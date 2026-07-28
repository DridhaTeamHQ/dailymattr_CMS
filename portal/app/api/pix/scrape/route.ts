import { NextResponse } from "next/server";
import { parseTargetUrl, scrapeListing } from "@/lib/pixScrape";

/** Scrape a listing page into deduplicated headline links. */
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
    return NextResponse.json({ items: await scrapeListing(url) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scrape failed.";
    return NextResponse.json(
      { error: message },
      { status: /^Source returned/.test(message) ? 502 : 500 }
    );
  }
}
