import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "steadii — AI secretary for your studies.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// 2026-05-14 — swapped the orange-tile "S" placeholder for the
// holographic Logomark (three nested arcs in cyan→pink→lime gradient)
// and lowercased "Steadii" to "steadii" so the OG card matches the
// canonical wordmark used in landing copy + metadata.
//
// The Logomark component itself uses CSS variables + useId, neither
// of which resolves inside next/og's edge ImageResponse runtime. The
// SVG is inlined here with explicit hex stops + a static gradient
// id. Keep the path coordinates in sync with components/landing/
// visual/logomark.tsx if either side changes.

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          backgroundColor: "#0C0B0A",
          color: "#F5F5F4",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg
            width={72}
            height={72}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient id="og-logomark" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#2dd4ff" />
                <stop offset="50%" stopColor="#ff4dcb" />
                <stop offset="100%" stopColor="#c4ff3a" />
              </linearGradient>
            </defs>
            <path
              d="M5 8.5C5 5.5 8 4 12 4s7 1.5 7 4.5"
              stroke="url(#og-logomark)"
              strokeWidth="2.4"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M5 12c0-3 3-4.5 7-4.5s7 1.5 7 4.5-3 4.5-7 4.5"
              stroke="url(#og-logomark)"
              strokeWidth="2.4"
              strokeLinecap="round"
              fill="none"
              opacity="0.75"
            />
            <path
              d="M5 15.5c0 3 3 4.5 7 4.5s7-1.5 7-4.5"
              stroke="url(#og-logomark)"
              strokeWidth="2.4"
              strokeLinecap="round"
              fill="none"
              opacity="0.5"
            />
          </svg>
          <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: -1 }}>
            steadii
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: 88,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -2,
              maxWidth: 960,
            }}
          >
            AI secretary for your studies.
          </div>
          <div
            style={{
              height: 6,
              width: 120,
              backgroundColor: "#F59E0B",
              borderRadius: 3,
            }}
          />
        </div>

        <div style={{ fontSize: 24, color: "#A8A29E" }}>mysteadii.com</div>
      </div>
    ),
    { ...size }
  );
}
