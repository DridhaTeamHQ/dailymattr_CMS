import { NextResponse } from "next/server";
import { generateReadingModes } from "@/lib/openai";
import { acquireSlot, clientIp, rateLimit, releaseSlot } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Guards against a pasted novel being sent to the model. */
const MAX_INPUT_CHARS = 20_000;

/* Looser per-minute than /api/refit, because the desk generates modes in a
   sitting — a dozen stories back to back — where a rewrite is a one-off. The
   hourly and global ceilings are what actually bound the spend. */
const RULES = (ip: string) => [
  { key: `modes:ip:${ip}:min`, limit: 12, windowMs: 60_000 },
  { key: `modes:ip:${ip}:hr`, limit: 80, windowMs: 3_600_000 },
  { key: "modes:global:hr", limit: 400, windowMs: 3_600_000 },
];

/**
 * Writes the three reading modes for one story.
 *
 * Nothing is fetched here — the copy arrives in the request, so there is no
 * outbound URL and no SSRF surface. Nothing is written either: the result goes
 * back to the editor, who reads it and decides whether to save. That review
 * step is the whole reason generation lives in the Studio rather than the app.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const slotKey = `modes:${ip}`;

  const limited = rateLimit(RULES(ip));
  if (!limited.ok) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${limited.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }
  if (!acquireSlot(slotKey)) {
    return NextResponse.json(
      { error: "A generation is already running. Wait for it to finish." },
      { status: 429 }
    );
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Reading modes need OPENAI_API_KEY set on the server." },
        { status: 501 }
      );
    }

    let payload: { title?: string; summary?: string; body?: string };
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    }

    const title = (payload.title ?? "").trim();
    const summary = (payload.summary ?? "").trim();
    const body = (payload.body ?? "").trim().slice(0, MAX_INPUT_CHARS);

    if (!title && !summary) {
      return NextResponse.json(
        { error: "Write the story first — there is nothing to retell yet." },
        { status: 400 }
      );
    }

    const result = await generateReadingModes(apiKey, { title, summary, body });
    if (!result) {
      return NextResponse.json(
        { error: "Couldn't make anything useful out of this story." },
        { status: 422 }
      );
    }

    return NextResponse.json({ modes: result.modes, tokens: result.tokens });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // A timeout is the common failure and reads better as itself.
    const timedOut = /abort|timeout/i.test(message);
    return NextResponse.json(
      { error: timedOut ? "The model took too long. Try again." : message },
      { status: timedOut ? 504 : 500 }
    );
  } finally {
    releaseSlot(slotKey);
  }
}
