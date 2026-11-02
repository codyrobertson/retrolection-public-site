/**
 * Now and then the resting hand (SmokeFooter) takes up the cigarette: it shifts its weight, swings
 * across to the ashtray with its fingers opening, comes down on the filter and closes on it between
 * the thumb and the index finger, lifts it out of the rest and (most times) draws it back toward the
 * smoker, holds it a breath, brings it back over the dish, flicks the ash off with the index finger,
 * lowers it into the rest until it bears, lets go and goes home. No two are the same.
 *
 * The hand moves the way a hand does (checked frame by frame against film of a hand on a counter):
 *   transport  each move across the table is a minimum-jerk path (Flash & Hogan): speed rises and
 *              falls in one smooth bell; how long it takes follows Fitts's law; it bows a little, as
 *              an arm swinging from the elbow does, and rises off the table and comes down on the way
 *   grasp      the fingers open while the hand is in flight, widest about two thirds of the way, and
 *              close as it arrives (Jeannerod), through the drawn in-between frames
 *   arm        the forearm swings about an elbow below the page and the hand turns with it (the wrist
 *              takes back a little of it), leaning into the direction it travels
 *   the rest   height, fingers, index and lean are damped springs stepped at 240 Hz, so everything has
 *              weight, overlap and settle; the planned path is tracked by stiff ones
 * The cigarette is not moved with it: it is a body (cig-physics) lying in the glass under gravity, which
 * the fingers hold by friction. Lifted, it comes up out of the groove and droops a little in the pinch;
 * the index's strike turns it about the pinch and it rings; the ash breaks off when the jolt outruns its
 * bond and falls, bouncing and crumbling, onto whatever glass is under it; lowered, it touches the bed
 * at its far end first, and let go, it settles into the groove by itself, wherever it comes to rest, and
 * lies there until the next time (it is drawn where it lies, and the hand reaches for it there).
 * Height is drawn with the art's own camera (footer-art.mjs): a raised point grows by EYE / (EYE - h)
 * and shifts (0.23, -0.05) h mm on the page; the cigarette's shadow and the hand's are thrown by the
 * art's light and soften with height; the plume trails the ember.
 */
import ART from "@/lib/footer-art.json";
import { ASH_AT, Cigarette, G, REST_AXIS, ashStep, restAt, station, type Fleck, type Grip, type V3 } from "@/lib/cig-physics";

export type BreakRig = {
  root: HTMLElement;
  hand: HTMLElement;
  cig: HTMLElement;
  shadow: HTMLElement;
  /** the class for a fleck of ash */
  fleck: string;
  /** show frame n of the hand's sheet */
  show(f: number): void;
  /** the ember in the vignette (px), its scale, and the plume's trail; null when it is back in the dish */
  ember(at: [number, number, number, number] | null): void;
};

const A = ART;
const frame = (name: string) => Math.max(0, A.hand.frames.findIndex((f) => f.name === name));
const GRASP = ["rest", "reach1", "reach2", "reach", "pinch1", "pinch2", "pinch3", "pinch"].map(frame);
const FLICK = ["pinch", "flick1", "flick"].map(frame);

const EYE = 600, PAR = [0.23, -0.05];         // the art's camera: its distance (mm) and the page shift of a raised point per mm
const HMM = A.pxPerMm, CMM = A.cig.pxPerMm;   // art px per mm: the hand's, the ashtray's
const ELBOW = [120, 500], WRIST = 0.85;       // the forearm's pivot, art px from the grip at rest; the share of its swing the hand keeps
const LEAN = 0.0009;                          // rad the hand leans into its travel, per art px/s
const STEP = 1 / 240;
const DC = A.dish.c;
const GRIP = station(A.dish.grip), Z0 = restAt(A.dish.grip)[2];
const WEIGHT = 0.75 * G;                      // near enough: what the fingers feel it bear on the glass

class Spring {
  v = 0;
  to: number;
  constructor(public x: number, public w: number, public d = 1) { this.to = x; }
  set(to: number, w = this.w, d = this.d) { this.to = to; this.w = w; this.d = d; }
  step(dt: number) { this.v += (this.w * this.w * (this.to - this.x) - 2 * this.d * this.w * this.v) * dt; this.x += this.v * dt; }
  near(e: number, ev = e * 4) { return Math.abs(this.to - this.x) < e && Math.abs(this.v) < ev; }
}

