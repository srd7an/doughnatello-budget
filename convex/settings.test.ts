import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

/**
 * Phase 10: the administrative surface behind Settings — household details,
 * members, invite withdrawal and export.
 *
 * The interesting cases are all refusals: the ones that stop a household from
 * being locked out of its own administration, and the ones that stop a
 * non-admin from doing an admin's job.
 */

const asA = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "user-a" });
const asB = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "user-b" });

/** A household with A as admin and B as an ordinary member. */
async function twoMembers() {
  const t = convexTest(schema);
  const householdId = await asA(t).mutation(api.households.create, {
    name: "Spanovic",
    displayName: "A",
  });
  const token = await asA(t).mutation(api.invites.create, { householdId });
  await asB(t).mutation(api.invites.accept, { token, displayName: "B" });

  const members = await asA(t).query(api.households.members, { householdId });
  const b = members.find((m) => m.displayName === "B")!;
  const a = members.find((m) => m.displayName === "A")!;
  return { t, householdId, aId: a.userId, bId: b.userId };
}

describe("household details", () => {
  test("an admin renames the household and sets the currency", async () => {
    const { t, householdId } = await twoMembers();
    await asA(t).mutation(api.households.update, {
      householdId,
      name: "  Home  ",
      baseCurrency: "eur",
    });
    const h = await asA(t).query(api.households.get, { householdId });
    expect(h!.name).toBe("Home"); // trimmed
    expect(h!.baseCurrency).toBe("EUR"); // normalised
  });

  test("a plain member cannot", async () => {
    const { t, householdId } = await twoMembers();
    await expect(
      asB(t).mutation(api.households.update, { householdId, name: "Mine now" }),
    ).rejects.toThrow(/admin/i);
  });

  test("an empty name or a non-currency is refused", async () => {
    const { t, householdId } = await twoMembers();
    await expect(
      asA(t).mutation(api.households.update, { householdId, name: "   " }),
    ).rejects.toThrow(/needs a name/);
    await expect(
      asA(t).mutation(api.households.update, {
        householdId,
        baseCurrency: "dinar",
      }),
    ).rejects.toThrow(/three-letter/);
  });

  test("changing currency relabels and never converts stored amounts", async () => {
    const { t, householdId } = await twoMembers();
    const cats = await asA(t).query(api.categories.list, { householdId });
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "income",
      amount: 300_000_00,
      categoryId: cats.find((c) => c.kind === "income")!._id,
      occurredOn: "2026-07-01",
    });
    await asA(t).mutation(api.households.update, {
      householdId,
      baseCurrency: "EUR",
    });
    const summary = await asA(t).query(api.overview.month, {
      householdId,
      month: "2026-07",
    });
    expect(summary.income).toBe(300_000_00);
  });
});

describe("members", () => {
  test("anyone may rename themselves", async () => {
    const { t, householdId, bId } = await twoMembers();
    await asB(t).mutation(api.households.updateMember, {
      householdId,
      userId: bId,
      displayName: "Bojana",
    });
    const members = await asA(t).query(api.households.members, { householdId });
    expect(members.find((m) => m.userId === bId)!.displayName).toBe("Bojana");
  });

  test("a member may not rename someone else, nor promote themselves", async () => {
    const { t, householdId, aId, bId } = await twoMembers();
    await expect(
      asB(t).mutation(api.households.updateMember, {
        householdId,
        userId: aId,
        displayName: "Nobody",
      }),
    ).rejects.toThrow(/admin/i);
    await expect(
      asB(t).mutation(api.households.updateMember, {
        householdId,
        userId: bId,
        role: "admin",
      }),
    ).rejects.toThrow(/admin/i);
  });

  test("an admin promotes a member", async () => {
    const { t, householdId, bId } = await twoMembers();
    await asA(t).mutation(api.households.updateMember, {
      householdId,
      userId: bId,
      role: "admin",
    });
    const members = await asA(t).query(api.households.members, { householdId });
    expect(members.find((m) => m.userId === bId)!.role).toBe("admin");
  });

  test("the last admin can neither be demoted nor removed", async () => {
    const { t, householdId, aId } = await twoMembers();
    await expect(
      asA(t).mutation(api.households.updateMember, {
        householdId,
        userId: aId,
        role: "member",
      }),
    ).rejects.toThrow(/last admin/);
    await expect(
      asA(t).mutation(api.households.removeMember, { householdId, userId: aId }),
    ).rejects.toThrow(/last admin/);
  });

  test("with a second admin, the first may step down", async () => {
    const { t, householdId, aId, bId } = await twoMembers();
    await asA(t).mutation(api.households.updateMember, {
      householdId,
      userId: bId,
      role: "admin",
    });
    await asA(t).mutation(api.households.updateMember, {
      householdId,
      userId: aId,
      role: "member",
    });
    const members = await asA(t).query(api.households.members, { householdId });
    expect(members.find((m) => m.userId === aId)!.role).toBe("member");
  });

  test("removing a member keeps the money they entered", async () => {
    const { t, householdId, bId } = await twoMembers();
    const cats = await asB(t).query(api.categories.list, { householdId });
    await asB(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 1_500_00,
      categoryId: cats.find((c) => c.kind !== "income")!._id,
      occurredOn: "2026-07-03",
    });

    await asA(t).mutation(api.households.removeMember, { householdId, userId: bId });

    // B is out...
    expect(await asB(t).query(api.households.listMine, {})).toEqual([]);
    await expect(
      asB(t).query(api.overview.month, { householdId, month: "2026-07" }),
    ).rejects.toThrow(/Not a member/);
    // ...but the household's figures are unchanged.
    const summary = await asA(t).query(api.overview.month, {
      householdId,
      month: "2026-07",
    });
    expect(summary.expense).toBe(1_500_00);
  });

  test("a member cannot remove anyone", async () => {
    const { t, householdId, aId } = await twoMembers();
    await expect(
      asB(t).mutation(api.households.removeMember, { householdId, userId: aId }),
    ).rejects.toThrow(/admin/i);
  });
});

