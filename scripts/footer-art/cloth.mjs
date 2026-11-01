// The ring, the sleeve and the shadow on the table: what the hero's engine does not draw on a
// hand. All three are built from the rig and the depth field, so they sit right through
// the camera, and hide behind (or in front of) the hand's own parts as the renderer's would.

import GK from '../../src/lib/typing/gk.js';

const { math: M, pencil: PEN } = GK;
const { vadd, vsub, vmul, vdot, vnorm } = M;
const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mean = (pts) => pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0]);

/** the eye's own light, as a screen direction in the rig: upper left of the sheet, a little toward the eye */
const lightOf = (view) => vnorm(vadd(vmul(view.u, 0.36), vmul(view.r, -0.9)));

// ---- the ring: a black band round the ring finger's first phalanx ----------------------------
/** closed rows of pencil round the finger, hidden where the hand hides them, one highlight along the top */
export function ring(RIG, R, b, { d = 3, s0 = 0.10, s1 = 0.26, rows = 7, pad = 0.9 } = {}) {
  const { rig, view, df } = b, g = R.g;
  const eps = Math.max(0.30, view.mmPerPx * 1.1), gap = Math.max(0.90, view.mmPerPx * 3.2);
  const L = lightOf(view), N = 56;
  const row = (s, tone, weight, hi) => {
    const pts = [], vis = [];
    for (let k = 0; k <= N; k++) {
      const alpha = (k / N) * TAU;
      const sp = RIG.digitSurface(rig, d, 1, s, alpha), nrm = RIG.digitNormal(rig, d, 1, s, alpha);
      const Q = vadd(sp.P, vmul(nrm, pad)), p = view.px(Q), z = view.near(Q);
      pts.push(p);
      let v = 1 - df.hidden(p[0], p[1], z, -1, eps, gap);
      v *= smoothstep(-0.05, 0.14, vdot(nrm, view.e));          // the far side of the band is behind the finger
      if (hi) v *= 1 - 0.85 * smoothstep(0.7, 0.95, vdot(nrm, view.e)) * smoothstep(0.25, 0.8, vdot(nrm, L));
      vis.push(v);
    }
    g.stroke(pts, { grade: PEN.gradeAt(4.5), tone, weight, passes: 2, taper: 0, close: true, wobble: 0.3, jitter: 0.25, vis });
  };
  for (let i = 0; i < rows; i++) {
    const s = s0 + (s1 - s0) * (i / (rows - 1)), mid = i > 0 && i < rows - 1;
    row(s, 1.6, 1.15, mid && i >= 2 && i <= 4);
  }
  row(s0, 1.3, 0.95, false); row(s1, 1.3, 0.95, false);
}

// ---- nails -----------------------------------------------------------------------------------
/** a light nail plate on the tip of each of the given fingers: a rounded outline on the dorsal side, hidden where the finger hides it */
export function nails(RIG, R, b, { ds = [1, 2, 3], sA = 0.5, sB = 1.06, half = 0.62, pad = 0.35 } = {}) {
  const { rig, view, df } = b, g = R.g;
  const eps = Math.max(0.30, view.mmPerPx * 1.1), gap = Math.max(0.90, view.mmPerPx * 3.2);
  for (const d of ds) {
    let ad = 0, best = -2;
    for (let k = 0; k < 72; k++) { const a = (k / 72) * TAU, f = vdot(RIG.digitNormal(rig, d, 3, 0.75, a), view.e); if (f > best) { best = f; ad = a; } }
    const pts = [], vis = [], N = 56;
    for (let k = 0; k <= N; k++) {
      const th = (k / N) * TAU, c = Math.cos(th), sn = Math.sin(th);
      const cx = Math.sign(c) * Math.pow(Math.abs(c), 0.62), cy = Math.sign(sn) * Math.pow(Math.abs(sn), 0.62);
      const s = (sA + sB) / 2 + ((sB - sA) / 2) * cx + (cx >= 0 ? -0.03 : 0.04) * (1 - Math.abs(cy)), a = ad + half * cy * (0.9 + 0.1 * (cx * 0.5 + 0.5));
      const sp = RIG.digitSurface(rig, d, 3, s, a), nrm = RIG.digitNormal(rig, d, 3, s, a), Q = vadd(sp.P, vmul(nrm, pad)), p = view.px(Q);
      pts.push(p);
      vis.push((1 - df.hidden(p[0], p[1], view.near(Q), -1, eps, gap)) * smoothstep(0.05, 0.3, vdot(nrm, view.e)));
    }
    g.stroke(pts, { grade: PEN.gradeAt(3.4), tone: 0.8, weight: 0.8, passes: 1, taper: 0, close: true, wobble: 0.3, jitter: 0.2, vis });
  }
}

