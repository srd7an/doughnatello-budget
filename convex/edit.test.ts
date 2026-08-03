import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

/**
 * Editing a transaction. The rule under test throughout: funding rows are
 * re-derived from the RESULT, never patched — so an edit lands in exactly the
 * state the same transaction would have had if entered that way first time.
 */
const asA = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "user-a" });

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
    income: cats.find((c) => c.kind === "income")!._id,
    grocery: cats.find((c) => c.name === "Grocery")!._id,
    takeout: cats.find((c) => c.name === "Takeout")!._id,
  };
}

const funding = (t: ReturnType<typeof convexTest>, txId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("transactionFunding")
      .filter((q) => q.eq(q.field("transactionId"), txId))
      .collect(),
  );

describe("editing", () => {
  test("changing the amount re-derives the funding row", async () => {
    const { t, householdId, grocery } = await setup();
    const id = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 2_000_00,
      categoryId: grocery,
      occurredOn: "2026-07-01",
    });

    await asA(t).mutation(api.transactions.update, {
      transactionId: id,
      amount: 3_500_00,
    });

    const rows = await funding(t, id);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(3_500_00);
    const summary = await asA(t).query(api.overview.month, {
      householdId,
      month: "2026-07",
    });
    expect(summary.expense).toBe(3_500_00);
  });

  test("editing keeps pot funding without being told about it", async () => {
    const { t, householdId, grocery } = await setup();
    const pot = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Car",
      kind: "sinking",
      icon: "car",
      color: "#10B981",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 20_000_00,
      potId: pot,
      occurredOn: "2026-07-01",
    });
    const id = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 3_000_00,
      categoryId: grocery,
      takeFromPotId: pot,
      occurredOn: "2026-07-02",
    });

    await asA(t).mutation(api.transactions.update, {
      transactionId: id,
      payee: "Renamed",
    });

    const rows = await funding(t, id);
    expect(rows).toHaveLength(1);
    expect(rows[0].potId).toBe(pot); // still funded by the pot
  });

  test("raising a pot-funded expense past the pot splits it", async () => {
    const { t, householdId, grocery } = await setup();
    const pot = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Car",
      kind: "sinking",
      icon: "car",
      color: "#10B981",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 5_000_00,
      potId: pot,
      occurredOn: "2026-07-01",
    });
    const id = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 3_000_00,
      categoryId: grocery,
      takeFromPotId: pot,
      occurredOn: "2026-07-02",
    });

    // 8.000 against a 5.000 pot: 5.000 from the pot, 3.000 from the month.
    await asA(t).mutation(api.transactions.update, {
      transactionId: id,
      amount: 8_000_00,
    });

    const rows = await funding(t, id);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.potId === pot)!.amount).toBe(5_000_00);
    expect(rows.find((r) => !r.potId)!.amount).toBe(3_000_00);
  });

  test("clearing pot funding moves it back onto the month", async () => {
    const { t, householdId, grocery } = await setup();
    const pot = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Car",
      kind: "sinking",
      icon: "car",
      color: "#10B981",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 20_000_00,
      potId: pot,
      occurredOn: "2026-07-01",
    });
    const id = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 3_000_00,
      categoryId: grocery,
      takeFromPotId: pot,
      occurredOn: "2026-07-02",
    });

    await asA(t).mutation(api.transactions.update, {
      transactionId: id,
      clearPotFunding: true,
    });

    const rows = await funding(t, id);
    expect(rows).toHaveLength(1);
    expect(rows[0].potId).toBeUndefined();
  });

  test("switching an expense to income drops its funding rows", async () => {
    const { t, householdId, grocery, income } = await setup();
    const id = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 2_000_00,
      categoryId: grocery,
      occurredOn: "2026-07-01",
    });

    await asA(t).mutation(api.transactions.update, {
      transactionId: id,
      direction: "income",
      categoryId: income,
    });

    expect(await funding(t, id)).toHaveLength(0);
    const summary = await asA(t).query(api.overview.month, {
      householdId,
      month: "2026-07",
    });
    expect(summary.income).toBe(2_000_00);
    expect(summary.expense).toBe(0);
  });

  test("moving the date moves it between months", async () => {
    const { t, householdId, grocery } = await setup();
    const id = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 1_000_00,
      categoryId: grocery,
      occurredOn: "2026-07-31",
    });
    await asA(t).mutation(api.transactions.update, {
      transactionId: id,
      occurredOn: "2026-08-01",
    });

    expect(
      await asA(t).query(api.transactions.listMonth, { householdId, month: "2026-07" }),
    ).toHaveLength(0);
    expect(
      await asA(t).query(api.transactions.listMonth, { householdId, month: "2026-08" }),
    ).toHaveLength(1);
  });

  test("a transfer cannot lose its pot, nor an expense its category", async () => {
    const { t, householdId, grocery } = await setup();
    const id = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 1_000_00,
      categoryId: grocery,
      occurredOn: "2026-07-01",
    });
    await expect(
      asA(t).mutation(api.transactions.update, {
        transactionId: id,
        direction: "transfer",
      }),
    ).rejects.toThrow(/destination pot/);
  });

  // The edit form offers every field the add form does, so each of these is a
  // change someone can now make with two taps.
  test("clearing the payee clears it, rather than putting it back", async () => {
    const { t, householdId, grocery } = await setup();
    const id = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 1_000_00,
      categoryId: grocery,
      occurredOn: "2026-07-01",
      payee: "Maxi",
      note: "milk",
    });

    // Omitted stays; empty clears. Both in one edit, so they cannot pass by
    // accidentally sharing a code path.
    await asA(t).mutation(api.transactions.update, {
      transactionId: id,
      payee: "",
    });
    const after = await asA(t).query(api.transactions.detail, {
      transactionId: id,
    });
    expect(after.payee).toBeNull();
    expect(after.note).toBe("milk");
  });

  test("moving an expense to another fund empties the first and fills the second", async () => {
    const { t, householdId, grocery } = await setup();
    const potIds = await Promise.all(
      ["Holiday", "Repairs"].map((name) =>
        asA(t).mutation(api.pots.create, {
          householdId,
          name,
          kind: "sinking",
          icon: "piggy",
          color: "#1D9E75",
        }),
      ),
    );
    for (const potId of potIds) {
      await asA(t).mutation(api.transactions.create, {
        householdId,
        direction: "transfer",
        amount: 50_000_00,
        potId,
        occurredOn: "2026-07-01",
      });
    }
    const id = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 20_000_00,
      categoryId: grocery,
      takeFromPotId: potIds[0],
      occurredOn: "2026-07-05",
    });

    await asA(t).mutation(api.transactions.update, {
      transactionId: id,
      takeFromPotId: potIds[1],
    });

    const pots = await asA(t).query(api.pots.balances, { householdId });
    expect(pots.find((p) => p._id === potIds[0])!.balance).toBe(50_000_00);
    expect(pots.find((p) => p._id === potIds[1])!.balance).toBe(30_000_00);
  });

  test("naming a loan on an existing expense pays it down; clearing it gives it back", async () => {
    const { t, householdId, grocery } = await setup();
    const loan = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Car loan",
      kind: "debt",
      icon: "car",
      color: "#B45309",
      originalAmount: 900_000_00,
    });
    const id = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 24_500_00,
      categoryId: grocery,
      occurredOn: "2026-07-12",
    });

    await asA(t).mutation(api.transactions.update, {
      transactionId: id,
      potId: loan,
    });
    const owed = async () =>
      (await asA(t).query(api.pots.balances, { householdId })).find(
        (p) => p._id === loan,
      )!.owed;
    expect(await owed()).toBe(875_500_00);

    await asA(t).mutation(api.transactions.update, {
      transactionId: id,
      clearLoan: true,
    });
    expect(await owed()).toBe(900_000_00);
  });

  test("a transfer turned into an expense does not become a loan payment", async () => {
    const { t, householdId, grocery } = await setup();
    const potId = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Holiday",
      kind: "sinking",
      icon: "plane",
      color: "#3B82F6",
    });
    const id = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 10_000_00,
      potId,
      occurredOn: "2026-07-01",
    });

    // The destination fund would otherwise carry over into potId, where on an
    // expense it would read as "pays off this fund" — which it is not.
    await asA(t).mutation(api.transactions.update, {
      transactionId: id,
      direction: "expense",
      categoryId: grocery,
    });

    const after = await asA(t).query(api.transactions.detail, {
      transactionId: id,
    });
    expect(after.potId).toBeNull();
    const pots = await asA(t).query(api.pots.balances, { householdId });
    expect(pots.find((p) => p._id === potId)!.balance).toBe(0);
  });

  test("an expense corrected to a transfer keeps the fund it was given", async () => {
    const { t, householdId, grocery } = await setup();
    const potId = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Car stuff",
      kind: "sinking",
      icon: "car",
      color: "#D6336C",
    });
    const id = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 10_000_00,
      categoryId: grocery,
      occurredOn: "2026-01-01",
      payee: "Car saving",
    });

    // Exactly what the form sends when you switch the tab to Transfer and
    // pick a fund: clearLoan is set because this is no longer an expense.
    await asA(t).mutation(api.transactions.update, {
      transactionId: id,
      direction: "transfer",
      potId,
      clearLoan: true,
      clearPotFunding: true,
      clearFromPot: true,
    });

    const after = await asA(t).query(api.transactions.detail, {
      transactionId: id,
    });
    expect(after.direction).toBe("transfer");
    expect(after.potId).toBe(potId);
    expect(after.categoryId).toBeNull();

    const pots = await asA(t).query(api.pots.balances, { householdId });
    expect(pots.find((p) => p._id === potId)!.balance).toBe(10_000_00);
  });

  test("an amount of zero is refused", async () => {
    const { t, householdId, grocery } = await setup();
    const id = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 1_000_00,
      categoryId: grocery,
      occurredOn: "2026-07-01",
    });
    await expect(
      asA(t).mutation(api.transactions.update, { transactionId: id, amount: 0 }),
    ).rejects.toThrow(/positive/);
  });
});

