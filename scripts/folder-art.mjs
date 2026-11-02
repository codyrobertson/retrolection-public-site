// The work index's folder, in the hero's pencil: its back with the tab, and its front, each as
// ink (the outline, and its shade hatched in) and as the paper under the ink (a silhouette).
//
//   node scripts/folder-art.mjs [--preview out.png]
//
// Writes public/folder/{back,back-paper,front,front-paper}.webp: alpha masks (RGB 0, alpha =
// coverage) the page tints with its own tokens, so the folder is graphite on whatever stock it
// is on. Drawn at 2x a 260 x 179 box (the row's 16:11); the page stretches it to the row's size.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import GK from '../src/lib/typing/gk.js';
import { hatch } from './footer-art/trace.mjs';

const { math: M, pencil: PEN } = GK;
const X = 2, BW = 260, BH = 179, W = BW * X, H = BH * X;
const OUT = 'public/folder', TMP = `${tmpdir()}/folder-art-${process.pid}`;
const preview = (() => { const i = process.argv.indexOf('--preview'); return i > 0 ? process.argv[i + 1] : null; })();
const clamp01 = (v) => Math.max(0, Math.min(1, v));
mkdirSync(OUT, { recursive: true }); mkdirSync(TMP, { recursive: true });

/** the shapes, in a 100 x 100 box stretched to the folder's (the same paths WorkIndex once drew):
    the back up to the box's top with its tab on the right; the front from FRONT_TOP down, its
    edge stepped up over the left */
const BACK = 'M3 16Q3 11 8 11H50Q54 11 56 7L58 3Q60 0 64 0H92Q97 0 97 5V95Q97 100 92 100H8Q3 100 3 95Z';
const FRONT = 'M0 7Q0 0 7 0H33Q37 0 40 4L43 8Q45 11 49 11H93Q100 11 100 18V93Q100 100 93 100H7Q0 100 0 93Z';
const FRONT_TOP = 0.42;

/** an svg path of M/H/V/L/Q/Z, sampled to points in sheet px */
function sample(d, map, step = 1.6) {
  const tok = d.match(/[MHVLQZ]|-?[\d.]+/g), pts = [];
  let i = 0, x = 0, y = 0, cmd = '';
  const num = () => +tok[i++];
  const seg = (f, len) => { const n = Math.max(2, Math.ceil(len / step)); for (let k = 1; k <= n; k++) pts.push(map(...f(k / n))); };
  while (i < tok.length) {
    if (/[A-Z]/.test(tok[i])) cmd = tok[i++];
    if (cmd === 'M') { x = num(); y = num(); pts.push(map(x, y)); cmd = 'L'; }
    else if (cmd === 'H' || cmd === 'V' || cmd === 'L') {
      const x0 = x, y0 = y;
      if (cmd === 'H') x = num(); else if (cmd === 'V') y = num(); else { x = num(); y = num(); }
      const [a, b] = [map(x0, y0), map(x, y)];
      seg((t) => [x0 + (x - x0) * t, y0 + (y - y0) * t], Math.hypot(b[0] - a[0], b[1] - a[1]));
    } else if (cmd === 'Q') {
      const x0 = x, y0 = y, cx = num(), cy = num(); x = num(); y = num();
      const [a, b] = [map(x0, y0), map(x, y)];
      seg((t) => [(1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y], Math.hypot(b[0] - a[0], b[1] - a[1]) * 1.2);
    } else if (cmd === 'Z') { i += 0; break; }
  }
  return pts;
}
const backAt = (x, y) => [(x / 100) * W, (y / 100) * H];
const frontAt = (x, y) => [(x / 100) * W, (FRONT_TOP + (y / 100) * (1 - FRONT_TOP)) * H];

/** a polygon's silhouette, 4x4 supersampled for a soft edge */
function silhouette(poly) {
  const out = new Float32Array(W * H), S = 4;
  for (let y = 0; y < H; y++) for (let sy = 0; sy < S; sy++) {
    const yy = y + (sy + 0.5) / S, xs = [];
    for (let k = 0, n = poly.length; k < n; k++) {
      const [x0, y0] = poly[k], [x1, y1] = poly[(k + 1) % n];
      if ((y0 <= yy && y1 > yy) || (y1 <= yy && y0 > yy)) xs.push(x0 + ((yy - y0) / (y1 - y0)) * (x1 - x0));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.floor(xs[k])); x < Math.min(W, Math.ceil(xs[k + 1])); x++) {
      for (let sx = 0; sx < S; sx++) { const xx = x + (sx + 0.5) / S; if (xx >= xs[k] && xx < xs[k + 1]) out[y * W + x] += 1 / (S * S); }
    }
  }
  return out;
}

