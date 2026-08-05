import { query, mutation, internalMutation, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { requireMember, requireDoc } from "./lib/auth";
import { insertTransaction } from "./transactions";
import { firstDue, dueDatesThrough, nextDue } from "./lib/recurrence";

const direction = v.union(
  v.literal("income"),
  v.literal("expense"),
  v.literal("transfer"),
);
const cadence = v.union(
  v.literal("weekly"),
  v.literal("monthly"),
  v.literal("yearly"),
);
const amountMode = v.union(v.literal("exact"), v.literal("estimate"));

/**
 * Recurring rules describe money that repeats. They are NOT transactions: a
 * rule only becomes real money when its occurrence is posted, either because
 * someone confirmed it or because the rule is autoPost.
 *
 * Occurrences are materialised (never computed on the fly) because they carry
 * state a formula cannot: skipped, posted, and the transaction they produced.
 * Two things materialise them — `sync`, run when a household is opened, and the
 * nightly cron in crons.ts. Both are idempotent on (ruleId, dueOn), so running
 * them in any order or twice over is safe.
 */

/** An estimate is a guess, so it must never post itself behind your back. */
function assertPostable(mode: "exact" | "estimate", autoPost: boolean) {
  if (autoPost && mode === "estimate") {
    throw new Error("An estimate rule cannot auto-post — confirm it instead");
  }
}

/**
 * A rule's `potId` on an expense is the loan it pays down, exactly as on the
 * transactions it posts. Only a debt pot qualifies — see assertLoan in
 * transactions.ts for why a fund must not be named here.
 */
async function assertLoanRef(
  ctx: MutationCtx,
  householdId: Id<"households">,
  direction: "income" | "expense" | "transfer",
  potId: Id<"pots">,
) {
  if (direction !== "expense") throw new Error("Only an expense can pay off a loan");
  const pot = await ctx.db.get(potId);
  if (!pot || pot.householdId !== householdId) throw new Error("Pot not found");
  if (pot.kind !== "debt") {
    throw new Error("That is a fund, not a loan — use Take from to spend it");
  }
}

async function assertRefs(
  ctx: MutationCtx,
  householdId: Id<"households">,
  refs: {
    categoryId?: Id<"categories">;
    potId?: Id<"pots">;
    fundedFromPotId?: Id<"pots">;
    accountId?: Id<"accounts">;
  },
) {
  for (const id of [refs.categoryId, refs.potId, refs.fundedFromPotId, refs.accountId]) {
    if (!id) continue;
    const doc = await ctx.db.get(id);
    if (!doc || (doc as { householdId?: Id<"households"> }).householdId !== householdId) {
      throw new Error("Referenced record not found");
    }
  }
}

export const create = mutation({
  args: {
    householdId: v.id("households"),
    direction,
    amount: v.number(), // para, positive
    amountMode,
    categoryId: v.optional(v.id("categories")),
    potId: v.optional(v.id("pots")), // transfer destination
    fundedFromPotId: v.optional(v.id("pots")), // expense: take from this pot
    payee: v.optional(v.string()),
    merchant: v.optional(v.string()),
    note: v.optional(v.string()),
    cadence,
    intervalCount: v.optional(v.number()), // default 1
    anchorDay: v.optional(v.number()), // default: day of startOn
    startOn: v.string(), // YYYY-MM-DD
    untilDate: v.optional(v.string()),
    autoPost: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.householdId);

    if (!Number.isInteger(args.amount) || args.amount <= 0) {
      throw new Error("Amount must be a positive whole number of para");
    }
    const autoPost = args.autoPost ?? false;
    assertPostable(args.amountMode, autoPost);

    if (args.direction === "transfer") {
      if (args.categoryId) throw new Error("Transfers are uncategorised");
      if (!args.potId) throw new Error("A transfer needs a destination pot");
    } else if (!args.categoryId) {
      throw new Error("A category is required");
    }
    if (args.fundedFromPotId && args.direction !== "expense") {
      throw new Error("Take from only applies to expenses");
    }
    // As on a transaction, potId on an expense names the loan it pays down —
    // which is what makes a monthly instalment a rule like any other.
    if (args.potId && args.direction !== "transfer") {
      await assertLoanRef(ctx, args.householdId, args.direction, args.potId);
    }

    const account = (
      await ctx.db
        .query("accounts")
        .withIndex("by_household", (q) => q.eq("householdId", args.householdId))
        .collect()
    ).find((a) => a.isPrimary && !a.isArchived);
    if (!account) throw new Error("No primary account");

    await assertRefs(ctx, args.householdId, args);

    const intervalCount = Math.max(1, Math.trunc(args.intervalCount ?? 1));
    const anchorDay = args.anchorDay ?? Number(args.startOn.slice(8, 10));
    if (anchorDay < 1 || anchorDay > 31) throw new Error("anchorDay must be 1-31");

    const recurrence = { cadence: args.cadence, intervalCount, anchorDay };

    return await ctx.db.insert("recurringRules", {
      householdId: args.householdId,
      createdBy: userId,
      direction: args.direction,
      categoryId: args.direction === "transfer" ? undefined : args.categoryId,
      potId: args.direction === "income" ? undefined : args.potId,
      accountId: account._id,
      amount: args.amount,
      amountMode: args.amountMode,
      payee: args.payee,
      merchant: args.merchant,
      note: args.note,
      cadence: args.cadence,
      intervalCount,
      anchorDay,
      startOn: args.startOn,
      untilDate: args.untilDate,
      nextDueOn: firstDue(args.startOn, recurrence),
      autoPost,
      fundedFromPotId: args.fundedFromPotId,
      isActive: true,
    });
  },
});

