// The hand that turns the page (PageCurl): the 01 / TYPING right hand, drawn by the same
// scene, taking a page by its corner. Rendered once, here, to a strip the browser only has
// to move: no engine on the pages that turn.
//
//   node scripts/curl-hand.mjs            public/hand/grip.webp + src/lib/grip.json
//   node scripts/curl-hand.mjs --preview out.png   also the strip on paper, to look at
//
// Each frame is a grip (0 reaching .. 1 holding) on one of two noise fields, drawn on twos as
// the hero's hands are. grip.json gives each frame's box in the strip and where, in it, the
// corner is held.

import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import GK from '../src/lib/typing/gk.js';
import { createScene } from '../src/lib/typing/scene.js';

const X = 2;                                   // drawn at 2× for sharp edges on a retina screen
const GRIPS = [0, 0.35, 0.7, 1];
const BOILS = 2;
const scene = createScene(GK, { X });

const frames = [];
for (const t of GRIPS) for (let b = 0; b < BOILS; b++) frames.push({ t, b, ...scene.gripLayer(t, b) });

// one strip, left to right, a little air between so filtering never bleeds
const GAP = 4, W = frames.reduce((s, f) => s + f.w + GAP, 0), H = Math.max(...frames.map((f) => f.h));
const rgba = new Uint8ClampedArray(W * H * 4);
let x = 0;
const meta = { x: X, frames: [] };
for (const f of frames) {
  for (let y = 0; y < f.h; y++) rgba.set(f.data.subarray(y * f.w * 4, (y + 1) * f.w * 4), (y * W + x) * 4);
  meta.frames.push({ t: f.t, boil: f.b, x, y: 0, w: f.w, h: f.h, pin: f.pin.map((v) => Math.round(v * 10) / 10) });
  x += f.w + GAP;
}

mkdirSync('public/hand', { recursive: true });
const raw = 'public/hand/grip.rgba';
writeFileSync(raw, rgba);
execFileSync('magick', ['-size', `${W}x${H}`, '-depth', '8', `rgba:${raw}`, '-define', 'webp:lossless=false', '-quality', '78', '-define', 'webp:alpha-quality=80', 'public/hand/grip.webp']);
execFileSync('rm', [raw]);
writeFileSync('src/lib/grip.json', JSON.stringify(meta));
console.log(`grip.webp ${W}x${H}, ${frames.length} frames`);

const at = process.argv.indexOf('--preview');
if (at > 0) {
  const out = process.argv[at + 1];
  execFileSync('magick', ['public/hand/grip.webp', '-background', '#f4f1e8', '-flatten', out]);
  console.log(out);
}
