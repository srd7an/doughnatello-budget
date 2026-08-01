import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getCallerId, requireCallerId, requireMember } from "./lib/auth";
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
