/**
 * Pix Post Builder — scraping, ported from the standalone project's
 * `server.mjs` so the CMS can build a poster straight from an article URL.
 *
 * The extraction is deliberately regex-based, exactly as the original is: it
 * pulls Open Graph and Twitter card metadata, falls back to the `<title>` tag,
 * scores paragraphs to find the real article body, and upgrades known CDN image
 * URLs to their highest-quality form. No new dependencies.
 *
 * Not ported: the OpenAI-backed image-search query, which needs a paid key.
 * The endpoint returns `imageQuery: null` and the composer copes.
 */

import { assertPublicUrl, safeFetch } from "./safeFetch";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

export const TEXT_DETAIL_CHAR_LIMIT = 500;

export type ScrapedItem = {
  title: string;
  url: string;
  image: string | null;
  posterText?: string;
  keywords?: string[];
  imageProxy?: string | null;
};

export type ScrapedArticle = {
  title: string;
  image: string | null;
  imageProxy: string | null;
  sourceUrl: string;
  articleText: string;
  detailText: string;
  imageQuery: string | null;
};

/**
 * Fetches a page through the SSRF guard. Every hop is re-validated and the
 * body is capped, so a redirect to an internal address can't be followed.
 */
async function fetchPage(url: URL): Promise<string> {
  const { buffer } = await safeFetch(url.toString(), {
    accept: "text/html,application/xhtml+xml",
    maxBytes: 3_000_000,
    timeoutMs: 10_000,
  });
  return new TextDecoder("utf-8").decode(buffer);
}

/**
 * The CDN "upgrade" rules rewrite an image URL to a larger variant, but some
 * hosts only serve the exact size they advertised — BBC's ichef 404s on any
 * width other than the one in the og:image tag, which silently loses the
 * photograph. So check the upgrade actually resolves and keep the original
 * when it doesn't. (The standalone builder has the same rules and the same
 * blind spot; worth fixing there too.)
 */
async function bestAvailableImage(
  original: string,
  upgraded: string
): Promise<string> {
  if (upgraded === original) return original;
  try {
    const res = await fetch(upgraded, {
      method: "HEAD",
      headers: { "user-agent": USER_AGENT },
    });
    if (res.ok) return upgraded;
  } catch {
    /* fall through to the original */
  }
  return original;
}

/**
 * Validates a user-supplied URL and rejects anything that resolves inside the
 * network. Async because it has to resolve DNS to do that honestly.
 */
export async function parseTargetUrl(raw: unknown): Promise<URL> {
  if (!raw || typeof raw !== "string") throw new Error("A URL is required.");
  const { url } = await assertPublicUrl(raw);
  return url;
}

/** Headline links on a listing page, deduplicated and enriched from each target. */
export async function scrapeListing(url: URL): Promise<ScrapedItem[]> {
  const html = await fetchPage(url);
  return enrichItems(extractItems(html, url.toString()));
}

/** One article: headline, hero image, body text. */
export async function scrapeArticle(url: URL): Promise<ScrapedArticle> {
  const html = await fetchPage(url);
  const target = url.toString();

  // Title: og:title > twitter:title > <title>
  let title = extractMetaContent(html, ["og:title", "twitter:title"]);
  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    title = titleMatch ? cleanupText(stripTags(titleMatch[1])) : "";
  }
  title = cleanupText(stripTags(title));
  // Drop trailing site names: " - BBC News", " | Times of India".
  title = title.replace(/\s*[-|\u2013\u2014]\s*[^-|\u2013\u2014]{2,30}$/i, "").trim();

  if (!title) throw new Error("Could not extract a title from this page.");

  let image = extractMetaContent(html, [
    "og:image:secure_url",
    "og:image",
    "twitter:image",
    "twitter:image:src",
  ]);
  if (image) {
    const resolved = resolveMaybeRelative(image, target);
    image = resolved
      ? await bestAvailableImage(resolved, upgradeImageToHighestQuality(resolved))
      : null;
  }

  const metaDescription = extractMetaContent(html, [
    "og:description",
    "twitter:description",
    "description",
  ]);
  const articleText = extractArticleText(html, title);

  return {
    title: cleanupText(title),
    image: image || null,
    // Remote images must come back through our own origin, or the canvas
    // taints and the poster can never be exported.
    imageProxy: image ? `/api/pix/image?url=${encodeURIComponent(image)}` : null,
    sourceUrl: target,
    articleText,
    detailText: limitCharacters(
      articleText || metaDescription || title,
      TEXT_DETAIL_CHAR_LIMIT
    ),
    imageQuery: null,
  };
}

/* ── Extraction helpers, ported verbatim ─────────────────────────────── */