/** ink coverage from a deposit buffer (footer-art.mjs's) */
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
function writeMask(name, cov, quality = 72) {
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) rgba[i * 4 + 3] = Math.round(clamp01(cov[i]) * 255);
  const raw = `${TMP}/${name}.rgba`;
  writeFileSync(raw, rgba);
  execFileSync('magick', ['-size', `${W}x${H}`, '-depth', '8', `rgba:${raw}`, '-define', 'webp:lossless=false', '-quality', String(quality), '-define', 'webp:alpha-quality=90', `${OUT}/${name}.webp`]);
  rmSync(raw);
}
const over = (a, b) => { for (let i = 0; i < a.length; i++) a[i] = 1 - (1 - a[i]) * (1 - b[i]); return a; };

let ph = 1;
const pen = (g) => (pts, o = {}) => g.stroke(pts, { grade: PEN.gradeAt(3.2), tone: 1.1, weight: 1.0, passes: 2, taper: 0.5, wobble: 0.6, jitter: 0.4, phase: ph++, ...o });

// ---- the back: its outline, and the inside of it in shade, deepest down where the front stands over it
const backPoly = sample(BACK, backAt), backPaper = silhouette(backPoly);
const bg = new PEN.Graphite(W, H, 2, 1201), bink = pen(bg);
bink(backPoly, { close: true, taper: 0 });
// the tab's fold: where the tab meets the back's top edge, a short line in from the edge
bink([backAt(56, 11.6), backAt(97, 11.6)].map(([x, y]) => [x, y]), { tone: 0.42, grade: PEN.gradeAt(1.6), passes: 1, weight: 0.8 });
const back = coverage(bg);
{
  const t = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = backPaper[y * W + x]; if (p < 0.5) continue;
    const v = y / H;                                         // darker toward the bottom: the inside of the folder
    t[y * W + x] = (0.2 + 0.42 * v) * (0.85 + 0.3 * (x / W));
  }
  over(back, hatch(t, W, H, { noise: new M.Noise(71), pitch: 3.4, floor: 0.16, angle: 52 }));
}

// ---- the front: its outline, the board's thickness along the top, and a little shade toward the lower right
const frontPoly = sample(FRONT, frontAt), frontPaper = silhouette(frontPoly);
const fg = new PEN.Graphite(W, H, 2, 1202), fink = pen(fg);
fink(frontPoly, { close: true, taper: 0 });
fink(sample('M2 8Q2 3 8 3H32Q36 3 38.6 6.4L41.6 10.6Q43.6 13.6 48 13.6H92Q97.5 13.6 97.5 19', frontAt), { tone: 0.38, grade: PEN.gradeAt(1.4), passes: 1, weight: 0.75 });
const front = coverage(fg);
{
  const t = new Float32Array(W * H), y0 = FRONT_TOP * H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = frontPaper[y * W + x]; if (p < 0.5) continue;
    const u = x / W, v = (y - y0) / (H - y0);
    t[y * W + x] = 0.62 * Math.pow(clamp01((u * 0.55 + v * 0.75) - 0.35), 1.3);
  }
  over(front, hatch(t, W, H, { noise: new M.Noise(73), pitch: 3.6, floor: 0.12, angle: 40 }));
}

writeMask('back', back); writeMask('back-paper', backPaper, 80);
writeMask('front', front); writeMask('front-paper', frontPaper, 80);

if (preview) {
  // the four laid together on the light stock, for a look
  const rgb = Buffer.alloc(W * H * 3), paper = [244, 241, 232], deep = [228, 223, 210], ink = [26, 25, 23];
  for (let i = 0; i < W * H; i++) {
    let c = paper;
    const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
    c = mix(c, deep, backPaper[i]); c = mix(c, ink, back[i] * 0.85);
    c = mix(c, paper, frontPaper[i]); c = mix(c, ink, front[i] * 0.85);
    rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2];
  }
  const ppm = `${TMP}/p.ppm`;
  writeFileSync(ppm, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), rgb]));
  execFileSync('magick', [ppm, preview]);
}
rmSync(TMP, { recursive: true, force: true });
console.log(`folder: ${W}x${H} -> ${OUT}`);