export const update = mutation({
  args: {
    ruleId: v.id("recurringRules"),
    amount: v.optional(v.number()),
    amountMode: v.optional(amountMode),
    categoryId: v.optional(v.id("categories")),
    potId: v.optional(v.id("pots")),
    fundedFromPotId: v.optional(v.id("pots")),
    payee: v.optional(v.string()),
    merchant: v.optional(v.string()),
    note: v.optional(v.string()),
    untilDate: v.optional(v.string()),
    autoPost: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, { ruleId, ...patch }) => {
    const { doc } = await requireDoc(ctx, "recurringRules", ruleId);

    if (patch.amount !== undefined) {
      if (!Number.isInteger(patch.amount) || patch.amount <= 0) {
        throw new Error("Amount must be a positive whole number of para");
      }
    }
    assertPostable(
      patch.amountMode ?? doc.amountMode,
      patch.autoPost ?? doc.autoPost,
    );
    await assertRefs(ctx, doc.householdId, patch);
    if (patch.potId && doc.direction !== "transfer") {
      await assertLoanRef(ctx, doc.householdId, doc.direction, patch.potId);
    }

    const fields = Object.fromEntries(
      Object.entries(patch).filter(([, val]) => val !== undefined),
    );
    await ctx.db.patch(ruleId, fields);
  },
});

/** Pausing keeps the history; the rule simply stops generating. */
export const setActive = mutation({
  args: { ruleId: v.id("recurringRules"), isActive: v.boolean() },
  handler: async (ctx, { ruleId, isActive }) => {
    const { doc } = await requireDoc(ctx, "recurringRules", ruleId);
    // Resuming after a pause would otherwise back-fill every date missed while
    // paused. Skip the rule forward to the next date that is still ahead.
    if (isActive && !doc.isActive) {
      let due = doc.nextDueOn;
      const today = todayISO();
      let guard = 0;
      while (due < today && guard++ < 400) due = nextDue(due, doc);
      await ctx.db.patch(ruleId, { isActive: true, nextDueOn: due });
      return;
    }
    await ctx.db.patch(ruleId, { isActive });
  },
});

/**
 * Deleting a rule drops its unposted occurrences but never the transactions it
 * already produced — that money happened.
 */
export const remove = mutation({
  args: { ruleId: v.id("recurringRules") },
  handler: async (ctx, { ruleId }) => {
    await requireDoc(ctx, "recurringRules", ruleId);
    const occurrences = await ctx.db
      .query("recurringOccurrences")
      .withIndex("by_rule_due", (q) => q.eq("ruleId", ruleId))
      .collect();
    for (const o of occurrences) {
      if (o.status !== "posted") await ctx.db.delete(o._id);
    }
    await ctx.db.delete(ruleId);
  },
});

