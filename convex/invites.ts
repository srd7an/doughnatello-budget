import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin, requireCallerId } from "./lib/auth";

const DEFAULT_EXPIRY_DAYS = 7;

// URL-safe random token. Convex's runtime provides Web Crypto.
function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Admin-only: mint an invite token for a household. Uniqueness of the token is
 * enforced by querying by_token before insert — Convex mutations are ACID, so a
 * collision (already astronomically unlikely) cannot slip through.
 */
export const create = mutation({
  args: {
    householdId: v.id("households"),
    email: v.optional(v.string()),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, { householdId, email, expiresInDays }) => {
    const { userId } = await requireAdmin(ctx, householdId);

    let token = newToken();
    while (
      await ctx.db
        .query("householdInvites")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique()
    ) {
      token = newToken();
    }

    const days = expiresInDays ?? DEFAULT_EXPIRY_DAYS;
    await ctx.db.insert("householdInvites", {
      householdId,
      token,
      email,
      expiresAt: Date.now() + days * 24 * 60 * 60 * 1000,
      invitedBy: userId,
    });
    return token;
  },
});

/**
 * Preview an invite before joining. Intentionally readable without membership
 * (that is what an invite link is for), but returns only the household name and
 * a status — never anything sensitive. May be called while signed out.
 */
export const preview = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const invite = await ctx.db
      .query("householdInvites")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!invite) return { status: "invalid" as const };

    const status = invite.acceptedAt
      ? ("used" as const)
      : invite.expiresAt < Date.now()
        ? ("expired" as const)
        : ("valid" as const);

    const household = await ctx.db.get(invite.householdId);
    return { status, householdName: household?.name ?? null };
  },
});

/**
 * Join a household by token. Must be signed in. Single-use (marks acceptedAt),
 * rejects expired/used/invalid tokens, and is idempotent for someone who is
 * already a member.
 */
export const accept = mutation({
  args: { token: v.string(), displayName: v.string() },
  handler: async (ctx, { token, displayName }) => {
    const userId = await requireCallerId(ctx);

    const invite = await ctx.db
      .query("householdInvites")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!invite) throw new Error("Invite not found");
    if (invite.acceptedAt) throw new Error("Invite already used");
    if (invite.expiresAt < Date.now()) throw new Error("Invite expired");

    const existing = await ctx.db
      .query("householdMembers")
      .withIndex("by_household_user", (q) =>
        q.eq("householdId", invite.householdId).eq("userId", userId),
      )
      .unique();

    if (!existing) {
      await ctx.db.insert("householdMembers", {
        householdId: invite.householdId,
        userId,
        displayName,
        role: "member",
        joinedAt: Date.now(),
      });
    }
    await ctx.db.patch(invite._id, { acceptedAt: Date.now() });
    return invite.householdId;
  },
});

/** Admin-only: outstanding (unaccepted) invites for a household. */
export const listPending = query({
  args: { householdId: v.id("households") },
  handler: async (ctx, { householdId }) => {
    await requireAdmin(ctx, householdId);
    const invites = await ctx.db
      .query("householdInvites")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    return invites.filter((i) => !i.acceptedAt);
  },
});
