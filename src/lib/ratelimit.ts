/**
 * Best-effort in-memory rate limit for the routes that call Claude.
 * Two buckets: per client IP (fixed window) and a global daily cap, so a
 * public demo link can't drain the API key. In-memory means per server
 * instance: on Vercel each warm instance keeps its own counts, which is
 * enough for a demo, not for production (that would need Redis/KV).
 *
 * Tunable with env vars: RATE_LIMIT_PER_IP (default 150), RATE_LIMIT_WINDOW_MIN
 * (default 10), RATE_LIMIT_DAILY (default 2000). One ladder rung costs about
 * two calls, because the client prefetches the next rung.
 */

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const PER_IP = num(process.env.RATE_LIMIT_PER_IP, 150);
const WINDOW_MS = num(process.env.RATE_LIMIT_WINDOW_MIN, 10) * 60_000;
const DAILY = num(process.env.RATE_LIMIT_DAILY, 2000);
const DAY_MS = 24 * 60 * 60_000;

const ipHits = new Map<string, { start: number; count: number }>();
let day = { start: Date.now(), count: 0 };

export type LimitResult = { ok: true } | { ok: false; scope: "ip" | "daily"; retryAfterSec: number };

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

/** Count one call for this IP; refuse if either bucket is full. */
export function checkRateLimit(ip: string, now = Date.now()): LimitResult {
  if (now - day.start >= DAY_MS) day = { start: now, count: 0 };
  if (day.count >= DAILY) {
    return { ok: false, scope: "daily", retryAfterSec: Math.ceil((day.start + DAY_MS - now) / 1000) };
  }
  let w = ipHits.get(ip);
  if (!w || now - w.start >= WINDOW_MS) {
    w = { start: now, count: 0 };
    ipHits.set(ip, w);
  }
  if (w.count >= PER_IP) {
    return { ok: false, scope: "ip", retryAfterSec: Math.ceil((w.start + WINDOW_MS - now) / 1000) };
  }
  w.count++;
  day.count++;
  if (ipHits.size > 10_000) {
    for (const [k, v] of ipHits) if (now - v.start >= WINDOW_MS) ipHits.delete(k);
  }
  return { ok: true };
}
