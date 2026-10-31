import Link from "next/link";
import type { ArtifactSummary, ExperimentSummary, PostSummary, ProjectSummary } from "@/lib/content";
import { formatDate } from "@/lib/format";
import { disciplineLabel, statusLabel } from "@/lib/taxonomy";
import styles from "./cards.module.css";

type Item = ProjectSummary | ExperimentSummary | ArtifactSummary;

export function CardGrid({ items, base, layout = "grid" }: { items: Item[]; base: string; layout?: string }) {
  return (
    <ul className={layout === "list" ? styles.list : styles.grid}>
      {items.map((item) => {
        const status = "status" in item ? item.status : undefined;
        return (
          <li key={item.slug} data-discipline={item.discipline} data-status={status}>
            <Link href={`${base}/${item.slug}`} className={styles.card}>
              {item.cover && (
                // eslint-disable-next-line @next/next/no-img-element -- CMS images have unknown dimensions
                <img src={item.cover} alt={item.coverAlt || ""} loading="lazy" className={styles.cover} />
              )}
              <h3 className={styles.title}>{item.title}</h3>
              <p className={styles.meta}>
                <span>{disciplineLabel[item.discipline]}</span>
                {status && <span>{statusLabel[status]}</span>}
              </p>
              {item.summary && <p className={styles.summary}>{item.summary}</p>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function PostList({ posts }: { posts: PostSummary[] }) {
  return (
    <ul className={styles.list}>
      {posts.map((post) => (
        <li key={post.slug}>
          <Link href={`/writing/${post.slug}`} className={styles.row}>
            <span className={styles.title}>{post.title}</span>
            <time dateTime={post.date ?? undefined} className={styles.meta}>
              {formatDate(post.date)}
            </time>
          </Link>
        </li>
      ))}
    </ul>
  );
}
