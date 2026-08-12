import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const asA = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "user-a" });

/**
 * A fund's page shows a column of figures under its balance, so those figures
 * have to be what happened to THAT fund. They were the transactions' own
 * amounts, which is a different number the moment a bill is bigger than the
 * fund — and the column silently failed to add up to the heading above it.
 */
describe("what each row did to this fund", () => {
  test("the rows sum to the balance", async () => {
    const t = convexTest(schema);
    const householdId = await asA(t).mutation(api.households.create, {
      name: "Home",
      displayName: "Me",
    });
    const cats = await asA(t).query(api.categories.list, { householdId });
    const pot = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Car stuff",
      kind: "sinking",
      icon: "car",
      color: "#1D9E75",
    });

    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 10_000_00,
      potId: pot,
      occurredOn: "2026-01-01",
    });
    // More than it holds: the fund pays all of it and is owed the rest.
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "expense",
      amount: 27_469_00,
      categoryId: cats.find((c) => c.name === "Car")!._id,
      takeFromPotId: pot,
      occurredOn: "2026-01-02",
    });

    const d = await asA(t).query(api.pots.detail, { potId: pot });
    expect(d.balance).toBe(10_000_00 - 27_469_00);

    // The property that was broken: read the column, add it up, get the
    // heading.
    const summed = d.rows.reduce((s, r) => s + r.potAmount, 0);
    expect(summed).toBe(d.balance);
  });

  test("a move counts on both funds, with opposite signs", async () => {
    const t = convexTest(schema);
    const householdId = await asA(t).mutation(api.households.create, {
      name: "Home",
      displayName: "Me",
    });
    const fund = (name: string) =>
      asA(t).mutation(api.pots.create, {
        householdId,
        name,
        kind: "savings",
        icon: "piggy",
        color: "#1D9E75",
      });
    const [a, b] = await Promise.all([fund("A"), fund("B")]);

    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 8_000_00,
      potId: a,
      occurredOn: "2026-01-01",
    });
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 3_000_00,
      fromPotId: a,
      potId: b,
      occurredOn: "2026-01-02",
    });

    const da = await asA(t).query(api.pots.detail, { potId: a });
    const db = await asA(t).query(api.pots.detail, { potId: b });
    expect(da.rows.reduce((s, r) => s + r.potAmount, 0)).toBe(da.balance);
    expect(db.rows.reduce((s, r) => s + r.potAmount, 0)).toBe(db.balance);
    expect(da.balance).toBe(5_000_00);
    expect(db.balance).toBe(3_000_00);
  });
})
