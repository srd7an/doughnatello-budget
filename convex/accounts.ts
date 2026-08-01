import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireMember, requireDoc } from "./lib/auth";

// One real bank account per household. It is seeded on creation and never
// chosen per-transaction (isPrimary is always the default). No account picker.

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
 * Set the real bank balance — the "match to bank" action. The user enters what
 * the bank actually says; drift against the app's computed balance is shown by
 * the balance query (Phase 6). This only stores the number.
 */
export const setBalance = mutation({
  args: { accountId: v.id("accounts"), bankBalance: v.number() },
  handler: async (ctx, { accountId, bankBalance }) => {
    await requireDoc(ctx, "accounts", accountId);
    await ctx.db.patch(accountId, { bankBalance });
  },
});

export const rename = mutation({
  args: { accountId: v.id("accounts"), name: v.string() },
  handler: async (ctx, { accountId, name }) => {
    await requireDoc(ctx, "accounts", accountId);
    await ctx.db.patch(accountId, { name });
  },
});
