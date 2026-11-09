import { query } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { requireMember } from "./lib/auth";
import {
  potBalance,
  debtOwed,
  bankTotal,
  bankTotalAsOf,
} from "./lib/balances";

/**
 * The month's headline numbers — a single pass over the month's transactions
 * and their funding rows.
 *
 *   income      = Σ income transactions
 *   expense     = Σ ALL funding on EXPENSE txns — from income and from funds
 *   savings     = Σ funding(potId: undefined) on TRANSFER txns   (set aside)
 *               − Σ funding(potId: set) on EXPENSE txns          (drawn down)
 *
 *   leftToSpend = income − expense − savings
 *
 * SAVINGS CAN BE NEGATIVE, and that is the point. Money set aside in March and
 * spent in September is a positive saving in March and a negative one in
 * September, so over the year it nets to nothing and the spending shows once,
 * in the month it happened. The model this replaced left pot-funded spending
 * out of `expense` entirely, which meant the year claimed you had SAVED 6.000
 * you had actually spent on the car.
 *
 * Two things it deliberately does not change:
 *
 * `leftToSpend` is arithmetically identical. Writing Ei for spending funded by
 * income, Ep for spending funded by a fund and S for money set aside, it was
 * income − Ei − S and is now income − (Ei + Ep) − (S − Ep). Ep cancels. "How
 * much may I still spend" was right before and is the same number now.
 *
 * The identity income = expense + savings + leftToSpend still holds by
 * construction, which is what the composition bar draws. When savings is
 * negative the bar is WIDER than income by that amount — the month spent past
 * what it earned, and the picture says so without a word.
 *
 * A move between funds stays neutral: its funding row carries a potId but sits
 * on a TRANSFER, and only expense transactions contribute to `expense`.
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

    // Which side of savings a transfer fed depends on the fund it went into.
    const kindByPot = new Map(
      (
        await ctx.db
          .query("pots")
          .withIndex("by_household", (q) => q.eq("householdId", householdId))
          .collect()
      ).map((p) => [p._id, p.kind]),
    );

    let income = 0;
    let expense = 0;
    let setAside = 0;
    let sinking = 0;
    // Money taken back out of a fund to pay for something, split by what the
    // fund was FOR. Drawing on a sinking fund is the plan completing; drawing
    // on a savings fund is a month that did not fit inside its income. Both
    // reduce savings by the same arithmetic — only the UI cares which.
    let drawnPlanned = 0;
    let drawnFromSavings = 0;

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

      if (t.direction === "transfer") {
        setAside += fromIncome;
        // A sinking fund is money already promised to a bill that has not
        // arrived yet — the registration, the service. Still money set aside,
        // but DEFERRED SPENDING rather than accumulation.
        if (t.potId && kindByPot.get(t.potId) === "sinking") sinking += fromIncome;
        continue;
      }

      // An expense. Everything that paid for it is spending, whichever pocket
      // it came out of.
      expense += fromIncome;
      for (const f of funding) {
        if (!f.potId) continue;
        expense += f.amount;
        if (kindByPot.get(f.potId) === "sinking") drawnPlanned += f.amount;
        else drawnFromSavings += f.amount;
      }
    }

    const drawnFromFunds = drawnPlanned + drawnFromSavings;
    const savings = setAside - drawnFromFunds;
    const leftToSpend = income - expense - savings;

    return {
      income,
      expense,
      savings,
      leftToSpend,
      // The parts of `savings`, for a UI that wants to say why it moved.
      // setAside − drawnFromFunds === savings, always.
      setAside,
      sinking,
      drawnFromFunds,
      drawnPlanned,
      drawnFromSavings,
    };
  },
});

/**
 * Funds, loans and assets as the month left them — the cards under the bar.
 *
 * Deliberately the same shape the year returns, because the two screens show
 * the same three groups and the only difference is the window: `change` is what
 * moved this month rather than this year, and `balance` is where the thing
 * stands now either way. One shape means one card component.
 *
 * Everything is listed, including what did not move. These are stocks — what
 * you HAVE — and a fund missing from the list because it had a quiet month
 * reads as a fund you no longer have.
 */
