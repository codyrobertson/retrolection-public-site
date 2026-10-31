import { ImageResponse } from "next/og";

export const ogSize = { width: 1200, height: 630 };

/** Shared social-card template. Restyle here once the visual direction lands. */
export function ogImage({ title, kicker, name }: { title: string; kicker?: string; name: string }) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#0a0a0a",
          color: "#ededed",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 28, color: "#a1a1a1", display: "flex" }}>{kicker ?? ""}</div>
        <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.1, letterSpacing: -2, display: "flex" }}>{title}</div>
        <div style={{ fontSize: 28, display: "flex" }}>{name}</div>
      </div>
    ),
    ogSize,
  );
}
