import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const asA = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "user-a" });

async function setup() {
  const t = convexTest(schema);
  const householdId = await asA(t).mutation(api.households.create, {
    name: "Home",
    displayName: "Me",
  });
  const categories = await asA(t).query(api.categories.list, { householdId });
  const income = categories.find((c) => c.kind === "income")!;
  const grocery = categories.find((c) => c.name === "Grocery")!;
  return { t, householdId, incomeCat: income._id, groceryCat: grocery._id };
}

// Read a transaction's funding rows straight from the db. Uses .filter (not
// .withIndex) because the generic tester type in t.run doesn't carry the
// schema's index names.
async function funding(t: ReturnType<typeof convexTest>, txId: Id<"transactions">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("transactionFunding")
      .filter((q) => q.eq(q.field("transactionId"), txId))
      .collect(),
  );
}

describe("funding — the two counting rules", () => {
  test("income creates no funding rows", async () => {
    const { t, householdId, incomeCat } = await setup();
    const tx = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "income",
      amount: 300_000_00,
      categoryId: incomeCat,
      occurredOn: "2026-07-01",
      payee: "Salary",
    });
    expect(await funding(t, tx)).toHaveLength(0);
  });

  test("expense funded by income → one row, potId undefined", async () => {
    const { t, householdId, groceryCat } = await setup();
    const tx = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 2_000_00,
      categoryId: groceryCat,
      occurredOn: "2026-07-02",
      payee: "Idea",
    });
    const f = await funding(t, tx);
    expect(f).toHaveLength(1);
    expect(f[0].potId).toBeUndefined(); // reduces left to spend
    expect(f[0].amount).toBe(2_000_00);
  });

  test("setting money aside (transfer) is an income-funded outflow", async () => {
    const { t, householdId } = await setup();
    const pot = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Car fund",
      kind: "sinking",
      icon: "car",
      color: "#1D9E75",
    });
    const tx = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 20_000_00,
      potId: pot,
      occurredOn: "2026-07-03",
    });
    const f = await funding(t, tx);
    // A single funding row with potId undefined — this is what makes a transfer
    // into a pot reduce left to spend, exactly like an expense.
    expect(f).toHaveLength(1);
    expect(f[0].potId).toBeUndefined();
    expect(f[0].amount).toBe(20_000_00);

    const balances = await asA(t).query(api.pots.balances, { householdId });
    expect(balances.find((b) => b._id === pot)!.balance).toBe(20_000_00);
  });

  test("spending a pot's money does NOT reduce left to spend, but is recorded", async () => {
    const { t, householdId, groceryCat } = await setup();
    const pot = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Car fund",
      kind: "sinking",
      icon: "car",
      color: "#1D9E75",
    });
    // Set aside 20.000, then spend 7.500 from it.
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 20_000_00,
      potId: pot,
      occurredOn: "2026-07-03",
    });
    const spend = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 7_500_00,
      categoryId: groceryCat,
      takeFromPotId: pot,
      occurredOn: "2026-07-04",
      payee: "Nutricionista",
    });

    const f = await funding(t, spend);
    expect(f).toHaveLength(1);
    expect(f[0].potId).toBe(pot); // funded from the pot — not from income
    expect(f[0].amount).toBe(7_500_00);

    // Pot balance drops; the expense still appears in the month list.
    const balances = await asA(t).query(api.pots.balances, { householdId });
    expect(balances.find((b) => b._id === pot)!.balance).toBe(12_500_00);
    const rows = await asA(t).query(api.transactions.listMonth, {
      householdId,
      month: "2026-07",
    });
    expect(rows.some((r) => r._id === spend)).toBe(true);
  });

  test("take-from split: pot covers part, income covers the rest", async () => {
    const { t, householdId, groceryCat } = await setup();
    const pot = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Car fund",
      kind: "sinking",
      icon: "car",
      color: "#1D9E75",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 5_000_00,
      potId: pot,
      occurredOn: "2026-07-03",
    });
    // Spend 8.000 taking from a pot that only has 5.000.
    const spend = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 8_000_00,
      categoryId: groceryCat,
      takeFromPotId: pot,
      occurredOn: "2026-07-05",
    });
    const f = await funding(t, spend);
    expect(f).toHaveLength(2);
    const fromPot = f.find((x) => x.potId === pot)!;
    const fromIncome = f.find((x) => x.potId === undefined)!;
    expect(fromPot.amount).toBe(5_000_00);
    expect(fromIncome.amount).toBe(3_000_00);
    // Pot fully drained.
    const balances = await asA(t).query(api.pots.balances, { householdId });
    expect(balances.find((b) => b._id === pot)!.balance).toBe(0);
  });
});

