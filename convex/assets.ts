import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireMember, requireDoc } from "./lib/auth";

/**
 * Assets are NOT funds. A car is not in the bank and cannot be spent from — an
 * asset only ever touches net worth, never left-to-spend / set-aside / free.
 * `valuedOn` exists because a value set once silently inflates net worth
 * forever; the UI surfaces the date and prompts an annual re-value.
 */

export const list = query({
  args: {
    householdId: v.id("households"),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, { householdId, includeArchived }) => {
    await requireMember(ctx, householdId);
    const all = await ctx.db
      .query("assets")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    return includeArchived ? all : all.filter((a) => !a.isArchived);
  },
});

export const create = mutation({
  args: {
    householdId: v.id("households"),
    name: v.string(),
    value: v.number(),
    valuedOn: v.string(), // YYYY-MM-DD
    linkedDebtPotId: v.optional(v.id("pots")),
  },
  handler: async (ctx, args) => {
    const { householdId, ...rest } = args;
    await requireMember(ctx, householdId);
    // If a debt pot is linked, it must belong to the same household.
    if (rest.linkedDebtPotId) {
      const pot = await ctx.db.get(rest.linkedDebtPotId);
      if (!pot || pot.householdId !== householdId) {
        throw new Error("Linked pot not found");
      }
    }
    return await ctx.db.insert("assets", {
      householdId,
      ...rest,
      isArchived: false,
    });
  },
});

export const update = mutation({
  args: {
    assetId: v.id("assets"),
    name: v.optional(v.string()),
    value: v.optional(v.number()),
    valuedOn: v.optional(v.string()),
    linkedDebtPotId: v.optional(v.id("pots")),
  },
  handler: async (ctx, { assetId, ...patch }) => {
    const { doc } = await requireDoc(ctx, "assets", assetId);
    if (patch.linkedDebtPotId) {
      const pot = await ctx.db.get(patch.linkedDebtPotId);
      if (!pot || pot.householdId !== doc.householdId) {
        throw new Error("Linked pot not found");
      }
    }
    const fields = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    await ctx.db.patch(assetId, fields);
  },
});

export const archive = mutation({
  args: { assetId: v.id("assets") },
  handler: async (ctx, { assetId }) => {
    await requireDoc(ctx, "assets", assetId);
    await ctx.db.patch(assetId, { isArchived: true });
  },
});

/** Delete an archived asset. Nothing references an asset, so this is always safe. */
export const remove = mutation({
  args: { assetId: v.id("assets") },
  handler: async (ctx, { assetId }) => {
    const { doc } = await requireDoc(ctx, "assets", assetId);
    if (!doc.isArchived) {
      throw new Error("Archive it first — deleting is for things you are done with");
    }
    await ctx.db.delete(assetId);
  },
});

export const unarchive = mutation({
  args: { assetId: v.id("assets") },
  handler: async (ctx, { assetId }) => {
    await requireDoc(ctx, "assets", assetId);
    await ctx.db.patch(assetId, { isArchived: false });
  },
});
