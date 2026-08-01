/**
 * Server-only helpers for pulling readable text out of a news article URL.
 *
 * Network safety lives in `lib/safeFetch` and is used from here; what this
 * module adds is the reading: stripping a page down to its prose, and shaping
 * the model's copy to fit the card.
 */

import {
  FetchLimitError,
  UnsafeUrlError,
  assertPublicUrl,
  safeFetch,
} from "./safeFetch";
import { stripTagBlocks } from "./html";
import { ARTICLE_DESC_MAX, ARTICLE_TITLE_MAX } from "./types";

export { assertPublicUrl };

export const MAX_TITLE_CHARS = ARTICLE_TITLE_MAX;
export const MAX_DESCRIPTION_CHARS = ARTICLE_DESC_MAX;

/* The word budget, derived rather than written down.
 *
 * The prompts steer the model on *words*, and tell it in as many words not to
 * count characters — because models are bad at counting and good at shape. So
 * the word figure is what actually decides how long the copy comes out; the
 * character cap only trims what arrives.
 *
 * That makes a hardcoded word count a quiet trap: raise the character cap on
 * its own and the model keeps writing to the old length, the extra room is
 * never used, and the change looks like it did nothing. English news prose runs
 * about 6.5 characters per word including the space — the ratio the previous
 * 300/46 pairing was itself calibrated on. */
const CHARS_PER_WORD = 6.5;
export const MAX_DESCRIPTION_WORDS = Math.round(MAX_DESCRIPTION_CHARS / CHARS_PER_WORD);
export const MIN_DESCRIPTION_WORDS = MAX_DESCRIPTION_WORDS - 6;

/* Below this fraction of the cap, a trim has failed rather than succeeded.
 *
 * `completeSentences` will not end a card mid-sentence, so when the copy's last
 * sentence straddles the limit it falls back to the previous boundary — and
 * that boundary can be anywhere. A real case: a 450-character summary whose
 * sentences end at 150, 332 and 450. The cap is 330. Sentence two misses by
 * *two characters*, so the only whole sentence that fits is the first, and a
 * card with room for three sentences ships with one.
 *
 * Nothing about that is visible downstream — it returns a clean, grammatical,
 * badly incomplete summary. This threshold is what makes it visible. */
export const FIT_FLOOR = 0.62;

/** Characters of article text handed to the model (~4k tokens of input). */
const MAX_TEXT_CHARS = 14_000;

export class ScrapeError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/* ──────────────────── network (delegated to safeFetch) ─────────────────── */

/**
 * Fetching is the shared guard's job, not this module's.
 *
 * `lib/safeFetch` validates the URL, re-checks every redirect hop and caps the
 * body while streaming. This module used to carry its own copy of all that;
 * two SSRF implementations is one too many, so it now just wraps the shared one
 * and translates its errors into the ScrapeError the API routes already handle.
 */
export async function fetchArticleHtml(
  rawUrl: string
): Promise<{ html: string; finalUrl: string }> {
  try {
    const res = await safeFetch(rawUrl, {
      timeoutMs: 12_000,
      maxBytes: 2_000_000,
      accept: "text/html,application/xhtml+xml",
      // safeFetch matches on a prefix; "text/" covers text/html and the
      // text/plain some publishers mislabel their pages as.
      expectContentType: "text/",
    });
    return {
      html: new TextDecoder("utf-8").decode(res.buffer),
      finalUrl: res.finalUrl,
    };
  } catch (e) {
    if (e instanceof UnsafeUrlError) throw new ScrapeError(e.message, 400);
    if (e instanceof FetchLimitError) throw new ScrapeError(e.message, 502);
    const msg = e instanceof Error ? e.message : "Could not reach that page.";
    if (/401|403/.test(msg)) {
      throw new ScrapeError("That page is behind a login or paywall.", 502);
    }
    throw new ScrapeError(msg, 502);
  }
}


/* ──────────────────────────── text extraction ──────────────────────────── */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  eacute: "é",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const attr = key.startsWith("og:") || key.startsWith("twitter:") ? "property|name" : "name|property";
    const re = new RegExp(
      `<meta[^>]+(?:${attr})=["']${key.replace(/:/g, "\\:")}["'][^>]*>`,
      "i"
    );
    const tag = html.match(re)?.[0];
    if (!tag) continue;
    const value = tag.match(/content=["']([^"']*)["']/i)?.[1];
    if (value?.trim()) return decodeEntities(value.trim());
  }
  return null;
}

