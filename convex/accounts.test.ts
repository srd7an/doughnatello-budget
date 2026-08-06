import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

/**
 * Multiple accounts, and the two ways a balance can change: overwrite it, or
 * record why it moved. The second is the one that matters — it is what stops
 * the ledger and the bank figure drifting apart silently.
 */

const asA = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "user-a" });

async function setup() {
  const t = convexTest(schema);
  const householdId = await asA(t).mutation(api.households.create, {
    name: "Home",
    displayName: "Me",
  });
  const [main] = await asA(t).query(api.accounts.list, { householdId });
  const cats = await asA(t).query(api.categories.list, { householdId });
  return {
    t,
    householdId,
    main,
    groceryCat: cats.find((c) => c.name === "Grocery")!._id,
  };
}

describe("multiple accounts", () => {
  test("a household starts with one primary account", async () => {
    const { main } = await setup();
    expect(main.name).toBe("Main account");
    expect(main.isPrimary).toBe(true);
    expect(main.transactionCount).toBe(0);
  });

  test("a second account is not primary, and primary can be moved", async () => {
    const { t, householdId, main } = await setup();
    const second = await asA(t).mutation(api.accounts.create, {
      householdId,
      name: "Savings account",
      bankBalance: 50_000_00,
    });

    let list = await asA(t).query(api.accounts.list, { householdId });
    expect(list.find((a) => a._id === second)!.isPrimary).toBe(false);

    await asA(t).mutation(api.accounts.setPrimary, { accountId: second });
    list = await asA(t).query(api.accounts.list, { householdId });
    expect(list.find((a) => a._id === second)!.isPrimary).toBe(true);
    expect(list.find((a) => a._id === main._id)!.isPrimary).toBe(false);
  });

  test("a transaction lands on the named account, or the primary", async () => {
    const { t, householdId, main, groceryCat } = await setup();
    const second = await asA(t).mutation(api.accounts.create, {
      householdId,
      name: "Second",
    });

    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 1_000_00,
      categoryId: groceryCat,
      occurredOn: "2026-07-01",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 2_000_00,
      categoryId: groceryCat,
      occurredOn: "2026-07-02",
      accountId: second,
    });

    const list = await asA(t).query(api.accounts.list, { householdId });
    expect(list.find((a) => a._id === main._id)!.transactionCount).toBe(1);
    expect(list.find((a) => a._id === second)!.transactionCount).toBe(1);
  });

  test("the last account cannot be archived, nor the primary one", async () => {
    const { t, householdId, main } = await setup();
    await expect(
      asA(t).mutation(api.accounts.archive, { accountId: main._id }),
    ).rejects.toThrow(/last account/);

    const second = await asA(t).mutation(api.accounts.create, {
      householdId,
      name: "Second",
    });
    await expect(
      asA(t).mutation(api.accounts.archive, { accountId: main._id }),
    ).rejects.toThrow(/primary/);
    // The non-primary one goes fine.
    await asA(t).mutation(api.accounts.archive, { accountId: second });
    expect(await asA(t).query(api.accounts.list, { householdId })).toHaveLength(1);
  });
});

