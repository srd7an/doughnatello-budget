import { query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireMember } from "./lib/auth";
import { potBalance, debtOwed } from "./lib/balances";

/**
 * The month's headline numbers — a single pass over the month's transactions
 * and their funding rows. This is where the two counting rules pay off.
 *
 *   income               = Σ income transactions
 *   expense (composition)= Σ funding(potId: undefined) on EXPENSE txns
 *   savings              = Σ funding(potId: undefined) on TRANSFER txns
 *                          (setting money aside — reduces leftToSpend)
 *   paidFromFunds        = Σ funding(potId: set) on EXPENSE txns
 *                          (pot spending — does NOT reduce leftToSpend)
 *
 *   leftToSpend = income − expense − savings
 *              (= income − all income-funded outflows). Pot-funded spending is
 *              absent by construction, so it never double-counts.
 *
 * income = expense + savings + leftToSpend, which is exactly the composition
 * bar. `leftToSpend` is labelled "Left to spend" for the current month and
 * "Leftover" for a finished one — same number, the UI picks the word.
 */
export const month = query({
  args: { householdId: v.id("households"), month: v.string() }, // YYYY-MM
  handler: async (ctx, { householdId, month }) => {
    await requireMember(ctx, householdId);

    const txs = await ctx.db
      .query("transactions")
      .withIndex("by_household_date", (q) =>
        q
          .eq("householdId", householdId)
          .gte("occurredOn", `${month}-01`)
          .lte("occurredOn", `${month}-31`),
      )
      .collect();

    let income = 0;
    let expense = 0;
    let savings = 0;
    let paidFromFunds = 0;

    for (const t of txs) {
      if (t.direction === "income") {
        income += t.amount;
        continue;
      }
      const funding = await ctx.db
        .query("transactionFunding")
        .withIndex("by_transaction", (q) => q.eq("transactionId", t._id))
        .collect();
      const fromIncome = funding
        .filter((f) => f.potId === undefined)
        .reduce((s, f) => s + f.amount, 0);
      const fromPots = funding
        .filter((f) => f.potId !== undefined)
        .reduce((s, f) => s + f.amount, 0);

      if (t.direction === "transfer") savings += fromIncome;
      else {
        expense += fromIncome;
        paidFromFunds += fromPots;
      }
    }

    const leftToSpend = income - expense - savings;
    return { income, expense, savings, leftToSpend, paidFromFunds };
  },
});

/**
 * The three balance numbers, which are all distinct from leftToSpend:
 *   inBank   — the manually-entered bank balance
 *   setAside — Σ savings + sinking pot balances (debt EXCLUDED)
 *   free     — inBank − setAside
 * "Free" answers how much slack exists at all; leftToSpend answers can I buy
 * this today. Never merge them.
 */
export const balances = query({
  args: { householdId: v.id("households") },
  handler: async (ctx, { householdId }) => {
    await requireMember(ctx, householdId);

    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    const inBank = accounts
      .filter((a) => !a.isArchived)
      .reduce((s, a) => s + a.bankBalance, 0);

    const pots = await ctx.db
      .query("pots")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();

    let setAside = 0;
    for (const p of pots) {
      if (p.isArchived) continue;
      // Debt pots are NOT money set aside.
      if (p.kind === "savings" || p.kind === "sinking") {
        setAside += await potBalance(ctx, householdId, p._id);
      }
    }

    return { inBank, setAside, free: inBank - setAside };
  },
});

/**
 * Net worth.
 *
 *   netWorth = Σ bank balances + Σ asset values − Σ debt owed
 *
 * DO NOT add savings/sinking pot balances. They are virtual partitions of money
 * already inside `bankBalance`; adding them double-counts. "Sum everything
 * positive, subtract everything negative" is the obvious-looking WRONG answer —
 * only pots with isRealAccount === true would ever be summed separately, and
 * none are today. This is why moving money between the main account and a pot
 * leaves net worth unchanged.
 */
