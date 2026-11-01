import type { CSSProperties } from "react";
import type { Discipline, ProjectStatus } from "@/lib/content";
import { disciplineLabel, statusLabel } from "@/lib/taxonomy";
import { ART_BOX, tileArt } from "@/lib/tileArt";
import type { WorkItem } from "./WorkIndex";
import styles from "./work.module.css";

export type WorkRow = {
  slug: string;
  title: string;
  discipline: Discipline;
  status: ProjectStatus;
  role?: string | null;
  client?: string | null;
  summary?: string | null;
  featured?: boolean;
};

/**
 * Plate 02, the work, as lines of the hero's sheet (WorkIndex, typed by TypingPlate): made
 * here, on the server, so each line's mark (its abstract drawing in the plates' graphite) is
 * drawn once, as markup, and never shipped as code.
 */
export function workItems(projects: WorkRow[]): WorkItem[] {
  return projects.map((p, i) => ({
    slug: p.slug,
    label: `${String(i + 1).padStart(2, "0")}  ${p.title}`,
    title: p.title,
    meta: [disciplineLabel[p.discipline], p.role?.trim()].filter(Boolean).join(" · "),
    status: statusLabel[p.status],
    active: p.status === "active",
    discipline: p.discipline,
    art: <Mark slug={p.slug} discipline={p.discipline} active={p.status === "active"} />,
  }));
}

function Mark({ slug, discipline, active }: { slug: string; discipline: Discipline; active: boolean }) {
  const art = tileArt(slug, discipline, active);
  return (
    <svg className={styles.art} viewBox={ART_BOX} preserveAspectRatio="xMidYMid slice">
      <defs>
        {art.clips.map((c) => (
          <clipPath key={c.id} id={c.id}><path d={c.d} /></clipPath>
        ))}
      </defs>
      {art.hatched.map((h, i) => (
        <path key={`h${i}`} className={styles.tone} d={h.d} clipPath={`url(#${h.clip})`} strokeOpacity={h.tone} />
      ))}
      {art.strokes.map((s, i) => (
        <path key={i} className={s.accent ? styles.accent : styles.stroke} d={s.d} pathLength={1} strokeWidth={s.w} strokeOpacity={s.tone} style={{ "--i": i } as CSSProperties} />
      ))}
    </svg>
  );
}
