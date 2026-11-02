import type React from "react";
import type { RenderableTreeNode } from "@markdoc/markdoc";
import Link from "next/link";
import type { Discipline, ProjectStatus } from "@/lib/content";
import { disciplineLabel, statusLabel } from "@/lib/taxonomy";
import styles from "./case-study.module.css";

/**
 * A project page set as a feature story: kicker, headline, dek, a ruled byline, the lead art
 * with its caption, an "at a glance" box, and more work at the foot.
 */

type Tag = { $$mdtype: "Tag"; name: string; attributes: Record<string, unknown>; children: RenderableTreeNode[] };
const isTag = (n: unknown): n is Tag => !!n && typeof n === "object" && (n as Tag).$$mdtype === "Tag";

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (isTag(node)) return node.children.map(textOf).join(" ");
  return "";
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/** The opening paragraph's first letter as an element of its own. A ::first-letter rule would do it
    in CSS, but the ink layer paints glyphs from text nodes and never sees the pseudo-element. */
function dropCap(article: unknown) {
  if (!isTag(article)) return article;
  const [first, ...rest] = article.children;
  const lead = isTag(first) && first.name === "p" ? first.children[0] : null;
  if (!isTag(first) || typeof lead !== "string" || !/^[A-Za-z]/.test(lead)) return article;
  const cap = { $$mdtype: "Tag", name: "span", attributes: { className: styles.dropCap }, children: [lead[0]] };
  return { ...article, children: [{ ...first, children: [cap, lead.slice(1), ...first.children.slice(1)] }, ...rest] };
}

/** The body with an id on every section heading, the sections themselves, and its reading time. */
export function readStory(tree: RenderableTreeNode) {
  const sections: { id: string; title: string }[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!isTag(node)) return node;
    if (node.name === "h2") {
      const title = textOf(node).replace(/\s+/g, " ").trim();
      let id = slugify(title) || "section";
      while (seen.has(id)) id += "-2";
      seen.add(id);
      sections.push({ id, title });
      return { ...node, attributes: { ...node.attributes, id }, children: node.children.map(walk) as RenderableTreeNode[] };
    }
    return { ...node, children: node.children.map(walk) as RenderableTreeNode[] };
  };
  const body = dropCap(walk(tree)) as RenderableTreeNode;
  const words = textOf(tree).split(/\s+/).filter(Boolean).length;
  return { body, sections, minutes: Math.max(1, Math.round(words / 230)) };
}

const monthYear = (date?: string | null) =>
  date ? new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : "";
const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");

type Story = {
  title: string;
  summary?: string | null;
  discipline: Discipline;
  status: ProjectStatus;
  date?: string | null;
  role?: string | null;
  client?: string | null;
  url?: string | null;
  cover?: string | null;
  coverAlt?: string | null;
  art?: string | null;
  artAlt?: string | null;
  loop?: string | null;
  tags?: readonly string[];
};

