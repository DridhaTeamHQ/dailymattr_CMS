import dns from "node:dns/promises";
import net from "node:net";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 2_500_000; // 2.5 MB of HTML is plenty for any article page

export interface ScrapeResult {
  url: string;
  title: string | null;
  summary: string | null;
  fullText: string | null;
  image: string | null;
  siteName: string | null;
  section: string | null;
  keywords: string[];
  publishedAt: string | null;
}

// ── SSRF guards ────────────────────────────────────────────────────
// The URL comes from a user, so the server must not be tricked into
// fetching internal services or cloud metadata endpoints.
function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 127) return true; // this-host / loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true; // unique local
  if (v6.startsWith("fe80")) return true; // link-local
  if (v6.startsWith("::ffff:")) return isBlockedIp(v6.slice(7)); // v4-mapped
  return false;
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Only http and https links can be imported.");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal"))
    throw new Error("That host isn't reachable from the importer.");

  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error("That address range isn't allowed.");
    return url;
  }
  const records = await dns.lookup(host, { all: true }).catch(() => {
    throw new Error("Couldn't resolve that domain.");
  });
  if (!records.length) throw new Error("Couldn't resolve that domain.");
  if (records.some((r) => isBlockedIp(r.address)))
    throw new Error("That address range isn't allowed.");
  return url;
}

// ── HTML helpers ───────────────────────────────────────────────────
const decode = (s: string) =>
  s
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X"))
        return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
      const map: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
        rsquo: "’",
        lsquo: "‘",
        ldquo: "“",
        rdquo: "”",
        mdash: "—",
        ndash: "–",
        hellip: "…",
      };
      return map[code.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();

/** Reads <meta> content by property/name, tolerating attribute order. */
function meta(html: string, key: string): string | null {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["']${k}["'][^>]*?content\\s*=\\s*["']([^"']*)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*?(?:property|name|itemprop)\\s*=\\s*["']${k}["']`,
      "i"
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]?.trim()) return decode(m[1]);
  }
  return null;
}

const first = (...vals: (string | null)[]) => vals.find((v) => v && v.trim()) ?? null;

/** Pulls readable body copy — prefers <article>, falls back to all <p>. */
function extractText(html: string): string | null {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<figure[\s\S]*?<\/figure>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ");

  const article = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const scope = article ?? cleaned;

  const paras = [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => decode(m[1].replace(/<[^>]+>/g, " ")))
    .filter((t) => t.split(/\s+/).length >= 8); // drop captions/bylines

  const text = paras.join(" ").trim();
  return text.length > 40 ? text : null;
}

/** Most publishers put the section in the path: /technology/news/story/... */
const PATH_NOISE = new Set([
  "news", "story", "article", "articles", "amp", "web", "en", "in", "india-news",
  "latest", "topic", "content", "post", "posts", "read", "www",
]);
function sectionFromPath(url: URL): string | null {
  for (const seg of url.pathname.split("/").filter(Boolean)) {
    const s = seg.toLowerCase();
    if (PATH_NOISE.has(s)) continue;
    if (!/^[a-z][a-z-]{2,19}$/.test(s)) continue; // skip slugs/ids/dates
    if (s.split("-").length > 2) continue; // long slugs aren't sections
    return s.replace(/-/g, " ");
  }
  return null;
}

/** Trims to ~`max` words on a sentence boundary where possible. */
function toWords(text: string, max = 60): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= max) return text.trim();
  const clipped = words.slice(0, max).join(" ");
  const lastStop = Math.max(
    clipped.lastIndexOf(". "),
    clipped.lastIndexOf("! "),
    clipped.lastIndexOf("? ")
  );
  if (lastStop > clipped.length * 0.55) return clipped.slice(0, lastStop + 1);
  return clipped.replace(/[,;:\s]+$/, "") + "…";
}

export async function POST(request: Request) {
  let raw: string;
  try {
    const body = (await request.json()) as { url?: string };
    raw = (body.url ?? "").trim();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (!raw) return Response.json({ error: "Paste a link first." }, { status: 400 });
  // Only add a scheme when none was given, so file:/ftp: reach the protocol check.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;

  let url: URL;
  try {
    url = await assertPublicUrl(raw);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "That link can't be imported." },
      { status: 400 }
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Many publishers serve a stub to unknown agents.
        "user-agent":
          "Mozilla/5.0 (compatible; DailyMattrStudio/1.0; +https://dailymattr.com)",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-IN,en;q=0.9",
      },
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e instanceof Error && e.name === "AbortError";
    return Response.json(
      { error: aborted ? "The site took too long to respond." : "Couldn't reach that link." },
      { status: 502 }
    );
  }
  clearTimeout(timer);

  if (!res.ok)
    return Response.json(
      { error: `The site returned ${res.status}. It may block automated readers.` },
      { status: 502 }
    );

  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("html"))
    return Response.json(
      { error: "That link isn't an article page." },
      { status: 415 }
    );

  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES)
    return Response.json({ error: "That page is too large to import." }, { status: 413 });
  const html = new TextDecoder("utf-8").decode(buf);

  const title = first(
    meta(html, "og:title"),
    meta(html, "twitter:title"),
    (() => {
      const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
      return t ? decode(t) : null;
    })(),
    (() => {
      const h = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
      return h ? decode(h.replace(/<[^>]+>/g, " ")) : null;
    })()
  );

  const description = first(
    meta(html, "og:description"),
    meta(html, "twitter:description"),
    meta(html, "description")
  );
  const fullText = extractText(html);
  const summarySource = first(
    fullText && fullText.split(/\s+/).length > 25 ? fullText : null,
    description
  );

  let image = first(
    meta(html, "og:image:secure_url"),
    meta(html, "og:image"),
    meta(html, "twitter:image"),
    meta(html, "twitter:image:src")
  );
  if (image) {
    try {
      image = new URL(image, url).toString();
    } catch {
      image = null;
    }
  }

  const keywords = (
    first(meta(html, "article:tag"), meta(html, "news_keywords"), meta(html, "keywords")) ?? ""
  )
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 5);

  const result: ScrapeResult = {
    url: url.toString(),
    title: title ? toWords(title, 20) : null,
    summary: summarySource ? toWords(summarySource, 60) : null,
    fullText,
    image,
    siteName: first(meta(html, "og:site_name"), meta(html, "application-name")),
    section: first(
      meta(html, "article:section"),
      meta(html, "category"),
      meta(html, "genre"),
      sectionFromPath(url)
    ),
    keywords,
    publishedAt: first(
      meta(html, "article:published_time"),
      meta(html, "datePublished"),
      meta(html, "publishdate")
    ),
  };

  if (!result.title && !result.summary)
    return Response.json(
      { error: "Couldn't read an article from that page — paste the text manually." },
      { status: 422 }
    );

  return Response.json(result);
}
