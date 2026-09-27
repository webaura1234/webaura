import { ImageResponse } from "next/og";

export const alt = "Spin & win up to 90% off your next website — WebAura";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// WhatsApp/Instagram link previews are the main traffic source, so this matters.
export default function OpengraphImage() {
  const wedges = ["#1a2314", "#f7f7dc", "#0a1628", "#d4af37", "#1a2314", "#eae8c1", "#0a1628", "#f7f7dc"];
  const pt = (deg: number) => {
    const r = (deg * Math.PI) / 180;
    return `${200 + 190 * Math.sin(r)} ${200 - 190 * Math.cos(r)}`;
  };

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", background: "#ffffff", padding: 70 }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontSize: 30, fontWeight: 700, color: "#d4af37", letterSpacing: 4 }}>WEBAURA INDIA</div>
          <div style={{ fontSize: 88, fontWeight: 800, color: "#1a2314", lineHeight: 1.02, marginTop: 20 }}>Spin to win up to</div>
          <div style={{ fontSize: 110, fontWeight: 800, color: "#0a1628", lineHeight: 1.02 }}>90% OFF</div>
          <div style={{ fontSize: 34, color: "#475569", marginTop: 24 }}>your next website or software project</div>
        </div>
        <svg width="420" height="420" viewBox="0 0 400 400">
          <circle cx="200" cy="200" r="200" fill="#1a2314" />
          {wedges.map((c, i) => (
            <path key={i} d={`M 200 200 L ${pt(i * 45)} A 190 190 0 0 1 ${pt((i + 1) * 45)} Z`} fill={c} stroke="#d4af37" strokeWidth="2" />
          ))}
          <circle cx="200" cy="200" r="46" fill="#ffffff" stroke="#d4af37" strokeWidth="8" />
        </svg>
      </div>
    ),
    size,
  );
}
