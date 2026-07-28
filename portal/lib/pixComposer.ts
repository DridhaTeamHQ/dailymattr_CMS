/**
 * Pix Post Builder — poster rendering, ported from the standalone project's
 * `public/app.js` so the CMS composes the same artwork the team's builder does.
 *
 * This module is framework-free: it draws onto a canvas from a plain state
 * object, exactly like the original. Keep the numbers here in step with
 * `pix/public/app.js` — they are the same design spec, maintained twice.
 *
 * Ported: layout presets, filters, headline layout and bracket highlighting,
 * background, hero, gradient, logo, tag, headline.
 * Not ported: the preview-only engagement/nav bars, the X and Text preview
 * modes, and anything that calls the builder's own API server (scrape, stock
 * images, AI enhance) — none of it affects the exported PNG.
 */

import { markHeadline } from "./pixHighlight";

/** Extra scale so a panned image never exposes an edge. */
const IMAGE_PAN_HEADROOM = 1.1;

/**
 * Download resolution ladder — aim as high as the browser can actually encode.
 * Oversized canvases fail silently on iOS and low-end GPUs (`toBlob` returns
 * null or a blank), so the caller steps down until one really encodes.
 *
 *   8K target (7680 long edge):
 *     9:16   920×1700 → ×4.52 → 4159×7680
 *     4:5   1080×1350 → ×5.69 → 6144×7680
 *     1:1   1080×1080 → ×7.11 → 7680×7680
 *     16:9  1920×1080 → ×4.00 → 7680×4320
 */
export const EXPORT_LONG_EDGES = [7680, 6144, 3840] as const;

/** Never below 2× — that is the retina floor. */
export const scaleForLongEdge = (target: number, W: number, H: number) =>
  Math.max(2, target / Math.max(W, H));

export type PixRatio = "9:16" | "4:5" | "1:1" | "16:9";

/** Five badges: none, plus each of Trending and Breaking with or without icon. */
export type PixTag =
  | "none"
  | "trending"
  | "trending-text"
  | "breaking"
  | "breaking-text";

/** How far the photograph can be panned from centre, in design pixels. */
export const IMAGE_PAN_LIMIT = 900;

export type PixLayout = {
  label: string;
  sub: string;
  W: number;
  H: number;
  logo: { centerX: number; centerY: number; slotPix: number };
  headline: {
    x: number;
    bottomPadding: number;
    maxWidth: number;
    defaultSize: number;
  };
  tag: { x: number; gapAboveHeadline: number };
  gradient: { fadeHeight: number };
};

/**
 * Each preset defines the canvas size plus every key element's position, so a
 * single render path produces posters in different aspect ratios. 9:16 is the
 * original spec; the others are tuned to look right at their dimensions.
 *
 * `headline.bottomPadding` is the gap between the bottom of the LAST headline
 * line and the canvas bottom — the headline anchors to the bottom no matter how
 * many lines it wraps to.
 */
export const LAYOUT_PRESETS: Record<PixRatio, PixLayout> = {
  "9:16": {
    label: "9:16",
    sub: "Story / Reel",
    W: 920,
    H: 1700,
    logo: { centerX: 810, centerY: 150, slotPix: 100 },
    headline: { x: 64, bottomPadding: 305, maxWidth: 920 - 128, defaultSize: 49 },
    tag: { x: 64, gapAboveHeadline: 16 },
    gradient: { fadeHeight: 330 },
  },
  "4:5": {
    label: "4:5",
    sub: "Feed Portrait",
    W: 1080,
    H: 1350,
    logo: { centerX: 970, centerY: 130, slotPix: 92 },
    headline: { x: 70, bottomPadding: 110, maxWidth: 1080 - 140, defaultSize: 52 },
    tag: { x: 70, gapAboveHeadline: 14 },
    gradient: { fadeHeight: 300 },
  },
  "1:1": {
    label: "1:1",
    sub: "Square",
    W: 1080,
    H: 1080,
    logo: { centerX: 970, centerY: 120, slotPix: 90 },
    headline: { x: 70, bottomPadding: 90, maxWidth: 1080 - 140, defaultSize: 50 },
    tag: { x: 70, gapAboveHeadline: 14 },
    gradient: { fadeHeight: 280 },
  },
  "16:9": {
    label: "16:9",
    sub: "Wide",
    W: 1920,
    H: 1080,
    logo: { centerX: 1810, centerY: 110, slotPix: 90 },
    headline: { x: 90, bottomPadding: 100, maxWidth: 1200, defaultSize: 64 },
    tag: { x: 90, gapAboveHeadline: 14 },
    gradient: { fadeHeight: 300 },
  },
};

