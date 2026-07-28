import { NextResponse } from "next/server";
import { parseTargetUrl, scrapeArticle } from "@/lib/pixScrape";

/** Scrape one article into a poster: headline, hero image, body text. */
export async function POST(req: Request) {
  let url: URL;
  try {
    const body = await req.json();
    url = parseTargetUrl(body?.url);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "A URL is required." },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json(await scrapeArticle(url));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Article scrape failed.";
    // A refusal by the source is not our fault — report it as a bad gateway so
    // the composer can say so plainly.
    const status = /^Source returned/.test(message)
      ? 502
      : /Could not extract/.test(message)
        ? 422
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
