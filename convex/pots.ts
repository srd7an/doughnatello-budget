import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireMember, requireDoc } from "./lib/auth";
import { debtOwed, potBalance } from "./lib/balances";

const potKind = v.union(
  v.literal("savings"),
  v.literal("sinking"),
  v.literal("debt"),
);

export const list = query({
  args: {
    householdId: v.id("households"),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, { householdId, includeArchived }) => {
    await requireMember(ctx, householdId);
    const all = await ctx.db
      .query("pots")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    const visible = includeArchived ? all : all.filter((p) => !p.isArchived);
    return visible.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

export const create = mutation({
  args: {
    householdId: v.id("households"),
    name: v.string(),
    kind: potKind,
    icon: v.string(),
    color: v.string(),
    targetAmount: v.optional(v.number()),
    targetDate: v.optional(v.string()),
    // Debt-only, all optional.
    interestRate: v.optional(v.number()),
    minimumPayment: v.optional(v.number()),
    originalAmount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { householdId, ...rest } = args;
    await requireMember(ctx, householdId);
    const existing = await ctx.db
      .query("pots")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    const sortOrder =
      existing.reduce((max, p) => Math.max(max, p.sortOrder), -1) + 1;
    return await ctx.db.insert("pots", {
      householdId,
      ...rest,
      sortOrder,
      isRealAccount: false, // every pot is virtual today
      isArchived: false,
    });
  },
});

export const get = query({
  args: { potId: v.id("pots") },
  handler: async (ctx, { potId }) => {
    // requireDoc resolves the pot's household and proves membership in it.
    const { doc } = await requireDoc(ctx, "pots", potId);
    return doc;
  },
});

/**
 * Each non-archived pot with its computed balance (transfers in − spent from
 * it). Used by the Add-transaction modal's "Take from" and by the Funds and
 * Loans settings panels.
 *
 * `balance` is meaningless for a debt pot — you do not "have" money in a loan —
 * so debt pots carry `owed` instead, and the two are deliberately separate
 * fields so no caller can add them together.
 */
export const balances = query({
  args: { householdId: v.id("households") },
  handler: async (ctx, { householdId }) => {
    await requireMember(ctx, householdId);
    const pots = await ctx.db
      .query("pots")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    const active = pots
      .filter((p) => !p.isArchived)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return await Promise.all(
      active.map(async (p) => ({
        _id: p._id,
        name: p.name,
        kind: p.kind,
        icon: p.icon,
        color: p.color,
        balance: await potBalance(ctx, householdId, p._id),
        owed: p.kind === "debt" ? await debtOwed(ctx, householdId, p) : null,
        targetAmount: p.targetAmount ?? null,
        targetDate: p.targetDate ?? null,
        interestRate: p.interestRate ?? null,
        minimumPayment: p.minimumPayment ?? null,
        originalAmount: p.originalAmount ?? null,
      })),
    );
  },
});

export const update = mutation({
  args: {
    potId: v.id("pots"),
    name: v.optional(v.string()),
    kind: v.optional(potKind),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    targetAmount: v.optional(v.number()),
    targetDate: v.optional(v.string()),
    interestRate: v.optional(v.number()),
    minimumPayment: v.optional(v.number()),
    originalAmount: v.optional(v.number()),
  },
  handler: async (ctx, { potId, ...patch }) => {
    await requireDoc(ctx, "pots", potId);
    // Drop undefined keys so we only patch what was provided.
    const fields = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    await ctx.db.patch(potId, fields);
  },
});

// Archive, never delete: a pot with transactions must keep its history.
export const archive = mutation({
  args: { potId: v.id("pots") },
  handler: async (ctx, { potId }) => {
    await requireDoc(ctx, "pots", potId);
    await ctx.db.patch(potId, { isArchived: true });
  },
});
