import shotsBySlug from "@/lib/project-shots.json";
import dribbble from "@/lib/dribbble.json";
import { getProjects } from "@/lib/content";
import PortfolioCanvas, { type Print } from "./PortfolioCanvas";
import styles from "./portfolio.module.css";

/** one tile of the canvas, in cells (--cell px each); it repeats past its edges, every way */
const COLS = 18, ROWS = 16;
/** a project takes a block of cells this many on a side, and fills most of it */
const BIG = 2;

type Shot = { src: string; w: number; h: number; kind: string };

/** the same layout every build: a small seeded generator (mulberry32) */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** a picture at `size` cells across its longer side, laid somewhere loose inside its block */
function lay(rnd: () => number, cx: number, cy: number, span: number, size: number, ratio: number) {
  const w = ratio <= 1 ? size : size / ratio, h = ratio <= 1 ? size * ratio : size;
  const pad = 0.06, sx = Math.max(0, span - 2 * pad - w), sy = Math.max(0, span - 2 * pad - h);
  return { x: cx + pad + rnd() * sx, y: cy + pad + rnd() * sy, w, h };
}

/**
 * After the ledger, in the light again: everything, loose on a dotted surface that goes on in
 * every direction. The projects' own pictures are the big ones, the Dribbble shots scattered
 * round them at their own sizes, a few cells left empty so it breathes. Laid out here, in cells,
 * so the page's CSS sizes it and the canvas (PortfolioCanvas) only has to move it.
 */
export default async function Portfolio() {
  const projects = await getProjects();
  const shots = shotsBySlug as Record<string, Shot[]>;
  const rnd = seeded(20261101);
  const free = Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(true));
  const prints: Print[] = [];
  const thumb = (src: string) => src.replace("/images/", "/images/thumbs/");

  // the projects first, each a block of its own, spread over the tile
  const work = projects.flatMap((p) => {
    const s = shots[p.slug]?.find((x) => x.kind === "desktop");
    return s ? [{ p, s }] : [];
  });
  for (const { p, s } of work) {
    for (let tries = 0; tries < 400; tries++) {
      const c = Math.floor(rnd() * (COLS - BIG + 1)), r = Math.floor(rnd() * (ROWS - BIG + 1));
      if (![0, 1].every((dy) => [0, 1].every((dx) => free[r + dy][c + dx]))) continue;
      [0, 1].forEach((dy) => [0, 1].forEach((dx) => (free[r + dy][c + dx] = false)));
      prints.push({ href: `/projects/${p.slug}`, src: thumb(s.src), title: p.title, own: true, ...lay(rnd, c, r, BIG, 1.55 + rnd() * 0.3, s.h / s.w) });
      break;
    }
  }
  // then the shots, one to a free cell, at sizes of their own
  const cells = free.flatMap((row, r) => row.flatMap((f, c) => (f ? [[c, r]] : [])));
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  dribbble.slice(0, cells.length).forEach((d, i) => {
    const [c, r] = cells[i], big = rnd() < 0.12;
    prints.push({ href: d.href, src: thumb(d.src), title: d.title, own: false, ...lay(rnd, c, r, 1, big ? 0.9 : 0.58 + rnd() * 0.28, d.h / d.w) });
  });

  return (
    <section id="portfolio" className={styles.section} aria-labelledby="portfolio-title" data-gl-skip data-dawn>
      <PortfolioCanvas prints={prints} width={COLS} height={ROWS} />
      <div className={styles.head}>
        <h2 id="portfolio-title" className={styles.title}>Portfolio</h2>
        <a className={styles.out} href="https://dribbble.com/mackody" target="_blank" rel="noopener noreferrer">
          Dribbble<span aria-hidden> ↗</span>
        </a>
      </div>
    </section>
  );
}
