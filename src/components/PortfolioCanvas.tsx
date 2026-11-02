"use client";

import { useEffect, useRef } from "react";
import styles from "./portfolio.module.css";

/** a picture on the canvas: placed in column widths (x, y, h), its column for the wrap */
export type Print = { href: string; src: string; title: string; own: boolean; col: number; x: number; y: number; h: number };

/** past the window's edge, how far a print is kept before it goes round to the other side */
const MARGIN = 160;
/** the dots' pitch, in px: the surface moves under the prints by this much, then repeats */
const PITCH = 22;
/** px/s the canvas drifts at when nobody has hold of it */
const DRIFT = 14;

/**
 * The portfolio as a surface that goes on in every direction: drag it (or swipe sideways, or a
 * trackpad's sideways scroll) and it carries on, with a throw. One tile of prints, each sent
 * round to the far side as it leaves the window: the tile is wider and taller than any window,
 * so a print is only ever in one place. The plane moves on the compositor; a print is written
 * to only when it goes round.
 */
export default function PortfolioCanvas({ prints, width, heights }: { prints: Print[]; width: number; heights: number[] }) {
  const view = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const dots = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = view.current, pl = plane.current, dt = dots.current;
    if (!el || !pl || !dt) return;
    const items = [...pl.children] as HTMLElement[];
    const wrapped = items.map(() => [NaN, NaN]);
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    let cw = 0, W = 0, vw = 0, vh = 0;
    let ox = 0, oy = 0, vx = 0, vy = 0;
    let raf = 0, last = 0, seen = false, held = false, rest = 0;

    const measure = () => {
      cw = parseFloat(getComputedStyle(el).getPropertyValue("--cw")) || 240;
      W = width * cw; vw = el.clientWidth; vh = el.clientHeight;
    };
    const place = () => {
      pl.style.transform = `translate3d(${ox}px, ${oy}px, 0)`;
      dt.style.transform = `translate3d(${((ox % PITCH) + PITCH) % PITCH - PITCH}px, ${((oy % PITCH) + PITCH) % PITCH - PITCH}px, 0)`;
      for (let i = 0; i < prints.length; i++) {
        const p = prints[i], H = heights[p.col] * cw;
        const kx = Math.ceil((-ox - MARGIN - cw - p.x * cw) / W);
        const ky = Math.ceil((-oy - MARGIN - p.h * cw - p.y * cw) / H);
        const w = wrapped[i];
        if (w[0] !== kx || w[1] !== ky) {
          w[0] = kx; w[1] = ky;
          items[i].style.transform = `translate3d(${kx * W}px, ${ky * H}px, 0)`;
        }
      }
    };
    const frame = (t: number) => {
      raf = 0;
      const d = Math.min(0.05, last ? (t - last) / 1000 : 0); last = t;
      if (!held) {
        if (Math.abs(vx) + Math.abs(vy) > 4) {
          ox += vx * d; oy += vy * d;
          const f = Math.pow(0.04, d); vx *= f; vy *= f;   // a throw, run out in a second or so
        } else if (!still.matches && t > rest) {
          ox -= DRIFT * d; oy -= DRIFT * 0.4 * d;
        }
      }
      place();
      if (seen && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const run = () => { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } };
    const hold = (ms: number) => { rest = performance.now() + ms; };

    // a drag, from a mouse or a pen; a finger only sideways (touch-action), so the page still scrolls
    let px = 0, py = 0, pt = 0, id = -1, moved = false;
    const down = (e: PointerEvent) => {
      if (e.button) return;
      id = e.pointerId; px = e.clientX; py = e.clientY; pt = e.timeStamp; moved = false; vx = vy = 0;
      held = true;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - px, dy = e.pointerType === "touch" ? 0 : e.clientY - py;
      if (!moved && Math.hypot(dx, e.clientY - py) < 5) return;
      if (!moved) { moved = true; el.setPointerCapture(id); el.dataset.dragging = "true"; }
      const s = Math.max(1, e.timeStamp - pt) / 1000;
      vx = vx * 0.3 + (dx / s) * 0.7; vy = vy * 0.3 + (dy / s) * 0.7;
      ox += dx; oy += dy; px = e.clientX; py = e.clientY; pt = e.timeStamp;
      place();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1; held = false; delete el.dataset.dragging;
      if (e.timeStamp - pt > 80) vx = vy = 0;                // held still before letting go: no throw
      hold(2500); run();
    };
    // a print dragged is not a print clicked
    const click = (e: MouseEvent) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } };
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;  // up and down is the page's
      e.preventDefault(); ox -= e.deltaX; vx = vy = 0; hold(2500); place(); run();
    };
    const key = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 400 : 120;
      const k = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (!k || e.target !== el) return;
      e.preventDefault(); vx = k[0] * 4; vy = k[1] * 4; hold(4000); run();
    };
    // a print focused from the keyboard is brought into the window
    const focus = (e: FocusEvent) => {
      const a = (e.target as HTMLElement).closest("a"); if (!a || !pl.contains(a)) return;
      const r = a.getBoundingClientRect(), v = el.getBoundingClientRect();
      ox += v.left + vw / 2 - (r.left + r.width / 2); oy += v.top + vh / 2 - (r.top + r.height / 2);
      el.scrollLeft = el.scrollTop = 0; vx = vy = 0; hold(6000); place();
    };
    const pause = () => { hold(1e9); };
    const resume = () => { if (!held) hold(1200); };

    measure();
    ox = -(W - vw) / 2; oy = -cw * 0.6;
    place();
    el.dataset.live = "true";
    const io = new IntersectionObserver(([en]) => { seen = en.isIntersecting; if (seen) run(); });
    io.observe(el);
    const ro = new ResizeObserver(() => { measure(); wrapped.forEach((w) => (w[0] = w[1] = NaN)); place(); });
    ro.observe(el);
    const vis = () => { if (!document.hidden) run(); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("click", click, true);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("keydown", key);
    el.addEventListener("focusin", focus);
    el.addEventListener("pointerenter", pause);
    el.addEventListener("pointerleave", resume);
    document.addEventListener("visibilitychange", vis);
    return () => {
      cancelAnimationFrame(raf); io.disconnect(); ro.disconnect();
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("click", click, true);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("keydown", key);
      el.removeEventListener("focusin", focus);
      el.removeEventListener("pointerenter", pause);
      el.removeEventListener("pointerleave", resume);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [prints, width, heights]);

  return (
    <div
      ref={view}
      className={styles.view}
      tabIndex={0}
      role="region"
      aria-label="Portfolio canvas: drag, or use the arrow keys, to look around"
    >
      <div ref={dots} className={styles.dots} aria-hidden />
      <div ref={plane} className={styles.plane}>
        {prints.map((p) => (
          <a
            key={p.src}
            href={p.href}
            className={styles.print}
            data-own={p.own}
            draggable={false}
            tabIndex={p.own ? 0 : -1}
            {...(p.own ? {} : { target: "_blank", rel: "noopener noreferrer" })}
            style={{ "--x": p.x, "--y": p.y, "--h": p.h } as React.CSSProperties}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- hundreds of prints, moved by hand: plain, lazy */}
            <img src={p.src} alt={p.title} loading="lazy" decoding="async" draggable={false} />
            <span className={styles.tip} aria-hidden>{p.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
