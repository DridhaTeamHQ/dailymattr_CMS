import dns from "node:dns/promises";
import net from "node:net";

/**
 * Outbound fetch for user-supplied URLs.
 *
 * Every route that takes a URL from a caller and fetches it is a server-side
 * request forgery hole unless the target is checked. Checking only the URL the
 * caller typed is not enough — a public host can 302 to 169.254.169.254 — so
 * redirects are followed by hand and every hop is validated.
 */

export const SAFE_USER_AGENT =
  "Mozilla/5.0 (compatible; DailyMattrStudio/1.0; +https://dailymattr.com)";

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 5_000_000;
const MAX_REDIRECTS = 5;

export class UnsafeUrlError extends Error {}
export class FetchLimitError extends Error {}
/**
 * The caller sent something wrong — a missing field, an unparseable body.
 *
 * Distinct from the fetch failures below because it is answered differently:
 * these are 400s the caller can fix, not 502s about a source being unreachable.
 * Without it, "A URL is required." was reported as "Couldn't reach that link."
 */
export class InvalidInputError extends Error {}

/** Loopback, private, link-local, CGNAT and reserved space. */
function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // includes cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true;
  if (v6.startsWith("fe80")) return true;
  if (v6.startsWith("::ffff:")) return isBlockedIp(v6.slice(7));
  return false;
}

/**
 * Resolves the host and rejects anything internal. Returns the URL plus the
 * addresses it resolved to, so the caller can pin them if it wants to.
 */
export async function assertPublicUrl(
  raw: string
): Promise<{ url: URL; addresses: string[] }> {
  let url: URL;
  try {
    // Only add a scheme when none was given, so file:/ftp: reach the check.
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new UnsafeUrlError("That doesn't look like a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new UnsafeUrlError("Only http and https links are supported.");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  )
    throw new UnsafeUrlError("That host isn't reachable from here.");

  if (net.isIP(host)) {
    if (isBlockedIp(host))
      throw new UnsafeUrlError("That address range isn't allowed.");
    return { url, addresses: [host] };
  }

  const records = await dns.lookup(host, { all: true }).catch(() => {
    throw new UnsafeUrlError("Couldn't resolve that domain.");
  });
  if (!records.length) throw new UnsafeUrlError("Couldn't resolve that domain.");
  if (records.some((r) => isBlockedIp(r.address)))
    throw new UnsafeUrlError("That address range isn't allowed.");

  return { url, addresses: records.map((r) => r.address) };
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  accept?: string;
  /** Reject when the response content-type doesn't start with this. */
  expectContentType?: string;
}

export interface SafeFetchResult {
  buffer: ArrayBuffer;
  contentType: string;
  finalUrl: string;
  status: number;
}

/**
 * Fetches a user-supplied URL with the guard applied to every redirect hop,
 * a hard timeout, and a size cap enforced while streaming rather than after
 * the whole body is already in memory.
 */
export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    accept = "*/*",
    expectContentType,
  } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let target = rawUrl;
    let response: Response | null = null;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const { url } = await assertPublicUrl(target);

      const res = await fetch(url, {
        signal: controller.signal,
        // Manual, so the guard runs again before we follow anywhere.
        redirect: "manual",
        headers: {
          "user-agent": SAFE_USER_AGENT,
          accept,
          "accept-language": "en-IN,en;q=0.9",
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location)
          throw new UnsafeUrlError("The site redirected without a target.");
        target = new URL(location, url).toString();
        continue;
      }

      response = res;
      break;
    }

    if (!response)
      throw new UnsafeUrlError("Too many redirects — gave up following.");

    if (!response.ok)
      throw new FetchLimitError(`The source returned ${response.status}.`);

    const contentType =
      response.headers.get("content-type") || "application/octet-stream";
    if (expectContentType && !contentType.startsWith(expectContentType))
      throw new FetchLimitError(`Expected ${expectContentType}, got ${contentType}.`);

    // Trust the header when it is present, but still cap while reading.
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared && declared > maxBytes)
      throw new FetchLimitError("That resource is too large.");

    const buffer = await readCapped(response, maxBytes);

    return {
      buffer,
      contentType,
      finalUrl: response.url || target,
      status: response.status,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Reads the body, aborting as soon as the cap is passed. */
async function readCapped(res: Response, maxBytes: number): Promise<ArrayBuffer> {
  if (!res.body) return new ArrayBuffer(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new FetchLimitError("That resource is too large.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

/** Maps a thrown guard error onto an HTTP response the caller can return. */
export function errorResponse(e: unknown): Response {
  if (e instanceof InvalidInputError)
    return Response.json({ error: e.message }, { status: 400 });
  if (e instanceof UnsafeUrlError)
    return Response.json({ error: e.message }, { status: 400 });
  if (e instanceof FetchLimitError)
    return Response.json({ error: e.message }, { status: 502 });
  const aborted = e instanceof Error && e.name === "AbortError";
  return Response.json(
    { error: aborted ? "The source took too long to respond." : "Couldn't reach that link." },
    { status: 502 }
  );
}
