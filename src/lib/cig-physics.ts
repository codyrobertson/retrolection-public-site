/**
 * The cigarette and its ash as bodies, for the break (cig-break): what the hand takes up is a rigid
 * rod with mass, lying under gravity in a solid glass dish, held by fingers that grip with friction.
 *
 * The world   the dish as drawn (footer-art.mjs, meta.dish): its profile turned about its axis (the
 *             foot, the rim's flat top, the inner wall bowing down to the floor) with its three rests
 *             cut across it as rounded grooves whose beds fall toward the middle, and the table under
 *             it all; held as a signed distance (mm), so anything can ask how far it is from glass and
 *             which way is out
 * The rod     a chain of spheres the cigarette's radius along its axis, each with the mass of what it
 *             is (filter, tobacco, ash), so its centre of mass sits over the rest, inside the groove,
 *             and moves back toward the filter when the ash goes; it has no roll (the drawing can't
 *             show one), so it is five degrees of freedom: where it is and which way its axis points
 * Contacts    every sphere against the glass: non-penetration and Coulomb friction (paper on glass)
 *             as impulses, solved in sub-steps the way Box2D v3 does (soft contact while solving,
 *             rigid in a relax pass, then restitution), with speculative margins so nothing tunnels
 * The grip    the finger pads as two soft constraints with limits: a point weld (the filter can't
 *             leave the pinch while the friction holds) and an angular one about it (a pinch resists
 *             turning, but not rigidly: the cigarette droops a little under its own weight and rings
 *             when struck); both fade as the fingers open, so laying it down is letting go of it
 * The ash     breaks off when a jolt across the axis outruns its bond; then a clump and its crumbs fall
 *             as spheres under gravity and air drag, against the glass, the rod and each other, and
 *             come to rest; a clump that lands hard crumbles
 * Lengths are mm, masses g, times s.
 */
import ART from "@/lib/footer-art.json";

const D = ART.dish;
const DEG = Math.PI / 180;
export const G = 9810;
const SUB = 8;                                   // sub-steps per step
const ITERS = 2;                                 // solver passes per sub-step, before the relax
const MU = 0.35, BOUNCE = 0.15, BOUNCE_V = 120;  // paper on glass; the restitution, and the closing speed it needs
const MARGIN = 1.2;                              // mm: how near a sphere must come to the glass to be a contact (speculative)
const PUSH = 200;                                // mm/s: the fastest the solver pushes out of an overlap
const CONTACT = { hz: 60, z: 10 }, WELD = { hz: 60, z: 1 }, PINCH = { w: 60, z: 0.16 };
const FMAX = 4e5, TMAX = 6e5;                    // the pinch's friction: g·mm/s² (0.4 N), g·mm²/s² (0.6 N·mm)

export type V3 = [number, number, number];

// ---- the world ------------------------------------------------------------------------------------

const wall = (t: number) => [D.lip - (D.lip - D.floor) * t, D.zr - (D.zr - D.zf) * Math.pow(t, 1.5)];
// the dish's half-section (r, z), closed round the solid
const PROFILE = [[0, 0], [D.rim, 0], [D.rim, D.zr], ...Array.from({ length: 13 }, (_, i) => wall(i / 12)), [0, D.zf]];
const RESTS = D.rests.map((a) => [Math.cos(a * DEG), Math.sin(a * DEG)]);
const MID = (D.rim - D.lip) / 2;
/** the bed of a rest's groove at `u` mm in from the rim, falling toward the middle as the cigarette lying in it does */
const bed = (u: number) => D.zr - D.gd - D.slope * (u - MID);

function sdProfile(r: number, z: number) {
  let d = Infinity, inside = false;
  for (let i = 0, j = PROFILE.length - 1; i < PROFILE.length; j = i++) {
    const [ax, ay] = PROFILE[i], [bx, by] = PROFILE[j];
    const ex = bx - ax, ey = by - ay, wx = r - ax, wy = z - ay;
    const t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    const qx = wx - ex * t, qy = wy - ey * t;
    d = Math.min(d, qx * qx + qy * qy);
    if ((ay > z) !== (by > z) && r < ax + ((z - ay) * ex) / ey) inside = !inside;
  }
  return inside ? -Math.sqrt(d) : Math.sqrt(d);
}

