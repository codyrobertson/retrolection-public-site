import { formatDate } from "@/lib/format";
import styles from "@/app/(site)/site.module.css";

type Props = {
  title: string;
  summary?: string | null;
  date?: string | null;
  meta?: readonly (string | null | undefined)[];
  cover?: string | null;
  coverAlt?: string | null;
  url?: string | null;
};

export function EntryHeader({ title, summary, date, meta = [], cover, coverAlt, url }: Props) {
  const items = [date && formatDate(date), ...meta].filter(Boolean);
  return (
    <header className={styles.pageHeader}>
      <h1 className={styles.pageTitle}>{title}</h1>
      {summary && <p className={styles.lede}>{summary}</p>}
      {items.length > 0 && (
        <p className={styles.meta}>
          {items.map((m) => (
            <span key={m}>{m}</span>
          ))}
          {url && <a href={url}>{new URL(url).hostname.replace(/^www\./, "")} ↗</a>}
        </p>
      )}
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element -- CMS images have unknown dimensions
        <img src={cover} alt={coverAlt || ""} className={styles.cover} fetchPriority="high" />
      )}
    </header>
  );
}