export const netWorth = query({
  args: { householdId: v.id("households") },
  handler: async (ctx, { householdId }) => {
    await requireMember(ctx, householdId);

    const [accounts, assets, pots] = await Promise.all([
      ctx.db
        .query("accounts")
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
    ]);

    const bank = accounts
      .filter((a) => !a.isArchived)
      .reduce((s, a) => s + a.bankBalance, 0);
    const assetsTotal = assets
      .filter((a) => !a.isArchived)
      .reduce((s, a) => s + a.value, 0);

    let debt = 0;
    for (const p of pots) {
      if (!p.isArchived && p.kind === "debt") {
        debt += await debtOwed(ctx, householdId, p);
      }
    }

    return {
      netWorth: bank + assetsTotal - debt,
      bank,
      assets: assetsTotal,
      debt,
    };
  },
});

type StockItem = {
  _id: Id<"pots"> | Id<"assets">;
  name: string;
  icon: string;
  color: string;
  balance: number; // current, all-time (loans are negative = owed)
  change: number; // this year
  valuedOn?: string;
};

/**
 * Everything the year view needs in one pass: 12 monthly composition buckets,
 * year totals, the net-worth hero + this-year change, and the Funds/Assets/
 * Loans stock rows (each with a current balance and a this-year change).
 *
 * Net-worth change this year = income − real expenses + asset revaluation,
 * where "real" EXCLUDES loan-payment expenses (a loan payment swaps cash for
 * reduced debt — net-worth neutral). Transfers into pots are also excluded
 * (virtual, net-worth neutral). Revaluation comes from assetValuations; see
 * the note on why an asset's FIRST valuation is not a gain.
 */
