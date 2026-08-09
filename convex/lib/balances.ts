import { QueryCtx, MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

/**
 * Pot balance = transfers in − expenses funded from it.
 *
 * There is no "transfer out" of a pot in this model: spending a pot's money is
 * a categorised EXPENSE with a transactionFunding row pointing at the pot, not
 * a transfer. So the balance is simply what was moved in, minus what has since
 * been spent against it.
 *
 * Caller must have already asserted membership of `householdId`.
 */
export async function potBalance(
  ctx: Ctx,
  householdId: Id<"households">,
  potId: Id<"pots">,
): Promise<number> {
  // Money moved into the pot: transfer transactions whose potId is this pot.
  const transfers = await ctx.db
    .query("transactions")
    .withIndex("by_household_pot", (q) =>
      q.eq("householdId", householdId).eq("potId", potId),
    )
    .collect();
  const movedIn = transfers
    .filter((t) => t.direction === "transfer")
    .reduce((sum, t) => sum + t.amount, 0);

  // Money spent out of the pot: funding rows pointing at this pot.
  const funding = await ctx.db
    .query("transactionFunding")
    .withIndex("by_household_pot", (q) =>
      q.eq("householdId", householdId).eq("potId", potId),
    )
    .collect();
  const spent = funding.reduce((sum, f) => sum + f.amount, 0);

  return movedIn - spent;
}

/**
 * Amount still owed on a debt pot = originalAmount − payments toward it.
 *
 * A loan payment is an ordinary income-funded EXPENSE (it reduces leftToSpend
 * and shows in its category) that additionally carries `potId = <debt pot>` to
 * mark which loan it pays down. So payments are those expense transactions —
 * distinct from the funding rows used for savings/sinking pots.
 *
 * Net worth SUBTRACTS this (a debt is negative worth).
 */
export async function debtOwed(
  ctx: Ctx,
  householdId: Id<"households">,
  pot: Doc<"pots">,
): Promise<number> {
  const original = pot.originalAmount ?? 0;
  const payments = await ctx.db
    .query("transactions")
    .withIndex("by_household_pot", (q) =>
      q.eq("householdId", householdId).eq("potId", pot._id),
    )
    .collect();
  const paid = payments
    .filter((t) => t.direction === "expense")
    .reduce((sum, t) => sum + t.amount, 0);
  return original - paid;
}

/**
 * What an account holds, derived from its ledger.
 *
 * `bankBalance` is NOT the current balance. It is an OFFSET: whatever has to be
 * added to the recorded flows for the total to match what the bank says. For a
 * household that entered its opening figure as a transaction — which is what
 * the import recipe does — the offset is zero and this is simply the ledger.
 *
 * It used to be the balance itself, typed in and never touched again, so it
 * went stale the moment you recorded anything. Two independent records of the
 * same money is a good idea, but only when one of them keeps itself: otherwise
 * you are maintaining both by hand and reconciling them in your head. This is
 * how every ledger since the invention of ledgers has done it — the running
 * total is derived, and a person only ever states an opening figure or corrects
 * a drift.
 *
 * Transfers are excluded: setting money aside moves it into a fund that is
 * inside this same account.
 */
export async function accountBalance(
  ctx: Ctx,
  account: Doc<"accounts">,
): Promise<number> {
  const txs = await ctx.db
    .query("transactions")
    .withIndex("by_household_date", (q) =>
      q.eq("householdId", account.householdId),
    )
    .collect();

  let flow = 0;
  for (const t of txs) {
    if (t.accountId !== account._id) continue;
    if (t.direction === "income") flow += t.amount;
    else if (t.direction === "expense") flow -= t.amount;
  }
  return account.bankBalance + flow;
}

/** Every non-archived account's balance, summed. */
export async function bankTotal(
  ctx: Ctx,
  householdId: Id<"households">,
): Promise<number> {
  const accounts = await ctx.db
    .query("accounts")
    .withIndex("by_household", (q) => q.eq("householdId", householdId))
    .collect();
  let total = 0;
  for (const a of accounts) {
    if (!a.isArchived) total += await accountBalance(ctx, a);
  }
  return total;
}
