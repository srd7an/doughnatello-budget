import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireMember, requireDoc } from "./lib/auth";

const categoryKind = v.union(
  v.literal("income"),
  v.literal("committed"),
  v.literal("discretionary"),
);

export const list = query({
  args: {
    householdId: v.id("households"),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, { householdId, includeArchived }) => {
    await requireMember(ctx, householdId);
    const all = await ctx.db
      .query("categories")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    const visible = includeArchived ? all : all.filter((c) => !c.isArchived);
    return visible.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

export const create = mutation({
  args: {
    householdId: v.id("households"),
    name: v.string(),
    kind: categoryKind,
    icon: v.string(),
    color: v.string(),
  },
  handler: async (ctx, { householdId, name, kind, icon, color }) => {
    await requireMember(ctx, householdId);
    // New categories sort to the end.
    const existing = await ctx.db
      .query("categories")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    const sortOrder =
      existing.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1;
    return await ctx.db.insert("categories", {
      householdId,
      name,
      kind,
      icon,
      color,
      sortOrder,
      isArchived: false,
    });
  },
});

export const update = mutation({
  args: {
    categoryId: v.id("categories"),
    name: v.optional(v.string()),
    // Kind changes via dragging between Needs/Wants groups in the UI.
    kind: v.optional(categoryKind),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, { categoryId, ...patch }) => {
    await requireDoc(ctx, "categories", categoryId);
    const fields = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    await ctx.db.patch(categoryId, fields);
  },
});

// Archive, never delete — a category with transactions must keep its history,
// or every past month's totals silently change.
export const archive = mutation({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, { categoryId }) => {
    await requireDoc(ctx, "categories", categoryId);
    await ctx.db.patch(categoryId, { isArchived: true });
  },
});

export const unarchive = mutation({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, { categoryId }) => {
    await requireDoc(ctx, "categories", categoryId);
    await ctx.db.patch(categoryId, { isArchived: false });
  },
});

/**
 * Delete an archived category for good.
 *
 * Archiving exists because a category's name is stamped on every transaction in
 * it — so this refuses while anything still points here. That keeps the rule
 * ("history is never silently rewritten") while unblocking the case it was
 * never meant to catch: a category created by mistake and never used.
 */
export const remove = mutation({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, { categoryId }) => {
    const { doc } = await requireDoc(ctx, "categories", categoryId);
    if (!doc.isArchived) {
      throw new Error("Archive it first — deleting is for things you are done with");
    }

    const used = await ctx.db
      .query("transactions")
      .withIndex("by_household_category", (q) =>
        q.eq("householdId", doc.householdId).eq("categoryId", categoryId),
      )
      .first();
    if (used) {
      throw new Error(
        "This category has transactions. Deleting it would leave them unlabelled.",
      );
    }

    const rules = await ctx.db
      .query("recurringRules")
      .withIndex("by_household", (q) => q.eq("householdId", doc.householdId))
      .collect();
    if (rules.some((r) => r.categoryId === categoryId)) {
      throw new Error("A repeating rule still uses this category.");
    }

    await ctx.db.delete(categoryId);
  },
});
