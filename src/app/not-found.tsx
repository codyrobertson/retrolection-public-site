import Link from "next/link";
import styles from "./not-found.module.css";

/** A page that isn't there: said the way the plates say things, with the way back. */
export default function NotFound() {
  return (
    <main className={styles.page}>
      <p className={styles.label}>404 / Not found</p>
      <h1 className={styles.title}>Nothing was ever typed here.</h1>
      <p className={styles.note}>The link may be old, or mistyped. Everything that is here starts on the front page.</p>
      <p className={styles.links}>
        <Link href="/">Front page →</Link>
        <Link href="/projects">All projects →</Link>
      </p>
    </main>
  );
}
