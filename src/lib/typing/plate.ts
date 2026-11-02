import { createPool, STALE } from "./pool";
import { createMachine, PLAYING, type Phase } from "./machine";
import { markRows, markTyped, visit } from "./session";
import { markFade, unmarkFade, watchFade } from "@/lib/theme-fade";
import { night, setNight } from "@/lib/night";

// Plate 01's director. The hands are solved and drawn in workers while the page plays; this is
// the one clock on the main thread that puts them on the stage, and the one machine (machine.ts)
// that says what the stage is doing. Each frame: measure if anything moved, read the page,
// then the phase's own step, which is the only thing that paints, types or hides.

export type Layer = { x: number; y: number; w: number; h: number; bitmap: ImageBitmap };
export type Frame = {
  R: string | null; L: string | null;     // pose recipes; null: that hand is not in the picture
  offR: [number, number]; offL: [number, number];
  hR: number; hL: number;                  // mm the hand is off the keys, for its shadow
  kb: [number, number];                    // where the board has been pushed, panel px
  typed: number | null; pressed: number[]; clunk?: string; clunkShift?: string;
  glideR?: boolean; glideL?: boolean;      // a loose hand, eased between frames; others hold their frame
  boil: number;                            // the hands' noise field: on twos, on fours while typing
};
export type Sched = { fps: number; frames: Frame[]; intro: number; loop: [number, number]; exit: Frame[] };
export type Layout = { PW: number; PH: number; XM: number; pxPerMm: number; keyboardRect: { x: number; y: number; w: number; h: number } };
export type Check = { worst: { mm: number; frame: number }; under: number; total: number };
// the hands typing what the reader typed (fresh starts the line over), or a line of the index (row)
type Live = { frames: Frame[]; text: string; fresh?: boolean; row?: string };
type Place = { k: number; W: number; H: number; x: number; y: number };
type Pool = ReturnType<typeof createPool>;

const KB_W1 = 1021;                        // the board's drawn width in panel px at X = 1 (layout.keyboardRect)
const KB_ASPECT = 485 / 1021;              // ...and its height over its width
const SAID_MAX = 40;                       // the reader's line keeps its last this many characters
const LIGHTS_MS = 900;                     // the page going dark (or light): globals.css --theme-time
const LINGER_MS = 20_000;
// how far ahead of the frame on screen the opening is drawn: the rest waits its turn, and what has
// played is let go, so the opening never holds all of its drawings at once. It is also as far as
// `load` looks before it lets the clock go.
const AHEAD = 48;
/** how far the rule has run (ms) before the board comes up under it, on a first look */
const RULED_MS = 520;
/** the index's lines are drawn after this many frames of what is on stage (the reader's keys go before it) */
const ROW_PRI = 12;
/** a line the hands can't get to sets itself, a letter every this many ms, each a beat after the one above */
const SET_MS = 16, SET_GAP = 70;
/** a scene that was already on stage (a resize, back from another page) comes up over this long */
const FADE_MS = 320;
// the phone layout: the same query as typing.module.css, so the stage and the box never
// disagree (the plate's width is short of the viewport's by a classic scrollbar)
const PHONE = "(max-width: 720px) and (orientation: portrait)";

const boardBoilOf = (i: number) => Math.floor(i / 4) % 3;     // the board, slower: it is still, and should read so
// the board boils with the hands: each frame wants the board, its held keys and its hands, on the same field
const layersOf = (fr: Frame, i: number): [string, Record<string, unknown>][] => [
  ["keyboard", { boil: boardBoilOf(i) }],
  ...fr.pressed.map((id): [string, Record<string, unknown>] => ["patch", { id, boil: boardBoilOf(i) }]),
  ...(["L", "R"] as const).flatMap((side): [string, Record<string, unknown>][] =>
    fr[side] ? [["hand", { side, spec: fr[side], boil: fr.boil }]] : []),
];
const keyOf = (type: string, req: Record<string, unknown>) => type + JSON.stringify(req);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const samePt = (p: [number, number], q: [number, number]) => p[0] === q[0] && p[1] === q[1];
/** a frame eased toward `nx` draws the same pixels for every `a` when nothing between them moves: key it once */
const frameKey = (pre: string, i: number, fr: Frame, nx: Frame, a: number, size: string, digits: number) =>
  samePt(fr.kb, nx.kb) && (!fr.glideL || !nx.L || samePt(fr.offL, nx.offL)) && (!fr.glideR || !nx.R || samePt(fr.offR, nx.offR))
    ? `${pre}${i}:s:${size}` : `${pre}${i}:${a.toFixed(digits)}:${size}`;

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

/**
 * The lights. Once the hands have taken the board away under the work, the page goes dark for
 * what comes after it (the experience, the contact form); as they bring it back, it comes up
 * again before the board is in sight. Colours move together only while it changes
 * (html[data-theme-moving]), and only in what is on screen (theme-fade).
 */
let lightsTimer = 0;
/** the window's height as layout sees it: on a phone, without the URL bar's coming and going
 * (innerHeight follows the bar; anything laid out or lit by it bounces and flickers as it does) */
const winH = () => document.documentElement.clientHeight;
/** night is only over the ledger: once the contact plate (light stock) is up to mid-window, the
 * lights come back on for it and the foot. A little either side of the middle, so it never dithers. */
