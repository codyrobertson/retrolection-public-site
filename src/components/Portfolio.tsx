import shotsBySlug from "@/lib/project-shots.json";
import dribbble from "@/lib/dribbble.json";
import { getProjects } from "@/lib/content";
import PortfolioCanvas, { type Print } from "./PortfolioCanvas";
import styles from "./portfolio.module.css";

/** columns in one tile of the canvas, a --cell (px) each; it repeats past its edges, every way */
const COLS = 9;
/** the gap between prints, in cells: one measure, down and across */
const GAP = 0.07;

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

/**
 * After the ledger, in the light again: everything, in columns on a dotted surface that goes on
 * in every direction. One width, one gap, each picture at its own height; the projects' own
 * pictures spaced through the Dribbble shots. Each column repeats at its own length, so it runs
 * on with no seam. Laid out here, in cells, so the page's CSS sizes it and the canvas
 * (PortfolioCanvas) only has to move it.
 */
export default async function Portfolio() {
  const projects = await getProjects();
  const shots = shotsBySlug as Record<string, Shot[]>;
  const rnd = seeded(20261101);
  const thumb = (src: string) => src.replace("/images/", "/images/thumbs/");

  type Item = Omit<Print, "x" | "y" | "w" | "h" | "ph"> & { ratio: number };
  const work: Item[] = projects.flatMap((p) => {
    const s = shots[p.slug]?.find((x) => x.kind === "desktop");
    return s ? [{ href: `/projects/${p.slug}`, src: thumb(s.src), title: p.title, own: true, ratio: s.h / s.w }] : [];
  });
  const loose: Item[] = dribbble.map((d) => ({ href: d.href, src: thumb(d.src), title: d.title, own: false, ratio: d.h / d.w }));
  for (let i = loose.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [loose[i], loose[j]] = [loose[j], loose[i]]; }
  // the projects spaced evenly through the shots, the first of them near the start
  const order = [...loose];
  work.forEach((w, i) => order.splice(Math.round(((i + 0.25) * order.length) / work.length) + i, 0, w));

  // each to the shortest column; the columns start a little apart so their tops never line up
  const depth = Array.from({ length: COLS }, () => rnd() * 0.5);
  const top = [...depth];
  const placed: (Item & { col: number; y: number; h: number })[] = [];
  for (const it of order) {
    const col = depth.indexOf(Math.min(...depth)), h = (1 - GAP) * Math.min(it.ratio, 1.4);
    placed.push({ ...it, col, y: depth[col], h });
    depth[col] += h + GAP;
  }
  const prints: Print[] = placed.map(({ ratio: _r, col, y, h, ...p }) => ({ ...p, x: col + GAP / 2, y, w: 1 - GAP, h, ph: depth[col] - top[col] }));

  return (
    <section id="portfolio" className={styles.section} aria-labelledby="portfolio-title" data-gl-skip data-dawn>
      <div className={styles.head}>
        <h2 id="portfolio-title" className={styles.title}>Portfolio</h2>
        <a className={styles.out} href="https://dribbble.com/mackody" target="_blank" rel="noopener noreferrer">
          Dribbble<span aria-hidden> ↗</span>
        </a>
      </div>
      <PortfolioCanvas prints={prints} width={COLS} />
    </section>
  );
}
