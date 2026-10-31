"use client";

import { useRef, useState } from "react";

/** Placeholder experiment proving the component pipeline works. Replace freely. */
export default function CursorTrail() {
  const ref = useRef<HTMLDivElement>(null);
  const [dots, setDots] = useState<{ x: number; y: number; id: number }[]>([]);

  return (
    <div
      ref={ref}
      onPointerMove={(e) => {
        const rect = ref.current!.getBoundingClientRect();
        const dot = { x: e.clientX - rect.left, y: e.clientY - rect.top, id: performance.now() };
        setDots((d) => [...d.slice(-24), dot]);
      }}
      style={{ position: "absolute", inset: 0, overflow: "hidden", cursor: "crosshair" }}
    >
      {dots.map((d, i) => (
        <span
          key={d.id}
          style={{
            position: "absolute",
            left: d.x,
            top: d.y,
            width: 8 + i,
            height: 8 + i,
            borderRadius: "50%",
            background: "currentColor",
            opacity: (i + 1) / dots.length,
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
          }}
        />
      ))}
      <p style={{ position: "absolute", bottom: 12, left: 16, fontSize: 13, opacity: 0.6 }}>Move your cursor</p>
    </div>
  );
}
