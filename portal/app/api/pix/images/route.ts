import { NextResponse } from "next/server";
import { buildImageQuery, searchImages } from "@/lib/pixImageSearch";

/** Beyond this many words it is a headline, not a search — so refine it. */
const REFINE_ABOVE_WORDS = 6;

/** Image suggestions for a headline — no API key, three sources in parallel. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const raw = params.get("q")?.trim();
  const max = Math.min(24, Number(params.get("max")) || 12);

  if (!raw) {
    return NextResponse.json(
      { error: "A search query is required." },
      { status: 400 }
    );
  }

  // Deliberate terms are left alone; a pasted headline gets cut down to the
  // words image search can actually use.
  const query =
    raw.split(/\s+/).length > REFINE_ABOVE_WORDS ? buildImageQuery(raw) : raw;

  try {
    const images = await searchImages(query, max);
    return NextResponse.json({ images, query, rawQuery: raw });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Image search failed.",
      },
      { status: 500 }
    );
  }
}
