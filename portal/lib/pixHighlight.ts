/**
 * Which words turn blue in a Pix headline.
 *
 * Mirrors the app's `highlight.ts`: decided per headline, on the fly — no model
 * call, no stored field. Figures, months and acronyms always mark. Proper nouns
 * mark too, except the first word and a stoplist of words that are capitalised
 * for position rather than meaning. If more than 45% of the headline would go
 * blue it falls back to figures and acronyms only — a half-blue headline
 * emphasises nothing.
 */

export const PIX_MARK_CEILING = 0.45;

/** Capitalised for position, not meaning — never marked as a proper noun. */
const STOPLIST = new Set(
  [
    "The", "A", "An", "And", "But", "Or", "Nor", "For", "So", "Yet",
    "In", "On", "At", "By", "To", "Of", "From", "With", "Without", "Into",
    "Over", "Under", "After", "Before", "During", "Between", "Across", "Amid",
    "As", "Than", "Then", "Now", "Here", "There", "This", "That", "These",
    "Those", "New", "Old", "Big", "Top", "First", "Last", "Next", "More",
    "Most", "Says", "Said", "Set", "Gets", "Got", "Why", "How", "What",
    "When", "Where", "Who", "Will", "Can", "May", "Not", "No", "Up", "Out",
    "Off", "Down", "Back", "Its", "It", "Is", "Are", "Was", "Were", "Be",
  ].map((w) => w.toLowerCase())
);

const MONTHS = new Set([
  "jan", "january", "feb", "february", "mar", "march", "apr", "april",
  "may", "jun", "june", "jul", "july", "aug", "august", "sep", "sept",
  "september", "oct", "october", "nov", "november", "dec", "december",
]);

/** Strip leading/trailing punctuation but keep %, + and currency marks. */
const core = (token: string) =>
  token.replace(/^[^\p{L}\p{N}₹$€£]+/gu, "").replace(/[^\p{L}\p{N}%+]+$/gu, "");

/** Digits, currency, percentages, and the bn / mn / cr / k / m / b suffixes. */
const isFigure = (c: string) => /\d/.test(c) || /^[₹$€£]/.test(c);

/** Two or more capitals, hyphens allowed: BJP, ISRO, NEET-UG. */
const isAcronym = (c: string) =>
  /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(c) && (c.match(/[A-Z]/g)?.length ?? 0) >= 2;

const isMonth = (c: string) => /^[A-Z]/.test(c) && MONTHS.has(c.toLowerCase());

/** Capitalised, three letters or more. Possessives count — India's is a name. */
const isProper = (c: string) => {
  if (!/^\p{Lu}[\p{L}'’]{2,}$/u.test(c)) return false;
  const bare = c.replace(/['’]s?$/u, "");
  return bare.length >= 3 && !STOPLIST.has(bare.toLowerCase());
};

export type PixSegment = { text: string; marked: boolean };

const HAS_BRACKETS = /[[\](){}]/;

/**
 * The one marking rule both previews use.
 *
 * If the writer bracketed anything, that is a deliberate choice and wins.
 * Otherwise the automatic on-device rule decides, so a plain headline still
 * gets its figures and names picked out. Either way the brackets themselves
 * never render.
 */
export function markPixHeadline(headline: string): PixSegment[] {
  if (!HAS_BRACKETS.test(headline)) return markHeadline(headline);

  const out: PixSegment[] = [];
  let open = false;

  for (const raw of headline.split(/(\s+)/)) {
    if (!raw) continue;
    if (!raw.trim()) {
      if (out.length) out[out.length - 1].text += raw;
      else out.push({ text: raw, marked: false });
      continue;
    }

    const opening = /[[({]/.test(raw);
    const closing = /[\])}]/.test(raw);
    if (opening) open = true;

    const word = raw.replace(/[[\](){}]/g, "");
    if (word) {
      const last = out[out.length - 1];
      if (last && last.marked === open) last.text += word;
      else out.push({ text: word, marked: open });
    }

    if (closing) open = false;
  }

  return out;
}

/**
 * Splits a headline into runs of marked / unmarked text. Adjacent marked words
 * land in the same segment, so "PM Modi" reads as one blue run.
 */
export function markHeadline(
  headline: string,
  opts?: { ignoreCeiling?: boolean }
): PixSegment[] {
  const tokens = headline.split(/(\s+)/).filter((t) => t !== "");
  const words = tokens.filter((t) => t.trim());

  // Pass one: classify. Proper nouns are provisional — the ceiling may drop them.
  let firstWordSeen = false;
  const strong: boolean[] = [];
  const soft: boolean[] = [];
  for (const t of tokens) {
    if (!t.trim()) {
      strong.push(false);
      soft.push(false);
      continue;
    }
    const c = core(t);
    const isFirst = !firstWordSeen;
    firstWordSeen = true;
    const hard = !!c && (isFigure(c) || isAcronym(c) || isMonth(c));
    strong.push(hard);
    // Never the first word — a capital there is grammar, not a name.
    soft.push(!hard && !isFirst && !!c && isProper(c));
  }

  // Pass two: the 45% ceiling, measured on visible characters.
  const total = words.join("").length || 1;
  let markedChars = 0;
  tokens.forEach((t, i) => {
    if (strong[i] || soft[i]) markedChars += t.trim().length;
  });
  const keepSoft =
    opts?.ignoreCeiling === true || markedChars / total <= PIX_MARK_CEILING;

  // Pass three: collapse into runs.
  const out: PixSegment[] = [];
  tokens.forEach((t, i) => {
    const marked = strong[i] || (keepSoft && soft[i]);
    const last = out[out.length - 1];
    // Whitespace joins whichever run it sits between when both sides match.
    if (last && last.marked === marked) last.text += t;
    else if (!t.trim() && last) last.text += t;
    else out.push({ text: t, marked });
  });
  return out;
}

/**
 * What the editor shows the writer: the share that actually renders blue, and
 * whether the ceiling kicked in and dropped the proper nouns.
 */
export function markReport(headline: string): {
  share: number;
  cappedBack: boolean;
} {
  const total = headline.replace(/\s+/g, "").length || 1;
  const measure = (segs: PixSegment[]) =>
    segs
      .filter((s) => s.marked)
      .reduce((n, s) => n + s.text.replace(/\s+/g, "").length, 0) / total;

  const actual = measure(markHeadline(headline));
  // Re-run without the ceiling to see whether it changed the outcome.
  const uncapped = measure(markHeadline(headline, { ignoreCeiling: true }));
  return { share: actual, cappedBack: uncapped - actual > 1e-9 };
}