/** signed distance (mm) from a point to the glass or the table: negative inside */
export function sdf(x: number, y: number, z: number) {
  let d = sdProfile(Math.hypot(x, y), z);
  if (d < 8) {
    // the rests: a U across the rim, its round bottom the groove's bed, its sides up through the rim's top
    for (const [cx, cy] of RESTS) {
      const a = x * cx + y * cy, w = y * cx - x * cy;
      if (a <= 0 || Math.abs(w) > D.hw + 8) continue;
      const zc = bed(D.rim - a) + D.hw;
      const ch = Math.max(z < zc ? Math.hypot(w, z - zc) - D.hw : Math.abs(w) - D.hw, -a);
      d = Math.max(d, -ch);
    }
  }
  return Math.min(d, z);
}

const EPS = 0.01;
/** the way out of the glass at a point (unit) */
function normal(x: number, y: number, z: number, out: number[]) {
  const nx = sdf(x + EPS, y, z) - sdf(x - EPS, y, z), ny = sdf(x, y + EPS, z) - sdf(x, y - EPS, z), nz = sdf(x, y, z + EPS) - sdf(x, y, z - EPS);
  const l = Math.hypot(nx, ny, nz) || 1;
  out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
}

/** Box2D's soft constraint: bias rate, mass scale and impulse scale for a spring of `hz` and damping ratio `z` over a step `h` */
function soft(hz: number, z: number, h: number) {
  const w = 2 * Math.PI * hz, a1 = 2 * z + h * w, a2 = h * w * a1, a3 = 1 / (1 + a2);
  return { bias: w / a1, mass: a2 * a3, imp: a3 };
}

// ---- the cigarette as drawn -----------------------------------------------------------------------

const [U0, UF, UB, U1] = D.u, RAD = D.rad, ALONG = Math.hypot(1, D.slope);   // mm of axis per mm of u
const [AXc, AXs] = RESTS[0];
/** a point on the axis of the cigarette lying in its rest, `u` mm in from the rim */
export const restAt = (u: number): V3 => [D.rim * AXc - AXc * u, D.rim * AXs - AXs * u, bed(u) + RAD];
/** its axis, filter to tip */
export const REST_AXIS: V3 = (() => { const l = Math.hypot(1, D.slope); return [-AXc / l, -AXs / l, -D.slope / l]; })();
/** the station (mm along the axis from the rim's outer edge) of a point `u` in from the rim */
export const station = (u: number) => u * ALONG;
/** the middle of the ash, and the ember at its root */
export const ASH_AT = station((UB + U1) / 2), EMBER_AT = station(D.ember);

// what each length of it weighs, g/mm: a heavy filter, the tobacco, the ash
const density = (u: number) => (u < UF ? 0.27 / (UF - U0) : u < UB ? 0.42 / (UB - UF) : 0.06 / (U1 - UB));

type Contact = { b: number; nx: number; ny: number; nz: number; s: number; rx: number; ry: number; rz: number; mn: number; vn0: number; ln: number; tx: number; ty: number; tz: number };
export type Grip = {
  /** 0..1: how hard the fingers hold */
  on: number;
  /** the station held, and where the hand has it (and how fast that is going) */
  at: number; to: V3; vel: V3;
  /** the axis the hand would have it point, and the hand's turn rate about the vertical */
  axis: V3; wz: number;
};

export class Cigarette {
  // the spheres: station along the axis, mass, whether ash
  s: number[] = []; m: number[] = []; ash: boolean[] = [];
  private whole: { s: number[]; m: number[]; ash: boolean[] };
  M = 0; sc = 0; I = 0;
  x: V3; v: V3 = [0, 0, 0]; d: V3; w: V3 = [0, 0, 0];
  /** the weight the glass bears now, g·mm/s² */
  load = 0;
  asleep = true;
  private calm = 0;
  private lw: V3 = [0, 0, 0];     // the grip's impulses, carried through a sub-step
  private la: V3 = [0, 0, 0];
  private n = [0, 0, 0];

