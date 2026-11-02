import shotsBySlug from "@/lib/project-shots.json";
import dribbble from "@/lib/dribbble.json";
import { getProjects } from "@/lib/content";
import PortfolioCanvas, { type Print } from "./PortfolioCanvas";
import styles from "./portfolio.module.css";

/** columns in one tile of the canvas; it repeats past them, every way */
const COLS = 12;
/** the gap between prints, in column widths */
const GAP = 0.08;
/** a project's picture among every this many of the shots, so they are spread over the tile */
const EVERY = 14;

type Shot = { src: string; w: number; h: number; kind: string };

/**
 * After the ledger: everything, laid out on a dotted surface that goes on in every direction.
 * The layout is made here, in column widths, so the page's CSS can size it and the canvas
 * (PortfolioCanvas) only has to move it.
 */
export default async function Portfolio() {
  const projects = await getProjects();
  const shots = shotsBySlug as Record<string, Shot[]>;
  const work = projects.flatMap((p) => {
    const s = shots[p.slug]?.find((x) => x.kind === "desktop");
    return s ? [{ href: `/projects/${p.slug}`, src: s.src, title: p.title, ratio: s.h / s.w, own: true }] : [];
  });
  const art = dribbble.map((d) => ({ href: d.href, src: d.src, title: d.title, ratio: d.h / d.w, own: false }));

  const all: typeof art = [];
  for (let i = 0, j = 0; i < art.length || j < work.length; ) {
    if (j < work.length && (i % EVERY === 0 || i >= art.length)) all.push(work[j++]);
    if (i < art.length) all.push(art[i++]);
  }

  // into the shortest column, each in turn: the columns come out within a print of each other
  const heights = Array<number>(COLS).fill(0);
  const prints: Print[] = all.map((it) => {
    const col = heights.indexOf(Math.min(...heights));
    const y = heights[col];
    heights[col] += it.ratio + GAP;
    return { ...it, col, x: col * (1 + GAP), y, h: it.ratio };
  });

  return (
    <section id="portfolio" className={styles.section} aria-labelledby="portfolio-title" data-gl-skip>
      <div className={styles.head}>
        <h2 id="portfolio-title" className={styles.title}>Portfolio</h2>
        <a className={styles.out} href="https://dribbble.com/mackody" target="_blank" rel="noopener noreferrer">
          Dribbble<span aria-hidden> ↗</span>
        </a>
      </div>
      <PortfolioCanvas prints={prints} width={COLS * (1 + GAP)} heights={heights} />
    </section>
  );
}
