import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/**
 * doughnatello schema.
 *
 * Conventions enforced here (see build spec):
 * - MONEY IS INTEGERS IN MINOR UNITS (para). Never floats. Every `amount`,
 *   `balance`, `value`, `target*`, `minimumPayment`, `originalAmount` field is
 *   an integer count of para (1 RSD = 100 para). The v.number() validator is
 *   float64 under the hood, but we only ever store integers in these fields.
 * - `amount` is always POSITIVE; `direction` carries the sign. Never store a
 *   negative amount.
 * - Every document that belongs to a household carries `householdId`, and every
 *   table it is queried by has an index on it.
 * - Calendar dates ("YYYY-MM-DD") are stored as strings. Wall-clock instants
 *   (createdAt, joinedAt, expiresAt, ...) are stored as epoch-millisecond
 *   numbers. `anchorDay` is a day-of-month number (1-31).
 * - Convex has no unique constraints. Where uniqueness matters
 *   ((ruleId, dueOn), (householdId, categoryId, effectiveFrom)) it is enforced
 *   inside the mutation by querying the index first, within the same ACID
 *   transaction.
 */

const potKind = v.union(
  v.literal("savings"),
  v.literal("sinking"),
  v.literal("debt"),
);

// NOTE: "committed"/"discretionary" is about OBLIGATION, not amount stability.
// Displayed as "Needs"/"Wants". Do not rename to isFixed.
const categoryKind = v.union(
  v.literal("income"),
  v.literal("committed"),
  v.literal("discretionary"),
);

const direction = v.union(
  v.literal("income"),
  v.literal("expense"),
  v.literal("transfer"),
);

const memberRole = v.union(v.literal("admin"), v.literal("member"));