  constructor() {
    const n = 29, a = station(U0 + 1.5), b = station(U1 - 1.5), ds = (b - a) / (n - 1);
    for (let i = 0; i < n; i++) { const s = a + ds * i, u = s / ALONG; this.s.push(s); this.m.push(density(u) * ds); this.ash.push(u > UB); }
    this.whole = { s: [...this.s], m: [...this.m], ash: [...this.ash] };
    this.d = [...REST_AXIS];
    this.x = [0, 0, 0];
    this.mass();
    const o = restAt(0);
    this.x = [o[0] + this.d[0] * this.sc, o[1] + this.d[1] * this.sc, o[2] + this.d[2] * this.sc];
  }

  /** the mass, the centre of mass's station and the inertia across the axis, from the spheres */
  private mass() {
    let M = 0, ms = 0;
    for (let i = 0; i < this.s.length; i++) { M += this.m[i]; ms += this.m[i] * this.s[i]; }
    const sc = ms / M, old = this.sc;
    let I = M * (RAD * RAD) / 4;
    for (let i = 0; i < this.s.length; i++) I += this.m[i] * ((this.s[i] - sc) ** 2 + (this.s[1] - this.s[0]) ** 2 / 12);
    // the centre moved along the body: carry the state to the new one
    if (this.M) {
      const k = sc - old, d = this.d, w = this.w;
      for (let j = 0; j < 3; j++) this.x[j] += d[j] * k;
      this.v[0] += (w[1] * d[2] - w[2] * d[1]) * k; this.v[1] += (w[2] * d[0] - w[0] * d[2]) * k; this.v[2] += (w[0] * d[1] - w[1] * d[0]) * k;
    }
    this.M = M; this.sc = sc; this.I = I;
  }

  /** a point on the axis at station `s` */
  at(s: number): V3 { const k = s - this.sc; return [this.x[0] + this.d[0] * k, this.x[1] + this.d[1] * k, this.x[2] + this.d[2] * k]; }
  /** its velocity */
  vel(s: number): V3 {
    const k = s - this.sc, d = this.d, w = this.w;
    return [this.v[0] + (w[1] * d[2] - w[2] * d[1]) * k, this.v[1] + (w[2] * d[0] - w[0] * d[2]) * k, this.v[2] + (w[0] * d[1] - w[1] * d[0]) * k];
  }
  get ashed() { return !this.ash.some(Boolean); }

  /** a blow that turns it about station `s` (the pinch) by `dw` rad/s about `axis` (unit, across the axis), leaving that point where it is */
  strike(s: number, axis: V3, dw: number) {
    const k = this.sc - s, Ia = this.I + this.M * k * k, L = dw * Ia;
    this.spin(s, [axis[0] * L, axis[1] * L, axis[2] * L]);
    this.asleep = false;
  }
  /** an angular impulse about station `s`, the body turning about that point */
  private spin(s: number, L: number[]) {
    const d = this.d, k = this.sc - s, Ia = this.I + this.M * k * k;
    const dot = L[0] * d[0] + L[1] * d[1] + L[2] * d[2];
    const ax = (L[0] - dot * d[0]) / Ia, ay = (L[1] - dot * d[1]) / Ia, az = (L[2] - dot * d[2]) / Ia;
    this.w[0] += ax; this.w[1] += ay; this.w[2] += az;
    // the centre goes round the pivot: Δv = Δω × (x − pivot)
    this.v[0] += (ay * d[2] - az * d[1]) * k; this.v[1] += (az * d[0] - ax * d[2]) * k; this.v[2] += (ax * d[1] - ay * d[0]) * k;
  }

  /** the ash breaks away: its spheres leave the body; returns where its middle was and how it was moving */
  shed() {
    const p = this.at(ASH_AT), u = this.vel(ASH_AT);
    for (let i = this.s.length - 1; i >= 0; i--) if (this.ash[i]) { this.s.splice(i, 1); this.m.splice(i, 1); this.ash.splice(i, 1); }
    this.mass();
    return { p, v: u };
  }

  /** the ash grown back (between breaks) */
  regrow() {
    if (!this.ashed) return;
    this.s = [...this.whole.s]; this.m = [...this.whole.m]; this.ash = [...this.whole.ash];
    this.mass();
  }

