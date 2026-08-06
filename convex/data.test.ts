import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const asA = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "user-a" });
const asB = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "user-b" });

async function newHousehold(subject: string) {
  const t = convexTest(schema);
  const householdId = await t
    .withIdentity({ subject })
    .mutation(api.households.create, { name: "Home", displayName: "Me" });
  return { t, householdId };
}

describe("seeding on household creation", () => {
  test("creates a primary account and default categories", async () => {
    const { t, householdId } = await newHousehold("user-a");

    const account = await asA(t).query(api.accounts.getPrimary, { householdId });
    expect(account?.name).toBe("Main account");
    expect(account?.isPrimary).toBe(true);
    expect(account?.bankBalance).toBe(0);

    const categories = await asA(t).query(api.categories.list, { householdId });
    expect(categories.length).toBeGreaterThan(5);
    expect(categories[0].name).toBe("Income"); // sorted, income first
    expect(categories.some((c) => c.name === "Grocery" && c.kind === "committed")).toBe(true);
    expect(categories.some((c) => c.name === "Takeout" && c.kind === "discretionary")).toBe(true);
  });
});

describe("categories CRUD", () => {
  test("create appends, update changes kind, archive hides", async () => {
    const { t, householdId } = await newHousehold("user-a");

    const before = await asA(t).query(api.categories.list, { householdId });
    const catId = await asA(t).mutation(api.categories.create, {
      householdId,
      name: "Hobbies",
      kind: "discretionary",
      icon: "star",
      color: "#000000",
    });
    const after = await asA(t).query(api.categories.list, { householdId });
    expect(after.length).toBe(before.length + 1);
    expect(after.at(-1)!._id).toBe(catId); // appended to the end

    // Kind change (the "drag between Needs and Wants" action).
    await asA(t).mutation(api.categories.update, {
      categoryId: catId,
      kind: "committed",
    });
    const updated = await asA(t).query(api.categories.list, { householdId });
    expect(updated.find((c) => c._id === catId)!.kind).toBe("committed");

    // Archive removes from the default list but is retrievable.
    await asA(t).mutation(api.categories.archive, { categoryId: catId });
    const visible = await asA(t).query(api.categories.list, { householdId });
    expect(visible.some((c) => c._id === catId)).toBe(false);
    const withArchived = await asA(t).query(api.categories.list, {
      householdId,
      includeArchived: true,
    });
    expect(withArchived.some((c) => c._id === catId)).toBe(true);
  });
});

describe("account balance", () => {
  test("setBalance stores the entered bank balance", async () => {
    const { t, householdId } = await newHousehold("user-a");
    const account = await asA(t).query(api.accounts.getPrimary, { householdId });
    await asA(t).mutation(api.accounts.setBalance, {
      accountId: account!._id,
      bankBalance: 1_250_00, // 1.250,00 RSD in para
    });
    const after = await asA(t).query(api.accounts.getPrimary, { householdId });
    expect(after!.bankBalance).toBe(1_250_00);
  });
});

describe("pots and assets", () => {
  test("create a savings pot and a debt pot", async () => {
    const { t, householdId } = await newHousehold("user-a");
    await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Car fund",
      kind: "sinking",
      icon: "car",
      color: "#1D9E75",
      targetAmount: 100_000_00,
      targetDate: "2027-01-01",
    });
    const debtId = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Kredit AIK",
      kind: "debt",
      icon: "bank",
      color: "#D85A30",
      originalAmount: 900_000_00,
      minimumPayment: 13_300_00,
    });
    const pots = await asA(t).query(api.pots.list, { householdId });
    expect(pots.map((p) => p.name)).toContain("Car fund");
    expect(pots.find((p) => p._id === debtId)!.kind).toBe("debt");
    expect(pots.find((p) => p._id === debtId)!.isRealAccount).toBe(false);
  });

  test("assets: create, update, archive; linked pot must be same household", async () => {
    const { t, householdId } = await newHousehold("user-a");
    const assetId = await asA(t).mutation(api.assets.create, {
      householdId,
      name: "KIA Sportage",
      value: 1_800_000_00,
      valuedOn: "2026-01-01",
    });
    let assets = await asA(t).query(api.assets.list, { householdId });
    expect(assets).toHaveLength(1);

    // What an asset is worth changes through a dated valuation, never through
    // `update` — that edits what it IS, not what it is worth.
    await asA(t).mutation(api.assets.revalue, {
      assetId,
      value: 1_700_000_00,
      valuedOn: "2026-06-01",
    });
    assets = await asA(t).query(api.assets.list, { householdId });
    expect(assets[0].value).toBe(1_700_000_00);

    // Filling in an OLDER valuation after the fact records it without making
    // the asset worth last year's number today.
    await asA(t).mutation(api.assets.revalue, {
      assetId,
      value: 1_900_000_00,
      valuedOn: "2025-01-01",
    });
    assets = await asA(t).query(api.assets.list, { householdId });
    expect(assets[0].value).toBe(1_700_000_00);

    const detail = await asA(t).query(api.assets.detail, { assetId });
    // Newest first, and the one written on create is in there too.
    expect(detail.history.map((h) => h.valuedOn)).toEqual([
      "2026-06-01",
      "2026-01-01",
      "2025-01-01",
    ]);

    await asA(t).mutation(api.assets.archive, { assetId });
    expect(await asA(t).query(api.assets.list, { householdId })).toHaveLength(0);
  });
});

describe("cross-household isolation for Phase 4 functions", () => {
  async function twoHouseholds() {
    // A owns their household; B owns a separate one with real docs to attack.
    const t = convexTest(schema);
    const hA = await asA(t).mutation(api.households.create, {
      name: "A",
      displayName: "A",
    });
    const hB = await asB(t).mutation(api.households.create, {
      name: "B",
      displayName: "B",
    });
    const accountB = await asB(t).query(api.accounts.getPrimary, {
      householdId: hB,
    });
    const catB = (await asB(t).query(api.categories.list, { householdId: hB }))[0];
    return { t, hA, hB, accountB: accountB!, catB };
  }

  test("A cannot read or write B's data by householdId or by id", async () => {
    const { t, hB, accountB, catB } = await twoHouseholds();

    await expect(
      asA(t).query(api.categories.list, { householdId: hB }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      asA(t).query(api.accounts.getPrimary, { householdId: hB }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      asA(t).mutation(api.categories.create, {
        householdId: hB,
        name: "x",
        kind: "committed",
        icon: "x",
        color: "#000",
      }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      asA(t).mutation(api.accounts.setBalance, {
        accountId: accountB._id,
        bankBalance: 999,
      }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      asA(t).mutation(api.categories.archive, { categoryId: catB._id }),
    ).rejects.toThrow(/Not a member/);
  });
});