describe("validation", () => {
  test("rejects a transfer without a destination pot", async () => {
    const { t, householdId } = await setup();
    await expect(
      asA(t).mutation(api.transactions.create, {
        householdId,
        direction: "transfer",
        amount: 1_000_00,
        occurredOn: "2026-07-01",
      }),
    ).rejects.toThrow(/destination pot/);
  });

  test("rejects an expense without a category", async () => {
    const { t, householdId } = await setup();
    await expect(
      asA(t).mutation(api.transactions.create, {
        householdId,
        direction: "expense",
        amount: 1_000_00,
        occurredOn: "2026-07-01",
      }),
    ).rejects.toThrow(/category is required/);
  });

  test("rejects a non-positive amount", async () => {
    const { t, householdId, groceryCat } = await setup();
    await expect(
      asA(t).mutation(api.transactions.create, {
        householdId,
        direction: "expense",
        amount: 0,
        categoryId: groceryCat,
        occurredOn: "2026-07-01",
      }),
    ).rejects.toThrow(/positive/);
  });
});

/**
 * Paying off a loan. The money side is deliberately unremarkable — an
 * instalment is an ordinary expense — and the only thing `potId` adds is that
 * the loan knows about it.
 */
describe("loan payments", () => {
  async function withLoan() {
    const ctx = await setup();
    const loan = await asA(ctx.t).mutation(api.pots.create, {
      householdId: ctx.householdId,
      name: "Car loan",
      kind: "debt",
      icon: "car",
      color: "#B45309",
      originalAmount: 900_000_00,
    });
    return { ...ctx, loan };
  }

  test("an expense tagged with a loan pays it down", async () => {
    const { t, householdId, groceryCat, loan } = await withLoan();
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 24_500_00,
      categoryId: groceryCat,
      potId: loan,
      occurredOn: "2026-07-12",
    });

    const pots = await asA(t).query(api.pots.balances, { householdId });
    expect(pots.find((p) => p._id === loan)!.owed).toBe(875_500_00);
  });

  test("it is still an ordinary expense — it reduces left to spend", async () => {
    const { t, householdId, incomeCat, groceryCat, loan } = await withLoan();
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "income",
      amount: 100_000_00,
      categoryId: incomeCat,
      occurredOn: "2026-07-01",
    });
    const txId = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 24_500_00,
      categoryId: groceryCat,
      potId: loan,
      occurredOn: "2026-07-12",
    });

    // One income-funded row, exactly as if the loan were never named.
    const rows = await funding(t, txId);
    expect(rows).toHaveLength(1);
    expect(rows[0].potId).toBeUndefined();

    const m = await asA(t).query(api.overview.month, {
      householdId,
      month: "2026-07",
    });
    expect(m.expense).toBe(24_500_00);
    expect(m.leftToSpend).toBe(75_500_00);
  });

  test("paying a loan out of a fund is both a payment and a withdrawal", async () => {
    const { t, householdId, groceryCat, loan } = await withLoan();
    const fund = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Rainy day",
      kind: "savings",
      icon: "piggy",
      color: "#1D9E75",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 50_000_00,
      potId: fund,
      occurredOn: "2026-07-02",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 30_000_00,
      categoryId: groceryCat,
      potId: loan, // the loan it pays down
      takeFromPotId: fund, // the money it comes out of
      occurredOn: "2026-07-12",
    });

    const pots = await asA(t).query(api.pots.balances, { householdId });
    expect(pots.find((p) => p._id === loan)!.owed).toBe(870_000_00);
    expect(pots.find((p) => p._id === fund)!.balance).toBe(20_000_00);
  });

  test("a fund cannot be paid off — that is what Take from is for", async () => {
    const { t, householdId, groceryCat } = await setup();
    const fund = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Rainy day",
      kind: "savings",
      icon: "piggy",
      color: "#1D9E75",
    });
    await expect(
      asA(t).mutation(api.transactions.create, {
        householdId,
        direction: "expense",
        amount: 1_000_00,
        categoryId: groceryCat,
        potId: fund,
        occurredOn: "2026-07-01",
      }),
    ).rejects.toThrow(/fund, not a loan/);
  });

  test("income cannot pay off a loan", async () => {
    const { t, householdId, incomeCat, loan } = await withLoan();
    await expect(
      asA(t).mutation(api.transactions.create, {
        householdId,
        direction: "income",
        amount: 1_000_00,
        categoryId: incomeCat,
        potId: loan,
        occurredOn: "2026-07-01",
      }),
    ).rejects.toThrow(/Only an expense can pay off a loan/);
  });

  test("a repeating instalment posts payments that keep paying it down", async () => {
    const { t, householdId, groceryCat, loan } = await withLoan();
    await asA(t).mutation(api.recurring.create, {
      householdId,
      direction: "expense",
      amount: 24_500_00,
      amountMode: "exact",
      categoryId: groceryCat,
      potId: loan,
      payee: "OTP banka",
      cadence: "monthly",
      startOn: "2026-07-12",
      autoPost: true,
    });
    await asA(t).mutation(api.recurring.sync, {
      householdId,
      through: "2026-09-30",
    });

    const pots = await asA(t).query(api.pots.balances, { householdId });
    // Three instalments: July, August, September.
    expect(pots.find((p) => p._id === loan)!.owed).toBe(826_500_00);
  });
});