  /** one step of `dt`, held by `grip` (or not) */
  step(dt: number, grip: Grip | null) {
    const holding = !!grip && grip.on > 0;
    if (holding) this.asleep = false;
    if (this.asleep) { this.load = 0; return; }
    const h = dt / SUB, cs = soft(CONTACT.hz, CONTACT.z, h), ws = soft(WELD.hz, WELD.z, h), ps = soft(PINCH.w / (2 * Math.PI), PINCH.z, h);
    let load = 0;
    for (let sub = 0; sub < SUB; sub++) {
      this.v[2] -= G * h;
      const cts = this.contacts(h);
      this.lw[0] = this.lw[1] = this.lw[2] = 0; this.la[0] = this.la[1] = this.la[2] = 0;
      for (let it = 0; it < ITERS; it++) {
        if (holding) this.hold(grip!, ws, ps, h);
        this.solve(cts, cs, h, true);
      }
      // move
      for (let j = 0; j < 3; j++) this.x[j] += this.v[j] * h;
      this.turn(h);
      if (holding) { const a = grip!; a.to[0] += a.vel[0] * h; a.to[1] += a.vel[1] * h; a.to[2] += a.vel[2] * h; }
      // the relax: the same contacts held rigidly, without the push that corrects overlap, and the bounces
      this.solve(cts, cs, h, false);
      for (const c of cts) {
        if (c.vn0 > -BOUNCE_V || c.ln <= 0) continue;
        const vn = this.relN(c), dl = -c.mn * (vn + BOUNCE * c.vn0), nl = Math.max(c.ln + dl, 0);
        this.push(c, (nl - c.ln) * c.nx, (nl - c.ln) * c.ny, (nl - c.ln) * c.nz); c.ln = nl;
      }
      for (const c of cts) load += c.ln;
    }
    this.load = load / dt;
    // asleep once it has been still a while with nothing holding it
    const still = Math.hypot(...this.v) < 1.5 && Math.hypot(...this.w) < 0.03;
    this.calm = !holding && still ? this.calm + dt : 0;
    if (this.calm > 0.3) { this.asleep = true; this.v = [0, 0, 0]; this.w = [0, 0, 0]; }
  }

  /** turn the axis by ω over h (ω is across the axis, so it stays so) */
  private turn(h: number) {
    const w = this.w, d = this.d, a = Math.hypot(w[0], w[1], w[2]) * h;
    if (a < 1e-12) return;
    const l = a / h, kx = w[0] / l, ky = w[1] / l, kz = w[2] / l, c = Math.cos(a), s = Math.sin(a);
    const cx = ky * d[2] - kz * d[1], cy = kz * d[0] - kx * d[2], cz = kx * d[1] - ky * d[0];
    const nx = d[0] * c + cx * s, ny = d[1] * c + cy * s, nz = d[2] * c + cz * s, n = Math.hypot(nx, ny, nz);
    d[0] = nx / n; d[1] = ny / n; d[2] = nz / n;
    const dot = w[0] * d[0] + w[1] * d[1] + w[2] * d[2];
    w[0] -= dot * d[0]; w[1] -= dot * d[1]; w[2] -= dot * d[2];
  }

  /** the spheres near enough the glass to touch it within this sub-step */
  private contacts(h: number) {
    const out: Contact[] = [], n = this.n, d = this.d, v = this.v, IM = 1 / this.M, II = 1 / this.I;
    const reach = MARGIN + Math.hypot(...v) * h;
    for (let b = 0; b < this.s.length; b++) {
      const k = this.s[b] - this.sc, px = this.x[0] + d[0] * k, py = this.x[1] + d[1] * k, pz = this.x[2] + d[2] * k;
      // nowhere near the dish or the table
      if (pz > D.zr + RAD + reach + 1 || (pz > RAD + reach && Math.hypot(px, py) > D.rim + RAD + reach)) continue;
      const s = sdf(px, py, pz) - RAD;
      if (s > reach) continue;
      normal(px, py, pz, n);
      const rx = d[0] * k, ry = d[1] * k, rz = d[2] * k;
      // r × n
      const cx = ry * n[2] - rz * n[1], cy = rz * n[0] - rx * n[2], cz = rx * n[1] - ry * n[0];
      const c: Contact = { b, nx: n[0], ny: n[1], nz: n[2], s, rx, ry, rz, mn: 1 / (IM + (cx * cx + cy * cy + cz * cz) * II), vn0: 0, ln: 0, tx: 0, ty: 0, tz: 0 };
      c.vn0 = this.relN(c);
      out.push(c);
    }
    return out;
  }
  private rel(c: Contact): V3 {
    const w = this.w;
    return [this.v[0] + w[1] * c.rz - w[2] * c.ry, this.v[1] + w[2] * c.rx - w[0] * c.rz, this.v[2] + w[0] * c.ry - w[1] * c.rx];
  }
  private relN(c: Contact) { const u = this.rel(c); return u[0] * c.nx + u[1] * c.ny + u[2] * c.nz; }
  /** an impulse at a contact's sphere */
  private push(c: Contact, px: number, py: number, pz: number) {
    const IM = 1 / this.M, II = 1 / this.I;
    this.v[0] += px * IM; this.v[1] += py * IM; this.v[2] += pz * IM;
    this.w[0] += (c.ry * pz - c.rz * py) * II; this.w[1] += (c.rz * px - c.rx * pz) * II; this.w[2] += (c.rx * py - c.ry * px) * II;
  }

