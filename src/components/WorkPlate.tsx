import type { Discipline, ProjectStatus } from "@/lib/content";
import { ART_BOX, tileArt } from "@/lib/tileArt";
import shotsBySlug from "@/lib/project-shots.json";
import type { Shot, WorkItem } from "./WorkIndex";
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

const SHOTS = shotsBySlug as Record<string, Shot[]>;

/** the summary's first clause: what it is, without the how */
const oneLiner = (s?: string | null) => (s ?? "").split(/:\s|\s—\s/)[0].replace(/\.$/, "").trim();

/**
 * The work, as lines of the hero's sheet (WorkIndex, typed by TypingPlate): made here, on the
 * server, so each line's pictures (or, with none, its abstract drawing in the plates' graphite)
 * are markup, never shipped as code.
 */
export function workItems(projects: WorkRow[]): WorkItem[] {
  return projects.map((p) => ({
    slug: p.slug,
    label: p.title,
    title: p.title,
    line: oneLiner(p.summary),
    role: p.role?.trim() || "",
    discipline: p.discipline,
    shots: (SHOTS[p.slug] ?? []).slice(0, 3),
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
        <path key={i} className={s.accent ? styles.accent : styles.stroke} d={s.d} pathLength={1} strokeWidth={s.w} strokeOpacity={s.tone} />
      ))}
    </svg>
  );
}
