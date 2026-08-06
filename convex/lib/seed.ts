import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

/**
 * Sensible starting data created with every household, so a new user lands on
 * something usable instead of an empty app.
 *
 * Seeds the one primary account and a set of default categories. It does NOT
 * seed pots or assets — those are personal (a car fund, a specific loan) and
 * are added by the user.
 *
 * Category kinds are about OBLIGATION, not amount stability:
 *  - committed ("Needs"): unavoidable — groceries, bills, rent, loan-ish.
 *  - discretionary ("Wants"): chosen — takeout, travel, gifts.
 * `icon` is a string key the frontend maps to a glyph; `color` is category
 * identity (not status).
 */

type SeedCategory = {
  name: string;
  kind: "income" | "committed" | "discretionary";
  icon: string;
  color: string;
};

const DEFAULT_CATEGORIES: SeedCategory[] = [
  { name: "Income", kind: "income", icon: "wallet", color: "#1D9E75" },
  { name: "Grocery", kind: "committed", icon: "basket", color: "#E8632A" },
  { name: "Bills", kind: "committed", icon: "bulb", color: "#E0A400" },
  { name: "Housing", kind: "committed", icon: "home", color: "#EA580C" },
  { name: "Car", kind: "committed", icon: "car", color: "#D6336C" },
  { name: "Fuel", kind: "committed", icon: "fuel", color: "#EC4899" },
  { name: "Health", kind: "committed", icon: "flower", color: "#22C55E" },
  { name: "Fitness", kind: "discretionary", icon: "dumbbell", color: "#16A34A" },
  { name: "Pets", kind: "discretionary", icon: "paw", color: "#B45309" },
  { name: "Takeout", kind: "discretionary", icon: "utensils", color: "#DB2777" },
  { name: "Travel", kind: "discretionary", icon: "plane", color: "#65A30D" },
  { name: "Gift", kind: "discretionary", icon: "gift", color: "#3B82F6" },
];

/** Insert the primary account + default categories for a fresh household. */
export async function seedHousehold(
  ctx: MutationCtx,
  householdId: Id<"households">,
) {
  await ctx.db.insert("accounts", {
    householdId,
    name: "Main account",
    icon: "bank",
    bankBalance: 0,
    isPrimary: true,
    isArchived: false,
  });

  let sortOrder = 0;
  for (const c of DEFAULT_CATEGORIES) {
    await ctx.db.insert("categories", {
      householdId,
      name: c.name,
      kind: c.kind,
      icon: c.icon,
      color: c.color,
      sortOrder: sortOrder++,
      isArchived: false,
    });
  }
}
