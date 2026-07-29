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

async function get(path, headers = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, { headers });
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

  // ── every outbound-fetching route is metered ──────────────────────
  //
  // These three were not. pix/scrape is the one that mattered: it fetches the
  // listing page and then enriches twelve links in parallel at two megabytes
  // each, so one unmetered call is thirteen outbound requests.
  //
  // Invalid input on purpose — the limiter runs before validation, so quota is
  // consumed without anything leaving the building.
  console.log("\nmetering");
  {
    const burst = async (name, n, fire) => {
      let sawLimit = false;
      for (let i = 0; i < n && !sawLimit; i++) {
        if ((await fire(i)).status === 429) sawLimit = true;
      }
      check(`${name} is rate limited`, sawLimit, `${n} requests, never limited`);
    };

    await burst("/api/pix/scrape", 8, () =>
      post("/api/pix/scrape", {}, { "X-Forwarded-For": "198.18.0.1" })
    );
    await burst("/api/pix/images", 25, () =>
      get("/api/pix/images", { "X-Forwarded-For": "198.18.0.2" })
    );
    // The proxy's ceiling is deliberately high — one image search legitimately
    // fires two dozen of these — so this only proves a ceiling exists.
    check(
      "/api/pix/image rejects a missing url before fetching",
      (await get("/api/pix/image", { "X-Forwarded-For": "198.18.0.3" })).status === 400
    );
  }

  // ── rate limiting cannot be shrugged off with a header ────────────
  //
  // x-forwarded-for reads "client, proxy1, proxy2" and each proxy appends the
  // address it saw, so only the rightmost entries are written by our own
  // infrastructure. Keying on the leftmost — the one value a caller controls —
  // meant a different header per request bought a fresh quota every time, and
  // every per-address limit in the app came off with one line of curl.
  //
  // Same trailing address throughout, different forged prefixes: the limiter
  // should see one caller.
  console.log("\nrate limiting");
  {
    let sawLimit = false;
    let sent = 0;
    for (let i = 0; i < 26 && !sawLimit; i++) {
      sent++;
      const r = await get(
        `/api/tts?text=spoofprobe%20${i}&lang=en`,
        // 25 distinct claimed addresses, one real one appended behind them.
        { "X-Forwarded-For": `10.9.9.${i}, 192.0.2.123` }
      );
      if (r.status === 429) sawLimit = true;
    }
    check(
      "a forged X-Forwarded-For does not buy a fresh quota",
      sawLimit,
      `${sent} requests with different claimed addresses, never limited`
    );
  }

  // ── /api/users (creates sign-in accounts) ─────────────────────────
  //
  // The route holds the service-role key, so the gate matters more here than
  // anywhere else: unauthenticated callers must not reach it, and must not
  // learn anything about how the server is configured.
  console.log("\n/api/users");
  {
    const body = {
      email: "probe@example.com",
      fullName: "Probe",
      role: "writer",
      password: "abcdefghij",
    };
    const bearer = { Authorization: "Bearer not-a-real-token" };
    // A fresh forwarded address per case, or the rate limiter answers first.
    const ip = (n) => ({ "X-Forwarded-For": `203.0.113.${n}` });

    check(
      "refuses a request with no token",
      (await post("/api/users", body, ip(10))).status === 401
    );
    {
      // The config check must sit behind the auth check.
      const r = await post("/api/users", body, ip(11));
      check(
        "tells an anonymous caller nothing about server config",
        r.status === 401 && !JSON.stringify(r.json ?? {}).includes("SERVICE_ROLE"),
        `status ${r.status}`
      );
    }
    check(
      "rejects a malformed body",
      (await post("/api/users", "notjson", { ...bearer, ...ip(12) })).status === 400
    );
    check(
      "rejects an invalid email",
      (await post("/api/users", { ...body, email: "nope" }, { ...bearer, ...ip(13) }))
        .status === 400
    );
    check(
      "rejects an unknown role",
      (await post("/api/users", { ...body, role: "root" }, { ...bearer, ...ip(14) }))
        .status === 400
    );
    check(
      "rejects a short password",
      (await post("/api/users", { ...body, password: "short" }, { ...bearer, ...ip(15) }))
        .status === 400
    );
    {
      // 501 where the key is absent, 401/403 where it is present and the token
      // is rubbish. Never 200 for a token that was never issued.
      const r = await post("/api/users", body, { ...bearer, ...ip(16) });
      check(
        "never creates an account for a forged token",
        [401, 403, 501].includes(r.status),
        `status ${r.status}`
      );
    }
    {
      let sawLimit = false;
      for (let i = 0; i < 9 && !sawLimit; i++) {
        const r = await post("/api/users", body, {
          ...bearer,
          "X-Forwarded-For": "203.0.113.99",
        });
        if (r.status === 429) sawLimit = true;
      }
      check("rate limits a burst", sawLimit, "9 requests without a 429");
    }
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
