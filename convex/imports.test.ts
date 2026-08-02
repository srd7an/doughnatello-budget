import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

/**
 * Import. The properties worth pinning: imported money is funded exactly like
 * hand-entered money, importing the same file twice does not double anything,
 * and a bad row is skipped with a reason rather than taking the batch down.
 */

const asA = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "user-a" });

async function setup() {
  const t = convexTest(schema);
  const householdId = await asA(t).mutation(api.households.create, {
    name: "Home",
    displayName: "Me",
  });
  return { t, householdId };
}

const grocery = (date: string, amount: number, payee?: string) => ({
  date,
  direction: "expense" as const,
  amount,
  category: "Grocery",
  payee,
});

describe("commit", () => {
  test("imported expenses get the same funding rows as hand-entered ones", async () => {
    const { t, householdId } = await setup();
    const result = await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [grocery("2026-07-01", 2_000_00, "Idea"), grocery("2026-07-02", 1_500_00)],
    });
    expect(result.imported).toBe(2);

    const summary = await asA(t).query(api.overview.month, {
      householdId,
      month: "2026-07",
    });
    // Only reachable if funding rows were written — leftToSpend reads them.
    expect(summary.expense).toBe(3_500_00);
    expect(summary.leftToSpend).toBe(-3_500_00);
  });

  test("category names are matched case-insensitively", async () => {
    const { t, householdId } = await setup();
    const result = await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [{ ...grocery("2026-07-01", 1_000_00), category: "grocery" }],
    });
    expect(result.imported).toBe(1);
    const rows = await asA(t).query(api.transactions.listMonth, {
      householdId,
      month: "2026-07",
    });
    expect(rows[0].category?.name).toBe("Grocery");
  });

  test("an unknown category is skipped with a reason, or created on request", async () => {
    const { t, householdId } = await setup();
    const row = { ...grocery("2026-07-01", 1_000_00), category: "Parking" };

    const skipped = await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [row],
    });
    expect(skipped.imported).toBe(0);
    expect(skipped.errors[0]).toMatch(/Parking/);

    const created = await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [row],
      createMissingCategories: true,
    });
    expect(created.imported).toBe(1);
    expect(created.createdCategories).toBe(1);
  });

  test("importing the same file twice does not double the history", async () => {
    const { t, householdId } = await setup();
    const rows = [grocery("2026-07-01", 2_000_00, "Idea")];

    await asA(t).mutation(api.imports.commit, { householdId, rows });
    const second = await asA(t).mutation(api.imports.commit, { householdId, rows });

    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
    expect(
      await asA(t).query(api.transactions.listMonth, {
        householdId,
        month: "2026-07",
      }),
    ).toHaveLength(1);
  });

  test("duplicates within one file are caught too", async () => {
    const { t, householdId } = await setup();
    const result = await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [grocery("2026-07-01", 2_000_00, "Idea"), grocery("2026-07-01", 2_000_00, "Idea")],
    });
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });

  test("skipDuplicates false lets a genuine repeat through", async () => {
    const { t, householdId } = await setup();
    const rows = [grocery("2026-07-01", 2_000_00, "Idea")];
    await asA(t).mutation(api.imports.commit, { householdId, rows });
    const again = await asA(t).mutation(api.imports.commit, {
      householdId,
      rows,
      skipDuplicates: false,
    });
    expect(again.imported).toBe(1);
  });

  test("a bad row is skipped without taking the batch down", async () => {
    const { t, householdId } = await setup();
    const result = await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [
        { date: "01/07/2026", direction: "expense", amount: 1_000_00, category: "Grocery" },
        { date: "2026-07-02", direction: "expense", amount: -5, category: "Grocery" },
        grocery("2026-07-03", 1_000_00),
      ],
    });
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/YYYY-MM-DD/);
    expect(result.errors[1]).toMatch(/positive/);
  });

  test("a transfer needs a fund that exists", async () => {
    const { t, householdId } = await setup();
    const bad = await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [{ date: "2026-07-01", direction: "transfer", amount: 5_000_00, fund: "Car" }],
    });
    expect(bad.imported).toBe(0);
    expect(bad.errors[0]).toMatch(/no fund/);

    await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Car",
      kind: "sinking",
      icon: "car",
      color: "#1D9E75",
    });
    const good = await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [{ date: "2026-07-01", direction: "transfer", amount: 5_000_00, fund: "Car" }],
    });
    expect(good.imported).toBe(1);
    const balances = await asA(t).query(api.pots.balances, { householdId });
    expect(balances[0].balance).toBe(5_000_00);
  });

  test("rows land on a named account", async () => {
    const { t, householdId } = await setup();
    const second = await asA(t).mutation(api.accounts.create, {
      householdId,
      name: "Second",
    });
    await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [grocery("2026-07-01", 1_000_00)],
      accountId: second,
    });
    const accounts = await asA(t).query(api.accounts.list, { householdId });
    expect(accounts.find((a) => a._id === second)!.transactionCount).toBe(1);
  });
});

describe("preview", () => {
  test("reports what would happen without writing anything", async () => {
    const { t, householdId } = await setup();
    await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [grocery("2026-07-01", 2_000_00, "Idea")],
    });

    const preview = await asA(t).mutation(api.imports.preview, {
      householdId,
      rows: [
        grocery("2026-07-01", 2_000_00, "Idea"), // already there
        { ...grocery("2026-07-02", 1_000_00), category: "Parking" }, // unknown
        { date: "nope", direction: "expense", amount: 1, category: "Grocery" }, // invalid
      ],
    });

    expect(preview).toMatchObject({
      total: 3,
      invalid: 1,
      duplicates: 1,
      importable: 1,
      unknownCategories: ["Parking"],
    });
    // Nothing was written.
    expect(
      await asA(t).query(api.transactions.listMonth, {
        householdId,
        month: "2026-07",
      }),
    ).toHaveLength(1);
  });
});

describe("cross-household isolation for import", () => {
  test("A cannot import into B's household", async () => {
    const t = convexTest(schema);
    await asA(t).mutation(api.households.create, { name: "A", displayName: "A" });
    const asB = t.withIdentity({ subject: "user-b" });
    const hB = await asB.mutation(api.households.create, {
      name: "B",
      displayName: "B",
    });

    await expect(
      asA(t).mutation(api.imports.commit, {
        householdId: hB,
        rows: [grocery("2026-07-01", 1_000_00)],
      }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      asA(t).mutation(api.imports.preview, { householdId: hB, rows: [] }),
    ).rejects.toThrow(/Not a member/);
  });
});
