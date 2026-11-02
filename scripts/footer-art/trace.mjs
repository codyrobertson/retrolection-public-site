// What the depth field knows about the hand, as marks: the outline of everything in front (its
// silhouette, and the edge of a finger lying over another part), and the light on it as a tone map.
// The engine draws creases, nails and shading from the rig; this draws what the rig cannot say
// from above: one continuous contour, heavier on the side away from the light.

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * the boundary of the covered cells as polylines in sheet px (`edge`: a cell A is outside-facing
 * where its neighbour B is empty or lies farther than `jump` units behind it, and `apart` says
 * the two parts are separate things: not a finger and the palm it grows out of)
 */
export function outlines(df, { jump = 3, minLen = 14, apart = () => true } = {}) {
  const { w: W, z0, i0 } = df, H = (i0.length / W) | 0;
  const next = new Map();                       // start corner -> [end corner, ...]
  const key = (x, y) => y * (W + 1) + x;
  const add = (x0, y0, x1, y1) => { const k = key(x0, y0); (next.get(k) || next.set(k, []).get(k)).push(key(x1, y1)); };
  const front = (a, b) => i0[b] < 0 || (i0[a] !== i0[b] && z0[a] - z0[b] > jump && apart(i0[a], i0[b]));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = y * W + x;
    if (i0[a] < 0) continue;
    if (y === 0 || front(a, a - W)) add(x, y, x + 1, y);
    if (x === W - 1 || front(a, a + 1)) add(x + 1, y, x + 1, y + 1);
    if (y === H - 1 || front(a, a + W)) add(x + 1, y + 1, x, y + 1);
    if (x === 0 || front(a, a - 1)) add(x, y + 1, x, y);
  }
  const xy = (k) => [k % (W + 1), (k / (W + 1)) | 0];
  const out = [];
  for (const [start] of next) {
    while (next.get(start)?.length) {
      const pts = [xy(start)];
      let k = start;
      for (;;) {
        const list = next.get(k);
        if (!list || !list.length) break;
        k = list.pop();
        pts.push(xy(k));
        if (k === start) break;
      }
      if (pts.length >= minLen) out.push({ pts, closed: pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] });
    }
  }
  return out.map((o) => smoothLine(o));
}

/** the staircase of cell corners, relaxed into a line (moving average, ends held) */
function smoothLine({ pts, closed }, win = 4) {
  const n = pts.length, res = [];
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, c = 0;
    for (let k = -win; k <= win; k++) {
      let j = i + k;
      if (closed) j = ((j % (n - 1)) + (n - 1)) % (n - 1);
      else if (j < 0 || j >= n) continue;
      sx += pts[j][0]; sy += pts[j][1]; c++;
    }
    res.push([sx / c, sy / c]);
  }
  if (closed) res[n - 1] = res[0].slice();
  return { pts: res, closed };
}

/** per-cell surface slope (units of depth per unit of screen) from the front depth; 0 where there is no surface */
export function slopes(df, upp) {
  const { w: W, z0, i0 } = df, H = (i0.length / W) | 0;
  const gx = new Float32Array(W * H), gy = new Float32Array(W * H);
  const ok = (a, b) => i0[b] >= 0 && Math.abs(z0[a] - z0[b]) < 6;
  const R = 3;
  for (let y = R; y < H - R; y++) for (let x = R; x < W - R; x++) {
    const a = y * W + x;
    if (i0[a] < 0) continue;
    const l = ok(a, a - R) ? a - R : a, r = ok(a, a + R) ? a + R : a, u = ok(a, a - R * W) ? a - R * W : a, d = ok(a, a + R * W) ? a + R * W : a;
    gx[a] = r !== l ? (z0[r] - z0[l]) / ((r - l) * upp) : 0;
    gy[a] = d !== u ? (z0[d] - z0[u]) / (((d - u) / W) * upp) : 0;
  }
  return { gx, gy };
}

export { clamp01 };

