import { internalMutation, internalQuery, QueryCtx } from "./_generated/server";
import { v } from "convex/values";

/**
 * Deleting a batch of transactions after an import went wrong.
 *
 * Nothing marks an imported row as imported — the importer runs every row
 * through `insertTransaction` precisely so the result is indistinguishable from
 * money typed by hand — so the only handle on a bad batch is the range of dates
 * it covered.
 *
 * Both functions are `internal`, so no client can reach them, and the delete
 * takes an `expect` count that must match exactly what the preview found. A
 * mistyped month then deletes nothing instead of a year: the guard is not
 * ceremony, it is the difference between "I meant January" and "January is
 * gone and so is February".
 *
 *   npx convex run maintenance:preview '{"from":"2026-01-01","to":"2026-01-31"}'
 *   npx convex run maintenance:removeRange '{"from":"2026-01-01","to":"2026-01-31","expect":83}'
 *
 * Add --prod to run against production. Funding rows go with each transaction;
 * categories, funds and loans are never touched.
 */

async function resolve(ctx: QueryCtx, name?: string) {
  const households = await ctx.db.query("households").collect();
  const household = name
    ? households.find((h) => h.name === name)
    : households.sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!household) throw new Error(`No household named "${name}"`);
  return household;
}

const args = {
  householdName: v.optional(v.string()),
  from: v.string(), // YYYY-MM-DD, inclusive
  to: v.string(), // YYYY-MM-DD, inclusive
};

/** What `removeRange` would delete, and the count it will demand back. */
export const preview = internalQuery({
  args,
  handler: async (ctx, { householdName, from, to }) => {
    const household = await resolve(ctx, householdName);
    const txs = await ctx.db
      .query("transactions")
      .withIndex("by_household_date", (q) =>
        q.eq("householdId", household._id).gte("occurredOn", from).lte("occurredOn", to),
      )
      .collect();

    const byDirection: Record<string, number> = {};
    let total = 0;
    for (const t of txs) {
      byDirection[t.direction] = (byDirection[t.direction] ?? 0) + 1;
      total += t.direction === "income" ? t.amount : -t.amount;
    }

    return {
      household: household.name,
      range: `${from} → ${to}`,
      count: txs.length,
      byDirection,
      netAmount: total,
      // Enough to recognise the batch, not enough to fill a terminal.
      sample: txs
        .slice(0, 8)
        .map((t) => `${t.occurredOn} ${t.direction} ${t.amount / 100} ${t.payee ?? ""}`),
    };
  },
});

export const removeRange = internalMutation({
  args: { ...args, expect: v.number() },
  handler: async (ctx, { householdName, from, to, expect }) => {
    const household = await resolve(ctx, householdName);
    const txs = await ctx.db
      .query("transactions")
      .withIndex("by_household_date", (q) =>
        q.eq("householdId", household._id).gte("occurredOn", from).lte("occurredOn", to),
      )
      .collect();

    if (txs.length !== expect) {
      throw new Error(
        `Refusing: ${txs.length} transactions in ${from} → ${to}, but you expected ${expect}. ` +
          `Run maintenance:preview and pass the count it reports.`,
      );
    }

    let fundingRows = 0;
    for (const t of txs) {
      const funding = await ctx.db
        .query("transactionFunding")
        .withIndex("by_transaction", (q) => q.eq("transactionId", t._id))
        .collect();
      for (const f of funding) {
        await ctx.db.delete(f._id);
        fundingRows += 1;
      }
      await ctx.db.delete(t._id);
    }

    return {
      household: household.name,
      deleted: txs.length,
      fundingRows,
      range: `${from} → ${to}`,
    };
  },
});

/**
 * Repairing rows filed under the wrong category.
 *
 * Before the importer learned to match a category by its side of the ledger and
 * to ignore archived names, an import could bind a row to an archived category
 * of the wrong kind. Such a row is stuck: the category is hidden in Settings and
 * absent from the form's picker, so there is no way to point it somewhere else
 * from inside the app — and if the kind is wrong, the month lists it under
 * neither Needs nor Wants while still counting it.
 *
 * Two ways out, depending on which is true:
 *   - the category itself is worth keeping → `reviveCategory` brings it back and
 *     corrects its kind, and every row it holds is fixed at once
 *   - the rows belong somewhere else → `refile` moves them
 *
 *   npx convex run maintenance:strays '{}' --prod
 *   npx convex run maintenance:reviveCategory '{"categoryId":"…","kind":"discretionary","icon":"sparkle","color":"#A855F7"}' --prod
 *   npx convex run maintenance:refile '{"from":"…","to":"…","expect":1}' --prod
 */

