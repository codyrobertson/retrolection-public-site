/* ============================================================================
   GRAPHITE KINEMATICS — 00 · math
   Deterministic randomness, value noise, vector algebra, curve utilities.
   Everything downstream is a pure function of (seed, params). No Math.random.
   ========================================================================== */
(function (GK) {
  'use strict';

  // ---------------------------------------------------------------- constants
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  // ------------------------------------------------------------------- scalar
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix = lerp;
  const inv = (v, a, b) => (b === a ? 0 : (v - a) / (b - a));
  const remap = (v, a, b, c, d) => lerp(c, d, clamp01(inv(v, a, b)));
  const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
  const smootherstep = (t) => { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); };
  const sstep = (a, b, v) => smoothstep(inv(v, a, b));
  const sign = Math.sign;

  // easing used by pose interpolation
  const ease = {
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    in: (t) => t * t * t,
    elasticOut: (t) => (t === 0 || t === 1) ? t
      : Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1,
    breathe: (t) => 0.5 - 0.5 * Math.cos(TAU * t)
  };

  // ---------------------------------------------------------------------- rng
  // mulberry32 — small, fast, well-distributed, fully deterministic.
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class Rng {
    constructor(seed) { this.reseed(seed); }
    reseed(seed) {
      this.seed = (seed >>> 0) || 1;
      this._f = mulberry32(this.seed * 2654435761 % 4294967296);
      this._spare = null;
      return this;
    }
    /** uniform [0,1) */
    f() { return this._f(); }
    /** uniform [a,b) */
    range(a, b) { return a + (b - a) * this._f(); }
    /** integer [a,b] inclusive */
    int(a, b) { return a + Math.floor(this._f() * (b - a + 1)); }
    /** boolean with probability p */
    chance(p) { return this._f() < p; }
    /** signed uniform [-m,m] */
    sym(m) { return (this._f() * 2 - 1) * m; }
    /** gaussian via Box-Muller, cached spare */
    gauss(mu = 0, sd = 1) {
      if (this._spare !== null) { const s = this._spare; this._spare = null; return mu + sd * s; }
      let u = 0, v = 0, s = 0;
      do { u = this._f() * 2 - 1; v = this._f() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
      const m = Math.sqrt(-2 * Math.log(s) / s);
      this._spare = v * m;
      return mu + sd * u * m;
    }
    /** gaussian truncated to [lo,hi] */
    gaussIn(mu, sd, lo, hi) {
      for (let i = 0; i < 12; i++) { const g = this.gauss(mu, sd); if (g >= lo && g <= hi) return g; }
      return clamp(mu, lo, hi);
    }
    pick(arr) { return arr[Math.floor(this._f() * arr.length)]; }
    /** pick from [{v,w},...] by weight */
    weighted(table) {
      let total = 0; for (const e of table) total += e.w;
      let r = this._f() * total;
      for (const e of table) { r -= e.w; if (r <= 0) return e.v; }
      return table[table.length - 1].v;
    }
    shuffled(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this._f() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
      return a;
    }
    /** a fresh independent stream, derived deterministically */
    fork(salt) { return new Rng((this.seed ^ Math.imul(salt + 1, 0x9E3779B1)) >>> 0); }
  }

  // -------------------------------------------------------------- value noise
  // Own implementation so output never depends on the host p5 build.
  const P_SIZE = 512;
  class Noise {
    constructor(seed) {
      const r = mulberry32(((seed >>> 0) || 1) * 0x27D4EB2D % 4294967296);
      this.g = new Float32Array(P_SIZE);
      for (let i = 0; i < P_SIZE; i++) this.g[i] = r();
      this.perm = new Uint16Array(P_SIZE * 2);
      const p = new Uint16Array(P_SIZE);
      for (let i = 0; i < P_SIZE; i++) p[i] = i;
      for (let i = P_SIZE - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
      for (let i = 0; i < P_SIZE * 2; i++) this.perm[i] = p[i & (P_SIZE - 1)];
    }
    _h(i, j, k) {
      const pm = this.perm;
      // `& 1023 & 511` and `& 511` mask to the same nine bits - 511 is a
      // subset of the 1023 mask, so ANDing with 1023 first and throwing most
      // of it away with a second AND right after was never selecting
      // anything the single mask doesn't. Every hash this returns is called
      // eight times for one noise sample, so it is worth not asking twice.
      return this.g[pm[(pm[(pm[i & 511] + (j & 511)) & 511] + (k & 511)) & 511]];
    }
    /** 3-D value noise, output in [0,1] */
    n3(x, y, z) {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      const xf = x - xi, yf = y - yi, zf = z - zi;
      const u = smootherstep(xf), v = smootherstep(yf), w = smootherstep(zf);
      const c000 = this._h(xi, yi, zi), c100 = this._h(xi + 1, yi, zi);
      const c010 = this._h(xi, yi + 1, zi), c110 = this._h(xi + 1, yi + 1, zi);
      const c001 = this._h(xi, yi, zi + 1), c101 = this._h(xi + 1, yi, zi + 1);
      const c011 = this._h(xi, yi + 1, zi + 1), c111 = this._h(xi + 1, yi + 1, zi + 1);
      const x00 = lerp(c000, c100, u), x10 = lerp(c010, c110, u);
      const x01 = lerp(c001, c101, u), x11 = lerp(c011, c111, u);
      return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
    }
    n2(x, y) { return this.n3(x, y, 0.5); }
    n1(x) { return this.n3(x, 0.5, 0.5); }
    /** fractal sum, output in [0,1] */
    fbm(x, y, z, oct = 4, gain = 0.5, lac = 2.0) {
      let a = 0.5, f = 1, sum = 0, norm = 0;
      for (let i = 0; i < oct; i++) { sum += a * this.n3(x * f, y * f, z * f); norm += a; a *= gain; f *= lac; }
      return sum / norm;
    }
    /** signed fractal, roughly [-1,1] */
    sfbm(x, y, z, oct = 4) { return this.fbm(x, y, z, oct) * 2 - 1; }
  }

  // ------------------------------------------------------------------ vectors
  const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
  const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const vmul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const vmad = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
  const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const vcross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
  const vlen = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  const vdist = (a, b) => vlen(vsub(a, b));
  const vnorm = (a) => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const vlerp = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const vcopy = (a) => [a[0], a[1], a[2]];

  /** combine three basis vectors: o + e0*a + e1*b + e2*c */
  const vframe = (o, e0, a, e1, b, e2, c) => [
    o[0] + e0[0] * a + e1[0] * b + e2[0] * c,
    o[1] + e0[1] * a + e1[1] * b + e2[1] * c,
    o[2] + e0[2] * a + e1[2] * b + e2[2] * c
  ];

  // ------------------------------------------------------------------ 3x3 rot
  // Column-major-ish: m = [ex, ey, ez] each a vec3 — the frame's basis vectors.
  const IDENT = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  /** apply frame m to local vector v -> world */
  const mApply = (m, v) => [
    m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
    m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
    m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2]
  ];

  /** compose: result = parent applied to child (child expressed in parent) */
  const mMul = (p, c) => [mApply(p, c[0]), mApply(p, c[1]), mApply(p, c[2])];

  /** rotation about local X (long axis of a bone) — axial twist / pronation */
  function rotX(t) {
    const c = Math.cos(t), s = Math.sin(t);
    return [[1, 0, 0], [0, c, s], [0, -s, c]];
  }
  /** rotation about local Y (mediolateral axis) — flexion / extension */
  function rotY(t) {
    const c = Math.cos(t), s = Math.sin(t);
    return [[c, 0, -s], [0, 1, 0], [s, 0, c]];
  }
  /** rotation about local Z (dorsopalmar axis) — abduction / adduction */
  function rotZ(t) {
    const c = Math.cos(t), s = Math.sin(t);
    return [[c, s, 0], [-s, c, 0], [0, 0, 1]];
  }

  /** re-orthonormalise to kill accumulated float drift over long chains */
  function mOrtho(m) {
    const x = vnorm(m[0]);
    let y = vsub(m[1], vmul(x, vdot(m[1], x)));
    y = vnorm(y);
    const z = vcross(x, y);
    return [x, y, z];
  }

  // ------------------------------------------------------------------- curves
  /** uniform Catmull-Rom, scalar, given t and its already-computed powers */
  function crSt(p0, p1, p2, p3, t, t2, t3) {
    return 0.5 * ((2 * p1) + (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  /** uniform Catmull-Rom, scalar */
  function crS(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return crSt(p0, p1, p2, p3, t, t2, t3);
  }
  /** uniform Catmull-Rom, vec3
   *  t2 and t3 depend on t alone, not on which of the three coordinates is
   *  being blended, so computing them once here and handing them to crSt
   *  three times is the same nine multiplies crS would have done on its own
   *  three calls, minus the four of those nine that were computing the exact
   *  same t*t and t*t*t over again each time. */
  function crV(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return [
      crSt(p0[0], p1[0], p2[0], p3[0], t, t2, t3),
      crSt(p0[1], p1[1], p2[1], p3[1], t, t2, t3),
      crSt(p0[2], p1[2], p2[2], p3[2], t, t2, t3)
    ];
  }
  /** sample a Catmull-Rom spline through pts[] at fractional index fi (clamped ends) */
  function splineAt(pts, fi) {
    const n = pts.length;
    if (n === 0) return [0, 0, 0];
    if (n === 1) return vcopy(pts[0]);
    // Outside the knots, extend the end tangent linearly. Cubic extrapolation
    // diverges within a knot or two and folds the surface it is carrying.
    if (fi < 0) {
      const a = pts[0], b = pts[1];
      return [a[0] + (b[0] - a[0]) * fi, a[1] + (b[1] - a[1]) * fi, a[2] + (b[2] - a[2]) * fi];
    }
    if (fi > n - 1) {
      const a = pts[n - 1], b = pts[n - 2], k = fi - (n - 1);
      return [a[0] + (a[0] - b[0]) * k, a[1] + (a[1] - b[1]) * k, a[2] + (a[2] - b[2]) * k];
    }
    const i = clamp(Math.floor(fi), 0, n - 2);
    const t = clamp01(fi - i);
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    return crV(p0, p1, p2, p3, t);
  }
  /** scalar version of splineAt */
  function splineAtS(vals, fi) {
    const n = vals.length;
    if (n === 0) return 0;
    if (n === 1) return vals[0];
    const i = clamp(Math.floor(fi), 0, n - 2);
    const t = clamp01(fi - i);
    return crS(vals[Math.max(0, i - 1)], vals[i], vals[i + 1], vals[Math.min(n - 1, i + 2)], t);
  }
  /** convert a value to a fractional index within a monotone knot array */
  function knotIndex(knots, v) {
    const n = knots.length;
    if (v <= knots[0]) return (v - knots[0]) / (knots[1] - knots[0]);
    if (v >= knots[n - 1]) return n - 1 + (v - knots[n - 1]) / (knots[n - 1] - knots[n - 2]);
    for (let i = 0; i < n - 1; i++) {
      if (v <= knots[i + 1]) return i + (v - knots[i]) / (knots[i + 1] - knots[i]);
    }
    return n - 1;
  }

  /** piecewise-linear profile lookup: stops = [[x,y],...] sorted by x */
  function profile(stops, x) {
    const n = stops.length;
    if (x <= stops[0][0]) return stops[0][1];
    if (x >= stops[n - 1][0]) return stops[n - 1][1];
    for (let i = 0; i < n - 1; i++) {
      if (x <= stops[i + 1][0]) {
        const t = inv(x, stops[i][0], stops[i + 1][0]);
        return lerp(stops[i][1], stops[i + 1][1], smoothstep(t));
      }
    }
    return stops[n - 1][1];
  }

  /**
   * Closest approach between two 3-D segments. Returns the parameters on each
   * and the distance. Degenerate cases fall back to a point-on-segment solve.
   */
  function closestSeg(p1, q1, p2, q2) {
    const d1 = vsub(q1, p1), d2 = vsub(q2, p2), r = vsub(p1, p2);
    const a = vdot(d1, d1), e = vdot(d2, d2), f = vdot(d2, r), c = vdot(d1, r), b = vdot(d1, d2);
    let s = 0, t = 0;
    const den = a * e - b * b;
    if (den > 1e-9) s = clamp((b * f - c * e) / den, 0, 1);
    t = (b * s + f) / (e || 1);
    if (t < 0) { t = 0; s = clamp(-c / (a || 1), 0, 1); }
    else if (t > 1) { t = 1; s = clamp((b - c) / (a || 1), 0, 1); }
    const P1 = vmad(p1, d1, s), P2 = vmad(p2, d2, t);
    return { s, t, P1, P2, d: vdist(P1, P2) };
  }

  // -------------------------------------------------------------- 2-D polyline
  /** total length of a 2-D polyline */
  function polyLen(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  }
  /** resample a 2-D polyline to (roughly) even spacing */
  function resample(pts, spacing) {
    if (pts.length < 2) return pts.slice();
    const out = [pts[0]];
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const seg = Math.hypot(dx, dy);
      if (seg < 1e-9) continue;
      let d = spacing - carry;
      while (d <= seg) {
        const t = d / seg;
        out.push([a[0] + dx * t, a[1] + dy * t]);
        d += spacing;
      }
      carry = seg - (d - spacing);
    }
    const last = pts[pts.length - 1];
    const tail = out[out.length - 1];
    if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > spacing * 0.35) out.push(last);
    return out;
  }
  /** Chaikin corner-cutting; keeps endpoints */
  function chaikin(pts, iters = 1) {
    let p = pts;
    for (let k = 0; k < iters; k++) {
      if (p.length < 3) break;
      const out = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1];
        out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      out.push(p[p.length - 1]);
      p = out;
    }
    return p;
  }
  /** point-in-polygon, even-odd */
  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  /** axis-aligned bounds of a 2-D point list */
  function bounds2(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    return [x0, y0, x1, y1];
  }

  GK.math = {
    TAU, DEG, clamp, clamp01, lerp, mix, inv, remap, smoothstep, smootherstep, sstep, sign, ease,
    mulberry32, Rng, Noise,
    v3, vadd, vsub, vmul, vmad, vdot, vcross, vlen, vdist, vnorm, vlerp, vcopy, vframe,
    IDENT, mApply, mMul, rotX, rotY, rotZ, mOrtho,
    crS, crV, splineAt, splineAtS, knotIndex, profile, closestSeg,
    polyLen, resample, chaikin, pointInPoly, bounds2
  };
})(window.GK = window.GK || {});

/* ============================================================================
   GRAPHITE KINEMATICS — 10 · anatomy
   Skeletal metrics, joint envelopes, and the per-seed generation of a single
   unique hand. Lengths are in millimetres; the renderer scales at the end.

   Nominal segment lengths follow published hand anthropometry (adult mean);
   each seed perturbs them within real population variance, correlated by an
   overall size factor so a hand stays internally consistent.

   Frame convention (right hand, neutral):
       +X  distal      (toward the fingertips)
       +Y  ulnar       (thumb -> little finger)
       +Z  dorsal      (out the back of the hand;  -Z is palmar)
   Joint rotations:  rotY = flexion(+) / extension(-)
                     rotZ = ulnar deviation(+) / radial(-)
                     rotX = axial twist (pronation / opposition)
   ========================================================================== */
(function (GK) {
  'use strict';
  const M = GK.math;
  const { DEG, clamp, lerp, Rng } = M;

  // Digit indices
  const THUMB = 0, INDEX = 1, MIDDLE = 2, RING = 3, LITTLE = 4;
  const DIGIT_NAMES = ['thumb', 'index', 'middle', 'ring', 'little'];

  // ------------------------------------------------------------ bone lengths
  // metacarpal / proximal / middle / distal  (mm, adult mean)
  const NOMINAL = {
    meta: [46.2, 68.1, 64.6, 58.0, 53.6],
    prox: [31.6, 39.8, 44.6, 41.8, 32.6],
    mid: [0, 22.4, 27.6, 25.6, 18.1],   // thumb has no middle phalanx
    dist: [21.7, 15.8, 17.4, 17.5, 15.8]
  };

  // half-breadth of each digit at its metacarpophalangeal joint (mm)
  const NOMINAL_BREADTH = [11.0, 10.2, 10.1, 9.4, 8.2];

  // ---------------------------------------------------- carpometacarpal bases
  // Origin of each metacarpal in the carpal frame, and its rest orientation.
  //   fan  : splay within the palm plane (rotZ), negative = radial
  //   tilt : how far palmar the metacarpal head sits (rotY), builds the arch
  //   roll : axial set of the metacarpal (rotX)
  const CMC_BASE = [
    // thumb — the trapezium is in the DISTAL carpal row, so CMC1 sits at
    // roughly the same proximodistal level as CMC2 (index), not behind it;
    // it is far radial and palmar, and rolled ~63 deg out of the palm plane
    // so the nail faces radially and a little dorsally at rest, not palmar.
    // At 63 degrees the nail came out radial and a little PALMAR, which is
    // the wrong side of the textbook line, and it left the pad near enough
    // edge-on that a palmar view of the hand showed the thumb's flank rather
    // than its print and creases. Two things had to be fixed before this
    // angle could move: the thenar's offset, which used to be tied to the
    // bone and slid off it as soon as this rotated, and the four opposition
    // presets, whose chains leaned on the old set.
    { pos: [17.5, -20.0, 10.0], fan: -42 * DEG, tilt: 20 * DEG, roll: -48 * DEG },
    { pos: [20.0, -11.5, -2.5], fan: -9.5 * DEG, tilt: 4 * DEG, roll: -8 * DEG },
    { pos: [21.0, -1.5, -3.5], fan: -0.5 * DEG, tilt: 0 * DEG, roll: 0 * DEG },
    { pos: [18.5, 7.5, -1.5], fan: 8.0 * DEG, tilt: 5 * DEG, roll: 9 * DEG },
    { pos: [15.0, 15.5, 2.0], fan: 17.0 * DEG, tilt: 12 * DEG, roll: 20 * DEG }
  ];

  // Mobility of the 4th/5th carpometacarpal joints — this is what lets the palm
  // cup. Digits 2 and 3 are effectively rigid against the carpus.
  const CMC_MOBILITY = [0, 0.0, 0.0, 11 * DEG, 26 * DEG];

  // ------------------------------------------------------------ joint limits
  // Range of motion per degree of freedom, in degrees. ext is negative flexion.
  //   mcp.flex/.ext/.abd   pip.flex   dip.flex/.ext
  const LIMITS = {
    wrist: { flex: 80, ext: 70, ulnar: 33, radial: 19, pron: 85, sup: 85 },
    digits: [
      { // thumb: cmc(flex,abd,opp) mcp(flex) ip(flex,ext)
        // In-plane radial abduction is the thumb's largest excursion — it is
        // what opens the hand flat — and it was being given less range than
        // adduction across the palm, so a spread hand threw the thumb forward
        // out of the plane instead of out to the side.
        cmc: { flex: 55, ext: 30, abd: 68, add: 10, opp: 92, rep: 15 },
        mcp: { flex: 58, ext: 12, abd: 9 },
        ip: { flex: 82, ext: 24 }
      },
      { mcp: { flex: 88, ext: 34, abd: 28 }, pip: { flex: 108, ext: 3 }, dip: { flex: 78, ext: 12 } },
      { mcp: { flex: 92, ext: 30, abd: 16 }, pip: { flex: 114, ext: 3 }, dip: { flex: 82, ext: 12 } },
      { mcp: { flex: 96, ext: 32, abd: 18 }, pip: { flex: 118, ext: 4 }, dip: { flex: 84, ext: 14 } },
      { mcp: { flex: 98, ext: 38, abd: 30 }, pip: { flex: 116, ext: 5 }, dip: { flex: 86, ext: 16 } }
    ]
  };

  // ---------------------------------------------------- dermatoglyphic types
  // Population frequencies of fingerprint pattern classes (approximate).
  const PRINT_TYPES = [
    { v: 'ulnarLoop', w: 0.52 },
    { v: 'whorl', w: 0.26 },
    { v: 'radialLoop', w: 0.08 },
    { v: 'arch', w: 0.07 },
    { v: 'tentedArch', w: 0.04 },
    { v: 'doubleLoop', w: 0.03 }
  ];

  /* --------------------------------------------------------------------------
     buildAnatomy(seed, opts) -> a single unique hand
     Everything here is structural: it does not depend on pose or on view.
     -------------------------------------------------------------------------- */
  function buildAnatomy(seed, opts) {
    opts = opts || {};
    const rng = new Rng(seed);
    const A = { seed, chirality: opts.chirality === 'left' ? -1 : 1 };

    // ---- global build ------------------------------------------------------
    // One size factor correlates every bone; slenderness is a second axis.
    const size = rng.gaussIn(1.0, 0.062, 0.84, 1.18);
    const slender = rng.gaussIn(1.0, 0.085, 0.80, 1.22);   // >1 = narrower digits
    const digitLengthBias = rng.gaussIn(1.0, 0.035, 0.90, 1.10);
    A.size = size; A.slender = slender;

    // 2D:4D ratio — index/ring length relation, a real and visible variation
    A.ratio2d4d = rng.gaussIn(0.965, 0.032, 0.88, 1.06);

    A.bones = [];
    for (let d = 0; d < 5; d++) {
      const jitter = () => rng.gaussIn(1.0, 0.028, 0.92, 1.08);
      let lenBias = digitLengthBias;
      if (d === INDEX) lenBias *= A.ratio2d4d / 0.965 * 0.5 + 0.5;
      if (d === RING) lenBias *= (2 - A.ratio2d4d / 0.965) * 0.5 + 0.5;

      const meta = NOMINAL.meta[d] * size * jitter();
      const prox = NOMINAL.prox[d] * size * lenBias * jitter();
      const mid = NOMINAL.mid[d] * size * lenBias * jitter();
      const dist = NOMINAL.dist[d] * size * lenBias * jitter();
      const breadth = NOMINAL_BREADTH[d] * size / slender * rng.gaussIn(1.0, 0.03, 0.9, 1.1);

      // Width control at each joint of the digit, as a fraction of its
      // breadth at the knuckle. A single continuous chain: the value at the
      // end of one bone IS the value at the start of the next, so the
      // silhouette never steps at a joint.
      const jw = d === THUMB
        ? [1.06, 0.945, 0.865]                 // MCP, IP, tip
        : [1.00, 0.900, 0.805, 0.745];         // MCP, PIP, DIP, tip
      const jb = d === THUMB
        ? [0.095, 0.105, 0]
        : [0.100, 0.118, 0.098, 0];
      // depth-to-breadth ratio at each joint: a digit is always a flattened
      // oval, flatter at the pulp than at the knuckle
      const jd = d === THUMB
        ? [0.985, 0.945, 0.905]
        : [0.980, 0.948, 0.918, 0.892];
      for (let i = 0; i < jw.length - 1; i++) jw[i] *= rng.gaussIn(1, 0.018, 0.95, 1.05);

      A.bones.push({
        digit: d,
        name: DIGIT_NAMES[d],
        jw, jb, jd,
        lengths: d === THUMB ? [meta, prox, dist] : [meta, prox, mid, dist],
        segNames: d === THUMB ? ['MC', 'PP', 'DP'] : ['MC', 'PP', 'MP', 'DP'],
        jointNames: d === THUMB ? ['CMC', 'MCP', 'IP'] : ['CMC', 'MCP', 'PIP', 'DIP'],
        breadth,
        // per-digit resting camber: fingers are never perfectly straight
        camber: [
          0,
          rng.gaussIn(d === LITTLE ? 3.0 : 1.2, 1.4, -2, 7) * DEG,
          rng.gaussIn(d === LITTLE ? 4.5 : 2.0, 1.6, -1, 9) * DEG,
          rng.gaussIn(1.5, 1.2, -1, 5) * DEG
        ],
        // little-finger clinodactyly: a slight ulnar bow at the DIP, common
        clino: d === LITTLE ? rng.gaussIn(5.5, 3.2, 0, 14) * DEG : rng.gaussIn(0.6, 1.0, -2, 3) * DEG
      });
    }

    // ---- carpometacarpal layout -------------------------------------------
    A.cmc = CMC_BASE.map((b, i) => ({
      pos: [b.pos[0] * size, b.pos[1] * size, b.pos[2] * size],
      fan: b.fan * rng.gaussIn(1, 0.07, 0.8, 1.2),
      tilt: b.tilt * rng.gaussIn(1, 0.1, 0.75, 1.3),
      roll: b.roll * rng.gaussIn(1, 0.045, 0.88, 1.12),
      mobility: CMC_MOBILITY[i]
    }));

    // Depth of the transverse metacarpal arch at rest
    A.archRest = rng.gaussIn(0.30, 0.08, 0.12, 0.52);

    // ---- soft tissue -------------------------------------------------------
    A.palm = {
      thenar: rng.gaussIn(1.0, 0.14, 0.68, 1.36),     // ball of the thumb
      hypothenar: rng.gaussIn(1.0, 0.13, 0.70, 1.32), // ulnar pad
      hollow: rng.gaussIn(1.0, 0.16, 0.62, 1.40),     // central concavity
      padding: rng.gaussIn(1.0, 0.11, 0.74, 1.28),    // overall fleshiness
      wristW: rng.gaussIn(1.0, 0.06, 0.86, 1.16)
    };

    // Web (interdigital commissure) height, as a fraction along the proximal
    // phalanx. The first web (thumb/index) is much lower than the rest.
    A.web = [
      rng.gaussIn(0.16, 0.03, 0.08, 0.26),
      rng.gaussIn(0.40, 0.035, 0.30, 0.50),
      rng.gaussIn(0.42, 0.035, 0.32, 0.52),
      rng.gaussIn(0.44, 0.038, 0.33, 0.55)
    ];

    // ---- creases -----------------------------------------------------------
    // Simian crease (single transverse palmar crease) occurs in ~1.5% of hands;
    // a Sydney crease somewhat more often. Both are real, both are rare.
    const creaseRoll = rng.f();
    A.creasePattern = creaseRoll < 0.015 ? 'simian' : (creaseRoll < 0.055 ? 'sydney' : 'normal');
    A.creases = {
      distalArc: rng.gaussIn(1.0, 0.13, 0.7, 1.3),
      proximalArc: rng.gaussIn(1.0, 0.13, 0.7, 1.3),
      thenarArc: rng.gaussIn(1.0, 0.12, 0.72, 1.3),
      fateLine: rng.chance(0.72),           // vertical crease, not universal
      sunLine: rng.chance(0.34),
      minorCount: rng.int(4, 11),
      wristCreases: rng.int(2, 3)
    };

    // ---- nails -------------------------------------------------------------
    A.nails = [];
    for (let d = 0; d < 5; d++) {
      A.nails.push({
        // length as a fraction of the distal phalanx, width as fraction of breadth
        len: rng.gaussIn(d === THUMB ? 0.60 : 0.63, 0.05, 0.44, 0.78),
        wide: rng.gaussIn(d === THUMB ? 0.78 : 0.70, 0.055, 0.54, 0.88),
        free: rng.gaussIn(0.14, 0.06, 0.0, 0.32),     // free edge overhang
        lunula: rng.gaussIn(d === THUMB ? 0.26 : 0.15, 0.07, 0.0, 0.36),
        curve: rng.gaussIn(1.0, 0.16, 0.6, 1.45)      // transverse curvature
      });
    }

    // ---- fingerprints ------------------------------------------------------
    // Whorls cluster: if a hand has one it is likelier to have more.
    const whorlBias = rng.f() * 0.55;
    A.prints = [];
    for (let d = 0; d < 5; d++) {
      const table = PRINT_TYPES.map(t => ({
        v: t.v,
        w: t.w * (t.v === 'whorl' || t.v === 'doubleLoop' ? 1 + whorlBias * 3 : 1)
      }));
      A.prints.push({
        type: rng.weighted(table),
        // ridge count / density and the position of the core and delta
        density: rng.gaussIn(1.0, 0.13, 0.72, 1.32),
        coreY: rng.gaussIn(0.0, 0.14, -0.32, 0.32),
        coreS: rng.gaussIn(0.58, 0.06, 0.44, 0.74),
        deltaSide: rng.chance(0.5) ? 1 : -1,
        swirl: rng.sym(0.5),
        broken: rng.range(0.04, 0.16)   // fraction of ridge endings/bifurcations
      });
    }
    // ulnar loops open toward the little finger; radial toward the thumb
    for (let d = 0; d < 5; d++) {
      const p = A.prints[d];
      if (p.type === 'ulnarLoop') p.deltaSide = A.chirality;
      if (p.type === 'radialLoop') p.deltaSide = -A.chirality;
    }

    // ---- dorsal detail -----------------------------------------------------
    A.veins = {
      strength: rng.gaussIn(1.0, 0.30, 0.15, 1.85),
      branchProb: rng.range(0.42, 0.78),
      caliber: rng.gaussIn(1.0, 0.18, 0.6, 1.5),
      meander: rng.range(0.4, 1.5),
      trunks: rng.int(2, 4)
    };
    A.hair = {
      density: Math.max(0, rng.gaussIn(0.55, 0.42, 0, 1.6)),
      length: rng.gaussIn(1.0, 0.22, 0.5, 1.6),
      lean: rng.sym(0.55)
    };
    A.knuckles = {
      prominence: rng.gaussIn(1.0, 0.17, 0.6, 1.5),
      wrinkleRows: rng.int(3, 6),
      dimple: rng.chance(0.55)
    };
    A.tendons = {
      prominence: rng.gaussIn(1.0, 0.28, 0.35, 1.7)
    };

    // ---- knuckle / joint bulge ---------------------------------------------
    A.condyle = rng.gaussIn(1.0, 0.12, 0.72, 1.34);
    // fingertip pulp overhang past the end of the distal phalanx
    A.pulp = rng.gaussIn(1.0, 0.13, 0.7, 1.35);

    A.limits = LIMITS;
    return A;
  }

  // ------------------------------------------------------ cross-section shape
  /**
   * Half-breadth (a, along the mediolateral axis) and half-depth (b, along the
   * dorsopalmar axis) at parameter s of segment `seg` of digit `d`. s runs
   * 0..1 over the bone and beyond 1 into the fingertip dome.
   *
   * A third and fourth value, when present, displace the cross-section's
   * CENTRE off the bone axis (medio-lateral, dorso-palmar) without changing
   * a/b. Every digit is centred (0,0) except the thumb's metacarpal, whose
   * flesh is not a tube around the bone: the thenar muscles sit palmar and
   * radial to it, and its dorsal aspect is subcutaneous bone you can feel
   * through the skin. Centring that mass on the bone draws a sausage; the
   * offset is what makes it read as a hand's thenar instead.
   */
  // The thenar's swell, and how hard the compounded variation behind it is
  // damped. Both fitted across three hundred seeds, not against one.
  const TH_SWELL = 0.70, TH_DAMP = 0.40;

  function segmentProfile(A, d, seg, s) {
    const bone = A.bones[d];
    const isThumb = d === THUMB;
    const nSeg = bone.lengths.length;
    const W = bone.breadth;
    const cond = A.condyle;

    if (seg === 0) {
      if (isThumb) {
        // The thumb's metacarpal is not buried: it is the thenar eminence,
        // a muscular mass that swells at mid-shaft and narrows to the knuckle.
        // The thenar's bulk is one biological quantity, and building it as a
        // product over-disperses it: the bone's breadth already carries the
        // hand's slenderness, and the eminence's own factor and the hand's
        // fleshiness then multiply on top. Three independent draws gave a
        // twofold spread of thenars across seeds - and muscle does not scale
        // one for one with the bone it sits on anyway. So take the whole
        // compounded deviation from nominal and damp it in log space, which
        // pulls both tails in without moving the middle, and set the swell so
        // a median hand lands mid-range instead of over the top of it.
        const nomW = NOMINAL_BREADTH[THUMB] * A.size;
        const dev = (W / nomW) * A.palm.thenar * A.palm.padding;
        const bulk = Math.pow(Math.max(0.2, dev), TH_DAMP);
        const a = nomW * bulk * M.profile(
          [[0, 1.95 * TH_SWELL], [0.26, 2.29 * TH_SWELL], [0.56, 2.18 * TH_SWELL],
           [0.82, 1.55 * TH_SWELL], [1, bone.jw[0]]], s);
        const b = a * lerp(0.70, 0.92, s);
        // The mass is not centred on the bone: abductor/flexor/opponens
        // pollicis brevis pile onto its palmar-radial side, while the dorsal
        // side is just skin over bone. Push the cross-section centre palmar
        // (positive dor) so the palmar half-thickness grows and the dorsal
        // half shrinks, tapering to zero by the knuckle where the thumb's
        // own column takes over and has to sit back on the bone axis again.
        const offD = -b * M.profile([[0, 0.32], [0.30, 0.46], [0.62, 0.40], [1, 0]], s);
        return [a, b, 0, offD];
      }
      // finger metacarpals are buried in the palm; only the head reads as form
      const a = W * lerp(1.18, bone.jw[0], s);
      return [a, a * 0.90];
    }

    // Interpolate along the continuous chain, waist the shaft, and add the
    // condylar swelling at whichever ends of this bone carry a joint.
    const i0 = seg - 1, i1 = seg;
    const w0 = bone.jw[i0], w1 = bone.jw[i1];
    const b0 = bone.jb[i0] * cond, b1 = bone.jb[i1] * cond;
    const sc = clamp(s, 0, 1);
    let w = lerp(w0, w1, sc) * (1 - 0.075 * Math.sin(Math.PI * sc));
    const eIn = Math.max(0, 1 - sc / 0.34), eOut = Math.max(0, (sc - 0.66) / 0.34);
    w += b0 * eIn * eIn + b1 * eOut * eOut;

    const isLast = seg === nSeg - 1;
    let a = W * w;
    let bDepth = a * lerp(bone.jd[i0], bone.jd[i1], sc);
    if (isLast) {
      // the distal phalanx widens for the pulp before the tuft narrows, and
      // the pad stands proud further than it spreads
      a *= M.profile([[0, 1], [0.30, 0.985], [0.62, 1.035], [0.88, 1.005], [1, 0.96]], sc);
      bDepth *= M.profile([[0, 1], [0.28, 1.01], [0.60, 1.0 + 0.14 * A.pulp], [0.88, 1.0 + 0.08 * A.pulp], [1, 0.97]], sc);
    }

    if (isLast && s > 1) {
      // rounded fingertip: a quarter-ellipse closing of the generalised tube
      const u = clamp((s - 1) / tipExtent(A, d), 0, 1);
      const k = Math.sqrt(Math.max(0, 1 - u * u));
      a *= k; bDepth *= k;
    }
    return [a, bDepth];
  }

  /** how far past the end of the distal phalanx the pulp dome extends, in s units */
  function tipExtent(A, d) {
    const bone = A.bones[d];
    const distLen = bone.lengths[bone.lengths.length - 1];
    return (bone.breadth * bone.jw[bone.jw.length - 1] * 0.92 * A.pulp) / distLen;
  }

  /**
   * The web line: at surface angle alpha (0 = ulnar side, +pi/2 = dorsal,
   * -pi/2 = palmar) the finger's surface begins at this value of s on the
   * proximal phalanx. Palmar web is high, dorsal web is at the knuckle.
   */
  function webStart(A, d, alpha) {
    if (d === THUMB) return 0;
    const palmarness = 0.5 - 0.5 * Math.sin(alpha);   // 1 at palmar, 0 at dorsal
    const radialWeb = A.web[d - 1];
    // the little finger has no web on its ulnar side: its border runs free
    const ulnarWeb = d < 4 ? A.web[d] : 0.02;
    const ulnarness = 0.5 + 0.5 * Math.cos(alpha);    // 1 on the ulnar side
    const h = lerp(radialWeb, ulnarWeb, ulnarness);
    return h * M.smoothstep(palmarness * 1.25) * 0.98;
  }

  GK.anatomy = {
    THUMB, INDEX, MIDDLE, RING, LITTLE, DIGIT_NAMES,
    NOMINAL, LIMITS, PRINT_TYPES, CMC_BASE,
    buildAnatomy, segmentProfile, tipExtent, webStart
  };
})(window.GK = window.GK || {});

/* ============================================================================
   GRAPHITE KINEMATICS — 20 · rig
   Forward kinematics for the whole linkage, plus the surface parametrisation
   that every crease, ridge, nail and hair is authored in.

   World frame (right hand, right-handed basis):
       +X  distal    -X  proximal
       +Y  ulnar     -Y  radial
       +Z  palmar    -Z  dorsal
   Named rotations (explicit, so sign conventions are never in doubt):
       FLEX(t)  carries distal toward palmar
       ABD(t)   carries distal toward ulnar
       TWIST(t) carries ulnar toward palmar (axial roll / opposition)

   Surface coordinates on a digit segment: (s, alpha)
       s      0..1 along the bone, past 1 into the fingertip dome
       alpha  0 = ulnar flank, +pi/2 = dorsal, +-pi = radial, -pi/2 = palmar
   Surface coordinates on the palm: (u, beta)
       u      0 at the wrist, 1 at the knuckle line
       beta   0..1 once around the closed cross-section; 0..0.5 sweeps the
              palmar face radial->ulnar, 0.5..1 returns across the dorsum
   ========================================================================== */
(function (GK) {
  'use strict';
  const M = GK.math;
  const AN = GK.anatomy;
  const { DEG, clamp, clamp01, lerp, smoothstep, inv } = M;
  const { vadd, vsub, vmul, vmad, vdot, vcross, vnorm, vlen, vdist, vlerp, vcopy, mApply, mMul, mOrtho } = M;

  // ------------------------------------------------------- named rotations
  /** carries +X toward +Z (distal -> palmar): flexion */
  function FLEX(t) { const c = Math.cos(t), s = Math.sin(t); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; }
  /** carries +X toward +Y (distal -> ulnar): abduction */
  function ABD(t) { const c = Math.cos(t), s = Math.sin(t); return [[c, s, 0], [-s, c, 0], [0, 0, 1]]; }
  /** carries +Y toward +Z (ulnar -> palmar): axial twist */
  function TWIST(t) { const c = Math.cos(t), s = Math.sin(t); return [[1, 0, 0], [0, c, s], [0, -s, c]]; }

  const IDENT = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  // =========================================================================
  //  VIEW — orthographic camera
  // =========================================================================
  class View {
    /**
     * @param az  0 = looking at the dorsum, PI = looking at the palm,
     *            +PI/2 = ulnar flank, -PI/2 = radial (thumb) flank
     * @param el  elevation toward the fingertips
     */
    constructor(az, el, roll, scale, center, cx, cy) {
      this.set(az, el, roll, scale, center, cx, cy);
    }
    set(az, el, roll, scale, center, cx, cy) {
      this.az = az; this.el = el; this.roll = roll || 0;
      this.scale = scale; this.center = center || [0, 0, 0];
      this.cx = cx; this.cy = cy;
      const ce = Math.cos(el), se = Math.sin(el);
      // e points from the scene toward the eye
      const e = [se, ce * Math.sin(az), -ce * Math.cos(az)];
      this.e = vnorm(e);
      let up = [1, 0, 0];                       // fingers up the page
      if (Math.abs(vdot(this.e, up)) > 0.985) up = [0, 0, -1];
      let r = vnorm(vcross(up, this.e));        // r x u = e
      let u = vnorm(vcross(this.e, r));
      if (this.roll) {
        const c = Math.cos(this.roll), s = Math.sin(this.roll);
        const r2 = vadd(vmul(r, c), vmul(u, s));
        const u2 = vadd(vmul(u, c), vmul(r, -s));
        r = r2; u = u2;
      }
      this.r = r; this.u = u;
      return this;
    }
    /** world -> screen [x, y] */
    px(P) {
      const dx = P[0] - this.center[0], dy = P[1] - this.center[1], dz = P[2] - this.center[2];
      return [
        this.cx + this.scale * (dx * this.r[0] + dy * this.r[1] + dz * this.r[2]),
        this.cy - this.scale * (dx * this.u[0] + dy * this.u[1] + dz * this.u[2])
      ];
    }
    /** larger = nearer the eye */
    near(P) { return P[0] * this.e[0] + P[1] * this.e[1] + P[2] * this.e[2]; }
    /** project a direction (no translation) to screen space */
    dir(D) {
      return [
        this.scale * (D[0] * this.r[0] + D[1] * this.r[1] + D[2] * this.r[2]),
        -this.scale * (D[0] * this.u[0] + D[1] * this.u[1] + D[2] * this.u[2])
      ];
    }
    /** cosine of the angle between a surface normal and the eye; >0 faces us */
    facing(N) { return vdot(N, this.e); }
  }

  // =========================================================================
  //  POSE -> SKELETON
  // =========================================================================

  /**
   * Collateral-ligament constraint: metacarpophalangeal abduction is free when
   * the joint is straight and almost eliminated by 90 degrees of flexion,
   * because the cam-shaped condyle draws the collateral ligaments taut.
   */
  function abdGate(flex) {
    return 1 - 0.88 * smoothstep(clamp01(flex / (78 * DEG)));
  }

  function solve(A, pose, opts) {
    const rig = { anatomy: A, pose, digits: [], joints: [] };
    const W = pose.wrist;

    // forearm roll, then wrist deviation, then wrist flexion
    const root = mMul(TWIST(W.pron || 0), mMul(ABD(W.dev || 0), FLEX(W.flex || 0)));
    rig.root = mOrtho(root);
    rig.origin = [0, 0, 0];

    // carpus: a short block between the wrist crease and the metacarpal bases
    const carpalLen = 26 * A.size;
    rig.carpal = { frame: rig.root, A: vmad(rig.origin, rig.root[0], -carpalLen * 0.55), len: carpalLen };
    rig.forearm = {
      frame: mOrtho(mMul(TWIST(W.pron || 0), IDENT())),
      A: rig.origin
    };

    const arch = pose.arch || 0;

    for (let d = 0; d < 5; d++) {
      const bone = A.bones[d];
      const cmc = A.cmc[d];
      const P = pose.digits[d];
      const nSeg = bone.lengths.length;

      // ---- carpometacarpal frame -----------------------------------------
      let fan = cmc.fan, tilt = cmc.tilt, roll = cmc.roll;
      if (d === AN.THUMB) {
        fan += (P.cmcRad || 0);      // radial abduction / adduction, in-plane
        tilt += (P.cmcAbd || 0);     // palmar abduction, out of the palm plane
        // Opposition pronates the thumb so its pad turns to face the fingers:
        // that carries the metacarpal's roll further from the palm plane, not
        // back toward it.
        roll -= (P.cmcOpp || 0);
      } else {
        const mob = cmc.mobility * arch;
        tilt += mob + (P.cmcFlex || 0);
        roll += mob * 0.45;          // ulnar metacarpals supinate as the palm cups
      }
      const cmcAxA = rig.root[2];                       // in-plane swing
      const afterFan = mMul(rig.root, ABD(fan));
      const cmcAxF = vmul(afterFan[1], -1);              // out of the palm plane
      const afterTilt = mMul(afterFan, FLEX(tilt));
      const cmcAxT = vmul(afterTilt[0], -1);             // opposition (roll -= opp)
      let frame = mOrtho(mMul(afterTilt, TWIST(roll)));
      let origin = vadd(rig.origin, mApply(rig.root, cmc.pos));

      const segs = [];
      const joints = [];
      for (let seg = 0; seg < nSeg; seg++) {
        if (seg > 0) {
          // ---- joint rotation ---------------------------------------------
          let flexA = 0, abdA = 0, twistA = 0, abdScale = 1;
          if (d === AN.THUMB) {
            if (seg === 1) { flexA = P.mcpFlex || 0; abdA = (P.mcpAbd || 0); }
            else { flexA = P.ipFlex || 0; }
          } else {
            if (seg === 1) {
              flexA = P.mcpFlex || 0;
              abdScale = abdGate(flexA);
              abdA = (P.mcpAbd || 0) * abdScale;
            } else if (seg === 2) {
              flexA = P.pipFlex || 0;
            } else {
              flexA = P.dipFlex || 0;
              abdA = bone.clino * (d === AN.LITTLE ? 1 : 0.4);
            }
          }
          flexA += bone.camber[seg] || 0;
          // World rotation axes, so a contact solver can ask how moving this
          // joint would move a point. ABD turns about the parent frame's
          // dorsopalmar axis; FLEX about the abducted frame's mediolateral
          // one, in the negative sense (FLEX carries +X toward +Z).
          const axA = frame[2];
          const mid = mMul(frame, ABD(abdA));
          const axF = vmul(mid[1], -1);
          frame = mOrtho(mMul(mid, FLEX(flexA)));
          joints.push({
            digit: d, index: seg, name: bone.jointNames[seg],
            P: origin, frame, axA, axF, abdScale,
            flex: flexA, abd: abdA, twist: twistA
          });
        } else {
          joints.push({ digit: d, index: 0, name: 'CMC', P: origin, frame, flex: tilt, abd: fan, twist: roll, axA: cmcAxA, axF: cmcAxF, axT: cmcAxT });
        }

        const len = bone.lengths[seg];
        const start = origin;
        const end = vmad(origin, frame[0], len);
        const isLast = seg === nSeg - 1;
        segs.push({
          digit: d, seg, name: bone.segNames[seg],
          A: start, B: end, len, frame,
          t: frame[0], ul: frame[1], pa: frame[2], dor: vmul(frame[2], -1),
          // Every segment begins a little *before* its own joint, and how much
          // before depends on how hard that joint is bent.
          //
          // A joint is two cylinders hinged together, and on the OUTSIDE of a
          // bend their ends part company: to keep the two solids reading as
          // one across a bend of angle t, the distal one has to reach back
          // about r * tan(t/2) past the hinge. At zero it costs nothing, which
          // is why this went unnoticed - a relaxed hand is fine. Hard flexed
          // it is most of a phalanx: measured on a maximal clench, the depth
          // field had open pipe ends where the knuckles should be, occlusion
          // failed in every one of those gaps, and the drawing came out as a
          // scatter of separate sausages rather than a fist.
          //
          // The proximal phalanx carries an extra fixed amount on top, because
          // its condyle has to plug into the end of the palm. That condyle is
          // the knuckle: it has to belong to the digit, or the palm's own
          // solid swallows it and a fist comes out with no knuckles at all.
          sMin: seg === 0 ? 0 : -((seg === 1 ? 0.12 : 0) + jointReach(A, d, seg, len, joints[seg].flex)),
          sMax: isLast ? 1 + AN.tipExtent(A, d) : 1,
          rendered: seg > 0 || d === AN.THUMB
        });
        origin = end;
      }
      rig.digits.push({ digit: d, name: bone.name, segs, joints, tip: origin });
      for (const j of joints) rig.joints.push(j);
    }

    // how far each knuckle has risen, for the dorsal thickness field
    A.__knuckle = [1, 2, 3, 4].map(d =>
      clamp01(Math.max(0, rig.digits[d].joints[1].flex) / (68 * DEG)));
    // The thenar is muscle, and it goes with the thumb: as the thumb swings
    // out of the palm plane the mass rises behind it. Without this the palm
    // stays flat, the metacarpal walks away from it, and the thumb reads as a
    // separate object floating beside the hand.
    {
      const T = pose.digits[0];
      A.__thenarLift = clamp01(((T.cmcAbd || 0) / (55 * DEG)) * 0.75 +
        ((T.cmcOpp || 0) / (75 * DEG)) * 0.45);
    }
    // the reach solver only needs the skeleton: the palm surface is most of the cost
    if (opts && opts.skeleton) return rig;
    buildPalm(rig);
    A.__thenarV = rig.palm.thumbV * 0.72;
    return rig;
  }

  // =========================================================================
  //  PALM SURFACE
  //  A closed generalised tube whose cross-sections are spanned by the five
  //  metacarpals, so that cupping the hand deforms the sheet for free.
  // =========================================================================
  const PALM_NU = 41;
  const PALM_U0 = -0.55, PALM_U1 = 1.22;
  // The sheet is spanned by the four finger metacarpals. The thumb's is short
  // and steeply angled — carrying it as a control column tents the surface —
  // so the thenar is carried as thickness instead, over a radial border that
  // tracks where the thumb metacarpal actually lies.
  const V_KNOTS = [0, 1 / 3, 2 / 3, 1];
  const VMID = 0.42;
  /** the hand narrows sharply into the wrist */
  const wristNarrow = (u) => lerp(0.84, 1, smoothstep(clamp01((u + 0.30) / 0.46)));

  function buildPalm(rig) {
    const A = rig.anatomy;
    const smoothstep = M.smoothstep;
    const grid = [];      // [uIdx][mcIdx] -> spine point
    const norms = [];     // [uIdx][mcIdx] -> dorsal-to-palmar normal
    for (let i = 0; i < PALM_NU; i++) {
      const u = lerp(PALM_U0, PALM_U1, i / (PALM_NU - 1));
      const row = [];
      for (let d = 1; d < 5; d++) {
        const mc = rig.digits[d].segs[0];
        let P = vmad(mc.A, mc.t, mc.len * u);
        if (u < 0) {
          // Proximal of the carpus the metacarpals converge on one another;
          // a wrist does not. Blend onto the hand's own long axis so the
          // sheet runs out parallel-sided instead of pinching to a point.
          const alt = vmad(mc.A, rig.root[0], u * 62 * A.size);
          P = M.vlerp(P, alt, smoothstep(clamp01(-u / 0.22)));
        }
        row.push(P);
      }
      grid.push(row);
    }
    // normals from the local surface tangents
    for (let i = 0; i < PALM_NU; i++) {
      const row = [];
      for (let d = 0; d < 4; d++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(PALM_NU - 1, i + 1);
        const d0 = Math.max(0, d - 1), d1 = Math.min(3, d + 1);
        const Tu = vsub(grid[i1][d], grid[i0][d]);
        const Tv = vsub(grid[i][d1], grid[i][d0]);
        let n = vnorm(vcross(Tv, Tu));
        // orient palmar-ward using the carpal frame
        if (vdot(n, rig.root[2]) < 0) n = vmul(n, -1);
        row.push(n);
      }
      norms.push(row);
    }
    // Where does the thumb metacarpal sit, in the sheet's own coordinates?
    // The radial border is pulled out to meet it, so the thenar opens and
    // closes with the thumb instead of being a fixed lobe. One representative
    // point (the old approach) stands in fine for a thumb near rest, but
    // opposition and cupping swing the metacarpal enough that a single sample
    // stops speaking for the rest of it, and the border reaches for the wrong
    // place while the base of the bone goes uncovered. Track several points
    // along its length instead, and let each u pull toward whichever of them
    // is relevant there.
    const tmc = rig.digits[0].segs[0];
    const palmRef = {
      grid, norms, nu: PALM_NU, u0: PALM_U0, u1: PALM_U1, knots: V_KNOTS,
      vLo: () => -3, vHi: () => 3
    };
    rig.palm = palmRef;
    const samples = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0].map((sv) => {
      const P = vmad(tmc.A, tmc.t, tmc.len * sv);
      let bestD = 1e18, bu = 0.5, bv = -0.5;
      for (let iu = 0; iu <= 16; iu++) {
        for (let iv = 0; iv <= 32; iv++) {
          const uu = lerp(-0.15, 1.05, iu / 16), vv = lerp(-1.45, 0.05, iv / 32);
          const q = palmSpine(rig, uu, vv).P;
          const dd = (q[0] - P[0]) ** 2 + (q[1] - P[1]) ** 2 + (q[2] - P[2]) ** 2;
          if (dd < bestD) { bestD = dd; bu = uu; bv = vv; }
        }
      }
      return { sv, u: bu, v: clamp(bv, -1.35, -0.10) };
    });
    const head = samples[samples.length - 1];   // the metacarpal head
    const track = samples.slice().sort((p, q) => p.u - q.u);
    // v the border should reach for at a given u, held flat past either end
    // of the tracked span rather than extrapolated, which is what lets the
    // wrist taper (below) and the web pinch (in vHi) still have the last word
    const thumbVAt = (u) => {
      if (u <= track[0].u) return track[0].v;
      if (u >= track[track.length - 1].u) return track[track.length - 1].v;
      for (let i = 0; i < track.length - 1; i++) {
        const a = track[i], b = track[i + 1];
        if (u <= b.u) return lerp(a.v, b.v, inv(u, a.u, b.u));
      }
      return track[track.length - 1].v;
    };
    const thumbV = thumbVAt(0.55), thumbU = 0.55;
    // The thenar's resting profile: a lobe over the thumb metacarpal that
    // returns to the rim at both ends - into the wrist proximally, into the
    // first web distally.
    const lobe = (u, c, wProx, wDist) =>
      Math.exp(-Math.pow((u - c) / (u < c ? wProx : wDist), 2));
    // wider proximally, where the eminence runs back to the wrist, than
    // distally, where it has to be off the sheet by the metacarpal heads -
    // past them the space between the rays is web, not palm, and a border
    // still carrying thenar width out there draws as a straight radial edge
    const REF_C = 0.46, REF_W = 0.54, REF_WD = 0.34, REF_A = 0.52;
    /** furthest the border may be drawn beyond that resting profile */
    const EMAX = 0.30;

    rig.palm = {
      grid, norms,
      nu: PALM_NU, u0: PALM_U0, u1: PALM_U1,
      knots: V_KNOTS, thumbV, thumbU,
      // The borders carry the eminences: the radial edge swells over the
      // thenar and pulls back in at the thumb web, the ulnar edge over the
      // hypothenar. Extrapolating past the outer metacarpals does the work.
      vLo: (u) => {
        const uu = clamp(u, -0.6, 1.3);
        const ref = -0.20 - REF_A * lobe(uu, REF_C, REF_W, REF_WD);
        // Muscle does not follow bone wherever the bone goes. The thenar is
        // anchored on the carpus and tethered across the first web, so an
        // abducting thumb draws it out only so far before the web - not the
        // palm - takes up the rest, and however the thumb is held the border
        // must still come back to the rim past the metacarpal head, or the
        // sheet keeps its full width out through the knuckles and reads as a
        // flat wedge. So the tracked bone enters as a saturating excursion
        // beyond the resting lobe, through a lobe of its own centred on the
        // head, and never as a position. Opposition, which swings the bone
        // back across the palm, leaves the resting thenar standing rather
        // than flattening it: the muscle bunches, it does not vanish.
        const want = Math.min(0, thumbVAt(uu) - ref);
        const extra = -EMAX * (1 - Math.exp(want / EMAX));
        const raw = Math.min(-0.20, ref + extra * lobe(uu, head.u, 0.46, 0.24));
        return VMID - (VMID - raw) * wristNarrow(uu);
      },
      /** where the radial border sits for a hand with the thumb at rest */
      vLoRef: (u) => {
        const uu = clamp(u, -0.6, 1.3);
        const raw = -0.20 - REF_A * lobe(uu, REF_C, REF_W, REF_WD);
        return VMID - (VMID - raw) * wristNarrow(uu);
      },
      /**
       * Palm features are authored against a hand with the thumb at rest.
       * Rebasing them onto the live radial border keeps them inside the sheet
       * in every pose: without it, an adducted thumb pulls the border in and
       * everything beyond it collapses onto the rim as one black line.
       */
      mapV: function (u, v) {
        if (v >= VMID) return v;
        const ref = this.vLoRef(u), live = this.vLo(u);
        const span = VMID - ref;
        if (span < 1e-6) return v;
        return lerp(live, VMID, (v - ref) / span);
      },
      vHi: (u) => {
        const uu = clamp(u, -0.6, 1.3);
        const raw = 1 + 0.105 + 0.275 * Math.exp(-Math.pow((uu - 0.34) / 0.46, 2));
        return VMID + (raw - VMID) * wristNarrow(uu);
      },
      // The palm's own solid stops just past the metacarpal heads. The web
      // margin between two digits is not a property of the palm at all — it
      // is skin spanning from one finger's flank to the next — so it is built
      // from those flanks, in webContours, rather than guessed here.
      uDistal: (v, palmar) => palmar === false ? 1.045
        : 1.030 + 0.055 * (0.5 - 0.5 * Math.cos(Math.PI * 6 * clamp(v, 0, 1)))
    };
  }

  /** spine point + palmar normal at palm coordinates (u, v) */
  function palmSpine(rig, u, v) {
    const p = rig.palm;
    const fi = (clamp(u, p.u0, p.u1) - p.u0) / (p.u1 - p.u0) * (p.nu - 1);
    const vi = M.knotIndex(p.knots, v);
    // Catmull-Rom in v within each of four u-rows, then Catmull-Rom in u
    const i = clamp(Math.floor(fi), 0, p.nu - 2);
    const tu = clamp(fi - i, -0.6, 1.6);
    const rows = [Math.max(0, i - 1), i, i + 1, Math.min(p.nu - 1, i + 2)];
    const cp = [], cn = [];
    for (let k = 0; k < 4; k++) {
      cp.push(M.splineAt(p.grid[rows[k]], vi));
      cn.push(M.splineAt(p.norms[rows[k]], vi));
    }
    return {
      P: M.crV(cp[0], cp[1], cp[2], cp[3], tu),
      n: vnorm(M.crV(cn[0], cn[1], cn[2], cn[3], tu))
    };
  }

  /** palmar soft-tissue thickness (mm) at palm coordinates */
  function palmThickPalmar(A, u, v) {
    if (A.__thenarV === undefined) A.__thenarV = -0.52;
    const S = A.size, pad = A.palm.padding;
    let t = 9.0;
    // thenar eminence — the muscular ball of the thumb
    t += (6.0 + 9.5 * (A.__thenarLift || 0)) * A.palm.thenar *
      Math.exp(-Math.pow((v - A.__thenarV) / 0.34, 2)) *
      Math.exp(-Math.pow((u - 0.50) / 0.46, 2));
    // hypothenar eminence
    t += 6.4 * A.palm.hypothenar *
      Math.exp(-Math.pow((v - 1.14) / 0.26, 2)) *
      Math.exp(-Math.pow((u - 0.44) / 0.42, 2));
    // pads over the metacarpal heads
    t += 4.6 * Math.exp(-Math.pow((u - 0.97) / 0.17, 2)) *
      M.smoothstep(clamp01((v + 0.22) / 0.30)) *
      (0.72 + 0.28 * Math.cos(Math.PI * 3 * clamp01(v)));
    // central hollow
    t -= 3.2 * A.palm.hollow *
      Math.exp(-Math.pow((u - 0.60) / 0.24, 2)) *
      Math.exp(-Math.pow((v - 0.50) / 0.32, 2));
    // wrist narrows and thins
    t *= lerp(0.40, 1.0, smoothstep(clamp01((u + 0.30) / 0.54)));
    return Math.max(1.0, t) * S * pad;
  }

  /**
   * Dorsal soft-tissue thickness (mm). The back of the hand is thin, except
   * over the metacarpal heads — and those only rise into knuckles when the
   * joint below them flexes. A knuckle is the head rolling out from under the
   * extensor hood, not the phalanx: with the joint at ninety degrees the
   * phalanx's own condyle points distally and contributes nothing dorsally,
   * which is why a fist drawn from the phalanx alone comes out with a flat
   * back and no knuckles at all.
   */
  function palmThickDorsal(A, u, v) {
    const S = A.size;
    const kn = A.__knuckle || [0, 0, 0, 0];
    // Padding, and it thins at both ends. Toward the wrist because the
    // tendons run straight over the carpus with nothing under them; toward
    // the knuckles because the metacarpal heads are subcutaneous, which is
    // the whole reason a knuckle shows at all. Carried at full depth to the
    // distal edge it swallowed the base of the proximal phalanx - measured
    // at rest, the little finger's knuckle sat 3mm inside the palm's own
    // solid, and in a cupped hand 4.6mm.
    let base = 4.4;
    base *= lerp(0.46, 1.0, smoothstep(clamp01((u + 0.30) / 0.56)));
    base *= lerp(1.0, 0.26, smoothstep(clamp01((u - 0.86) / 0.22)));
    // and thinnest of all over the fifth head, which is the most
    // subcutaneous bone on the hand - it is the one that breaks in a
    // boxer's fracture, and the one whose knuckle stands proudest
    base *= lerp(1.0, 0.62, smoothstep(clamp01((v - 0.70) / 0.32)) *
      smoothstep(clamp01((u - 0.80) / 0.24)));
    // the shafts of the metacarpals show through as low ridges
    base += 0.9 * Math.pow(Math.abs(Math.cos(Math.PI * 3 * v)), 3) *
      M.smoothstep(clamp01((v + 0.20) / 0.28)) *
      (1 - smoothstep(clamp01((u - 0.86) / 0.20)));
    // and the heads themselves sit on top of it, at their own depth: they
    // are bone, so they do not thin with the padding around them
    let t = base;
    for (let i = 0; i < 4; i++) {
      const vc = i / 3;
      t += (1.1 + 4.4 * kn[i]) * A.knuckles.prominence *
        Math.exp(-Math.pow((u - 0.985) / 0.145, 2)) *
        Math.exp(-Math.pow((v - vc) / 0.155, 2));
    }
    return Math.max(0.8, t) * S * A.palm.padding;
  }

  /** superelliptical wrap: 1 across the sheet, 0 at the borders */
  function palmWrap(rig, u, v) {
    const lo = rig.palm.vLo(u), hi = rig.palm.vHi(u);
    if (v <= lo || v >= hi) return 0;
    const x = (v - lo) / (hi - lo) * 2 - 1;    // -1..1
    return Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(x), 5)));
  }

  /**
   * Palm surface point at (u, beta).
   * beta 0..0.5 sweeps the palmar face from the radial border to the ulnar
   * border; 0.5..1 returns across the dorsum. Returns { P, N, v, palmar }.
   */
  function palmSurface(rig, u, beta) {
    const A = rig.anatomy;
    const lo = rig.palm.vLo(u), hi = rig.palm.vHi(u);
    const phi = M.TAU * beta;
    const v = lo + (hi - lo) * (0.5 - 0.5 * Math.cos(phi));
    const s = Math.sin(phi);
    const sp = palmSpine(rig, u, v);
    const wrap = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(2 * (v - lo) / (hi - lo) - 1), 5)));
    const palmar = s >= 0;
    const thick = palmar ? palmThickPalmar(A, u, v) : palmThickDorsal(A, u, v);
    const off = thick * wrap * Math.abs(s);
    const P = vmad(sp.P, sp.n, palmar ? off : -off);
    // palmNormal is a difference of these, so the dent turns the normal too
    return { P: rig.soft ? softPoint(rig, P) : P, v, palmar, spine: sp.P, n: sp.n, off, thick, wrap };
  }

  /** numeric surface normal on the palm */
  function palmNormal(rig, u, beta) {
    const h = 0.006;
    // c0 answers both what palmSurface(rig, u, beta) used to be asked for
    // twice: the centre point for the finite difference, and .n/.palmar for
    // the orientation reference below. Calling it a second time returned the
    // same object every time - rig and (u, beta) are exactly what it reads -
    // so the second call was never disagreeing with the first, only paying
    // for palmSpine and the thickness fields all over again to reconfirm it.
    const c0 = palmSurface(rig, u, beta);
    const p0 = c0.P;
    const pu = palmSurface(rig, clamp(u + h, -0.1, 1.12), beta).P;
    const pb = palmSurface(rig, u, beta + h).P;
    const Tu = vsub(pu, p0), Tb = vsub(pb, p0);
    let N = vnorm(vcross(Tb, Tu));
    const ref = vmul(c0.n, c0.palmar ? 1 : -1);
    if (vdot(N, ref) < 0) N = vmul(N, -1);
    return N;
  }

  // =========================================================================
  //  DIGIT SURFACE
  // =========================================================================

  /**
   * Where a section's centre sits off its bone axis, in the bone's own frame.
   *
   * Only the thumb's metacarpal uses this: the thenar is muscle piled on the
   * palmar-radial side of the HAND, not a sleeve centred on the bone. Which
   * frame that displacement belongs to matters as soon as the metacarpal's
   * axial set changes - tie it to the bone's own dorsal axis and the muscle
   * rotates with the roll and slides off the bone it is there to cover. So
   * segmentProfile gives the magnitude and this resolves the direction, out
   * of the hand's palmar axis and into the section's plane.
   */
  function sectionOffset(rig, d, seg, pr) {
    const m = -(pr[3] || 0), u = pr[2] || 0;
    if (!m) return [u, 0];
    const sg = rig.digits[d].segs[seg];
    const cu = vdot(rig.root[2], sg.ul), cd = vdot(rig.root[2], sg.dor);
    const n = Math.hypot(cu, cd);
    if (n < 1e-6) return [u, -m];
    return [u + m * (cu / n), m * (cd / n)];
  }

  /**
   * Surface point on a digit segment; alpha 0 = ulnar, +pi/2 = dorsal.
   *
   * `pr0`, when the caller already has it, is this section's segmentProfile
   * - optional, and only ever passed by a caller about to ask digitNormal
   * for the same (d, seg, s) right after, so it can hand that call the
   * profile back too instead of making it re-derive one this function
   * already has sitting in a local variable. Every other caller leaves it
   * out and gets exactly what this function always computed for itself.
   */
  function digitSurface(rig, d, seg, s, alpha, pr0) {
    const A = rig.anatomy;
    const sg = rig.digits[d].segs[seg];
    const pr = pr0 || AN.segmentProfile(A, d, seg, s);
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const off = sectionOffset(rig, d, seg, pr);
    const offU = off[0], offD = off[1];
    const P = [
      sg.A[0] + sg.t[0] * sg.len * s + sg.ul[0] * (pr[0] * ca + offU) + sg.dor[0] * (pr[1] * sa + offD),
      sg.A[1] + sg.t[1] * sg.len * s + sg.ul[1] * (pr[0] * ca + offU) + sg.dor[1] * (pr[1] * sa + offD),
      sg.A[2] + sg.t[2] * sg.len * s + sg.ul[2] * (pr[0] * ca + offU) + sg.dor[2] * (pr[1] * sa + offD)
    ];
    return { P: rig.soft ? softPoint(rig, P) : P, a: pr[0], b: pr[1], seg: sg, pr, off };
  }


  // =========================================================================
  //  SOFT CONTACT — WHAT THE BALL DOES TO THE HAND
  //
  //  A hand holding a ball is not a hand with a ball drawn next to it. Skin
  //  gives: the pads flatten where they take the weight, and the tissue that
  //  went out of the dent has to go somewhere, so it stands up in a low ring
  //  around it. Without that the ball reads as pasted on however carefully
  //  the fingers are placed around it, because every edge stays exactly as
  //  round as it was when nothing was touching it.
  //
  //  Done here - in the surface itself - rather than as marks laid over the
  //  top, so everything that reads the surface inherits it at once: the
  //  silhouette bends round the dent because the silhouette is traced from
  //  this surface, the modelling turns because the normal turns, and a
  //  crease crossing the contact rides over the ring instead of through it.
  // =========================================================================

  /**
   * Set up the ball's deformation of the hand, or clear it.
   *
   * The depth is measured against the undeformed hand - which is why `soft`
   * is cleared before sampling - and everything else scales off that, so a
   * ball resting on the palm dimples it and a ball squeezed hard dents deep
   * and throws up a correspondingly bigger ring.
   */
  function softContact(rig, amount) {
    rig.soft = null;
    const b = rig.ball;
    if (!b || !(amount > 0.01)) return;
    let pen = 0;
    const probe = (P) => {
      const v = b.r - Math.hypot(P[0] - b.C[0], P[1] - b.C[1], P[2] - b.C[2]);
      if (v > pen) pen = v;
    };
    for (let d = 0; d < 5; d++) {
      for (const sg of rig.digits[d].segs) {
        if (!sg.rendered) continue;
        for (let i = 0; i <= 6; i++) {
          const s = lerp(sg.sMin, sg.sMax, i / 6);
          for (let k = 0; k < 12; k++) probe(digitSurface(rig, d, sg.seg, s, (k / 12) * Math.PI * 2).P);
        }
      }
    }
    for (let i = 0; i <= 14; i++) {
      for (let k = 0; k <= 10; k++) {
        probe(palmSurface(rig, lerp(-0.2, 1.02, i / 14), (k / 10) * 0.5).P);
      }
    }
    if (pen < 0.12) return;
    rig.soft = {
      C: b.C, r: b.r, amount: clamp(amount, 0, 1.6), pen,
      // how sharply the skin turns into the contact. Zero would crease it
      // along the rim like a paper bag; a millimetre or so is knuckle skin.
      ease: 1.35,
      // how far out the displaced tissue reaches, and how high it stands
      rim: clamp(pen * 2.4, 2.4, 11),
      bulge: pen * 0.42,
    };
  }

  /**
   * The displacement at one point: how far it moves, and which way.
   *
   * Straight out along the radius from the ball's centre. Pushed to exactly
   * the sphere it would crease at the rim, so the press is a smooth minimum
   * rather than a clamp - deep in the contact it resolves the penetration
   * completely, and it lets go over the last millimetre instead of stopping
   * dead. The ring outside is the same tissue arriving, so it rises and
   * falls over the rim's width and is gone by the end of it.
   */
  function softField(sf, P) {
    const ax = P[0] - sf.C[0], ay = P[1] - sf.C[1], az = P[2] - sf.C[2];
    const rho = Math.sqrt(ax * ax + ay * ay + az * az);
    if (rho < 1e-6) return null;
    const rel = rho - sf.r;
    if (rel > sf.rim) return null;
    const e = sf.ease;
    const root = Math.sqrt(rel * rel + e * e);
    const press = 0.5 * (root - rel);
    const t = clamp01(rel / sf.rim);
    const ring = sf.bulge * 4 * t * (1 - t);
    const w = (press - ring) * sf.amount;
    // d/drho of the same, for the normal
    const dw = (0.5 * (rel / root - 1) - sf.bulge * 4 * (1 - 2 * t) / sf.rim) * sf.amount;
    return { u: [ax / rho, ay / rho, az / rho], w, dw };
  }

  /** a surface point, moved by the contact */
  function softPoint(rig, P) {
    const sf = rig.soft;
    if (!sf) return P;
    const f = softField(sf, P);
    if (!f) return P;
    return [P[0] + f.u[0] * f.w, P[1] + f.u[1] * f.w, P[2] + f.u[2] * f.w];
  }

  /**
   * The normal, turned by the contact.
   *
   * To first order a surface displaced by h along its own normal turns by the
   * tangential gradient of h, and h here is the radial displacement resolved
   * onto the normal. That is what makes the dent read: the rim catches the
   * light on its outer slope and loses it on the inner one, which is the only
   * thing that separates a pressed pad from a flat one.
   */
  function softNormal(rig, P, N) {
    const sf = rig.soft;
    if (!sf) return N;
    const f = softField(sf, P);
    if (!f) return N;
    const un = vdot(f.u, N);
    const g = f.dw * un;
    const gn = g * un;
    const t = [f.u[0] * g - N[0] * gn, f.u[1] * g - N[1] * gn, f.u[2] * g - N[2] * gn];
    return vnorm([N[0] - t[0], N[1] - t[1], N[2] - t[2]]);
  }

  /**
   * How far a segment reaches back past its own joint, as a fraction of its
   * length, so that its solid and its parent's stay one solid through a bend.
   *
   * Capped, because the geometric answer runs away as the bend approaches a
   * right angle and beyond - and because reaching back too far pushes the
   * narrower distal bone out through the palmar side of the wider one on the
   * INSIDE of the bend, which trades a hole for a lump.
   */
  function jointReach(A, d, seg, len, flex) {
    const bend = clamp(flex, 0, 2.4);
    if (bend < 0.05) return 0;
    const pr = AN.segmentProfile(A, d, seg, 0);
    const r = Math.max(pr[0], pr[1]);
    return Math.min(0.18, 0.62 * r * Math.tan(bend * 0.5) / Math.max(1e-6, len));
  }

  /** section centre of a digit segment, including any offset from segmentProfile */
  function sectionCenter(rig, d, seg, s) {
    const sg = rig.digits[d].segs[seg];
    const pr = AN.segmentProfile(rig.anatomy, d, seg, s);
    const off = sectionOffset(rig, d, seg, pr);
    return vmad(vmad(vmad(sg.A, sg.t, sg.len * s), sg.ul, off[0]), sg.dor, off[1]);
  }

  /**
   * Outward surface normal on a digit segment.
   *
   * `pr0`/`off0` let a caller that just computed digitSurface at this same
   * (d, seg, s) hand its segmentProfile and sectionOffset straight in,
   * rather than have this function spend a segmentProfile call and a
   * sectionOffset call re-deriving values it was just given the inputs to
   * skip. projectCurve, knuckleRings and firstWeb all call digitSurface and
   * digitNormal back to back at the same point for exactly this reason - a
   * curve needs both the surface and the way it faces - and passing them
   * through is arithmetically inert: p0 and o0 below end up holding the
   * identical values a bare call would have computed, just once instead of
   * twice.
   */
  function digitNormal(rig, d, seg, s, alpha, pr0, off0) {
    const A = rig.anatomy;
    const sg = rig.digits[d].segs[seg];
    const h = 0.004;
    const p0 = pr0 || AN.segmentProfile(A, d, seg, s);
    const p1 = AN.segmentProfile(A, d, seg, s + h);
    const da = (p1[0] - p0[0]) / h, db = (p1[1] - p0[1]) / h;
    // the section-centre offset (see sectionOffset) can also move with s
    const o0 = off0 || sectionOffset(rig, d, seg, p0), o1 = sectionOffset(rig, d, seg, p1);
    const dOffU = (o1[0] - o0[0]) / h, dOffD = (o1[1] - o0[1]) / h;
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    // dP/dalpha
    const Pa = [
      sg.ul[0] * (-p0[0] * sa) + sg.dor[0] * (p0[1] * ca),
      sg.ul[1] * (-p0[0] * sa) + sg.dor[1] * (p0[1] * ca),
      sg.ul[2] * (-p0[0] * sa) + sg.dor[2] * (p0[1] * ca)
    ];
    // dP/ds
    const Ps = [
      sg.t[0] * sg.len + sg.ul[0] * (da * ca + dOffU) + sg.dor[0] * (db * sa + dOffD),
      sg.t[1] * sg.len + sg.ul[1] * (da * ca + dOffU) + sg.dor[1] * (db * sa + dOffD),
      sg.t[2] * sg.len + sg.ul[2] * (da * ca + dOffU) + sg.dor[2] * (db * sa + dOffD)
    ];
    let N = vnorm(vcross(Pa, Ps));
    // guarantee outward orientation against the radial direction of the section
    const ref = [
      sg.ul[0] * ca + sg.dor[0] * sa,
      sg.ul[1] * ca + sg.dor[1] * sa,
      sg.ul[2] * ca + sg.dor[2] * sa
    ];
    if (vdot(N, ref) < 0) N = vmul(N, -1);
    return rig.soft ? softNormal(rig, digitSurface(rig, d, seg, s, alpha).P, N) : N;
  }


  // =========================================================================
  //  SILHOUETTE CONTOURS
  // =========================================================================

  /**
   * The knuckle rings of a digit.
   *
   * A digit's own outline is traced from its coverage (digitSilhouette), and
   * the knuckle is inside that trace rather than on it - so where a finger
   * foreshortens hard enough that the joint reads as a step in the form, the
   * ring has to be drawn in its own right. Only the metacarpophalangeal one:
   * a digit tapers along its length, so the proximal rim of a middle or
   * distal phalanx lies *inside* the segment behind it, and drawn as a ring
   * it reads as the open end of a pipe.
   */
  function knuckleRings(rig, view, d) {
    const A = rig.anatomy;
    const rings = [];
    for (const sg of rig.digits[d].segs) {
      if (!sg.rendered || sg.seg !== 1) continue;
      const f = Math.abs(vdot(sg.t, view.e));
      if (f < 0.50) continue;
      const gate = M.smoothstep(clamp01((f - 0.50) / 0.26));
      const sRing = -0.02;
      const ring = [];
      const N = 44;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const surf = digitSurface(rig, d, sg.seg, sRing, a);
        const fn = vdot(digitNormal(rig, d, sg.seg, sRing, a, surf.pr, surf.off), view.e);
        const q = surf.P;
        // only the arc where the surface grazes is an edge
        let g = gate * (1 - M.smoothstep(clamp01((Math.abs(fn) - 0.05) / 0.32)));
        // ...and where the web has buried it. This used to read `sRing <
        // webStart`, which looks like a comparison and is a constant: webStart
        // is a height times a smoothstep, so it is zero on the dorsal side and
        // never negative anywhere, and the ring is sampled at a fixed -0.02.
        // The test was therefore true at every angle on every finger in every
        // pose, and the knuckle - the one mark that says a foreshortened
        // finger has a joint in it rather than being a bent tube - has been
        // drawing at a quarter strength since it was written. What the damping
        // wants to know is whether there is any web at this angle at all.
        const web = AN.webStart(A, d, a);
        g *= lerp(1, 0.25, M.smoothstep(clamp01(web / 0.10)));
        const p = view.px(q);
        ring.push([p[0], p[1], view.near(q), sg.pid, g]);
      }
      rings.push(ring);
    }
    return rings;
  }

  /** closed screen outline of the palm sheet, used for occlusion and contour */
  function palmContour(rig, view, opts) {
    opts = opts || {};
    const NU = opts.nu || 44, NB = opts.nb || 96;
    // walk the two long borders (beta = 0 and beta = 0.5) plus the end arcs
    const radial = [], ulnar = [];
    const u0 = opts.u0 !== undefined ? opts.u0 : -0.10;
    const u1 = opts.u1 !== undefined ? opts.u1 : 1.055;
    for (let i = 0; i <= NU; i++) {
      const u = lerp(u0, u1, i / NU);
      const a = palmSurface(rig, u, 0.0);
      const b = palmSurface(rig, u, 0.5);
      const pa = view.px(a.P), pb = view.px(b.P);
      radial.push([pa[0], pa[1], view.near(a.P)]);
      ulnar.push([pb[0], pb[1], view.near(b.P)]);
    }
    const capDistal = [], capWrist = [];
    for (let i = 0; i <= NB; i++) {
      const t = i / NB;
      const beta = 0.5 - t * 0.5;
      const vAt = palmSurface(rig, u1, beta).v;
      const d1 = palmSurface(rig, rig.palm.uDistal(vAt, true), beta);
      const w1 = palmSurface(rig, u0, 0.5 + t * 0.5);   // wrist, dorsal face
      const pd = view.px(d1.P), pw = view.px(w1.P);
      capDistal.push([pd[0], pd[1], view.near(d1.P)]);
      capWrist.push([pw[0], pw[1], view.near(w1.P)]);
    }
    return {
      radial, ulnar, capDistal, capWrist,
      outline: radial.concat(capDistal, ulnar.slice().reverse(), capWrist)
    };
  }

  /** on-screen spine length across the metacarpals vs. the sheet's true (unforeshortened) width */
  function palmAxisRatio(rig, view, u0, u1) {
    const NC = 8;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, wSum = 0;
    for (let i = 0; i <= NC; i++) {
      const u = lerp(u0, u1, i / NC);
      const p = view.px(palmSpine(rig, u, VMID).P);
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
      wSum += vdist(palmSurface(rig, u, 0).P, palmSurface(rig, u, 0.5).P) * view.scale;
    }
    const axisSpan = Math.hypot(x1 - x0, y1 - y0);
    return axisSpan / Math.max(1e-6, wSum / (NC + 1));
  }

  /**
   * The palm's outline as a union: sample the whole sheet, take the radial
   * maximum about the projected centroid, bin by angle, fill the odd empty
   * bin from its neighbours. A digit answers the same problem by tracing the
   * border of what it covers, which assumes nothing about the projection's
   * shape; the palm can use the cheaper radial construction because,
   * foreshortened, it reads as a thin band rather than a blob, and a band
   * about its own centroid is star-shaped. What matters either way is only
   * that the surface is sampled densely enough to recover a boundary the
   * per-column extremes can't.
   *
   * Unlike a traced border, this one still has to survive palmSilhouette
   * callers' self-occlusion test, so a bin keeps the winning sample verbatim
   * rather than a radius reconstructed from a smoothed profile: a real point
   * is on the palm's own front surface by construction and passes; an
   * averaged one drifts depth and position out of step with each other and
   * reads as buried inside the solid it belongs to. A gap-filled bin
   * interpolates between two real neighbours, which stays close enough. Each
   * point carries the u it was won at, which is all splitRing needs to cut
   * the closed loop back into the two sides palmSilhouette hands its caller.
   */
  function palmUnionRing(rig, view, u0, u1) {
    const NS = 40, NA = 80, NBK = 128;
    const pts = [];
    for (let i = 0; i <= NS; i++) {
      const u = lerp(u0, u1, i / NS);
      for (let k = 0; k < NA; k++) {
        const q = palmSurface(rig, u, k / NA).P;
        const p = view.px(q);
        pts.push([p[0], p[1], view.near(q), u]);
      }
    }
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    cx /= pts.length; cy /= pts.length;
    const rad = new Float64Array(NBK).fill(-1);
    const ring = new Array(NBK);
    for (const p of pts) {
      const dx = p[0] - cx, dy = p[1] - cy;
      const r = Math.hypot(dx, dy);
      let b = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * NBK) % NBK;
      if (b < 0) b += NBK;
      if (r > rad[b]) { rad[b] = r; ring[b] = p; }
    }
    let filled = 0;
    for (let b = 0; b < NBK; b++) if (rad[b] >= 0) filled++;
    if (filled < NBK * 0.5) return null;
    for (let b = 0; b < NBK; b++) {
      if (ring[b]) continue;
      let lo = b, hi = b, n = 0;
      while (!ring[(lo + NBK) % NBK] && n++ < NBK) lo--;
      n = 0;
      while (!ring[hi % NBK] && n++ < NBK) hi++;
      const a = ring[((lo % NBK) + NBK) % NBK], c2 = ring[hi % NBK];
      ring[b] = [(a[0] + c2[0]) * 0.5, (a[1] + c2[1]) * 0.5, (a[2] + c2[2]) * 0.5, (a[3] + c2[3]) * 0.5];
    }
    return ring;
  }

  /**
   * Cuts palmUnionRing's closed loop into the two arcs running from its most
   * proximal point to its most distal one, then resamples each to NU+1
   * points at the same u values the rails use — not evenly by arc length —
   * so index i means the same column on both sides of a lerp between them.
   * Arc length would let a bump like the thenar land at a different index on
   * the two curves, so blending them would land on a point on neither.
   */
  function splitRing(ring, NU, u0, u1) {
    const NR = ring.length;
    let bWrist = 0, bTip = 0, uMin = Infinity, uMax = -Infinity;
    for (let b = 0; b < NR; b++) {
      if (ring[b][3] < uMin) { uMin = ring[b][3]; bWrist = b; }
      if (ring[b][3] > uMax) { uMax = ring[b][3]; bTip = b; }
    }
    const walk = (from, to) => {
      const out = [];
      let b = from;
      for (let n = 0; n <= NR; n++) {
        out.push(ring[b]);
        if (b === to) break;
        b = (b + 1) % NR;
      }
      return out;
    };
    const resample = (poly) => {
      const out = [];
      let j = 0;
      for (let i = 0; i <= NU; i++) {
        const target = lerp(u0, u1, i / NU);
        while (j < poly.length - 2 && poly[j + 1][3] < target) j++;
        const a = poly[j], b = poly[Math.min(poly.length - 1, j + 1)];
        const span = b[3] - a[3];
        const t = Math.abs(span) > 1e-9 ? clamp01((target - a[3]) / span) : 0;
        out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
      }
      return out;
    };
    return [resample(walk(bWrist, bTip)), resample(walk(bTip, bWrist).reverse())];
  }

  /**
   * The true screen outline of the palm sheet, for any view.
   *
   * Scanning the surface for where the normal grazes is unusable here: the
   * cross-section has a cusp at each rim, where the offset closes to zero and
   * the normal flips, and the scan fills with spurious crossings. Instead take
   * the cross-section's projected extremes along the direction perpendicular
   * to the sheet's own screen tangent. That is well defined in every view —
   * face-on it returns the two borders, edge-on it returns the palmar and
   * dorsal faces — and it never degenerates.
   *
   * Except the tangent itself can, the same way a per-section rail does: near
   * az 180 with the camera rising toward the fingertips, the sheet's u-axis
   * points almost straight at the eye, so a 0.012 step in u is nearly all
   * curvature and no slope, and the perpendicular built from it swings
   * wherever that curvature noise points rather than tracking the form. Each
   * column distrusts its own tangent exactly as far as a wide-baseline
   * reading of the same slope disagrees with it, and leans toward the wide
   * one by that amount — continuous in the disagreement, so nothing pops,
   * and at elevation 0, where the two already agree, it reproduces the old
   * rails exactly.
   *
   * That steadies the direction each column searches along, but a column is
   * still only one slice: once neighbouring slices project on top of each
   * other, u no longer orders the sheet on screen and no per-column extreme,
   * however carefully aimed, traces a boundary that doesn't cross itself.
   * The palm never gets small enough on screen to fall back to a whole
   * separate outline the way a foreshortened digit does — it just gets
   * thin — so palmUnionRing builds that fallback anyway, over the same
   * domain the rails cover, and every column fades its rail toward the
   * matching point on it in proportion to how thin the sheet reads
   * (palmAxisRatio). Both mechanisms are continuous functions of the view,
   * so an orbit through either transition never pops.
   */
  function palmSilhouette(rig, view, opts) {
    opts = opts || {};
    const NU = opts.nu || 54, NB = opts.nb || 96;
    const u0 = opts.u0 !== undefined ? opts.u0 : -0.44;
    const u1 = opts.u1 !== undefined ? opts.u1 : 1.03;
    const sideA = [], sideB = [];
    let prevA = null, prevB = null;
    const d2 = (a, b) => (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]);
    const WIDE = 0.28;
    const tangentAt = (u, h) => {
      const lo = Math.max(u0, u - h), hi = Math.min(u1, u + h);
      const t = view.dir(vsub(palmSurface(rig, hi, 0.25).P, palmSurface(rig, lo, 0.25).P));
      const tl = Math.hypot(t[0], t[1]);
      return tl > 1e-6 ? [t[0] / tl, t[1] / tl] : null;
    };
    const distrust = [];
    for (let i = 0; i <= NU; i++) {
      const u = lerp(u0, u1, i / NU);
      const tight = tangentAt(u, 0.012) || [0, 1];
      const wide = tangentAt(u, WIDE);
      let tx = tight[0], ty = tight[1], w = 0;
      if (wide) {
        const drift = Math.acos(clamp(tx * wide[0] + ty * wide[1], -1, 1)) * (180 / Math.PI);
        w = smoothstep(clamp01((drift - 8) / (30 - 8)));
        if (w > 0) {
          tx = lerp(tx, wide[0], w); ty = lerp(ty, wide[1], w);
          const tl = Math.hypot(tx, ty) || 1;
          tx /= tl; ty /= tl;
        }
      }
      distrust.push(w);
      const nx = -ty, ny = tx;
      let minD = 1e18, maxD = -1e18, minP = null, maxP = null;
      for (let k = 0; k < NB; k++) {
        const beta = k / NB;
        const q = palmSurface(rig, u, beta).P;
        const p = view.px(q);
        const dd = p[0] * nx + p[1] * ny;
        if (dd < minD) { minD = dd; minP = [p[0], p[1], view.near(q)]; }
        if (dd > maxD) { maxD = dd; maxP = [p[0], p[1], view.near(q)]; }
      }
      // Keep each side of the outline continuous. The extremum can hand off
      // between the palmar and dorsal faces as the sheet turns, and an
      // unordered pair leaves a chord stitched across the form.
      if (prevA && prevB && d2(minP, prevA) + d2(maxP, prevB) > d2(maxP, prevA) + d2(minP, prevB)) {
        const swap = minP; minP = maxP; maxP = swap;
      }
      sideA.push(minP); sideB.push(maxP);
      prevA = minP; prevB = maxP;
    }
    // A distrusted tangent still leaves a column free to pick between two
    // nearly-tied points on the loop, which is where the last of the jitter
    // survives. Leaning each point on its neighbours exactly as far as its
    // own tangent was distrusted mops that up without softening a column
    // that was never in question.
    const relax = (side) => {
      for (let pass = 0; pass < 3; pass++) {
        const src = side.map(p => p.slice());
        for (let i = 1; i < side.length - 1; i++) {
          const w = distrust[i] * 0.5;
          if (w <= 0) continue;
          for (let c = 0; c < 3; c++) {
            side[i][c] = lerp(src[i][c], (src[i - 1][c] + src[i][c] * 2 + src[i + 1][c]) * 0.25, w);
          }
        }
      }
    };
    relax(sideA); relax(sideB);

    // A steadied tangent still can't save a column once neighbouring columns
    // start projecting on top of each other — past that point u no longer
    // orders the sheet on screen, so no per-column extreme traces a boundary
    // that doesn't cross itself. That is the same collapse a digit answers by
    // tracing its coverage instead, one level up; the palm never gets compact
    // enough on screen for a blob, so instead every column fades toward the
    // union ring, in proportion to how thin the sheet reads.
    const ratio = palmAxisRatio(rig, view, u0, u1);
    const edgeOn = 1 - smoothstep(clamp01((ratio - 0.70) / (1.35 - 0.70)));
    if (edgeOn > 0.004) {
      const ring = palmUnionRing(rig, view, u0, u1);
      if (ring) {
        let [unionA, unionB] = splitRing(ring, NU, u0, u1);
        // The ring has no notion of which arc is "A": settle it once, by
        // whichever pairing agrees better with the rails where the rails are
        // themselves trusted, so the label can't flicker column to column.
        let same = 0, swapCost = 0;
        for (let i = 0; i <= NU; i++) {
          const wt = 1 - distrust[i];
          same += wt * (d2(sideA[i], unionA[i]) + d2(sideB[i], unionB[i]));
          swapCost += wt * (d2(sideA[i], unionB[i]) + d2(sideB[i], unionA[i]));
        }
        if (swapCost < same) { const t = unionA; unionA = unionB; unionB = t; }
        for (let i = 0; i <= NU; i++) {
          for (let c = 0; c < 3; c++) {
            sideA[i][c] = lerp(sideA[i][c], unionA[i][c], edgeOn);
            sideB[i][c] = lerp(sideB[i][c], unionB[i][c], edgeOn);
          }
        }
      }
    }

    // The palm has no distal end to close: four digits leave through it. The
    // only real boundary there is the web margin on the palmar face, running
    // proximally under each digit and distally between them. Closing the
    // dorsal half as well lays a box straight across the knuckles.
    const cap = [];
    const N = 46;
    for (let i = 0; i <= N; i++) {
      const beta = 0.5 * (i / N);                      // palmar face only
      const v = palmSurface(rig, u1, beta).v;
      const q = palmSurface(rig, rig.palm.uDistal(v, true), beta).P;
      const p = view.px(q);
      cap.push([p[0], p[1], view.near(q)]);
    }
    return { sideA, sideB, cap, u0, u1 };
  }

  /**
   * The free margins of the three interdigital webs. Each is a sheet of skin
   * spanning between two adjacent proximal phalanges, so its edge runs from a
   * point on one digit's ulnar flank to a point on the next digit's radial
   * flank, sagging a little proximally in between. Building it from the
   * flanks is what keeps it registered with the fingers it belongs to: a
   * margin invented on the palm either pokes past them or leaves a slit.
   */
  function webContours(rig, view) {
    const A = rig.anatomy;
    const out = [];
    for (let d = 1; d < 4; d++) {
      const sgA = rig.digits[d].segs[1], sgB = rig.digits[d + 1].segs[1];
      const aA = 0, aB = Math.PI;                       // ulnar flank, radial flank
      const PA = digitSurface(rig, d, 1, AN.webStart(A, d, aA), aA).P;
      const PB = digitSurface(rig, d + 1, 1, AN.webStart(A, d + 1, aB), aB).P;
      // sag: pull the midpoint back toward the knuckles and a touch palmar
      const mid = M.vlerp(PA, PB, 0.5);
      const prox = vnorm(vadd(sgA.t, sgB.t));
      const palmar = vnorm(vadd(sgA.pa, sgB.pa));
      const gap = M.vdist(PA, PB);
      const M1 = vmad(vmad(mid, prox, -gap * 0.30), palmar, gap * 0.06);
      const pts = [];
      const ctrl = [PA, PA, M1, PB, PB];
      for (let i = 0; i <= 26; i++) {
        const q = M.splineAt(ctrl, 1 + (i / 26) * 2);
        const p = view.px(q);
        pts.push([p[0], p[1], view.near(q), rig.palm.pid, 1]);
      }
      out.push(pts);
    }
    return out;
  }



  // =========================================================================
  //  THE OUTLINE OF A DIGIT, TRACED FROM ITS OWN COVERAGE
  //
  //  Every other way of finding a silhouette here starts from a cross-section
  //  and asks which way round it faces. That works while a finger runs across
  //  the picture and stops working the moment it turns to point at the eye:
  //  the two answers per section swing round and meet, so the rails spiral
  //  inward instead of ending on an edge, the tip has to be patched in from a
  //  second construction, and the patch and the rails then disagree about
  //  where the finger's edge is. Cross-fading between constructions cannot
  //  fix that, because there is no view in which both are right.
  //
  //  A silhouette is the boundary of what the form covers. So cover it: fill
  //  the digit's whole surface into a small mask, close the pinholes, and
  //  walk the border. One closed curve, joined by construction, correct from
  //  any direction, and with no assumption anywhere that the projection is
  //  star-shaped, convex, or longer than it is wide. The cost is a raster
  //  step per digit, which at this size is a few hundred microseconds.
  // =========================================================================

  /** scanline-fill one triangle into a coverage/depth/owner mask */
  function fillTri(m, ax, ay, az, ag, bx, by, bz, bg, cx, cy, cz, cg, owner) {
    const W = m.w, H = m.h;
    let y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    let y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    let x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    let x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    if (y1 < y0 || x1 < x0) return;
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-12) return;
    // Same hoist as DepthField.tri in 60-render.js, and for the same reason:
    // l1 and l2 are affine in (px, py), so the four coefficients below are
    // identical at every pixel this triangle covers and do not belong inside
    // the loop that visits them. The division by `d` stays a division, done
    // once per pixel exactly where it always was - turning it into a
    // multiply by a precomputed 1/d would change the rounding of every l1
    // and l2 in the mask by a bit that never shows on a smoothed, resampled
    // silhouette, but "never shows" is not the bar this file holds itself
    // to, so it is left a division.
    const A1 = by - cy, B1 = cx - bx;
    const A2 = cy - ay, B2 = ax - cx;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5, dpy = py - cy;
      const rowB1 = B1 * dpy, rowB2 = B2 * dpy;
      const row = y * W;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, dpx = px - cx;
        const l1 = (A1 * dpx + rowB1) / d;
        if (l1 < -0.002) continue;
        const l2 = (A2 * dpx + rowB2) / d;
        if (l2 < -0.002) continue;
        const l3 = 1 - l1 - l2;
        if (l3 < -0.002) continue;
        const zz = l1 * az + l2 * bz + l3 * cz;
        const i = row + x;
        if (!m.cov[i] || zz > m.dep[i]) {
          m.dep[i] = zz; m.own[i] = owner;
          m.gn[i] = l1 * ag + l2 * bg + l3 * cg;
        }
        m.cov[i] = 1;
      }
    }
  }

  /**
   * Walk the border of a filled mask, Moore-neighbourhood, once round.
   *
   * Returns cell coordinates in order, once round.
   */
  function traceBorder(m) {
    const W = m.w, H = m.h, cov = m.cov;
    let sx = -1, sy = -1;
    for (let y = 0; y < H && sy < 0; y++) {
      for (let x = 0; x < W; x++) if (cov[y * W + x]) { sx = x; sy = y; break; }
    }
    if (sy < 0) return null;
    const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : cov[y * W + x];
    const out = [];
    let cxi = sx, cyi = sy, dir = 6, guard = W * H * 4;
    while (guard-- > 0) {
      out.push([cxi, cyi]);
      // the first neighbour clockwise from where we came in
      let nx = 0, ny = 0, nd = 0, found = false;
      const from = (dir + 6) % 8;
      for (let k = 0; k < 8; k++) {
        const t = (from + k) % 8;
        const ax = cxi + DX[t], ay = cyi + DY[t];
        if (at(ax, ay)) { nx = ax; ny = ay; nd = t; found = true; break; }
      }
      if (!found) break;
      // Jacob's criterion: back at the start and about to repeat the first
      // step, so the loop is closed. Testing the start cell alone would cut
      // it short at any one-cell isthmus; testing arrival direction alone
      // walks the whole border twice.
      if (out.length > 2 && cxi === sx && cyi === sy && nx === out[1][0] && ny === out[1][1]) {
        out.pop();
        break;
      }
      cxi = nx; cyi = ny; dir = nd;
    }
    return out.length > 8 ? out : null;
  }

  /**
   * The outline of one digit, as the border of everything it covers.
   *
   * `use: false` only when the digit renders to nothing at all. Points carry
   * screen position, the near-depth of the surface that put them there, the
   * identity of the bone that owns that surface - so the depth test can skip
   * the solid a line is the silhouette of - and a weight.
   */
  function digitSilhouette(rig, view, d, opts) {
    opts = opts || {};
    const dg = rig.digits[d];
    const segs = dg.segs.filter(sg => sg.rendered);
    if (!segs.length) return { use: false };
    const NA = opts.na || 30;
    const rings = [];
    for (const sg of segs) {
      const NS = opts.ns || 13;
      for (let i = 0; i <= NS; i++) {
        const s = sg.sMin + (sg.sMax - sg.sMin) * (i / NS);
        const row = [];
        for (let k = 0; k < NA; k++) {
          const a = (k / NA) * Math.PI * 2;
          const q = digitSurface(rig, d, sg.seg, s, a).P;
          const p = view.px(q);
          // The same two places a digit's edge is not its own edge, carried
          // on the surface itself so the border walk inherits them: the
          // thumb's metacarpal, which is thenar mass rather than a tube over
          // its proximal reach, and whatever a proximal phalanx has buried in
          // the web between it and its neighbour.
          let gn = 1;
          if (d === AN.THUMB && sg.seg === 0) gn = smoothstep(clamp01((s - 0.42) / 0.26));
          if (sg.seg === 1 && s < AN.webStart(rig.anatomy, d, a)) gn *= 0.22;
          row.push([p[0], p[1], view.near(q), gn]);
        }
        rings.push({ row, seg: sg.seg, s });
      }
    }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const r of rings) for (const p of r.row) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    if (!(x1 > x0) || !(y1 > y0)) return { use: false };
    // A cell fine enough that the border is smooth after filtering, and a
    // two-cell margin so the closing pass has room to work in.
    const cell = Math.max(0.6, Math.min(2.2, (x1 - x0 + y1 - y0) * 0.5 / 150));
    const PAD = 3;
    const W = Math.ceil((x1 - x0) / cell) + PAD * 2;
    const H = Math.ceil((y1 - y0) / cell) + PAD * 2;
    if (W < 6 || H < 6 || W * H > 4e6) return { use: false };
    const m = {
      w: W, h: H, cov: new Uint8Array(W * H),
      dep: new Float32Array(W * H), own: new Int16Array(W * H),
      gn: new Float32Array(W * H),
    };
    const gx = (px) => (px - x0) / cell + PAD, gy = (py) => (py - y0) / cell + PAD;
    for (let r = 0; r + 1 < rings.length; r++) {
      const a = rings[r], b = rings[r + 1];
      const owner = a.seg;
      for (let k = 0; k < NA; k++) {
        const k2 = (k + 1) % NA;
        const p0 = a.row[k], p1 = a.row[k2], p2 = b.row[k2], p3 = b.row[k];
        fillTri(m, gx(p0[0]), gy(p0[1]), p0[2], p0[3], gx(p1[0]), gy(p1[1]), p1[2], p1[3],
          gx(p2[0]), gy(p2[1]), p2[2], p2[3], owner);
        fillTri(m, gx(p0[0]), gy(p0[1]), p0[2], p0[3], gx(p2[0]), gy(p2[1]), p2[2], p2[3],
          gx(p3[0]), gy(p3[1]), p3[2], p3[3], owner);
      }
    }
    // Close the pinholes a quad mesh leaves along its own seams, so the walk
    // follows the outside of the digit and not the inside of a crack.
    {
      const t = new Uint8Array(m.cov);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (t[i]) continue;
        if (t[i - 1] && t[i + 1]) { m.cov[i] = 1; continue; }
        if (t[i - W] && t[i + W]) m.cov[i] = 1;
      }
    }
    const border = traceBorder(m);
    if (!border) return { use: false };
    // Back to pixels, then filtered: a walk over cells is a staircase, and a
    // staircase drawn with a pencil is a burr on every step.
    let pts = border.map(([bx, by]) => [(bx - PAD + 0.5) * cell + x0, (by - PAD + 0.5) * cell + y0]);
    // A tap for tools that want to see the construction rather than its
    // result: the coverage mask, and the staircase before it is filtered.
    // Off the hot path entirely - nothing here runs unless one is passed.
    if (opts.tap) opts.tap({ cell, x0, y0, pad: PAD, w: W, h: H, cov: m.cov, own: m.own, raw: pts.map(q => q.slice()) });
    const N = pts.length;
    for (let pass = 0; pass < (opts.smooth === undefined ? 4 : opts.smooth); pass++) {
      const src = pts;
      pts = new Array(N);
      for (let i = 0; i < N; i++) {
        const a = src[(i - 1 + N) % N], b = src[i], c = src[(i + 1) % N];
        pts[i] = [(a[0] + b[0] * 2 + c[0]) * 0.25, (a[1] + b[1] * 2 + c[1]) * 0.25];
      }
    }
    // Resample by arclength: the walk clusters points on the diagonals.
    const cum = [0];
    for (let i = 1; i <= N; i++) {
      const a = pts[i - 1], b = pts[i % N];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[N];
    if (!(total > 1)) return { use: false };
    // one point every few pixels: fine enough that a chord never shows on
    // a fingertip's curvature, coarse enough that the depth test isn't run
    // hundreds of times per digit for nothing.
    const NP = Math.max(64, Math.min(opts.n || 400, Math.round(total / 4)));
    // Two things pull the walk inside the form it is tracing: it runs on cell
    // centres, half a cell in, and every smoothing pass shortens a convex
    // curve a little more. Both are known, so push the whole loop back out
    // along its own normal rather than leaving the drawing a hair narrow.
    {
      let area = 0;
      for (let i = 0; i < N; i++) {
        const a = pts[i], b = pts[(i + 1) % N];
        area += a[0] * b[1] - b[0] * a[1];
      }
      const sgn = area > 0 ? 1 : -1;
      const off = cell * 1.15;
      const src = pts;
      pts = new Array(N);
      for (let i = 0; i < N; i++) {
        const a = src[(i - 1 + N) % N], b = src[i], c = src[(i + 1) % N];
        const tx = c[0] - a[0], ty = c[1] - a[1];
        const L = Math.hypot(tx, ty);
        if (L < 1e-9) { pts[i] = b; continue; }
        pts[i] = [b[0] + (ty / L) * off * sgn, b[1] - (tx / L) * off * sgn];
      }
    }
    const out = [];
    let j = 0;
    const sample = (px, py) => {
      const cx2 = Math.round(gx(px)), cy2 = Math.round(gy(py));
      for (let rad = 0; rad < 4; rad++) {
        for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
          if (rad > 0 && Math.abs(dx) !== rad && Math.abs(dy) !== rad) continue;
          const xx = cx2 + dx, yy = cy2 + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const i = yy * W + xx;
          if (m.cov[i]) return [m.dep[i], m.own[i], m.gn[i]];
        }
      }
      return [0, segs[0].seg, 1];
    };
    for (let i = 0; i <= NP; i++) {
      const want = (i / NP) * total;
      while (j < N && cum[j + 1] < want) j++;
      const a = pts[j % N], b = pts[(j + 1) % N];
      const seg = Math.max(1e-9, cum[j + 1] - cum[j]);
      const t = Math.max(0, Math.min(1, (want - cum[j]) / seg));
      const px = lerp(a[0], b[0], t), py = lerp(a[1], b[1], t);
      const [dz, own, gn] = sample(px, py);
      const sg = segs.find(z => z.seg === own) || segs[0];
      out.push([px, py, dz, sg.pid, gn]);
    }
    if (opts.tap) opts.tap({ final: out });
    return { use: true, outline: out, area: total };
  }


  /**
   * The first web: the commissure between thumb and index. It is a genuine
   * sheet of skin, and it is what keeps a strongly opposed thumb attached to
   * the hand — the distal thumb metacarpal really does stand clear of the
   * palm, so without the web the thumb draws as an object floating beside it.
   *
   * Returns the free margin (the edge that shows in outline), a ladder of
   * rungs across the sheet, which the rasteriser fills so the web occludes,
   * and wedgeAt — because the commissure is not that ladder's bare sheet. It
   * is a wedge of real muscle, the adductor pollicis on the palmar side and
   * the bulkier first dorsal interosseous on the dorsal, and a membrane has
   * no depth to present when the hand turns edge-on: it projects to a
   * sliver and the thumb reads as a lump laid beside the hand rather than
   * joined to it. wedgeAt(t, k, side) offsets the ladder into a palmar and
   * a dorsal face — side +1 / -1, or 0 for the bare mid-sheet the ladder
   * already describes — tapered to nothing at k=0 and k=1, where the
   * commissure simply IS the thumb's or the index's own skin, so the two
   * faces close against those surfaces without a seam.
   */
  function firstWeb(rig, view) {
    const A = rig.anatomy;
    const thPP = rig.digits[0].segs[1];
    const ixPP = rig.digits[1].segs[1];
    const ixMCP = ixPP.A, thMCP = thPP.A;

    // which way round each digit faces its neighbour
    const facingAlpha = (d, seg, sv, target) => {
      let best = 0, bestDot = -2;
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        const q = digitSurface(rig, d, seg, sv, a);
        const n = digitNormal(rig, d, seg, sv, a, q.pr, q.off);
        const dot = vdot(n, vnorm(vsub(target, q.P)));
        if (dot > bestDot) { bestDot = dot; best = a; }
      }
      return best;
    };
    const aTh = facingAlpha(0, 1, 0.30, ixMCP);
    const aIx = facingAlpha(1, 1, 0.30, thMCP);
    const aThM = facingAlpha(0, 0, 0.75, ixMCP);

    // The sheet runs from deep in the commissure out to a free margin between
    // the two digits. Deep matters: the thumb metacarpal stands some 30mm off
    // the palm's sheet, so no radial border drawn on that sheet can ever meet
    // it, and a web strung only between the two proximal phalanges leaves the
    // whole space between the rays open - which is what makes a thumb read as
    // a finger stuck on the side of the hand. So each side is a chain. The
    // thumb's climbs its metacarpal, crosses the MCP and runs onto the
    // phalanx; the index's starts on the palm's own radial border, so the two
    // solids meet with no seam, and sweeps onto the phalanx the same way.
    // Sample the pair as a ladder, one rung per step, the margin last.
    const HALF = 0.42;
    const sIxEnd = AN.webStart(A, 1, aIx) * 0.95;
    const atBorder = palmSurface(rig, 1.0, 0).P;
    const thRail = (t) => t < HALF
      ? digitSurface(rig, 0, 0, lerp(0.44, 1.0, t / HALF), aThM).P
      : digitSurface(rig, 0, 1, lerp(0, 0.38, (t - HALF) / (1 - HALF)), aTh).P;
    const ixRail = (t) => {
      if (t < HALF) return palmSurface(rig, lerp(0.42, 1.0, t / HALF), 0).P;
      const k = (t - HALF) / (1 - HALF);
      const onDigit = digitSurface(rig, 1, 1, lerp(0, sIxEnd, k), aIx).P;
      return M.vlerp(atBorder, onDigit, M.smoothstep(k));
    };
    const NR = 16;
    const thSide = [], ixSide = [];
    for (let i = 0; i <= NR; i++) {
      const t = i / NR;
      thSide.push(thRail(t));
      ixSide.push(ixRail(t));
    }
    // free margin: the distal rung, sagging back toward the palm
    const PT = thSide[NR], PI = ixSide[NR];
    const span = M.vdist(PT, PI);
    const mid = M.vlerp(PT, PI, 0.5);
    const prox = vnorm(vadd(thPP.t, ixPP.t));
    const sag = vmad(mid, prox, -span * 0.13);
    const margin = [];
    const ctrl = [PT, PT, sag, PI, PI];
    for (let i = 0; i <= 30; i++) {
      const q = M.splineAt(ctrl, 1 + (i / 30) * 2);
      const p = view.px(q);
      margin.push([p[0], p[1], view.near(q), rig.palm.pid, 1]);
    }

    // ---- the wedge: real thickness, not a membrane ------------------------
    // A normal per rung, not one normal for the whole sheet: deep in the
    // commissure the wedge lies nearly flat against the palm, and by the
    // margin it has rolled out to stand between the two phalanges, so a
    // single normal borrowed from one end points the bulge the wrong way
    // over most of the other. Central differences on the rung midline give
    // the along-sheet tangent; the ladder's own width gives the across one.
    const spine = thSide.map((p, i) => M.vlerp(p, ixSide[i], 0.5));
    const rungNormal = thSide.map((p, i) => {
      const i0 = Math.max(0, i - 1), i1 = Math.min(NR, i + 1);
      const along = vsub(spine[i1], spine[i0]);
      const across = vsub(ixSide[i], thSide[i]);
      let n = vnorm(vcross(across, along));
      if (vdot(n, rig.root[2]) < 0) n = vmul(n, -1);   // palmar-positive
      return n;
    });
    const S = A.size, pad = A.palm.padding;
    // Roughly 8-12mm through at the depth of the commissure, tapering to
    // 2-4mm at the free margin; the interosseous outbulks the adductor, so
    // the dorsal face carries the larger share throughout.
    const throughAt = (t) => lerp(12.0, 3.5, smoothstep(clamp01(t))) * S * pad;
    const bow = (t, k) => t * Math.sin(Math.PI * k) * 0.18;
    /** a point on the wedge: t 0(deep)..1(margin), k 0(thumb)..1(index) flank, side -1 dorsal / 0 mid-sheet / +1 palmar */
    const wedgeAt = (t, k, side) => {
      t = clamp01(t); k = clamp01(k);
      const fi = t * NR;
      const i = Math.min(NR - 1, Math.floor(fi)), fr = fi - i;
      const a = M.vlerp(thSide[i], thSide[i + 1], fr), b = M.vlerp(ixSide[i], ixSide[i + 1], fr);
      const P = vmad(M.vlerp(a, b, k), prox, -M.vdist(a, b) * bow(t, k));
      if (!side) return P;
      // the taper that closes the wedge against the thumb's and the index's
      // own skin at k=0 and k=1 - without it the faces poke past surfaces
      // already modelled elsewhere and the join shows as a seam
      const taper = Math.sin(Math.PI * k);
      const through = throughAt(t) * taper;
      const n = M.vlerp(rungNormal[i], rungNormal[i + 1], fr);
      return vmad(P, n, side > 0 ? through * 0.42 : -through * 0.58);
    };
    // The wedge's own outline: a closed loop around its boundary, not a
    // search over its surface. Two of that boundary's four sides are
    // already known and already flat - thSide and ixSide, k=0 and k=1,
    // where the taper closes the wedge seamlessly against the thumb's and
    // the index's own skin - so only the other two, the free-standing ends
    // at t=0 and t=1, need a face chosen for them. Each end sweeps k with
    // whichever of the palmar or dorsal point is nearer the eye, blended
    // rather than switched so the loop never jumps as a view carries the
    // choice past its crossover. The t=1 end is the free margin and bulges
    // 2-4mm; the t=0 end is the depth of the commissure and bulges the
    // most, 8-12mm, which is the width this loop is chiefly for: a
    // membrane has nothing to show there at all.
    const NK_CAP = 16, EDGE_SOFT = 1.5;
    const capAt = (t) => {
      const pts = [];
      for (let j = 0; j <= NK_CAP; j++) {
        const k = j / NK_CAP;
        const qP = wedgeAt(t, k, 1), qD = wedgeAt(t, k, -1);
        const bl = smoothstep(clamp01((view.near(qP) - view.near(qD)) / EDGE_SOFT + 0.5));
        const q = M.vlerp(qD, qP, bl);
        const p = view.px(q);
        pts.push([p[0], p[1], view.near(q), rig.palm.pid, 1]);
      }
      return pts;
    };
    const flat = (rail) => rail.map((q) => {
      const p = view.px(q);
      return [p[0], p[1], view.near(q), rig.palm.pid, 1];
    });
    const band = flat(thSide).concat(capAt(1), flat(ixSide.slice().reverse()), capAt(0).reverse());
    return { thSide, ixSide, margin, PT, PI, sag, wedgeAt, band };
  }

  GK.rig = {
    FLEX, ABD, TWIST, IDENT, View, solve, abdGate,
    palmSpine, palmSurface, palmNormal, palmThickPalmar, palmThickDorsal, palmWrap,
    digitSurface, digitNormal, sectionCenter, softContact, knuckleRings, digitSilhouette, palmContour, palmSilhouette, webContours, firstWeb,
    PALM_NU, V_KNOTS
  };
})(window.GK = window.GK || {});

/* ============================================================================
   GRAPHITE KINEMATICS — 30 · pose
   The manifold of reachable hands. Every pose is expressed in normalised
   units (-1 = full extension, +1 = full flexion) and converted through the
   measured joint envelopes, so no sample can ever leave the possible.
   ========================================================================== */
(function (GK) {
  'use strict';
  const M = GK.math;
  const AN = GK.anatomy;
  const { DEG, clamp, clamp01, lerp, smoothstep, Rng } = M;

  const FINGERS = [1, 2, 3, 4];

  /** normalised -1..1 -> radians, using the separate flexion/extension limits */
  function nr(lim, x, key) {
    const flex = (lim[key] || 0) * DEG;
    const ext = (lim[(key === 'flex' ? 'ext' : key === 'abd' ? 'add' : 'ext')] || 0) * DEG;
    return x >= 0 ? x * flex : x * ext;
  }
  function sym(limDeg, x) { return x * limDeg * DEG; }

  // ------------------------------------------------------------ empty pose
  function blank() {
    return {
      wrist: { flex: 0, dev: 0, pron: 0 },
      arch: 0,
      digits: [
        { cmcRad: 0, cmcAbd: 0, cmcOpp: 0, mcpFlex: 0, mcpAbd: 0, ipFlex: 0 },
        { cmcFlex: 0, mcpFlex: 0, mcpAbd: 0, pipFlex: 0, dipFlex: 0 },
        { cmcFlex: 0, mcpFlex: 0, mcpAbd: 0, pipFlex: 0, dipFlex: 0 },
        { cmcFlex: 0, mcpFlex: 0, mcpAbd: 0, pipFlex: 0, dipFlex: 0 },
        { cmcFlex: 0, mcpFlex: 0, mcpAbd: 0, pipFlex: 0, dipFlex: 0 }
      ]
    };
  }

  /**
   * Build a pose from a compact normalised spec.
   *   wrist   [flex, dev, pron]      -1..1
   *   arch    0..1
   *   thumb   [cmcRad, cmcAbd, cmcOpp, mcp, ip]
   *   f       [[mcp, pip, dip, abd], x4]   index..little
   */
  function mk(A, spec) {
    const L = A.limits;
    const p = blank();
    const w = spec.wrist || [0, 0, 0];
    p.wrist.flex = w[0] >= 0 ? w[0] * L.wrist.flex * DEG : w[0] * L.wrist.ext * DEG;
    p.wrist.dev = w[1] >= 0 ? w[1] * L.wrist.ulnar * DEG : w[1] * L.wrist.radial * DEG;
    p.wrist.pron = sym(L.wrist.pron, w[2] || 0);
    p.arch = clamp01(spec.arch || 0);

    const t = spec.thumb || [0, 0, 0, 0, 0];
    const TL = L.digits[0];
    p.digits[0].cmcRad = t[0] >= 0 ? t[0] * TL.cmc.flex * DEG : t[0] * TL.cmc.ext * DEG;
    p.digits[0].cmcAbd = t[1] >= 0 ? t[1] * TL.cmc.abd * DEG : t[1] * TL.cmc.add * DEG;
    p.digits[0].cmcOpp = t[2] >= 0 ? t[2] * TL.cmc.opp * DEG : t[2] * TL.cmc.rep * DEG;
    p.digits[0].mcpFlex = t[3] >= 0 ? t[3] * TL.mcp.flex * DEG : t[3] * TL.mcp.ext * DEG;
    p.digits[0].ipFlex = t[4] >= 0 ? t[4] * TL.ip.flex * DEG : t[4] * TL.ip.ext * DEG;

    const f = spec.f || [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    for (let i = 0; i < 4; i++) {
      const d = i + 1, DL = L.digits[d], v = f[i] || [0, 0, 0, 0];
      p.digits[d].mcpFlex = v[0] >= 0 ? v[0] * DL.mcp.flex * DEG : v[0] * DL.mcp.ext * DEG;
      p.digits[d].pipFlex = v[1] >= 0 ? v[1] * DL.pip.flex * DEG : v[1] * DL.pip.ext * DEG;
      p.digits[d].dipFlex = v[2] >= 0 ? v[2] * DL.dip.flex * DEG : v[2] * DL.dip.ext * DEG;
      // abduction is signed away from the middle finger
      const away = d === 1 ? -1 : d === 2 ? -0.35 : d === 3 ? 0.55 : 1;
      p.digits[d].mcpAbd = (v[3] || 0) * DL.mcp.abd * DEG * away;
      p.digits[d].cmcFlex = 0;
    }
    return p;
  }

  /**
   * The inverse of mk(): recover the normalised spec from a pose in radians,
   * so a pose arrived at any way at all can be handed back to the sliders.
   */
  function specOf(A, pose) {
    const L = A.limits;
    const un = (v, flexDeg, extDeg) => {
      if (v >= 0) return flexDeg > 0 ? clamp(v / (flexDeg * DEG), -1, 1) : 0;
      return extDeg > 0 ? clamp(v / (extDeg * DEG), -1, 1) : 0;
    };
    const spec = { wrist: [], arch: clamp01(pose.arch || 0), thumb: [], f: [] };
    spec.wrist[0] = un(pose.wrist.flex, L.wrist.flex, L.wrist.ext);
    spec.wrist[1] = un(pose.wrist.dev, L.wrist.ulnar, L.wrist.radial);
    spec.wrist[2] = clamp(pose.wrist.pron / (L.wrist.pron * DEG), -1, 1);
    const T = pose.digits[0], TL = L.digits[0];
    spec.thumb = [
      un(T.cmcRad, TL.cmc.flex, TL.cmc.ext),
      un(T.cmcAbd, TL.cmc.abd, TL.cmc.add),
      un(T.cmcOpp, TL.cmc.opp, TL.cmc.rep),
      un(T.mcpFlex, TL.mcp.flex, TL.mcp.ext),
      un(T.ipFlex, TL.ip.flex, TL.ip.ext)
    ];
    for (let d = 1; d < 5; d++) {
      const v = pose.digits[d], DL = L.digits[d];
      const away = d === 1 ? -1 : d === 2 ? -0.35 : d === 3 ? 0.55 : 1;
      // abduction is gated by flexion on the way in; undo that first
      const gate = 1 - 0.88 * smoothstep(clamp01(Math.max(0, v.mcpFlex) / (78 * DEG)));
      spec.f.push([
        un(v.mcpFlex, DL.mcp.flex, DL.mcp.ext),
        un(v.pipFlex, DL.pip.flex, DL.pip.ext),
        un(v.dipFlex, DL.dip.flex, DL.dip.ext),
        clamp(v.mcpAbd / (DL.mcp.abd * DEG * away * (gate > 0.05 ? 1 : 1)), -1, 1)
      ]);
    }
    return spec;
  }

  /** hard-clamp any pose back inside the envelope */
  function clampPose(A, pose) {
    const L = A.limits;
    const p = JSON.parse(JSON.stringify(pose));
    p.wrist.flex = clamp(p.wrist.flex, -L.wrist.ext * DEG, L.wrist.flex * DEG);
    p.wrist.dev = clamp(p.wrist.dev, -L.wrist.radial * DEG, L.wrist.ulnar * DEG);
    p.wrist.pron = clamp(p.wrist.pron, -L.wrist.sup * DEG, L.wrist.pron * DEG);
    p.arch = clamp01(p.arch);
    const T = p.digits[0], TL = L.digits[0];
    T.cmcRad = clamp(T.cmcRad, -TL.cmc.ext * DEG, TL.cmc.flex * DEG);
    T.cmcAbd = clamp(T.cmcAbd, -TL.cmc.add * DEG, TL.cmc.abd * DEG);
    T.cmcOpp = clamp(T.cmcOpp, -TL.cmc.rep * DEG, TL.cmc.opp * DEG);
    T.mcpFlex = clamp(T.mcpFlex, -TL.mcp.ext * DEG, TL.mcp.flex * DEG);
    T.ipFlex = clamp(T.ipFlex, -TL.ip.ext * DEG, TL.ip.flex * DEG);
    for (let d = 1; d < 5; d++) {
      const v = p.digits[d], DL = L.digits[d];
      v.mcpFlex = clamp(v.mcpFlex, -DL.mcp.ext * DEG, DL.mcp.flex * DEG);
      v.pipFlex = clamp(v.pipFlex, -DL.pip.ext * DEG, DL.pip.flex * DEG);
      v.dipFlex = clamp(v.dipFlex, -DL.dip.ext * DEG, DL.dip.flex * DEG);
      v.mcpAbd = clamp(v.mcpAbd, -DL.mcp.abd * DEG, DL.mcp.abd * DEG);
      // the proximal interphalangeal joint cannot fully close against a
      // hyperextended knuckle: the long flexors run out of excursion
      const hyper = clamp01(-v.mcpFlex / (30 * DEG));
      v.pipFlex = Math.min(v.pipFlex, DL.pip.flex * DEG * (1 - 0.20 * hyper));
    }
    return p;
  }

  // =========================================================================
  //  PRESETS
  // =========================================================================
  const PRESETS = {
    'rest': {
      label: 'At rest',
      spec: {
        wrist: [0.06, 0.06, 0], arch: 0.28, thumb: [0.16, 0.20, 0.18, 0.16, 0.12],
        f: [[0.20, 0.36, 0.26, 0.10], [0.23, 0.42, 0.30, 0.02], [0.26, 0.47, 0.33, -0.05], [0.30, 0.52, 0.36, 0.10]]
      }
    },
    'flat': {
      label: 'Flat',
      spec: { wrist: [0, 0, 0], arch: 0.02, thumb: [-0.25, 0.14, 0.05, 0, 0], f: [[0, 0, 0, 0.18], [0, 0, 0, 0.05], [0, 0, 0, 0.05], [0, 0, 0, 0.22]] }
    },
    'spread': {
      label: 'Spread',
      spec: { wrist: [-0.10, 0, 0], arch: 0, thumb: [-0.90, 0.22, -0.15, -0.20, -0.25], f: [[-0.15, -0.4, -0.5, 1], [-0.12, -0.4, -0.5, 1], [-0.12, -0.4, -0.5, 1], [-0.15, -0.4, -0.5, 1]] }
    },
    'fist': {
      label: 'Fist',
      spec: {
        wrist: [0.05, 0.10, 0], arch: 0.55, thumb: [0.66, 0.14, 0.50, 0.62, 0.52],
        f: [[0.94, 0.96, 0.78, -0.15], [0.96, 0.98, 0.80, -0.05], [0.96, 0.98, 0.80, 0.05], [0.96, 0.98, 0.80, 0.15]]
      }
    },
    'grip': {
      label: 'Cylinder grip',
      spec: {
        wrist: [0.02, 0.08, 0], arch: 0.48, thumb: [0.57, 0.00, 0.54, 0.61, 0.76],
        f: [[0.60, 0.66, 0.44, -0.10], [0.63, 0.70, 0.47, 0], [0.66, 0.73, 0.49, 0.05], [0.70, 0.76, 0.51, 0.12]]
      }
    },
    // The thumb chains below were fitted by inverse kinematics: the pads are
    // brought into contact and each is turned to face the other, then pulled
    // back toward the gesture that was asked for.
    'pinch': {
      label: 'Pinch',
      spec: {
        wrist: [0, 0, 0], arch: 0.36, thumb: [0.54, 0.50, 0.94, 0.32, 0.20],
        f: [[0.57, 0.45, -0.01, -0.56], [0.62, 0.70, 0.48, 0], [0.72, 0.82, 0.56, 0.05], [0.78, 0.86, 0.58, 0.10]]
      }
    },
    'ok': {
      label: 'OK',
      spec: {
        wrist: [-0.05, 0, 0], arch: 0.22, thumb: [0.50, 0.47, 0.87, 0.32, 0.20],
        f: [[0.57, 0.43, -0.02, -0.64], [-0.10, -0.15, -0.25, 0.30], [-0.10, -0.20, -0.30, 0.35], [-0.05, -0.20, -0.30, 0.55]]
      }
    },
    'point': {
      label: 'Point',
      spec: {
        wrist: [0, -0.10, 0], arch: 0.40, thumb: [0.34, 0.16, 0.30, 0.44, 0.20],
        f: [[-0.12, -0.10, -0.20, -0.15], [0.94, 0.97, 0.76, 0], [0.94, 0.97, 0.76, 0.05], [0.92, 0.96, 0.74, 0.10]]
      }
    },
    'peace': {
      label: 'Two',
      spec: {
        wrist: [-0.05, 0, 0], arch: 0.34, thumb: [0.44, 0.14, 0.36, 0.52, 0.34],
        f: [[-0.10, -0.10, -0.20, 0.85], [-0.08, -0.10, -0.20, 0.85], [0.92, 0.96, 0.74, 0], [0.92, 0.96, 0.74, 0.10]]
      }
    },
    'thumbsUp': {
      label: 'Thumb up',
      spec: {
        wrist: [0, 0.12, -0.35], arch: 0.52, thumb: [0.40, -0.05, -0.35, -0.20, -0.30],
        f: [[0.94, 0.97, 0.78, -0.10], [0.95, 0.98, 0.79, 0], [0.95, 0.98, 0.79, 0.05], [0.95, 0.98, 0.79, 0.10]]
      }
    },
    'claw': {
      label: 'Claw',
      spec: {
        wrist: [-0.20, 0, 0], arch: 0.30, thumb: [-0.45, 0.32, 0.18, -0.05, 0.55],
        f: [[-0.34, 0.86, 0.68, 0.55], [-0.32, 0.88, 0.70, 0.20], [-0.32, 0.88, 0.70, 0.25], [-0.34, 0.86, 0.68, 0.60]]
      }
    },
    'cup': {
      label: 'Cup',
      spec: {
        wrist: [0.10, 0, 0], arch: 0.78, thumb: [0.35, 0.30, 0.50, 0.28, 0.12],
        f: [[0.30, 0.34, 0.22, -0.45], [0.32, 0.36, 0.24, -0.20], [0.34, 0.40, 0.26, -0.20], [0.38, 0.46, 0.30, -0.40]]
      }
    },
    'tripod': {
      label: 'Writing grip',
      spec: {
        wrist: [0.06, 0.14, 0], arch: 0.46, thumb: [0.57, 0.53, 0.75, 0.32, 0.20],
        f: [[0.44, 0.40, 0.20, -0.20], [0.67, 0.41, -0.01, 0.13], [0.72, 0.84, 0.56, 0.10], [0.80, 0.90, 0.60, 0.18]]
      }
    },
    'hook': {
      label: 'Hook',
      spec: {
        wrist: [-0.10, 0, 0], arch: 0.30, thumb: [-0.62, 0.24, 0.00, -0.10, -0.20],
        f: [[0.05, 0.94, 0.80, -0.05], [0.05, 0.96, 0.82, 0], [0.05, 0.96, 0.82, 0.05], [0.05, 0.94, 0.80, 0.10]]
      }
    },
    'wave': {
      label: 'Open, palm out',
      spec: {
        wrist: [-0.35, 0, 1.0], arch: 0.10, thumb: [-0.78, 0.30, -0.05, -0.10, -0.15],
        f: [[-0.20, -0.10, -0.20, 0.55], [-0.18, -0.10, -0.20, 0.20], [-0.18, -0.10, -0.20, 0.25], [-0.20, -0.10, -0.20, 0.60]]
      }
    },
    'countThree': {
      label: 'Three',
      spec: {
        wrist: [0, 0, 0], arch: 0.30, thumb: [-0.55, 0.10, 0.05, -0.20, -0.30],
        f: [[-0.10, -0.10, -0.20, 0.70], [-0.08, -0.10, -0.20, 0.30], [0.90, 0.95, 0.72, 0.05], [0.92, 0.96, 0.74, 0.10]]
      }
    },
    'hyperextend': {
      label: 'Hyperextended',
      spec: {
        wrist: [-0.60, 0, 0], arch: 0, thumb: [-0.95, 0.30, -0.85, -0.60, -0.90],
        f: [[-0.95, -0.9, -0.95, 0.45], [-0.95, -0.9, -0.95, 0.15], [-0.95, -0.9, -0.95, 0.20], [-0.95, -0.9, -0.95, 0.50]]
      }
    },
    'clenchMax': {
      label: 'Full flexion',
      spec: {
        wrist: [0.55, 0.20, 0], arch: 0.85, thumb: [0.70, 0.05, 0.62, 0.85, 0.75],
        f: [[1, 1, 1, -0.2], [1, 1, 1, -0.05], [1, 1, 1, 0.05], [1, 1, 1, 0.2]]
      }
    }
  };
  const PRESET_KEYS = Object.keys(PRESETS);

  function preset(A, key) {
    const P = PRESETS[key] || PRESETS.rest;
    return clampPose(A, mk(A, P.spec));
  }

  // =========================================================================
  //  COUPLING — the tendons the fingers share
  // =========================================================================
  function couple(A, spec, amount) {
    amount = amount === undefined ? 1 : amount;
    const f = spec.f;
    const out = f.map(v => v.slice());
    // juncturae tendinum: neighbouring knuckles are dragged along
    const K = [[0, 1, 0.10], [1, 0, 0.10], [1, 2, 0.20], [2, 1, 0.20], [2, 3, 0.30], [3, 2, 0.34]];
    for (const [a, b, k] of K) out[a][0] += (f[b][0] - f[a][0]) * k * amount;
    // the two-thirds rule: the distal joint follows the middle one
    for (let i = 0; i < 4; i++) {
      out[i][2] = lerp(out[i][2], out[i][1] * 0.66, 0.72 * amount);
    }
    // quadriga: the little finger cannot lag far behind the ring
    out[3][1] = lerp(out[3][1], Math.max(out[3][1], out[2][1] * 0.82), 0.5 * amount);
    // spreading closes down as the knuckles flex
    for (let i = 0; i < 4; i++) out[i][3] *= 1 - 0.55 * clamp01(out[i][0]) * amount;
    return out;
  }

  // =========================================================================
  //  GENERATIVE SAMPLING
  //  entropy 0 -> a named intention, barely perturbed
  //  entropy 1 -> a free walk of the manifold
  // =========================================================================
  function generate(A, seed, entropy) {
    const rng = new Rng(seed);
    entropy = clamp01(entropy === undefined ? 0.55 : entropy);

    // ---- an intention to depart from --------------------------------------
    const key = rng.pick(PRESET_KEYS);
    const base = PRESETS[key].spec;
    const jitter = 0.12 + 0.55 * entropy;

    // ---- a free sample of the manifold ------------------------------------
    const curl = rng.f();                       // how closed the hand is
    const splay = rng.gaussIn(0.2, 0.5, -1, 1); // how spread
    const cascade = rng.range(-0.25, 0.45);     // ulnar-ward increase in curl
    const free = { wrist: [], arch: 0, thumb: [], f: [] };
    free.wrist = [
      rng.gaussIn(0, 0.34, -0.9, 0.9),
      rng.gaussIn(0.05, 0.3, -0.9, 0.9),
      rng.gaussIn(0, 0.55, -1, 1)
    ];
    free.arch = clamp01(curl * 0.6 + rng.gaussIn(0.15, 0.25, -0.3, 0.8));
    free.thumb = [
      rng.gaussIn(curl * 0.55 - 0.1, 0.42, -1, 1),
      rng.gaussIn(0.35 - curl * 0.25, 0.32, -0.2, 1),
      rng.gaussIn(curl * 0.5, 0.35, -0.6, 1),
      rng.gaussIn(curl * 0.6, 0.3, -0.6, 1),
      rng.gaussIn(curl * 0.55, 0.32, -0.9, 1)
    ];
    for (let i = 0; i < 4; i++) {
      const local = clamp(curl + cascade * (i / 3 - 0.5) * 2 + rng.gaussIn(0, 0.18 * (0.4 + entropy), -0.6, 0.6), -0.9, 1);
      const mcp = clamp(local * 0.92 + rng.gaussIn(0, 0.13, -0.4, 0.4), -0.95, 1);
      const pip = clamp(local * 1.04 + rng.gaussIn(0.03, 0.15, -0.4, 0.4), -0.9, 1);
      const dip = clamp(pip * 0.66 + rng.gaussIn(0, 0.12, -0.35, 0.35), -0.95, 1);
      const away = clamp(splay + rng.gaussIn(0, 0.28, -0.7, 0.7), -1, 1);
      free.f.push([mcp, pip, dip, away]);
    }

    // ---- blend intention with freedom -------------------------------------
    const w = entropy;
    const spec = {
      wrist: (base.wrist || [0, 0, 0]).map((v, i) => lerp(v, free.wrist[i], w) + rng.sym(0.06 * jitter)),
      arch: lerp(base.arch || 0, free.arch, w) + rng.sym(0.08 * jitter),
      thumb: (base.thumb || [0, 0, 0, 0, 0]).map((v, i) => lerp(v, free.thumb[i], w) + rng.sym(0.10 * jitter)),
      f: (base.f || [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]])
        .map((v, i) => v.map((x, j) => lerp(x, free.f[i][j], w) + rng.sym(0.09 * jitter)))
    };
    spec.f = couple(A, spec, 0.55 + 0.45 * (1 - entropy));
    for (let i = 0; i < 3; i++) spec.wrist[i] = clamp(spec.wrist[i], -1, 1);
    for (let i = 0; i < 5; i++) spec.thumb[i] = clamp(spec.thumb[i], -1, 1);
    spec.arch = clamp01(spec.arch);
    spec.f = spec.f.map(v => v.map(x => clamp(x, -1, 1)));
    const p = clampPose(A, mk(A, spec));
    p.intent = key;
    p.spec = spec;
    return p;
  }

  // =========================================================================
  //  INTERPOLATION & ANIMATION
  // =========================================================================
  function lerpPose(a, b, t) {
    const e = M.ease.inOut(clamp01(t));
    const p = blank();
    p.wrist.flex = lerp(a.wrist.flex, b.wrist.flex, e);
    p.wrist.dev = lerp(a.wrist.dev, b.wrist.dev, e);
    p.wrist.pron = lerp(a.wrist.pron, b.wrist.pron, e);
    p.arch = lerp(a.arch, b.arch, e);
    for (let d = 0; d < 5; d++) {
      const A0 = a.digits[d], B0 = b.digits[d], P = p.digits[d];
      for (const k in P) if (typeof P[k] === 'number') P[k] = lerp(A0[k] || 0, B0[k] || 0, e);
    }
    return p;
  }

  /** the full degree-of-freedom inventory, in the order a tour visits them */
  function dofList(A) {
    const L = A.limits;
    const out = [
      { path: ['wrist', 'flex'], label: 'wrist flexion / extension', lo: -L.wrist.ext, hi: L.wrist.flex },
      { path: ['wrist', 'dev'], label: 'wrist radial / ulnar deviation', lo: -L.wrist.radial, hi: L.wrist.ulnar },
      { path: ['wrist', 'pron'], label: 'forearm pronation / supination', lo: -L.wrist.sup, hi: L.wrist.pron },
      { path: ['arch'], label: 'transverse metacarpal arch', lo: 0, hi: 1, unit: '' },
      { path: ['digits', 0, 'cmcRad'], label: 'thumb CMC flexion / extension', lo: -L.digits[0].cmc.ext, hi: L.digits[0].cmc.flex },
      { path: ['digits', 0, 'cmcAbd'], label: 'thumb CMC palmar abduction', lo: -L.digits[0].cmc.add, hi: L.digits[0].cmc.abd },
      { path: ['digits', 0, 'cmcOpp'], label: 'thumb opposition', lo: -L.digits[0].cmc.rep, hi: L.digits[0].cmc.opp },
      { path: ['digits', 0, 'mcpFlex'], label: 'thumb MCP flexion', lo: -L.digits[0].mcp.ext, hi: L.digits[0].mcp.flex },
      { path: ['digits', 0, 'ipFlex'], label: 'thumb IP flexion', lo: -L.digits[0].ip.ext, hi: L.digits[0].ip.flex }
    ];
    const names = ['', 'index', 'middle', 'ring', 'little'];
    for (let d = 1; d < 5; d++) {
      const DL = L.digits[d];
      out.push({ path: ['digits', d, 'mcpFlex'], label: names[d] + ' MCP flexion', lo: -DL.mcp.ext, hi: DL.mcp.flex });
      out.push({ path: ['digits', d, 'mcpAbd'], label: names[d] + ' MCP abduction', lo: -DL.mcp.abd, hi: DL.mcp.abd });
      out.push({ path: ['digits', d, 'pipFlex'], label: names[d] + ' PIP flexion', lo: -DL.pip.ext, hi: DL.pip.flex });
      out.push({ path: ['digits', d, 'dipFlex'], label: names[d] + ' DIP flexion', lo: -DL.dip.ext, hi: DL.dip.flex });
    }
    return out;
  }

  const getPath = (o, path) => path.reduce((a, k) => a[k], o);
  const setPath = (o, path, v) => { let a = o; for (let i = 0; i < path.length - 1; i++) a = a[path[i]]; a[path[path.length - 1]] = v; };

  /**
   * A tour of the whole range of motion: each degree of freedom in turn is
   * carried from one end of its envelope to the other and back, against a
   * resting hand.
   */
  function romTour(A, t, basePose) {
    const dofs = dofList(A);
    const base = basePose || preset(A, 'rest');
    const n = dofs.length;
    const ft = (t % 1 + 1) % 1;
    const idx = Math.floor(ft * n);
    const local = ft * n - idx;
    const dof = dofs[idx];
    const p = JSON.parse(JSON.stringify(base));
    // ease out to the extremes and back through the rest value
    const tri = local < 0.5 ? local * 2 : (1 - local) * 2;
    const phase = local < 0.5 ? 1 : -1;
    const amt = M.ease.inOut(tri);
    const target = (phase > 0 ? dof.hi : dof.lo) * (dof.unit === '' ? 1 : DEG);
    const cur = getPath(p, dof.path);
    setPath(p, dof.path, lerp(cur, target, amt));
    const out = clampPose(A, p);
    out.active = dof;
    out.activeValue = getPath(out, dof.path);
    out.tourIndex = idx; out.tourCount = n;
    return out;
  }

  /** a small idle motion, so a still hand is never quite still */
  function breathe(A, pose, t, amount) {
    if (!amount) return pose;
    const n = new M.Noise(A.seed ^ 0x9911);
    const p = JSON.parse(JSON.stringify(pose));
    const k = amount * 0.055;
    p.wrist.flex += (n.n1(t * 0.31) - 0.5) * k * 2;
    p.wrist.dev += (n.n1(t * 0.27 + 8) - 0.5) * k * 1.4;
    for (let d = 0; d < 5; d++) {
      const P = p.digits[d];
      const o = d * 13.7;
      if (d === 0) {
        P.cmcRad += (n.n1(t * 0.33 + o) - 0.5) * k * 1.6;
        P.mcpFlex += (n.n1(t * 0.41 + o + 3) - 0.5) * k * 1.2;
        P.ipFlex += (n.n1(t * 0.37 + o + 6) - 0.5) * k * 1.2;
      } else {
        P.mcpFlex += (n.n1(t * 0.29 + o) - 0.5) * k * 1.5;
        P.pipFlex += (n.n1(t * 0.35 + o + 4) - 0.5) * k * 1.8;
        P.dipFlex += (n.n1(t * 0.39 + o + 9) - 0.5) * k * 1.3;
        P.mcpAbd += (n.n1(t * 0.23 + o + 12) - 0.5) * k * 0.8;
      }
    }
    return clampPose(A, p);
  }

  /** human-readable angle table, for the annotation layer */
  function readout(A, pose) {
    const rows = [];
    const R = (x) => Math.round(x / DEG);
    rows.push(['wrist', 'flex ' + R(pose.wrist.flex) + '°  dev ' + R(pose.wrist.dev) + '°  pron ' + R(pose.wrist.pron) + '°']);
    rows.push(['thumb', 'CMC ' + R(pose.digits[0].cmcRad) + '/' + R(pose.digits[0].cmcAbd) + '/' + R(pose.digits[0].cmcOpp) +
      '  MCP ' + R(pose.digits[0].mcpFlex) + '  IP ' + R(pose.digits[0].ipFlex)]);
    const names = ['', 'index', 'middle', 'ring', 'little'];
    for (let d = 1; d < 5; d++) {
      const p = pose.digits[d];
      rows.push([names[d], 'MCP ' + R(p.mcpFlex) + '° (' + (p.mcpAbd >= 0 ? '+' : '') + R(p.mcpAbd) +
        ')  PIP ' + R(p.pipFlex) + '°  DIP ' + R(p.dipFlex) + '°']);
    }
    return rows;
  }


  // =========================================================================
  //  CONTACT
  //  A hand is not a linkage in free space: fingers meet each other and meet
  //  the palm, and where they meet, they stop. Without this a fist drives its
  //  fingertips ten millimetres through its own palm and the thumb passes
  //  clean through the index — the mechanism is right and the hand is
  //  impossible.
  //
  //  Contacts are resolved by a damped Jacobian-transpose relaxation: each
  //  penetration asks the joints proximal to it how much moving them would
  //  separate the pair, and every joint gives a share proportional to how much
  //  good it can do. Distal joints are weighted higher, because a hand meeting
  //  an obstruction gives at its fingertips before it gives at its knuckles.
  // =========================================================================

  /** the adjustable degrees of freedom of one digit, proximal to distal */
  function jointDofs(rig, pose, d) {
    const dg = rig.digits[d];
    const out = [];
    const push = (seg, j, axis, w, add) => {
      if (!axis) return;
      out.push({ seg, axis, O: j.P, w, add });
    };
    if (d === 0) {
      const c = dg.joints[0], m = dg.joints[1], i = dg.joints[2];
      push(0, c, c.axA, 0.55, x => pose.digits[0].cmcRad += x);
      push(0, c, c.axF, 0.55, x => pose.digits[0].cmcAbd += x);
      push(0, c, c.axT, 0.35, x => pose.digits[0].cmcOpp -= x);
      push(1, m, m.axF, 1.5, x => pose.digits[0].mcpFlex += x);
      push(2, i, i.axF, 2.4, x => pose.digits[0].ipFlex += x);
    } else {
      const m = dg.joints[1], pp = dg.joints[2], dd = dg.joints[3];
      // Splay is the stiffest thing a hand has: fingers pressed together stay
      // together and give at the joints instead. Letting abduction take the
      // correction turns every closed pose into a splayed one.
      push(1, m, m.axA, 0.035, x => pose.digits[d].mcpAbd += x / (m.abdScale || 1));
      push(1, m, m.axF, 0.55, x => pose.digits[d].mcpFlex += x);
      push(2, pp, pp.axF, 1.5, x => pose.digits[d].pipFlex += x);
      push(3, dd, dd.axF, 2.6, x => pose.digits[d].dipFlex += x);
    }
    return out;
  }

  /** coarse palmar surface samples: spine point, outward normal, thickness */
  function palmSamples(rig) {
    const R = GK.rig, A = rig.anatomy;
    const out = [];
    for (let i = 0; i <= 13; i++) {
      const u = lerp(-0.02, 1.01, i / 13);
      const lo = rig.palm.vLo(u), hi = rig.palm.vHi(u);
      // The thumb-side border now swings out to track the thumb itself (see
      // rig.js vLo), so its span is no longer fixed - a thumb pulled well
      // clear widens it a lot. Sample count has to keep pace or the far
      // (ulnar) side of the same fixed budget gets too sparse to hold the
      // little finger in contact resolution.
      const NJ = Math.max(9, Math.round(9 * (hi - lo) / 1.5));
      for (let j = 0; j <= NJ; j++) {
        const v = lerp(lo + 0.06, hi - 0.06, j / NJ);
        const sp = R.palmSpine(rig, u, v);
        // the palm's pad compresses under a fingertip; it is not a wall
        out.push({ P: sp.P, n: sp.n, t: R.palmThickPalmar(A, u, v) * 0.82 });
      }
    }
    return out;
  }

  function gatherContacts(A, rig, tol, scene) {
    const AN2 = GK.anatomy;
    const segs = [];
    for (let d = 0; d < 5; d++) {
      for (const sg of rig.digits[d].segs) {
        if (!sg.rendered) continue;
        const r = (AN2.segmentProfile(A, d, sg.seg, 0.2)[0] + AN2.segmentProfile(A, d, sg.seg, 0.8)[0]) * 0.5;
        segs.push({ d, seg: sg.seg, A: sg.A, B: sg.B, r, sg });
      }
    }
    const cs = [];
    // digit against digit
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = segs[i], b = segs[j];
        if (a.d === b.d && Math.abs(a.seg - b.seg) <= 1) continue;
        if (a.d === 0 && b.d === 0) continue;
        const cc = M.closestSeg(a.A, a.B, b.A, b.B);
        // soft tissue may flatten a little where two digits press together
        const sameRow = a.d > 0 && b.d > 0;
        const pen = (a.r + b.r) * (sameRow ? 0.76 : 0.84) - cc.d;
        if (pen <= tol) continue;
        const n = M.vnorm(M.vsub(cc.P1, cc.P2));
        if (!isFinite(n[0])) continue;
        cs.push({ d: a.d, seg: a.seg, P: cc.P1, n, depth: pen * 0.5 });
        cs.push({ d: b.d, seg: b.seg, P: cc.P2, n: M.vmul(n, -1), depth: pen * 0.5 });
      }
    }
    // digit against palm
    const ps = palmSamples(rig);
    for (let d = 0; d < 5; d++) {
      const dg = rig.digits[d];
      const n0 = dg.segs.length;
      for (const sg of dg.segs) {
        if (!sg.rendered || sg.seg < (d === 0 ? 1 : 2)) continue;
        const isLast = sg.seg === n0 - 1;
        const sList = isLast ? [0.35, 0.75, 1.0, sg.sMax * 0.94] : [0.4, 0.85];
        for (const sv of sList) {
          const C = M.vmad(sg.A, sg.t, sg.len * sv);
          const r = AN2.segmentProfile(A, d, sg.seg, Math.min(sv, 1))[1];
          let best = null;
          for (const q of ps) {
            const off = M.vdot(M.vsub(C, q.P), q.n);
            if (off < -6 || off > q.t + r) continue;
            const lat = M.vlen(M.vsub(M.vsub(C, q.P), M.vmul(q.n, off)));
            if (lat > 11) continue;
            const pen = q.t + r - off;
            if (pen > tol && (!best || pen > best.depth)) best = { d, seg: sg.seg, P: C, n: q.n, depth: pen };
          }
          if (best) cs.push(best);
        }
      }
    }
    if (scene && scene.ball) for (const c of ballContacts(A, rig, scene.ball, tol)) cs.push(c);
    return cs;
  }

  // The most any one contact may move any one joint in one iteration. This is
  // a trust region, not a damping constant: the step's DIRECTION is usually
  // right even where its length is nonsense, and twenty iterations of a
  // bounded step get to the same place as one unbounded one without ever
  // passing through the nonsense. Eight degrees is loose enough that a
  // maximal clench still resolves its own pads out of its palm inside the
  // iteration budget, and tight enough that the thirty-degree throw measured
  // below cannot happen.
  //
  // A fixed damping term was tried first and is the wrong shape. The step is
  // lambda * depth / sum(w g^2), and `w` is the joint's compliance - splay is
  // deliberately the stiffest thing the hand has, at 0.035 against flexion's
  // 0.55, so `sum` for a contact resolved by abduction is naturally small.
  // Damping keyed on `sum` therefore swamps exactly the contacts that keep
  // adjacent fingers out of each other: measured, four presets went from
  // clean to 37% interpenetration between the middle and ring.
  const CONTACT_STEP = 8.0 * DEG;

  /**
   * Push the hand out of its contacts, one Jacobian-transpose step.
   *
   * `g` is how fast the contact point moves along the contact normal per
   * radian of each joint, so the step is lambda * depth / sum(w g^2) - and
   * every g goes to zero together in exactly the case a hand meets most
   * often, a fingertip arriving square on a ball. Flexing the finger there
   * moves the tip ACROSS the contact normal rather than along it, so the hand
   * genuinely cannot push itself off that contact by bending, and the
   * unbounded step reads that as needing an enormous one.
   *
   * Measured before this: the ring finger touching a 26mm ball 0.3mm deep was
   * thrown thirty degrees back out of its own grip in a single iteration, and
   * because holdBall had latched it as arrived, it stayed there - the finger
   * finished 32mm off a ball it was supposed to be holding.
   */
  function applyContacts(A, pose, rig, cs, lambda) {
    for (const c of cs) {
      const dofs = jointDofs(rig, pose, c.d).filter(x => x.seg <= c.seg);
      if (!dofs.length) continue;
      const g = new Array(dofs.length);
      let sum = 0;
      for (let i = 0; i < dofs.length; i++) {
        const x = dofs[i];
        g[i] = M.vdot(M.vcross(x.axis, M.vsub(c.P, x.O)), c.n);
        sum += x.w * g[i] * g[i];
      }
      if (sum < 1e-7) continue;
      const k = lambda * c.depth / sum;
      let biggest = 0;
      for (let i = 0; i < dofs.length; i++) {
        const step = Math.abs(k * dofs[i].w * g[i]);
        if (step > biggest) biggest = step;
      }
      const scale = biggest > CONTACT_STEP ? CONTACT_STEP / biggest : 1;
      for (let i = 0; i < dofs.length; i++) dofs[i].add(k * dofs[i].w * g[i] * scale);
    }
  }

  // =========================================================================
  //  HOLDING SOMETHING
  // =========================================================================

  /**
   * Where a ball of a given radius sits when the hand closes on it: against
   * the palm, on the palm's own outward normal, a little way into the flesh
   * so the pads have something to press. Placed from the hand rather than
   * given, because a ball positioned by hand and a hand posed to hold it are
   * two ways of getting the same thing wrong.
   */
  function ballOnPalm(A, rig, radius) {
    const R = GK.rig;
    const sp = R.palmSurface(rig, 0.52, 0.22);
    const n = R.palmNormal(rig, 0.52, 0.22);
    // Not a fraction of the radius. Sinking the centre to 92% of the radius
    // buries a big ball proportionally deeper than a small one - at 38mm that
    // is three millimetres of palm, which puts the metacarpal heads inside the
    // sphere, and a proximal phalanx whose base rim is inside a ball cannot be
    // pushed out of it by bending: the rim sweeps about the joint, so rotating
    // only moves the penetration round. It has to be got right here.
    //
    // So the ball is lowered onto the hand instead: start clear, and settle it
    // until the deepest thing it touches is one soft-tissue allowance in. The
    // palm is what it lands on - the fingers are still open at this point,
    // which is the whole reason this runs before the hand closes.
    const ALLOW = 1.6;
    const deepest = (C) => {
      let pen = -1e9;
      for (let i = 0; i <= 16; i++) {
        const u = lerp(-0.05, 1.02, i / 16);
        for (let k = 0; k <= 12; k++) {
          const P = R.palmSurface(rig, u, (k / 12) * 0.5).P;
          const v = radius - M.vdist(P, C);
          if (v > pen) pen = v;
        }
      }
      return pen;
    };
    let t = radius + 8;
    for (let it = 0; it < 18; it++) {
      const step = deepest(M.vmad(sp.P, n, t)) - ALLOW;
      if (Math.abs(step) < 0.05) break;
      t += step * 0.75;
    }
    return { C: M.vmad(sp.P, n, t), r: radius };
  }

  /**
   * Where the hand meets a ball, measured on the surface rather than the axis.
   *
   * Taking the bone's axis and calling the segment a cylinder of one radius is
   * a fair test for a fingertip, whose section is nearly round, and a poor one
   * everywhere else: a proximal phalanx is a flattened ellipse, so the axis
   * test clears it while its palmar face is already several millimetres
   * inside the ball. Measured on a 38mm ball: the ring and little proximal
   * phalanges sat 3.7 and 5.5mm through a sphere the axis test called
   * untouched, which is a solid passing through a solid.
   *
   * So sample the surface, and keep the deepest point per segment - one
   * contact per segment, because a segment resting flat on a ball touches it
   * along a whole line and feeding twenty near-identical records to the
   * solver just multiplies the same correction by twenty.
   */
  function ballContacts(A, rig, ball, tol) {
    const AN2 = GK.anatomy;
    const cs = [];
    for (let d = 0; d < 5; d++) {
      for (const sg of rig.digits[d].segs) {
        if (!sg.rendered) continue;
        // A finger's metacarpal lives inside the palm and the palm's own
        // contacts answer for it. The thumb's is thenar mass out on its own,
        // and a ball pressed into the first web meets it directly - untested,
        // it took 8.4mm of a 38mm ball straight through the ball of the thumb.
        if (sg.seg < 1 && d !== 0) continue;
        // cheap reject: could this segment reach the ball at all?
        const mid = GK.rig.sectionCenter(rig, d, sg.seg, (sg.sMin + sg.sMax) * 0.5);
        const pr = AN2.segmentProfile(A, d, sg.seg, 0.5);
        const reach = sg.len * 0.5 + Math.max(pr[0], pr[1]) + ball.r;
        if (M.vdist(mid, ball.C) > reach) continue;
        let best = null;
        for (let i = 0; i <= 6; i++) {
          const sv = lerp(sg.sMin, sg.sMax, i / 6);
          for (let k = 0; k < 10; k++) {
            const P = GK.rig.digitSurface(rig, d, sg.seg, sv, (k / 10) * Math.PI * 2).P;
            const away = M.vsub(P, ball.C);
            const dist = M.vlen(away);
            if (dist < 1e-6) continue;
            const pen = ball.r - dist;
            if (!best || pen > best.depth) {
              best = { d, seg: sg.seg, P, n: M.vmul(away, 1 / dist), depth: pen };
            }
          }
        }
        if (best && best.depth > tol) cs.push(best);
      }
    }
    return cs;
  }

  /**
   * Close the hand on a ball.
   *
   * Not by aiming the pads at it. Driving every tip onto the sphere's surface
   * lands them all on its equator, which is five fingers touching a circle
   * rather than a hand holding anything, and for a ball too big to wrap it
   * drives the proximal phalanges straight through it instead.
   *
   * A hand closes until it meets resistance, so this does too: flex everything
   * by a few degrees, settle against the ball and against itself, and stop
   * flexing whichever digits have arrived. Each finger then stops where the
   * ball is, not where it was told, and the same code holds a marble and a
   * grapefruit.
   */
  function holdBall(A, pose, radius, opts) {
    opts = opts || {};
    const R = GK.rig;
    let p = clampPose(A, JSON.parse(JSON.stringify(pose)));
    const ball = opts.ball || ballOnPalm(A, R.solve(A, p), radius);
    const scene = { ball };
    const rested = [false, false, false, false, false];
    const bestGap = [1e9, 1e9, 1e9, 1e9, 1e9];
    const bestAt = [null, null, null, null, null];
    const past = [0, 0, 0, 0, 0];
    // how near a digit has to have been before "it is going away again" is
    // evidence of anything
    const NEARLY = 6.0;
    let settled = 0;
    const STEPS = opts.steps === undefined ? 26 : opts.steps;
    const rate = opts.rate === undefined ? 0.13 : opts.rate;
    const shut = clampPose(A, mk(A, PRESETS[opts.toward || 'fist'].spec));
    for (let it = 0; it < STEPS; it++) {
      const rig = R.solve(A, p);
      // A digit has arrived when its LAST bone is resting on the ball. Any
      // contact at all is the wrong test: a proximal phalanx lying across a
      // big ball touches it from the first step, and stopping there leaves
      // the finger straight - it was never the part that was going to close.
      // A contact only counts once it is on the segment whose flexion would
      // otherwise still be carrying the tip inward.
      const onBall = {};
      for (const c of ballContacts(A, rig, ball, -0.4))
        if (c.seg >= rig.digits[c.d].segs.length - 1) onBall[c.d] = 1;
      // Arriving is not a one-way door. The contact solver runs between
      // closing steps and can push a digit that has just touched back off the
      // ball again; latched on first contact, that digit then stands there
      // for the remaining twenty iterations with its pad in mid-air, which is
      // what left the ring finger 32mm off a ball it was holding. So the test
      // is re-read every step, with enough hysteresis that a digit resting on
      // the surface does not chatter in and out of the closing schedule.
      //
      // And a digit stops at its closest approach whether it arrived or not.
      // On a small ball a long finger curls straight past it, and from there
      // every further degree of flexion takes the pad further away - so a
      // rule that only watches for contact never fires and the finger closes
      // into a fist beside a marble it was supposed to be holding. Measured:
      // the middle finger finished 13.6mm past a 16mm ball.
      //
      // But only once the digit has actually got near the thing. The contact
      // solver runs between closing steps and jostles every gap by a
      // millimetre or so, and read without that guard the rule fires on that
      // jostle: the ring finger, still 28mm out and closing perfectly well,
      // saw its gap tick upward twice and was frozen there for the rest of
      // the run. A finger cannot be past a ball it has never reached.
      for (let d = 0; d < 5; d++) {
        const dg = rig.digits[d];
        const pad = GK.anatomy.segmentProfile(A, d, dg.segs.length - 1, 0.9)[1];
        const gap = M.vdist(dg.tip, ball.C) - ball.r - pad;
        if (gap < bestGap[d] - 0.05) {
          bestGap[d] = gap;
          bestAt[d] = JSON.parse(JSON.stringify(p.digits[d]));
          past[d] = 0;
        } else if (bestGap[d] < NEARLY && gap > bestGap[d] + 0.4 && ++past[d] >= 3 && !rested[d]) {
          // it has turned away from the ball twice running: put it back where
          // it was nearest and leave it there
          if (bestAt[d]) p.digits[d] = JSON.parse(JSON.stringify(bestAt[d]));
          rested[d] = true;
          continue;
        }
        if (onBall[d] || gap <= 0.4) rested[d] = true;
        else if (gap > 2.5) rested[d] = false;
      }
      // and since a digit can un-rest, only stop once the whole hand has
      // been resting for two steps together
      if (rested.every(Boolean)) { if (settled++) break; } else settled = 0;
      // Close along an authored trajectory rather than an invented one. Which
      // joints move, and in what proportion, is exactly what the grip preset
      // already encodes - it was fitted and then hand-corrected - and a
      // schedule guessed here instead got the fingers closing while the thumb
      // waved beside the ball, because the three motions that carry a thumb
      // onto something held do not divide evenly.
      for (let d = 0; d < 5; d++) {
        if (rested[d]) continue;
        const q = p.digits[d], t = shut.digits[d];
        for (const k in q) if (typeof q[k] === 'number') q[k] += (t[k] - q[k]) * rate;
      }
      // no spring while closing, or the hand pulls back out of its own grip
      p = resolveContacts(A, clampPose(A, p), { iters: 6, scene, kappa: 0 });
    }
    // The closing trajectory gets the fingers onto the ball and leaves the
    // thumb about a pad's width short, every size, because the authored grip
    // it is following was authored around fingers rather than around this
    // object. So finish the thumb by aiming it: the reach solver respects the
    // joint stops, so if the thumb genuinely cannot get there it stays where
    // it is rather than being forced.
    // ...and so does any digit the closing schedule left short. Flexing a
    // long finger onto a small ball sweeps its pad along an arc that can miss
    // the thing entirely - a hand closing on a marble flexes at the two
    // interphalangeal joints and hardly at the knuckle, which is not a
    // proportional close and is not what any single authored grip encodes.
    // The reach solver already knows how to put a pad somewhere; ask it.
    const short = [];
    {
      const rig = R.solve(A, p);
      for (let d = 0; d < 5; d++) {
        const dg = rig.digits[d];
        const pad = GK.anatomy.segmentProfile(A, d, dg.segs.length - 1, 0.9)[1];
        if (M.vdist(dg.tip, ball.C) - ball.r - pad > 1.2) short.push(d);
      }
    }
    for (const d of (opts.aim || short)) {
      const rig = R.solve(A, p);
      const dg = rig.digits[d];
      const away = M.vsub(dg.tip, ball.C);
      const len = M.vlen(away);
      if (len < 1e-6) continue;
      const pad = GK.anatomy.segmentProfile(A, d, dg.segs.length - 1, 0.9)[1];
      const target = M.vmad(ball.C, M.vmul(away, 1 / len), ball.r + pad * 0.6);
      // The step this solver takes is small on purpose, so the iteration
      // count has to cover the whole swing. A thumb reaching round a 38mm
      // ball travels ninety degrees of opposition; given twenty iterations it
      // finished 29.6mm short, and given a hundred and twenty it finishes
      // 1.2mm short. It was never that the target could not be reached.
      p = reach(A, p, d, target, { iters: 120, kappa: 0.002 });
    }
    // Settle hard against the pose that was just aimed, because by this point
    // the aim IS the answer: the reach solver has put each pad on the ball,
    // and all this pass has left to do is take a couple of millimetres of
    // penetration out of it. Left slack, it does not polish - it re-solves.
    // A thumb 2.5mm into a 38mm ball was thrown to its own extension limit,
    // 43mm clear of the thing it was holding, because swinging the whole
    // digit away is a perfectly good way to remove a penetration and nothing
    // told it otherwise. Swept over ten seeds, two starting poses and three
    // radii, every digit's gap falls monotonically as this is tightened and
    // the penetration it buys back rises slowly: at 0.35 the worst pad gap
    // across the population is 15mm where it was 41mm, and penetration is
    // 0.2mm median, 2.6mm at the ninetieth.
    const out = resolveContacts(A, p, { iters: 40, scene, kappa: 0.350, drift: 0 });
    out.ball = ball;
    // Recomputed from the hand that came out, not carried over from the
    // closing loop. `rested` is the loop's own bookkeeping and it stops being
    // true the moment the aiming pass and the final settle move a digit -
    // reported as-is it says a finger is holding the ball while the finger is
    // measurably somewhere else, which is worse than saying nothing.
    {
      const fin = R.solve(A, out);
      out.held = [];
      out.holdGap = [];
      for (let d = 0; d < 5; d++) {
        const dg = fin.digits[d];
        const pad = GK.anatomy.segmentProfile(A, d, dg.segs.length - 1, 0.9)[1];
        const gap = M.vdist(dg.tip, ball.C) - ball.r - pad;
        out.holdGap[d] = gap;
        out.held[d] = gap <= 1.2;
      }
    }
    return out;
  }

  /**
   * A hand taking a ball and letting it go, as a function of one number.
   *
   * Returns a closure rather than a pose, because closing a hand on something
   * is a settle inside a settle and costs a couple of hundred milliseconds -
   * far too much to pay per frame. The grasp is worked out once; every frame
   * before release is an interpolation between fixed keyframes, which is also
   * why the closing reads as one motion instead of a series of separate
   * grips. But the closure is not purely a function of its argument the way
   * the rest of this file is: from the moment the fingers begin to open, the
   * ball is a live GK.physics body, and physics has a memory - what it does
   * next depends on what it was doing a moment ago, not just on "now". So
   * this closure carries that body forward call to call, and (like every
   * other stateful animation driver in this codebase - PH.step itself, or a
   * dragged fingertip in reach()) it is meant to be sampled with a
   * monotonically increasing argument, once per frame, the way every caller
   * in this file already does. A rewind is handled - it will not throw - but
   * it cannot un-happen a bounce, so scrubbing backward through a fall just
   * holds the ball at wherever it last got to rather than replaying physics
   * in reverse.
   *
   * The hand itself does not travel: there is no translation in the rig, and
   * faking one by sliding the ball into the palm looks like the ball doing
   * the work. So the lift is carried by the wrist, which is a real degree of
   * freedom - the whole hand swings up about a fixed wrist origin - and for
   * as long as the grip holds, the ball is carried rigidly with it: attached
   * to a fixed spot on the palm sheet, not frozen at a world-space point,
   * which is what a hand that lifts its grip while the held object stays
   * exactly where it was in space would mean. Once support is lost the ball
   * answers to nothing but gravity and whatever it touches on the way out.
   */
  function pickAndDrop(A, radius, opts) {
    opts = opts || {};
    const R = GK.rig;
    const openKey = opts.open || 'spread';
    const open = clampPose(A, mk(A, PRESETS[openKey].spec));
    const grip = holdBall(A, open, radius);
    const ball0 = grip.ball;
    // Gravity is anchored here, once, to the pose the hand is in BEFORE it
    // starts moving - not re-read at the moment of release. root rotates
    // rigidly with wrist flexion (see 35-physics.js's header), so anchoring
    // at release would let a hand that had already tilted while lifting the
    // ball redefine "down" to match its own tilt: gravity would always point
    // straight out of the palm no matter how the hand held it, which is the
    // wrist rotating the world rather than the world staying put. Anchored
    // here instead, a hand that lifts a ball at an angle can show the ball
    // pressing into a different part of the cupped palm as it tips - real
    // weight against a real contact - rather than that being erased by
    // gravity quietly following the hand around.
    const rig0 = R.solve(A, open);
    // `open` is posed with no notion of the ball at all, and while
    // ballOnPalm keeps it clear for most seeds and radii, it does not for
    // every one: measured across this file's own seed/radius sweep, the
    // largest ball size put the hand a couple of millimetres into its own
    // object before the hand had moved at all. So it is settled against the
    // ball once here, the same way holdBall settles its own final pose, and
    // this corrected copy - not the raw preset - is what idle and the start
    // of the close actually blend from. `open` itself stays untouched: it
    // is still what `grip` and the gravity frame above were built from, and
    // re-settling it here must not feed back into either.
    const openClear = resolveContacts(A, open, { scene: { ball: ball0 }, iters: 20, tol: 0.2 });

    // ==== TIMING ============================================================
    // Every field below is a FRACTION of the whole looping cycle (0..1), and
    // `seconds` is what turns fractions into the physics engine's own units -
    // the ball does not know or care how fast the caller is stepping `t`, it
    // only knows how many seconds of gravity it has been given, so this is
    // the number to change if a drop should feel heavier/slower or lighter/
    // quicker without touching a single physics constant.
    const T = Object.assign({
      start:    0.05, // idle at `open` ends here; the fingers start closing
      contact:  0.34, // the fingers have arrived on the ball; grip settled
      liftTop:  0.52, // the lift is complete: ball held up and steady
      release:  0.60, // the pause at the top ends; fingers begin opening
      clear:    0.76  // the KINEMATIC opening motion finishes here. This is
                       // a fallback deadline, not the release trigger - the
                       // physics contact solver almost always lets go
                       // earlier than this, on its own, the moment the
                       // fingers have actually opened clear of the ball, the
                       // same way simtest.js's "opening the hand releases
                       // the ball into a real fall" case works.
    }, opts.timing);
    // Real gravity (G_MAG in 35-physics.js) is not adjustable to taste, so
    // this is the number that actually controls how far the ball falls
    // before the cycle loops: 1.0s means the release-to-loop-end window
    // (1-T.release, about 0.4 of the cycle) is ~0.4s of real free fall,
    // which drops a ball on the order of the hand's own size before the
    // sequence resets - long enough to read as a real fall, short enough
    // that it has not left the frame's neighbourhood by the time it does.
    const SECONDS = opts.seconds === undefined ? 1.0 : opts.seconds; // whole-cycle physics duration
    const PHYS_STEP_CAP = 1 / 60;  // no single PH.step() call covers more than this much physics time,
                                    // regardless of how coarsely the caller samples `t` - see advancePhysics
    const LIFT_FLEX = 26 * DEG, LIFT_DEV = 7 * DEG;  // unchanged from the original: the wrist carries the lift
    const SETTLE_LIFT = 0.6;       // how much of the lift is still held once the hand has fully re-opened
    const ANCHOR_UV = [0.52, 0.22]; // the same palm spot ballOnPalm itself places a held ball against

    // Per-digit stagger for the close and the open, so the fingers do not
    // arrive (or let go) in lockstep. Every digit still lands EXACTLY on the
    // pose holdBall computed - this only changes how it gets there, never
    // where. The naive way to stagger five things is five different finish
    // times, but a digit that finishes early would have to stop dead against
    // whatever it is closing on before the window itself is over, and one
    // that starts late would have to leave zero velocity behind at a
    // boundary shared with an adjacent phase that is not itself moving -
    // both are the "abrupt start or stop" this whole file is trying to get
    // away from. So instead every digit gets the SAME ease.inOut - zero
    // velocity at both ends, guaranteed - just entered late: a digit with a
    // large delay sits exactly at its start value, genuinely motionless,
    // for that fraction of the window, then eases through the rest of it no
    // differently from a digit with no delay at all, arriving with the same
    // zero velocity every one of them does. The order - index and middle
    // move first, ring and little a little behind, the thumb last - is not
    // to taste: it is the order a real hand's digits actually arrive in
    // (and, reversed, let go in), because the thumb's opposition is a
    // compound CMC rotation plus flexion and is the slowest degree of
    // freedom a hand has, where the fingers close on a comparatively simple
    // hinge.
    const DIGIT_DELAY = [0.34, 0, 0, 0.12, 0.18];   // thumb, index, middle, ring, little
    function digitProgress(cta) { return DIGIT_DELAY.map(delay => M.ease.inOut(clamp01(M.inv(cta, delay, 1)))); }

    function copyDigits(pose) { return pose.digits.map(d => Object.assign({}, d)); }
    function blendDigits(a, b, tt) {
      return a.digits.map((da, d) => {
        const db = b.digits[d], e = Array.isArray(tt) ? tt[d] : tt, out = {};
        for (const k in da) out[k] = typeof da[k] === 'number' ? M.lerp(da[k], db[k], e) : da[k];
        return out;
      });
    }
    /** 0 before the grip forms, eases up to 1 across the lift, holds through
     *  the pause, eases back down to SETTLE_LIFT as the hand re-opens, and
     *  stays there through the fall - the wrist leading the fingers in the
     *  one place this rig can show it, since it is the only joint upstream
     *  of everything else: the fingers hold the grip they already have
     *  while the wrist alone carries the ball up, and later carries it back
     *  down partway, exactly the "wrist leads, fingers follow" a real lift
     *  shows, because on this rig the wrist is the only joint that CAN lead
     *  without also having to be the thing doing the holding. */
    function liftFrac(u) {
      if (u < T.contact) return 0;
      if (u < T.liftTop) return M.ease.inOut(M.inv(u, T.contact, T.liftTop));
      if (u < T.release) return 1;
      if (u < T.clear) return M.lerp(1, SETTLE_LIFT, M.ease.inOut(M.inv(u, T.release, T.clear)));
      return SETTLE_LIFT;
    }
    function wristFor(li) {
      // Every phase before contact and after clear holds `open`'s own
      // wrist value (grip's wrist is open's wrist too - holdBall never
      // touches it), so the wrist has exactly one motion in this whole
      // sequence: the lift, and liftFrac already carries its own easing.
      return { flex: open.wrist.flex + li * LIFT_FLEX, dev: open.wrist.dev + li * LIFT_DEV, pron: open.wrist.pron };
    }

    // ==== THE BALL, ATTACHED ================================================
    // Where a held ball sits, expressed as a fixed offset off a fixed spot on
    // the palm sheet, so re-evaluating it against a rotated (lifted) rig
    // carries the ball rigidly with the palm instead of leaving it stranded
    // at a world-space point while the hand swings up and away from it.
    //
    // The offset is a full 3-D vector in the palm's own local frame at that
    // spot - the surface normal and two tangents built from it - not a
    // single distance along the normal alone. A single scalar only
    // reproduces ball0.C if ball0.C happens to sit exactly on that one
    // normal line, which it does for the rig it was actually placed
    // against and essentially never does for any other: measured, that
    // version of this function was quietly discarding upwards of a
    // millimetre of ball0.C's position every time, sideways to the normal,
    // which is exactly the direction a scalar-along-the-normal offset has
    // no way to represent. Three components does not have that blind spot -
    // it is the whole vector, decomposed rather than approximated - and it
    // still carries the ball rigidly through a pure rotation for the same
    // reason the scalar version tried to: normal, tangents and surface
    // point all rotate together, because they are all read from the same
    // rig.
    //
    // The frame itself is solved once, eagerly, against the rig the hand is
    // actually in the instant attachment begins - grip's own digits, at
    // open's own (not yet lifted) wrist, which is exactly T.contact - not
    // against rig0, whose fingers are still open. reproduces ball0.C
    // exactly at T.contact by construction, because that is precisely the
    // geometry ball0.C sits in front of at that instant.
    function tangentFrame(n) {
      // an arbitrary but CONSISTENT pair of tangents built from n alone, so
      // they rotate rigidly whenever n itself does; which two directions
      // they are does not matter, only that the same recipe is used every
      // time this is called.
      const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const t1 = M.vnorm(M.vcross(ref, n));
      return [t1, M.vcross(n, t1)];
    }
    const anchorLocal = (function () {
      const rigAtContact = R.solve(A, grip);
      const sp = R.palmSurface(rigAtContact, ANCHOR_UV[0], ANCHOR_UV[1]);
      const n = R.palmNormal(rigAtContact, ANCHOR_UV[0], ANCHOR_UV[1]);
      const [t1, t2] = tangentFrame(n);
      const d = M.vsub(ball0.C, sp.P);
      return { n: M.vdot(d, n), t1: M.vdot(d, t1), t2: M.vdot(d, t2) };
    })();
    function attachedBallC(rig) {
      const sp = R.palmSurface(rig, ANCHOR_UV[0], ANCHOR_UV[1]);
      const n = R.palmNormal(rig, ANCHOR_UV[0], ANCHOR_UV[1]);
      const [t1, t2] = tangentFrame(n);
      let C = M.vmad(sp.P, n, anchorLocal.n);
      C = M.vmad(C, t1, anchorLocal.t1);
      C = M.vmad(C, t2, anchorLocal.t2);
      return C;
    }

    // ==== THE BALL, FALLING ==================================================
    // A real GK.physics body, created the instant it is first needed (the
    // instant the caller's sampling first crosses T.release) and stepped
    // forward by exactly as much physics time as `u` has advanced since the
    // last call. Zero initial velocity is not a simplification stood in for
    // a real number: liftFrac's own ease.inOut has zero slope at u=T.release
    // (that is what ease.inOut(0) with a cubic on both sides means), so the
    // hand's own motion is already momentarily still at the instant of
    // release - a controlled let-go, not a toss - and handing the ball a
    // velocity of exactly what the hand was doing at that instant is exactly
    // what "zero" already is here, not an approximation of it.
    let sim = null;
    function advancePhysics(u, rigNow) {
      const PH = GK.physics;
      if (!sim) {
        const state = PH.createState({
          r: radius, C: attachedBallC(rigNow), v: [0, 0, 0], w: [0, 0, 0],
          density: opts.density, restitution: opts.restitution, friction: opts.friction
        });
        PH.setGravityFromRig(state, rig0);
        sim = { state, lastU: u };
        return;
      }
      let remaining = (u - sim.lastU) * SECONDS;
      sim.lastU = u;
      // Chunked rather than handed to PH.step() in one call, so accuracy
      // never depends on how densely the caller happens to sample `t`: a
      // tool taking eight frames across the whole animation gets the same
      // trajectory as one taking two hundred, just read out at coarser
      // intervals, because the physics underneath never sees a dt larger
      // than PHYS_STEP_CAP regardless.
      while (remaining > 1e-6) {
        const h = Math.min(remaining, PHYS_STEP_CAP);
        PH.step(sim.state, rigNow, h);
        remaining -= h;
      }
    }

    let gen = null;   // which lap of the loop the previous call belonged to
    return function (t) {
      const u = ((t % 1) + 1) % 1;
      const thisGen = Math.floor(t);
      // A new lap is a fresh repetition of the same gesture: a new ball, in
      // effect, so any physics body left over from the last one round has
      // nothing to do with this one. (anchorT does not need this - it no
      // longer depends on when it was first asked for, see its own note.)
      if (thisGen !== gen) { sim = null; gen = thisGen; }

      const li = liftFrac(u);
      const p = blank();
      let phase;
      if (u < T.start) {
        p.digits = copyDigits(openClear); p.arch = openClear.arch; phase = 'idle';
      } else if (u < T.contact) {
        const cta = M.inv(u, T.start, T.contact);
        p.digits = blendDigits(openClear, grip, digitProgress(cta));
        p.arch = M.lerp(openClear.arch, grip.arch, M.ease.inOut(cta)); phase = 'close';
      } else if (u < T.release) {
        p.digits = copyDigits(grip); p.arch = grip.arch; phase = u < T.liftTop ? 'lift' : 'hold';
      } else if (u < T.clear) {
        const oe = M.inv(u, T.release, T.clear);
        p.digits = blendDigits(grip, open, digitProgress(oe));
        p.arch = M.lerp(grip.arch, open.arch, M.ease.inOut(oe)); phase = 'release';
      } else {
        p.digits = copyDigits(open); p.arch = open.arch; phase = 'falling';
      }
      p.wrist = wristFor(li);

      let ball;
      if (u < T.contact) {
        ball = { C: ball0.C.slice(), r: ball0.r };
      } else {
        const rigNow = R.solve(A, p);
        if (u < T.release) ball = { C: attachedBallC(rigNow), r: ball0.r };
        else { advancePhysics(u, rigNow); ball = { C: sim.state.C.slice(), r: sim.state.r }; }
      }
      ball.roughness = opts.roughness;
      ball.anisotropy = opts.anisotropy;

      const out = clampPose(A, p);
      out.ball = ball;
      out.phase = phase;
      return out;
    };
  }

  /**
   * Pull one digit to a point in space.
   *
   * The same damped Jacobian transpose the contacts use, except the error is
   * a displacement rather than a penetration depth, so it has three
   * components instead of one and the step length is solved for rather than
   * guessed: for J-transpose the best step along the gradient has a closed
   * form, and using it is the difference between a finger that follows the
   * cursor and one that crawls.
   *
   * Every joint stays sprung toward the pose that was asked for, at a fraction
   * of the contact solver's pull. Without it a dragged fingertip will happily
   * unwind the whole chain to gain a millimetre it cannot reach, and let go
   * of a pose the moment you touch it.
   */
  function reach(A, pose, d, target, opts) {
    opts = opts || {};
    const iters = opts.iters === undefined ? 30 : opts.iters;
    const tol = opts.tol === undefined ? 0.3 : opts.tol;
    const kappa = opts.kappa === undefined ? 0.02 : opts.kappa;
    const p0 = JSON.parse(JSON.stringify(pose));
    let p = JSON.parse(JSON.stringify(pose));
    let err = 1e9;
    for (let it = 0; it < iters; it++) {
      const rig = GK.rig.solve(A, p, { skeleton: true });
      const tip = rig.digits[d].tip;
      const e = M.vsub(target, tip);
      err = M.vlen(e);
      if (err < tol) break;
      const dofs = jointDofs(rig, p, d);
      if (!dofs.length) break;
      // J is the tip's velocity per unit of each joint's rotation
      const g = new Array(dofs.length);
      let v = [0, 0, 0];
      for (let i = 0; i < dofs.length; i++) {
        const x = dofs[i];
        const j = M.vcross(x.axis, M.vsub(tip, x.O));
        g[i] = M.vdot(j, e);
        v = M.vadd(v, M.vmul(j, x.w * g[i]));
      }
      const vv = M.vdot(v, v);
      if (vv < 1e-9) break;
      const step = M.vdot(e, v) / vv;
      for (let i = 0; i < dofs.length; i++) dofs[i].add(step * dofs[i].w * g[i]);
      const a = p.digits[d], b = p0.digits[d];
      for (const k in a) if (typeof a[k] === 'number') a[k] += (b[k] - a[k]) * kappa;
      p = clampPose(A, p);
    }
    p.reachError = err;
    return p;
  }

  /**
   * Settle a pose against its own contacts. Returns a corrected copy; the
   * deepest remaining penetration is reported on `.contactDepth`.
   */
  // How fast the spring's own target gives way to where the hand has
  // actually ended up, per iteration. Zero is a target that never moves,
  // which cannot converge against a pose the hand can't occupy; one is no
  // spring at all.
  const TARGET_DRIFT = 0.06;

  function resolveContacts(A, pose, opts) {
    opts = opts || {};
    const iters = opts.iters === undefined ? 20 : opts.iters;
    const tol = opts.tol === undefined ? 0.35 : opts.tol;
    const lambda = opts.lambda === undefined ? 0.72 : opts.lambda;
    const kappa = opts.kappa === undefined ? 0.065 : opts.kappa;
    // A caller that already knows its target is reachable should pass 0: the
    // grip solver's aimed pose was produced by the reach solver against the
    // real joint stops, so it is occupiable by construction and letting it
    // drift only lets contact walk the hand off the thing it is holding.
    // An authored preset carries no such guarantee.
    const drift = opts.drift === undefined ? TARGET_DRIFT : opts.drift;
    const p0 = JSON.parse(JSON.stringify(pose));
    let p = JSON.parse(JSON.stringify(pose));
    let deepest = 0;
    for (let it = 0; it < iters; it++) {
      const rig = GK.rig.solve(A, p);
      const cs = gatherContacts(A, rig, tol, opts.scene);
      deepest = 0;
      for (const c of cs) deepest = Math.max(deepest, c.depth);
      if (!cs.length) break;
      applyContacts(A, p, rig, cs, lambda);
      // Every joint is sprung toward the pose that was asked for. The hand
      // settles where contact balances intent, which is what a hand does;
      // letting contact win outright turns a fist into a splayed claw.
      //
      // But the target has to be allowed to move. Run as twenty separate
      // one-iteration calls - each re-reading its own target - a maximal
      // clench converges from 23.9mm of penetration to zero; run as one
      // twenty-iteration call against a target that never moves, it settles
      // at 7.6mm with the thumb inside the middle finger. The spring is not
      // balancing that contact, it is holding it, because the pose it is
      // pulling toward is one the hand cannot actually occupy.
      //
      // So the target drifts toward wherever the hand has got to, slowly
      // enough that the early iterations still answer to what was asked for
      // and late ones answer to what is possible. Weakening the spring
      // instead was tried and is worse in both directions: it lets a
      // deliberately tight pose splay open, and it turns off exactly the
      // pull that stops a contact flinging a thumb to its joint stops.
      for (let d = 0; d < 5; d++) {
        const a = p.digits[d], b = p0.digits[d];
        for (const k in a) if (typeof a[k] === 'number') {
          a[k] += (b[k] - a[k]) * kappa;
          b[k] += (a[k] - b[k]) * drift;
        }
      }
      p = clampPose(A, p);
    }
    p.contactDepth = deepest;
    if (pose.active) p.active = pose.active;
    if (pose.intent) p.intent = pose.intent;
    if (pose.spec) p.spec = pose.spec;
    return p;
  }

  GK.pose = {
    blank, mk, clampPose, specOf, preset, PRESETS, PRESET_KEYS, couple, generate,
    resolveContacts, gatherContacts, jointDofs, reach,
    holdBall, ballOnPalm, ballContacts, pickAndDrop,
    lerpPose, dofList, romTour, breathe, readout, nr
  };
})(window.GK = window.GK || {});

/* ============================================================================
   GRAPHITE KINEMATICS — 35 · physics
   The held ball as a real object: a small rigid-body sphere with its own
   state — position, velocity, orientation, spin — that collides with the
   hand's own surfaces (the same digitSurface/palmSurface the renderer draws
   from) and is resolved by impulses, not placed by a formula. Squeeze it and
   the contact forces rise. Tilt the hand past what friction can hold and it
   rolls. Open the fingers and it is not "released" by a timeline — it falls
   because nothing is pushing back on it any more.

   WHAT THIS FILE DOES NOT DO: it does not give the hand itself mass. The
   joints stay exactly what they already were — an IK-posed linkage — and the
   ball pushes on them the same way a contact already does in 30-pose.js:
   jointDofs() plus a Jacobian-transpose relaxation (see reactToHand below,
   which is applyContacts' sibling, driven by contact force instead of
   penetration depth). Two different problems, two different solvers, wired
   together by the contact records this file produces.

   THE GRAVITY / "DOWN" CONVENTION. rig.root is this system's only notion of
   a world frame, and pickAndDrop (30-pose.js) already treats -root[0] as
   "down the page" for exactly one pose, fixed once at the start of that
   animation and never revisited even while the wrist goes on to move. That
   is deliberate, not an oversight: root rotates rigidly with wrist
   flexion/deviation, and the whole hand's geometry rotates right along with
   it, so a gravity vector that were re-read from root every frame would
   rotate in lockstep with the palm and a wrist twist would never change
   anything relative to the ball — "tilting the hand" would be a no-op.
   Real gravity does not rotate when a wrist does. So: -root[0] is read once,
   the first time a state sees a rig, cached on state.down, and held fixed
   from then on — call setGravityFromRig() to deliberately re-anchor it (a
   ball freshly dropped into a new hand/pose) or wake() to nudge a resting
   ball back into the solver without moving gravity at all.

   UNITS. Millimetres, kilograms, seconds throughout — the rig is already in
   mm, so contacts need no conversion. Force is reported to callers in
   newtons (see FORCE_SI); everything internal stays mm/kg/s.
   ========================================================================== */
(function (GK) {
  'use strict';
  const M = GK.math, AN = GK.anatomy, RG = GK.rig, PO = GK.pose;
  const { clamp, clamp01, lerp } = M;
  const { vadd, vsub, vmul, vmad, vdot, vcross, vlen, vdist, vnorm, vlerp } = M;

  // =========================================================================
  //  TUNABLES
  // =========================================================================
  const G_MAG = 9810;                 // mm/s^2
  const DEFAULT_DENSITY = 1.0e-6;     // kg/mm^3 (~1 g/cm^3 — a light rubber/wood ball)
  const DEFAULT_RESTITUTION = 0.28;
  const DEFAULT_FRICTION = 0.92;      // combined ball/skin Coulomb coefficient
  const SUBSTEP_DT = 1 / 240;         // fixed substep, so a step's outcome is frame-rate independent
  const MAX_SUBSTEPS = 8;
  const MAX_DT = 0.1;                 // guard against a stalled caller handing us a huge dt
  const SOLVER_ITERS = 4;             // Gauss-Seidel sweeps per substep
  const REST_LIN_EPS = 3.0;           // mm/s
  const REST_ANG_EPS = 3.0;           // rad/s
  const REST_TIME = 0.12;             // s below both thresholds before sleeping
  const RESTITUTION_VEL_FLOOR = 45;   // mm/s — slower closing speeds bounce inelastically
  const WAKE_HAND_SPEED = 1.5;        // mm/s of hand-surface motion that wakes a sleeping ball
  const SPEC_MARGIN = 2.0;            // mm — speculative contact margin so fast approach isn't missed
  const PALM_COMPLIANCE = 0.85;       // the palm's pad is not a wall (cf. palmSamples in 30-pose.js)
  const CONTACT_EMA_ALPHA = 0.35;     // low-pass on exposed contact depth/force/position
  const CONTACT_GRACE = 0.10;         // s a contact is kept alive after it stops being detected
  const CONTACT_MIN_DEPTH = 0.01;     // mm — below this a contact isn't worth publishing
  const FORCE_SI = 1e-3;              // (kg*mm/s^2) -> N
  const FORCE_TO_YIELD_MM = 3.2;      // mm of give at the contact point, saturating (see reactToHand)
  const FORCE_SAT = 3.5;              // N — force at which that yield is ~63% saturated
  const ANGULAR_DAMPING = 1.0;        // 1/s - see the note beside its use in step()

  const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  // =========================================================================
  //  QUATERNION — [w,x,y,z]. Kept local: 00-math.js has no rotation type
  //  beyond the 3x3 frames the rig already uses, and a ball spinning under
  //  friction needs an orientation cheap enough to integrate every substep.
  // =========================================================================
  function qIdent() { return [1, 0, 0, 0]; }
  function qNormalize(q) {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  }
  function qMul(a, b) {
    return [
      a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
      a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
      a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
      a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
    ];
  }
  /** semi-implicit integration of orientation by angular velocity w over dt */
  function qIntegrate(q, w, h) {
    const wq = [0, w[0] * h, w[1] * h, w[2] * h];
    const dq = qMul(wq, q);
    return qNormalize([q[0] + dq[0] * 0.5, q[1] + dq[1] * 0.5, q[2] + dq[2] * 0.5, q[3] + dq[3] * 0.5]);
  }
  /** rotate a world vector by q (Fabian Giesen's optimised form) */
  function qRotate(q, v) {
    const qv = [q[1], q[2], q[3]];
    const t = vmul(vcross(qv, v), 2);
    return vadd(vadd(v, vmul(t, q[0])), vcross(qv, t));
  }
  /** the ball's own frame in world space, as [ex,ey,ez] — GK.math's mApply convention */
  function orientationFrame(state) {
    return [qRotate(state.q, [1, 0, 0]), qRotate(state.q, [0, 1, 0]), qRotate(state.q, [0, 0, 1])];
  }

  // =========================================================================
  //  STATE
  // =========================================================================

  /**
   * A new ball. Mass follows from radius and density like a real object's
   * would, rather than being handed in independently of its size.
   */
  function createState(opts) {
    opts = opts || {};
    const r = opts.r === undefined ? 26 : opts.r;
    const density = opts.density === undefined ? DEFAULT_DENSITY : opts.density;
    const mass = Math.max(1e-6, density * (4 / 3) * Math.PI * r * r * r);
    const I = 0.4 * mass * r * r;            // solid sphere: (2/5) m r^2
    return {
      C: (opts.C || [0, 0, 0]).slice(),
      v: (opts.v || [0, 0, 0]).slice(),
      q: (opts.q || qIdent()).slice(),
      w: (opts.w || [0, 0, 0]).slice(),
      r, mass, invMass: 1 / mass, invI: 1 / I,
      restitution: opts.restitution === undefined ? DEFAULT_RESTITUTION : opts.restitution,
      friction: opts.friction === undefined ? DEFAULT_FRICTION : opts.friction,
      down: opts.down ? vnorm(opts.down) : null,
      asleep: false, _restT: 0, _simTime: 0,
      _prevRig: null, _palmUV: null, _ema: new Map(),
      contacts: [], netContactForce: [0, 0, 0], lastStepMs: 0, lastSubsteps: 0
    };
  }

  /** (Re-)anchor "down" from a rig's own frame — see the file header. */
  function setGravityFromRig(state, rig) {
    state.down = vnorm(vmul(rig.root[0], -1));
    state.asleep = false; state._restT = 0;
    return state.down;
  }

  /** Nudge a sleeping ball back into the solver without touching gravity. */
  function wake(state) { state.asleep = false; state._restT = 0; }

  // =========================================================================
  //  CONTACT GEOMETRY — sampled fresh from the rig each step(), cached for
  //  the substeps within it (the hand doesn't move mid-step; only the ball
  //  does). This is deliberately the same simplification gatherContacts and
  //  ballContacts already use in 30-pose.js: one capsule per rendered
  //  segment, radius averaged from segmentProfile — not a fresh union of
  //  cross-sections. It is proven cheap enough there for a settle loop run
  //  20 times over; here it runs a handful of times per frame.
  // =========================================================================

  function closestOnSeg(A, B, P) {
    const AB = vsub(B, A);
    const L2 = vdot(AB, AB);
    let t = L2 > 1e-9 ? vdot(vsub(P, A), AB) / L2 : 0;
    t = clamp(t, 0, 1);
    return { Q: vmad(A, AB, t), t };
  }

  function buildDigitCapsules(A, rig, ballC) {
    const caps = [];
    for (let d = 0; d < 5; d++) {
      for (const sg of rig.digits[d].segs) {
        // A finger's segment 0 is its metacarpal, which lives inside the
        // palm - the palm contact already answers for it, and giving it its
        // own capsule as well would just double-count the same flesh. The
        // thumb's segment 0 is not that: it is the thenar mass, out on its
        // own away from the palm sheet, and ballContacts (30-pose.js) already
        // treats it as a contact in its own right for exactly that reason.
        // Skipping it here too - as this used to, uniformly - leaves the
        // thumb's own base with no physics capsule at all, and a ball
        // released near a still-closing thumb sails straight through it:
        // measured on this file's own test data, over 11mm of a 26mm ball
        // through the thenar before this fix, zero after.
        if (!sg.rendered || (sg.seg < 1 && d !== 0)) continue;
        // dorsopalmar half-depth (index 1), the same choice ballContacts
        // makes for ball-vs-digit — the width that actually meets a ball
        // pressed against the front or back of a finger, not its flanks.
        const r = (AN.segmentProfile(A, d, sg.seg, 0.2)[1] + AN.segmentProfile(A, d, sg.seg, 0.8)[1]) * 0.5;
        const { t } = closestOnSeg(sg.A, sg.B, ballC);
        caps.push({ d, seg: sg.seg, A: sg.A, B: sg.B, r: Math.max(1.5, r), t });
      }
    }
    return caps;
  }

  const PALM_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  /**
   * Closest point on the palm's smooth (u,v) sheet to a world point: a coarse
   * grid over the whole sheet (cheap enough, next to the substep loop below,
   * to just always run — this is not the place to economise) plus last
   * frame's answer as an extra seed, then coordinate-descent refinement. A
   * warm-start-only search was tried first and quietly lost real, thin
   * contacts on a fast-moving ball: the greedy descent can settle into a
   * local minimum in the few iterations available and never find the true
   * closest point again. Re-scanning every call costs a fraction of a
   * millisecond and cannot get stuck. Contact IDENTITY doesn't depend on
   * exactly which (u,v) this converges to — every palm contact is exposed
   * under the one 'palm' key (see publishContacts) — so re-seeding here
   * cannot itself cause the flicker that identity would.
   */
  function palmClosest(rig, C, warmUV) {
    let u, v, bestD = Infinity;
    for (let iu = 0; iu <= 14; iu++) {
      const uu = lerp(-0.3, 1.1, iu / 14);
      const lo = rig.palm.vLo(uu), hi = rig.palm.vHi(uu);
      for (let iv = 0; iv <= 12; iv++) {
        const vv = lerp(lo, hi, iv / 12);
        const d = vdist(RG.palmSpine(rig, uu, vv).P, C);
        if (d < bestD) { bestD = d; u = uu; v = vv; }
      }
    }
    if (warmUV) {
      const uu = clamp(warmUV[0], -0.5, 1.15);
      const vv = clamp(warmUV[1], rig.palm.vLo(uu) + 0.02, rig.palm.vHi(uu) - 0.02);
      const d = vdist(RG.palmSpine(rig, uu, vv).P, C);
      if (d < bestD) { bestD = d; u = uu; v = vv; }
    }
    let step = 0.05;
    for (let pass = 0; pass < 12 && step > 0.0004; pass++) {
      let improved = false;
      for (const [du, dv] of PALM_DIRS) {
        const uu = clamp(u + du * step, -0.5, 1.15);
        const vv = clamp(v + dv * step, rig.palm.vLo(uu) + 0.02, rig.palm.vHi(uu) - 0.02);
        const d = vdist(RG.palmSpine(rig, uu, vv).P, C);
        if (d < bestD - 1e-9) { bestD = d; u = uu; v = vv; improved = true; }
      }
      if (!improved) step *= 0.5;
    }
    const sp = RG.palmSpine(rig, u, v);
    return { u, v, P: sp.P, n: sp.n };
  }

  /** live contact candidates against the ball's CURRENT position, given the
   *  per-step capsule/palm cache — cheap enough to call once a substep. */
  function gatherLive(state, capsules, palmPoint) {
    const C = state.C, r = state.r;
    const list = [];
    const off = vdot(vsub(C, palmPoint.P), palmPoint.n);
    const depthP = (palmPoint.thick + r) - off;
    if (depthP > -SPEC_MARGIN && off > -8) {
      list.push({
        kind: 'palm', u: palmPoint.u, v: palmPoint.v, n: palmPoint.n, depth: depthP,
        Phand: vmad(palmPoint.P, palmPoint.n, palmPoint.thick)
      });
    }
    for (const cap of capsules) {
      const { Q } = closestOnSeg(cap.A, cap.B, C);
      const dist = vdist(C, Q);
      if (dist < 1e-6) continue;
      const n = vmul(vsub(C, Q), 1 / dist);
      const depth = (cap.r + r) - dist;
      if (depth > -SPEC_MARGIN) {
        list.push({ kind: 'digit', d: cap.d, seg: cap.seg, n, depth, Phand: vmad(Q, n, cap.r) });
      }
    }
    return list;
  }

  // =========================================================================
  //  IMPULSE SOLVER — sequential impulses, accumulated and clamped per
  //  contact within a substep (Gauss-Seidel across contacts so a ball
  //  touching the palm and three fingers at once has them all agree).
  //
  //  Normal impulse needs no rotational coupling: the sphere's lever arm to
  //  any contact point is r*(-n), parallel to n, so a purely normal force
  //  produces no torque. Friction's lever arm is perpendicular to n (it acts
  //  along the tangent), and that is what makes the ball roll: the effective
  //  mass for the tangential impulse works out to invMass + invI*r^2, which
  //  for a solid sphere is 7/(2m) — the classic rolling-sphere factor.
  //
  //  Velocity here is solved as though the hand were momentarily static at
  //  each contact. A real closing or tilting hand still reaches the ball:
  //  contacts are re-detected from the moving surface every substep (see
  //  gatherLive), so a finger that has advanced 0.3mm since the last substep
  //  shows up as 0.3mm more penetration right now, and the same non-
  //  penetration constraint below pushes the ball out of that — which is
  //  what carries it along as the hand closes. What this deliberately does
  //  NOT do is also hand the ball the contact point's own velocity as
  //  momentum: that was tried (finite-differencing the closest point frame
  //  to frame) and cost more than it bought. The closest point on a capsule
  //  or the palm sheet does not track one fixed patch of skin — it is
  //  recomputed from wherever the ball is now — so differencing it measures
  //  the drift of a moving target, not a surface's true velocity, and under
  //  a full grip (six to eight contacts, all changing together as fingers
  //  close) that noise compounded into a runaway within a few dozen frames,
  //  every way it was weighted in. The plain constraint below has no such
  //  term to go wrong and settles a closing grip to within 1% of net force
  //  balancing weight; see updateSleep for how standing penetration is kept
  //  from ever growing once the ball is actually at rest.
  // =========================================================================
  function solveContactsSubstep(state, contacts, iters) {
    const invM = state.invMass, invI = state.invI, r = state.r, mu = state.friction, mass = state.mass;
    for (const c of contacts) {
      c._jn = 0; c._jt = 0;
      c._rVec = vmul(c.n, -r);
      const vPoint = vadd(state.v, vcross(state.w, c._rVec));
      const vn0 = vdot(vPoint, c.n);
      const e = (vn0 > -RESTITUTION_VEL_FLOOR) ? 0 : state.restitution;
      // No Baumgarte-style depth bias here. Two shapes of it were tried —
      // an independent post-substep push on state.C, and a bias folded into
      // this same accumulated normal impulse — and both destabilised a full
      // grip: six to eight simultaneous contacts, their depths all changing
      // together as the fingers close, and both approaches went into a
      // runaway within a few dozen frames every time, however small the
      // correction was made per application. The plain velocity constraint
      // below does not have that failure mode and turns out not to need the
      // help: resting depth is whatever this converges to under load, held
      // there by the constraint itself rather than trimmed back by a second
      // system, and once asleep (see updateSleep) it never has the chance to
      // creep further. See the header note above this function.
      c._desired = vn0 < 0 ? -e * vn0 : 0;
    }
    const kt = invM + invI * r * r;
    for (let it = 0; it < iters; it++) {
      for (const c of contacts) {
        const n = c.n, rVec = c._rVec;
        // ---- normal ----
        let vPoint = vadd(state.v, vcross(state.w, rVec));
        let vn = vdot(vPoint, n);
        let dPn = (c._desired - vn) * mass;
        let newJn = Math.max(0, c._jn + dPn);
        dPn = newJn - c._jn; c._jn = newJn;
        state.v = vmad(state.v, n, dPn * invM);
        // ---- friction (Coulomb cone sized off the normal impulse) ----
        vPoint = vadd(state.v, vcross(state.w, rVec));
        const vt = vsub(vPoint, vmul(n, vdot(vPoint, n)));
        const vtLen = vlen(vt);
        if (vtLen > 1e-6 && c._jn > 0) {
          const tDir = vmul(vt, 1 / vtLen);
          let dPt = -vtLen / kt;
          const maxT = mu * c._jn;
          let newJt = clamp(c._jt + dPt, -maxT, maxT);
          dPt = newJt - c._jt; c._jt = newJt;
          state.v = vmad(state.v, tDir, dPt * invM);
          state.w = vadd(state.w, vmul(vcross(rVec, vmul(tDir, dPt)), invI));
        }
      }
    }
  }

  function updateSleep(state, dt) {
    const lin = vlen(state.v), ang = vlen(state.w);
    if (lin < REST_LIN_EPS && ang < REST_ANG_EPS) {
      state._restT += dt;
      if (state._restT > REST_TIME) { state.asleep = true; state.v = [0, 0, 0]; state.w = [0, 0, 0]; }
    } else state._restT = 0;
  }

  // =========================================================================
  //  EXPOSED CONTACTS — the input the surface deformation reads. Identity is
  //  (d,seg) for a digit or the single palm point, which is exactly what
  //  keeps this stable: there is at most one contact per rendered segment and
  //  one for the palm, so the SET rarely changes shape frame to frame, and an
  //  EMA per identity (plus a short grace period before an identity is
  //  dropped) smooths what does move so a squeeze reads as a settling field
  //  rather than a flicker.
  // =========================================================================
  function publishContacts(state, ctx, dt) {
    const { capsules, palmPoint, accumJn } = ctx;
    const fresh = gatherLive(state, capsules, palmPoint);
    const seen = new Set();
    for (const c of fresh) {
      if (c.depth <= CONTACT_MIN_DEPTH) continue;
      const key = c.kind === 'palm' ? 'palm' : ('digit_' + c.d + '_' + c.seg);
      seen.add(key);
      const jn = c.kind === 'palm' ? accumJn.palm : (accumJn.digit[key] || 0);
      const fRaw = Math.max(0, (jn / dt) * FORCE_SI);
      let ema = state._ema.get(key);
      if (!ema) {
        ema = { depth: c.depth, f: fRaw, P: c.Phand.slice(), n: c.n.slice() };
      } else {
        const a = CONTACT_EMA_ALPHA;
        ema.depth = lerp(ema.depth, c.depth, a);
        ema.f = lerp(ema.f, fRaw, a);
        ema.P = vlerp(ema.P, c.Phand, a);
        ema.n = vnorm(vlerp(ema.n, c.n, a));
      }
      ema.seenAt = state._simTime;
      ema.part = c.kind === 'palm' ? { kind: 'palm', u: c.u, v: c.v } : { kind: 'digit', d: c.d, seg: c.seg };
      state._ema.set(key, ema);
    }
    const out = [];
    for (const [key, ema] of state._ema) {
      if (!seen.has(key)) {
        if (state._simTime - ema.seenAt > CONTACT_GRACE) { state._ema.delete(key); continue; }
      }
      out.push({ P: ema.P.slice(), n: ema.n.slice(), depth: ema.depth, f: ema.f, part: ema.part });
    }
    state.contacts = out;
  }

  // =========================================================================
  //  STEP — a fixed-substep integrator so the resting position, the settle
  //  time and the fall all come out the same whether the caller runs at 30,
  //  60 or 144 fps; only how many substeps get spent to cover dt changes.
  // =========================================================================
  function step(state, rig, dt) {
    const t0 = now();
    if (!(dt > 0)) { state.lastStepMs = 0; return state; }
    dt = Math.min(dt, MAX_DT);
    state._simTime += dt;
    const A = rig.anatomy;
    if (state.down == null) setGravityFromRig(state, rig);

    const capsules = buildDigitCapsules(A, rig, state.C);
    const palmHit = palmClosest(rig, state.C, state._palmUV);
    state._palmUV = [palmHit.u, palmHit.v];
    const palmPoint = {
      u: palmHit.u, v: palmHit.v, P: palmHit.P, n: palmHit.n,
      thick: RG.palmThickPalmar(A, palmHit.u, palmHit.v) * PALM_COMPLIANCE
    };
    const prevRig = state._prevRig;

    // ---- asleep: stay put unless the hand has moved or support vanished ---
    if (state.asleep) {
      const live = gatherLive(state, capsules, palmPoint);
      let held = false;
      for (const c of live) if (c.depth > 0.02) held = true;
      let disturbed = !held;
      // geometric disturbance only (never fed into the impulse solve, see
      // the note above solveContactsSubstep) - just "has the hand actually
      // moved enough to be worth re-checking", so a sleeping ball wakes when
      // fingers open or the hand tilts even though nothing has hit it yet
      if (!disturbed && prevRig) {
        const dt2 = dt > 0 ? dt : 1;
        disturbed = vdist(palmHit.P, RG.palmSpine(prevRig, palmHit.u, palmHit.v).P) / dt2 > WAKE_HAND_SPEED;
        for (let i = 0; i < capsules.length && !disturbed; i++) {
          const cap = capsules[i];
          const old = prevRig.digits[cap.d] && prevRig.digits[cap.d].segs[cap.seg];
          if (old && vdist(vlerp(cap.A, cap.B, cap.t), vlerp(old.A, old.B, cap.t)) / dt2 > WAKE_HAND_SPEED) disturbed = true;
        }
      }
      if (!disturbed) {
        state._prevRig = rig; state.lastStepMs = now() - t0; state.lastSubsteps = 0;
        return state;                 // state.contacts is untouched: already settled
      }
      wake(state);
    }

    // ---- active integration, fixed substeps -------------------------------
    const nSub = Math.min(MAX_SUBSTEPS, Math.max(1, Math.round(dt / SUBSTEP_DT)));
    const h = dt / nSub;
    const accumJn = { palm: 0, digit: Object.create(null) };
    let impulseAccum = [0, 0, 0];        // normal + friction, every contact, this whole step()
    for (let s = 0; s < nSub; s++) {
      state.v = vmad(state.v, state.down, G_MAG * h);
      const live = gatherLive(state, capsules, palmPoint);
      const vBefore = state.v;
      solveContactsSubstep(state, live, SOLVER_ITERS);
      impulseAccum = vmad(impulseAccum, vsub(state.v, vBefore), state.mass);
      for (const c of live) {
        if (c.kind === 'palm') accumJn.palm += c._jn;
        else accumJn.digit['digit_' + c.d + '_' + c.seg] = (accumJn.digit['digit_' + c.d + '_' + c.seg] || 0) + c._jn;
      }
      // A resting multi-contact ball can settle its LINEAR velocity to a
      // dead stop while very slightly, persistently gaining spin: friction
      // here only cancels slip that is already showing up at a contact, not
      // the slip gravity is about to introduce over the rest of this
      // substep, and with several contacts at once the residual from each
      // can combine into a genuine (if tiny) net torque none of them sees
      // individually. Real static friction would zero that; this one-line
      // damping stands in for that missing proactive term. It can only ever
      // shrink |w|, never grow it, so unlike the position-correction and
      // reactToHand-at-full-strength failures documented above, it has no
      // runaway mode to reopen — and it is far too gentle (a few tenths of a
      // percent per substep) to visibly slow an actually rolling ball over
      // the second-or-so a tilt or a fall plays out in.
      state.w = vmul(state.w, Math.max(0, 1 - ANGULAR_DAMPING * h));
      state.C = vmad(state.C, state.v, h);
      state.q = qIntegrate(state.q, state.w, h);
    }
    // the total force (normal + Coulomb friction, summed over every contact)
    // the hand actually exerted on the ball this frame — the honest way to
    // check "is friction plus normal force what's holding this up", since a
    // side-pinched ball can be held almost entirely by friction with very
    // little of it in the normal direction at all.
    state.netContactForce = vmul(impulseAccum, (1 / dt) * FORCE_SI);

    publishContacts(state, { capsules, palmPoint, accumJn }, dt);
    updateSleep(state, dt);
    state._prevRig = rig;
    state.lastStepMs = now() - t0; state.lastSubsteps = nSub;
    return state;
  }

  // =========================================================================
  //  HAND REACTION — reads back exactly like applyContacts (30-pose.js):
  //  same jointDofs, same Jacobian-transpose pseudo-inverse step, same
  //  per-joint compliance weights. The difference is what drives it: not
  //  penetration depth (there mostly isn't any once the ball solver is
  //  running) but the contact FORCE this step actually produced, saturating
  //  so a hard squeeze yields more than a light rest but never unhinges a
  //  joint. Palm force gets a small direct nudge on the arch — the one
  //  compliant DOF jointDofs doesn't reach — so a heavy ball presses the cup
  //  flatter, not just the fingers wider.
  // =========================================================================
  function reactToHand(A, pose, rig, contacts, opts) {
    opts = opts || {};
    const kappa = opts.kappa === undefined ? 1 : opts.kappa;
    const archYield = opts.archYield === undefined ? 0.5 : opts.archYield;
    const p = JSON.parse(JSON.stringify(pose));
    let palmF = 0;
    for (const c of contacts) {
      if (c.part.kind === 'palm') { palmF = Math.max(palmF, c.f); continue; }
      const d = c.part.d, seg = c.part.seg;
      const dofs = PO.jointDofs(rig, p, d).filter(x => x.seg <= seg);
      if (!dofs.length) continue;
      const g = new Array(dofs.length);
      let sum = 0;
      for (let i = 0; i < dofs.length; i++) {
        const x = dofs[i];
        g[i] = vdot(vcross(x.axis, vsub(c.P, x.O)), c.n);
        sum += x.w * g[i] * g[i];
      }
      if (sum < 1e-7) continue;
      // yieldAmt is in the SAME units g[i] is - mm of point displacement
      // along the contact normal - exactly like applyContacts' lambda*depth,
      // so this reuses that same pseudo-inverse honestly rather than in
      // name only: a target expressed directly in radians here would be
      // solved for as though it were millimetres of relief and come out
      // roughly (typical lever arm in mm) times too small.
      const yieldAmt = kappa * FORCE_TO_YIELD_MM * Math.tanh(c.f / FORCE_SAT);
      const k = yieldAmt / sum;
      for (let i = 0; i < dofs.length; i++) dofs[i].add(k * dofs[i].w * g[i]);
    }
    if (palmF > 0) p.arch = clamp01(p.arch - archYield * 0.12 * Math.tanh(palmF / FORCE_SAT));
    return PO.clampPose(A, p);
  }

  // =========================================================================
  //  DIAGNOSTICS
  // =========================================================================
  function energy(state) {
    const keLin = 0.5 * state.mass * vdot(state.v, state.v);
    const I = 0.4 * state.mass * state.r * state.r;
    const keAng = 0.5 * I * vdot(state.w, state.w);
    const heightUp = state.down ? -vdot(state.C, state.down) : 0;
    const pe = state.mass * G_MAG * heightUp;
    return { keLin, keAng, ke: keLin + keAng, pe, total: keLin + keAng + pe };
  }

  GK.physics = {
    G: G_MAG, SUBSTEP_DT, MAX_SUBSTEPS,
    createState, setGravityFromRig, wake, step, reactToHand, energy, orientationFrame,
    qIdent, qMul, qNormalize, qRotate, qIntegrate
  };
})(window.GK = window.GK || {});

/* ============================================================================
   GRAPHITE KINEMATICS — 40 · pencil
   A graphite deposition field. Marks are not composited, they are *added*:
   density accumulates into a float buffer and is tone-mapped once, at the end,
   through a saturating response. Overlapping passes therefore darken exactly
   as layered graphite darkens, and never as stacked opacity.
   ========================================================================== */
(function (GK) {
  'use strict';
  const M = GK.math;
  const { clamp, clamp01, lerp, smoothstep } = M;

  // Pencil grades: nib radius, deposit strength, grain break-up, wobble scale.
  //            2H     H      HB      B      2B      4B      6B
  const GRADES = [
    { name: '2H', nib: 0.46, dep: 0.52, grain: 0.86, wob: 0.62 },
    { name: 'H', nib: 0.55, dep: 0.66, grain: 0.78, wob: 0.72 },
    { name: 'HB', nib: 0.68, dep: 0.82, grain: 0.68, wob: 0.85 },
    { name: 'B', nib: 0.84, dep: 1.00, grain: 0.58, wob: 1.00 },
    { name: '2B', nib: 1.02, dep: 1.20, grain: 0.48, wob: 1.16 },
    { name: '4B', nib: 1.28, dep: 1.46, grain: 0.38, wob: 1.34 },
    { name: '6B', nib: 1.62, dep: 1.78, grain: 0.30, wob: 1.55 }
  ];

  function gradeAt(x) {
    const f = clamp(x, 0, GRADES.length - 1.001);
    const i = Math.floor(f), t = f - i;
    const a = GRADES[i], b = GRADES[Math.min(GRADES.length - 1, i + 1)];
    return {
      name: t < 0.5 ? a.name : b.name,
      nib: lerp(a.nib, b.nib, t), dep: lerp(a.dep, b.dep, t),
      grain: lerp(a.grain, b.grain, t), wob: lerp(a.wob, b.wob, t)
    };
  }

  class Graphite {
    /**
     * @param w,h  logical canvas size
     * @param ss   supersample factor (1 for draft, 2 for the finished plate)
     */
    constructor(w, h, ss, seed) {
      this.resize(w, h, ss, seed);
    }

    resize(w, h, ss, seed) {
      ss = Math.max(1, Math.round(ss || 1));
      const W = Math.round(w * ss), H = Math.round(h * ss);
      if (this.W === W && this.H === H && this.seed === seed) { this.clear(); return this; }
      this.w = w; this.h = h; this.ss = ss; this.W = W; this.H = H; this.seed = seed;
      this.buf = new Float32Array(W * H);
      this.rgba = new Uint8ClampedArray(w * h * 4);
      // which 32×32 (supersampled px) tiles the pencil has been in: everywhere else is still +0
      this.TW = Math.ceil(W / 32); this.TH = Math.ceil(H / 32);
      this.touched = new Uint8Array(this.TW * this.TH);
      this._clean();
      this._buildPaper();
      return this;
    }

    /** paper tooth: fine grain over a coarse undulation, generated once */
    _buildPaper() {
      const { W, H } = this;
      const n = new M.Noise(this.seed ^ 0x5f3a);
      // coarse undulation at 1/4 resolution, bilinearly upsampled
      const CW = Math.ceil(W / 4) + 2, CH = Math.ceil(H / 4) + 2;
      const coarse = new Float32Array(CW * CH);
      for (let y = 0; y < CH; y++) {
        for (let x = 0; x < CW; x++) {
          coarse[y * CW + x] = n.fbm(x * 0.055, y * 0.055, 3.7, 3, 0.55, 2.1);
        }
      }
      const tooth = new Float32Array(W * H);
      // deterministic per-pixel hash for the tooth itself
      const s0 = (this.seed >>> 0) || 1;
      for (let y = 0; y < H; y++) {
        const cy = y / 4, y0 = cy | 0, fy = cy - y0;
        for (let x = 0; x < W; x++) {
          const cx = x / 4, x0 = cx | 0, fx = cx - x0;
          const c00 = coarse[y0 * CW + x0], c10 = coarse[y0 * CW + x0 + 1];
          const c01 = coarse[(y0 + 1) * CW + x0], c11 = coarse[(y0 + 1) * CW + x0 + 1];
          const c = lerp(lerp(c00, c10, fx), lerp(c01, c11, fx), fy);
          let hsh = (x * 374761393 + y * 668265263 + s0 * 2246822519) >>> 0;
          hsh = (hsh ^ (hsh >>> 13)) >>> 0;
          hsh = Math.imul(hsh, 1274126177) >>> 0;
          const fine = ((hsh ^ (hsh >>> 16)) >>> 0) / 4294967296;
          tooth[y * W + x] = 0.34 + 0.52 * fine + 0.42 * c;
        }
      }
      this.tooth = tooth;
      this.noise = n;
      return this;
    }

    /**
     * Only splat() puts graphite down, so the field is bare outside the box it has touched
     * (supersampled px, inclusive): clearing, and reading the drawing back, need go no further.
     */
    _clean() { this.dx0 = this.W; this.dy0 = this.H; this.dx1 = -1; this.dy1 = -1; }
    clear() {
      const { buf, W, dx0, dx1 } = this;
      for (let y = this.dy0; y <= this.dy1; y++) buf.fill(0, y * W + dx0, y * W + dx1 + 1);
      this.touched.fill(0);
      this._clean();
      return this;
    }
    /** the touched box in logical px, inclusive; null while the sheet is bare */
    dirty() {
      if (this.dx1 < 0) return null;
      const ss = this.ss;
      return { x0: (this.dx0 / ss) | 0, y0: (this.dy0 / ss) | 0, x1: (this.dx1 / ss) | 0, y1: (this.dy1 / ss) | 0 };
    }

    /**
     * How much graphite already sits around a point, in logical canvas
     * pixels, read back through the same saturating response resolve() ends
     * on — so it reads on a plain 0 (bare paper) .. 1 (solid) scale no
     * matter the grade or supersampling that put it there. A small-radius
     * mean rather than a single-cell probe, because the question is "is
     * this neighbourhood getting crowded", not "is this exact pixel dark":
     * a single fresh line under its own nib should not look saturated to
     * itself, but a handful of lines converging within a few pixels should.
     */
    densityAt(x, y, r) {
      const { W, H, buf, ss } = this;
      const R = Math.max(1, Math.round((r === undefined ? 2.5 : r) * ss));
      const cx = Math.round(x * ss), cy = Math.round(y * ss);
      const x0 = Math.max(0, cx - R), x1 = Math.min(W - 1, cx + R);
      const y0 = Math.max(0, cy - R), y1 = Math.min(H - 1, cy + R);
      if (x1 < x0 || y1 < y0) return 0;
      // bare cells are +0 and add nothing: sum only where the pencil has been (same order, same sum)
      // and inside it, only the tiles it has been in (adding +0 leaves a sum exactly as it was)
      const ya = Math.max(y0, this.dy0), yb = Math.min(y1, this.dy1), xa = Math.max(x0, this.dx0), xb = Math.min(x1, this.dx1);
      const T = this.touched, TW = this.TW, txa = xa >> 5, txb = xb >> 5;
      let sum = 0;
      for (let yy = ya; yy <= yb; yy++) {
        const row = yy * W, trow = (yy >> 5) * TW;
        for (let tx = txa; tx <= txb; tx++) {
          if (!T[trow + tx]) continue;
          const xs = tx << 5, a = xs > xa ? xs : xa, b = xs + 31 < xb ? xs + 31 : xb;
          for (let xx = a; xx <= b; xx++) sum += buf[row + xx];
        }
      }
      const mean = sum / ((x1 - x0 + 1) * (y1 - y0 + 1));
      return 1 - Math.exp(-1.55 * mean);
    }

    /** deposit into the field; x,y in supersampled space */
    splat(x, y, r, amt) {
      const { W, H, buf, tooth } = this;
      if (!(amt > 0)) return;
      const rr = r * r;
      const R = Math.ceil(r);
      const x0 = Math.max(0, (x - R) | 0), x1 = Math.min(W - 1, (x + R + 1) | 0);
      const y0 = Math.max(0, (y - R) | 0), y1 = Math.min(H - 1, (y + R + 1) | 0);
      if (x1 < x0 || y1 < y0) return;
      if (x0 < this.dx0) this.dx0 = x0; if (x1 > this.dx1) this.dx1 = x1;
      if (y0 < this.dy0) this.dy0 = y0; if (y1 > this.dy1) this.dy1 = y1;
      const T = this.touched, TW = this.TW;
      for (let ty = y0 >> 5, tye = y1 >> 5; ty <= tye; ty++) for (let tx = x0 >> 5, txe = x1 >> 5; tx <= txe; tx++) T[ty * TW + tx] = 1;
      // quartic kernel, normalised so peak deposit is independent of radius
      const k = amt * 3.05 / (rr + 0.35);
      for (let yy = y0; yy <= y1; yy++) {
        const dy = yy + 0.5 - y;
        const row = yy * W;
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx + 0.5 - x;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr) continue;
          const t = 1 - d2 / rr;
          const i = row + xx;
          buf[i] += k * t * t * tooth[i];
        }
      }
    }

    /**
     * Lay a stroke along a 2-D polyline.
     * pts     [[x,y],...] in logical canvas pixels
     * o.tone      base darkness 0..1+
     * o.weight    nib radius multiplier
     * o.passes    overlapping passes (contour 3, crease 2, detail 1)
     * o.taper     entry/exit lift, 0..1
     * o.wobble    low-frequency deviation in logical px
     * o.jitter    per-pass lateral offset in logical px
     * o.grade     pencil grade descriptor from gradeAt()
     * o.vis       array of per-point visibility 0..1, or a function(i,t)
     * o.press     optional function(t) -> extra pressure
     * o.phase     decorrelates the wobble between strokes
     * o.close     treat the path as closed (no taper)
     */
    stroke(pts, o) {
      if (!pts || pts.length < 2) return;
      o = o || {};
      const ss = this.ss;
      const g = o.grade || gradeAt(3);
      const tone = (o.tone === undefined ? 1 : o.tone) * g.dep;
      if (tone <= 0.0015) return;
      const weight = (o.weight === undefined ? 1 : o.weight) * g.nib;
      const passes = Math.max(1, o.passes || 1);
      const taper = o.taper === undefined ? 0.55 : o.taper;
      const wobble = (o.wobble === undefined ? 1 : o.wobble) * g.wob;
      const jitter = o.jitter === undefined ? 0.55 : o.jitter;
      const grain = o.grain === undefined ? 1 : o.grain;
      const phase = o.phase || 0;
      const n = this.noise;
      const vis = o.vis, press = o.press;

      // Per-point visibility is supplied against the *incoming* points; the
      // path is about to be resampled, so build an arclength lookup first or
      // occlusion would smear along the whole mark.
      let visAt = null;
      if (vis && typeof vis !== 'function') {
        const srcT = new Float32Array(pts.length);
        let sl = 0;
        for (let i = 1; i < pts.length; i++) {
          sl += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
          srcT[i] = sl;
        }
        if (sl > 1e-9) { for (let i = 0; i < pts.length; i++) srcT[i] /= sl; }
        visAt = (t) => {
          let lo = 0, hi = srcT.length - 1;
          if (t <= 0) return vis[0];
          if (t >= 1) return vis[hi];
          while (hi - lo > 1) { const m = (lo + hi) >> 1; if (srcT[m] <= t) lo = m; else hi = m; }
          const span = srcT[hi] - srcT[lo];
          const f = span > 1e-9 ? (t - srcT[lo]) / span : 0;
          return vis[lo] + (vis[hi] - vis[lo]) * f;
        };
      }

      // resample to a fixed deposition spacing in supersampled space
      const spacing = 0.85;
      const path = M.resample(pts, spacing / ss);
      const NP = path.length;
      if (NP < 2) return;

      // arclength parameter and per-point normals
      const tArr = new Float32Array(NP);
      let L = 0;
      for (let i = 1; i < NP; i++) {
        L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
        tArr[i] = L;
      }
      if (L < 1e-6) return;
      for (let i = 0; i < NP; i++) tArr[i] /= L;

      const Lpx = L * ss;
      // short marks keep their weight; long ones may modulate along the run
      for (let p = 0; p < passes; p++) {
        const ph = phase + p * 17.31;
        // a whole-stroke lateral bias, as if the hand re-entered the line
        const bias = (n.n1(ph * 3.1 + 0.5) - 0.5) * 2 * jitter;
        const passTone = tone * (p === 0 ? 1 : lerp(0.86, 0.52, (p - 1) / Math.max(1, passes - 1)));
        // each pass covers a sub-span, as a searching hand does
        const p0 = p === 0 ? 0 : Math.max(0, (n.n1(ph * 5.7) - 0.55) * 0.30);
        const p1 = p === 0 ? 1 : Math.min(1, 1 - Math.max(0, (n.n1(ph * 5.7 + 9.1) - 0.55) * 0.30));

        for (let i = 0; i < NP; i++) {
          const t = tArr[i];
          if (t < p0 || t > p1) continue;
          const a = path[i], b = path[Math.min(NP - 1, i + 1)], c = path[Math.max(0, i - 1)];
          let dx = b[0] - c[0], dy = b[1] - c[1];
          const dl = Math.hypot(dx, dy) || 1;
          const nx = -dy / dl, ny = dx / dl;

          // low-frequency hand wobble along the run, plus the pass bias
          const wob = (n.n1(t * Lpx * 0.021 + ph) - 0.5) * 2 * wobble * 1.35 +
            (n.n1(t * Lpx * 0.075 + ph * 2.3) - 0.5) * 2 * wobble * 0.42 + bias;

          // pressure: lift at both ends, breathe in the middle
          let pr = 1;
          if (!o.close && taper > 0) {
            const span = clamp01(Math.min(t - p0, p1 - t) / Math.max(0.001, (p1 - p0)));
            const tt = clamp01(Math.min(t - p0, p1 - t) / (o.taperLen || 0.16));
            pr *= lerp(1 - taper, 1, Math.pow(tt, 0.62)) * (0.55 + 0.45 * smoothstep(span * 6));
          }
          pr *= 0.80 + 0.34 * n.n1(t * Lpx * 0.013 + ph * 0.77);
          if (press) pr *= press(t);

          let v = 1;
          if (visAt) v = visAt(t);
          else if (typeof vis === 'function') v = vis(i, t);
          if (v <= 0.002) continue;

          // grain: the nib skips where the paper is low
          const gk = n.n1(t * Lpx * 0.55 + ph * 4.1);
          const skip = g.grain * grain;
          const gmul = clamp01((gk - skip * 0.30) / (1 - skip * 0.30 + 1e-6)) * 0.55 + 0.55;

          const amt = passTone * pr * v * gmul;
          if (amt <= 0.002) continue;
          const rad = Math.max(0.34, weight * (0.80 + 0.42 * pr)) * ss;
          this.splat((a[0] + nx * wob) * ss, (a[1] + ny * wob) * ss, rad, amt * spacing);
        }
      }
    }

    /** a single short tick — cheaper than stroke() for ridges and hair */
    tick(x0, y0, x1, y1, o) {
      this.stroke([[x0, y0], [x1, y1]], o);
    }

    /**
     * Tone-map the density field into RGBA.
     * @param o.paper     [r,g,b] paper colour
     * @param o.ink       [r,g,b] darkest graphite
     * @param o.gamma     response curve of the deposit
     * @param o.k         saturation constant
     * @param o.sheen     specular lift of the very darkest passages
     * @param o.vignette  0..1
     */
    resolve(o) {
      o = o || {};
      const paper = o.paper || [244, 241, 232];
      const ink = o.ink || [26, 25, 23];
      const K = o.k === undefined ? 1.55 : o.k;
      const gamma = o.gamma === undefined ? 1.0 : o.gamma;
      const sheen = o.sheen === undefined ? 0.13 : o.sheen;
      const vig = o.vignette === undefined ? 0.30 : o.vignette;
      const grainAmt = o.paperGrain === undefined ? 0.030 : o.paperGrain;
      const { w, h, ss, W, buf, tooth, rgba } = this;
      const inv = 1 / (ss * ss);
      const cx = w * 0.5, cy = h * 0.5;
      const maxR = Math.hypot(cx, cy);
      // slightly cool, slightly lifted where the deposit is heaviest
      const sheenR = 62, sheenG = 64, sheenB = 72;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let d = 0;
          if (ss === 1) {
            d = buf[y * W + x];
          } else {
            for (let sy = 0; sy < ss; sy++) {
              const row = (y * ss + sy) * W + x * ss;
              for (let sx = 0; sx < ss; sx++) d += buf[row + sx];
            }
            d *= inv;
          }
          let v = 1 - Math.exp(-K * d);
          if (gamma !== 1) v = Math.pow(v, gamma);

          // paper: tooth grain and a soft vignette
          const tt = tooth[Math.min(W - 1, x * ss) + Math.min(this.H - 1, y * ss) * W];
          const pg = 1 - grainAmt * (tt - 0.72);
          const rr = Math.hypot(x - cx, y - cy) / maxR;
          const vg = 1 - vig * 0.16 * Math.pow(clamp01(rr * 1.12), 3.0);

          const sh = sheen * clamp01((v - 0.72) / 0.28);
          const ir = lerp(ink[0], sheenR, sh), ig = lerp(ink[1], sheenG, sh), ib = lerp(ink[2], sheenB, sh);

          const i = (y * w + x) * 4;
          rgba[i] = lerp(paper[0] * pg * vg, ir, v);
          rgba[i + 1] = lerp(paper[1] * pg * vg, ig, v);
          rgba[i + 2] = lerp(paper[2] * pg * vg, ib, v);
          rgba[i + 3] = 255;
        }
      }
      return this.rgba;
    }
  }

  GK.pencil = { Graphite, GRADES, gradeAt };
})(window.GK = window.GK || {});

/* ============================================================================
   GRAPHITE KINEMATICS — 50 · features
   Every crease, fold, nail, print and palmar line, authored as curves in the
   surface parameter space of the rig. Nothing here knows about the camera:
   a fold is a fact about skin, not a mark about a picture.

   Curve records:
     { on:'digit', d, seg, pts:[[s, alpha, offMm?], ...], style }
     { on:'palm',  pts:[[u, beta, offMm?], ...], style }
     { on:'world', pts:[[x,y,z], ...], style }
   ========================================================================== */
(function (GK) {
  'use strict';
  const M = GK.math;
  const AN = GK.anatomy;
  const R = GK.rig;
  const { TAU, DEG, clamp, clamp01, lerp, smoothstep, inv, remap } = M;

  const HALF = Math.PI / 2;
  const PALMAR = -HALF, DORSAL = HALF;

  // ---------------------------------------------------------------- styles
  const S = {
    contour: { tone: 0.92, weight: 1.10, passes: 3, taper: 0.42, wobble: 0.85, jitter: 0.62, layer: 'contour' },
    contourSoft: { tone: 0.52, weight: 0.95, passes: 2, taper: 0.55, wobble: 1.05, jitter: 0.75, layer: 'contour' },
    crease: { tone: 0.74, weight: 0.86, passes: 2, taper: 0.62, wobble: 0.80, jitter: 0.42, layer: 'crease' },
    creaseFine: { tone: 0.40, weight: 0.68, passes: 1, taper: 0.72, wobble: 0.95, jitter: 0.38, layer: 'crease' },
    fold: { tone: 0.34, weight: 0.66, passes: 1, taper: 0.80, wobble: 1.05, jitter: 0.35, layer: 'fold' },
    wrinkle: { tone: 0.26, weight: 0.60, passes: 1, taper: 0.85, wobble: 1.20, jitter: 0.32, layer: 'fold' },
    nail: { tone: 0.60, weight: 0.76, passes: 2, taper: 0.50, wobble: 0.62, jitter: 0.30, layer: 'nail' },
    nailFine: { tone: 0.30, weight: 0.58, passes: 1, taper: 0.70, wobble: 0.70, jitter: 0.26, layer: 'nail' },
    print: { tone: 0.20, weight: 0.46, passes: 1, taper: 0.55, wobble: 0.55, jitter: 0.18, layer: 'print' },
    palmRidge: { tone: 0.13, weight: 0.44, passes: 1, taper: 0.60, wobble: 0.70, jitter: 0.20, layer: 'ridge' },
    palmCrease: { tone: 0.80, weight: 0.98, passes: 2, taper: 0.52, wobble: 0.95, jitter: 0.50, layer: 'palmcrease' },
    palmMinor: { tone: 0.30, weight: 0.62, passes: 1, taper: 0.78, wobble: 1.10, jitter: 0.40, layer: 'palmcrease' },
    tendon: { tone: 0.28, weight: 0.72, passes: 1, taper: 0.88, wobble: 0.90, jitter: 0.45, layer: 'tendon' },
    vein: { tone: 0.22, weight: 0.58, passes: 1, taper: 0.86, wobble: 0.85, jitter: 0.35, layer: 'vein' },
    hair: { tone: 0.21, weight: 0.42, passes: 1, taper: 0.90, wobble: 0.60, jitter: 0.15, layer: 'hair' },
    hatch: { tone: 0.10, weight: 0.40, passes: 1, taper: 0.70, wobble: 0.90, jitter: 0.20, layer: 'hatch' },
    // form modelling: its own layer, because tone that describes a solid is
    // not the same job as the lattice of the skin over it, and must not be
    // turned down with it
    model: { tone: 0.52, weight: 0.54, passes: 1, taper: 0.82, wobble: 1.15, jitter: 0.30, layer: 'model' },
    bone: { tone: 0.30, weight: 0.60, passes: 1, taper: 0.60, wobble: 0.70, jitter: 0.30, layer: 'bone' }
  };
  /**
   * Derive a style. A tone given here is a FACTOR on the base style's tone,
   * not a replacement: that is what keeps the value hierarchy — silhouette
   * over crease over fold over ridge — intact no matter how hard a joint is
   * flexed or how deep a crease has gathered.
   */
  const st = (base, over) => {
    const o = Object.assign({}, base, over || {});
    if (over && over.tone !== undefined && base.tone !== undefined) o.tone = base.tone * over.tone;
    return o;
  };
  // every mark gets its own wobble; shared phases make neighbours twins
  // Every mark gets its own wobble; shared phases make neighbours twins. The
  // counter has to be reset at the start of each drawing, though, and for a
  // long time was not: it ran on across frames, so the same hand in the same
  // pose from the same angle came out with every stroke wobbling differently
  // the second time it was drawn. Measured on a static pose, four percent of
  // pixels changed between two identical renders. In motion that is the whole
  // drawing boiling underneath the movement, which is not the same thing as a
  // hand-drawn line having life in it.
  let PHASE = 0;
  const nextPhase = () => (PHASE = (PHASE + 1) % 100000);
  const resetPhase = () => { PHASE = 0; };

  // --------------------------------------------------------------- helpers
  /** beta on the palm cross-section that lands on across-value v */
  function betaForV(rig, u, v, palmar) {
    const lo = rig.palm.vLo(u), hi = rig.palm.vHi(u);
    const frac = clamp01((v - lo) / (hi - lo));
    const phi = Math.acos(clamp(1 - 2 * frac, -1, 1));
    return palmar === false ? 1 - phi / TAU : phi / TAU;
  }
  /**
   * A palm curve given as (u, v) samples on the palmar or dorsal face. The v
   * values are rebased onto the sheet's live borders, so a feature authored
   * over the thenar stays over the thenar whatever the thumb is doing.
   */
  function palmCurve(rig, uvs, palmar, off) {
    return uvs.map(p => [p[0], betaForV(rig, p[0], rig.palm.mapV(p[0], p[1]), palmar), off || p[2] || 0]);
  }
  /**
   * The first web's own surface, as (t, k): t runs from the depth of the
   * commissure out to the free margin, k across it from thumb to index. The
   * commissure is not part of the palm's sheet - it spans between two rays -
   * so a mark authored in palm coordinates gets rebased onto the palm's own
   * border and lands as a straight line lying across the hand. Marks stand a
   * little proud of the sheet, so it occludes them from behind instead of
   * fighting them for the same depth.
   */
  function webSheet(rig) {
    const w = R.firstWeb(rig, new R.View(0, 0, 0, 1, [0, 0, 0], 0, 0));
    const N = w.thSide.length - 1;
    const prox = M.vnorm(M.vadd(rig.digits[0].segs[1].t, rig.digits[1].segs[1].t));
    let face = M.vnorm(M.vcross(M.vsub(w.ixSide[N], w.thSide[N]),
      M.vsub(w.thSide[N], w.thSide[0])));
    if (M.vdot(face, rig.root[2]) < 0) face = M.vmul(face, -1);
    const at = (t, k, lift) => {
      const f = clamp01(t) * N;
      const i = Math.min(N - 1, Math.floor(f)), fr = f - i;
      const a = M.vlerp(w.thSide[i], w.thSide[i + 1], fr);
      const b = M.vlerp(w.ixSide[i], w.ixSide[i + 1], fr);
      const bow = clamp01(t) * Math.sin(Math.PI * k) * 0.18;
      const base = M.vmad(M.vlerp(a, b, clamp01(k)), prox, -M.vdist(a, b) * bow);
      return M.vmad(base, face, lift || 0);
    };
    // How taut the commissure is, read off the sheet itself rather than off
    // the joint angles that produced it. Opposition and a wrapped grip slacken
    // the web without touching either abduction angle, so an angle-driven
    // guess calls them open when they are gathered.
    const open = smoothstep(inv(M.vdist(w.PT, w.PI) / rig.anatomy.size, 20, 68));
    return { at, open };
  }

  /** sample a smooth curve through (u,v) control points */
  function uvSpline(ctrl, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const fi = (i / n) * (ctrl.length - 1);
      const p = M.splineAt(ctrl.map(c => [c[0], c[1], 0]), fi);
      out.push([p[0], p[1]]);
    }
    return out;
  }

  /** how far into its range a joint is flexed, 0..1 */
  function flexFrac(A, d, jointName, angle) {
    const L = A.limits.digits[d];
    let max = 90 * DEG;
    if (jointName === 'MCP') max = (L.mcp.flex) * DEG;
    else if (jointName === 'PIP') max = (L.pip.flex) * DEG;
    else if (jointName === 'DIP') max = (L.dip.flex) * DEG;
    else if (jointName === 'IP') max = (L.ip.flex) * DEG;
    return clamp01(angle / max);
  }

  // =========================================================================
  //  A · DIGIT JOINT FOLDS
  //  Skin does not stretch, it gathers. On the flexion side one faint line
  //  becomes a bunched sheaf as the joint closes; on the extension side the
  //  wrinkle lattice is drawn taut and erased.
  // =========================================================================

  /** one transverse crease across the palmar face of a digit segment */
  function creaseArc(d, seg, s, span, bow, style, res) {
    const pts = [];
    const n = res || 22;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = PALMAR + (t * 2 - 1) * span;
      const k = 1 - Math.pow(t * 2 - 1, 2);        // 0 at the ends, 1 at centre
      pts.push([s + bow * k, a, -0.32 * k]);        // creases sit *into* the skin
    }
    return { on: 'digit', d, seg, pts, style };
  }

  function digitFolds(rig, out) {
    const A = rig.anatomy;
    const rngRoot = new M.Rng(A.seed ^ 0x1f01);

    for (let d = 0; d < 5; d++) {
      const dg = rig.digits[d];
      const isThumb = d === AN.THUMB;
      const nSeg = dg.segs.length;
      const rng = rngRoot.fork(d * 7 + 3);

      for (let seg = 1; seg < nSeg; seg++) {
        const jn = dg.joints[seg].name;
        const flex = dg.joints[seg].flex;
        const f = flexFrac(A, d, jn, Math.max(0, flex));
        const ext = clamp01(-flex / (30 * DEG));       // hyperextension amount

        // ---- palmar flexion creases -------------------------------------
        // The metacarpophalangeal crease lies *distal* to its own joint, over
        // the base of the proximal phalanx. Almost nobody draws this right.
        const isMCP = (jn === 'MCP');
        const base = isMCP ? 0.235 : (jn === 'PIP' ? 0.055 : 0.075);
        // The proximal interphalangeal joint takes two creases — and so does
        // the thumb's metacarpophalangeal, which is the joint that does the
        // same work in a ray with one fewer bone.
        const twin = (jn === 'PIP') || (isThumb && jn === 'MCP');
        // The thumb's creases wrap further round than a finger's. Its palmar
        // surface is broad and flat where a finger's is round, and it is the
        // one digit whose pad never squarely faces a palmar view, so a crease
        // cut to a finger's arc shows only its middle few degrees and the
        // thumb comes out bare.
        const span = lerp(1.02, 1.30, f) * (isMCP ? 1.16 : 1.0) * (isThumb ? 1.34 : 1.0);
        const bow = (isMCP ? 0.030 : 0.016) * lerp(1, 1.5, f);
        const mainTone = lerp(0.60, 1.0, Math.pow(f, 0.72)) * (isMCP ? 0.94 : 1.0);
        const sJit = () => rng.sym(0.008);

        const primaries = twin ? [base - 0.030, base + 0.034] : [base];
        for (let pi = 0; pi < primaries.length; pi++) {
          out.push(creaseArc(d, seg, primaries[pi] + sJit(), span, bow,
            st(S.crease, { tone: mainTone * (pi === 0 ? 1 : 0.88), phase: nextPhase() })));
        }

        // gathered secondary lines: they multiply and crowd as the joint shuts
        const nExtra = Math.floor(f * 3.4 + (twin ? 0.4 : 0));
        for (let i = 0; i < nExtra; i++) {
          const side = (i % 2 === 0) ? -1 : 1;
          const rank = Math.floor(i / 2) + 1;
          const gap = lerp(0.052, 0.030, f) * rank;
          const sPos = (twin ? (side < 0 ? primaries[0] : primaries[1]) : base) + side * gap + sJit();
          if (sPos < -0.06 || sPos > 0.92) continue;
          out.push(creaseArc(d, seg, sPos, span * lerp(0.86, 0.62, rank / 4), bow * 0.7,
            st(S.creaseFine, {
              tone: lerp(0.42, 1.35, f) * (1 - rank * 0.18),
              phase: nextPhase()
            }), 16));
        }

        // ---- lateral gathering wedges -----------------------------------
        // Where the crease runs out onto the flank the skin puckers into
        // short obliques converging on the crease.
        if (f > 0.12) {
          for (let sideI = 0; sideI < 2; sideI++) {
            const sgn = sideI === 0 ? -1 : 1;
            const nW = 1 + Math.floor(f * 2.6);
            for (let i = 0; i < nW; i++) {
              const a0 = PALMAR + sgn * (span * 0.80 + i * 0.16);
              const pts = [];
              const L = lerp(0.05, 0.11, f) * (1 - i * 0.2);
              for (let k = 0; k <= 6; k++) {
                const t = k / 6;
                pts.push([base + (t - 0.5) * L * 1.4, a0 + sgn * t * 0.30 * (1 - i * 0.15), -0.2]);
              }
              out.push({
                on: 'digit', d, seg, pts,
                style: st(S.fold, { tone: lerp(0.28, 1.30, f) * (1 - i * 0.22), phase: nextPhase() })
              });
            }
          }
        }

        // ---- dorsal extension wrinkles ----------------------------------
        // Present over a straight knuckle, erased as the joint closes.
        const taut = clamp01(1 - f * 1.45) * (1 - ext * 0.35);
        if (taut > 0.05) {
          const rows = A.knuckles.wrinkleRows + (jn === 'MCP' ? 1 : 0);
          const spread = lerp(0.20, 0.38, taut) * (jn === 'MCP' ? 1.35 : 1.0);
          const dspan = lerp(0.62, 1.02, taut) * (jn === 'MCP' ? 1.25 : 1.0);
          for (let i = 0; i < rows; i++) {
            const t = (i + 0.5) / rows + rng.sym(0.10 / rows);
            let useSeg = seg, ss = -spread * 0.5 + spread * t;
            if (ss < 0.012) {
              // a wrinkle set straddles its joint: the proximal half of it
              // belongs to the bone behind. The metacarpophalangeal joint has
              // no drawable bone behind it, so there it stacks distally instead
              // of being dropped, which used to leave the row half-drawn.
              if (seg > 1) { useSeg = seg - 1; ss = 1 + ss; }
              else ss = 0.012 + spread * t * 0.5;
            }
            // Each wrinkle reaches its own distance round the finger, and a
            // different distance each way. Equal arcs at equal spacing read
            // as tape wrapped round the finger, and two rows ruled parallel
            // with a lattice between them read as printed rather than skin.
            const reachL = dspan * rng.range(0.55, 1.10);
            const reachR = dspan * rng.range(0.55, 1.10);
            const drift = rng.sym(0.016);
            // and it bows toward the fingertip in the middle, the way a
            // crease does over a joint that has to open - always the same
            // way, because skin gathers on one side of a hinge, not both
            const bow = lerp(0.012, 0.052, taut) * rng.range(0.7, 1.3);
            const pts = [];
            const NW = 16;
            for (let k = 0; k <= NW; k++) {
              const q = k / NW;
              const x = q * 2 - 1;
              const a = DORSAL + (x < 0 ? x * reachL : x * reachR) + rng.sym(0.012);
              const kk = 1 - x * x;
              pts.push([ss + drift + bow * kk, a, -0.16]);
            }
            out.push({
              on: 'digit', d: d, seg: useSeg, pts,
              style: st(S.wrinkle, {
                tone: lerp(0.20, 1.55, taut) * (0.6 + 0.4 * Math.sin(Math.PI * t)),
                phase: nextPhase()
              })
            });
          }
          // The oblique cross-set that turns the rows into a mesh. Each
          // oblique crosses the joint, so it has to be emitted as two curves -
          // one per bone. Built as a single point list spanning both, the
          // proximal points land at s ~ 0.97 of the WRONG segment and the
          // lattice collapses into a row of brackets at the finger's base.
          //
          // Spaced evenly, slanted alternately and cut to one length, they
          // come out as a row of identical triangles - which is a diagram of
          // skin, not skin. Every one gets its own place, slope, length and
          // height instead, and only some of them get drawn.
          const nObl = Math.round(4 + taut * 6);
          for (let i = 0; i < nObl; i++) {
            if (rng.f() > 0.34 + 0.55 * taut) continue;
            const sgn = rng.f() < 0.5 ? 1 : -1;
            const aC = DORSAL + (rng.f() - 0.5) * dspan * 1.9;
            const slant = rng.range(0.14, 0.40) * sgn;
            // Short, and bowed. Run at the full width of the wrinkle band and
            // ruled straight, an oblique is a third of a phalanx of dead
            // straight line lying across a form that is curving underneath
            // it, and it reads as a scratch on the paper rather than as a
            // fold in skin - the more so where it happens to continue onto
            // whatever is behind.
            const len = rng.range(0.34, 0.62);
            const mid = rng.sym(0.16);
            const bow = rng.sym(0.10);
            const here = [], back = [];
            for (let k = 0; k <= 8; k++) {
              const q = k / 8, x = q * 2 - 1;
              const ss = (-spread * 0.45 + spread * 0.9 * q) * len + spread * mid;
              const a = aC + slant * (q - 0.5) + bow * (1 - x * x) + rng.sym(0.02);
              if (ss >= 0.012) here.push([ss, a, -0.14]);
              else if (seg > 1) back.push([1 + ss, a, -0.14]);
            }
            const tone = lerp(0.10, 0.72, taut) * rng.range(0.55, 1.10);
            if (here.length > 2) out.push({
              on: 'digit', d, seg, pts: here,
              style: st(S.wrinkle, { tone, phase: nextPhase() })
            });
            if (back.length > 2) out.push({
              on: 'digit', d, seg: seg - 1, pts: back,
              style: st(S.wrinkle, { tone: tone * 0.9, phase: nextPhase() })
            });
          }
        }

        // ---- the shaft between the joints -------------------------------
        // A phalanx between two creases is not bare. It carries a scatter of
        // short slack folds, finer and much fainter than the joint's own
        // rows, running the same way round the finger - which is what stops
        // the stretch between two knuckles reading as moulded plastic.
        {
          const nS = Math.round(3 + rng.f() * 4);
          for (let i = 0; i < nS; i++) {
            const ss = rng.range(0.30, 0.80);
            const aC = DORSAL + rng.sym(0.85);
            const reach = rng.range(0.18, 0.46);
            const pts = [];
            for (let k = 0; k <= 7; k++) {
              const q = k / 7, x = q * 2 - 1;
              pts.push([ss + rng.sym(0.006) + 0.012 * (1 - x * x), aC + x * reach, -0.14]);
            }
            out.push({
              on: 'digit', d, seg, pts,
              style: st(S.wrinkle, { tone: rng.range(0.24, 0.62), weight: 0.52, phase: nextPhase() })
            });
          }
        }

        // ---- knuckle rim -------------------------------------------------
        // A bent joint presents a hard dorsal corner where the skin turns off
        // the head onto the phalanx. On a closed hand this rim is the strongest
        // mark on the whole back of the digit, and the wrinkle sets above have
        // by then been drawn taut and erased — so without it a fist has nothing
        // describing its joints at all.
        if (f > 0.26 && jn !== 'DIP') {
          const k = (f - 0.26) / 0.74;
          for (let r = 0; r < (k > 0.55 ? 2 : 1); r++) {
            const pts = [];
            const span = 0.90 - r * 0.16;
            for (let q2 = 0; q2 <= 18; q2++) {
              const q = q2 / 18;
              const a = DORSAL + (q * 2 - 1) * span;
              pts.push([0.015 + r * 0.055 + 0.022 * (1 - Math.pow(q * 2 - 1, 2)), a, 0.18]);
            }
            out.push({
              on: 'digit', d, seg, pts,
              style: st(S.crease, {
                tone: (0.34 + 0.95 * k) * (r ? 0.52 : 1), weight: 0.95 - r * 0.2, phase: nextPhase()
              })
            });
          }
        }
      }

      // ---- knuckle pads --------------------------------------------------
      // The skin over an interphalangeal joint is thicker and coarser than the
      // skin either side of it, and reads as a patch of texture rather than as
      // a line. It is what stops an extended finger drawing as a plain tube.
      for (let seg = 2; seg < nSeg; seg++) {
        const jn = dg.joints[seg].name;
        const flex = dg.joints[seg].flex;
        const taut = clamp01(1 - flexFrac(A, d, jn, Math.max(0, flex)) * 1.3);
        if (taut < 0.15) continue;
        // A lozenge mesh of short crossing marks, scattered. Drawn as evenly
        // spaced arcs instead it reads as a bandage wrapped round the finger.
        const nP = Math.round(16 + taut * 14);
        for (let i = 0; i < nP; i++) {
          const s0 = rng.range(-0.055, 0.135);
          const a0 = DORSAL + rng.sym(0.62);
          const L = rng.range(0.030, 0.058);
          const lean = rng.chance(0.5) ? 1 : -1;
          const skew = (0.16 + rng.range(0, 0.10)) * lean;
          out.push({
            on: 'digit', d, seg,
            pts: [[s0 - L * 0.5, a0 - skew, -0.05], [s0, a0, -0.05], [s0 + L * 0.5, a0 + skew, -0.05]],
            style: st(S.hatch, { tone: (0.8 + 0.9 * rng.f()) * taut, phase: nextPhase() })
          });
        }
      }

      // ---- lateral digital line -----------------------------------------
      // The seam where dorsal skin meets the pulp, running the whole digit.
      for (let sideI = 0; sideI < 2; sideI++) {
        const a0 = sideI === 0 ? 0.02 : Math.PI - 0.02;
        for (let seg = 1; seg < nSeg; seg++) {
          const sg = dg.segs[seg];
          const pts = [];
          const nS = 14;
          for (let k = 0; k <= nS; k++) {
            const s = (k / nS) * (seg === nSeg - 1 ? sg.sMax * 0.94 : 1);
            if (seg === 1 && s < AN.webStart(A, d, a0) + 0.02) continue;
            pts.push([s, a0 + Math.sin(s * 5 + seg) * 0.035, 0]);
          }
          if (pts.length > 3) out.push({
            on: 'digit', d, seg, pts,
            style: st(S.fold, { tone: 0.46, weight: 0.6, taper: 0.9, phase: nextPhase() })
          });
        }
      }
    }
  }

  // =========================================================================
  //  B · WEB SPACES
  //  The interdigital commissures: the skin bridging adjacent digits.
  // =========================================================================
  function webs(rig, out) {
    const A = rig.anatomy;
    for (let d = 1; d < 4; d++) {
      const h1 = AN.webStart(A, d, 0.0);          // ulnar flank of digit d
      const h2 = AN.webStart(A, d + 1, Math.PI);  // radial flank of digit d+1
      // palmar margin of the web, drawn on each digit's own flank
      for (const [dd, hh, a0, sgn] of [[d, h1, 0.0, 1], [d + 1, h2, Math.PI, -1]]) {
        const pts = [];
        for (let k = 0; k <= 12; k++) {
          const t = k / 12;
          const a = a0 + sgn * (-0.05 - t * 1.25);
          pts.push([hh * (1 - t * t * 0.92), a, -0.25]);
        }
        out.push({
          on: 'digit', d: dd, seg: 1, pts,
          style: st(S.crease, { tone: 0.60, weight: 0.82, taper: 0.7, phase: nextPhase() })
        });
      }
    }
    // ---- the first web -------------------------------------------------
    // Two regimes, and they look nothing alike. Adducted, the skin of the
    // commissure has surplus and buckles across the line of compression into
    // folds stacked back from the margin. Abducted, it is a taut sheet and
    // what shows is the pull running from the depth of the commissure out to
    // the margin. The margin itself the renderer draws as a contour, so it is
    // not repeated here.
    const sheet = webSheet(rig);
    const web = sheet.at, open = sheet.open;
    const wRng = new M.Rng(A.seed ^ 0x7b21);
    const gathered = 1 - open;

    const nFold = Math.round(gathered * 4);
    for (let i = 0; i < nFold; i++) {
      const t0 = 0.93 - i * 0.11;
      const pts = [];
      for (let j = 0; j <= 18; j++) {
        const k = lerp(0.12, 0.88, j / 18);
        // a slack fold hangs toward the margin at its middle
        const t = t0 + 0.05 * gathered * Math.sin(Math.PI * inv(k, 0.12, 0.88));
        pts.push(web(t, k, 1.1 + i * 0.25));
      }
      out.push({
        on: 'world', pts,
        style: st(S.crease, {
          tone: (0.50 + 0.90 * gathered) * (1 - i * 0.18), phase: nextPhase()
        })
      });
    }

    const nTaut = Math.round(open * 4);
    for (let i = 0; i < nTaut; i++) {
      const k0 = 0.24 + 0.54 * (i / Math.max(1, nTaut - 1)) + wRng.sym(0.05);
      // each pull runs its own length: a sheet under tension does not crease
      // in a comb of equal strokes
      const tA = 0.44 + wRng.f() * 0.14, tB = 0.86 + wRng.f() * 0.08;
      const pts = [];
      for (let j = 0; j <= 12; j++) {
        const t = lerp(tA, tB, j / 12);
        // the pull fans as it runs out, the way a sheet does off two anchors
        const k = k0 + (k0 - 0.5) * 0.26 * inv(t, tA, tB);
        pts.push(web(t, k, 1.1));
      }
      out.push({
        on: 'world', pts,
        style: st(S.fold, {
          tone: (0.34 + 0.62 * open) * (0.7 + 0.5 * wRng.f()), phase: nextPhase()
        })
      });
    }
  }

  // =========================================================================
  //  C · NAILS
  // =========================================================================
  function nails(rig, out) {
    const A = rig.anatomy;
    for (let d = 0; d < 5; d++) {
      const dg = rig.digits[d];
      const seg = dg.segs.length - 1;
      const N = A.nails[d];
      const sg = dg.segs[seg];
      // The bone ends at s = 1 but the fingertip does not: the pulp and the
      // nail carry on past it. A free edge placed at the bone's end leaves the
      // nail stranded in the middle of the phalanx.
      const sB = 1 + AN.tipExtent(A, d) * (0.46 + 0.38 * N.free);
      const sA = sB - N.len;                          // proximal fold
      const w = 0.95 * N.wide + 0.18;                 // half-width in alpha
      const off = 0.55 * N.curve;                     // the plate stands proud

      const bowP = 0.055 * N.curve;   // proximal fold arcs distally at the sides
      const bowD = 0.050;             // free edge arcs distally at the centre

      // The plate as one closed outline. Drawn as four edges — proximal fold,
      // free edge and two straight sides — it meets at square corners and
      // reads as a sticker. A nail is a rounded rectangle with a strong free
      // edge, narrowing a little toward the cuticle.
      const sMid = (sA + sB) * 0.5, sHalf = (sB - sA) * 0.5;
      const plate = [];
      const NN = 64;
      for (let i = 0; i <= NN; i++) {
        const th = (i / NN) * TAU;
        const c = Math.cos(th), sn = Math.sin(th);
        // superelliptical corners
        const cx = Math.sign(c) * Math.pow(Math.abs(c), 0.60);
        const cy = Math.sign(sn) * Math.pow(Math.abs(sn), 0.60);
        const taperW = 0.88 + 0.12 * (cx * 0.5 + 0.5);     // narrower at the fold
        const bow = cx >= 0 ? -bowD * (1 - Math.abs(cy)) : bowP * (1 - Math.abs(cy));
        plate.push([sMid + sHalf * cx + bow, DORSAL + w * cy * taperW, off]);
      }
      out.push({ on: 'digit', d, seg, pts: plate, style: st(S.nail, { tone: 1.10, phase: nextPhase() }) });

      // the free edge again, pressed harder: it is the one hard line a nail has
      const freeEdge = [];
      for (let i = 0; i <= 22; i++) {
        const t = i / 22;
        const cy = (t * 2 - 1) * 0.82;
        freeEdge.push([sB - bowD * (1 - Math.abs(cy)), DORSAL + w * cy, off]);
      }
      out.push({ on: 'digit', d, seg, pts: freeEdge, style: st(S.nail, { tone: 1.25, phase: nextPhase() }) });

      // hyponychium: where the plate lifts off the skin
      if (N.free > 0.05) {
        const hy = [];
        for (let i = 0; i <= 18; i++) {
          const t = i / 18;
          const cy = (t * 2 - 1) * 0.80;
          hy.push([sB - N.free * 0.32 - bowD * 0.9 * (1 - Math.abs(cy)), DORSAL + w * cy, off]);
        }
        out.push({ on: 'digit', d, seg, pts: hy, style: st(S.nailFine, { tone: 1.05, phase: nextPhase() }) });
      }

      // lunula
      if (N.lunula > 0.03) {
        const pts = [];
        for (let i = 0; i <= 16; i++) {
          const t = i / 16;
          const a = DORSAL + (t * 2 - 1) * w * 0.66;
          const k = Math.pow(t * 2 - 1, 2);
          pts.push([sA + N.lunula * N.len * (1 - k * 0.55) + bowP * k, a, off]);
        }
        out.push({ on: 'digit', d, seg, pts, style: st(S.nailFine, { tone: 1.00, phase: nextPhase() }) });
      }
      // lateral nail folds
      for (const sgn of [-1, 1]) {
        const pts = [];
        for (let i = 0; i <= 12; i++) {
          const t = i / 12;
          pts.push([lerp(sA + bowP * 0.9, sB - bowD * 0.15, t), DORSAL + sgn * w * (1 + 0.03 * Math.sin(t * 3)), off * 0.55]);
        }
        out.push({ on: 'digit', d, seg, pts, style: st(S.nail, { tone: 0.80, weight: 0.7, phase: nextPhase() }) });
        // the fold of skin outside the plate
        const pts2 = pts.map(p => [p[0], p[1] + sgn * 0.10, 0]);
        out.push({ on: 'digit', d, seg, pts: pts2, style: st(S.nailFine, { tone: 0.73, phase: nextPhase() }) });
      }
      // a couple of longitudinal striations across the plate
      const rng = new M.Rng(A.seed ^ (0x2a00 + d));
      const nStr = rng.int(1, 3);
      for (let i = 0; i < nStr; i++) {
        const aa = DORSAL + rng.sym(w * 0.7);
        out.push({
          on: 'digit', d, seg,
          pts: [[sA + N.len * 0.12, aa, off], [sB - N.len * 0.1, aa + rng.sym(0.03), off]],
          style: st(S.nailFine, { tone: 0.33, weight: 0.5, phase: nextPhase() })
        });
      }
    }
  }

  // =========================================================================
  //  D · EVENLY SPACED STREAMLINES
  //  Ridge fields are integrated, not drawn. Lines terminate when they crowd
  //  a neighbour, which yields realistic endings and bifurcations for free.
  // =========================================================================
  function streamlines(orient, o) {
    const spacing = o.spacing;
    const dTest = spacing * (o.dSep === undefined ? 0.82 : o.dSep);
    const step = o.step || spacing * 0.55;
    const maxSteps = o.maxSteps || 400;
    const inside = o.inside;
    const cell = spacing;
    const grid = new Map();
    const key = (x, y) => ((x / cell) | 0) + ',' + ((y / cell) | 0);
    const near = (x, y, r) => {
      const cx = (x / cell) | 0, cy = (y / cell) | 0;
      const n = Math.ceil(r / cell);
      for (let j = cy - n; j <= cy + n; j++) {
        for (let i = cx - n; i <= cx + n; i++) {
          const b = grid.get(i + ',' + j);
          if (!b) continue;
          for (let k = 0; k < b.length; k += 2) {
            const dx = b[k] - x, dy = b[k + 1] - y;
            if (dx * dx + dy * dy < r * r) return true;
          }
        }
      }
      return false;
    };
    const add = (x, y) => {
      const k = key(x, y);
      let b = grid.get(k); if (!b) { b = []; grid.set(k, b); }
      b.push(x, y);
    };

    const lines = [];
    const queue = [];
    const seed0 = o.seed0 || [(o.x0 + o.x1) * 0.5, (o.y0 + o.y1) * 0.5];
    queue.push(seed0);

    const integrate = (sx, sy, dir) => {
      const pts = [];
      let x = sx, y = sy, px = null, py = null;
      for (let i = 0; i < maxSteps; i++) {
        if (!inside(x, y)) break;
        if (i > 0 && near(x, y, dTest)) break;
        pts.push([x, y]);
        // RK2 with direction continuity
        let a = orient(x, y);
        let vx = Math.cos(a), vy = Math.sin(a);
        if (px !== null && (vx * px + vy * py) < 0) { vx = -vx; vy = -vy; }
        else if (px === null && dir < 0) { vx = -vx; vy = -vy; }
        const mx = x + vx * step * 0.5, my = y + vy * step * 0.5;
        let a2 = orient(mx, my);
        let wx = Math.cos(a2), wy = Math.sin(a2);
        if ((wx * vx + wy * vy) < 0) { wx = -wx; wy = -wy; }
        x += wx * step; y += wy * step;
        px = wx; py = wy;
        if (!isFinite(x) || !isFinite(y)) break;
      }
      return pts;
    };

    let guard = 0;
    while (queue.length && lines.length < (o.maxLines || 700) && guard++ < 20000) {
      const [sx, sy] = queue.shift();
      if (!inside(sx, sy) || near(sx, sy, dTest)) continue;
      const fwd = integrate(sx, sy, 1);
      const bwd = integrate(sx, sy, -1);
      const line = bwd.slice(1).reverse().concat(fwd);
      if (line.length < 3) continue;
      for (const p of line) add(p[0], p[1]);
      lines.push(line);
      // propose new seeds perpendicular to this line
      for (let i = 0; i < line.length; i += Math.max(1, Math.round(spacing / step))) {
        const a = orient(line[i][0], line[i][1]);
        const nx = -Math.sin(a), ny = Math.cos(a);
        queue.push([line[i][0] + nx * spacing, line[i][1] + ny * spacing]);
        queue.push([line[i][0] - nx * spacing, line[i][1] - ny * spacing]);
      }
    }
    return lines;
  }

  // ------------------------------------------------ fingerprint orientation
  function printField(type, p) {
    const cx = 0 + p.coreY, cy = p.coreS;
    const side = p.deltaSide;
    const dx = side * 0.62, dy = cy - 0.46;
    const sw = p.swirl;
    switch (type) {
      case 'arch':
        return (x, y) => {
          const h = 0.34, w = 0.52;
          const dydx = -2 * x / (w * w) * h * Math.exp(-(x * x) / (w * w));
          return Math.atan2(dydx, 1) + sw * 0.08;
        };
      case 'tentedArch':
        return (x, y) => {
          const w = 0.34, h = 0.66;
          const dydx = -h * Math.sign(x) * Math.exp(-Math.abs(x) / w) / w;
          return Math.atan2(dydx * 0.9, 1) + sw * 0.06;
        };
      case 'whorl':
        return (x, y) => {
          const a1 = Math.atan2(y - cy, x - cx);
          const a2 = Math.atan2(y - dy, x - dx);
          const a3 = Math.atan2(y - dy, x + dx);
          return a1 + HALF - 0.5 * (a2 + a3) + sw * 0.25;
        };
      case 'doubleLoop':
        return (x, y) => {
          const a1 = Math.atan2(y - (cy + 0.16), x - (cx - 0.14));
          const a2 = Math.atan2(y - (cy - 0.18), x - (cx + 0.14));
          const a3 = Math.atan2(y - dy, x - dx);
          const a4 = Math.atan2(y - dy, x + dx);
          return 0.5 * (a1 + a2) - 0.5 * (a3 + a4) + HALF + sw * 0.2;
        };
      default: // ulnarLoop / radialLoop
        return (x, y) => {
          const a1 = Math.atan2(y - cy, x - cx);
          const a2 = Math.atan2(y - dy, x - dx);
          return 0.5 * (a1 - a2) + sw * 0.12;
        };
    }
  }

  function fingerprints(rig, out, quality) {
    const A = rig.anatomy;
    for (let d = 0; d < 5; d++) {
      const dg = rig.digits[d];
      const seg = dg.segs.length - 1;
      const sg = dg.segs[seg];
      const P = A.prints[d];
      const bone = A.bones[d];
      // pad extent in surface coordinates
      const sLo = 0.16, sHi = sg.sMax * 0.96;
      const aHalf = 1.12;
      // ~0.5 mm of ridge pitch over a pad about fifteen millimetres across:
      // the parameter domain below spans the pad, so pitch it directly
      const spacing = 0.062 / P.density;

      const field = printField(P.type, P);
      const lines = streamlines(field, {
        x0: -1, y0: -1, x1: 1, y1: 1.6,
        spacing: spacing,
        step: spacing * 0.52,
        maxSteps: quality > 0 ? 420 : 170,
        maxLines: quality > 0 ? 320 : 110,
        seed0: [0, P.coreS - 0.35],
        inside: (x, y) => {
          if (y < -0.02 || y > 1.34) return false;
          const rx = x / 1.0;
          const ry = (y - 0.62) / 0.72;
          return rx * rx + ry * ry < 1.0;
        }
      });

      const rng = new M.Rng(A.seed ^ (0x3b00 + d));
      for (let i = 0; i < lines.length; i++) {
        let ln = lines[i];
        if (ln.length < 4) continue;
        // random ridge breaks, so minutiae read as endings not perfect arcs
        if (rng.chance(P.broken * 2.2) && ln.length > 10) {
          const c = rng.int(3, ln.length - 4);
          ln = rng.chance(0.5) ? ln.slice(0, c) : ln.slice(c);
        }
        const pts = ln.map(p => [
          lerp(sLo, sHi, clamp01(p[1] / 1.3)),
          PALMAR + p[0] * aHalf,
          -0.08
        ]);
        out.push({
          on: 'digit', d, seg, pts,
          style: st(S.print, { tone: 0.70 + 0.50 * rng.f(), phase: nextPhase() })
        });
      }
      // flexion-crease-free zone: a faint boundary at the pad's proximal edge
    }
  }

  // =========================================================================
  //  E · PALMAR CREASES
  //  Palmistry named them; anatomy did not. They are flexion creases of the
  //  metacarpophalangeal row and of the thumb's opposition arc.
  // =========================================================================
  function palmCreases(rig, out) {
    const A = rig.anatomy;
    const C = A.creases;
    const rng = new M.Rng(A.seed ^ 0x4c01);
    const pose = rig.pose;

    // how hard the finger row and the thumb are working
    let mcpF = 0;
    for (let d = 1; d < 5; d++) mcpF += flexFrac(A, d, 'MCP', Math.max(0, pose.digits[d].mcpFlex));
    mcpF /= 4;
    const oppF = clamp01((pose.digits[0].cmcOpp || 0) / (60 * DEG)) * 0.6 +
      clamp01((pose.digits[0].cmcRad || 0) / (40 * DEG)) * 0.4;
    const arch = clamp01(pose.arch || 0);

    const gather = (ctrl, count, spreadU, spreadV, style, tone, phase) => {
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
        const c2 = ctrl.map(p => [p[0] + t * spreadU, p[1] + t * spreadV]);
        out.push({
          on: 'palm', pts: palmCurve(rig, uvSpline(c2, 40), true, -0.4),
          style: st(style, { tone: tone * (1 - Math.abs(t) * 0.42), phase: nextPhase() })
        });
      }
    };

    if (A.creasePattern === 'simian') {
      // a single transverse crease crossing the whole palm
      gather([[0.84, -0.10], [0.80, 0.24], [0.76, 0.62], [0.70, 1.06]],
        1 + Math.round(mcpF * 2.4), 0.030, 0, S.palmCrease, 0.86 + 0.52 * mcpF, 900);
    } else {
      // distal transverse crease — flexion of the ulnar three metacarpals
      const dArc = C.distalArc;
      gather([
        [0.870 + 0.02 * arch, 0.12], [0.880, 0.42], [0.860, 0.70], [0.795, 0.95], [0.720, 1.10]
      ], 1 + Math.round(mcpF * 2.6), 0.026 * dArc, 0, S.palmCrease, 0.83 + 0.54 * mcpF, 910);

      // proximal transverse crease — flexion of the index and middle rays
      const sydney = A.creasePattern === 'sydney';
      gather([
        [0.800, -0.22], [0.762, 0.00], [0.690, 0.34], [0.590, 0.66], [sydney ? 0.505 : 0.520, sydney ? 1.08 : 0.86]
      ], 1 + Math.round(mcpF * 2.0), 0.024 * C.proximalArc, 0, S.palmCrease, 0.77 + 0.49 * mcpF, 920);
    }

    // thenar crease — the arc the thumb sweeps in opposition
    gather([
      [0.810, -0.26], [0.700, -0.46], [0.505, -0.60], [0.315, -0.58], [0.145, -0.44], [0.020, -0.28]
    ], 1 + Math.round(oppF * 2.8), 0.020 * C.thenarArc, 0.020, S.palmCrease, 0.74 + 0.57 * oppF, 930);

    // vertical creases: not everyone has them
    if (C.fateLine) {
      out.push({
        on: 'palm',
        pts: palmCurve(rig, uvSpline([[0.05, 0.54], [0.30, 0.52], [0.55, 0.49], [0.80, 0.44]], 34), true, -0.35),
        style: st(S.palmMinor, { tone: 1.13, phase: nextPhase() })
      });
    }
    if (C.sunLine) {
      out.push({
        on: 'palm',
        pts: palmCurve(rig, uvSpline([[0.40, 0.80], [0.60, 0.78], [0.82, 0.74]], 24), true, -0.3),
        style: st(S.palmMinor, { tone: 0.87, phase: nextPhase() })
      });
    }

    // minor creases: the grille of the thenar and hypothenar
    for (let i = 0; i < C.minorCount; i++) {
      const zone = rng.f();
      let a, b;
      if (zone < 0.45) {          // thenar
        const u = rng.range(0.14, 0.70), v = rng.range(-0.62, -0.14);
        const L = rng.range(0.06, 0.17), ang = rng.range(-1.2, 0.4);
        a = [u - Math.cos(ang) * L, v - Math.sin(ang) * L * 0.9];
        b = [u + Math.cos(ang) * L, v + Math.sin(ang) * L * 0.9];
      } else if (zone < 0.80) {   // hypothenar
        const u = rng.range(0.10, 0.62), v = rng.range(0.88, 1.22);
        const L = rng.range(0.05, 0.14), ang = rng.range(0.4, 1.9);
        a = [u - Math.cos(ang) * L, v - Math.sin(ang) * L * 0.8];
        b = [u + Math.cos(ang) * L, v + Math.sin(ang) * L * 0.8];
      } else {                    // mid palm
        const u = rng.range(0.42, 0.80), v = rng.range(0.16, 0.88);
        const L = rng.range(0.04, 0.10), ang = rng.range(-0.5, 1.6);
        a = [u - Math.cos(ang) * L, v - Math.sin(ang) * L];
        b = [u + Math.cos(ang) * L, v + Math.sin(ang) * L];
      }
      out.push({
        on: 'palm', pts: palmCurve(rig, uvSpline([a, [(a[0] + b[0]) / 2 + rng.sym(0.012), (a[1] + b[1]) / 2 + rng.sym(0.02)], b], 14), true, -0.25),
        style: st(S.palmMinor, { tone: rng.range(0.47, 1.13), phase: nextPhase() })
      });
    }

    // creases at the base of each finger, on the palm side of the knuckle line
    for (let d = 1; d < 5; d++) {
      const v = (d - 1) / 3;
      const f = flexFrac(A, d, 'MCP', Math.max(0, pose.digits[d].mcpFlex));
      const n = 1 + Math.round(f * 1.6);
      for (let i = 0; i < n; i++) {
        out.push({
          on: 'palm',
          pts: palmCurve(rig, uvSpline([
            [0.975 - i * 0.035, v - 0.13], [0.995 - i * 0.035, v], [0.975 - i * 0.035, v + 0.13]
          ], 16), true, -0.3),
          style: st(S.palmMinor, { tone: (0.73 + 1.13 * f) * (1 - i * 0.3), phase: nextPhase() })
        });
      }
    }

    // ---- wrist creases (rascettes) --------------------------------------
    const wf = clamp01(Math.max(0, pose.wrist.flex) / (70 * DEG));
    const nW = C.wristCreases + Math.round(wf * 2);
    for (let i = 0; i < nW; i++) {
      const u = -0.012 - i * 0.052 - wf * 0.01;
      out.push({
        on: 'palm',
        pts: palmCurve(rig, uvSpline([
          [u + 0.024, -0.26], [u - 0.004, 0.12], [u - 0.012, 0.52], [u + 0.004, 0.94], [u + 0.032, 1.24]
        ], 30), true, -0.4),
        style: st(S.palmCrease, {
          tone: (0.60 + 0.60 * wf) * (1 - i * 0.16), weight: 0.88, phase: nextPhase()
        })
      });
    }

    // ---- cupping folds ---------------------------------------------------
    if (arch > 0.25) {
      for (let i = 0; i < 3; i++) {
        const v = 0.55 + i * 0.20;
        out.push({
          on: 'palm',
          pts: palmCurve(rig, uvSpline([[0.30, v - 0.06], [0.52, v], [0.74, v + 0.05]], 20), true, -0.3),
          style: st(S.palmMinor, { tone: (arch - 0.25) * 1.83 * (1 - i * 0.2), phase: nextPhase() })
        });
      }
    }
  }

  // =========================================================================
  //  F · PALMAR FRICTION RIDGES
  //  The same field machinery as the fingerprints, at a coarser pitch and a
  //  whisper of tone, flowing around the thenar and hypothenar.
  // =========================================================================
  function palmRidges(rig, out, quality) {
    const A = rig.anatomy;
    const rng = new M.Rng(A.seed ^ 0x5d01);
    const noise = new M.Noise(A.seed ^ 0x5d02);
    // A bounded orientation field: broadly transverse across the palm, tilted
    // into arcs where the thenar and hypothenar masses rise under it. Built as
    // a sum of bounded tilts rather than a potential, so it can carry no
    // singularity and the streamline sweep never stalls against a saddle.
    const tilt = (u, v, u0, v0, su, sv, amp) => {
      const x = (u - u0) / su, y = (v - v0) / sv;
      return amp * x * Math.exp(-(x * x + y * y));
    };
    const field = (u, v) => HALF
      + tilt(u, v, 0.48, -0.40, 0.40, 0.38, 1.05)
      + tilt(u, v, 0.42, 1.14, 0.38, 0.28, 0.80)
      + 0.20 * (v - 0.40)
      + (noise.n2(u * 2.0, v * 2.0) - 0.5) * 0.22;
    const lines = streamlines(field, {
      x0: -0.4, y0: -0.4, x1: 1.1, y1: 1.2,
      spacing: quality > 0 ? 0.020 : 0.038,
      step: quality > 0 ? 0.011 : 0.020,
      maxSteps: quality > 0 ? 420 : 190,
      maxLines: quality > 0 ? 900 : 300,
      seed0: [0.5, 0.45],
      inside: (u, v) => u > -0.10 && u < 1.03 &&
        v > rig.palm.vLoRef(u) + 0.02 && v < rig.palm.vHi(u) - 0.02
    });
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.length < 5) continue;
      out.push({
        on: 'palm', pts: palmCurve(rig, ln, true, -0.05),
        style: st(S.palmRidge, { tone: 0.40 + 0.28 * rng.f(), phase: nextPhase() })
      });
    }
  }


  // =========================================================================
  //  F2 · THE FORM OF A DIGIT, AS TONE
  // =========================================================================

  /**
   * Where the light comes from.
   *
   * Two parts, and both are needed. A lamp fixed to the hand is what makes
   * the hand and whatever it is holding answer to one light, and what gives a
   * pose its own consistent modelling however it is turned. On its own it
   * fails badly: fixed to the hand, the light ends up behind the camera from
   * some directions, and a form lit down the axis you are looking along has
   * no visible shadow at all. Measured on a resting hand at azimuth 250, one
   * section in sixty-four came out both turned from the light and facing the
   * eye - the fingers drew as bare tubes, which is the complaint this exists
   * to answer.
   *
   * So most of it is a studio light instead: sixty-odd degrees off the camera
   * axis, and the offset mostly sideways rather than up. That matters more
   * than it sounds - fingers run up the page, so a light raised above the
   * camera is displaced ALONG the form, and a terminator along the form is
   * one nobody can see. Raked across instead, it cuts every finger at a
   * slant. Left and a little high, which is where a right-handed draughtsman
   * puts the lamp so their own hand does not shadow the page.
   */
  function lightDir(rig, view) {
    const hand = M.vnorm(M.vadd(M.vmul(rig.root[0], -0.18),
      M.vadd(M.vmul(rig.root[1], -0.86), M.vmul(rig.root[2], 0.48))));
    if (!view || !view.u) return hand;
    // Seventy-five degrees, not forty-five. On a cylinder the drawable
    // shadow runs from the terminator to the silhouette, and how much of the
    // page that covers falls away fast as the lamp swings toward the camera:
    // at forty-five degrees it is the outer sixth of a finger's width, which
    // reads as a line drawn beside the edge rather than as a form turning.
    // At seventy-five it is nearly two thirds, and the finger goes round.
    const key = M.vnorm(M.vadd(M.vmul(view.e, 0.26),
      M.vadd(M.vmul(view.u, 0.36), M.vmul(view.r, -0.90))));
    return M.vnorm(M.vlerp(hand, key, 0.80));
  }

  /**
   * A finger is a cylinder, and nothing in an outline says so.
   *
   * Two rails and a dome are the same drawing whether the form between them
   * is round, flat or hollow - which is why a finger drawn as outline alone
   * reads as a length of pipe. What says "round" is tone: a band that begins
   * at the terminator, deepens as the surface turns away, and eases off again
   * right at the edge, where light bouncing back off whatever the hand is
   * over creeps round the form. That last easing is the whole of it. A shadow
   * running solid to the silhouette flattens the finger into a cut-out; a
   * shadow that lifts before it gets there puts air behind the form.
   *
   * Two things have to be got right about where the marks go.
   *
   * The band is the arc that is turned from the light AND still facing the
   * eye - not the arc that is dark. Most of what is dark is round the back,
   * and a stroke put there costs the same as one on the paper and is thrown
   * away by the visibility test.
   *
   * And within that arc, marks are spaced by how much of the PAGE each step
   * covers rather than by angle. The far end of the band is turning away, so
   * it projects to a sliver; spread evenly round the section, every stroke
   * piles against the silhouette in a stack that reads as a liner drawn round
   * the edge. Spaced by projected width, the shadow opens out across the
   * finger the way it does on the thing itself.
   *
   * Built as an accumulation rather than a value: three passes over the same
   * band, each shorter and narrower than the last, so the paper ends up with
   * one stroke in the half-light, two where it turns and three in the core.
   */
  function digitShading(rig, view, out, amount) {
    const A = rig.anatomy;
    const amt = amount === undefined ? 1 : amount;
    if (amt <= 0.02) return;
    const rngRoot = new M.Rng(A.seed ^ 0x7a11);
    const L = lightDir(rig, view);
    const NA = 64, HZ = 0.12;

    const bandAt = (d, seg, s) => {
      const lam = new Float64Array(NA), fac = new Float64Array(NA);
      let any = false;
      for (let k = 0; k < NA; k++) {
        const n = R.digitNormal(rig, d, seg, s, (k / NA) * Math.PI * 2);
        lam[k] = M.vdot(n, L);
        fac[k] = view ? M.vdot(n, view.e) : 1;
        if (lam[k] < 0.02 && fac[k] > HZ) any = true;
      }
      if (!any) return null;
      const wrap = (k) => ((k % NA) + NA) % NA;
      const ok = (k) => lam[wrap(k)] < 0.02 && fac[wrap(k)] > HZ;
      let k0 = 0;
      while (!ok(k0)) k0++;
      let g = 0;
      while (ok(k0 - 1) && g++ < NA) k0--;
      let k1 = k0; g = 0;
      while (ok(k1 + 1) && g++ < NA) k1++;
      if (k1 - k0 < 2) return null;
      const T = Math.PI * 2 / NA;
      // run the band from the terminator - the end the light has only just
      // left - toward the silhouette, so a fraction across it means the same
      // thing at every section along the bone
      const flip = Math.abs(lam[wrap(k0)]) >= Math.abs(lam[wrap(k1)]);
      const ks = [], cum = [0];
      for (let k = k0; k <= k1; k++) ks.push(flip ? k1 - (k - k0) : k);
      for (let i = 1; i < ks.length; i++) {
        cum.push(cum[i - 1] + Math.max(0.05, fac[wrap(ks[i])]));
      }
      const total = cum[cum.length - 1] || 1;
      let lo = 9;
      for (const k of ks) lo = Math.min(lo, lam[wrap(k)]);
      const alphaOf = (t) => {
        const want = clamp01(t) * total;
        let i = 0;
        while (i < cum.length - 2 && cum[i + 1] < want) i++;
        const f = (want - cum[i]) / Math.max(1e-9, cum[i + 1] - cum[i]);
        return (ks[i] + (ks[i + 1] - ks[i]) * f) * T;
      };
      return { alphaOf, lo };
    };

    for (let dd = 0; dd < 5; dd++) {
      const rng = rngRoot.fork(dd * 11 + 5);
      for (const sg of rig.digits[dd].segs) {
        if (!sg.rendered) continue;
        // The thumb's metacarpal is thenar mass. The palm models it; a
        // cylinder's shading laid over it would carve a tube out of the ball
        // of the thumb, which is the one place on a hand there isn't one.
        if (dd === AN.THUMB && sg.seg === 0) continue;
        // read the band at a few stations, so a stroke can follow the
        // terminator as it walks round a bending bone
        const NB = 5, stn = [];
        for (let i = 0; i <= NB; i++) {
          const sv = lerp(sg.sMin, Math.min(sg.sMax, 1.02), i / NB);
          stn.push({ sv, b: bandAt(dd, sg.seg, sv) });
        }
        const have = stn.filter(z => z.b);
        if (have.length < 3) continue;
        for (const z of stn) if (!z.b) z.b = have[0].b;
        const lo = have.reduce((m, z) => Math.min(m, z.b.lo), 9);
        const depth = clamp01(-lo / 0.9);

        const alphaAt = (sv, t) => {
          let i = 0;
          while (i < stn.length - 2 && stn[i + 1].sv < sv) i++;
          let a = stn[i].b.alphaOf(t), b = stn[i + 1].b.alphaOf(t);
          while (b - a > Math.PI) b -= Math.PI * 2;
          while (a - b > Math.PI) b += Math.PI * 2;
          const f = clamp01((sv - stn[i].sv) / Math.max(1e-6, stn[i + 1].sv - stn[i].sv));
          return lerp(a, b, f);
        };
        // up out of the light at the terminator, held through the turn, and
        // lifted again at the very edge for the light coming back round
        const value = (t) => M.smoothstep(clamp01(t / 0.30)) *
          (1 - 0.55 * M.smoothstep(clamp01((t - 0.80) / 0.20)));

        const PASS = [
          { n: 8, t0: 0.02, t1: 0.98, span: [0.06, 0.96], tone: 0.62 },
          { n: 6, t0: 0.20, t1: 0.90, span: [0.18, 0.88], tone: 0.74 },
          { n: 4, t0: 0.36, t1: 0.80, span: [0.28, 0.78], tone: 0.90 },
        ];
        for (let p = 0; p < PASS.length; p++) {
          const P = PASS[p];
          if (depth < p * 0.20) continue;
          const n = Math.max(2, Math.round(P.n * (0.55 + 0.45 * depth) * amt));
          for (let i = 0; i < n; i++) {
            const t = P.t0 + (P.t1 - P.t0) * ((i + 0.5) / n) + rng.sym(0.030);
            const v = value(clamp01(t));
            if (v < 0.10) continue;
            const s0 = lerp(sg.sMin, sg.sMax, P.span[0] + rng.f() * 0.18);
            const s1 = lerp(sg.sMin, sg.sMax, P.span[1] - rng.f() * 0.18);
            if (s1 - s0 < 0.12) continue;
            const pts = [];
            const NP = 12;
            for (let k = 0; k <= NP; k++) {
              const q = k / NP;
              const sv = lerp(s0, s1, q);
              // each stroke wanders off the band's own parallel: a set of
              // exact parallels is a screen, not a shadow
              const drift = rng.sym(0.034) * Math.sin(q * Math.PI) + (p - 1) * 0.018;
              pts.push([sv, alphaAt(sv, clamp01(t + drift)), -0.10]);
            }
            out.push({
              on: 'digit', d: dd, seg: sg.seg, pts,
              style: st(S.model, {
                tone: P.tone * v * (0.45 + 0.55 * depth) * amt, phase: nextPhase()
              })
            });
          }
        }
        // Short obliques through the core only. A crossing that runs the
        // whole length is a plaid; a few laid across the darkest part are
        // what keep a deep shadow from going flat and grey.
        if (depth > 0.42) {
          const nX = Math.max(1, Math.round(3 * depth * amt));
          for (let i = 0; i < nX; i++) {
            const sc = lerp(sg.sMin, Math.min(sg.sMax, 1.0), 0.24 + rng.f() * 0.56);
            const tc = 0.52 + rng.sym(0.16);
            const pts = [];
            for (let k = 0; k <= 6; k++) {
              const q = k / 6;
              pts.push([sc + (q - 0.5) * 0.22, alphaAt(sc, clamp01(tc + (q - 0.5) * 0.40)), -0.09]);
            }
            out.push({
              on: 'digit', d: dd, seg: sg.seg, pts,
              style: st(S.model, { tone: 0.70 * depth * amt, phase: nextPhase() })
            });
          }
        }
      }
    }
  }

  // =========================================================================
  //  G · WHAT THE HAND IS HOLDING
  // =========================================================================

  /**
   * The surface of a held ball.
   *
   * A bare circle is not a sphere - it is a hole in the paper - and the only
   * thing that makes it read as a solid is marks that follow its form. So the
   * hatching runs as circles about the light's own axis, which is what a
   * draughtsman does and what makes the curvature legible: the arcs crowd and
   * fatten as the surface turns away, and stop where it turns to face the
   * light.
   *
   * Two properties, because a ball is made of something.
   *
   * `roughness` is how the surface takes the pencil. At zero the arcs are
   * continuous and the silhouette is one clean line: a billiard ball. Raised,
   * the arcs break into dashes, wander off their circles, and the silhouette
   * frays - stone, or a worn tennis ball. It also brings up a stipple, which
   * a smooth ball has none of.
   *
   * `anisotropy` is whether the surface has a grain. At zero the arcs are
   * true circles about the light and the ball reads as uniform. Raised, they
   * stretch along one axis of the ball's own frame, so the form still reads
   * but the material has a direction to it - wound thread, brushed metal,
   * the seam-ward grain of a leather ball.
   */
  function heldBall(rig, view, out, detail) {
    const b = rig.ball;
    if (!b) return;
    const amt = detail && detail.ball !== undefined ? detail.ball : 1;
    if (amt <= 0.02) return;
    const rough = clamp01(b.roughness === undefined ? 0.25 : b.roughness);
    const aniso = clamp01(b.anisotropy === undefined ? 0 : b.anisotropy);
    const rng = new M.Rng((rig.anatomy.seed ^ 0x5bb1) >>> 0);
    const noise = new M.Noise((rig.anatomy.seed ^ 0x2f7d) >>> 0);

    // The light, in the hand's own frame rather than the camera's, because a
    // ball is lit by a room and not by whoever is looking at it. From the
    // palm side, up and to the radial side: a ball held in a hand is nearly
    // always seen from the palm, and lighting it from behind there leaves the
    // whole visible face in shadow and the drawing reading as a dark disc.
    // Strongly to one side rather than square on. A light behind the ball
    // leaves the whole visible face in shadow; a light straight down the eye
    // leaves it bare, and a bare circle is a hole in the paper. Across the
    // form is the only place a terminator lands where it can be seen, which
    // is the whole point of drawing one.
    const L = lightDir(rig, view);
    // a frame about it, and the grain direction the anisotropy stretches along
    const T0 = M.vnorm(M.vcross(L, rig.root[0]));
    const T1 = M.vnorm(M.vcross(L, T0));
    const grainAx = rig.root[1];

    // Arcs at constant angle from the light. Past 90 degrees the surface has
    // turned away; the terminator is where the tone has to start, and it
    // thickens from there into the far limb.
    const N = Math.round(lerp(7, 16, amt) * (1 - aniso * 0.25));
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      const th = lerp(Math.PI * 0.40, Math.PI * 0.99, t);
      const shade = Math.pow(t, 0.72);
      const pts = [];
      const NP = 84;
      for (let k = 0; k <= NP; k++) {
        const ph = (k / NP) * M.TAU;
        // stretch the circle along the grain: the form still reads, the
        // material gains a direction
        const wob = rough * 0.055 * (noise.n2(Math.cos(ph) * 2.2 + i * 3.1,
          Math.sin(ph) * 2.2) - 0.5) * 2;
        const a = th + wob;
        let dir = M.vadd(M.vmul(T0, Math.cos(ph)), M.vmul(T1, Math.sin(ph)));
        if (aniso > 0.01) {
          const along = M.vdot(dir, grainAx);
          dir = M.vnorm(M.vadd(dir, M.vmul(grainAx, along * aniso * 1.35)));
        }
        const P = M.vadd(b.C, M.vmul(M.vadd(M.vmul(L, Math.cos(a)),
          M.vmul(dir, Math.sin(a))), b.r * 1.002));
        pts.push(P);
      }
      // rough surfaces do not take a continuous line
      const runs = rough < 0.12 ? [pts] : dash(pts, rng, rough);
      for (const run of runs) {
        if (run.length < 3) continue;
        out.push({
          on: 'world', pts: run,
          style: st(S.hatch, {
            tone: (0.55 + 1.5 * shade) * amt * (0.8 + 0.4 * rng.f()),
            weight: lerp(1.0, 1.5, shade),
            wobble: 0.8 + rough * 1.9, jitter: 0.3 + rough * 1.5,
            phase: nextPhase()
          })
        });
      }
    }

    // stipple, which only a rough ball has
    const nDots = Math.round(rough * rough * 520 * amt);
    for (let i = 0; i < nDots; i++) {
      const u = rng.f() * 2 - 1, ph = rng.f() * M.TAU;
      const sr = Math.sqrt(Math.max(0, 1 - u * u));
      const dir = M.vadd(M.vmul(T0, Math.cos(ph) * sr), M.vmul(T1, Math.sin(ph) * sr));
      const n = M.vadd(M.vmul(L, u), dir);
      const lit = M.vdot(n, L);
      if (lit > 0.35 - rough * 0.3) continue;      // the lit side stays bare
      const P = M.vadd(b.C, M.vmul(n, b.r * 1.002));
      const q = M.vmad(P, M.vnorm(M.vcross(n, L)), 0.5 + rng.f() * 1.1);
      out.push({
        on: 'world', pts: [P, q],
        style: st(S.hatch, { tone: 0.5 + 1.1 * rng.f(), weight: 0.8, phase: nextPhase() })
      });
    }
  }

  /** break a path into dashes, the way a rough surface breaks a pencil line */
  function dash(pts, rng, rough) {
    const runs = [];
    let cur = [];
    for (const p of pts) {
      cur.push(p);
      if (cur.length > 4 && rng.f() < 0.035 + rough * 0.10) {
        runs.push(cur);
        cur = [];
        const skip = 1 + Math.floor(rng.f() * (1 + rough * 5));
        for (let s = 0; s < skip; s++) cur.push(null);
        cur = [];
      }
    }
    if (cur.length) runs.push(cur);
    return runs;
  }

  GK.features = {
    S, st, nextPhase, resetPhase, PALMAR, DORSAL, betaForV, palmCurve, uvSpline, flexFrac,
    digitFolds, digitShading, lightDir, webs, nails, fingerprints, palmCreases, palmRidges, streamlines, printField,
    heldBall
  };
})(window.GK = window.GK || {});

/* ============================================================================
   GRAPHITE KINEMATICS — 55 · dorsal & construction
   Extensor tendons, the dorsal venous network, hair, skin lattice, and the
   skeleton itself: eight carpals, five metacarpals, fourteen phalanges.
   ========================================================================== */
(function (GK) {
  'use strict';
  const M = GK.math;
  const AN = GK.anatomy;
  const R = GK.rig;
  const F = GK.features;
  const { TAU, DEG, clamp, clamp01, lerp, smoothstep } = M;
  const { vadd, vsub, vmul, vmad, vdot, vcross, vnorm, vlerp } = M;
  const HALF = Math.PI / 2;
  const { S, st, palmCurve, uvSpline, flexFrac, betaForV, PALMAR, DORSAL } = F;

  // =========================================================================
  //  EXTENSOR TENDONS
  //  Four cords running from the wrist to the metacarpal heads. They stand
  //  proud when the fingers extend and sink away as they curl.
  // =========================================================================
  function tendons(rig, out) {
    const A = rig.anatomy;
    const prom = A.tendons.prominence;
    for (let d = 1; d < 5; d++) {
      const v = (d - 1) / 3;
      const ext = 1 - flexFrac(A, d, 'MCP', Math.max(0, rig.pose.digits[d].mcpFlex));
      const lift = clamp01(-rig.pose.digits[d].mcpFlex / (26 * DEG));
      const vis = clamp01(ext * 0.85 + lift * 0.5) * prom;
      if (vis < 0.06) continue;
      // A cord only reads where it stands proud of the metacarpal, over the
      // distal half of the back of the hand. Run it from wrist to knuckle and
      // it becomes a straight radiating spoke, which is not what a hand does.
      const ctrl = [
        [0.30, lerp(0.42, v, 0.52)],
        [0.52, lerp(0.44, v, 0.74)],
        [0.74, lerp(0.46, v, 0.92)],
        [0.92, v],
        [1.02, v]
      ];
      const mid = uvSpline(ctrl, 34);
      for (const sgn of [-1, 1]) {
        const off = mid.map(p => [p[0], p[1] + sgn * 0.026 * (0.4 + 0.6 * p[0])]);
        out.push({
          on: 'palm', pts: palmCurve(rig, off, false, 0.35 * vis),
          style: st(S.tendon, { tone: (0.16 + 0.34 * vis), taper: 0.94, phase: F.nextPhase() })
        });
      }
      // the tendon crest itself, brightest over the metacarpal shaft
      out.push({
        on: 'palm', pts: palmCurve(rig, mid, false, 0.6 * vis),
        style: st(S.tendon, { tone: 0.06 + 0.15 * vis, weight: 0.6, taper: 0.95, phase: F.nextPhase() })
      });
    }
    // extensor pollicis longus and the snuffbox, when the thumb extends
    const tExt = clamp01(-(rig.pose.digits[0].cmcRad || 0) / (24 * DEG)) +
      clamp01(-(rig.pose.digits[0].mcpFlex || 0) / (12 * DEG)) * 0.4;
    if (tExt > 0.1) {
      for (const off of [-0.055, 0.055]) {
        out.push({
          on: 'palm',
          pts: palmCurve(rig, uvSpline([[0.06, -0.10 + off], [0.34, -0.34 + off], [0.62, -0.54 + off], [0.86, -0.66 + off]], 26), false, 0.3),
          style: st(S.tendon, { tone: 0.43 + 0.93 * clamp01(tExt), phase: 1340 + (off > 0 ? 1 : 0) })
        });
      }
    }
  }

  // =========================================================================
  //  DORSAL VENOUS NETWORK
  //  Grown, not drawn: trunks rise from the wrist, meander, and branch toward
  //  the knuckles, each vessel rendered as its pair of walls.
  // =========================================================================
  function veins(rig, out) {
    const A = rig.anatomy;
    const V = A.veins;
    if (V.strength < 0.08) return;
    const rng = new M.Rng(A.seed ^ 0x6e01);
    const noise = new M.Noise(A.seed ^ 0x6e02);
    const segsOut = [];

    function grow(u, v, du, dv, cal, depth) {
      if (depth > 4 || cal < 0.28 || u > 1.02) return;
      const pts = [[u, v]];
      let cu = u, cv = v, dU = du, dV = dv;
      const steps = rng.int(9, 20);
      for (let i = 0; i < steps; i++) {
        const n = (noise.n2(cu * 5.2 + depth * 3.1, cv * 5.2) - 0.5) * 2;
        dV += n * 0.055 * V.meander;
        dU += (0.024 - dU) * 0.16;
        const L = 0.052;
        cu += dU * L * 1.0;
        cv += dV * L * 1.0;
        if (cu > 1.03 || cv < -0.50 || cv > 1.30) break;
        pts.push([cu, cv]);
      }
      if (pts.length < 3) return;
      segsOut.push({ pts, cal });
      if (rng.chance(V.branchProb) && depth < 4) {
        const side = rng.chance(0.5) ? 1 : -1;
        grow(cu, cv, dU * 0.9, dV + side * rng.range(0.5, 1.3), cal * rng.range(0.52, 0.74), depth + 1);
        grow(cu, cv, dU, dV - side * rng.range(0.1, 0.5), cal * rng.range(0.72, 0.92), depth + 1);
      } else if (depth < 4) {
        grow(cu, cv, dU, dV, cal * 0.86, depth + 1);
      }
    }

    for (let i = 0; i < V.trunks; i++) {
      const v0 = lerp(-0.18, 1.06, (i + 0.5) / V.trunks) + rng.sym(0.10);
      grow(rng.range(0.02, 0.14), v0, 1, rng.sym(0.5), V.caliber * rng.range(0.9, 1.35), 0);
    }

    for (let i = 0; i < segsOut.length; i++) {
      const sgm = segsOut[i];
      const sm = M.chaikin(sgm.pts, 2);
      const halfW = 0.0065 * sgm.cal;
      for (const sgn of [-1, 1]) {
        const wall = sm.map((p, k) => {
          const t = k / (sm.length - 1);
          const taper = Math.sin(Math.PI * clamp01(t * 0.9 + 0.05));
          return [p[0], p[1] + sgn * halfW * (0.55 + 0.45 * taper)];
        });
        out.push({
          on: 'palm', pts: palmCurve(rig, wall, false, 0.5 * sgm.cal),
          style: st(S.vein, { tone: 0.64 * V.strength * clamp01(sgm.cal), phase: 1400 + i * 2 + (sgn > 0 ? 1 : 0) })
        });
      }
    }
  }

  // =========================================================================
  //  DORSAL FORM SHADING
  //  Tone for the back of the hand, built the way the wrist already reads:
  //  many faint, slightly offset, wandering strokes accumulating in the
  //  graphite field rather than a fill. Driven by a light fixed in the
  //  hand's own frame against the real dorsal surface normal, so the
  //  metacarpal shafts read as low ridges and the valleys between them as
  //  the light leaves them first — palmThickDorsal (20-rig.js) already
  //  models both as relief and the knuckle heads' own pose-driven swell
  //  with them, so the true surface normal carries all three for free and
  //  this only has to read it. The one thing not in that relief — the
  //  slight hollow just proximal to the knuckle row — is authored in.
  // =========================================================================

  /**
   * One lamp for the whole scene.
   *
   * This used to carry its own coefficients - a second hand-tuned light
   * sitting beside the one the ball answers to, which meant the back of the
   * hand and the thing in front of it disagreed about where the light was.
   * The shared one is defined off the view as well as the hand, so it never
   * goes frontal and the dorsum always has a terminator to draw.
   */
  function dorsalLight(rig, view) {
    return F.lightDir(rig, view);
  }

  /** how shadowed the real dorsal surface is at (u,v), 0 lit .. 1 dark */
  function dorsalShade(rig, view, L, u, v) {
    const beta = betaForV(rig, u, v, false);
    const N = R.palmNormal(rig, u, beta);
    const nl = vdot(N, L);
    // From the terminator, not from half-lit. Starting at nl = 0.5 put tone
    // on most of the back of the hand at once, and tone everywhere is a
    // stain rather than a form - what describes the dorsum is the boundary
    // between what the light reaches and what it does not, and there has to
    // be bare paper on one side of that for it to be a boundary at all.
    let k = clamp01((0.14 - nl) / 0.74);
    // and light creeping back round the edge, same as a finger's
    if (view) {
      const edge = 1 - M.smoothstep(clamp01((Math.abs(vdot(N, view.e)) - 0.10) / 0.26));
      k *= 1 - 0.55 * edge;
    }
    // the hollow just proximal to the knuckle heads, where the extensor
    // tendons gather before fanning to the fingers: not part of the
    // surface relief, so it does not fall out of the normal above
    const hollow = Math.exp(-Math.pow((u - 0.80) / 0.075, 2)) * 0.16;
    return clamp01(k + hollow * (1 - k));
  }

  /**
   * A bundle of near-duplicate strokes at one position: several passes
   * offset and re-wobbled independently rather than one stroke asked to
   * carry the tone alone, so they weave and cross the way the tendon
   * cords already do and the pile-up itself reads as the mark. By default
   * the bundle runs from (u0,v0) to (u1,v0), down a shaft; `arc` instead
   * bows it across a knuckle, from (u0..u1, v0) treated as a half-width.
   */
  function shadeBundle(rig, out, rngD, u0, u1, v0, k, count, arc, offBase) {
    for (let b = 0; b < count; b++) {
      const vOff = v0 + rngD.sym(arc ? 0.011 : 0.014);
      let pts;
      if (arc) {
        // an arc across the knuckle: bow in u, run in v
        const half = (u1 - u0) * 0.5;
        const bow = rngD.sym(0.010);
        const mid = (u0 + u1) * 0.5;
        pts = [[mid, vOff - half], [mid + bow, vOff], [mid, vOff + half]];
      } else {
        const uu0 = u0 + rngD.sym(0.03), uu1 = u1 + rngD.sym(0.035);
        const mid = (uu0 + uu1) * 0.5;
        const drift = rngD.sym(0.022);
        pts = [[uu0, vOff], [mid, vOff + drift], [uu1, vOff + rngD.sym(0.016)]];
      }
      out.push({
        on: 'palm', pts: palmCurve(rig, pts, false, offBase + b * 0.009),
        style: st(S.hatch, {
          tone: k * (1.05 + 0.95 * rngD.f()), weight: 1.10,
          wobble: arc ? 0.85 : 1.1, jitter: arc ? 0.4 : 0.5, phase: F.nextPhase()
        })
      });
    }
  }

  function dorsalShading(rig, view, out) {
    const A = rig.anatomy;
    const rng = new M.Rng(A.seed ^ 0x9d31);
    const L = dorsalLight(rig, view);

    // how proud each tendon already stands, so the shading yields to the
    // cord instead of drawing over it — the same term tendons() computes
    const tProm = [0, 0, 0, 0, 0];
    for (let d = 1; d < 5; d++) {
      const ext = 1 - flexFrac(A, d, 'MCP', Math.max(0, rig.pose.digits[d].mcpFlex));
      const lift = clamp01(-rig.pose.digits[d].mcpFlex / (26 * DEG));
      tProm[d] = clamp01(ext * 0.85 + lift * 0.5) * A.tendons.prominence;
    }

    for (let d = 1; d < 5; d++) {
      const vC = (d - 1) / 3;
      const rngD = rng.fork(d * 11 + 5);

      // Down the shaft and through the valleys either side of it: a comb of
      // positions across the ray's width, each a small bundle of near-
      // duplicate passes. The comb spans wide enough that neighbouring rays
      // overlap at the valley floor between them.
      //
      // Each stroke covers only the stretch of its own line that is actually
      // in shadow, and carries that stretch's own value. Run at the darkest
      // value it touches, over the whole metacarpal, forty near-parallel
      // strokes per ray stack into a solid block on the ulnar side - which is
      // a stain, not a back of a hand.
      const comb = 12;
      const NU = 9;
      for (let c = 0; c < comb; c++) {
        const v0 = vC + (c / (comb - 1) - 0.5) * 0.44;
        const near = clamp01(1 - Math.abs(v0 - vC) / 0.05) * tProm[d];
        const yield0 = 1 - 0.75 * near;
        const ks = [];
        for (let i = 0; i < NU; i++) {
          const u = 0.20 + (0.67 * i) / (NU - 1);
          ks.push({ u, k: dorsalShade(rig, view, L, u, v0) * yield0 });
        }
        let best = 0;
        for (const z of ks) if (z.k > best) best = z.k;
        if (best < 0.07) continue;
        const thr = Math.max(0.05, best * 0.42);
        let i0 = 0;
        while (i0 < NU && ks[i0].k < thr) i0++;
        let i1 = NU - 1;
        while (i1 > i0 && ks[i1].k < thr) i1--;
        if (i1 - i0 < 1) continue;
        let mean = 0;
        for (let i = i0; i <= i1; i++) mean += ks[i].k;
        mean /= (i1 - i0 + 1);
        // Density carries the value, not pressure. Every comb position
        // firing two or three passes puts forty near-parallel strokes across
        // one ray, which on the ulnar side - where the whole shaft is turned
        // from the light - closes into a solid block. Thin the comb by how
        // dark it is instead, and the same value arrives as hatching with
        // paper still showing between the strokes.
        if (rngD.f() > 0.16 + 0.84 * mean) continue;
        const count = mean > 0.62 ? 2 : 1;
        shadeBundle(rig, out, rngD, ks[i0].u, ks[i1].u, v0, mean * 0.86, count, false, 0.10);
      }

      // across the swell of the knuckle head
      const combH = 5;
      for (let c = 0; c < combH; c++) {
        const u0c = 0.855 + (c / (combH - 1)) * 0.145;
        const k = dorsalShade(rig, view, L, u0c, vC) * (1 - 0.6 * tProm[d]);
        if (k < 0.08) continue;
        const count = 1 + Math.round(k * 3);
        shadeBundle(rig, out, rngD, u0c - 0.10, u0c + 0.10, vC, k, count, true, 0.16);
      }
    }
  }

  // =========================================================================
  //  DORSAL KNUCKLE FIELD
  //  Broad arcs over the metacarpal heads, plus the interosseous hollows.
  // =========================================================================
  function knuckleField(rig, view, out) {
    const A = rig.anatomy;
    for (let d = 1; d < 5; d++) {
      const v = (d - 1) / 3;
      const f = flexFrac(A, d, 'MCP', Math.max(0, rig.pose.digits[d].mcpFlex));
      const taut = clamp01(1 - f * 1.5);
      const rows = 2 + Math.round(taut * 3);
      for (let i = 0; i < rows; i++) {
        const u = 0.995 - i * 0.045 - taut * 0.01;
        out.push({
          on: 'palm',
          pts: palmCurve(rig, uvSpline([[u - 0.012, v - 0.115], [u, v], [u - 0.012, v + 0.115]], 16), false, 0.15),
          style: st(S.wrinkle, { tone: 0.23 + 0.85 * taut * (1 - i * 0.22), phase: F.nextPhase() })
        });
      }
      // the knuckle rises; mark its crest when the joint is bent
      if (f > 0.25) {
        out.push({
          on: 'palm',
          pts: palmCurve(rig, uvSpline([[1.015, v - 0.14], [1.045, v], [1.015, v + 0.14]], 20), false, 0.55),
          style: st(S.crease, { tone: 0.30 + 0.86 * (f - 0.25) / 0.75, weight: 0.95, phase: F.nextPhase() })
        });
      }
    }
    // The clefts between the knuckles. This is the single most characteristic
    // thing about the back of a closed hand, and it only exists when the
    // joints are bent: with the hand open the heads sit level and the skin
    // runs smooth across them.
    for (let d = 1; d < 4; d++) {
      const vGap = ((d - 1) + 0.5) / 3;
      const fA = flexFrac(A, d, 'MCP', Math.max(0, rig.pose.digits[d].mcpFlex));
      const fB = flexFrac(A, d + 1, 'MCP', Math.max(0, rig.pose.digits[d + 1].mcpFlex));
      const f = Math.min(fA, fB);
      if (f < 0.22) continue;
      const k = (f - 0.22) / 0.78;
      out.push({
        on: 'palm',
        pts: palmCurve(rig, uvSpline([
          [1.035, vGap], [0.985, vGap - 0.004], [0.925, vGap], [0.855, vGap + 0.006]
        ], 24), false, -0.55 - 0.9 * k),
        style: st(S.crease, { tone: 0.34 + 0.78 * k, weight: 0.92, phase: F.nextPhase() })
      });
      // a shorter companion, the way a deep cleft doubles at its mouth
      if (k > 0.45) {
        out.push({
          on: 'palm',
          pts: palmCurve(rig, uvSpline([[1.02, vGap + 0.030], [0.965, vGap + 0.026], [0.915, vGap + 0.030]], 16), false, -0.35),
          style: st(S.creaseFine, { tone: 0.5 + 0.8 * (k - 0.45) / 0.55, phase: F.nextPhase() })
        });
      }
    }

    // The crown of a bent knuckle carries a small central depression: the
    // extensor hood is thin where it passes over the head, and the skin dips
    // into it. Not everyone shows one.
    if (A.knuckles.dimple) {
      for (let d = 1; d < 5; d++) {
        const v = (d - 1) / 3;
        const f = flexFrac(A, d, 'MCP', Math.max(0, rig.pose.digits[d].mcpFlex));
        if (f < 0.52) continue;
        out.push({
          on: 'palm',
          pts: palmCurve(rig, uvSpline([[1.028, v - 0.030], [1.042, v], [1.028, v + 0.030]], 12), false, 0.35),
          style: st(S.fold, { tone: 1.1 * (f - 0.52) / 0.48, weight: 0.7, phase: F.nextPhase() })
        });
      }
    }

    // hollows between the metacarpals (the dorsal interossei)
    for (let d = 1; d < 4; d++) {
      const v = (d - 0.5) / 3;
      out.push({
        on: 'palm',
        pts: palmCurve(rig, uvSpline([[0.42, v], [0.66, v + 0.008], [0.90, v]], 20), false, -0.25),
        style: st(S.hatch, { tone: 0.90, weight: 0.55, phase: F.nextPhase() })
      });
    }
    // first dorsal interosseous: the bulge in the thumb web
    const spread = clamp01(((rig.pose.digits[0].cmcRad || 0) * -1 + (rig.pose.digits[0].cmcAbd || 0)) / (40 * DEG));
    out.push({
      on: 'palm',
      pts: palmCurve(rig, uvSpline([[0.94, -0.26], [0.80, -0.34], [0.62, -0.33], [0.48, -0.26]], 22), false, 0.2),
      style: st(S.fold, { tone: 0.41 + 0.70 * clamp01(spread), phase: F.nextPhase() })
    });

    // form shading last, so it reads against the crests and hollows above
    // rather than under them
    dorsalShading(rig, view, out);
  }

  // =========================================================================
  //  HAIR
  // =========================================================================
  function hair(rig, out) {
    const A = rig.anatomy;
    const H = A.hair;
    if (H.density < 0.04) return;
    const rng = new M.Rng(A.seed ^ 0x7a01);

    // over the proximal phalanges
    for (let d = 1; d < 5; d++) {
      const n = Math.round(H.density * 13);
      for (let i = 0; i < n; i++) {
        const s = rng.range(0.18, 0.88);
        const a = DORSAL + rng.sym(0.85);
        const L = rng.range(0.035, 0.085) * H.length;
        const lean = H.lean + rng.sym(0.5);
        out.push({
          on: 'digit', d, seg: 1,
          pts: [[s, a, 0.1], [s + L * 0.6, a + lean * 0.10, 0.6], [s + L, a + lean * 0.20, 1.1]],
          style: st(S.hair, { tone: 0.53 + 0.67 * rng.f(), phase: F.nextPhase() })
        });
      }
      // a sparser tuft over the middle phalanx
      const n2 = Math.round(H.density * 5);
      for (let i = 0; i < n2; i++) {
        const s = rng.range(0.2, 0.8);
        const a = DORSAL + rng.sym(0.7);
        const L = rng.range(0.05, 0.11) * H.length;
        out.push({
          on: 'digit', d, seg: 2,
          pts: [[s, a, 0.1], [s + L, a + (H.lean + rng.sym(0.4)) * 0.16, 0.9]],
          style: st(S.hair, { tone: 0.40 + 0.53 * rng.f(), phase: F.nextPhase() })
        });
      }
    }
    // over the back of the hand
    const n3 = Math.round(H.density * 46);
    for (let i = 0; i < n3; i++) {
      const u = rng.range(0.18, 0.98);
      const v = rng.range(-0.38, 1.14);
      const L = rng.range(0.028, 0.062) * H.length;
      const lean = H.lean + rng.sym(0.6);
      out.push({
        on: 'palm',
        pts: palmCurve(rig, [[u, v], [u + L * 0.6, v + lean * 0.022], [u + L, v + lean * 0.045]], false, 0.9),
        style: st(S.hair, { tone: 0.37 + 0.53 * rng.f(), phase: F.nextPhase() })
      });
    }
  }

  // =========================================================================
  //  SKIN LATTICE
  //  The fine diamond mesh of dorsal skin. Barely there, but its absence is
  //  the difference between skin and rubber.
  // =========================================================================
  function skinLattice(rig, out, amount) {
    if (amount <= 0.01) return;
    const A = rig.anatomy;
    const rng = new M.Rng(A.seed ^ 0x8b01);
    const n = Math.round(150 * amount);
    for (let i = 0; i < n; i++) {
      const u = rng.range(0.10, 1.0);
      const v = rng.range(-0.50, 1.20);
      const L = rng.range(0.03, 0.075);
      const ang = (rng.chance(0.5) ? 0.72 : -0.72) + rng.sym(0.22);
      out.push({
        on: 'palm',
        pts: palmCurve(rig, [[u - Math.cos(ang) * L * 0.5, v - Math.sin(ang) * L], [u + Math.cos(ang) * L * 0.5, v + Math.sin(ang) * L]], false, 0),
        style: st(S.hatch, { tone: 0.50 + 0.60 * rng.f(), phase: F.nextPhase() })
      });
    }
    // and on the dorsum of the digits
    for (let d = 1; d < 5; d++) {
      for (let seg = 1; seg <= 2; seg++) {
        const m = Math.round(16 * amount);
        for (let i = 0; i < m; i++) {
          const s = rng.range(0.12, 0.9);
          const a = DORSAL + rng.sym(0.8);
          const L = rng.range(0.05, 0.11);
          const ang = (rng.chance(0.5) ? 1 : -1);
          out.push({
            on: 'digit', d, seg,
            pts: [[s - L * 0.5, a - ang * 0.13], [s + L * 0.5, a + ang * 0.13]],
            style: st(S.hatch, { tone: 0.50 + 0.50 * rng.f(), phase: F.nextPhase() })
          });
        }
      }
    }
  }

  // =========================================================================
  //  SKELETON — twenty-seven bones
  // =========================================================================
  const CARPAL_NAMES = ['scaphoid', 'lunate', 'triquetrum', 'pisiform',
    'trapezium', 'trapezoid', 'capitate', 'hamate'];
  // position in the carpal block (x distal, y ulnar, z palmar), and radii
  const CARPALS = [
    { p: [-2, -9.5, 1.0], r: [7.0, 5.2, 5.0] },   // scaphoid
    { p: [-4, -1.5, -0.5], r: [5.4, 5.0, 4.6] },  // lunate
    { p: [-5, 6.0, 0.0], r: [4.8, 4.4, 4.4] },    // triquetrum
    { p: [-4, 7.0, 5.6], r: [3.4, 3.2, 3.0] },    // pisiform
    // the trapezium carries the thumb's saddle: it sits well radial and
    // palmar of the rest of the distal row, up against the base of MC1
    { p: [6, -16.0, 5.5], r: [5.6, 4.6, 4.4] },   // trapezium
    { p: [7, -5.0, -1.0], r: [4.2, 3.8, 3.8] },   // trapezoid
    { p: [6, 0.5, 0.0], r: [6.4, 5.2, 5.2] },     // capitate
    { p: [5, 7.5, 1.5], r: [5.6, 4.8, 4.8] }      // hamate
  ];

  /** an ellipse on a plane facing the eye, used to draw bone ends and carpals */
  function billboardEllipse(view, C, rx, ry, n) {
    const e = view.e;
    let up = [1, 0, 0];
    if (Math.abs(vdot(e, up)) > 0.97) up = [0, 0, -1];
    const r = vnorm(vcross(up, e));
    const u = vnorm(vcross(e, r));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      pts.push([
        C[0] + r[0] * Math.cos(a) * rx + u[0] * Math.sin(a) * ry,
        C[1] + r[1] * Math.cos(a) * rx + u[1] * Math.sin(a) * ry,
        C[2] + r[2] * Math.cos(a) * rx + u[2] * Math.sin(a) * ry
      ]);
    }
    return pts;
  }

  function skeleton(rig, view, out) {
    const A = rig.anatomy;
    const sc = A.size;
    const style = st(S.bone, { tone: 1.0 });

    // carpals
    for (let i = 0; i < CARPALS.length; i++) {
      const c = CARPALS[i];
      const P = vadd(rig.origin, M.mApply(rig.root, [c.p[0] * sc + 6 * sc, c.p[1] * sc, c.p[2] * sc]));
      out.push({
        on: 'world', xray: true, pts: billboardEllipse(view, P, c.r[0] * sc, c.r[1] * sc, 26),
        style: st(style, { tone: 0.88, phase: F.nextPhase() }), close: true, name: CARPAL_NAMES[i]
      });
    }

    // metacarpals and phalanges: a shaft with condyles at each end
    for (let d = 0; d < 5; d++) {
      const dg = rig.digits[d];
      for (let seg = 0; seg < dg.segs.length; seg++) {
        const sg = dg.segs[seg];
        const [wa] = AN.segmentProfile(A, d, seg, 0.5);
        const shaft = wa * (seg === 0 ? 0.30 : 0.34);
        const head = wa * (seg === 0 ? 0.46 : 0.50);
        // two shaft walls: broad at each end, waisted through the diaphysis
        for (const sgn of [-1, 1]) {
          const pts = [];
          for (let i = 0; i <= 18; i++) {
            const t = i / 18;
            const w = lerp(shaft, head, Math.pow(Math.abs(Math.cos(Math.PI * t)), 1.6));
            pts.push(vadd(vmad(sg.A, sg.t, sg.len * t), vmul(sg.ul, sgn * w)));
          }
          out.push({ on: 'world', xray: true, pts, style: st(style, { phase: F.nextPhase() }) });
        }
        // condyles
        out.push({
          on: 'world', xray: true, pts: billboardEllipse(view, sg.A, head * 1.02, head * 0.92, 20),
          style: st(style, { tone: 0.76, phase: F.nextPhase() }), close: true
        });
        out.push({
          on: 'world', xray: true, pts: billboardEllipse(view, sg.B, head * 1.06, head * 0.96, 20),
          style: st(style, { tone: 0.76, phase: F.nextPhase() }), close: true
        });
      }
    }

    // radius and ulna, entering from the forearm
    const fl = 95 * sc;
    for (const [sgn, rr] of [[-1, 9], [1, 7.5]]) {
      const axis = rig.root[0], side = rig.root[1];
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const p = vmad(rig.origin, axis, -lerp(6, fl, t) * 1);
        pts.push(vadd(p, vmul(side, sgn * rr * sc * lerp(1.25, 0.75, t))));
      }
      out.push({ on: 'world', xray: true, pts, style: st(style, { tone: 0.71, phase: F.nextPhase() }) });
    }
  }

  // =========================================================================
  //  FOREARM STUB — the drawing has to end somewhere
  // =========================================================================
  function forearm(rig, view, out, len) {
    const A = rig.anatomy;
    len = (len === undefined ? 46 : len) * A.size;
    const nU = 16;
    for (const sgn of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= nU; i++) {
        const t = i / nU;
        const u = -t * (len / (rig.palm.gridSpanU || 1));
        const s = R.palmSurface(rig, -t * 0.55, sgn < 0 ? 0.0 : 0.5);
        pts.push([-t * 0.55, sgn < 0 ? 0.0 : 0.5, 0]);
      }
      out.push({
        on: 'palm',
        pts: pts.map(p => [p[0], p[1] === 0 ? 0.0 : 0.5, 0]),
        style: st(S.contourSoft, { tone: 0.58, taper: 0.9, phase: F.nextPhase() })
      });
    }
  }

  GK.dorsal = { tendons, veins, knuckleField, hair, skinLattice, skeleton, forearm, billboardEllipse, CARPAL_NAMES };
})(window.GK = window.GK || {});

/* ============================================================================
   GRAPHITE KINEMATICS — 60 · render
   Curves in surface space become graphite on paper. Back-facing runs fade over
   the horizon; occluded runs are not deleted but ghosted, the way a draughtsman
   leaves construction visible beneath the finished line.
   ========================================================================== */
(function (GK) {
  'use strict';
  const M = GK.math;
  const AN = GK.anatomy;
  const RG = GK.rig;
  const F = GK.features;
  const D = GK.dorsal;
  const PEN = GK.pencil;
  const { TAU, DEG, clamp, clamp01, lerp, smoothstep } = M;
  const { vadd, vsub, vmul, vmad, vdot, vnorm } = M;

  // =========================================================================
  //  DEPTH FIELD
  //  Two peeled layers, each carrying the identity of the part that wrote it.
  //  Identity is what makes the test honest: a silhouette must never be
  //  occluded by the solid it is the silhouette *of*, and without an id the
  //  only way to prevent that is to shrink every part until its contact edges
  //  leak. With an id, self is simply skipped and nothing has to be shrunk.
  // =========================================================================
  class DepthField {
    constructor(w, h, div) {
      this.div = div || 2;
      this.w = Math.ceil(w / this.div); this.h = Math.ceil(h / this.div);
      const n = this.w * this.h;
      this.z0 = new Float32Array(n); this.i0 = new Int16Array(n);
      this.z1 = new Float32Array(n); this.i1 = new Int16Array(n);
      // A cache for slope(), filled in lazily rather than all at once: see
      // the note on slope() below for why this is safe and _slopeSet exists
      // rather than a sentinel value, and why it stays unallocated (null)
      // until the first query, since a caller that never asks about slope
      // (nothing does, off the contour/occlusion path) should not pay for it.
      this._slope = null; this._slopeSet = null;
      this.clear();
    }
    clear() {
      this.z0.fill(-1e18); this.z1.fill(-1e18);
      this.i0.fill(-1); this.i1.fill(-1);
      if (this._slopeSet) this._slopeSet.fill(0);    // the cache kept, but nothing in it trusted
      return this;
    }
    /** rasterise a triangle owned by part `id`, peeling two layers */
    tri(ax, ay, az, bx, by, bz, cx, cy, cz, id) {
      const d = this.div, W = this.w, H = this.h;
      const z0 = this.z0, i0 = this.i0, z1 = this.z1, i1 = this.i1;
      ax /= d; ay /= d; bx /= d; by /= d; cx /= d; cy /= d;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      if (x1 < x0 || y1 < y0) return;
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-12) return;
      const iden = 1 / den;
      // l0 and l1 are affine in (px, py): every one of these four
      // coefficients is the same at every pixel the triangle covers, so this
      // hoists them out of a loop that, until now, recomputed all four from
      // scratch on every single pixel - the actual cost of this function,
      // since a triangle is on average tens of pixels and this ran twice
      // that often for nothing. What is pulled out is exactly the
      // sub-expressions as they were written, not a reassociated equivalent
      // of them, so the value each pixel multiplies by iden is bit-for-bit
      // what it was before. A wrong version of this hoist still looks right
      // on every triangle in this file and only disagrees with the original
      // on one rasterised near some part's own silhouette, where l0 or l1
      // sits within float noise of the -0.003 cutoff - which is exactly
      // where nobody would go looking for it.
      const A0 = by - cy, B0 = cx - bx;
      const A1 = cy - ay, B1 = ax - cx;
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5, dpy = py - cy;
        const rowB0 = B0 * dpy, rowB1 = B1 * dpy;
        const row = y * W;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, dpx = px - cx;
          const l0 = (A0 * dpx + rowB0) * iden;
          if (l0 < -0.003) continue;
          const l1 = (A1 * dpx + rowB1) * iden;
          if (l1 < -0.003) continue;
          const l2 = 1 - l0 - l1;
          if (l2 < -0.003) continue;
          const zz = l0 * az + l1 * bz + l2 * cz;
          const i = row + x;
          const cur = z0[i], curId = i0[i];
          if (zz > cur) {
            if (curId !== id) { z1[i] = cur; i1[i] = curId; }
            z0[i] = zz; i0[i] = id;
          } else if (id !== curId && zz > z1[i]) {
            z1[i] = zz; i1[i] = id;
          }
        }
      }
    }
    quad(a, b, c, d, id) {
      this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], id);
      this.tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], id);
    }

    /** depth of the nearest surface at a cell, whoever wrote it */
    frontAny(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return -1e18;
      const i = cy * this.w + cx;
      return this.i0[i] === -1 ? -1e18 : this.z0[i];
    }

    /** depth of the nearest surface at a cell that is NOT part `id` */
    frontOther(cx, cy, id) {
      if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return -1e18;
      const i = cy * this.w + cx;
      if (this.i0[i] === -1) return -1e18;
      if (this.i0[i] !== id) return this.z0[i];
      return this.i1[i] === -1 ? -1e18 : this.z1[i];
    }

    /**
     * Local steepness of the depth field, in scene units per cell.
     *
     * The depth field itself (z0) is written once, by rasterise(), before
     * the first call to slope() and never again - every mark in the plate
     * is projected and occlusion-tested against the SAME finished field, not
     * one still being drawn into. That is exactly the condition memoising
     * this on first ask requires: the value at a cell cannot change out from
     * under the cache between one query and the next, so the second query
     * of a cell is not skipping work that might now give a different
     * answer, it is skipping work that is guaranteed to give the same one.
     * A silhouette walks its own border at a few pixels per point and a
     * dense field of ridge or fingerprint strokes crosses itself constantly,
     * so the same handful of cells near any busy patch of the drawing get
     * asked about over and over - hidden() alone taps up to four of them
     * per point it tests, twice over on a self-tested contour.
     *
     * What would NOT be safe is caching this across draws, which is why it
     * is a property of one DepthField instance - built fresh every draw()
     * and thrown away at the end of it - rather than of the Renderer, and
     * why clear() drops it: a cache that outlived the field it was measuring
     * would go on answering questions about a pose, view or anatomy that
     * has since changed, and that is a wrong drawing wearing the frame of a
     * fast one.
     */
    slope(cx, cy) {
      const W = this.w, H = this.h;
      if (cx < 1 || cy < 1 || cx >= W - 1 || cy >= H - 1) return 0;
      const n = W * H;
      if (!this._slope) { this._slope = new Float32Array(n); this._slopeSet = new Uint8Array(n); }
      const i = cy * W + cx;
      if (this._slopeSet[i]) return this._slope[i];
      const z = this.z0;
      const l = z[i - 1], r = z[i + 1], u = z[i - W], d = z[i + W];
      const v = (l < -1e17 || r < -1e17 || u < -1e17 || d < -1e17) ? 0 : Math.max(Math.abs(r - l), Math.abs(d - u)) * 0.5;
      this._slope[i] = v; this._slopeSet[i] = 1;
      return v;
    }

    /** slope(), addressed by screen pixel like behind() and stepBehind() rather than by cell */
    slopeAt(x, y) {
      return this.slope(Math.round(x / this.div - 0.5), Math.round(y / this.div - 0.5));
    }

    /**
     * How hidden is a point at (x, y) lying at depth z on part `id`?
     * Returns 0 (clear) .. 1 (buried), antialiased over the four cells the
     * sample straddles, with the tolerance widened where the depth field is
     * steep — which is exactly where a silhouette grazes and a fixed
     * tolerance would carve a halo out of the line.
     */
    hidden(x, y, z, id, tol, soft, includeSelf) {
      const fx = x / this.div - 0.5, fy = y / this.div - 0.5;
      const cx = Math.floor(fx), cy = Math.floor(fy);
      let acc = 0, wsum = 0;
      for (let j = 0; j <= 1; j++) {
        for (let i = 0; i <= 1; i++) {
          const gx = cx + i, gy = cy + j;
          const w = (i ? (fx - cx) : (1 - (fx - cx))) * (j ? (fy - cy) : (1 - (fy - cy)));
          if (w <= 0) continue;
          wsum += w;
          const zf = includeSelf ? this.frontAny(gx, gy) : this.frontOther(gx, gy, id);
          if (zf <= -1e17) continue;
          const t = tol + this.slope(gx, gy) * 1.6;
          acc += w * clamp01((zf - z - t) / soft);
        }
      }
      return wsum > 0 ? acc / wsum : 0;
    }

    /** how far in FRONT of a point the nearest other surface sits */
    behind(x, y, z, id) {
      const cx = Math.round(x / this.div - 0.5), cy = Math.round(y / this.div - 0.5);
      const zf = this.frontOther(cx, cy, id);
      return zf <= -1e17 ? 0 : Math.max(0, zf - z);
    }

    /**
     * The depth step a silhouette describes: how far BEHIND it the next
     * surface lies. Infinite when the line is drawn against nothing at all.
     * A contour is only as strong as the step it reports — where two forms
     * merge, the step is small and so is the line, which is the difference
     * between a thenar swelling into a palm and a cylinder laid on top of it.
     */
    stepBehind(x, y, z, id) {
      const cx = Math.round(x / this.div - 0.5), cy = Math.round(y / this.div - 0.5);
      const zf = this.frontOther(cx, cy, id);
      if (zf <= -1e17) return Infinity;
      const d = z - zf;
      return d > 0 ? d : Infinity;
    }
  }

  /**
   * Fill the depth field with every solid part of the hand, one identity per
   * rendered segment plus one for the palm. Parts are rasterised at very
   * nearly full size: with identities there is nothing to protect against.
   */
  /**
   * A sphere's silhouette under an orthographic projection is a circle, and
   * every point on it lies at the centre's own depth - it is the great circle
   * square-on to the eye. So there is nothing to search for.
   */
  function ballOutline(ball, view, n) {
    const c = view.px(ball.C), z = view.near(ball.C), r = ball.r * view.scale;
    const out = [];
    for (let i = 0; i <= (n || 96); i++) {
      const a = (i / (n || 96)) * Math.PI * 2;
      out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, z]);
    }
    return out;
  }

  /** the sphere as a solid, so it occludes the hand and the hand occludes it */
  function rasteriseBall(ball, view, df, id) {
    const NU = 28, NV = 18;
    const P = (iu, iv) => {
      const th = (iu / NU) * Math.PI * 2, ph = (iv / NV) * Math.PI;
      const q = [
        ball.C[0] + ball.r * Math.sin(ph) * Math.cos(th),
        ball.C[1] + ball.r * Math.sin(ph) * Math.sin(th),
        ball.C[2] + ball.r * Math.cos(ph)
      ];
      const p = view.px(q);
      return [p[0], p[1], view.near(q)];
    };
    for (let iv = 0; iv < NV; iv++) {
      for (let iu = 0; iu < NU; iu++) {
        df.quad(P(iu, iv), P(iu + 1, iv), P(iu + 1, iv + 1), P(iu, iv + 1), id);
      }
    }
  }

  function rasterise(rig, view, df, shrink, ids) {
    const A = rig.anatomy;
    if (rig.ball) rasteriseBall(rig.ball, view, df, ids.ball);
    // Full size, and it matters. Shrinking every part by three and a half
    // percent leaves a halo around each one in which the depth field holds
    // nothing at all, and a contour crossing that halo is tested against
    // empty space and drawn - which is why stray lines turn up in the gaps
    // between fingers, where every silhouette in the neighbourhood passes.
    // Measured across forty plates: 359 contour points of 67,367 were drawn
    // that a true-size field buries, and 968 landed on a pixel the shrink
    // had emptied. The shrink was there to stop a part occluding its own
    // silhouette; identities do that now, and do it exactly.
    shrink = shrink === undefined ? 1.0 : shrink;
    const NA = 20;
    for (let d = 0; d < 5; d++) {
      const dg = rig.digits[d];
      for (const sg of dg.segs) {
        if (!sg.rendered) continue;
        const id = ids.digit[d][sg.seg];
        const NS = sg.seg === dg.segs.length - 1 ? 11 : 8;
        let prev = null, first = null, firstAx = null, lastAx = null;
        for (let i = 0; i <= NS; i++) {
          const s = sg.sMin + (sg.sMax - sg.sMin) * (i / NS);
          const ring = [];
          const axis = vmad(sg.A, sg.t, sg.len * s);
          for (let k = 0; k < NA; k++) {
            const a = (k / NA) * TAU;
            const q = RG.digitSurface(rig, d, sg.seg, s, a);
            const P = M.vlerp(axis, q.P, shrink);
            const p = view.px(P);
            ring.push([p[0], p[1], view.near(P)]);
          }
          if (prev) for (let k = 0; k < NA; k++) {
            const k2 = (k + 1) % NA;
            df.quad(prev[k], prev[k2], ring[k2], ring[k], id);
          }
          if (!first) { first = ring; firstAx = view.px(axis).concat(view.near(axis)); }
          lastAx = view.px(axis).concat(view.near(axis));
          prev = ring;
        }
        // Close both ends. A tube built as quads between rings is a pipe, not
        // a solid: seen down its own axis the depth field looks straight
        // through the near wall and writes the far one, so anything in front
        // of that opening tests as unoccluded and is drawn. A hard-flexed
        // finger points every one of its joints at the eye from somewhere,
        // which is why a clenched fist came out as a scatter of separate
        // sausages with lines crossing through them.
        const cap = (ring, ax) => {
          for (let k = 0; k < NA; k++) df.quad(ax, ring[k], ring[(k + 1) % NA], ax, id);
        };
        if (first) cap(first, firstAx);
        if (prev) cap(prev, lastAx);
      }
    }
    // The first web, as the wedge it actually is: a palmar face and a
    // dorsal face, plus a rim strip closing the free margin between them.
    // Rasterised as a bare mid-sheet this fills nothing from anywhere near
    // edge-on - a membrane projects to a sliver - which is why the thumb
    // used to read as a lump laid beside the hand rather than joined to it.
    {
      const w = RG.firstWeb(rig, view);
      const proj = (P) => { const p = view.px(P); return [p[0], p[1], view.near(P)]; };
      const NT = w.thSide.length - 1, NC = 6;
      for (const side of [1, -1]) {
        for (let i = 0; i < NT; i++) {
          const t0 = i / NT, t1 = (i + 1) / NT;
          for (let k = 0; k < NC; k++) {
            const k0 = k / NC, k1 = (k + 1) / NC;
            df.quad(proj(w.wedgeAt(t0, k0, side)), proj(w.wedgeAt(t0, k1, side)),
              proj(w.wedgeAt(t1, k1, side)), proj(w.wedgeAt(t1, k0, side)), ids.palm);
          }
        }
      }
      for (let k = 0; k < NC; k++) {
        const k0 = k / NC, k1 = (k + 1) / NC;
        df.quad(proj(w.wedgeAt(1, k0, 1)), proj(w.wedgeAt(1, k1, 1)),
          proj(w.wedgeAt(1, k1, -1)), proj(w.wedgeAt(1, k0, -1)), ids.palm);
      }
    }
    const NU = 30, NB = 36, id = ids.palm;
    const uTop = [];
    for (let k = 0; k <= NB; k++) {
      const beta = k / NB;
      const v = RG.palmSurface(rig, 1.0, beta).v;
      uTop.push(rig.palm.uDistal(v, beta < 0.5));
    }
    let prevRow = null;
    for (let i = 0; i <= NU; i++) {
      const row = [];
      for (let k = 0; k <= NB; k++) {
        const u = lerp(-0.42, uTop[k], i / NU);
        const s = RG.palmSurface(rig, u, k / NB);
        const P = M.vlerp(s.spine, s.P, shrink);
        const p = view.px(P);
        row.push([p[0], p[1], view.near(P)]);
      }
      if (prevRow) for (let k = 0; k < NB; k++) df.quad(prevRow[k], prevRow[k + 1], row[k + 1], row[k], id);
      prevRow = row;
    }
  }

  /** stable part identities: one per rendered segment, one for the palm */
  function buildIds(rig) {
    const ids = { palm: 0, digit: [] };
    let next = 1;
    for (let d = 0; d < 5; d++) {
      const row = [];
      for (const sg of rig.digits[d].segs) {
        row[sg.seg] = sg.rendered ? next++ : -1;
        sg.pid = row[sg.seg];
      }
      ids.digit.push(row);
    }
    rig.palm.pid = 0;
    if (rig.ball) ids.ball = next++;
    ids.count = next;
    return ids;
  }

  // =========================================================================
  //  CURVE PROJECTION
  // =========================================================================

  /**
   * How much a mark should give way to graphite already down nearby — the
   * paper's own memory of what has already been drawn, read straight out of
   * the deposition field rather than inferred from geometry. Several
   * individually reasonable marks (a handful of named palm creases, a ring
   * of knuckle contour, a field of ridge texture) can each be exactly where
   * they belong and still converge, from one view, into the same few
   * screen pixels; nothing about any single one of them is wrong, so
   * nothing about any single one of them would flag it. What they share is
   * that the paper under them is getting dark, and that a hand notices.
   */
  function crowdGive(g, x, y) {
    if (!g) return 1;
    const ink = g.densityAt(x, y, 14);
    return 1 - 0.97 * smoothstep(clamp01((ink - 0.02) / 0.08));
  }

  /**
   * Turn a surface curve into screen points with per-point visibility.
   * vis combines the horizon fade with the occlusion test.
   */
  function projectCurve(rig, view, df, cv, opt) {
    const A = rig.anatomy;
    const n = cv.pts.length;
    const out = new Array(n);
    const eps = opt.eps === undefined ? 0.9 : opt.eps;
    const gap = opt.gap === undefined ? 2.2 : opt.gap;
    const ids = opt.ids;
    const myId = cv.on === 'digit' ? ids.digit[cv.d][cv.seg]
      : cv.on === 'palm' ? ids.palm : -1;
    let prevP = null, prevp = null;
    for (let i = 0; i < n; i++) {
      const q = cv.pts[i];
      let P, N = null;
      if (cv.on === 'digit') {
        // digitSurface already worked out this section's profile and its
        // centre offset to place P; handing them to digitNormal (see its
        // own comment) is what lets the busiest call in this loop skip
        // redoing that part of the work for the same point a line below.
        const sp = RG.digitSurface(rig, cv.d, cv.seg, q[0], q[1]);
        N = RG.digitNormal(rig, cv.d, cv.seg, q[0], q[1], sp.pr, sp.off);
        P = q[2] ? vmad(sp.P, N, q[2]) : sp.P;
      } else if (cv.on === 'palm') {
        const sp = RG.palmSurface(rig, q[0], q[1]);
        N = RG.palmNormal(rig, q[0], q[1]);
        P = q[2] ? vmad(sp.P, N, q[2]) : sp.P;
      } else {
        P = q;
      }
      const p = view.px(P);
      const near = view.near(P);
      let vis = 1;
      if (N) {
        const f = vdot(N, view.e);
        // Fine detail compresses as it turns away and must be gone well
        // before the horizon, or every ridge on the far side stacks into a
        // black band along the silhouette.
        const h0 = opt.horizon === undefined ? 0.015 : opt.horizon;
        vis = smoothstep(clamp01((f - h0) / (h0 > 0.1 ? 0.34 : 0.22)));
        // Facing isn't the only way a surface compresses: a segment seen
        // close to end-on foreshortens along its whole LENGTH even where it
        // still faces the eye well around its girth, and every mark meant to
        // be spaced out along that length lands on the next one. Compare how
        // far this step actually moved on the page to how far it moved on
        // the surface — that ratio drops well before the facing test does,
        // in exactly this case, because it is sensitive to the direction of
        // the surface's motion and not just its tilt.
        if (prevP) {
          const dWorld = M.vdist(P, prevP);
          if (dWorld > 1e-6) {
            const dScreen = Math.hypot(p[0] - prevp[0], p[1] - prevp[1]);
            const mag = dScreen / (dWorld * view.scale);
            vis *= smoothstep(clamp01(mag / 0.85));
          }
        }
      }
      prevP = P; prevp = p;
      // The skeleton is construction, not surface: it is drawn through the
      // flesh that contains it, so it takes no occlusion test at all.
      if (cv.xray) { out[i] = [p[0], p[1], 1, near, 0]; continue; }
      // Facing and occlusion are different kinds of invisible and must not be
      // conflated. A mark on the far side of the surface is simply not in the
      // picture; a mark this side of it that another form covers is
      // construction, and construction is what gets ghosted.
      let hid = 0, behind = 0, give = 1;
      if (vis > 0.004) {
        hid = df.hidden(p[0], p[1], near, myId, eps, gap);
        behind = df.behind(p[0], p[1], near, myId);
        give = crowdGive(opt.g, p[0], p[1]);
      }
      const decay = Math.exp(-Math.max(0, behind - 2) / 11);
      out[i] = [p[0], p[1], vis * (1 - hid) * give, near, vis * hid * decay * give];
    }
    return out;
  }

  /** split a visibility-tagged polyline into runs above a threshold */
  /**
   * Split a visibility-tagged polyline into the runs worth drawing.
   * `idx` names which slot carries the visibility for this pass, so the same
   * point list can yield a finished run and a ghosted one without either
   * having to be inferred from the other.
   */
  function runs(pts, lo, idx, maxJump) {
    const res = [];
    let cur = null;
    const jump2 = maxJump ? maxJump * maxJump : 0;
    for (let i = 0; i < pts.length; i++) {
      if (jump2 && cur && i > 0) {
        const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
        if (dx * dx + dy * dy > jump2) cur = null;
      }
      const v = pts[i][idx];
      if (v > lo) {
        if (!cur) { cur = { pts: [], vis: [] }; res.push(cur); }
        cur.pts.push([pts[i][0], pts[i][1]]);
        cur.vis.push(v);
      } else if (cur) {
        // carry one fading point past the edge so the mark tapers out
        cur.pts.push([pts[i][0], pts[i][1]]); cur.vis.push(v * 0.5);
        cur = null;
      }
    }
    return res.filter(r => r.pts.length >= 2);
  }

  // =========================================================================
  //  RENDERER
  // =========================================================================
  // how far from the horizon each kind of mark gives up
  const FINE_LAYERS = {
    ridge: 0.30, print: 0.26, hatch: 0.30, model: 0.20, hair: 0.24, vein: 0.22, tendon: 0.22,
    fold: 0.12, crease: 0.09, palmcrease: 0.12, nail: 0.10
  };

  const state_noop = false;

  const DEFAULT_LAYERS = {
    contour: true, crease: true, fold: true, nail: true, print: true,
    palmcrease: true, ridge: true, vein: true, tendon: true, hair: true,
    hatch: true, model: true, bone: false, label: false
  };

  class Renderer {
    constructor(w, h) {
      this.w = w; this.h = h;
      this.g = null;
      this.cacheSeed = null;
    }

    /** rebuild only what depends on the seed */
    anatomyFor(seed) {
      if (!this._an || this._anSeed !== seed) {
        this._an = AN.buildAnatomy(seed);
        this._anSeed = seed;
      }
      return this._an;
    }

    /**
     * Settle a pose against its own contacts, memoised so the draft pass and
     * the plate that follows it share one solve.
     */
    settle(A, pose, iters) {
      if (state_noop) return pose;
      const key = this._anSeed + '|' + iters + '|' + JSON.stringify(pose);
      if (this._ck === key) return this._cp;
      const out = GK.pose.resolveContacts(A, pose, { iters });
      this._ck = key; this._cp = out;
      return out;
    }

    build(state) {
      const A = this.anatomyFor(state.seed);
      const pose = state.contacts === false ? state.pose
        : this.settle(A, state.pose, (state.quality || 0) >= 1 ? 20 : 10);
      const rig = RG.solve(A, pose);
      // Something the hand is holding rides on the rig, so everything that
      // walks the scene - the framing, the depth field, the contours - meets
      // it the same way it meets the hand.
      rig.ball = state.ball || pose.ball || null;
      // ...and it presses in. Set before anything reads the surface, since
      // the surface is where the deformation lives - the framing pass walks
      // it too, and a hand squeezing hard is a different shape to frame.
      RG.softContact(rig, rig.ball
        ? (state.soft === undefined ? (rig.ball.soft === undefined ? 1 : rig.ball.soft) : state.soft)
        : 0);
      const V = state.view;
      const view = new RG.View(V.az, V.el, V.roll || 0, 1, [0, 0, 0], 0, 0);

      // ---- auto-frame -----------------------------------------------------
      // Measure the real outline rather than a scatter of landmarks: a curled
      // fingertip, a fat thenar or a foreshortened knuckle ring all sit
      // outside any convenient set of key points, and the drawing gets clipped.
      // Projection is linear, so a cheap pass at unit scale gives exact bounds.
      view.scale = 1; view.cx = 0; view.cy = 0;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      const swallow = (pts) => {
        for (const p of pts) {
          if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
          if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
        }
      };
      // The surface itself, not any outline built from it: an outline is an
      // approximation of the boundary and a fingertip's pulp can sit a
      // millimetre outside whichever one is in use, which is exactly the
      // clipping this pass exists to prevent.
      for (let d = 0; d < 5; d++) {
        for (const sg of rig.digits[d].segs) {
          if (!sg.rendered) continue;
          for (let i = 0; i <= 6; i++) {
            const sv = sg.sMin + (sg.sMax - sg.sMin) * (i / 6);
            const ring = [];
            for (let k = 0; k < 12; k++) {
              const q = RG.digitSurface(rig, d, sg.seg, sv, (k / 12) * TAU).P;
              ring.push(view.px(q));
            }
            swallow(ring);
          }
        }
      }
      const fsil = RG.palmSilhouette(rig, view, { nu: 20, nb: 44, u0: -0.44, u1: 1.03 });
      swallow(fsil.sideA); swallow(fsil.sideB); swallow(fsil.cap);
      if (rig.ball) swallow(ballOutline(rig.ball, view));

      // A caller can pin the framing instead. Anything that renders a
      // sequence has to: re-fitting each frame makes the hand swim about
      // inside its own plate, and a ball leaving the picture drags the whole
      // drawing small as it goes.
      if (state.fit) {
        view.scale = state.fit.scale; view.cx = state.fit.cx; view.cy = state.fit.cy;
        view.mmPerPx = 1 / view.scale;
        return this._build2(A, pose, rig, view, state);
      }
      const margin = state.margin === undefined ? 0.88 : state.margin;
      const zoom = V.zoom === undefined ? 1 : V.zoom;
      const scale = Math.min(this.w * margin / Math.max(1e-6, x1 - x0),
        this.h * margin / Math.max(1e-6, y1 - y0)) * zoom;
      view.scale = scale;
      view.cx = this.w * 0.5 - scale * (x0 + x1) * 0.5;
      view.cy = this.h * 0.5 - scale * (y0 + y1) * 0.5;
      // millimetres per pixel, for depth tolerances
      view.mmPerPx = 1 / scale;

      return this._build2(A, pose, rig, view, state);
    }

    _build2(A, pose, rig, view, state) {
      // ---- depth field ----------------------------------------------------
      const ids = buildIds(rig);
      // one field per resolution, cleared between draws rather than made anew (tens of MB a hand)
      const div = (state.quality || 0) >= 1 ? 1 : 2;
      this._dfs ||= {};
      const dk = `${div}:${this.w}x${this.h}`;
      const df = this._dfs[dk] ? this._dfs[dk].clear() : (this._dfs[dk] = new DepthField(this.w, this.h, div));
      rasterise(rig, view, df, undefined, ids);

      // ---- feature curves -------------------------------------------------
      const L = Object.assign({}, DEFAULT_LAYERS, state.layers || {});
      const det = state.detail || {};
      const q = state.quality === undefined ? 1 : state.quality;
      const curves = [];
      // so the same hand drawn twice is the same drawing
      F.resetPhase();
      if (L.crease || L.fold) F.digitFolds(rig, curves);
      if (L.crease) F.webs(rig, curves);
      if (L.nail) F.nails(rig, curves);
      if (L.model) F.digitShading(rig, view, curves, 1);
      if (L.print && (det.print === undefined ? 1 : det.print) > 0.02) F.fingerprints(rig, curves, q);
      if (L.palmcrease) F.palmCreases(rig, curves);
      if (L.ridge && (det.ridge === undefined ? 1 : det.ridge) > 0.02) F.palmRidges(rig, curves, q);
      if (rig.ball) F.heldBall(rig, view, curves, det);
      if (L.tendon) D.tendons(rig, curves);
      if (L.vein) D.veins(rig, curves);
      if (L.fold) D.knuckleField(rig, view, curves);
      if (L.hair) D.hair(rig, curves);
      if (L.hatch) D.skinLattice(rig, curves, det.lattice === undefined ? 0.6 : det.lattice);
      if (L.bone) D.skeleton(rig, view, curves);

      return { A, rig, view, df, ids, curves, layers: L };
    }

    draw(state) {
      const t0 = Date.now();
      const built = this.build(state);
      const { rig, view, df, ids, curves, layers } = built;
      const A = built.A;
      const stl = state.style || {};
      const q = state.quality === undefined ? 1 : state.quality;
      const ss = q >= 2 ? 2 : 1;
      if (!this.g || this.g.w !== this.w || this.g.h !== this.h || this.g.ss !== ss || this.g.seed !== state.seed) {
        this.g = new PEN.Graphite(this.w, this.h, ss, state.seed);
      } else {
        this.g.clear();
      }
      const g = this.g;
      const grade = PEN.gradeAt(stl.grade === undefined ? 3 : stl.grade);
      const toneScale = stl.tone === undefined ? 1 : stl.tone;
      const wobScale = stl.wobble === undefined ? 1 : stl.wobble;
      const ghost = stl.ghost === undefined ? 0.14 : stl.ghost;
      const det = state.detail || {};
      const layerGain = {
        print: det.print === undefined ? 1 : det.print,
        ridge: det.ridge === undefined ? 1 : det.ridge,
        hatch: det.lattice === undefined ? 1 : det.lattice,
        model: det.shade === undefined ? 1 : det.shade,
        hair: det.hair === undefined ? 1 : det.hair,
        vein: det.vein === undefined ? 1 : det.vein
      };
      // Tolerances in scene units. Identity keeps a part from occluding
      // itself, so these only have to absorb rasterisation error.
      const eps = Math.max(0.30, view.mmPerPx * 1.1);
      const gap = Math.max(0.90, view.mmPerPx * 3.2);

      const put = (r, style, extraTone) => {
        g.stroke(r.pts, {
          grade,
          tone: (style.tone || 0.5) * toneScale * (extraTone === undefined ? 1 : extraTone),
          weight: style.weight, passes: style.passes, taper: style.taper,
          wobble: (style.wobble || 1) * wobScale, jitter: style.jitter,
          grain: style.grain, phase: (style.phase || 0) * 0.137 + 3.1,
          vis: r.vis
        });
      };

      // ---- feature curves --------------------------------------------------
      for (const cv of curves) {
        const gain = layerGain[cv.style.layer];
        if (gain !== undefined && gain <= 0.02) continue;
        const fine = FINE_LAYERS[cv.style.layer] || 0;
        const pp = projectCurve(rig, view, df, cv, { eps, gap, ids, horizon: fine, g });
        // Fold and crease carry the knuckle's own structure (the crest of a
        // bent joint, the wrinkle it leaves), toned for where they usually
        // sit: spaced out across an open hand, with plenty else nearby to
        // read them against. Over an open patch of paper — nothing else
        // within reach, which is exactly what a fist seen from above does
        // to its own knuckle row — that same tone is too little to carry
        // the line alone, so lean on it harder there. crowdGive already
        // handles the opposite problem (too much nearby, not too little),
        // so this only ever adds where the page is still genuinely bare.
        let press = 1;
        if ((cv.style.layer === 'fold' || cv.style.layer === 'crease') && pp.length) {
          const mid = pp[pp.length >> 1];
          const bare = 1 - clamp01(g.densityAt(mid[0], mid[1], 14) / 0.12);
          press = lerp(1, 2.8, bare);
        }
        const tone = (gain === undefined ? 1 : clamp(gain, 0, 2)) * press;
        for (const r of runs(pp, 0.05, 2)) put(r, cv.style, tone);

        if (ghost > 0.01 && cv.style.layer !== 'print' && cv.style.layer !== 'ridge' &&
          cv.style.layer !== 'hatch' && cv.style.layer !== 'model' && cv.style.layer !== 'hair') {
          for (const r of runs(pp, 0.06, 4)) {
            put(r, F.st(cv.style, { passes: 1, taper: 0.85 }), tone * ghost);
          }
        }
      }

      // ---- contours --------------------------------------------------------
      if (layers.contour) this._contours(rig, view, df, ids, g, grade, stl, toneScale, wobScale, ghost, eps, gap,
        state.trace || null, state.contourOnly || null);

      built.ms = Date.now() - t0;
      this.last = built;
      return built;
    }

    _contours(rig, view, df, ids, g, grade, stl, toneScale, wobScale, ghost, eps, gap, trace, only) {
      const search = stl.search === undefined ? 0.35 : stl.search;

      /**
       * pts carry [x, y, near, partId, gain]. Everything about whether a mark
       * survives is decided here: how much of it another part covers, how
       * deeply, and whether it rides an overlapping edge worth pressing on.
       */
      const emit = (pts, style, opts) => {
        opts = opts || {};
        // Which construction drew this line. A drawing that has gone wrong
        // shows a line in the wrong place, and the first question is always
        // which of eight constructions put it there - a question the finished
        // plate cannot answer, because every one of them lands in the same
        // graphite. Recorded only when a caller asks (tools/parts.js).
        if (trace) trace.push({ src: opts.src || 'other', pts: pts.slice() });
        // ...and a caller can ask for one of them on its own
        if (only && (opts.src || 'other') !== only) return;
        const selfTol = opts.selfTest ? eps * 3 + 1.6 : 0;
        // slots: 0 x, 1 y, 2 front, 3 near, 4 ghost, 5 gain, 6 part id,
        // then 7 visibility, 8 ghost decay, 9 turn, 10 base gain - the last
        // four are working values, resolved into 2/4/5 in the pass below once
        // the edge's own strength is known.
        const tagged = pts.map(p => {
          const id = p[3] === undefined ? -1 : p[3];
          let v = 1 - df.hidden(p[0], p[1], p[2], id, eps, gap);
          // The palm outline is a per-section extreme, not a true silhouette:
          // where the sheet's own sections overlap in screen space, one can
          // dive inside the form. Testing it against the palm's own front
          // surface throws away exactly those points and nothing else.
          if (opts.selfTest) v *= 1 - df.hidden(p[0], p[1], p[2], id, selfTol, gap * 2, true);
          const behind = df.behind(p[0], p[1], p[2], id);
          // A shallow step doesn't always mean a weak edge - two knuckles
          // pressed together part with almost no depth between them, yet the
          // surface still turns hard right there. So the turn the surface is
          // taking underfoot can rescue an edge the separation alone would
          // have thrown away, though only so far: a silhouette sits by
          // definition where the depth field falls off a cliff, so its slope
          // is always steep, and at equal weight this term stops being a
          // rescue and becomes an override.
          const turn = smoothstep(clamp01(df.slopeAt(p[0], p[1]) / 0.35));
          const base = (p[4] === undefined ? 1 : p[4]) * crowdGive(g, p[0], p[1]);
          const decay = Math.exp(-Math.max(0, behind - 2) / 11);
          return [p[0], p[1], 0, p[2], 0, 0, id, v, decay, turn, base];
        });
        for (let i = 0; i < tagged.length; i++) {
          const p = tagged[i];
          const a = tagged[Math.max(0, i - 1)], b = tagged[Math.min(tagged.length - 1, i + 1)];
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const dl = Math.hypot(dx, dy) || 1;
          const ux = -dy / dl, uy = dx / dl;
          // What is behind this edge? Asked at the contour point itself the
          // answer is almost always "nothing", because a contour point sits
          // exactly on its own part's boundary and the thing behind it starts
          // a pixel or two further out - measured on a clenched fist, 841 of
          // 1197 contour points reported open air, which cannot be true of a
          // hand with its fingers folded into its own palm. Every one of them
          // then drew at full strength, so the outer boundary of the hand and
          // the seam between two fingers pressed together came out as the
          // same black line and the fist read as five separate sausages.
          //
          // So ask just outside, both ways, and keep the nearest answer.
          // Something in FRONT is not an answer: stepBehind already returns
          // Infinity for that, which is what stops a finger crossing in front
          // from lightening the edge it is crossing.
          let step = df.stepBehind(p[0], p[1], p[3], p[6]);
          for (const sgn of [-1, 1]) {
            // Out to about a millimetre and a half in scene units. Adjacent
            // fingers in a fist are pressed together with under a millimetre
            // between their surfaces, which at this scale is seven pixels -
            // a probe that only reached five found nothing and reported open
            // air between two touching fingers. Reaching further than this
            // stops finding neighbours and starts finding the next thing
            // along: past sixteen pixels the count barely moves.
            for (const off of [3, 7, 12]) {
              const s2 = df.stepBehind(p[0] + ux * sgn * off, p[1] + uy * sgn * off, p[3], p[6]);
              if (s2 < step) step = s2;
            }
          }
          const merge = step === Infinity ? 1 : 0.16 + 0.84 * smoothstep(clamp01(step / 13));
          const gain = p[10] * Math.max(merge, 0.45 * p[9]);
          p[5] = gain;
          p[2] = p[7] * gain;
          p[4] = (1 - p[7]) * p[8] * gain;
          // Overlap emphasis: where this form passes in front of another, a
          // draughtsman leans on the line.
          let best = 0;
          for (const sgn of [-1, 1]) {
            const bh = df.behind(p[0] + ux * sgn * 5, p[1] + uy * sgn * 5, p[3], p[6]);
            if (bh > 0.5 && bh < 70) best = Math.max(best, clamp01(bh / 14));
          }
          p[2] *= 1 + best * 0.55;
        }
        for (const r of runs(tagged, 0.06, 2, opts.maxJump)) {
          g.stroke(r.pts, {
            grade, tone: style.tone * toneScale, weight: style.weight,
            passes: style.passes, taper: style.taper,
            wobble: (style.wobble || 1) * wobScale, jitter: style.jitter,
            phase: (style.phase || 0) * 0.137 + 11.7, vis: r.vis
          });
        }
        if (ghost > 0.01 && !opts.noGhost) {
          for (const r of runs(tagged, 0.08, 4, opts.maxJump)) {
            if (M.polyLen(r.pts) < 22) continue;
            g.stroke(r.pts, {
              grade, tone: style.tone * toneScale * ghost * 0.9, weight: style.weight * 0.85,
              passes: 1, taper: 0.85, wobble: (style.wobble || 1) * wobScale * 1.3,
              jitter: style.jitter, phase: (style.phase || 0) * 0.31 + 5.3, vis: r.vis
            });
          }
        }
        // the searching lines a hand lays down beside the one it means
        if (search > 0.02 && !opts.noSearch) {
          for (let k = 0; k < 2; k++) {
            const off = (k === 0 ? 1 : -1) * (1.6 + k * 1.4);
            const shifted = tagged.map((p, i) => {
              const a = tagged[Math.max(0, i - 1)], b = tagged[Math.min(tagged.length - 1, i + 1)];
              const dx = b[0] - a[0], dy = b[1] - a[1];
              const dl = Math.hypot(dx, dy) || 1;
              return [p[0] - dy / dl * off, p[1] + dx / dl * off, p[2], p[3], p[4], p[5], p[6]];
            });
            for (const r of runs(shifted, 0.30, 2, opts.maxJump)) {
              // A hand searches alongside a line it is committing to, not
              // beside every twelve-pixel fragment a busy pose leaves behind.
              if (M.polyLen(r.pts) < 46) continue;
              g.stroke(r.pts, {
                grade, tone: style.tone * toneScale * 0.16 * search, weight: style.weight * 0.8,
                passes: 1, taper: 0.9, wobble: (style.wobble || 1) * wobScale * 1.9,
                jitter: style.jitter * 2.0, phase: (style.phase || 0) * 0.7 + k * 21.3, vis: r.vis
              });
            }
          }
        }
      };

      // A rail that leaps across the picture is not one line: a digit turning
      // through the view hands its silhouette from one flank to the other.
      const jumpD = Math.max(12, this.w * 0.030);
      const fw = RG.firstWeb(rig, view);
      // Where the web meets the thumb, the thumb's boundary is not free: it
      // runs into tissue that belongs to both. The union outline closes
      // unconditionally and knows nothing about that, so it draws a finished
      // edge straight across the join, and at the elevations where the web is
      // edge-on - and therefore drawing almost nothing itself - that edge is
      // the whole reason the thumb reads as a rounded form sitting beside the
      // hand rather than part of it.
      const webAngles = fw.thSide.map(P => view.px(P));
      // Back to front, and it is not a nicety. Graphite accumulates into a
      // field that later marks read: a stroke gives way where the paper is
      // already dark and presses where it is bare. Laid down in digit order
      // that feedback runs backwards half the time - a finger at the back of
      // the hand gets the bare paper and the full pressure, and the one in
      // front arrives second and yields to it. Sorted by depth, the same
      // mechanism does what a hand does: the far form is stated first and the
      // near one is laid over it, so the near one is the darker line and the
      // drawing has an order in it.
      const order = [0, 1, 2, 3, 4].sort((a, b) => {
        const da = view.near(rig.digits[a].tip) + view.near(rig.digits[a].segs[1].A);
        const db = view.near(rig.digits[b].tip) + view.near(rig.digits[b].segs[1].A);
        return da - db;
      });
      for (const d of order) {
        // One outline per digit, traced from what the digit covers. Every
        // per-section construction that used to live here - two rails, a tip
        // cap, a patch for the last bone, a patch for the whole digit, and
        // the cross-fades holding them apart - answered the same question in
        // a way that only works while the finger runs across the picture.
        // A border walk answers it the same way from every direction, and
        // arrives joined instead of needing to be joined.
        const sil = RG.digitSilhouette(rig, view, d);
        if (sil.use) {
          let outline = sil.outline;
          // Where the thumb's own edge runs into the first web it is not an
          // edge: the web is tissue belonging to both, and a finished line
          // ruled across it is what made the thumb read as a lump set beside
          // the hand rather than part of it.
          if (d === AN.THUMB) {
            outline = outline.map((p) => {
              const a = Math.atan2(p[1] - view.h * 0.5, p[0] - view.w * 0.5);
              let near = 9;
              for (const w of webAngles) {
                const dx = p[0] - w[0], dy = p[1] - w[1];
                const dd = Math.hypot(dx, dy);
                if (dd < near) near = dd;
              }
              void a;
              return [p[0], p[1], p[2], p[3], p[4] * smoothstep(clamp01((near - 5) / 16))];
            });
          }
          emit(outline, F.st(F.S.contour, { tone: 0.95, phase: d * 37 + 1 }),
            { maxJump: jumpD, src: 'digit:' + rig.digits[d].name });
        }
        // The knuckle is a real step in the outline of a foreshortened digit,
        // and it is inside the border walk, not on it - so it still has to be
        // drawn, and still only over the arc where the surface grazes.
        const rings = RG.knuckleRings(rig, view, d);
        for (let ri = 0; ri < rings.length; ri++) {
          emit(rings[ri], F.st(F.S.contour, { tone: 0.95, phase: d * 37 + 40 + ri }),
            { noSearch: true, noGhost: true, selfTest: true, maxJump: jumpD, src: 'knuckle' });
        }
      }

      const u0 = -0.44, u1 = 1.030;
      const sil = RG.palmSilhouette(rig, view, { nu: 56, nb: 96, u0, u1 });
      const tagPalm = (arr, fade) => arr.map((p, k) => {
        const u = lerp(u0, u1, k / (arr.length - 1));
        return [p[0], p[1], p[2], ids.palm,
          fade === false ? 1 : smoothstep(clamp01((u + 0.40) / 0.30))];
      });
      // Seen from the back the thumb's metacarpal is inside the hand: the thenar
      // and the first dorsal interosseous wrap it, so the palm's radial border
      // is not an edge wherever that bone lies under or just beside it - a line
      // there rules the thumb off as a thing tucked under the flesh. Its own
      // outline, and the web, say where the thumb actually separates.
      const tSegs = ids.digit[AN.THUMB], tMc = tSegs[0], tPx = tSegs[1];
      const cellAt = (x, y) => {
        const cx = (x / df.div) | 0, cy = (y / df.div) | 0;
        return cx < 0 || cy < 0 || cx >= df.w || cy >= df.h ? -1 : cy * df.w + cx;
      };
      const overThumb = (x, y) => {
        let hits = 0, n = 0;
        for (const [ox, oy] of [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5], [9, 0], [-9, 0], [0, 9], [0, -9]]) {
          const c = cellAt(x + ox, y + oy);
          n++;
          if (c < 0) continue;
          if (df.i0[c] === tMc || df.i1[c] === tMc) hits++;
          else if (df.i1[c] === tPx && df.i0[c] === ids.palm) hits++;
        }
        return hits / n;
      };
      const unwrapThumb = (arr) => arr.map((p) => {
        const k = smoothstep(clamp01(overThumb(p[0], p[1]) / 0.34));
        return k > 0 ? [p[0], p[1], p[2], p[3], p[4] * (1 - k)] : p;
      });
      const jump = Math.max(14, this.w * 0.035);
      emit(unwrapThumb(tagPalm(sil.sideA)), F.st(F.S.contour, { tone: 0.90, phase: 200 }), { maxJump: jump, selfTest: true, src: 'palm' });
      emit(unwrapThumb(tagPalm(sil.sideB)), F.st(F.S.contour, { tone: 0.90, phase: 201 }), { maxJump: jump, selfTest: true, src: 'palm' });
      emit(tagPalm(sil.cap, false),
        F.st(F.S.contourSoft, { tone: 0.30, taper: 0.86, phase: 202 }),
        { noSearch: true, selfTest: true, src: 'palmCap' });
      // The thumb's commissure, as the outline of the wedge it actually is:
      // a closed band running up the thumb's own flank, across the free
      // margin, back down the palm's, and across the depth of the
      // commissure — where it bulges most, and where a bare mid-sheet had
      // nothing to show at all. selfTest buries whatever part of that band
      // faces away behind the part that covers it.
      if (rig.ball) {
        const bo = ballOutline(rig.ball, view).map(p => [p[0], p[1], p[2], ids.ball, 1]);
        emit(bo, F.st(F.S.contour, { tone: 0.86, weight: 1.05, taper: 0.5, phase: 300 }),
          { src: 'ball', noSearch: true, maxJump: jump });
      }
      // the band's flank along the thumb's metacarpal is the same buried flesh
      emit(unwrapThumb(fw.band), F.st(F.S.contour, { tone: 1.05, weight: 1.18, taper: 0.5, phase: 208 }),
        { src: 'web', maxJump: jump, selfTest: true });
      // the free margins of the webs, spanning finger to finger
      const webs = RG.webContours(rig, view);
      for (let i = 0; i < webs.length; i++) {
        emit(webs[i], F.st(F.S.contour, { tone: 0.72, taper: 0.68, phase: 210 + i }),
          { src: 'web', noSearch: true, maxJump: jump });
      }
    }

    resolve(state) {
      const stl = (state && state.style) || {};
      return this.g.resolve({
        paper: stl.paper || [244, 241, 232],
        ink: stl.ink || [26, 25, 23],
        k: stl.k === undefined ? 1.55 : stl.k,
        gamma: stl.gamma === undefined ? 1.0 : stl.gamma,
        sheen: stl.sheen,
        vignette: stl.vignette,
        paperGrain: stl.paperGrain
      });
    }
  }

  GK.render = { Renderer, DepthField, rasterise, buildIds, projectCurve, runs, ballOutline, DEFAULT_LAYERS };
})(window.GK = window.GK || {});