describe("changing what the bank says", () => {
  test("setBalance overwrites, explaining nothing", async () => {
    const { t, householdId, main } = await setup();
    await asA(t).mutation(api.accounts.setBalance, {
      accountId: main._id,
      bankBalance: 120_000_00,
    });
    const [after] = await asA(t).query(api.accounts.list, { householdId })
    expect(after.bankBalance).toBe(120_000_00)

    const txs = await asA(t).query(api.transactions.listMonth, {
      householdId,
      month: new Date().toISOString().slice(0, 7),
    })
    expect(txs).toHaveLength(0) // nothing recorded
  });

  test("adjustBalance moves the figure AND records why", async () => {
    const { t, householdId, main } = await setup();
    await asA(t).mutation(api.accounts.setBalance, {
      accountId: main._id,
      bankBalance: 100_000_00,
    });

    const today = new Date().toISOString().slice(0, 10);
    await asA(t).mutation(api.accounts.adjustBalance, {
      accountId: main._id,
      bankBalance: 92_000_00, // 8.000 less than the app thought
      occurredOn: today,
    });

    const [after] = await asA(t).query(api.accounts.list, { householdId });
    expect(after.bankBalance).toBe(92_000_00);

    const txs = await asA(t).query(api.transactions.listMonth, {
      householdId,
      month: today.slice(0, 7),
    });
    expect(txs).toHaveLength(1);
    expect(txs[0].direction).toBe("expense"); // money went missing
    expect(txs[0].amount).toBe(8_000_00);
    expect(txs[0].payee).toBe("Balance adjustment");
    expect(txs[0].category?.name).toBe("Adjustment");
  });

  test("money appearing is recorded as income", async () => {
    const { t, householdId, main } = await setup();
    const today = new Date().toISOString().slice(0, 10);
    await asA(t).mutation(api.accounts.adjustBalance, {
      accountId: main._id,
      bankBalance: 5_000_00,
      occurredOn: today,
    });
    const txs = await asA(t).query(api.transactions.listMonth, {
      householdId,
      month: today.slice(0, 7),
    });
    expect(txs[0].direction).toBe("income");
    expect(txs[0].amount).toBe(5_000_00);
  });

  test("one Adjustment category per side, each created once and reused", async () => {
    const { t, householdId, main } = await setup();
    const today = new Date().toISOString().slice(0, 10);
    const to = (bankBalance: number) =>
      asA(t).mutation(api.accounts.adjustBalance, {
        accountId: main._id,
        bankBalance,
        occurredOn: today,
      });
    // Up twice, down twice: two of each kind, and no category made per call.
    await to(1_000_00);
    await to(3_000_00);
    await to(2_000_00);
    await to(500_00);

    const cats = await asA(t).query(api.categories.list, { householdId });
    const adjustments = cats.filter((c) => c.name.startsWith("Adjustment"));
    expect(adjustments).toHaveLength(2);
    // The side must match the direction, or the rows land in neither group.
    expect(adjustments.find((c) => c.name === "Adjustment income")!.kind).toBe(
      "income",
    );
    expect(adjustments.find((c) => c.name === "Adjustment")!.kind).toBe(
      "committed",
    );
  });

  test("adjusting to the same figure records nothing", async () => {
    const { t, householdId, main } = await setup();
    const result = await asA(t).mutation(api.accounts.adjustBalance, {
      accountId: main._id,
      bankBalance: main.bankBalance,
    });
    expect(result).toBeNull();
    const cats = await asA(t).query(api.categories.list, { householdId });
    expect(cats.some((c) => c.name === "Adjustment")).toBe(false);
  });
});

describe("cross-household isolation for accounts", () => {
  test("A cannot read or change B's accounts", async () => {
    const t = convexTest(schema);
    await asA(t).mutation(api.households.create, { name: "A", displayName: "A" });
    const asB = t.withIdentity({ subject: "user-b" });
    const hB = await asB.mutation(api.households.create, {
      name: "B",
      displayName: "B",
    });
    const [accountB] = await asB.query(api.accounts.list, { householdId: hB });

    const a = asA(t);
    await expect(
      a.query(api.accounts.list, { householdId: hB }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      a.mutation(api.accounts.create, { householdId: hB, name: "x" }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      a.mutation(api.accounts.setBalance, {
        accountId: accountB._id,
        bankBalance: 1,
      }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      a.mutation(api.accounts.adjustBalance, {
        accountId: accountB._id,
        bankBalance: 1,
      }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      a.mutation(api.accounts.setPrimary, { accountId: accountB._id }),
    ).rejects.toThrow(/Not a member/);
  });

  test("A cannot book a transaction onto B's account", async () => {
    const t = convexTest(schema);
    const hA = await asA(t).mutation(api.households.create, {
      name: "A",
      displayName: "A",
    });
    const asB = t.withIdentity({ subject: "user-b" });
    const hB = await asB.mutation(api.households.create, {
      name: "B",
      displayName: "B",
    });
    const [accountB] = await asB.query(api.accounts.list, { householdId: hB });
    const catsA = await asA(t).query(api.categories.list, { householdId: hA });

    await expect(
      asA(t).mutation(api.transactions.create, {
        householdId: hA,
        direction: "expense",
        amount: 1_000_00,
        categoryId: catsA.find((c) => c.kind !== "income")!._id,
        occurredOn: "2026-07-01",
        accountId: accountB._id,
      }),
    ).rejects.toThrow(/Account not found/);
  });
});

describe("the account's own glyph", () => {
  test("a household's first account gets one, and it can be changed", async () => {
    const { t, householdId, main } = await setup();
    expect(main.icon).toBe("bank");

    await asA(t).mutation(api.accounts.setIcon, {
      accountId: main._id,
      icon: "piggy",
    });
    const [after] = await asA(t).query(api.accounts.list, { householdId });
    expect(after.icon).toBe("piggy");
  });

  test("an account written before icons existed still draws one", async () => {
    // The field is optional in the schema, so a document from before it has no
    // icon at all. The fallback lives in the query rather than in every screen
    // that reads it.
    const t = convexTest(schema);
    const householdId = await asA(t).mutation(api.households.create, {
      name: "Home",
      displayName: "Me",
    });
    const [acc] = await asA(t).query(api.accounts.list, { householdId });
    await t.run(async (ctx) => {
      await ctx.db.patch(acc._id, { icon: undefined });
    });

    const [after] = await asA(t).query(api.accounts.list, { householdId });
    expect(after.icon).toBe("bank");
  });
})
