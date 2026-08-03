import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const asA = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "user-a" });

const YEAR = "2026";

async function setup() {
  const t = convexTest(schema);
  const householdId = await asA(t).mutation(api.households.create, {
    name: "Home",
    displayName: "Me",
  });
  const cats = await asA(t).query(api.categories.list, { householdId });
  return {
    t,
    householdId,
    incomeCat: cats.find((c) => c.kind === "income")!._id,
    groceryCat: cats.find((c) => c.name === "Grocery")!._id,
  };
}

describe("overview.year", () => {
  test("buckets transactions by month and the columns sum to the totals", async () => {
    const { t, householdId, incomeCat, groceryCat } = await setup();
    // Jan income + expense
    await asA(t).mutation(api.transactions.create, {
      householdId, direction: "income", amount: 30_000_000,
      categoryId: incomeCat, occurredOn: "2026-01-10",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId, direction: "expense", amount: 2_000_000,
      categoryId: groceryCat, occurredOn: "2026-01-15",
    });
    // Mar income
    await asA(t).mutation(api.transactions.create, {
      householdId, direction: "income", amount: 30_000_000,
      categoryId: incomeCat, occurredOn: "2026-03-01",
    });

    const y = await asA(t).query(api.overview.year, { householdId, year: YEAR });

    expect(y.months[0].income).toBe(30_000_000); // Jan
    expect(y.months[0].expense).toBe(2_000_000);
    expect(y.months[2].income).toBe(30_000_000); // Mar
    expect(y.months[1].income).toBe(0); // Feb empty

    // Columns sum to the totals.
    const sum = (k: "income" | "expense" | "savings") =>
      y.months.reduce((s, m) => s + m[k], 0);
    expect(y.totals.income).toBe(sum("income"));
    expect(y.totals.expense).toBe(sum("expense"));
    expect(y.totals.income).toBe(60_000_000);
  });

  test("net-worth change excludes loan payments (they are net-worth neutral)", async () => {
    const { t, householdId, incomeCat, groceryCat } = await setup();
    const debtPot = await asA(t).mutation(api.pots.create, {
      householdId, name: "Loan", kind: "debt", icon: "bank",
      color: "#D85A30", originalAmount: 50_000_000,
    });

    // Income 30.000; a normal expense 2.000; a loan payment 5.000.
    await asA(t).mutation(api.transactions.create, {
      householdId, direction: "income", amount: 30_000_000,
      categoryId: incomeCat, occurredOn: "2026-02-01",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId, direction: "expense", amount: 2_000_000,
      categoryId: groceryCat, occurredOn: "2026-02-02",
    });
    // Loan payment: an expense tagged with the debt pot (inserted directly;
    // the UI wires this later).
    await t.run(async (ctx) => {
      const acct = (
        await ctx.db
          .query("accounts")
          .withIndex("by_household", (q) => q.eq("householdId", householdId))
          .collect()
      )[0];
      const txId = await ctx.db.insert("transactions", {
        householdId, accountId: acct._id, categoryId: groceryCat,
        direction: "expense", amount: 5_000_000, occurredOn: "2026-02-10",
        potId: debtPot, paidBy: "user-a", createdBy: "user-a",
        createdAt: Date.now(),
      });
      await ctx.db.insert("transactionFunding", {
        householdId, transactionId: txId, potId: undefined, amount: 5_000_000,
      });
    });

    const y = await asA(t).query(api.overview.year, { householdId, year: YEAR });
    // Change = income − real expenses = 30.000 − 2.000 = 28.000. The 5.000 loan
    // payment is NOT subtracted (it reduced debt by the same amount).
    expect(y.netWorthChange).toBe(28_000_000);
    // Loans accordion shows the payment as this-year change and reduced owed.
    expect(y.loans.change).toBe(5_000_000); // +paid
    expect(y.loans.balance).toBe(-45_000_000); // 50M owed − 5M paid, negative
  });

  test("funds row shows this-year change and current balance", async () => {
    const { t, householdId, groceryCat } = await setup();
    const pot = await asA(t).mutation(api.pots.create, {
      householdId, name: "Car fund", kind: "sinking", icon: "car",
      color: "#1D9E75",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId, direction: "transfer", amount: 20_000_000,
      potId: pot, occurredOn: "2026-04-01",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId, direction: "expense", amount: 7_000_000,
      categoryId: groceryCat, takeFromPotId: pot, occurredOn: "2026-05-01",
    });

    const y = await asA(t).query(api.overview.year, { householdId, year: YEAR });
    expect(y.funds.items).toHaveLength(1);
    expect(y.funds.items[0].balance).toBe(13_000_000); // 20M in − 7M spent
    expect(y.funds.items[0].change).toBe(13_000_000); // same, all this year
    // Setting aside counts as savings in April's bucket.
    expect(y.months[3].savings).toBe(20_000_000);
  });
});

/**
 * Revaluation. Until now the year's net-worth change was income minus real
 * spending and nothing else, so a flat that went up ten percent moved it by
 * zero — the one thing the figure knowingly missed.
 */
describe("asset revaluation", () => {
  test("a re-valued asset moves the year, a newly recorded one does not", async () => {
    const { t, householdId } = await setup();

    // Owned since last year, and worth more now.
    const flat = await asA(t).mutation(api.assets.create, {
      householdId,
      name: "Flat",
      value: 20_000_000_00,
      valuedOn: "2025-06-01",
    });
    await asA(t).mutation(api.assets.revalue, {
      assetId: flat,
      value: 22_000_000_00,
      valuedOn: `${YEAR}-06-01`,
    });

    // Written down for the first time inside the year. It did not GROW by its
    // whole worth — it just got recorded.
    await asA(t).mutation(api.assets.create, {
      householdId,
      name: "Car",
      value: 1_500_000_00,
      valuedOn: `${YEAR}-03-01`,
    });

    const y = await asA(t).query(api.overview.year, { householdId, year: YEAR });
    expect(y.assets.change).toBe(2_000_000_00);
    expect(y.assets.balance).toBe(23_500_000_00);
    expect(y.netWorthChange).toBe(2_000_000_00); // no income, no spending
  });

  test("a valuation after the year ends does not leak into it", async () => {
    const { t, householdId } = await setup();
    const flat = await asA(t).mutation(api.assets.create, {
      householdId,
      name: "Flat",
      value: 20_000_000_00,
      valuedOn: "2025-06-01",
    });
    await asA(t).mutation(api.assets.revalue, {
      assetId: flat,
      value: 30_000_000_00,
      valuedOn: "2027-02-01",
    });

    const y = await asA(t).query(api.overview.year, { householdId, year: YEAR });
    expect(y.assets.change).toBe(0);
  });
});
