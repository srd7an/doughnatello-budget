/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as assets from "../assets.js";
import type * as auth from "../auth.js";
import type * as categories from "../categories.js";
import type * as crons from "../crons.js";
import type * as devSeed from "../devSeed.js";
import type * as exports from "../exports.js";
import type * as households from "../households.js";
import type * as http from "../http.js";
import type * as imports from "../imports.js";
import type * as invites from "../invites.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_balances from "../lib/balances.js";
import type * as lib_recurrence from "../lib/recurrence.js";
import type * as lib_seed from "../lib/seed.js";
import type * as maintenance from "../maintenance.js";
import type * as overview from "../overview.js";
import type * as pots from "../pots.js";
import type * as recurring from "../recurring.js";
import type * as transactions from "../transactions.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  assets: typeof assets;
  auth: typeof auth;
  categories: typeof categories;
  crons: typeof crons;
  devSeed: typeof devSeed;
  exports: typeof exports;
  households: typeof households;
  http: typeof http;
  imports: typeof imports;
  invites: typeof invites;
  "lib/auth": typeof lib_auth;
  "lib/balances": typeof lib_balances;
  "lib/recurrence": typeof lib_recurrence;
  "lib/seed": typeof lib_seed;
  maintenance: typeof maintenance;
  overview: typeof overview;
  pots: typeof pots;
  recurring: typeof recurring;
  transactions: typeof transactions;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