// ---- the sleeve ------------------------------------------------------------------------------
/**
 * where the sleeve is: its loop at the hem (t = 0), the way it runs (toward the elbow), and a surface function.
 * A shirt cuff: a snug band `band` rig units long, then the sleeve proper, `step` wider and gathered into it.
 */
export function sleeve(RIG, rig, { gape = 1.14, flare = 0.0016, nLoop = 200, band = 0, step = 0, drop = 0 } = {}) {
  const ax = vnorm(vsub(RIG.palmSurface(rig, -0.08, 0.25).P, RIG.palmSurface(rig, -0.5, 0.25).P));
  // the wrist's loop, slid `drop` up the forearm: a sleeve pushed back shows some arm
  const W = Array.from({ length: nLoop }, (_, j) => vadd(RIG.palmSurface(rig, -0.08, j / nLoop).P, vmul(ax, -drop)));
  const C = mean(W);
  const wp = (j) => {                                  // the loop at a fractional index
    const f = Math.floor(j), u = j - f, a = W[((f % nLoop) + nLoop) % nLoop], b = W[(((f + 1) % nLoop) + nLoop) % nLoop];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  };
  const radius = (t) => gape * (1 + step * smoothstep(band - 2, band + 6, t)) + flare * t;
  const at = (t, j) => vadd(vadd(C, vmul(ax, -t)), vmul(vsub(wp(j), C), radius(t)));
  const normalAt = (j) => vnorm(vsub(wp(j), C));
  return { W, C, ax, nLoop, at, normalAt, wp, band };
}

