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

  // Two identical rows in ONE file used to be treated as a duplicate pair and
  // one of them dropped. That was wrong and is now the opposite — see
  // "identical rows that are not duplicates" below. The file is the claim about
  // what happened; deduping is only there to survive importing it twice.

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

/**
 * The three columns a CSV could not say until now: what a spend came out of,
 * what an instalment pays down, and which fund a move left.
 */
describe("pay from, paying off, and moving between funds", () => {
  async function withPots() {
    const ctx = await setup();
    const fund = await asA(ctx.t).mutation(api.pots.create, {
      householdId: ctx.householdId,
      name: "Rainy day",
      kind: "savings",
      icon: "piggy",
      color: "#1D9E75",
    });
    const other = await asA(ctx.t).mutation(api.pots.create, {
      householdId: ctx.householdId,
      name: "Repairs",
      kind: "sinking",
      icon: "repair",
      color: "#7C3AED",
    });
    const loan = await asA(ctx.t).mutation(api.pots.create, {
      householdId: ctx.householdId,
      name: "Car loan",
      kind: "debt",
      icon: "car",
      color: "#B45309",
      originalAmount: 900_000_00,
    });
    return { ...ctx, fund, other, loan };
  }

  test("an expense can be paid out of a fund", async () => {
    const { t, householdId, fund } = await withPots();
    await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [
        { date: "2026-07-01", direction: "transfer", amount: 50_000_00, fund: "Rainy day" },
        { ...grocery("2026-07-05", 20_000_00, "Maxi"), payFrom: "Rainy day" },
      ],
    });

    const pots = await asA(t).query(api.pots.balances, { householdId });
    expect(pots.find((p) => p._id === fund)!.balance).toBe(30_000_00);
    // Spent from a fund, so it does NOT come off the month: setting the money
    // aside was the outflow, and it was counted then.
    const m = await asA(t).query(api.overview.month, { householdId, month: "2026-07" });
    expect(m.savings).toBe(50_000_00);
    expect(m.expense).toBe(0);
    expect(m.paidFromFunds).toBe(20_000_00);
  });

  test("an instalment can name the loan it pays down", async () => {
    const { t, householdId, loan } = await withPots();
    await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [
        { ...grocery("2026-07-12", 24_500_00, "OTP banka"), paysOff: "Car loan" },
      ],
    });

    const pots = await asA(t).query(api.pots.balances, { householdId });
    expect(pots.find((p) => p._id === loan)!.owed).toBe(875_500_00);
  });

  test("a transfer can move between funds, and can release one", async () => {
    const { t, householdId, fund, other } = await withPots();
    await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [
        { date: "2026-07-01", direction: "transfer", amount: 50_000_00, fund: "Rainy day" },
        {
          date: "2026-07-10",
          direction: "transfer",
          amount: 20_000_00,
          fund: "Repairs",
          payFrom: "Rainy day",
        },
        // No destination: money let go of, which is a row with a source only.
        { date: "2026-07-11", direction: "transfer", amount: 5_000_00, payFrom: "Rainy day" },
      ],
    });

    const pots = await asA(t).query(api.pots.balances, { householdId });
    expect(pots.find((p) => p._id === fund)!.balance).toBe(25_000_00);
    expect(pots.find((p) => p._id === other)!.balance).toBe(20_000_00);
  });

  test("a fund named as a loan is refused, with the row that did it", async () => {
    const { t, householdId } = await withPots();
    const result = await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [{ ...grocery("2026-07-05", 1_000_00, "Maxi"), paysOff: "Rainy day" }],
    });

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toMatch(/Row 1.*fund, not a loan/);
  });

  test("an unknown fund is named in the preview before anything is written", async () => {
    const { t, householdId } = await withPots();
    const p = await asA(t).mutation(api.imports.preview, {
      householdId,
      rows: [{ ...grocery("2026-07-05", 1_000_00), payFrom: "Holiday" }],
    });
    expect(p.unknownFunds).toContain("Holiday");
  });
});

describe("a row with no category", () => {
  test("lands in Uncategorised rather than being refused", async () => {
    const { t, householdId } = await setup();
    const result = await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [
        { date: "2026-07-01", direction: "expense", amount: 2_000_00, payee: "Idea" },
      ],
    });

    expect(result.imported).toBe(1);
    const cats = await asA(t).query(api.categories.list, { householdId });
    expect(cats.map((c) => c.name)).toContain("Uncategorised");
  });

  test("all of them share the one category, not one each", async () => {
    const { t, householdId } = await setup();
    await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [
        { date: "2026-07-01", direction: "expense", amount: 1_000_00, payee: "A" },
        { date: "2026-07-02", direction: "expense", amount: 2_000_00, payee: "B" },
      ],
    });

    const cats = await asA(t).query(api.categories.list, { householdId });
    expect(cats.filter((c) => c.name === "Uncategorised")).toHaveLength(1);
  });

  test("the preview counts them before anything is written", async () => {
    const { t, householdId } = await setup();
    const p = await asA(t).mutation(api.imports.preview, {
      householdId,
      rows: [
        { date: "2026-07-01", direction: "expense", amount: 1_000_00 },
        { ...grocery("2026-07-02", 2_000_00) },
      ],
    });
    expect(p.uncategorised).toBe(1);
    expect(p.unknownCategories).not.toContain("");
  });
});

