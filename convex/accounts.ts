import { query, mutation, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireMember, requireDoc } from "./lib/auth";
import { insertTransaction } from "./transactions";

/**
 * Real bank accounts. A household starts with one ("Main account") and can add
 * more.
 *
 * `bankBalance` is what the BANK says, typed in by a person — the app cannot see
 * your bank, and it is deliberately not derived from the transaction list (there
 * is no opening figure to derive it from). Transactions and this number are
 * therefore two independent records of the same money, which is exactly why
 * changing it is guarded: see `adjustBalance`.
 */

export const getPrimary = query({
  args: { householdId: v.id("households") },
  handler: async (ctx, { householdId }) => {
    await requireMember(ctx, householdId);
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    return accounts.find((a) => a.isPrimary && !a.isArchived) ?? null;
  },
});

/**
 * Every account with the number of transactions booked against it.
 *
 * The count is what lets the UI know whether editing the balance needs a
 * warning: on an account nobody has used, retyping the balance is just a
 * correction; on one with history, it silently contradicts the ledger.
 */
export const list = query({
  args: {
    householdId: v.id("households"),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, { householdId, includeArchived }) => {
    await requireMember(ctx, householdId);
    const all = await ctx.db
      .query("accounts")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    const visible = includeArchived ? all : all.filter((a) => !a.isArchived);

    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_household_date", (q) => q.eq("householdId", householdId))
      .collect();
    const counts = new Map<string, number>();
    for (const t of transactions) {
      counts.set(t.accountId, (counts.get(t.accountId) ?? 0) + 1);
    }

    return visible
      .map((a) => ({
        _id: a._id,
        name: a.name,
        // Accounts predate the icon, so everything reading it falls back here
        // rather than in five places downstream.
        icon: a.icon ?? "bank",
        bankBalance: a.bankBalance,
        isPrimary: a.isPrimary,
        isArchived: a.isArchived,
        transactionCount: counts.get(a._id) ?? 0,
      }))
      .sort((a, b) => (a.isPrimary === b.isPrimary ? 0 : a.isPrimary ? -1 : 1));
  },
});

export const create = mutation({
  args: {
    householdId: v.id("households"),
    name: v.string(),
    icon: v.optional(v.string()),
    bankBalance: v.optional(v.number()),
  },
  handler: async (ctx, { householdId, name, icon, bankBalance }) => {
    await requireMember(ctx, householdId);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("An account needs a name");

    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();

    return await ctx.db.insert("accounts", {
      householdId,
      name: trimmed,
      icon: icon ?? "bank",
      bankBalance: bankBalance ?? 0,
      // The first account a household ever has must be primary, or there is
      // nothing for a transaction to default to.
      isPrimary: existing.filter((a) => !a.isArchived).length === 0,
      isArchived: false,
    });
  },
});

/**
 * Overwrite what the bank says, with no explanation recorded.
 *
 * Correct for an account with no history (you are just entering the opening
 * figure). On an account with transactions this leaves the balance and the
 * ledger disagreeing with nothing to say why — which is what the UI warns
 * about before calling this, and why `adjustBalance` exists as the alternative.
 */
export const setBalance = mutation({
  args: { accountId: v.id("accounts"), bankBalance: v.number() },
  handler: async (ctx, { accountId, bankBalance }) => {
    await requireDoc(ctx, "accounts", accountId);
    if (!Number.isInteger(bankBalance)) {
      throw new Error("Balance must be a whole number of para");
    }
    await ctx.db.patch(accountId, { bankBalance });
  },
});

/**
 * Move the balance to what the bank says AND record why.
 *
 * The difference becomes a dated transaction — income if money appeared,
 * expense if it went missing — so the ledger explains the jump instead of the
 * figure silently changing under you. This is how reconciliation works in real
 * accounting software, and it is the option the UI offers whenever the account
 * already has history.
 */
