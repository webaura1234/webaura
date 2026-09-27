"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Options as ConfettiOptions } from "canvas-confetti";
import { Ambience } from "./Ambience";
import { Wheel } from "./Wheel";
import { LeadForm } from "./LeadForm";
import { ResultCard } from "./ResultCard";
import { segmentIndexOf, type SpinResponse } from "@/lib/segments";

type Phase = "idle" | "form" | "submitting" | "spinning" | "done";
type FieldErrors = { name?: string; phone?: string; form?: string };

const STORAGE_KEY = "webaura-spin-v2";
const REQUEST_TIMEOUT_MS = 15_000;
const SCREEN_EXIT_MS = 250;

type Saved = { result: SpinResponse; clockOffsetMs: number };

function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    return saved?.result?.code && saved.result.phoneMasked ? saved : null;
  } catch {
    return null;
  }
}

const taperTimers: number[] = [];

function stopCelebration() {
  taperTimers.splice(0).forEach((t) => window.clearTimeout(t));
  void import("canvas-confetti").then((m) => m.default.reset());
}

/** A dense, varied peak at the moment of reveal, then a thinning drift from above. */
async function celebrate(discountPct: number | null) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const confetti = (await import("canvas-confetti")).default;
  const colors = ["#d4af37", "#1a2314", "#f7f7dc", "#0a1628", "#25d366", "#eae8c1"];
  const scale = discountPct === null ? 0.7 : discountPct >= 30 ? 1.5 : 1;
  const fire = (count: number, opts: ConfettiOptions) =>
    confetti({ colors, zIndex: 60, disableForReducedMotion: true, ...opts, particleCount: Math.max(1, Math.round(count * scale)) });

  fire(70, { angle: 60, spread: 55, startVelocity: 62, origin: { x: 0, y: 0.8 }, scalar: 1.1 });
  fire(70, { angle: 120, spread: 55, startVelocity: 62, origin: { x: 1, y: 0.8 }, scalar: 1.1 });
  fire(80, { spread: 100, startVelocity: 42, origin: { x: 0.5, y: 0.55 }, scalar: 0.8, shapes: ["circle"] });
  fire(30, { spread: 140, startVelocity: 34, origin: { x: 0.5, y: 0.5 }, scalar: 1.5, shapes: ["square"], ticks: 260 });
  fire(18, { spread: 360, startVelocity: 26, origin: { x: 0.5, y: 0.45 }, scalar: 1.2, shapes: ["star"], colors: ["#d4af37", "#f6e08f"] });

  const TAPER_STEPS = 9;
  for (let i = 1; i <= TAPER_STEPS; i++) {
    taperTimers.push(window.setTimeout(() => {
      fire((TAPER_STEPS - i + 1) * 4, {
        angle: 270,
        spread: 90,
        startVelocity: 12,
        gravity: 0.7,
        ticks: 320,
        scalar: 0.7 + Math.random() * 0.6,
        origin: { x: 0.15 + Math.random() * 0.7, y: -0.05 },
      });
    }, 220 * i));
  }
}

