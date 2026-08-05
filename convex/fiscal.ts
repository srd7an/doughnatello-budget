import { action } from "./_generated/server";
import { v } from "convex/values";

/**
 * Looking up a fiscal receipt's shop from the tax administration.
 *
 * The QR code carries the total, the moment and the till — but no shop name;
 * see `parseFiscal` in src/lib/qr.ts. The verification URL printed alongside it
 * leads to a page that does have one, so this fetches that page.
 *
 * It is an ACTION and not a browser fetch because suf.purs.gov.rs sends no CORS
 * headers, which is not an oversight — the page is meant for people, not for
 * other people's JavaScript. The consequence worth stating plainly: scanning a
 * receipt now makes one request from this backend to the tax administration,
 * for a URL that is printed on the receipt precisely so it can be visited.
 *
 * Everything here is best-effort. The page is HTML meant for reading, so any
 * parse of it is a guess about someone else's markup and will eventually be
 * wrong. Every field is therefore optional and every failure is a null: a scan
 * whose lookup fails still has its amount and its date from the code itself,
 * and the shop can still be typed. This must never be the reason a receipt
 * cannot be recorded.
 */

/** Only the tax administration, ever. A client hands us this URL. */
function assertPurs(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Not a URL");
  }
  if (url.protocol !== "https:") throw new Error("Refusing a non-https URL");
  // Exactly this host or a subdomain of it — never "purs.gov.rs.example.com",
  // and never an arbitrary address that would turn this into a proxy for
  // whatever the caller felt like reaching from our backend.
  if (!/(^|\.)purs\.gov\.rs$/i.test(url.hostname)) {
    throw new Error("Refusing a host that is not purs.gov.rs");
  }
  return url;
}

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function unescapeHtml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => entities[name.toLowerCase()] ?? m);
}

/** The text of the first element carrying this id. */
function labelled(html: string, id: string): string | null {
  const m = new RegExp(`id="${id}"[^>]*>([^<]*)`).exec(html);
  const v = m ? unescapeHtml(m[1]).trim() : "";
  return v || null;
}

/**
 * The company's name, which is the one field with no id of its own.
 *
 * It lives in the printed journal, on the line after the tax number:
 *
 *     ============ ФИСКАЛНИ РАЧУН ============
 *                    104643930                  ← tin
 *      Pet Network SRB veterinarska apoteka     ← this
 *         1168017-prodavnica 2 Novi Sad
 *
 * Anchored on the tin rather than on a line number, because a header that gains
 * a line would otherwise silently start returning the address.
 */
function companyFromJournal(html: string, tin: string | null): string | null {
  if (!tin) return null;
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/.exec(html);
  if (!pre) return null;

  const lines = unescapeHtml(pre[1])
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const at = lines.findIndex((l) => l === tin);
  if (at === -1) return null;
  const next = lines[at + 1];
  // A separator rule means the header ended and there is no name to take.
  return next && !/^[=-]+$/.test(next) ? next : null;
}

export const lookup = action({
  args: { url: v.string() },
  handler: async (_ctx, { url }) => {
    const target = assertPurs(url);

    let html: string;
    try {
      // A timeout, because a slow tax portal must not hold a scan open: the
      // amount and the date are already known and the shop is a bonus.
      const res = await fetch(target.toString(), {
        signal: AbortSignal.timeout(6000),
        headers: { "Accept-Language": "sr" },
      });
      if (!res.ok) return null;
      html = await res.text();
    } catch {
      return null;
    }

    const tin = labelled(html, "tinLabel");
    const company = companyFromJournal(html, tin);
    const shop = labelled(html, "shopFullNameLabel");

    // The company is the name a person would recognise; the shop is a branch
    // code and a town. Neither is guaranteed, so whichever exists wins.
    const merchant = company ?? shop;
    if (!merchant) return null;

    return {
      merchant,
      company,
      shop,
      tin,
      city: labelled(html, "cityLabel"),
      address: labelled(html, "addressLabel"),
      // Returned for confirmation only. The amount that gets SAVED is the one
      // decoded from the code itself, which needs no network and cannot be
      // wrong about a receipt it is holding.
      total: labelled(html, "totalAmountLabel"),
    };
  },
});
