import Link from "next/link";
import type { CaseStudySummary, ExperimentSummary, PostSummary } from "@/lib/content";
import { formatDate } from "@/lib/format";
import styles from "./cards.module.css";

type Item = CaseStudySummary | ExperimentSummary;

export function CardGrid({ items, base, layout = "grid" }: { items: Item[]; base: string; layout?: string }) {
  return (
    <ul className={layout === "list" ? styles.list : styles.grid}>
      {items.map((item) => (
        <li key={item.slug}>
          <Link href={`${base}/${item.slug}`} className={styles.card}>
            {item.cover && (
              // eslint-disable-next-line @next/next/no-img-element -- CMS images have unknown dimensions
              <img src={item.cover} alt={item.coverAlt || ""} loading="lazy" className={styles.cover} />
            )}
            <h3 className={styles.title}>{item.title}</h3>
            {item.summary && <p className={styles.summary}>{item.summary}</p>}
          </Link>
        </li>
      ))}
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
