import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { requireMember, requireDoc } from "./lib/auth";
import { debtOwed, potBalance } from "./lib/balances";
import { enrichRows } from "./transactions";

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

/**
 * Delete an archived fund or loan for good. Refuses while any transaction,
 * funding row, repeating rule or asset still points at it — the same rule as
 * categories: nothing that would rewrite history, everything that would not.
 */
export const remove = mutation({
  args: { potId: v.id("pots") },
  handler: async (ctx, { potId }) => {
    const { doc } = await requireDoc(ctx, "pots", potId);
    if (!doc.isArchived) {
      throw new Error("Archive it first — deleting is for things you are done with");
    }

    const moved = await ctx.db
      .query("transactions")
      .withIndex("by_household_pot", (q) =>
        q.eq("householdId", doc.householdId).eq("potId", potId),
      )
      .first();
    if (moved) throw new Error("This has transactions against it.");

    const funded = await ctx.db
      .query("transactionFunding")
      .withIndex("by_household_pot", (q) =>
        q.eq("householdId", doc.householdId).eq("potId", potId),
      )
      .first();
    if (funded) throw new Error("Money has been spent from this.");

    const [rules, assets] = await Promise.all([
      ctx.db
        .query("recurringRules")
        .withIndex("by_household", (q) => q.eq("householdId", doc.householdId))
        .collect(),
      ctx.db
        .query("assets")
        .withIndex("by_household", (q) => q.eq("householdId", doc.householdId))
        .collect(),
    ]);
    if (rules.some((r) => r.potId === potId || r.fundedFromPotId === potId)) {
      throw new Error("A repeating rule still uses this.");
    }
    if (assets.some((a) => a.linkedDebtPotId === potId)) {
      throw new Error("An asset is still linked to this loan.");
    }

    await ctx.db.delete(potId);
  },
});

export const unarchive = mutation({
  args: { potId: v.id("pots") },
  handler: async (ctx, { potId }) => {
    await requireDoc(ctx, "pots", potId);
    await ctx.db.patch(potId, { isArchived: false });
  },
});

/**
 * Everything a fund or a loan has to show for itself: what it is, what it holds
 * or still owes, and every transaction that ever touched it.
 *
 * Not period-scoped, deliberately. A fund's balance is all of time — a holiday
 * fund built over twenty months is not an August fact — and its page is the one
 * place in the app the period control does not govern.
 *
 * "Touched it" is three different rows, which is why this cannot be one query:
 *   potId       — money set aside INTO it, and (on an expense) a loan payment
 *   fromPotId   — money moved OUT of it, to another fund or back to the balance
 *   funding row — spending it paid for
 * A single transaction can appear under two of those, so they are merged by id.
 */
/**
 * What each row did to THIS fund, as distinct from what the transaction was.
 *
 * They are not the same number and the difference is not rare. A fund pays what
 * it can and the month pays the rest: a 27.469 service charged to a fund
 * holding 10.000 takes 10.000 from it, and the page was showing 27.469 — so a
 * column of figures that should sum to the balance above them did not, by
 * exactly the part the fund never paid.
 *
 * Money in is the transfer's own amount. Money out is the funding row, which is
 * the only record of how much of a transaction a fund actually carried, and
 * covers both spending it and moving it somewhere else.
 */
async function withPotAmount<T extends { _id: Id<"transactions">; direction: string; amount: number; potId: Id<"pots"> | null }>(
  rows: T[],
  potId: Id<"pots">,
  funding: Doc<"transactionFunding">[],
): Promise<(T & { potAmount: number })[]> {
  const out = new Map<Id<"transactions">, number>();
  for (const f of funding) {
    if (f.potId !== potId) continue;
    out.set(f.transactionId, (out.get(f.transactionId) ?? 0) + f.amount);
  }
  return rows.map((r) => ({
    ...r,
    // A transfer into it adds; anything funded out of it takes away. And an
    // EXPENSE pointing at it is a loan payment — the pot is the debt, and the
    // payment is what the row did to it. That third case was missing, so every
    // row on a loan's page read 0: the page listed the payments and showed
    // none of them.
    potAmount:
      ((r.direction === "transfer" || r.direction === "expense") &&
      r.potId === potId
        ? r.amount
        : 0) - (out.get(r._id) ?? 0),
  }));
}

export const detail = query({
  args: { potId: v.id("pots") },
  handler: async (ctx, { potId }) => {
    const { doc } = await requireDoc(ctx, "pots", potId);
    const householdId = doc.householdId;

    const [pointsAt, movedOut, funding] = await Promise.all([
      ctx.db
        .query("transactions")
        .withIndex("by_household_pot", (q) =>
          q.eq("householdId", householdId).eq("potId", potId),
        )
        .collect(),
      ctx.db
        .query("transactions")
        .withIndex("by_household_from_pot", (q) =>
          q.eq("householdId", householdId).eq("fromPotId", potId),
        )
        .collect(),
      ctx.db
        .query("transactionFunding")
        .withIndex("by_household_pot", (q) =>
          q.eq("householdId", householdId).eq("potId", potId),
        )
        .collect(),
    ]);

    const byId = new Map(
      [...pointsAt, ...movedOut].map((t) => [t._id, t] as const),
    );
    for (const f of funding) {
      if (byId.has(f.transactionId)) continue;
      const t = await ctx.db.get(f.transactionId);
      if (t) byId.set(t._id, t);
    }

    return {
      _id: doc._id,
      name: doc.name,
      kind: doc.kind,
      icon: doc.icon,
      color: doc.color,
      isArchived: doc.isArchived,
      targetAmount: doc.targetAmount ?? null,
      targetDate: doc.targetDate ?? null,
      interestRate: doc.interestRate ?? null,
      minimumPayment: doc.minimumPayment ?? null,
      originalAmount: doc.originalAmount ?? null,
      balance: await potBalance(ctx, householdId, potId),
      owed: doc.kind === "debt" ? await debtOwed(ctx, householdId, doc) : null,
      rows: await withPotAmount(
        await enrichRows(ctx, householdId, [...byId.values()]),
        potId,
        funding,
      ),
    };
  },
});
