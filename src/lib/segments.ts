// Wheel layout shared by client (rendering) and server (angle maths).
// Odds deliberately live server-side only, in spin.ts.
// Order is clockwise starting at 12 o'clock; big and small prizes are
// interleaved so near-misses are visible.

export type OutcomeId =
  | "pct_5"
  | "pct_10"
  | "pct_15"
  | "pct_20"
  | "pct_30"
  | "pct_50"
  | "free_consult"
  | "pct_90";

export type Segment = {
  id: OutcomeId;
  label: string;
  discountPct: number | null;
  wheelTop: string;
  wheelSub: string;
  fill: string;
  text: string;
};

const OLIVE = "#1a2314";
const NAVY = "#0a1628";
const CREAM = "#f7f7dc";
const SAND = "#eae8c1";
const GOLD = "#d4af37";

export const SEGMENTS: readonly Segment[] = [
  { id: "pct_5", label: "5% OFF", discountPct: 5, wheelTop: "5%", wheelSub: "OFF", fill: OLIVE, text: CREAM },
  { id: "pct_30", label: "30% OFF", discountPct: 30, wheelTop: "30%", wheelSub: "OFF", fill: CREAM, text: OLIVE },
  { id: "pct_10", label: "10% OFF", discountPct: 10, wheelTop: "10%", wheelSub: "OFF", fill: NAVY, text: CREAM },
  { id: "pct_90", label: "90% OFF", discountPct: 90, wheelTop: "90%", wheelSub: "OFF", fill: GOLD, text: OLIVE },
  { id: "pct_15", label: "15% OFF", discountPct: 15, wheelTop: "15%", wheelSub: "OFF", fill: OLIVE, text: CREAM },
  { id: "free_consult", label: "Free Consultation", discountPct: null, wheelTop: "FREE", wheelSub: "CONSULTATION", fill: SAND, text: OLIVE },
  { id: "pct_20", label: "20% OFF", discountPct: 20, wheelTop: "20%", wheelSub: "OFF", fill: NAVY, text: CREAM },
  { id: "pct_50", label: "50% OFF", discountPct: 50, wheelTop: "50%", wheelSub: "OFF", fill: CREAM, text: OLIVE },
];

export const SEGMENT_ANGLE = 360 / SEGMENTS.length;

export function segmentIndexOf(id: string): number {
  return SEGMENTS.findIndex((s) => s.id === id);
}

/** Index of the wedge under the fixed 12 o'clock pointer after rotating the wheel clockwise by `rotationDeg`. */
export function segmentUnderPointer(rotationDeg: number): number {
  const wheelAngle = (((360 - (rotationDeg % 360)) % 360) + 360) % 360;
  return Math.floor(wheelAngle / SEGMENT_ANGLE) % SEGMENTS.length;
}

export const COUPON_TTL_MS = 48 * 60 * 60 * 1000;

export type SpinResponse = {
  outcome: { id: OutcomeId; label: string; discountPct: number | null };
  code: string;
  angle: number;
  /** Name as typed in this request — the stored name is never echoed back. */
  name: string;
  /** e.g. "+91 ••••••3210", so sales can match the WhatsApp sender to the coupon. */
  phoneMasked: string;
  expiresAt: string;
  expired: boolean;
  /** Server clock at response time; the client uses it to correct for a wrong device clock. */
  serverNow: string;
  alreadySpun: boolean;
};
