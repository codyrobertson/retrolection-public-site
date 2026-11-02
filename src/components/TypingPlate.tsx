"use client";

import Link from "next/link";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPool, STALE } from "@/lib/typing/pool";
import { DEFAULTS } from "@/lib/typing/scene";
import { markRows, markTyped, stampFor, touch, visit } from "@/lib/typing/session";
import { markFade, unmarkFade, watchFade } from "@/lib/theme-fade";
import { HERO, linesOf, shortcodeOf, stampOf } from "@/lib/typing/text";
import { PASTE } from "@/lib/typing/scene";
import AsciiBox from "./AsciiBox";
import { BOARD_EVENT, TYPE_EVENT } from "./SiteNav";
import TunePanel, { loadTuned, type Metric, type Params } from "./TunePanel";
import WorkIndex, { FULL, type WorkItem } from "./WorkIndex";
import styles from "./typing.module.css";

// Plate 01. Nothing here is pre-rendered: the hands are solved and drawn in workers while
// the page plays, and the ?tune panel drives the same renderer. Poses change 24 times a
// second; where the board and the hands sit is eased between them on every display frame.

const KB_W1 = 1021;                        // the board's drawn width in panel px at X = 1 (layout.keyboardRect)
const KB_ASPECT = 485 / 1021;              // ...and its height over its width

type Layer = { x: number; y: number; w: number; h: number; bitmap: ImageBitmap };
type Frame = {
  R: string | null; L: string | null;     // pose recipes; null: that hand is not in the picture
  offR: [number, number]; offL: [number, number];
  hR: number; hL: number;                  // mm the hand is off the keys, for its shadow
  kb: [number, number];                    // where the board has been pushed, panel px
  typed: number | null; pressed: number[]; clunk?: string; clunkShift?: string;
  glideR?: boolean; glideL?: boolean;      // a loose hand, eased between frames; others hold their frame
  boil: number;                            // the hands' noise field: on twos, on fours while typing
};
type Sched = { fps: number; frames: Frame[]; intro: number; loop: [number, number]; exit: Frame[] };
// the hands typing what the reader typed (fresh starts the line over), or a line of the index (row)
type Live = { frames: Frame[]; text: string; fresh?: boolean; row?: string };
type Layout = { PW: number; PH: number; XM: number; pxPerMm: number; keyboardRect: { x: number; y: number; w: number; h: number } };
type Check = { worst: { mm: number; frame: number }; under: number; total: number };
type Place = { k: number; W: number; H: number; x: number; y: number };

const boardBoilOf = (i: number) => Math.floor(i / 4) % 3;     // the board, slower: it is still, and should read so
// the board boils with the hands: each frame wants the board, its held keys and its hands, on the same field
const layersOf = (fr: Frame, i: number): [string, Record<string, unknown>][] => [
  ["keyboard", { boil: boardBoilOf(i) }],
  ...fr.pressed.map((id): [string, Record<string, unknown>] => ["patch", { id, boil: boardBoilOf(i) }]),
  ...(["L", "R"] as const).flatMap((side): [string, Record<string, unknown>][] =>
    fr[side] ? [["hand", { side, spec: fr[side], boil: fr.boil }]] : []),
];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const samePt = (p: [number, number], q: [number, number]) => p[0] === q[0] && p[1] === q[1];
/** a frame eased toward `nx` draws the same pixels for every `a` when nothing between them moves: key it once */
const frameKey = (pre: string, i: number, fr: Frame, nx: Frame, a: number, size: string, digits: number) =>
  samePt(fr.kb, nx.kb) && (!fr.glideL || !nx.L || samePt(fr.offL, nx.offL)) && (!fr.glideR || !nx.R || samePt(fr.offR, nx.offR))
    ? `${pre}${i}:s:${size}` : `${pre}${i}:${a.toFixed(digits)}:${size}`;
const smoothstep = (t: number) => t * t * (3 - 2 * t);

// the phone layout: the same query as typing.module.css, so the stage and the box never
// disagree (the plate's width is short of the viewport's by a classic scrollbar)
const PHONE = "(max-width: 720px) and (orientation: portrait)";

/** the board on the page (the box above it is as wide): large, near half the stage's height,
 * and smaller only where the box leaves it no room at all (`room`: px from the box's foot down).
 * A phone gets the hands' half of it, past its sides, for the drawing's small details. */
const boardCss = (w: number, h: number, room = h, phone = false) => {
  if (phone) return w * 1.85;
  const big = Math.min(w - 64, 980, (h * 0.46) / KB_ASPECT), fit = (room - 20 - h * 0.05) / KB_ASPECT;
  return Math.min(big, Math.max(fit, 560));
};
/** where the panel sits in the stage canvas, and at what scale: the board's front edge a fifth
 * of the way up, so the hands that push it are in the picture, or lower where the box needs
 * the room (on a phone, its rim just under the box's foot: no keys under the box, no paper
 * between); and never so high that the foot of the hands' sheet (where the forearms trail
 * off) shows above the stage's bottom */
function placeOf(L: Layout, w: number, h: number, room: number, bw: number, phone: boolean): Place {
  const k = L.keyboardRect.w / bw, W = Math.round(w * k), H = Math.round(h * k);
  const ax = phone ? L.XM : L.keyboardRect.x + L.keyboardRect.w / 2;
  const front = phone ? h - room - 6 + bw * KB_ASPECT : Math.min(h * 0.95, Math.max(h * 0.8, h - room + 20 + bw * KB_ASPECT));
  const y = Math.max(front * k - (L.keyboardRect.y + L.keyboardRect.h), H - L.PH);
  return { k, W, H, x: Math.round(W / 2 - ax), y: Math.round(y) };
}

/** graphite for a cast shadow: a light tone under close diagonal hatching */
function hatch() {
  const c = document.createElement("canvas");
  c.width = c.height = 12;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(26,25,23,0.32)";
  g.fillRect(0, 0, 12, 12);
  g.strokeStyle = "rgba(26,25,23,0.85)";
  g.lineWidth = 0.9;
  for (const o of [-12, -6, 0, 6, 12]) { g.beginPath(); g.moveTo(o, 12); g.lineTo(o + 12, 0); g.stroke(); }
  return c;
}
const noop = () => () => {};
const keyOf = (type: string, req: Record<string, unknown>) => type + JSON.stringify(req);

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

