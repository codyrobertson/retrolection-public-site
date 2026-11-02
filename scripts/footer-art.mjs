// The foot of the page (SmokeFooter): a left hand resting on a plank veneer, one finger lifting
// and pressing, an ashtray with a lit cigarette, a still wisp for the no-motion case. The hand
// is the hero's (same engine, same pencil, same weight and boil: scripts/curl-hand.mjs does the
// page-turning one); the rest is drawn here with the same pencil. Everything is written as an
// alpha coverage mask, so the page tints it: graphite on the paper stock, chalk on the dark.
//
//   node scripts/footer-art.mjs [az=-38 el=-8 roll=-90] [--only hand|tray|wood] [--preview out.png]
//
// The cigarette is drawn on its own layers (cig-ink, cig-ash, cig-body, cig-shadow, the dish's size) and the
// hand has reach, pinch and flick frames, so the hand can take it up and tap it (src/lib/cig-break.ts).
//
// public/footer/*.webp + src/lib/footer-art.json (css px at --s: 1; the page scales it).

import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import GK from '../src/lib/typing/gk.js';
import { outlines, tone as toneMap, hatch } from './footer-art/trace.mjs';
import { ring, nails, sleeve, hull, polyCover, drawSleeve, armShadow, tablePlane, shadow, blur } from './footer-art/cloth.mjs';

const { math: M, pose: PO, render: RE, pencil: PEN } = GK;
const { vadd, vmul } = M;
const args = Object.fromEntries(process.argv.slice(2).filter((a) => /^\w+=/.test(a)).map((a) => a.split('=')));
const flag = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const only = flag('--only');
const probeOnly = process.argv.includes('--probe');    // one rest frame, nothing written but the preview
const preview = flag('--preview');
const want = (part) => !only || only === part;

const DEG = Math.PI / 180;
const X = 2;                                       // drawn at 2× for sharp edges on a retina screen
const HS = 900 * X, SEED = 12345;                  // the hero's sheet and seed
const OUT = 'public/footer', TMP = `${tmpdir()}/footer-art-${process.pid}`;
const PX_MM = +(args.pxmm ?? 1.7);                                 // css px a millimetre of hand is drawn at, at full size (the ashtray is drawn in px: ~11 cm across at this)
const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (t) => t * t * (3 - 2 * t);
mkdirSync(OUT, { recursive: true }); mkdirSync(TMP, { recursive: true });

/** raw coverage (0..1) -> RGB 0, alpha = coverage, as a lossy webp: the page tints it */
function writeMask(name, cov, w, h, quality = 70, alpha = 85) {
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba[i * 4 + 3] = Math.round(clamp01(cov[i]) * 255);
  const raw = `${TMP}/${name}.rgba`;
  writeFileSync(raw, rgba);
  execFileSync('magick', ['-size', `${w}x${h}`, '-depth', '8', `rgba:${raw}`, '-define', 'webp:lossless=false', '-quality', String(quality), '-define', `webp:alpha-quality=${alpha}`, `${OUT}/${name}.webp`]);
  rmSync(raw);
}
/** ink coverage straight from a deposit buffer: scene.js's inkAlpha */
function coverage(g) {
  const { ss, W: GW, buf, w, h } = g, out = new Float32Array(w * h), inv = 1 / (ss * ss);
  const D = g.dirty();
  if (!D) return out;
  for (let y = D.y0; y <= D.y1; y++) for (let x = D.x0; x <= D.x1; x++) {
    let d = 0;
    for (let sy = 0; sy < ss; sy++) { const row = (y * ss + sy) * GW + x * ss; for (let sx = 0; sx < ss; sx++) d += buf[row + sx]; }
    out[y * w + x] = clamp01((1 - Math.exp(-1.55 * d * inv)) * 1.05 - 0.01);
  }
  return out;
}

// --only rewrites one part: the rest of the json stays
const JSON_AT = 'src/lib/footer-art.json';
const meta = { ...(only && existsSync(JSON_AT) ? JSON.parse(readFileSync(JSON_AT, 'utf8')) : {}), x: X, pxPerMm: PX_MM };