const STOPWORDS = new Set([
  "THE", "A", "AN", "AND", "OR", "BUT", "FOR", "WITH", "FROM", "THAT", "THIS", "WILL", "WOULD", "SHOULD", "COULD",
  "SAYS", "SAID", "AFTER", "BEFORE", "ABOUT", "UNDER", "OVER", "INTO", "ONTO", "WITHIN", "WITHOUT", "THROUGH",
  "THEIR", "THEY", "THEM", "THERE", "THEN", "HAVE", "HAS", "HAD", "WAS", "WERE", "ARE", "IS", "BEEN", "BEING",
  "MORE", "MOST", "VERY", "JUST", "ONLY", "ALSO", "NEWS", "LIVE", "BBC", "NEW", "SOME", "SUCH", "YOUR", "OUR",
  "AGAINST", "DURING", "WHILE", "WHERE", "WHEN", "WHAT", "WHICH", "WHO", "WHOM", "WHY", "HOW"
]);

function extractItems(html: string, baseUrl: string): ScrapedItem[] {
  const matches = [...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const items: ScrapedItem[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const href = match[1]?.trim();
    const rawInner = match[2] ?? "";
    const title = cleanupText(stripTags(rawInner));
    if (!href || !looksLikeHeadline(title)) {
      continue;
    }

    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }

    if (!looksLikeArticleUrl(absoluteUrl, baseUrl)) {
      continue;
    }

    const normalizedKey = `${normalizeText(title)}|${normalizeUrl(absoluteUrl)}`;
    if (seen.has(normalizedKey)) {
      continue;
    }

    seen.add(normalizedKey);
    items.push({
      title: trimTitle(title),
      url: absoluteUrl,
      image: extractImageUrl(rawInner, baseUrl)
    });

    if (items.length >= 16) {
      break;
    }
  }

  return items;
}

/** Upper bound on per-item lookups, so one listing can't fan out unbounded. */
const MAX_ENRICHED = 12;

async function enrichItems(items: ScrapedItem[]): Promise<ScrapedItem[]> {
  // Deduplicate first — enriching two copies of the same URL is wasted egress.
  const unique = items.filter(
    (item, index, array) =>
      array.findIndex((c) => normalizeUrl(c.url) === normalizeUrl(item.url)) ===
      index
  );

  // Fetched in parallel with a hard per-request timeout inside safeFetch;
  // sequentially this held the function open for as long as the slowest
  // sixteen sites took to answer.
  return Promise.all(
    unique.slice(0, MAX_ENRICHED).map(async (item) => {
      const next: ScrapedItem = { ...item };
      try {
        const { buffer } = await safeFetch(item.url, {
          accept: "text/html,application/xhtml+xml",
          maxBytes: 2_000_000,
          timeoutMs: 8_000,
        });
        const html = new TextDecoder("utf-8").decode(buffer);
        const metaTitle = extractMetaContent(html, ["og:title", "twitter:title"]);
        const metaImage = extractMetaContent(html, ["og:image", "twitter:image", "twitter:image:src"]);
        if (metaTitle && looksLikeHeadline(metaTitle)) {
          next.title = trimTitle(cleanupText(metaTitle));
        }
        if (metaImage) {
          next.image = resolveMaybeRelative(metaImage, item.url);
        }
      } catch {
        /* keep whatever the listing page gave us */
      }

      next.posterText = next.posterText || buildPosterText(next.title, "", "");
      next.keywords = next.keywords?.length ? next.keywords : extractKeywords(next.title, next.posterText);
      // Was /api/image, which has never existed — every proxied image 404'd.
      next.imageProxy = next.image ? `/api/pix/image?url=${encodeURIComponent(next.image)}` : null;
      return next;
    })
  );
}

function extractMetaContent(html: string, names: string[]): string | null {
  for (const name of names) {
    const propertyRegex = new RegExp(`<meta[^>]+(?:property|name)=["']${escapeForRegex(name)}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
    const contentFirstRegex = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapeForRegex(name)}["'][^>]*>`, "i");
    const match = html.match(propertyRegex) || html.match(contentFirstRegex);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1]);
    }
  }
  return null;
}

function extractImageUrl(htmlChunk: string, baseUrl: string): string | null {
  const src = findAttributeValue(htmlChunk, ["src", "data-src", "data-lazy-src", "data-original"]);
  const srcset = findAttributeValue(htmlChunk, ["srcset", "data-srcset"]);
  const candidate = src || firstSrcFromSet(srcset);
  return candidate ? resolveMaybeRelative(candidate, baseUrl) : null;
}

