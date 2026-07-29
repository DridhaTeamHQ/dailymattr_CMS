#!/usr/bin/env node
/**
 * Contract tests for every API route.
 *
 * Checks the things that are cheap to get wrong and expensive to discover in
 * production: input validation, auth, SSRF refusal, path traversal, and the
 * shape of what comes back. It does not test the UI — that needs a session.
 *
 *   node scripts/test-api.mjs                    # against localhost:3000
 *   BASE=https://cms.example.com node scripts/test-api.mjs
 *
 * Outbound-fetching routes are pointed at example.com, which is IANA's
 * reserved documentation domain and safe to hit.
 */

const BASE = process.env.BASE ?? "http://localhost:3000";

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function post(path, body, headers = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* not json */
    }
    return { status: res.status, json };
  } catch (e) {
    return { status: 0, json: null, error: e.message };
  }
}

async function get(path) {
  try {
    const res = await fetch(`${BASE}${path}`);
    return { status: res.status, type: res.headers.get("content-type") };
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

/** Routes that reach out to the network must refuse to reach inward. */
const SSRF_TARGETS = [
  "http://127.0.0.1/",
  "http://localhost:3000/api/scrape",
  "http://169.254.169.254/latest/meta-data/", // cloud metadata
  "http://10.0.0.1/",
  "http://192.168.1.1/",
  "file:///etc/passwd",
];

async function main() {
  console.log(`Testing ${BASE}\n`);

  // ── liveness ──────────────────────────────────────────────────────
  console.log("server");
  const root = await get("/");
  check("server is reachable", root.status > 0, root.error);
  if (root.status === 0) {
    console.log("\nServer is not running. Start it and re-run.");
    process.exit(1);
  }

  // ── /api/refit ────────────────────────────────────────────────────
  console.log("\n/api/refit");
  check("rejects a non-JSON body", (await post("/api/refit", "not json")).status === 400);
  check(
    "rejects a missing summary",
    [400, 422].includes((await post("/api/refit", { title: "x" })).status)
  );
  {
    const r = await post("/api/refit", {
      title: "A headline that is really quite a lot longer than a card will ever hold",
      summary:
        "One sentence that carries the story. " +
        "A second sentence that adds detail nobody strictly needs. " +
        "A third that pushes this comfortably past any card limit. " +
        "A fourth for good measure, so the trim has something to remove.",
    });
    check(
      "trims long copy or explains why it cannot",
      [200, 429, 502, 503].includes(r.status),
      `status ${r.status}`
    );
    if (r.status === 200) {
      check("returns a title", typeof r.json?.title === "string");
      check("returns a summary", typeof r.json?.summary === "string");
      check(
        "the summary actually got shorter",
        (r.json?.summary?.length ?? 1e9) < 240,
        `got ${r.json?.summary?.length}`
      );
    }
  }

  // ── /api/scrape ───────────────────────────────────────────────────
  console.log("\n/api/scrape");
  check("rejects a missing url", (await post("/api/scrape", {})).status === 400);
  check(
    "rejects a non-string url",
    (await post("/api/scrape", { url: 42 })).status === 400
  );
  for (const target of SSRF_TARGETS) {
    const r = await post("/api/scrape", { url: target });
    check(
      `refuses ${target}`,
      r.status >= 400 && r.status !== 404,
      `status ${r.status}`
    );
  }

  // ── /api/pix/scrape + scrape-article ──────────────────────────────
  for (const path of ["/api/pix/scrape", "/api/pix/scrape-article"]) {
    console.log(`\n${path}`);
    check("rejects a missing url", (await post(path, {})).status === 400);
    for (const target of SSRF_TARGETS.slice(0, 4)) {
      const r = await post(path, { url: target });
      check(`refuses ${target}`, r.status >= 400 && r.status !== 404, `status ${r.status}`);
    }
  }

  // ── /api/pix/image (proxy) ────────────────────────────────────────
  console.log("\n/api/pix/image");
  check("rejects a missing url", (await get("/api/pix/image")).status >= 400);
  for (const target of SSRF_TARGETS.slice(0, 4)) {
    const r = await get(`/api/pix/image?url=${encodeURIComponent(target)}`);
    check(`refuses ${target}`, r.status >= 400, `status ${r.status}`);
  }

  // ── /api/pix/images (search) ──────────────────────────────────────
  console.log("\n/api/pix/images");
  {
    const r = await post("/api/pix/images", {});
    check("rejects a missing query", r.status >= 400, `status ${r.status}`);
  }

  // ── /api/scrape-video ─────────────────────────────────────────────
  console.log("\n/api/scrape-video");
  check(
    "requires a session (401 without a bearer token)",
    (await post("/api/scrape-video", { url: "https://youtube.com/watch?v=aaaaaaaaaaa" })).status ===
      401
  );
  check(
    "rejects an unsupported host even with a token",
    [400, 401].includes(
      (
        await post(
          "/api/scrape-video",
          { url: "https://example.com/video" },
          { Authorization: "Bearer not-a-real-token" }
        )
      ).status
    )
  );

  // ── /api/tts ──────────────────────────────────────────────────────
  console.log("\n/api/tts");
  check("rejects missing text", (await get("/api/tts")).status === 400);
  check(
    "rejects an oversized body of text",
    (await get(`/api/tts?text=${"a".repeat(2000)}&lang=en`)).status === 413
  );
  for (const lang of ["en&client=injected", "../../etc", "toolongtobealang", "e"]) {
    check(
      `rejects lang "${lang}"`,
      (await get(`/api/tts?text=hi&lang=${encodeURIComponent(lang)}`)).status === 400
    );
  }
  {
    const r = await get("/api/tts?text=Hello%20from%20DailyMattr&lang=en");
    check("synthesises valid input", [200, 429, 502].includes(r.status), `status ${r.status}`);
    if (r.status === 200) check("returns audio/mpeg", (r.type ?? "").includes("audio/mpeg"));
  }
  {
    // One call fans out to ten upstream requests, so it has to be metered.
    let sawLimit = false;
    for (let i = 0; i < 26 && !sawLimit; i++) {
      const r = await get(`/api/tts?text=burst%20${i}&lang=en`);
      if (r.status === 429) sawLimit = true;
    }
    check("rate limits a burst", sawLimit, "26 requests without a 429");
  }

  // ── /api/media/[filename] ─────────────────────────────────────────
  console.log("\n/api/media/[filename]");
  for (const attempt of [
    "..%2F..%2F..%2Fpackage.json",
    "..%5C..%5Cpackage.json",
    "%2Fetc%2Fpasswd",
  ]) {
    const r = await get(`/api/media/${attempt}`);
    check(`refuses traversal ${decodeURIComponent(attempt)}`, r.status >= 400, `status ${r.status}`);
  }

  // ── summary ───────────────────────────────────────────────────────
  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  • ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