// ---- the hand ---------------------------------------------------------------------
// The hero's renderer, style and weight, a different view: the left hand (the right model,
// mirrored) lying palm down, fingers toward the ashtray, thumb toward the viewer.
async function hand() {
  const HAND_MM = 188, MM = 164 / HAND_MM;         // rig units per mm (scene.js)
  const SCALE = (PX_MM * X) / MM;                  // sheet px per rig unit
  const STYLE = { grade: 3.2, tone: 1.2, wobble: 0.75, ghost: 0.05, paper: [255, 255, 255], ink: [26, 25, 23] };
  // the hero's own layers (scene.js), so the two hands are one hand drawn twice
  const LAYERS = { contour: true, crease: true, fold: true, nail: true, model: true, palmcrease: true, tendon: false, vein: false, hatch: false, hair: false, print: false, ridge: false, bone: false };
  if (args.lay) for (const k of Object.keys(LAYERS)) LAYERS[k] = args.lay.split(',').includes(k);   // debugging: just these layers
  const DETAIL = { shade: +(args.shade ?? 0.7), vein: +(args.vein ?? 0.35), lattice: +(args.lattice ?? 0), hair: 0 };
  const R = new RE.Renderer(HS, HS);
  const A = GK.anatomy.buildAnatomy(SEED, { chirality: 'right' }); R._an = A; R._anSeed = SEED;
  // shorter, fuller fingers than the engine's default: the photo's hand is a broad, relaxed one
  { const th = A.bones[0]; th.lengths = th.lengths.map((v) => v * +(args.tlen ?? 0.9)); th.breadth *= +(args.tw ?? 0.93); }   // a smaller thumb
  for (let d = 1; d <= 4; d++) { const bn = A.bones[d]; for (let k = 1; k < bn.lengths.length; k++) bn.lengths[k] *= +(args.flen ?? 0.865); bn.breadth *= +(args.fw ?? 1.12); bn.jw[2] *= 0.99; bn.jw[3] *= +(args.tipw ?? 0.96); }   // tips taper rather than blob
  R.g = new PEN.Graphite(HS, HS, 2, SEED);
  const base = R.g.stroke.bind(R.g);
  R.g.stroke = (pts, o) => base(pts, { ...o, weight: (o && o.weight !== undefined ? o.weight : 1) * 1.575 * X });
  const boils = [0, 1, 2].map((n) => new M.Noise(SEED * 7 + n * 101));
  const VIEW = { az: +(args.az ?? 0) * DEG, el: +(args.el ?? 10) * DEG, roll: +(args.roll ?? -14) * DEG };

  const CURL = +(args.curl ?? 0.4);                    // how far the resting fingers bend: 1 as in the photo, toward 0 long and flat
  const SPREAD = (args.spread ?? '0.3,0.08,0.4,0.6').split(',').map(Number);   // each finger's spread from the middle: the photo's, a relaxed open hand
  const REST = {
    wrist: [0.03, +(args.dev ?? -0.6), +(args.pron ?? 0)], arch: +(args.arch ?? 0.22),
    thumb: [+(args.thumb ?? -0.45), +(args.tabd ?? -0.4), +(args.topp ?? -0.7), +(args.tmcp ?? 0.15), +(args.tip ?? 0)],   // tucked along the index, pointing forward
    f: [[0.14, 0.30, 0.16, 0.14], [0.20, 0.40, 0.26, 0.03], [0.24, 0.46, 0.30, 0.06], [0.32, 0.54, 0.38, 0.16]]
      
      .map(([m, p, d], i) => [m * CURL, p * CURL * +(args.pipk ?? 1), d * CURL * +(args.dipk ?? 0.5), +(args.abd ?? 1) * SPREAD[i]]),
  };
  /** REST with finger d (1..4) given [mcp, pip, dip] and its neighbours' knuckles nudged with it */
  const withFinger = (d, [m, p, di], { neighbours = 0 } = {}) => {
    const s = JSON.parse(JSON.stringify(REST));
    s.f[d - 1] = [m, p, di, REST.f[d - 1][3]];
    for (const n of [d - 2, d]) if (s.f[n]) s.f[n][0] += neighbours;
    return s;
  };
  const rest = (d) => REST.f[d - 1];
  const UP = (d) => withFinger(d, [rest(d)[0] - 0.2, rest(d)[1] + 0.3, rest(d)[2] + 0.12], { neighbours: -0.03 });   // the knuckle lifts, the finger opens: its tip rises ~2 cm
  const STRIKE = (d) => withFinger(d, [rest(d)[0] + 0.08, rest(d)[1] + 0.10, rest(d)[2]], { neighbours: 0.02 });     // pad pressed down
  const pose = (spec) => PO.clampPose(A, PO.mk(A, spec));

  // pinned framing, as the hero's: one fit for every frame so the hand never swims
  const probe = R.build({ seed: SEED, pose: pose(REST), view: VIEW, quality: 0, margin: 0.8, contacts: false });
  const midX = (HS / 2 - probe.view.cx) / probe.view.scale, midY = (HS / 2 - probe.view.cy) / probe.view.scale;
  const FIT = { scale: SCALE, cx: HS / 2 - SCALE * midX, cy: HS / 2 - SCALE * midY };

  // one pencil for every frame: only the finger that moves may change, or the whole drawing shimmers at each tap
  const HALF = (d) => withFinger(d, UP(d).f[d - 1].slice(0, 3).map((v, k) => (v + rest(d)[k]) / 2), { neighbours: -0.015 });
  const FRAMES = [['rest', 0, REST]];
  for (let d = 1; d <= 4; d++) FRAMES.push(['half', 0, HALF(d)], ['up', 0, UP(d)], ['strike', 0, STRIKE(d)]);
  // the cigarette (SmokeFooter): the hand opens toward the ashtray, takes the filter between the thumb and
  // the index finger, and taps it with the index; the other fingers stay loose, as they lie at rest
  const num = (k, d) => (args[k] ?? d).split(',').map(Number);
  const loose = (k) => REST.f.slice(1).map(([m, p, d, a], i) => [m + k * (0.12 + 0.04 * i), p + k * (0.2 + 0.04 * i), d + k * 0.1, a * (1 - 0.4 * k)]);
  const PINCH = { wrist: REST.wrist, arch: 0.3, thumb: num('pthumb', '0.3,-0.2,0,0.2,0.2'), f: [num('pidx', '0.45,0.6,0.3,-0.4'), ...loose(1)] };
  const REACH = { wrist: REST.wrist, arch: 0.24, thumb: num('rthumb', '-0.25,-0.3,-0.35,0.15,0.1'), f: [num('ridx', '0.1,0.15,0.08,-0.4'), ...loose(0.4)] };
  const FLICK = { ...PINCH, f: [num('fidx', '0.2,0.25,0.1,-0.4'), ...PINCH.f.slice(1)] };
  FRAMES.push(['reach', 0, REACH], ['pinch', 0, PINCH], ['flick', 0, FLICK]);
  // and the stages between, so the fingers open and close through the motion rather than jumping to it (cig-break steps through them)
  const blend = (a, b, t) => (Array.isArray(a) ? a.map((v, i) => blend(v, b[i], t)) : typeof a === 'number' ? a + (b - a) * t : a);
  const tween = (a, b, t) => ({ wrist: blend(a.wrist, b.wrist, t), arch: blend(a.arch, b.arch, t), thumb: blend(a.thumb, b.thumb, t), f: blend(a.f, b.f, t) });
  FRAMES.push(['reach1', 0, tween(REST, REACH, 1 / 3)], ['reach2', 0, tween(REST, REACH, 2 / 3)]);
  FRAMES.push(['pinch1', 0, tween(REACH, PINCH, 0.25)], ['pinch2', 0, tween(REACH, PINCH, 0.5)], ['pinch3', 0, tween(REACH, PINCH, 0.75)]);
  FRAMES.push(['flick1', 0, tween(PINCH, FLICK, 0.5)]);
  const GRIP = {};                                  // frame name -> where the thumb and index meet, on the sheet

  const noiseH = new M.Noise(SEED + 9);
  const MM_PER_UNIT = HAND_MM / 164;
  const MIRROR = !!+(args.mirror ?? 0);            // 1: a left hand (the right model, mirrored)
  const RING = !!+(args.ring ?? 0), CUFF = !!+(args.cuff ?? 1), SHADOW = !!+(args.shadow ?? 1);
  const SLEEVE_MM = +(args.sleeve ?? 56), BAND_MM = +(args.band ?? 18);            // how much sleeve shows above the page's foot
  const UNDER_MM = +(args.under ?? 34);              // and how much more is drawn, below it: the arm swings and reaches (cig-break) without its end showing
  let under = 0;                                     // that much, in sheet px
  const cg = new PEN.Graphite(HS, HS, 2, SEED + 1);
  const cbase = cg.stroke.bind(cg);
  cg.stroke = (pts, o) => cbase(pts, { ...o, weight: (o && o.weight !== undefined ? o.weight : 1) * 1.575 * X });
  let owner = null;                                 // part id -> which digit it belongs to (palm -1)
  const DROP = +(args.drop ?? 34) / MM_PER_UNIT;     // how far the sleeve is pushed up the arm: the rig ends at the wrist, so that much forearm is drawn here
  let arm = null, armMask = null, fg = null;
  const ARM_T0 = +(args.armt0 ?? -12);
  const WRIST_CUT = +(args.wcut ?? 4);               // mm before the rig's wrist loop where its lines give way to the forearm's                // where the forearm's cone begins, back inside the heel of the hand, so the two run into each other
  let sl = null, plane = null, beyond = null;                // beyond(x, y): past the sleeve's cut, off the cell
  /** two or three faint extensor ridges, soft tapered curves from the wrist toward the knuckles of the index, middle and ring fingers */
  function ridges(b) {
    const { div, w: dw, h: dh, i0 } = b.df, pxMm = PX_MM * X;
    const c0 = b.view.px(sl.C), c1 = b.view.px(vadd(sl.C, vmul(sl.ax, -10)));
    let ux = c0[0] - c1[0], uy = c0[1] - c1[1]; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;    // toward the fingers
    const nx = -uy, ny = ux;
    const amp = +(args.ridge ?? 0.35);   // off unless asked (ridges=1): the hero draws none
    for (const d of [1, 2, 3]) {
      let pmin = 1e9, cnt = 0, kx = 0, ky = 0;
      for (let y = 0; y < dh; y += 1) for (let x = 0; x < dw; x += 1) {
        const id = i0[y * dw + x]; if (id < 0 || owner[id] !== d) continue;
        const sx = (x + 0.5) * div, sy = (y + 0.5) * div, pr = (sx - c0[0]) * ux + (sy - c0[1]) * uy;
        if (pr < pmin - 3) { pmin = pr; cnt = 0; kx = 0; ky = 0; }
        if (pr < pmin + 3) { cnt++; kx += sx; ky += sy; }
      }
      if (!cnt) continue;
      kx /= cnt; ky /= cnt;
      const lat = (kx - c0[0]) * nx + (ky - c0[1]) * ny, along = pmin;
      const t0 = 16 * pxMm, t1 = Math.max(t0 + 20 * pxMm, along - 7 * pxMm);
      const S = [c0[0] + ux * t0 + nx * lat * 0.35, c0[1] + uy * t0 + ny * lat * 0.35];
      const E = [c0[0] + ux * t1 + nx * lat * 0.97, c0[1] + uy * t1 + ny * lat * 0.97];
      const bow = (d === 1 ? -7 : d === 2 ? 5 : 8) * pxMm * +(args.bow ?? 0.6);
      const C = [(S[0] + E[0]) / 2 + nx * bow, (S[1] + E[1]) / 2 + ny * bow];
      const pts = []; for (let k = 0; k <= 28; k++) { const t = k / 28, a = (1 - t) * (1 - t), bq = 2 * t * (1 - t), c = t * t; pts.push([a * S[0] + bq * C[0] + c * E[0], a * S[1] + bq * C[1] + c * E[1]]); }
      R.g.stroke(pts, { grade: PEN.gradeAt(+(args.rg ?? 1.2)), tone: 0.3 * amp, weight: +(args.rw ?? 1.3), passes: 2, taper: 0.95, wobble: 0.9, jitter: 0.5, phase: d * 31 });
    }
  }
  /** the bare forearm between the wrist and the hem: its two edges, and fine hair lying toward the elbow, thicker on the outer side */
  function forearm(b, i0, dw, div, g) {
    const { view } = b, hand = (p) => { const x = (p[0] / div) | 0, y = (p[1] / div) | 0; return x >= 0 && y >= 0 && x < dw && i0[y * dw + x] >= 0 && !pastWrist(b, p[0], p[1]); };
    const ca = view.px(arm.C), cb = view.px(vadd(arm.C, vmul(arm.ax, -10))), dl = Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) || 1, ux = (cb[0] - ca[0]) / dl, uy = (cb[1] - ca[1]) / dl, nx = -uy, ny = ux;
    let jLo = 0, jHi = 0, lo = 1e9, hi = -1e9;
    for (let j = 0; j < arm.nLoop; j++) { const p = view.px(arm.at(DROP * 0.5, j)), v = (p[0] - ca[0]) * nx + (p[1] - ca[1]) * ny; if (v < lo) { lo = v; jLo = j; } if (v > hi) { hi = v; jHi = j; } }
    for (const j of [jLo, jHi]) {
      const pts = Array.from({ length: 25 }, (_, i) => view.px(arm.at(ARM_T0 + 1 + ((DROP + 6 - ARM_T0 - 1) * i) / 24, j)));
      g.stroke(pts, { grade: PEN.gradeAt(3.4), tone: 1.1, weight: 1.0, passes: 2, taper: 0.4, wobble: 0.7, jitter: 0.4, vis: pts.map((p) => (hand(p) ? 0 : 1)), phase: j });
    }
    const rnd = M.mulberry32(SEED + 77), pxMm = PX_MM * X, N = +(args.hair ?? 160);
    for (let k = 0; k < N; k++) {
      const t = 3 + rnd() * (DROP + 1), side = rnd();                                   // side 0: the thumb's edge, 1: the little finger's
      const q0 = view.px(arm.at(t, jLo)), q1 = view.px(arm.at(t, jHi));
      if (rnd() > (0.15 + 0.85 * side) * smooth(clamp01((t - 3) / 12))) continue;        // sparse toward the thumb and the wrist
      const x = q0[0] + (q1[0] - q0[0]) * (0.08 + 0.84 * side), y = q0[1] + (q1[1] - q0[1]) * (0.08 + 0.84 * side);
      if (hand([x, y])) continue;
      const a = (rnd() - 0.5) * 0.8 + 0.3, len = (1.4 + rnd() * 2) * pxMm;
      const dx = ux * Math.cos(a) - uy * Math.sin(a), dy = ux * Math.sin(a) + uy * Math.cos(a);
      g.stroke([[x, y], [x + dx * len * 0.5 + nx * 0.6, y + dy * len * 0.5 + ny * 0.6], [x + dx * len, y + dy * len]], { grade: PEN.gradeAt(2.2), tone: 0.22 + 0.16 * rnd(), weight: 0.42, passes: 1, taper: 0.7, wobble: 0.5, jitter: 0.3, phase: k });
    }
  }
  /** past the rig's wrist, inside the drawn forearm: the model ends there in a cut, which is not the arm's */
  function pastWrist(b, x, y) {
    if (!armMask || armMask[Math.min(HS - 1, Math.max(0, y | 0)) * HS + Math.min(HS - 1, Math.max(0, x | 0))] < 0.5) return false;
    const c = b.view.px(arm.C), e = b.view.px(vadd(arm.C, vmul(arm.ax, -10))), dl = Math.hypot(e[0] - c[0], e[1] - c[1]) || 1;
    return ((x - c[0]) * (e[0] - c[0]) + (y - c[1]) * (e[1] - c[1])) / dl > -WRIST_CUT * PX_MM * X;
  }
  /** one frame: ink coverage and the silhouette, on the full sheet */
  function layer(spec, boil) {
    R.g.noise = boils[boil % 3]; cg.noise = boils[(boil + 1) % 3];
    const b = R.draw({ seed: SEED, pose: pose(spec), view: VIEW, fit: FIT, style: STYLE, layers: LAYERS, detail: DETAIL, quality: 2, contacts: false });
    const { div, w: dw, i0, z0 } = b.df, upp = b.view.mmPerPx * div;
    { const t = b.view.px(b.rig.digits[0].tip), f = b.view.px(b.rig.digits[1].tip); spec.grip = [(t[0] + f[0]) / 2, (t[1] + f[1]) / 2]; }
    if (!owner) { owner = new Int8Array(64).fill(-2); owner[b.ids.palm] = -1; b.ids.digit.forEach((segs, d) => segs.forEach((id) => { if (id >= 0) owner[id] = d; })); }
    if (!sl) {
      sl = sleeve(GK.rig, b.rig, { gape: +(args.gape ?? 1.85), band: BAND_MM / MM_PER_UNIT, step: +(args.step ?? 0), drop: +(args.drop ?? 34) / MM_PER_UNIT });
      const tEnd = (SLEEVE_MM + UNDER_MM) / MM_PER_UNIT, pE = b.view.px(vadd(sl.C, vmul(sl.ax, -tEnd))), p0 = b.view.px(sl.C);
      const pV = b.view.px(vadd(sl.C, vmul(sl.ax, -SLEEVE_MM / MM_PER_UNIT)));
      // the sleeve leaves the cell through the edge it runs most toward: cut square to that edge
      const dx = pE[0] - p0[0], dy = pE[1] - p0[1];
      if (Math.abs(dy) > Math.abs(dx)) { const c = Math.round(pE[1]), s = Math.sign(dy); beyond = (x, y) => (y - c) * s > 0; under = Math.abs(pE[1] - pV[1]); }
      else { const c = Math.round(pE[0]), s = Math.sign(dx); beyond = (x) => (x - c) * s > 0; under = Math.abs(pE[0] - pV[0]); }
      sl.tEnd = tEnd;
    }
    if (DROP && !arm) {
      // the forearm from the wrist to the hem: the wrist's own loop, swelling a little toward the elbow
      arm = sleeve(GK.rig, b.rig, { gape: +(args.armgape ?? 1.55), flare: +(args.armflare ?? 0.004), band: 0, step: 0 });
      // the rig's wrist sits toward the little finger and is thin: the arm's axis moves toward the thumb, so the radius
      // runs on from the root of the thumb, as a real wrist does from above
      { let jt = 0, lo = 1e9; const c = b.view.px(arm.C);
        for (let j = 0; j < arm.nLoop; j++) { const p = b.view.px(arm.wp(j)); if (p[0] - c[0] < lo) { lo = p[0] - c[0]; jt = j; } }
        const d = M.vnorm(M.vsub(arm.wp(jt), arm.C)), sh = +(args.armshift ?? 8), at0 = arm.at;
        arm.at = (t, j) => vadd(at0(t, j), vmul(d, sh)); arm.C = vadd(arm.C, vmul(d, sh));
        const st0 = sl.at; sl.at = (t, j) => vadd(st0(t, j), vmul(d, sh)); sl.C = vadd(sl.C, vmul(d, sh)); }   // and the sleeve round it
      const loop = [];
      for (let j = 0; j < arm.nLoop; j += 2) for (const t of [ARM_T0, DROP + 6]) loop.push(b.view.px(arm.at(t, j)));
      const poly = hull(loop);
      armMask = new Float32Array(HS * HS);
      let x0 = HS, x1 = 0, y0 = HS, y1 = 0;
      for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(HS - 1, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(HS - 1, Math.ceil(x1)); x++) armMask[y * HS + x] = polyCover(poly, x, y);
    }
    // the heel of the hand where it leaves the cuff: the rig's wrist ends in a corner, so round it off (gently, cells only)
    if (CUFF && !DROP && +(args.round ?? 1)) {
      const c0 = b.view.px(sl.C), c1 = b.view.px(vadd(sl.C, vmul(sl.ax, -10)));
      let ux = c0[0] - c1[0], uy = c0[1] - c1[1]; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      const dh = (i0.length / dw) | 0, m = new Float32Array(dw * dh);
      for (let k = 0; k < m.length; k++) m[k] = i0[k] >= 0 ? 1 : 0;
      const rb = blur(m, dw, dh, Math.max(2, Math.round((+(args.roundr ?? 7) * PX_MM * X) / div)), 3), win = +(args.roundw ?? 40) * PX_MM * X;
      for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
        const k = y * dw + x; if (i0[k] < 0 || rb[k] >= 0.5) continue;
        const pr = ((x + 0.5) * div - c0[0]) * ux + ((y + 0.5) * div - c0[1]) * uy;
        if (pr > 0 && pr < win) { i0[k] = -1; z0[k] = -1e18; }
      }
    }
    // the outline: one continuous line under the engine's, light, so the silhouette closes where the engine's contour lifts
    if (!+(args.nooutline ?? 0)) for (const { pts, closed } of outlines(b.df, { apart: (p, q) => { const op = owner[p], oq = owner[q]; return op !== oq && !((op === -1 && oq > 0) || (oq === -1 && op > 0)); } })) {
      const n = pts.length, vis = pts.map((p, k) => {
        const q = pts[Math.min(n - 1, k + 2)], o = pts[Math.max(0, k - 2)];
        const tx = q[0] - o[0], ty = q[1] - o[1], tl = Math.hypot(tx, ty) || 1;
        const away = (ty / tl) * 0.6 + (-tx / tl) * 0.8;                 // outward normal against the lee
        const [px_, py_] = pts[k], am = armMask ? armMask[Math.min(HS - 1, Math.max(0, Math.round(py_))) * HS + Math.min(HS - 1, Math.max(0, Math.round(px_)))] : 0;
        return clamp01(0.5 + 0.55 * away) * (1 - smooth(clamp01(am * 1.4)));
      });
      R.g.stroke(pts, { grade: PEN.gradeAt(3.4), tone: +(args.otone ?? 0.6), weight: 1.0, passes: 2, taper: closed ? 0 : 0.5, wobble: 0.7, jitter: 0.4, close: closed, vis, phase: n % 97 });
    }
    if (+(args.ridges ?? 0)) ridges(b);
    if (RING) ring(GK.rig, R, b);
    if (+(args.nails ?? 0)) nails(GK.rig, R, b);
    const ink = coverage(R.g);
    if (arm) {                                          // the model's marks past its wrist go; the forearm is drawn in their place
      for (let y = 0; y < HS; y++) for (let x = 0; x < HS; x++) if (ink[y * HS + x] > 0 && pastWrist(b, x, y)) ink[y * HS + x] = 0;
      fg ??= new PEN.Graphite(HS, HS, 2, SEED + 5); fg.clear?.(); if (!fg.clear) fg = new PEN.Graphite(HS, HS, 2, SEED + 5);
      forearm(b, i0, dw, div, fg);
      const fc = coverage(fg); for (let i = 0; i < ink.length; i++) ink[i] = 1 - (1 - ink[i]) * (1 - fc[i]);
    }
    if (+(args.hatch ?? 0)) {
      const t = toneMap(b.df, upp, { gain: +(args.tone ?? 0.3), lift: +(args.lift ?? 0.3), owner, valley: +(args.valley ?? 0), blurFn: blur });
      { const bt = blur(t, HS, HS, 4, 2); for (let i = 0; i < t.length; i++) t[i] = Math.min(t[i], bt[i] * 1.15); }   // no tone thinner than a few px: the seams between the rig's segments are not the hand's
      const hv = hatch(t, HS, HS, { noise: noiseH, pitch: +(args.pitch ?? 4.2) });
      // and the tone itself, softly, with the paper's tooth in it: a graphite wash under the hatching
      const wash = blur(t, HS, HS, 5, 2), W2 = +(args.wash ?? 0.32);
      for (let y = 0; y < HS; y++) for (let x = 0; x < HS; x++) {
        const i = y * HS + x, w = wash[i];
        let a = hv[i];
        if (w > 0.02) { const tooth = hash2(x + 11, y + 5); a = 1 - (1 - a) * (1 - W2 * Math.pow(w, 1.2) * (0.4 + 0.9 * tooth)); }
        ink[i] = 1 - (1 - ink[i]) * (1 - a);
      }
    }
    if (+(args.groove ?? 0)) {                          // a hairline of shadow where one digit lies against the next
      const gv = new Float32Array(HS * HS);
      const own = (x, y) => { const id = i0[((y / div) | 0) * dw + ((x / div) | 0)]; return id >= 0 ? owner[id] : -2; };
      for (let y = 0; y < HS - 1; y++) for (let x = 0; x < HS - 1; x++) {
        const o = own(x, y); if (o < 0) continue;
        const r = own(x + 1, y), d = own(x, y + 1);
        if ((r >= 0 && r !== o) || (d >= 0 && d !== o)) gv[y * HS + x] = 1;
      }
      const gb = blur(gv, HS, HS, 1, 1);
      for (let i = 0; i < gb.length; i++) if (gb[i] > 0.02) ink[i] = 1 - (1 - ink[i]) * (1 - Math.min(0.6, gb[i] * 1.5 * (0.55 + 0.7 * hash2(i % HS, (i / HS) | 0))));
    }
    const body = new Float32Array(HS * HS);
    for (let y = 0; y < HS; y++) for (let x = 0; x < HS; x++) if (i0[((y / div) | 0) * dw + ((x / div) | 0)] >= 0) body[y * HS + x] = 1;
    if (armMask) for (let i = 0; i < body.length; i++) body[i] = Math.max(body[i], armMask[i]);
    // a light warm graphite wash over the whole hand, so it is paper and not a white cutout: heavier
    // on the side away from the light (down and toward the thumb), with the paper's tooth and a fine stipple
    if (+(args.skin ?? 0)) {
      let bx0 = HS, bx1 = 0, by0 = HS, by1 = 0;
      for (let y = 0; y < HS; y++) for (let x = 0; x < HS; x++) if (body[y * HS + x]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      const lx = -0.35, ly = 0.94, p0 = bx0 * lx + by0 * ly, p1 = bx1 * lx + by1 * ly, lo = Math.min(p0, bx1 * lx + by0 * ly, bx0 * lx + by1 * ly), hi = Math.max(p1, bx1 * lx + by0 * ly, bx0 * lx + by1 * ly);
      const base = +(args.skin0 ?? 0.02), grad = +(args.skin1 ?? 0.055);
      for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
        const i = y * HS + x; if (!body[i]) continue;
        const g = smooth(clamp01((x * lx + y * ly - lo) / (hi - lo || 1)));
        const h = hash2(x, y);
        let a = (base + grad * g) * (0.55 + 0.9 * h);
        if (h > 0.9935 - 0.005 * g) a = Math.max(a, 0.09 + 0.13 * g);          // stipple
        ink[i] = 1 - (1 - ink[i]) * (1 - a);
      }
    }
    // the sleeve, on its own sheet: it hides the wrist and forearm, and the hand hides it where it is nearer
    let inCuff = null;
    if (CUFF) {
      cg.clear();
      const { depth, shade } = drawSleeve(sl, b.view, cg, { tLen: sl.tEnd + 30, W: HS, H: HS, mmPerUnit: MM_PER_UNIT, pxMm: PX_MM * X, robe: !!+(args.robe ?? 1) });
      const cov = coverage(cg);
      const loop = [];
      for (let j = 0; j < sl.nLoop; j += 2) for (const t of [0, sl.band, sl.band + 8, sl.tEnd * 0.5, sl.tEnd + 30]) loop.push(b.view.px(sl.at(t, j)));
      const poly = hull(loop);
      let hx0 = HS, hx1 = 0, hy0 = HS, hy1 = 0;
      for (const [x, y] of poly) { hx0 = Math.min(hx0, x); hx1 = Math.max(hx1, x); hy0 = Math.min(hy0, y); hy1 = Math.max(hy1, y); }
      inCuff = new Uint8Array(HS * HS);
      for (let y = Math.max(0, Math.floor(hy0) - 2); y <= Math.min(HS - 1, Math.ceil(hy1) + 2); y++) for (let x = Math.max(0, Math.floor(hx0) - 2); x <= Math.min(HS - 1, Math.ceil(hx1) + 2); x++) {
        if (beyond(x, y)) continue;
        const cover = polyCover(poly, x, y);                         // antialiased edge: the sleeve's rim is not a stair
        if (cover <= 0.02) continue;
        const i = y * HS + x, cn = depth[i], hn = z0[i];
        if (hn > -1e17 && cn > -1e17 && hn > cn + 0.6) continue;     // the hand is nearer
        const tooth = hash2(x + 3, y + 17), wash = shade[i] * (0.7 + 0.6 * tooth) * cover;
        inCuff[i] = 1; body[i] = Math.max(body[i], cover);
        ink[i] = 1 - (1 - cov[i]) * (1 - wash);
      }
    }
    let gone = null;
    if (CUFF) {                                   // the forearm beyond the hem, wherever the sleeve does not hide it
      gone = new Uint8Array(HS * HS);
      const c0 = b.view.px(sl.C), c1 = b.view.px(vadd(sl.C, vmul(sl.ax, -10))), ax = c1[0] - c0[0], ay = c1[1] - c0[1];
      for (let y = 0; y < HS; y++) for (let x = 0; x < HS; x++) {
        const i = y * HS + x;
        if (!inCuff[i] && (x - c0[0]) * ax + (y - c0[1]) * ay > 0) { if (body[i]) gone[i] = 1; body[i] = 0; ink[i] = 0; }
      }
    }
    if (CUFF && +(args.contact ?? 1)) {                 // the gape's soft shadow on the hand beside the hem
      const m = new Float32Array(HS * HS); for (let i = 0; i < m.length; i++) m[i] = inCuff[i];
      const bl = blur(m, HS, HS, Math.round(4 * PX_MM * X), 2);
      for (let i = 0; i < bl.length; i++) if (!inCuff[i] && body[i] && !(gone && gone[i])) ink[i] = 1 - (1 - ink[i]) * (1 - Math.min(0.3, 0.36 * Math.pow(Math.min(1, bl[i] / 0.5), 1.5)));
    }
    if (SHADOW && CUFF) {                               // the arm's shadow on the table, as the hand's
      const c0 = b.view.px(sl.C), c1 = b.view.px(vadd(sl.C, vmul(sl.ax, -10))), al = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) || 1;
      const fall = armShadow(armMask ? Float32Array.from(inCuff, (v, i) => Math.max(v, armMask[i] > 0.5 ? 1 : 0)) : inCuff, HS, HS, { c0, u: [(c1[0] - c0[0]) / al, (c1[1] - c0[1]) / al], pxMm: PX_MM * X });
      for (let i = 0; i < fall.length; i++) if (!body[i]) ink[i] = Math.max(ink[i], fall[i]);
    }
    if (SHADOW) {
      if (!plane) plane = tablePlane(b.df);
      const sh = shadow(b.df, plane, { mm: MM_PER_UNIT, pxMm: PX_MM * X, skip: (i) => gone && (inCuff[i] || gone[i]) });
      for (let i = 0; i < sh.length; i++) if (!body[i]) ink[i] = Math.max(ink[i], sh[i]);
    }
    if (CUFF) for (let y = 0; y < HS; y++) for (let x = 0; x < HS; x++) if (beyond(x, y)) { ink[y * HS + x] = 0; body[y * HS + x] = 0; }
    return { ink, body };
  }

  const shown = probeOnly ? FRAMES.filter(([n]) => n === (args.pose ?? 'rest')).slice(0, 1) : FRAMES;
  const sheets = shown.map(([, boil, spec]) => layer(spec, boil));
  // the union box of every frame, padded for the pencil's edge
  let bx0 = HS, by0 = HS, bx1 = 0, by1 = 0;
  for (const { ink, body } of sheets) for (let y = 0; y < HS; y++) for (let x = 0; x < HS; x++) {
    const i = y * HS + x;
    if (ink[i] > 0.004 || body[i]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  }
  // what shows above the page's foot: the layout is fitted to this, the sleeve below it hangs out of sight
  const visCut = Math.round(by1 - under);
  let vx1 = bx0;
  for (const { ink, body } of sheets) for (let y = by0; y <= visCut; y++) for (let x = vx1 + 1; x <= bx1; x++) { const i = y * HS + x; if (ink[i] > 0.004 || body[i]) vx1 = x; }
  const cw = bx1 - bx0 + 1, ch = by1 - by0 + 1, COLS = probeOnly ? 1 : 5, ROWS = probeOnly ? 1 : Math.ceil(FRAMES.length / COLS);
  const gw = cw * COLS, gh = ch * ROWS;
  const inkG = new Float32Array(gw * gh), bodyG = new Float32Array(gw * gh);
  sheets.forEach(({ ink, body }, n) => {
    const ox = (n % COLS) * cw, oy = ((n / COLS) | 0) * ch;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const sx = bx0 + x, i = (by0 + y) * HS + sx, o = (oy + y) * gw + ox + (MIRROR ? cw - 1 - x : x);
      inkG[o] = ink[i]; bodyG[o] = body[i];
    }
  });
  // the body is the silhouette softened a pixel: it hides the wood, ink sits on it
  const bodyS = boxBlur(bodyG, gw, gh);
  if (!probeOnly) { writeMask('hand-ink', inkG, gw, gh, +(args.hq ?? 55), +(args.haq ?? 70)); writeMask('hand-body', bodyS, gw, gh, 40, 50); }
  meta.hand = {
    cell: [cw / X, ch / X], cols: COLS, rows: ROWS, px: [gw, gh], under: Math.round((under / X) * 10) / 10, vis: [(vx1 - bx0 + 1) / X, (visCut - by0 + 1) / X],
    frames: FRAMES.map(([name], n) => ({ name, col: n % COLS, row: (n / COLS) | 0 })),
  };
  for (const [name, , spec] of shown) if (spec.grip) GRIP[name] = [Math.round(((MIRROR ? bx1 - spec.grip[0] : spec.grip[0] - bx0) / X) * 10) / 10, Math.round(((spec.grip[1] - by0) / X) * 10) / 10];
  meta.hand.grip = GRIP;
  console.log('grip', JSON.stringify(GRIP), 'box', bx0, by0, cw, ch);
  return { inkG, bodyG: bodyS, gw, gh, cw, ch };
}

