"use client";

import { useEffect, useState } from "react";

type Layer = { destroy: () => void };
type Mode = "analog" | "digital";

/** Starts the WebGL paper, marker, ink and frame layers after first paint, plus the analog/digital switch. The DOM is unchanged until each layer is ready. */
export function Surface() {
  const [mode, setMode] = useState<Mode>("analog");

  useEffect(() => {
    const layers: Layer[] = [];
    let cancelled = false;
    const start = () =>
      Promise.all([import("@/lib/surface-mode"), import("@/lib/paper-gl"), import("@/lib/marker-gl"), import("@/lib/ink-gl"), import("@/lib/frame-gl")]).then(
        ([s, p, m, i, f]) => {
          if (cancelled) return;
          s.restoreSurfaceMode();
          setMode(s.getSurfaceMode());
          layers.push(p.startPaper(), m.startMarker(), i.startInk(), f.startFrames());
        },
      );
    const idle = typeof window.requestIdleCallback === "function";
    const id = idle ? window.requestIdleCallback(start, { timeout: 400 }) : setTimeout(start, 50);
    return () => {
      cancelled = true;
      if (idle) window.cancelIdleCallback(id as number);
      else clearTimeout(id);
      layers.forEach((l) => l.destroy());
    };
  }, []);

  const flip = () => {
    const next: Mode = mode === "analog" ? "digital" : "analog";
    setMode(next);
    import("@/lib/surface-mode").then((s) => s.setSurfaceMode(next));
  };

  return (
    <button type="button" className="surface-toggle" onClick={flip} aria-pressed={mode === "digital"} aria-label="Switch between analog and digital surface">
      {mode === "analog" ? "Analog → Digital" : "Digital → Analog"}
    </button>
  );
}
