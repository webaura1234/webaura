// Client-side wheel motion. The server decides the final rotation; this only
// shapes how the wheel travels there: quick launch, long frictional coast,
// a small overshoot past the resting point, then a damped spring back.

import { SEGMENT_ANGLE } from "./segments";

export const SPIN_TIMING = {
  accelSec: 0.3,
  decelSec: 4.2,
  settleSec: 0.75,
  /** Coast speed falls as (1 − u)^power; higher means a longer crawl at the end. */
  decelPower: 1.7,
  overshootDeg: 5,
  /** The overshoot never brings the pointer closer than this to the winning wedge's edge. */
  edgeClearanceDeg: 2,
  reducedSec: 1.2,
} as const;

const SPRING_DAMPING = 6.5;
const SPRING_FREQ = 13;

export type SpinMotion = {
  durationMs: number;
  overshoot: number;
  /** Wheel rotation in degrees `t` seconds after launch. */
  at: (t: number) => number;
};

/**
 * How far the wheel may coast past `target`. Rotating further clockwise moves the
 * pointer toward the winning wedge's leading edge, so the overshoot is capped by
 * the room left on that side; the spring's rebound (~20% of it) goes the other way,
 * where the server always leaves at least 15% of the wedge.
 */
export function overshootFor(target: number, max: number = SPIN_TIMING.overshootDeg): number {
  const underPointer = (((360 - (target % 360)) % 360) + 360) % 360;
  const intoWedge = underPointer % SEGMENT_ANGLE;
  return Math.max(0, Math.min(max, intoWedge - SPIN_TIMING.edgeClearanceDeg));
}

export function spinMotion(start: number, target: number, reduced = false): SpinMotion {
  if (reduced) {
    const T = SPIN_TIMING.reducedSec;
    return {
      durationMs: T * 1000,
      overshoot: 0,
      at: (t) => (t >= T ? target : start + (target - start) * (1 - (1 - Math.max(0, t) / T) ** 3)),
    };
  }

  const { accelSec: tA, decelSec: tC, settleSec: tD, decelPower: p } = SPIN_TIMING;
  const overshoot = overshootFor(target);
  // Linear speed ramp to vMax, then speed vMax·(1−u)^p: distances vMax·tA/2 and vMax·tC/(p+1).
  const vMax = (target + overshoot - start) / (tA / 2 + tC / (p + 1));
  const accelDist = (vMax * tA) / 2;
  const coastDist = (vMax * tC) / (p + 1);
  const spring = (t: number) =>
    overshoot * Math.exp(-SPRING_DAMPING * t) * (Math.cos(SPRING_FREQ * t) + (SPRING_DAMPING / SPRING_FREQ) * Math.sin(SPRING_FREQ * t));
  // Bleed off the spring's tiny leftover so it ends exactly on target instead of snapping.
  const springResidual = spring(tD);

  return {
    durationMs: (tA + tC + tD) * 1000,
    overshoot,
    at(t) {
      if (t <= 0) return start;
      if (t < tA) return start + (vMax * t * t) / (2 * tA);
      t -= tA;
      if (t < tC) return start + accelDist + coastDist * (1 - (1 - t / tC) ** (p + 1));
      t -= tC;
      if (t < tD) return target + spring(t) - springResidual * (t / tD);
      return target;
    },
  };
}

/** The motion sampled into Web Animations keyframes, so it runs on the compositor. */
export function spinKeyframes(motion: SpinMotion, fps = 60): Keyframe[] {
  const n = Math.max(2, Math.ceil((motion.durationMs / 1000) * fps));
  return Array.from({ length: n + 1 }, (_, i) => {
    const deg = i === n ? motion.at(Infinity) : motion.at((i / n) * (motion.durationMs / 1000));
    return { offset: i / n, transform: `rotate(${deg.toFixed(3)}deg)` };
  });
}
