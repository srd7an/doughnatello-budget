import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { firstDue, nextDue, dueDatesThrough } from "./lib/recurrence";

/**
 * Phase 9: recurring rules and their occurrences.
 *
 * The date math is tested on its own (it is pure), then the generation path is
 * tested for the two properties that matter: it is idempotent on (ruleId,
 * dueOn), and a posted occurrence produces the same funding rows an equivalent
 * manual transaction would.
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
  return {
    t,
    householdId,
    incomeCat: categories.find((c) => c.kind === "income")!._id,
    groceryCat: categories.find((c) => c.name === "Grocery")!._id,
  };
}

async function funding(
  t: ReturnType<typeof convexTest>,
  txId: Id<"transactions">,
) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("transactionFunding")
      .filter((q) => q.eq(q.field("transactionId"), txId))
      .collect(),
  );
}

const monthly = (anchorDay: number) => ({
  cadence: "monthly" as const,
  intervalCount: 1,
  anchorDay,
});

describe("recurrence date math", () => {
  test("a month-end anchor clamps but never walks backwards", () => {
    const r = monthly(31);
    expect(nextDue("2026-01-31", r)).toBe("2026-02-28");
    // The anchor is still 31 — February must not become the new anchor.
    expect(nextDue("2026-02-28", r)).toBe("2026-03-31");
    expect(nextDue("2026-03-31", r)).toBe("2026-04-30");
    expect(nextDue("2026-04-30", r)).toBe("2026-05-31");
  });

  test("February clamps to 29 in a leap year", () => {
    expect(nextDue("2028-01-31", monthly(31))).toBe("2028-02-29");
  });

  test("monthly rolls the year at December", () => {
    expect(nextDue("2026-12-15", monthly(15))).toBe("2027-01-15");
  });

  test("an interval greater than one skips months", () => {
    expect(
      nextDue("2026-01-15", { cadence: "monthly", intervalCount: 3, anchorDay: 15 }),
    ).toBe("2026-04-15");
  });

  test("weekly ignores the anchor and adds whole weeks", () => {
    const r = { cadence: "weekly" as const, intervalCount: 2, anchorDay: 1 };
    expect(nextDue("2026-07-01", r)).toBe("2026-07-15");
    // Across a month boundary.
    expect(nextDue("2026-07-29", r)).toBe("2026-08-12");
  });

  test("a 29 February yearly rule clamps in common years and recovers", () => {
    const r = { cadence: "yearly" as const, intervalCount: 1, anchorDay: 29 };
    expect(nextDue("2028-02-29", r)).toBe("2029-02-28");
    expect(nextDue("2031-02-28", r)).toBe("2032-02-29");
  });

  test("firstDue takes the anchor in the start month, else the next one", () => {
    expect(firstDue("2026-07-01", monthly(10))).toBe("2026-07-10");
    expect(firstDue("2026-07-20", monthly(10))).toBe("2026-08-10");
    expect(firstDue("2026-07-10", monthly(10))).toBe("2026-07-10"); // inclusive
    expect(firstDue("2026-01-31", monthly(31))).toBe("2026-01-31");
  });

  test("dueDatesThrough is inclusive of `through` and stops at untilDate", () => {
    expect(dueDatesThrough("2026-01-15", "2026-04-15", monthly(15))).toEqual([
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
      "2026-04-15",
    ]);
    expect(
      dueDatesThrough("2026-01-15", "2026-12-15", monthly(15), "2026-03-01"),
    ).toEqual(["2026-01-15", "2026-02-15"]);
  });
});

describe("rule creation", () => {
  test("an estimate rule may not auto-post", async () => {
    const { t, householdId, groceryCat } = await setup();
    await expect(
      asA(t).mutation(api.recurring.create, {
        householdId,
        direction: "expense",
        amount: 5_000_00,
        amountMode: "estimate",
        categoryId: groceryCat,
        cadence: "monthly",
        startOn: "2026-07-05",
        autoPost: true,
      }),
    ).rejects.toThrow(/estimate/);
  });

  test("anchorDay defaults to the day of startOn", async () => {
    const { t, householdId, groceryCat } = await setup();
    const ruleId = await asA(t).mutation(api.recurring.create, {
      householdId,
      direction: "expense",
      amount: 5_000_00,
      amountMode: "exact",
      categoryId: groceryCat,
      cadence: "monthly",
      startOn: "2026-07-05",
    });
    const rule = await t.run(async (ctx) => await ctx.db.get(ruleId));
    expect(rule!.anchorDay).toBe(5);
    expect(rule!.nextDueOn).toBe("2026-07-05");
  });

  test("a transfer rule needs a pot and refuses a category", async () => {
    const { t, householdId, groceryCat } = await setup();
    await expect(
      asA(t).mutation(api.recurring.create, {
        householdId,
        direction: "transfer",
        amount: 10_000_00,
        amountMode: "exact",
        cadence: "monthly",
        startOn: "2026-07-01",
      }),
    ).rejects.toThrow(/destination pot/);

    await expect(
      asA(t).mutation(api.recurring.create, {
        householdId,
        direction: "transfer",
        amount: 10_000_00,
        amountMode: "exact",
        categoryId: groceryCat,
        cadence: "monthly",
        startOn: "2026-07-01",
      }),
    ).rejects.toThrow(/uncategorised/);
  });
});

describe("occurrence generation", () => {
  test("sync materialises one pending occurrence per due date", async () => {
    const { t, householdId, groceryCat } = await setup();
    await asA(t).mutation(api.recurring.create, {
      householdId,
      direction: "expense",
      amount: 5_000_00,
      amountMode: "exact",
      categoryId: groceryCat,
      cadence: "monthly",
      startOn: "2026-05-10",
    });

    const result = await asA(t).mutation(api.recurring.sync, {
      householdId,
      through: "2026-07-31",
    });
    expect(result).toEqual({ created: 3, posted: 0 }); // May, June, July

    const due = await asA(t).query(api.recurring.listDue, {
      householdId,
      through: "2026-07-31",
    });
    expect(due.map((d) => d.dueOn)).toEqual([
      "2026-05-10",
      "2026-06-10",
      "2026-07-10",
    ]);
  });

  test("syncing twice creates nothing the second time", async () => {
    const { t, householdId, groceryCat } = await setup();
    await asA(t).mutation(api.recurring.create, {
      householdId,
      direction: "expense",
      amount: 5_000_00,
      amountMode: "exact",
      categoryId: groceryCat,
      cadence: "monthly",
      startOn: "2026-05-10",
    });

    await asA(t).mutation(api.recurring.sync, { householdId, through: "2026-07-31" });
    const second = await asA(t).mutation(api.recurring.sync, {
      householdId,
      through: "2026-07-31",
    });
    expect(second).toEqual({ created: 0, posted: 0 });

    const all = await t.run(async (ctx) =>
      ctx.db.query("recurringOccurrences").collect(),
    );
    expect(all).toHaveLength(3);
  });

  test("the nightly sweep and an app-open sync do not double-post", async () => {
    const { t, householdId, incomeCat } = await setup();
    await asA(t).mutation(api.recurring.create, {
      householdId,
      direction: "income",
      amount: 300_000_00,
      amountMode: "exact",
      categoryId: incomeCat,
      cadence: "monthly",
      startOn: "2026-07-01",
      autoPost: true,
      payee: "Salary",
    });

    const swept = await t.mutation(internal.recurring.sweep, {
      through: "2026-07-31",
    });
    expect(swept.posted).toBe(1);
    const synced = await asA(t).mutation(api.recurring.sync, {
      householdId,
      through: "2026-07-31",
    });
    expect(synced).toEqual({ created: 0, posted: 0 });

    const txs = await asA(t).query(api.transactions.listMonth, {
      householdId,
      month: "2026-07",
    });
    expect(txs).toHaveLength(1);
    expect(txs[0].amount).toBe(300_000_00);
  });

  test("untilDate ends the rule and deactivates it", async () => {
    const { t, householdId, groceryCat } = await setup();
    const ruleId = await asA(t).mutation(api.recurring.create, {
      householdId,
      direction: "expense",
      amount: 1_000_00,
      amountMode: "exact",
      categoryId: groceryCat,
      cadence: "monthly",
      startOn: "2026-01-15",
      untilDate: "2026-03-31",
    });
    const result = await asA(t).mutation(api.recurring.sync, {
      householdId,
      through: "2026-12-31",
    });
    expect(result.created).toBe(3); // Jan, Feb, Mar
    const rule = await t.run(async (ctx) => await ctx.db.get(ruleId));
    expect(rule!.isActive).toBe(false);
  });

  test("a paused rule generates nothing, and resuming does not back-fill", async () => {
    const { t, householdId, groceryCat } = await setup();
    const ruleId = await asA(t).mutation(api.recurring.create, {
      householdId,
      direction: "expense",
      amount: 1_000_00,
      amountMode: "exact",
      categoryId: groceryCat,
      cadence: "monthly",
      startOn: "2026-01-15",
    });
    await asA(t).mutation(api.recurring.setActive, { ruleId, isActive: false });

    const paused = await asA(t).mutation(api.recurring.sync, {
      householdId,
      through: "2026-06-30",
    });
    expect(paused).toEqual({ created: 0, posted: 0 });

    // Resuming rolls nextDueOn forward to a date that is not in the past, so
    // the months spent paused are not billed retroactively.
    await asA(t).mutation(api.recurring.setActive, { ruleId, isActive: true });
    const rule = await t.run(async (ctx) => await ctx.db.get(ruleId));
    expect(rule!.nextDueOn >= new Date().toISOString().slice(0, 10)).toBe(true);
  });
});

describe("settling an occurrence", () => {
  async function dueGroceryOccurrence(estimate = false) {
    const { t, householdId, groceryCat } = await setup();
    await asA(t).mutation(api.recurring.create, {
      householdId,
      direction: "expense",
      amount: 5_000_00,
      amountMode: estimate ? "estimate" : "exact",
      categoryId: groceryCat,
      cadence: "monthly",
      startOn: "2026-07-10",
      payee: "Landlord",
    });
    await asA(t).mutation(api.recurring.sync, { householdId, through: "2026-07-31" });
    const [due] = await asA(t).query(api.recurring.listDue, {
      householdId,
      through: "2026-07-31",
    });
    return { t, householdId, due };
  }

  test("confirming posts a transaction funded exactly like a manual one", async () => {
    const { t, due } = await dueGroceryOccurrence();
    const txId = await asA(t).mutation(api.recurring.confirm, {
      occurrenceId: due._id,
    });
    const rows = await funding(t, txId);
    expect(rows).toHaveLength(1);
    expect(rows[0].potId).toBeUndefined(); // reduces left to spend
    expect(rows[0].amount).toBe(5_000_00);
  });

  test("an estimate can be confirmed at the amount that actually arrived", async () => {
    const { t, householdId, due } = await dueGroceryOccurrence(true);
    const txId = await asA(t).mutation(api.recurring.confirm, {
      occurrenceId: due._id,
      amount: 6_432_00,
    });
    const tx = await asA(t).query(api.transactions.get, { transactionId: txId });
    expect(tx.amount).toBe(6_432_00);
    expect(tx.occurredOn).toBe("2026-07-10");
    const summary = await asA(t).query(api.overview.month, {
      householdId,
      month: "2026-07",
    });
    expect(summary.expense).toBe(6_432_00);
  });

  test("a pot-funded rule does not reduce left to spend", async () => {
    const { t, householdId, groceryCat } = await setup();
    const pot = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Car fund",
      kind: "sinking",
      icon: "car",
      color: "#1D9E75",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 20_000_00,
      potId: pot,
      occurredOn: "2026-07-01",
    });
    await asA(t).mutation(api.recurring.create, {
      householdId,
      direction: "expense",
      amount: 3_000_00,
      amountMode: "exact",
      categoryId: groceryCat,
      fundedFromPotId: pot,
      cadence: "monthly",
      startOn: "2026-07-10",
    });
    await asA(t).mutation(api.recurring.sync, { householdId, through: "2026-07-31" });
    const [due] = await asA(t).query(api.recurring.listDue, {
      householdId,
      through: "2026-07-31",
    });
    const txId = await asA(t).mutation(api.recurring.confirm, {
      occurrenceId: due._id,
    });

    const rows = await funding(t, txId);
    expect(rows).toHaveLength(1);
    expect(rows[0].potId).toBe(pot); // paid from the pot, not from income
    const balances = await asA(t).query(api.pots.balances, { householdId });
    expect(balances.find((b) => b._id === pot)!.balance).toBe(17_000_00);
  });

  test("skipping settles the occurrence without creating money", async () => {
    const { t, householdId, due } = await dueGroceryOccurrence();
    await asA(t).mutation(api.recurring.skip, { occurrenceId: due._id });
    expect(
      await asA(t).query(api.recurring.listDue, { householdId, through: "2026-07-31" }),
    ).toHaveLength(0);
    expect(
      await asA(t).query(api.transactions.listMonth, {
        householdId,
        month: "2026-07",
      }),
    ).toHaveLength(0);
  });

  test("an occurrence cannot be settled twice", async () => {
    const { t, due } = await dueGroceryOccurrence();
    await asA(t).mutation(api.recurring.confirm, { occurrenceId: due._id });
    await expect(
      asA(t).mutation(api.recurring.confirm, { occurrenceId: due._id }),
    ).rejects.toThrow(/already settled/);
    await expect(
      asA(t).mutation(api.recurring.skip, { occurrenceId: due._id }),
    ).rejects.toThrow(/already settled/);
  });

  test("deleting a rule keeps the money it already posted", async () => {
    const { t, householdId, due } = await dueGroceryOccurrence();
    await asA(t).mutation(api.recurring.confirm, { occurrenceId: due._id });
    await asA(t).mutation(api.recurring.remove, { ruleId: due.ruleId });
    expect(
      await asA(t).query(api.transactions.listMonth, {
        householdId,
        month: "2026-07",
      }),
    ).toHaveLength(1);
  });
});

describe("cross-household isolation for recurring", () => {
  async function twoHouseholds() {
    const t = convexTest(schema);
    const hA = await asA(t).mutation(api.households.create, {
      name: "A",
      displayName: "A",
    });
    const asB = t.withIdentity({ subject: "user-b" });
    const hB = await asB.mutation(api.households.create, {
      name: "B",
      displayName: "B",
    });
    const catsB = await asB.query(api.categories.list, { householdId: hB });
    const ruleB = await asB.mutation(api.recurring.create, {
      householdId: hB,
      direction: "expense",
      amount: 5_000_00,
      amountMode: "exact",
      categoryId: catsB.find((c) => c.kind !== "income")!._id,
      cadence: "monthly",
      startOn: "2026-07-10",
    });
    await asB.mutation(api.recurring.sync, { householdId: hB, through: "2026-07-31" });
    const [dueB] = await asB.query(api.recurring.listDue, {
      householdId: hB,
      through: "2026-07-31",
    });
    return { t, hA, hB, ruleB, dueB };
  }

  test("A cannot read, sync, settle or delete B's recurring data", async () => {
    const { t, hB, ruleB, dueB } = await twoHouseholds();
    const a = asA(t);
    await expect(
      a.query(api.recurring.listRules, { householdId: hB }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      a.query(api.recurring.listDue, { householdId: hB }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      a.mutation(api.recurring.sync, { householdId: hB }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      a.mutation(api.recurring.update, { ruleId: ruleB, amount: 1 }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      a.mutation(api.recurring.setActive, { ruleId: ruleB, isActive: false }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      a.mutation(api.recurring.remove, { ruleId: ruleB }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      a.mutation(api.recurring.confirm, { occurrenceId: dueB._id }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      a.mutation(api.recurring.skip, { occurrenceId: dueB._id }),
    ).rejects.toThrow(/Not a member/);
  });

  test("A cannot aim a rule at B's category or pot", async () => {
    const { t, hA, hB } = await twoHouseholds();
    const asB = t.withIdentity({ subject: "user-b" });
    const catsB = await asB.query(api.categories.list, { householdId: hB });
    await expect(
      asA(t).mutation(api.recurring.create, {
        householdId: hA,
        direction: "expense",
        amount: 1_000_00,
        amountMode: "exact",
        categoryId: catsB.find((c) => c.kind !== "income")!._id,
        cadence: "monthly",
        startOn: "2026-07-10",
      }),
    ).rejects.toThrow(/not found/i);
  });

  test("an unauthenticated caller cannot sync", async () => {
    const { t, hB } = await twoHouseholds();
    await expect(t.mutation(api.recurring.sync, { householdId: hB })).rejects.toThrow(
      /Not authenticated/,
    );
  });
});