export interface ExtractedArticle {
  pageTitle: string | null;
  metaDescription: string | null;
  imageUrl: string | null;
  siteName: string | null;
  publishedAt: string | null;
  text: string;
}

/**
 * Strips a page down to article prose. Deliberately regex-based rather than a
 * DOM library — we only need a bag of sentences for the model, not fidelity.
 */
export function extractArticle(html: string, finalUrl: string): ExtractedArticle {
  // stripTagBlocks rather than a lazy regex with a backreference: the regex
  // cost 19 seconds on a crafted 2 MB page of unclosed tags, on the single
  // thread every other request shares. See lib/html.ts.
  const cleaned = stripTagBlocks(
    html.replace(/<!--[\s\S]*?-->/g, " "),
    ["script", "style", "noscript", "svg", "iframe", "template"]
  );

  const pageTitle =
    metaContent(html, ["og:title", "twitter:title"]) ??
    (cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ? decodeEntities(cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1]).trim()
      : null);

  const metaDescription = metaContent(html, [
    "og:description",
    "description",
    "twitter:description",
  ]);

  let imageUrl = metaContent(html, ["og:image", "twitter:image", "twitter:image:src"]);
  if (imageUrl) {
    try {
      imageUrl = new URL(imageUrl, finalUrl).toString();
    } catch {
      imageUrl = null;
    }
  }

  const siteName = metaContent(html, ["og:site_name", "application-name"]);
  const publishedAt = metaContent(html, [
    "article:published_time",
    "publishdate",
    "date",
  ]);

  // Prefer the <article> body when the page marks one up; fall back to <body>.
  const article = cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const body = cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? cleaned;
  const scope = stripTagBlocks(article && article.length > 400 ? article : body, [
    "nav",
    "header",
    "footer",
    "aside",
    "form",
    "figcaption",
  ]);

  const text = extractProse(scope).slice(0, MAX_TEXT_CHARS);

  return { pageTitle, metaDescription, imageUrl, siteName, publishedAt, text };
}

/** Tail boilerplate that sits inside the content column on Indian news sites. */
const BOILERPLATE =
  /^(you can also check|stay updated with|download the|follow us|copyright ©|for reprint rights|read more$|also read|watch:|trending now|subscribe)/i;

/** Paywall and app-install chrome, which sits above the story rather than after it. */
const PROMO =
  /active subscription|subscription benefits|premium stories|gift a subscription|already a (subscriber|member)|sign in to continue|download the .{0,12}app/i;

/**
 * Splits the page into blocks and keeps only the ones that read like prose.
 *
 * The discriminator is link density — the share of a block's text sitting inside
 * <a> tags. Navigation, "more from this section" rails and the headline farms
 * Indian news sites bury below the story are effectively all anchor text, while
 * article paragraphs are near zero even when they cite a source. Length alone
 * cannot separate them: those junk lines are long, which is exactly why they
 * survived the previous filter and drowned the real story.
 */
function extractProse(scope: string): string {
  const blocks = scope
    .replace(/<br\s*\/?>/gi, "</p>")
    .split(/<\/(?:p|div|section|li|ul|ol|h[1-6]|tr|table|blockquote|figure)\s*>/i);

  const kept: string[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const plain = decodeEntities(block.replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();

    if (plain.length < 40) continue; // nav crumbs, share labels, timestamps
    if (BOILERPLATE.test(plain) || PROMO.test(plain)) continue;

    const anchorText = (block.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) ?? [])
      .map((a) => a.replace(/<[^>]+>/g, " "))
      .join(" ");
    const anchorLen = decodeEntities(anchorText).replace(/\s+/g, " ").trim().length;

    // A prose paragraph may cite a link or two; a link rail is nearly all anchor.
    if (anchorLen / plain.length > 0.3) continue;

    // The headline repeats across the <h1>, og:title and "related" rails.
    const key = plain.slice(0, 80).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    kept.push(plain);
  }

  return kept.join("\n");
}

/* ──────────────────────────── output shaping ───────────────────────────── */

/**
 * Trims to `max` characters without cutting mid-word.
 *
 * With `preferSentence`, a full stop is favoured over a word boundary so a
 * truncated description still reads as finished prose — losing the last clause
 * beats shipping "…prevented the attempt during a". The 55% floor stops a stray
 * early period (an initial, "U.S.") from gutting the text.
 */
export function clampChars(
  input: string,
  max: number,
  preferSentence = false
): string {
  const text = input.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;

  const cut = text.slice(0, max);

  if (preferSentence) {
    // Devanagari danda included for Hindi copy.
    const sentenceEnd = Math.max(
      cut.lastIndexOf(". "),
      cut.lastIndexOf("! "),
      cut.lastIndexOf("? "),
      cut.lastIndexOf("। ")
    );
    if (sentenceEnd > max * 0.55) return cut.slice(0, sentenceEnd + 1).trim();
  }

  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s,;:–—-]+$/, "");
}

