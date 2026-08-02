import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

/**
 * Moving money that is already set aside — fund → fund, or fund → back to the
 * general balance.
 *
 * The rule the whole feature rests on: a move is RELABELLING, not saving. The
 * money came off the month once, when it was first set aside. Counting it again
 * would take the same money off twice, so a move must leave income, expense,
 * savings and left-to-spend exactly where it found them, and touch only which
 * fund the money is promised to.
 */
const asA = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "user-a" });

const MONTH = "2026-07";

async function setup() {
  const t = convexTest(schema);
  const householdId = await asA(t).mutation(api.households.create, {
    name: "Home",
    displayName: "Me",
  });
  const cats = await asA(t).query(api.categories.list, { householdId });
  const fund = (name: string) =>
    asA(t).mutation(api.pots.create, {
      householdId,
      name,
      kind: "sinking",
      icon: "piggy",
      color: "#1D9E75",
    });
  const [holiday, repairs] = await Promise.all([fund("Holiday"), fund("Repairs")]);

  // A month's income, and 50.000 of it set aside into Holiday.
  await asA(t).mutation(api.transactions.create, {
    householdId,
    direction: "income",
    amount: 200_000_00,
    categoryId: cats.find((c) => c.kind === "income")!._id,
    occurredOn: `${MONTH}-01`,
  });
  await asA(t).mutation(api.transactions.create, {
    householdId,
    direction: "transfer",
    amount: 50_000_00,
    potId: holiday,
    occurredOn: `${MONTH}-02`,
  });

  const balances = async () =>
    await asA(t).query(api.pots.balances, { householdId });
  const month = async () =>
    await asA(t).query(api.overview.month, { householdId, month: MONTH });

  return {
    t,
    householdId,
    holiday,
    repairs,
    balances,
    month,
    groceryCat: cats.find((c) => c.name === "Grocery")!._id,
  };
}

describe("moving money between funds", () => {
  test("a move empties one fund into the other and leaves the month alone", async () => {
    const { t, householdId, holiday, repairs, balances, month } = await setup();
    const before = await month();

    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 30_000_00,
      fromPotId: holiday,
      potId: repairs,
      occurredOn: `${MONTH}-10`,
    });

    const pots = await balances();
    expect(pots.find((p) => p._id === holiday)!.balance).toBe(20_000_00);
    expect(pots.find((p) => p._id === repairs)!.balance).toBe(30_000_00);

    // Not a second helping of savings, and nothing new spent.
    const after = await month();
    expect(after).toEqual(before);
  });

  test("releasing a fund frees the money without adding to left to spend", async () => {
    const { t, householdId, holiday, month } = await setup();
    const before = await month();
    const account = await asA(t).query(api.accounts.getPrimary, { householdId });
    await asA(t).mutation(api.accounts.setBalance, {
      accountId: account!._id,
      bankBalance: 200_000_00,
    });

    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 20_000_00,
      fromPotId: holiday,
      occurredOn: `${MONTH}-10`,
    });

    // Set aside falls, free rises by the same, the bank is untouched: no money
    // moved, only the promise it was under.
    const b = await asA(t).query(api.overview.balances, { householdId });
    expect(b.inBank).toBe(200_000_00);
    expect(b.setAside).toBe(30_000_00);
    expect(b.free).toBe(170_000_00);

    // July's money is July's. These were set aside earlier and stay that way.
    expect(await month()).toEqual(before);
  });

  test("the year sees the source fall and the destination rise", async () => {
    const { t, householdId, holiday, repairs } = await setup();
    await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 30_000_00,
      fromPotId: holiday,
      potId: repairs,
      occurredOn: `${MONTH}-10`,
    });

    const year = await asA(t).query(api.overview.year, {
      householdId,
      year: "2026",
    });
    const item = (id: string) => year.funds.items.find((i) => i._id === id)!;
    expect(item(holiday).change).toBe(20_000_00); // 50 in, 30 back out
    expect(item(repairs).change).toBe(30_000_00);
    expect(year.funds.balance).toBe(50_000_00); // the pair still holds 50

    // A move is not spending, so it must not show as money paid from funds.
    expect(year.totals.paidFromFunds).toBe(0);
    expect(year.totals.savings).toBe(50_000_00); // only the original set-aside
  });

  test("a fund cannot give more than it holds", async () => {
    const { t, householdId, holiday, repairs } = await setup();
    await expect(
      asA(t).mutation(api.transactions.create, {
        householdId,
        direction: "transfer",
        amount: 60_000_00,
        fromPotId: holiday,
        potId: repairs,
        occurredOn: `${MONTH}-10`,
      }),
    ).rejects.toThrow(/does not hold that much/);
  });

  test("a fund cannot move money to itself", async () => {
    const { t, householdId, holiday } = await setup();
    await expect(
      asA(t).mutation(api.transactions.create, {
        householdId,
        direction: "transfer",
        amount: 1_000_00,
        fromPotId: holiday,
        potId: holiday,
        occurredOn: `${MONTH}-10`,
      }),
    ).rejects.toThrow(/to itself/);
  });

  test("a loan is not somewhere money can be parked", async () => {
    const { t, householdId, holiday } = await setup();
    const loan = await asA(t).mutation(api.pots.create, {
      householdId,
      name: "Car loan",
      kind: "debt",
      icon: "car",
      color: "#B45309",
      originalAmount: 900_000_00,
    });
    await expect(
      asA(t).mutation(api.transactions.create, {
        householdId,
        direction: "transfer",
        amount: 1_000_00,
        fromPotId: holiday,
        potId: loan,
        occurredOn: `${MONTH}-10`,
      }),
    ).rejects.toThrow(/paid off, not moved into/);
  });

  test("a transfer with neither end is refused", async () => {
    const { t, householdId } = await setup();
    await expect(
      asA(t).mutation(api.transactions.create, {
        householdId,
        direction: "transfer",
        amount: 1_000_00,
        occurredOn: `${MONTH}-10`,
      }),
    ).rejects.toThrow(/destination pot/);
  });

  test("only a transfer moves money out of a fund", async () => {
    const { t, householdId, holiday, groceryCat } = await setup();
    await expect(
      asA(t).mutation(api.transactions.create, {
        householdId,
        direction: "expense",
        amount: 1_000_00,
        categoryId: groceryCat,
        fromPotId: holiday,
        occurredOn: `${MONTH}-10`,
      }),
    ).rejects.toThrow(/Only a transfer/);
  });
});

