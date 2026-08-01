import { query, mutation, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  getCallerId,
  requireAdmin,
  requireCallerId,
  requireMember,
} from "./lib/auth";
import { seedHousehold } from "./lib/seed";

/**
 * Read a household the caller belongs to. Membership is proven first; the
 * client-supplied householdId only selects, it does not authorise.
 */
export const get = query({
  args: { householdId: v.id("households") },
  handler: async (ctx, { householdId }) => {
    await requireMember(ctx, householdId);
    return await ctx.db.get(householdId);
  },
});

/**
 * Every household the caller belongs to, with their role and display name.
 * The frontend uses this to decide onboarding vs. app. Returns [] when signed
 * out rather than throwing, so it is safe to call before auth resolves.
 *
 * Seeding default categories/account/pots on creation is Phase 4 — this just
 * makes the household and the creator's admin membership.
 */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getCallerId(ctx);
    if (!userId) return [];
    const memberships = await ctx.db
      .query("householdMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const results = await Promise.all(
      memberships.map(async (m) => {
        const household = await ctx.db.get(m.householdId);
        return household
          ? {
              _id: household._id,
              name: household.name,
              baseCurrency: household.baseCurrency,
              role: m.role,
              displayName: m.displayName,
            }
          : null;
      }),
    );
    return results.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

/** Members of a household (for avatars and the paidBy picker). */
export const members = query({
  args: { householdId: v.id("households") },
  handler: async (ctx, { householdId }) => {
    await requireMember(ctx, householdId);
    const members = await ctx.db
      .query("householdMembers")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    return members.map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      role: m.role,
    }));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    displayName: v.string(),
    baseCurrency: v.optional(v.string()),
  },
  handler: async (ctx, { name, displayName, baseCurrency }) => {
    const userId = await requireCallerId(ctx);
    const now = Date.now();
    const householdId = await ctx.db.insert("households", {
      name,
      baseCurrency: baseCurrency ?? "RSD",
      createdAt: now,
    });
    // The creator is the first member and an admin.
    await ctx.db.insert("householdMembers", {
      householdId,
      userId,
      displayName,
      role: "admin",
      joinedAt: now,
    });
    // Land on a usable app: primary account + default categories.
    await seedHousehold(ctx, householdId);
    return householdId;
  },
});

/**
 * Rename the household or change its base currency. Admin-only: it is shared
 * furniture, not a personal preference.
 *
 * Changing the currency relabels; it NEVER converts. Stored amounts are para in
 * whatever currency they were entered — there is no exchange rate anywhere in
 * this app, and pretending otherwise would silently rewrite history.
 */
export const update = mutation({
  args: {
    householdId: v.id("households"),
    name: v.optional(v.string()),
    baseCurrency: v.optional(v.string()),
  },
  handler: async (ctx, { householdId, name, baseCurrency }) => {
    await requireAdmin(ctx, householdId);
    const fields: Record<string, string> = {};
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("A household needs a name");
      fields.name = trimmed;
    }
    if (baseCurrency !== undefined) {
      const trimmed = baseCurrency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(trimmed)) {
        throw new Error("Currency must be a three-letter code");
      }
      fields.baseCurrency = trimmed;
    }
    if (Object.keys(fields).length > 0) await ctx.db.patch(householdId, fields);
  },
});

/**
 * Change a member's display name or role.
 *
 * Anyone may rename themselves. Only an admin may touch someone else, or change
 * any role at all. The last admin cannot be demoted — a household with no admin
 * can never be administered again.
 */
export const updateMember = mutation({
  args: {
    householdId: v.id("households"),
    userId: v.string(),
    displayName: v.optional(v.string()),
    role: v.optional(v.union(v.literal("admin"), v.literal("member"))),
  },
  handler: async (ctx, { householdId, userId, displayName, role }) => {
    const caller = await requireMember(ctx, householdId);
    const isSelf = caller.userId === userId;
    if ((!isSelf || role !== undefined) && caller.membership.role !== "admin") {
      throw new Error("Requires admin");
    }

    const target = await ctx.db
      .query("householdMembers")
      .withIndex("by_household_user", (q) =>
        q.eq("householdId", householdId).eq("userId", userId),
      )
      .unique();
    if (!target) throw new Error("Not a member");

    const fields: Record<string, string> = {};
    if (displayName !== undefined) {
      const trimmed = displayName.trim();
      if (!trimmed) throw new Error("A name is required");
      fields.displayName = trimmed;
    }
    if (role !== undefined && role !== target.role) {
      if (target.role === "admin" && (await adminCount(ctx, householdId)) === 1) {
        throw new Error("The last admin cannot be demoted");
      }
      fields.role = role;
    }
    if (Object.keys(fields).length > 0) await ctx.db.patch(target._id, fields);
  },
});

/**
 * Remove someone from the household. Admin-only, and the last admin cannot be
 * removed for the same reason they cannot be demoted.
 *
 * Their transactions stay: the money happened, and deleting it would silently
 * change everyone's totals. The rows keep pointing at a userId that is no
 * longer a member, which the UI renders as "?".
 */
export const removeMember = mutation({
  args: { householdId: v.id("households"), userId: v.string() },
  handler: async (ctx, { householdId, userId }) => {
    await requireAdmin(ctx, householdId);
    const target = await ctx.db
      .query("householdMembers")
      .withIndex("by_household_user", (q) =>
        q.eq("householdId", householdId).eq("userId", userId),
      )
      .unique();
    if (!target) throw new Error("Not a member");
    if (target.role === "admin" && (await adminCount(ctx, householdId)) === 1) {
      throw new Error("The last admin cannot be removed");
    }
    await ctx.db.delete(target._id);
  },
});

/** How many admins the household has — the guard against locking it out. */
async function adminCount(
  ctx: QueryCtx,
  householdId: Id<"households">,
): Promise<number> {
  const members = await ctx.db
    .query("householdMembers")
    .withIndex("by_household", (q) => q.eq("householdId", householdId))
    .collect();
  return members.filter((m) => m.role === "admin").length;
}
