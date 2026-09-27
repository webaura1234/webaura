import { describe, expect, it } from "vitest";
import { SlidingWindowLimiter, clientIp, hashIp } from "@/lib/rateLimit";

describe("SlidingWindowLimiter", () => {
  it("allows up to the limit per window, then throttles with a retry hint", () => {
    const limiter = new SlidingWindowLimiter(20, 60_000);
    const t0 = 1_000_000;
    for (let i = 0; i < 20; i++) expect(limiter.check("1.2.3.4", t0 + i)).toBe(0);
    const retry = limiter.check("1.2.3.4", t0 + 20);
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(60);
    expect(limiter.check("5.6.7.8", t0 + 20)).toBe(0);
    expect(limiter.check("1.2.3.4", t0 + 60_001)).toBe(0);
  });
});

describe("clientIp / hashIp", () => {
  it("takes the first X-Forwarded-For hop, then X-Real-IP", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "49.36.1.2, 10.0.0.1" }))).toBe("49.36.1.2");
    expect(clientIp(new Headers({ "x-real-ip": "49.36.1.3" }))).toBe("49.36.1.3");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("stores a stable hash, never the raw IP, and buckets IPv6 by /64", () => {
    const h = hashIp("49.36.1.2");
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).toBe(hashIp("49.36.1.2"));
    expect(h).not.toBe(hashIp("49.36.1.3"));
    expect(hashIp("2409:4070:1:2:aaaa::1")).toBe(hashIp("2409:4070:1:2:bbbb::9"));
    expect(hashIp("2409:4070:1:2::1")).not.toBe(hashIp("2409:4070:1:3::1"));
    expect(hashIp("2409:4070::1")).toBe(hashIp("2409:4070:0:0:ffff::2"));
    expect(hashIp("2409:4070:0001:0002::1")).toBe(hashIp("2409:4070:1:2::1"));
  });
});
