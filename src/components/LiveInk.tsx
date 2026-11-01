"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A part of the page that changes as it is read, in the page's ballpoint ink: its own GL
 * layer rides in it (ink-gl.js startLiveInk) and keeps up with each change, where the page's
 * layer would wait for things to settle. Started after first paint, as the page's are.
 */
export default function LiveInk({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let layer: { destroy: () => void } | undefined, dead = false;
    const go = () => import("@/lib/ink-gl").then((m) => { if (!dead) layer = m.startLiveInk(el, id); });
    const idle = typeof window.requestIdleCallback === "function";
    const t = idle ? window.requestIdleCallback(go, { timeout: 400 }) : window.setTimeout(go, 50);
    return () => { dead = true; if (idle) window.cancelIdleCallback(t); else window.clearTimeout(t); layer?.destroy(); };
  }, [id]);
  return (
    <div ref={ref} className={className} style={{ position: "relative" }} data-gl-skip>
      {children}
    </div>
  );
}
