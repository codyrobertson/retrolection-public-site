// Small copies of the pictures the home page shows many of at once: the portfolio canvas's
// Dribbble shots and the work index's product shots. Shown at 120-420 css px, they are drawn at
// most 720 px wide (2x), so a screenful decodes in a few MB rather than a few hundred.
//
//   node scripts/thumbs.mjs
//
// public/images/<path>.webp -> public/images/thumbs/<path>.webp; a picture already narrow enough
// is copied as it is. Re-run after adding shots; existing thumbs are kept.
import { readdirSync, readFileSync, existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const ROOT = 'public/images', OUT = `${ROOT}/thumbs`, MAX = 720;
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = join(d, e.name);
  return e.isDirectory() ? (p === OUT ? [] : walk(p)) : /\.webp$/.test(e.name) ? [p] : [];
});
// every Dribbble shot, and every product shot the work index lists (src/lib/project-shots.json)
const listed = Object.values(JSON.parse(readFileSync('src/lib/project-shots.json', 'utf8'))).flat().map((x) => `public${x.src}`);
const files = [...walk(`${ROOT}/dribbble`), ...listed.filter((p) => existsSync(p))];
let made = 0;
for (const src of files) {
  const dst = join(OUT, src.slice(ROOT.length + 1));
  if (existsSync(dst) && statSync(dst).mtimeMs >= statSync(src).mtimeMs) continue;
  mkdirSync(dirname(dst), { recursive: true });
  const w = +execFileSync('magick', ['identify', '-format', '%w', src]).toString();
  if (w <= MAX) copyFileSync(src, dst);
  else execFileSync('magick', [src, '-resize', `${MAX}x`, '-quality', '74', dst]);
  made++;
}
console.log(`thumbs: ${made} made, ${files.length} in all -> ${OUT}`);