export const adjustBalance = mutation({
  args: {
    accountId: v.id("accounts"),
    bankBalance: v.number(),
    occurredOn: v.optional(v.string()), // YYYY-MM-DD, defaults to today
  },
  handler: async (ctx, { accountId, bankBalance, occurredOn }) => {
    const { doc: account, userId } = await requireDoc(ctx, "accounts", accountId);
    if (!Number.isInteger(bankBalance)) {
      throw new Error("Balance must be a whole number of para");
    }

    const difference = bankBalance - account.bankBalance;
    if (difference === 0) return null;

    const direction = difference > 0 ? ("income" as const) : ("expense" as const);
    const categoryId = await adjustmentCategory(ctx, account.householdId, direction);

    const transactionId = await insertTransaction(ctx, userId, {
      householdId: account.householdId,
      accountId,
      direction,
      amount: Math.abs(difference),
      categoryId,
      occurredOn: occurredOn ?? new Date().toISOString().slice(0, 10),
      payee: "Balance adjustment",
      note: `${account.name}: corrected to what the bank says`,
    });

    await ctx.db.patch(accountId, { bankBalance });
    return transactionId;
  },
});

/**
 * The category adjustments are filed under, created on first use.
 *
 * A real category rather than an uncategorised hole: an adjustment IS money
 * that appeared or vanished, and burying it would make the month's totals
 * unexplainable. One category serves both directions — what matters is that
 * the row is visible and labelled, not which side of the ledger it sits on.
 */
async function adjustmentCategory(
  ctx: MutationCtx,
  householdId: Id<"households">,
  direction: "income" | "expense",
): Promise<Id<"categories">> {
  // One per side. A single category served both until it couldn't: a category
  // carries the kind, and the kind says which side of the ledger it belongs to,
  // so an income row filed under a spending category is a row the month screen
  // cannot place. Money that appeared and money that went missing are two
  // different events anyway.
  const income = direction === "income";
  const name = income ? "Adjustment income" : "Adjustment";

  const categories = await ctx.db
    .query("categories")
    .withIndex("by_household", (q) => q.eq("householdId", householdId))
    .collect();
  const existing = categories.find(
    (c) => c.name === name && (c.kind === "income") === income,
  );
  if (existing) return existing._id;

  const sortOrder =
    categories.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1;
  return await ctx.db.insert("categories", {
    householdId,
    name,
    kind: income ? "income" : "committed",
    icon: "wallet",
    color: "#78716C",
    sortOrder,
    isArchived: false,
  });
}

export const setIcon = mutation({
  args: { accountId: v.id("accounts"), icon: v.string() },
  handler: async (ctx, { accountId, icon }) => {
    await requireDoc(ctx, "accounts", accountId);
    await ctx.db.patch(accountId, { icon });
  },
});

export const rename = mutation({
  args: { accountId: v.id("accounts"), name: v.string() },
  handler: async (ctx, { accountId, name }) => {
    await requireDoc(ctx, "accounts", accountId);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("An account needs a name");
    await ctx.db.patch(accountId, { name: trimmed });
  },
});

/** Exactly one account is primary — it is what a transaction defaults to. */
export const setPrimary = mutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const { doc } = await requireDoc(ctx, "accounts", accountId);
    if (doc.isArchived) throw new Error("An archived account cannot be primary");
    const all = await ctx.db
      .query("accounts")
      .withIndex("by_household", (q) => q.eq("householdId", doc.householdId))
      .collect();
    for (const a of all) {
      const shouldBe = a._id === accountId;
      if (a.isPrimary !== shouldBe) {
        await ctx.db.patch(a._id, { isPrimary: shouldBe });
      }
    }
  },
});

/**
 * Archive, never delete: transactions point at their account for ever. The last
 * open account cannot go, and neither can the primary one while another exists
 * — pick a new primary first, so a transaction always has somewhere to land.
 */
export const archive = mutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const { doc } = await requireDoc(ctx, "accounts", accountId);
    const open = (
      await ctx.db
        .query("accounts")
        .withIndex("by_household", (q) => q.eq("householdId", doc.householdId))
        .collect()
    ).filter((a) => !a.isArchived);

    if (open.length <= 1) throw new Error("The last account cannot be archived");
    if (doc.isPrimary) {
      throw new Error("Make another account primary before archiving this one");
    }
    await ctx.db.patch(accountId, { isArchived: true });
  },
});
