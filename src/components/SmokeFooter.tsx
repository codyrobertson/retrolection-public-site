"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import ART from "@/lib/footer-art.json";
import { startTapping } from "@/lib/tap-schedule";
import styles from "./smoke-footer.module.css";

/**
 * The foot of the page: a lit cigarette in an ashtray, its smoke going up to the scrim, and a
 * right hand seen from above, resting by it with the arm coming up off the page's foot; now and
 * then its fingers drum. Drawn once with
 * the hero's pencil (scripts/footer-art.mjs) as alpha masks, so the footer's tokens tint it:
 * the footer is always the light stock, so graphite on paper, whatever the page above is.
 *
 * Without motion, or without script, it is the still frame: the hand at rest, the ember a dot,
 * the smoke a drawn wisp. The plume (smoke-gl) and the tapping (tap-schedule) start only when
 * the foot is near the screen, and stop when it leaves or the tab is hidden.
 *
 * Everything below the root is data-gl-skip: its own motion must not rebuild the page's ink.
 */

const A = ART;
const px = (n: number) => `${n}px`;
const VARS = {
  "--group": A.groupW,
  "--hand-w": A.hand.cell[0], "--hand-h": A.hand.cell[1], "--hand-cols": A.hand.cols, "--hand-rows": A.hand.rows,
  "--tray-w": A.tray.w, "--tray-h": A.tray.h, "--ember-x": A.tray.ember[0], "--ember-y": A.tray.ember[1],
  "--wisp-w": A.wisp.w, "--wisp-h": A.wisp.h,
  "--wood-w": px(A.wood.w), "--wood-h": px(A.wood.h),
} as CSSProperties;

export default function SmokeFooter() {
  const root = useRef<HTMLDivElement>(null);
  const hand = useRef<HTMLDivElement>(null);
  const ember = useRef<HTMLDivElement>(null);
  const smokeCanvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = root.current, hd = hand.current, em = ember.current, cv = smokeCanvas.current;
    if (!el || !hd || !em || !cv) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    if (still.matches) { cv.hidden = true; return; }

    let near = false, dead = false, smoke: { play(): void; pause(): void; resize(): void; destroy(): void } | null = null, loading = false;
    const active = () => near && !document.hidden && !still.matches;

    // the ember's place in the canvas, 0..1 across and up, and the drawing's scale (the dot is 12 art px); measured when the foot changes size, not per frame
    let at: [number, number, number] = [0.5, 0.2, 1];
    const measure = () => {
      const c = cv.getBoundingClientRect(), e = em.getBoundingClientRect();
      if (c.width && c.height) at = [(e.left + e.width / 2 - c.left) / c.width, 1 - (e.top + e.height / 2 - c.top) / c.height, e.width / 12];
    };
    const resized = () => { measure(); smoke?.resize(); };

    let frame = -1;
    const show = (f: number) => {
      if (f === frame) return;
      frame = f;
      hd.style.setProperty("--hc", String(f % A.hand.cols));
      hd.style.setProperty("--hr", String(Math.floor(f / A.hand.cols)));
    };
    const tap = startTapping(show, active);

    const sync = () => {
      if (active()) {
        if (!smoke && !loading) {
          loading = true;
          import("@/lib/smoke-gl").then(({ startSmoke }) => {
            if (dead) return;
            measure();
            smoke = startSmoke(cv, { ember: () => at, onFrame: (ok = true) => el.toggleAttribute("data-live", ok) });
            if (!smoke) cv.hidden = true;
            sync();
          });
        }
        smoke?.play();
        tap.kick();
      } else smoke?.pause();
    };

    const io = new IntersectionObserver(([e]) => { near = e.isIntersecting; sync(); }, { rootMargin: "200px" });
    io.observe(el);
    const ro = new ResizeObserver(resized);
    ro.observe(el);
    const stop = () => { smoke?.destroy(); smoke = null; tap.stop(); el.removeAttribute("data-live"); cv.hidden = true; };
    const moved = () => (still.matches ? stop() : sync());
    document.addEventListener("visibilitychange", sync);
    still.addEventListener("change", moved);
    return () => {
      dead = true;
      io.disconnect(); ro.disconnect();
      document.removeEventListener("visibilitychange", sync);
      still.removeEventListener("change", moved);
      smoke?.destroy(); tap.stop();
    };
  }, []);

  return (
    <div ref={root} className={styles.vignette} style={VARS} aria-hidden="true" data-gl-skip>
      <div className={styles.wood} />
      <div className={styles.trayBody} />
      <div className={styles.trayInk} />
      <div className={styles.wisp} />
      <div ref={ember} className={styles.ember} />
      <canvas ref={smokeCanvas} className={styles.smoke} />
      <div className={styles.scrim} />
      <div ref={hand} className={styles.hand}>
        <div className={styles.handBody} />
        <div className={styles.handInk} />
      </div>
    </div>
  );
}
