"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./typing.module.css";

const GLYPHS = "+-:=*#%/\\|<>~";
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * A box ruled in type: `+`, dashes and colons in the mono face, counted out to whole
 * characters so its corners land on the grid at any width. It draws itself in: two runs of
 * rule set off from the top left corner, one along the top and down the right, the other
 * down the left and along the foot, and meet in the far corner; then what it holds comes up,
 * and the `corner` line in its top right settles out of a scramble of rule glyphs.
 */
export default function AsciiBox({ corner, reduced = false, children }: { corner?: string; reduced?: boolean; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [grid, setGrid] = useState({ cols: 0, rows: 0, ch: 0 });
  const [run0, setDrawn] = useState(0);           // 0..1, how far the rule has run
  const [settle0, setSettled] = useState(0);      // 0..1, how much of the corner line has settled
  const drawn = reduced ? 1 : run0, settled = reduced ? 1 : settle0;

  useLayoutEffect(() => {
    const o = outer.current, b = body.current, p = probe.current;
    if (!o || !b || !p) return;
    const measure = () => {
      const r = p.getBoundingClientRect(), ch = r.width / 10, lh = r.height;
      const cols = Math.max(12, Math.floor(o.clientWidth / ch));
      const rows = Math.max(1, Math.ceil(b.scrollHeight / lh));
      setGrid((g) => (g.cols === cols && g.rows === rows && g.ch === ch ? g : { cols, rows, ch }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(b);
    document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, []);

  // once it has been measured, the rule runs (1.1s), then the corner settles (0.6s)
  const measured = grid.cols > 0;
  useEffect(() => {
    if (!measured || reduced) return;
    let raf = 0;
    const t0 = performance.now() + 180;
    const tick = (now: number) => {
      const t = (now - t0) / 1100;
      setDrawn(ease(Math.max(0, Math.min(1, t))));
      setSettled(Math.max(0, Math.min(1, (now - t0 - 900) / 600)));
      if (t < 1.5) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [measured, reduced]);

  const { cols, rows, ch } = grid;
  const run = Math.round(drawn * (cols + rows));          // how far each run has got, in characters
  const rule = (top: boolean) =>
    Array.from({ length: cols }, (_, j) => {
      const on = top ? j < run : rows + j < run;
      if (!on) return " ";
      return j === 0 || j === cols - 1 ? "+" : j % 2 ? "-" : " ";
    }).join("");
  const side = (right: boolean) =>
    Array.from({ length: rows }, (_, r) => ((right ? cols + r : r + 1) < run ? ":" : " ")).join("\n");

  // the corner line: each letter a rule glyph until its turn comes
  const cornerText = corner
    ? [...corner].map((c, i, all) => (c === " " || settled * all.length > i ? c : settled > 0 ? GLYPHS[(i * 7 + Math.floor(settled * 40)) % GLYPHS.length] : " ")).join("")
    : "";

  return (
    <div ref={outer} className={styles.note}>
      <span ref={probe} className={styles.probe} aria-hidden>
        0000000000
      </span>
      <div className={styles.box} style={cols ? { width: cols * ch } : undefined} data-ready={cols > 0} data-drawn={drawn >= 1}>
        <div className={styles.rule} aria-hidden>{rule(true)}</div>
        <div className={styles.boxMid}>
          <div className={styles.side} aria-hidden>{side(false)}</div>
          <div ref={body} className={styles.boxBody}>
            {corner && (
              <p className={styles.corner}>
                <span className={styles.sr}>{corner}</span>
                <span aria-hidden>{cornerText}</span>
              </p>
            )}
            {children}
          </div>
          <div className={styles.side} aria-hidden>{side(true)}</div>
        </div>
        <div className={styles.rule} aria-hidden>{rule(false)}</div>
      </div>
    </div>
  );
}