/** a well-mixed 2D hash in [0, 1) */
function hash2(x, y) {
  let h = Math.imul(x + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function boxBlur(a, w, h) {
  const out = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < w && yy >= 0 && yy < h) { s += a[yy * w + xx]; n++; }
    }
    out[y * w + x] = s / n;
  }
  return out;
}

/** coverage planes, each in its colour, onto a ground: a ppm to look at */
function compose(name, w, h, layers, ground) {
  const rgb = Buffer.alloc(w * h * 3);
  const p = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16));
  const G = p(ground), L = layers.map((l) => ({ ...l, rgb: p(l.col) }));
  for (let i = 0; i < w * h; i++) {
    const c = G.slice();
    for (const { cov, rgb: t, op = 1 } of L) {
      const a = (cov[i] || 0) * op;
      for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - a) + t[k] * a;
    }
    rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2];
  }
  const ppm = `${TMP}/${name}.ppm`;
  writeFileSync(ppm, Buffer.concat([Buffer.from(`P6 ${w} ${h} 255\n`), rgb]));
  return ppm;
}


// ---- the ashtray and the cigarette --------------------------------------------------
// Drawn with the hero's pencil, from above, on a square css px sheet: a heavy round glass dish
// with three rests, a lit cigarette lying in the upper right one, its burning end over the middle.
// The hand's light (from the upper left, shadows to the lower right) and the hand's camera: the eye
// sits a little toward the wrist, so a raised point shifts right by 0.23 of its height. Few lines,
// each one meant; the glass is said by the wood showing through its floor.
// at the hand's own scale and a little over (it lies nearer the eye): a dish about 12 cm across, half
// again the palm's width, and a cigarette as long as a finger. The sheet grows with it.
// the sheet runs on past the dish toward the hand, for the filter's shadow; it lies over the gap between them
const TK = +(args.tk ?? 1.15), TSH = TK / 0.84, TH = Math.round(216 * TSH), TW = Math.round(232 * TSH), TGAP = 16 - (TW - TH);
function tray() {
  const W = TW * X, H = TH * X;
  const g = new PEN.Graphite(W, H, 2, 777);
  const grade = (v) => PEN.gradeAt(v);
  let ph = 1;
  const DC = [104 * TSH, 104 * TSH], PM = PX_MM * TK, S = PM * X;     // css px per mm of the dish; sheet px per mm
  const pr = (x, y, z = 0) => [(DC[0] + PM * (0.97 * x + 0.23 * z)) * X, (DC[1] - PM * (y + 0.05 * z)) * X];
  const pol = (r, z, a) => pr(r * Math.cos(a * DEG), r * Math.sin(a * DEG), z);
  const arc = (r, z, a0, a1, n = 120) => Array.from({ length: n + 1 }, (_, i) => pol(r, z, a0 + (a1 - a0) * (i / n)));
  const pen = (target) => (pts, o = {}) => target.stroke(pts, { grade: grade(3.2), tone: 1.1, weight: 1.0, passes: 2, taper: 0.5, wobble: 0.6, jitter: 0.4, phase: ph++, ...o });
  const ink = pen(g);
  const noise = new M.Noise(31);
  const LIGHT = 135;                                     // the light comes from the upper left
  const lit = (a) => 0.5 + 0.5 * Math.cos((a - LIGHT) * DEG);   // 1 where the rim faces the light
  const RIM = 52, LIP = 43, ZR = 22, FLOOR = 31, ZF = 7, GD = 5;   // mm: rim's outer radius, lip's inner, rim height, floor, its height, a rest's depth
  // the rests' angles and half width (mm): the cigarette lies in the first, its filter toward the hand, low
  // enough that the hand reaches it sliding across the table rather than up it
  const AX = +(args.ax ?? 30), RESTS = [AX, AX + 120, AX + 240], HW = 5.2;
  const wall = (t) => ({ r: LIP - (LIP - FLOOR) * t, z: ZR - (ZR - ZF) * Math.pow(t, 1.5) });
  const inRest = (a, r) => RESTS.some((c) => Math.abs(((a - c + 540) % 360) - 180) * DEG * r < HW);

  // the rim: outer and inner edges, each broken at the rests; the outer lost where the light catches it
  const brokenArc = (r, z, o, visAt) => {
    for (let k = 0; k < 3; k++) {
      const a0 = RESTS[k] + (HW / r) / DEG, a1 = RESTS[(k + 1) % 3] + (k === 2 ? 360 : 0) - (HW / r) / DEG;
      const pts = arc(r, z, a0, a1), vis = visAt ? pts.map((_, i) => visAt(a0 + (a1 - a0) * (i / 120))) : undefined;
      ink(pts, { ...o, vis });
    }
  };
  brokenArc(RIM, ZR, { tone: 1.25, passes: 3, taper: 0.15 }, (a) => 1 - 0.8 * Math.pow(lit(a), 6));
  brokenArc(LIP, ZR, { tone: 0.8, passes: 2, weight: 0.9, taper: 0.15 }, (a) => 0.55 + 0.45 * (1 - lit(a)));
  brokenArc(RIM - 2.2, ZR, { grade: grade(1), tone: 0.32, passes: 1, weight: 0.75, taper: 0.6 }, (a) => Math.pow(1 - lit(a), 2));   // the bevel, a thread of glass on the far side

  // each rest: a rounded groove across the rim, its two sides bowing in, its bed one step down
  for (const c of RESTS) {
    for (const s of [-1, 1]) {
      const side = Array.from({ length: 9 }, (_, i) => { const t = i / 8, r = RIM + 0.6 - (RIM - LIP + 1.2) * t, w = HW * (1 - 0.18 * Math.sin(t * Math.PI)); return pol(r, ZR - 0.6 * Math.sin(t * Math.PI), c + (s * w) / r / DEG); });
      const away = Math.cos((c + s * 90 - LIGHT) * DEG) < 0;   // the side wall that faces away from the light is the darker
      ink(side, { tone: away ? 1.0 : 0.6, passes: away ? 2 : 1, weight: 0.9, taper: 0.3 });
    }
    ink(Array.from({ length: 9 }, (_, i) => { const t = i / 8, r = RIM - (RIM - LIP) * t; return pol(r, ZR - GD, c); }), { grade: grade(1), tone: 0.28, passes: 1, weight: 0.8, taper: 0.7 });   // the groove's bed, seen through
  }

  // the outside: the foot's arc, where the eye reaches round the dish's left
  { const pts = arc(RIM - 1, 0, 100, 262), vis = pts.map((_, i) => 0.35 + 0.65 * Math.sin((i / 120) * Math.PI)); ink(pts, { tone: 0.75, passes: 2, vis, taper: 0.5 }); }
  // the inside: the floor's edge, and under the glass, the base's cut star, faint
  ink(arc(FLOOR, ZF, 0, 360, 140), { tone: 0.5, passes: 1, weight: 0.85, close: true, taper: 0 });
  ink(arc(FLOOR - 0.6, ZF, LIGHT - 70, LIGHT + 70), { grade: grade(1.4), tone: 0.5, passes: 2, weight: 1.05, taper: 0.8 });   // the dark crease where the wall in shade meets the floor
  for (let k = 0; k < 16; k++) {
    const a = k * 22.5 + 11.25;
    ink([pol(5, 0.5, a), pol(FLOOR - 4, 0.5, a)], { grade: grade(0.6), tone: 0.13, passes: 1, weight: 0.7, taper: 0.9, wobble: 0.3 });
  }
  ink(arc(4.2, 0.5, 0, 360, 40), { grade: grade(0.6), tone: 0.16, passes: 1, weight: 0.7, close: true, taper: 0 });

  const dish = coverage(g);
  // the inner wall in shade as hatching, the hand's; the rest of the wall is left to the light
  const tw = new Float32Array(W * H);
  {
    const lc = pr(0, 0, ZR), fc = pr(0, 0, ZF);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const rl = Math.hypot(x - lc[0], y - lc[1]) / S, rf = Math.hypot(x - fc[0], y - fc[1]) / S;
      if (rl > LIP - 0.4 || rf < FLOOR + 0.4) continue;
      const a = Math.atan2(-(y - lc[1]), x - lc[0]) / DEG, f = clamp01((LIP - rl) / (LIP - FLOOR));
      tw[y * W + x] = Math.pow(lit(a), 2.2) * (0.35 + 0.65 * f) * 1.05;
    }
    const hv = hatch(tw, W, H, { noise: new M.Noise(55), pitch: 3.2, floor: 0.14, angle: 52 });
    for (let i = 0; i < dish.length; i++) dish[i] = 1 - (1 - dish[i]) * (1 - hv[i]);
  }

  // the cigarette, on its own sheets (paper and ash), so the hand can take it out of the dish
  const c = new PEN.Graphite(W, H, 2, 778), cink = pen(c), ca = new PEN.Graphite(W, H, 2, 779), aink = pen(ca);
  const N0 = [RIM * Math.cos(AX * DEG), RIM * Math.sin(AX * DEG)], DIR = [-Math.cos(AX * DEG), -Math.sin(AX * DEG)], PERP = [-DIR[1], DIR[0]];
  // PERP points to the lower right: v > 0 is the side away from the light
  const RAD = 3.9, U0 = -25, UF = -1, UB = 35, U1 = 45;   // the filter's end, the filter's join, the burn, the tip
  const axisZ = (u) => ZR - GD + RAD - 0.11 * (u - (RIM - LIP) / 2);
  const at = (u, v) => [N0[0] + DIR[0] * u + PERP[0] * v, N0[1] + DIR[1] * u + PERP[1] * v];
  const cp = (u, v, dz = 0) => { const [x, y] = at(u, v); return pr(x, y, axisZ(u) + dz); };
  const run = (v, u0, u1, n = 33) => Array.from({ length: n }, (_, i) => cp(u0 + ((u1 - u0) * i) / (n - 1), v));
  const jag = (v, k) => 0.55 * (noise.n1(v * 0.9 + k) - 0.5) * 2;
  cink(run(RAD, U0, UB + jag(RAD, 3)), { tone: 1.2, passes: 2, taper: 0.1 });            // the edge in shade
  cink(run(-RAD, U0, UB + jag(-RAD, 3)), { tone: 0.7, passes: 2, taper: 0.1 });          // the lit edge
  cink(Array.from({ length: 17 }, (_, i) => { const a = (i / 16) * Math.PI; return cp(U0 - 0.9 * Math.sin(a), RAD * Math.cos(a)); }), { tone: 0.8, passes: 1, weight: 0.9, taper: 0.2 });   // the filter's end
  cink(Array.from({ length: 17 }, (_, i) => { const a = (i / 16) * Math.PI; return cp(U0 + 0.5 - 0.5 * Math.sin(a), RAD * 0.62 * Math.cos(a)); }), { grade: grade(0.8), tone: 0.25, passes: 1, weight: 0.7, taper: 0.4 });   // its cut, inside
  cink(Array.from({ length: 13 }, (_, i) => { const v = -RAD + (2 * RAD * i) / 12; return cp(UF + 0.25 * Math.cos((v / RAD) * 1.4), v); }), { tone: 0.85, passes: 2, weight: 0.9, taper: 0.2 });   // where the tipping ends
  cink(Array.from({ length: 13 }, (_, i) => { const v = -RAD + (2 * RAD * i) / 12; return cp(UF - 1.3 + 0.25 * Math.cos((v / RAD) * 1.4), v); }), { grade: grade(0.8), tone: 0.3, passes: 1, weight: 0.7, taper: 0.4 });   // its thin band
  for (const [v, t] of [[0.5, 0.2], [0.68, 0.26], [0.84, 0.32]]) cink(run(RAD * v, UF + 1.5, UB - 1.8, 21), { grade: grade(1), tone: t, passes: 1, weight: 0.75, taper: 0.85, wobble: 0.35 });   // the paper's round, three long strokes on the shaded side
  cink(run(-RAD * 0.25, UF + 4, UB - 6, 15), { grade: grade(0.5), tone: 0.1, passes: 1, weight: 0.65, taper: 0.9 });   // the seam
  // the burn: a dark, uneven ring, the paper just behind it singed
  cink(Array.from({ length: 15 }, (_, i) => { const v = -RAD + (2 * RAD * i) / 14; return cp(UB + jag(v, 3), v); }), { grade: grade(4), tone: 1.5, passes: 3, weight: 1.15, taper: 0.1, wobble: 0.9 });
  // the ash: a little proud of the paper, grey, rough at the edges, three cracks round it
  const ashR = (u, s) => RAD * (1.04 + 0.05 * (noise.n1(u * 1.3 + s * 7) - 0.5));
  for (const s of [1, -1]) aink(Array.from({ length: 13 }, (_, i) => { const u = UB + 0.3 + ((U1 - 1.2 - UB) * i) / 12; return cp(u, s * ashR(u, s)); }), { grade: grade(1.6), tone: s > 0 ? 0.62 : 0.38, passes: 1, weight: 0.85, taper: 0.25, wobble: 1.1 });
  aink(Array.from({ length: 15 }, (_, i) => { const a = (i / 14) * Math.PI; return cp(U1 - 1.2 + 1.3 * Math.sin(a), RAD * 1.02 * Math.cos(a)); }), { grade: grade(1.8), tone: 0.55, passes: 1, weight: 0.9, taper: 0.3, wobble: 1.0 });   // the tip, round
  for (const [u, k] of [[UB + 2.6, 1], [UB + 5.2, 2], [UB + 7.6, 3]]) aink(Array.from({ length: 9 }, (_, i) => { const v = -RAD * 0.9 + (1.8 * RAD * i) / 8; return cp(u + 0.35 * Math.cos((v / RAD) * 1.4) + jag(v, k * 5) * 0.5, v); }), { grade: grade(1.3), tone: 0.3, passes: 1, weight: 0.7, taper: 0.5, wobble: 0.8 });
  const tip = cp(UB + 1, 0.2), tipPx = [tip[0] / X, tip[1] / X];    // the ember: the coal at the root of the ash, where it stays when the ash is tapped off
  const cig = coverage(c), ash = coverage(ca);

  // the cigarette's footprint on the sheet (and where each point of it stands)
  const tubeUV = (x, y) => {                              // sheet px -> (u, v) on the cigarette's axis plane, near enough
    const mx = (x / X - DC[0]) / PM, my = -(y / X - DC[1]) / PM;
    let u = 0, v = 0;
    for (let it = 0; it < 3; it++) { const z = axisZ(u), px = (mx - 0.23 * z) / 0.97, py = my + 0.05 * z; u = (px - N0[0]) * DIR[0] + (py - N0[1]) * DIR[1]; v = (px - N0[0]) * PERP[0] + (py - N0[1]) * PERP[1]; }
    return [u, v];
  };
  const onTube = (x, y) => { const [u, v] = tubeUV(x, y); return u > U0 - 0.9 && u < U1 + 0.6 && Math.abs(v) < RAD * (u > UB ? 1.06 : 1) - 0.15; };

  // tone laid in straight: the filter's cork mottle, the singe, the ash's grain, a soft heap of ash on the floor under the tip
  const tone = new Float32Array(W * H), atone = new Float32Array(W * H), heapT = new Float32Array(W * H);
  const heap = pr(at(U1 + 1.5, 0.8)[0], at(U1 + 1.5, 0.8)[1], ZF);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, grain = hash2(x, y);
    if (onTube(x, y)) {
      const [u, v] = tubeUV(x, y), shade = clamp01(0.5 + 0.5 * (v / RAD));
      if (u < UF - 1.6) { const spot = noise.fbm(u * 2.4, v * 2.4, 0.7); tone[i] = 0.07 + (spot > 0.58 ? 0.16 : 0.02) * (0.5 + grain) + 0.12 * shade * shade; }
      else if (u > UB - 1.4 && u < UB) tone[i] = 0.16 * (0.5 + grain) * (1 - (UB - u) / 1.4);
      else if (u >= UB) atone[i] = (0.1 + 0.18 * shade) * (0.7 + 0.6 * grain);
    }
    const d = Math.hypot(x - heap[0], y - heap[1]) / S;
    const edge = 3.2 + 1.2 * (noise.fbm(Math.atan2(y - heap[1], x - heap[0]) * 1.7, 2.2, 0.8) - 0.5) * 2;
    if (d < edge + 1) heapT[i] = 0.13 * smooth(clamp01((edge + 1 - d) / 2.6)) * (0.6 + 0.6 * grain);
  }

  // the cigarette's shadow: each point of it thrown down to the lower right onto what lies under it, as far as the hand's are for its height
  const ground = (mx, my) => { const r = Math.hypot(mx, my); if (r > RIM) return 0; if (r > LIP) return ZR; if (r < FLOOR) return ZF; return wall(clamp01((LIP - r) / (LIP - FLOOR))).z; };
  const throwPt = (u, v) => {
    const [x, y] = at(u, v), z = axisZ(u); let gz = ground(x, y);
    for (let it = 0; it < 4; it++) { const h = Math.max(0, z - gz); gz = ground(x + 0.42 * h, y - 0.27 * h); }
    const h = Math.max(0, z - gz), p = cp(u, v); return [p[0] + (1 + 0.35 * h) * S, p[1] + (0.7 + 0.22 * h) * S];   // the hand's throw, on the page
  };
  const cshadow = new Float32Array(W * H);
  const tubeShadow = [...Array.from({ length: 40 }, (_, i) => throwPt(U0 + ((U1 - U0) * i) / 39, -RAD)), ...Array.from({ length: 40 }, (_, i) => throwPt(U1 - ((U1 - U0) * i) / 39, RAD))];
  fillPoly(cshadow, W, H, tubeShadow);

  // the dish's shadow on the wood: the hull of its foot and its rim thrown, glass-light in its middle
  const cast = new Float32Array(W * H), caustic = new Float32Array(W * H), seam = new Float32Array(W * H);
  const base = pr(0, 0, 0), throwRim = (([x, y]) => [x + (2 + 0.35 * ZR) * S, y + (1.5 + 0.22 * ZR) * S])(pr(0, 0, ZR)), Rpx = RIM * S;
  const capsule = (x, y, p, q, r) => { const dx = q[0] - p[0], dy = q[1] - p[1], t = clamp01(((x - p[0]) * dx + (y - p[1]) * dy) / (dx * dx + dy * dy || 1)); return Math.hypot(x - p[0] - t * dx, y - p[1] - t * dy) < r; };
  const rimC = pr(0, 0, ZR);
  const body = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (capsule(x, y, base, throwRim, Rpx)) cast[i] = 1;
    if (Math.hypot(x - (base[0] + throwRim[0]) / 2 - 0.15 * S * ZR, y - (base[1] + throwRim[1]) / 2 - 0.1 * S * ZR) < Rpx * 0.55) caustic[i] = 1;
    if (Math.hypot(x - base[0] - 1.2 * S, y - base[1] - 0.8 * S) < Rpx) seam[i] = 1;
    // the body: paper under the glass, thinner over the floor and the wall, where the wood shows through
    const inDish = capsule(x, y, base, rimC, Rpx);
    if (inDish) {
      const rl = Math.hypot(x - rimC[0], y - rimC[1]) / S, rf = Math.hypot(x - (base[0] + (rimC[0] - base[0]) * ZF / ZR), y - (base[1] + (rimC[1] - base[1]) * ZF / ZR)) / S;
      body[i] = rl > LIP ? 0.96 : rf < FLOOR ? 0.58 : 0.72 + 0.2 * clamp01((rl - FLOOR) / (LIP - FLOOR));
    }
  }
  const tubeM = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (onTube(x, y)) tubeM[y * W + x] = 1;
  const bodyS = blur(body, W, H, 1, 2), cigBody = blur(tubeM, W, H, 1, 2);
  const a = blur(cast, W, H, 5 * X, 3), b = blur(seam, W, H, 3, 2), cl = blur(caustic, W, H, 9 * X, 3), cs = blur(cshadow, W, H, 3, 2);
  // the paper's wash and tooth (skin=1, as the hand's can be): off, as the hero's keyboard, white with hatching
  const SKIN = +(args.skin ?? 0);
  const wash = blur(tw, W, H, 5, 2), lx = 0.6, ly = 0.8, l0 = (base[0] - Rpx) * lx + (base[1] - Rpx) * ly, l1 = (base[0] + Rpx) * lx + (base[1] + Rpx) * ly;
  // the dish (with the ash heap) whole, the cigarette over it in its own layers: paper, ash, and its shadow
  const ink2 = new Float32Array(W * H), cigInk = new Float32Array(W * H), ashInk = new Float32Array(W * H), cigShadow = new Float32Array(W * H);
  for (let i = 0; i < ink2.length; i++) {
    const x = i % W, y = (i / W) | 0;
    let v = 1 - (1 - dish[i]) * (1 - heapT[i]);
    if (SKIN && body[i] > 0.5) {
      const gr = smooth(clamp01((x * lx + y * ly - l0) / (l1 - l0))), h = hash2(x + 7, y + 3);
      let p = (0.02 + 0.05 * gr) * (0.55 + 0.9 * h) + 0.3 * Math.pow(wash[i], 1.2) * (0.4 + 0.9 * h);
      if (h > 0.9935 - 0.005 * gr) p = Math.max(p, 0.09 + 0.13 * gr);
      v = 1 - (1 - v) * (1 - p);
    }
    if (body[i] < 0.5) v = Math.max(v, Math.min(1, a[i] * 0.19 * (1 - 0.55 * cl[i]) + b[i] * 0.12));
    ink2[i] = clamp01(v);
    cigInk[i] = clamp01(1 - (1 - cig[i]) * (1 - tone[i]));
    ashInk[i] = clamp01(1 - (1 - ash[i]) * (1 - atone[i]));
    cigShadow[i] = tubeM[i] ? 0 : cs[i] * (body[i] > 0.5 ? 0.3 : 0.2);
  }
  writeMask('tray-ink', ink2, W, H, 66, 80);
  writeMask('tray-body', bodyS, W, H, 44, 60);
  writeMask('cig-ink', cigInk, W, H, 66, 80);
  writeMask('cig-ash', ashInk, W, H, 66, 80);
  writeMask('cig-body', cigBody, W, H, 44, 60);
  writeMask('cig-shadow', cigShadow, W, H, 44, 60);
  const css = (q) => [Math.round((q[0] / X) * 10) / 10, Math.round((q[1] / X) * 10) / 10];
  const g0 = cp(U0 + 5, 0), g1 = cp(U1, 0);
  meta.tray = { w: TW, h: TH, gap: TGAP, ember: [Math.round(tipPx[0] * 10) / 10, Math.round((TH - tipPx[1]) * 10) / 10] };
  // css px from the sheet's top left: where the fingers take it (on the filter), the burn, the ember, and which way it points
  meta.cig = { pxPerMm: Math.round(PM * 1000) / 1000, z: Math.round(axisZ(U0 + 5) * 10) / 10, floor: ZF, grip: css(g0), burn: css(cp(UB, 0)), ember: css(tip), angle: Math.round((Math.atan2(g1[1] - g0[1], g1[0] - g0[0]) / DEG) * 10) / 10 };
  // the solid it lies in, for the cigarette's physics (cig-physics): the dish's centre on the sheet (css px), its profile and
  // rests (mm, degrees), and the cigarette as drawn: its radius, its stations along the rest's line in from the rim (filter's
  // end, the tipping's join, the burn, the tip), where it is taken, and the fall of its axis
  meta.dish = { c: [Math.round(DC[0] * 1000) / 1000, Math.round(DC[1] * 1000) / 1000], rim: RIM, lip: LIP, zr: ZR, floor: FLOOR, zf: ZF, gd: GD, hw: HW, rests: RESTS,
    rad: RAD, u: [U0, UF, UB, U1], grip: U0 + 5, ember: UB + 1, slope: 0.11 };
  return { ink2, bodyS, cigInk, ashInk, cigBody, cigShadow, W, H };
}
/** a polygon filled into a 0/1 sheet, by scanlines */
function fillPoly(dst, W, H, poly) {
  for (let y = 0; y < H; y++) {
    const xs = [];
    for (let k = 0, n = poly.length; k < n; k++) {
      const [x0, y0] = poly[k], [x1, y1] = poly[(k + 1) % n];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k])); x < Math.min(W, xs[k + 1]); x++) dst[y * W + x] = 1;
  }
}

