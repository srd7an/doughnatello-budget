import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/**
 * The lookup reaches a government website, so what is pinned here is everything
 * that must hold WITHOUT one: who may call it, and where it is willing to go.
 *
 * An action that takes a URL from a client and fetches it is an open proxy
 * unless it says otherwise twice over — once about who is asking, and once
 * about what they are asking for.
 */
const signedIn = () => convexTest(schema).withIdentity({ subject: "user-a" });

describe("who may ask", () => {
  test("an unauthenticated caller is refused", async () => {
    await expect(
      convexTest(schema).action(api.fiscal.lookup, {
        url: "https://suf.purs.gov.rs/v/?vl=aGk=",
      }),
    ).rejects.toThrow(/Not authenticated/);
  });

  test("and is refused BEFORE the URL is looked at", async () => {
    // Otherwise a stranger could map which hosts are reachable from our backend
    // by reading which error comes back.
    await expect(
      convexTest(schema).action(api.fiscal.lookup, { url: "not a url" }),
    ).rejects.toThrow(/Not authenticated/);
  });
});

describe("where it will go", () => {
  const run = (url: string) => signedIn().action(api.fiscal.lookup, { url });

  test("anything that is not purs.gov.rs is refused", async () => {
    await expect(run("https://example.com/")).rejects.toThrow(/purs\.gov\.rs/);
  });

  test("a lookalike domain is refused", async () => {
    // The check is on the host ENDING in purs.gov.rs, not containing it.
    await expect(run("https://purs.gov.rs.evil.com/v/")).rejects.toThrow(
      /purs\.gov\.rs/,
    );
  });

  test("credentials in the URL do not smuggle another host past it", async () => {
    // "https://suf.purs.gov.rs@evil.com/" has hostname evil.com — not the part
    // before the @ that a person reads first.
    await expect(run("https://suf.purs.gov.rs@evil.com/")).rejects.toThrow(
      /purs\.gov\.rs/,
    );
  });

  test("plain http is refused even on the right host", async () => {
    await expect(run("http://suf.purs.gov.rs/v/")).rejects.toThrow(/https/);
  });

  test("something that is not a URL at all is refused", async () => {
    await expect(run("suf.purs.gov.rs")).rejects.toThrow(/Not a URL/);
  });

  test("localhost and cloud metadata are refused", async () => {
    // The reason the host check exists at all: without it this action would
    // fetch whatever it was named, from inside the backend.
    await expect(run("https://127.0.0.1/")).rejects.toThrow(/purs\.gov\.rs/);
    await expect(run("https://[::1]/")).rejects.toThrow(/purs\.gov\.rs/);
    await expect(run("https://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      /purs\.gov\.rs/,
    );
  });
});