  private solve(cts: Contact[], cs: ReturnType<typeof soft>, h: number, bias: boolean) {
    const IM = 1 / this.M, II = 1 / this.I;
    for (const c of cts) {
      // the normal: no closing into the glass (speculatively: no closer than touching by the sub-step's end)
      let b = 0, ms = 1, is = 0;
      if (c.s > 0) b = c.s / h;
      else if (bias) { b = Math.max(cs.bias * c.s, -PUSH); ms = cs.mass; is = cs.imp; }
      const vn = this.relN(c), dl = -c.mn * ms * (vn + b) - is * c.ln, nl = Math.max(c.ln + dl, 0), a = nl - c.ln;
      c.ln = nl;
      this.push(c, a * c.nx, a * c.ny, a * c.nz);
      // friction: the slip across the normal, stopped within the cone μ·λn
      const u = this.rel(c), un = u[0] * c.nx + u[1] * c.ny + u[2] * c.nz;
      const tx = u[0] - un * c.nx, ty = u[1] - un * c.ny, tz = u[2] - un * c.nz, tl = Math.hypot(tx, ty, tz);
      if (tl < 1e-9) continue;
      const ex = tx / tl, ey = ty / tl, ez = tz / tl;
      const cx = c.ry * ez - c.rz * ey, cy = c.rz * ex - c.rx * ez, cz = c.rx * ey - c.ry * ex;
      const mt = 1 / (IM + (cx * cx + cy * cy + cz * cz) * II);
      let fx = c.tx - mt * tx, fy = c.ty - mt * ty, fz = c.tz - mt * tz;
      const fl = Math.hypot(fx, fy, fz), cap = MU * c.ln;
      if (fl > cap) { const q = cap / fl; fx *= q; fy *= q; fz *= q; }
      this.push(c, fx - c.tx, fy - c.ty, fz - c.tz);
      c.tx = fx; c.ty = fy; c.tz = fz;
    }
  }

