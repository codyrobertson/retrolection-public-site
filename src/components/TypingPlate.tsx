"use client";

import Link from "next/link";
import { Fragment, memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Phase } from "@/lib/typing/machine";
import { startPlate, type BoxHandle, type Check } from "@/lib/typing/plate";
import { DEFAULTS, PASTE } from "@/lib/typing/scene";
import { stampFor, touch, visit } from "@/lib/typing/session";
import { HERO, linesOf, shortcodeOf, stampOf } from "@/lib/typing/text";
import AsciiBox from "./AsciiBox";
import { BOARD_EVENT, TYPE_EVENT } from "./SiteNav";
import TunePanel, { loadTuned, type Metric, type Params } from "./TunePanel";
import WorkIndex, { FULL, NUM, type WorkItem } from "./WorkIndex";
import styles from "./typing.module.css";

// Plate 01. Nothing here is pre-rendered: the hands are solved and drawn in workers while the
// page plays, and the ?tune panel drives the same renderer. What the plate is doing is one
// machine (lib/typing/machine.ts), run by one clock (lib/typing/plate.ts); this is the page it
// writes on: the box, the letters as they go down, the index, the reader's line.

const noop = () => () => {};

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

export type Hero = { eyebrow?: string; heading: string; subheading?: string; links?: { label: string; href: string }[] };

const stampOnce = () => stampFor(stampOf);
const typedBefore = () => visit()?.phase === "typed";
const NO_ROWS: string[] = [];
const rowsBefore = () => visit()?.rows ?? NO_ROWS;

/** a line of the box, `n` letters of it down and the caret where the next lands (if it is the caret's line) */
const TypedLine = memo(function TypedLine({ text, n, caret }: { text: string; n: number; caret: boolean }) {
  const chars = [...text];
  return (
    <span aria-hidden>
      {chars.map((ch, j) => (
        <Fragment key={j}>
          {caret && n === j && <span className={styles.caret} />}
          <span className={styles.char} data-on={j < n}>{ch}</span>
        </Fragment>
      ))}
      {caret && n >= chars.length && <span className={styles.caret} />}
    </span>
  );
});