export const RATIOS = Object.keys(LAYOUT_PRESETS) as PixRatio[];

/** Filter presets — pure value bundles, applied by clicking a chip. */
export const FILTER_PRESETS = {
  none: { brightness: 100, contrast: 100, saturation: 100, blur: 0 },
  vivid: { brightness: 105, contrast: 120, saturation: 145, blur: 0 },
  bw: { brightness: 105, contrast: 110, saturation: 0, blur: 0 },
  warm: { brightness: 102, contrast: 108, saturation: 130, blur: 0 },
  cool: { brightness: 100, contrast: 110, saturation: 90, blur: 0 },
  faded: { brightness: 108, contrast: 88, saturation: 80, blur: 0 },
  soft: { brightness: 105, contrast: 95, saturation: 105, blur: 1 },
} as const;

export type PixFilter = keyof typeof FILTER_PRESETS;

export const FILTER_NAMES = Object.keys(FILTER_PRESETS) as PixFilter[];

export type PixComposerState = {
  ratio: PixRatio;
  accent: string;
  headline: string;
  /** Body copy for the Text preview. Scraping fills it; the writer can edit. */
  detailText: string;
  /** 0 = auto (fixed 48px), otherwise the chosen size. */
  fontSize: number;
  overlayOpacity: number;
  imageOffset: { x: number; y: number };
  imageZoom: number;
  tag: PixTag;
  filter: PixFilter;
  filterBrightness: number;
  filterContrast: number;
  filterSaturation: number;
  filterBlur: number;
};

/** Everything the Reset Image & Filters button puts back. */
export const IMAGE_DEFAULTS = {
  imageOffset: { x: 0, y: 0 },
  imageZoom: 100,
  overlayOpacity: 100,
  filter: "none" as PixFilter,
  filterBrightness: 100,
  filterContrast: 100,
  filterSaturation: 100,
  filterBlur: 0,
};

export const defaultComposerState = (): PixComposerState => ({
  ratio: "9:16",
  // Matches PIX_BRAND_LIGHT, so the canvas and the spec preview agree.
  accent: "#7AA5FF",
  headline: "",
  detailText: "",
  fontSize: 0,
  overlayOpacity: 100,
  imageOffset: { x: 0, y: 0 },
  imageZoom: 100,
  tag: "none",
  filter: "none",
  filterBrightness: 100,
  filterContrast: 100,
  filterSaturation: 100,
  filterBlur: 0,
});

/**
 * Highlight bracket syntax. Writers wrap words to highlight them — all three
 * pairs are equivalent: [Modi]  (Modi)  {Modi}
 */
const HIGHLIGHT_OPEN_CHAR = /[[({]/;
const HIGHLIGHT_CLOSE_CHAR = /[\])}]/;
const HIGHLIGHT_ANY_CHARS_GLOBAL = /[[\](){}]/g;

export const stripHighlightBrackets = (s: string) =>
  s.replace(HIGHLIGHT_ANY_CHARS_GLOBAL, "");

export const getLayout = (s: PixComposerState) =>
  LAYOUT_PRESETS[s.ratio] ?? LAYOUT_PRESETS["9:16"];

