"use client";

import { useEffect, useState } from "react";

type Layer = { destroy: () => void };
type Mode = "analog" | "digital";

/**
 * Starts the WebGL paper, marker, ink and frame layers after first paint. The mode lives in the DOM:
 * `<html data-surface="analog|digital">`, or any element with `data-surface-toggle`. The button below is just one such element.
 */
export function Surface() {
  const [mode, setMode] = useState<Mode>("analog");

  useEffect(() => {
    const layers: Layer[] = [];
    let cancelled = false;
    let unbind = () => {};
    let unsync = () => {};
    let frame = 0, step = 0;
    const start = () =>
      Promise.all([import("@/lib/surface-mode"), import("@/lib/paper-gl"), import("@/lib/marker-gl"), import("@/lib/ink-gl"), import("@/lib/frame-gl")]).then(
        ([s, p, m, i, f]) => {
          if (cancelled) return;
          s.restoreSurfaceMode();
          unbind = s.bindSurfaceAttributes();
          unsync = s.onSurface(() => setMode(s.getSurfaceMode()));
          setMode(s.getSurfaceMode());
          // a frame a layer: each makes its contexts and programs and draws its first tiles (the GPU answers
          // some of that synchronously), and the four before one frame held it for 60 ms. A task each is not
          // enough: the frame waits for every task queued ahead of it, so the next starts after it is drawn
          const starts = [p.startPaper, m.startMarker, i.startInk, f.startFrames];
          const next = () => {
            if (cancelled) return;
            layers.push(starts.shift()!());
            if (starts.length) frame = requestAnimationFrame(() => (step = window.setTimeout(next, 0)));
          };
          next();
        },
      );
    const idle = typeof window.requestIdleCallback === "function";
    const id = idle ? window.requestIdleCallback(start, { timeout: 400 }) : setTimeout(start, 50);
    return () => {
      cancelled = true;
      if (idle) window.cancelIdleCallback(id as number);
      else clearTimeout(id);
      cancelAnimationFrame(frame);
      clearTimeout(step);
      layers.forEach((l) => l.destroy());
      unbind();
      unsync();
    };
  }, []);

  // the page stays analog: no switch on screen for now (html[data-surface] still drives it)
  void mode;
  return null;
}
