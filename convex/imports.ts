import { mutation, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireMember } from "./lib/auth";
import { insertTransaction } from "./transactions";

/**
 * Bulk import of transactions parsed from a CSV.
 *
 * The file is parsed and mapped in the browser (src/lib/csv.ts) — this takes
 * already-structured rows. That split is deliberate: parsing is presentation
 * work with a preview attached, while the rules about what a transaction IS
 * belong on the server, where they cannot be skipped.
 *
 * Every row goes through `insertTransaction`, so imported money gets exactly the
 * funding rows hand-entered money would. An importer that wrote to the
 * transactions table directly would produce rows that look right in a list and
 * are invisible to left-to-spend.
 */

const row = v.object({
  date: v.string(), // YYYY-MM-DD
  direction: v.union(
    v.literal("income"),
    v.literal("expense"),
    v.literal("transfer"),
  ),
  amount: v.number(), // para, positive
  category: v.optional(v.string()), // matched by name
  fund: v.optional(v.string()), // transfer destination, matched by name
  payee: v.optional(v.string()),
  note: v.optional(v.string()),
});

export const preview = mutation({
  args: { householdId: v.id("households"), rows: v.array(row) },
  handler: async (ctx, { householdId, rows }) => {
    await requireMember(ctx, householdId);
    const [categories, pots, existing] = await lookups(ctx, householdId);

    const unknownCategories = new Set<string>();
    const unknownFunds = new Set<string>();
    const problems: string[] = [];
    let duplicates = 0;
    let invalid = 0;

    for (const [i, r] of rows.entries()) {
      const problem = validate(r);
      if (problem) {
        invalid += 1;
        // A count alone leaves you guessing; a few examples name the cause.
        if (problems.length < 5) problems.push(`Row ${i + 1}: ${problem}`);
        continue;
      }
      if (existing.has(fingerprint(r.date, r.amount, r.direction, r.payee))) {
        duplicates += 1;
      }
      if (r.category && !categories.has(r.category.toLowerCase())) {
        unknownCategories.add(r.category);
      }
      if (r.fund && !pots.has(r.fund.toLowerCase())) {
        unknownFunds.add(r.fund);
      }
    }

    return {
      total: rows.length,
      invalid,
      duplicates,
      importable: rows.length - invalid - duplicates,
      problems,
      unknownCategories: [...unknownCategories],
      unknownFunds: [...unknownFunds],
    };
  },
});

/**
 * Commit the rows.
 *
 * `skipDuplicates` defaults to true because importing the same file twice is
 * the single most likely mistake, and doubling somebody's spending history is
 * a bad way to find out. A duplicate is same date + amount + direction + payee.
 */
export const commit = mutation({
  args: {
    householdId: v.id("households"),
    rows: v.array(row),
    accountId: v.optional(v.id("accounts")),
    createMissingCategories: v.optional(v.boolean()),
    skipDuplicates: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.householdId);
    const skipDuplicates = args.skipDuplicates ?? true;
    const [categories, pots, existing] = await lookups(ctx, args.householdId);

    let imported = 0;
    let skipped = 0;
    let created = 0;
    const errors: string[] = [];

    let sortOrder =
      (
        await ctx.db
          .query("categories")
          .withIndex("by_household", (q) => q.eq("householdId", args.householdId))
          .collect()
      ).reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1;

    for (const [i, r] of args.rows.entries()) {
      const problem = validate(r);
      if (problem) {
        errors.push(`Row ${i + 1}: ${problem}`);
        skipped += 1;
        continue;
      }

      const print = fingerprint(r.date, r.amount, r.direction, r.payee);
      if (skipDuplicates && existing.has(print)) {
        skipped += 1;
        continue;
      }

      let categoryId: Id<"categories"> | undefined
      if (r.direction !== "transfer") {
        const key = (r.category ?? "").toLowerCase();
        categoryId = categories.get(key);
        if (!categoryId) {
          if (!args.createMissingCategories || !r.category) {
            errors.push(`Row ${i + 1}: no category "${r.category ?? ""}"`);
            skipped += 1;
            continue;
          }
          categoryId = await ctx.db.insert("categories", {
            householdId: args.householdId,
            name: r.category,
            kind: r.direction === "income" ? "income" : "committed",
            icon: "star",
            color: "#78716C",
            sortOrder: sortOrder++,
            isArchived: false,
          });
          categories.set(key, categoryId);
          created += 1;
        }
      }

      let potId: Id<"pots"> | undefined;
      if (r.direction === "transfer") {
        potId = r.fund ? pots.get(r.fund.toLowerCase()) : undefined;
        if (!potId) {
          errors.push(`Row ${i + 1}: no fund "${r.fund ?? ""}" to transfer into`);
          skipped += 1;
          continue;
        }
      }

      await insertTransaction(ctx, userId, {
        householdId: args.householdId,
        accountId: args.accountId,
        direction: r.direction,
        amount: r.amount,
        categoryId,
        potId,
        occurredOn: r.date,
        payee: r.payee,
        note: r.note,
      });
      existing.add(print);
      imported += 1;
    }

    // Only the first handful — a thousand-row failure should not return a
    // thousand strings the UI cannot show anyway.
    return { imported, skipped, createdCategories: created, errors: errors.slice(0, 20) };
  },
});

function validate(r: {
  date: string;
  amount: number;
  direction: string;
}): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return "date must be YYYY-MM-DD";
  if (!Number.isInteger(r.amount) || r.amount <= 0) {
    return "amount must be a positive number";
  }
  return null;
}

/** Same day, same amount, same direction, same payee — almost certainly a re-import. */
function fingerprint(
  date: string,
  amount: number,
  direction: string,
  payee?: string,
): string {
  return `${date}|${amount}|${direction}|${(payee ?? "").toLowerCase()}`;
}

/** Name→id maps for matching, plus fingerprints of what is already there. */
async function lookups(ctx: MutationCtx, householdId: Id<"households">) {
  const [categories, pots, transactions] = await Promise.all([
    ctx.db
      .query("categories")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect(),
    ctx.db
      .query("pots")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect(),
    ctx.db
      .query("transactions")
      .withIndex("by_household_date", (q) => q.eq("householdId", householdId))
      .collect(),
  ]);

  return [
    new Map(categories.map((c) => [c.name.toLowerCase(), c._id])),
    new Map(pots.map((p) => [p.name.toLowerCase(), p._id])),
    new Set(
      transactions.map((t) =>
        fingerprint(t.occurredOn, t.amount, t.direction, t.payee),
      ),
    ),
  ] as const;
}
