// Headless checks for the 01 / TYPING scene: the same code the hero runs, without a browser.
//
//   node scripts/typing-check.mjs                    home-pose metrics + every frame's hand gap
//   node scripts/typing-check.mjs yaw=14 pron=0.3    try parameters (thumb/pinky as comma lists)
//   node scripts/typing-check.mjs --png out.png      also write the home frame, composited
//   node scripts/typing-check.mjs --png out.png --frame 15 [--frame 40 ...]   ...or frames of the performance, stacked
//                                                    (exit frames follow the performance's)
//
// Exits 1 when a metric fails, so it can gate a change.

import GK from '../src/lib/typing/gk.js';
import { createScene } from '../src/lib/typing/scene.js';
import { TYPED } from '../src/lib/typing/text.js';

const args = process.argv.slice(2);
const params = {};
for (const a of args) {
  const m = /^(\w+)=(.+)$/.exec(a);
  if (m) params[m[1]] = m[2].includes(',') ? m[2].split(',').map(Number) : Number(m[2]);
}
const png = args.includes('--png') ? args[args.indexOf('--png') + 1] : null;
const shots = args.flatMap((a, i) => (a === '--frame' ? [+args[i + 1]] : []));
for (let i = args.length - 1; i >= 0; i--) if (args[i] === '--frame') args.splice(i, 2);

let t = performance.now();
const scene = createScene(GK, params);
const ms = () => { const d = performance.now() - t; t = performance.now(); return `${d.toFixed(0)}ms`; };
console.log(`scene ${ms()}  panel ${scene.layout.PW}x${scene.layout.PH}`);

let failed = false;
for (const m of scene.metrics()) {
  if (!m.ok) failed = true;
  console.log(`${m.ok ? '  ok ' : 'FAIL '} ${m.label.padEnd(20)} ${m.value.toFixed(2)} ${m.unit}${m.detail ? `  (${m.detail})` : ''}`);
}
console.log(`metrics ${ms()}`);

const sched = scene.schedule(TYPED), frames = [...sched.frames, ...sched.exit];
console.log(`schedule ${ms()}  ${sched.frames.length} frames + ${sched.exit.length} exit (from ${sched.frames.length})`);
const all = args.includes('--fast') ? { under: 0, total: frames.length, worst: { mm: NaN, frame: -1 } } : scene.checkAll(frames);
if (all.under) failed = true;
if (all.under && args.includes('--gaps')) console.log(all.gaps.map((g, i) => (g < (scene.params.clear) ? `${i}:${g}` : null)).filter(Boolean).join(' '));
console.log(`${all.under ? 'FAIL ' : '  ok '} frames under the gap  ${all.under}/${all.total}  worst ${all.worst.mm.toFixed(1)}mm at frame ${all.worst.frame}  ${ms()}`);

if (png) {
  const { PW, PH } = scene.layout;
  const board = scene.keyboardLayer();
  const shot = (fr, i) => {
    const out = new Uint8ClampedArray(PW * PH * 3);
    for (let p = 0; p < PW * PH; p++) out.set([244, 241, 232], p * 3);
    const over = (L, dx = 0, dy = 0) => {
      for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
        const X = Math.round(L.x + dx) + x, Y = Math.round(L.y + dy) + y;
        if (X < 0 || Y < 0 || X >= PW || Y >= PH) continue;
        const s = (y * L.w + x) * 4, a = L.data[s + 3] / 255, o = (Y * PW + X) * 3;
        for (let c = 0; c < 3; c++) out[o + c] = out[o + c] * (1 - a) + L.data[s + c] * a;
      }
    };
    const kb = fr.kb || [0, 0];
    over(board, ...kb);
    for (const id of fr.pressed) over(scene.keyPatch(id), ...kb);
    if (fr.L) over(scene.handLayer('L', fr.L, Math.floor(i / 2) % 3), ...fr.offL);
    if (fr.R) over(scene.handLayer('R', fr.R, Math.floor(i / 2) % 3), ...fr.offR);
    return out;
  };
  const list = shots.length ? shots.map((i) => [frames[i], i]) : [[{ R: 'home', L: 'home', offR: [0, 0], offL: [0, 0], pressed: [] }, 0]];
  const { writeFileSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const ppms = list.map(([fr, i], n) => {
    const ppm = png.replace(/\.\w+$/, `.${n}.ppm`);
    writeFileSync(ppm, Buffer.concat([Buffer.from(`P6 ${PW} ${PH} 255\n`), Buffer.from(shot(fr, i))]));
    return ppm;
  });
  execFileSync('magick', [...ppms, '-append', png]);
  console.log(`wrote ${png}  ${ms()}`);
}
process.exit(failed ? 1 : 0);