// ---- the still wisp: the smoke as a drawing, for no motion and no script ---------------
function wisp() {
  const WW = 120, WH = 140;
  const g = new PEN.Graphite(WW * X, WH * X, 2, 991);
  const noise = new M.Noise(991);
  let ph = 50;
  const S = (pts) => pts.map(([x, y]) => [x * X, y * X]);
  const curves = [[0, 0.5], [1, 2.1], [2, 3.4], [3, 4.8]];
  for (const [k, seed] of curves) {
    const pts = Array.from({ length: 7 }, (_, i) => {
      const t = i / 6;
      return [14 + k * 3 + t * (22 + k * 5) + (noise.fbm(seed + t * 2, k, 1.5) - 0.5) * 70 * Math.sin(t * Math.PI + 0.3), WH - 4 - t * 124];
    });
    const sm = M.chaikin(pts, 3);
    const o = { grade: PEN.gradeAt(0.8), tone: 0.5, passes: 1, taper: 0.92, weight: 1, wobble: 1.2, jitter: 0.8, phase: ph++ };
    g.stroke(S(sm), o);
    g.stroke(S(sm.map(([x, y]) => [x + 4 + k, y + 2])), { ...o, tone: 0.26, phase: ph++ });
    g.stroke(S(sm.map(([x, y]) => [x - 5, y - 1])), { ...o, tone: 0.26, phase: ph++ });
  }
  const raw = coverage(g), W = WW * X, H = WH * X;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) raw[y * W + x] *= smooth(clamp01(y / (28 * X)));   // fades out over the top 28 px
  writeMask('wisp-ink', raw, W, H, 62, 62);
  meta.wisp = { w: WW, h: WH, at: [-18, 0] };
  return { raw, W, H };
}