export type Hero = { eyebrow?: string; heading: string; subheading?: string; links?: { label: string; href: string }[] };

const stampOnce = () => stampFor(stampOf);
const typedBefore = () => visit()?.phase === "typed";
const SAID_MAX = 40;                     // the reader's line keeps its last this many characters
const EXIT_MS = 1700;                      // the hands taking the board away, or bringing it back
const LIGHTS_MS = 900;                     // the page going dark (or light): globals.css --theme-time

/**
 * The lights. Once the hands have taken the board away under the work, the page goes dark for
 * what comes after it (the experience, the contact form); as they bring it back, it comes up
 * again before the board is in sight. Colours move together only while it changes
 * (html[data-theme-moving]), and only in what is on screen (theme-fade).
 */
let lightsTimer = 0;
/** night is only over the ledger: once the contact plate (light stock) is up to mid-window, the
 * lights come back on for it and the foot. A little either side of the middle, so it never dithers. */
function dawn() {
  const top = document.getElementById("contact")?.getBoundingClientRect().top;
  if (top === undefined) return false;
  return top < innerHeight * (document.documentElement.dataset.theme === "light" ? 0.55 : 0.45);
}
function lights(theme: "light" | "dark", instant = false) {
  const el = document.documentElement;
  if (el.dataset.theme === theme) return;
  window.clearTimeout(lightsTimer);
  if (instant) { el.removeAttribute("data-theme-moving"); unmarkFade(); }
  else {
    markFade();
    el.setAttribute("data-theme-moving", "");
    lightsTimer = window.setTimeout(() => { el.removeAttribute("data-theme-moving"); unmarkFade(); }, LIGHTS_MS + 60);
  }
  el.dataset.theme = theme;
}

/**
 * What the plate has drawn outlives the plate. Back from another page, the board, the hands'
 * loop and their way out are already there (the performance picks up where it was), and the
 * workers that drew them are let go only once the reader has been away a while.
 */
type Pool = ReturnType<typeof createPool>;
const SHARED = {
  pool: null as Pool | null, poolFor: "", bye: 0,
  done: new Map<string, Layer>(), key: "", played: "", frame: 0,
  sched: null as Sched | null, layout: null as Layout | null,
};
const LINGER_MS = 20_000;
// how far ahead of the frame on screen the opening is drawn: the rest waits its turn, and what
// has played is let go, so the opening never holds all of its drawings at once
const AHEAD = 48;
/** keep a few cores for the page itself */
const workerCount = () => Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));

/** a drawing nothing still to come needs: its memory back, and drawn again if it is ever asked for */
function release(key: string) {
  const l = SHARED.done.get(key);
  if (!l) return;
  SHARED.done.delete(key);
  l.bitmap.close();
  const at = key.indexOf("{");
  SHARED.pool?.forget(key.slice(0, at), JSON.parse(key.slice(at)));
}
const NO_ROWS: string[] = [];
const rowsBefore = () => visit()?.rows ?? NO_ROWS;

/** for a schedule: what is kept once drawn (the loop, the way out) and when the opening last needs the rest */
type Plan = { keep: Set<string>; last: Map<string, number> };
const plans = new WeakMap<Sched, Plan>();
function planOf(s: Sched): Plan {
  let p = plans.get(s);
  if (p) return p;
  const keep = new Set<string>(), last = new Map<string, number>(), loop0 = s.loop[0];
  s.frames.forEach((fr, i) => layersOf(fr, i).forEach(([t, r]) => (i >= loop0 ? keep.add(keyOf(t, r)) : last.set(keyOf(t, r), i))));
  s.exit.forEach((fr, j) => layersOf(fr, j).forEach(([t, r]) => keep.add(keyOf(t, r))));
  for (const k of keep) last.delete(k);
  plans.set(s, (p = { keep, last }));
  return p;
}

/** a line of the box, `n` letters of it down and the caret where the next lands (if it is the caret's line) */
const TypedLine = memo(function TypedLine({ text, n, caret }: { text: string; n: number; caret: boolean }) {
  const chars = [...text];
  return (
    <span aria-hidden>
      {chars.map((ch, j) => (
        <Fragment key={j}>
          {caret && n === j && <span className={styles.caret} />}
          <span className={styles.char} data-on={j < n}>{ch}</span>
        </Fragment>
      ))}
      {caret && n >= chars.length && <span className={styles.caret} />}
    </span>
  );
});

