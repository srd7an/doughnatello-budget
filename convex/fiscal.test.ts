import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/**
 * The lookup reaches a government website, so what is pinned here is the part
 * that must hold without one: which URLs it is willing to fetch at all.
 *
 * An action that takes a URL from a client and fetches it is a proxy unless it
 * says otherwise. This one says otherwise.
 */
describe("what the receipt lookup will fetch", () => {
  const run = (url: string) =>
    convexTest(schema).action(api.fiscal.lookup, { url });

  test("anything that is not purs.gov.rs is refused", async () => {
    await expect(run("https://example.com/")).rejects.toThrow(/purs\.gov\.rs/);
  });

  test("a lookalike domain is refused", async () => {
    // The check is on the host ENDING in purs.gov.rs, not containing it.
    await expect(run("https://purs.gov.rs.evil.com/v/")).rejects.toThrow(
      /purs\.gov\.rs/,
    );
  });

  test("plain http is refused even on the right host", async () => {
    await expect(run("http://suf.purs.gov.rs/v/")).rejects.toThrow(/https/);
  });

  test("something that is not a URL at all is refused", async () => {
    await expect(run("suf.purs.gov.rs")).rejects.toThrow(/Not a URL/);
  });

  test("localhost and internal addresses are refused", async () => {
    // The reason the host check exists: without it this action would fetch
    // whatever the caller named, from inside the backend.
    await expect(run("https://127.0.0.1/")).rejects.toThrow(/purs\.gov\.rs/);
    await expect(run("https://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      /purs\.gov\.rs/,
    );
  });
});
