"use client";

import { useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import type { BoxHandle } from "@/lib/typing/plate";
import styles from "./typing.module.css";

const GLYPHS = "+-:=*#%/\\|<>~";
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const RULE_MS = 1100, SETTLE_AT = 900, SETTLE_MS = 600;

/**
 * A box ruled in type: `+`, dashes and colons in the mono face, counted out to whole
 * characters so its corners land on the grid at any width. It draws itself in: two runs of
 * rule set off from the top left corner, one along the top and down the right, the other
 * down the left and along the foot, and meet in the far corner; then what it holds comes up,
 * and the `corner` line in its top right settles out of a scramble of rule glyphs.
 *
 * It keeps no clock of its own: the plate's (TypingPlate) says how far the rule has run, `t` ms
 * since it set off, through `handle`. The rule is written straight into its lines, never
 * through React, so drawing it costs a few text nodes a frame and nothing else.
 */
export default function AsciiBox({ corner, handle, children }: { corner?: string; handle?: Ref<BoxHandle>; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const boxEl = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const top = useRef<HTMLDivElement>(null), foot = useRef<HTMLDivElement>(null);
  const left = useRef<HTMLDivElement>(null), right = useRef<HTMLDivElement>(null);
  const cornerEl = useRef<HTMLSpanElement>(null);
  const [grid, setGrid] = useState({ cols: 0, rows: 0, ch: 0 });
  // what was last written, so a frame that moves nothing writes nothing
  const at = useRef({ t: NaN, run: -1, settle: -1, cols: 0, rows: 0 });

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

  const { cols, rows } = grid;
  /** the rule as it stands `t` ms after it set off (Infinity: all of it) */
  const draw = (t: number) => {
    const A = at.current;
    A.t = t;
    if (!cols) return;
    const run = Math.round(ease(Math.max(0, Math.min(1, t / RULE_MS))) * (cols + rows));   // how far each run has got, in characters
    const settle = Math.max(0, Math.min(1, (t - SETTLE_AT) / SETTLE_MS));
    const regrid = A.cols !== cols || A.rows !== rows;
    if (regrid || run !== A.run) {
      const rule = (isTop: boolean) => {
        let s = "";
        for (let j = 0; j < cols; j++) s += (isTop ? j < run : rows + j < run) ? (j === 0 || j === cols - 1 ? "+" : j % 2 ? "-" : " ") : " ";
        return s;
      };
      const side = (isRight: boolean) => Array.from({ length: rows }, (_, r) => ((isRight ? cols + r : r + 1) < run ? ":" : " ")).join("\n");
      top.current!.textContent = rule(true);
      foot.current!.textContent = rule(false);
      left.current!.textContent = side(false);
      right.current!.textContent = side(true);
    }
    // the corner line: each letter a rule glyph until its turn comes
    if (corner && cornerEl.current && (regrid || settle !== A.settle)) {
      cornerEl.current.textContent = [...corner].map((c, i, all) => (c === " " || settle * all.length > i ? c : settle > 0 ? GLYPHS[(i * 7 + Math.floor(settle * 40)) % GLYPHS.length] : " ")).join("");
    }
    const drawn = run >= cols + rows && settle >= 1;
    if (drawn !== (boxEl.current!.dataset.drawn === "true")) {
      if (drawn) boxEl.current!.dataset.drawn = "true";
      else delete boxEl.current!.dataset.drawn;
    }
    Object.assign(A, { run, settle, cols, rows });
  };
  useImperativeHandle(handle, () => ({ draw }));
  // a new grid (the box was resized) is written again where the rule had got to
  useLayoutEffect(() => draw(Number.isNaN(at.current.t) ? 0 : at.current.t));

  return (
    <div ref={outer} className={styles.note}>
      <span ref={probe} className={styles.probe} aria-hidden>
        0000000000
      </span>
      <div ref={boxEl} className={styles.box} style={cols ? { width: cols * grid.ch } : undefined} data-ready={cols > 0}>
        <div ref={top} className={styles.rule} aria-hidden />
        <div className={styles.boxMid}>
          <div ref={left} className={styles.side} aria-hidden />
          <div ref={body} className={styles.boxBody}>
            {corner && (
              <p className={styles.corner}>
                <span className={styles.sr}>{corner}</span>
                <span ref={cornerEl} aria-hidden />
              </p>
            )}
            {children}
          </div>
          <div ref={right} className={styles.side} aria-hidden />
        </div>
        <div ref={foot} className={styles.rule} aria-hidden />
      </div>
    </div>
  );
}
