import { NextResponse } from "next/server";
import { parseTargetUrl, scrapeListing } from "@/lib/pixScrape";
import { InvalidInputError, errorResponse } from "@/lib/safeFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Scrape a listing page into deduplicated headline links. */
export async function POST(req: Request) {
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
}
