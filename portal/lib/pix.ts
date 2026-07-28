import type { ContentItem } from "./types";

/**
 * Pix format spec — every number here is the app's, in points.
 *
 * Two placements share one card surface: the list card in the home feed and the
 * full-bleed page card in the reader deck. The photo sits on top of the card
 * colour and the dark panel simply begins where the photo ends.
 */

/** The card surface itself — dark in both themes. */
export const PIX_PANEL = "#0C111D";
export const PIX_BRAND = "#3979FF";
/**
 * Marked words in the headline. The app ships one per theme — the card surface
 * is dark either way, but the accent follows the reader's theme. Rendering goes
 * through `--pix-brand-light`, which flips on prefers-color-scheme; these two
 * constants are the values behind it.
 */
export const PIX_BRAND_LIGHT_DARK = "#7AA5FF";
export const PIX_BRAND_LIGHT_LIGHT = "#6694FF";
/** The marked-word blue the CMS renders — matched by the builder canvas. */
export const PIX_BRAND_LIGHT = PIX_BRAND_LIGHT_DARK;
/** Use this in styles so the theme switch happens in CSS, not JavaScript. */
export const PIX_BRAND_LIGHT_VAR = "var(--pix-brand-light)";
export const PIX_PILL_FILL = "rgba(11, 13, 18, 0.42)";
export const PIX_ACTION_FILL = "rgba(11, 13, 18, 0.44)";
export const PIX_ACTION_RING = "rgba(255, 255, 255, 0.26)";
export const PIX_SLIDE2_VEIL = "rgba(8, 11, 20, 0.78)";

export type PixPlacement = "list" | "page";

/** Reference screen the spec is drawn against. */
export const PIX_SCREEN = 375;

/** Geometry per placement, at PIX_SCREEN. */
export const PIX_GEOMETRY = {
  list: {
    /** 24 pt gutters each side. */
    w: PIX_SCREEN - 48,
    /** min(W × 1.28, 520) */
    h: Math.min(PIX_SCREEN * 1.28, 520),
    radius: 22,
    /** Photo takes the top 58%; the panel is the remainder. */
    photo: 0.58,
    copyInset: 20,
    /** Copy column is anchored from the bottom on the list card. */
    headlineBottom: 78,
    actionsBottom: 34,
    dotsBottom: 18,
  },
  page: {
    w: PIX_SCREEN,
    h: 812,
    radius: 0,
    photo: 0.66,
    copyInset: 20,
    /** Copy column starts 24 under the photo on the page card. */
    headlineTop: 24,
    actionsBottom: 72,
    dotsBottom: 50,
    publisherBottom: 16,
    publisherInset: 22,
  },
} as const;

/** Chrome shared by both placements. */
export const PIX_CHROME = {
  pillTop: 14,
  pillInset: 14,
  pillPadX: 11,
  pillPadY: 5,
  accentBar: { w: 34, h: 3, radius: 2, gap: 12 },
  action: { size: 40, gap: 8, icon: 17, stroke: 2 },
  badge: 17,
  dot: { size: 5, active: 16 },
  /** Slide two. */
  points: { inset: 22, edge: 74, gap: 16, marker: 7, markerOffset: 7 },
} as const;

/** Type scale actually used by Pix — the `lg` step plus Inter for everything else. */
export const PIX_TYPE = {
  headline: { size: 23, line: 28, tracking: -0.7, weight: 800 },
  point: { size: 14, line: 21, weight: 400 },
  pill: { size: 11 },
  publisher: { size: 12.5 },
  badge: { size: 9.5 },
} as const;

/** Line ceilings enforced in code — anything longer truncates with an ellipsis. */
export const PIX_LINES = { headline: 4, point: 5 } as const;

/** Key points per Pix. Exactly three, always. */
export const PIX_POINT_COUNT = 3;

/**
 * Character budgets. These are measured estimates for this type at this width,
 * not limits the app enforces — it clamps by line count. We stop the writer at
 * the list card's budget, because that is the narrower of the two columns and
 * the one the feed shows.
 */
export const PIX_CHARS_PER_LINE = { headlineList: 24, headlinePage: 28, point: 44 };
export const PIX_TITLE_MAX = PIX_CHARS_PER_LINE.headlineList * PIX_LINES.headline; // 96
export const PIX_POINT_MAX = PIX_CHARS_PER_LINE.point * PIX_LINES.point; // 220

/**
 * The Text screen paragraph. It has no hard ceiling — the canvas steps the type
 * down through six scales and then clips — so this is the point past which the
 * type is no longer at full size, not a limit the renderer enforces.
 */
export const PIX_TEXT_SLIDE_MAX = 400;

/**
 * What the shipped Pix actually read like, as opposed to what the ceilings
 * above permit. Every sample headline lands in 62-69 characters and every key
 * point in 66-79 — roughly one and a half lines each, one fact apiece. Writers
 * (and the AI) aim here; the MAX values are only the truncation backstop.
 */
export const PIX_HOUSE_STYLE = {
  headlineChars: 65,
  pointChars: 72,
  textSlideChars: 300,
} as const;

/** Estimated lines a string occupies in a given column. */
export const pixLines = (text: string, perLine: number) =>
  Math.max(1, Math.ceil(text.trim().length / perLine));

/**
 * The app splits a story's summary into sentences of at least 25 characters when
 * the summariser hasn't produced tldr bullets — so slide two always fills.
 */
export function pixPointsFromSummary(summary: string): string[] {
  const sentences = summary
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25);
  // Nothing long enough to split on — use the summary whole rather than nothing.
  if (sentences.length === 0) return summary.trim() ? [summary.trim()] : [];
  return sentences.slice(0, PIX_POINT_COUNT);
}

/** Key points live in body.points; always returns exactly PIX_POINT_COUNT slots. */
export function getPixPoints(item: Pick<ContentItem, "body" | "summary">): string[] {
  const raw = (item.body as { points?: unknown })?.points;
  const points = Array.isArray(raw) ? raw.map((p) => String(p ?? "")) : [];
  // No authored points — fall back the way the app does.
  const filled = points.some((p) => p.trim())
    ? points
    : pixPointsFromSummary(item.summary);
  return Array.from({ length: PIX_POINT_COUNT }, (_, i) => filled[i] ?? "");
}

/** Points the reader actually sees — blank slots dropped. */
export const filledPixPoints = (item: Pick<ContentItem, "body" | "summary">) =>
  getPixPoints(item).filter((p) => p.trim());

/** Keeps summary in sync so list/review screens outside Pix stay readable. */
export const pixSummary = (points: string[]) =>
  points.map((p) => p.trim()).filter(Boolean).join(" ");