/** convex hull of screen points (the projected cylinder is exactly the hull of its two end loops) */
export function hull(pts) {
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** how much of the pixel (x, y) a convex polygon covers, from the signed distance to its edge: antialiased, no stair-step */
export function polyCover(poly, x, y) {
  let inside = true, dmin = 1e9;
  const n = poly.length;
  for (let k = 0; k < n; k++) {
    const [ax, ay] = poly[k], [bx, by] = poly[(k + 1) % n], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = clamp01(((x - ax) * dx + (y - ay) * dy) / l2), d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
    if (d < dmin) dmin = d;
    if ((x - ax) * dy - (y - ay) * dx > 0) inside = false;      // hull() winds one way: outside any edge's left side
  }
  const sd = inside ? dmin : -dmin;
  return clamp01(0.5 + sd);
}

/**
 * pencil a white shirt cuff onto its own sheet `cg`: a hem with a double stitch, the far edge of the band, a button,
 * soft folds where the sleeve gathers into the band and one long fold along the forearm. The white is the paper:
 * `shade` is a light warm wash (dark on the side away from the light, at the silhouette and beside each fold) that
 * the page tints. Returns the depth map (for the hand to be in front where it is) and the shade plane.
 */
export function drawSleeve(S, view, cg, { tLen, W, H, mmPerUnit = 1.146, pxMm = 3.4, robe = false }) {
  const L = lightOf(view);
  const depth = new Float32Array(W * H).fill(-1e18), shade = new Float32Array(W * H);
  const nLoop = S.nLoop, U = (mm) => mm / mmPerUnit, tB = S.band;
  const faces = (j) => vdot(S.normalAt(j), view.e);
  const px = (t, j) => view.px(S.at(t, j));
  let jc = 0, fm = -2;
  for (let j = 0; j < nLoop; j++) { const f = faces(j); if (f > fm) { fm = f; jc = j; } }
  const visOf = (j) => clamp01((faces(j) + 0.1) / 0.3);
  /** a closed ring round the sleeve at t, hidden on the far side */
  const ringAt = (t, o) => {
    const pts = [], vis = [];
    for (let j = 0; j <= nLoop; j++) { pts.push(px(t, j)); vis.push(visOf(j)); }
    cg.stroke(pts, { grade: PEN.gradeAt(3.2), passes: 2, taper: 0.3, wobble: 0.45, jitter: 0.3, close: true, vis, ...o });
  };
  /** a dashed stitch row at t over the facing half */
  const wob = new M.Noise(4141);
  const stitch = (t, tone) => {
    for (let j = 0; j < nLoop - 4; j += 5) {
      if (faces(j) < 0.12 || faces(j + 3) < 0.12) continue;
      const w0 = (wob.n1(j * 0.11 + t * 3) - 0.5) * U(0.9), w1 = (wob.n1(j * 0.11 + t * 3 + 0.4) - 0.5) * U(0.9), len = j + 2.6 + (wob.n1(j * 0.37) - 0.5) * 0.9;
      cg.stroke([px(t + w0, j), px(t + (w0 + w1) / 2, (j + len) / 2), px(t + w1, len)], { grade: PEN.gradeAt(3.6), tone: tone * (0.8 + 0.4 * wob.n1(j * 0.7 + 5)), weight: 0.5, passes: 1, taper: 0.25, wobble: 0.35, jitter: 0.25 });
    }
  };
  if (robe) {
    // a towelling robe's turned-back cuff: a soft rolled hem, the roll's inner edge, the cuff's top edge lost in the pile
    ringAt(0, { tone: 0.9, weight: 1.1, passes: 2, wobble: 1.1, jitter: 0.55 });
    ringAt(U(2.2), { tone: 0.28, weight: 0.7, passes: 1, wobble: 1.2, jitter: 0.6, taper: 0.8 });
    ringAt(tB, { tone: 0.42, weight: 0.85, passes: 1, wobble: 1.4, jitter: 0.7, taper: 0.7 });
  } else {
    ringAt(0, { tone: 1.05, weight: 0.95, passes: 3 });                    // the hem
    stitch(U(2.3), 0.75); stitch(U(4.4), 0.75);                              // double stitch
    ringAt(tB, { tone: 0.95, weight: 0.9 });                                 // the band's far edge
    stitch(tB - U(2.4), 0.6);
  }
  // the silhouette: the loop's two extremes across the sleeve on the screen (the loop is not round, so not where the radial normal turns edge-on)
  const ca = view.px(S.C), cb = view.px(vadd(S.C, vmul(S.ax, -10))), dx0 = cb[0] - ca[0], dy0 = cb[1] - ca[1], dl = Math.hypot(dx0, dy0) || 1, nx = -dy0 / dl, ny = dx0 / dl;
  let jLo = 0, jHi = 0, lo = 1e9, hi = -1e9;
  for (let j = 0; j < nLoop; j++) { const p = px(tB, j), v = (p[0] - ca[0]) * nx + (p[1] - ca[1]) * ny; if (v < lo) { lo = v; jLo = j; } if (v > hi) { hi = v; jHi = j; } }
  for (const j of [jLo, jHi]) {
    const ln = Array.from({ length: 41 }, (_, i) => px((tLen * i) / 40, j));
    cg.stroke(ln, { grade: PEN.gradeAt(3.2), tone: 1.0, weight: 0.95, passes: 2, taper: 0.2, wobble: 0.45, jitter: 0.3 });
  }
  // a soft fold: a tapered line along (t, j) control points, a shaded flank beside it
  const fold = (pts, o = {}) => {
    const ln = pts.map(([t, j]) => px(t, j));
    cg.stroke(ln, { grade: PEN.gradeAt(2.4), tone: o.tone ?? 0.6, weight: o.weight ?? 0.85, passes: 2, taper: 0.95, wobble: 0.7, jitter: 0.4, phase: o.phase ?? 0 });
    const fl = pts.map(([t, j]) => px(t, j + (o.flank ?? 3.5)));
    paint(fl, (o.width ?? 2.0) * pxMm, o.shade ?? 0.07);
  };
  const paintRaster = new Float32Array(W * H);
  const paint = (ln, rad, val) => {
    const R = Math.ceil(rad);
    for (let i = 0; i < ln.length - 1; i++) {
      const [ax, ay] = ln[i], [bx, by] = ln[i + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const k = i / (ln.length - 1), env = Math.sin(Math.PI * Math.min(1, k * 1.05 + 0.02));     // fades at both ends
      for (let y = Math.floor(Math.min(ay, by) - R); y <= Math.ceil(Math.max(ay, by) + R); y++) for (let x = Math.floor(Math.min(ax, bx) - R); x <= Math.ceil(Math.max(ax, bx) + R); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const t = clamp01(((x - ax) * dx + (y - ay) * dy) / l2), d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
        const v = val * env * Math.exp(-(d * d) / (2 * (rad * 0.45) * (rad * 0.45)));
        if (v > paintRaster[y * W + x]) paintRaster[y * W + x] = v;
      }
    }
  };
  const sw = (t0, t1, j0_, j1_, bow, n = 14) => Array.from({ length: n + 1 }, (_, i) => { const s = i / n; return [t0 + (t1 - t0) * s, jc + j0_ + (j1_ - j0_) * s + bow * Math.sin(Math.PI * s)]; });
  // the sleeve gathered into the band: short folds fanning out from it
  const g0 = tB - U(1), g1 = tB + U(15);
  [[-40, -48, 3], [-20, -23, -2], [4, 6, 3], [27, 33, -2], [43, 52, 2]].forEach(([a, b, bw], k) => fold(sw(g0, g1 - U(k % 2 ? 4 : 0), a, b, bw), { phase: 17 * k, tone: 0.5, weight: 0.8, flank: k % 2 ? -3.5 : 3.5 }));
  // one long compression fold along the forearm
  fold(sw(tB + U(5), tLen - U(4), 24, 12, -5, 24), { phase: 91, tone: 0.62, weight: 1.05, flank: 4, width: 2.6, shade: 0.085 });
  if (!robe) {
  // two creases in the band where the cuff stands off the wrist
  fold(sw(U(3.5), U(12), -31, -22, 1.5, 8), { phase: 5, tone: 0.4, weight: 0.65, flank: 2, width: 1.4, shade: 0.045 });
  fold(sw(U(5), U(12.5), 26, 35, -1.5, 8), { phase: 9, tone: 0.4, weight: 0.65, flank: -2, width: 1.4, shade: 0.045 });
  fold(sw(U(8), U(15), 6, 14, 1.2, 8), { phase: 13, tone: 0.34, weight: 0.6, flank: 2, width: 1.3, shade: 0.04 });
  fold(sw(U(9), U(17), -8, -17, -1, 8), { phase: 21, tone: 0.32, weight: 0.55, flank: -2, width: 1.2, shade: 0.035 });
  // the button, near the band's far edge, with four holes
  {
    const jb = jc + 17, tb = tB - U(6), Q = S.at(tb, jb), nrm = S.normalAt(jb), ex = vnorm(vsub(S.at(tb, jb + 1), S.at(tb, jb - 1))), ey = S.ax;
    const circ = (r, n = 28) => Array.from({ length: n + 1 }, (_, k) => { const a = (k / n) * TAU; return view.px(vadd(vadd(Q, vmul(nrm, 0.5)), vadd(vmul(ex, Math.cos(a) * r), vmul(ey, Math.sin(a) * r)))); });
    cg.stroke(circ(U(2.6)), { grade: PEN.gradeAt(3.6), tone: 1.0, weight: 0.75, passes: 2, taper: 0, close: true, wobble: 0.2, jitter: 0.15 });
    cg.stroke(circ(U(1.9)), { grade: PEN.gradeAt(4), tone: 0.55, weight: 0.45, passes: 1, taper: 0, close: true, wobble: 0.15, jitter: 0.1 });
    for (const [a, b] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) {
      const p = view.px(vadd(vadd(Q, vmul(nrm, 0.5)), vadd(vmul(ex, U(1.9) * a * 0.9), vmul(ey, U(1.9) * b * 0.9))));
      cg.stroke([[p[0] - 0.6, p[1] - 0.2], [p[0] + 0.6, p[1] + 0.2]], { grade: PEN.gradeAt(5), tone: 1.0, weight: 0.7, passes: 1, taper: 0, wobble: 0, jitter: 0 });
    }
  }
  } else {
    // the pile: little loops of towelling, densest where the cloth turns from the light
    const pile = new M.Noise(733);
    for (let k = 0; k < 420; k++) {
      const jj = pile.n1(k * 1.37) * nLoop * 3 % nLoop, t = (tLen * ((k * 0.618) % 1)), f = faces(jj);
      if (f < 0.05) continue;
      const lit = smoothstep(-0.1, 0.9, vdot(S.normalAt(jj), L));
      if (pile.n1(k * 2.9 + 7) > 0.35 + 0.5 * (1 - lit)) continue;
      const p = px(t, jj), r = (0.5 + pile.n1(k * 5.3) * 0.6) * pxMm * 0.5, a0 = pile.n1(k * 3.1) * TAU;
      cg.stroke(Array.from({ length: 7 }, (_, i) => [p[0] + r * Math.cos(a0 + i * 0.9), p[1] + r * 0.8 * Math.sin(a0 + i * 0.9)]), { grade: PEN.gradeAt(1.4), tone: 0.1 + 0.12 * (1 - lit), weight: 0.5, passes: 1, taper: 0.5, wobble: 0.6, jitter: 0.4 });
    }
  }
  // the cloth's own shading, strand by strand: light on the lit side, round at the silhouette, a little deeper under the gathers
  const steps = Math.max(40, Math.ceil((tLen * mmPerUnit * pxMm) / 1.4));
  const total = nLoop * 2;
  for (let j = 0; j < total; j++) {
    const jj = j / 2, f = faces(jj);
    if (f < -0.01) continue;
    const lit = smoothstep(-0.1, 0.9, vdot(S.normalAt(jj), L));
    const base = 0.006 + 0.085 * Math.pow(1 - lit, 1.35) + 0.06 * (1 - smoothstep(0.0, 0.45, f));
    for (let i = 0; i <= steps; i++) {
      const t = (tLen * i) / steps, Q = S.at(t, jj), p = view.px(Q), z = view.near(Q);
      const v = base * (t < tB ? 0.85 : 1 + 0.12 * smoothstep(tB, tB + U(10), t));
      const x = Math.round(p[0]), y = Math.round(p[1]);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        if (z > depth[yy * W + xx]) depth[yy * W + xx] = z;
        shade[yy * W + xx] = v;
      }
    }
  }
  const sm = blur(shade, W, H, 2, 2);
  for (let i = 0; i < sm.length; i++) sm[i] = Math.min(0.5, sm[i] + paintRaster[i]);
  return { depth, shade: sm };
}

/** the cuff's shadow on the table: a soft mark toward the lower right (as the hand's), a tight seam where the arm lies down */
export function armShadow(inCuff, W, H, { c0, u, pxMm }) {
  const cast = new Float32Array(W * H), seam = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inCuff[y * W + x]) continue;
    const tmm = Math.max(0, -((x - c0[0]) * u[0] + (y - c0[1]) * u[1]) / pxMm);              // along the sleeve, from the hem
    const h = Math.max(3, 16 - 0.2 * tmm);
    const ox = Math.round((2 + 0.35 * h) * pxMm), oy = Math.round((1.5 + 0.22 * h) * pxMm), xx = x + ox, yy = y + oy;
    if (xx < W && yy < H && xx >= 0 && yy >= 0) cast[yy * W + xx] = 1;
    if (h < 10) { const sx = x + Math.round(ox * 0.3), sy = y + Math.round(oy * 0.3); if (sx >= 0 && sy >= 0 && sx < W && sy < H) seam[sy * W + sx] = 1; }
  }
  const a = blur(cast, W, H, 7, 3), c = blur(seam, W, H, 2, 2), out = new Float32Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, a[i] * 0.085 + c[i] * 0.095);
  return out;
}

