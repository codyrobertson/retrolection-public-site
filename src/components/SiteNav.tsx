"use client";

import Link from "next/link";
import styles from "./masthead.module.css";

/** what the hands type when a link is pointed at: the plate listens for it (TypingPlate) */
export const TYPE_EVENT = "plate:type";
/** the plate's board has gone (detail true) or come back: the lights follow it */
export const BOARD_EVENT = "plate:board";
const say = (text: string) => () => window.dispatchEvent(new CustomEvent(TYPE_EVENT, { detail: text }));

/**
 * The masthead's links. Pointing at one (or tabbing to it) while the board is up has the
 * hands type its name, the way they type whatever the reader types.
 */
export default function SiteNav() {
  return (
    <>
      <nav className={styles.nav} aria-label="Primary">
        <Link href="/#work" onPointerEnter={say("Projects")} onFocus={say("Projects")}>Projects</Link>
        <a href="https://github.com/codyrobertson" target="_blank" rel="noopener noreferrer" onPointerEnter={say("GitHub")} onFocus={say("GitHub")}>
          GitHub<span aria-hidden className={styles.out}>↗</span>
        </a>
      </nav>
      <Link href="/#contact" className={styles.contact} onPointerEnter={say("Contact me")} onFocus={say("Contact me")}>Contact me</Link>
    </>
  );
}
