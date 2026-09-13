import { query, mutation, MutationCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireMember, requireDoc } from "./lib/auth";
import { setTransactionTags } from "./lib/tags";
import { enrichRows } from "./transactions";

/**
 * Tags — the one way to group transactions by something the app has no column
 * for: a holiday, a wedding, a renovation, a car you were buying.
 *
 * A tag counts nothing. It does not appear in left-to-spend, in a fund's
 * balance, or in net worth, and a transaction wearing one is funded exactly as
 * it was before. That is the whole point: the rows already counted where they
 * counted, and a tag only lets you read them back together.
 *
 * Every direction can be tagged, deliberately. A holiday is not only spending:
 * the money moved into the fund for it, and the refund from the airline, belong
 * to the same story, and the tag's page reports the three separately rather
 * than adding them into one meaningless figure.
 */

const MAX_NAME = 60;

/** Same palette as the settings pickers, so a tag looks like everything else. */
const PALETTE = [
  "#E11D48",
  "#A855F7",
  "#3B82F6",
  "#14B8A6",
  "#22C55E",
  "#EAB308",
  "#F97316",
  "#78716C",
];

/**
 * The form a name is COMPARED in — never the form it is stored in.
 *
 * "Grčka 2026" typed twice is one tag, whichever way the case fell, or the
 * point of tagging is lost the moment there are two of them holding half the
 * holiday each.
 */
const key = (name: string) => name.trim().toLocaleLowerCase();

async function assertNameFree(
  ctx: MutationCtx,
  householdId: Id<"households">,
  name: string,
  except?: Id<"tags">,
) {
  const all = await ctx.db
    .query("tags")
    .withIndex("by_household", (q) => q.eq("householdId", householdId))
    .collect();
  const clash = all.find((t) => t._id !== except && key(t.name) === key(name));
  if (clash) {
    throw new ConvexError(
      clash.isArchived
        ? `"${clash.name}" already exists, archived — bring it back instead`
        : `"${clash.name}" already exists`,
    );
  }
}

/**
 * Every tag, with how many transactions wear it.
 *
 * Ordered by use, then by name: the picker is opened while entering the fourth
 * dinner of the same holiday, so the tag you are in the middle of using has to
 * be at the top. One collect of the join table answers it for the whole list —
 * the per-tag alternative is a query each, for a number shown next to a name.
 */
