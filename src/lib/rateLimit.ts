import "server-only";
import { createHash } from "node:crypto";

/**
 * Client IP from proxy headers. Only trustworthy behind a proxy that overwrites
 * these headers (Vercel does); on a bare `next start` a client can spoof them.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Hashed so raw IPs are never stored. IPv6 is bucketed by /64 because a single
 * subscriber typically controls a whole /64 and could rotate within it.
 */
export function hashIp(ip: string): string {
  let key = ip;
  if (ip.includes(":") && !ip.startsWith("::ffff:")) {
    const [head, tail = ""] = ip.toLowerCase().split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    const groups = ip.includes("::")
      ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
      : left;
    key = groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
  }
  const salt = process.env.IP_HASH_SALT ?? "webaura-spin";
  return createHash("sha256").update(`${salt}:${key}`).digest("hex").slice(0, 32);
}

export function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Per-instance sliding-window limiter. On serverless each instance has its own
 * memory, so this only blunts bursts; the DB-backed per-IP cap on new spins in
 * spin.ts is the limit that holds across instances.
 */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  /** Returns 0 if allowed, otherwise seconds until the next slot frees up. */
  check(key: string, now = Date.now()): number {
    this.sweep(now);
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000));
    }
    recent.push(now);
    this.hits.set(key, recent);
    return 0;
  }

  private sweep(now: number) {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    const cutoff = now - this.windowMs;
    for (const [key, times] of this.hits) {
      if (times[times.length - 1] <= cutoff) this.hits.delete(key);
    }
  }
}
