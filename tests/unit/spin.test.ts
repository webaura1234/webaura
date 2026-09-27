import { describe, expect, it, vi } from "vitest";
import type { CouponRecord, CouponStore, InsertResult } from "@/lib/db";
import { RateLimitError, maskPhone, spin, type SpinInput } from "@/lib/spin";
import { COUPON_TTL_MS, segmentIndexOf, segmentUnderPointer } from "@/lib/segments";

class FakeStore implements CouponStore {
  rows = new Map<string, CouponRecord>();
  codes = new Set<string>();
  insertCalls: CouponRecord[] = [];
  /** Force the next N inserts to report a code collision. */
  codeCollisions = 0;
  failInsert: Error | null = null;
  failLookup: Error | null = null;
  recentByIp = 0;

  async findByPhone(phone: string) {
    if (this.failLookup) throw this.failLookup;
    return this.rows.get(phone) ?? null;
  }

  async insert(record: CouponRecord): Promise<InsertResult> {
    this.insertCalls.push(record);
    if (this.failInsert) throw this.failInsert;
    if (this.codeCollisions > 0) {
      this.codeCollisions--;
      return { ok: false, conflict: "code" };
    }
    if (this.rows.has(record.phone)) return { ok: false, conflict: "phone" };
    if (this.codes.has(record.code)) return { ok: false, conflict: "code" };
    this.rows.set(record.phone, record);
    this.codes.add(record.code);
    return { ok: true };
  }

  async countSinceByIp() {
    return this.recentByIp;
  }
}

const input = (over: Partial<SpinInput> = {}): SpinInput => ({
  name: "Priya Sharma",
  phone: "919876543210",
  source: "whatsapp",
  ipHash: "iphash",
  ...over,
});

const FIXED_NOW = Date.UTC(2026, 8, 27, 10, 0, 0);

describe("spin()", () => {
  it("creates one record with an exact +48h expiry and a matching landing angle", async () => {
    const store = new FakeStore();
    const res = await spin(input(), store, { now: () => FIXED_NOW });
    const row = store.rows.get("919876543210")!;

    expect(store.insertCalls).toHaveLength(1);
    expect(res.alreadySpun).toBe(false);
    expect(res.code).toBe(row.code);
    expect(res.outcome.id).toBe(row.outcome);
    expect(new Date(row.expiresAt).getTime() - new Date(row.createdAt).getTime()).toBe(COUPON_TTL_MS);
    expect(row.createdAt).toBe("2026-09-27T10:00:00.000Z");
    expect(res.expiresAt).toBe("2026-09-29T10:00:00.000Z");
    expect(res.serverNow).toBe("2026-09-27T10:00:00.000Z");
    expect(res.expired).toBe(false);
    expect(segmentUnderPointer(res.angle)).toBe(segmentIndexOf(res.outcome.id));
  });

  it("returns the stored result for a repeat phone without spinning again", async () => {
    const store = new FakeStore();
    const first = await spin(input(), store);
    for (let i = 0; i < 20; i++) {
      const again = await spin(input({ name: "Someone Else" }), store);
      expect(again.alreadySpun).toBe(true);
      expect(again.code).toBe(first.code);
      expect(again.outcome).toEqual(first.outcome);
      expect(segmentUnderPointer(again.angle)).toBe(segmentIndexOf(first.outcome.id));
    }
    expect(store.insertCalls).toHaveLength(1);
  });

  it("never echoes the stored name back to a different requester", async () => {
    const store = new FakeStore();
    await spin(input({ name: "Priya Sharma" }), store);
    const probe = await spin(input({ name: "Curious Stranger" }), store);
    expect(probe.name).toBe("Curious Stranger");
    expect(JSON.stringify(probe)).not.toContain("Priya");
    expect(probe.phoneMasked).toBe("+91 ••••••3210");
  });

  it("retries with a fresh code on collision and stores only a unique one", async () => {
    const store = new FakeStore();
    store.codeCollisions = 3;
    const res = await spin(input(), store);
    const tried = store.insertCalls.map((r) => r.code);
    expect(tried).toHaveLength(4);
    expect(new Set(tried).size).toBe(4);
    expect(res.code).toBe(tried[3]);
    expect(store.rows.size).toBe(1);
  });

  it("gives up (no coupon shown) if every code attempt collides", async () => {
    const store = new FakeStore();
    store.codeCollisions = 100;
    await expect(spin(input(), store)).rejects.toThrow(/unique coupon code/);
    expect(store.rows.size).toBe(0);
  });

  it("honours the winner when a concurrent request for the same phone inserted first", async () => {
    const store = new FakeStore();
    const winner: CouponRecord = {
      name: "Priya Sharma",
      phone: "919876543210",
      outcome: "pct_50",
      outcomeLabel: "50% OFF",
      discountPct: 50,
      code: "WEBAURA-WINNER",
      source: null,
      ipHash: null,
      createdAt: new Date(FIXED_NOW).toISOString(),
      expiresAt: new Date(FIXED_NOW + COUPON_TTL_MS).toISOString(),
    };
    // Lookup misses (row not there yet), then the insert races and loses.
    const realFind = store.findByPhone.bind(store);
    let lookups = 0;
    store.findByPhone = vi.fn(async (phone: string) => {
      if (lookups++ === 0) {
        store.rows.set(phone, winner);
        return null;
      }
      return realFind(phone);
    });
    const res = await spin(input(), store);
    expect(res.alreadySpun).toBe(true);
    expect(res.code).toBe("WEBAURA-WINNER");
    expect(res.outcome.id).toBe("pct_50");
  });

  it("propagates storage failures so the user never sees an unrecorded win", async () => {
    const store = new FakeStore();
    store.failInsert = new Error("connection refused");
    await expect(spin(input(), store)).rejects.toThrow("connection refused");

    const store2 = new FakeStore();
    store2.failLookup = new Error("timeout");
    await expect(spin(input(), store2)).rejects.toThrow("timeout");
    expect(store2.insertCalls).toHaveLength(0);
  });

  it("caps new spins per network but still returns existing coupons", async () => {
    const store = new FakeStore();
    await spin(input(), store, { newSpinsPerIpPerHour: 10 });
    store.recentByIp = 10;

    await expect(spin(input({ phone: "919000000001" }), store, { newSpinsPerIpPerHour: 10 })).rejects.toBeInstanceOf(RateLimitError);
    const existing = await spin(input(), store, { newSpinsPerIpPerHour: 10 });
    expect(existing.alreadySpun).toBe(true);
  });

  it("flags an expired coupon using the server clock", async () => {
    const store = new FakeStore();
    await spin(input(), store, { now: () => FIXED_NOW });
    const justBefore = await spin(input(), store, { now: () => FIXED_NOW + COUPON_TTL_MS - 1 });
    const atExpiry = await spin(input(), store, { now: () => FIXED_NOW + COUPON_TTL_MS });
    expect(justBefore.expired).toBe(false);
    expect(atExpiry.expired).toBe(true);
    expect(atExpiry.code).toBe(justBefore.code);
  });

  it("masks all but the last four digits", () => {
    expect(maskPhone("919876543210")).toBe("+91 ••••••3210");
  });
});
