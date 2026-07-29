import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * One call here becomes up to ten outbound requests to Google, so it is an
 * amplifier: unmetered, it lets anyone who finds the URL spend this server's
 * outbound budget ten times over and get its IP throttled by the upstream.
 * The other fetching routes are all metered; this one was not.
 */
const RULES = (ip: string) => [
  { key: `tts:ip:${ip}:min`, limit: 20, windowMs: 60_000 },
  { key: `tts:ip:${ip}:hr`, limit: 200, windowMs: 3_600_000 },
  { key: "tts:global:hr", limit: 2_000, windowMs: 3_600_000 },
];

/** Matches "en", "en-GB", "pt-BR" and nothing else. */
const LANG_RE = /^[a-z]{2}(-[A-Za-z]{2})?$/;

/** Ten chunks of 170 characters is all that is ever synthesised. */
const MAX_TEXT_CHARS = 1_700;

/** A hung upstream must not hold the request open indefinitely. */
const UPSTREAM_TIMEOUT_MS = 15_000;

export async function GET(req: NextRequest) {
  const limited = rateLimit(RULES(clientIp(req)));
  if (!limited.ok) {
    return new NextResponse(`Too many requests. Try again in ${limited.retryAfter}s.`, {
      status: 429,
      headers: { "Retry-After": String(limited.retryAfter) },
    });
  }

  const { searchParams } = new URL(req.url);
  const text = searchParams.get("text") || "";
  const lang = searchParams.get("lang") || "en";

  if (!text.trim()) {
    return new NextResponse("Missing text parameter", { status: 400 });
  }
  if (text.length > MAX_TEXT_CHARS) {
    return new NextResponse(
      `Text is ${text.length} characters; the limit is ${MAX_TEXT_CHARS}.`,
      { status: 413 }
    );
  }
  // `lang` was interpolated into the upstream URL unencoded, so a value like
  // "en&client=x" appended parameters of the caller's choosing to the request
  // this server made. Validated rather than escaped: the set of real language
  // tags is small and known.
  if (!LANG_RE.test(lang)) {
    return new NextResponse("Unsupported language code.", { status: 400 });
  }

  try {
    const rawText = text.trim();
    // Split into chunks of max 170 characters at word boundaries (Google TTS 200-char limit)
    const chunks: string[] = [];
    let current = "";

    const words = rawText.split(/\s+/);
    for (const w of words) {
      if ((current + " " + w).length > 170) {
        if (current) chunks.push(current.trim());
        current = w;
      } else {
        current = current ? current + " " + w : w;
      }
    }
    if (current.trim()) chunks.push(current.trim());

    // Limit to max 10 chunks (~1700 chars)
    const limitedChunks = chunks.slice(0, 10);

    // Fetch MP3 audio buffers for all chunks concurrently
    const audioBuffers = await Promise.all(
      limitedChunks.map(async (chunk) => {
        const query = encodeURIComponent(chunk);
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${query}&tl=${lang}&client=tw-ob`;
        const res = await fetch(ttsUrl, {
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });
        if (!res.ok) throw new Error("Upstream chunk TTS failed");
        return new Uint8Array(await res.arrayBuffer());
      })
    );

    // Concatenate all MP3 chunks into one seamless MP3 buffer
    const totalLength = audioBuffers.reduce((acc, b) => acc + b.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of audioBuffers) {
      combined.set(buf, offset);
      offset += buf.length;
    }

    return new NextResponse(combined.buffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch (err) {
    // Logged in full, reported in general: the upstream's own wording is not
    // something a caller needs, and it is the sort of detail that tells an
    // attacker which service sits behind this route.
    console.error("[tts] upstream failed:", err);
    return new NextResponse("Could not generate audio for that text.", {
      status: 502,
    });
  }
}