  /** the fingers: the held point kept in the pinch, and the axis turned as the hand has it, both as far as friction allows */
  private hold(g: Grip, ws: ReturnType<typeof soft>, ps: ReturnType<typeof soft>, h: number) {
    const d = this.d, k = g.at - this.sc, IM = 1 / this.M;
    const rx = d[0] * k, ry = d[1] * k, rz = d[2] * k, w = this.w;
    // the point: error and its rate
    const p = this.at(g.at), u = this.vel(g.at);
    const C = [p[0] - g.to[0], p[1] - g.to[1], p[2] - g.to[2]], Cd = [u[0] - g.vel[0], u[1] - g.vel[1], u[2] - g.vel[2]];
    const q = [0, 0, 0];
    for (let j = 0; j < 3; j++) q[j] = ws.mass * (Cd[j] + ws.bias * C[j]);
    // K⁻¹ q: along the axis the whole mass; across it, the mass as felt at the point
    const along = q[0] * d[0] + q[1] * d[1] + q[2] * d[2], mp = 1 / (IM + (k * k) / this.I);
    const L = [0, 0, 0];
    for (let j = 0; j < 3; j++) L[j] = -(this.M * along * d[j] + mp * (q[j] - along * d[j])) - ws.imp * this.lw[j];
    const lim = FMAX * g.on * h;
    let nx = this.lw[0] + L[0], ny = this.lw[1] + L[1], nz = this.lw[2] + L[2];
    const nl = Math.hypot(nx, ny, nz);
    if (nl > lim) { const s = lim / nl; nx *= s; ny *= s; nz *= s; }
    const ax = nx - this.lw[0], ay = ny - this.lw[1], az = nz - this.lw[2];
    this.lw[0] = nx; this.lw[1] = ny; this.lw[2] = nz;
    this.v[0] += ax * IM; this.v[1] += ay * IM; this.v[2] += az * IM;
    this.w[0] += (ry * az - rz * ay) / this.I; this.w[1] += (rz * ax - rx * az) / this.I; this.w[2] += (rx * ay - ry * ax) / this.I;
    // the turn: toward the hand's axis, about the pinch, springy (it droops, it rings)
    const t = g.axis, e = [d[1] * t[2] - d[2] * t[1], d[2] * t[0] - d[0] * t[2], d[0] * t[1] - d[1] * t[0]];
    const Ia = this.I + this.M * k * k;
    const wr = [w[0], w[1], w[2] - g.wz], wd = wr[0] * d[0] + wr[1] * d[1] + wr[2] * d[2];
    const A = [0, 0, 0];
    for (let j = 0; j < 3; j++) A[j] = -Ia * ps.mass * (wr[j] - wd * d[j] - ps.bias * e[j]) - ps.imp * this.la[j];
    const tlim = TMAX * g.on * h;
    let mx = this.la[0] + A[0], my = this.la[1] + A[1], mz = this.la[2] + A[2];
    const ml = Math.hypot(mx, my, mz);
    if (ml > tlim) { const s = tlim / ml; mx *= s; my *= s; mz *= s; }
    const dA = [mx - this.la[0], my - this.la[1], mz - this.la[2]];
    this.la[0] = mx; this.la[1] = my; this.la[2] = mz;
    this.spin(g.at, dA);
  }
}

// ---- the ash --------------------------------------------------------------------------------------

export type Fleck = { x: number; y: number; z: number; vx: number; vy: number; vz: number; r: number; m: number; a: number; spin: number; big: boolean; broke: boolean; still: number; landed: number };
const ASH_MU = 0.6, ASH_E = 0.12, ASH_E_V = 180, CRUMBLE = 300;

