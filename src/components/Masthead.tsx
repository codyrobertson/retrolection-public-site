import Link from "next/link";
import Logo from "./Logo";
import SiteNav from "./SiteNav";
import styles from "./masthead.module.css";

/** the wordmark and the links, over every page; it holds still through a page turn */
export default function Masthead() {
  return (
    <header className={styles.masthead}>
      <Link href="/" className={styles.wordmark} aria-label="Retrolection, home">
        <Logo className={styles.logo} />
      </Link>
      <SiteNav />
    </header>
  );
}
