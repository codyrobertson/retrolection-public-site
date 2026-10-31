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
    const id = "requestIdleCallback" in window ? window.requestIdleCallback(start, { timeout: 400 }) : window.setTimeout(start, 50);
    return () => {
      cancelled = true;
      if ("cancelIdleCallback" in window) window.cancelIdleCallback(id);
      else window.clearTimeout(id);
      layers.forEach((l) => l.destroy());
    };
  }, []);
  return null;
}