/** a step of the flecks: gravity and drag, the glass, the cigarette's spheres, each other; returns crumbs to add */
export function ashStep(fl: Fleck[], dt: number, t: number, cig: Cigarette | null) {
  const born: Fleck[] = [], n = [0, 0, 0], SUBS = 4, h = dt / SUBS;
  for (let sub = 0; sub < SUBS; sub++) {
    for (const q of fl) {
      if (q.landed) continue;
      const drag = Math.exp(-(3 + 5 / q.r) * h);
      q.vx *= drag; q.vy *= drag; q.vz = (q.vz - G * h) * drag;
      q.x += q.vx * h; q.y += q.vy * h; q.z += q.vz * h; q.a += q.spin * h;
      // the glass
      const s = sdf(q.x, q.y, q.z) - q.r;
      let touching = false;
      if (s < 0) {
        normal(q.x, q.y, q.z, n);
        q.x -= s * n[0]; q.y -= s * n[1]; q.z -= s * n[2];
        const vn = q.vx * n[0] + q.vy * n[1] + q.vz * n[2];
        if (vn < 0) {
          if (q.big && !q.broke && vn < -CRUMBLE) { q.broke = true; born.push(...crumble(q, n)); }
          bounce(q, n, vn, vn < -ASH_E_V ? ASH_E : 0);
        }
        touching = true;
      }
      // the cigarette, as it swings back through
      if (cig) for (let b = 0; b < cig.s.length; b++) {
        const c = cig.at(cig.s[b]), dx = q.x - c[0], dy = q.y - c[1], dz = q.z - c[2], l = Math.hypot(dx, dy, dz), o = RAD + q.r - l;
        if (o <= 0 || l < 1e-6) continue;
        n[0] = dx / l; n[1] = dy / l; n[2] = dz / l;
        q.x += o * n[0]; q.y += o * n[1]; q.z += o * n[2];
        const u = cig.vel(cig.s[b]), vn = (q.vx - u[0]) * n[0] + (q.vy - u[1]) * n[1] + (q.vz - u[2]) * n[2];
        if (vn < 0) { q.vx -= u[0]; q.vy -= u[1]; q.vz -= u[2]; bounce(q, n, vn, ASH_E); q.vx += u[0]; q.vy += u[1]; q.vz += u[2]; }
      }
      // at rest once it has lain still a little
      q.still = touching && Math.hypot(q.vx, q.vy, q.vz) < 6 ? q.still + h : 0;
      if (q.still > 0.2) { q.landed = t; q.vx = q.vy = q.vz = 0; }
    }
    // each other
    for (let i = 0; i < fl.length; i++) for (let j = i + 1; j < fl.length; j++) {
      const a = fl[i], b = fl[j], dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l = Math.hypot(dx, dy, dz), o = a.r + b.r - l;
      if (o <= 0 || l < 1e-6 || (a.landed && b.landed)) continue;
      const nx = dx / l, ny = dy / l, nz = dz / l, ia = a.landed ? 0 : 1 / a.m, ib = b.landed ? 0 : 1 / b.m, s = ia + ib;
      if (!s) continue;
      a.x -= nx * o * (ia / s); a.y -= ny * o * (ia / s); a.z -= nz * o * (ia / s);
      b.x += nx * o * (ib / s); b.y += ny * o * (ib / s); b.z += nz * o * (ib / s);
      const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
      if (vn >= 0) continue;
      const j2 = (-(1 + ASH_E) * vn) / s;
      a.vx -= j2 * nx * ia; a.vy -= j2 * ny * ia; a.vz -= j2 * nz * ia;
      b.vx += j2 * nx * ib; b.vy += j2 * ny * ib; b.vz += j2 * nz * ib;
    }
  }
  return born;
}

/** off a surface of normal n: the closing speed reversed by e, the slip cut by friction (Coulomb, on that impulse), the spin damped */
function bounce(q: Fleck, n: number[], vn: number, e: number) {
  q.vx -= (1 + e) * vn * n[0]; q.vy -= (1 + e) * vn * n[1]; q.vz -= (1 + e) * vn * n[2];
  const un = q.vx * n[0] + q.vy * n[1] + q.vz * n[2];
  const tx = q.vx - un * n[0], ty = q.vy - un * n[1], tz = q.vz - un * n[2], tl = Math.hypot(tx, ty, tz);
  if (tl > 1e-9) { const k = Math.max(0, tl - ASH_MU * (1 + e) * -vn) / tl; q.vx = un * n[0] + tx * k; q.vy = un * n[1] + ty * k; q.vz = un * n[2] + tz * k; }
  q.spin *= 0.5;
}

/** a clump that lands hard sheds crumbs off its underside, scattering across the surface */
function crumble(q: Fleck, n: number[]): Fleck[] {
  const out: Fleck[] = [], k = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < k; i++) {
    const r = 0.35 + Math.random() * 0.45, a = Math.random() * 2 * Math.PI, sp = 60 + Math.random() * 120;
    // a direction across the surface
    const up = Math.abs(n[2]) < 0.9;               // any line not along n, crossed with it
    let ex = up ? n[1] : 0, ey = up ? -n[0] : n[2], ez = up ? 0 : -n[1];
    const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
    const fx = n[1] * ez - n[2] * ey, fy = n[2] * ex - n[0] * ez, fz = n[0] * ey - n[1] * ex;
    const c = Math.cos(a), s = Math.sin(a);
    out.push({ x: q.x + (ex * c + fx * s) * q.r * 0.6, y: q.y + (ey * c + fy * s) * q.r * 0.6, z: q.z + n[2] * 0.2, r, m: r ** 3, a, spin: (Math.random() - 0.5) * 16,
      vx: q.vx + (ex * c + fx * s) * sp, vy: q.vy + (ey * c + fy * s) * sp, vz: q.vz + (ez * c + fz * s) * sp + 40, big: false, broke: true, still: 0, landed: 0 });
  }
  q.r *= 0.85; q.m = q.r ** 3;
  return out;
}