/** Every transaction whose category is archived or on the wrong side. */
export const strays = internalQuery({
  args: { householdName: v.optional(v.string()) },
  handler: async (ctx, { householdName }) => {
    const household = await resolve(ctx, householdName);
    const [txs, categories] = await Promise.all([
      ctx.db
        .query("transactions")
        .withIndex("by_household_date", (q) => q.eq("householdId", household._id))
        .collect(),
      ctx.db
        .query("categories")
        .withIndex("by_household", (q) => q.eq("householdId", household._id))
        .collect(),
    ]);
    const byId = new Map(categories.map((c) => [c._id, c]));

    // A list, not a keyed object: Convex field names are plain ASCII, and a
    // grouping key built from a category's own name is not.
    const found = new Map<
      string,
      { category: string; categoryId: string; reason: string; rows: string[] }
    >();
    for (const t of txs) {
      if (!t.categoryId) continue;
      const cat = byId.get(t.categoryId);
      const wrongSide = cat && (cat.kind === "income") !== (t.direction === "income");
      if (cat && !cat.isArchived && !wrongSide) continue;

      const reason = !cat
        ? "category no longer exists"
        : [cat.isArchived && "archived", wrongSide && `kind is ${cat.kind}`]
            .filter(Boolean)
            .join(", ");
      let entry = found.get(t.categoryId);
      if (!entry) {
        entry = {
          category: cat?.name ?? "(deleted)",
          categoryId: t.categoryId,
          reason,
          rows: [],
        };
        found.set(t.categoryId, entry);
      }
      entry.rows.push(
        `${t.occurredOn} ${t.direction} ${t.amount / 100} ${t.payee ?? ""}`.trim(),
      );
    }
    return [...found.values()];
  },
});

/** Bring an archived category back, correcting what was wrong with it. */
export const reviveCategory = internalMutation({
  args: {
    categoryId: v.id("categories"),
    kind: v.optional(
      v.union(v.literal("committed"), v.literal("discretionary"), v.literal("income")),
    ),
    name: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, { categoryId, kind, name, icon, color }) => {
    const cat = await ctx.db.get(categoryId);
    if (!cat) throw new Error("No such category");

    // Changing the kind moves every row it holds to the other side of the
    // ledger, so the rows have to agree with it.
    if (kind) {
      const txs = await ctx.db
        .query("transactions")
        .withIndex("by_household_date", (q) => q.eq("householdId", cat.householdId))
        .collect();
      const held = txs.filter((t) => t.categoryId === categoryId);
      const clash = held.find((t) => (t.direction === "income") !== (kind === "income"));
      if (clash) {
        throw new Error(
          `Refusing: "${cat.name}" holds a ${clash.direction} on ${clash.occurredOn}, ` +
            `which cannot sit in a category of kind "${kind}". Refile that row first.`,
        );
      }
    }

    await ctx.db.patch(categoryId, {
      isArchived: false,
      ...(kind && { kind }),
      ...(name && { name }),
      ...(icon && { icon }),
      ...(color && { color }),
    });
    const after = await ctx.db.get(categoryId);
    return { name: after!.name, kind: after!.kind, icon: after!.icon };
  },
});

/** Move every transaction from one category to another. */
export const refile = internalMutation({
  args: {
    from: v.id("categories"),
    /** An existing destination… */
    to: v.optional(v.id("categories")),
    /** …or a new one, for when nothing suitable exists to move the rows into. */
    toNew: v.optional(
      v.object({
        name: v.string(),
        kind: v.union(
          v.literal("committed"),
          v.literal("discretionary"),
          v.literal("income"),
        ),
        icon: v.string(),
        color: v.string(),
      }),
    ),
    expect: v.number(),
    /** Move only the rows whose direction disagrees with this category. */
    strayRows: v.optional(v.boolean()),
  },
  handler: async (ctx, { from, to, toNew, expect, strayRows }) => {
    const source = await ctx.db.get(from);
    if (!source) throw new Error("No such category");
    if (!to === !toNew) throw new Error("Give either `to` or `toNew`, not both");

    if (!to) {
      const siblings = await ctx.db
        .query("categories")
        .withIndex("by_household", (q) => q.eq("householdId", source.householdId))
        .collect();
      const clash = siblings.find(
        (c) =>
          c.name.toLowerCase() === toNew!.name.toLowerCase() &&
          (c.kind === "income") === (toNew!.kind === "income") &&
          !c.isArchived,
      );
      to =
        clash?._id ??
        (await ctx.db.insert("categories", {
          householdId: source.householdId,
          ...toNew!,
          sortOrder: siblings.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1,
          isArchived: false,
        }));
    }

    const target = await ctx.db.get(to);
    if (!target) throw new Error("No such category");
    if (source.householdId !== target.householdId) {
      throw new Error("Refusing: those categories belong to different households");
    }

    const txs = await ctx.db
      .query("transactions")
      .withIndex("by_household_date", (q) => q.eq("householdId", source.householdId))
      .collect();
    const all = txs.filter((t) => t.categoryId === from);
    // A live category usually holds one wrong row among many right ones — a
    // single income filed under a spending category. `strays` takes just those
    // and leaves the rest where they are.
    const held = strayRows
      ? all.filter((t) => (t.direction === "income") !== (source.kind === "income"))
      : all;

    if (held.length !== expect) {
      throw new Error(
        `Refusing: "${source.name}" holds ${held.length} ${strayRows ? "stray " : ""}rows, ` +
          `but you expected ${expect}. Run maintenance:strays and pass the count it reports.`,
      );
    }
    const clash = held.find(
      (t) => (t.direction === "income") !== (target.kind === "income"),
    );
    if (clash) {
      throw new Error(
        `Refusing: a ${clash.direction} on ${clash.occurredOn} cannot move into ` +
          `"${target.name}", which is of kind "${target.kind}".`,
      );
    }

    for (const t of held) await ctx.db.patch(t._id, { categoryId: to });
    return { moved: held.length, from: source.name, to: target.name };
  },
});