/** minimum jerk: 0..1 over 0..1, with no speed and no acceleration at either end */
const mj = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 - 15 * u + 6 * u * u));
/** Fitts: how long a practised move of `d` mm onto a target `w` mm across takes, s */
const fitts = (d: number, w: number) => 0.3 + 0.1 * Math.log2(1 + d / w);

type Move = { t0: number; T: number; x0: number; y0: number; h0: number; x1: number; y1: number; h1: number; bow: number; lift: number; hand?: (u: number) => void };
type Flake = { q: Fleck; el: HTMLElement; w: number; h: number; o: number };

const rnd = (a: number, b: number) => a + (b - a) * Math.random();
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// ---- the cigarette on the page --------------------------------------------------------------------
// The sheet it is drawn on is the dish's, in css px: a point (mm) lands at sheet(p). Its drawing is the projection of it
// lying in its rest, so drawn anywhere else it is that picture mapped by how the projections of its axis and its
// breadth have changed, scaled for height about the pinch.
const sheet = (p: V3) => [DC[0] + CMM * (0.97 * p[0] + 0.23 * p[2]), DC[1] - CMM * (p[1] + 0.05 * p[2])];
const lin = (v: V3) => [CMM * (0.97 * v[0] + 0.23 * v[2]), -CMM * (v[1] + 0.05 * v[2])];
/** level, across the axis: turning about it tips the far end down */
const across = (d: V3): V3 => { const l = Math.hypot(d[0], d[1]) || 1; return [-d[1] / l, d[0] / l, 0]; };
const ORIGIN = sheet(restAt(A.dish.grip));
const B0 = (() => {
  const a = lin(REST_AXIS), b = lin(across(REST_AXIS)), det = a[0] * b[1] - b[0] * a[1];
  return [b[1] / det, -a[1] / det, -b[0] / det, a[0] / det];          // [a0 b0]⁻¹, column-major as CSS has it
})();
const bodies = new WeakMap<HTMLElement, Cigarette>();

/** draw the cigarette where its body is, `ahead` s on (as the hand is drawn); returns its map (CSS matrix order), scale and where its pinch is in the vignette */
function place(cig: HTMLElement, shadow: HTMLElement, body: Cigarette, ahead = 0) {
  const k = cig.offsetWidth / A.tray.w, w = body.w, d0 = body.d;
  const ext = (s: number): V3 => { const p = body.at(s), v = body.vel(s); return [p[0] + v[0] * ahead, p[1] + v[1] * ahead, p[2] + v[2] * ahead]; };
  const dx = d0[0] + (w[1] * d0[2] - w[2] * d0[1]) * ahead, dy = d0[1] + (w[2] * d0[0] - w[0] * d0[2]) * ahead, dz = d0[2] + (w[0] * d0[1] - w[1] * d0[0]) * ahead, dl = Math.hypot(dx, dy, dz);
  const d: V3 = [dx / dl, dy / dl, dz / dl], g = ext(GRIP), s = EYE / (EYE - (g[2] - Z0));
  const a = lin(d), b = lin(across(d));
  const m = [(a[0] * B0[0] + b[0] * B0[1]) * s, (a[1] * B0[0] + b[1] * B0[1]) * s, (a[0] * B0[2] + b[0] * B0[3]) * s, (a[1] * B0[2] + b[1] * B0[3]) * s];
  const p = sheet(g);
  cig.style.transformOrigin = `${ORIGIN[0] * k}px ${ORIGIN[1] * k}px`;
  cig.style.transform = `translate(${(p[0] - ORIGIN[0]) * k}px, ${(p[1] - ORIGIN[1]) * k}px) matrix(${m[0]}, ${m[1]}, ${m[2]}, ${m[3]}, 0, 0)`;
  // its shadow, thrown by the art's light, parting from it and softening as its middle rises off the rest
  const z = Math.max(0, ext(body.sc)[2] - restAt(0)[2] - body.sc * REST_AXIS[2]), sk = z * CMM * k;
  shadow.style.transform = z > 0.05 ? `translate(${0.35 * sk}px, ${0.22 * sk}px)` : "";
  shadow.style.opacity = z > 0.05 ? String(1 / (1 + z / 22)) : "";
  shadow.style.filter = z > 1 ? `blur(${Math.round(z * 0.28 * k) / 4}px)` : "";
  return { m, s, at: [cig.offsetLeft + p[0] * k, cig.offsetTop + p[1] * k] };
}

