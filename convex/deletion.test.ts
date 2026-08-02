import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

/**
 * Permanent deletion of archived things.
 *
 * Archiving exists so a name stamped on history is never silently lost. These
 * pin the line: anything still referenced refuses, anything unused goes.
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
  return { t, householdId, grocery: cats.find((c) => c.name === "Grocery")! };
}

describe("categories", () => {
  test("an unused archived category can be deleted", async () => {
    const { t, householdId } = await setup();
    const id = await asA(t).mutation(api.categories.create, {
      householdId,
      name: "Typo",
      kind: "committed",
      icon: "star",
      color: "#78716C",
    });
    await asA(t).mutation(api.categories.archive, { categoryId: id });
    await asA(t).mutation(api.categories.remove, { categoryId: id });

    const all = await asA(t).query(api.categories.list, {
      householdId,
      includeArchived: true,
    });
    expect(all.some((c) => c._id === id)).toBe(false);
  });

  test("it must be archived first", async () => {
    const { t, grocery } = await setup();
    await expect(
      asA(t).mutation(api.categories.remove, { categoryId: grocery._id }),
    ).rejects.toThrow(/Archive it first/);
  });

  test("one with transactions refuses, so history stays labelled", async () => {
    const { t, householdId, grocery } = await setup();
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 1_000_00,
      categoryId: grocery._id,
      occurredOn: "2026-07-01",
    });
    await asA(t).mutation(api.categories.archive, { categoryId: grocery._id });

    await expect(
      asA(t).mutation(api.categories.remove, { categoryId: grocery._id }),
    ).rejects.toThrow(/unlabelled/);
  });

  test("one a repeating rule uses refuses", async () => {
    const { t, householdId, grocery } = await setup();
    await asA(t).mutation(api.recurring.create, {
      householdId,
      direction: "expense",
      amount: 5_000_00,
      amountMode: "exact",
      categoryId: grocery._id,
      cadence: "monthly",
      startOn: "2026-07-10",
    });
    await asA(t).mutation(api.categories.archive, { categoryId: grocery._id });
    await expect(
      asA(t).mutation(api.categories.remove, { categoryId: grocery._id }),
    ).rejects.toThrow(/repeating rule/);
  });
});

describe("funds and loans", () => {
  test("an unused archived fund can be deleted", async () => {
    const { t, householdId } = await setup();
    const potId = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Unused",
      kind: "sinking",
      icon: "piggy",
      color: "#10B981",
    });
    await asA(t).mutation(api.pots.archive, { potId });
    await asA(t).mutation(api.pots.remove, { potId });
    expect(
      await asA(t).query(api.pots.list, { householdId, includeArchived: true }),
    ).toHaveLength(0);
  });

  test("one with money moved into it refuses", async () => {
    const { t, householdId } = await setup();
    const potId = await asA(t).mutation(api.pots.create, {
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
      potId,
      occurredOn: "2026-07-01",
    });
    await asA(t).mutation(api.pots.archive, { potId });
    await expect(
      asA(t).mutation(api.pots.remove, { potId }),
    ).rejects.toThrow(/transactions against it/);
  });

  test("a loan an asset is linked to refuses", async () => {
    const { t, householdId } = await setup();
    const potId = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Mortgage",
      kind: "debt",
      icon: "bank",
      color: "#D85A30",
      originalAmount: 1_000_000_00,
    });
    await asA(t).mutation(api.assets.create, {
      householdId,
      name: "Flat",
      value: 2_000_000_00,
      valuedOn: "2026-01-01",
      linkedDebtPotId: potId,
    });
    await asA(t).mutation(api.pots.archive, { potId });
    await expect(
      asA(t).mutation(api.pots.remove, { potId }),
    ).rejects.toThrow(/asset is still linked/);
  });
});

describe("assets", () => {
  test("an archived asset deletes; a live one does not", async () => {
    const { t, householdId } = await setup();
    const assetId = await asA(t).mutation(api.assets.create, {
      householdId,
      name: "Car",
      value: 500_000_00,
      valuedOn: "2026-01-01",
    });
    await expect(
      asA(t).mutation(api.assets.remove, { assetId }),
    ).rejects.toThrow(/Archive it first/);

    await asA(t).mutation(api.assets.archive, { assetId });
    await asA(t).mutation(api.assets.remove, { assetId });
    expect(
      await asA(t).query(api.assets.list, { householdId, includeArchived: true }),
    ).toHaveLength(0);
  });
});

describe("isolation", () => {
  test("A cannot delete B's archived things", async () => {
    const t = convexTest(schema);
    await asA(t).mutation(api.households.create, { name: "A", displayName: "A" });
    const asB = t.withIdentity({ subject: "user-b" });
    const hB = await asB.mutation(api.households.create, {
      name: "B",
      displayName: "B",
    });
    const catsB = await asB.query(api.categories.list, { householdId: hB });
    const victim = catsB[0]._id;
    await asB.mutation(api.categories.archive, { categoryId: victim });

    await expect(
      asA(t).mutation(api.categories.remove, { categoryId: victim }),
    ).rejects.toThrow(/Not a member/);
  });
});
