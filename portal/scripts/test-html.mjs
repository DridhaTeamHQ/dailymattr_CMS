#!/usr/bin/env node
/**
 * Checks stripTagBlocks against the regex it replaced.
 *
 * Both scrapers used to strip tag blocks with a lazy regex and a backreference.
 * On a real page that costs a millisecond; on a page built to defeat it —
 * thousands of opening tags that are never closed — the engine rescans to the
 * end of the document for every one of them. Measured at 19 seconds on a 2 MB
 * page, inside the 2 MB fetch cap, on the single thread every other request
 * shares.
 *
 * Two things have to stay true, so both are checked here:
 *
 *   1. The replacement produces byte-identical output. It is the same document
 *      going to the same extraction code, so anything else is a silent change
 *      in what gets scraped.
 *   2. It stays linear. The point was never elegance.
 *
 * The equivalence half is fuzzed rather than enumerated. The first version of
 * this passed fourteen hand-written cases and still differed on 121 of 4,000
 * random documents — because a per-tag pass resolves interleaved tags like
 * `<iframe><style>…</iframe>` differently from a single left-to-right pass.
 * None of the cases written by hand had thought to interleave them.
 *
 *   node scripts/test-html.mjs
 */

const isWordChar = (c) =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;

function nextOpen(lower, tag, from) {
  const open = `<${tag}`;
  let at = from;
  for (;;) {
    const i = lower.indexOf(open, at);
    if (i === -1) return -1;
    const n = lower.charCodeAt(i + open.length);
    if (Number.isNaN(n) || !isWordChar(n)) return i;
    at = i + open.length;
  }
}

/** Kept in step with lib/html.ts by hand — see the note at the bottom. */
function stripTagBlocks(html, tags) {
  const lower = html.toLowerCase();
  const parts = [];
  const retired = new Set();
  let cursor = 0;
  let from = 0;
  for (;;) {
    let bestStart = -1;
    let bestTag = null;
    for (const tag of tags) {
      if (retired.has(tag)) continue;
      const s = nextOpen(lower, tag, from);
      if (s === -1) {
        retired.add(tag);
        continue;
      }
      if (bestStart === -1 || s < bestStart) {
        bestStart = s;
        bestTag = tag;
      }
    }
    if (bestStart === -1 || !bestTag) break;
    const close = `</${bestTag}>`;
    const end = lower.indexOf(close, bestStart + bestTag.length + 1);
    if (end === -1) {
      retired.add(bestTag);
      continue;
    }
    parts.push(html.slice(cursor, bestStart), " ");
    cursor = end + close.length;
    from = cursor;
  }
  if (cursor === 0) return html;
  parts.push(html.slice(cursor));
  return parts.join("");
}

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
};

const SETS = [
  {
    name: "script/style/etc (article-scrape, pixScrape)",
    tags: ["script", "style", "noscript", "svg", "iframe", "template"],
    re: /<(script|style|noscript|svg|iframe|template)\b[\s\S]*?<\/\1>/gi,
    frag: ["<p>x</p>", "<script>", "</script>", "<style>", "</style>", "<svg a>",
           "</svg>", "text ", "<scriptx>", "</p>", "<iframe>", "</iframe>",
           "<template>", "</template>", "<noscript>", "</noscript>",
           "<SCRIPT>", "</SCRIPT>"],
  },
  {
    name: "page furniture (article-scrape)",
    tags: ["nav", "header", "footer", "aside", "form", "figcaption"],
    re: /<(nav|header|footer|aside|form|figcaption)\b[\s\S]*?<\/\1>/gi,
    frag: ["<nav>", "</nav>", "<header a>", "</header>", "<form>", "</form>",
           "<aside>", "</aside>", "copy ", "<p>y</p>", "<navx>", "<footer>",
           "</footer>", "<figcaption>", "</figcaption>"],
  },
];

const ROUNDS = Number(process.env.ROUNDS ?? 100_000);

console.log("equivalence with the regex it replaced");
for (const set of SETS) {
  let bad = 0;
  let example = null;
  for (let i = 0; i < ROUNDS; i++) {
    let s = "";
    const n = 2 + Math.floor(Math.random() * 16);
    for (let j = 0; j < n; j++)
      s += set.frag[Math.floor(Math.random() * set.frag.length)];
    if (s.replace(set.re, " ") !== stripTagBlocks(s, set.tags)) {
      bad++;
      example ??= s;
    }
  }
  check(`${set.name}: ${ROUNDS - bad}/${ROUNDS} identical`, bad === 0, example && JSON.stringify(example));
}

console.log("\nstays linear on a page built to be slow");
{
  const tags = SETS[0].tags;
  const re = SETS[0].re;
  const ms = (fn) => {
    const a = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - a) / 1e6;
  };

  // 2 MB is the fetch cap, so this is a page the scraper would accept.
  const hostile = ("<script foo>" + "a".repeat(20))
    .repeat(Math.ceil(2_000_000 / 32))
    .slice(0, 2_000_000);
  const count = (hostile.match(/<script/g) ?? []).length;

  const slow = ms(() => hostile.replace(re, " "));
  const fast = ms(() => stripTagBlocks(hostile, tags));
  console.log(`     ${count} unclosed tags in 2 MB: regex ${slow.toFixed(0)}ms, linear ${fast.toFixed(0)}ms`);
  check("under 250ms where the regex took seconds", fast < 250, `${fast.toFixed(0)}ms`);

  const normal = ("<p>" + "word ".repeat(60) + "</p><script>x</script>")
    .repeat(4000)
    .slice(0, 2_000_000);
  const n = ms(() => stripTagBlocks(normal, tags));
  check("still quick on an ordinary 2 MB page", n < 250, `${n.toFixed(0)}ms`);
}

console.log(`\n${failures ? `${failures} failed` : "all good"}`);
process.exit(failures ? 1 : 0);

/* The implementation is duplicated above rather than imported, because lib is
   TypeScript and this runs on plain node with no build step — the same reason
   test-api.mjs talks to a running server instead of importing route handlers.
   If lib/html.ts changes, change it here too; the equivalence check is what
   catches a divergence, and it can only catch one it can see. */
