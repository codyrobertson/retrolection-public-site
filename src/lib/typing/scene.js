// 01 / TYPING — two graphite hands on a retro round-key keyboard.
//
// Hands and keyboard share one orthographic camera and one world: the right hand's
// rig frame (rig units; the rig's hand is 164 long, so a desk millimetre is
// 164 / handMm units). Every keystroke is an IK solve onto a real key, and every key
// travels in the same space. The left hand is the right model drawn mirrored about
// the F–J midline, so its targets are the right hand's targets reflected.
//
// Nothing here touches the DOM or Node: the same scene runs in the browser's
// workers (live) and in scripts/typing-check.mjs (headless checks).

import { legendStrokes } from './font.js';

const DEG = Math.PI / 180;
export const INK = [26, 25, 23];
export const PAPER = [244, 241, 232];

export const DEFAULTS = {
  X: 1,            // device px per layout px: the sheet a hand is drawn on is 900·X square
  ss: 2,           // graphite supersampling
  el: -14,         // camera tilt off straight down, degrees: near overhead, as a hand is seen from above
  yaw: 13.2,       // degrees the forearms come in from the elbows
  pron: 0.18,      // forearm roll, -1..1 (positive: thumb side up)
  dev: -0.33,      // wrist deviation, -1..1
  hand: 188,       // wrist-to-fingertip, mm
  thumb: [0.55, 0.22, 0.3, 0.1, 0.1],     // [cmcRad, cmcAbd, cmcOpp, mcp, ip], where the thumb starts before it finds the bar
  pinky: [0.29, 0.16, 0.11, 0.02],        // little finger start for its IK: [mcp, pip, dip, abd]
  curl: 0.6,       // how far the fingers bend on the keys: 1 arched, toward 0 long and flat
  weight: 1.575,   // contour weight, layout px
  clear: 8,        // mm the hands must stay apart
};

const LAYERS = { hatch: false, hair: false, tendon: false, vein: false, ridge: false, print: false };
const STYLE = { grade: 3.2, tone: 1.2, wobble: 0.75, ghost: 0.05, paper: [255, 255, 255], ink: INK };
const SEED = 12345;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const clone = (p) => JSON.parse(JSON.stringify(p));

/**
 * ink coverage straight from a deposit buffer (no paper, no vignette), over a rect of the logical
 * image. The whole sheet comes back in one scratch per Graphite (read it before the next call);
 * `hit`, if given, grows to the box of what reads as ink (> 0.004).
 */
function inkAlpha(g, x0 = 0, y0 = 0, w = g.w, h = g.h, hit = null) {
  const { ss, W: GW, buf } = g, inv = 1 / (ss * ss);
  const full = x0 === 0 && y0 === 0 && w === g.w && h === g.h;
  let out;
  if (full) {
    out = g._alpha;
    if (!out || out.length !== w * h) out = g._alpha = new Float32Array(w * h);
    else if (g._alphaBox) { const B = g._alphaBox; for (let y = B.ya; y <= B.yb; y++) out.fill(0, y * w + B.xa, y * w + B.xb + 1); }
    g._alphaBox = null;
  } else out = new Float32Array(w * h);
  // bare paper reads back as exactly 0, which `out` already is: only the box the pencil touched is read,
  // and in it only the tiles it has been in (an ss×ss cell never straddles a tile when ss divides 32)
  const D = g.dirty();
  if (!D) return out;
  const ya = Math.max(0, D.y0 - y0), yb = Math.min(h - 1, D.y1 - y0), xa = Math.max(0, D.x0 - x0), xb = Math.min(w - 1, D.x1 - x0);
  if (full) g._alphaBox = { xa, xb, ya, yb };
  const tiled = 32 % ss === 0, T = g.touched, TW = g.TW;
  for (let y = ya; y <= yb; y++) {
    const trow = tiled ? (((y + y0) * ss) >> 5) * TW : 0;
    for (let x = xa; x <= xb; x++) {
      if (tiled && !T[trow + (((x + x0) * ss) >> 5)]) continue;
      let d = 0;
      for (let sy = 0; sy < ss; sy++) { const row = ((y + y0) * ss + sy) * GW + (x + x0) * ss; for (let sx = 0; sx < ss; sx++) d += buf[row + sx]; }
      const v = clamp01((1 - Math.exp(-1.55 * d * inv)) * 1.05 - 0.01);
      out[y * w + x] = v;
      if (hit !== null && v > 0.004) { if (x < hit.x0) hit.x0 = x; if (x > hit.x1) hit.x1 = x; if (y < hit.y0) hit.y0 = y; if (y > hit.y1) hit.y1 = y; }
    }
  }
  return out;
}

/** the union of the pencil's touched box and the depth field's covered cells, in px of an S×S
 * sheet ([x0, y0, x1, y1] inclusive): outside it a layer has neither ink nor paper */
function scanBox(g, df, S) {
  let x0 = S, y0 = S, x1 = -1, y1 = -1;
  const D = g.dirty();
  if (D) { x0 = D.x0; y0 = D.y0; x1 = D.x1; y1 = D.y1; }
  const { div, w: dw, i0 } = df, dh = (i0.length / dw) | 0;
  for (let cy = 0; cy < dh; cy++) for (let cx = 0; cx < dw; cx++) if (i0[cy * dw + cx] >= 0) {
    if (cx * div < x0) x0 = cx * div; if (cx * div + div - 1 > x1) x1 = cx * div + div - 1;
    if (cy * div < y0) y0 = cy * div; if (cy * div + div - 1 > y1) y1 = cy * div + div - 1;
  }
  return [Math.max(0, x0), Math.max(0, y0), Math.min(S - 1, x1), Math.min(S - 1, y1)];
}

// ---- keyboard layout (key units; u across, v toward the typist; J is at u 8.25, v 2.5) ----
function buildKeys() {
  const keys = [];
  const key = (legend, u0, v0, w = 1, h = 1, name) => keys.push({ id: keys.length, legend, name: name || legend, u0, v0, u1: u0 + w, v1: v0 + h });
  key('ESC', 0, -1.5);
  ['F1', 'F2', 'F3', 'F4'].forEach((l, i) => key(l, 2 + i, -1.5));
  ['F5', 'F6', 'F7', 'F8'].forEach((l, i) => key(l, 6.5 + i, -1.5));
  ['F9', 'F10', 'F11', 'F12'].forEach((l, i) => key(l, 11 + i, -1.5));
  const ROWS = [
    [['`', 1], ['1', 1], ['2', 1], ['3', 1], ['4', 1], ['5', 1], ['6', 1], ['7', 1], ['8', 1], ['9', 1], ['0', 1], ['-', 1], ['=', 1], ['BACK', 2]],
    [['TAB', 1.5], ['Q', 1], ['W', 1], ['E', 1], ['R', 1], ['T', 1], ['Y', 1], ['U', 1], ['I', 1], ['O', 1], ['P', 1], ['[', 1], [']', 1], ['\\', 1.5]],
    [['CAPS', 1.75], ['A', 1], ['S', 1], ['D', 1], ['F', 1], ['G', 1], ['H', 1], ['J', 1], ['K', 1], ['L', 1], [';', 1], ["'", 1], ['ENTER', 2.25]],
    [['SHIFT', 2.25, 'LSHIFT'], ['Z', 1], ['X', 1], ['C', 1], ['V', 1], ['B', 1], ['N', 1], ['M', 1], [',', 1], ['.', 1], ['/', 1], ['SHIFT', 2.75, 'RSHIFT']],
    [['CTRL', 1.25, 'LCTRL'], ['WIN', 1.25], ['ALT', 1.25, 'LALT'], ['', 6.25, 'SPACE'], ['ALT', 1.25, 'RALT'], ['FN', 1.25], ['MENU', 1.25], ['CTRL', 1.25, 'RCTRL']],
  ];
  ROWS.forEach((row, r) => { let u = 0; for (const [l, w, name] of row) { key(l, u, r, w, 1, name); u += w; } });
  return keys;
}
// compact: the board is the main block alone, F12 and the right CTRL its last keys
const BEZEL = { u0: -0.62, u1: 15.62, v0: -2.15, v1: 5.6 };

// touch-typing: which hand and digit (1 index .. 4 little, 0 thumb) owns each key
const OWNER = {};
for (const [hand, d, names] of [
  ['L', 4, 'Q A Z 1 ` TAB CAPS LSHIFT'], ['L', 3, 'W S X 2'], ['L', 2, 'E D C 3'], ['L', 1, 'R F V T G B 4 5'],
  ['R', 1, 'Y H N U J M 6 7'], ['R', 2, 'I K , 8'], ['R', 3, 'O L . 9'], ['R', 4, "P ; / 0 - = [ ] ' \\ ENTER BACK RSHIFT"],
]) for (const n of names.split(' ')) OWNER[n] = [hand, d];
OWNER.SPACE = ['R', 0];
const SHIFTED = { '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', _: '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`' };

/** the key and finger that type a character, and whether shift is held (by the other hand's little finger) */
// Ctrl+V: the left little finger holds CTRL while the index takes V
export const PASTE = '\u0016';
export function strokeFor(ch) {
  if (ch === PASTE) return { name: 'V', hand: 'L', d: 1, shift: false, ctrl: true };
  if (ch === ' ') return { name: 'SPACE', hand: 'R', d: 0, shift: false };
  if (ch === '\n') return { name: 'ENTER', hand: 'R', d: 4, shift: false };
  let name = ch, shift = false;
  if (/[a-z]/.test(ch)) name = ch.toUpperCase();
  else if (/[A-Z]/.test(ch)) shift = true;
  else if (SHIFTED[ch]) { name = SHIFTED[ch]; shift = true; }
  let own = OWNER[name];
  if (!own) {                                                  // an accented letter: its plain key
    const base = ch.normalize('NFD')[0];
    if (base !== ch) return strokeFor(base);
    return null;
  }
  return { name, hand: own[0], d: own[1], shift };
}