export default function TypingPlate({ hero = HERO, work = [], more = work.length }: { hero?: Hero; work?: WorkItem[]; more?: number }) {
  // the dateline is the reader's own day and time: set once the page is in their hands, and
  // held, so the performance is not rebuilt when the minute turns
  const stamp = useSyncExternalStore(noop, stampOnce, () => "");
  const lines: string[] = linesOf(hero, stamp), text = lines.join("\n");
  const sub = hero.subheading ?? "";
  const reduced = usePrefersReducedMotion();
  // where the plate is (machine.ts): the caret is only out while the hands are typing the box
  const [phase, setPhase] = useState<Phase>("boot");
  const [typed0, setTyped] = useState(0);
  // typed out once this visit, it stays typed: the board picks up its loop, the sheet is all there
  const resumed = useSyncExternalStore(noop, typedBefore, () => false);
  // with reduced motion nothing is typed: it is all there, whatever frame the board shows
  const typed = reduced || resumed ? text.length : typed0;
  // ?tune opens the panel, with whatever was last tuned on this machine
  const tune = useSyncExternalStore(noop, () => new URLSearchParams(window.location.search).has("tune"), () => false);
  const saved = useMemo(() => (tune ? loadTuned() : null), [tune]);
  const [edited, setParams] = useState<Params | null>(null);
  const params = edited ?? saved ?? (DEFAULTS as Params);
  const [X, setX] = useState(0);
  const [said, setSaid] = useState("");                     // what the hands have typed for the reader
  const [rows, setRows] = useState<Record<string, number>>({}); // how much of each line of the index is on the sheet
  const [cur, setCur] = useState("");                       // ...and the line the hands are typing
  // ...and the lines typed earlier this visit, there whole from the start
  const seenRows = useSyncExternalStore(noop, rowsBefore, () => NO_ROWS);
  const sheetRows = useMemo(() => {
    if (!seenRows.length) return rows;
    const n = { ...rows };
    for (const id of seenRows) n[id] = FULL;
    return n;
  }, [rows, seenRows]);
  const [playChoice, setPlaying] = useState<boolean | null>(null);
  const playing = playChoice ?? !tune;
  const [metrics, setMetrics] = useState<Metric[] | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState(false);

  const sceneRef = useRef<HTMLDivElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const box = useRef<BoxHandle>(null);
  const director = useRef<ReturnType<typeof startPlate> | null>(null);
  // what the plate is to play, kept current for it (and for its start, below)
  const opts = useRef({ text, params, tune, reduced, playing });
  useEffect(() => {
    opts.current = { text, params, tune, reduced, playing };
    director.current?.set(opts.current);
  }, [text, params, tune, reduced, playing]);

  // the sheet in ink: a GL layer of its own riding in the box (ink-gl.js startLiveInk), so the
  // letters the hands put down are ballpoint as the rest of the page is; started after first
  // paint, as the page's layers are (Surface)
  useEffect(() => {
    const note = sceneRef.current?.querySelector<HTMLElement>(`.${styles.note}`);
    if (!note) return;
    let layer: { destroy: () => void } | undefined, dead = false;
    const go = () => import("@/lib/ink-gl").then((m) => { if (!dead) layer = m.startLiveInk(note, "ink-sheet-gl"); });
    const idle = typeof window.requestIdleCallback === "function";
    const id = idle ? window.requestIdleCallback(go, { timeout: 400 }) : window.setTimeout(go, 50);
    return () => { dead = true; if (idle) window.cancelIdleCallback(id); else window.clearTimeout(id); layer?.destroy(); };
  }, []);

  // the plate, once the dateline is set (it is the first thing the hands type)
  useEffect(() => {
    const scene = sceneRef.current, plate = plateRef.current, canvas = canvasRef.current;
    const note = scene?.querySelector<HTMLElement>(`.${styles.note}`);
    if (!stamp || !scene || !plate || !canvas || !note) return;
    const d = startPlate(
      { scene, plate, canvas, note, ruled: note.querySelector<HTMLElement>(`.${styles.box}`), platen: scene.querySelector<HTMLElement>(`.${styles.platen}`), box },
      {
        phase: setPhase,
        typed: setTyped,
        row: (id, n) => setRows((m) => { const v = n === null ? FULL : NUM + n; return m[id] === v ? m : { ...m, [id]: v }; }),
        cur: setCur,
        said: setSaid,
        board: (away) => window.dispatchEvent(new CustomEvent(BOARD_EVENT, { detail: away })),
        title: (id) => (scene.querySelector<HTMLElement>(`[data-row="${id}"]`)?.dataset.label ?? "").slice(NUM),
        busy: setBusy,
        x: setX,
        configured: (pool, t) => {
          if (!opts.current.tune) return;
          setMetrics(null);
          setCheck(null);
          pool.get("metrics", {}, -1).then((m: Metric[]) => setMetrics(m), () => {});
          pool.get("check", { text: t }, 1e6).then((c: Check) => setCheck(c), () => {});
        },
      },
      opts.current,
    );
    director.current = d;
    const onKey = (e: KeyboardEvent) => d.key(e);
    const onSay = (e: Event) => d.say(String((e as CustomEvent).detail ?? ""));
    window.addEventListener("keydown", onKey);
    window.addEventListener(TYPE_EVENT, onSay);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(TYPE_EVENT, onSay);
      d.stop();
      director.current = null;
    };
  }, [stamp]);
  useEffect(() => {
    const id = window.setInterval(touch, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const handsDone = !!stamp && typed >= text.length;
  // the line under the heading is pasted: it is there whole the moment V goes down under CTRL
  const pasteAt = text.indexOf(PASTE), pasted = pasteAt >= 0 && typed > pasteAt;

  // every line a letter at a time, the caret where the next one lands
  const starts = lines.map((_, l) => lines.slice(0, l).reduce((n, t) => n + t.length + 1, 0));
  const caretLine = handsDone || phase !== "type" ? -1 : starts.reduce((at, st, l) => (typed >= st ? l : at), 0);
  // a line's count is held to its own length (and -1 before it begins), so a letter going down
  // draws again only the line it lands in
  const typedLine = (l: number) => {
    const len = lines[l].length;
    return <TypedLine text={lines[l]} n={Math.max(-1, Math.min(len + 1, typed - starts[l]))} caret={l === caretLine} />;
  };
  const head = lines.indexOf(hero.heading);
  /** a link's shortcode: not begun, being typed (its letters so far), or rendered by its Return */
  const shortcode = (ln: { label: string }) => {
    const l = lines.indexOf(shortcodeOf(ln)), st = starts[l], code = lines[l] ?? "";
    if (l < 0 || reduced) return { done: reduced, so: "" };
    return { done: typed > st + code.length, so: typed > st ? code.slice(0, typed - st) : "", caret: caretLine === l };
  };

  return (
    <div ref={sceneRef} className={styles.scene} data-phase={phase} data-gl-skip>
      {/* the desk: the board and the hands, pinned over the sheet as it scrolls */}
      <div ref={plateRef} className={styles.plate}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          aria-label="Two graphite hands push a round-key typewriter keyboard into place and type the box above it."
        />
      </div>
      <section className={styles.sheet} aria-labelledby="plate-title">
        <AsciiBox corner={hero.eyebrow} handle={box}>
          <p className={styles.stamp}>
            {stamp ? (<><span className={styles.sr}>{stamp}</span>{typedLine(0)}</>) : "\u00a0"}
          </p>
          <h1 id="plate-title" className={styles.headline}>
            <span className={styles.sr}>{hero.heading}</span>
            {stamp ? typedLine(head) : <span className={styles.char} aria-hidden>{hero.heading}</span>}
          </h1>
          {!!sub && (
            <p className={styles.sub}>
              <span className={styles.sr}>{sub}</span>
              {caretLine === lines.indexOf(PASTE) && <span className={styles.caret} />}
              <span className={styles.paste} data-on={pasted || reduced} aria-hidden>{sub}</span>
            </p>
          )}
          {!!hero.links?.length && (
            <p className={styles.links}>
              {hero.links.map((ln, n) => {
                const sc = shortcode(ln), cls = n ? styles.ghost : styles.primary, say = () => window.dispatchEvent(new CustomEvent(TYPE_EVENT, { detail: ln.label }));
                if (!sc.done) return sc.so ? (
                  <span key={ln.href} className={styles.code} aria-hidden>{sc.so}{sc.caret && <span className={styles.caret} />}</span>
                ) : null;
                return /^https?:/.test(ln.href)
                  ? <a key={ln.href} href={ln.href} className={cls} target="_blank" rel="noopener noreferrer" onPointerEnter={say}>{ln.label}<span aria-hidden> ↗</span></a>
                  : <Link key={ln.href} href={ln.href} className={cls} onPointerEnter={say}>{ln.label}</Link>;
              })}
            </p>
          )}
          {/* whatever the reader types while the board is up, the hands type here: the line is
              always there, empty or not, so the platen under it never moves */}
          <p className={styles.prompt} aria-hidden>
            {!!said && (<><span className={styles.promptMark}>›</span><span className={styles.said}>{said}</span><span className={styles.caret} /></>)}
          </p>
          {/* the platen: the hero's foot, where the sheet goes into the machine */}
          <div className={styles.platen} aria-hidden />
          {!!work.length && <WorkIndex items={work} total={more} typed={sheetRows} cur={cur} all={reduced} />}
        </AsciiBox>
        {tune && (
          <TunePanel
            params={params}
            onChange={setParams}
            metrics={metrics}
            check={check}
            busy={busy}
            playing={playing}
            onPlay={() => setPlaying(!playing)}
            X={X}
          />
        )}
      </section>
    </div>
  );
}
