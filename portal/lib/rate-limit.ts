/**
 * Minimal in-memory sliding-window rate limiter.
 *
 * Scope caveat: state lives in the Node process, so it resets on restart and is
 * per-instance. Good enough for the single-instance CMS portal; swap the Map for
 * Redis/Upstash before running more than one server behind a load balancer.
 */

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

/** Drop buckets nobody has touched in the last hour so the Map cannot grow forever. */
const sweep = (now: number, maxWindowMs: number) => {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    const fresh = bucket.hits.filter((t) => now - t < maxWindowMs);
    if (fresh.length === 0) buckets.delete(key);
    else bucket.hits = fresh;
  }
};

export interface LimitRule {
  /** Bucket name, e.g. "scrape-article:ip". */
  key: string;
  /** Max hits allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface LimitResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the oldest hit falls out of the window. */
  retryAfter: number;
}

/**
 * Checks every rule and records a hit only when all of them pass, so a request
 * rejected by the global cap does not also burn the caller's personal quota.
 */
export function rateLimit(rules: LimitRule[]): LimitResult {
  const now = Date.now();
  const maxWindow = Math.max(...rules.map((r) => r.windowMs), 3_600_000);
  sweep(now, maxWindow);

  let remaining = Number.POSITIVE_INFINITY;

  for (const rule of rules) {
    const bucket = buckets.get(rule.key) ?? { hits: [] };
    const hits = bucket.hits.filter((t) => now - t < rule.windowMs);
    bucket.hits = hits;
    buckets.set(rule.key, bucket);

    if (hits.length >= rule.limit) {
      const oldest = hits[0];
      return {
        ok: false,
        remaining: 0,
        retryAfter: Math.max(1, Math.ceil((rule.windowMs - (now - oldest)) / 1000)),
      };
    }
    remaining = Math.min(remaining, rule.limit - hits.length - 1);
  }

  for (const rule of rules) buckets.get(rule.key)!.hits.push(now);

  return { ok: true, remaining, retryAfter: 0 };
}

/** Best-effort client IP from proxy headers, falling back to a shared bucket. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Guards against a single caller firing many concurrent scrapes. */
const inFlight = new Set<string>();

export function acquireSlot(key: string): boolean {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

export function releaseSlot(key: string): void {
  inFlight.delete(key);
}