export function createScene(GK, overrides = {}) {
  const P = { ...DEFAULTS, ...overrides };
  const { math: M, pose: PO, render: RE, pencil: PEN } = GK;
  const X = P.X, HS = Math.round(900 * X), WEIGHT = P.weight * X;
  const VIEW = { az: 0, el: P.el * DEG, roll: 0 };
  const YAW = P.yaw * DEG;
  const bend = ([m, p, d, a]) => [m * P.curl, p * P.curl, d * P.curl, a];
  const HOME_SPEC = {
    wrist: [0.05, P.dev, P.pron], arch: 0.2, thumb: P.thumb,
    f: [...[[0.26, 0.50, 0.22, 0.04], [0.24, 0.50, 0.22, 0], [0.12, 0.34, 0.14, -0.02]].map(bend), P.pinky],
  };

  // ---- the hand renderer ----------------------------------------------------------
  const R = new RE.Renderer(HS, HS);
  const A = GK.anatomy.buildAnatomy(SEED, { chirality: 'right' }); R._an = A; R._anSeed = SEED;
  R.g = new PEN.Graphite(HS, HS, P.ss, SEED);
  const baseStroke = R.g.stroke.bind(R.g);
  R.g.stroke = (pts, o) => baseStroke(pts, Object.assign({}, o, { weight: (o && o.weight !== undefined ? o.weight : 1) * WEIGHT }));
  const boils = [0, 1, 2].map((n) => new M.Noise(SEED * 7 + n * 101));
  const draw = (pose, view, fit, quality) =>
    R.draw({ seed: SEED, pose, view, fit, style: STYLE, layers: LAYERS, detail: { shade: 0.7 }, quality, contacts: false });

  // pinned framing: the home pose's knuckle span becomes 330 layout px, wrists on the sheet's foot
  const home0 = PO.clampPose(A, PO.mk(A, HOME_SPEC));
  const probe = R.build({ seed: SEED, pose: home0, view: VIEW, quality: 0, margin: 0.4 });
  const pfit = { scale: probe.view.scale, cx: probe.view.cx, cy: probe.view.cy };
  draw(home0, VIEW, pfit, 0);
  let bx0 = 1e9, bx1 = -1e9, by1 = -1e9;
  {
    const a0 = inkAlpha(R.g);
    for (let y = 0; y < HS; y++) for (let x = 0; x < HS; x++) if (a0[y * HS + x] > 0.25) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
  }
  const k = (330 * X) / (bx1 - bx0);
  const FIT = { scale: pfit.scale * k, cx: HS / 2 - ((bx0 + bx1) / 2 - pfit.cx) * k, cy: HS - 4 - (by1 - pfit.cy) * k };
  const viewAt = (roll) => R.build({ seed: SEED, pose: home0, view: { ...VIEW, roll }, fit: FIT, quality: 0, contacts: false }).view;
  const VIEWOBJ = viewAt(0);

  // the forearms come in from the elbows, so each hand sits yawed on the desk: it is drawn
  // through a rolled camera, and desk points reach the rig through the same turn about the eye axis
  const rotE = (Pt, a) => {
    const e = VIEWOBJ.e, c = Math.cos(a), s = Math.sin(a), d = M.vdot(e, Pt), x = M.vcross(e, Pt);
    return [0, 1, 2].map((i) => Pt[i] * c + x[i] * s + e[i] * d * (1 - c));
  };
  let VIEW_H = null, VIEWH = null, SPIN = 0;
  for (const roll of [YAW, -YAW]) {
    const v = viewAt(roll);
    // test the forearm, not the hand (deviation turns the hand): this roll sends the right forearm down and out
    if (v.px([-100, 0, 0])[0] < v.px([0, 0, 0])[0]) { VIEW_H = { ...VIEW, roll }; VIEWH = v; break; }
  }
  if (!VIEWH) { VIEW_H = VIEW; VIEWH = VIEWOBJ; }
  for (const a of [YAW, -YAW]) {
    const q = [30, 20, -10], p0 = VIEWOBJ.px(rotE(q, a)), p1 = VIEWH.px(q);
    if (Math.hypot(p0[0] - p1[0], p0[1] - p1[1]) < 1e-6) SPIN = a;
  }

  // ---- the world: key units on the desk -------------------------------------------
  // +X distal (away from the typist), +Y ulnar (screen right), +Z palmar (down)
  const MM = 164 / P.hand, U = 19.05 * MM;
  const rig0 = GK.rig.solve(A, home0);
  const tipsHome = rig0.digits.map((d) => d.tip);
  const Z_TOP = (tipsHome[1][2] + tipsHome[2][2] + tipsHome[3][2]) / 3 + 3 * MM;   // cap tops: tips rest 3mm above
  const CAP = 3.6 * MM, TRAVEL = 4.0 * MM, STEM = 6.0 * MM;
  const Z_PLATE = Z_TOP + CAP + STEM, Z_FRAME = Z_TOP + 1.5 * MM;
  const uJ = 8.25, vJ = 2.5, uMid = (uJ + 5.25) / 2;
  const world = (u, v, z) => [tipsHome[1][0] - (v - vJ) * U, tipsHome[1][1] + (u - uJ) * U, z];
  const P0 = tipsHome[1];                                   // desk <-> rig pivot: J stays under the index
  const toRig = (Pt) => M.vadd(P0, rotE(M.vsub(Pt, P0), -SPIN));
  const toDesk = (Pt) => M.vadd(P0, rotE(M.vsub(Pt, P0), SPIN));
  const deskUV = (Pt) => { const D = toDesk(Pt); return { u: uJ + (D[1] - P0[1]) / U, v: vJ - (D[0] - P0[0]) / U, h: (Z_TOP - D[2]) / MM }; };
  const mirrorU = (u) => 2 * uMid - u;
  const DELTA = (() => { const a = VIEWOBJ.px(P0), b = VIEWH.px(P0); return [a[0] - b[0], a[1] - b[1]]; })();

  // ---- projection into the panel ----------------------------------------------------
  let OFF = [0, 0];
  const scr = (Pt) => { const p = VIEWOBJ.px(Pt); return [p[0] + OFF[0], p[1] + OFF[1]]; };
  const S = (u, v, z) => scr(world(u, v, z));
  const corners = [S(BEZEL.u0, BEZEL.v0, Z_FRAME), S(BEZEL.u1, BEZEL.v0, Z_FRAME), S(BEZEL.u0, BEZEL.v1, Z_FRAME + 16 * MM), S(BEZEL.u1, BEZEL.v1, Z_FRAME + 16 * MM)];
  const KX0 = Math.min(...corners.map((p) => p[0])), KX1 = Math.max(...corners.map((p) => p[0]));
  const KY0 = Math.min(...corners.map((p) => p[1])), KY1 = Math.max(...corners.map((p) => p[1]));
  const MARGIN = Math.round(28 * X);
  OFF = [MARGIN - KX0, MARGIN - KY0];
  const PW = Math.round(KX1 - KX0 + 2 * MARGIN);
  const PH = Math.round(OFF[1] + HS - 12 * X);
  const posR = [OFF[0] + DELTA[0], OFF[1] + DELTA[1]];
  const XM = S(uMid, vJ, Z_TOP)[0];
  const posL = [2 * XM - posR[0] - (HS - 1), posR[1]];
  const keyboardRect = { x: MARGIN, y: MARGIN, w: Math.round(KX1 - KX0), h: Math.round(KY1 - KY0) };

  // ---- keyboard ---------------------------------------------------------------------
  const keys = buildKeys();
  const byName = new Map(keys.map((kk) => [kk.name, kk]));
  /** capsule outline of a key inset from its footprint: [u, v] samples with outward normals */
  const capsule = (kk, insetU, extraMm = 0) => {
    const e = (extraMm * MM) / U;
    const a0 = kk.u0 + insetU, a1 = kk.u1 - insetU, b0 = kk.v0 + insetU, b1 = kk.v1 - insetU;
    const r = Math.min(a1 - a0, b1 - b0) / 2 + e;
    const cu0 = a0 + r - e, cu1 = a1 - r + e, cv0 = b0 + r - e, cv1 = b1 - r + e;
    const pts = [];
    for (const [cu, cv, a] of [[cu1, cv0, -90], [cu1, cv1, 0], [cu0, cv1, 90], [cu0, cv0, 180]]) for (let j = 0; j <= 12; j++) {
      const t = (a + (90 * j) / 12) * DEG;
      pts.push({ u: cu + Math.cos(t) * r, v: cv + Math.sin(t) * r, nu: Math.cos(t), nv: Math.sin(t) });
    }
    return pts;
  };
  // each key's screen box, pressed or not, for patch regions and culling
  for (const kk of keys) {
    const pts = capsule(kk, 0).flatMap((p) => [S(p.u, p.v, Z_TOP), S(p.u, p.v, Z_PLATE + 1)]);
    kk.box = {
      x0: Math.min(...pts.map((p) => p[0])) - 4 * X, x1: Math.max(...pts.map((p) => p[0])) + 4 * X,
      y0: Math.min(...pts.map((p) => p[1])) - 4 * X, y1: Math.max(...pts.map((p) => p[1])) + 4 * X,
    };
  }
  let kg = null, occ = null;
  const GRADE = PEN.gradeAt(3.2);
  /** mark a convex polygon's pixels in a mask: the cap silhouettes (occ), or a shading area's bit */
  function fillConvex(pts, buf = occ, bit = 1) {
    const Q = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const p of Q) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of Q.slice().reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    const hull = lo.slice(0, -1).concat(hi.slice(0, -1));
    const y0 = Math.max(0, Math.floor(Math.min(...hull.map((p) => p[1])))), y1 = Math.min(PH - 1, Math.ceil(Math.max(...hull.map((p) => p[1]))));
    for (let y = y0; y <= y1; y++) {
      let xa = 1e9, xb = -1e9;
      for (let i = 0; i < hull.length; i++) {
        const a = hull[i], b = hull[(i + 1) % hull.length];
        if ((a[1] <= y && b[1] >= y) || (b[1] <= y && a[1] >= y)) {
          const x = a[1] === b[1] ? Math.min(a[0], b[0]) : a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
          xa = Math.min(xa, x); xb = Math.max(xb, x);
          if (a[1] === b[1]) xb = Math.max(xb, a[0], b[0]);
        }
      }
      for (let x = Math.max(0, Math.floor(xa)); x <= Math.min(PW - 1, Math.ceil(xb)); x++) buf[y * PW + x] |= bit;
    }
  }
  const WOB = STYLE.wobble * 1.25;
  const B = BEZEL, IN = 0.36, CORNER = 0.42, WALL_Z = Z_FRAME + 16 * MM;
  /** a rounded rect on the board at height z, as screen points, closed */
  const rr = (u0, v0, u1, v1, rad, z) => {
    const pts = [];
    for (const [cu, cv, a] of [[u1 - rad, v0 + rad, -90], [u1 - rad, v1 - rad, 0], [u0 + rad, v1 - rad, 90], [u0 + rad, v0 + rad, 180]])
      for (let j = 0; j <= 10; j++) { const t = (a + (90 * j) / 10) * DEG; pts.push(S(cu + Math.cos(t) * rad, cv + Math.sin(t) * rad, z)); }
    pts.push(pts[0]);
    return pts;
  };
  // the front of the case, right corner round to left, [u, v]
  const FRONT = [0, 90].flatMap((a0, s) => Array.from({ length: 11 }, (_, j) => {
    const t = (a0 + (90 * j) / 10) * DEG, cu = s ? B.u0 + CORNER : B.u1 - CORNER;
    return [cu + Math.cos(t) * CORNER, B.v1 - CORNER + Math.sin(t) * CORNER];
  }));

  // Where the graphite goes down as tone, in hatching, as it does on the hands. The light is
  // high and behind the board (the hands' shadows fall toward the typist): the plate sits in
  // the case's shade, each cap throws a short shadow toward the typist and a little right,
  // the front wall faces away, and the case darkens the desk in front of it.
  const PLATE = 1, CAST = 2, WALL = 4, DESK = 8, THROW = [0.07, 0.24];   // a cap's shadow, key units
  let areas = null;
  function shadingAreas() {
    areas = new Uint8Array(PW * PH);
    fillConvex(rr(B.u0 + IN, B.v0 + IN, B.u1 - IN, B.v1 - IN, 0.16, Z_FRAME), areas, PLATE);
    for (const kk of keys) {
      const c = capsule(kk, 0.11);
      fillConvex(c.map((p) => S(p.u, p.v, Z_PLATE)).concat(c.map((p) => S(p.u + THROW[0], p.v + THROW[1], Z_PLATE))), areas, CAST);
    }
    const band = (u0, v0, u1, v1) => fillConvex([S(u0, v0, Z_PLATE), S(u1, v0, Z_PLATE), S(u1, v1, Z_PLATE), S(u0, v1, Z_PLATE)], areas, CAST);
    band(B.u0, B.v0, B.u1, B.v0 + IN + 0.3);          // under the far wall
    band(B.u0, B.v0, B.u0 + IN + 0.1, B.v1);          // and the left
    for (let i = 0; i + 1 < FRONT.length; i++) {
      const [a, b] = [FRONT[i], FRONT[i + 1]];
      fillConvex([S(a[0], a[1], Z_FRAME), S(b[0], b[1], Z_FRAME), S(b[0], b[1], WALL_Z), S(a[0], a[1], WALL_Z)], areas, WALL);
    }
    fillConvex([S(B.u0 + CORNER, B.v1, WALL_Z), S(B.u1 - CORNER, B.v1, WALL_Z), S(B.u1 - CORNER + 0.12, B.v1 + 0.5, WALL_Z), S(B.u0 + CORNER + 0.12, B.v1 + 0.5, WALL_Z)], areas, DESK);
  }
  const DESK_Y = () => [S(B.u0, B.v1, WALL_Z)[1], S(B.u0, B.v1 + 0.5, WALL_Z)[1]];
  const DESK_X = () => [S(B.u0 + CORNER, B.v1, WALL_Z)[0], S(B.u1 - CORNER, B.v1, WALL_Z)[0]];

  /**
   * Draw the keyboard with some keys at the bottom of their travel. With a region, only
   * keys touching it are stroked (the rest cannot change pixels there) and only the
   * region is resolved: that is a key patch, drawn the same way as the whole board.
   */
  // The board is drawn the way the renderer draws a hand: one committed contour per form,
  // heavier where it turns away from the eye (the near edge of a cap, the case's front),
  // light inside it, a pale searching line beside the long edges, and the same boil.
  function drawKeyboard(pressed = new Set(), region = null, boil = 0) {
    if (!kg) { kg = new PEN.Graphite(PW, PH, P.ss, SEED); occ = new Uint8Array(PW * PH); }
    if (!areas) shadingAreas();
    const g = kg;
    g.noise = boils[boil % 3];
    g.clear(); occ.fill(0);
    const visOf = (pts) => pts.map((p) => { const x = Math.round(p[0]), y = Math.round(p[1]); return x < 0 || y < 0 || x >= PW || y >= PH ? 1 : occ[y * PW + x] ? 0 : 1; });
    /** a stroke; `lit(p)` (0..1) lightens it where the form faces the light */
    const line = (pts, tone, w, ph, o = {}, lit = null) => {
      const d = M.resample(pts, 1.5);
      if (d.length < 2) return;
      const vis = visOf(d);
      if (lit) d.forEach((p, i) => { vis[i] *= 1 - 0.45 * lit(p); });
      g.stroke(d, Object.assign({ grade: GRADE, tone: tone * STYLE.tone, weight: w * WEIGHT, wobble: WOB, taper: 0.45, phase: ph + boil * 17.3, vis }, o));
    };
    /** a long edge, as a hand commits to it: the line, and a faint one either side that it searched along */
    const edge = (pts, tone, w, ph, o = {}) => {
      line(pts, tone, w, ph, o);
      const d = M.resample(pts, 1.5), n = d.length;
      if (n < 30) return;
      for (const [off, k] of [[1.7 * X, 0], [-2.6 * X, 1]]) {
        const sh = d.map((p, i) => {
          const a = d[Math.max(0, i - 1)], b = d[Math.min(n - 1, i + 1)], dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          return [p[0] - ((b[1] - a[1]) / dl) * off, p[1] + ((b[0] - a[0]) / dl) * off];
        });
        // only part of the way: a search, not a second line
        const a0 = Math.floor(n * (0.08 + 0.3 * k)), a1 = Math.floor(n * (0.55 + 0.4 * k));
        line(sh.slice(a0, a1), tone * 0.18, w * 0.8, ph + 40 + k * 21.3, { taper: 0.9, wobble: WOB * 1.9, close: false });
      }
    };
    const R0 = region || { x: 0, y: 0, w: PW, h: PH };
    const touches = (b) => !region || (b.x1 >= region.x && b.x0 <= region.x + region.w && b.y1 >= region.y && b.y0 <= region.y + region.h);
    /**
     * Parallel strokes over a shading area, `gap` px apart: '/' (dir 1) or '\' (dir -1). The
     * strokes are laid on a grid fixed to the board and broken only where the area or a cap
     * breaks them, so a key patch lays exactly the strokes the whole board does.
     */
    const hatch = (want, dir, gap, tone, w, ph, fade = null) => {
      const G = gap * X, x0 = R0.x - 6, x1 = R0.x + R0.w + 6, y0 = R0.y - 6, y1 = R0.y + R0.h + 6;
      const cs = [x0 + dir * y0, x1 + dir * y0, x0 + dir * y1, x1 + dir * y1];
      for (let k = Math.ceil(Math.min(...cs) / G); k <= Math.floor(Math.max(...cs) / G); k++) {
        const c = k * G;
        let run = [], vis = [];
        const flush = () => {
          if (run.length > 2 && run.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1))
            g.stroke(run, { grade: GRADE, tone: tone * STYLE.tone, weight: w * WEIGHT, wobble: 0.45, jitter: 0.3, taper: 0.55, phase: ph + k * 1.37 + boil * 17.3, vis, close: false });
          run = []; vis = [];
        };
        for (let y = 0; y < PH; y += 1.5) {
          const x = c - dir * y, xi = Math.round(x), yi = Math.round(y), i = yi * PW + xi;
          if (xi < 0 || xi >= PW || !want(areas[i]) || occ[i]) { flush(); continue; }
          run.push([x, y]); vis.push(fade ? fade(x, y) : 1);
        }
        flush();
      }
    };
    // keys nearest the typist first: they hide what is behind them
    const order = keys.slice().sort((a, b) => b.v1 - a.v1 || a.u0 - b.u0);
    for (const kk of order) {
      if (!touches(kk.box)) continue;
      const zt = Z_TOP + (pressed.has(kk.id) ? TRAVEL : 0), zb = zt + CAP;
      const outline = capsule(kk, 0.11);
      const top = outline.map((p) => S(p.u, p.v, zt));
      const bot = outline.map((p) => S(p.u, p.v, zb));
      const mid = S((kk.u0 + kk.u1) / 2, (kk.v0 + kk.v1) / 2, zt), hy = Math.max(...top.map((p) => Math.abs(p[1] - mid[1]))) || 1;
      const farLit = (p) => clamp01(0.5 - (p[1] - mid[1]) / hy);              // the far rim catches the light
      // the cap: its top's rim, then the near side, where the form turns under (the heavier line)
      line(top, 0.5, 0.8, 100 + kk.id * 4.7, { close: true, taper: 0 }, farLit);
      const near = outline.filter((p) => p.nv > -0.25);
      line(near.map((p) => S(p.u, p.v, zb)), 0.82, 1.05, 400 + kk.id * 2.3, { taper: 0.55 });
      // the dish: the far wall inside the rim, turned from the light
      const dish = capsule(kk, 0.17);
      const turn = dish.slice(39).concat(dish.slice(0, 13)).filter((p) => p.nv < -0.3);
      line(turn.map((p) => S(p.u, p.v, zt + 0.5 * MM)), 0.2, 0.5, 700 + kk.id * 3.1, { taper: 0.85 });
      if (kk.legend) {
        const c = world((kk.u0 + kk.u1) / 2, (kk.v0 + kk.v1) / 2, zt);
        const h = kk.legend.length === 1 ? 4.4 : kk.legend.length <= 2 ? 2.8 : 2.0;
        legendStrokes(kk.legend, h * MM).forEach((pl, si) =>
          line(pl.map(([dy, dx]) => scr([c[0] - dx, c[1] + dy, zt])), 0.42, 0.5, 300 + kk.id * 6.1 + si * 1.3, { taper: 0.15 }));
      }
      // the homing bars the index fingers find without looking
      if (kk.name === 'F' || kk.name === 'J') {
        const u = (kk.u0 + kk.u1) / 2, v = kk.v1 - 0.27;
        line([S(u - 0.09, v, zt), S(u + 0.09, v, zt)], 0.6, 0.75, 900 + kk.id, { taper: 0.3 });
      }
      fillConvex(top.concat(bot));
    }
    // the maker's mark, set in the plate between ESC and F1 on a bare disc of its own: the
    // Retrolection roundel. Drawn before its disc is masked, so the hatching stops short of it
    const mark = (u, v, r) => {
      const at = ([x, y]) => S(u + x * r, v + y * r, Z_FRAME);
      line(Array.from({ length: 33 }, (_, j) => { const t = (j / 32) * 2 * Math.PI; return at([Math.cos(t), Math.sin(t)]); }), 0.5, 0.6, 30, { close: true, taper: 0 });
      line([at([-0.56, 0.43]), at([-0.24, -0.33])], 0.55, 0.6, 31, { taper: 0.2 });
      line([at([-0.27, 0.38]), at([0.05, -0.32])], 0.55, 0.6, 32, { taper: 0.2 });
      line([at([0.16, 0.07]), at([0.36, -0.33]), at([0.56, 0.07])], 0.55, 0.6, 33, { taper: 0.2 });
    };
    const MARK = { u: 1.5, v: -1.0, r: 0.26 };
    mark(MARK.u, MARK.v, MARK.r);
    fillConvex(Array.from({ length: 24 }, (_, j) => { const t = (j / 24) * 2 * Math.PI; return S(MARK.u + Math.cos(t) * MARK.r * 1.3, MARK.v + Math.sin(t) * MARK.r * 1.3, Z_FRAME); }));
    // the plate in the case's shade, darker where the caps and the far wall throw their shadows
    hatch((m) => m & PLATE, 1, 4.2, 0.13, 0.42, 1000);
    hatch((m) => (m & PLATE) && (m & CAST), -1, 3.4, 0.2, 0.42, 2000);
    // the front wall, turned away; the desk in front of it, fading from the case
    hatch((m) => m & WALL, 1, 3.2, 0.2, 0.45, 3000);
    hatch((m) => m & WALL, -1, 4.6, 0.12, 0.42, 4000);
    const [dy0, dy1] = DESK_Y(), [dx0, dx1] = DESK_X();
    hatch((m) => m & DESK, 1, 3.8, 0.15, 0.42, 5000, (x, y) =>
      (1 - smooth(clamp01((y - dy0) / (dy1 - dy0)))) * smooth(clamp01((x - dx0) / (60 * X))) * smooth(clamp01((dx1 - x) / (30 * X))));
    // the case: its rim, the step down to the plate, the front wall turning under
    edge(rr(B.u0, B.v0, B.u1, B.v1, CORNER, Z_FRAME), 0.72, 1.05, 11, { close: true, taper: 0 });
    line(rr(B.u0 + IN, B.v0 + IN, B.u1 - IN, B.v1 - IN, 0.16, Z_FRAME), 0.3, 0.6, 12, { close: true, taper: 0 });
    edge(FRONT.map(([u, v]) => S(u, v, WALL_Z)), 0.95, 1.35, 14);
    line([S(B.u0, B.v1 - CORNER, Z_FRAME), S(B.u0, B.v1 - CORNER, WALL_Z)], 0.7, 1.05, 15);
    line([S(B.u1, B.v1 - CORNER, Z_FRAME), S(B.u1, B.v1 - CORNER, WALL_Z)], 0.7, 1.05, 16);
    // screws, each slot turned a little differently
    const screw = (u, v, n) => {
      const ring = Array.from({ length: 17 }, (_, j) => { const t = (j / 16) * 2 * Math.PI; return S(u + Math.cos(t) * 0.1, v + Math.sin(t) * 0.1, Z_FRAME); });
      line(ring, 0.42, 0.55, 20 + n * 3, { close: true, taper: 0 });
      const a = ((n * 47) % 180) * DEG;
      line([S(u - Math.cos(a) * 0.065, v - Math.sin(a) * 0.065, Z_FRAME), S(u + Math.cos(a) * 0.065, v + Math.sin(a) * 0.065, Z_FRAME)], 0.42, 0.45, 21 + n * 3);
    };
    [1.2, 7.5, 13.8].forEach((u, i) => screw(u, B.v0 + IN / 2, i));
    [1.2, 7.5, 13.8].forEach((u, i) => screw(u, B.v1 - IN / 2, 10 + i));
    return { alpha: inkAlpha(g, R0.x, R0.y, R0.w, R0.h), ...R0 };
  }
  /** the whole board, ink only, to lay over the page's paper */
  function keyboardLayer(boil = 0) {
    const { alpha, x, y, w, h } = drawKeyboard(new Set(), null, boil);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p++) { data[p * 4] = INK[0]; data[p * 4 + 1] = INK[1]; data[p * 4 + 2] = INK[2]; data[p * 4 + 3] = Math.round(alpha[p] * 255); }
    return { data, x, y, w, h };
  }
  /** one key held down: an opaque patch (paper and ink) that covers the key at rest */
  function keyPatch(id, boil = 0) {
    const b = keys[id].box;
    const region = { x: Math.max(0, Math.floor(b.x0)), y: Math.max(0, Math.floor(b.y0)) };
    region.w = Math.min(PW, Math.ceil(b.x1)) - region.x; region.h = Math.min(PH, Math.ceil(b.y1)) - region.y;
    const { alpha, x, y, w, h } = drawKeyboard(new Set([id]), region, boil);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p++) {
      const v = alpha[p];
      data[p * 4] = lerp(PAPER[0], INK[0], v); data[p * 4 + 1] = lerp(PAPER[1], INK[1], v); data[p * 4 + 2] = lerp(PAPER[2], INK[2], v); data[p * 4 + 3] = 255;
    }
    return { data, x, y, w, h };
  }

  // ---- poses ----------------------------------------------------------------------------
  let THUMB_REST = null;
  /** where on the board (key units) a finger presses a key */
  function keyUV(hand, name) {
    const kk = byName.get(name);
    let u = (kk.u0 + kk.u1) / 2, v = (kk.v0 + kk.v1) / 2;
    if (name === 'SPACE' && THUMB_REST) { u = THUMB_REST.u; v = THUMB_REST.v; if (hand === 'L') u = mirrorU(u); }   // press where it rests
    if (name === 'LSHIFT') u = kk.u1 - 0.55;                    // a little finger only reaches the near end
    if (name === 'RSHIFT') u = kk.u0 + 0.55;
    return [u, v];
  }
  /** a fingertip's target in the hand's rig: at a named key, or at [u, v] on the board */
  function keyTarget(hand, d, name, lift) {
    let [u, v] = Array.isArray(name) ? name : keyUV(hand, name);
    if (hand === 'L') u = mirrorU(u);                            // the left model sees the board reflected
    return toRig(world(u, v, Z_TOP - 3 * MM + lift * MM));
  }
  const solve = (base, hand, d, name, lift) => PO.reach(A, clone(base), d, keyTarget(hand, d, name, lift), { iters: 60, tol: 0.25 });
  // home: fingers IK'd onto the home row, the thumb just over the space bar, near its middle
  const HOME_KEYS = { R: ['J', 'K', 'L', ';'], L: ['F', 'D', 'S', 'A'] };
  /** where a finger rests on its home key: the little finger, shortest, a row back, as a flat hand holds it */
  const homeUV = (side, d) => {
    const kk = byName.get(HOME_KEYS[side][d - 1]);
    return [(kk.u0 + kk.u1) / 2, (kk.v0 + kk.v1) / 2 + (d === 4 ? 1.1 : 0)];
  };
  const THUMB_U = 7.65, THUMB_V = 4.42;
  const homeFor = (hand) => {
    let p = clone(home0);
    const fingers = () => HOME_KEYS[hand].forEach((n, i) => { p = solve(p, hand, i + 1, homeUV(hand, i + 1), 0); });
    fingers();
    p = solve(p, hand, 0, [hand === 'L' ? mirrorU(THUMB_U) : THUMB_U, THUMB_V], -1.5);
    fingers();                                                // the thumb may have turned the hand under them
    return p;
  };
  const HOME = { R: homeFor('R') };
  HOME.L = homeFor('L');
  const THUMB_AT = deskUV(GK.rig.solve(A, HOME.R).digits[0].tip);
  THUMB_REST = { u: THUMB_AT.u, v: THUMB_AT.v };

  // A hand's pose for one frame is a small recipe, named by its JSON so workers can share
  // it and cache by it (numbers are rounded, so near-equal frames are one drawing):
  //   t   [a, b, c]       the whole hand moved on the desk, mm: outward along the row,
  //                       toward the typist, up
  //   w   [flex, dev, pron]  radians added at the wrist
  //   r   0..1            let go toward the relaxed, open hand (0: shaped to the keys)
  //   f   { d: [key, lift] }  a fingertip at a key (or at [u, v] on the board); lift in mm,
  //                       negative above the cap and positive down into its travel.
  //                       Unnamed fingers rest on home.
  //   th  [key, lift]     the thumb pressing; omitted, it keeps its posed rest
  //   k   0..1            the loose hand's fingers curled toward a hook (with r)
  // Fingertips are solved after the wrist and the hand have moved, so whatever the hand
  // does, the fingers stay where the keys are.
  const RELAX = PO.clampPose(A, PO.mk(A, {
    // a loose hand keeps its thumb alongside the index, a little less opposed than on the keys
    wrist: [0.16, P.dev * 0.4, P.pron + 0.16], arch: 0.1, thumb: [P.thumb[0], P.thumb[1] * 0.7, P.thumb[2] * 0.5, P.thumb[3] * 0.6, P.thumb[4] + 0.08],
    f: [[0.12, 0.24, 0.1, 0.08], [0.1, 0.24, 0.1, 0], [0.12, 0.28, 0.12, -0.04], [0.14, 0.3, 0.14, -0.1]],
  }));
  // the same hand with its fingers hooked, as over the edge of something it means to pull
  const HOOK = PO.clampPose(A, PO.mk(A, {
    wrist: [-0.04, P.dev * 0.4, P.pron + 0.16], arch: 0.22, thumb: [P.thumb[0], P.thumb[1] * 0.7, P.thumb[2] * 0.5, P.thumb[3] * 0.6, P.thumb[4] + 0.08],
    f: [[0.06, 0.5, 0.48, 0.06], [0.04, 0.52, 0.5, 0], [0.06, 0.52, 0.5, -0.03], [0.08, 0.5, 0.48, -0.08]],
  }));
  const looseOf = (k = 0) => (k > 0.001 ? PO.lerpPose(RELAX, HOOK, k) : RELAX);
  const shiftOf = (t = [0, 0, 0]) => rotE([-t[1] * MM, t[0] * MM, -t[2] * MM], -SPIN);
  const SHEET0 = VIEWH.px([0, 0, 0]);
  /** where a desk move puts the hand's layer, panel px (the left layer is mirrored) */
  const offsetOf = (side, t) => {
    const q = VIEWH.px(shiftOf(t));
    return [(side === 'L' ? -1 : 1) * (q[0] - SHEET0[0]), q[1] - SHEET0[1]];
  };
  /** a key's offset from where a finger rests, in the hand's own (mirrored) frame, mm */
  const reachOf = (side, d, name) => {
    const kk = byName.get(name), [hu, hv] = homeUV(side, Math.max(1, d));
    const du = (kk.u0 + kk.u1) / 2 - hu, dv = (kk.v0 + kk.v1) / 2 - hv;
    return [(side === 'L' ? -du : du) * 19.05, dv * 19.05];
  };
  function poseFrom(side, rec) {
    const S = shiftOf(rec.t), r = rec.r || 0;
    let p = clone(HOME[side]);
    if (rec.w) { p.wrist.flex += rec.w[0]; p.wrist.dev += rec.w[1]; p.wrist.pron += rec.w[2]; }
    if (r < 0.999) {
      for (let d = 1; d <= 4; d++) {
        const [name, lift] = (rec.f && rec.f[d]) || [homeUV(side, d), 0];
        p = PO.reach(A, p, d, M.vsub(keyTarget(side, d, name, lift), S), { iters: 40, tol: 0.3 });
      }
      if (rec.th) p = PO.reach(A, p, 0, M.vsub(keyTarget(side, 0, rec.th[0], rec.th[1]), S), { iters: 40, tol: 0.3 });
    }
    if (r > 0.001) {
      const loose = clone(looseOf(rec.k));
      if (rec.w) { loose.wrist.flex += rec.w[0]; loose.wrist.dev += rec.w[1]; loose.wrist.pron += rec.w[2]; }
      p = PO.lerpPose(p, loose, r);
    }
    return p;
  }
  const poseCache = { R: new Map(), L: new Map() };
  function poseOf(side, spec) {
    const cache = poseCache[side];
    if (!cache.has(spec)) cache.set(spec, spec === 'home' ? HOME[side] : spec.startsWith('{"m"') ? mousePose(JSON.parse(spec).m) : poseFrom(side, JSON.parse(spec)));
    return cache.get(spec);
  }

  // ---- the performance: what each frame shows ---------------------------------------
  const FPS = 24;
  const q = (v, step) => Number((Math.round(v / step) * step).toFixed(3));
  const qk = (k) => (Array.isArray(k) ? k.map((v) => q(v, 0.02)) : k);
  /** a recipe as its cache name */
  const specOf = (rec) => JSON.stringify({
    t: rec.t.map((v) => q(v, 0.25)), w: rec.w.map((v) => q(v, 0.002)), r: q(rec.r, 0.02),
    ...(rec.k ? { k: q(rec.k, 0.02) } : {}),
    ...(rec.f && Object.keys(rec.f).length ? { f: Object.fromEntries(Object.entries(rec.f).map(([d, [k, l]]) => [d, [qk(k), q(l, 0.25)]])) } : {}),
    ...(rec.th ? { th: [qk(rec.th[0]), q(rec.th[1], 0.25)] } : {}),
  });
  /**
   * A smooth path through [time, value] keys: a monotone cubic, so it never overshoots a
   * key, and only comes to rest where the motion turns (or at the ends). Flat outside.
   */
  const curve = (keys) => {
    const n = keys.length, xs = keys.map((k) => k[0]), ys = keys.map((k) => k[1]), d = [], m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] > 0 ? (d[i - 1] + d[i]) / 2 : 0;
    for (let i = 0; i < n - 1; i++) {
      if (!d[i]) { m[i] = m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
    }
    return (x) => {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      let i = 0;
      while (x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], s = (x - xs[i]) / h, s2 = s * s, s3 = s2 * s;
      return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h * m[i + 1];
    };
  };
  const inOut = curve([[0, 0], [1, 1]]);
  const bump = (t) => (t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t) ** 2);

  const paced = (f) => (x) => f(x / SPEED);
  // One keystroke, in seconds about the moment the key bottoms out (the clunk): the finger
  // lifts to wind up, strikes, holds the key down, rebounds and settles; the hand travels a
  // little toward the key and sinks into the strike; the neighbours ride up with it. A stroke
  // starts before the last one has settled, so the motion runs on.
  // At speed (the page types at ~120 wpm) a stroke is the same gesture, quicker: every curve
  // below is in seconds at a relaxed pace, and runs SPEED times as long.
  const SPEED = 0.6, BEAT = 0.095;
  const STROKE = [-0.25 * SPEED, 0.32 * SPEED];
  const LIFT = paced(curve([[-0.17, 0], [-0.08, -6], [0, 4.3], [0.07, 4.3], [0.15, -2.2], [0.3, 0]]));
  const REACH = paced(curve([[-0.17, 0], [-0.07, 1], [0.12, 1], [0.3, 0]]));
  const DIP = paced(curve([[-0.17, 0], [-0.08, 0.9], [0, -0.9], [0.07, -1.4], [0.16, -0.4], [0.3, 0]]));
  const NEIGH = paced(curve([[-0.08, 0], [0, -1.4], [0.1, -1.2], [0.22, 0]]));
  const THUMB = paced(curve([[-0.12, 0], [-0.05, -1.6], [0, 3.6], [0.07, 3.8], [0.15, -0.8], [0.27, 0]]));
  const SHIFT_LIFT = paced(curve([[-0.25, 0], [-0.15, -3], [-0.06, 4.3], [0.1, 4.3], [0.18, -1], [0.28, 0]]));
  const SHIFT_REACH = paced(curve([[-0.25, 0], [-0.14, 1], [0.12, 1], [0.3, 0]]));
  const FOLLOW = 0.16, DOWN = 2.5;                             // hand travel with the finger; mm of travel that registers

  // Pushing the board: loose, open hands, the longest fingertips against the lip of the case,
  // the board travelling with them. Hands only take the typing shape once they are on the keys.
  // The hands push wide of where they type, out toward the ends of the board: loose hands are
  // broader than shaped ones, and at home spacing they would meet.
  const EDGE_V = BEZEL.v1 - 0.22, EDGE_LIFT = 19, PUSH_OUT = 34;
  const RELAX_TIP = deskUV(GK.rig.solve(A, RELAX).digits[2].tip);
  const PUSH_T = [PUSH_OUT, (EDGE_V - RELAX_TIP.v) * 19.05, -(EDGE_LIFT - 3) - RELAX_TIP.h];
  const KB_IN = 290, KB_OUT = 300;                            // mm: where the board starts, and where the hands pull it to
  const KB1 = (() => { const a = VIEWOBJ.px(P0), b = VIEWOBJ.px(M.vadd(P0, [-MM, 0, 0])); return [0, b[1] - a[1]]; })();
  const kbPx = (mm) => [KB1[0] * mm, KB1[1] * mm];
  const edgeUV = (side, d) => [homeUV(side, d)[0] + ((side === 'L' ? -1 : 1) * PUSH_OUT) / 19.05, EDGE_V];
  const rest = (calm = 1) => ({ t: [0, 0, 0], w: [0, 0, 0], r: 0, f: {}, calm });
  const pushRec = () => {
    const h = rest(0);
    h.t = [...PUSH_T];
    h.r = 1;
    return h;
  };
  /**
   * From the push (s = 0) to hovering over home (s = 1): the hands come up off the case still
   * loose, travel, and gather into shape over the keys as the fingers find them.
   */
  const OFFLIFT = curve([[0, EDGE_LIFT], [0.3, -14], [1, -12]]);
  const LIFT_Z = curve([[0, PUSH_T[2]], [0.35, 10], [1, 12]]);
  const LIFT_A = curve([[0, PUSH_OUT], [0.3, PUSH_OUT * 0.85], [1, 12]]);   // in toward home, the last of it on landing
  const LIFT_B = curve([[0, PUSH_T[1]], [0.15, PUSH_T[1] - 4], [1, 0]]);
  const SHAPE = curve([[0, 1], [0.4, 0.92], [1, 0.4]]);
  const lifting = (s) => {
    const h = rest(0);
    h.t = [LIFT_A(s), LIFT_B(s), LIFT_Z(s)];
    h.r = SHAPE(s);
    for (let d = 1; d <= 4; d++) {
      const sd = clamp01((s - 0.04 * (d - 1)) / 0.88);
      h.f[d] = ['edge>home', OFFLIFT(sd), inOut(clamp01((sd - 0.12) / 0.75))];
    }
    return h;
  };
  /** from hovering (g = 0) to resting on home (g = 1): index first, out to the little finger */
  const landing = (g) => {
    const h = rest(0.3);
    h.t = [12 * (1 - curve([[0, 0], [0.7, 1], [1, 1]])(g)), 0, 12 * (1 - curve([[0, 0], [0.6, 0.9], [1, 1]])(g))];
    h.r = 0.4 * (1 - curve([[0, 0], [0.7, 1], [1, 1]])(g));
    for (let d = 1; d <= 4; d++) {
      const sd = clamp01((g - 0.09 * (d - 1)) / 0.7);
      h.f[d] = ['home', -12 * (1 - curve([[0, 0], [0.75, 0.95], [1, 1]])(sd))];
    }
    return h;
  };
  // The way out: the hands come up off the keys and travel up the board, opening as they
  // go; over the far edge the fingers curl and hook down behind it; the hands take up the
  // slack, and pull the board down toward the typist and off the page.
  // The hand is loose throughout (r = 1), so where it goes is where its middle fingertip
  // goes: the hand is placed so that tip follows the path below, whatever the curl.
  const tipOf = (k) => deskUV(GK.rig.solve(A, looseOf(k)).digits[2].tip);
  const GRIP_U = 11.4;                                        // the right middle finger's hold; the left's is its mirror
  // along the row the hand holds still as its fingers curl: placed once, for the hook
  const HOLD_A = (GRIP_U - tipOf(1).u) * 19.05;
  const placeAt = (k, v, h) => { const tp = tipOf(k); return [HOLD_A, (v - tp.v) * 19.05, h - tp.h]; };
  // the tip's path over the far edge, g 0..1: forward over the frame, then down behind it
  const OVER_V = curve([[0, BEZEL.v0 + 0.8], [0.55, BEZEL.v0 - 0.02], [1, BEZEL.v0 - 0.05]]);
  const OVER_H = curve([[0, 10], [0.45, 3], [1, -3.5]]);
  const OVER_K = curve([[0, 0.12], [0.35, 0.3], [1, 1]]);
  const POISED = { k: OVER_K(0), at: [OVER_V(0), OVER_H(0)] };
  const poisedT = placeAt(POISED.k, ...POISED.at);
  /** from hovering over home (s = 0, as landing(0)) to poised over the far edge (s = 1) */
  const REACH_R = curve([[0, 0.4], [0.55, 1], [1, 1]]);
  const reaching = (s) => {
    const h = rest(0), e = inOut(s), from = landing(0);
    h.t = [lerp(from.t[0], poisedT[0], e), lerp(from.t[1], poisedT[1], e), lerp(from.t[2], poisedT[2], e) + 14 * bump(s)];
    h.r = REACH_R(s);
    h.k = POISED.k * clamp01((s - 0.3) / 0.7);
    for (let d = 1; d <= 4; d++) h.f[d] = ['home', -12 - 10 * bump(clamp01((s - 0.04 * (d - 1)) / 0.85))];
    return h;
  };
  /** from poised (g = 0) to fingers hooked behind the far edge (g = 1); then `tug` takes up the slack */
  const hooking = (g, tug = 0) => {
    const h = rest(0), k = OVER_K(g) + 0.06 * tug;
    h.t = placeAt(k, OVER_V(g) + 0.04 * tug, OVER_H(g) + 0.6 * tug);
    h.t[1] += 3.5 * tug;                                       // the hand leans back toward the typist
    h.r = 1;
    h.k = k;
    return h;
  };
  // fingers named loosely above are made concrete per side here
  const concrete = (side, h) => {
    for (const [d, v] of Object.entries(h.f)) {
      const home = homeUV(side, +d);
      if (v[0] === 'edge') h.f[d] = [edgeUV(side, +d), v[1]];
      else if (v[0] === 'home') { if (Math.abs(v[1]) < 0.12) delete h.f[d]; else h.f[d] = [home, v[1]]; }
      else if (v[0] === 'edge>home') { const e = edgeUV(side, +d); h.f[d] = [[lerp(e[0], home[0], v[2]), lerp(e[1], home[1], v[2])], v[1]]; }
    }
    return h;
  };

  const LOOP = 96;                                            // the idle breath, frames (4s): even, so twos close on themselves

  /**
   * Frames for typing `text`, at 24 a second. The hands push the board up into place, let go
   * of its front edge, lift over the keys and settle onto home, then type: strokes overlap,
   * the timing follows the hands (alternating hands are quicker than one hand twice), and
   * the wrists breathe throughout about fingertips that stay on the keys. Ends in a seamless
   * idle loop. `exit` is the way off, driven by scroll: the hands reach up the board, take
   * its far edge, and pull it down off the page.
   * `live` types `text` from the idle hands instead, for keys the reader presses: no entry,
   * no loop and no way out; its last frame leads into the first of the loop.
   */
  function schedule(text, { live = false } = {}) {
    const recs = [];                                          // per frame: { R, L, kb, typed, pressed, clunk, clunkShift }
    const at = (sec) => Math.round(sec * FPS);
    // the entry
    const EMPTY = 0.25, PUSH = 1.5, HOLD = 0.16, UP = 0.66, LAND = 0.42, SETTLE = 0.3, LEAD = 0.07;
    const pushEase = curve([[0, 0], [0.22, 0.13], [0.72, 0.9], [1, 1]]);
    const tPush = EMPTY, tUp = tPush + PUSH + HOLD, tLand = tUp + UP, tSettle = tLand + LAND, T0 = live ? -0.15 : tSettle + SETTLE;
    const handIn = (sec) => {
      if (sec < tUp) return pushRec();
      if (sec < tLand) return lifting((sec - tUp) / UP);
      if (sec < tSettle) return landing((sec - tLand) / LAND);
      const h = rest(0.3 + 0.05 * ((sec - tSettle) / SETTLE));
      h.t[2] = -1.4 * bump((sec - tSettle) / SETTLE);          // the weight goes into the keys, and back
      return h;
    };

    // the strokes, timed
    const strokes = [];
    let tt = T0 + 0.2, prev = null;
    [...text].forEach((ch, c) => {
      const st = strokeFor(ch);
      const hash = Math.sin(c * 12.9898 + 4.1) * 43758.5453, jitter = (hash - Math.floor(hash) - 0.5) * 0.05;
      if (c > 0) {
        let beat = BEAT;
        if (ch === ' ' || text[c - 1] === ' ') beat = BEAT * 1.2;
        if (ch === '\n') beat = 0.12;
        if (text[c - 1] === '\n') beat = 0.34;                                                // a breath before a new line
        if (ch === PASTE) beat = 0.42;                                                        // ...and a longer one before a paste
        if (st && prev && st.hand === prev.hand && st.d !== 0 && prev.d !== 0) beat += 0.012;  // one hand twice: slower
        else if (st && prev && st.hand !== prev.hand) beat -= 0.008;                           // hand to hand: quicker
        tt += beat + jitter * 0.25;
      }
      strokes.push({ c, at: tt, st, key: st ? byName.get(st.name) : null });
      prev = st;
    });
    const tEnd = tt + (live ? 0.45 : 0.7);
    const loop0 = at(tEnd);

    const typingRec = (side, sec, list = strokes) => {
      const h = rest(0.35);
      const lift = [0, 0, 0, 0, 0], uv = [null, ...[1, 2, 3, 4].map((d) => homeUV(side, d))];
      let th = null;
      // At speed strokes overlap: a finger goes where its strongest stroke takes it, and the
      // hand follows its strongest reach. Summed, two reaches in a row would carry it twice
      // as far, into the other hand.
      const reach = [0, 0, 0, 0, 0];
      let follow = [0, 0], pull = 0;
      for (const s of list) {
        const x = sec - s.at;
        if (!s.st || x < STROKE[0] || x > STROKE[1]) continue;
        const { hand, d, name, shift } = s.st;
        if (hand === side) {
          if (d === 0) th = (th || 0) + THUMB(x);
          else {
            const e = REACH(x), k = keyUV(side, name), home = homeUV(side, d);
            if (e >= reach[d]) { reach[d] = e; uv[d] = [home[0] + e * (k[0] - home[0]), home[1] + e * (k[1] - home[1])]; }
            lift[d] += LIFT(x);
            for (const n of [d - 1, d + 1]) if (n >= 1 && n <= 4) lift[n] += NEIGH(x);
            const [ru, rv] = reachOf(side, d, name);
            if (e >= pull) { pull = e; follow = [e * FOLLOW * Math.max(0, ru), e * FOLLOW * rv]; }   // toward the other hand the finger does the reaching
            if (s.st.ctrl) {                                     // the chord: the little finger down on CTRL, held through the stroke
              const ec = SHIFT_REACH(x), kc = keyUV(side, 'LCTRL'), h4 = homeUV(side, 4);
              uv[4] = [h4[0] + ec * (kc[0] - h4[0]), h4[1] + ec * (kc[1] - h4[1])];
              lift[4] += SHIFT_LIFT(x);
              h.t[2] -= 0.8 * ec;
            }
          }
          h.t[2] += DIP(x);
        } else if (shift) {
          const sk = side === 'L' ? 'LSHIFT' : 'RSHIFT', e = SHIFT_REACH(x), k = keyUV(side, sk), home = homeUV(side, 4);
          uv[4] = [uv[4][0] + e * (k[0] - home[0]), uv[4][1] + e * (k[1] - home[1])];
          lift[4] += SHIFT_LIFT(x);
          const [su, sv] = reachOf(side, 4, sk);
          h.t[0] += e * 0.25 * su; h.t[1] += e * 0.25 * sv; h.t[2] -= 0.8 * e;
        }
      }
      h.t[0] += follow[0]; h.t[1] += follow[1];
      for (let d = 1; d <= 4; d++) {
        const home = homeUV(side, d), moved = Math.abs(uv[d][0] - home[0]) + Math.abs(uv[d][1] - home[1]) > 0.01;
        if (moved || Math.abs(lift[d]) > 0.12) h.f[d] = [moved ? uv[d] : homeUV(side, d), lift[d]];
      }
      if (th !== null && Math.abs(th) > 0.12) h.th = ['SPACE', th];
      return h;
    };
    /**
     * A hand while typing, from a small fixed set of poses: home; or the finger of its
     * strongest stroke on the way to its key, or down on it; the little finger on shift while
     * the other hand types a capital. No breath while typing. A performance at speed is then a
     * few dozen drawings, each made once and shown again and again, so it never waits on them.
     */
    const RISE = -0.07 * SPEED, STRUCK = 0.02 * SPEED;
    const typingPose = (side, sec) => {
      let best = null, bw = 0, shifted = null;
      for (const s of strokes) {
        const x = sec - s.at;
        if (!s.st || x < STROKE[0] || x > STROKE[1]) continue;
        if (s.st.hand === side) { const w = s.st.d === 0 ? Math.max(0, THUMB(x)) / 4 : REACH(x); if (w > bw) { bw = w; best = s; } }
        else if (s.st.shift && SHIFT_REACH(x) > 0.5) shifted = s;
      }
      const list = [];
      if (best && bw > 0.35) {
        const x = sec - best.at;
        list.push({ ...best, at: sec - (x < RISE / 2 ? RISE : STRUCK) });
      }
      if (shifted) list.push({ ...shifted, at: sec - STRUCK });
      const h = typingRec(side, sec, list);
      h.calm = 0;
      return h;
    };
    const keysDown = (sec) => {
      const down = [];
      for (const s of strokes) {
        if (!s.st) continue;
        const x = sec - s.at;
        // a stroke at speed may bottom out between frames: the frame nearest it shows it down
        if ((x >= STROKE[0] && x <= STROKE[1] && (s.st.d === 0 ? THUMB(x) : LIFT(x)) >= DOWN) || Math.abs(x - 0.03 * SPEED) <= 0.5 / FPS) down.push(s.key.id);
        if (s.st.shift && x >= STROKE[0] && x <= STROKE[1] && SHIFT_LIFT(x) >= DOWN) down.push(byName.get(s.st.hand === 'R' ? 'LSHIFT' : 'RSHIFT').id);
        if (s.st.ctrl && x >= STROKE[0] && x <= STROKE[1] && SHIFT_LIFT(x) >= DOWN) down.push(byName.get('LCTRL').id);
      }
      return down;
    };

    // the idle loop: one small fidget per hand, at different moments; held on twos
    const idleRec = (side, i) => {
      const f = 2 * Math.floor((i - loop0) / 2) % LOOP, h = rest(1);
      if (side === 'R') { const a = bump((f - 16) / 20); if (a) h.f[1] = ['J', -3.2 * a]; }
      else { const b = bump((f - 58) / 18); if (b) { h.f[4] = ['A', -2.4 * b]; h.f[3] = ['S', -0.8 * b]; } }
      return h;
    };
    // breath, on twos, phased to the loop so it closes on itself
    const breath = (side, i) => {
      const k = 2 * Math.floor((i - loop0) / 2), s = (2 * Math.PI * k) / LOOP, ph = side === 'R' ? 0 : 2.3;
      return {
        t: [0.35 * Math.sin(s + ph + 1.3), 0.45 * Math.sin(s + ph + 0.4), 1.2 * Math.sin(s + ph) + 0.35 * Math.sin(2 * s + ph * 1.7)],
        w: [0.02 * Math.sin(s + ph - 0.6), 0, 0.014 * Math.sin(s + ph + 2)],
      };
    };
    const typedAt = (sec) => strokes.filter((s) => s.at <= sec + 1e-6).length;

    const N = live ? loop0 : loop0 + LOOP;
    let was = new Set();
    for (let i = 0; i < N; i++) {
      const sec = i / FPS, fr = { typed: 0, pressed: [] };
      const recOf = (side) => {
        const lead = side === 'L' ? LEAD : 0, s = sec + lead;
        if (!live && sec < EMPTY - 0.0001) return null;
        if (i >= loop0) return idleRec(side, i);
        if (s < T0) return handIn(s);
        fr.still = true;
        const h = typingPose(side, (2 * Math.floor(i / 2)) / FPS);   // on twos: the hand changes shape at a pace the eye can follow
        // after the line, the hands come to rest and the breath comes back in
        if (sec > tt + 0.3) h.calm = 0.35 + 0.65 * inOut(clamp01((sec - tt - 0.3) / (tEnd - tt - 0.3)));
        return h;
      };
      fr.R = recOf('R'); fr.L = recOf('L');
      fr.kb = live ? 0 : sec < tPush + PUSH ? KB_IN * (1 - pushEase(clamp01((sec - tPush) / PUSH))) : 0;
      fr.typed = typedAt(sec);
      fr.pressed = i < loop0 ? keysDown(sec) : [];
      const now = new Set(fr.pressed);
      for (const s of strokes) {
        if (!s.st || now.has(s.key.id) === false || was.has(s.key.id) || Math.abs(sec - s.at) > 0.12) continue;
        fr.clunk = s.st.name;
      }
      for (const id of now) if (!was.has(id) && /SHIFT/.test(keys[id].name)) fr.clunkShift = keys[id].name;
      was = now;
      recs.push(fr);
    }

    const frameOf = (fr, i, { breathe = true, glide = false } = {}) => {
      const out = { typed: fr.typed, pressed: fr.pressed, R: null, L: null, offR: [0, 0], offL: [0, 0], hR: 0, hL: 0, kb: kbPx(fr.kb).map((v) => Math.round(v * 10) / 10) };
      out.boil = fr.still ? 0 : Math.floor(i / 2) % 3;             // which field the hands are drawn on: one, while typing
      if (fr.clunk) out.clunk = fr.clunk;
      if (fr.clunkShift) out.clunkShift = fr.clunkShift;
      for (const side of ['R', 'L']) {
        const h = fr[side];
        if (!h) continue;
        concrete(side, h);
        if (breathe && h.calm) {
          const br = breath(side, i);
          h.t = h.t.map((v, j) => v + br.t[j] * h.calm);
          h.w = h.w.map((v, j) => v + br.w[j] * h.calm);
        }
        out[side] = specOf(h);
        const o = offsetOf(side, h.t);
        out['off' + side] = [Math.round((o[0] + out.kb[0]) * 10) / 10, Math.round((o[1] + out.kb[1]) * 10) / 10];
        out['h' + side] = Math.max(0, h.t[2]) + h.r * 12;
        // a loose hand moves as one piece, so the page may ease it between frames; a hand
        // with fingers on the keys holds its frame, or the planted tips would slide and snap
        if (h.r >= 0.999 || glide) out['glide' + side] = true;
      }
      return out;
    };
    const frames = recs.map((fr, i) => frameOf(fr, i));
    if (live) return { fps: FPS, frames, live: true, text };

    // the way out, as a scroll runs it from 0 to 1: frame 0 is the loop's first frame. Off
    // the keys, up the board, a grip on its far edge; then the board and the hands holding it
    // go down the page together (the page fades them out as they go).
    const EXIT = 72, UNLAND = 0.07, REACH_END = 0.3, HOOK_END = 0.43, TUG_END = 0.5;
    const TUG = curve([[0, 0], [0.6, 1], [1, 1]]);
    const PULL = curve([[0, 0], [0.18, 0.05], [1, 1]]);     // slow to start, as a weight is
    const exitRecs = [];
    for (let j = 0; j < EXIT; j++) {
      const p = j / (EXIT - 1), fr = { typed: null, pressed: [], kb: 0 };
      const recOf = (side) => {
        const pp = clamp01(p - (side === 'L' ? 0.012 : 0));
        if (pp < UNLAND) { const h = landing(1 - inOut(pp / UNLAND)); h.calm = 1 - pp / UNLAND; return h; }
        if (pp < REACH_END) return reaching((pp - UNLAND) / (REACH_END - UNLAND));
        if (pp < HOOK_END) return hooking(inOut((pp - REACH_END) / (HOOK_END - REACH_END)));
        return hooking(1, TUG(clamp01((pp - HOOK_END) / (TUG_END - HOOK_END))));
      };
      fr.R = recOf('R'); fr.L = recOf('L');
      // the tug moves the board a little; then it goes, the hands with it
      fr.kb = p <= HOOK_END ? 0 : p <= TUG_END ? 3.5 * TUG((p - HOOK_END) / (TUG_END - HOOK_END)) : 3.5 + (KB_OUT - 3.5) * PULL((p - TUG_END) / (1 - TUG_END));
      exitRecs.push(fr);
    }
    // off the keys the hands are loose, and the page eases them between frames
    const exit = exitRecs.map((fr, j) => frameOf(fr, loop0 + j - (j % 2), { breathe: j < 6, glide: j / (EXIT - 1) > UNLAND }));
    return { fps: FPS, frames, intro: loop0, loop: [loop0, frames.length], exit, text };
  }

  // ---- the mouse: the right hand's other desk tool --------------------------------------
  // A two-button wheel mouse on the desk beside the board, in its own frame in mm: x across
  // (right), y toward the typist (front of the mouse at -y), h up off the desk. It sits where
  // the right hand already is, turned with the forearm, so the hand only has to come down
  // onto it. The hand on it is a recipe like the keys' ({ m: { b, w, p } }): which button is
  // down, where the index is on the wheel, how far the press has gone.
  const Z_DESK = Z_FRAME + 16 * MM;
  const ML = 62, MW = 33;                                         // half length, half width
  const MOUSE_YAW = (P.mouseYaw ?? -8) * DEG;
  const halfW = (y) => MW * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(y) / ML, 2.6)), 1 / 2.6) * (1 + 0.07 * (y / ML));
  const ridge = ((f) => (y) => f(y / ML))(curve([[-1, 13], [-0.86, 21], [-0.52, 28], [0, 34], [0.24, 36], [0.59, 32], [0.86, 21], [1, 8]]));
  const hOf = (x, y) => { const w = halfW(y); return w <= 0 ? 0 : ridge(y) * Math.pow(Math.max(0, 1 - (x / w) ** 2), 0.32); };
  // where the buttons meet the desk's keys: the split between the buttons, at their front,
  // lands between J and K, a little toward the typist of where the fingers rest
  const M_AT = { u: uJ + 0.5 + (P.mouseU ?? 0), v: vJ + 0.2 + (P.mouseV ?? 0) };
  const mUV = (x, y) => {
    const c = Math.cos(MOUSE_YAW), s = Math.sin(MOUSE_YAW), y0 = y + 30;   // y -30: the buttons' fingertip line
    return [M_AT.u + (x * c - y0 * s) / 19.05, M_AT.v + (x * s + y0 * c) / 19.05];
  };
  const mWorld = (x, y, h) => { const [u, v] = mUV(x, y); return world(u, v, Z_DESK - h * MM); };
  const mS = (x, y, h = hOf(x, y)) => scr(mWorld(x, y, h));
  /** a fingertip's target on the mouse, in the hand's rig: `up` mm above the surface there */
  const mTarget = (x, y, up = 4) => toRig(mWorld(x, y, hOf(x, y) + up));
  const SEAM = -9, SLOT = [-47, -24];
  const mouseBox = (() => {
    const pts = [];
    for (let j = 0; j <= 48; j++) { const t = (j / 48) * 2 * Math.PI, y = -Math.cos(t) * ML * 1.25, x = Math.sin(t) * MW * 1.25; pts.push(mS(x, y, 0), mS(x * 0.6, y, 40)); }
    for (let y = -ML; y >= -ML - 70; y -= 5) pts.push(mS(0, y, 0));            // the cord, as far as it is drawn
    const x0 = Math.floor(Math.min(...pts.map((p) => p[0]))), y0 = Math.floor(Math.min(...pts.map((p) => p[1])));
    return { x: x0, y: y0, w: Math.ceil(Math.max(...pts.map((p) => p[0]))) - x0, h: Math.ceil(Math.max(...pts.map((p) => p[1]))) - y0 };
  })();

  let mg = null, mareas = null;
  /**
   * The mouse as a layer: paper inside its outline (it sits on the desk, the cord on it),
   * ink outside. `b` the button held ('L', 'R', 'M' or ''), `w` the wheel's turn in mm.
   */
  function mouseLayer(b = '', w = 0, boil = 0) {
    const { x: bx, y: by, w: bw, h: bh } = mouseBox;
    if (!mg) { mg = new PEN.Graphite(bw, bh, P.ss, SEED + 3); mareas = new Uint8Array(bw * bh); }
    const g = mg;
    g.noise = boils[boil % 3];
    g.clear(); mareas.fill(0);
    const at = (p) => [p[0] - bx, p[1] - by];
    const line = (pts, tone, wt, ph, o = {}) => {
      const d = M.resample(pts.map(at), 1.5);
      if (d.length > 1) g.stroke(d, Object.assign({ grade: GRADE, tone: tone * STYLE.tone, weight: wt * WEIGHT, wobble: WOB, taper: 0.45, phase: ph + boil * 17.3 }, o));
    };
    const along = (n, f) => Array.from({ length: n + 1 }, (_, j) => f(j / n));
    // the shell: its foot on the desk, the shoulder where the top turns down into the sides
    const foot = along(64, (t) => { const a = t * 2 * Math.PI, y = -Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** (2 / 2.6) * ML; return [Math.sign(Math.sin(a)) * halfW(y), y]; });
    const footS = foot.map(([x, y]) => mS(x, y, 0));
    const shoulder = foot.map(([x, y]) => mS(x * 0.93, y * 0.97));
    // what shades: the slopes away from the light (high, beyond the far edge, a little left),
    // and the desk under the mouse's near side
    const SH = 1, CAST = 2, mark = (poly, bit) => {
      const pts = poly.map(at), ys = pts.map((p) => p[1]);
      for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(bh - 1, Math.ceil(Math.max(...ys))); y++) {
        const xs = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], c = pts[(i + 1) % pts.length];
          if ((a[1] <= y) !== (c[1] <= y)) xs.push(a[0] + ((y - a[1]) / (c[1] - a[1])) * (c[0] - a[0]));
        }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(bw - 1, Math.floor(xs[k + 1])); x++) mareas[y * bw + x] |= bit;
      }
    };
    const LIGHT = M.vnorm([-0.35, -0.75, 0.75]);
    const IN = 4, SH2 = 8, SKIRT = 16, WELL = 32;
    // the light on the shell, per cell: where it turns from the light it takes a tone, and a
    // second, darker tone where it turns further (the right flank, the slope down to the heel)
    for (let y = -ML; y < ML; y += 1.5) for (let x = -MW; x < MW; x += 1.5) {
      const c = [x + 0.75, y + 0.75];
      if (Math.abs(c[0]) >= halfW(c[1]) * 0.98) continue;
      const hx = (hOf(c[0] + 0.5, c[1]) - hOf(c[0] - 0.5, c[1])), hy = (hOf(c[0], c[1] + 0.5) - hOf(c[0], c[1] - 0.5));
      const lit = M.vdot(M.vnorm([-hx, -hy, 1]), LIGHT), cell = [mS(x, y), mS(x + 1.6, y), mS(x + 1.6, y + 1.6), mS(x, y + 1.6)];
      if (lit < 0.64) mark(cell, SH);
      if (lit < 0.42) mark(cell, SH2);
    }
    const PART = 6;                                                // the parting line: top shell over its base
    const part = foot.map(([x, y]) => mS(x * 0.985, y * 0.99, PART));
    const near = (i) => foot[i][1] > -ML * 0.25;                  // the arc of the foot the eye sees the side of
    mark(footS, IN);
    for (let i = 0; i + 1 < foot.length; i++) if (near(i) && near(i + 1)) mark([footS[i], footS[i + 1], part[i + 1], part[i]], SKIRT);
    mark(foot.map(([x, y]) => mS(x * 1.04 + 3, y + 9, 0)), CAST);
    const c = (SLOT[0] + SLOT[1]) / 2, half = (SLOT[1] - SLOT[0]) / 2 - 1.5;
    const slotAt = (r, k = 1) => along(40, (t) => { const a = t * 2 * Math.PI; return mS(Math.cos(a) * r, c + Math.sin(a) * ((SLOT[1] - SLOT[0]) / 2) * k); });
    mark(slotAt(5.2), WELL);
    const hatch = (want, dir, gap, tone, wt, ph, fade = null) => {
      const G = gap * X;
      for (let k = Math.floor((dir > 0 ? 0 : -bh) / G); k <= Math.ceil((bw + (dir > 0 ? bh : 0)) / G); k++) {
        let run = [], vis = [];
        const flush = () => { if (run.length > 2) g.stroke(run, { grade: GRADE, tone: tone * STYLE.tone, weight: wt * WEIGHT, wobble: 0.45, jitter: 0.3, taper: 0.55, phase: ph + k * 1.37 + boil * 17.3, close: false, vis }); run = []; vis = []; };
        for (let y = 0; y < bh; y += 1.5) {
          const x = k * G - dir * y, xi = Math.round(x), yi = Math.round(y);
          if (xi < 0 || xi >= bw || !want(mareas[yi * bw + xi])) { flush(); continue; }
          run.push([x, y]); vis.push(fade ? fade(x, y) : 1);
        }
        flush();
      }
    };
    /** a stroke lightened where the form faces the light: `lit(i)` 0..1 per resampled point */
    const shaded = (pts, tone, wt, ph, o = {}, lit) => {
      const d = M.resample(pts.map(at), 1.5);
      if (d.length < 2) return;
      g.stroke(d, Object.assign({ grade: GRADE, tone: tone * STYLE.tone, weight: wt * WEIGHT, wobble: WOB, taper: 0.45, phase: ph + boil * 17.3, vis: d.map((p, i) => 1 - 0.55 * lit(p, i / (d.length - 1))) }, o));
    };
    /** a long edge as the board's are drawn: the line, and a faint one beside it that it searched along */
    const edge = (pts, tone, wt, ph, o = {}, lit = () => 0) => {
      shaded(pts, tone, wt, ph, o, lit);
      const d = M.resample(pts.map(at), 1.5), n = d.length;
      if (n < 30) return;
      for (const [off, k] of [[1.6 * X, 0], [-2.4 * X, 1]]) {
        const sh = d.map((p, i) => {
          const a = d[Math.max(0, i - 1)], e = d[Math.min(n - 1, i + 1)], dl = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
          return [p[0] - ((e[1] - a[1]) / dl) * off + bx, p[1] + ((e[0] - a[0]) / dl) * off + by];
        });
        const a0 = Math.floor(n * (0.1 + 0.3 * k)), a1 = Math.floor(n * (0.5 + 0.42 * k));
        line(sh.slice(a0, a1), tone * 0.18, wt * 0.8, ph + 40 + k * 21.3, { taper: 0.9, wobble: WOB * 1.9, close: false });
      }
    };
    // the desk: the mouse's shadow toward the reader and right, fading as it leaves the foot
    const [sy0, sy1] = [mS(0, ML * 0.4, 0)[1] - by, mS(0, ML + 12, 0)[1] - by];
    hatch((m) => (m & CAST) && !(m & IN), 1, 3.4, 0.24, 0.42, 5100, (x, y) => 0.45 + 0.55 * (1 - smooth(clamp01((y - sy0) / (sy1 - sy0)))));
    hatch((m) => (m & CAST) && !(m & IN), -1, 5.2, 0.12, 0.4, 5110);
    // the shell in its own shade; the base below the parting line, turned under
    hatch((m) => (m & SH) && (m & IN) && !(m & WELL), 1, 3.4, 0.22, 0.42, 5200);
    hatch((m) => (m & SH2) && (m & IN) && !(m & WELL), -1, 3.8, 0.17, 0.4, 5300);
    hatch((m) => (m & SKIRT), 1, 2.6, 0.3, 0.42, 5400);
    hatch((m) => (m & SKIRT) && (m & SH), -1, 3.6, 0.18, 0.4, 5410);
    // the outline, heavier where it turns away from the light (the near side and the right)
    const litFoot = (p, t) => { const a = t * 2 * Math.PI; return clamp01(0.55 * Math.cos(a) - 0.55 * Math.sin(a)); };
    edge(footS, 0.98, 1.35, 5000, { close: true, taper: 0 }, litFoot);
    shaded(part.slice(16, 49), 0.55, 0.75, 5005, { taper: 0.5 }, (p, t) => 0.4 * (1 - t));
    shaded(shoulder.slice(8, 57), 0.24, 0.55, 5010, { taper: 0.8 }, (p, t) => (t < 0.5 ? 0.6 : 0));
    // the grips: ribs moulded into each flank, under the thumb and under the little finger
    for (const sx of [-1, 1]) for (let y = -12; y <= 22; y += 3.2) {
      const wy = halfW(y);
      line(along(5, (t) => mS(sx * wy * (0.985 - 0.1 * t), y, PART + 1 + t * (hOf(sx * wy * 0.885, y) - PART - 1))), sx > 0 ? 0.45 : 0.3, 0.5, 5500 + sx * 40 + y, { taper: 0.6 });
    }
    // the buttons: a gap across where they hinge from the shell, and a gap between them
    const seamAt = (x, d = 0) => mS(x, SEAM + 1.2 * (x / MW) ** 2 + d);
    const across = along(36, (t) => (t * 2 - 1) * halfW(SEAM) * 0.97);
    line(across.map((x) => seamAt(x)), 0.7, 0.8, 5020, { taper: 0.3 });
    line(across.map((x) => seamAt(x, -0.9)), 0.25, 0.5, 5021, { taper: 0.5 });
    for (const sx of [-0.55, 0.55]) {
      line(along(8, (t) => mS(sx, SLOT[1] + 0.5 + t * (SEAM - SLOT[1] - 0.5))), sx < 0 ? 0.62 : 0.4, 0.65, 5030 + sx, { taper: 0.2 });
      line(along(8, (t) => mS(sx, -ML + 1.2 + t * (SLOT[0] - 0.5 - (-ML + 1.2)))), sx < 0 ? 0.62 : 0.4, 0.65, 5040 + sx, { taper: 0.2 });
    }
    // the buttons' lip over the nose
    line(along(20, (t) => { const a = Math.PI * (0.18 + 0.64 * t), y = -ML + 2.2 - Math.sin(a) * 0.8; return mS(-Math.cos(a) * halfW(y) * 0.86, y); }), 0.3, 0.55, 5045, { taper: 0.6 });
    // a held button sits down in the shell: its seam opens and its face takes a tone
    if (b === 'L' || b === 'R') {
      const sx = b === 'L' ? -1 : 1, xs = along(18, (t) => sx * (0.06 + t * 0.9) * halfW(SEAM));
      line(xs.map((x) => seamAt(x, -0.7)), 0.95, 1.05, 5050, { taper: 0.4 });
      line(along(10, (t) => mS(sx * 1.1, -ML + 2 + t * (SEAM + 1 - (-ML + 2)))), 0.8, 0.85, 5060, { taper: 0.3 });
      mark(along(24, (t) => { const y = -ML + 3 + t * (SEAM - 2 - (-ML + 3)); return mS(sx * halfW(y) * 0.86, y); }).concat([mS(sx * 1.5, SEAM - 2), mS(sx * 1.5, -ML + 3)]), 64);
      hatch((m) => (m & 64) && !(m & WELL), sx, 3, 0.16, 0.4, 5070);
    }
    // the wheel in its well: the rim, the dark of the well either side, the wheel's crown and
    // its ridges turning past
    edge(slotAt(5.2), 0.78, 0.85, 5075, { close: true, taper: 0 });
    line(slotAt(4.4, 0.93), 0.35, 0.55, 5076, { close: true, taper: 0 });
    hatch((m) => (m & WELL), 1, 1.8, 0.45, 0.45, 5077);
    hatch((m) => (m & WELL), -1, 2.2, 0.3, 0.42, 5078);
    const sunk = b === 'M' ? 1.4 : 0;
    const crown = (y) => hOf(0, y) + 2.2 * Math.sqrt(Math.max(0, 1 - ((y - c) / half) ** 2)) - sunk;
    const tread = along(24, (t) => c - half + t * 2 * half);
    // the wheel itself is paper over the dark of its well
    const face = tread.map((y) => mS(-3.3, y, crown(y))).concat(tread.slice().reverse().map((y) => mS(3.3, y, crown(y))));
    const fa = face.map(at), fy = fa.map((p) => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...fy))); y <= Math.min(bh - 1, Math.ceil(Math.max(...fy))); y++) {
      const xs = [];
      for (let i = 0; i < fa.length; i++) { const p0 = fa[i], p1 = fa[(i + 1) % fa.length]; if ((p0[1] <= y) !== (p1[1] <= y)) xs.push(p0[0] + ((y - p0[1]) / (p1[1] - p0[1])) * (p1[0] - p0[0])); }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(bw - 1, Math.floor(xs[k + 1])); x++) for (let sy = 0; sy < g.ss; sy++) g.buf.fill(0, (y * g.ss + sy) * g.W + x * g.ss, (y * g.ss + sy) * g.W + (x + 1) * g.ss);
    }
    for (const x of [-3.3, 3.3]) line(tread.map((y) => mS(x, y, crown(y) - 0.6)), x > 0 ? 0.7 : 0.5, 0.65, 5080 + x, { taper: 0.4 });
    const PITCH = 2.6;
    for (let k = -14; k <= 14; k++) {
      const y = c + k * PITCH + (((w % PITCH) + PITCH) % PITCH);
      if (Math.abs(y - c) > half * 0.94) continue;
      const fade = 1 - ((y - c) / half) ** 2;
      line([mS(-3, y, crown(y)), mS(3, y, crown(y))], 0.28 + 0.4 * fade, 0.55, 5100 + k * 3.1, { taper: 0.3 });
      line([mS(-2.6, y + 0.7, crown(y + 0.7)), mS(2.6, y + 0.7, crown(y + 0.7))], 0.12 * fade, 0.45, 5150 + k * 2.3, { taper: 0.5 });
    }
    // the cord: a sleeve out of the nose, then the cord as a tube, away up the desk and off
    const cordAt = (t) => [1.8 * Math.sin(t * 3.2) + 3 * t * t, -ML - t * 70, 3.2 * (1 - t) + 1.4];
    const sleeve = along(6, (t) => cordAt(t * 0.13));
    for (const sx of [-1, 1]) line(sleeve.map(([x, y, h], i) => mS(x + sx * (2.4 - 0.15 * i), y, h)), sx > 0 ? 0.75 : 0.55, 0.75, 5190 + sx, { taper: 0.2 });
    for (const t of [0.03, 0.065, 0.1]) { const [x, y, h] = cordAt(t); line([mS(x - 2.2, y, h), mS(x + 2.2, y, h)], 0.4, 0.5, 5195 + t * 100, { taper: 0.3 }); }
    const cord = along(30, (t) => cordAt(0.13 + 0.87 * t));
    line(cord.map(([x, y, h]) => mS(x - 1.3, y, h)), 0.55, 0.75, 5200, { taper: 0.9 });
    line(cord.map(([x, y, h]) => mS(x + 1.3, y, h)), 0.8, 0.85, 5210, { taper: 0.9 });
    line(cord.map(([x, y, h]) => mS(x + 0.6, y, h + 0.6)), 0.12, 0.45, 5220, { taper: 0.9 });
    // paper inside the foot so the mouse covers the desk; the cord fades as it goes
    const alpha = inkAlpha(g), data = new Uint8ClampedArray(bw * bh * 4);
    const cy1 = mS(0, -ML - 66, 1.5)[1] - by, cy0 = mS(0, -ML - 10, 3)[1] - by;
    for (let p = 0; p < bw * bh; p++) {
      const y = (p / bw) | 0, f = cy1 < cy0 ? smooth(clamp01((y - cy1) / (cy0 - cy1))) : 1;
      const a = alpha[p], al = mareas[p] & 4 ? 1 : a * f;
      const t = al > 0 ? a / al : 0;
      data[p * 4] = lerp(PAPER[0], INK[0], t); data[p * 4 + 1] = lerp(PAPER[1], INK[1], t); data[p * 4 + 2] = lerp(PAPER[2], INK[2], t); data[p * 4 + 3] = Math.round(al * 255);
    }
    return { data, x: bx, y: by, w: bw, h: bh };
  }

  // The hand on the mouse. Where each digit goes, mm in the mouse's frame: index and middle
  // on the buttons, the ring finger and little finger curled against the right flank, the
  // thumb against the left. On the wheel, the index moves back onto it; the middle stays put.
  const GRIP = { 1: [-13.5, -30, 4], 2: [12.5, -28, 4], 3: [MW + 3, -6, 6], 4: [MW + 5, 14, 2] };
  const THUMB_GRIP = [-MW - 4, 2, 9];
  const MOUSE_T = [P.mouseT?.[0] ?? 0, P.mouseT?.[1] ?? 6, P.mouseT?.[2] ?? 9];
  const mouseCache = new Map();
  /** b: button held, w: index travel along the wheel (mm, + toward the typist), p: 0..1 into the press */
  function mousePose({ b = '', w = 0, p = 0, o = 0 }) {
    const on = o || b === 'M';
    const key = JSON.stringify([b, w, p, on ? 1 : 0]);
    if (mouseCache.has(key)) return mouseCache.get(key);
    const S = shiftOf(MOUSE_T);
    let pose = clone(HOME.R);
    pose.wrist.flex += P.mouseW?.[0] ?? 0.05; pose.wrist.dev += P.mouseW?.[1] ?? 0; pose.wrist.pron += P.mouseW?.[2] ?? 0;
    const press = 2.2 * p;
    const tgt = (d) => {
      if (d === 1 && on) return mTarget(0, (SLOT[0] + SLOT[1]) / 2 + w, 6.2 - (b === 'M' ? press : 0));
      const [x, y, up] = GRIP[d];
      return mTarget(x, y, up - ((b === 'L' && d === 1) || (b === 'R' && d === 2) ? press : 0));
    };
    for (let pass = 0; pass < 2; pass++) {
      for (let d = 1; d <= 4; d++) pose = PO.reach(A, pose, d, M.vsub(tgt(d), S), { iters: 60, tol: 0.25 });
      pose = PO.reach(A, pose, 0, M.vsub(mTarget(...THUMB_GRIP), S), { iters: 60, tol: 0.25 });
    }
    mouseCache.set(key, pose);
    return pose;
  }
  /** a mouse recipe as its hand spec, for handLayer and the pool's cache */
  const mouseSpec = (m) => JSON.stringify({ m: { b: m.b || '', w: q(m.w || 0, 0.5), p: q(m.p || 0, 0.25), o: m.o || m.b === 'M' ? 1 : 0 } });
  /** where the hand's layer goes with the mouse: the hand moves as the desk moves under it */
  const mouseOffset = offsetOf('R', MOUSE_T);

  // ---- drawing a hand ----------------------------------------------------------------
  /**
   * One hand as a layer for the compositor: paper inside its silhouette so it sits on the
   * keys, ink outside. `boil` picks one of three noise fields (drawn on twos). Placed in
   * panel px; the left hand comes back already mirrored.
   */
  function handLayer(side, spec, boil = 0) {
    R.g.noise = boils[boil % 3];
    const b = draw(poseOf(side, spec), VIEW_H, FIT, 2);
    // the drawing's box: what reads as ink, and the cells the hand covers (paper), each boxed on its own
    const hit = { x0: HS, y0: HS, x1: -1, y1: -1 };
    const alpha = inkAlpha(R.g, 0, 0, HS, HS, hit);
    const { div, w: dw, i0 } = b.df, dh = (i0.length / dw) | 0;
    let cx0 = dw, cx1 = -1, cy0 = dh, cy1 = -1;
    for (let cy = 0; cy < dh; cy++) {
      const row = cy * dw;
      let l = 0;
      while (l < dw && i0[row + l] < 0) l++;
      if (l === dw) continue;
      let r = dw - 1;
      while (i0[row + r] < 0) r--;
      if (l < cx0) cx0 = l; if (r > cx1) cx1 = r; if (cy < cy0) cy0 = cy; cy1 = cy;
    }
    let { x0, y0, x1, y1 } = hit;
    if (cx1 >= 0) {
      const px0 = cx0 * div, py0 = cy0 * div, px1 = Math.min(HS - 1, cx1 * div + div - 1), py1 = Math.min(HS - 1, cy1 * div + div - 1);
      if (px0 < x0) x0 = px0; if (py0 < y0) y0 = py0; if (px1 > x1) x1 = px1; if (py1 > y1) y1 = py1;
    }
    if (x1 < 0) return { data: new Uint8ClampedArray(4), x: 0, y: 0, w: 1, h: 1 };
    const w = x1 - x0 + 1, h = y1 - y0 + 1, data = new Uint8ClampedArray(w * h * 4), mirror = side === 'L';
    // the forearm trails off toward the foot of the sheet, the way a drawing of a hand stops:
    // wherever the sheet ends on the page, there is no cut
    const F0 = HS * (spec.startsWith('{"m"') ? 0.88 : 0.72), F1 = HS - 14 * X;
    for (let y = 0; y < h; y++) {
      const sy = y0 + y, f = 1 - smooth(clamp01((sy - F0) / (F1 - F0))), arow = sy * HS, crow = ((sy / div) | 0) * dw;
      for (let x = 0; x < w; x++) {
        const sx = x0 + x, av = alpha[arow + sx];
        const a = av * f, al = (i0[crow + ((sx / div) | 0)] >= 0 ? 1 : av) * f, t = al > 0 ? a / al : 0;
        const o = (y * w + (mirror ? w - 1 - x : x)) * 4;
        data[o] = lerp(PAPER[0], INK[0], t); data[o + 1] = lerp(PAPER[1], INK[1], t); data[o + 2] = lerp(PAPER[2], INK[2], t); data[o + 3] = Math.round(al * 255);
      }
    }
    const pos = mirror ? [posL[0] + (HS - 1 - x1), posL[1] + y0] : [posR[0] + x0, posR[1] + y0];
    return { data, x: Math.round(pos[0]), y: Math.round(pos[1]), w, h };
  }

  // ---- the grip: the right hand taking a page by its corner ------------------------------
  /**
   * t 0: reaching, the fingers long and the thumb out; t 1: the corner held between the
   * index pad (on top) and the thumb (under it), the other fingers curled out of the way.
   * Targets in the rig's own frame (+X distal, +Y ulnar, +Z palmar), off the home pose's tips.
   */
  const gripCache = new Map();
  const GRIP_AT = (() => { const T = GK.rig.solve(A, HOME.R).digits.map((d) => d.tip); return M.vadd(T[1], [9 * MM, -12 * MM, 2 * MM]); })();
  function gripPose(t) {
    const key = q(t, 0.02);
    if (gripCache.has(key)) return gripCache.get(key);
    const T = GK.rig.solve(A, HOME.R).digits.map((d) => d.tip), e = smooth(clamp01(t));
    const mix = (a, b) => [0, 1, 2].map((i) => lerp(a[i], b[i], e));
    const tgt = {
      1: mix(M.vadd(T[1], [14 * MM, 2 * MM, -7 * MM]), GRIP_AT),
      0: mix(M.vadd(T[0], [8 * MM, -10 * MM, -2 * MM]), M.vadd(GRIP_AT, [-1 * MM, 0, 3.5 * MM])),
    };
    for (let d = 2; d <= 4; d++) tgt[d] = mix(M.vadd(T[d], [(10 - 2 * d) * MM, 0, -5 * MM]), M.vadd(T[d], [-(6 + 3 * d) * MM, -2 * MM, 5 * MM]));
    let pose = clone(HOME.R);
    pose.wrist.flex += lerp(-0.05, 0.08, e);
    for (let pass = 0; pass < 2; pass++) for (const d of [1, 2, 3, 4, 0]) pose = PO.reach(A, pose, d, tgt[d], { iters: 60, tol: 0.25 });
    gripCache.set(key, pose);
    return pose;
  }
  // the grip reaches past the typing sheet's head: framed lower on it, the wrist still at its foot
  const GFIT = { ...FIT, cy: FIT.cy + 150 * X };
  const GVIEW = R.build({ seed: SEED, pose: home0, view: VIEW_H, fit: GFIT, quality: 0, contacts: false }).view;
  /** the grip as a layer, as handLayer draws a hand, with where the held corner is in it */
  function gripLayer(t, boil = 0) {
    R.g.noise = boils[boil % 3];
    const b = draw(gripPose(t), VIEW_H, GFIT, 2);
    const alpha = inkAlpha(R.g);
    const { div, w: dw, i0 } = b.df;
    const inside = (x, y) => i0[((y / div) | 0) * dw + ((x / div) | 0)] >= 0;
    // the drawing's box is inside what the pencil touched and what the hand covers: look only there
    const [sx0, sy0, sx1, sy1] = scanBox(R.g, b.df, HS);
    let x0 = HS, x1 = -1, y0 = HS, y1 = -1;
    for (let y = sy0; y <= sy1; y++) for (let x = sx0; x <= sx1; x++) if (alpha[y * HS + x] > 0.004 || inside(x, y)) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, data = new Uint8ClampedArray(w * h * 4);
    const F0 = HS * 0.72, F1 = HS - 14 * X;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = x0 + x, sy = y0 + y, f = 1 - smooth(clamp01((sy - F0) / (F1 - F0)));
      const a = alpha[sy * HS + sx] * f, al = (inside(sx, sy) ? 1 : alpha[sy * HS + sx]) * f, k = al > 0 ? a / al : 0;
      const o = (y * w + x) * 4;
      data[o] = lerp(PAPER[0], INK[0], k); data[o + 1] = lerp(PAPER[1], INK[1], k); data[o + 2] = lerp(PAPER[2], INK[2], k); data[o + 3] = Math.round(al * 255);
    }
    const rig = GK.rig.solve(A, gripPose(t)), tip = rig.digits[1].tip, pin = GVIEW.px(tip);
    return { data, w, h, pin: [pin[0] - x0, pin[1] - y0] };
  }

  // ---- measurements --------------------------------------------------------------------
  const pxPerMm = FIT.scale * MM;
  const rowCache = new Map();
  /** per-row leftmost silhouette x of a pose on its own sheet (cheap quality-0 draw) */
  function rowsOf(side, spec) {
    const key = side + spec;
    if (rowCache.has(key)) return rowCache.get(key);
    const b = draw(poseOf(side, spec), VIEW_H, FIT, 0);
    const { div, w, h, i0 } = b.df, rows = new Int16Array(HS).fill(-1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (i0[y * w + x] >= 0) {
      for (let yy = y * div; yy < Math.min(HS, (y + 1) * div); yy++) if (rows[yy] < 0 || x * div < rows[yy]) rows[yy] = x * div;
      break;
    }
    rowCache.set(key, rows);
    return rows;
  }
  /** narrowest gap between the hands in a frame, mm (negative: they overlap), and the panel row */
  function clearance(fr) {
    if (!fr.R || !fr.L) return { mm: Infinity, row: -1 };
    const rR = rowsOf('R', fr.R), rL = rowsOf('L', fr.L), oR = fr.offR || [0, 0], oL = fr.offL || [0, 0];
    let best = Infinity, row = -1;
    for (let Y = 0; Y < PH; Y++) {
      const yr = Math.round(Y - posR[1] - oR[1]), yl = Math.round(Y - posL[1] - oL[1]);
      if (yr < 0 || yr >= HS || yl < 0 || yl >= HS || rR[yr] < 0 || rL[yl] < 0) continue;
      const gap = posR[0] + oR[0] + rR[yr] - (posL[0] + oL[0] + HS - 1 - rL[yl]);
      if (gap < best) { best = gap; row = Y; }
    }
    return { mm: best / pxPerMm, row };
  }
  /** share of the thumb's two outer bones that is the front-most surface: 1 in plain view, 0 under the palm */
  function thumbSeen(pose) {
    const b = draw(pose, VIEW_H, FIT, 0);
    const segs = new Set(b.ids.digit[0].slice(-2)), { i0, i1 } = b.df;
    let front = 0, behind = 0;
    for (let i = 0; i < i0.length; i++) { if (segs.has(i0[i])) front++; else if (segs.has(i1[i])) behind++; }
    return front / Math.max(1, front + behind);
  }
  /** how far the little finger's middle joints jut outward past the line from its knuckle to its tip, mm */
  function pinkyBulge(pose) {
    const dg = GK.rig.solve(A, pose).digits[4];
    const pts = dg.joints.map((j) => VIEWH.px(j.P)).concat([VIEWH.px(dg.tip)]);
    const a = pts[1], b = pts[pts.length - 1];
    const nx = b[1] - a[1], ny = -(b[0] - a[0]), L = Math.hypot(nx, ny) || 1, out = nx / L > 0 ? 1 : -1;
    let worst = 0;
    for (const p of pts.slice(2, -1)) worst = Math.max(worst, (out * ((p[0] - a[0]) * nx + (p[1] - a[1]) * ny)) / L);
    return worst / pxPerMm;
  }
  /** the home pose against what a typing hand looks like; each with its pass line */
  function metrics() {
    const rg = GK.rig.solve(A, HOME.R);
    const reach = Math.max(...HOME_KEYS.R.map((n, i) => M.vlen(M.vsub(rg.digits[i + 1].tip, keyTarget('R', i + 1, homeUV('R', i + 1), 0))))) / MM;
    const clear = clearance({ R: 'home', L: 'home' }).mm;
    const vis = thumbSeen(HOME.R), bulge = pinkyBulge(HOME.R);
    const onBar = THUMB_AT.v >= 4.05 && THUMB_AT.v <= 4.95 && THUMB_AT.u >= 6.9 && THUMB_AT.u <= 8.6;
    return [
      { key: 'clear', label: 'hand gap', value: clear, unit: 'mm', ok: clear >= P.clear },
      { key: 'thumbVis', label: 'thumb seen', value: vis * 100, unit: '%', ok: vis >= 0.75 },
      { key: 'thumbH', label: 'thumb over keys', value: THUMB_AT.h, unit: 'mm', ok: THUMB_AT.h >= 3 && THUMB_AT.h <= 12 },
      { key: 'thumbAt', label: 'thumb on bar', value: THUMB_AT.v, unit: 'row', ok: onBar, detail: `u ${THUMB_AT.u.toFixed(2)} v ${THUMB_AT.v.toFixed(2)}` },
      { key: 'pinky', label: 'little finger bulge', value: bulge, unit: 'mm', ok: bulge <= 1.5 },
      { key: 'reach', label: 'fingertip off key', value: reach, unit: 'mm', ok: reach <= 2 },
    ];
  }
  /** the gap in every frame of a schedule: the worst, and how many fall under the line */
  function checkAll(frames) {
    let worst = { mm: Infinity, frame: -1 }, under = 0;
    const gaps = frames.map((fr, i) => {
      const c = clearance(fr);
      if (c.mm < worst.mm) worst = { mm: c.mm, frame: i };
      if (c.mm < P.clear) under++;
      return Math.round(c.mm * 10) / 10;
    });
    return { worst, under, total: frames.length, gaps };
  }

  return {
    params: P,
    layout: { PW, PH, HS, X, posR, posL, XM, keyboardRect, pxPerMm },
    keys: keys.map(({ id, name, legend, box }) => ({ id, name, legend, box })),
    schedule, handLayer, gripLayer, keyboardLayer, keyPatch, metrics, checkAll, poseOf,
    mouse: { box: mouseBox, offset: mouseOffset, spec: mouseSpec, layer: mouseLayer },
    /** the right hand on its own sheet: front part per pixel (-1 none, 0 palm, else digit*10+segment) and every joint */
    debug(spec = 'home') {
      const pose = poseOf('R', spec), b = draw(pose, VIEW_H, FIT, 0), { div, w, h, i0 } = b.df;
      const part = new Map([[b.ids.palm, 0]]);
      b.ids.digit.forEach((segs, d) => segs.forEach((id, k) => part.set(id, 10 * (d + 1) + k)));
      const front = new Int16Array(w * h).map((_, i) => (i0[i] < 0 ? -1 : part.get(i0[i]) ?? 99));
      const rig = GK.rig.solve(A, pose);
      const joints = rig.digits.map((dg) => dg.joints.map((j) => VIEWH.px(j.P)).concat([VIEWH.px(dg.tip)]));
      const trace = [];
      R.draw({ seed: SEED, pose, view: VIEW_H, fit: FIT, style: STYLE, layers: LAYERS, detail: { shade: 0.7 }, quality: 2, contacts: false, trace });
      return { HS, div, w, h, front, joints, trace: trace.map((t) => ({ src: t.src, pts: t.pts.map((q) => [q[0], q[1]]) })) };
    },
  };
}
