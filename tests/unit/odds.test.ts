import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  EDGE_MARGIN,
  TOTAL_WEIGHT,
  WEIGHTS,
  generateCouponCode,
  landingAngle,
  outcomeForRoll,
  pickWeightedOutcome,
  type Rng,
} from "@/lib/odds";
import { SEGMENTS, SEGMENT_ANGLE, segmentUnderPointer, type OutcomeId } from "@/lib/segments";

const TARGET_PCT: Record<OutcomeId, number> = {
  pct_5: 30,
  pct_10: 25,
  pct_15: 20,
  pct_20: 12,
  pct_30: 7,
  pct_50: 4,
  free_consult: 1.5,
  pct_90: 0.5,
};

function simulate(n: number) {
  const counts = Object.fromEntries(WEIGHTS.map(([id]) => [id, 0])) as Record<OutcomeId, number>;
  for (let i = 0; i < n; i++) counts[pickWeightedOutcome()]++;
  return counts;
}

describe("weighted table", () => {
  it("has exactly one weight per wheel segment, summing to 100%", () => {
    expect(TOTAL_WEIGHT).toBe(10_000);
    expect(WEIGHTS.map(([id]) => id).sort()).toEqual(SEGMENTS.map((s) => s.id).sort());
    for (const [id, w] of WEIGHTS) expect(w / 100).toBe(TARGET_PCT[id]);
  });

  it("maps every possible roll to an outcome with exactly the target frequency (no rounding loss)", () => {
    const counts: Record<string, number> = {};
    for (let roll = 0; roll < TOTAL_WEIGHT; roll++) {
      const id = outcomeForRoll(roll);
      counts[id] = (counts[id] ?? 0) + 1;
    }
    expect(counts).toEqual(Object.fromEntries(WEIGHTS));
  });

  it("resolves both sides of every cumulative band boundary to the correct segment (no off-by-one)", () => {
    let lower = 0;
    WEIGHTS.forEach(([id, w], i) => {
      const upper = lower + w;
      expect(outcomeForRoll(lower), `first roll of ${id}`).toBe(id);
      expect(outcomeForRoll(upper - 1), `last roll of ${id}`).toBe(id);
      if (i < WEIGHTS.length - 1) expect(outcomeForRoll(upper), `first roll after ${id}`).toBe(WEIGHTS[i + 1][0]);
      lower = upper;
    });
    // Spelled out for the cutoffs people ask about.
    expect(outcomeForRoll(7499)).toBe("pct_15");
    expect(outcomeForRoll(7500)).toBe("pct_20");
    expect(outcomeForRoll(9949)).toBe("free_consult");
    expect(outcomeForRoll(9950)).toBe("pct_90");
    expect(outcomeForRoll(9999)).toBe("pct_90");
  });

  it("rejects rolls outside [0, 10000)", () => {
    for (const bad of [-1, 10_000, 1.5, Number.NaN]) expect(() => outcomeForRoll(bad)).toThrow(RangeError);
  });

  it("makes the 0.5% jackpot reachable through the real picker", () => {
    const stub = (value: number): Rng => () => value;
    expect(pickWeightedOutcome(stub(9950))).toBe("pct_90");
    expect(pickWeightedOutcome(stub(9999))).toBe("pct_90");
  });
});

describe("simulated spins (crypto RNG)", () => {
  it("10,000 spins land within ±1.5 percentage points of every target", () => {
    const n = 10_000;
    const counts = simulate(n);
    for (const [id, target] of Object.entries(TARGET_PCT) as [OutcomeId, number][]) {
      expect(Math.abs((counts[id] / n) * 100 - target), id).toBeLessThanOrEqual(1.5);
    }
  });

  it("1,000,000 spins: within ±0.25 points of every target, jackpot hit, and passes a chi-square fit", () => {
    const n = 1_000_000;
    const counts = simulate(n);
    let chi2 = 0;
    const rows: string[] = [];
    for (const [id, target] of Object.entries(TARGET_PCT) as [OutcomeId, number][]) {
      const observedPct = (counts[id] / n) * 100;
      const expected = (target / 100) * n;
      chi2 += (counts[id] - expected) ** 2 / expected;
      rows.push(`${id.padEnd(13)} target ${String(target).padStart(4)}%  observed ${observedPct.toFixed(3).padStart(7)}%`);
      expect(Math.abs(observedPct - target), id).toBeLessThanOrEqual(0.25);
    }
    console.log(`\n${rows.join("\n")}\nchi² = ${chi2.toFixed(2)} (df 7, p=0.001 critical 24.32)`);
    expect(counts.pct_90).toBeGreaterThan(0);
    expect(chi2).toBeLessThan(24.32);
  });
});

