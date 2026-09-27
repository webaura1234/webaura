import type { CSSProperties } from "react";

const MOTE_COLORS = ["#d4af37", "#1a2314", "#d7d5ab", "#0a1628", "#d4af37"];

// Integer LCG so server and client render identical motes (no hydration mismatch).
const MOTES = (() => {
  let seed = 20260927;
  const next = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  return Array.from({ length: 18 }, (_, i) => {
    const color = MOTE_COLORS[i % MOTE_COLORS.length];
    const dark = color === "#1a2314" || color === "#0a1628";
    return {
      left: `${(next() * 100).toFixed(1)}%`,
      size: `${(4 + next() * 9).toFixed(1)}px`,
      style: {
        "--dur": `${(18 + next() * 20).toFixed(1)}s`,
        "--delay": `${(-next() * 38).toFixed(1)}s`,
        "--drift": `${((next() - 0.5) * 16).toFixed(1)}vw`,
        "--o": dark ? "0.12" : (0.35 + next() * 0.3).toFixed(2),
        background: color,
        boxShadow: dark ? undefined : `0 0 12px 2px ${color}66`,
      } as CSSProperties,
    };
  });
})();

/** Slow, always-on background motion so the page reads as alive from across the room. */
export function Ambience({ phase }: { phase: string }) {
  return (
    <div data-phase={phase} className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="ambient-blob ambient-blob-a" />
      <div className="ambient-blob ambient-blob-b" />
      <div className="ambient-blob ambient-blob-c" />
      {MOTES.map((m, i) => (
        <span key={i} className="ambient-mote" style={{ ...m.style, left: m.left, width: m.size, height: m.size }} />
      ))}
      <div className="ambient-win absolute inset-0" />
    </div>
  );
}
