import { internalMutation, internalQuery, QueryCtx } from "./_generated/server";
import { v } from "convex/values";

/**
 * Deleting a batch of transactions after an import went wrong.
 *
 * Nothing marks an imported row as imported — the importer runs every row
 * through `insertTransaction` precisely so the result is indistinguishable from
 * money typed by hand — so the only handle on a bad batch is the range of dates
 * it covered.
 *
 * Both functions are `internal`, so no client can reach them, and the delete
 * takes an `expect` count that must match exactly what the preview found. A
 * mistyped month then deletes nothing instead of a year: the guard is not
 * ceremony, it is the difference between "I meant January" and "January is
 * gone and so is February".
 *
 *   npx convex run maintenance:preview '{"from":"2026-01-01","to":"2026-01-31"}'
 *   npx convex run maintenance:removeRange '{"from":"2026-01-01","to":"2026-01-31","expect":83}'
 *
 * Add --prod to run against production. Funding rows go with each transaction;
 * categories, funds and loans are never touched.
 */

async function resolve(ctx: QueryCtx, name?: string) {
  const households = await ctx.db.query("households").collect();
  const household = name
    ? households.find((h) => h.name === name)
    : households.sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!household) throw new Error(`No household named "${name}"`);
  return household;
}

const args = {
  householdName: v.optional(v.string()),
  from: v.string(), // YYYY-MM-DD, inclusive
  to: v.string(), // YYYY-MM-DD, inclusive
};

/** What `removeRange` would delete, and the count it will demand back. */
export const preview = internalQuery({
  args,
  handler: async (ctx, { householdName, from, to }) => {
    const household = await resolve(ctx, householdName);
    const txs = await ctx.db
      .query("transactions")
      .withIndex("by_household_date", (q) =>
        q.eq("householdId", household._id).gte("occurredOn", from).lte("occurredOn", to),
      )
      .collect();

    const byDirection: Record<string, number> = {};
    let total = 0;
    for (const t of txs) {
      byDirection[t.direction] = (byDirection[t.direction] ?? 0) + 1;
      total += t.direction === "income" ? t.amount : -t.amount;
    }

    return {
      household: household.name,
      range: `${from} → ${to}`,
      count: txs.length,
      byDirection,
      netAmount: total,
      // Enough to recognise the batch, not enough to fill a terminal.
      sample: txs
        .slice(0, 8)
        .map((t) => `${t.occurredOn} ${t.direction} ${t.amount / 100} ${t.payee ?? ""}`),
    };
  },
});

export const removeRange = internalMutation({
  args: { ...args, expect: v.number() },
  handler: async (ctx, { householdName, from, to, expect }) => {
    const household = await resolve(ctx, householdName);
    const txs = await ctx.db
      .query("transactions")
      .withIndex("by_household_date", (q) =>
        q.eq("householdId", household._id).gte("occurredOn", from).lte("occurredOn", to),
      )
      .collect();

    if (txs.length !== expect) {
      throw new Error(
        `Refusing: ${txs.length} transactions in ${from} → ${to}, but you expected ${expect}. ` +
          `Run maintenance:preview and pass the count it reports.`,
      );
    }

    let fundingRows = 0;
    for (const t of txs) {
      const funding = await ctx.db
        .query("transactionFunding")
        .withIndex("by_transaction", (q) => q.eq("transactionId", t._id))
        .collect();
      for (const f of funding) {
        await ctx.db.delete(f._id);
        fundingRows += 1;
      }
      await ctx.db.delete(t._id);
    }

    return {
      household: household.name,
      deleted: txs.length,
      fundingRows,
      range: `${from} → ${to}`,
    };
  },
});