describe("landing angle ↔ visual segment", () => {
  const minClearance = SEGMENT_ANGLE * EDGE_MARGIN - 0.01;

  it("always puts the pointer inside the chosen wedge, clear of both edges (20,000 samples per segment)", () => {
    const failures: string[] = [];
    let tightest = Infinity;
    SEGMENTS.forEach((segment, index) => {
      for (let i = 0; i < 20_000; i++) {
        const angle = landingAngle(index);
        const wheelAngle = (((360 - (angle % 360)) % 360) + 360) % 360;
        const intoWedge = wheelAngle - index * SEGMENT_ANGLE;
        const clearance = Math.min(intoWedge, SEGMENT_ANGLE - intoWedge);
        tightest = Math.min(tightest, clearance);
        if (segmentUnderPointer(angle) !== index || clearance < minClearance || angle < 6 * 360 || angle >= 9 * 360) {
          failures.push(`${segment.id}: angle ${angle}, clearance ${clearance.toFixed(2)}°`);
        }
      }
    });
    console.log(`160,000 landing angles checked; closest approach to a wedge edge: ${tightest.toFixed(2)}°`);
    expect(failures).toEqual([]);
  });

  it("stays in the wedge at the extreme jitter values", () => {
    const low: Rng = (min) => min;
    const high: Rng = (_min, max) => max - 1;
    SEGMENTS.forEach((_, index) => {
      expect(segmentUnderPointer(landingAngle(index, low))).toBe(index);
      expect(segmentUnderPointer(landingAngle(index, high))).toBe(index);
    });
  });

  it("still lands correctly when the client adds it on top of an existing rotation", () => {
    // Mirrors SpinExperience: next = ceil(prev / 360) * 360 + angle
    for (const prev of [0, 1, 147.06, 359.99, 720, 1000.5, 2667.06]) {
      SEGMENTS.forEach((_, index) => {
        const angle = landingAngle(index);
        expect(segmentUnderPointer(Math.ceil(prev / 360) * 360 + angle)).toBe(index);
      });
    }
  });
});

describe("coupon codes", () => {
  it("match the DB format and use only unambiguous characters", () => {
    for (let i = 0; i < 5_000; i++) {
      expect(generateCouponCode()).toMatch(/^WEBAURA-[2-9A-HJKMNP-Z]{6}$/);
    }
  });

  it("are uniformly random per character (not sequential or predictable)", () => {
    const n = 40_000;
    const counts = new Map<string, number>();
    let previous = "";
    let sharedPrefix = 0;
    for (let i = 0; i < n; i++) {
      const code = generateCouponCode();
      for (const ch of code.slice(8)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
      if (code.slice(0, 11) === previous.slice(0, 11)) sharedPrefix++;
      previous = code;
    }
    const expected = (n * 6) / CODE_ALPHABET.length;
    let chi2 = 0;
    for (const ch of CODE_ALPHABET) chi2 += ((counts.get(ch) ?? 0) - expected) ** 2 / expected;
    expect(counts.size).toBe(CODE_ALPHABET.length);
    expect(chi2).toBeLessThan(59.7); // df 30, p=0.001
    // Consecutive codes sharing their first 3 random chars would suggest a counter.
    expect(sharedPrefix).toBeLessThan(10);
  });
});
