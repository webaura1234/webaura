"use client";

import { useEffect, useState } from "react";
import type { SpinResponse } from "@/lib/segments";
import { claimUrl } from "@/lib/whatsapp";

/** `clockOffsetMs` = server clock − device clock, so a wrong phone clock doesn't skew the countdown. */
function useCountdown(target: string, clockOffsetMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const ms = Math.max(0, new Date(target).getTime() - (now + clockOffsetMs));
  const s = Math.floor(ms / 1000);
  return {
    expired: ms === 0,
    hours: Math.floor(s / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

const COUNT_UP_MS = 1100;

/** Counts 0 → target on a fresh win, then reports `landed` so the number can spring into place. */
function useCountUp(target: number | null, run: boolean) {
  const [value, setValue] = useState(run && target !== null ? 0 : target);
  const [landed, setLanded] = useState(!run);
  useEffect(() => {
    if (!run || target === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / COUNT_UP_MS);
      setValue(Math.round(target * (1 - (1 - u) ** 3)));
      if (u < 1) raf = requestAnimationFrame(step);
      else setLanded(true);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run]);
  return { value, landed };
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.04 21.5h-.01a9.45 9.45 0 0 1-4.82-1.32l-.35-.2-3.58.94.96-3.49-.23-.36a9.43 9.43 0 0 1-1.45-5.03c0-5.22 4.25-9.47 9.48-9.47 2.53 0 4.91.99 6.7 2.78a9.4 9.4 0 0 1 2.77 6.7c0 5.23-4.25 9.47-9.47 9.47zm8.06-17.53A11.33 11.33 0 0 0 12.04.63C5.76.63.64 5.74.64 12.03c0 2.01.52 3.97 1.52 5.7L.54 23.63l6.04-1.58a11.4 11.4 0 0 0 5.45 1.39h.01c6.28 0 11.4-5.11 11.4-11.4 0-3.05-1.19-5.91-3.34-8.07z" />
    </svg>
  );
}

type ResultCardProps = {
  result: SpinResponse;
  clockOffsetMs?: number;
  /** Fresh win from a spin just now (not a returning visitor): count up and spring in. */
  celebrate?: boolean;
};

export function ResultCard({ result, clockOffsetMs = 0, celebrate = false }: ResultCardProps) {
  const countdown = useCountdown(result.expiresAt, clockOffsetMs);
  const { hours, minutes, seconds } = countdown;
  const expired = result.expired || countdown.expired;
  const [copied, setCopied] = useState(false);
  const isConsult = result.outcome.discountPct === null;
  const pct = useCountUp(result.outcome.discountPct, celebrate);
  const springIn = celebrate && (isConsult || pct.landed);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked (e.g. in-app browsers) — code is still selectable */
    }
  };

  return (
    <section className="pop-in w-full overflow-hidden rounded-3xl border-2 border-sand bg-white shadow-[0_20px_60px_-20px_rgba(26,35,20,0.35)]" aria-live="polite">
      <div className="relative bg-olive px-6 pb-6 pt-5 text-center text-cream">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_70%_at_50%_60%,rgba(212,175,55,0.28),transparent_70%)]"
          aria-hidden
        />
        <div className="relative">
          {result.alreadySpun && (
            <p className="mx-auto mb-3 w-fit rounded-full bg-cream/10 px-3 py-1 text-xs font-medium text-cream/80">
              Welcome back — this number has already spun. Here&apos;s your reward.
            </p>
          )}
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold">
            {result.alreadySpun ? "Your reward" : `Congrats, ${result.name.split(" ")[0]}!`}
          </p>
          {isConsult ? (
            // Sizes track the card's inner width (viewport − page and card padding) so the widest
            // value still fits; Syne numerals run ~1.1em each.
            <p className="mt-2 font-display font-extrabold leading-[0.9]">
              <span
                className={`win-number text-[min(5.5rem,calc((100vw-88px)/4.6))] uppercase tracking-tight ${springIn ? "win-land" : ""}`}
              >
                Free
              </span>{" "}
              <span className="block text-2xl text-gold sm:text-3xl">Consultation</span>
            </p>
          ) : (
            <p className="mt-1 font-display font-extrabold leading-none">
              <span className="sr-only">{result.outcome.discountPct}% OFF</span>
              <span aria-hidden>
                <span
                  className={`win-number text-[min(8rem,calc((100vw-88px)/2.9))] tracking-tighter tabular-nums ${springIn ? "win-land" : ""}`}
                >
                  {pct.value}
                  <span className="ml-[0.04em] align-top text-[0.5em] leading-none">%</span>
                </span>
                <span className="-mt-1 block pl-[0.3em] text-2xl tracking-[0.3em] text-gold sm:text-3xl">OFF</span>
              </span>
            </p>
          )}
          <p className="mt-2 text-sm text-cream/65">
            {isConsult ? "A free strategy call with the WebAura team" : "on your next website or software project"}
          </p>
        </div>
      </div>

      <div className="space-y-5 p-6">
        <div>
          <p className="text-center text-xs font-bold uppercase tracking-widest text-navy/50">Your coupon code</p>
          <div className="mt-2 flex items-stretch overflow-hidden rounded-2xl border-2 border-dashed border-gold bg-cream">
            <code className="flex-1 select-all whitespace-nowrap px-3 py-3.5 text-center font-mono text-[clamp(0.95rem,4.6vw,1.5rem)] font-bold tracking-wider text-olive">
              {result.code}
            </code>
            <button
              type="button"
              onClick={copy}
              className="min-h-14 shrink-0 border-l-2 border-dashed border-gold px-4 text-sm font-bold text-olive transition hover:bg-sand active:scale-[0.94] active:bg-sand-dark"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl bg-navy/[0.04] px-4 py-3 text-center">
          {expired ? (
            <p className="text-sm font-semibold text-red-600">This coupon has expired.</p>
          ) : (
            <>
              <p className="text-xs font-semibold uppercase tracking-widest text-navy/55">Valid for 48 hours · expires in</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-navy" role="timer">
                {pad(hours)}:{pad(minutes)}:{pad(seconds)}
              </p>
            </>
          )}
        </div>

        <a
          href={claimUrl(result, expired)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-whatsapp px-6 py-4 text-lg font-bold text-white shadow-lg shadow-whatsapp/30 transition hover:bg-whatsapp-dark active:scale-[0.96]"
        >
          <WhatsAppIcon className="h-6 w-6" />
          {expired ? "Message us on WhatsApp" : "Claim on WhatsApp"}
        </a>

        <p className="text-center text-[0.7rem] leading-relaxed text-navy/40">
          Send the pre-filled message to lock in your offer. Applicable on new projects only; one coupon per customer.
        </p>
      </div>
    </section>
  );
}