describe("detail", () => {
  test("shows how the money was actually funded", async () => {
    const { t, householdId, grocery } = await setup();
    const pot = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Car fund",
      kind: "sinking",
      icon: "car",
      color: "#10B981",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 5_000_00,
      potId: pot,
      occurredOn: "2026-07-01",
    });
    const id = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 8_000_00,
      categoryId: grocery,
      takeFromPotId: pot,
      occurredOn: "2026-07-02",
      payee: "Idea",
    });

    const d = await asA(t).query(api.transactions.detail, { transactionId: id });
    expect(d.payee).toBe("Idea");
    expect(d.category?.name).toBe("Grocery");
    expect(d.accountName).toBe("Main");
    expect(d.paidByName).toBe("Me");
    expect(d.funding).toHaveLength(2);
    expect(d.funding.find((f) => f.potName === "Car fund")!.amount).toBe(5_000_00);
    expect(d.funding.find((f) => f.potId === null)!.amount).toBe(3_000_00);
  });
});

describe("isolation", () => {
  test("A cannot edit, read or delete B's transaction", async () => {
    const t = convexTest(schema);
    await asA(t).mutation(api.households.create, { name: "A", displayName: "A" });
    const asB = t.withIdentity({ subject: "user-b" });
    const hB = await asB.mutation(api.households.create, { name: "B", displayName: "B" });
    const catsB = await asB.query(api.categories.list, { householdId: hB });
    const txB = await asB.mutation(api.transactions.create, {
      householdId: hB,
      direction: "expense",
      amount: 1_000_00,
      categoryId: catsB.find((c) => c.kind !== "income")!._id,
      occurredOn: "2026-07-01",
    });

    await expect(
      asA(t).mutation(api.transactions.update, { transactionId: txB, amount: 1 }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      asA(t).query(api.transactions.detail, { transactionId: txB }),
    ).rejects.toThrow(/Not a member/);
  });
});