/**
 * Words a headline must not end on. When a title is one word over the limit the
 * word-boundary trim leaves the preposition behind — "…police excesses during"
 * — which reads as a truncation rather than a headline.
 */
const DANGLING_WORD =
  /\s+(a|an|the|of|for|to|in|on|at|by|with|from|during|after|before|over|under|into|amid|against|about|as|and|or|but|that|which|who|whose|its|his|her|their|this|these|those|is|are|was|were|has|have|had|will|would|can|could|says?|said)$/i;

/**
 * Clamps a headline, then drops any trailing word it cannot end on. Repeats,
 * because trimming one dangling word can expose another ("…as part of").
 */
export function clampTitle(input: string, max: number): string {
  let text = clampChars(input, max);
  for (let i = 0; i < 4; i++) {
    const next = text.replace(DANGLING_WORD, "");
    if (next === text) break;
    // Never trim so hard the headline stops being one.
    if (next.trim().length < 20) break;
    text = next;
  }
  return text.replace(/[\s,;:–—-]+$/, "");
}

/** Abbreviations whose full stop does not end a sentence. */
const ABBREVIATIONS =
  /(?:^|\s)(?:mr|mrs|ms|dr|prof|sr|jr|st|rev|hon|adv|col|gen|capt|lt|sgt|inc|ltd|co|vs|no|rs|approx|est|fig|eg|ie|etc)$/i;

/** Trailing initials — "A", "U.S", "P.V" — where the next stop is not a full stop. */
const INITIALS = /(?:^|\s)(?:[A-Za-z]\.)*[A-Za-z]$/;

/** Index just past the last real sentence terminator, or -1. */
function lastSentenceEnd(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    if (!".!?।".includes(text[i])) continue;
    // Must be the end of the string or followed by a space.
    if (i < text.length - 1 && !/\s/.test(text[i + 1])) continue;
    if (text[i] === ".") {
      const before = text.slice(0, i);
      // "…said Mr." or "…the U.S." does not end the sentence.
      if (ABBREVIATIONS.test(before) || INITIALS.test(before)) continue;
    }
    return i + 1;
  }
  return -1;
}

/**
 * Editorialising the model reaches for once it runs out of facts but still has
 * length budget left: "the move highlights…", "it remains to be seen…". These
 * say nothing, and a news card cannot afford a sentence that says nothing.
 */
const FILLER_SENTENCE =
  /\b(highlight(s|ed|ing)?|underscore(s|d)?|underline(s|d)?|serves? as a reminder|raises? (serious )?questions|remains? (to be seen|critical|unclear)|sparking (a )?(debate|discussion)|marks a (significant|major) (moment|shift)|is a testament|reflects? (the )?(growing|broader|wider))\b/i;

/**
 * Drops a trailing filler sentence, provided real copy survives.
 *
 * Applied after the length clamp so it removes commentary rather than facts —
 * the model pads at the end, never the start.
 */
export function stripFiller(input: string): string {
  const text = input.trim();
  // Split on sentence ends, keeping the terminator with its sentence.
  const parts = text.match(/[^.!?।]+[.!?।]+|\S[^.!?।]*$/g);
  if (!parts || parts.length < 2) return text;

  const kept = [...parts];
  while (kept.length > 1 && FILLER_SENTENCE.test(kept[kept.length - 1])) {
    const remaining = kept.slice(0, -1).join("").trim();
    // Never strip so much that the result stops being a summary.
    if (remaining.length < 100) break;
    kept.pop();
  }
  return kept.join("").trim();
}

/**
 * Guarantees a description reads as finished prose.
 *
 * Two things can leave a dangling fragment: our own length clamp, and the model
 * cutting itself off while trying to respect the character budget. Both end up
 * here, and anything after the last complete sentence is dropped — a shorter
 * summary always beats one that stops mid-clause.
 */
export function completeSentences(input: string, max: number): string {
  const text = clampChars(input, max, true);
  if (/[.!?।]$/.test(text)) return text;

  const end = lastSentenceEnd(text);
  // Cut whenever a real sentence survives — a finished summary beats a longer
  // broken one, even a noticeably shorter one. Only bail out when trimming
  // would leave a fragment too small to be worth showing at all.
  return end > 25 ? text.slice(0, end).trim() : text;
}
