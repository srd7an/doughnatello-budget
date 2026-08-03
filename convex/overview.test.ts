import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const asA = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "user-a" });

const MONTH = "2026-07";

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

describe("leftToSpend — the two counting rules", () => {
  test("income sets the baseline; an income-funded expense reduces it", async () => {
    const { t, householdId, incomeCat, groceryCat } = await setup();
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "income",
      amount: 30_000_000,
      categoryId: incomeCat,
      occurredOn: `${MONTH}-01`,
    });
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 200_000,
      categoryId: groceryCat,
      occurredOn: `${MONTH}-02`,
    });

    const s = await asA(t).query(api.overview.month, { householdId, month: MONTH });
    expect(s.income).toBe(30_000_000);
    expect(s.expense).toBe(200_000);
    expect(s.savings).toBe(0);
    expect(s.leftToSpend).toBe(29_800_000);
    expect(s.income).toBe(s.expense + s.savings + s.leftToSpend); // composition holds
  });

  test("setting money aside reduces leftToSpend; spending it later does NOT", async () => {
    const { t, householdId, incomeCat, groceryCat } = await setup();
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "income",
      amount: 30_000_000,
      categoryId: incomeCat,
      occurredOn: `${MONTH}-01`,
    });
    const pot = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Car fund",
      kind: "sinking",
      icon: "car",
      color: "#1D9E75",
    });

    // Set aside 20.000 → leftToSpend drops by exactly that.
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 2_000_000,
      potId: pot,
      occurredOn: `${MONTH}-03`,
    });
    let s = await asA(t).query(api.overview.month, { householdId, month: MONTH });
    expect(s.savings).toBe(2_000_000);
    expect(s.leftToSpend).toBe(28_000_000);

    // Spend 7.500 out of that pot → leftToSpend UNCHANGED, but it is recorded.
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 750_000,
      categoryId: groceryCat,
      takeFromPotId: pot,
      occurredOn: `${MONTH}-04`,
    });
    s = await asA(t).query(api.overview.month, { householdId, month: MONTH });
    expect(s.leftToSpend).toBe(28_000_000); // did not move
    expect(s.expense).toBe(0); // no income-funded expense
    expect(s.paidFromFunds).toBe(750_000); // surfaced separately
  });
});

describe("balances", () => {
  test("inBank − setAside = free, and setAside excludes debt pots", async () => {
    const { t, householdId } = await setup();
    const account = await asA(t).query(api.accounts.getPrimary, { householdId });
    await asA(t).mutation(api.accounts.setBalance, {
      accountId: account!._id,
      bankBalance: 100_000_000,
    });

    const savings = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Rainy day",
      kind: "savings",
      icon: "piggy",
      color: "#1D9E75",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 5_000_000,
      potId: savings,
      occurredOn: `${MONTH}-05`,
    });
    // A debt pot must NOT count toward set aside.
    await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Loan",
      kind: "debt",
      icon: "bank",
      color: "#D85A30",
      originalAmount: 90_000_000,
    });

    const b = await asA(t).query(api.overview.balances, { householdId });
    expect(b.inBank).toBe(100_000_000);
    expect(b.setAside).toBe(5_000_000); // savings only, not the debt
    expect(b.free).toBe(95_000_000);
  });
});

describe("net worth — the double-count trap", () => {
  test("moving money between the main account and a virtual pot leaves net worth unchanged", async () => {
    const { t, householdId } = await setup();
    const account = await asA(t).query(api.accounts.getPrimary, { householdId });
    await asA(t).mutation(api.accounts.setBalance, {
      accountId: account!._id,
      bankBalance: 100_000_000,
    });
    await asA(t).mutation(api.assets.create, {
      householdId,
      name: "Car",
      value: 80_000_000,
      valuedOn: `${MONTH}-01`,
    });
    await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Loan",
      kind: "debt",
      icon: "bank",
      color: "#D85A30",
      originalAmount: 90_000_000,
    });

    const before = await asA(t).query(api.overview.netWorth, { householdId });
    expect(before.netWorth).toBe(90_000_000); // 100M + 80M − 90M
    expect(before.bank).toBe(100_000_000);
    expect(before.assets).toBe(80_000_000);
    expect(before.debt).toBe(90_000_000);

    // Set aside 50.000 into a savings pot — a pure main→virtual-pot move.
    const savings = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Rainy day",
      kind: "savings",
      icon: "piggy",
      color: "#1D9E75",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 5_000_000,
      potId: savings,
      occurredOn: `${MONTH}-06`,
    });

    const after = await asA(t).query(api.overview.netWorth, { householdId });
    // Unchanged. If the savings pot were wrongly added, this would be 95.000.000.
    expect(after.netWorth).toBe(90_000_000);
  });

  test("a loan payment (expense tagged with the debt pot) reduces net worth debt", async () => {
    const { t, householdId, groceryCat } = await setup();
    const account = await asA(t).query(api.accounts.getPrimary, { householdId });
    await asA(t).mutation(api.accounts.setBalance, {
      accountId: account!._id,
      bankBalance: 0,
    });
    const debtPot = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Loan",
      kind: "debt",
      icon: "bank",
      color: "#D85A30",
      originalAmount: 90_000_000,
    });

    expect((await asA(t).query(api.overview.netWorth, { householdId })).debt).toBe(
      90_000_000,
    );

    // Simulate a loan payment: an expense tagged with the debt pot. (The
    // Add-transaction UI wires this in a later phase; here we insert it.)
    await t.run(async (ctx) => {
      const acct = (
        await ctx.db
          .query("accounts")
          .withIndex("by_household", (q) => q.eq("householdId", householdId))
          .collect()
      )[0];
      await ctx.db.insert("transactions", {
        householdId,
        accountId: acct._id,
        categoryId: groceryCat,
        direction: "expense",
        amount: 10_000_000,
        occurredOn: `${MONTH}-07`,
        potId: debtPot,
        paidBy: "user-a",
        createdBy: "user-a",
        createdAt: Date.now(),
      });
    });

    const nw = await asA(t).query(api.overview.netWorth, { householdId });
    expect(nw.debt).toBe(80_000_000); // 90M owed − 10M paid
    expect(nw.netWorth).toBe(-80_000_000); // 0 bank + 0 assets − 80M
  });
});