/**
 * The bug this suite exists for: five real expenses were imported into a
 * category of kind "income" that merely shared their name and had been
 * archived months earlier. They counted towards the month's total but appeared
 * in neither Needs nor Wants, because the month groups by kind — and being
 * archived, the category was invisible in Settings and unpickable in the form,
 * so the rows wore the fallback star and could not be corrected.
 */
describe("matching a category by name", () => {
  test("an archived category is never matched — a live one is made instead", async () => {
    const { t, householdId } = await setup();
    const cats = await asA(t).query(api.categories.list, { householdId });
    const grocery = cats.find((c) => c.name === "Grocery")!;
    await asA(t).mutation(api.categories.archive, { categoryId: grocery._id });

    await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [
        {
          date: "2026-07-01",
          direction: "expense" as const,
          amount: 1_000_00,
          category: "Grocery",
        },
      ],
      createMissingCategories: true,
    });

    const after = await asA(t).query(api.categories.list, { householdId });
    const live = after.filter((c) => c.name === "Grocery");
    expect(live).toHaveLength(1); // list() hides the archived one
    expect(live[0]._id).not.toBe(grocery._id);

    // And the preview says so first, rather than silently binding to the dead one.
    const p = await asA(t).mutation(api.imports.preview, {
      householdId,
      rows: [
        { date: "2026-07-02", direction: "income" as const, amount: 1_00, category: "Grocery" },
      ],
    });
    expect(p.unknownCategories).toContain("Grocery");
  });

  test("income and expense rows of the same name get a category each", async () => {
    const { t, householdId } = await setup();
    await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [
        { date: "2026-07-01", direction: "expense" as const, amount: 5_000_00, category: "Rent" },
        { date: "2026-07-02", direction: "income" as const, amount: 9_000_00, category: "Rent" },
      ],
      createMissingCategories: true,
    });

    const cats = await asA(t).query(api.categories.list, { householdId });
    const rent = cats.filter((c) => c.name === "Rent");
    expect(rent).toHaveLength(2);
    expect(rent.map((c) => c.kind).sort()).toEqual(["committed", "income"]);
  });

  test("a blank category keeps the two sides apart too", async () => {
    const { t, householdId } = await setup();
    await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [
        { date: "2026-07-01", direction: "expense" as const, amount: 1_000_00 },
        { date: "2026-07-02", direction: "income" as const, amount: 2_000_00 },
      ],
    });

    const cats = await asA(t).query(api.categories.list, { householdId });
    expect(cats.find((c) => c.name === "Uncategorised")!.kind).toBe("committed");
    expect(cats.find((c) => c.name === "Uncategorised income")!.kind).toBe("income");
  });

  test("the server refuses an expense filed under an income category", async () => {
    const { t, householdId } = await setup();
    const cats = await asA(t).query(api.categories.list, { householdId });
    const incomeCat = cats.find((c) => c.kind === "income")!;

    await expect(
      asA(t).mutation(api.transactions.create, {
        householdId,
        direction: "expense",
        amount: 1_000_00,
        categoryId: incomeCat._id,
        occurredOn: "2026-07-01",
      }),
    ).rejects.toThrow(/is an income category/);
  });
});

/**
 * Repetition is not duplication.
 *
 * The check exists so importing the same file twice does not double a year of
 * spending. It is not there to decide that two coffees on the same day for the
 * same money cannot both have happened — and it used to, because a row was
 * added to the seen-set the moment it was imported, so the second of two
 * identical rows in one file was skipped as a duplicate of the first.
 */
describe("identical rows that are not duplicates", () => {
  const coffee = (payee: string) => ({
    date: "2026-07-01",
    direction: "expense" as const,
    amount: 3_50_00,
    category: "Grocery",
    payee,
  });

  test("two identical rows in one file are two transactions", async () => {
    const { t, householdId } = await setup();
    const result = await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [coffee("Kafeterija"), coffee("Kafeterija")],
    });
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);

    const rows = await asA(t).query(api.transactions.listMonth, {
      householdId,
      month: "2026-07",
    });
    expect(rows).toHaveLength(2);
  });

  test("but importing the same file twice still adds nothing", async () => {
    const { t, householdId } = await setup();
    const rows = [coffee("Kafeterija"), coffee("Kafeterija")];
    await asA(t).mutation(api.imports.commit, { householdId, rows });
    const second = await asA(t).mutation(api.imports.commit, { householdId, rows });

    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(2);
  });

  test("a third copy on top of two existing ones imports exactly one", async () => {
    const { t, householdId } = await setup();
    await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [coffee("Kafeterija"), coffee("Kafeterija")],
    });
    // The file now says three. Two are already here, so one is new.
    const again = await asA(t).mutation(api.imports.commit, {
      householdId,
      rows: [coffee("Kafeterija"), coffee("Kafeterija"), coffee("Kafeterija")],
    });
    expect(again.imported).toBe(1);
    expect(again.skipped).toBe(2);
  });

  test("the preview counts them the same way it will import them", async () => {
    const { t, householdId } = await setup();
    await asA(t).mutation(api.imports.commit, { householdId, rows: [coffee("A")] });

    const p = await asA(t).mutation(api.imports.preview, {
      householdId,
      rows: [coffee("A"), coffee("A"), coffee("A")],
    });
    expect(p.duplicates).toBe(1);
    expect(p.importable).toBe(2);
  });
})
