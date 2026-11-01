"use client";

import { useEffect, useRef } from "react";
import styles from "./black-ink.module.css";

/**
 * Black ink spilled on the dark stock, under a dark plate's words: a live WebGL layer
 * (black-ink-gl.js) in the box this leaves empty. Mounted first in its section, so the
 * words and their own ink layer stay above it. Started after idle, as the page's layers are;
 * sessionStorage "black-ink" = "off" leaves it out, to measure the page without it.
 */
export default function BlackInk({ kind }: { kind: "experience" | "contact" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    try { if (sessionStorage.getItem("black-ink") === "off") return; } catch {}
    let layer: { destroy: () => void } | undefined, dead = false;
    const go = () => import("@/lib/black-ink-gl").then((m) => { if (!dead) layer = m.startBlackInk(el, { id: `black-ink-${kind}`, kind }); });
    const idle = typeof window.requestIdleCallback === "function";
    const t = idle ? window.requestIdleCallback(go, { timeout: 2000 }) : window.setTimeout(go, 80);
    return () => { dead = true; if (idle) window.cancelIdleCallback(t); else window.clearTimeout(t); layer?.destroy(); };
  }, [kind]);
  return <div ref={ref} className={styles.spill} data-gl-host aria-hidden="true" />;
}
