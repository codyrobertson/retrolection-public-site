"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import GRIP from "@/lib/grip.json";
import styles from "./curl.module.css";

/**
 * Turning the page. A link to another page doesn't cut to it: the right hand (the hero's,
 * drawn by the same scene: scripts/curl-hand.mjs) comes in from the right, takes the sheet by
 * its top right corner, and pulls it down and away to the left, the next page under it.
 *
 * The reach is the live page; the pull is a view transition the page drives itself (React
 * starts none: no <ViewTransition> here), so the outgoing sheet is the browser's own snapshot
 * of it. Every frame of the pull is worked out at the click, for this window, as keyframes:
 * the sheet clipped at the fold (::view-transition-old(root)), the back of the turned corner
 * (curl-flap), and the hand holding it (curl-hand), so they move as one on the compositor.
 *
 * Off with reduced motion, without view transitions, and for anything but a plain click on a
 * link to another of the site's pages.
 */

const REACH_MS = 520, PINCH_MS = 150, HOLD_MS = 40;
const PULL = (diag: number) => Math.min(1150, 760 + diag * 0.18);
const SAMPLES = 48;
const SKIP = /^\/(keystatic|api)(\/|$)|\.[a-z0-9]+$/i;

type V = [number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const rot = (a: V, r: number): V => [a[0] * Math.cos(r) - a[1] * Math.sin(r), a[0] * Math.sin(r) + a[1] * Math.cos(r)];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoother = (t: number) => t * t * t * (t * (6 * t - 15) + 10);
const out3 = (t: number) => 1 - (1 - t) ** 3;
const PAPER = [244, 241, 232], INK = [26, 25, 23];            // the strip's own: scene.js
const rgb = (hex: string) => { const h = hex.trim().replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const px = (n: number) => `${Math.round(n * 10) / 10}px`;

/**
 * The viewport cut by a line, on one side of it: (p - o)·d <= s (keep 1) or >= s (keep -1).
 * Always eight points, two an edge (the edge's start or where it comes in, and where it goes
 * out), so that from one keyframe to the next each point only slides: a polygon whose points
 * changed places would sweep a wedge across the page between them.
 */
function cut(W: number, H: number, o: V, d: V, s: number, keep: 1 | -1) {
  const rect: V[] = [[0, 0], [W, 0], [W, H], [0, H]];
  const side = (p: V) => keep * (s - dot([p[0] - o[0], p[1] - o[1]], d));
  const pts: (V | null)[] = [];
  rect.forEach((a, i) => {
    const b = rect[(i + 1) % 4], fa = side(a), fb = side(b);
    const x = fa * fb < 0 ? add(a, mul([b[0] - a[0], b[1] - a[1]], fa / (fa - fb))) : null;
    if (fa >= 0) pts.push(a, x ?? a);
    else if (x) pts.push(x, x);
    else pts.push(null, null);
  });
  // an edge wholly cut away sits on the last point before it
  const last = [...pts].reverse().find(Boolean) ?? ([-9, -9] as V);
  let prev = last;
  return pts.map((p) => (prev = p ?? prev));
}
const poly = (pts: V[]) => `polygon(${pts.map((p) => `${px(p[0])} ${px(p[1])}`).join(", ")})`;

/** the strip's frames on one canvas, pins together: what the hand's box is, and where the held corner is in it */
const BOX = (() => {
  const f = GRIP.frames, X = GRIP.x;
  const L = Math.max(...f.map((q) => q.pin[0])), T = Math.max(...f.map((q) => q.pin[1]));
  const R = Math.max(...f.map((q) => q.w - q.pin[0])), B = Math.max(...f.map((q) => q.h - q.pin[1]));
  return { L, T, w: (L + R) / X, h: (T + B) / X, pin: [L / X, T / X] as V };
})();

export default function PageCurl() {
  const router = useRouter();
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  const hand = useRef<HTMLCanvasElement>(null);
  const keys = useRef<HTMLStyleElement>(null);
  const strip = useRef<HTMLImageElement | null>(null);
  const inked = useRef<{ key: string; src: CanvasImageSource } | null>(null);
  const waiting = useRef<{ path: string; done: () => void } | null>(null);
  const busy = useRef(false);

  // the new page is in: let the pull begin
  useEffect(() => {
    const w = waiting.current;
    if (w && w.path === pathname) { waiting.current = null; w.done(); }
  }, [pathname]);

  useEffect(() => {
    const img = new Image();
    img.decoding = "async";
    const load = () => { img.src = "/hand/grip.webp"; img.decode().then(() => { strip.current = img; }, () => {}); };
    const idle = typeof window.requestIdleCallback === "function";
    const t = idle ? window.requestIdleCallback(load, { timeout: 2000 }) : window.setTimeout(load, 800);

    /**
     * The strip in the page's own paper and ink: drawn graphite on light stock, so on the dark
     * stock its tones are mapped across (each channel, paper to paper and ink to ink), once.
     */
    const stock = () => {
      const cs = getComputedStyle(document.documentElement);
      const paper = rgb(cs.getPropertyValue("--paper")), ink = rgb(cs.getPropertyValue("--ink")), key = `${paper}${ink}`;
      if (inked.current?.key !== key) {
        const im = strip.current!;
        if (paper.every((v, i) => v === PAPER[i]) && ink.every((v, i) => v === INK[i])) inked.current = { key, src: im };
        else {
          const cv = document.createElement("canvas"); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
          const g = cv.getContext("2d", { willReadFrequently: true })!; g.drawImage(im, 0, 0);
          const px = g.getImageData(0, 0, cv.width, cv.height), d = px.data;
          const a = [0, 1, 2].map((i) => (ink[i] - paper[i]) / (INK[i] - PAPER[i])), b = [0, 1, 2].map((i) => paper[i] - a[i] * PAPER[i]);
          for (let o = 0; o < d.length; o += 4) for (let i = 0; i < 3; i++) d[o + i] = a[i] * d[o + i] + b[i];
          g.putImageData(px, 0, 0);
          inked.current = { key, src: cv };
        }
      }
      return { paper, deep: cs.getPropertyValue("--paper-deep").trim(), dark: document.documentElement.dataset.theme === "dark" };
    };

    /** one frame of the strip on the hand's canvas: grip 0..1, boil 0/1 */
    const paint = (grip: number, boil: number) => {
      const c = hand.current, im = inked.current?.src;
      if (!c || !im) return;
      const g = c.getContext("2d")!, k = c.width / BOX.w / GRIP.x;
      const f = GRIP.frames.reduce((best, q) => (q.boil === boil % 2 && Math.abs(q.t - grip) < Math.abs(best.t - grip) ? q : best), GRIP.frames[0]);
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(im, f.x, f.y, f.w, f.h, (BOX.L - f.pin[0]) * k, (BOX.T - f.pin[1]) * k, f.w * k, f.h * k);
    };

    const turn = (href: string, path: string) => {
      const el = root.current!, c = hand.current!, st = keys.current!;
      const W = innerWidth, H = innerHeight, diag = Math.hypot(W, H);
      const sc = Math.min(1, Math.max(0.6, W / 1400));
      const C0: V = [W, 0];
      const d = (() => { const v: V = [-1, 1.12]; const n = Math.hypot(...v); return [v[0] / n, v[1] / n] as V; })();
      const S_END = dot([-W, H], d) + 24;
      const inward: V = [-Math.SQRT1_2, Math.SQRT1_2];
      // fingers up and to the right, the wrist below and left of the corner; turning further as it pulls
      const A0 = 36 * (Math.PI / 180), A1 = 62 * (Math.PI / 180);
      // the hand's place for its pin at p, turned a: translate · rotate · scale, about its box's corner
      const place = (p: V, a: number) => { const t = add(p, mul(rot(BOX.pin, a), -sc)); return `translate(${px(t[0])}, ${px(t[1])}) rotate(${(a * 180) / Math.PI}deg) scale(${sc})`; };
      const held = (s: number) => {
        const corner = add(C0, mul(d, 2 * s));
        const v = add(inward, mul(d, -2 * dot(inward, d)));          // the corner's inside, turned over with it
        return add(corner, mul(v, 14 * sc));
      };

      // the pull, sampled: the sheet's keep, the turned-over back, the hand
      const sheet: string[] = [], back: string[] = [], hold: string[] = [];
      for (let i = 0; i <= SAMPLES; i++) {
        const u = i / SAMPLES, s = S_END * smoother(u), pct = `${((u * 100)).toFixed(2)}%`;
        const flap = cut(W, H, C0, d, s, 1).map((p) => add(p, mul(d, 2 * (s - dot([p[0] - C0[0], p[1] - C0[1]], d)))));
        sheet.push(`${pct}{clip-path:${poly(cut(W, H, C0, d, s, -1))}}`);
        back.push(`${pct}{clip-path:${poly(flap)}}`);
        hold.push(`${pct}{transform:${place(held(s), lerp(A0, A1, smoother(u)))}}`);
      }
      const ms = PULL(diag);
      st.textContent =
        `@keyframes curl-sheet{${sheet.join("")}}@keyframes curl-back{${back.join("")}}@keyframes curl-hold{${hold.join("")}}` +
        `:root{--curl-ms:${Math.round(ms)}ms}`;

      // the reach: in from below the right edge, onto the corner, and the pinch
      const dpr = Math.min(2, devicePixelRatio || 1);
      c.width = Math.round(BOX.w * dpr * sc); c.height = Math.round(BOX.h * dpr * sc);
      c.style.width = `${BOX.w}px`; c.style.height = `${BOX.h}px`;
      // the turned sheet keeps the colours it had: by the time it's drawn the next page may have its own
      const { paper, deep, dark } = stock();
      const flap = el.querySelector<HTMLElement>("[data-flap]")!;
      flap.style.background = `linear-gradient(135deg, color-mix(in srgb, rgb(${paper}) ${dark ? 92 : 70}%, white) 0%, transparent 60%), ${deep}`;
      el.dataset.on = "";
      flap.style.viewTransitionName = "curl-flap"; c.style.viewTransitionName = "curl-hand";
      const from: V = [W - 40 * sc, H + BOX.h * sc * 0.5], at = held(0);
      const t0 = performance.now();
      let boil = 0, lastBoil = 0;
      router.prefetch(href);

      return new Promise<void>((resolve) => {
        const reach = (now: number) => {
          const e = Math.min(1, (now - t0) / REACH_MS), k = out3(e);
          const p: V = [lerp(from[0], at[0], k), lerp(from[1], at[1], k) - Math.sin(k * Math.PI) * 40 * sc];
          c.style.transform = place(p, lerp(A0 + 0.3, A0, k));
          const pinch = Math.max(0, (now - t0 - REACH_MS + PINCH_MS) / PINCH_MS);
          if (now - lastBoil > 1000 / 12) { boil++; lastBoil = now; }
          paint(Math.min(1, pinch), boil);
          if (now - t0 < REACH_MS + HOLD_MS) requestAnimationFrame(reach);
          else resolve();
        };
        requestAnimationFrame(reach);
      }).then(() => {
        let raf = 0;
        const boiling = (now: number) => { if (now - lastBoil > 1000 / 12) { boil++; lastBoil = now; paint(1, boil); } raf = requestAnimationFrame(boiling); };
        const vt = document.startViewTransition({
          update: () => new Promise<void>((done) => {
            el.dataset.pull = "";                               // the flap, whole, for the new snapshot only: it is drawn cut
            const timer = window.setTimeout(() => { waiting.current = null; done(); }, 4000);
            // no requestAnimationFrame in here: the page doesn't render while its snapshot is up
            waiting.current = { path, done: () => { clearTimeout(timer); done(); } };
            router.push(href);
          }),
          types: ["page-curl"],
        });
        vt.ready.then(() => { raf = requestAnimationFrame(boiling); }, () => {});
        return vt.finished.finally(() => {
          cancelAnimationFrame(raf);
          delete el.dataset.on; delete el.dataset.pull;
          flap.style.viewTransitionName = c.style.viewTransitionName = flap.style.background = "";
          c.style.transform = "";
          st.textContent = "";
        });
      });
    };

    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download") || a.dataset.noCurl !== undefined) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname || SKIP.test(url.pathname)) return;
      if (busy.current || !strip.current || typeof document.startViewTransition !== "function") return;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      e.preventDefault();
      e.stopPropagation();                                    // before Link's own handler, at the document
      busy.current = true;
      turn(url.pathname + url.search + url.hash, url.pathname).catch(() => router.push(url.href)).finally(() => { busy.current = false; });
    };
    window.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("click", click, true);
      if (idle) window.cancelIdleCallback(t as number); else window.clearTimeout(t as number);
    };
  }, [router]);

  return (
    <div ref={root} className={styles.curl} aria-hidden>
      <style ref={keys} />
      <div className={styles.flap} data-flap />
      <canvas ref={hand} className={styles.hand} />
    </div>
  );
}
