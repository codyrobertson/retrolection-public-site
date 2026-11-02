"use client";

import Link from "next/link";
import { Fragment, memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { Discipline } from "@/lib/content";
import styles from "./work.module.css";

/** a line of the index, made on the server (WorkPlate): the mark is the tile art, drawn there */
export type WorkItem = { slug: string; label: string; title: string; meta: string; status: string; active: boolean; discipline: Discipline; art: ReactNode };
type Filter = "all" | Discipline;

/** a line typed whole (or pasted): more letters than any line has */
export const FULL = 1e6;

// "Design + Code" work counts as both, so it shows under Design and under Code; its own tab
// narrows to only it
const TABS: [Filter, string][] = [["all", "All"], ["design", "Design"], ["code", "Code"], ["design-code", "Design + Code"]];
const shows = (f: Filter, d: Discipline) => f === "all" || d === f || (d === "design-code" && f !== "design-code");
const NUM = 4;                              // "01  ": the number and its gap, set in the box's mono

/**
 * Plate 02 is the rest of the hero's sheet: the work, as an index the hands type as each line
 * comes up past the platen (TypingPlate counts the letters into `typed`). A line not yet up
 * holds its place, its letters there but not inked, so the sheet never shifts as it is typed;
 * its details and its mark come up when its last letter goes down, or all at once when it was
 * pasted. Changing tab moves the lines to their new places (a view transition where the
 * browser has one).
 */
/** a line of the index: drawn again only when its own count of letters moves, not at each of the hero's */
const Row = memo(function Row({ t, n }: { t: WorkItem; n: number | undefined }) {
  const state = n === undefined ? "under" : n >= t.label.length ? "done" : "typing";
  return (
    <li style={{ viewTransitionName: `tile-${t.slug}` } as CSSProperties}>
      <Link href={`/projects/${t.slug}`} className={styles.row} data-row={t.slug} data-label={t.label} data-state={state} data-active={t.active}>
        <span className={styles.sr}>{`${t.title}. ${t.meta}. ${t.status}.`}</span>
        <span className={styles.typed} aria-hidden>
          {[...t.label].map((ch, j) => (
            <Fragment key={j}>
              {state === "typing" && j === n && <span className={styles.caret} />}
              <span className={j < NUM ? styles.num : styles.ch} data-on={n !== undefined && j < n}>{ch}</span>
            </Fragment>
          ))}
          {state === "typing" && (n ?? 0) >= t.label.length && <span className={styles.caret} />}
        </span>
        <span className={styles.meta} aria-hidden>{t.meta}</span>
        <span className={styles.status} aria-hidden>{t.status}</span>
        <span className={styles.thumb} aria-hidden>{t.art}</span>
      </Link>
    </li>
  );
});

export default memo(function WorkIndex({ items, total = items.length, typed, all }: { items: WorkItem[]; total?: number; typed: Record<string, number>; all: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const pick = (f: Filter) => {
    if (f === filter) return;
    const go = () => flushSync(() => setFilter(f));
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) doc.startViewTransition(go);
    else go();
  };
  // a mark draws itself in once, the first time its line is done
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.querySelectorAll<HTMLElement>(`[data-state="done"]:not([data-seen])`).forEach((r) => requestAnimationFrame(() => { r.dataset.seen = "true"; }));
  });

  const shown = items.filter((t) => shows(filter, t.discipline));
  return (
    <div id="work" className={styles.index}>
      <p className={styles.label}>
        <span>02 / Work</span>
        <span>{total > items.length ? `${String(items.length).padStart(2, "0")} of ${total}` : `${String(items.length).padStart(2, "0")} projects`}</span>
      </p>
      <h2 className={styles.sr}>Selected work</h2>
      <div className={styles.tabs} role="group" aria-label="Filter by discipline">
        {TABS.map(([f, label]) => (
          <button key={f} type="button" className={styles.tab} aria-pressed={filter === f} onClick={() => pick(f)}>
            {label}
            <span className={styles.count}>{String(items.filter((t) => shows(f, t.discipline)).length).padStart(2, "0")}</span>
          </button>
        ))}
      </div>
      <ol ref={list} className={styles.rows}>
        {shown.map((t) => <Row key={t.slug} t={t} n={all ? FULL : typed[t.slug]} />)}
      </ol>
      {total > items.length && (
        <p className={styles.more}>
          <Link href="/projects">All {total} projects<span aria-hidden> →</span></Link>
        </p>
      )}
    </div>
  );
});
