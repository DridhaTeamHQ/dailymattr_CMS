/**
 * Pix Post Builder — image suggestions, ported from the standalone project's
 * `lib/image-search.js`.
 *
 * Multi-source web image search with fallbacks: Bing first (best large-image
 * coverage), then Google, then DuckDuckGo. None of them need an API key —
 * each is scraped from the public results page — so if one changes its markup
 * the next source still answers.
 *
 * Every result is upgraded to the largest variant the CDN will serve and comes
 * back through our own proxy, so the canvas can draw it and still export.
 */

import { USER_AGENT } from "./pixScrape";

export type ImageSuggestion = {
  id: number;
  alt: string;
  /** Same-origin thumbnail for the picker grid. */
  preview: string;
  /** The upstream URL, kept for reference. */
  image: string;
  /** Same-origin full image — what the canvas actually loads. */
  imageProxy: string;
  source: string;
};

const IMG_HEADERS = {
  "user-agent": USER_AGENT,
  accept: "text/html,application/xhtml+xml",
  "accept-language": "en-US,en;q=0.9",
};

/** Bing escapes its JSON into HTML attributes, so entities need undoing. */
const decodeSearchUrl = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=");

/**
 * Turns a headline into a short search query.
 *
 * Image search is built for a few words, not a sentence — feeding it a whole
 * headline returns whatever loosely matches, which is how a wildfire story ends
 * up suggesting stock portraits and a fire-triangle diagram. So keep the proper
 * nouns and the strongest content words and drop the rest.
 *
 * The standalone builder does this with a gpt-4o-mini call; without a key this
 * is the honest keyword version of the same idea.
 */
const QUERY_STOPWORDS = new Set(
  [
    "the","a","an","and","or","but","for","with","from","that","this","will",
    "would","should","could","says","said","after","before","about","under",
    "over","into","onto","within","without","through","their","they","them",
    "there","then","have","has","had","was","were","are","is","been","being",
    "more","most","very","just","only","also","new","some","such","your","our",
    "against","during","while","where","when","what","which","who","whom","why",
    "how","its","it","as","at","by","of","on","in","to","out","up","off","down",
    "back","not","no","own","life","near","amid","says","reveals","announces",
  ].map((w) => w.toLowerCase())
);

export function buildImageQuery(headline: string, maxWords = 5): string {
  const cleaned = headline
    // Quoted fragments are colour, not subject matter.
    .replace(/["'“”‘’][^"'“”‘’]{4,}["'“”‘’]/g, " ")
    .replace(/[[\](){}]/g, " ")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ").filter(Boolean);
  const proper: string[] = [];
  const content: string[] = [];

  words.forEach((w, i) => {
    const bare = w.replace(/['’]s$/i, "");
    if (bare.length < 3 || QUERY_STOPWORDS.has(bare.toLowerCase())) return;
    // A capital anywhere but the first word signals a name or place.
    if (i > 0 && /^\p{Lu}/u.test(bare)) proper.push(bare);
    else content.push(bare);
  });

  const picked: string[] = [];
  const seen = new Set<string>();
  for (const w of [...proper, ...content]) {
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(w);
    if (picked.length >= maxWords) break;
  }

  return picked.length ? picked.join(" ") : cleaned.slice(0, 60);
}

/** Strips CDN resize parameters to get back to the original resolution. */
export function upgradeImageUrl(imageUrl: string): string {
  try {
    const u = new URL(imageUrl);
    if (
      u.hostname.includes("cloudinary.com") ||
      u.hostname.includes("res.cloudinary.com")
    ) {
      u.pathname = u.pathname
        .replace(/\/c_\w+,[^/]+/g, "")
        .replace(/\/w_\d+[^/]*/g, "")
        .replace(/\/h_\d+[^/]*/g, "");
      return u.toString();
    }
    if (u.hostname.includes("imgix.net")) {
      ["w", "h", "fit", "crop"].forEach((p) => u.searchParams.delete(p));
      u.searchParams.set("q", "100");
      return u.toString();
    }
    if (
      u.searchParams.has("resize") ||
      u.searchParams.has("w") ||
      u.searchParams.has("fit")
    ) {
      ["resize", "w", "h", "fit", "crop"].forEach((p) =>
        u.searchParams.delete(p)
      );
      return u.toString();
    }
    [
      "width", "height", "w", "h", "quality", "q",
      "resize", "size", "maxwidth", "maxheight",
    ].forEach((k) => u.searchParams.delete(k));
    if (u.hostname.includes("ytimg.com") && u.pathname.includes("hqdefault")) {
      return imageUrl.replace("hqdefault", "maxresdefault");
    }
    return u.toString();
  } catch {
    return imageUrl;
  }
}

/** Filters out favicons, sprites and thumbnails masquerading as photographs. */
export function isLikelyHighQuality(url: string): boolean {
  const lower = (url || "").toLowerCase();
  if (lower.includes("favicon")) return false;
  if (lower.includes("/icon")) return false;
  if (lower.match(/\b(16|24|32|48|64|72|96)x\1\b/)) return false;
  if (lower.includes("thumbnail") && !lower.includes("maxresdefault")) return false;
  if (lower.includes("logo") && !lower.includes("article")) return false;

  // A poster needs a photograph. Diagrams, charts and explainer graphics read
  // terribly behind a headline, and image search loves returning them.
  if (/\.svg(\?|$)/.test(lower)) return false;
  if (
    /\b(infographic|diagram|chart|graph|clipart|vector|illustration|icon-set|template|wordcloud|screenshot|meme)\b/.test(
      lower
    )
  )
    return false;

  return true;
}

const proxy = (url: string) => `/api/pix/image?url=${encodeURIComponent(url)}`;

function makeResult(
  url: string,
  source: string,
  idx: number,
  alt?: string
): ImageSuggestion {
  const upgraded = upgradeImageUrl(url);
  return {
    id: idx,
    alt: alt || `${source} image`,
    // The picker shows twelve of these at once, so the preview deliberately
    // uses the smaller original rather than the upgraded variant. Proxying a
    // dozen full-resolution photographs left the grid blank for a minute —
    // the upgrade is only worth paying for on the image actually chosen.
    preview: proxy(url),
    image: upgraded,
    imageProxy: proxy(upgraded),
    source,
  };
}

/**
 * Bing used to emit `"murl":"…"` as plain JSON; it now HTML-escapes the whole
 * blob into an attribute, so the URL arrives as `&quot;murl&quot;:&quot;…`.
 * Matching only the old form is why this source silently returned nothing.
 */
const BING_MURL =
  /(?:&quot;|")murl(?:&quot;|")\s*:\s*(?:&quot;|")(https?:.*?)(?:&quot;|")/gi;

async function bingSearch(
  query: string,
  max: number,
  sizeFilter: string
): Promise<ImageSuggestion[]> {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(
    query
  )}&qft=+filterui:imagesize-${sizeFilter}&form=IRFLTR&first=1`;
  const r = await fetch(url, { headers: IMG_HEADERS });
  if (!r.ok) return [];
  const html = await r.text();
  const out: ImageSuggestion[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(BING_MURL)) {
    if (out.length >= max) break;
    const u = decodeSearchUrl(m[1]);
    if (/\b(bing|microsoft)\.(com|net)\b/.test(u)) continue;
    if (!isLikelyHighQuality(u) || seen.has(u)) continue;
    seen.add(u);
    out.push(makeResult(u, "bing", out.length));
  }
  return out;
}

export async function tryBingImages(
  query: string,
  max: number
): Promise<ImageSuggestion[]> {
  try {
    const results = await bingSearch(query, max, "wallpaper");
    if (results.length) return results;
    return await bingSearch(query, max, "large");
  } catch {
    return [];
  }
}

export async function tryGoogleImages(
  query: string,
  max: number
): Promise<ImageSuggestion[]> {
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(
      query
    )}&tbm=isch&tbs=isz:lt,islt:2mp`;
    const r = await fetch(url, { headers: IMG_HEADERS });
    if (!r.ok) return [];
    const html = await r.text();
    const out: ImageSuggestion[] = [];
    const seen = new Set<string>();
    for (const m of html.matchAll(
      /\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)",[0-9]+,[0-9]+\]/gi
    )) {
      if (out.length >= max) break;
      const u = m[1]
        .replace(/\\u003d/g, "=")
        .replace(/\\u0026/g, "&")
        .replace(/\\\/\//g, "//");
      if (/(gstatic|google|googleapis)\.com/.test(u) || u.includes("x-raw-image"))
        continue;
      if (!isLikelyHighQuality(u) || seen.has(u)) continue;
      seen.add(u);
      out.push(makeResult(u, "google", out.length, "Google image"));
    }
    return out;
  } catch {
    return [];
  }
}