export const listRules = query({
  args: { householdId: v.id("households") },
  handler: async (ctx, { householdId }) => {
    await requireMember(ctx, householdId);
    const [rules, categories, pots] = await Promise.all([
      ctx.db
        .query("recurringRules")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("categories")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("pots")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
    ]);
    const catById = new Map(categories.map((c) => [c._id, c]));
    const potById = new Map(pots.map((p) => [p._id, p]));

    return rules
      .map((r) => ({
        _id: r._id,
        direction: r.direction,
        amount: r.amount,
        amountMode: r.amountMode,
        payee: r.payee ?? null,
        merchant: r.merchant ?? null,
        note: r.note ?? null,
        cadence: r.cadence,
        intervalCount: r.intervalCount,
        anchorDay: r.anchorDay,
        nextDueOn: r.nextDueOn,
        untilDate: r.untilDate ?? null,
        autoPost: r.autoPost,
        isActive: r.isActive,
        category: r.categoryId ? summarise(catById.get(r.categoryId)) : null,
        pot: r.potId ? summarise(potById.get(r.potId)) : null,
        fundedFromPot: r.fundedFromPotId
          ? summarise(potById.get(r.fundedFromPotId))
          : null,
      }))
      .sort((a, b) =>
        a.isActive === b.isActive
          ? a.nextDueOn < b.nextDueOn
            ? -1
            : 1
          : a.isActive
            ? -1
            : 1,
      );
  },
});

function summarise(doc?: { name: string; icon: string; color: string }) {
  return doc ? { name: doc.name, icon: doc.icon, color: doc.color } : null;
}

/**
 * Pending occurrences due on or before `through` (default: today). This is what
 * the "Due" block reads — it never generates, so it stays a pure query; `sync`
 * does the writing.
 */
export const listDue = query({
  args: { householdId: v.id("households"), through: v.optional(v.string()) },
  handler: async (ctx, { householdId, through }) => {
    await requireMember(ctx, householdId);
    const limit = through ?? todayISO();

    const occurrences = await ctx.db
      .query("recurringOccurrences")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();

    const pending = occurrences.filter(
      (o) => o.status === "pending" && o.dueOn <= limit,
    );

    const rows = await Promise.all(
      pending.map(async (o) => {
        const rule = await ctx.db.get(o.ruleId);
        if (!rule) return null;
        const category = rule.categoryId
          ? await ctx.db.get(rule.categoryId)
          : null;
        const pot = rule.potId ? await ctx.db.get(rule.potId) : null;
        return {
          _id: o._id,
          dueOn: o.dueOn,
          ruleId: rule._id,
          direction: rule.direction,
          amount: rule.amount,
          amountMode: rule.amountMode,
          payee: rule.payee ?? null,
          merchant: rule.merchant ?? null,
          note: rule.note ?? null,
          category: summarise(category ?? undefined),
          pot: summarise(pot ?? undefined),
        };
      }),
    );

    return rows
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1));
  },
});

/**
 * Materialise every occurrence due on or before `through` for one household.
 * Called on app open, so the Due block is correct the moment it renders rather
 * than waiting for the nightly cron.
 */
export const sync = mutation({
  args: { householdId: v.id("households"), through: v.optional(v.string()) },
  handler: async (ctx, { householdId, through }) => {
    await requireMember(ctx, householdId);
    return await generateForHousehold(ctx, householdId, through ?? todayISO());
  },
});

export async function generateForHousehold(
  ctx: MutationCtx,
  householdId: Id<"households">,
  through: string,
) {
  const rules = await ctx.db
    .query("recurringRules")
    .withIndex("by_household_due", (q) =>
      q.eq("householdId", householdId).eq("isActive", true).lte("nextDueOn", through),
    )
    .collect();

  let created = 0;
  let posted = 0;
  for (const rule of rules) {
    const result = await generateForRule(ctx, rule, through);
    created += result.created;
    posted += result.posted;
  }
  return { created, posted };
}

