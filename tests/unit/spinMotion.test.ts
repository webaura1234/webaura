import { describe, expect, it } from "vitest";
import { landingAngle, type Rng } from "@/lib/odds";
import { SEGMENTS, segmentUnderPointer } from "@/lib/segments";
import { SPIN_TIMING, overshootFor, spinKeyframes, spinMotion } from "@/lib/spinMotion";

function seededRng(seed: number): Rng {
  return (min, max) => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return min + (seed % (max - min));
  };
}

const settleStart = SPIN_TIMING.accelSec + SPIN_TIMING.decelSec;

/** Every server landing for every segment, from a few different previous resting points. */
function* cases(perSegment = 400) {
  const rng = seededRng(7);
  for (let index = 0; index < SEGMENTS.length; index++) {
    for (let k = 0; k < perSegment; k++) {
      const prev = [0, 137.5, 2890.25, 7255][k % 4];
      const target = Math.ceil(prev / 360) * 360 + landingAngle(index, rng);
      yield { index, start: prev, target };
    }
  }
}

describe("spin motion", () => {
  it("starts at rest, ends exactly on the server's rotation", () => {
    for (const { start, target } of cases(50)) {
      const m = spinMotion(start, target);
      expect(m.at(0)).toBe(start);
      expect(m.at(m.durationMs / 1000)).toBe(target);
    }
  });

  it("overshoot and spring-back never leave the winning wedge", () => {
    const failures: string[] = [];
    for (const { index, start, target } of cases()) {
      const m = spinMotion(start, target);
      for (let t = settleStart - 0.6; t <= m.durationMs / 1000 + 0.01; t += 0.004) {
        const seg = segmentUnderPointer(m.at(t));
        // Before the coast ends the wheel is still arriving through the wedge's trailing edge.
        if (t >= settleStart - 0.05 && seg !== index) failures.push(`${SEGMENTS[index].id} t=${t.toFixed(3)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("has a visible overshoot on every landing", () => {
    for (const { target } of cases(100)) expect(overshootFor(target)).toBeGreaterThanOrEqual(4.5);
  });

  it("only moves forward until the overshoot peak", () => {
    let backwardSteps = 0;
    for (const { start, target } of cases(20)) {
      const m = spinMotion(start, target);
      let prev = m.at(0);
      for (let t = 0.001; t <= settleStart; t += 0.001) {
        const x = m.at(t);
        if (x < prev - 1e-9) backwardSteps++;
        prev = x;
      }
      expect(prev).toBeCloseTo(target + m.overshoot, 6);
    }
    expect(backwardSteps).toBe(0);
  });

  it("the last second before stopping is far slower than the first", () => {
    for (const { start, target } of cases(20)) {
      const m = spinMotion(start, target);
      const first = m.at(1) - m.at(0);
      const last = m.at(settleStart) - m.at(settleStart - 1);
      expect(last).toBeLessThan(first / 15);
      expect(last).toBeGreaterThan(10); // still visibly creeping over a divider or so, not frozen
    }
  });

  it("has no speed jumps between phases (smooth at 1ms resolution)", () => {
    const m = spinMotion(0, 7 * 360 + 200);
    let prevV = 0;
    let maxDv = 0;
    for (let t = 0.001; t < m.durationMs / 1000; t += 0.001) {
      const v = (m.at(t) - m.at(t - 0.001)) / 0.001;
      maxDv = Math.max(maxDv, Math.abs(v - prevV));
      prevV = v;
    }
    // Largest change of speed in one millisecond, in °/s; peak speed is ~1300°/s.
    expect(maxDv).toBeLessThan(10);
  });

  it("reduced motion: short plain ease-out, no overshoot", () => {
    const m = spinMotion(0, 2 * 360 + 100, true);
    expect(m.durationMs).toBe(SPIN_TIMING.reducedSec * 1000);
    expect(m.overshoot).toBe(0);
    for (let t = 0; t <= m.durationMs / 1000; t += 0.01) expect(m.at(t)).toBeLessThanOrEqual(820 + 1e-9);
    expect(m.at(m.durationMs / 1000)).toBe(820);
  });

  it("keyframes run from start to target with increasing offsets", () => {
    const m = spinMotion(360, 360 + 8 * 360 + 90);
    const kf = spinKeyframes(m);
    expect(kf[0]).toMatchObject({ offset: 0, transform: "rotate(360.000deg)" });
    expect(kf.at(-1)).toMatchObject({ offset: 1, transform: `rotate(${(360 + 8 * 360 + 90).toFixed(3)}deg)` });
    for (let i = 1; i < kf.length; i++) expect(kf[i].offset as number).toBeGreaterThan(kf[i - 1].offset as number);
  });
});
