import { getAuthUserId } from "@convex-dev/auth/server";
import { QueryCtx, MutationCtx } from "../_generated/server";
import { DataModel, Doc, Id, TableNames } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

/**
 * The caller's users._id, or null if unauthenticated. Convex Auth encodes the
 * subject as `userId|sessionId`; getAuthUserId returns just the userId, so it
 * is stable across a user's sessions — which is what householdMembers.userId
 * stores.
 */
export async function getCallerId(ctx: Ctx): Promise<Id<"users"> | null> {
  return await getAuthUserId(ctx);
}

/** Like getCallerId but throws instead of returning null. */
export async function requireCallerId(ctx: Ctx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

/**
 * The single authorisation primitive for the whole backend.
 *
 * Every query, mutation and action that touches household data MUST begin by
 * calling this (or requireAdmin, or requireDoc which wraps it). It:
 *   1. resolves the caller's identity from ctx.auth — never from a client arg,
 *   2. asserts the caller is a member of `householdId`.
 *
 * A `householdId` from the client says WHICH household to read. It never says
 * whether the caller MAY. That is this function's job, and its alone.
 */
export async function requireMember(ctx: Ctx, householdId: Id<"households">) {
  const userId = await requireCallerId(ctx);

  const membership = await ctx.db
    .query("householdMembers")
    .withIndex("by_household_user", (q) =>
      q.eq("householdId", householdId).eq("userId", userId),
    )
    .unique();

  if (!membership) throw new Error("Not a member of this household");
  return { userId, membership };
}

/**
 * Admin-only actions (deleting a household, removing members, changing roles).
 */
export async function requireAdmin(ctx: Ctx, householdId: Id<"households">) {
  const result = await requireMember(ctx, householdId);
  if (result.membership.role !== "admin") {
    throw new Error("Requires admin");
  }
  return result;
}

// Household-owned tables: every one carries a `householdId` field. Fetch-by-id
// on any of these must be routed through requireDoc so the household check
// cannot be forgotten.
type HouseholdTable = {
  [T in TableNames]: DataModel[T]["document"] extends {
    householdId: Id<"households">;
  }
    ? T
    : never;
}[TableNames];

/**
 * Fetch a document by id AND prove the caller is entitled to it.
 *
 * `ctx.db.get(id)` bypasses every filter — so a raw get of a client-supplied id
 * is a cross-tenant read waiting to happen. This resolves the doc, derives its
 * owning household from the stored `householdId`, and runs requireMember against
 * THAT household. A caller passing another household's id fails the membership
 * check. Returns the doc (never null) and the caller's membership.
 */
export async function requireDoc<T extends HouseholdTable>(
  ctx: Ctx,
  // Names the table at the call site and binds T so `id` must match it. Unused
  // at runtime (the doc is fetched by id); the leading _ marks that.
  _table: T,
  id: Id<T>,
) {
  const doc = (await ctx.db.get(id)) as Doc<T> | null;
  // Do not leak existence across tenants: a missing doc and a doc the caller may
  // not see both surface as the same generic error.
  if (!doc) throw new Error("Not found");
  // T is constrained to HouseholdTable, so every doc has householdId — but
  // Doc<T> is a union TS won't narrow generically, hence the unknown hop.
  const householdId = (doc as unknown as { householdId: Id<"households"> })
    .householdId;
  const { userId, membership } = await requireMember(ctx, householdId);
  return { doc, userId, membership };
}