export const monthStocks = query({
  args: { householdId: v.id("households"), month: v.string() }, // YYYY-MM
  handler: async (ctx, { householdId, month }) => {
    await requireMember(ctx, householdId);

    const [txs, pots, assets] = await Promise.all([
      ctx.db
        .query("transactions")
        .withIndex("by_household_date", (q) =>
          q
            .eq("householdId", householdId)
            .gte("occurredOn", `${month}-01`)
            .lte("occurredOn", `${month}-31`),
        )
        .collect(),
      ctx.db
        .query("pots")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("assets")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
    ]);

    const moved = new Map<Id<"pots">, number>();
    const add = (id: Id<"pots">, n: number) =>
      moved.set(id, (moved.get(id) ?? 0) + n);

    for (const t of txs) {
      // Into a fund, or off a loan. A debt pot going "up" means less owed,
      // which is why both read as a positive movement of the same kind.
      if (t.potId) add(t.potId, t.amount);
      const funding = await ctx.db
        .query("transactionFunding")
        .withIndex("by_transaction", (q) => q.eq("transactionId", t._id))
        .collect();
      // Out of a fund: spent from it, or moved to another one.
      for (const f of funding) if (f.potId) add(f.potId, -f.amount);
    }

    const funds: StockItem[] = [];
    const loans: StockItem[] = [];
    for (const p of pots) {
      if (p.isArchived) continue;
      if (p.kind === "debt") {
        loans.push({
          _id: p._id,
          name: p.name,
          icon: p.icon,
          color: p.color,
          balance: -(await debtOwed(ctx, householdId, p)), // negative = owed
          change: moved.get(p._id) ?? 0,
          goal: p.originalAmount ?? null,
        });
      } else {
        funds.push({
          _id: p._id,
          name: p.name,
          icon: p.icon,
          color: p.color,
          balance: await potBalance(ctx, householdId, p._id),
          change: moved.get(p._id) ?? 0,
          goal: p.targetAmount ?? null,
        });
      }
    }

    // An asset's month is a revaluation or nothing — no money flows through it.
    const end = `${month}-31`;
    const start = `${month}-01`;
    const valuations = await ctx.db
      .query("assetValuations")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    const assetItems: StockItem[] = assets
      .filter((a) => !a.isArchived)
      .map((a) => {
        const mine = valuations
          .filter((v) => v.assetId === a._id)
          .sort((x, y) => (x.valuedOn < y.valuedOn ? -1 : 1));
        const before = [...mine].reverse().find((v) => v.valuedOn < start);
        const latest = [...mine].reverse().find((v) => v.valuedOn <= end);
        return {
          _id: a._id,
          name: a.name,
          // Assets have no colour of their own — they are not funds, and the
          // neutral keeps them from reading as one.
          icon: a.icon ?? "money",
          color: "#a8a29e",
          balance: a.value,
          change: before && latest ? latest.value - before.value : 0,
          valuedOn: a.valuedOn,
        };
      });

    return { funds, loans, assets: assetItems };
  },
});

/**
 * The three balance numbers, which are all distinct from leftToSpend:
 *   inBank   — what the accounts hold, derived from the ledger
 *   setAside — Σ savings + sinking pot balances (debt EXCLUDED)
 *   free     — inBank − setAside
 * "Free" answers how much slack exists at all; leftToSpend answers can I buy
 * this today. Never merge them.
 */
