import "server-only";
import type { CouponRecord, CouponStore } from "./db";
import { cryptoRng, generateCouponCode, landingAngle, pickWeightedOutcome, type Rng } from "./odds";
import { COUPON_TTL_MS, SEGMENTS, segmentIndexOf, type SpinResponse } from "./segments";

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super("Too many new spins from this network");
  }
}

export type SpinInput = {
  name: string;
  phone: string;
  source: string | null;
  ipHash: string | null;
};

export type SpinOptions = {
  rng?: Rng;
  now?: () => number;
  /** Max new coupons per hashed IP per hour. 0 disables the check. */
  newSpinsPerIpPerHour?: number;
};

const MAX_CODE_ATTEMPTS = 8;

export function maskPhone(phone: string): string {
  return `+91 ••••••${phone.slice(-4)}`;
}

function toResponse(record: CouponRecord, input: SpinInput, alreadySpun: boolean, now: number, rng: Rng): SpinResponse {
  const index = segmentIndexOf(record.outcome);
  const segment = SEGMENTS[index];
  return {
    outcome: { id: segment.id, label: segment.label, discountPct: segment.discountPct },
    code: record.code,
    angle: landingAngle(index, rng),
    name: input.name,
    phoneMasked: maskPhone(record.phone),
    expiresAt: record.expiresAt,
    expired: new Date(record.expiresAt).getTime() <= now,
    serverNow: new Date(now).toISOString(),
    alreadySpun,
  };
}

export async function spin(input: SpinInput, store: CouponStore, opts: SpinOptions = {}): Promise<SpinResponse> {
  const rng = opts.rng ?? cryptoRng;
  const clock = opts.now ?? Date.now;

  const existing = await store.findByPhone(input.phone);
  if (existing) return toResponse(existing, input, true, clock(), rng);

  const cap = opts.newSpinsPerIpPerHour ?? 0;
  if (cap > 0 && input.ipHash) {
    const since = new Date(clock() - 60 * 60 * 1000).toISOString();
    if ((await store.countSinceByIp(input.ipHash, since)) >= cap) throw new RateLimitError(15 * 60);
  }

  const outcome = pickWeightedOutcome(rng);
  const segment = SEGMENTS[segmentIndexOf(outcome)];
  const now = clock();

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const record: CouponRecord = {
      name: input.name,
      phone: input.phone,
      outcome,
      outcomeLabel: segment.label,
      discountPct: segment.discountPct,
      code: generateCouponCode(rng),
      source: input.source,
      ipHash: input.ipHash,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + COUPON_TTL_MS).toISOString(),
    };

    // Any storage error propagates: the user must never see a win that wasn't recorded.
    const result = await store.insert(record);
    if (result.ok) return toResponse(record, input, false, now, rng);

    if (result.conflict === "phone") {
      // Lost a race with a concurrent request for the same number — honour its result.
      const winner = await store.findByPhone(input.phone);
      if (winner) return toResponse(winner, input, true, clock(), rng);
    }
  }

  throw new Error("Could not allocate a unique coupon code");
}
