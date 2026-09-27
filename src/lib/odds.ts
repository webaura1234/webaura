import "server-only";
import { randomInt } from "node:crypto";
import { SEGMENT_ANGLE, type OutcomeId } from "./segments";

/** Uniform integer in [min, max). */
export type Rng = (min: number, max: number) => number;

export const cryptoRng: Rng = (min, max) => randomInt(min, max);

// Basis points (sum = 10 000) so 0.5% is an exact integer band, not a float
// that can round away. Order defines the cumulative bands.
export const WEIGHTS: readonly (readonly [OutcomeId, number])[] = [
  ["pct_5", 3000],
  ["pct_10", 2500],
  ["pct_15", 2000],
  ["pct_20", 1200],
  ["pct_30", 700],
  ["pct_50", 400],
  ["free_consult", 150],
  ["pct_90", 50],
];

export const TOTAL_WEIGHT = WEIGHTS.reduce((sum, [, w]) => sum + w, 0);

/** Maps an integer roll in [0, TOTAL_WEIGHT) to its outcome band. */
export function outcomeForRoll(roll: number): OutcomeId {
  if (!Number.isInteger(roll) || roll < 0 || roll >= TOTAL_WEIGHT) {
    throw new RangeError(`roll out of range: ${roll}`);
  }
  let upper = 0;
  for (const [id, weight] of WEIGHTS) {
    upper += weight;
    if (roll < upper) return id;
  }
  throw new Error("unreachable: weights exhausted");
}

export function pickWeightedOutcome(rng: Rng = cryptoRng): OutcomeId {
  return outcomeForRoll(rng(0, TOTAL_WEIGHT));
}

// No 0/O/1/I/L so codes survive being read aloud or retyped from a screenshot.
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 6; // 31^6 ≈ 887M combinations

export function generateCouponCode(rng: Rng = cryptoRng, length = CODE_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[rng(0, CODE_ALPHABET.length)];
  return `WEBAURA-${out}`;
}

/** Fraction of each wedge kept clear on both sides so it never visibly lands on a divider. */
export const EDGE_MARGIN = 0.15;

/**
 * Total clockwise rotation (degrees, from rest) that leaves the fixed top
 * pointer inside the given segment. Segment i occupies
 * [i·45°, (i+1)·45°) clockwise from 12 o'clock in the wheel's own frame;
 * rotating the wheel by R brings wheel-angle (360 − R mod 360) under the pointer.
 */
export function landingAngle(segmentIndex: number, rng: Rng = cryptoRng): number {
  const fullTurns = rng(6, 9);
  const maxJitter = Math.floor((SEGMENT_ANGLE / 2) * (1 - 2 * EDGE_MARGIN) * 100);
  const jitter = rng(-maxJitter, maxJitter + 1) / 100;
  const target = segmentIndex * SEGMENT_ANGLE + SEGMENT_ANGLE / 2 + jitter;
  const offset = (((360 - target) % 360) + 360) % 360;
  return Math.round((fullTurns * 360 + offset) * 100) / 100;
}
