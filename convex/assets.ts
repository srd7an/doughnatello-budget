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
    icon: v.optional(v.string()),
    valuedOn: v.string(), // YYYY-MM-DD
    linkedDebtPotId: v.optional(v.id("pots")),
  },
  handler: async (ctx, args) => {
    const { householdId, ...rest } = args;
    const { userId } = await requireMember(ctx, householdId);
    // If a debt pot is linked, it must belong to the same household.
    if (rest.linkedDebtPotId) {
      const pot = await ctx.db.get(rest.linkedDebtPotId);
      if (!pot || pot.householdId !== householdId) {
        throw new Error("Linked pot not found");
      }
    }
    const assetId = await ctx.db.insert("assets", {
      householdId,
      ...rest,
      isArchived: false,
    });
    // What it was worth when you first wrote it down is the first entry in its
    // history, not a special case outside it.
    await ctx.db.insert("assetValuations", {
      householdId,
      assetId,
      value: rest.value,
      valuedOn: rest.valuedOn,
      createdAt: Date.now(),
      createdBy: userId,
    });
    return assetId;
  },
});

/**
 * Re-value an asset: what it is worth now, and as of when.
 *
 * This is the only way its value changes, which is the point — `update` edits
 * what an asset IS (its name, its icon, the loan that bought it), and what it
 * is WORTH is a series of dated observations instead. Otherwise a flat that
 * doubled would leave no trace of having done so, and the year could never say
 * anything about it.
 *
 * A back-dated entry is allowed and does not touch the current figure: filling
 * in last year's valuation after the fact must not make the asset worth last
 * year's number today.
 */
export const revalue = mutation({
  args: {
    assetId: v.id("assets"),
    value: v.number(), // para
    valuedOn: v.string(), // YYYY-MM-DD
    note: v.optional(v.string()),
  },
  handler: async (ctx, { assetId, value, valuedOn, note }) => {
    const { doc, userId } = await requireDoc(ctx, "assets", assetId);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error("A value must be a whole number of para, and not negative");
    }
    await ctx.db.insert("assetValuations", {
      householdId: doc.householdId,
      assetId,
      value,
      valuedOn,
      note,
      createdAt: Date.now(),
      createdBy: userId,
    });
    if (valuedOn >= doc.valuedOn) {
      await ctx.db.patch(assetId, { value, valuedOn });
    }
  },
});

/** One asset with its whole history, newest first. */
export const detail = query({
  args: { assetId: v.id("assets") },
  handler: async (ctx, { assetId }) => {
    const { doc } = await requireDoc(ctx, "assets", assetId);
    const history = await ctx.db
      .query("assetValuations")
      .withIndex("by_asset", (q) => q.eq("assetId", assetId))
      .collect();
    const linked = doc.linkedDebtPotId
      ? await ctx.db.get(doc.linkedDebtPotId)
      : null;
    return {
      _id: doc._id,
      name: doc.name,
      icon: doc.icon ?? "money",
      value: doc.value,
      valuedOn: doc.valuedOn,
      isArchived: doc.isArchived,
      linkedDebt: linked ? { _id: linked._id, name: linked.name } : null,
      history: history
        .sort((a, b) => (a.valuedOn < b.valuedOn ? 1 : -1))
        .map((h) => ({
          _id: h._id,
          value: h.value,
          valuedOn: h.valuedOn,
          note: h.note ?? null,
        })),
    };
  },
});

export const update = mutation({
  args: {
    assetId: v.id("assets"),
    name: v.optional(v.string()),
    icon: v.optional(v.string()),
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