// ---- the wood: plank grain, drawn once, tiling across --------------------------------
function wood() {
  const WW = 1536, WH = 390, XW = 1;
  const g = new PEN.Graphite(WW * XW, WH * XW, 2, 4242);
  const noise = new M.Noise(4242), rnd = M.mulberry32(4242);
  let ph = 100;
  const R = (a, b) => a + (b - a) * rnd();
  // a stroke at x, and one a tile either side, so what runs off one edge comes in at the other
  const wrap = (pts, o) => { for (const dx of [-WW, 0, WW]) g.stroke(pts.map(([x, y]) => [x + dx, y]), { ...o, phase: ph }); ph++; };
  const seams = [0.36 * WH, 0.74 * WH];
  for (const y of seams) wrap(Array.from({ length: 193 }, (_, i) => [i * (WW / 192), y + (noise.fbm(i * 0.03, y, 0.5) - 0.5) * 2.2]), { grade: PEN.gradeAt(3), tone: 0.8, passes: 2, taper: 0, weight: 1.1, wobble: 0.4, jitter: 0.3 });
  const planks = [[-30, seams[0]], [seams[0], seams[1]], [seams[1], WH + 30]];
  planks.forEach(([y0, y1], pi) => {
    const n = Math.round(R(22, 27));
    for (let k = 0; k < n; k++) {
      // denser near a seam: bias the line's row toward the plank's edges
      let t = rnd(); if (rnd() < 0.4) t = rnd() < 0.5 ? rnd() * 0.18 : 1 - rnd() * 0.18;
      const base = y0 + (y1 - y0) * t, amp = R(3, 9), f = R(0.0025, 0.005), off = k * 3.1 + pi * 17;
      let x = R(0, 120);
      while (x < WW + 120) {
        const len = R(160, 520), seg = [];
        for (let u = 0; u <= len; u += 12) seg.push([x + u, base + amp * (noise.fbm((x + u) * f + off, pi, 1.2) - 0.5)]);
        if (seg.length > 1) wrap(seg, { grade: PEN.gradeAt(R(0.6, 1.4)), tone: R(0.4, 0.75), passes: 1, taper: 0.85, weight: R(0.7, 1.1), wobble: 0.6, jitter: 0.4 });
        x += len + R(10, 40);
      }
    }
  });
  // two knots, each a few nested ovals bent by the grain
  for (const [kx, ky, kr] of [[430, 0.55 * WH, 20], [1180, 0.18 * WH, 14]]) {
    for (let i = 1; i <= 5; i++) {
      const r = kr * (i / 5), ring = Array.from({ length: 41 }, (_, j) => { const a = (j / 40) * Math.PI * 2; return [kx + r * 1.7 * Math.cos(a) * (1 + 0.1 * Math.sin(a * 3 + i)), ky + r * 0.8 * Math.sin(a)]; });
      wrap(ring, { grade: PEN.gradeAt(0.9), tone: 0.55, passes: 1, taper: 0.4, weight: 0.8, wobble: 0.5, close: true });
    }
  }
  const cov = coverage(g);
  writeMask('wood-ink', cov, WW * XW, WH * XW, 55, 70);
  meta.wood = { w: WW, h: WH };
  return { cov, W: WW * XW, H: WH * XW };
}