export const list = query({
  args: {
    householdId: v.id("households"),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, { householdId, includeArchived }) => {
    await requireMember(ctx, householdId);
    const [tags, links] = await Promise.all([
      ctx.db
        .query("tags")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("transactionTags")
        .withIndex("by_household_tag", (q) => q.eq("householdId", householdId))
        .collect(),
    ]);

    const counts = new Map<Id<"tags">, number>();
    for (const l of links) counts.set(l.tagId, (counts.get(l.tagId) ?? 0) + 1);

    return tags
      .filter((t) => includeArchived || !t.isArchived)
      .map((t) => ({
        _id: t._id,
        name: t.name,
        color: t.color,
        icon: t.icon,
        isArchived: t.isArchived,
        count: counts.get(t._id) ?? 0,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: {
    householdId: v.id("households"),
    name: v.string(),
    // Both optional so a tag can be made from inside the transaction form,
    // where the only thing you have decided is what to call it.
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
  },
  handler: async (ctx, { householdId, name, color, icon }) => {
    await requireMember(ctx, householdId);
    const trimmed = name.trim().slice(0, MAX_NAME);
    if (!trimmed) throw new ConvexError("A tag needs a name");
    await assertNameFree(ctx, householdId, trimmed);

    // Walk the palette rather than always opening on rose, so tags made in a
    // row are told apart at a glance without anyone choosing a colour.
    const existing = await ctx.db
      .query("tags")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();

    return await ctx.db.insert("tags", {
      householdId,
      name: trimmed,
      color: color ?? PALETTE[existing.length % PALETTE.length],
      icon: icon ?? "tag",
      createdAt: Date.now(),
      isArchived: false,
    });
  },
});

export const update = mutation({
  args: {
    tagId: v.id("tags"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
  },
  handler: async (ctx, { tagId, name, color, icon }) => {
    const { doc } = await requireDoc(ctx, "tags", tagId);
    const fields: Record<string, string> = {};
    if (name !== undefined) {
      const trimmed = name.trim().slice(0, MAX_NAME);
      if (!trimmed) throw new ConvexError("A tag needs a name");
      await assertNameFree(ctx, doc.householdId, trimmed, tagId);
      fields.name = trimmed;
    }
    if (color !== undefined) fields.color = color;
    if (icon !== undefined) fields.icon = icon;
    if (Object.keys(fields).length > 0) await ctx.db.patch(tagId, fields);
  },
});

/**
 * Archiving hides a tag from the pickers and leaves every row wearing it.
 *
 * The same word as everywhere else in the app, and for a softer reason: a
 * category's name is stamped on history and deleting one rewrites totals, while
 * a finished holiday changes nothing at all. It is archived because a picker
 * offering every trip you have ever taken is a picker nobody can use.
 */
export const archive = mutation({
  args: { tagId: v.id("tags") },
  handler: async (ctx, { tagId }) => {
    await requireDoc(ctx, "tags", tagId);
    await ctx.db.patch(tagId, { isArchived: true });
  },
});

export const unarchive = mutation({
  args: { tagId: v.id("tags") },
  handler: async (ctx, { tagId }) => {
    await requireDoc(ctx, "tags", tagId);
    await ctx.db.patch(tagId, { isArchived: false });
  },
});

/**
 * Delete a tag for good, labels and all.
 *
 * Unlike a category, this is allowed while transactions still wear it — and it
 * takes their labels with it. A tag holds no money: nothing about those rows
 * changes except that they stop being gathered under this name, so refusing
 * would protect a grouping nobody wants any more at the cost of leaving it
 * undeletable forever. Archive first, so it is never one stray tap.
 */
export const remove = mutation({
  args: { tagId: v.id("tags") },
  handler: async (ctx, { tagId }) => {
    const { doc } = await requireDoc(ctx, "tags", tagId);
    if (!doc.isArchived) {
      throw new ConvexError(
        "Archive it first — deleting is for things you are done with",
      );
    }
    const links = await ctx.db
      .query("transactionTags")
      .withIndex("by_household_tag", (q) =>
        q.eq("householdId", doc.householdId).eq("tagId", tagId),
      )
      .collect();
    for (const l of links) await ctx.db.delete(l._id);
    await ctx.db.delete(tagId);
  },
});

/** The tags one transaction wears, as ids — what the form loads into itself. */
export const forTransaction = query({
  args: { transactionId: v.id("transactions") },
  handler: async (ctx, { transactionId }) => {
    await requireDoc(ctx, "transactions", transactionId);
    const rows = await ctx.db
      .query("transactionTags")
      .withIndex("by_transaction", (q) => q.eq("transactionId", transactionId))
      .collect();
    return rows.map((r) => r.tagId);
  },
});

/** Replace one transaction's tags. The form's own save goes through here. */
export const setForTransaction = mutation({
  args: {
    transactionId: v.id("transactions"),
    tagIds: v.array(v.id("tags")),
  },
  handler: async (ctx, { transactionId, tagIds }) => {
    const { doc } = await requireDoc(ctx, "transactions", transactionId);
    await setTransactionTags(ctx, doc.householdId, transactionId, tagIds);
  },
});

/**
 * Put one tag on many transactions at once — or take it off them.
 *
 * This is how a holiday that already happened gets labelled: the rows are in
 * the list in front of you, and opening forty of them one at a time is not a
 * feature, it is a punishment. Each id is resolved through requireDoc, so a
 * batch can no more cross households than a single edit can.
 *
 * Idempotent in both directions: tagging something already tagged writes
 * nothing, untagging something untagged deletes nothing.
 */
export const applyToMany = mutation({
  args: {
    tagId: v.id("tags"),
    transactionIds: v.array(v.id("transactions")),
    /** false takes the tag off instead of putting it on. */
    on: v.boolean(),
  },
  handler: async (ctx, { tagId, transactionIds, on }) => {
    const { doc: tag } = await requireDoc(ctx, "tags", tagId);
    let changed = 0;

    for (const transactionId of transactionIds) {
      const { doc: tx } = await requireDoc(ctx, "transactions", transactionId);
      // Both ids are the caller's, and each was checked against the household
      // it named. This is the check that they named the SAME one.
      if (tx.householdId !== tag.householdId) {
        throw new ConvexError("Not found");
      }

      const existing = await ctx.db
        .query("transactionTags")
        .withIndex("by_transaction", (q) =>
          q.eq("transactionId", transactionId),
        )
        .collect();
      const already = existing.find((r) => r.tagId === tagId);

      if (on && !already) {
        await ctx.db.insert("transactionTags", {
          householdId: tag.householdId,
          transactionId,
          tagId,
        });
        changed += 1;
      } else if (!on && already) {
        await ctx.db.delete(already._id);
        changed += 1;
      }
    }

    return { changed };
  },
});

/**
 * One tag, in full: what it gathered, and every row it gathered.
 *
 * Not period-scoped, for the same reason a fund's page is not — a holiday
 * booked in March and eaten in July is one thing, and a page that showed you
 * July's third of it would be answering a question nobody asked.
 *
 * The three totals are kept APART rather than netted. Spending, money coming
 * back, and money set aside for it are different facts, and a single figure
 * made of all three would be a number with no name.
 */
export const detail = query({
  args: { tagId: v.id("tags") },
  handler: async (ctx, { tagId }) => {
    const { doc } = await requireDoc(ctx, "tags", tagId);
    const householdId = doc.householdId;

    const links = await ctx.db
      .query("transactionTags")
      .withIndex("by_household_tag", (q) =>
        q.eq("householdId", householdId).eq("tagId", tagId),
      )
      .collect();

    const txs = (
      await Promise.all(links.map((l) => ctx.db.get(l.transactionId)))
    ).flatMap((t) => (t && t.householdId === householdId ? [t] : []));

    const spent = txs
      .filter((t) => t.direction === "expense")
      .reduce((sum, t) => sum + t.amount, 0);
    const received = txs
      .filter((t) => t.direction === "income")
      .reduce((sum, t) => sum + t.amount, 0);
    const setAside = txs
      .filter((t) => t.direction === "transfer")
      .reduce((sum, t) => sum + t.amount, 0);

    // What the money went ON, which is the question a holiday's page is opened
    // with. Categories keep their own meaning here — the tag is a second axis
    // across them, never a replacement for them.
    const categories = await ctx.db
      .query("categories")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    const catById = new Map(categories.map((c) => [c._id, c]));
    const totals = new Map<string, number>();
    for (const t of txs) {
      if (t.direction !== "expense") continue;
      const id = t.categoryId ?? "none";
      totals.set(id, (totals.get(id) ?? 0) + t.amount);
    }
    const byCategory = [...totals.entries()]
      .map(([id, total]) => {
        const cat =
          id === "none" ? undefined : catById.get(id as Id<"categories">);
        return {
          categoryId: id,
          name: cat?.name ?? "Uncategorised",
          icon: cat?.icon ?? "star",
          color: cat?.color ?? "#a8a29e",
          total,
        };
      })
      .sort((a, b) => b.total - a.total);

    const dates = txs.map((t) => t.occurredOn).sort();

    return {
      _id: doc._id,
      name: doc.name,
      color: doc.color,
      icon: doc.icon,
      isArchived: doc.isArchived,
      spent,
      received,
      setAside,
      count: txs.length,
      firstOn: dates[0] ?? null,
      lastOn: dates.at(-1) ?? null,
      byCategory,
      rows: await enrichRows(ctx, householdId, txs),
    };
  },
});