const buildFilterString = (s: PixComposerState) =>
  [
    `brightness(${s.filterBrightness}%)`,
    `contrast(${s.filterContrast}%)`,
    `saturate(${s.filterSaturation}%)`,
    `blur(${s.filterBlur}px)`,
  ].join(" ");

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/* ── Headline layout ─────────────────────────────────────────────────── */

type HeadlineLayout = { font: string; lines: string[]; lineHeight: number };

const normalizeHeadlineForPoster = (text: string) =>
  text.replace(/\s+/g, " ").replace(/^live\s+/i, "").trim();

function wrapWords(
  ctx: CanvasRenderingContext2D,
  words: string[],
  maxWidth: number
): string[] {
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    // Strip bracket markers when measuring text width.
    if (ctx.measureText(stripHighlightBrackets(test)).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return rebalanceLines(ctx, lines, maxWidth);
}

/** Pulls a word up from the next line where it fits, for less ragged wrapping. */
function rebalanceLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  maxWidth: number
): string[] {
  if (lines.length < 2) return lines;

  const balanced = [...lines];
  for (let i = 0; i < balanced.length - 1; i += 1) {
    const currentWords = balanced[i].split(" ");
    const nextWords = balanced[i + 1].split(" ");
    if (currentWords.length < 2 || nextWords.length < 2) continue;

    const moved = `${balanced[i]} ${nextWords[0]}`;
    if (
      ctx.measureText(stripHighlightBrackets(moved)).width <= maxWidth * 0.98
    ) {
      balanced[i] = moved;
      nextWords.shift();
      balanced[i + 1] = nextWords.join(" ");
    }
  }

  return balanced.filter(Boolean);
}

/**
 * Serif face the poster headline is set in.
 *
 * The builder names its own face; here the font arrives through
 * next/font, which mints a hashed family name, so the composer resolves the
 * real name from the CSS variable at mount and sets it here. The literal stays
 * as the fallback, which is also what a plain Google Fonts load would give.
 */
let headlineFamily = "'Plus Jakarta Sans', 'Poppins', sans-serif";

export const getHeadlineFamily = () => headlineFamily;

export function setHeadlineFamily(family: string) {
  if (family.trim()) headlineFamily = family.trim();
}

function buildHeadlineLayout(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fixedSize: number
): HeadlineLayout {
  const cleaned = normalizeHeadlineForPoster(text);
  const words = cleaned.trim().split(/\s+/).filter(Boolean);
  // Auto mode is a fixed 48px — the text grows downward as lines increase.
  const size = fixedSize > 0 ? fixedSize : 48;
  const font = `800 ${size}px ${headlineFamily}`;
  ctx.font = font;
  const lines = wrapWords(ctx, words, maxWidth);
  return {
    font,
    lines,
    lineHeight: Math.round(size * (fixedSize > 0 ? 1.1 : 1.22)),
  };
}

export function computeHeadlineLayoutAndTop(
  ctx: CanvasRenderingContext2D,
  s: PixComposerState,
  canvasHeight: number
) {
  const L = getLayout(s);
  const text = s.headline || "YOUR HEADLINE HERE";
  const layout = buildHeadlineLayout(ctx, text, L.headline.maxWidth, s.fontSize);

  // Pull the real font size out of the font string so block height doesn't
  // depend on lineHeight, which has line-spacing baked in.
  const m = layout.font.match(/(\d+(?:\.\d+)?)px/);
  const fontSize = m ? parseFloat(m[1]) : 49;

  const blockHeight = (layout.lines.length - 1) * layout.lineHeight + fontSize;
  const top = Math.max(0, canvasHeight - L.headline.bottomPadding - blockHeight);
  return { layout, top, fontSize, blockHeight };
}

/* ── Draw passes ─────────────────────────────────────────────────────── */