describe("list rows", () => {
  test("a row names the fund it was paid out of, so it can be filtered by it", async () => {
    const { t, householdId, groceryCat } = await setup();
    const fund = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Holiday",
      kind: "sinking",
      icon: "plane",
      color: "#3B82F6",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 50_000_00,
      potId: fund,
      occurredOn: "2026-07-02",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 20_000_00,
      categoryId: groceryCat,
      takeFromPotId: fund,
      occurredOn: "2026-07-05",
    });

    const rows = await asA(t).query(api.transactions.listMonth, {
      householdId,
      month: "2026-07",
    });
    const spend = rows.find((r) => r.direction === "expense")!;
    const setAside = rows.find((r) => r.direction === "transfer")!;

    // The spend points at the fund through its funding, the transfer through
    // its destination — between them, everything that touched the fund.
    expect(spend.fundedFromPotId).toBe(fund);
    expect(spend.potId).toBeNull();
    expect(setAside.potId).toBe(fund);
    expect(setAside.fundedFromPotId).toBeNull();
  });
});

describe("isolation", () => {
  test("A cannot create a transaction in B's household", async () => {
    const { t } = await setup(); // t has user-a's household
    const hB = await t
      .withIdentity({ subject: "user-b" })
      .mutation(api.households.create, { name: "B", displayName: "B" });
    const bCats = await t
      .withIdentity({ subject: "user-b" })
      .query(api.categories.list, { householdId: hB });

    await expect(
      asA(t).mutation(api.transactions.create, {
        householdId: hB,
        direction: "expense",
        amount: 1_000_00,
        categoryId: bCats[0]._id,
        occurredOn: "2026-07-01",
      }),
    ).rejects.toThrow(/Not a member/);
  });
});

/**
 * A fiscal receipt carries no shop name, only the till's identifier. So the
 * name is learned: typed once against a till, returned on every later scan
 * there. This pins the whole loop, because until a scan is actually saved
 * nothing in the app can demonstrate that it works.
 */
