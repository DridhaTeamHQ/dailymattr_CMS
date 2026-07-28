import type { ContentKind } from "@/lib/types";

/**
 * The four format colours, in one place.
 *
 * Validated for both themes — lightness band, chroma floor, colour-vision
 * separation and contrast all pass on light and dark surfaces, so a format
 * keeps its identity when the theme flips.
 *
 * Shared rather than copied because a reader who learns "Pix is green" on the
 * dashboard should not have to relearn it on the team page.
 */
export const KIND_COLOR: Record<ContentKind, string> = {
  article: "#378ADD",
  pix: "#1D9E75",
  qix: "#D85A30",
  trax: "#7F77DD",
};

/** Pipeline stages read as status, so they borrow the semantic tokens and
 *  follow the theme rather than being pinned to a hex. */
export const STAGE_COLOR = {
  live: "var(--color-mint)",
  cleared: "var(--color-violet)",
  inQa: "var(--color-amber)",
  sentBack: "var(--color-rose)",
  draft: "var(--color-faint)",
} as const;
