"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { SEGMENT_ANGLE, SEGMENTS } from "@/lib/segments";
import { spinKeyframes, spinMotion } from "@/lib/spinMotion";

const SIZE = 400;
const C = SIZE / 2;
const R_SEGMENTS = 178;
const R_RIM = 196;
const R_HUB = 44;
const LIGHTS = 16;

const SWAY_DEG = 3.5;
const SWAY_PERIOD_MS = 8000;

// Pointer flapper: each divider kicks it, a damped spring brings it back.
const FLICK_DEG = 17;
const FLAPPER_STIFFNESS = 900;
const FLAPPER_DAMPING = 24;

/** Point at `deg` clockwise from 12 o'clock. */
function polar(deg: number, r: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [C + r * Math.sin(rad), C - r * Math.cos(rad)];
}

function wedgePath(i: number, r: number) {
  const [x0, y0] = polar(i * SEGMENT_ANGLE, r);
  const [x1, y1] = polar((i + 1) * SEGMENT_ANGLE, r);
  return `M ${C} ${C} L ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1} Z`;
}

function line(deg: number, r0: number, r1: number) {
  const [x0, y0] = polar(deg, r0);
  const [x1, y1] = polar(deg, r1);
  return { x1: x0, y1: y0, x2: x1, y2: y1 };
}

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function currentRotation(el: HTMLElement): number {
  const tf = getComputedStyle(el).transform;
  if (!tf || tf === "none") return 0;
  const m = new DOMMatrixReadOnly(tf);
  return (Math.atan2(m.b, m.a) * 180) / Math.PI;
}

type WheelProps = {
  /** Absolute resting rotation in degrees, as returned by the server. */
  rotation: number;
  spinning: boolean;
  /** Gentle attract-loop sway while nobody has spun yet. */
  idle?: boolean;
  winnerIndex?: number | null;
  onSpinEnd?: () => void;
};

