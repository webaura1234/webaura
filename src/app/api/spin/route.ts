import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { RateLimitError, spin } from "@/lib/spin";
import { SlidingWindowLimiter, clientIp, envInt, hashIp } from "@/lib/rateLimit";
import { normalizeIndianPhone, normalizeName, normalizeSource } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const burstLimiter = new SlidingWindowLimiter(envInt("RATE_LIMIT_REQUESTS_PER_MINUTE", 20), 60_000);
const NEW_SPINS_PER_IP_PER_HOUR = envInt("RATE_LIMIT_NEW_SPINS_PER_HOUR", 10);

function fail(status: number, error: string, field?: "name" | "phone", headers: Record<string, string> = {}) {
  return NextResponse.json({ error, field }, { status, headers: { ...NO_STORE, ...headers } });
}

export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  const retryAfter = burstLimiter.check(ip);
  if (retryAfter) {
    return fail(429, "Too many attempts. Please wait a minute and try again.", undefined, { "Retry-After": String(retryAfter) });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail(400, "Invalid request body.");
    body = parsed as Record<string, unknown>;
  } catch {
    return fail(400, "Invalid request body.");
  }

  // Only name, phone and source are read — any outcome/angle/code in the body is ignored.
  const name = normalizeName(body.name);
  if (!name) return fail(422, "Please enter your name (letters only, 2–60 characters).", "name");

  const phone = normalizeIndianPhone(body.phone);
  if (!phone) return fail(422, "Please enter a valid 10-digit Indian mobile number.", "phone");

  try {
    const result = await spin(
      { name, phone, source: normalizeSource(body.source), ipHash: hashIp(ip) },
      await getStore(),
      { newSpinsPerIpPerHour: NEW_SPINS_PER_IP_PER_HOUR },
    );
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return fail(429, "Too many spins from this network. Please try again later.", undefined, {
        "Retry-After": String(err.retryAfterSeconds),
      });
    }
    console.error("[api/spin]", err);
    return fail(503, "We couldn't record your spin right now, so no coupon was issued. Please try again in a moment.");
  }
}

export function GET() {
  return fail(405, "Method not allowed.");
}