/**
 * how dark the pencil should lie on each cell: the form turning from the light (a key light
 * at the upper left of the sheet, as the engine's), the rim where a surface rolls away, and the
 * dim in the lee of a part lying over it. 0..1, sheet cells.
 */
export function tone(df, upp, { gain = 1, light = [-0.5, -0.62, 0.6], owner = null, lift = 0.4, valley = 0.5, blurFn = null } = {}) {
  const { w: W, z0, i0 } = df, H = (i0.length / W) | 0;
  // valleys: how far each cell sits below the mean of its surroundings (between knuckles, along tendons, in the webs)
  let conc = null;
  if (blurFn && valley > 0) {
    const zc = new Float32Array(W * H), mk = new Float32Array(W * H);
    for (let i = 0; i < zc.length; i++) if (i0[i] >= 0) { zc[i] = z0[i]; mk[i] = 1; }
    const bz = blurFn(zc, W, H, 9, 2), bm = blurFn(mk, W, H, 9, 2);
    conc = new Float32Array(W * H);
    for (let i = 0; i < conc.length; i++) if (i0[i] >= 0 && bm[i] > 0.55) conc[i] = clamp01(((bz[i] / bm[i] - z0[i]) - 0.4) / 2.6);
  }
  const { gx, gy } = slopes(df, upp);
  const L = light, ln = Math.hypot(...L), t = new Float32Array(W * H);
  const lee = [0.6, 0.8];                          // toward where light does not reach: the lower right of the sheet
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = y * W + x;
    if (i0[a] < 0) continue;
    const nx = -gx[a], ny = -gy[a], nl = Math.hypot(nx, ny, 1), nz = 1 / nl;
    const lam = (nx * L[0] + ny * L[1] + L[2]) / (nl * ln);            // 1 facing the light
    const form = clamp01(lift - 0.85 * lam);                            // the turn into shade
    const rim = Math.pow(1 - nz, 1.8) * 0.9;                            // the roll round the edge
    // a lee: something nearer lies up-light of this cell, within a few mm
    let occ = 0;
    for (let k = 1; k <= 7; k++) {
      const sx = Math.round(x - lee[0] * k * 3), sy = Math.round(y - lee[1] * k * 3);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const b = sy * W + sx, dz = i0[b] < 0 ? 0 : z0[b] - z0[a];
      if (dz > 3 + 0.25 * k && (!owner || owner[i0[b]] !== owner[i0[a]])) occ = Math.max(occ, 1 - k / 8);
    }
    t[a] = clamp01((form * 0.8 + rim + occ * 0.55 + (conc ? conc[a] * valley : 0)) * gain);
  }
  return t;
}

/**
 * tone as pencil hatching: parallel strokes at `angle`, a hair wider the darker the tone, broken
 * up along their length by a value noise so they read as laid down, not ruled. sheet px in, a
 * coverage plane out. `pitch` is the spacing in sheet px.
 */
export function hatch(t, W, H, { angle = 58, pitch = 3.4, noise, floor = 0.1, power = 1.0 } = {}) {
  const a = (angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = t[y * W + x];
    if (v < floor) continue;
    const across = (x * -sa + y * ca) / pitch + (noise.n1(x * 0.011 + 3.3) + noise.n1(y * 0.013 + 7.7) - 1) * 2.2, along = (x * ca + y * sa);
    const line = Math.floor(across), f = across - line;
    // each line gets its own length pattern and offset
    const lo = noise.n1(line * 1.37 + 5.1), seg = noise.n1(along * 0.045 + line * 3.71);
    const reach = clamp01((v - floor) / (1 - floor));
    const dist = Math.abs(f - 0.5) * 2;
    const wid = 0.28 + 0.5 * Math.pow(reach, power);
    const on = clamp01((wid - dist) / 0.22);
    const gate = clamp01((reach * 1.4 - 0.18 + (seg - 0.5) * 0.9 + (lo - 0.5) * 0.35) * 3);
    out[y * W + x] = on * gate * (0.22 + 0.4 * reach);
  }
  return out;
}
