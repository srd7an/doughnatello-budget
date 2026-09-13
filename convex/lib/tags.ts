import { QueryCtx, MutationCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

/**
 * The join table, in the two directions anything ever reads it.
 *
 * Kept out of tags.ts so `transactions.ts` can write tags without importing the
 * module that imports `enrichRows` back off it. The authorisation is the
 * caller's: everything here takes a householdId that has already been proven.
 */

/** How many tags one transaction may carry. */
const MAX_TAGS = 8;

/**
 * Replace a transaction's tags with exactly `tagIds`.
 *
 * Written as a REPLACEMENT rather than an add/remove pair because that is what
 * the form does: it hands back the set it is showing. Rows that are already
 * right are left alone rather than deleted and re-inserted, so a save that
 * changed the payee does not churn the join table.
 *
 * Every id is checked against the household — an id from the client says which
 * tag, never whether you may have it.
 */
export async function setTransactionTags(
  ctx: MutationCtx,
  householdId: Id<"households">,
  transactionId: Id<"transactions">,
  tagIds: Id<"tags">[],
) {
  // The same tag twice is one tag, and the order a picker hands them back in
  // means nothing.
  const wanted = [...new Set(tagIds)];
  if (wanted.length > MAX_TAGS) {
    throw new ConvexError(`A transaction can carry at most ${MAX_TAGS} tags`);
  }

  for (const tagId of wanted) {
    const tag = await ctx.db.get(tagId);
    if (!tag || tag.householdId !== householdId) {
      throw new ConvexError("Tag not found");
    }
  }

  const existing = await ctx.db
    .query("transactionTags")
    .withIndex("by_transaction", (q) => q.eq("transactionId", transactionId))
    .collect();

  const have = new Set(existing.map((r) => r.tagId));
  for (const row of existing) {
    if (!wanted.includes(row.tagId)) await ctx.db.delete(row._id);
  }
  for (const tagId of wanted) {
    if (have.has(tagId)) continue;
    await ctx.db.insert("transactionTags", {
      householdId,
      transactionId,
      tagId,
    });
  }
}

/** Every join row for a transaction, dropped — deleting the transaction. */
export async function clearTransactionTags(
  ctx: MutationCtx,
  transactionId: Id<"transactions">,
) {
  const rows = await ctx.db
    .query("transactionTags")
    .withIndex("by_transaction", (q) => q.eq("transactionId", transactionId))
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
}

export type TagPill = {
  _id: Id<"tags">;
  name: string;
  color: string;
  icon: string;
};

/**
 * The tags on a batch of transactions, ready to hang off their rows.
 *
 * TWO reads for the whole batch — the household's tags, and its join rows —
 * rather than one indexed read per transaction. The per-transaction version is
 * the obvious one and it is the wrong one here: a year holds several hundred
 * rows and would ask several hundred times, to answer a question about the
 * handful of them that carry a label at all. The join table only ever holds a
 * row per tagged transaction, so reading all of it is smaller than reading
 * nothing for each of them.
 */
export async function tagsForTransactions(
  ctx: Ctx,
  householdId: Id<"households">,
  transactionIds: Id<"transactions">[],
): Promise<Map<Id<"transactions">, TagPill[]>> {
  const out = new Map<Id<"transactions">, TagPill[]>();
  if (transactionIds.length === 0) return out;

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
  const byId = new Map(tags.map((t) => [t._id, t]));
  const wanted = new Set<string>(transactionIds);

  for (const id of transactionIds) out.set(id, []);
  for (const link of links) {
    if (!wanted.has(link.transactionId)) continue;
    const tag = byId.get(link.tagId);
    if (!tag) continue;
    out.get(link.transactionId)!.push({
      _id: tag._id,
      name: tag.name,
      color: tag.color,
      icon: tag.icon,
    });
  }
  // A stable order down the list: the same tag is always the one a row shows
  // first, whatever order the join rows happened to come back in.
  for (const pills of out.values()) {
    pills.sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}