async function generateForRule(
  ctx: MutationCtx,
  rule: Doc<"recurringRules">,
  through: string,
) {
  const dates = dueDatesThrough(rule.nextDueOn, through, rule, rule.untilDate);
  let created = 0;
  let posted = 0;

  for (const dueOn of dates) {
    // Idempotency: (ruleId, dueOn) is unique, enforced by checking the index
    // inside this mutation. Convex mutations are serialisable, so a concurrent
    // sync and cron cannot both pass this check.
    const existing = await ctx.db
      .query("recurringOccurrences")
      .withIndex("by_rule_due", (q) =>
        q.eq("ruleId", rule._id).eq("dueOn", dueOn),
      )
      .unique();
    if (existing) continue;

    if (rule.autoPost) {
      const transactionId = await postFromRule(ctx, rule, dueOn, rule.amount);
      await ctx.db.insert("recurringOccurrences", {
        householdId: rule.householdId,
        ruleId: rule._id,
        dueOn,
        status: "posted",
        transactionId,
      });
      posted += 1;
    } else {
      await ctx.db.insert("recurringOccurrences", {
        householdId: rule.householdId,
        ruleId: rule._id,
        dueOn,
        status: "pending",
      });
    }
    created += 1;
  }

  // Advance the cursor past everything just generated, so the next run starts
  // where this one stopped even if nothing was inserted.
  const last = dates[dates.length - 1];
  const cursor = last ? nextDue(last, rule) : rule.nextDueOn;
  const expired = !!rule.untilDate && cursor > rule.untilDate;
  await ctx.db.patch(rule._id, {
    nextDueOn: cursor,
    isActive: expired ? false : rule.isActive,
  });

  return { created, posted };
}

async function postFromRule(
  ctx: MutationCtx,
  rule: Doc<"recurringRules">,
  occurredOn: string,
  amount: number,
) {
  return await insertTransaction(ctx, rule.createdBy, {
    householdId: rule.householdId,
    direction: rule.direction,
    amount,
    categoryId: rule.categoryId,
    potId: rule.potId,
    takeFromPotId: rule.fundedFromPotId,
    occurredOn,
    payee: rule.payee,
    note: rule.note,
    paidBy: rule.createdBy,
  });
}

/**
 * Confirm a due occurrence into a real transaction. `amount` overrides the
 * rule's figure — that is the whole point of an estimate rule: the bill arrives,
 * you type what it actually was.
 */
export const confirm = mutation({
  args: {
    occurrenceId: v.id("recurringOccurrences"),
    amount: v.optional(v.number()),
    occurredOn: v.optional(v.string()),
  },
  handler: async (ctx, { occurrenceId, amount, occurredOn }) => {
    const { doc: occurrence, userId } = await requireDoc(
      ctx,
      "recurringOccurrences",
      occurrenceId,
    );
    if (occurrence.status !== "pending") {
      throw new Error("This occurrence is already settled");
    }
    const rule = await ctx.db.get(occurrence.ruleId);
    if (!rule) throw new Error("Not found");

    const finalAmount = amount ?? rule.amount;
    if (!Number.isInteger(finalAmount) || finalAmount <= 0) {
      throw new Error("Amount must be a positive whole number of para");
    }

    // Confirming attributes the money to whoever confirmed it, not to whoever
    // set the rule up.
    const transactionId = await insertTransaction(ctx, userId, {
      householdId: rule.householdId,
      direction: rule.direction,
      amount: finalAmount,
      categoryId: rule.categoryId,
      potId: rule.potId,
      takeFromPotId: rule.fundedFromPotId,
      occurredOn: occurredOn ?? occurrence.dueOn,
      payee: rule.payee,
      merchant: rule.merchant,
      note: rule.note,
      paidBy: userId,
    });

    await ctx.db.patch(occurrenceId, { status: "posted", transactionId });
    return transactionId;
  },
});

/** Not this time — no transaction, and it stops asking. */
export const skip = mutation({
  args: { occurrenceId: v.id("recurringOccurrences") },
  handler: async (ctx, { occurrenceId }) => {
    const { doc } = await requireDoc(ctx, "recurringOccurrences", occurrenceId);
    if (doc.status !== "pending") {
      throw new Error("This occurrence is already settled");
    }
    await ctx.db.patch(occurrenceId, { status: "skipped" });
  },
});

/**
 * Nightly sweep, run by the cron with no caller identity — hence internal, and
 * hence the household loop rather than a client-supplied householdId. Its only
 * job that `sync` does not already cover is firing autoPost rules for
 * households nobody happens to open that day.
 */
export const sweep = internalMutation({
  args: { through: v.optional(v.string()) },
  handler: async (ctx, { through }) => {
    const limit = through ?? todayISO();
    const households = await ctx.db.query("households").collect();
    let created = 0;
    let posted = 0;
    for (const h of households) {
      const result = await generateForHousehold(ctx, h._id, limit);
      created += result.created;
      posted += result.posted;
    }
    return { households: households.length, created, posted };
  },
});

/** UTC today. Rules are day-grained, so an hour of drift is not worth a tz. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