export default defineSchema({
  // Convex Auth tables (users, authAccounts, authSessions, ...). The `users`
  // table holds the identity; householdMembers.userId references users._id.
  ...authTables,

  households: defineTable({
    name: v.string(),
    baseCurrency: v.string(), // e.g. "RSD"; no conversion is ever performed
    createdAt: v.number(),
  }),

  householdMembers: defineTable({
    householdId: v.id("households"),
    userId: v.string(), // identity.subject from ctx.auth — never a client arg
    displayName: v.string(),
    role: memberRole,
    joinedAt: v.number(),
  })
    .index("by_household", ["householdId"])
    .index("by_user", ["userId"])
    .index("by_household_user", ["householdId", "userId"]),

  householdInvites: defineTable({
    householdId: v.id("households"),
    token: v.string(),
    email: v.optional(v.string()),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    invitedBy: v.string(), // userId of the inviter
  })
    .index("by_token", ["token"])
    .index("by_household", ["householdId"]),

  // The one real bank account per household. isPrimary is the default on every
  // transaction; there is exactly one primary. Never show an account picker.
  accounts: defineTable({
    householdId: v.id("households"),
    name: v.string(),
    bankBalance: v.number(), // para, entered manually
    isPrimary: v.boolean(),
    isArchived: v.boolean(),
  }).index("by_household", ["householdId"]),

  // Virtual partitions of the single bank balance. isRealAccount is false for
  // every pot today (reserved for a future genuine separate account).
  pots: defineTable({
    householdId: v.id("households"),
    name: v.string(),
    kind: potKind,
    icon: v.string(),
    color: v.string(),
    sortOrder: v.number(),
    // Optional planning fields.
    targetAmount: v.optional(v.number()), // para
    targetDate: v.optional(v.string()), // YYYY-MM-DD
    // Debt-only, all optional.
    interestRate: v.optional(v.number()),
    minimumPayment: v.optional(v.number()), // para
    originalAmount: v.optional(v.number()), // para
    isRealAccount: v.boolean(),
    isArchived: v.boolean(),
  }).index("by_household", ["householdId"]),

  // Assets are NOT funds. They only ever touch net worth.
  assets: defineTable({
    householdId: v.id("households"),
    name: v.string(),
    value: v.number(), // para
    valuedOn: v.string(), // YYYY-MM-DD — surfaced to prompt annual re-value
    linkedDebtPotId: v.optional(v.id("pots")),
    isArchived: v.boolean(),
  }).index("by_household", ["householdId"]),

  categories: defineTable({
    householdId: v.id("households"),
    name: v.string(),
    kind: categoryKind,
    icon: v.string(),
    color: v.string(),
    sortOrder: v.number(),
    isArchived: v.boolean(),
  }).index("by_household", ["householdId"]),

  transactions: defineTable({
    householdId: v.id("households"),
    accountId: v.id("accounts"),
    // Optional because transfers into pots are uncategorised (they count as
    // saving, not as any spending category). Set for income and expense.
    categoryId: v.optional(v.id("categories")),
    direction,
    amount: v.number(), // para, always positive
    occurredOn: v.string(), // YYYY-MM-DD
    payee: v.optional(v.string()),
    note: v.optional(v.string()),
    // On a transfer: the destination fund. On an expense: the debt pot this
    // payment pays down. Never set on income.
    potId: v.optional(v.id("pots")),
    // Transfers only: where the money came FROM. Unset means this month's
    // income — the ordinary "set some aside". Set means the money was already
    // set aside once and is only being relabelled: fund → fund when potId is
    // also set, or fund → back to the general balance when it is not.
    //
    // A move's source is charged through an ordinary transactionFunding row
    // pointing at it, exactly as spending from that fund would be, which is why
    // pot balances need no special case for it. No index: nothing queries by
    // source — balances read the funding rows.
    fromPotId: v.optional(v.id("pots")),
    paidBy: v.string(), // userId
    createdBy: v.string(), // userId
    createdAt: v.number(),
  })
    .index("by_household_date", ["householdId", "occurredOn"])
    .index("by_household_category", ["householdId", "categoryId"])
    .index("by_household_pot", ["householdId", "potId"]),

  // The heart of the two counting rules. potId undefined => funded by this
  // month's income (reduces left to spend). potId set => funded from a pot
  // (does NOT reduce left to spend; already counted when set aside).
  transactionFunding: defineTable({
    householdId: v.id("households"),
    transactionId: v.id("transactions"),
    potId: v.optional(v.id("pots")),
    amount: v.number(), // para, always positive
  })
    .index("by_transaction", ["transactionId"])
    .index("by_household_pot", ["householdId", "potId"]),

  // NOTE: budgetTargets was removed in the 2026-07-25 IA revision. There are no
  // budget targets — the "%" shown next to a category is its computed SHARE of
  // the period's total spending, derived from transactions, not a stored plan.

  recurringRules: defineTable({
    householdId: v.id("households"),
    // Who set the rule up. An auto-posted transaction has no caller to attribute
    // it to (the cron runs with no identity), so paidBy/createdBy come from here.
    createdBy: v.string(), // userId
    direction,
    categoryId: v.optional(v.id("categories")),
    potId: v.optional(v.id("pots")),
    accountId: v.id("accounts"),
    amount: v.number(), // para
    amountMode: v.union(v.literal("exact"), v.literal("estimate")),
    payee: v.optional(v.string()),
    note: v.optional(v.string()),
    cadence: v.union(
      v.literal("weekly"),
      v.literal("monthly"),
      v.literal("yearly"),
    ),
    intervalCount: v.number(),
    anchorDay: v.number(), // 1-31; clamped to month length, never skipped
    startOn: v.string(), // YYYY-MM-DD
    untilDate: v.optional(v.string()),
    nextDueOn: v.string(), // YYYY-MM-DD
    autoPost: v.boolean(), // must be false for estimate rules
    fundedFromPotId: v.optional(v.id("pots")),
    isActive: v.boolean(),
  })
    .index("by_household", ["householdId"])
    .index("by_household_due", ["householdId", "isActive", "nextDueOn"]),

  recurringOccurrences: defineTable({
    householdId: v.id("households"),
    ruleId: v.id("recurringRules"),
    dueOn: v.string(), // YYYY-MM-DD
    status: v.union(
      v.literal("pending"),
      v.literal("posted"),
      v.literal("skipped"),
    ),
    transactionId: v.optional(v.id("transactions")),
  })
    // Uniqueness of (ruleId, dueOn) is enforced by querying this index inside
    // the generation mutation before inserting. Convex mutations are ACID.
    .index("by_rule_due", ["ruleId", "dueOn"])
    .index("by_household", ["householdId"]),
});
