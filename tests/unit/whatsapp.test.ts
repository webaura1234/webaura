import { describe, expect, it } from "vitest";
import { claimMessage, claimUrl, formatExpiryIST } from "@/lib/whatsapp";

const base = {
  name: "Priya Sharma",
  code: "WEBAURA-7KQ2MX",
  outcome: { id: "pct_20" as const, label: "20% OFF", discountPct: 20 },
  expiresAt: "2026-09-28T22:35:00.000Z",
  phoneMasked: "+91 ••••••3210",
};

describe("WhatsApp claim link", () => {
  it("targets the business number and round-trips the exact message", () => {
    const url = new URL(claimUrl(base));
    expect(url.origin + url.pathname).toBe("https://wa.me/917288052098");
    expect(url.searchParams.get("text")).toBe(claimMessage(base));
  });

  it("includes the name, code, discount and registered number", () => {
    const msg = claimMessage(base);
    expect(msg).toContain("Priya Sharma");
    expect(msg).toContain("WEBAURA-7KQ2MX");
    expect(msg).toContain("*20% OFF*");
    expect(msg).toContain("+91 ••••••3210");
  });

  it.each(["D'Souza", "Jean-Luc", "Dr. Rao", "प्रिया शर्मा", "Zoë Ångström"])(
    "survives special characters in the name: %s",
    (name) => {
      const raw = claimUrl({ ...base, name });
      const query = raw.split("?text=")[1];
      expect(query).not.toMatch(/[\s#&"<>?]/);
      const text = new URL(raw).searchParams.get("text")!;
      expect(text).toBe(claimMessage({ ...base, name }));
      expect(text).toContain(name);
    },
  );

  it("formats expiry in IST regardless of the machine's timezone", () => {
    // 22:35 UTC = 04:05 IST the next day
    expect(formatExpiryIST("2026-09-28T22:35:00.000Z")).toMatch(/29 Sept?,? 4:05\s?am/i);
    // 18:30 UTC = midnight IST
    expect(formatExpiryIST("2026-09-28T18:30:00.000Z")).toMatch(/29 Sept?,? 12:00\s?am/i);
    expect(claimMessage(base)).toMatch(/valid till 29 Sept?,? 4:05\s?am IST/i);
  });

  it("uses Free Consultation wording and never renders 0% or null%", () => {
    const msg = claimMessage({
      ...base,
      outcome: { id: "free_consult", label: "Free Consultation", discountPct: null },
    });
    expect(msg).toContain("*Free Consultation*");
    expect(msg).not.toMatch(/0%|null|undefined/);
  });

  it("switches to an expired-coupon message after expiry", () => {
    const msg = claimMessage(base, true);
    expect(msg).toContain("expired on");
    expect(msg).not.toContain("I'd like to claim it");
    expect(msg).toContain("WEBAURA-7KQ2MX");
  });
});
