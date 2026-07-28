import { NextResponse } from "next/server";
import { ScrapeError } from "@/lib/article-scrape";
import { refitArticleCopy } from "@/lib/openai";
import { acquireSlot, clientIp, rateLimit, releaseSlot } from "@/lib/rate-limit";
import { ARTICLE_DESC_MAX, ARTICLE_TITLE_MAX } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Guards against a pasted novel being sent to the model. */
const MAX_INPUT_CHARS = 20_000;

const RULES = (ip: string) => [
  { key: `refit:ip:${ip}:min`, limit: 8, windowMs: 60_000 },
  { key: `refit:ip:${ip}:hr`, limit: 60, windowMs: 3_600_000 },
  { key: "refit:global:hr", limit: 300, windowMs: 3_600_000 },
];

/**
 * Trims a NewsStudio story to the card's limits.
 *
 * Nothing is fetched here — the copy arrives in the request, so there is no
 * outbound URL and no SSRF surface. The result is only ever written back as a
 * CMS override; the pipeline database is untouched.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const slotKey = `refit:${ip}`;

  const limited = rateLimit(RULES(ip));
  if (!limited.ok) {
    return NextResponse.json(
      { error: `Too many rewrites. Try again in ${limited.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }
  if (!acquireSlot(slotKey)) {
    return NextResponse.json(
      { error: "A rewrite is already running. Wait for it to finish." },
      { status: 429 }
    );
  }

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const { title, summary } = (body ?? {}) as {
      title?: unknown;
      summary?: unknown;
    };

    if (typeof title !== "string" || typeof summary !== "string") {
      return NextResponse.json(
        { error: "A title and summary are required." },
        { status: 400 }
      );
    }
    if (!summary.trim()) {
      return NextResponse.json({ error: "There is no story to trim." }, { status: 400 });
    }
    if (title.length + summary.length > MAX_INPUT_CHARS) {
      return NextResponse.json({ error: "That story is too long." }, { status: 413 });
    }

    const fitted = await refitArticleCopy({
      title: title.trim(),
      summary: summary.trim(),
    });

    console.info(
      `[refit] ${summary.length}→${fitted.description.length} chars · ${fitted.tokens.prompt}+${fitted.tokens.completion} tokens`
    );

    return NextResponse.json({
      title: fitted.title,
      summary: fitted.description,
      limits: { title: ARTICLE_TITLE_MAX, description: ARTICLE_DESC_MAX },
    });
  } catch (e) {
    if (e instanceof ScrapeError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[refit] unexpected", e);
    return NextResponse.json(
      { error: "Something went wrong while trimming that story." },
      { status: 500 }
    );
  } finally {
    releaseSlot(slotKey);
  }
}
