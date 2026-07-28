import { NextResponse } from "next/server";
import { parseTargetUrl, scrapeArticle } from "@/lib/pixScrape";
import { errorResponse } from "@/lib/safeFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Scrape one article into a poster: headline, hero image, body text. */
export async function POST(req: Request) {
  let url: URL;
  try {
    const body = await req.json();
    // Resolves DNS and refuses internal addresses before anything is fetched.
    url = await parseTargetUrl(body?.url);
  } catch (e) {
    return errorResponse(e);
  }

  try {
    return NextResponse.json(await scrapeArticle(url));
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    // "Nothing readable on the page" is the caller's problem, not a failure.
    if (/Could not extract/.test(message))
      return NextResponse.json({ error: message }, { status: 422 });
    return errorResponse(e);
  }
}