export const balances = query({
  args: { householdId: v.id("households") },
  handler: async (ctx, { householdId }) => {
    await requireMember(ctx, householdId);

    const inBank = await bankTotal(ctx, householdId);

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

    const [assets, pots] = await Promise.all([
      ctx.db
        .query("assets")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("pots")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
    ]);

    const bank = await bankTotal(ctx, householdId);
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
  /** What it is going towards: a fund's target, a loan's original amount.
   *  Null where there is none, so a card never draws progress to nowhere. */
  goal?: number | null;
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

    const [pots, assets, valuations] = await Promise.all([
      ctx.db
        .query("pots")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("assets")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("assetValuations")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
    ]);

    /**
     * What an asset was worth on a given day.
     *
     * The latest valuation up to that day — and, before there is one, the
     * EARLIEST there ever is. Writing a flat down for the first time in March
     * is not March earning you a flat: the thing was already yours, the app
     * simply had not heard of it. Falling back to its first known figure puts
     * it on both ends of any comparison, so entering it moves nothing and a
     * later revaluation moves exactly what it should.
     *
     * An asset with no valuations at all falls back to the figure on the asset
     * itself, which is the only number there is.
     */
    const startOfYear = `${Number(year) - 1}-12-31`;
    const endOfYear = `${year}-12-31`;
    const valuationsByAsset = new Map<Id<"assets">, typeof valuations>();
    for (const v of valuations) {
      const rows = valuationsByAsset.get(v.assetId) ?? [];
      rows.push(v);
      valuationsByAsset.set(v.assetId, rows);
    }
    const assetValueAt = (a: (typeof assets)[number], on: string) => {
      const rows = valuationsByAsset.get(a._id) ?? [];
      if (rows.length === 0) return a.value;
      const upTo = rows.filter((v) => v.valuedOn <= on);
      if (upTo.length > 0) {
        return upTo.reduce((x, y) => (x.valuedOn >= y.valuedOn ? x : y)).value;
      }
      return rows.reduce((x, y) => (x.valuedOn <= y.valuedOn ? x : y)).value;
    };
    const assetChange = new Map<Id<"assets">, number>();
    for (const a of assets) {
      assetChange.set(
        a._id,
        assetValueAt(a, endOfYear) - assetValueAt(a, startOfYear),
      );
    }

    const debtPotIds = new Set(
      pots.filter((p) => p.kind === "debt").map((p) => p._id),
    );

    // Same counting as `month` above — see the note there for why savings can
    // go negative and why leftToSpend is unchanged by it.
    const months = Array.from({ length: 12 }, () => ({
      income: 0,
      expense: 0,
      savings: 0,
      leftToSpend: 0,
      setAside: 0,
      sinking: 0, // a slice of setAside, not an addition to it
      drawnFromFunds: 0,
      drawnPlanned: 0,
      drawnFromSavings: 0,
    }));
    const sinkingPotIds = new Set(
      pots.filter((p) => p.kind === "sinking").map((p) => p._id),
    );

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
        bucket.setAside += fromIncome;
        if (t.potId && sinkingPotIds.has(t.potId)) bucket.sinking += fromIncome;
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
            // Spending is spending, whichever pocket paid — and the same
            // amount comes back off savings below.
            bucket.expense += f.amount;
            bucket.drawnFromFunds += f.amount;
            if (sinkingPotIds.has(f.potId)) bucket.drawnPlanned += f.amount;
            else bucket.drawnFromSavings += f.amount;
            spentFromPotYear.set(
              f.potId,
              (spentFromPotYear.get(f.potId) ?? 0) + f.amount,
            );
          }
        }
        if (t.potId && debtPotIds.has(t.potId)) {
          debtPaidYear.set(t.potId, (debtPaidYear.get(t.potId) ?? 0) + t.amount);
        }
      }
    }
    for (const m of months) {
      m.savings = m.setAside - m.drawnFromFunds;
      m.leftToSpend = m.income - m.expense - m.savings;
    }

    const totals = months.reduce(
      (a, m) => ({
        income: a.income + m.income,
        expense: a.expense + m.expense,
        savings: a.savings + m.savings,
        leftToSpend: a.leftToSpend + m.leftToSpend,
        setAside: a.setAside + m.setAside,
        sinking: a.sinking + m.sinking,
        drawnFromFunds: a.drawnFromFunds + m.drawnFromFunds,
        drawnPlanned: a.drawnPlanned + m.drawnPlanned,
        drawnFromSavings: a.drawnFromSavings + m.drawnFromSavings,
      }),
      {
        income: 0,
        expense: 0,
        savings: 0,
        leftToSpend: 0,
        setAside: 0,
        sinking: 0,
        drawnFromFunds: 0,
        drawnPlanned: 0,
        drawnFromSavings: 0,
      },
    );

    const bank = await bankTotal(ctx, householdId);

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
          goal: p.targetAmount ?? null,
        });
      } else if (p.kind === "debt") {
        loanItems.push({
          _id: p._id,
          name: p.name,
          icon: p.icon,
          color: p.color,
          balance: -(await debtOwed(ctx, householdId, p)), // negative = owed
          change: debtPaidYear.get(p._id) ?? 0, // +paid
          goal: p.originalAmount ?? null,
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

    /**
     * Net worth AT A DATE — the same three lines as today's, read at the end
     * of a given day.
     *
     * The year's change is the difference between two of these, and nothing
     * else. It used to be derived from the year's flows instead — income minus
     * real expenses plus revaluation — which is a good approximation and not
     * the thing it claims to be: buy a car with money from the account and the
     * flow version books the whole price as a loss, because the car it turned
     * into was invisible to it. Two snapshots cannot drift from the balance
     * sheet, because they ARE the balance sheet, twice.
     *
     * Archived pots, assets and accounts are out of both ends, exactly as they
     * are out of today's figure. That keeps the comparison against the same
     * hero it sits under, at the price of a real one: something you owned last
     * year and have since archived leaves the older end too, so selling a car
     * reads as income arriving rather than as a car becoming money.
     */
    const debtOwedAt = async (pot: Doc<"pots">, on: string) => {
      const payments = await ctx.db
        .query("transactions")
        .withIndex("by_household_pot", (q) =>
          q.eq("householdId", householdId).eq("potId", pot._id),
        )
        .collect();
      const paid = payments
        .filter((t) => t.direction === "expense" && t.occurredOn <= on)
        .reduce((sum, t) => sum + t.amount, 0);
      return (pot.originalAmount ?? 0) - paid;
    };
    const snapshot = async (on: string) => {
      const bankThen = await bankTotalAsOf(ctx, householdId, on);
      const assetsThen = assets
        .filter((a) => !a.isArchived)
        .reduce((sum, a) => sum + assetValueAt(a, on), 0);
      let debtThen = 0;
      for (const p of pots) {
        if (!p.isArchived && p.kind === "debt") {
          debtThen += await debtOwedAt(p, on);
        }
      }
      return {
        bank: bankThen,
        assets: assetsThen,
        debt: debtThen,
        netWorth: bankThen + assetsThen - debtThen,
      };
    };
    const opened = await snapshot(startOfYear);
    const closed = await snapshot(endOfYear);

    /**
     * Net worth at the end of each month — the path between the two sheets.
     *
     * Walked forward from the opening sheet rather than snapshotted twelve
     * times: a snapshot reads every transaction the household has ever had, and
     * the year's own are already in hand. Bank moves by income less expense on
     * the live accounts, debt falls by what was paid against it, and an asset
     * is worth what its latest valuation said that day. December's figure is
     * the closing sheet by construction, which the test holds it to.
     *
     * Null for a month that has not ended and is not the one today is in: a
     * line drawn flat across the future claims to know it.
     */
    const liveAccounts = new Set(
      (
        await ctx.db
          .query("accounts")
          .withIndex("by_household", (q) => q.eq("householdId", householdId))
          .collect()
      )
        .filter((a) => !a.isArchived)
        .map((a) => a._id as string),
    );
    const bankMove = Array<number>(12).fill(0);
    const debtPaid = Array<number>(12).fill(0);
    for (const t of txs) {
      const mi = Number(t.occurredOn.slice(5, 7)) - 1;
      if (liveAccounts.has(t.accountId as string)) {
        if (t.direction === "income") bankMove[mi] += t.amount;
        else if (t.direction === "expense") bankMove[mi] -= t.amount;
      }
      if (t.direction === "expense" && t.potId && debtPotIds.has(t.potId)) {
        const pot = pots.find((p) => p._id === t.potId);
        if (pot && !pot.isArchived) debtPaid[mi] += t.amount;
      }
    }
    const thisMonth = new Date().toISOString().slice(0, 7);
    let bankRun = opened.bank;
    let debtRun = opened.debt;
    const netWorthByMonth = Array.from({ length: 12 }, (_, mi) => {
      bankRun += bankMove[mi];
      debtRun -= debtPaid[mi];
      const key = `${year}-${String(mi + 1).padStart(2, "0")}`;
      if (key > thisMonth) return null;
      const assetsThen = assets
        .filter((a) => !a.isArchived)
        .reduce((sum, a) => sum + assetValueAt(a, `${key}-31`), 0);
      return bankRun + assetsThen - debtRun;
    });

    return {
      netWorth: bank + assetGroup.balance - debtTotal,
      /** What you are worth at the end of this year, less what you were worth
       *  at the end of the last one. A difference of two balance sheets. */
      netWorthChange: closed.netWorth - opened.netWorth,
      /**
       * The same difference, line by line, so the screen can show its working
       * rather than re-derive it from the totals beside it — which is where a
       * second, disagreeing definition of net worth would come from.
       *
       *   bank + assets + loans = netWorthChange, always.
       *
       * `loans` is positive when you owe LESS than you did: money that left
       * the account for good and took the debt with it. That is the line
       * anyone comparing this figure with the year's spending is looking for.
       */
      netWorthParts: {
        /** The day the comparison is against: last year's last. */
        openedOn: startOfYear,
        opening: opened.netWorth,
        closing: closed.netWorth,
        bank: closed.bank - opened.bank,
        assets: closed.assets - opened.assets,
        loans: opened.debt - closed.debt,
      },
      netWorthByMonth,
      bank,
      months,
      totals,
      funds,
      assets: assetGroup,
      loans,
    };
  },
});

