import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

/**
 * Phase 2: household creation and invite/join by token.
 *
 * These drive the real exposed functions (not the db directly) as two distinct
 * signed-in users, "user-a" and "user-b". convex-test's withIdentity sets the
 * subject; getAuthUserId resolves it to the stored userId.
 */

const asA = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "user-a" });
const asB = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "user-b" });

describe("household creation", () => {
  test("creator becomes an admin member and sees it in listMine", async () => {
    const t = convexTest(schema);
    const householdId = await asA(t).mutation(api.households.create, {
      name: "Spanovic",
      displayName: "Srđan",
    });

    const mine = await asA(t).query(api.households.listMine, {});
    expect(mine).toHaveLength(1);
    expect(mine[0]._id).toBe(householdId);
    expect(mine[0].role).toBe("admin");
    expect(mine[0].name).toBe("Spanovic");
  });

  test("listMine returns [] for a signed-out caller (no throw)", async () => {
    const t = convexTest(schema);
    expect(await t.query(api.households.listMine, {})).toEqual([]);
  });

  test("create requires authentication", async () => {
    const t = convexTest(schema);
    await expect(
      t.mutation(api.households.create, { name: "x", displayName: "y" }),
    ).rejects.toThrow(/Not authenticated/);
  });
});

describe("invite + join by token", () => {
  async function setup() {
    const t = convexTest(schema);
    const householdId = await asA(t).mutation(api.households.create, {
      name: "Spanovic",
      displayName: "Srđan",
    });
    return { t, householdId };
  }

  test("admin mints a token; B previews then joins as a member", async () => {
    const { t, householdId } = await setup();

    const token = await asA(t).mutation(api.invites.create, { householdId });
    expect(typeof token).toBe("string");

    const preview = await asB(t).query(api.invites.preview, { token });
    expect(preview.status).toBe("valid");
    expect(preview.householdName).toBe("Spanovic");

    const joinedId = await asB(t).mutation(api.invites.accept, {
      token,
      displayName: "Partner",
    });
    expect(joinedId).toBe(householdId);

    const mineB = await asB(t).query(api.households.listMine, {});
    expect(mineB).toHaveLength(1);
    expect(mineB[0].role).toBe("member");
  });

  test("a non-admin member cannot mint invites", async () => {
    const { t, householdId } = await setup();
    const token = await asA(t).mutation(api.invites.create, { householdId });
    await asB(t).mutation(api.invites.accept, { token, displayName: "Partner" });

    // B is now a member, not an admin.
    await expect(
      asB(t).mutation(api.invites.create, { householdId }),
    ).rejects.toThrow(/admin/i);
  });

  test("a used token cannot be reused", async () => {
    const { t } = await setup();
    const householdId = (await asA(t).query(api.households.listMine, {}))[0]._id;
    const token = await asA(t).mutation(api.invites.create, { householdId });
    await asB(t).mutation(api.invites.accept, { token, displayName: "Partner" });

    await expect(
      asB(t).mutation(api.invites.accept, { token, displayName: "Partner" }),
    ).rejects.toThrow(/already used/i);
    expect((await asB(t).query(api.invites.preview, { token })).status).toBe(
      "used",
    );
  });

  test("an expired token is rejected", async () => {
    const { t, householdId } = await setup();
    const token = await asA(t).mutation(api.invites.create, {
      householdId,
      expiresInDays: -1, // already in the past
    });
    expect((await asB(t).query(api.invites.preview, { token })).status).toBe(
      "expired",
    );
    await expect(
      asB(t).mutation(api.invites.accept, { token, displayName: "Partner" }),
    ).rejects.toThrow(/expired/i);
  });

  test("an unknown token previews invalid and cannot be accepted", async () => {
    const { t } = await setup();
    expect(
      (await asB(t).query(api.invites.preview, { token: "nope" })).status,
    ).toBe("invalid");
    await expect(
      asB(t).mutation(api.invites.accept, {
        token: "nope",
        displayName: "Partner",
      }),
    ).rejects.toThrow(/not found/i);
  });

  test("accept requires authentication", async () => {
    const { t, householdId } = await setup();
    const token = await asA(t).mutation(api.invites.create, { householdId });
    await expect(
      t.mutation(api.invites.accept, { token, displayName: "x" }),
    ).rejects.toThrow(/Not authenticated/);
  });

  test("admin sees pending invites; they disappear once accepted", async () => {
    const { t, householdId } = await setup();
    const token = await asA(t).mutation(api.invites.create, { householdId });
    expect(
      await asA(t).query(api.invites.listPending, { householdId }),
    ).toHaveLength(1);

    await asB(t).mutation(api.invites.accept, { token, displayName: "Partner" });
    expect(
      await asA(t).query(api.invites.listPending, { householdId }),
    ).toHaveLength(0);
  });
});