function findAttributeValue(htmlChunk: string, names: string[]): string | null {
  for (const name of names) {
    const regex = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i");
    const match = htmlChunk.match(regex);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function resolveMaybeRelative(value: string, baseUrl: string): string | null {
  try {
    return new URL(value.trim(), baseUrl).toString();
  } catch {
    return null;
  }
}

function firstSrcFromSet(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return value.split(",")[0]?.trim().split(/\s+/)[0] || null;
}

function stripTags(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function cleanupText(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&hellip;/gi, "...");
}

function upgradeImageToHighestQuality(imageUrl: string): string {
  try {
    const u = new URL(imageUrl);
    const host = u.hostname;

    // --- Cloudinary ---
    if (host.includes("cloudinary.com")) {
      // Replace upload transformations with just w_auto,q_auto:best
      u.pathname = u.pathname.replace(/\/upload\/[^/]+\//, "/upload/q_auto:best,f_auto/");
      return u.toString();
    }

    // --- imgix ---
    if (host.includes("imgix.net") || u.searchParams.has("ixid")) {
      u.searchParams.delete("w");
      u.searchParams.delete("h");
      u.searchParams.delete("fit");
      u.searchParams.delete("crop");
      u.searchParams.delete("q");
      u.searchParams.delete("auto");
      u.searchParams.set("q", "100");
      u.searchParams.set("auto", "format,compress");
      return u.toString();
    }

    // --- WordPress / Jetpack resize (e.g. ?resize=800,450 or ?w=800) ---
    if (u.searchParams.has("resize") || (u.searchParams.has("w") && !host.includes("twitter"))) {
      u.searchParams.delete("resize");
      u.searchParams.delete("w");
      u.searchParams.delete("h");
      u.searchParams.delete("fit");
      u.searchParams.delete("strip");
      u.searchParams.delete("quality");
      return u.toString();
    }

    // --- Times of India / HT Media (thumb/ in path) ---
    const toi = u.pathname.match(/^(.*?)\/thumb\/(\d+)x(\d+)(\/.*)?$/);
    if (toi) {
      u.pathname = toi[1] + (toi[4] || "");
      return u.toString();
    }

    // --- BBC / Akamai image service (/ichef/) ---
    if (host.includes("bbci.co.uk") || u.pathname.includes("/ichef/")) {
      u.pathname = u.pathname.replace(/\/\d+\//, "/1280/");
      return u.toString();
    }

    // --- Generic: strip common resize query params ---
    ["width", "height", "w", "h", "size", "quality", "q", "maxwidth", "maxheight", "scale"].forEach(p => {
      u.searchParams.delete(p);
    });

    return u.toString();
  } catch {
    return imageUrl;
  }
}

function looksLikeHeadline(value: string): boolean {
  if (!value) {
    return false;
  }
  const text = cleanupText(value);
  const words = text.split(/\s+/).filter(Boolean);
  if (text.length < 30 || text.length > 180) {
    return false;
  }
  if (words.length < 5 || words.length > 28) {
    return false;
  }
  if (/^(sign in|home|live|menu|search|open source|bbc news|british broadcasting corporation)$/i.test(text)) {
    return false;
  }
  return /[a-zA-Z]/.test(text);
}

function looksLikeArticleUrl(candidate: string, baseUrl: string): boolean {
  const url = new URL(candidate);
  const base = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    return false;
  }
  const path = url.pathname.toLowerCase();
  if (url.origin === base.origin && (path === "/" || path === "")) {
    return false;
  }
  if (/\/(signin|account|weather|sport\/scores-and-fixtures|newsround)$/.test(path)) {
    return false;
  }
  return path.split("/").filter(Boolean).length >= 1;
}

function trimTitle(value: string): string {
  return value.length > 110 ? `${value.slice(0, 107).trimEnd()}...` : value;
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

function extractArticleText(html: string, title = ""): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(?:header|footer|nav|aside|form|button)\b[\s\S]*?<\/(?:header|footer|nav|aside|form|button)>/gi, " ");

  const scopes = extractArticleScopes(stripped);
  const scoredScopes = scopes.map((scope, index) => {
    const paragraphs = extractParagraphCandidates(scope.html, title);
    const score = paragraphs.reduce((sum, item) => sum + item.score, 0) + scope.priority - index;
    return { paragraphs, score };
  });

  scoredScopes.sort((a, b) => b.score - a.score);
  const best = scoredScopes.find((scope) => scope.paragraphs.length >= 2) || scoredScopes[0];
  return (best?.paragraphs || []).slice(0, 10).map((item) => item.text).join(" ");
}

function extractArticleScopes(html: string): { html: string; priority: number }[] {
  const scopes: { html: string; priority: number }[] = [];
  const scopePatterns = [
    { regex: /<article\b[^>]*>([\s\S]*?)<\/article>/gi, priority: 120 },
    { regex: /<main\b[^>]*>([\s\S]*?)<\/main>/gi, priority: 80 },
    { regex: /<(?:section|div)\b[^>]*(?:class|id)=["'][^"']*(?:article|story|content|entry|post|body)[^"']*["'][^>]*>([\s\S]*?)<\/(?:section|div)>/gi, priority: 55 },
  ];

  for (const pattern of scopePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(html)) !== null) {
      scopes.push({ html: match[1], priority: pattern.priority });
    }
  }

  scopes.push({ html, priority: 0 });
  return scopes;
}

function extractParagraphCandidates(scope: string, title: string): { text: string; score: number }[] {
  const seen = new Set<string>();
  const candidates: { text: string; score: number }[] = [];
  for (const match of scope.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = cleanupText(stripTags(match[1] || ""));
    const key = normalizeText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const score = scoreArticleParagraph(text, title);
    if (score > 0) candidates.push({ text, score });
  }
  return candidates;
}

function scoreArticleParagraph(text: string, title = ""): number {
  const normalized = normalizeText(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (text.length < 45 || text.length > 1200 || words.length < 8) return 0;
  if (title && normalizeText(title) === normalized) return 0;
  if (isBoilerplateParagraph(normalized)) return 0;

  const sentenceCount = (text.match(/[.!?](?:\s|$)/g) || []).length;
  const hasNewsTerms = /\b(said|according|reported|minister|police|court|government|company|team|match|official|source|agency|statement)\b/i.test(text);

  // Relevance: paragraphs that mention the story's own proper nouns (from
  // the title) far outrank generic page copy like author bios. "Ranbir
  // Kapoor" appearing in a paragraph is a much stronger signal than length.
  let overlapBonus = 0;
  if (title) {
    const titleNouns = (title.match(/\b[A-Z][a-zA-Z''-]{3,}\b/g) || [])
      .map((w) => w.toLowerCase())
      .filter((w, i, a) => a.indexOf(w) === i);
    const hits = titleNouns.filter((n) => normalized.includes(n)).length;
    overlapBonus = Math.min(hits, 3) * 140;
  }

  return Math.min(text.length, 320) + sentenceCount * 35 + (hasNewsTerms ? 80 : 0) + overlapBonus;
}

function isBoilerplateParagraph(normalized: string): boolean {
  return /\b(privacy policy|cookie policy|cookies|terms of use|sign in|sign up|subscribe|subscription|advertisement|sponsored|newsletter|all rights reserved|copyright|follow us|read more|related stories|enable javascript|disable ad blocker|allow notifications|manage settings|accept all|our privacy policy has been revised|please review updated privacy policy|news desk|entertainment desk|sports desk|is a dynamic and dedicated team|team of journalists|bring the pulse|about the author|written by|contributed to this report|catch all the|stay updated with|download the app|for more (?:updates|news)|end of article)\b/i.test(normalized);
}

function limitCharacters(value: string, maxChars: number): string {
  const text = cleanupText(value || "");
  if (text.length <= maxChars) return text;
  const clipped = text.slice(0, maxChars + 1);
  const boundary = clipped.lastIndexOf(" ");
  return clipped.slice(0, boundary > Math.floor(maxChars * 0.84) ? boundary : maxChars).trim();
}


function buildPosterText(title: string, metaDescription: string, articleText: string): string {
  const source = cleanupText(metaDescription || articleText || title);
  const sentences = source.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  let summary = "";
  for (const sentence of sentences) {
    const candidate = `${summary} ${sentence}`.trim();
    if (candidate.length > 120) {
      break;
    }
    summary = candidate;
    if (summary.length >= 72) {
      break;
    }
  }
  const output = summary || source;
  return output.length > 120 ? `${output.slice(0, 117).trimEnd()}...` : output;
}

function extractKeywords(title: string, posterText: string): string[] {
  const found: string[] = [];
  const phraseMatches = cleanupText(title).match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}|[A-Z]{2,})\b/g) || [];
  for (const match of phraseMatches) {
    const upper = match.toUpperCase();
    if (!STOPWORDS.has(upper) && !found.includes(upper)) {
      found.push(upper);
    }
    if (found.length >= 3) {
      return found;
    }
  }

  const frequency = new Map<string, number>();
  for (const word of cleanupText(`${title} ${posterText}`).toUpperCase().match(/[A-Z]{3,}/g) || []) {
    if (STOPWORDS.has(word) || word.length < 4) {
      continue;
    }
    frequency.set(word, (frequency.get(word) || 0) + 1);
  }

  for (const word of [...frequency.entries()].sort((a, b) => b[1] - a[1]).map(([word]) => word)) {
    if (!found.includes(word)) {
      found.push(word);
    }
    if (found.length >= 4) {
      break;
    }
  }

  return found.slice(0, 4);
}