/** Days in a YYYY-MM month. */
function daysIn(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The YYYY-MM `delta` months away from `month`. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** How many earlier months the "typical month" is averaged over. */
const PACE_LOOKBACK = 3;

/**
 * How the month's spending ACCUMULATED, day by day — the shape `month` sums
 * away — and the same shape for a typical month to hold it against.
 *
 *   daily[d]   = Σ expense transactions on day d+1        (this month)
 *   income[d]  = Σ income transactions on day d+1         (this month)
 *   typical[d] = average, over the earlier months that had any spending at
 *                all, of what had been spent by day d+1
 *
 * Expense is the transaction's amount, whichever pocket paid for it — the same
 * total `month.expense` arrives at through the funding rows, because a
 * transaction's funding always adds up to its amount.
 *
 * A month with no spending is left out of the typical one rather than averaged
 * in as a zero: the months before anyone started using the app would otherwise
 * drag "typical" towards nothing, and every real month would look like a spree.
 * A shorter month carries its final total across the days it does not have, so
 * the 31st of a typical month is never lower than the 28th.
 */
export const monthPace = query({
  args: { householdId: v.id("households"), month: v.string() }, // YYYY-MM
  handler: async (ctx, { householdId, month }) => {
    await requireMember(ctx, householdId);

    const first = shiftMonth(month, -PACE_LOOKBACK);
    const txs = await ctx.db
      .query("transactions")
      .withIndex("by_household_date", (q) =>
        q
          .eq("householdId", householdId)
          .gte("occurredOn", `${first}-01`)
          .lte("occurredOn", `${month}-31`),
      )
      .collect();

    const days = daysIn(month);
    const daily = Array<number>(days).fill(0);
    const income = Array<number>(days).fill(0);
    const earlier = new Map<string, number[]>();

    for (const t of txs) {
      const key = t.occurredOn.slice(0, 7);
      const day = Number(t.occurredOn.slice(8, 10));
      if (key === month) {
        if (t.direction === "expense") daily[day - 1] += t.amount;
        else if (t.direction === "income") income[day - 1] += t.amount;
        continue;
      }
      if (t.direction !== "expense") continue;
      let row = earlier.get(key);
      if (!row) {
        row = Array<number>(31).fill(0);
        earlier.set(key, row);
      }
      row[day - 1] += t.amount;
    }

    const cumulative = [...earlier.entries()].map(([key, row]) => {
      const len = daysIn(key);
      let run = 0;
      return Array.from({ length: days }, (_, d) => {
        if (d < len) run += row[d];
        return run;
      });
    });
    const typical =
      cumulative.length > 0
        ? Array.from(
            { length: days },
            (_, d) =>
              cumulative.reduce((s, c) => s + c[d], 0) / cumulative.length,
          )
        : null;

    return { days, daily, income, typical, typicalMonths: cumulative.length };
  },
});

/**
 * Where the month's spending went, category by category, each against what a
 * typical month had put there BY THE SAME DAY.
 *
 * The same "typical" as `monthPace` — the average of the earlier months that
 * had any spending — cut at `throughDay` so a month nine days old is compared
 * with nine days of the others. Against whole months it would be under on
 * everything until the 28th, and say nothing.
 *
 * Only categories with spending this month are returned, largest first; the
 * uncategorised remainder comes back with a null category.
 */
export const monthCategories = query({
  args: {
    householdId: v.id("households"),
    month: v.string(), // YYYY-MM
    throughDay: v.optional(v.number()),
  },
  handler: async (ctx, { householdId, month, throughDay }) => {
    await requireMember(ctx, householdId);
    const limit = throughDay ?? 31;

    const first = shiftMonth(month, -PACE_LOOKBACK);
    const [txs, categories] = await Promise.all([
      ctx.db
        .query("transactions")
        .withIndex("by_household_date", (q) =>
          q
            .eq("householdId", householdId)
            .gte("occurredOn", `${first}-01`)
            .lte("occurredOn", `${month}-31`),
        )
        .collect(),
      ctx.db
        .query("categories")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
    ]);
    const catById = new Map(categories.map((c) => [c._id, c]));

    const now = new Map<string, number>();
    const before = new Map<string, number>();
    const spendingMonths = new Set<string>();
    for (const t of txs) {
      if (t.direction !== "expense") continue;
      const key = t.occurredOn.slice(0, 7);
      const cat = (t.categoryId as string | undefined) ?? "";
      if (key === month) {
        now.set(cat, (now.get(cat) ?? 0) + t.amount);
        continue;
      }
      spendingMonths.add(key);
      if (Number(t.occurredOn.slice(8, 10)) <= limit) {
        before.set(cat, (before.get(cat) ?? 0) + t.amount);
      }
    }

    return [...now.entries()]
      .map(([cat, amount]) => {
        const c = cat ? catById.get(cat as Id<"categories">) : undefined;
        return {
          categoryId: c ? c._id : null,
          name: c?.name ?? null,
          icon: c?.icon ?? null,
          color: c?.color ?? null,
          amount,
          typical:
            spendingMonths.size > 0
              ? (before.get(cat) ?? 0) / spendingMonths.size
              : null,
        };
      })
      .sort((a, b) => b.amount - a.amount);
  },
});
