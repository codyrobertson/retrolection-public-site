"use client";

import { useEffect } from "react";

type Layer = { destroy: () => void };

/** Starts the WebGL paper, marker and ink layers after first paint. Renders nothing; the DOM is unchanged until each layer is ready. */
export function Surface() {
  useEffect(() => {
    const layers: Layer[] = [];
    let cancelled = false;
    const start = () =>
      Promise.all([import("@/lib/paper-gl"), import("@/lib/marker-gl"), import("@/lib/ink-gl")]).then(([p, m, i]) => {
        if (cancelled) return;
        layers.push(p.startPaper(), m.startMarker(), i.startInk());
      });
    const idle = typeof window.requestIdleCallback === "function";
    const id = idle ? window.requestIdleCallback(start, { timeout: 400 }) : setTimeout(start, 50);
    return () => {
      cancelled = true;
      if (idle) window.cancelIdleCallback(id as number);
      else clearTimeout(id);
      layers.forEach((l) => l.destroy());
    };
  }, []);
  return null;
}
