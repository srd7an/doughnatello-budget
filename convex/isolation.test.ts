import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

/**
 * Cross-household isolation — the Phase 1 acceptance gate.
 *
 * Proves that a member of household A cannot read, write or delete anything in
 * household B, INCLUDING by passing B's document ids directly to every exposed
 * function. This is proven by test, not by inspection.
 *
 * The attacker (user A) authenticates as themselves and then aims B's real ids
 * at every function. Every attempt must throw.
 */

async function seedTwoHouseholds() {
  const t = convexTest(schema);

  const ids = await t.run(async (ctx) => {
    const now = Date.now();

    const hA = await ctx.db.insert("households", {
      name: "Household A",
      baseCurrency: "RSD",
      createdAt: now,
    });
    const hB = await ctx.db.insert("households", {
      name: "Household B",
      baseCurrency: "RSD",
      createdAt: now,
    });

    await ctx.db.insert("householdMembers", {
      householdId: hA,
      userId: "user-a",
      displayName: "A",
      role: "admin",
      joinedAt: now,
    });
    await ctx.db.insert("householdMembers", {
      householdId: hB,
      userId: "user-b",
      displayName: "B",
      role: "admin",
      joinedAt: now,
    });

    const accountB = await ctx.db.insert("accounts", {
      householdId: hB,
      name: "Main",
      bankBalance: 0,
      isPrimary: true,
      isArchived: false,
    });
    const categoryB = await ctx.db.insert("categories", {
      householdId: hB,
      name: "Groceries",
      kind: "committed",
      icon: "cart",
      color: "#534AB7",
      sortOrder: 0,
      isArchived: false,
    });
    const potB = await ctx.db.insert("pots", {
      householdId: hB,
      name: "Car fund",
      kind: "sinking",
      icon: "car",
      color: "#1D9E75",
      sortOrder: 0,
      isRealAccount: false,
      isArchived: false,
    });
    const txB = await ctx.db.insert("transactions", {
      householdId: hB,
      accountId: accountB,
      categoryId: categoryB,
      direction: "expense",
      amount: 12_345,
      occurredOn: "2026-07-01",
      paidBy: "user-b",
      createdBy: "user-b",
      createdAt: now,
    });

    return { hB, potB, txB };
  });

  // Everything below runs as user A, a member of A but a stranger to B.
  // `t` itself carries no identity — use it for the unauthenticated case.
  const asA = t.withIdentity({ subject: "user-a" });
  return { t, asA, ...ids };
}

describe("cross-household isolation", () => {
  test("A cannot READ B's household or its pots (by householdId)", async () => {
    const { asA, hB } = await seedTwoHouseholds();
    await expect(asA.query(api.households.get, { householdId: hB })).rejects.toThrow(
      /Not a member/,
    );
    await expect(asA.query(api.pots.list, { householdId: hB })).rejects.toThrow(
      /Not a member/,
    );
    await expect(
      asA.query(api.transactions.listMonth, { householdId: hB, month: "2026-07" }),
    ).rejects.toThrow(/Not a member/);
  });

  test("A cannot READ B's docs by passing B's ids directly", async () => {
    const { asA, potB, txB } = await seedTwoHouseholds();
    await expect(asA.query(api.pots.get, { potId: potB })).rejects.toThrow(
      /Not a member/,
    );
    await expect(
      asA.query(api.transactions.get, { transactionId: txB }),
    ).rejects.toThrow(/Not a member/);
  });

  test("A cannot WRITE B's docs by passing B's ids directly", async () => {
    const { asA, potB } = await seedTwoHouseholds();
    await expect(
      asA.mutation(api.pots.update, { potId: potB, name: "hacked" }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      asA.mutation(api.pots.archive, { potId: potB }),
    ).rejects.toThrow(/Not a member/);
  });

  test("A cannot DELETE B's transaction by passing B's id directly", async () => {
    const { asA, txB } = await seedTwoHouseholds();
    await expect(
      asA.mutation(api.transactions.remove, { transactionId: txB }),
    ).rejects.toThrow(/Not a member/);
  });

  test("an UNAUTHENTICATED caller is rejected everywhere", async () => {
    // Same instance, no identity attached — so the ids genuinely exist and we
    // prove the auth check (not a missing-doc error) is what rejects them.
    const { t, hB, potB } = await seedTwoHouseholds();
    await expect(t.query(api.households.get, { householdId: hB })).rejects.toThrow(
      /Not authenticated/,
    );
    await expect(t.query(api.pots.get, { potId: potB })).rejects.toThrow(
      /Not authenticated/,
    );
  });

  test("B's own member CAN reach B's data (the check is not just deny-all)", async () => {
    const t = convexTest(schema);
    const { hB, potB } = await t.run(async (ctx) => {
      const now = Date.now();
      const hB = await ctx.db.insert("households", {
        name: "B",
        baseCurrency: "RSD",
        createdAt: now,
      });
      await ctx.db.insert("householdMembers", {
        householdId: hB,
        userId: "user-b",
        displayName: "B",
        role: "admin",
        joinedAt: now,
      });
      const potB = await ctx.db.insert("pots", {
        householdId: hB,
        name: "Car fund",
        kind: "sinking",
        icon: "car",
        color: "#1D9E75",
        sortOrder: 0,
        isRealAccount: false,
        isArchived: false,
      });
      return { hB, potB };
    });

    const asB = t.withIdentity({ subject: "user-b" });
    const household = await asB.query(api.households.get, { householdId: hB });
    expect(household?.name).toBe("B");
    const pot = await asB.query(api.pots.get, { potId: potB });
    expect(pot?.name).toBe("Car fund");
  });
});
