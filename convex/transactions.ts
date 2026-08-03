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
 *
 * An expense may additionally carry `potId` naming a DEBT pot: the loan this
 * payment pays down. That changes nothing about how it is funded — a loan
 * instalment is an ordinary expense — it only lets `debtOwed` count it.
 */
export const create = mutation({
  args: {
    householdId: v.id("households"),
    direction,
    amount: v.number(), // para, positive
    categoryId: v.optional(v.id("categories")), // income/expense only
    potId: v.optional(v.id("pots")), // transfer destination, or loan paid down
    fromPotId: v.optional(v.id("pots")), // transfer: move out of this fund
    takeFromPotId: v.optional(v.id("pots")), // expense: fund from this pot
    occurredOn: v.string(), // YYYY-MM-DD
    payee: v.optional(v.string()),
    note: v.optional(v.string()),
    paidBy: v.optional(v.string()), // defaults to the caller
    accountId: v.optional(v.id("accounts")), // defaults to the primary account
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
  fromPotId?: Id<"pots">;
  takeFromPotId?: Id<"pots">;
  occurredOn: string;
  payee?: string;
  note?: string;
  paidBy?: string;
  accountId?: Id<"accounts">;
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

  // A household may hold several accounts; the caller names one or gets the
  // primary. An id from the client selects, it never authorises — hence the
  // household check.
  const accounts = await ctx.db
    .query("accounts")
    .withIndex("by_household", (q) => q.eq("householdId", args.householdId))
    .collect();
  const account = args.accountId
    ? accounts.find((a) => a._id === args.accountId)
    : accounts.find((a) => a.isPrimary && !a.isArchived);
  if (!account) throw new Error("Account not found");

  // Category: required for income/expense, forbidden for transfer.
  if (args.direction === "transfer") {
    if (args.categoryId) throw new Error("Transfers are uncategorised");
    await assertMove(ctx, args);
  } else {
    if (args.fromPotId) throw new Error("Only a transfer moves money out of a fund");
    if (!args.categoryId) throw new Error("A category is required");
    const cat = await ctx.db.get(args.categoryId);
    if (!cat || cat.householdId !== args.householdId) {
      throw new Error("Category not found");
    }
    // An expense may also name the LOAN it pays down (see assertLoan).
    if (args.potId) await assertLoan(ctx, args.householdId, args.direction, args.potId);
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
    // Transfer: the destination fund. Expense: the loan it pays down.
    potId: args.direction === "income" ? undefined : args.potId,
    fromPotId: args.direction === "transfer" ? args.fromPotId : undefined,
    paidBy,
    createdBy: userId,
    createdAt: Date.now(),
  });

  await writeFunding(ctx, transactionId, args);

  return transactionId;
}

/**
 * Write the funding rows for a transaction — the two counting rules, in the one
 * place that knows them.
 *
 * Split out so `update` can re-derive them after an edit. It MUST run against a
 * transaction whose old funding rows are already deleted: the pot-funded split
 * reads the pot's balance, and a stale row of its own would make the pot look
 * poorer than it is and push the remainder onto income.
 */
async function writeFunding(
  ctx: MutationCtx,
  transactionId: Id<"transactions">,
  args: Pick<
    TransactionInput,
    "householdId" | "direction" | "amount" | "takeFromPotId" | "fromPotId"
  >,
) {
  if (args.direction === "income") return; // income funds nothing

  // Money moving out of a fund — to another fund, or back to the general
  // balance. It is charged to the source exactly as spending from that fund
  // would be, which is what makes pot balances need no special case for it.
  // Nothing is charged to income: these were set aside once already, and
  // counting them again would take the same money off the month twice.
  if (args.direction === "transfer" && args.fromPotId) {
    await ctx.db.insert("transactionFunding", {
      householdId: args.householdId,
      transactionId,
      potId: args.fromPotId,
      amount: args.amount,
    });
    return;
  }

  if (args.direction === "expense" && args.takeFromPotId) {
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
    return;
  }

  // An expense from this month, or a transfer setting money aside — both are
  // income-funded outflows, so both reduce what is left to spend.
  await ctx.db.insert("transactionFunding", {
    householdId: args.householdId,
    transactionId,
    potId: undefined,
    amount: args.amount,
  });
}

async function assertPot(
  ctx: MutationCtx,
  householdId: Id<"households">,
  potId: Id<"pots">,
) {
  const pot = await ctx.db.get(potId);
  if (!pot || pot.householdId !== householdId) throw new Error("Pot not found");
  return pot;
}

/**
 * A transfer is one of three things, decided by which ends it has:
 *
 *   into a fund              — set money aside out of this month's income
 *   fund → fund              — move it; it was already set aside once
 *   fund → (nothing)         — release it back to the general balance
 *
 * The last two are RELABELLING, not saving, which is why neither may name a
 * debt pot: you do not park money inside a loan, you pay the loan off (an
 * expense — see assertLoan).
 *
 * A move MAY take more than its source holds, and the source goes negative.
 * That is not an overdraft, it is a promise: moving 100 out of a fund holding
 * 40 leaves −60 in one and +100 in the other, and the two still add to 40. Set
 * aside, free and net worth are all unchanged, because a move charges nothing
 * to income either way — the arithmetic survives, and a fund you spent from
 * and mean to top up later is an ordinary thing to want.
 *
 * Spending is the case where a shortfall must NOT go negative, and it does not:
 * writeFunding splits it, taking what the fund has and charging the rest to the
 * month. That is what keeps left-to-spend honest — a pot allowed to go
 * arbitrarily negative through spending would let money leave the account
 * without ever coming off the month.
 */
async function assertMove(
  ctx: MutationCtx,
  args: Pick<TransactionInput, "householdId" | "potId" | "fromPotId" | "amount">,
) {
  const { householdId, potId, fromPotId, amount } = args;
  if (!potId && !fromPotId) {
    throw new Error("A transfer needs a destination pot");
  }
  if (potId && fromPotId && potId === fromPotId) {
    throw new Error("A fund cannot move money to itself");
  }
  for (const id of [potId, fromPotId]) {
    if (!id) continue;
    const pot = await assertPot(ctx, householdId, id);
    if (pot.kind === "debt") {
      throw new Error("A loan is paid off, not moved into — record it as an expense");
    }
  }
}

/**
 * `potId` on a non-transfer means one thing only: this expense is a payment
 * against that LOAN. It stays an ordinary expense — the money leaves the
 * account and reduces what is left to spend — and `debtOwed` derives the
 * balance from it, so the loan goes down as you pay it.
 *
 * Only a debt pot may be named, and only by an expense. Pointing an expense at
 * a savings fund here would look like spending that fund without ever taking
 * the money out of it (`takeFromPotId` is the field for that), and income can
 * never pay anything down.
 */
async function assertLoan(
  ctx: MutationCtx,
  householdId: Id<"households">,
  direction: Doc<"transactions">["direction"],
  potId: Id<"pots">,
) {
  if (direction !== "expense") {
    throw new Error("Only an expense can pay off a loan");
  }
  const pot = await assertPot(ctx, householdId, potId);
  if (pot.kind !== "debt") {
    throw new Error("That is a fund, not a loan — use Take from to spend it");
  }
}

/**
 * Enriched rows for the UI: each transaction joined with its category, its
 * funding pot pill (destination pot for transfers, source pot for pot-funded
 * expenses) and the paying member's name. Grouping (by day, or by category) is
 * done client-side. Shared by listMonth and listYear.
 */
export async function enrichRows(
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

      // Determine the pot pill: the destination fund of a transfer, the loan an
      // expense pays down, or failing that the fund an expense was funded from.
      const fromPot = t.fromPotId ? potById.get(t.fromPotId) : undefined;
      let pot: (typeof pots)[number] | undefined;
      // The fund an expense was actually paid out of. Reported separately from
      // the pill because the pill may be showing a loan instead, and because
      // "everything that touched this fund" needs the id, not the name.
      let fundedFromPotId: Id<"pots"> | undefined;
      if (t.direction === "expense") {
        const funding = await ctx.db
          .query("transactionFunding")
          .withIndex("by_transaction", (q) => q.eq("transactionId", t._id))
          .collect();
        fundedFromPotId = funding.find((f) => f.potId)?.potId;
      }
      if (t.potId) {
        pot = potById.get(t.potId);
      } else if (fundedFromPotId) {
        pot = potById.get(fundedFromPotId);
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
        fromPotId: t.fromPotId ?? null,
        fundedFromPotId: fundedFromPotId ?? null,
        category: category
          ? {
              name: category.name,
              icon: category.icon,
              color: category.color,
              kind: category.kind,
            }
          : null,
        pot: pot ? { name: pot.name, icon: pot.icon, color: pot.color } : null,
        // Only a move has both ends. The pill reads "from → into" then.
        fromPot: fromPot
          ? { name: fromPot.name, icon: fromPot.icon, color: fromPot.color }
          : null,
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

/**
 * Edit a transaction.
 *
 * Funding rows are DELETED AND RE-DERIVED rather than patched, because the
 * counting rules are not a function of the field you changed: raising an
 * expense funded from a pot can push it past the pot's balance and split it
 * across income, and switching direction changes the rules entirely. Re-running
 * writeFunding on the merged result is the only version that cannot drift.
 *
 * Order matters — the old rows go first, so the pot balance the split reads is
 * the balance without this transaction in it.
 */
export const update = mutation({
  args: {
    transactionId: v.id("transactions"),
    direction: v.optional(direction),
    amount: v.optional(v.number()),
    categoryId: v.optional(v.id("categories")),
    potId: v.optional(v.id("pots")),
    fromPotId: v.optional(v.id("pots")),
    takeFromPotId: v.optional(v.id("pots")),
    clearPotFunding: v.optional(v.boolean()), // back to "from this month"
    clearLoan: v.optional(v.boolean()), // no longer pays off a loan
    clearFromPot: v.optional(v.boolean()), // a move becomes plain saving
    clearDestination: v.optional(v.boolean()), // a move becomes a release
    occurredOn: v.optional(v.string()),
    payee: v.optional(v.string()),
    note: v.optional(v.string()),
    paidBy: v.optional(v.string()),
    accountId: v.optional(v.id("accounts")),
  },
  handler: async (ctx, args) => {
    const { doc } = await requireDoc(ctx, "transactions", args.transactionId);
    const householdId = doc.householdId;

    const existingFunding = await ctx.db
      .query("transactionFunding")
      .withIndex("by_transaction", (q) =>
        q.eq("transactionId", args.transactionId),
      )
      .collect();

    const nextDirection = args.direction ?? doc.direction;
    const nextAmount = args.amount ?? doc.amount;
    if (!Number.isInteger(nextAmount) || nextAmount <= 0) {
      throw new Error("Amount must be a positive whole number of para");
    }

    // What funded it before, so an edit that does not mention funding keeps it.
    // On a move the pot-funded row is its source, not a spend, so it is only
    // read back as "take from" when this is (or becomes) an expense.
    const previousPotFunding =
      doc.direction === "transfer" && doc.fromPotId
        ? undefined
        : existingFunding.find((f) => f.potId)?.potId;
    const nextTakeFrom = args.clearPotFunding
      ? undefined
      : (args.takeFromPotId ?? previousPotFunding);

    let categoryId = args.categoryId ?? doc.categoryId;
    let potId = args.clearLoan ? undefined : (args.potId ?? doc.potId);
    if (args.clearDestination) potId = undefined;
    const fromPotId =
      nextDirection === "transfer" && !args.clearFromPot
        ? (args.fromPotId ?? doc.fromPotId)
        : undefined;

    if (nextDirection === "transfer") {
      categoryId = undefined;
      // The ends of a transfer are checked below, once the old funding rows are
      // gone and the doc has been patched: a move's own charge against its
      // source would otherwise make the fund look too poor to afford its own
      // edit.
    } else {
      if (!categoryId) throw new Error("A category is required");
      const cat = await ctx.db.get(categoryId);
      if (!cat || cat.householdId !== householdId) {
        throw new Error("Category not found");
      }
      // Switching a transfer to an expense carries its destination fund over as
      // a loan, which it is not — drop anything that is not a debt pot rather
      // than rejecting an edit the user did not make.
      if (potId) {
        const pot = await ctx.db.get(potId);
        potId =
          nextDirection === "expense" && pot?.kind === "debt" ? potId : undefined;
        if (potId) await assertLoan(ctx, householdId, nextDirection, potId);
      }
    }

    const takeFromPotId = nextDirection === "expense" ? nextTakeFrom : undefined;
    if (takeFromPotId) await assertPot(ctx, householdId, takeFromPotId);

    if (args.accountId) {
      const account = await ctx.db.get(args.accountId);
      if (!account || account.householdId !== householdId) {
        throw new Error("Account not found");
      }
    }
    if (args.paidBy) {
      const member = await ctx.db
        .query("householdMembers")
        .withIndex("by_household_user", (q) =>
          q.eq("householdId", householdId).eq("userId", args.paidBy!),
        )
        .unique();
      if (!member) throw new Error("paidBy is not a member");
    }

    for (const f of existingFunding) await ctx.db.delete(f._id);

    await ctx.db.patch(args.transactionId, {
      direction: nextDirection,
      amount: nextAmount,
      categoryId,
      potId,
      fromPotId,
      occurredOn: args.occurredOn ?? doc.occurredOn,
      // An omitted field keeps what is there; an EMPTY one clears it. Without
      // the distinction, deleting a payee in the form silently put it back.
      payee: args.payee === "" ? undefined : (args.payee ?? doc.payee),
      note: args.note === "" ? undefined : (args.note ?? doc.note),
      paidBy: args.paidBy ?? doc.paidBy,
      accountId: args.accountId ?? doc.accountId,
    });

    // Now that the row reads as it will be saved — old funding gone, ends
    // patched — the source has its real balance and can be checked against.
    // Throwing here still rolls the whole edit back; Convex mutations are ACID.
    if (nextDirection === "transfer") {
      await assertMove(ctx, {
        householdId,
        potId,
        fromPotId,
        amount: nextAmount,
      });
    }

    await writeFunding(ctx, args.transactionId, {
      householdId,
      direction: nextDirection,
      amount: nextAmount,
      takeFromPotId,
      fromPotId,
    });
  },
});

/**
 * One transaction, with everything the detail view shows: the names behind its
 * ids, and how it was actually funded — the fact that decides whether it
 * reduced this month's money or came out of a fund set aside earlier.
 */
export const detail = query({
  args: { transactionId: v.id("transactions") },
  handler: async (ctx, { transactionId }) => {
    const { doc } = await requireDoc(ctx, "transactions", transactionId);

    const [category, pot, account, members, funding] = await Promise.all([
      doc.categoryId ? ctx.db.get(doc.categoryId) : null,
      doc.potId ? ctx.db.get(doc.potId) : null,
      ctx.db.get(doc.accountId),
      ctx.db
        .query("householdMembers")
        .withIndex("by_household", (q) => q.eq("householdId", doc.householdId))
        .collect(),
      ctx.db
        .query("transactionFunding")
        .withIndex("by_transaction", (q) => q.eq("transactionId", transactionId))
        .collect(),
    ]);

    const pots = await ctx.db
      .query("pots")
      .withIndex("by_household", (q) => q.eq("householdId", doc.householdId))
      .collect();
    const potById = new Map(pots.map((p) => [p._id, p]));
    const nameByUser = new Map(members.map((m) => [m.userId, m.displayName]));

    return {
      _id: doc._id,
      direction: doc.direction,
      amount: doc.amount,
      occurredOn: doc.occurredOn,
      payee: doc.payee ?? null,
      note: doc.note ?? null,
      categoryId: doc.categoryId ?? null,
      potId: doc.potId ?? null,
      fromPotId: doc.fromPotId ?? null,
      accountId: doc.accountId,
      accountName: account?.name ?? "—",
      paidBy: doc.paidBy,
      paidByName: nameByUser.get(doc.paidBy) ?? "?",
      createdAt: doc.createdAt,
      category: category
        ? { name: category.name, icon: category.icon, color: category.color }
        : null,
      pot: pot ? { name: pot.name, icon: pot.icon, color: pot.color } : null,
      fromPot: (() => {
        const p = doc.fromPotId ? potById.get(doc.fromPotId) : undefined;
        return p ? { name: p.name, icon: p.icon, color: p.color } : null;
      })(),
      funding: funding.map((f) => ({
        amount: f.amount,
        potId: f.potId ?? null,
        potName: f.potId ? (potById.get(f.potId)?.name ?? null) : null,
      })),
    };
  },
});