const parts = {};
if (want('hand')) parts.hand = await hand();
if (want('tray')) { parts.tray = tray(); parts.wisp = wisp(); }
if (want('wood')) parts.wood = wood();

// the hand's cell, a gap, the ashtray: the width the page fits to its own
if (meta.hand && meta.tray) meta.groupW = Math.round((meta.hand.vis[0] + meta.tray.gap + meta.tray.w) * 10) / 10;
if (!probeOnly) writeFileSync(JSON_AT, JSON.stringify(meta));
console.log(JSON.stringify(meta));

if (preview) {
  const ppms = [];
  if (parts.hand) {
    const { inkG, bodyG, gw, gh } = parts.hand;
    // the page's stack: a paper-coloured silhouette over the ground, ink over that
    ppms.push(compose('hand-l', gw, gh, [{ cov: bodyG, col: '#f4f1e8' }, { cov: inkG, col: '#1a1917' }], '#d9d3c3'));
    ppms.push(compose('hand-d', gw, gh, [{ cov: bodyG, col: '#141311' }, { cov: inkG, col: '#ebe6da' }], '#2a2824'));
  }
  if (parts.tray) {
    const { ink2, bodyS, cigInk, ashInk, cigBody, cigShadow, W, H } = parts.tray;
    ppms.push(compose('tray-l', W, H, [{ cov: bodyS, col: '#f4f1e8' }, { cov: ink2, col: '#1a1917' }, { cov: cigShadow, col: '#1a1917' }, { cov: cigBody, col: '#f4f1e8' }, { cov: cigInk, col: '#1a1917' }, { cov: ashInk, col: '#1a1917' }], '#d9d3c3'));
    ppms.push(compose('tray-e', W, H, [{ cov: bodyS, col: '#f4f1e8' }, { cov: ink2, col: '#1a1917' }], '#d9d3c3'));
    ppms.push(compose('tray-d', W, H, [{ cov: bodyS, col: '#141311' }, { cov: ink2, col: '#ebe6da' }], '#2a2824'));
    ppms.push(compose('wisp-l', parts.wisp.W, parts.wisp.H, [{ cov: parts.wisp.raw, col: '#1a1917' }], '#f4f1e8'));
  }
  if (parts.wood) {
    const { cov, W, H } = parts.wood;
    // twice side by side: the seam between tiles is the thing to look at
    const two = new Float32Array(W * 2 * H);
    for (let y = 0; y < H; y++) { two.set(cov.subarray(y * W, (y + 1) * W), y * W * 2); two.set(cov.subarray(y * W, (y + 1) * W), y * W * 2 + W); }
    ppms.push(compose('wood-l', W * 2, H, [{ cov: two, col: '#1a1917', op: 1 }], '#f4f1e8'));
  }
  execFileSync('magick', [...ppms, '-append', '-resize', '2400x>', preview]);
  console.log(preview);
}
