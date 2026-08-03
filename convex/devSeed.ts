import {
  internalAction,
  internalMutation,
  internalQuery,
  MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { insertTransaction } from "./transactions";
import { generateForHousehold } from "./recurring";
import { debtOwed, potBalance } from "./lib/balances";
import { addDays, daysInMonth, firstDue, toISO } from "./lib/recurrence";

/**
 * Demo data for a dev deployment — a household that looks lived in, so every
 * screen has something real to show.
 *
 * Everything here is `internal`, so no client can ever call it, and it refuses
 * to run on any deployment without DEV_SEED=allow (see assertSeedable). Run it
 * with:
 *
 *   npx convex run devSeed:fill '{}'                     # newest household
 *   npx convex run devSeed:fill '{"householdName":"Home"}'
 *   npx convex run devSeed:fill '{"householdId":"kh74..."}'   # no ambiguity
 *   npx convex run devSeed:fill '{"fromMonth":"2025-01"}'
 *
 * It is destructive by design and re-runnable: it wipes the household's
 * transactions, funding rows, pots, assets and repeating rules first, then
 * rebuilds them. It NEVER touches households, members, categories or accounts —
 * so the login you already use keeps working.
 *
 * Two things it is careful about, because getting them wrong makes the numbers
 * lie:
 *  - transactions are written through `insertTransaction`, the one place that
 *    knows the funding rules — never by inserting `transactionFunding` by hand;
 *  - months are seeded in order, and a month's transfers go in before the
 *    expenses funded from those pots, because a pot-funded expense reads the
 *    pot's balance AT INSERT TIME and spills onto income if the pot is empty.
 *
 * Repeating rules are given start dates that keep every auto-posting rule in the
 * future, so syncing after a seed can never back-fill months of surprise
 * transactions. A couple of manual rules are deliberately left due today, so the
 * Due block has something to confirm.
 */

const rsd = (dinars: number) => Math.round(dinars * 100); // dinars → para

/** Deterministic PRNG, so re-seeding the same month gives the same data. */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;

const pick = <T>(r: Rand, xs: T[]): T => xs[Math.floor(r() * xs.length) % xs.length];
/** A messy amount in para, the way a receipt actually looks. */
const para = (r: Rand, loDinars: number, hiDinars: number) =>
  Math.round(loDinars * 100 + r() * (hiDinars - loDinars) * 100);
/** A round amount in whole dinars — bills, salaries, standing orders. */
const round = (r: Rand, loDinars: number, hiDinars: number) =>
  rsd(Math.round(loDinars + r() * (hiDinars - loDinars)));

const GROCERS = ["Maxi", "Lidl", "Idea", "Univerexport", "Roda", "DIS", "Aman"];
const FUEL = ["NIS Petrol", "MOL", "OMV", "Shell"];
const TAKEOUT = ["Wolt", "Glovo", "Kafeterija", "Pekara Trpković", "Salaš 011"];
const PHARMACY = ["Apoteka Benu", "Lilly", "Dr Ristić"];

// ---------------------------------------------------------------------------
// Funds, loans and assets
// ---------------------------------------------------------------------------

const POTS = [
  {
    key: "rainy",
    name: "Rainy day",
    kind: "savings" as const,
    icon: "piggy",
    color: "#1D9E75",
    targetAmount: rsd(600_000),
  },
  {
    key: "holiday",
    name: "Summer holiday",
    kind: "sinking" as const,
    icon: "plane",
    color: "#3B82F6",
    targetAmount: rsd(300_000),
    targetDate: "2027-06-15",
  },
  {
    key: "service",
    name: "Car service",
    kind: "sinking" as const,
    icon: "tools",
    color: "#E8632A",
    targetAmount: rsd(120_000),
  },
  {
    key: "repairs",
    name: "Home repairs",
    kind: "sinking" as const,
    icon: "repair",
    color: "#7C3AED",
    targetAmount: rsd(250_000),
  },
  {
    key: "homeLoan",
    name: "Home loan",
    kind: "debt" as const,
    icon: "home",
    color: "#DC2626",
    originalAmount: rsd(6_000_000),
    interestRate: 4.75,
    minimumPayment: rsd(38_400),
  },
  {
    key: "carLoan",
    name: "Car loan",
    kind: "debt" as const,
    icon: "car",
    color: "#B45309",
    originalAmount: rsd(900_000),
    interestRate: 8.9,
    minimumPayment: rsd(24_500),
  },
];

type PotKey = (typeof POTS)[number]["key"];
type PotIds = Record<string, Id<"pots">>;

// `opened` is the first time it was written down and `drift` what it was worth
// then, as a fraction of today — a flat up 8%, a car down to 88% of it.
const ASSETS = [
  { name: "Apartment", value: rsd(21_000_000), icon: "property", drift: 0.92, opened: "2025-01-10", valuedOn: "2026-01-15", debt: "homeLoan" },
  { name: "Škoda Octavia", value: rsd(1_450_000), icon: "car", drift: 1.14, opened: "2025-01-10", valuedOn: "2026-03-01", debt: "carLoan" },
  { name: "Foreign currency savings", value: rsd(620_000), icon: "vault", drift: 0.8, opened: "2025-02-01", valuedOn: "2026-06-30" },
];

// ---------------------------------------------------------------------------
// One month of money
// ---------------------------------------------------------------------------

type Spec = {
  day: number;
  direction: "income" | "expense" | "transfer";
  amount: number;
  category?: string; // category name
  pot?: PotKey; // transfer destination
  fromPot?: PotKey; // transfer source — a move, not new saving
  takeFrom?: PotKey; // expense funded from this fund
  loan?: PotKey; // expense that pays down this loan
  payee?: string;
  note?: string;
};

/** Payees owned by a repeating rule — the current month leaves them to it. */
const RULE_PAYEES = ["SBB", "FitPass"];

function monthPlan(month: string, lastDay: number): Spec[] {
  const r = rng(`doughnatello:${month}`);
  const mi = Number(month.slice(5, 7));
  const out: Spec[] = [];
  const add = (s: Spec) => {
    if (s.day <= lastDay) out.push(s);
  };

  // Income first — the month is paid on the 1st.
  add({
    day: 1,
    direction: "income",
    amount: round(r, 208_000, 214_000),
    category: "Income",
    payee: "Plata",
  });
  if (mi === 12) {
    add({
      day: 24,
      direction: "income",
      amount: rsd(120_000),
      category: "Income",
      payee: "Trinaesta plata",
      note: "Year-end bonus",
    });
  }
  if (r() < 0.35) {
    add({
      day: 6 + Math.floor(r() * 18),
      direction: "income",
      amount: round(r, 25_000, 70_000),
      category: "Income",
      payee: "Honorar",
      note: "Freelance",
    });
  }

  // Standing orders into the funds. These land early so the rest of the month
  // can be funded from them.
  add({ day: 2, direction: "transfer", amount: rsd(20_000), pot: "rainy" });
  add({ day: 2, direction: "transfer", amount: rsd(15_000), pot: "holiday" });
  add({ day: 2, direction: "transfer", amount: rsd(5_000), pot: "service" });
  if (mi % 2 === 0) {
    add({ day: 2, direction: "transfer", amount: rsd(10_000), pot: "repairs" });
  }

  // Loans — ordinary expenses tagged with the loan they pay down.
  add({
    day: 5,
    direction: "expense",
    amount: rsd(38_400),
    category: "Housing",
    loan: "homeLoan",
    payee: "Banca Intesa",
    note: "Home loan instalment",
  });
  add({
    day: 12,
    direction: "expense",
    amount: rsd(24_500),
    category: "Car",
    loan: "carLoan",
    payee: "OTP banka",
    note: "Car loan instalment",
  });

  // Bills.
  add({ day: 1, direction: "expense", amount: rsd(4_500), category: "Bills", payee: "SBB" });
  add({
    day: 8,
    direction: "expense",
    amount: round(r, 2_400, 3_300),
    category: "Bills",
    payee: "Yettel",
  });
  add({
    day: 15,
    direction: "expense",
    amount: round(r, 5_200, 7_800),
    category: "Bills",
    payee: "Infostan",
  });
  add({
    day: 18,
    direction: "expense",
    // Winter heating is the reason this one is an estimate rule in the app.
    amount: mi <= 3 || mi >= 11 ? round(r, 9_000, 14_500) : round(r, 4_500, 8_000),
    category: "Bills",
    payee: "EPS Snabdevanje",
  });

  // The everyday shopping.
  const shops = 8 + Math.floor(r() * 4);
  for (let i = 0; i < shops; i++) {
    add({
      day: 1 + Math.floor(r() * 28),
      direction: "expense",
      amount: para(r, 900, 9_500),
      category: "Grocery",
      payee: pick(r, GROCERS),
    });
  }
  for (let i = 0; i < 2 + Math.floor(r() * 2); i++) {
    add({
      day: 2 + Math.floor(r() * 26),
      direction: "expense",
      amount: para(r, 4_200, 8_500),
      category: "Fuel",
      payee: pick(r, FUEL),
    });
  }
  for (let i = 0; i < 3 + Math.floor(r() * 4); i++) {
    add({
      day: 1 + Math.floor(r() * 28),
      direction: "expense",
      amount: para(r, 650, 3_900),
      category: "Takeout",
      payee: pick(r, TAKEOUT),
    });
  }

  add({ day: 2, direction: "expense", amount: rsd(3_900), category: "Fitness", payee: "FitPass" });
  add({
    day: 9 + Math.floor(r() * 12),
    direction: "expense",
    amount: para(r, 1_800, 4_200),
    category: "Pets",
    payee: "Pet Centar",
  });
  if (r() < 0.7) {
    add({
      day: 4 + Math.floor(r() * 22),
      direction: "expense",
      amount: para(r, 850, 5_500),
      category: "Health",
      payee: pick(r, PHARMACY),
    });
  }
  if (r() < 0.4 || mi === 12) {
    add({
      day: 6 + Math.floor(r() * 20),
      direction: "expense",
      amount: para(r, 2_000, 12_000),
      category: "Gift",
      payee: pick(r, ["Zara", "IKEA", "Tehnomanija", "Delta City"]),
    });
  }

  // The big ones, paid out of the fund that was saved for them.
  if (mi === 7 || mi === 8) {
    add({
      day: 10 + Math.floor(r() * 10),
      direction: "expense",
      amount: round(r, 60_000, 110_000),
      category: "Travel",
      takeFrom: "holiday",
      payee: pick(r, ["Booking.com", "Air Serbia", "Kon Tiki Travel"]),
      note: "Summer holiday",
    });
  }
  if (mi === 4 || mi === 10) {
    add({
      day: 8 + Math.floor(r() * 14),
      direction: "expense",
      amount: round(r, 12_000, 32_000),
      category: "Car",
      takeFrom: "service",
      payee: "Auto servis Petrović",
      note: mi === 4 ? "Summer tyres + service" : "Winter tyres",
    });
  }
  // One of each kind of move, pinned to a month so they are always there to
  // look at: money changing its mind about which fund it is for, and money
  // being let go of entirely. Both are relabelling — neither touches the month.
  // Sourced from the rainy-day fund rather than the holiday one: by September
  // the holiday fund has just paid for a holiday and is empty, and a move may
  // not overdraw its source.
  if (month === "2025-09") {
    add({
      day: 15,
      direction: "transfer",
      amount: rsd(25_000),
      fromPot: "rainy",
      pot: "repairs",
      note: "Boiler first",
    });
  }
  if (month === "2026-03") {
    add({
      day: 20,
      direction: "transfer",
      amount: rsd(8_000),
      fromPot: "rainy",
      note: "Freed up",
    });
  }

  // Deliberately more than the fund holds by November: the overspill is funded
  // from the month's income, which is the split-funding path made visible.
  if (mi === 11) {
    add({
      day: 22,
      direction: "expense",
      amount: rsd(95_000),
      category: "Housing",
      takeFrom: "repairs",
      payee: "Majstor",
      note: "New boiler",
    });
  }

  // Transfers before expenses, then by day: a pot-funded expense must never be
  // inserted before the transfer that filled the pot.
  const order = (s: Spec) => s.day * 10 + (s.direction === "transfer" ? 0 : 1);
  return out.sort((a, b) => order(a) - order(b));
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * The seed deletes a household's entire financial history, and pushing to main
 * deploys these functions to production alongside the dev deployment. So it is
 * opt-in per deployment rather than opt-out: it runs only where someone has
 * deliberately set DEV_SEED=allow, which production never will.
 *
 *   npx convex env set DEV_SEED allow
 */
function assertSeedable() {
  if (process.env.DEV_SEED !== "allow") {
    throw new Error(
      "devSeed is disabled on this deployment. It wipes real data — enable it only " +
        "on a dev deployment with: npx convex env set DEV_SEED allow",
    );
  }
}

/**
 * Which household gets wiped and rebuilt. Three ways to say it, in order of
 * how sure you are:
 *
 *   householdId   — exactly this one. The only form with no ambiguity.
 *   householdName — the first with this name, which is a problem the moment
 *                   two share one. Two households called "Home" on the same
 *                   deployment is not hypothetical; it is what a second person
 *                   signing up produces, since that is the default name.
 *   neither       — the newest. Convenient on a dev deployment where the one
 *                   you just made is the one you mean, and exactly why this
 *                   must never be pointed at production.
 */
async function resolveHousehold(
  ctx: MutationCtx,
  name?: string,
  id?: Id<"households">,
) {
  assertSeedable();
  if (id) {
    const byId = await ctx.db.get(id);
    if (!byId) throw new Error(`No household with id ${id}`);
    return byId;
  }
  const households = await ctx.db.query("households").collect();
  if (households.length === 0) throw new Error("No households — sign in and create one first");
  if (name) {
    const matches = households.filter((h) => h.name === name);
    if (matches.length === 0) throw new Error(`No household named "${name}"`);
    if (matches.length > 1) {
      throw new Error(
        `${matches.length} households are named "${name}" — pass householdId instead. ` +
          matches.map((h) => `${h._id} (created ${new Date(h.createdAt).toISOString().slice(0, 10)})`).join(", "),
      );
    }
    return matches[0];
  }
  return households.sort((a, b) => b.createdAt - a.createdAt)[0];
}

/**
 * Wipe everything derived, then create the funds, loans and assets.
 *
 * Categories, accounts, members and the household itself are left alone — the
 * login you already use has to keep working. Funding rows go before the
 * transactions they hang off, so nothing is ever orphaned mid-delete.
 */
export const prepare = internalMutation({
  args: {
    householdName: v.optional(v.string()),
    householdId: v.optional(v.id("households")),
    reset: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const household = await resolveHousehold(
      ctx,
      args.householdName,
      args.householdId,
    );
    const householdId = household._id;

    const members = await ctx.db
      .query("householdMembers")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    if (members.length === 0) throw new Error("Household has no members");

    const account = (
      await ctx.db
        .query("accounts")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect()
    ).find((a) => a.isPrimary && !a.isArchived);
    if (!account) throw new Error("Household has no primary account");

    if (args.reset !== false) {
      const [funding, occurrences, txs, rules, assets, pots, valuations] =
        await Promise.all([
        ctx.db
          .query("transactionFunding")
          .withIndex("by_household_pot", (q) => q.eq("householdId", householdId))
          .collect(),
        ctx.db
          .query("recurringOccurrences")
          .withIndex("by_household", (q) => q.eq("householdId", householdId))
          .collect(),
        ctx.db
          .query("transactions")
          .withIndex("by_household_date", (q) => q.eq("householdId", householdId))
          .collect(),
        ctx.db
          .query("recurringRules")
          .withIndex("by_household", (q) => q.eq("householdId", householdId))
          .collect(),
        ctx.db
          .query("assets")
          .withIndex("by_household", (q) => q.eq("householdId", householdId))
          .collect(),
        ctx.db
          .query("pots")
          .withIndex("by_household", (q) => q.eq("householdId", householdId))
          .collect(),
        ctx.db
          .query("assetValuations")
          .withIndex("by_household", (q) => q.eq("householdId", householdId))
          .collect(),
      ]);
      for (const doc of [
        ...funding,
        ...occurrences,
        ...txs,
        ...rules,
        ...valuations,
        ...assets,
        ...pots,
      ]) {
        await ctx.db.delete(doc._id);
      }
    }

    let sortOrder = 0;
    const potIds: PotIds = {};
    for (const p of POTS) {
      const { key, ...fields } = p;
      potIds[key] = await ctx.db.insert("pots", {
        householdId,
        ...fields,
        sortOrder: sortOrder++,
        isRealAccount: false,
        isArchived: false,
      });
    }

    for (const a of ASSETS) {
      const assetId = await ctx.db.insert("assets", {
        householdId,
        name: a.name,
        value: a.value,
        icon: a.icon,
        valuedOn: a.valuedOn,
        linkedDebtPotId: a.debt ? potIds[a.debt] : undefined,
        isArchived: false,
      });
      // A first entry a year earlier, then today's — so the flat has actually
      // moved this year and the net-worth change has something to say.
      for (const [value, valuedOn] of [
        [Math.round(a.value * (a.drift ?? 1)), a.opened],
        [a.value, a.valuedOn],
      ] as const) {
        await ctx.db.insert("assetValuations", {
          householdId,
          assetId,
          value,
          valuedOn,
          createdAt: Date.now(),
          createdBy: members[0].userId,
        });
      }
    }

    return { householdId, householdName: household.name };
  },
});

/** One month of transactions, in date order. */
export const seedMonth = internalMutation({
  args: {
    householdId: v.id("households"),
    month: v.string(), // YYYY-MM
    lastDay: v.number(),
    isCurrentMonth: v.boolean(),
  },
  handler: async (ctx, { householdId, month, lastDay, isCurrentMonth }) => {
    const [categories, pots, members] = await Promise.all([
      ctx.db
        .query("categories")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("pots")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("householdMembers")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
    ]);
    const catByName = new Map(categories.map((c) => [c.name, c._id]));
    const potByName = new Map(pots.map((p) => [p.name, p._id]));
    const potId = (key: PotKey) => {
      const name = POTS.find((p) => p.key === key)!.name;
      const id = potByName.get(name);
      if (!id) throw new Error(`Missing fund "${name}" — run prepare first`);
      return id;
    };

    let created = 0;
    for (const s of monthPlan(month, lastDay)) {
      if (isCurrentMonth && s.payee && RULE_PAYEES.includes(s.payee)) continue;

      const categoryId = s.category ? catByName.get(s.category) : undefined;
      if (s.category && !categoryId) continue; // category was renamed away

      // Spread the paying member around when a household has more than one.
      const paidBy = members[created % members.length].userId;

      await insertTransaction(ctx, members[0].userId, {
        householdId,
        direction: s.direction,
        amount: s.amount,
        categoryId: s.direction === "transfer" ? undefined : categoryId,
        // Destination fund on a transfer; the loan it pays down on an expense.
        potId: s.pot ? potId(s.pot) : s.loan ? potId(s.loan) : undefined,
        fromPotId: s.fromPot ? potId(s.fromPot) : undefined,
        takeFromPotId: s.takeFrom ? potId(s.takeFrom) : undefined,
        occurredOn: `${month}-${String(s.day).padStart(2, "0")}`,
        payee: s.payee,
        note: s.note,
        paidBy,
      });
      created++;
    }
    return created;
  },
});

/**
 * Repeating rules, the bank balance, and one sync.
 *
 * Auto-posting rules start tomorrow, so the sync at the end can never invent
 * transactions for months that were just seeded by hand. The manual ones start
 * on the 1st of this month, which leaves the early-month ones pending — that is
 * what fills the Due block.
 */
export const finish = internalMutation({
  args: { householdId: v.id("households"), today: v.string() },
  handler: async (ctx, { householdId, today }) => {
    const [categories, pots, members, accounts] = await Promise.all([
      ctx.db
        .query("categories")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("pots")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("householdMembers")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("accounts")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
    ]);
    const cat = (name: string) => categories.find((c) => c.name === name)?._id;
    const pot = (key: PotKey) =>
      pots.find((p) => p.name === POTS.find((x) => x.key === key)!.name)?._id;
    const account = accounts.find((a) => a.isPrimary && !a.isArchived)!;
    const createdBy = members[0].userId;

    const tomorrow = addDays(today, 1);
    const monthStart = `${today.slice(0, 7)}-01`;

    type RuleSpec = {
      direction: "income" | "expense" | "transfer";
      amount: number;
      amountMode: "exact" | "estimate";
      categoryId?: Id<"categories">;
      potId?: Id<"pots">;
      payee?: string;
      note?: string;
      cadence: "weekly" | "monthly" | "yearly";
      anchorDay: number;
      startOn: string;
      autoPost: boolean;
    };

    const rules: RuleSpec[] = [
      {
        direction: "income",
        amount: rsd(210_000),
        amountMode: "exact",
        categoryId: cat("Income"),
        payee: "Plata",
        cadence: "monthly",
        anchorDay: 1,
        startOn: tomorrow,
        autoPost: true,
      },
      {
        direction: "expense",
        amount: rsd(38_400),
        amountMode: "exact",
        categoryId: cat("Housing"),
        potId: pot("homeLoan"), // the instalment pays the loan down
        payee: "Banca Intesa",
        note: "Home loan instalment",
        cadence: "monthly",
        anchorDay: 5,
        startOn: monthStart,
        autoPost: false,
      },
      {
        direction: "expense",
        amount: rsd(24_500),
        amountMode: "exact",
        categoryId: cat("Car"),
        potId: pot("carLoan"),
        payee: "OTP banka",
        note: "Car loan instalment",
        cadence: "monthly",
        anchorDay: 12,
        startOn: tomorrow,
        autoPost: true,
      },
      {
        direction: "expense",
        amount: rsd(4_500),
        amountMode: "exact",
        categoryId: cat("Bills"),
        payee: "SBB",
        cadence: "monthly",
        anchorDay: 1,
        startOn: monthStart,
        autoPost: false,
      },
      {
        direction: "expense",
        amount: rsd(3_900),
        amountMode: "exact",
        categoryId: cat("Fitness"),
        payee: "FitPass",
        cadence: "monthly",
        anchorDay: 2,
        startOn: monthStart,
        autoPost: false,
      },
      {
        direction: "expense",
        amount: rsd(2_900),
        amountMode: "exact",
        categoryId: cat("Bills"),
        payee: "Yettel",
        cadence: "monthly",
        anchorDay: 8,
        startOn: tomorrow,
        autoPost: true,
      },
      {
        // An estimate: the bill arrives, you type what it actually was.
        direction: "expense",
        amount: rsd(7_500),
        amountMode: "estimate",
        categoryId: cat("Bills"),
        payee: "EPS Snabdevanje",
        note: "Varies with the season",
        cadence: "monthly",
        anchorDay: 18,
        startOn: monthStart,
        autoPost: false,
      },
      {
        direction: "transfer",
        amount: rsd(20_000),
        amountMode: "exact",
        potId: pot("rainy"),
        note: "Standing order",
        cadence: "monthly",
        anchorDay: 3,
        startOn: tomorrow,
        autoPost: true,
      },
      {
        direction: "expense",
        amount: rsd(46_000),
        amountMode: "exact",
        categoryId: cat("Car"),
        payee: "Dunav osiguranje",
        note: "Car insurance",
        cadence: "yearly",
        anchorDay: 20,
        startOn: `${Number(today.slice(0, 4))}-09-01`,
        autoPost: false,
      },
      {
        direction: "expense",
        amount: rsd(1_290),
        amountMode: "exact",
        categoryId: cat("Takeout"),
        payee: "Kafeterija",
        note: "Friday coffee",
        cadence: "weekly",
        anchorDay: Number(tomorrow.slice(8, 10)),
        startOn: tomorrow,
        autoPost: true,
      },
    ];

    for (const r of rules) {
      // A rule whose category or fund was renamed away is skipped, not guessed.
      if (r.direction === "transfer" ? !r.potId : !r.categoryId) continue;
      const recurrence = { cadence: r.cadence, intervalCount: 1, anchorDay: r.anchorDay };
      await ctx.db.insert("recurringRules", {
        householdId,
        createdBy,
        direction: r.direction,
        categoryId: r.direction === "transfer" ? undefined : r.categoryId,
        potId: r.direction === "income" ? undefined : r.potId,
        accountId: account._id,
        amount: r.amount,
        amountMode: r.amountMode,
        payee: r.payee,
        note: r.note,
        cadence: r.cadence,
        intervalCount: 1,
        anchorDay: r.anchorDay,
        startOn: r.startOn,
        nextDueOn: firstDue(r.startOn, recurrence),
        autoPost: r.autoPost,
        isActive: true,
      });
    }

    // Materialise what is already due, so the Due block is populated on open.
    const sync = await generateForHousehold(ctx, householdId, today);

    // The bank balance is entered by hand in the real app, so it has to be set
    // to something the history agrees with: an opening float, plus every dinar
    // that came in, minus every dinar that went out. Transfers move nothing —
    // funds are virtual partitions of this same balance.
    const txs = await ctx.db
      .query("transactions")
      .withIndex("by_household_date", (q) => q.eq("householdId", householdId))
      .collect();
    let flow = rsd(250_000);
    for (const t of txs) {
      if (t.direction === "income") flow += t.amount;
      else if (t.direction === "expense") flow -= t.amount;
    }
    await ctx.db.patch(account._id, { bankBalance: flow });

    return { rules: rules.length, totalTransactions: txs.length, sync, bankBalance: flow };
  },
});

/**
 * The whole job. Split across mutations by month so no single transaction gets
 * anywhere near Convex's read/write limits, and so a failure halfway leaves
 * something inspectable rather than a silent rollback of twenty months.
 */
export const fill = internalAction({
  args: {
    householdName: v.optional(v.string()),
    householdId: v.optional(v.id("households")),
    fromMonth: v.optional(v.string()), // YYYY-MM, default 19 months back
    reset: v.optional(v.boolean()), // default true
  },
  // The return type is spelled out because an action that calls mutations in
  // its own module is otherwise circular to infer.
  handler: async (
    ctx,
    args,
  ): Promise<{
    household: string;
    months: string;
    transactions: number;
    totalTransactions: number;
    rules: number;
    sync: { created: number; posted: number };
    bankBalance: number;
  }> => {
    const now = new Date();
    const today = toISO(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());

    const { householdId, householdName } = await ctx.runMutation(internal.devSeed.prepare, {
      householdName: args.householdName,
      householdId: args.householdId,
      reset: args.reset ?? true,
    });

    const start = args.fromMonth ?? monthsBack(today.slice(0, 7), 19);
    const months = monthRange(start, today.slice(0, 7));

    let transactions = 0;
    for (const month of months) {
      const isCurrentMonth = month === today.slice(0, 7);
      const [y, m] = month.split("-").map(Number);
      const lastDay = isCurrentMonth ? Number(today.slice(8, 10)) : daysInMonth(y, m);
      transactions += await ctx.runMutation(internal.devSeed.seedMonth, {
        householdId,
        month,
        lastDay,
        isCurrentMonth,
      });
    }

    const summary = await ctx.runMutation(internal.devSeed.finish, { householdId, today });

    return {
      household: householdName,
      months: `${months[0]} → ${months[months.length - 1]}`,
      transactions,
      ...summary,
    };
  },
});

/**
 * What the seed produced, in one line per number — the same figures the app
 * shows, so you can tell a bad seed from a bad screen without logging in.
 *
 *   npx convex run devSeed:check '{"householdName":"Home"}'
 */
export const check = internalQuery({
  args: {
    householdName: v.optional(v.string()),
    householdId: v.optional(v.id("households")),
  },
  handler: async (ctx, args) => {
    const households = await ctx.db.query("households").collect();
    const household = args.householdId
      ? households.find((h) => h._id === args.householdId)
      : args.householdName
        ? households.find((h) => h.name === args.householdName)
        : households.sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!household) throw new Error("No such household");
    const householdId = household._id;

    const [txs, pots, accounts, assets, occurrences] = await Promise.all([
      ctx.db
        .query("transactions")
        .withIndex("by_household_date", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("pots")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("accounts")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("assets")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("recurringOccurrences")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
    ]);

    const funds: Record<string, number> = {};
    let setAside = 0;
    let owed = 0;
    for (const p of pots) {
      if (p.kind === "debt") {
        const d = await debtOwed(ctx, householdId, p);
        funds[p.name] = -d;
        owed += d;
      } else {
        const b = await potBalance(ctx, householdId, p._id);
        funds[p.name] = b;
        setAside += b;
      }
    }

    const inBank = accounts.reduce((s, a) => s + a.bankBalance, 0);
    const assetTotal = assets.reduce((s, a) => s + a.value, 0);
    const spans = txs.map((t) => t.occurredOn).sort();

    return {
      household: household.name,
      transactions: txs.length,
      span: `${spans[0]} → ${spans[spans.length - 1]}`,
      inBank,
      setAside,
      free: inBank - setAside,
      netWorth: inBank + assetTotal - owed,
      funds,
      pendingOccurrences: occurrences.filter((o) => o.status === "pending").length,
    };
  },
});

/** `n` months before `month`; a negative `n` walks forward. */
function monthsBack(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) - n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to && out.length < 240) {
    out.push(cur);
    cur = monthsBack(cur, -1);
  }
  return out;
}
