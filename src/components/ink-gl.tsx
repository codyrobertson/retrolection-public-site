"use client";

import { useEffect } from "react";

/** Starts the WebGL ink layer after first paint. Renders nothing; DOM text is unchanged until the GL layer is ready. */
export function InkGL() {
  useEffect(() => {
    let ink: { destroy: () => void } | undefined;
    let cancelled = false;
    const start = () =>
      import("@/lib/ink-gl").then((m) => {
        if (!cancelled) ink = m.startInk();
      });
    const id = "requestIdleCallback" in window ? window.requestIdleCallback(start, { timeout: 400 }) : window.setTimeout(start, 50);
    return () => {
      cancelled = true;
      if ("cancelIdleCallback" in window) window.cancelIdleCallback(id);
      else window.clearTimeout(id);
      ink?.destroy();
    };
  }, []);
  return null;
}
