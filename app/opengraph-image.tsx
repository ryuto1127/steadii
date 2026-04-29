import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Steadii — AI secretary for your studies.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 14,
              backgroundColor: "#F59E0B",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 48,
              fontWeight: 700,
              color: "#0C0B0A",
            }}
          >
            S
          </div>
          <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: -1 }}>
            Steadii
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