export function StoryHeader({ story, minutes, author }: { story: Story; minutes: number; author: string }) {
  const { title, summary, discipline, status, date, role, url, cover, coverAlt, art, artAlt, loop } = story;
  return (
    <header className={styles.head}>
      <div className={styles.column}>
        <p className={styles.kicker}>
          <Link href="/projects">Case study</Link>
          <span aria-hidden>/</span>
          <span>{disciplineLabel[discipline]}</span>
        </p>
        <h1 className={styles.title}>{title}</h1>
        {summary && <p className={styles.dek}>{summary}</p>}
        <div className={styles.byline}>
          <p className={styles.by}>
            By <strong>{author}</strong>
            {role && <span className={styles.role}>{role}</span>}
          </p>
          <p className={styles.when}>
            {date && <time dateTime={date}>{monthYear(date)}</time>}
            <span>{minutes} min read</span>
            <span className={styles.status} data-status={status}>{statusLabel[status]}</span>
            {url && (
              <a href={url} className={styles.visit} target="_blank" rel="noopener noreferrer">
                {host(url)}<span aria-hidden> ↗</span>
              </a>
            )}
          </p>
        </div>
      </div>
      {art ? (
        <figure className={styles.lead}>
          <div className={styles.sheet}>
            <div className={styles.art}>
              {/* eslint-disable-next-line @next/next/no-img-element -- CMS images have unknown dimensions */}
              <img src={art} alt={artAlt || ""} fetchPriority="high" />
              {loop && <video src={loop} poster={art} autoPlay muted loop playsInline aria-hidden />}
            </div>
            {/* the sheet is taped to the page (tape-gl.js draws the strips) */}
            <span className={styles.tape} data-tape data-tape-angle="-38" style={{ left: "-2.2rem", top: "0.6rem" }} />
            <span className={styles.tape} data-tape data-tape-angle="34" style={{ right: "-2.2rem", top: "0.4rem" }} />
            <span className={styles.tape} data-tape data-tape-angle="-4" style={{ left: "46%", bottom: "-1rem" }} />
          </div>
          <figcaption className={styles.column}>
            {artAlt && <span>{artAlt}</span>}
            <span className={styles.credit}>Illustration</span>
          </figcaption>
        </figure>
      ) : cover && (
        <figure className={styles.lead}>
          {/* eslint-disable-next-line @next/next/no-img-element -- CMS images have unknown dimensions */}
          <img src={cover} alt={coverAlt || ""} fetchPriority="high" />
          <figcaption className={styles.column}>
            {coverAlt && <span>{coverAlt}</span>}
            <span className={styles.credit}>{url ? `Screenshot: ${host(url)}` : `Image: ${title}`}</span>
          </figcaption>
        </figure>
      )}
    </header>
  );
}

export function AtAGlance({ story, sections }: { story: Story; sections: { id: string; title: string }[] }) {
  const facts = [
    ["Role", story.role],
    ["Client", story.client],
    ["Discipline", disciplineLabel[story.discipline]],
    ["Status", statusLabel[story.status]],
    ["Started", monthYear(story.date)],
    ["Stack", story.tags?.join(", ")],
  ].filter((f): f is [string, string] => !!f[1]);
  return (
    <aside className={styles.glance} aria-label="At a glance">
      <div>
        <h2 className={styles.label}>At a glance</h2>
        <dl className={styles.facts}>
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {sections.length > 1 && (
        <nav aria-label="In this case study">
          <h2 className={styles.label}>In this case study</h2>
          <ol className={styles.toc}>
            {sections.map((s, i) => (
              <li key={s.id}>
                {/* a real span, not ::before: the ink layer only repaints DOM text */}
                <span className={styles.tocN} aria-hidden>{String(i + 1).padStart(2, "0")}</span>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}
    </aside>
  );
}

type Item = { slug: string; title: string; summary?: string | null; discipline: Discipline; cover?: string | null; coverAlt?: string | null; art?: string | null };

/** Each polaroid's lean and tape, fixed per position so the wall doesn't reshuffle between builds. */
const LEAN = [-3.2, 2.1, -1.4, 3.4, -2.6, 1.2];
const TAPE = [-6, 5, -12, 3, 9, -4];

export function MoreWork({ items }: { items: Item[] }) {
  if (!items.length) return null;
  return (
    <section className={styles.more} aria-labelledby="more-work">
      <h2 id="more-work" className={styles.label}>More case studies</h2>
      <ul className={styles.wall}>
        {items.map((p, i) => {
          const pic = p.art || p.cover;
          return (
            <li key={p.slug} className={styles.pin} style={{ "--lean": `${LEAN[i % LEAN.length]}deg` } as React.CSSProperties}>
              <Link href={`/projects/${p.slug}`} className={styles.polaroid}>
                <span className={styles.photo}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- CMS images have unknown dimensions */}
                  {pic && <img src={pic} alt="" loading="lazy" />}
                </span>
                <span className={styles.moreTitle}>{p.title}</span>
                <span className={styles.moreKicker}>{disciplineLabel[p.discipline]}</span>
              </Link>
              <span className={styles.pinTape} data-tape data-tape-angle={TAPE[i % TAPE.length]} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