export async function tryDuckDuckGoImages(
  query: string,
  max: number
): Promise<ImageSuggestion[]> {
  try {
    const tokenRes = await fetch(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
      { headers: { "user-agent": USER_AGENT } }
    );
    if (!tokenRes.ok) return [];
    const vqd = (await tokenRes.text()).match(/vqd=([\d-]+)/)?.[1];
    if (!vqd) return [];

    const ddgUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(
      query
    )}&vqd=${vqd}&f=size:Large&p=1`;
    const r = await fetch(ddgUrl, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
    });
    if (!r.ok) return [];
    const data = (await r.json()) as {
      results?: { image?: string; thumbnail?: string; title?: string }[];
    };
    return (data.results || [])
      .filter((it) => isLikelyHighQuality(it.image || ""))
      .slice(0, max)
      .map((it, i) => {
        const upgraded = upgradeImageUrl(it.image!);
        return {
          id: i,
          alt: it.title || "DuckDuckGo Image",
          preview: proxy(it.thumbnail || upgraded),
          image: upgraded,
          imageProxy: proxy(upgraded),
          source: "duckduckgo",
        };
      });
  } catch {
    return [];
  }
}

/**
 * Queries every source at once and interleaves what comes back.
 *
 * The original tried them in order and took the first that answered, which
 * meant one engine's bad day decided the whole result set — and a source that
 * has quietly stopped matching costs a full round-trip before the next one is
 * even tried. Running them together is faster and mixes the sources, so a weak
 * result from one is diluted rather than dominant.
 */
export async function searchImages(
  query: string,
  max = 12
): Promise<ImageSuggestion[]> {
  const settled = await Promise.all([
    tryBingImages(query, max).catch(() => []),
    tryDuckDuckGoImages(query, max).catch(() => []),
    tryGoogleImages(query, max).catch(() => []),
  ]);

  // Round-robin so the grid opens with a spread rather than 12 from one engine.
  const merged: ImageSuggestion[] = [];
  const seen = new Set<string>();
  for (let i = 0; merged.length < max; i += 1) {
    const exhausted = settled.every((list) => i >= list.length);
    if (exhausted) break;
    for (const list of settled) {
      const item = list[i];
      if (!item || merged.length >= max) continue;
      const key = item.image.split("?")[0];
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...item, id: merged.length });
    }
  }
  return merged;
}
