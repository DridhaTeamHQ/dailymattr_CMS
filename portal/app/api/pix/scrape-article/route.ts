import { NextResponse } from "next/server";
import {
  ScrapeError,
  extractArticle,
  fetchArticleHtml,
} from "@/lib/article-scrape";
import { writePixPost } from "@/lib/openai";
import { parseTargetUrl, scrapeArticle } from "@/lib/pixScrape";
import { acquireSlot, clientIp, rateLimit, releaseSlot } from "@/lib/rate-limit";
import { InvalidInputError, errorResponse } from "@/lib/safeFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Under this there is no story to write from — a stub or a paywall teaser. */
const MIN_ARTICLE_CHARS = 400;

const RULES = (ip: string) => [
  { key: `pix-write:ip:${ip}:min`, limit: 5, windowMs: 60_000 },
  { key: `pix-write:ip:${ip}:hr`, limit: 40, windowMs: 3_600_000 },
  { key: "pix-write:global:hr", limit: 200, windowMs: 3_600_000 },
];

/**
 * Scrape one article into a poster: headline, hero image, body text — then have
 * the model write the Pix copy over it.
 *
 * The AI fields are additive. If writing fails the scrape still returns, so the
 * composer keeps the photograph and the publisher's own headline, and the
 * writer can fill the points by hand.
 */
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

  const ip = clientIp(req);
  const slotKey = `pix-write:${ip}`;

  const limited = rateLimit(RULES(ip));
  if (!limited.ok) {
    return NextResponse.json(
      { error: `Too many builds. Try again in ${limited.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }
  if (!acquireSlot(slotKey)) {
    return NextResponse.json(
      { error: "A build is already running. Wait for it to finish." },
      { status: 429 }
    );
  }

  try {
    const article = await scrapeArticle(url);

    let source = article.articleText || article.detailText || "";

    // The poster scraper reads <p> tags only, which several Indian publishers
    // (Times of India among them) do not use for body copy — it comes back
    // near-empty on those. Fall back to the link-density extractor, which does
    // not care about markup shape. Costs a second fetch, but only when needed.
    if (source.length < MIN_ARTICLE_CHARS) {
      try {
        const { html, finalUrl } = await fetchArticleHtml(
          article.sourceUrl || url.toString()
        );
        const fuller = extractArticle(html, finalUrl).text;
        if (fuller.length > source.length) source = fuller;
      } catch (e) {
        console.warn("[pix-write] fallback extraction failed:", e);
      }
    }

    let ai: Awaited<ReturnType<typeof writePixPost>> | null = null;
    let aiError: string | null = null;

    if (source.length < MIN_ARTICLE_CHARS) {
      aiError =
        "Not enough article text to write from — the points are the raw sentences.";
    } else {
      try {
        ai = await writePixPost({
          text: source,
          sourceTitle: article.title || null,
          sourceUrl: article.sourceUrl || url.toString(),
        });
        console.info(
          `[pix-write] ${url.hostname} · ${ai.tokens.prompt}+${ai.tokens.completion} tokens`
        );
      } catch (e) {
        // Never lose the scrape over a failed write.
        aiError =
          e instanceof ScrapeError ? e.message : "The AI writer was unavailable.";
        console.warn("[pix-write] falling back to raw scrape:", aiError);
      }
    }

    return NextResponse.json({
      ...article,
      // Present only when the model actually wrote them.
      headline: ai?.headline ?? null,
      points: ai?.points ?? null,
      textSlide: ai?.textSlide ?? null,
      aiError,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    // "Nothing readable on the page" is the caller's problem, not a failure.
    if (/Could not extract/.test(message))
      return NextResponse.json({ error: message }, { status: 422 });
    return errorResponse(e);
  } finally {
    releaseSlot(slotKey);
  }
}