// ---- the shadow on the table -----------------------------------------------------------------
/** a plane through the lower envelope of a depth field: the table, as tilted by the camera */
export function tablePlane(df) {
  const { w: W, z0, i0 } = df, H = (i0.length / W) | 0;
  let a = 0, bx = 0, by = 0;                                // z = a + bx x + by y
  for (let it = 0; it < 5; it++) {
    const res = [];
    for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) { const i = y * W + x; if (i0[i] >= 0) res.push([x, y, z0[i], z0[i] - (a + bx * x + by * y)]); }
    res.sort((p, q) => p[3] - q[3]);
    const lo = res.slice(0, Math.max(60, (res.length * (it ? 0.12 : 0.4)) | 0));
    let sx = 0, sy = 0, sz = 0, sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0, n = lo.length;
    for (const [x, y, z] of lo) { sx += x; sy += y; sz += z; sxx += x * x; sxy += x * y; syy += y * y; sxz += x * z; syz += y * z; }
    // normal equations for [a bx by]
    const m = [[n, sx, sy, sz], [sx, sxx, sxy, sxz], [sy, sxy, syy, syz]];
    for (let i = 0; i < 3; i++) { let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r; [m[i], m[p]] = [m[p], m[i]]; for (let r = 0; r < 3; r++) if (r !== i) { const f = m[r][i] / m[i][i]; for (let c = i; c < 4; c++) m[r][c] -= f * m[i][c]; } }
    a = m[0][3] / m[0][0]; bx = m[1][3] / m[1][1]; by = m[2][3] / m[2][2];
  }
  return (x, y) => a + bx * x + by * y;
}

