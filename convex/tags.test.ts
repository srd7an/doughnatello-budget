import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Tags — a second axis across transactions, and the rule that makes them safe:
 * they count nothing. Every test here that touches money proves the figure did
 * NOT move.
 */

const asA = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "user-a" });

async function setup() {
  const t = convexTest(schema);
  const householdId = await asA(t).mutation(api.households.create, {
    name: "Home",
    displayName: "Me",
  });
  const categories = await asA(t).query(api.categories.list, { householdId });
  const income = categories.find((c) => c.kind === "income")!;
  const grocery = categories.find((c) => c.name === "Grocery")!;
  return { t, householdId, incomeCat: income._id, groceryCat: grocery._id };
}

async function spend(
  t: ReturnType<typeof convexTest>,
  householdId: Id<"households">,
  categoryId: Id<"categories">,
  amount: number,
  occurredOn: string,
  tagIds?: Id<"tags">[],
) {
  return await asA(t).mutation(api.transactions.create, {
    householdId,
    direction: "expense",
    amount,
    categoryId,
    occurredOn,
    payee: "Taverna",
    tagIds,
  });
}

describe("tags", () => {
  test("a tag is created, listed, and counts what wears it", async () => {
    const { t, householdId, groceryCat } = await setup();
    const tagId = await asA(t).mutation(api.tags.create, {
      householdId,
      name: "Grčka 2026",
    });

    await spend(t, householdId, groceryCat, 5_000_00, "2026-07-10", [tagId]);
    await spend(t, householdId, groceryCat, 3_000_00, "2026-07-11", [tagId]);
    await spend(t, householdId, groceryCat, 1_000_00, "2026-07-12");

    const tags = await asA(t).query(api.tags.list, { householdId });
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe("Grčka 2026");
    expect(tags[0].count).toBe(2);
  });

  test("the same name twice is refused, whatever the case", async () => {
    const { t, householdId } = await setup();
    await asA(t).mutation(api.tags.create, { householdId, name: "Grčka 2026" });
    await expect(
      asA(t).mutation(api.tags.create, { householdId, name: "  grčka 2026 " }),
    ).rejects.toThrow(/already exists/);
  });

  test("a tag moves no money: totals are identical with and without it", async () => {
    const { t, householdId, incomeCat, groceryCat } = await setup();
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "income",
      amount: 300_000_00,
      categoryId: incomeCat,
      occurredOn: "2026-07-01",
    });
    const before = await asA(t).query(api.overview.month, {
      householdId,
      month: "2026-07",
    });

    const tagId = await asA(t).mutation(api.tags.create, {
      householdId,
      name: "Grčka 2026",
    });
    const txId = await spend(
      t,
      householdId,
      groceryCat,
      10_000_00,
      "2026-07-05",
    );
    const withSpend = await asA(t).query(api.overview.month, {
      householdId,
      month: "2026-07",
    });

    await asA(t).mutation(api.tags.setForTransaction, {
      transactionId: txId,
      tagIds: [tagId],
    });
    const after = await asA(t).query(api.overview.month, {
      householdId,
      month: "2026-07",
    });

    expect(withSpend.leftToSpend).toBe(before.leftToSpend - 10_000_00);
    // Tagging it changed nothing at all.
    expect(after).toEqual(withSpend);
  });

  test("detail keeps spending, income and money set aside apart", async () => {
    const { t, householdId, incomeCat, groceryCat } = await setup();
    const tagId = await asA(t).mutation(api.tags.create, {
      householdId,
      name: "Grčka 2026",
    });
    const potId = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Holiday",
      kind: "sinking",
      icon: "palm",
      color: "#14B8A6",
    });

    await spend(t, householdId, groceryCat, 8_000_00, "2026-07-10", [tagId]);
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "income",
      amount: 2_000_00,
      categoryId: incomeCat,
      occurredOn: "2026-07-20",
      payee: "Airline refund",
      tagIds: [tagId],
    });
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 50_000_00,
      potId,
      occurredOn: "2026-03-01",
      tagIds: [tagId],
    });

    const detail = await asA(t).query(api.tags.detail, { tagId });
    expect(detail.spent).toBe(8_000_00);
    expect(detail.received).toBe(2_000_00);
    expect(detail.setAside).toBe(50_000_00);
    expect(detail.count).toBe(3);
    // All of time, not a month — the transfer in March is part of the holiday.
    expect(detail.firstOn).toBe("2026-03-01");
    expect(detail.lastOn).toBe("2026-07-20");
    expect(detail.byCategory).toHaveLength(1);
    expect(detail.byCategory[0].total).toBe(8_000_00);
  });

  test("applyToMany tags a batch, and is idempotent both ways", async () => {
    const { t, householdId, groceryCat } = await setup();
    const tagId = await asA(t).mutation(api.tags.create, {
      householdId,
      name: "Grčka 2026",
    });
    const ids = [
      await spend(t, householdId, groceryCat, 1_000_00, "2026-07-10"),
      await spend(t, householdId, groceryCat, 2_000_00, "2026-07-11"),
      await spend(t, householdId, groceryCat, 3_000_00, "2026-07-12"),
    ];

    expect(
      await asA(t).mutation(api.tags.applyToMany, {
        tagId,
        transactionIds: ids,
        on: true,
      }),
    ).toEqual({ changed: 3 });
    // Running it again writes nothing.
    expect(
      await asA(t).mutation(api.tags.applyToMany, {
        tagId,
        transactionIds: ids,
        on: true,
      }),
    ).toEqual({ changed: 0 });
    expect((await asA(t).query(api.tags.detail, { tagId })).spent).toBe(
      6_000_00,
    );

    await asA(t).mutation(api.tags.applyToMany, {
      tagId,
      transactionIds: [ids[0]],
      on: false,
    });
    expect((await asA(t).query(api.tags.detail, { tagId })).count).toBe(2);
  });

  test("setForTransaction replaces the set, and the same tag twice is once", async () => {
    const { t, householdId, groceryCat } = await setup();
    const a = await asA(t).mutation(api.tags.create, {
      householdId,
      name: "Grčka 2026",
    });
    const b = await asA(t).mutation(api.tags.create, {
      householdId,
      name: "Svadba",
    });
    const txId = await spend(
      t,
      householdId,
      groceryCat,
      1_000_00,
      "2026-07-10",
    );

    await asA(t).mutation(api.tags.setForTransaction, {
      transactionId: txId,
      tagIds: [a, a, b],
    });
    expect(
      await asA(t).query(api.tags.forTransaction, { transactionId: txId }),
    ).toHaveLength(2);

    await asA(t).mutation(api.tags.setForTransaction, {
      transactionId: txId,
      tagIds: [b],
    });
    expect(
      await asA(t).query(api.tags.forTransaction, { transactionId: txId }),
    ).toEqual([b]);
  });

  test("an edit that does not mention tags keeps them", async () => {
    const { t, householdId, groceryCat } = await setup();
    const tagId = await asA(t).mutation(api.tags.create, {
      householdId,
      name: "Grčka 2026",
    });
    const txId = await spend(
      t,
      householdId,
      groceryCat,
      1_000_00,
      "2026-07-10",
      [tagId],
    );
    await asA(t).mutation(api.transactions.update, {
      transactionId: txId,
      payee: "Konoba",
    });
    expect(
      await asA(t).query(api.tags.forTransaction, { transactionId: txId }),
    ).toEqual([tagId]);
  });

  test("rows carry their tags, and deleting a transaction takes its labels", async () => {
    const { t, householdId, groceryCat } = await setup();
    const tagId = await asA(t).mutation(api.tags.create, {
      householdId,
      name: "Grčka 2026",
    });
    const txId = await spend(
      t,
      householdId,
      groceryCat,
      1_000_00,
      "2026-07-10",
      [tagId],
    );

    const rows = await asA(t).query(api.transactions.listMonth, {
      householdId,
      month: "2026-07",
    });
    expect(rows[0].tags.map((x) => x.name)).toEqual(["Grčka 2026"]);

    await asA(t).mutation(api.transactions.remove, { transactionId: txId });
    const links = await t.run(async (ctx) =>
      ctx.db
        .query("transactionTags")
        .filter((q) => q.eq(q.field("transactionId"), txId))
        .collect(),
    );
    expect(links).toHaveLength(0);
    expect((await asA(t).query(api.tags.detail, { tagId })).count).toBe(0);
  });

  test("a live tag cannot be deleted; an archived one goes, labels and all", async () => {
    const { t, householdId, groceryCat } = await setup();
    const tagId = await asA(t).mutation(api.tags.create, {
      householdId,
      name: "Grčka 2026",
    });
    const txId = await spend(
      t,
      householdId,
      groceryCat,
      1_000_00,
      "2026-07-10",
      [tagId],
    );

    await expect(asA(t).mutation(api.tags.remove, { tagId })).rejects.toThrow(
      /Archive it first/,
    );

    await asA(t).mutation(api.tags.archive, { tagId });
    // Archived tags leave the pickers but keep their rows.
    expect(await asA(t).query(api.tags.list, { householdId })).toHaveLength(0);
    expect(
      await asA(t).query(api.tags.list, { householdId, includeArchived: true }),
    ).toHaveLength(1);

    await asA(t).mutation(api.tags.remove, { tagId });
    const links = await t.run(async (ctx) =>
      ctx.db
        .query("transactionTags")
        .filter((q) => q.eq(q.field("transactionId"), txId))
        .collect(),
    );
    expect(links).toHaveLength(0);
    // The transaction itself is untouched — a tag never took money with it.
    const tx = await asA(t).query(api.transactions.get, {
      transactionId: txId,
    });
    expect(tx.amount).toBe(1_000_00);
  });
});