/** after the vignette changes size: the cigarette drawn again where it lies */
export function cigRedraw(cig: HTMLElement, shadow: HTMLElement) {
  const body = bodies.get(cig);
  if (body) place(cig, shadow, body);
}

/** runs one break; `done(true)` when it is over, `done(false)` if `active()` went false and it snapped back */
export function cigBreak(rig: BreakRig, active: () => boolean, done: (finished: boolean) => void) {
  const { root, hand, cig, shadow } = rig;
  const k = hand.offsetWidth / A.hand.cell[0];                  // page px per art px
  const gh = A.hand.grip.pinch, gc = A.cig.grip, em = A.cig.ember;
  const H0 = [hand.offsetLeft + gh[0] * k, hand.offsetTop + gh[1] * k];
  const body = bodies.get(cig) ?? new Cigarette();
  bodies.set(cig, body);
  if (root.dataset.ash !== "gone") body.regrow();
  const arm = (x: number, y: number) => WRIST * (Math.atan2(y - ELBOW[1], x - ELBOW[0]) - Math.atan2(-ELBOW[1], -ELBOW[0]));
  // the hand's pinch (art px from home, mm up) as a point in the world, and where the hand must be to pinch a point
  const sheetH = [(H0[0] - cig.offsetLeft) / k, (H0[1] - cig.offsetTop) / k];
  const world = (x: number, y: number, z: number): V3 => {
    const sx = sheetH[0] + x + PAR[0] * z * HMM, sy = sheetH[1] + y + PAR[1] * z * HMM, Z = Z0 + z;
    return [((sx - DC[0]) / CMM - 0.23 * Z) / 0.97, (DC[1] - sy) / CMM - 0.05 * Z, Z];
  };
  const reach = (p: V3) => {
    const s = sheet(p), z = p[2] - Z0;
    return [s[0] - sheetH[0] - PAR[0] * z * HMM, s[1] - sheetH[1] - PAR[1] * z * HMM, z];
  };
  // in the fingers the cigarette lies over the thumb and under the index: drawn over the hand, with the filter's end, from
  // just past the grip, masked away under the finger; a gradient across its length, in the sheet's own frame, so it goes
  // where the sheet goes. `mm` is how far past the grip toward the ember the finger covers (less as it lifts to tap)
  const ang = (A.cig.angle * Math.PI) / 180, ax = Math.cos(ang), ay = Math.sin(ang);
  const cw = cig.offsetWidth, ch = cig.offsetHeight, glen = Math.abs(cw * ax) + Math.abs(ch * ay);
  const sGrip = (gc[0] * k - cw / 2) * ax + (gc[1] * k - ch / 2) * ay + glen / 2;
  const bite = (mm: number) => { const s = sGrip + mm * CMM * k; return `linear-gradient(${A.cig.angle + 90}deg, transparent ${s - 0.75}px, #000 ${s + 0.75}px)`; };
  const hbody = hand.firstElementChild as HTMLElement | null;     // the hand's paper: its silhouette casts the hand's shadow

  const Px = new Spring(0, 24), Py = new Spring(0, 24), h = new Spring(0, 24), g = new Spring(0, 12), f = new Spring(0, 20), lean = new Spring(0, 9, 0.8);
  const springs = [Px, Py, h, g, f, lean];

  hand.style.transition = "none";
  hand.style.transformOrigin = `${gh[0] * k}px ${gh[1] * k}px`;
  root.dataset.break = "";

  let raf = 0, last = 0, t = 0, acc = 0, over = false, shown = -1, strikes = 0, armed = false, drift = 0, prevE: number[] | null = null;
  let move: Move | null = null, rPrev = arm(0, 0);
  // the fingers on it, and from the moment they bite, the point of it they hold and its axis, in the hand's frame
  let holding = false, pinch: { off: V3; axis: V3; r: number } | null = null;
  // the ash's bond: the jolt across the axis (mm/s within a step) it takes to break it, weaker after each blow that didn't
  let bond = rnd(480, 640);
  // drawn a part-step ahead of the last physics step, by the time the frame has left over: frames don't land on steps,
  // and drawing whole steps (one, two or three a frame) makes even motion stutter
  let ahead = 0, onTop = false;
  const X = (sp: Spring) => sp.x + sp.v * ahead;
  const flakes: Flake[] = [];
  const waits: { ok: () => boolean; go: () => void }[] = [];
  const until = (ok: () => boolean) => new Promise<void>((go) => waits.push({ ok: () => over || ok(), go }));
  const wait = (ms: number) => { const end = t + ms / 1000; return until(() => t >= end); };

  /** carry the hand to (x, y) art px from home and h1 mm up; resolves when the planned path ends */
  const go = (x: number, y: number, h1: number, o: { w?: number; T?: number; bow?: number; lift?: number; hand?: (u: number) => void } = {}) => {
    const x0 = Px.to, y0 = Py.to, d = Math.hypot(x - x0, y - y0) / HMM;
    const mine: Move = { t0: t, T: (o.T ?? fitts(d, o.w ?? 10)) * rnd(0.92, 1.08), x0, y0, h0: h.to, x1: x, y1: y, h1, bow: (o.bow ?? 0.06) * d * HMM, lift: o.lift ?? 0, hand: o.hand };
    move = mine;
    return until(() => move !== mine);
  };
  const steer = () => {
    if (!move) return;
    const m = move, u = (t - m.t0) / m.T, s = mj(u), b = Math.sin(Math.PI * s);
    const dx = m.x1 - m.x0, dy = m.y1 - m.y0, n = Math.hypot(dx, dy) || 1;
    Px.to = m.x0 + dx * s - (dy / n) * m.bow * b;
    Py.to = m.y0 + dy * s + (dx / n) * m.bow * b;
    h.to = m.h0 + (m.h1 - m.h0) * s + m.lift * b;
    m.hand?.(clamp(u, 0, 1));
    if (u >= 1) move = null;
  };
  /** stop where it is */
  const halt = () => { move = null; Px.to = Px.x; Py.to = Py.x; h.to = h.x; };

  /** the fingers' hold this step, from the hand's pose: how hard (by how closed), where they have the held point and which way its axis */
  const grip = (r: number, dr: number): Grip | null => {
    const on = holding ? clamp((g.x - 4.6) / 2, 0, 1) * (f.x > 0.5 ? 0.8 : 1) : 0;
    if (on <= 0) { pinch = null; return null; }
    const P = world(Px.x, Py.x, h.x);
    if (!pinch) { const c = body.at(GRIP); pinch = { off: [c[0] - P[0], c[1] - P[1], c[2] - P[2]], axis: [...body.d], r }; }
    // the page turns clockwise, the world about +z the other way
    const q = pinch.r - r, cq = Math.cos(q), sq = Math.sin(q), o = pinch.off, a = pinch.axis, wz = -dr;
    const off: V3 = [o[0] * cq - o[1] * sq, o[0] * sq + o[1] * cq, o[2]];
    // its velocity: the hand's, and the hand's turn carrying the held point round
    const vz = h.v, sx = Px.v + PAR[0] * vz * HMM, sy = Py.v + PAR[1] * vz * HMM;
    const vel: V3 = [(sx / CMM - 0.23 * vz) / 0.97 - wz * off[1], -sy / CMM - 0.05 * vz + wz * off[0], vz];
    return { on, at: GRIP, to: [P[0] + off[0], P[1] + off[1], P[2] + off[2]], vel, axis: [a[0] * cq - a[1] * sq, a[0] * sq + a[1] * cq, a[2]], wz };
  };

  const pose = () => {
    const z = X(h), x = X(Px), y = X(Py);
    return { z, s: EYE / (EYE - z), r: arm(x, y) + X(lean), gx: x + PAR[0] * z * HMM, gy: y + PAR[1] * z * HMM };
  };

  const draw = (dt: number) => {
    const { z, s, r, gx, gy } = pose();
    hand.style.transform = `translate(${gx * k}px, ${gy * k}px) rotate(${r}rad) scale(${s})`;
    // its shadow, by the same light as the cigarette's, parting from it as it lifts (the drawn one is its shadow on the table)
    if (hbody) {
      const sh = (Math.max(0, z) * HMM * k) / s, ox = 0.35 * sh, oy = 0.22 * sh, cr = Math.cos(r), sr = Math.sin(r);   // into the hand's turned frame
      hbody.style.filter = z > 0.5 ? `drop-shadow(${ox * cr + oy * sr}px ${oy * cr - ox * sr}px ${(z * 0.12 * k) / s}px rgb(26 25 23 / ${(0.2 * Math.min(1, z / 8)) / (1 + z / 40)}))` : "";
    }
    const mask = onTop ? bite(1.5 - 12 * clamp(X(f) / 2, 0, 1)) : "";
    cig.style.maskImage = cig.style.webkitMaskImage = mask;
    const n = holding && f.x > 0.5 ? FLICK[clamp(Math.round(f.x), 0, 2)] : GRASP[clamp(Math.round(g.x), 0, 7)];
    if (n !== shown) rig.show((shown = n));
    // the cigarette where its body is, as far ahead as the hand
    const c = place(cig, shadow, body, body.asleep ? 0 : ahead);
    for (const fl of flakes) {
      const q = fl.q, p = sheet([q.x, q.y, q.z]), o = fl.o * (q.landed ? 1 - clamp((t - q.landed - 0.6) / 1.8, 0, 1) : 1);
      fl.el.style.opacity = String(o);
      fl.el.style.transform = `translate(${cig.offsetLeft + p[0] * k - fl.w / 2}px, ${cig.offsetTop + p[1] * k - fl.h / 2}px) rotate(${q.a}rad) scale(${EYE / (EYE - (q.z - A.dish.zf))})`;
    }
    if (!holding && body.asleep) { if (prevE) { prevE = null; rig.ember(null); } return; }
    // the ember, where the sheet's map puts it, for the plume
    const ex = (em[0] - ORIGIN[0]) * k, ey = (em[1] - ORIGIN[1]) * k;
    const E = [c.at[0] + c.m[0] * ex + c.m[2] * ey, c.at[1] + c.m[1] * ex + c.m[3] * ey];
    if (prevE && dt > 0) drift += (clamp(-(E[0] - prevE[0]) / dt / k / 320, -0.35, 0.35) - drift) * (1 - Math.exp(-dt / 0.35));
    prevE = E;
    rig.ember([E[0], E[1], k * c.s, drift]);
  };

  const flake = (q: Fleck, o: number) => {
    const el = document.createElement("i"), w = 2 * q.r * CMM * k * (q.big ? 1 : rnd(1, 1.3)), hh = q.big ? w * 0.62 : w * rnd(0.7, 1);
    el.className = rig.fleck;
    Object.assign(el.style, { left: "0", top: "0", width: `${w}px`, height: `${hh}px` });
    root.appendChild(el);
    flakes.push({ q, el, w, h: hh, o });
  };
  /** the ash breaks off, moving as it was when its bond gave: a clump and its crumbs, through where it was */
  const shed = (v: V3) => {
    root.dataset.ash = "gone";
    window.setTimeout(() => { if (root.dataset.ash === "gone") root.dataset.ash = "grow"; }, 450);
    const { p } = body.shed(), d = body.d, sd = across(d);
    const up = [d[1] * sd[2] - d[2] * sd[1], d[2] * sd[0] - d[0] * sd[2], d[0] * sd[1] - d[1] * sd[0]];
    for (let i = 0; i < 8; i++) {
      const big = i === 0, r = big ? rnd(2.4, 3) : rnd(0.35, 0.8), along = big ? 0 : rnd(-4, 4), a = rnd(0, 2 * Math.PI), rr = big ? 0 : rnd(0, 3);
      const o = (j: number) => p[j] + d[j] * along + (sd[j] * Math.cos(a) + up[j] * Math.sin(a)) * rr;
      flake({ x: o(0), y: o(1), z: o(2), vx: v[0] + rnd(-20, 20), vy: v[1] + rnd(-20, 20), vz: v[2] + rnd(-10, 25), r, m: r ** 3,
        a: Math.atan2(-d[1], d[0]) + rnd(-0.2, 0.2), spin: big ? rnd(-2, 2) : rnd(-8, 8), big, broke: !big, still: 0, landed: 0 }, big ? 0.22 : rnd(0.25, 0.4));
    }
  };
  const fall = (dt: number) => {
    if (!flakes.length) return;
    for (const q of ashStep(flakes.map((fl) => fl.q), dt, t, body)) flake(q, rnd(0.25, 0.4));
    for (let i = flakes.length - 1; i >= 0; i--) if (flakes[i].q.landed && t - flakes[i].q.landed > 2.4) { flakes[i].el.remove(); flakes.splice(i, 1); }
  };

  const reset = (keep: boolean) => {
    cancelAnimationFrame(raf);
    hand.style.transform = hand.style.transformOrigin = cig.style.maskImage = cig.style.webkitMaskImage = "";
    if (hbody) hbody.style.filter = "";
    // the cigarette stays where it lies, unless the break was cut short: then it is back in its rest as drawn
    if (!keep) {
      bodies.delete(cig);
      cig.style.transform = cig.style.transformOrigin = shadow.style.transform = shadow.style.opacity = shadow.style.filter = "";
    }
    delete root.dataset.held;
    for (const fl of flakes) fl.el.remove();
    flakes.length = 0;
    delete root.dataset.break;
    rig.ember(null);
    // the entrance's transition back once this frame has settled, or the snap home would animate
    requestAnimationFrame(() => { hand.style.transition = ""; });
  };
  const finish = (ok: boolean) => {
    if (over) return;
    over = true;
    reset(ok);
    rig.show(GRASP[0]);
    for (const w of waits.splice(0)) w.go();
    done(ok);
  };

  const tick = (now: number) => {
    if (over) return;
    if (!active()) return finish(false);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    acc += dt;
    while (acc >= STEP) {
      acc -= STEP; t += STEP;
      steer();
      lean.to = clamp(Px.v * LEAN, -0.07, 0.07);
      const fBefore = f.x;
      for (const sp of springs) sp.step(STEP);
      const r = arm(Px.x, Py.x) + lean.x, dr = (r - rPrev) / STEP;
      rPrev = r;
      const before = holding && !body.ashed ? body.vel(ASH_AT) : null;
      // the strike: the index comes down on it past the pinch and turns it about the pinch, tip down; the hand gives a little
      if (holding && armed && fBefore > 0.3 && f.x <= 0.3 && f.v < 0) {
        armed = false;
        body.strike(GRIP, across(body.d), rnd(8.5, 11) * (strikes++ ? 0.85 : 1));
        h.v -= 45;
      }
      body.step(STEP, grip(r, dr));
      // the ash goes when the jolt across the axis outruns its bond, keeping what of the jolt the bond passed on before it broke
      if (before && !body.ashed) {
        const after = body.vel(ASH_AT), d = body.d, j = [after[0] - before[0], after[1] - before[1], after[2] - before[2]];
        const jd = j[0] * d[0] + j[1] * d[1] + j[2] * d[2], jl = Math.hypot(j[0] - jd * d[0], j[1] - jd * d[1], j[2] - jd * d[2]);
        if (jl > bond) { const s = bond / jl; shed([before[0] + j[0] * s, before[1] + j[1] * s, before[2] + j[2] * s]); }
        else if (jl > 150) bond *= 0.8;
      }
      fall(STEP);
    }
    ahead = acc;
    draw(dt);
    ahead = 0;
    for (let i = waits.length - 1; i >= 0; i--) if (waits[i].ok()) waits.splice(i, 1)[0].go();
    if (t > 32) return finish(true);                              // never stuck
    raf = requestAnimationFrame(tick);
  };

  const script = async () => {
    // where it lies now (in its rest, or near it), and the rest as drawn, where it goes back to
    const R = reach(body.at(GRIP)), HOME = reach(restAt(A.dish.grip));
    // weight shifts, the fingers begin to open, the hand comes up off the table
    g.set(1, 10); await go(rnd(2, 4), rnd(-1, 1), 2.5, { T: rnd(0.22, 0.32), bow: 0 });
    // across, the fingers opening in flight, widest two thirds of the way, closing round the filter as it lands
    await go(R[0], R[1], R[2], { w: 8, bow: rnd(0.04, 0.09), lift: rnd(9, 13), hand: (u) => g.set(u < 0.65 ? 1 + (2 * u) / 0.65 : 3 + (2 * (u - 0.65)) / 0.35, 16) });
    // landed on the filter: the thumb goes under it, the index over it, and the fingers close on it as the hand settles;
    // they have it once they are closed and the hand is still (its lean out of its travel spent): from there it goes where they go
    onTop = true; root.dataset.held = "";
    g.set(7, 15, 1); await until(() => g.x > 6.8 && lean.near(0.002) && Math.hypot(Px.v, Py.v) < 2);
    if (over) return;
    holding = true;
    await wait(rnd(100, 200));
    // out of the groove: up until it is clear of the rim, then up and away
    await go(R[0] + rnd(0.5, 1.5), R[1] + rnd(0, 1), R[2] + rnd(6.5, 8), { T: rnd(0.26, 0.32), bow: 0 });
    await go(R[0] + rnd(5, 9), R[1] + rnd(3, 6), rnd(12, 16), { T: rnd(0.32, 0.4), bow: 0 });
    if (Math.random() < 0.85) {
      // drawn back toward the smoker, and held a breath, never quite still
      await go(HOME[0] * 0.45 + rnd(6, 14), HOME[1] * 0.45 + rnd(30, 38), rnd(32, 40), { w: 25, bow: rnd(-0.08, -0.03) });
      const end = t + rnd(1.4, 3);
      while (t < end && !over) await go(Px.to + rnd(-2.5, 2.5), Py.to + rnd(-2, 2), h.to + rnd(-2.5, 2.5), { T: rnd(0.5, 0.8), bow: 0 });
    } else await wait(rnd(400, 800));
    // back over the dish, a little short of the rest and high enough to tap
    await go(HOME[0] + rnd(-5, -1), HOME[1] + rnd(3, 7), rnd(14, 18), { w: 6, bow: rnd(0.03, 0.07) });
    await wait(rnd(80, 180));
    // the taps: one, two or three, each a little softer, and more while the ash holds
    const taps = Math.random() < 0.25 ? 1 : Math.random() < 0.7 ? 2 : 3;
    for (let i = 0; (i < taps || !body.ashed) && i < 5 && !over; i++) {
      f.set(2, 19, 0.95); await until(() => f.x > 1.75);
      await wait(rnd(40, 110));
      armed = true; f.set(0, 46 - i * 4, 0.6);
      await wait(rnd(300, 430));
    }
    f.set(0, 20, 1); await wait(rnd(150, 280));
    // over the rest and a little above it, then down slowly until it bears on the glass
    await go(HOME[0], HOME[1], rnd(4, 5.5), { w: 4, bow: 0, lift: 2 });
    await until(() => Math.hypot(Px.x - HOME[0], Py.x - HOME[1]) < 0.5 && lean.near(0.003));
    void go(HOME[0], HOME[1], -0.5, { T: rnd(0.55, 0.7), bow: 0 });
    await until(() => body.load > 0.35 * WEIGHT || !move);
    halt();
    await wait(rnd(60, 120));
    if (over) return;
    // let go: the fingers open off it, and it settles into the groove by itself
    g.set(3, 12);
    await until(() => g.x < 4.6);
    holding = false;
    await go(Px.to + rnd(2, 4), Py.to + rnd(1, 3), h.to + 4, { T: rnd(0.24, 0.32), bow: 0 });
    onTop = false; delete root.dataset.held;                     // the hand is off it, and above it again
    // home, the fingers relaxing on the way, settling with a little give
    await go(0, 0, 0, { w: 14, bow: rnd(-0.07, -0.03), lift: rnd(4, 7), hand: (u) => g.set(3 * (1 - u), 9) });
    g.set(0, 6);
    await until(() => Math.hypot(Px.x, Py.x) < 0.3 && h.near(0.2) && g.near(0.05) && lean.near(0.002) && body.asleep);
    const end = t + 3;
    await until(() => !flakes.length || t > end);
    finish(true);
  };

  raf = requestAnimationFrame(tick);
  void script();
  return { stop: () => finish(false) };
}