export default function TypingPlate({ hero = HERO, work = [], more = work.length }: { hero?: Hero; work?: WorkItem[]; more?: number }) {
  // the dateline is the reader's own day and time: set once the page is in their hands, and
  // held, so the performance is not rebuilt when the minute turns
  const stamp = useSyncExternalStore(noop, stampOnce, () => "");
  const lines: string[] = linesOf(hero, stamp), text = lines.join("\n");
  const sub = hero.subheading ?? "";
  const reduced = usePrefersReducedMotion();
  const [typed0, setTyped] = useState(0);
  // typed out once this visit, it stays typed: the board picks up its loop, the sheet is all there
  const resumed = useSyncExternalStore(noop, typedBefore, () => false);
  // with reduced motion nothing is typed: it is all there, whatever frame the board shows
  const typed = reduced || resumed ? text.length : typed0;
  // ?tune opens the panel, with whatever was last tuned on this machine
  const tune = useSyncExternalStore(noop, () => new URLSearchParams(window.location.search).has("tune"), () => false);
  const saved = useMemo(() => (tune ? loadTuned() : null), [tune]);
  const [edited, setParams] = useState<Params | null>(null);
  const params = edited ?? saved ?? (DEFAULTS as Params);
  const [X, setX] = useState(0);
  const [ready, setReady] = useState(false);
  const [said, setSaid] = useState("");                     // what the hands have typed for the reader
  const [rows, setRows] = useState<Record<string, number>>({}); // how much of each line of the index is on the sheet
  // ...and the lines typed earlier this visit, there whole from the start
  const seenRows = useSyncExternalStore(noop, rowsBefore, () => NO_ROWS);
  const sheetRows = useMemo(() => {
    if (!seenRows.length) return rows;
    const n = { ...rows };
    for (const id of seenRows) n[id] = FULL;
    return n;
  }, [rows, seenRows]);
  const [playChoice, setPlaying] = useState<boolean | null>(null);
  const playing = playChoice ?? !tune;
  const [metrics, setMetrics] = useState<Metric[] | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState(false);

  const sceneRef = useRef<HTMLDivElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pool = useRef<Pool | null>(null);
  const done = useRef(SHARED.done);
  const sched = useRef<Sched | null>(null);
  // the last scene's layers, let go once the new one is on screen
  const retired = useRef<Layer[]>([]);
  /** where the drawing on the desk starts, CSS px down it (as last painted): what follows the sheet is cut there */
  const inkTop = useRef(0);
  const layout = useRef<Layout | null>(null);
  const stage = useRef({ w: 0, h: 0, room: 0, phone: false, bw: 0, lh: 18, platen: 0 });
  const played = useRef("");                // the scene the performance is under way in, to pick it up again
  const frameIdx = useRef(0);
  const playingRef = useRef(false);
  // the reader's keys: waiting to be scheduled, scheduled and waiting their turn, being typed
  const live = useRef({ pending: "", asking: false, queue: [] as Live[], cur: null as (Live & { i: number; shown: number }) | null, said: "", open: false, fresh: false, label: "", gen: 0 });
  const shade = useRef<{ pattern: CanvasPattern | null; cache: WeakMap<Layer, { c: HTMLCanvasElement; m: number }> }>({ pattern: null, cache: new WeakMap() });
  const reducedRef = useRef(false);
  const handsDoneRef = useRef(false);
  useEffect(() => { playingRef.current = playing && !reduced; reducedRef.current = reduced; }, [playing, reduced]);

  // the sheet in ink: a GL layer of its own riding in the box (ink-gl.js startLiveInk), so the
  // letters the hands put down are ballpoint as the rest of the page is; started after first
  // paint, as the page's layers are (Surface)
  useEffect(() => {
    const note = sceneRef.current?.querySelector<HTMLElement>(`.${styles.note}`);
    if (!note) return;
    let layer: { destroy: () => void } | undefined, dead = false;
    const go = () => import("@/lib/ink-gl").then((m) => { if (!dead) layer = m.startLiveInk(note, "ink-sheet-gl"); });
    const idle = typeof window.requestIdleCallback === "function";
    const id = idle ? window.requestIdleCallback(go, { timeout: 400 }) : window.setTimeout(go, 50);
    return () => { dead = true; if (idle) window.cancelIdleCallback(id); else window.clearTimeout(id); layer?.destroy(); };
  }, []);

  useEffect(() => {
    window.clearTimeout(SHARED.bye);
    SHARED.pool ||= createPool(workerCount());
    pool.current = SHARED.pool;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __typing: unknown }).__typing = { pool: pool.current, get done() { return SHARED.done; } };
    return () => {
      const s = sched.current;
      SHARED.frame = frameIdx.current;
      SHARED.pool?.drop();
      pool.current = null;
      // the opening's drawings go with the plate; the board, the loop and the way out wait for the reader
      if (s) { const { keep } = planOf(s); for (const k of [...SHARED.done.keys()]) if (!keep.has(k)) release(k); }
      SHARED.bye = window.setTimeout(() => { SHARED.pool?.dispose(); SHARED.pool = null; SHARED.poolFor = ""; }, LINGER_MS);
    };
  }, []);

  // The desk (the plate) is pinned over the sheet, which scrolls as any page does. The platen is
  // the hero's foot as the page opens: the sheet goes into the machine there, and the board has
  // the room under it. Resolution follows the stage: device px across the board, capped where
  // drawing gets slow. Measured before the first paint (and again on a return to the page), not
  // a frame later from the observer: what follows the sheet is laid out against it.
  useLayoutEffect(() => {
    const el = plateRef.current, scene = sceneRef.current;
    if (!el || !scene) return;
    const box = scene.querySelector<HTMLElement>(`.${styles.note}`), ruled = box?.querySelector<HTMLElement>(`.${styles.box}`);
    const platen = scene.querySelector<HTMLElement>(`.${styles.platen}`);
    const measure = () => {
      const w = el.clientWidth, h = el.clientHeight, phone = window.matchMedia(PHONE).matches;
      // where the platen is on the desk: as far down the scene as the hero's foot (the desk's
      // top is the scene's until it pins, and the two move together until then)
      const at = platen ? platen.getBoundingClientRect().bottom - scene.getBoundingClientRect().top : h / 2;
      const room = Math.max(0, h - at);
      // The box is as wide as the board under it, and the board gives way to the box (it fits in
      // the room the box leaves). The box's type is sized off its width and its rows are whole
      // lines, so a wider box can stand a line taller and take back the room it was widened
      // for: it narrows at once, but widens only by more than a row of room is worth of board,
      // or the two would take turns for ever. Nor while the rule is still being counted out to
      // the last width: its type is sized for that width and set in the old, and stands taller.
      let bw = boardCss(w, h, room, phone);
      if (!phone) {
        const was = parseFloat(scene.style.getPropertyValue("--kbw")) || 0, kbw = Math.round(Math.min(bw, w - 32));
        const settled = !was || !box || !ruled || Math.abs(ruled.offsetWidth - box.clientWidth) < 12;
        if (settled && (kbw < was - 2 || kbw > was + 40)) {
          scene.style.setProperty("--kbw", `${kbw}px`);
          bw = kbw;
        } else bw = was;
      } else scene.style.removeProperty("--kbw");
      scene.style.setProperty("--room", `${Math.round(room)}px`);
      // what comes after the sheet on the page is set to its measure (Experience, Contact)
      if (ruled?.offsetWidth) document.documentElement.style.setProperty("--sheet", `${ruled.offsetWidth}px`);
      // the desk pins its platen where it can, and what is under it in the window is what the
      // sheet's foot has to come up through (less than the room, where the board is cropped)
      scene.style.setProperty("--at", `${Math.round(at)}px`);
      const top = parseFloat(getComputedStyle(el).top) || 0;
      scene.style.setProperty("--below", `${Math.round(Math.max(0, Math.min(room, innerHeight - top - at)))}px`);
      // that room is the board's to go through, not the page's: what follows the sheet (Experience)
      // is drawn up into it, and comes out from under the board as the hands take it away
      document.documentElement.style.setProperty("--tail", getComputedStyle(scene).paddingBottom);
      const lh = parseFloat(getComputedStyle(box ?? el).lineHeight) || 18;
      stage.current = { w, h, room, phone, bw, lh, platen: at };
      const dpr = window.devicePixelRatio || 1;
      const next = Math.min(1.35, Math.max(0.45, Math.round(((bw * dpr) / KB_W1) * 20) / 20));
      setX((x) => (Math.abs(next - x) >= 0.1 ? next : x));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (box) ro.observe(box);
    if (ruled) ro.observe(ruled);
    // a short window holds the desk at its least height and pins it higher (its `top`), which
    // moves with the window's height while the desk's size does not
    window.addEventListener("resize", measure);
    measure();
    return () => {
      ro.disconnect(); window.removeEventListener("resize", measure);
      const next = scene.nextElementSibling as HTMLElement | null;
      if (next) next.style.clipPath = "";
    };
  }, []);

  /** ask for a layer; it lands in `done` when drawn */
  const want = useCallback((type: string, req: Record<string, unknown>, pri: number) => {
    const key = keyOf(type, req);
    if (done.current.has(key) || !pool.current) return;
    pool.current.get(type, req, pri).then(
      (out: Layer) => {
        done.current.set(key, out);
        if (!pool.current && !(sched.current && planOf(sched.current).keep.has(key))) release(key);
      },
      (err: unknown) => { if ((err as Error)?.message !== STALE.message) console.error(err); },
    );
  }, []);
  /** the frames about to play from `at` (the loop after the opening, round and round), then the
   * way out (a reader may scroll on at any moment), then the rest of the loop: the opening's
   * later frames are asked for as it gets to them (advance) */
  const prime = useCallback((s: Sched, at = 0) => {
    const N = s.frames.length, loop0 = s.loop[0], idx = (i: number) => (i < N ? i : loop0 + ((i - N) % (N - loop0)));
    for (let k = 0; k < AHEAD; k++) { const i = idx(at + k); layersOf(s.frames[i], i).forEach(([ty, r]) => want(ty, r, k)); }
    s.exit.forEach((fr, j) => layersOf(fr, j).forEach(([ty, r]) => want(ty, r, AHEAD + j)));
    for (let i = loop0; i < N; i++) layersOf(s.frames[i], i).forEach(([ty, r]) => want(ty, r, AHEAD + s.exit.length + i - loop0));
  }, [want]);
  /** the opening has moved on a frame: one more frame into the window, and the one that played let go */
  const advance = useCallback((s: Sched, from: number, to: number) => {
    const loop0 = s.loop[0], j = to + AHEAD - 1;
    if (to < loop0 && j < s.frames.length) layersOf(s.frames[j], j).forEach(([ty, r]) => want(ty, r, AHEAD - 1));
    if (from < loop0 && to > from) {
      const { last } = planOf(s);
      layersOf(s.frames[from], from).forEach(([ty, r]) => { const k = keyOf(ty, r); if (last.get(k) === from) release(k); });
    }
  }, [want]);

  const isReady = useCallback((fr: Frame, i: number) => layersOf(fr, i).every(([t, r]) => done.current.has(keyOf(t, r))), []);

  /** a hand's shadow, made once per drawing: blurred, hatched, faint */
  const shadowOf = useCallback((l: Layer, h: number, k: number) => {
    const S = shade.current, hit = S.cache.get(l);
    if (hit) return hit;
    const blur = k * (1.1 + 0.32 * h), m = Math.ceil(blur * 3);
    const c = document.createElement("canvas");
    c.width = l.w + 2 * m;
    c.height = l.h + 2 * m;
    const g = c.getContext("2d")!;
    S.pattern ||= g.createPattern(hatch(), "repeat");
    g.filter = `blur(${blur.toFixed(1)}px)`;
    g.drawImage(l.bitmap, m, m);
    g.filter = "none";
    g.globalCompositeOperation = "source-in";
    g.fillStyle = S.pattern!;
    g.fillRect(0, 0, c.width, c.height);
    const out = { c, m };
    S.cache.set(l, out);
    return out;
  }, []);

  /** frame `fr`'s drawings, placed part way (`a`) toward where `nx` puts them */
  const paint = useCallback((fr: Frame, nx: Frame, a: number, i: number) => {
    const canvas = canvasRef.current, L = layout.current, { w, h, room, bw, phone } = stage.current;
    if (!canvas || !L || !w || !isReady(fr, i)) return false;
    const board = done.current.get(keyOf("keyboard", { boil: boardBoilOf(i) }))!;
    const P = placeOf(L, w, h, room, bw, phone);
    // a new scene swaps in whole, on its first complete frame: no flash while tuning
    if (canvas.width !== P.W || canvas.height !== P.H) { canvas.width = P.W; canvas.height = P.H; }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, P.W, P.H);
    ctx.translate(P.x, P.y);
    const at = (p: [number, number], q: [number, number]): [number, number] => [lerp(p[0], q[0], a), lerp(p[1], q[1], a)];
    const [bx, by] = at(fr.kb, nx.kb);
    ctx.drawImage(board.bitmap, board.x + bx, board.y + by);
    for (const id of fr.pressed) { const l = done.current.get(keyOf("patch", { id, boil: boardBoilOf(i) }))!; ctx.drawImage(l.bitmap, l.x + bx, l.y + by); }
    const hands = (["L", "R"] as const).flatMap((side) => {
      const spec = fr[side];
      if (!spec) return [];
      const l = done.current.get(keyOf("hand", { side, spec, boil: fr.boil }))!;
      const off = side === "L" ? fr.offL : fr.offR, glide = side === "L" ? fr.glideL : fr.glideR;
      const offN = glide && nx[side] ? (side === "L" ? nx.offL : nx.offR) : off;
      return [{ l, off: at(off, offN), h: side === "L" ? fr.hL : fr.hR }];
    });
    // Both shadows before either hand: the light is high and behind the board, so a hand
    // throws its shadow toward the typist, tight and dark at the keys, wide and faint above them.
    if ("filter" in ctx) {
      const k = L.pxPerMm;
      for (const { l, off, h: hh } of hands) {
        const { c, m } = shadowOf(l, hh, k);
        ctx.globalAlpha = 0.42 / (1 + hh * 0.05);
        ctx.drawImage(c, l.x + off[0] - m + k * (0.5 + 0.18 * hh), l.y + off[1] - m + k * (1.4 + 0.55 * hh));
        ctx.globalAlpha = 1;
      }
    }
    for (const { l, off } of hands) ctx.drawImage(l.bitmap, l.x + off[0], l.y + off[1]);
    // the top of what is drawn (board or hands, with a hand's shadow above it), in px down the desk
    const top = Math.min(board.y + by, ...hands.map(({ l, off }) => l.y + off[1])) - L.pxPerMm * 2;
    inkTop.current = ((P.y + top) * canvas.clientHeight) / P.H;
    if (retired.current.length && !retired.current.includes(board)) {
      for (const l of retired.current) l.bitmap.close();
      retired.current = [];
    }
    return true;
  }, [isReady, shadowOf]);

  /** a performance frame has come up: how much of the heading it has typed */
  const arrive = useCallback((fr: Frame) => {
    if (fr.typed !== null) setTyped(fr.typed);
  }, []);

  // a scene for these parameters at this resolution, then everything it will need, in order
  useEffect(() => {
    const P = pool.current;
    if (!P || !X || !stamp) return;
    let alive = true;
    const run = async () => {
      setBusy(true);
      setMetrics(null);
      setCheck(null);
      const id = text + JSON.stringify(params), key = `${id}@${X}`, same = SHARED.key === key && !!SHARED.sched && !!SHARED.layout;
      if (!same) {
        retired.current.push(...done.current.values());
        done.current = SHARED.done = new Map();
      }
      try {
        // the scene this plate was showing before it went (another page, and back): its
        // drawings are still here; only fresh workers need telling what they are drawing
        let L = same ? SHARED.layout! : null;
        if (!same || SHARED.poolFor !== key) {
          L = (await P.configure({ ...params, X })).layout;
          SHARED.poolFor = key;
        }
        [0, 1, 2].forEach((boil) => want("keyboard", { boil }, -2));
        const s: Sched = same ? SHARED.sched! : await P.get("schedule", { text }, -3);
        if (!alive) return;
        sched.current = SHARED.sched = s;
        layout.current = SHARED.layout = L!;
        SHARED.key = key;
        setReady(true);
        // the same scene at a new resolution (the window was resized), or back from another page,
        // picks the performance up where it was, rather than typing it all again from the top;
        // a plate typed out this visit starts in its loop
        const still = s.loop[0], N = s.frames.length;
        const was = played.current === id ? frameIdx.current : SHARED.played === id ? SHARED.frame : 0;
        const at = typedBefore() ? Math.max(still, Math.min(was, N - 1)) : Math.min(was, N - 1);
        played.current = SHARED.played = id;
        if (playingRef.current) prime(s, at);
        else layersOf(s.frames[still], still).forEach(([ty, r]) => want(ty, r, -1));
        frameIdx.current = playingRef.current ? at : still;
        // ...and the reader's keys in hand, drawn again for it
        for (const lv of [live.current.cur, ...live.current.queue]) lv?.frames.forEach((fr, j) => layersOf(fr, j).forEach(([ty, r]) => want(ty, r, -4)));
        if (tune) {
          P.get("metrics", {}, -1).then((m: Metric[]) => alive && setMetrics(m), () => {});
          P.get("check", { text }, 1e6).then((c: Check) => alive && setCheck(c), () => {});
        }
      } catch (err) {
        if ((err as Error)?.message !== STALE.message) console.error(err);
      } finally {
        if (alive) setBusy(false);
      }
    };
    // a microtask, not a timer: the workers start on the scene in the same turn as the layout
    const t = tune ? window.setTimeout(run, 60) : 0;
    if (!tune) queueMicrotask(() => { if (alive) void run(); });
    return () => { alive = false; window.clearTimeout(t); };
  }, [params, X, tune, want, prime, text, stamp]);

  // play from the top when asked to (the ?tune panel's play): on the click, not in an effect,
  // which would run again on every return to the page and send the opening back to its start
  const togglePlay = () => {
    const s = sched.current;
    if (!playing && s && !reduced) { prime(s); frameIdx.current = 0; }
    setPlaying(!playing);
  };

  // The clock: poses at the schedule's rate; a pose that is not drawn yet is held, never
  // skipped; between poses, positions are eased on every display frame. The sheet scrolls as
  // a page does: each line of the index is typed as it comes up past the platen, and once the
  // sheet's foot is past it, the hands take the board away (and bring it back if the reader
  // scrolls back down to it), on their own time, not the scroll's.
  //
  // Coming in (a load, a link from another page, a return to this one) the first look is taken
  // before anything is painted: the board is where the scroll puts it and the lights are already
  // right, with nothing animated to get there; and a reader who came in past the hero has it typed.
  useLayoutEffect(() => {
    let raf = 0, last = performance.now(), acc = 0, shown = "", exiting = false, resume = 0, q = 0, away = false, told = "", seenAt = "";
    let first = true, entered = false;
    // the lines of the index that have come up past the platen (this visit: typed once, they stay)
    const up = new Set<string>(rowsBefore());
    const Lv = live.current;
    // what the reader's keys and the index's lines had drawn: let go once nothing is waiting to type
    const liveKeys = new Set<string>();
    const letLiveGo = () => {
      const s = sched.current;
      if (!s || Lv.cur || Lv.queue.length || Lv.asking) return;
      const { keep } = planOf(s);
      for (const k of liveKeys) if (!keep.has(k)) release(k);
      liveKeys.clear();
    };
    const wantLive = (frames: Frame[]) => frames.forEach((fr, j) => layersOf(fr, j).forEach(([ty, r]) => { liveKeys.add(keyOf(ty, r)); want(ty, r, -4); }));
    const whole = (row?: string) => { if (row) { setRows((m) => ({ ...m, [row]: FULL })); markRows([row]); } };
    /** the hands' strokes for `text` asked for; typed, in turn, from the loop */
    const ask = (text: string, extra: Partial<Live>) => {
      Lv.asking = true;
      const g = Lv.gen;
      pool.current!.get("schedule", { text, live: true }, -5).then((ls: { frames: Frame[] }) => {
        // the board went (or the line was wiped) while these were asked for: a line of the index is there whole
        if (!Lv.open || g !== Lv.gen) { whole(extra.row); return; }
        wantLive(ls.frames);
        Lv.queue.push({ frames: ls.frames, text, ...extra });
      }, () => {}).finally(() => { Lv.asking = false; });
    };
    /** the sheet's foot went past the platen, by scrolling or by a jump (a link to the contact form) */
    const goAway = () => {
      if (!away) away = true;
    };
    /** the reader came in past the hero (a link down the page, a return scrolled down it): it is typed */
    const skipped = () => {
      if (handsDoneRef.current || reducedRef.current) return;
      markTyped();
      setTyped(Number.MAX_SAFE_INTEGER);
      const s = sched.current;
      if (s) frameIdx.current = Math.max(s.loop[0], frameIdx.current);
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const s = sched.current, scene = sceneRef.current, plate = plateRef.current, dt = Math.min(64, now - last);
      const instant = first;
      first = false;
      // read, not observed: the first look comes before any observer has said where the desk is
      const sr = scene?.getBoundingClientRect();
      if (!scene || !plate || !sr || sr.bottom <= 0 || sr.top >= innerHeight) {
        // far down the page (the desk out of sight above), it is night whatever the clock missed,
        // and the board is away: back up to it, the hands bring it back as they would from a scroll
        if (sr && sr.bottom <= 0) {
          lights(dawn() ? "light" : "dark", instant);
          const next = scene!.nextElementSibling as HTMLElement | null;
          if (next?.style.clipPath) next.style.clipPath = "";
          if (instant) skipped();
          if (!reducedRef.current) {
            goAway(); q = 1;
            if (told !== "away") { told = "away"; document.documentElement.dataset.board = "away"; window.dispatchEvent(new CustomEvent(BOARD_EVENT, { detail: true })); }
          }
        }
        last = now;
        return;
      }
      const st = stage.current, still = reducedRef.current;
      const platenY = plate.getBoundingClientRect().top + st.platen;
      const note = scene.querySelector<HTMLElement>(`.${styles.note}`), foot = note ? note.getBoundingClientRect().bottom : 0;
      // what follows the sheet, read with the rest before anything is written this frame
      const next = scene.nextElementSibling as HTMLElement | null, nextBox = next?.getBoundingClientRect(), day = dawn();

      // the lines come up past the platen: the newest is typed, if the hands are free; any others
      // that came up with it (a quick scroll) are simply there, as the bio is pasted. Looked for
      // only when the sheet has moved (a scroll, a resize, a tab of the index), not every frame.
      const at = `${Math.round(platenY)}:${Math.round(foot)}`;
      if (!still && at !== seenAt) {
        seenAt = at;
        const fresh: string[] = [];
        for (const r of scene.querySelectorAll<HTMLElement>("[data-row]")) {
          const id = r.dataset.row!;
          if (!up.has(id) && r.getBoundingClientRect().bottom < platenY + 1) { up.add(id); fresh.push(id); }
        }
        if (fresh.length) {
          const free = !!s && !!pool.current && playingRef.current && handsDoneRef.current && q === 0 && !Lv.cur && !Lv.queue.length && !Lv.asking && !Lv.pending;
          const typing = free ? fresh[fresh.length - 1] : null;
          setRows((m) => { const n = { ...m }; for (const id of fresh) n[id] = id === typing ? 0 : FULL; return n; });
          markRows(fresh.filter((id) => id !== typing));
          if (typing) {
            const label = scene.querySelector<HTMLElement>(`[data-row="${typing}"]`)?.dataset.label ?? "";
            ask(label.slice(0, 16), { row: typing });
          }
        }
      }

      // the way out, keyed to the sheet's foot: past the platen, and the board goes; back down
      // under it (by more than a line or two, so it never dithers), and the board comes back
      if (!away && foot < platenY - st.lh * 0.5) away = true;
      else if (away && foot > platenY + st.lh * 2) away = false;
      // the hero gone by on the way in (a link down the page): typed, not played to an empty window
      // (the scroll to a link's #section may come after this look, so the hash says it too)
      if (instant && (away || !!location.hash || (scene.querySelector("h1")?.getBoundingClientRect().bottom ?? 1) < 0)) skipped();
      // until the hands have their schedule, and on the first look with it, the board is where the
      // scroll says rather than on its way there
      if (still) q = 0;
      else if (!s || !entered) q = away ? 1 : 0;
      else q = clamp01(q + ((away ? 1 : -1) * dt) / EXIT_MS);
      if (s) entered = true;
      const gone = q > 0.55 ? "away" : "up";
      if (told !== gone) {
        told = gone;
        document.documentElement.dataset.board = gone;
        window.dispatchEvent(new CustomEvent(BOARD_EVENT, { detail: gone === "away" }));
      }
      if (!away) lights("light", still || instant);
      else if (still || gone === "away") lights(day ? "light" : "dark", still || instant);
      Lv.open = q === 0;
      // Nothing of the sheet shows under the board: it is cut at the board's top edge, which
      // goes down the window with the board as the hands take it away.
      if (note) {
        const edge = platenY + (innerHeight + 40 - platenY) * smoothstep(clamp01((q - 0.12) / 0.6));
        const cut = still || q >= 1 ? 0 : Math.max(0, Math.round(foot - edge));
        const v = cut ? `inset(0 0 ${cut}px 0)` : "";
        if (note.style.clipPath !== v) note.style.clipPath = v;
        // and what follows the sheet, up in the board's room, is under the board until it goes
        if (next && nextBox) {
          const r = nextBox;
          // cut where the drawing starts (the hands stand above the board, and are open graphite)
          const line = Math.min(edge, platenY - st.platen + inkTop.current);
          const off = still || q >= 1 || r.top > innerHeight ? 0 : Math.min(Math.round(r.height), Math.max(0, Math.round(r.bottom - line)));
          const w = off ? `inset(0 0 ${off}px 0)` : "";
          if (next.style.clipPath !== w) next.style.clipPath = w;
        }
      }
      if (!s) { last = now; return; }

      const N = s.frames.length, step = 1000 / s.fps, loop0 = s.loop[0], size = `${st.w}x${st.h}x${st.room}x${st.bw}`;
      if (!playingRef.current) {
        const key = `still${loop0}:${size}`;
        if (shown !== key && paint(s.frames[loop0], s.frames[loop0], 0, loop0)) { shown = key; arrive(s.frames[loop0]); }
        last = now;
        return;
      }
      const canvas = canvasRef.current;
      if (q > 0) {
        if (!exiting) {
          exiting = true; resume = frameIdx.current;
          // what was being typed goes with the board: the reader's line, and any line of the index whole
          whole(Lv.cur?.row); Lv.queue.forEach((lv) => whole(lv.row));
          Lv.pending = ""; Lv.queue = []; Lv.cur = null; Lv.gen++;
          if (Lv.said) { Lv.said = ""; setSaid(""); }
          letLiveGo();
        }
        // the board goes off the foot of the window as drawn; only its last few frames thin out
        if (canvas) { canvas.style.transition = "none"; canvas.style.opacity = String(1 - smoothstep(clamp01((q - 0.88) / 0.12))); }
        const E = s.exit, f = q * (E.length - 1), i0 = Math.floor(f), i1 = Math.min(E.length - 1, i0 + 1), a = f - i0;
        const key = frameKey("x", i0, E[i0], E[i1], a, size, 3);
        if (shown !== key) {
          if (paint(E[i0], E[i1], a, i0)) shown = key;
          else {
            // not drawn yet: wanted before anything else, and meanwhile the nearest that is
            layersOf(E[i0], i0).forEach(([ty, r]) => want(ty, r, -6));
            for (let d = 1; d < 8; d++) {
              const j = [i0 - d, i0 + d].find((jj) => jj >= 0 && jj < E.length && isReady(E[jj], jj));
              if (j !== undefined && paint(E[j], E[j], 0, j)) { shown = `x${j}:0:${size}`; break; }
            }
          }
        }
        last = now;
        return;
      }
      if (exiting) {
        exiting = false; frameIdx.current = resume; acc = 0; shown = "";
        if (canvas) { canvas.style.transition = ""; canvas.style.opacity = ""; }
      }
      // the reader's keys: their strokes asked for a few at a time, then typed from the loop
      // and back into it, each letter landing in the box (or on its line of the index) as its key goes down
      if (Lv.pending && !Lv.asking && pool.current) {
        const chunk = Lv.pending.slice(0, 16), fresh = Lv.fresh;
        Lv.pending = Lv.pending.slice(16);
        Lv.fresh = false;
        ask(chunk, { fresh });
      }
      if (!Lv.cur && Lv.queue.length && frameIdx.current >= loop0) {
        Lv.cur = { ...Lv.queue.shift()!, i: 0, shown: 0 }; acc = 0;
        wantLive(Lv.cur.frames);       // anything let go since it was asked for is asked for again
        if (Lv.cur.fresh) { Lv.said = ""; setSaid(""); }
      }
      acc = Math.min(acc + dt, step * 2);
      last = now;
      if (Lv.cur) {
        const C = Lv.cur, F = C.frames;
        if (acc >= step) {
          if (C.i + 1 >= F.length) { acc -= step; C.i = F.length; }
          else if (isReady(F[C.i + 1], C.i + 1)) { C.i++; acc -= step; }
          else acc = step;
        }
        const n = C.i >= F.length ? C.text.length : F[C.i].typed ?? 0;
        if (n > C.shown) {
          const was = C.shown;
          C.shown = n;
          if (C.row) { const id = C.row; setRows((m) => ({ ...m, [id]: n })); }
          else { Lv.said = (Lv.said + C.text.slice(was, n)).slice(-SAID_MAX); setSaid(Lv.said); }
        }
        if (C.i < F.length) {
          const nx = F[Math.min(F.length - 1, C.i + 1)], a = Math.min(1, acc / step), key = frameKey("live", C.i, F[C.i], nx, a, size, 2);
          if (shown !== key && paint(F[C.i], nx, a, C.i)) shown = key;
          return;
        }
        whole(C.row);
        Lv.cur = null; frameIdx.current = loop0; shown = "";      // the last frame leads into the loop's first
        letLiveGo();
      }
      let i = frameIdx.current;
      if (acc >= step) {
        const next = i + 1 >= N ? loop0 : i + 1;
        if (isReady(s.frames[next], next)) { const from = i; i = frameIdx.current = next; acc -= step; arrive(s.frames[i]); advance(s, from, next); }
        else acc = step;
      }
      const nx = i + 1 >= N ? loop0 : i + 1, a = Math.min(1, acc / step);
      const key = frameKey("", i, s.frames[i], s.frames[nx], a, size, 2);
      if (shown !== key && paint(s.frames[i], s.frames[nx], a, i)) shown = key;
    };
    tick(performance.now());
    const unwatch = watchFade();
    // off the home page the lights are up, and there is no board to be away; what the hands were
    // typing is there whole, and nothing asked for before the reader left is typed when they return
    return () => {
      cancelAnimationFrame(raf); unwatch(); lights("light", true); delete document.documentElement.dataset.board;
      whole(Lv.cur?.row); Lv.queue.forEach((lv) => whole(lv.row));
      Lv.pending = ""; Lv.queue = []; Lv.cur = null; Lv.gen++; Lv.open = false; Lv.label = "";
      if (Lv.said) { Lv.said = ""; setSaid(""); }
    };
  }, [paint, arrive, isReady, want, advance]);

  // The reader's keys, once the hands have typed the heading and while the board is in place:
  // the hands type them too. Not while a field or a control has them, or with a modifier.
  const handsDone = !!stamp && typed >= text.length;
  const listening = handsDone && playing && !reduced;
  useEffect(() => {
    handsDoneRef.current = handsDone;
    // the plate is typed out: so it stays, this visit
    if (handsDone && !reduced) markTyped();
  }, [handsDone, reduced]);
  useEffect(() => {
    const id = window.setInterval(touch, 60_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      const L = live.current, el = e.target as HTMLElement | null;
      if (!L.open || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName))) return;
      if (e.key === "Backspace") {
        e.preventDefault();
        if (L.pending) L.pending = L.pending.slice(0, -1);
        else { L.said = L.said.slice(0, -1); setSaid(L.said); }
      } else if (e.key === "Escape") {
        L.pending = ""; L.said = ""; setSaid(""); L.queue = []; L.gen++;
        if (L.cur) L.cur.shown = L.cur.text.length;
      } else if (e.key.length === 1) {
        if (e.key === " ") e.preventDefault();                 // the space bar types, rather than scrolls, while the board is up
        L.pending = (L.pending + e.key).slice(-SAID_MAX); L.label = "";
      }
    };
    // a masthead link pointed at: the hands type its name over whatever was on the line,
    // once, however often the pointer crosses it while they do
    const onSay = (e: Event) => {
      const L = live.current, label = String((e as CustomEvent).detail ?? "").slice(0, SAID_MAX);
      if (!L.open || !label) return;
      if (label === L.label && (L.pending || L.asking || L.cur || L.queue.length || L.said === label)) return;
      L.label = label; L.pending = label; L.fresh = true; L.queue = []; L.gen++;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(TYPE_EVENT, onSay);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(TYPE_EVENT, onSay); };
  }, [listening]);

  // the line under the heading is pasted: it is there whole the moment V goes down under CTRL
  const pasteAt = text.indexOf(PASTE), pasted = pasteAt >= 0 && typed > pasteAt;

  // every line a letter at a time, the caret where the next one lands
  const starts = lines.map((_, l) => lines.slice(0, l).reduce((n, t) => n + t.length + 1, 0));
  const caretLine = handsDone ? -1 : starts.reduce((at, st, l) => (typed >= st ? l : at), 0);
  // a line's count is held to its own length (and -1 before it begins), so a letter going down
  // draws again only the line it lands in
  const typedLine = (l: number) => {
    const len = lines[l].length;
    return <TypedLine text={lines[l]} n={Math.max(-1, Math.min(len + 1, typed - starts[l]))} caret={l === caretLine} />;
  };
  const head = lines.indexOf(hero.heading);
  /** a link's shortcode: not begun, being typed (its letters so far), or rendered by its Return */
  const shortcode = (ln: { label: string }) => {
    const l = lines.indexOf(shortcodeOf(ln)), st = starts[l], code = lines[l] ?? "";
    if (l < 0 || reduced) return { done: reduced, so: "" };
    return { done: typed > st + code.length, so: typed > st ? code.slice(0, typed - st) : "", caret: caretLine === l };
  };

  return (
    <div ref={sceneRef} className={styles.scene} data-gl-skip>
      {/* the desk: the board and the hands, pinned over the sheet as it scrolls */}
      <div ref={plateRef} className={styles.plate}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          data-ready={ready}
          role="img"
          aria-label="Two graphite hands push a round-key typewriter keyboard into place and type the box above it."
        />
      </div>
      <section className={styles.sheet} aria-labelledby="plate-title">
        <AsciiBox corner={hero.eyebrow} reduced={reduced}>
          <p className={styles.stamp}>
            {stamp ? (<><span className={styles.sr}>{stamp}</span>{typedLine(0)}</>) : "\u00a0"}
          </p>
          <h1 id="plate-title" className={styles.headline}>
            <span className={styles.sr}>{hero.heading}</span>
            {stamp ? typedLine(head) : <span className={styles.char} aria-hidden>{hero.heading}</span>}
          </h1>
          {!!sub && (
            <p className={styles.sub}>
              <span className={styles.sr}>{sub}</span>
              {caretLine === lines.indexOf(PASTE) && <span className={styles.caret} />}
              <span className={styles.paste} data-on={pasted || reduced} aria-hidden>{sub}</span>
            </p>
          )}
          {!!hero.links?.length && (
            <p className={styles.links}>
              {hero.links.map((ln, n) => {
                const sc = shortcode(ln), cls = n ? styles.ghost : styles.primary, say = () => window.dispatchEvent(new CustomEvent(TYPE_EVENT, { detail: ln.label }));
                if (!sc.done) return sc.so ? (
                  <span key={ln.href} className={styles.code} aria-hidden>{sc.so}{sc.caret && <span className={styles.caret} />}</span>
                ) : null;
                return /^https?:/.test(ln.href)
                  ? <a key={ln.href} href={ln.href} className={cls} target="_blank" rel="noopener noreferrer" onPointerEnter={say}>{ln.label}<span aria-hidden> ↗</span></a>
                  : <Link key={ln.href} href={ln.href} className={cls} onPointerEnter={say}>{ln.label}</Link>;
              })}
            </p>
          )}
          {/* whatever the reader types while the board is up, the hands type here: the line is
              always there, empty or not, so the platen under it never moves */}
          <p className={styles.prompt} aria-hidden>
            {!!said && (<><span className={styles.promptMark}>›</span><span className={styles.said}>{said}</span><span className={styles.caret} /></>)}
          </p>
          {/* the platen: the hero's foot, where the sheet goes into the machine */}
          <div className={styles.platen} aria-hidden />
          {!!work.length && <WorkIndex items={work} total={more} typed={sheetRows} all={reduced} />}
        </AsciiBox>
        {tune && (
          <TunePanel
            params={params}
            onChange={setParams}
            metrics={metrics}
            check={check}
            busy={busy}
            playing={playing}
            onPlay={togglePlay}
            X={X}
          />
        )}
      </section>
    </div>
  );
}