describe("invites", () => {
  test("an admin revokes a pending invite and the link stops working", async () => {
    const t = convexTest(schema);
    const householdId = await asA(t).mutation(api.households.create, {
      name: "Home",
      displayName: "A",
    });
    const token = await asA(t).mutation(api.invites.create, { householdId });
    const [pending] = await asA(t).query(api.invites.listPending, { householdId });

    await asA(t).mutation(api.invites.revoke, { inviteId: pending._id });

    expect(await asA(t).query(api.invites.listPending, { householdId })).toEqual([]);
    await expect(
      asB(t).mutation(api.invites.accept, { token, displayName: "B" }),
    ).rejects.toThrow();
  });

  test("an accepted invite cannot be revoked", async () => {
    const t = convexTest(schema);
    const householdId = await asA(t).mutation(api.households.create, {
      name: "Home",
      displayName: "A",
    });
    const token = await asA(t).mutation(api.invites.create, { householdId });
    const [pending] = await asA(t).query(api.invites.listPending, { householdId });
    await asB(t).mutation(api.invites.accept, { token, displayName: "B" });

    await expect(
      asA(t).mutation(api.invites.revoke, { inviteId: pending._id }),
    ).rejects.toThrow(/already been used/);
  });

  test("a member cannot revoke", async () => {
    const { t, householdId } = await twoMembers();
    await asA(t).mutation(api.invites.create, { householdId });
    const [pending] = await asA(t).query(api.invites.listPending, { householdId });
    await expect(
      asB(t).mutation(api.invites.revoke, { inviteId: pending._id }),
    ).rejects.toThrow(/admin/i);
  });
});

describe("export", () => {
  test("every transaction comes out with names resolved and para intact", async () => {
    const { t, householdId } = await twoMembers();
    const cats = await asA(t).query(api.categories.list, { householdId });
    const grocery = cats.find((c) => c.name === "Grocery")!;
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
      amount: 20_000_00,
      potId: pot,
      occurredOn: "2026-07-01",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 3_000_00,
      categoryId: grocery._id,
      takeFromPotId: pot,
      occurredOn: "2026-07-05",
      payee: "Idea",
    });

    const rows = await asA(t).query(api.exports.transactions, { householdId });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: "2026-07-01",
      direction: "transfer",
      amount: 20_000_00,
      fund: "Car fund",
      paidBy: "A",
    });
    expect(rows[1]).toMatchObject({
      date: "2026-07-05",
      direction: "expense",
      amount: 3_000_00,
      category: "Grocery",
      fundedFrom: "Car fund", // the fact that makes the row interpretable
      payee: "Idea",
    });
  });
});

describe("cross-household isolation for settings functions", () => {
  test("A cannot administer B's household", async () => {
    const t = convexTest(schema);
    await asA(t).mutation(api.households.create, { name: "A", displayName: "A" });
    const hB = await asB(t).mutation(api.households.create, {
      name: "B",
      displayName: "B",
    });
    const membersB = await asB(t).query(api.households.members, { householdId: hB });
    const bId = membersB[0].userId;
    await asB(t).mutation(api.invites.create, { householdId: hB });
    const [inviteB] = await asB(t).query(api.invites.listPending, {
      householdId: hB,
    });

    const a = asA(t);
    await expect(
      a.mutation(api.households.update, { householdId: hB, name: "hacked" }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      a.mutation(api.households.updateMember, {
        householdId: hB,
        userId: bId,
        displayName: "hacked",
      }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      a.mutation(api.households.removeMember, { householdId: hB, userId: bId }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      a.mutation(api.invites.revoke, { inviteId: inviteB._id }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      a.query(api.exports.transactions, { householdId: hB }),
    ).rejects.toThrow(/Not a member/);
  });
});
