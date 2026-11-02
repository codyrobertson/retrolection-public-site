"use client";

import { useEffect, useRef } from "react";
import styles from "./portfolio.module.css";

/** a picture on the canvas: placed and sized in cells (x, y, w, h); its column repeats every ph cells */
export type Print = { href: string; src: string; title: string; own: boolean; x: number; y: number; w: number; h: number; ph: number };

/** past the window's edge, how far a print is kept before it goes round to the other side */
const MARGIN = 160;
/** the dots' pitch, in px: the surface moves under the prints by this much, then repeats */
const PITCH = 24;

/**
 * The portfolio as a surface that goes on in every direction: drag it (or swipe sideways, or a
 * trackpad's sideways scroll, or the arrow keys) and it carries on, with a throw, then rests:
 * nothing moves (or is drawn) unless someone moves it. One tile of columns, each print sent round
 * to the far side as it leaves the window: the tile is wider than any window and every column
 * longer than one, so a print is only ever in one place. The plane is the one layer that moves
 * (on the compositor); a print is written to only when it goes round, and then in 2D, so the
 * prints are painted into the plane rather than each made a layer of its own.
 */
export default function PortfolioCanvas({ prints, width }: { prints: Print[]; width: number }) {
  const view = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const dots = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = view.current, pl = plane.current, dt = dots.current;
    if (!el || !pl || !dt) return;
    const items = [...pl.children] as HTMLElement[];
    const wrapped = items.map(() => [NaN, NaN]);
    let cell = 0, W = 0, vw = 0, vh = 0;
    let ox = 0, oy = 0, vx = 0, vy = 0;
    let raf = 0, last = 0, seen = false, held = false;

    const measure = () => {
      cell = parseFloat(getComputedStyle(el).getPropertyValue("--cell")) || 280;
      W = width * cell; vw = el.clientWidth; vh = el.clientHeight;
    };
    const place = () => {
      pl.style.transform = `translate3d(${ox}px, ${oy}px, 0)`;
      const m = (v: number) => ((v % PITCH) + PITCH) % PITCH - PITCH;
      dt.style.transform = `translate3d(${m(ox)}px, ${m(oy)}px, 0)`;
      for (let i = 0; i < prints.length; i++) {
        const p = prints[i];
        const kx = Math.ceil((-ox - MARGIN - (p.x + p.w) * cell) / W);
        const H = p.ph * cell, ky = Math.ceil((-oy - MARGIN - (p.y + p.h) * cell) / H);
        const w = wrapped[i];
        if (w[0] !== kx || w[1] !== ky) { w[0] = kx; w[1] = ky; items[i].style.transform = `translate(${kx * W}px, ${ky * H}px)`; }
      }
    };
    const frame = (t: number) => {
      raf = 0;
      const d = Math.min(0.05, last ? (t - last) / 1000 : 0); last = t;
      if (held || Math.abs(vx) + Math.abs(vy) <= 4) { vx = vy = 0; return; }   // at rest: no more frames
      ox += vx * d; oy += vy * d;
      const f = Math.pow(0.04, d); vx *= f; vy *= f;      // a throw, run out in a second or so
      place();
      if (seen && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const run = () => { if (!raf && seen) { last = 0; raf = requestAnimationFrame(frame); } };

    // a drag, from a mouse or a pen; a finger only sideways (touch-action), so the page still scrolls
    let px = 0, py = 0, pt = 0, id = -1, dragged = false;
    const down = (e: PointerEvent) => {
      if (e.button) return;
      id = e.pointerId; px = e.clientX; py = e.clientY; pt = e.timeStamp; dragged = false; vx = vy = 0; held = true;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - px, dy = e.pointerType === "touch" ? 0 : e.clientY - py;
      if (!dragged && Math.hypot(e.clientX - px, e.clientY - py) < 5) return;
      if (!dragged) { dragged = true; el.setPointerCapture(id); el.dataset.dragging = "true"; }
      const s = Math.max(1, e.timeStamp - pt) / 1000;
      vx = vx * 0.3 + (dx / s) * 0.7; vy = vy * 0.3 + (dy / s) * 0.7;
      ox += dx; oy += dy; px = e.clientX; py = e.clientY; pt = e.timeStamp;
      place();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1; held = false; delete el.dataset.dragging;
      if (e.timeStamp - pt > 80) vx = vy = 0;                 // held still before letting go: no throw
      run();
    };
    // a print dragged is not a print clicked
    const click = (e: MouseEvent) => { if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false; } };
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;   // up and down is the page's
      e.preventDefault(); ox -= e.deltaX; vx = vy = 0; place();
    };
    const key = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 480 : 160;
      const k = ({ ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] } as Record<string, number[]>)[e.key];
      if (!k || e.target !== el) return;
      e.preventDefault(); vx = k[0] * 4; vy = k[1] * 4; run();
    };
    // a print focused from the keyboard is brought into the window
    const focus = (e: FocusEvent) => {
      const a = (e.target as HTMLElement).closest("a"); if (!a || !pl.contains(a)) return;
      const r = a.getBoundingClientRect(), v = el.getBoundingClientRect();
      ox += v.left + vw / 2 - (r.left + r.width / 2); oy += v.top + vh / 2 - (r.top + r.height / 2);
      el.scrollLeft = el.scrollTop = 0; vx = vy = 0; place();
    };

    measure();
    ox = -(W - vw) / 2; oy = -0.35 * cell;   // opened partway down, so it reads as running on above too
    place();
    el.dataset.live = "true";
    const io = new IntersectionObserver(([en]) => { seen = en.isIntersecting; if (seen) run(); });
    io.observe(el);
    const ro = new ResizeObserver(() => { measure(); wrapped.forEach((w) => (w[0] = w[1] = NaN)); place(); });
    ro.observe(el);
    const vis = () => { if (!document.hidden) run(); };
    const on: [string, EventListener, AddEventListenerOptions?][] = [
      ["pointerdown", down as EventListener], ["pointermove", move as EventListener], ["pointerup", up as EventListener],
      ["pointercancel", up as EventListener], ["click", click as EventListener, { capture: true }], ["wheel", wheel as EventListener, { passive: false }],
      ["keydown", key as EventListener], ["focusin", focus as EventListener],
    ];
    on.forEach(([t, f, o]) => el.addEventListener(t, f, o));
    document.addEventListener("visibilitychange", vis);
    return () => {
      cancelAnimationFrame(raf); io.disconnect(); ro.disconnect();
      on.forEach(([t, f, o]) => el.removeEventListener(t, f, o));
      document.removeEventListener("visibilitychange", vis);
    };
  }, [prints, width]);

  return (
    <div ref={view} className={styles.view} tabIndex={0} role="region" aria-label="Portfolio canvas: drag, or use the arrow keys, to look around">
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
            style={{ "--x": p.x, "--y": p.y, "--w": p.w, "--h": p.h } as React.CSSProperties}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- hundreds of small prints, moved by hand: plain, lazy */}
            <img src={p.src} alt={p.title} loading="lazy" decoding="async" draggable={false} />
            <span className={styles.tip} aria-hidden>{p.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