function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(110, 90, 0, 110, 90, 350);
  glow.addColorStop(0, "rgba(139, 92, 246, 0.24)");
  glow.addColorStop(1, "rgba(139, 92, 246, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

/** Cover-fit with focal point, pan offset and zoom, then the image filters. */
function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  s: PixComposerState,
  image: CanvasImageSource & { width: number; height: number },
  x: number,
  y: number,
  width: number,
  height: number
) {
  const zoom = (s.imageZoom || 100) / 100;
  const baseScale = Math.max(width / image.width, height / image.height);
  const scale = baseScale * zoom * IMAGE_PAN_HEADROOM;
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const focal = { x: image.width / 2, y: image.height / 2 };

  let dx = x + width / 2 - focal.x * scale + s.imageOffset.x;
  let dy = y + height / 2 - focal.y * scale + s.imageOffset.y;

  dx = clamp(dx, x + width - drawWidth, x);
  dy = clamp(dy, y + height - drawHeight, y);

  // Filters apply to the image layer only — gradient, headline and logo must
  // render unfiltered, so reset immediately after the draw.
  ctx.save();
  ctx.filter = buildFilterString(s);
  ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
  ctx.restore();
}

function drawHero(
  ctx: CanvasRenderingContext2D,
  s: PixComposerState,
  image: (CanvasImageSource & { width: number; height: number }) | null,
  W: number,
  H: number,
  headlineTop: number
) {
  if (image) drawCoverImage(ctx, s, image, 0, 0, W, H);

  const opa = (s.overlayOpacity ?? 100) / 100;

  // Gradient starts `fadeHeight` above the headline top and is fully black by
  // the headline top, so it follows long vs short headlines automatically.
  const L = getLayout(s);
  const gradientStart = Math.max(0, headlineTop - L.gradient.fadeHeight);
  const gradientHeight = H - gradientStart;
  const fullBlackFrac = (headlineTop - gradientStart) / gradientHeight;
  const grad = ctx.createLinearGradient(0, gradientStart, 0, H);
  const stop = (frac: number, alpha: number) =>
    grad.addColorStop(
      Math.min(1, frac * fullBlackFrac),
      `rgba(0,0,0,${(alpha * opa).toFixed(2)})`
    );
  grad.addColorStop(0, "rgba(0,0,0,0)");
  stop(0.24, 0.1);
  stop(0.44, 0.3);
  stop(0.6, 0.55);
  stop(0.76, 0.8);
  stop(0.88, 0.95);
  stop(1.0, 1.0);
  grad.addColorStop(1, `rgba(0,0,0,${(1 * opa).toFixed(2)})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, gradientStart, W, gradientHeight);
}

/** Circular logo with the soft white halo that lifts it off dark photos. */
function drawLogo(
  ctx: CanvasRenderingContext2D,
  s: PixComposerState,
  logo: HTMLImageElement | null
) {
  if (!logo) return;
  const L = getLayout(s);
  const rawW = logo.naturalWidth || logo.width || 1;
  const rawH = logo.naturalHeight || logo.height || 1;

  // Scale so the longest edge fills the slot, preserving aspect ratio.
  const scale = L.logo.slotPix / Math.max(rawW, rawH);
  const w = rawW * scale;
  const h = rawH * scale;
  const x = L.logo.centerX - w / 2;
  const y = L.logo.centerY - h / 2;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const radius = Math.min(w, h) / 2;

  ctx.save();
  ctx.shadowColor = "rgba(255, 255, 255, 0.5)";
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(logo, x, y, w, h);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "rgba(255, 255, 255, 0.5)";
  ctx.shadowBlur = 18;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Trending / Breaking badge, anchored just above the headline. */
function drawTag(
  ctx: CanvasRenderingContext2D,
  s: PixComposerState,
  tagImage: HTMLImageElement | null,
  headlineTop: number
) {
  if (s.tag === "none" || !tagImage) return;
  const L = getLayout(s);
  const drawW = tagImage.naturalWidth || tagImage.width;
  const drawH = tagImage.naturalHeight || tagImage.height;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 12;
  ctx.drawImage(
    tagImage,
    L.tag.x,
    headlineTop - drawH - L.tag.gapAboveHeadline,
    drawW,
    drawH
  );
  ctx.restore();
}

/**
 * One pass: every word drawn in place, marked runs in the accent colour.
 *
 * The bracketed words are coloured rather than boxed, so the headline matches
 * the format spec's marked-word treatment — the accent carries the emphasis
 * without a filled panel sitting behind the type.
 */
function drawHeadline(
  ctx: CanvasRenderingContext2D,
  s: PixComposerState,
  layout: HeadlineLayout,
  top: number
) {
  const L = getLayout(s);
  const left = L.headline.x;

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = layout.font;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 8;

  // A run can open on one line and close on the next, so this outlives the loop.
  let currentlyHighlighted = false;
  const usesBrackets = /[[\](){}]/.test(s.headline);
  const autoMarked = usesBrackets
    ? new Set<string>()
    : new Set(
        markHeadline(s.headline)
          .filter((seg) => seg.marked)
          .flatMap((seg) => seg.text.trim().split(/\s+/))
          .filter(Boolean)
      );

  layout.lines.forEach((line, lineIndex) => {
    let cursor = left;
    const y = top + lineIndex * layout.lineHeight;

    for (const rawWord of line.split(" ")) {
      const isOpening = HIGHLIGHT_OPEN_CHAR.test(rawWord);
      const isClosing = HIGHLIGHT_CLOSE_CHAR.test(rawWord);
      const cleanWord = stripHighlightBrackets(rawWord);

      // The opening word is marked; the closing word is too, hence the
      // open-before-draw / close-after-draw ordering.
      if (isOpening) currentlyHighlighted = true;

      // With no brackets anywhere, the automatic rule decides instead — the
      // same fallback the spec preview uses, so both stay in step.
      const marked = usesBrackets
        ? currentlyHighlighted
        : autoMarked.has(cleanWord);

      if (cleanWord.length > 0) {
        ctx.fillStyle = marked ? s.accent : "#ffffff";
        ctx.fillText(`${cleanWord} `, cursor, y);
        cursor += ctx.measureText(`${cleanWord} `).width;
      }

      if (isClosing) currentlyHighlighted = false;
    }
  });

  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/* ── Text screen (the reader's second slide) ─────────────────────────── */

/**
 * Body copy on the Text screen. Kept firmly bold in both the measure and the
 * draw pass so the rendered text doesn't drift between weights.
 */
const PREVIEW_TEXT_WEIGHT = 700;
let previewTextFamily = "'Poppins', 'Segoe UI', Arial, sans-serif";

export const getPreviewTextFamily = () => previewTextFamily;

export function setPreviewTextFamily(family: string) {
  if (family.trim()) previewTextFamily = family.trim();
}

/** Collapses runs of spaces and trailing empty bullets, keeping paragraphs. */
function normalizeDetailText(value: string, preserveOpenBullet = false) {
  const lines = (value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd());

  while (
    !preserveOpenBullet &&
    lines.length &&
    /^[•*-]\s*$/.test(lines[lines.length - 1].trim())
  ) {
    lines.pop();
  }

  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

function wrapPreviewTextLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  words.forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (!line || ctx.measureText(test).width <= maxWidth) {
      line = test;
      return;
    }
    lines.push(line);
    line = word;
  });
  if (line) lines.push(line);
  return lines;
}

function buildPreviewTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  preserveOpenBullet: boolean
): string[] {
  const sourceLines = normalizeDetailText(text, preserveOpenBullet).split("\n");
  const lines: string[] = [];
  sourceLines.forEach((sourceLine) => {
    const trimmed = sourceLine.trim();
    if (!trimmed) {
      // Collapse consecutive blanks into a single paragraph break.
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      return;
    }
    const lineText = /^[•*-]\s+/.test(trimmed)
      ? `• ${trimmed.replace(/^[•*-]\s+/, "")}`
      : trimmed;
    lines.push(...wrapPreviewTextLine(ctx, lineText, maxWidth));
  });
  return lines.length ? lines : [""];
}

/** Blank lines are paragraph gaps, so they advance less than a full line. */
const previewTextStep = (line: string, lineHeight: number) =>
  line ? lineHeight : lineHeight * 0.28;

function getVisiblePreviewLines(
  lines: string[],
  lineHeight: number,
  maxBlockHeight: number
): string[] {
  const visible: string[] = [];
  let blockHeight = 0;
  for (const line of lines) {
    const step = previewTextStep(line, lineHeight);
    if (visible.length && blockHeight + step > maxBlockHeight) break;
    visible.push(line);
    blockHeight += step;
  }
  return visible.length ? visible : [lines[0] || ""];
}

/** Steps the type down until the whole paragraph fits, then gives up and clips. */
function fitPreviewTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  minY: number,
  maxY: number,
  fontSize: number,
  lineHeight: number,
  preserveOpenBullet: boolean
) {
  const scales = [1, 0.92, 0.84, 0.76, 0.68, 0.62];
  let bestFit = null as null | {
    fontSize: number;
    lineHeight: number;
    lines: string[];
    visibleLines: string[];
  };

  for (const scale of scales) {
    const nextFontSize = Math.max(fontSize * scale, fontSize * 0.62);
    const nextLineHeight = Math.max(nextFontSize * 1.34, lineHeight * scale);
    ctx.font = `${PREVIEW_TEXT_WEIGHT} ${Math.round(nextFontSize)}px ${previewTextFamily}`;
    const lines = buildPreviewTextLines(ctx, text, maxWidth, preserveOpenBullet);
    const maxBlockHeight = Math.max(nextLineHeight, maxY - minY + nextLineHeight);
    const visibleLines = getVisiblePreviewLines(lines, nextLineHeight, maxBlockHeight);
    bestFit = { fontSize: nextFontSize, lineHeight: nextLineHeight, lines, visibleLines };
    if (visibleLines.length === lines.length) return bestFit;
  }
  return bestFit!;
}

function drawEllipsizedLine(
  ctx: CanvasRenderingContext2D,
  line: string,
  x: number,
  y: number,
  maxWidth: number
) {
  let output = line.endsWith("...") ? line : `${line}...`;
  while (output.length > 4 && ctx.measureText(output).width > maxWidth) {
    output = `${output.slice(0, -4).trimEnd()}...`;
  }
  ctx.fillText(output, x, y);
}

function drawWrappedPreviewText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  minY: number,
  maxWidth: number,
  maxY: number,
  fontSize: number,
  lineHeight: number
) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0, 0, 0, 0.48)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;

  const fit = fitPreviewTextLines(
    ctx, text, maxWidth, minY, maxY, fontSize, lineHeight, true
  );
  const { lines, visibleLines } = fit;

  // Anything that didn't fit is signalled on the last visible line.
  let ellipsisIndex = -1;
  if (lines.length > visibleLines.length) {
    ellipsisIndex = visibleLines.length - 1;
    while (ellipsisIndex > 0 && !visibleLines[ellipsisIndex]) ellipsisIndex -= 1;
    visibleLines[ellipsisIndex] = `${visibleLines[ellipsisIndex]}...`;
  }

  ctx.font = `${PREVIEW_TEXT_WEIGHT} ${Math.round(fit.fontSize)}px ${previewTextFamily}`;
  const visibleHeight = visibleLines.reduce(
    (sum, line) => sum + previewTextStep(line, fit.lineHeight),
    0
  );
  // The block is bottom-anchored, like the poster headline.
  let cy = Math.max(minY, maxY - Math.max(0, visibleHeight - fit.lineHeight));
  visibleLines.forEach((line, index) => {
    if (line) {
      if (index === ellipsisIndex) drawEllipsizedLine(ctx, line, x, cy, maxWidth);
      else ctx.fillText(line, x, cy);
    }
    cy += previewTextStep(line, fit.lineHeight);
  });
  ctx.restore();
}

/** The same photograph, blurred and dimmed, drawn twice for a soft edge. */
function drawTextPreviewBackground(
  ctx: CanvasRenderingContext2D,
  s: PixComposerState,
  image: CanvasImageSource & { width: number; height: number },
  W: number,
  H: number,
  unit: number
) {
  const bleed = 34 * unit;
  const drawX = -bleed;
  const drawY = -bleed;
  const drawW = W + bleed * 2;
  const drawH = H + bleed * 2;
  const zoom = (s.imageZoom || 100) / 100;
  const baseScale = Math.max(drawW / image.width, drawH / image.height);
  const imageScale = baseScale * zoom * IMAGE_PAN_HEADROOM;
  const drawWidth = image.width * imageScale;
  const drawHeight = image.height * imageScale;
  const focal = { x: image.width / 2, y: image.height / 2 };

  const layer = (offset: { x: number; y: number } | null) => {
    let dx = drawX + drawW / 2 - focal.x * imageScale + (offset?.x ?? 0);
    let dy = drawY + drawH / 2 - focal.y * imageScale + (offset?.y ?? 0);
    dx = clamp(dx, drawX + drawW - drawWidth, drawX);
    dy = clamp(dy, drawY + drawH - drawHeight, drawY);
    ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
  };

  ctx.save();
  ctx.filter = `blur(${Math.round(18 * unit)}px) brightness(62%) contrast(108%) saturate(72%)`;
  layer(null);
  layer(s.imageOffset);
  ctx.restore();
}

/**
 * The Text screen — the reader's second slide. The photograph goes soft behind
 * a heavy dim, and the paragraph carries the story.
 */
export function renderTextScreen(
  ctx: CanvasRenderingContext2D,
  s: PixComposerState,
  assets: PixAssets,
  scale = 1
) {
  const L = getLayout(s);
  const { W, H } = L;
  // Everything is specified against the 9:16 canvas, so scale to this preset.
  const unit = Math.min(W / 920, H / 1700);

  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.fillStyle = "#070707";
  ctx.fillRect(0, 0, W, H);

  if (assets.image) drawTextPreviewBackground(ctx, s, assets.image, W, H, unit);

  const dim = ctx.createLinearGradient(0, 0, 0, H);
  dim.addColorStop(0, "rgba(0, 0, 0, 0.68)");
  dim.addColorStop(0.34, "rgba(0, 0, 0, 0.52)");
  dim.addColorStop(0.62, "rgba(0, 0, 0, 0.68)");
  dim.addColorStop(1, "rgba(0, 0, 0, 0.98)");
  ctx.fillStyle = dim;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
  ctx.fillRect(0, 0, W, H);

  drawLogo(ctx, s, assets.logo);

  drawWrappedPreviewText(
    ctx,
    s.detailText || "Write the paragraph for the Text preview.",
    L.headline.x,
    H * 0.1,
    L.headline.maxWidth,
    H - 335 * (H / 1700),
    39 * unit,
    61 * unit
  );

  ctx.restore();
}

/* ── Entry point ─────────────────────────────────────────────────────── */

export type PixAssets = {
  image: (CanvasImageSource & { width: number; height: number }) | null;
  logo: HTMLImageElement | null;
  tag: HTMLImageElement | null;
};

/**
 * Draws one poster. `scale` renders at a multiple of the design size for
 * export — layout still reads the design dimensions, so nothing shifts.
 */
export function renderPoster(
  ctx: CanvasRenderingContext2D,
  s: PixComposerState,
  assets: PixAssets,
  scale = 1
) {
  const L = getLayout(s);
  const { W, H } = L;

  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const { layout, top } = computeHeadlineLayoutAndTop(ctx, s, H);

  drawBackground(ctx, W, H);
  drawHero(ctx, s, assets.image, W, H, top);
  drawLogo(ctx, s, assets.logo);
  drawTag(ctx, s, assets.tag, top);
  drawHeadline(ctx, s, layout, top);

  ctx.restore();
}
