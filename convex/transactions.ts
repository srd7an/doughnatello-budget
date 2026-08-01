import { query, mutation, MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { requireMember, requireDoc } from "./lib/auth";
import { potBalance } from "./lib/balances";

const direction = v.union(
  v.literal("income"),
  v.literal("expense"),
  v.literal("transfer"),
);

/**
 * Create a transaction and its funding rows — the heart of the two counting
 * rules (see the build spec).
 *
 *  - income   → no funding rows. Contributes to income(month).
 *  - expense  → one or two transactionFunding rows:
 *      • funded from this month's income  → potId: undefined (reduces leftToSpend)
 *      • funded from a pot                → potId: <pot>   (does NOT reduce it)
 *      • split (pot can't cover it)       → both rows
 *  - transfer → money set aside into a pot. It is an income-funded OUTFLOW, so
 *      it gets a single funding row with potId: undefined — that is what makes
 *      "setting money aside reduces left to spend". The pot's balance rises via
 *      the transfer transaction itself. No transfer-out is ever recorded.
 */
export const create = mutation({
  args: {
    householdId: v.id("households"),
    direction,
    amount: v.number(), // para, positive
    categoryId: v.optional(v.id("categories")), // income/expense only
    potId: v.optional(v.id("pots")), // transfer destination
    takeFromPotId: v.optional(v.id("pots")), // expense: fund from this pot
    occurredOn: v.string(), // YYYY-MM-DD
    payee: v.optional(v.string()),
    note: v.optional(v.string()),
    paidBy: v.optional(v.string()), // defaults to the caller
  },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.householdId);
    return await insertTransaction(ctx, userId, args);
  },
});

export type TransactionInput = {
  householdId: Id<"households">;
  direction: Doc<"transactions">["direction"];
  amount: number;
  categoryId?: Id<"categories">;
  potId?: Id<"pots">;
  takeFromPotId?: Id<"pots">;
  occurredOn: string;
  payee?: string;
  note?: string;
  paidBy?: string;
};

/**
 * The funding rules themselves, with the caller already resolved.
 *
 * Split out from `create` so recurring occurrences post through exactly this
 * code path — there must be only one place that decides how a transaction is
 * funded. The caller of this helper is responsible for authorisation; it takes
 * `userId` rather than reading ctx.auth precisely because the cron that
 * auto-posts rules has no identity of its own.
 */
export async function insertTransaction(
  ctx: MutationCtx,
  userId: string,
  args: TransactionInput,
) {
  if (!Number.isInteger(args.amount) || args.amount <= 0) {
    throw new Error("Amount must be a positive whole number of para");
  }

  const account = (
    await ctx.db
      .query("accounts")
      .withIndex("by_household", (q) => q.eq("householdId", args.householdId))
      .collect()
  ).find((a) => a.isPrimary && !a.isArchived);
  if (!account) throw new Error("No primary account");

  // Category: required for income/expense, forbidden for transfer.
  if (args.direction === "transfer") {
    if (args.categoryId) throw new Error("Transfers are uncategorised");
    if (!args.potId) throw new Error("A transfer needs a destination pot");
    await assertPot(ctx, args.householdId, args.potId);
  } else {
    if (!args.categoryId) throw new Error("A category is required");
    const cat = await ctx.db.get(args.categoryId);
    if (!cat || cat.householdId !== args.householdId) {
      throw new Error("Category not found");
    }
  }

  if (args.takeFromPotId) {
    if (args.direction !== "expense") {
      throw new Error("Take from only applies to expenses");
    }
    await assertPot(ctx, args.householdId, args.takeFromPotId);
  }

  // paidBy, if given, must be a member of this household.
  let paidBy = userId as string;
  if (args.paidBy) {
    const member = await ctx.db
      .query("householdMembers")
      .withIndex("by_household_user", (q) =>
        q.eq("householdId", args.householdId).eq("userId", args.paidBy!),
      )
      .unique();
    if (!member) throw new Error("paidBy is not a member");
    paidBy = args.paidBy;
  }

  const transactionId = await ctx.db.insert("transactions", {
    householdId: args.householdId,
    accountId: account._id,
    categoryId: args.direction === "transfer" ? undefined : args.categoryId,
    direction: args.direction,
    amount: args.amount,
    occurredOn: args.occurredOn,
    payee: args.payee,
    note: args.note,
    potId: args.direction === "transfer" ? args.potId : undefined,
    paidBy,
    createdBy: userId,
    createdAt: Date.now(),
  });

  if (args.direction === "expense") {
    if (args.takeFromPotId) {
      const bal = await potBalance(ctx, args.householdId, args.takeFromPotId);
      const fromPot = Math.min(Math.max(bal, 0), args.amount);
      const fromIncome = args.amount - fromPot;
      if (fromPot > 0) {
        await ctx.db.insert("transactionFunding", {
          householdId: args.householdId,
          transactionId,
          potId: args.takeFromPotId,
          amount: fromPot,
        });
      }
      if (fromIncome > 0) {
        await ctx.db.insert("transactionFunding", {
          householdId: args.householdId,
          transactionId,
          potId: undefined,
          amount: fromIncome,
        });
      }
    } else {
      await ctx.db.insert("transactionFunding", {
        householdId: args.householdId,
        transactionId,
        potId: undefined,
        amount: args.amount,
      });
    }
  } else if (args.direction === "transfer") {
    await ctx.db.insert("transactionFunding", {
      householdId: args.householdId,
      transactionId,
      potId: undefined,
      amount: args.amount,
    });
  }

  return transactionId;
}

