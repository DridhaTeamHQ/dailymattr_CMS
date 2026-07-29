import { clientIp, rateLimit } from "@/lib/rate-limit";
import { errorResponse, safeFetch } from "@/lib/safeFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Loose on purpose. Every suggestion thumbnail is proxied, so one image search
 * legitimately fires up to twenty-four of these at once, and a writer trying a
 * few searches in a minute is doing nothing wrong. The point is a ceiling on
 * a route that will fetch twelve megabytes for anyone who asks — not a budget
 * for ordinary work.
 */
const RULES = (ip: string) => [
  { key: `pix-image:ip:${ip}:min`, limit: 200, windowMs: 60_000 },
  { key: `pix-image:ip:${ip}:hr`, limit: 2_000, windowMs: 3_600_000 },
  { key: "pix-image:global:hr", limit: 8_000, windowMs: 3_600_000 },
];

/**
 * Same-origin proxy for scraped images.
 *
 * Without this the composer can draw a remote photograph but never export it —
 * the canvas is tainted the moment a cross-origin image is drawn, and
 * `toDataURL` throws. Serving the bytes from our own origin keeps it clean.
 *
 * It is also a request forwarder pointed at whatever URL the caller supplies,
 * so it goes through the same guard as the scrapers: internal addresses are
 * refused, redirects are re-checked at every hop, and the body is capped.
 */
export async function GET(req: Request) {
  const limited = rateLimit(RULES(clientIp(req)));
  if (!limited.ok) {
    return Response.json(
      { error: `Too many images. Try again in ${limited.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }

  const target = new URL(req.url).searchParams.get("url");
  if (!target) {
    return Response.json({ error: "Image URL is required." }, { status: 400 });
  }

  try {
    const { buffer, contentType } = await safeFetch(target, {
      accept: "image/*",
      expectContentType: "image/",
      maxBytes: 12_000_000,
      timeoutMs: 10_000,
    });

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Only our own canvas reads this; there is no reason for any other
        // origin to be able to drive it.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