describe("remembering a shop by its till", () => {
  const buy = (
    t: ReturnType<typeof convexTest>,
    householdId: Id<"households">,
    categoryId: Id<"categories">,
    extra: { merchant?: string; fiscalDevice?: string },
    day = "01",
  ) =>
    asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 4_599_00,
      categoryId,
      occurredOn: `2026-07-${day}`,
      ...extra,
    });

  test("the till and the name are both stored", async () => {
    const { t, householdId, groceryCat } = await setup();
    const id = await buy(t, householdId, groceryCat, {
      merchant: "Maxi",
      fiscalDevice: "SEGNUN3N",
    });

    const doc = await asA(t).query(api.transactions.detail, { transactionId: id });
    expect(doc.merchant).toBe("Maxi");
  });

  test("a later scan at the same till finds the name", async () => {
    const { t, householdId, groceryCat } = await setup();
    await buy(t, householdId, groceryCat, {
      merchant: "Maxi",
      fiscalDevice: "SEGNUN3N",
    });

    expect(
      await asA(t).query(api.transactions.merchantForDevice, {
        householdId,
        fiscalDevice: "SEGNUN3N",
      }),
    ).toBe("Maxi");
  });

  test("a till nobody has named yet returns nothing, rather than a guess", async () => {
    const { t, householdId, groceryCat } = await setup();
    // Saved from a scan, but with the field left empty — which is what the
    // FIRST visit to a shop looks like.
    await buy(t, householdId, groceryCat, { fiscalDevice: "SEGNUN3N" });

    expect(
      await asA(t).query(api.transactions.merchantForDevice, {
        householdId,
        fiscalDevice: "SEGNUN3N",
      }),
    ).toBeNull();
  });

  test("a different till is a different shop", async () => {
    const { t, householdId, groceryCat } = await setup();
    await buy(t, householdId, groceryCat, {
      merchant: "Maxi",
      fiscalDevice: "SEGNUN3N",
    });

    expect(
      await asA(t).query(api.transactions.merchantForDevice, {
        householdId,
        fiscalDevice: "OTHER123",
      }),
    ).toBeNull();
  });

  test("the most recent naming wins, so a renamed shop stays renamed", async () => {
    const { t, householdId, groceryCat } = await setup();
    await buy(t, householdId, groceryCat, {
      merchant: "Maxi",
      fiscalDevice: "SEGNUN3N",
    }, "01");
    await buy(t, householdId, groceryCat, {
      merchant: "Maxi Vračar",
      fiscalDevice: "SEGNUN3N",
    }, "20");

    expect(
      await asA(t).query(api.transactions.merchantForDevice, {
        householdId,
        fiscalDevice: "SEGNUN3N",
      }),
    ).toBe("Maxi Vračar");
  });

  test("editing a transaction can clear the merchant, and can set one", async () => {
    const { t, householdId, groceryCat } = await setup();
    const id = await buy(t, householdId, groceryCat, { merchant: "Maxi" });

    await asA(t).mutation(api.transactions.update, {
      transactionId: id,
      merchant: "",
    });
    let doc = await asA(t).query(api.transactions.detail, { transactionId: id });
    expect(doc.merchant).toBeNull();

    await asA(t).mutation(api.transactions.update, {
      transactionId: id,
      merchant: "Univerexport",
    });
    doc = await asA(t).query(api.transactions.detail, { transactionId: id });
    expect(doc.merchant).toBe("Univerexport");
  });

  test("the merchant list counts how often each was used", async () => {
    const { t, householdId, groceryCat } = await setup();
    await buy(t, householdId, groceryCat, { merchant: "Maxi" }, "01");
    await buy(t, householdId, groceryCat, { merchant: "Maxi" }, "02");
    await buy(t, householdId, groceryCat, { merchant: "Lidl" }, "03");

    expect(
      await asA(t).query(api.transactions.merchants, { householdId }),
    ).toEqual([
      { name: "Maxi", count: 2 },
      { name: "Lidl", count: 1 },
    ]);
  });
});
