import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireMember } from "./lib/auth";

/**
 * Every transaction in the household, flattened for export.
 *
 * Your money should never be trapped in someone else's app, so this returns the
 * full history with names resolved rather than ids — a CSV of foreign keys is
 * not an export, it is a hostage note. The CSV itself is assembled in the
 * browser (src/lib/csv.ts): the rows are already here, and a file download does
 * not need a round trip.
 *
 * Amounts stay in integer para, with `direction` carrying the sign, exactly as
 * stored — an export that silently rounds is worse than no export.
 */
export const transactions = query({
  args: { householdId: v.id("households") },
  handler: async (ctx, { householdId }) => {
    await requireMember(ctx, householdId);

    const [txs, categories, pots, members, funding] = await Promise.all([
      ctx.db
        .query("transactions")
        .withIndex("by_household_date", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("categories")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("pots")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("householdMembers")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("transactionFunding")
        .withIndex("by_household_pot", (q) => q.eq("householdId", householdId))
        .collect(),
    ]);

    const catName = new Map(categories.map((c) => [c._id, c.name]));
    const potName = new Map(pots.map((p) => [p._id, p.name]));
    const memberName = new Map(members.map((m) => [m.userId, m.displayName]));

    // Which pot funded each expense, if any — the fact that makes a row
    // interpretable, since a pot-funded expense did not come out of the month.
    const fundedFrom = new Map<string, string>();
    for (const f of funding) {
      if (f.potId) fundedFrom.set(f.transactionId, potName.get(f.potId) ?? "");
    }

    return txs
      .sort((a, b) => (a.occurredOn < b.occurredOn ? -1 : 1))
      .map((t) => ({
        date: t.occurredOn,
        direction: t.direction,
        amount: t.amount, // para
        category: t.categoryId ? (catName.get(t.categoryId) ?? "") : "",
        fund: t.potId ? (potName.get(t.potId) ?? "") : "",
        fundedFrom: fundedFrom.get(t._id) ?? "",
        payee: t.payee ?? "",
        note: t.note ?? "",
        paidBy: memberName.get(t.paidBy) ?? "",
      }));
  },
});