async function assertPot(
  ctx: MutationCtx,
  householdId: Id<"households">,
  potId: Id<"pots">,
) {
  const pot = await ctx.db.get(potId);
  if (!pot || pot.householdId !== householdId) throw new Error("Pot not found");
}

/**
 * Enriched rows for the UI: each transaction joined with its category, its
 * funding pot pill (destination pot for transfers, source pot for pot-funded
 * expenses) and the paying member's name. Grouping (by day, or by category) is
 * done client-side. Shared by listMonth and listYear.
 */
async function enrichRows(
  ctx: QueryCtx,
  householdId: Id<"households">,
  txs: Doc<"transactions">[],
) {
  const [categories, pots, members] = await Promise.all([
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
  ]);
  const catById = new Map(categories.map((c) => [c._id, c]));
  const potById = new Map(pots.map((p) => [p._id, p]));
  const nameByUser = new Map(members.map((m) => [m.userId, m.displayName]));

  const rows = await Promise.all(
    txs.map(async (t) => {
      const category = t.categoryId ? catById.get(t.categoryId) : undefined;

      // Determine the pot pill.
      let pot: (typeof pots)[number] | undefined;
      if (t.direction === "transfer" && t.potId) {
        pot = potById.get(t.potId);
      } else if (t.direction === "expense") {
        const funding = await ctx.db
          .query("transactionFunding")
          .withIndex("by_transaction", (q) => q.eq("transactionId", t._id))
          .collect();
        const potFunding = funding.find((f) => f.potId);
        if (potFunding?.potId) pot = potById.get(potFunding.potId);
      }

      return {
        _id: t._id,
        direction: t.direction,
        amount: t.amount,
        occurredOn: t.occurredOn,
        payee: t.payee ?? null,
        note: t.note ?? null,
        categoryId: t.categoryId ?? null,
        potId: t.potId ?? null,
        category: category
          ? {
              name: category.name,
              icon: category.icon,
              color: category.color,
              kind: category.kind,
            }
          : null,
        pot: pot ? { name: pot.name, icon: pot.icon, color: pot.color } : null,
        paidByName: nameByUser.get(t.paidBy) ?? "?",
      };
    }),
  );

  // Newest first.
  return rows.sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1));
}

export const listMonth = query({
  args: { householdId: v.id("households"), month: v.string() }, // YYYY-MM
  handler: async (ctx, { householdId, month }) => {
    await requireMember(ctx, householdId);
    const txs = await ctx.db
      .query("transactions")
      .withIndex("by_household_date", (q) =>
        q
          .eq("householdId", householdId)
          .gte("occurredOn", `${month}-01`)
          .lte("occurredOn", `${month}-31`),
      )
      .collect();
    return await enrichRows(ctx, householdId, txs);
  },
});

export const listYear = query({
  args: { householdId: v.id("households"), year: v.string() }, // "2026"
  handler: async (ctx, { householdId, year }) => {
    await requireMember(ctx, householdId);
    const txs = await ctx.db
      .query("transactions")
      .withIndex("by_household_date", (q) =>
        q
          .eq("householdId", householdId)
          .gte("occurredOn", `${year}-01-01`)
          .lte("occurredOn", `${year}-12-31`),
      )
      .collect();
    return await enrichRows(ctx, householdId, txs);
  },
});

export const get = query({
  args: { transactionId: v.id("transactions") },
  handler: async (ctx, { transactionId }) => {
    const { doc } = await requireDoc(ctx, "transactions", transactionId);
    return doc;
  },
});

// Deleting a transaction also removes its funding rows.
export const remove = mutation({
  args: { transactionId: v.id("transactions") },
  handler: async (ctx, { transactionId }) => {
    await requireDoc(ctx, "transactions", transactionId);
    const funding = await ctx.db
      .query("transactionFunding")
      .withIndex("by_transaction", (q) => q.eq("transactionId", transactionId))
      .collect();
    for (const f of funding) await ctx.db.delete(f._id);
    await ctx.db.delete(transactionId);
  },
});