/**
 * Savings splits in two without ever splitting the bar.
 *
 * A sinking fund is money already promised to a bill that has not arrived —
 * deferred spending. A savings fund is a pile with nothing attached. Both come
 * off the month you fill them, and the registration paid later out of the
 * sinking fund must NOT come off that later month, or the same money is counted
 * twice. So `sinking` is reported as a SLICE of `savings`, never beside it.
 */
describe("the savings split", () => {
  async function setup() {
    const t = convexTest(schema);
    const householdId = await asA(t).mutation(api.households.create, {
      name: "Home",
      displayName: "Me",
    });
    const cats = await asA(t).query(api.categories.list, { householdId });
    const fund = (name: string, kind: "savings" | "sinking") =>
      asA(t).mutation(api.pots.create, {
        householdId,
        name,
        kind,
        icon: "piggy",
        color: "#1D9E75",
      });
    const [cash, carStuff] = await Promise.all([
      fund("Cash fund", "savings"),
      fund("Car stuff", "sinking"),
    ]);
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "income",
      amount: 200_000_00,
      categoryId: cats.find((c) => c.kind === "income")!._id,
      occurredOn: `${MONTH}-01`,
    });
    return { t, householdId, cash, carStuff };
  }

  const setAside = (
    t: ReturnType<typeof convexTest>,
    householdId: Id<"households">,
    potId: Id<"pots">,
    amount: number,
    day: string,
  ) =>
    asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount,
      potId,
      occurredOn: `${MONTH}-${day}`,
    });

  test("sinking is part of savings, and the identity still holds", async () => {
    const { t, householdId, cash, carStuff } = await setup();
    await setAside(t, householdId, cash, 13_291_00, "05");
    await setAside(t, householdId, carStuff, 6_000_00, "06");

    const m = await asA(t).query(api.overview.month, { householdId, month: MONTH });
    expect(m.savings).toBe(19_291_00);
    expect(m.sinking).toBe(6_000_00); // the Car stuff half
    expect(m.savings - m.sinking).toBe(13_291_00); // the pile half

    // The bar must still add up, with savings counted exactly once.
    expect(m.income).toBe(m.expense + m.savings + m.leftToSpend);
  });

  test("spending a sinking fund later does not come off that month too", async () => {
    const { t, householdId, carStuff } = await setup();
    await setAside(t, householdId, carStuff, 6_000_00, "06");
    const cats = await asA(t).query(api.categories.list, { householdId });

    // The registration, paid out of the fund in a later month.
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 6_000_00,
      categoryId: cats.find((c) => c.name === "Car")!._id,
      takeFromPotId: carStuff,
      occurredOn: "2026-09-15",
    });

    const sep = await asA(t).query(api.overview.month, {
      householdId,
      month: "2026-09",
    });
    // It shows as paid from funds, and takes nothing off September.
    expect(sep.paidFromFunds).toBe(6_000_00);
    expect(sep.expense).toBe(0);
    expect(sep.savings).toBe(0);
    expect(sep.sinking).toBe(0);
  });

  test("a fund with no kind set behaves as plain savings", async () => {
    const { t, householdId, cash } = await setup();
    await setAside(t, householdId, cash, 5_000_00, "05");
    const m = await asA(t).query(api.overview.month, { householdId, month: MONTH });
    expect(m.savings).toBe(5_000_00);
    expect(m.sinking).toBe(0);
  });

  test("the year splits it the same way", async () => {
    const { t, householdId, cash, carStuff } = await setup();
    await setAside(t, householdId, cash, 10_000_00, "05");
    await setAside(t, householdId, carStuff, 4_000_00, "06");

    const y = await asA(t).query(api.overview.year, { householdId, year: "2026" });
    expect(y.totals.savings).toBe(14_000_00);
    expect(y.totals.sinking).toBe(4_000_00);
  });
});
