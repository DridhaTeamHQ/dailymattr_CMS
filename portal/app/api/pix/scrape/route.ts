import { NextResponse } from "next/server";
import { parseTargetUrl, scrapeListing } from "@/lib/pixScrape";
import { acquireSlot, clientIp, rateLimit, releaseSlot } from "@/lib/rate-limit";
import { InvalidInputError, errorResponse } from "@/lib/safeFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The heaviest scrape in the app, and it was the only one unmetered.
 *
 * One call fetches the listing page and then enriches up to twelve links in
 * parallel at two megabytes each — thirteen outbound requests and around
 * twenty-five megabytes of egress, for anyone who can reach the URL. Its
 * sibling scrape-article, which fetches a single page, has been metered all
 * along; this matches it.
 */
const RULES = (ip: string) => [
  { key: `pix-listing:ip:${ip}:min`, limit: 5, windowMs: 60_000 },
  { key: `pix-listing:ip:${ip}:hr`, limit: 40, windowMs: 3_600_000 },
  { key: "pix-listing:global:hr", limit: 200, windowMs: 3_600_000 },
];

/** Scrape a listing page into deduplicated headline links. */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const slotKey = `pix-listing:${ip}`;

  const limited = rateLimit(RULES(ip));
  if (!limited.ok) {
    return NextResponse.json(
      { error: `Too many scrapes. Try again in ${limited.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }
  // Thirteen parallel fetches at a time is enough; two of these at once from
  // one caller is not something a person does.
  if (!acquireSlot(slotKey)) {
    return NextResponse.json(
      { error: "A scrape is already running. Wait for it to finish." },
      { status: 429 }
    );
  }

  try {
    let url: URL;
    try {
      const body = await req.json().catch(() => {
        throw new InvalidInputError("Invalid request body.");
      });
      // Resolves DNS and refuses internal addresses before anything is fetched.
      url = await parseTargetUrl(body?.url);
    } catch (e) {
      return errorResponse(e);
    }

    try {
      return NextResponse.json({ items: await scrapeListing(url) });
    } catch (e) {
      return errorResponse(e);
    }
  } finally {
    // Always, or one failed scrape locks this caller out until a restart.
    releaseSlot(slotKey);
  }
}
