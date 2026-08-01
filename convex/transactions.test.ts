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
