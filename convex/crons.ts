import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * The nightly half of occurrence generation. `recurring.sync` already covers
 * anyone who opens the app, so this exists for the case a query cannot serve:
 * an autoPost rule (rent, salary) must land on its date whether or not a member
 * logs in that day.
 *
 * 02:00 UTC — after midnight everywhere the app is used, so a rule due "today"
 * is never posted a day early.
 */
const crons = cronJobs();

crons.daily(
  "generate recurring occurrences",
  { hourUTC: 2, minuteUTC: 0 },
  internal.recurring.sweep,
  {},
);

export default crons;
