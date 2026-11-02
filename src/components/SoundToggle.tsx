"use client";

import { useEffect, useSyncExternalStore } from "react";
import { onSound, setSound, soundOn, soundWanted } from "@/lib/sound";
import styles from "./masthead.module.css";

/**
 * The page's sound (lib/sound), off until asked for. Three bars that stand still when it is
 * off and move with the band when it is on. Turned on last time, it is armed, not playing:
 * the reader's first click or key anywhere on the page starts it, as browsers require.
 */
export default function SoundToggle() {
  const playing = useSyncExternalStore(onSound, soundOn, () => false);

  useEffect(() => {
    if (soundOn() || !soundWanted()) return;
    const go = (e: Event) => {
      if ((e.target as Element | null)?.closest?.("[data-sound]")) return;   // the toggle itself: it decides
      disarm(); if (!soundOn()) void setSound(true);
    };
    const disarm = () => ["pointerdown", "keydown"].forEach((t) => removeEventListener(t, go, true));
    ["pointerdown", "keydown"].forEach((t) => addEventListener(t, go, true));
    return disarm;
  }, []);

  return (
    <button
      type="button"
      className={styles.sound}
      aria-pressed={playing}
      aria-label={playing ? "Sound on" : "Sound off"}
      title={playing ? "Sound on" : "Sound off"}
      data-sound
      data-on={playing || undefined}
      onClick={() => void setSound(!soundOn())}
    >
      <span aria-hidden className={styles.bars}><i /><i /><i /></span>
    </button>
  );
}