export const year = query({
  args: { householdId: v.id("households"), year: v.string() }, // "2026"
  handler: async (ctx, { householdId, year }) => {
    await requireMember(ctx, householdId);

    const txs = await ctx.db
      .query("transactions")
      .withIndex("by_household_date", (q) =>
        q
          .eq("householdId", householdId)
          .gte("occurredOn", `${year}-01-01`)
          .lte("occurredOn", `${year}-12-31`),
      )
      .collect();

    const [pots, assets, accounts, valuations] = await Promise.all([
      ctx.db
        .query("pots")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("assets")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("accounts")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("assetValuations")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
    ]);

    /**
     * What an asset's value did across this year.
     *
     * Only RE-valuations count. An asset whose first entry falls inside the
     * year did not grow by its whole worth — it was written down for the first
     * time, and treating that as a gain would put the price of a flat into one
     * year's net-worth change. So an asset that did not exist at the start of
     * the year contributes nothing to the change, however much it is worth.
     */
    const valueAt = (rows: typeof valuations, on: string) => {
      const before = rows.filter((v) => v.valuedOn <= on);
      if (before.length === 0) return null;
      return before.reduce((a, b) => (a.valuedOn >= b.valuedOn ? a : b)).value;
    };
    const startOfYear = `${Number(year) - 1}-12-31`;
    const endOfYear = `${year}-12-31`;
    const assetChange = new Map<Id<"assets">, number>();
    for (const a of assets) {
      const rows = valuations.filter((v) => v.assetId === a._id);
      const opened = valueAt(rows, startOfYear);
      if (opened === null) continue; // first written down this year
      assetChange.set(a._id, (valueAt(rows, endOfYear) ?? opened) - opened);
    }

    const debtPotIds = new Set(
      pots.filter((p) => p.kind === "debt").map((p) => p._id),
    );

    const months = Array.from({ length: 12 }, () => ({
      income: 0,
      expense: 0,
      savings: 0,
      leftToSpend: 0,
      paidFromFunds: 0,
    }));

    let realExpenseFull = 0; // income − this = net-worth change
    const transfersInYear = new Map<Id<"pots">, number>();
    const spentFromPotYear = new Map<Id<"pots">, number>();
    const debtPaidYear = new Map<Id<"pots">, number>();

    for (const t of txs) {
      const mi = Number(t.occurredOn.slice(5, 7)) - 1;
      const bucket = months[mi];
      if (t.direction === "income") {
        bucket.income += t.amount;
        continue;
      }
      const funding = await ctx.db
        .query("transactionFunding")
        .withIndex("by_transaction", (q) => q.eq("transactionId", t._id))
        .collect();
      const fromIncome = funding
        .filter((f) => f.potId === undefined)
        .reduce((s, f) => s + f.amount, 0);

      if (t.direction === "transfer") {
        bucket.savings += fromIncome;
        if (t.potId)
          transfersInYear.set(
            t.potId,
            (transfersInYear.get(t.potId) ?? 0) + t.amount,
          );
        // Money moved OUT of a fund — to another fund, or released back to the
        // balance. It leaves the source exactly as spending it would, so the
        // source's change for the year has to see it. It is NOT paidFromFunds:
        // nothing was bought.
        for (const f of funding) {
          if (f.potId) {
            spentFromPotYear.set(
              f.potId,
              (spentFromPotYear.get(f.potId) ?? 0) + f.amount,
            );
          }
        }
      } else {
        bucket.expense += fromIncome;
        for (const f of funding) {
          if (f.potId) {
            bucket.paidFromFunds += f.amount;
            spentFromPotYear.set(
              f.potId,
              (spentFromPotYear.get(f.potId) ?? 0) + f.amount,
            );
          }
        }
        if (t.potId && debtPotIds.has(t.potId)) {
          debtPaidYear.set(t.potId, (debtPaidYear.get(t.potId) ?? 0) + t.amount);
        } else {
          realExpenseFull += t.amount;
        }
      }
    }
    for (const m of months) m.leftToSpend = m.income - m.expense - m.savings;

    const totals = months.reduce(
      (a, m) => ({
        income: a.income + m.income,
        expense: a.expense + m.expense,
        savings: a.savings + m.savings,
        leftToSpend: a.leftToSpend + m.leftToSpend,
        paidFromFunds: a.paidFromFunds + m.paidFromFunds,
      }),
      { income: 0, expense: 0, savings: 0, leftToSpend: 0, paidFromFunds: 0 },
    );

    const bank = accounts
      .filter((a) => !a.isArchived)
      .reduce((s, a) => s + a.bankBalance, 0);

    const fundItems: StockItem[] = [];
    const loanItems: StockItem[] = [];
    for (const p of pots) {
      if (p.isArchived) continue;
      if (p.kind === "savings" || p.kind === "sinking") {
        fundItems.push({
          _id: p._id,
          name: p.name,
          icon: p.icon,
          color: p.color,
          balance: await potBalance(ctx, householdId, p._id),
          change:
            (transfersInYear.get(p._id) ?? 0) - (spentFromPotYear.get(p._id) ?? 0),
        });
      } else if (p.kind === "debt") {
        loanItems.push({
          _id: p._id,
          name: p.name,
          icon: p.icon,
          color: p.color,
          balance: -(await debtOwed(ctx, householdId, p)), // negative = owed
          change: debtPaidYear.get(p._id) ?? 0, // +paid
        });
      }
    }
    const assetItems: StockItem[] = assets
      .filter((a) => !a.isArchived)
      .map((a) => ({
        _id: a._id,
        name: a.name,
        // Assets have no colour of their own — they are not funds, and the
        // neutral keeps them from reading as one.
        icon: a.icon ?? "money",
        color: "#a8a29e",
        balance: a.value,
        change: assetChange.get(a._id) ?? 0,
        valuedOn: a.valuedOn,
      }));

    const total = (items: StockItem[], k: "balance" | "change") =>
      items.reduce((s, i) => s + i[k], 0);

    const funds = {
      balance: total(fundItems, "balance"),
      change: total(fundItems, "change"),
      items: fundItems,
    };
    const loans = {
      balance: total(loanItems, "balance"),
      change: total(loanItems, "change"),
      items: loanItems,
    };
    const assetGroup = {
      balance: total(assetItems, "balance"),
      change: total(assetItems, "change"),
      items: assetItems,
    };

    const debtTotal = -loans.balance; // loans.balance is negative owed
    return {
      netWorth: bank + assetGroup.balance - debtTotal,
      // Money in minus money really out, PLUS what the things you own did on
      // their own. A flat that went up 10% is net worth that arrived without
      // passing through the account, and leaving it out was the one thing this
      // figure knowingly missed.
      netWorthChange: totals.income - realExpenseFull + assetGroup.change,
      bank,
      months,
      totals,
      funds,
      assets: assetGroup,
      loans,
    };
  },
});