/** Keeps a block mounted briefly after it's hidden so it can animate out. */
function usePresence(show: boolean, exitMs = SCREEN_EXIT_MS) {
  const [mounted, setMounted] = useState(show);
  useEffect(() => {
    if (show) {
      setMounted(true);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(t);
  }, [show, exitMs]);
  return { mounted: show || mounted, leaving: !show && mounted };
}

export function SpinExperience() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<SpinResponse | null>(null);
  const [justWon, setJustWon] = useState(false);
  const [round, setRound] = useState(0);
  const [serverError, setServerError] = useState<FieldErrors | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const resultRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(false);

  // Returning visitor on the same device: show their coupon straight away.
  // The server remains the source of truth — this is only a convenience.
  useEffect(() => {
    const saved = loadSaved();
    if (!saved) return;
    setResult(saved.result);
    setClockOffsetMs(saved.clockOffsetMs);
    setRotation(saved.result.angle % 360);
    setPhase("done");
  }, []);

  const submitLead = async (lead: { name: string; phone: string }) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setPhase("submitting");
    setServerError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const params = new URLSearchParams(window.location.search);
      const res = await fetch("/api/spin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...lead, source: params.get("utm_source") ?? params.get("src") }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.code) {
        const msg = data.error ?? "Something went wrong. Please try again.";
        setServerError(data.field ? { [data.field]: msg } : { form: msg });
        setPhase("form");
        return;
      }

      const spin = data as SpinResponse;
      const offset = new Date(spin.serverNow).getTime() - Date.now();
      setResult(spin);
      setClockOffsetMs(offset);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ result: spin, clockOffsetMs: offset } satisfies Saved));
      } catch {
        /* private mode — fine */
      }

      // The server angle is an absolute rotation from rest; add it on top of
      // any whole turns already applied so the wheel always moves forward.
      setPhase("spinning");
      setRotation((prev) => Math.ceil(prev / 360) * 360 + spin.angle);
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "AbortError";
      setServerError({
        form: timedOut
          ? "This is taking too long — check your connection and try again."
          : "Network error — check your connection and try again.",
      });
      setPhase("form");
    } finally {
      window.clearTimeout(timeout);
      inFlightRef.current = false;
    }
  };

  const onSpinEnd = useCallback(() => {
    setPhase("done");
    setJustWon(true);
    if (result) void celebrate(result.outcome.discountPct);
    window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
  }, [result]);

  /** Back to the attract screen for the next visitor. The server still allows one spin per number. */
  const restart = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    const previous = result;
    stopCelebration();
    setJustWon(false);
    setServerError(null);
    setRound((n) => n + 1);
    setPhase("idle");
    // Keep the old card mounted while it fades out, unless a new spin has already replaced it.
    window.setTimeout(() => setResult((r) => (r === previous ? null : r)), SCREEN_EXIT_MS);
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  const closeForm = useCallback(() => setPhase("idle"), []);

  const spinning = phase === "spinning";
  const done = phase === "done" && result !== null;
  const winnerIndex = done ? segmentIndexOf(result.outcome.id) : null;
  const cta = usePresence(!done);
  const card = usePresence(done);

  return (
    <>
      <Ambience phase={phase} />

      <div className="grid items-center gap-4 sm:gap-8 lg:grid-cols-[1fr_minmax(0,440px)] lg:gap-16">
        <div className="text-center lg:text-left">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-sand bg-cream px-3 py-1 text-[0.7rem] font-bold uppercase tracking-widest text-olive sm:text-xs lg:mx-0">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
            Limited-time offer
          </p>
          <h1 className="mt-3 font-display text-[2.1rem] font-extrabold leading-[1.02] tracking-tight text-olive sm:mt-4 sm:text-6xl">
            Spin to win up to <span className="relative whitespace-nowrap text-navy">
              90% off
              <svg viewBox="0 0 200 12" className="absolute -bottom-1 left-0 w-full" preserveAspectRatio="none" aria-hidden>
                <path d="M2 9 Q 100 1 198 7" stroke="#d4af37" strokeWidth={5} fill="none" strokeLinecap="round" />
              </svg>
            </span>
          </h1>
          <p className="mx-auto mt-3 max-w-md text-[0.95rem] leading-relaxed text-navy/70 sm:mt-4 sm:text-lg lg:mx-0">
            your next website or software project.
            <span className="hidden sm:inline"> Enter your WhatsApp number, spin once, and claim your coupon instantly.</span>
          </p>

          <ul className="mx-auto mt-5 hidden max-w-md flex-wrap gap-1.5 text-xs font-medium text-olive/60 lg:mx-0 lg:flex">
            {["Websites & online stores", "Custom software & ERPs", "AI automation", "Branding"].map((s) => (
              <li key={s} className="rounded-full bg-cream/70 px-2.5 py-1">
                {s}
              </li>
            ))}
          </ul>
        </div>

        <div className="mx-auto w-full max-w-[340px] px-2 pt-3 sm:max-w-[400px] sm:px-0 sm:pt-4">
          <Wheel
            rotation={rotation}
            spinning={spinning}
            idle={phase === "idle" || phase === "form" || phase === "submitting"}
            winnerIndex={winnerIndex}
            onSpinEnd={onSpinEnd}
          />
        </div>
      </div>

      {/* CTA and result share one grid cell so they cross-fade instead of jumping. */}
      <div ref={resultRef} className="mx-auto mt-6 grid w-full max-w-md grid-cols-1 scroll-mt-4 sm:mt-8 lg:mt-12">
        {card.mounted && result && (
          <div className={`relative min-w-0 [grid-area:1/1] ${card.leaving ? "screen-out" : ""}`}>
            <div className="win-halo pointer-events-none absolute -inset-x-16 -inset-y-12 -z-10 rounded-full" aria-hidden />
            <ResultCard result={result} clockOffsetMs={clockOffsetMs} celebrate={justWon} />
            <button
              type="button"
              onClick={restart}
              className="group mt-4 flex min-h-14 w-full items-center justify-center gap-2.5 rounded-2xl border-2 border-olive/15 bg-white/80 px-6 text-base font-bold text-olive shadow-sm backdrop-blur-sm transition hover:border-olive/30 hover:bg-cream active:scale-[0.96]"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 text-gold transition-transform duration-500 group-hover:-rotate-180 group-active:-rotate-180"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <path d="M3 4v5h5" />
              </svg>
              Spin again
            </button>
            <p className="mt-2 text-center text-[0.7rem] leading-relaxed text-navy/40">
              For a new WhatsApp number. A number that has already spun keeps its original coupon.
            </p>
          </div>
        )}

        {cta.mounted && (
          <div className={`min-w-0 text-center [grid-area:1/1] ${cta.leaving ? "screen-out" : "screen-in"}`}>
            <div className={phase === "idle" ? "cta-pulse" : "relative"}>
              <button
                type="button"
                onClick={() => setPhase("form")}
                disabled={phase !== "idle"}
                className="group relative min-h-14 w-full overflow-hidden rounded-2xl bg-olive px-8 py-4 text-xl font-extrabold tracking-wide text-cream shadow-xl shadow-olive/30 transition hover:bg-olive-soft active:scale-[0.96] disabled:cursor-default disabled:opacity-90 sm:py-5"
              >
                <span className="relative z-10">{spinning ? "Spinning…" : "Spin Now"}</span>
                {!spinning && (
                  <span className="absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-20deg] bg-gradient-to-r from-transparent via-white/20 to-transparent transition-all duration-700 group-hover:left-full" />
                )}
              </button>
            </div>
            <p className="mt-3 text-[0.7rem] text-navy/40">
              One spin per WhatsApp number · Coupon valid for 48 hours · No payment needed
            </p>
          </div>
        )}
      </div>

      <LeadForm
        key={round}
        open={phase === "form" || phase === "submitting"}
        submitting={phase === "submitting"}
        serverError={serverError}
        onClose={closeForm}
        onSubmit={submitLead}
      />
    </>
  );
}
