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

/** Where a row with no category of its own goes. */
const UNCATEGORISED = "Uncategorised";

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
  // What the money came OUT of, matched by name: a fund an expense was paid
  // from, or the source fund of a move. Same column, read by direction —
  // exactly as the form's one "Pay from" row does.
  payFrom: v.optional(v.string()),
  // The loan an expense pays down. Only a debt pot qualifies; the server
  // refuses anything else, so a mistyped name cannot quietly spend a fund.
  paysOff: v.optional(v.string()),
  payee: v.optional(v.string()),
  note: v.optional(v.string()),
});

export const preview = mutation({
  args: { householdId: v.id("households"), rows: v.array(row) },
  handler: async (ctx, { householdId, rows }) => {
    await requireMember(ctx, householdId);
    const [categories, pots, existing] = await lookups(ctx, householdId);

    const unknownCategories = new Set<string>();
    let uncategorised = 0;
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
      if (r.direction !== "transfer" && !r.category?.trim()) {
        uncategorised += 1;
      } else if (r.category && !categories.has(r.category.toLowerCase())) {
        unknownCategories.add(r.category);
      }
      for (const name of [r.fund, r.payFrom, r.paysOff]) {
        if (name && !pots.has(name.toLowerCase())) unknownFunds.add(name);
      }
    }

    return {
      total: rows.length,
      invalid,
      duplicates,
      uncategorised,
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
        // A blank category is not a broken row — a bank export has no such
        // column at all. It goes somewhere named for what it is, so the
        // history lands intact and can be filed afterwards, which is far
        // easier than re-importing.
        const name = r.category?.trim() || UNCATEGORISED;
        const key = name.toLowerCase();
        categoryId = categories.get(key);
        if (!categoryId) {
          if (!args.createMissingCategories && name !== UNCATEGORISED) {
            errors.push(`Row ${i + 1}: no category "${r.category ?? ""}"`);
            skipped += 1;
            continue;
          }
          categoryId = await ctx.db.insert("categories", {
            householdId: args.householdId,
            name,
            kind: r.direction === "income" ? "income" : "committed",
            // A star says nothing, and every imported category wearing one
            // makes the icons useless at exactly the moment there are most of
            // them. These say what kind of row they hold, and are meant to be
            // changed — which is the point of them being recognisable.
            icon: r.direction === "income" ? "wallet" : "receipt",
            color: r.direction === "income" ? "#1D9E75" : "#78716C",
            sortOrder: sortOrder++,
            isArchived: false,
          });
          categories.set(key, categoryId);
          created += 1;
        }
      }

      // Where it came OUT of. One column, read by direction — a fund an
      // expense was paid from, or the source fund of a move.
      let payFrom: Id<"pots"> | undefined;
      if (r.payFrom) {
        payFrom = pots.get(r.payFrom.toLowerCase());
        if (!payFrom) {
          errors.push(`Row ${i + 1}: no fund "${r.payFrom}" to pay from`);
          skipped += 1;
          continue;
        }
      }

      // A transfer's destination, or the loan an expense pays down. Both live
      // in potId, which is why they cannot both be set on one row.
      let potId: Id<"pots"> | undefined;
      if (r.direction === "transfer") {
        potId = r.fund ? pots.get(r.fund.toLowerCase()) : undefined;
        // A move out of a fund may land nowhere — that is releasing it back to
        // the balance, and it is only a mistake when there is no source either.
        if (!potId && !payFrom) {
          errors.push(`Row ${i + 1}: no fund "${r.fund ?? ""}" to transfer into`);
          skipped += 1;
          continue;
        }
      } else if (r.paysOff) {
        potId = pots.get(r.paysOff.toLowerCase());
        if (!potId) {
          errors.push(`Row ${i + 1}: no loan "${r.paysOff}"`);
          skipped += 1;
          continue;
        }
      }

      try {
        await insertTransaction(ctx, userId, {
          householdId: args.householdId,
          accountId: args.accountId,
          direction: r.direction,
          amount: r.amount,
          categoryId,
          potId,
          fromPotId: r.direction === "transfer" ? payFrom : undefined,
          takeFromPotId: r.direction === "expense" ? payFrom : undefined,
          occurredOn: r.date,
          payee: r.payee,
          note: r.note,
        });
      } catch (e) {
        // The server's own rules — a fund named as a loan, a move bigger than
        // its source — reported against the row that broke them rather than
        // taking the whole file down.
        errors.push(`Row ${i + 1}: ${e instanceof Error ? e.message : "refused"}`);
        skipped += 1;
        continue;
      }
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
