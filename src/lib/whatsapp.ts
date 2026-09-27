import type { SpinResponse } from "./segments";

export const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "917288052098";

type ClaimInput = Pick<SpinResponse, "name" | "code" | "outcome" | "expiresAt" | "phoneMasked">;

export function formatExpiryIST(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export function prizeText(outcome: ClaimInput["outcome"]): string {
  return outcome.discountPct === null
    ? "a *Free Consultation*"
    : `*${outcome.discountPct}% OFF* my next website/software project`;
}

export function claimMessage(r: ClaimInput, expired = false): string {
  const expiry = formatExpiryIST(r.expiresAt);
  const lines = expired
    ? [
        `Hi WebAura! I'm ${r.name}.`,
        `I won ${prizeText(r.outcome)} on the Spin the Wheel, but my coupon *${r.code}* expired on ${expiry} IST.`,
        `Is there still a way to use it?`,
      ]
    : [
        `Hi WebAura! I'm ${r.name}.`,
        `I just won ${prizeText(r.outcome)} on the Spin the Wheel.`,
        `My coupon code is *${r.code}* (valid till ${expiry} IST).`,
        `I'd like to claim it.`,
      ];
  lines.push(`Registered number: ${r.phoneMasked}`);
  return lines.join("\n");
}

export function claimUrl(r: ClaimInput, expired = false): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(claimMessage(r, expired))}`;
}