function dawn() {
  const top = document.getElementById("contact")?.getBoundingClientRect().top;
  if (top === undefined) return false;
  return top < winH() * (document.documentElement.dataset.theme === "light" ? 0.55 : 0.45);
}
function lights(theme: "light" | "dark", instant = false) {
  const el = document.documentElement;
  setNight(theme === "dark" ? Infinity : -Infinity);
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
const SHARED = {
  pool: null as Pool | null, poolFor: "", bye: 0,
  done: new Map<string, Layer>(), key: "", played: "", frame: 0,
  sched: null as Sched | null, layout: null as Layout | null,
};
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

/** for a schedule: each frame's layers, what is kept once drawn (the loop, the way out), when the
 * opening last needs the rest, and where the hands are first on the keys */
type Plan = { keys: string[][]; keep: Set<string>; last: Map<string, number>; typeAt: number };
const plans = new WeakMap<Sched, Plan>();
function planOf(s: Sched): Plan {
  let p = plans.get(s);
  if (p) return p;
  const keys = s.frames.map((fr, i) => layersOf(fr, i).map(([t, r]) => keyOf(t, r)));
  const keep = new Set<string>(), last = new Map<string, number>(), loop0 = s.loop[0];
  keys.forEach((ks, i) => ks.forEach((k) => (i >= loop0 ? keep.add(k) : last.set(k, i))));
  s.exit.forEach((fr, j) => layersOf(fr, j).forEach(([t, r]) => keep.add(keyOf(t, r))));
  for (const k of keep) last.delete(k);
  // the caret comes up a quarter second before the first letter goes down: the hands are home
  const first = s.frames.findIndex((fr) => (fr.typed ?? 0) > 0);
  const typeAt = first < 0 ? loop0 : Math.max(0, first - Math.round(s.fps / 4));
  plans.set(s, (p = { keys, keep, last, typeAt }));
  return p;
}

/** the ruled box (AsciiBox), drawn as the plate says: `t` ms since its rule set off */
export type BoxHandle = { draw(t: number): void };
export type PlateView = {
  scene: HTMLDivElement; plate: HTMLDivElement; canvas: HTMLCanvasElement;
  note: HTMLElement; ruled: HTMLElement | null; platen: HTMLElement | null;
  box: { current: BoxHandle | null };
};
/** what the plate tells the page (React): each only when it changes */
export type PlateOut = {
  phase(p: Phase): void;
  typed(n: number): void;
  /** a line of the index: `null` there whole, else how many letters of its title are down */
  row(id: string, n: number | null): void;
  cur(id: string): void;
  said(text: string): void;
  board(away: boolean): void;
  title(id: string): string;
  busy?(b: boolean): void;
  /** the drawing's resolution, device px per layout px (?tune shows it) */
  x?(X: number): void;
  /** a scene is on the stage (?tune reads its metrics off the pool) */
  configured?(pool: Pool, text: string): void;
};
export type PlateOpts = { text: string; params: Record<string, unknown>; tune: boolean; reduced: boolean; playing: boolean };

export function startPlate(view: PlateView, out: PlateOut, init: PlateOpts) {
  const { scene, plate, canvas, note, ruled, platen } = view;
  let o = init;
  window.clearTimeout(SHARED.bye);
  const pool = (SHARED.pool ||= createPool(workerCount()));
  let done = SHARED.done;
  let sched: Sched | null = null, layout: Layout | null = null;
  // the last scene's layers, let go once the new one is on screen
  let retired: Layer[] = [];
  const stage = { w: 0, h: 0, room: 0, phone: false, bw: 0, lh: 18, platen: 0, pin: 0 };
  let X = 0, dirty = true, geo = 0, visible = true;

  // the clock: the frame on stage, time owed to the next, and the key of what was last painted
  let frameIdx = 0, acc = 0, shown = "", played = "", startAt = 0;
  /** how far the board is down from its place, CSS px (as last painted): what is under it is cut there */
  let drop = 0;
  // the way out, 0..1 (eased behind the scroll), and where the performance was when it began
  let q = 0, resume: { phase: Phase; frame: number } = { phase: "idle", frame: 0 };
  // the rule's own clock (NaN: not set off; -Infinity: there whole), when the canvas first had
  // something on it, how far up the lights are, and what the canvas and the masthead were last told
  let ruledAt = NaN, shownAt = NaN, lit = 1, alpha = -1, told = "";
  // first look: the board comes up under the box; anything else (back from another page, a
  // resize, ?tune) is already there, and only fades up if it had gone
  let fresh = !(visit()?.phase === "typed");

  const shade = { pattern: null as CanvasPattern | null, cache: new WeakMap<Layer, { c: HTMLCanvasElement; m: number }>() };
  // in development, or anywhere with ?plate: the machine's steps on the Performance panel's Timings
  // track, its faults counted, and (?plate) a panel of its state over the page
  const debug = process.env.NODE_ENV !== "production" || /[?&]plate\b/.test(location.search)
    ? { under: 0, measures: 0, holds: [] as [number, number][], faults: new Map<string, number>() } : null;

  const M = createMachine("boot", {
    enter: {
      load: (_from, now) => { if (Number.isNaN(ruledAt)) ruledAt = fresh ? now : -Infinity; },
      enter: () => { fresh = false; },
      idle: (from) => { if (from === "type" || from === "load") markTyped(); },
      exit: (from) => { if (PLAYING.has(from)) resume = { phase: from === "live" ? "idle" : from, frame: frameIdx }; dropAll(); },
      still: () => { shown = ""; if (Number.isNaN(ruledAt)) ruledAt = -Infinity; },
    },
    leave: {
      exit: () => { frameIdx = resume.frame; acc = 0; shown = ""; seenAt = ""; },
      away: () => { const next = scene.nextElementSibling as HTMLElement | null; if (next) next.style.clipPath = ""; },
    },
    change: (to) => { out.phase(to); },
  }, !!debug);

  // ---- drawings ------------------------------------------------------------------------

  /** ask for a layer; it lands in `done` when drawn */
  const want = (type: string, req: Record<string, unknown>, pri: number) => {
    const key = keyOf(type, req);
    if (done.has(key)) return;
    pool.get(type, req, pri).then(
      (l: Layer) => done.set(key, l),
      (err: unknown) => { if ((err as Error)?.message !== STALE.message) console.error(err); },
    );
  };
  const loopIdx = (s: Sched, i: number) => (i < s.frames.length ? i : s.loop[0] + ((i - s.frames.length) % (s.frames.length - s.loop[0])));
  /** the frames about to play from `at` (the loop after the opening, round and round), then the
   * way out (a reader may scroll on at any moment), then the rest of the loop: the opening's
   * later frames are asked for as it gets to them (advance) */
  const prime = (s: Sched, at = 0) => {
    const loop0 = s.loop[0], N = s.frames.length;
    for (let k = 0; k < AHEAD; k++) { const i = loopIdx(s, at + k); layersOf(s.frames[i], i).forEach(([ty, r]) => want(ty, r, k)); }
    s.exit.forEach((fr, j) => layersOf(fr, j).forEach(([ty, r]) => want(ty, r, AHEAD + j)));
    for (let i = loop0; i < N; i++) layersOf(s.frames[i], i).forEach(([ty, r]) => want(ty, r, AHEAD + s.exit.length + i - loop0));
  };
  /** the opening has moved on a frame: one more frame into the window, and the one that played let go */
  const advance = (s: Sched, from: number, to: number) => {
    const loop0 = s.loop[0], j = to + AHEAD - 1;
    if (to < loop0 && j < s.frames.length) layersOf(s.frames[j], j).forEach(([ty, r]) => want(ty, r, AHEAD - 1));
    if (from < loop0 && to > from) {
      const { last, keys } = planOf(s);
      keys[from].forEach((k) => { if (last.get(k) === from) release(k); });
    }
  };
  const isReady = (fr: Frame, i: number) => layersOf(fr, i).every(([t, r]) => done.has(keyOf(t, r)));
  /**
   * Can the clock go from `from` and never wait? Each frame ahead needs its drawings by the time
   * it is up. What is not drawn yet will take the pool what that kind of drawing has been taking
   * (a board is several hands' work), shared over its workers but never quicker than the largest
   * one alone, with a margin.
   */
  const COST: Record<string, number> = { keyboard: 450, patch: 60, hand: 150 };
  const costOf = (k: string) => {
    const type = k.slice(0, k.indexOf("{")), st = (pool.stats as Record<string, { n: number; ms: number }>)[type];
    return st && st.n >= 3 ? st.ms / st.n : COST[type] ?? 150;
  };
  const runs = (keys: (i: number) => string[], from: number, end: number, fps: number) => {
    if (keys(from).some((k) => !done.has(k))) return false;
    const missing = new Set<string>();
    let sum = 0, most = 0;
    for (let i = from + 1; i < end; i++) {
      for (const k of keys(i)) if (!done.has(k) && !missing.has(k)) { missing.add(k); const c = costOf(k); sum += c; most = Math.max(most, c); }
      if (Math.max(most, sum / pool.size) * 1.25 > ((i - from) * 1000) / fps) return false;
    }
    return true;
  };
  const aheadReady = (s: Sched, from: number) => {
    const { keys } = planOf(s);
    return runs((k) => keys[loopIdx(s, from + k)], 0, from < s.loop[0] ? Math.min(AHEAD, s.loop[0] - from) : AHEAD, s.fps);
  };
  /** ...and a line to type from the loop (it is typed quicker than the schedule's rate: a margin) */
  const liveReady = (F: Frame[], fps: number) => runs((j) => layersOf(F[j], j).map(([t, r]) => keyOf(t, r)), 0, F.length, fps * 2.7);

  /** a hand's shadow, made once per drawing: blurred, hatched, faint */
  const shadowOf = (l: Layer, h: number, k: number) => {
    const hit = shade.cache.get(l);
    if (hit) return hit;
    const blur = k * (1.1 + 0.32 * h), m = Math.ceil(blur * 3);
    const c = document.createElement("canvas");
    c.width = l.w + 2 * m;
    c.height = l.h + 2 * m;
    const g = c.getContext("2d")!;
    shade.pattern ||= g.createPattern(hatch(), "repeat");
    g.filter = `blur(${blur.toFixed(1)}px)`;
    g.drawImage(l.bitmap, m, m);
    g.filter = "none";
    g.globalCompositeOperation = "source-in";
    g.fillStyle = shade.pattern!;
    g.fillRect(0, 0, c.width, c.height);
    const res = { c, m };
    shade.cache.set(l, res);
    return res;
  };

  /** frame `fr`'s drawings, placed part way (`a`) toward where `nx` puts them */
  const paint = (fr: Frame, nx: Frame, a: number, i: number) => {
    const L = layout, { w, h, room, bw, phone } = stage;
    if (!L || !w || !isReady(fr, i)) return false;
    const board = done.get(keyOf("keyboard", { boil: boardBoilOf(i) }))!;
    const P = placeOf(L, w, h, room, bw, phone);
    // a new scene swaps in whole, on its first complete frame: no flash while tuning
    if (canvas.width !== P.W || canvas.height !== P.H) { canvas.width = P.W; canvas.height = P.H; }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, P.W, P.H);
    ctx.translate(P.x, P.y);
    const at = (p: [number, number], q2: [number, number]): [number, number] => [lerp(p[0], q2[0], a), lerp(p[1], q2[1], a)];
    const [bx, by] = at(fr.kb, nx.kb);
    ctx.drawImage(board.bitmap, board.x + bx, board.y + by);
    for (const id of fr.pressed) { const l = done.get(keyOf("patch", { id, boil: boardBoilOf(i) }))!; ctx.drawImage(l.bitmap, l.x + bx, l.y + by); }
    const hands = (["L", "R"] as const).flatMap((side) => {
      const spec = fr[side];
      if (!spec) return [];
      const l = done.get(keyOf("hand", { side, spec, boil: fr.boil }))!;
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
    drop = Math.max(0, by - (sched ? sched.frames[sched.loop[0]].kb[1] : 0)) / P.k;
    if (retired.length && !retired.includes(board)) {
      for (const l of retired) l.bitmap.close();
      retired = [];
    }
    if (Number.isNaN(shownAt)) shownAt = performance.now();
    return true;
  };

  /** a performance frame has come up: how much of the heading it has typed */
  const arrive = (fr: Frame) => { if (fr.typed !== null) out.typed(fr.typed); };

  // ---- the stage -----------------------------------------------------------------------

  // The desk (the plate) is pinned over the sheet, which scrolls as any page does. The platen is
  // the hero's foot as the page opens: the sheet goes into the machine there, and the board has
  // the room under it. Resolution follows the stage: device px across the board, capped where
  // drawing gets slow. Measured at the top of a frame, once, however many observers fired.
  const measure = () => {
    if (debug) debug.measures++;
    const w = plate.clientWidth, h = plate.clientHeight, phone = window.matchMedia(PHONE).matches;
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
      const settled = !was || !ruled || Math.abs(ruled.offsetWidth - note.clientWidth) < 12;
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
    const top = parseFloat(getComputedStyle(plate).top) || 0;
    scene.style.setProperty("--below", `${Math.round(Math.max(0, Math.min(room, winH() - top - at)))}px`);
    // that room is the board's to go through, not the page's: what follows the sheet (Experience)
    // is drawn up into it, and comes out from under the board as the hands take it away
    document.documentElement.style.setProperty("--tail", getComputedStyle(scene).paddingBottom);
    const lh = parseFloat(getComputedStyle(note).lineHeight) || 18;
    Object.assign(stage, { w, h, room, phone, bw, lh, platen: at, pin: top });
    const dpr = window.devicePixelRatio || 1;
    const next = Math.min(1.35, Math.max(0.45, Math.round(((bw * dpr) / KB_W1) * 20) / 20));
    if (Math.abs(next - X) >= 0.1) { X = next; out.x?.(X); configure(); }
  };
  const moved = () => { dirty = true; geo++; };
  // the window's own resizes: only those layout sees (not a phone's URL bar showing and hiding)
  let winWas = "";
  const resized = () => { const k = `${innerWidth}x${winH()}`; if (k !== winWas) { winWas = k; moved(); } };
  const ro = new ResizeObserver(moved);
  ro.observe(plate);
  ro.observe(note);
  if (ruled) ro.observe(ruled);
  // a short window holds the desk at its least height and pins it higher (its `top`), which
  // moves with the window's height while the desk's size does not
  window.addEventListener("resize", resized);
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
  io.observe(plate);

  // ---- a scene: these parameters at this resolution, then everything it will need, in order

  let cfgSeq = 0, loaded = 0, cfgTimer = 0;
  function configure() {
    window.clearTimeout(cfgTimer);
    if (!X || !o.text) return;
    // the stage goes back to `load` (holding what is on it) until the new scene can play on its own
    if (M.phase !== "boot" && M.phase !== "load" && M.phase !== "still") {
      if (PLAYING.has(M.phase)) resume = { phase: M.phase === "live" ? "idle" : M.phase, frame: frameIdx };
      if (M.phase === "live") dropAll();
      M.go("load", "scene drawn again");
    }
    const seq = ++cfgSeq;
    cfgTimer = window.setTimeout(() => run(seq), o.tune ? 60 : 0);
  }
  async function run(seq: number) {
    const { text, params } = o;
    out.busy?.(true);
    const id = text + JSON.stringify(params), key = `${id}@${X}`, same = SHARED.key === key && !!SHARED.sched && !!SHARED.layout;
    if (!same) {
      retired.push(...done.values());
      done = SHARED.done = new Map();
    }
    try {
      // the scene this plate was showing before it went (another page, and back): its
      // drawings are still here; only fresh workers need telling what they are drawing
      let L = same ? SHARED.layout! : null;
      if (!same || SHARED.poolFor !== key) {
        L = (await pool.configure({ ...params, X })).layout;
        SHARED.poolFor = key;
      }
      [0, 1, 2].forEach((boil) => want("keyboard", { boil }, -2));
      const s: Sched = same ? SHARED.sched! : await pool.get("schedule", { text }, -3);
      if (seq !== cfgSeq) return;
      sched = SHARED.sched = s;
      layout = SHARED.layout = L!;
      SHARED.key = key;
      loaded = seq;
      // the same scene at a new resolution (the window was resized), or back from another page,
      // picks the performance up where it was, rather than typing it all again from the top;
      // a plate typed out this visit starts in its loop
      const loop0 = s.loop[0], N = s.frames.length;
      const was = played === id ? frameIdx : SHARED.played === id ? SHARED.frame : 0;
      const typed = visit()?.phase === "typed";
      startAt = typed ? Math.max(loop0, Math.min(was, N - 1)) : Math.min(was, N - 1);
      fresh &&= startAt === 0;
      played = SHARED.played = id;
      if (o.playing && !o.reduced) prime(s, startAt);
      else layersOf(s.frames[loop0], loop0).forEach(([ty, r]) => want(ty, r, -1));
      // ...and the reader's keys in hand, drawn again for it
      for (const lv of [Lv.cur, ...Lv.queue]) lv?.frames.forEach((fr, j) => layersOf(fr, j).forEach(([ty, r]) => want(ty, r, -4)));
      out.configured?.(pool, text);
    } catch (err) {
      if ((err as Error)?.message !== STALE.message) console.error(err);
    } finally {
      if (seq === cfgSeq) out.busy?.(false);
    }
  }

  // ---- the reader's keys, and the index's lines --------------------------------------------

  // the reader's keys: waiting to be scheduled, scheduled and waiting their turn, being typed
  const Lv = { pending: "", asking: false, queue: [] as Live[], cur: null as (Live & { i: number; shown: number }) | null, said: "", open: false, fresh: false, label: "" };
  // the lines of the index that have come up past the platen (this visit: typed once, they stay)
  const up = new Set<string>(visit()?.rows ?? []);
  let rowQ: string[] = [];                                  // up, waiting for the hands, in the order they came
  let ahead = "";                                           // the next line to come up: its strokes are drawn before it does
  let rush = false;                                         // the line being typed has left the window: finish it quick
  const rowPlans = new Map<string, Frame[] | null>();       // a line's strokes (null: asked for)
  const drawn = new Set<string>();
  // what the reader's keys and the index's lines had drawn: let go once nothing is waiting to type
  const liveKeys = new Set<string>();
  const letLiveGo = () => {
    const s = sched;
    if (!s || Lv.cur || Lv.queue.length || Lv.asking || rowQ.length) return;
    const { keep } = planOf(s), hold = new Set<string>();
    rowPlans.get(ahead)?.forEach((fr, j) => layersOf(fr, j).forEach(([ty, r]) => hold.add(keyOf(ty, r))));
    for (const k of liveKeys) if (!keep.has(k) && !hold.has(k)) { release(k); liveKeys.delete(k); }
    for (const id of drawn) if (id !== ahead) drawn.delete(id);
  };
  const wantLive = (frames: Frame[], pri = -4) => frames.forEach((fr, j) => layersOf(fr, j).forEach(([ty, r]) => { liveKeys.add(keyOf(ty, r)); want(ty, r, pri); }));
  const whole = (row?: string) => { if (row) { sets.delete(row); out.row(row, null); markRows([row]); } };
  // lines that came up while the hands were busy (or had more than one in hand): they set
  // themselves, letter by letter, from the number out, so nothing on the sheet is ever just there
  const sets = new Map<string, { at: number; from: number; n: number; len: number }>();
  let setLast = 0;
  const set = (row?: string, from = 0) => {
    if (!row || sets.has(row)) return;
    const now = performance.now(), at = Math.max(now, setLast + SET_GAP);
    setLast = at;
    sets.set(row, { at, from, n: -1, len: out.title(row).length });
  };
  const setting = (now: number) => {
    for (const [id, S] of sets) {
      const n = Math.min(S.len, S.from + Math.max(0, Math.floor((now - S.at) / SET_MS)));
      if (n >= S.len) { whole(id); continue; }
      if (n !== S.n) { S.n = n; out.row(id, n); }
    }
  };
  /** a line's strokes, asked for once (they take a millisecond or two; drawing them takes the time) */
  const planFor = (id: string) => {
    if (rowPlans.has(id)) return rowPlans.get(id) ?? null;
    rowPlans.set(id, null);
    pool.get("schedule", { text: out.title(id), live: true }, -5).then((ls: { frames: Frame[] }) => rowPlans.set(id, ls.frames), () => rowPlans.delete(id));
    return null;
  };
  const drawRow = (id: string, pri: number) => {
    const F = planFor(id);
    if (F && !drawn.has(id)) { drawn.add(id); wantLive(F, pri); }
  };
  /** the hands' strokes for the reader's `text` asked for; typed, in turn, from the loop */
  const ask = (text: string, extra: Partial<Live>) => {
    Lv.asking = true;
    pool.get("schedule", { text, live: true }, -5).then((ls: { frames: Frame[] }) => {
      if (!Lv.open) return;
      wantLive(ls.frames);
      Lv.queue.push({ frames: ls.frames, text, ...extra });
    }, () => {}).finally(() => { Lv.asking = false; });
  };
  /** the hands put down what they were typing, and every line waiting is there whole */
  function dropAll() {
    set(Lv.cur?.row, Lv.cur?.shown); Lv.queue.forEach((lv) => set(lv.row)); rowQ.forEach((id) => set(id));
    rowQ = []; Lv.pending = ""; Lv.queue = []; Lv.cur = null; rush = false; out.cur("");
    if (Lv.said) { Lv.said = ""; out.said(""); }
    letLiveGo();
  }
  /** the next thing to type, from the loop: the reader's keys first, then the index's queue */
  const nextJob = () => {
    const fps = sched!.fps;
    // a line waits in the loop until its drawings are ahead of it (any let go since it was
    // asked for are asked for again), and the reader's keys go before the index's lines
    if (Lv.queue.length) {
      if (!liveReady(Lv.queue[0].frames, fps)) { wantLive(Lv.queue[0].frames); return false; }
      Lv.cur = { ...Lv.queue.shift()!, i: 0, shown: 0 }; acc = 0;
      if (Lv.cur.fresh) { Lv.said = ""; out.said(""); }
      return true;
    }
    if (rowQ.length) {
      const id = rowQ[0], F = planFor(id);
      if (F && !liveReady(F, fps)) wantLive(F, ROW_PRI);
      else if (F) {
        rowQ.shift(); drawRow(id, ROW_PRI); rush = false;
        Lv.cur = { frames: F, text: out.title(id), row: id, i: 0, shown: 0 }; acc = 0;
        out.cur(id);
        return true;
      }
    }
    return false;
  };
  const jobWhy = () => (Lv.cur?.row ? `row ${Lv.cur.row}` : "the reader's keys");
  /** the reader's keys go in a few at a time */
  const feed = () => {
    if (Lv.pending && !Lv.asking) {
      const chunk = Lv.pending.slice(0, 16), f = Lv.fresh;
      Lv.pending = Lv.pending.slice(16);
      Lv.fresh = false;
      ask(chunk, { fresh: f });
    }
  };

  // ---- the page: read once a frame (only when it has moved), written by the phase -----------

  let seenAt = "", seenGeo = -1, seenY = NaN, seenH = 0;
  const page = { platenY: 0, foot: 0, next: null as HTMLElement | null, nextBox: null as DOMRect | null, day: false, above: false };
  const read = () => {
    if (seenGeo === geo && seenY === scrollY && seenH === winH()) return false;
    seenGeo = geo; seenY = scrollY; seenH = winH();
    page.platenY = plate.getBoundingClientRect().top + stage.platen;
    page.foot = note.getBoundingClientRect().bottom;
    page.next = scene.nextElementSibling as HTMLElement | null;
    page.nextBox = page.next?.getBoundingClientRect() ?? null;
    page.day = dawn();
    page.above = scene.getBoundingClientRect().bottom < 0;
    return true;
  };
  const board = (away: boolean) => {
    const v = away ? "away" : "up";
    if (told === v) return;
    told = v;
    document.documentElement.dataset.board = v;
    out.board(away);
  };
  // what paints its own stock, and so is not turned by the GL layers at the lights' front: the
  // sheet's box (its ground follows the front, --nf) and the masthead (the theme the front has
  // given it, until the page's own theme is that)
  const mast = document.querySelector<HTMLElement>("header");
  let nfWas = NaN, mastWas = "";
  const painted = () => {
    const y = night.y;
    if (ruled) {
      const v = Math.round(Math.max(-1e5, Math.min(1e5, y - ruled.getBoundingClientRect().top)));
      if (v !== nfWas) { nfWas = v; ruled.style.setProperty("--nf", `${v}px`); }
    }
    if (mast) {
      const r = mast.getBoundingClientRect(), want = y > (r.top + r.bottom) / 2 ? "dark" : "light";
      const v = want === (document.documentElement.dataset.theme ?? "light") ? "" : want;
      if (v !== mastWas) { mastWas = v; if (v) mast.dataset.night = v; else delete mast.dataset.night; }
    }
  };
  const clip = (el: HTMLElement | null | undefined, px: number) => {
    const v = px ? `inset(0 0 ${px}px 0)` : "";
    if (el && el.style.clipPath !== v) el.style.clipPath = v;
  };
  const setAlpha = (a: number) => {
    const v = Math.round(a * 100) / 100;
    if (v !== alpha) { alpha = v; canvas.style.opacity = String(v); }
  };

  /**
   * The lines against the platen: as each comes up past it, it waits its turn (its number there
   * at once) and the hands type it, its strokes drawn before it is up. They keep one line in
   * hand: with another coming up, the one waiting sets itself and the one being typed is
   * hurried; so is one that leaves the window before it is done. Only in the loop: anywhere
   * else (the hands still on the heading, the board on its way out), a line that comes up sets
   * itself. Only one that leaves the window unseen is simply there.
   */
  const rows = (canType: boolean) => {
    const at = `${Math.round(page.platenY)}:${Math.round(page.foot)}`;
    if (at === seenAt) return;
    seenAt = at;
    const fresh2: string[] = [], gone = new Set<string>(), top = Math.max(0, page.platenY - stage.platen) + 8;
    let nextUp = "";
    for (const r of scene.querySelectorAll<HTMLElement>("[data-row]")) {
      const id = r.dataset.row!, b = r.getBoundingClientRect().bottom;
      if (!up.has(id)) {
        if (b < page.platenY + 1) { up.add(id); fresh2.push(id); }
        else nextUp ||= id;
      } else if (b < top) gone.add(id);
    }
    if (fresh2.length) {
      if (canType) {
        const waiting = [...rowQ, ...fresh2], keep = waiting.slice(-1);
        waiting.slice(0, -1).forEach((id) => set(id));
        rowQ = keep;
        out.row(keep[0], 0);
        planFor(keep[0]);
      } else fresh2.forEach((id) => set(id));
    }
    // out of the window above before their turn: there whole; the one under way, hurried
    if (gone.size) {
      for (const id of gone) if (sets.has(id)) whole(id);
      const left = rowQ.filter((id) => gone.has(id));
      if (left.length) { rowQ = rowQ.filter((id) => !gone.has(id)); left.forEach(whole); }
      rush = !!Lv.cur?.row && gone.has(Lv.cur.row);
    }
    if (nextUp !== ahead) { ahead = nextUp; if (ahead && canType) planFor(ahead); }
  };

  // ---- the phases' steps: each paints (or not) and says where to go next -------------------

  const sizeKey = () => `${stage.w}x${stage.h}x${stage.room}x${stage.bw}`;

  /** the performance's clock: poses at the schedule's rate, eased between on every display
   * frame; a pose not drawn yet is held, never skipped (load sees that it rarely is) */
  const clock = (dt: number) => {
    const s = sched!, N = s.frames.length, loop0 = s.loop[0], step = 1000 / s.fps;
    acc = Math.min(acc + dt, step * 2);
    let i = frameIdx;
    if (acc >= step) {
      const next = i + 1 >= N ? loop0 : i + 1;
      if (isReady(s.frames[next], next)) { const from = i; i = frameIdx = next; acc -= step; arrive(s.frames[i]); advance(s, from, next); }
      else { acc = step; if (debug) { debug.under++; debug.holds.push([Math.round(performance.now()), next]); } }
    }
    const nx = i + 1 >= N ? loop0 : i + 1, a = Math.min(1, acc / step);
    const key = frameKey("", i, s.frames[i], s.frames[nx], a, sizeKey(), 2);
    if (shown !== key && paint(s.frames[i], s.frames[nx], a, i)) shown = key;
  };

  const steps: Record<Phase, (now: number, dt: number) => void> = {
    boot() {
      if (o.reduced || (sched && !o.playing)) { if (sched) M.go("still", o.reduced ? "reduced motion" : "paused"); return; }
      if (X && o.text) M.go("load", "measured");
    },
    load(now) {
      const s = sched;
      if (!s || loaded !== cfgSeq) return;
      if (o.reduced || !o.playing) { M.go("still", o.reduced ? "reduced motion" : "paused"); return; }
      const { typeAt } = planOf(s), loop0 = s.loop[0];
      if (fresh && now - ruledAt < RULED_MS) return;
      if (!aheadReady(s, startAt)) return;
      frameIdx = startAt; acc = 0; shown = "";
      if (startAt) arrive(s.frames[startAt]);
      M.go(startAt >= loop0 ? "idle" : startAt >= typeAt ? "type" : "enter", startAt ? `drawn ahead, from frame ${startAt}` : "drawn ahead", now);
    },
    enter(_now, dt) {
      clock(dt);
      if (frameIdx >= planOf(sched!).typeAt) M.go("type", "hands on the keys");
    },
    type(_now, dt) {
      clock(dt);
      if (frameIdx >= sched!.loop[0]) M.go("idle", "heading typed");
    },
    idle(_now, dt) {
      feed();
      if (nextJob()) { M.go("live", jobWhy()); steps.live(_now, dt); return; }
      clock(dt);
    },
    live(now, dt) {
      feed();
      const s = sched!, step = 1000 / s.fps, C = Lv.cur;
      if (!C) { M.go("idle", "nothing to type"); return; }
      const F = C.frames;
      // a line of the index is typed briskly, and faster with others waiting (or when it has gone by)
      const sp = C.row ? 1.35 * (rowQ.length ? 2 : 1) * (rush ? 2 : 1) : 1, stp = step / sp;
      acc = Math.min(acc + dt, stp * 2);
      if (acc >= stp) {
        if (C.i + 1 >= F.length) { acc -= stp; C.i = F.length; }
        else if (isReady(F[C.i + 1], C.i + 1)) { C.i++; acc -= stp; }
        else { acc = stp; if (debug) { debug.under++; debug.holds.push([Math.round(performance.now()), -(C.i + 1)]); } }
      }
      const n = C.i >= F.length ? C.text.length : F[C.i].typed ?? 0;
      if (n > C.shown) {
        const was = C.shown;
        C.shown = n;
        if (C.row) out.row(C.row, n);
        else { Lv.said = (Lv.said + C.text.slice(was, n)).slice(-SAID_MAX); out.said(Lv.said); }
      }
      if (C.i < F.length) {
        const nx = F[Math.min(F.length - 1, C.i + 1)], a = Math.min(1, acc / stp), key = frameKey("live", C.i, F[C.i], nx, a, sizeKey(), 2);
        if (shown !== key && paint(F[C.i], nx, a, C.i)) shown = key;
        return;
      }
      // done: its last frame leads into the loop's first; straight on to the next, from the same pose
      whole(C.row);
      if (C.row) out.cur("");
      Lv.cur = null; rush = false; frameIdx = s.loop[0]; shown = "";
      letLiveGo();
      if (nextJob()) { M.go("live", jobWhy(), now); return; }
      M.go("idle", "typed", now);
      clock(dt);
    },
    exit() {
      const s = sched!;
      if (q === 0) { M.go(resume.phase, "board back in place"); return; }
      // the board goes off the foot of the window as drawn; only its last few frames thin out
      const E = s.exit, f = q * (E.length - 1), i0 = Math.floor(f), i1 = Math.min(E.length - 1, i0 + 1), a = f - i0;
      const key = frameKey("x", i0, E[i0], E[i1], a, sizeKey(), 3);
      if (shown === key) return;
      if (paint(E[i0], E[i1], a, i0)) { shown = key; return; }
      // not drawn yet: wanted before anything else, and meanwhile the nearest that is
      layersOf(E[i0], i0).forEach(([ty, r]) => want(ty, r, -6));
      for (let d = 1; d < 8; d++) {
        const j = [i0 - d, i0 + d].find((jj) => jj >= 0 && jj < E.length && isReady(E[jj], jj));
        if (j !== undefined && paint(E[j], E[j], 0, j)) { shown = `x${j}:0:${sizeKey()}`; break; }
      }
    },
    away() {
      if (visible) M.go("exit", "back in view");
    },
    still() {
      const s = sched;
      if (!s) return;
      if (!o.reduced && o.playing) { frameIdx = 0; acc = 0; shown = ""; prime(s); M.go("enter", "playing"); return; }
      const loop0 = s.loop[0], key = `still${loop0}:${sizeKey()}`;
      if (shown !== key && paint(s.frames[loop0], s.frames[loop0], 0, loop0)) { shown = key; arrive(s.frames[loop0]); }
    },
  };

  /** the canvas: hidden until the stage has something on it, then as lit as the page is */
  const alphaOf = (now: number) => {
    const ph = M.phase;
    if (ph === "boot" || Number.isNaN(shownAt)) return 0;
    if (ph === "exit") return Math.min(lit, 1 - smoothstep(clamp01((q - 0.78) / 0.2)));
    // a fresh entry has the board coming up from below the window, and needs no fade
    const up = startAt === 0 && sched && frameIdx < planOf(sched).typeAt + 1 ? 1 : clamp01((now - shownAt) / FADE_MS);
    return Math.min(lit, ph === "still" && o.reduced ? 1 : smoothstep(up));
  };

  // ---- the frame ------------------------------------------------------------------------

  let raf = 0, last = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(64, now - last);
    last = now;
    if (dirty) { dirty = false; measure(); }
    // the rule: its own clock, set off by `load`, and left alone once it has run
    if (ruledAt === ruledAt && !ruled?.dataset.drawn) view.box.current?.draw(now - ruledAt);
    // how far up the lights are, 0..1, at their own pace: the drawing is graphite on paper, and is
    // only ever as there as they are (it goes as they go down, and comes back as they come up)
    lit = clamp01(lit + ((document.documentElement.dataset.theme === "dark" ? -1 : 1) * dt) / LIGHTS_MS);
    const ph = M.phase, s = sched;
    if (ph === "boot") { steps.boot(now, dt); if (M.phase === "boot") return; }
    const moved2 = read();

    if (!visible) {
      // far down the page (the desk out of sight above), the board is away and it is night
      // (or day again, over the contact form); back up, the hands bring the board back with the scroll
      if (page.above) {
        lights(page.day ? "light" : "dark");
        if (PLAYING.has(ph) && s && !o.reduced) M.go("exit", "left above the window");
        if (M.phase === "exit") { q = 1; board(true); M.go("away", "above the window"); }
      }
      for (const id of sets.keys()) whole(id);
      painted();
      return;
    }
    if (ph === "away") steps.away(now, dt);

    const still = o.reduced;
    // the index's lines against the platen, looked at only when the sheet has moved
    if (!still && moved2) rows(M.phase === "idle" || M.phase === "live");
    if (sets.size) setting(now);
    // the next line's strokes drawn while it is still on its way up, the first in the queue
    // first; both after the next half second of what is on stage, which must never wait for them
    if (M.phase === "idle" || M.phase === "live") {
      if (rowQ[0] && !drawn.has(rowQ[0])) drawRow(rowQ[0], ROW_PRI);
      else if (ahead && !drawn.has(ahead) && !rowQ.length) drawRow(ahead, ROW_PRI + 12);
    }

    // the way out: how far the sheet's foot is past the platen, over the window the board has to
    // go through, eased a little behind the scroll (measured from where the platen is pinned: at
    // the scene's end the desk goes up with it, and the board is gone before it does)
    const pinned = Math.max(page.platenY, stage.pin + stage.platen);
    const past = pinned - stage.lh * 0.5 - page.foot, span = Math.max(220, (winH() - pinned) * 0.9);
    const target = still || !s ? 0 : clamp01(past / span);
    q += (target - q) * (1 - Math.exp(-dt / 90));
    if (Math.abs(target - q) < 0.002) q = target;
    if (q > 0 && PLAYING.has(M.phase)) M.go("exit", "the sheet's foot past the platen");
    // the lights: down as the board nears the foot of the window, and up as soon as the scroll
    // turns back for it (the scroll's place, not the board's, which trails it)
    // The lights are the hands': as they pull the board down, night comes down the window after
    // it (night.js, a front every GL layer and the stock turn their pixels at), all the way down
    // as the board is gone; only then does the page's theme change, with nothing left in the
    // light to show it. Brought back up, the front goes back up with it, and the theme is day's
    // again once the board is in place.
    board(still ? past > 0 : q > 0.55);
    if (still || page.day) lights(!page.day && past > 0 ? "dark" : "light", still);
    // (no fade when it does: what the GL layers draw has already turned)
    else if (q >= 1) lights("dark", true);
    else if (q <= 0) lights("light", true);
    else setNight(q * Math.max(winH() + 60, page.platenY + drop));
    painted();
    Lv.open = M.phase === "idle" || M.phase === "live";

    // Nothing of the sheet, or of what follows it, shows under the board: both are cut at the
    // platen, and in the way out below it by as far as the board has gone down the page
    const edge = page.platenY + (M.phase === "exit" ? drop : 0);
    clip(note, still || q >= 1 ? 0 : Math.max(0, Math.round(page.foot - edge)));
    if (page.nextBox) {
      const r = page.nextBox;
      clip(page.next, still || q >= 1 || r.top > innerHeight ? 0 : Math.min(Math.round(r.height), Math.max(0, Math.round(r.bottom - edge))));
    }

    steps[M.phase](now, dt);
    setAlpha(alphaOf(now));
    if (debug) audit(now);
  };

  // ---- what must hold, every frame (development, ?plate) -----------------------------------
  // Each is a way the plate has gone wrong before. A fault is counted, traced (its own mark on the
  // Timings track) and said once; the steps above are what put it right.
  let hudEl: HTMLPreElement | null = null, hudAt = 0;
  const said = new Set<string>();
  const fault = (k: string, cond: boolean) => {
    if (!cond || !debug) return;
    debug.faults.set(k, (debug.faults.get(k) ?? 0) + 1);
    performance.mark(`plate fault: ${k}`);
    if (!said.has(k)) { said.add(k); console.warn(`plate: ${k} (phase ${M.phase}, q ${q.toFixed(3)})`); }
  };
  const state = () => ({
    phase: M.phase, inPhase: Math.round(performance.now() - M.since), q: +q.toFixed(3), night: night.y,
    theme: document.documentElement.dataset.theme ?? "light", board: told, visible, frame: frameIdx, alpha, lit: +lit.toFixed(2),
    rows: { queued: [...rowQ], setting: [...sets.keys()], typing: Lv.cur?.row ?? "", ahead }, keys: { pending: Lv.pending, said: Lv.said },
    stage: { ...stage }, under: debug?.under ?? 0, faults: Object.fromEntries(debug?.faults ?? []),
  });
  const audit = (now: number) => {
    const ph = M.phase, inPhase = now - M.since, theme = document.documentElement.dataset.theme ?? "light";
    fault("playing with the board on its way out", PLAYING.has(ph) && q > 0.01);
    fault("away, but the plate is in view", ph === "away" && visible && inPhase > 100);
    fault("still, though playing", ph === "still" && !o.reduced && o.playing && inPhase > 100);
    fault("night all over in the day's theme", night.y === Infinity && theme !== "dark");
    fault("day all over in the night's theme", night.y === -Infinity && theme === "dark" && !page.above);
    fault("a line setting itself for over 3s", [...sets.values()].some((S) => now - S.at > 3000));
    fault("loading for over 8s", ph === "load" && inPhase > 8000 && visible);
    if (hudEl && now - hudAt > 150) {
      hudAt = now;
      const st = state(), tr = M.trace.slice(-10).map((x) => `${(x.t / 1000).toFixed(2).padStart(7)} ${x.ok ? "" : "✗ "}${x.from}→${x.to}  ${x.why}`);
      hudEl.textContent = `${st.phase} ${st.inPhase}ms  q ${st.q}  night ${Number.isFinite(st.night) ? Math.round(st.night) : st.night}  ${st.theme}  board ${st.board}\n` +
        `frame ${st.frame}  alpha ${st.alpha}  lit ${st.lit}  held ${st.under}  ${st.visible ? "in view" : "out of view"}\n` +
        `rows: typing ${st.rows.typing || "-"}  queued ${st.rows.queued.join(",") || "-"}  setting ${st.rows.setting.join(",") || "-"}\n` +
        (Object.keys(st.faults).length ? `faults: ${Object.entries(st.faults).map(([k, n]) => `${k} ×${n}`).join("; ")}\n` : "") + tr.join("\n");
    }
  };
  if (debug && /[?&]plate\b/.test(location.search)) {
    hudEl = document.createElement("pre");
    hudEl.setAttribute("data-ink-off", ""); hudEl.setAttribute("aria-hidden", "true");
    hudEl.style.cssText = "position:fixed;right:8px;top:calc(var(--masthead, 56px) + 8px);z-index:99;max-width:min(420px, calc(100vw - 16px));margin:0;padding:8px 10px;font:10px/1.4 ui-monospace,monospace;white-space:pre-wrap;color:#e8e3d6;background:rgb(20 19 17 / 0.92);border-radius:6px;pointer-events:none";
    document.body.append(hudEl);
  }
  raf = requestAnimationFrame(frame);
  const unwatch = watchFade();
  if (debug) (window as unknown as { __plate: unknown }).__plate = { pool, debug, state, get trace() { return M.trace; }, get phase() { return M.phase; }, get frame() { return frameIdx; }, get done() { return SHARED.done; } };

  return {
    /** new options from the page (?tune's sliders and play, reduced motion) */
    set(next: Partial<PlateOpts>) {
      const prev = o;
      o = { ...o, ...next };
      if (o.text !== prev.text || o.params !== prev.params) configure();
      if (o.reduced !== prev.reduced || o.playing !== prev.playing) {
        if ((o.reduced || !o.playing) && M.phase !== "boot" && M.phase !== "load") M.go("still", o.reduced ? "reduced motion" : "paused");
        // back on from reduced motion: from where the performance would be, through load
        else if (!o.reduced && prev.reduced && M.phase === "still") { startAt = sched ? sched.loop[0] : 0; M.go("load", "motion back on"); }
      }
    },
    /** the reader's keys, once the hands have typed the heading and while the board is in place:
     * the hands type them too. Not while a field or a control has them, or with a modifier. */
    key(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (!Lv.open || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName))) return;
      if (e.key === "Backspace") {
        e.preventDefault();
        if (Lv.pending) Lv.pending = Lv.pending.slice(0, -1);
        else { Lv.said = Lv.said.slice(0, -1); out.said(Lv.said); }
      } else if (e.key === "Escape") {
        Lv.pending = ""; Lv.said = ""; out.said("");
      } else if (e.key.length === 1) {
        if (e.key === " ") e.preventDefault();                 // the space bar types, rather than scrolls, while the board is up
        Lv.pending = (Lv.pending + e.key).slice(-SAID_MAX); Lv.label = "";
      }
    },
    /** a masthead link pointed at: the hands type its name over whatever was on the line, once,
     * however often the pointer crosses it while they do */
    say(label: string) {
      label = label.slice(0, SAID_MAX);
      if (!Lv.open || !label) return;
      if (label === Lv.label && (Lv.pending || Lv.asking || Lv.cur || Lv.queue.length || Lv.said === label)) return;
      Lv.label = label; Lv.pending = label; Lv.fresh = true; Lv.queue = [];
    },
    stop() {
      cancelAnimationFrame(raf);
      hudEl?.remove();
      cfgSeq++;
      window.clearTimeout(cfgTimer);
      ro.disconnect(); io.disconnect(); window.removeEventListener("resize", resized);
      unwatch();
      // off the home page the lights are up, and there is no board to be away
      lights("light", true);
      painted();
      delete document.documentElement.dataset.board;
      document.documentElement.style.removeProperty("--tail");
      const next = scene.nextElementSibling as HTMLElement | null;
      if (next) next.style.clipPath = "";
      SHARED.frame = frameIdx;
      pool.drop();
      // the opening's drawings go with the plate; the board, the loop and the way out wait for the reader
      if (sched) { const { keep } = planOf(sched); for (const k of [...SHARED.done.keys()]) if (!keep.has(k)) release(k); }
      SHARED.bye = window.setTimeout(() => { SHARED.pool?.dispose(); SHARED.pool = null; SHARED.poolFor = ""; }, LINGER_MS);
    },
  };
}