/** separable box blur, running sums, on a W×H plane: a fresh array */
export function blur(src, W, H, r, passes = 2) {
  const cur = Float32Array.from(src), tmp = new Float32Array(W * H), n = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {                           // horizontal
      const row = y * W;
      let s = 0;
      for (let x = -r; x <= r; x++) s += cur[row + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) { tmp[row + x] = s / n; s += cur[row + Math.min(W - 1, x + r + 1)] - cur[row + Math.max(0, x - r)]; }
    }
    for (let x = 0; x < W; x++) {                           // vertical
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) { cur[y * W + x] = s / n; s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]; }
    }
  }
  return cur;
}

/**
 * the table's shadow of the hand: every covered cell at height h (mm above the table) throws a
 * soft mark toward the lower right of the sheet (the lee of a light from the upper left), further
 * and fainter the higher it is, and a tight dark seam where it nearly touches. `skip(i)` leaves a cell out.
 */
export function shadow(df, plane, { mm, pxMm, skip = () => false, soft = 1 } = {}) {
  const { w: W, z0, i0 } = df, H = (i0.length / W) | 0;
  const cast = new Float32Array(W * H), seam = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (i0[i] < 0 || skip(i)) continue;
    const h = Math.max(0, Math.min(20, (z0[i] - plane(x, y)) * mm));
    const ox = Math.round((2 + 0.35 * h) * pxMm), oy = Math.round((1.5 + 0.22 * h) * pxMm);
    const xx = x + ox, yy = y + oy;
    if (xx >= 0 && yy >= 0 && xx < W && yy < H) cast[yy * W + xx] = 1;
    if (h < 2.5) { const sx = x + Math.round(ox * 0.3), sy = y + Math.round(oy * 0.3); if (sx >= 0 && sy >= 0 && sx < W && sy < H) seam[sy * W + sx] = 1; }
  }
  const a = blur(cast, W, H, Math.round(6 * soft), 3), c = blur(seam, W, H, Math.round(2.5 * soft), 2);
  const out = new Float32Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, a[i] * 0.085 + c[i] * 0.095);
  return out;
}