describe("editing a move", () => {
  test("raising it is measured against the fund without its own charge", async () => {
    const { t, householdId, holiday, repairs, balances } = await setup();
    const id = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 30_000_00,
      fromPotId: holiday,
      potId: repairs,
      occurredOn: `${MONTH}-10`,
    });

    // Holiday reads 20.000 with this move in place, but 50.000 without it —
    // and 45.000 is what it can really afford.
    await asA(t).mutation(api.transactions.update, {
      transactionId: id,
      amount: 45_000_00,
    });

    const pots = await balances();
    expect(pots.find((p) => p._id === holiday)!.balance).toBe(5_000_00);
    expect(pots.find((p) => p._id === repairs)!.balance).toBe(45_000_00);
  });

  test("raising it past what the fund holds is still refused", async () => {
    const { t, householdId, holiday, repairs } = await setup();
    const id = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 30_000_00,
      fromPotId: holiday,
      potId: repairs,
      occurredOn: `${MONTH}-10`,
    });
    await expect(
      asA(t).mutation(api.transactions.update, {
        transactionId: id,
        amount: 60_000_00,
      }),
    ).rejects.toThrow(/does not hold that much/);
  });

  test("dropping the source turns a move back into saving", async () => {
    const { t, householdId, holiday, repairs, balances, month } = await setup();
    const id = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 30_000_00,
      fromPotId: holiday,
      potId: repairs,
      occurredOn: `${MONTH}-10`,
    });

    await asA(t).mutation(api.transactions.update, {
      transactionId: id,
      clearFromPot: true,
    });

    // Holiday keeps its 50, Repairs still has its 30 — and the 30 is now money
    // set aside this month, so it comes off left to spend.
    const pots = await balances();
    expect(pots.find((p) => p._id === holiday)!.balance).toBe(50_000_00);
    expect(pots.find((p) => p._id === repairs)!.balance).toBe(30_000_00);
    const m = await month();
    expect(m.savings).toBe(80_000_00);
    expect(m.leftToSpend).toBe(120_000_00);
  });

  test("dropping the destination turns a move into a release", async () => {
    const { t, householdId, holiday, repairs, balances } = await setup();
    const id = await asA(t).mutation(api.transactions.create, {
      householdId,
      direction: "transfer",
      amount: 30_000_00,
      fromPotId: holiday,
      potId: repairs,
      occurredOn: `${MONTH}-10`,
    });

    await asA(t).mutation(api.transactions.update, {
      transactionId: id,
      clearDestination: true,
    });

    const pots = await balances();
    expect(pots.find((p) => p._id === holiday)!.balance).toBe(20_000_00);
    expect(pots.find((p) => p._id === repairs)!.balance).toBe(0);
  });
});