export function Wheel({ rotation, spinning, idle = false, winnerIndex = null, onSpinEnd }: WheelProps) {
  const swayRef = useRef<HTMLDivElement>(null);
  const rotorRef = useRef<HTMLDivElement>(null);
  const flapperRef = useRef<HTMLDivElement>(null);
  const restingRef = useRef(rotation);
  const onSpinEndRef = useRef(onSpinEnd);
  onSpinEndRef.current = onSpinEnd;

  if (!spinning) restingRef.current = rotation;

  useEffect(() => {
    const el = swayRef.current;
    if (!el || !idle || prefersReducedMotion()) return;
    const sway = el.animate([{ transform: `rotate(${-SWAY_DEG}deg)` }, { transform: `rotate(${SWAY_DEG}deg)` }], {
      duration: SWAY_PERIOD_MS / 2,
      iterations: Infinity,
      direction: "alternate",
      easing: "ease-in-out",
      iterationStart: 0.5,
    });
    return () => {
      // Ease back to rest from wherever the sway is, instead of snapping.
      const from = currentRotation(el);
      sway.cancel();
      if (Math.abs(from) > 0.05) {
        el.animate([{ transform: `rotate(${from}deg)` }, { transform: "rotate(0deg)" }], {
          duration: 500,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
      }
    };
  }, [idle]);

  // Layout effect: the first painted frame must already be the animation's start,
  // not the final rotation React just wrote into the style.
  useLayoutEffect(() => {
    const rotor = rotorRef.current;
    if (!spinning || !rotor) return;
    const reduced = prefersReducedMotion();
    const from = restingRef.current;
    const motion = spinMotion(from, rotation, reduced);
    const anim = rotor.animate(spinKeyframes(motion), { duration: motion.durationMs, easing: "linear" });

    let ended = false;
    let raf = 0;
    const finish = () => {
      if (ended) return;
      ended = true;
      window.clearTimeout(fallback);
      anim.cancel();
      restingRef.current = rotation;
      onSpinEndRef.current?.();
    };
    anim.finished.then(finish, () => {});
    // Animations stall in background tabs; make sure the result still shows.
    const fallback = window.setTimeout(finish, motion.durationMs + 400);

    const flapper = flapperRef.current;
    let angle = 0;
    let vel = 0;
    let last = performance.now();
    let lastTickAt = 0;
    let sector = Math.floor(from / SEGMENT_ANGLE);
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!ended && !reduced) {
        const s = Math.floor(motion.at(Number(anim.currentTime ?? 0) / 1000) / SEGMENT_ANGLE);
        if (s !== sector) {
          angle = (s > sector ? -1 : 1) * (FLICK_DEG + Math.random() * 4 - 2);
          vel = 0;
          // A physical click on phones, only once the ticks are slow enough to feel individually.
          if (now - lastTickAt > 110) navigator.vibrate?.(8);
          lastTickAt = now;
          sector = s;
        }
      }
      for (let i = 0; i < 2; i++) {
        const h = dt / 2;
        vel += (-FLAPPER_STIFFNESS * angle - FLAPPER_DAMPING * vel) * h;
        angle += vel * h;
      }
      if (flapper) flapper.style.transform = `rotate(${angle.toFixed(2)}deg)`;
      if (!ended || Math.abs(angle) > 0.05 || Math.abs(vel) > 0.5) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      ended = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(fallback);
      anim.cancel();
      if (flapper) flapper.style.transform = "";
    };
  }, [spinning, rotation]);

  return (
    <div data-testid="wheel" className={`relative mx-auto aspect-square w-full max-w-[400px] select-none ${spinning ? "is-spinning" : ""}`}>
      {/* Static drop shadow: on the rotor it would swing around with the spin. */}
      <div className="absolute inset-0 rounded-full shadow-[0_22px_50px_-14px_rgba(10,22,40,0.5)]" aria-hidden />

      <div ref={swayRef} className="absolute inset-0">
        <div
          data-testid="wheel-rotor"
          ref={rotorRef}
          className="absolute inset-0 rounded-full"
          style={{ transform: `rotate(${rotation}deg)`, willChange: "transform" }}
        >
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full" role="img" aria-label="Prize wheel">
            <circle cx={C} cy={C} r={R_RIM} fill="#1a2314" />

            {SEGMENTS.map((s, i) => (
              <path key={s.id} data-segment={s.id} d={wedgePath(i, R_SEGMENTS)} fill={s.fill} />
            ))}

            {winnerIndex !== null && !spinning && (
              <path d={wedgePath(winnerIndex, R_SEGMENTS)} fill="#ffffff" opacity={0.3} className="winner-glow" pointerEvents="none" />
            )}

            {/* Sunken dividers: a soft groove, a gold rib, and a light catch on one side. */}
            <g pointerEvents="none" strokeLinecap="round">
              {SEGMENTS.map((s, i) => (
                <g key={`div-${s.id}`}>
                  <line {...line(i * SEGMENT_ANGLE, R_HUB, R_SEGMENTS)} stroke="#000" strokeOpacity={0.28} strokeWidth={7} />
                  <line {...line(i * SEGMENT_ANGLE, R_HUB, R_SEGMENTS)} stroke="#d4af37" strokeWidth={2.4} />
                  <line {...line(i * SEGMENT_ANGLE + 0.8, R_HUB + 6, R_SEGMENTS - 2)} stroke="#fff6cf" strokeOpacity={0.55} strokeWidth={0.9} />
                </g>
              ))}
            </g>

            {SEGMENTS.map((s, i) => {
              const mid = i * SEGMENT_ANGLE + SEGMENT_ANGLE / 2;
              const labelY = C - 114;
              const isLong = s.wheelTop.length > 3;
              const lightText = s.text.toLowerCase() === "#f7f7dc";
              return (
                <g key={`label-${s.id}`} transform={`rotate(${mid} ${C} ${C})`} pointerEvents="none">
                  <text
                    x={C}
                    y={labelY}
                    transform={`rotate(90 ${C} ${labelY})`}
                    textAnchor="middle"
                    fill={s.text}
                    stroke={lightText ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.5)"}
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                    style={{ fontFamily: "var(--font-syne), sans-serif" }}
                  >
                    <tspan x={C} dy={-3} fontSize={isLong ? 27 : 38} fontWeight={800} letterSpacing={-0.5}>
                      {s.wheelTop}
                    </tspan>
                    <tspan x={C} dy={isLong ? 17 : 20} fontSize={isLong ? 10 : 14} fontWeight={800} letterSpacing={isLong ? 0.2 : 2.5}>
                      {s.wheelSub}
                    </tspan>
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Fixed lighting over the face (it must not turn with the wheel): a highlight
          from the top-left, shading toward the rim, and a metallic gold bezel. */}
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <radialGradient id="wheel-light" cx="0.32" cy="0.2" r="0.75">
            <stop offset="0" stopColor="#fff" stopOpacity={0.3} />
            <stop offset="0.35" stopColor="#fff" stopOpacity={0.06} />
            <stop offset="0.6" stopColor="#fff" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="wheel-vignette" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.72" stopColor="#0a1628" stopOpacity={0} />
            <stop offset="1" stopColor="#0a1628" stopOpacity={0.32} />
          </radialGradient>
          <linearGradient id="wheel-bezel" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f6e08f" />
            <stop offset="0.45" stopColor="#d4af37" />
            <stop offset="0.7" stopColor="#8f6f17" />
            <stop offset="1" stopColor="#e9c95a" />
          </linearGradient>
        </defs>
        <circle cx={C} cy={C} r={R_SEGMENTS} fill="url(#wheel-vignette)" />
        <circle cx={C} cy={C} r={R_SEGMENTS} fill="url(#wheel-light)" />
        <circle cx={C} cy={C} r={R_SEGMENTS + 1.5} fill="none" stroke="url(#wheel-bezel)" strokeWidth={4} />
        <circle cx={C} cy={C} r={R_RIM - 1.5} fill="none" stroke="url(#wheel-bezel)" strokeWidth={2} strokeOpacity={0.6} />
      </svg>

      {/* Rim lights live outside the rotor as HTML so their opacity animation runs on the
          compositor; animating SVG children inside the rotor would repaint it every frame. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {Array.from({ length: LIGHTS }, (_, i) => {
          const [x, y] = polar((i * 360) / LIGHTS, (R_RIM + R_SEGMENTS) / 2 + 1);
          return (
            <span
              key={`light-${i}`}
              className={`absolute h-[2.2%] w-[2.2%] -translate-x-1/2 -translate-y-1/2 rounded-full ${i % 2 ? "rim-light-alt bg-cream" : "rim-light bg-gold"}`}
              style={{ left: `${(x / SIZE) * 100}%`, top: `${(y / SIZE) * 100}%` }}
            />
          );
        })}
      </div>

      {/* Hub sits outside the rotating layer so the logo stays upright. */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-[22%] w-[22%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-gold bg-white shadow-[inset_0_-4px_8px_rgba(10,22,40,0.14),0_6px_14px_rgba(10,22,40,0.35)]">
        <img src="/webaura-logo-black.png" alt="" className="h-[70%] w-[70%] object-contain" draggable={false} />
      </div>

      {/* Fixed pointer at 12 o'clock; the inner flapper pivots on its pin when a divider passes. */}
      <div
        className={`pointer-events-none absolute left-1/2 top-[-5%] z-10 w-[12%] -translate-x-1/2 ${spinning ? "" : "pointer-idle"}`}
        aria-hidden
      >
        <div
          ref={flapperRef}
          className="origin-[50%_35%] [filter:drop-shadow(0_4px_3px_rgba(10,22,40,0.4))]"
          style={{ willChange: "transform" }}
        >
          <svg viewBox="0 0 40 52" className="w-full overflow-visible">
            <defs>
              <linearGradient id="pointer-gold" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#f6e08f" />
                <stop offset="0.5" stopColor="#d4af37" />
                <stop offset="1" stopColor="#8f6f17" />
              </linearGradient>
            </defs>
            <path d="M20 50 L4 14 A17 17 0 1 1 36 14 Z" fill="url(#pointer-gold)" stroke="#1a2314" strokeWidth={3} strokeLinejoin="round" />
            {/* Right-hand facet in shade gives the pin a ridge down its centre. */}
            <path d="M20 48 L34.5 15 A15.5 15.5 0 0 0 20 4.3 Z" fill="#1a2314" opacity={0.16} />
            <path d="M8.5 11 A13 13 0 0 1 19 4.5" fill="none" stroke="#fff" strokeOpacity={0.75} strokeWidth={2.4} strokeLinecap="round" />
            <circle cx={20} cy={18} r={6} fill="#1a2314" />
            <circle cx={18.3} cy={16.3} r={1.6} fill="#f7f7dc" opacity={0.7} />
          </svg>
        </div>
      </div>
    </div>
  );
}
