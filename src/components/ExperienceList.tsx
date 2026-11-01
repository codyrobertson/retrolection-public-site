"use client";

import { useRef, useState } from "react";
import styles from "./experience.module.css";

export type Job = { company: string; role: string; url: string; location: string; when: string; highlights: string[] };

const NN = (n: number) => String(n).padStart(2, "0");
const LINE_MS = 70;                        // a line of what was done printing after the one before it

/**
 * The ledger. One line opens at a time (details[name]); what was done there prints a line at
 * a time as it opens (data-on, which the live ink follows), and is simply there to a reader
 * who wants no motion, or without scripts.
 */
export default function ExperienceList({ jobs, dated }: { jobs: Job[]; dated: boolean }) {
  const [printed, setPrinted] = useState<Record<number, number>>({});
  const timers = useRef<Record<number, number[]>>({});
  // a line's own timers: opening one closes another (details[name]), and that one's toggle
  // must not stop this one printing
  const toggle = (i: number, open: boolean) => {
    (timers.current[i] ?? []).forEach(clearTimeout);
    timers.current[i] = [];
    const n = jobs[i].highlights.length + 1;
    if (!open) { setPrinted((m) => ({ ...m, [i]: 0 })); return; }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setPrinted((m) => ({ ...m, [i]: n })); return; }
    setPrinted((m) => ({ ...m, [i]: 0 }));
    for (let k = 1; k <= n; k++) timers.current[i].push(window.setTimeout(() => setPrinted((m) => ({ ...m, [i]: k })), k * LINE_MS));
  };
  return (
    <ol className={styles.rows} data-dated={dated}>
      <li className={styles.head} aria-hidden>
        <span>No.</span><span>Company</span><span>Role</span>{dated && <span>When</span>}<span>Where</span><span />
      </li>
      {jobs.map((j, i) => {
        const shown = printed[i] ?? -1;
        return (
          <li key={`${j.company}-${i}`}>
            <details className={styles.row} name="experience" onToggle={(e) => toggle(i, e.currentTarget.open)}>
              <summary className={styles.line}>
                <span className={styles.num}>{NN(i + 1)}</span>
                <span className={styles.company}>{j.company}</span>
                <span className={styles.role}>{j.role}</span>
                {dated && <span className={styles.when}>{j.when}</span>}
                <span className={styles.where}>{j.location}</span>
                <span className={styles.toggle} aria-hidden />
              </summary>
              <div className={styles.more}>
                <ul>
                  {j.highlights.map((h, k) => <li key={k} data-on={shown < 0 || k < shown}>{h}</li>)}
                </ul>
                {j.url && (
                  <a href={j.url} target="_blank" rel="noopener noreferrer" className={styles.visit} data-on={shown < 0 || shown > j.highlights.length - 1}>
                    {j.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}<span aria-hidden> ↗</span>
                  </a>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
