/**
 * The hero is one machine. Every animation on the plate belongs to exactly one phase, a phase
 * begins only when what it shows is drawn, and nothing else starts, stops or hides anything:
 *
 *            measured            box half ruled ∧ entry drawn ahead        hands on the keys      the loop
 *   boot ───────────────▶ load ─────────────────────────────────▶ enter ─────────────────▶ type ─────────▶ idle ⇄ live
 *                           │   (typed before this visit: the loop's pose drawn)                            ▲
 *                           └───────────────────────────────────────────────────────────────────────────────┘
 *
 *   enter | type | idle | live ──(the sheet's foot past the platen)──▶ exit ──(scrolled back)──▶ where it was
 *   exit ──(the plate above the window)──▶ away ──(back in view)──▶ exit
 *   any ──(the scene is drawn again: a resize, ?tune)──▶ load ──▶ where it was
 *   any ──(reduced motion, or ?tune paused)──▶ still
 *
 *   boot   nothing measured: the box is not ruled, the board not drawn
 *   load   the rule runs while the workers draw the board and the opening; the clock waits
 *   enter  the hands push the board up and settle on the keys (no caret: nothing to type yet)
 *   type   the dateline, the heading, the paste, the shortcodes; the caret on its line
 *   idle   the hands' loop; lines of the index and the reader's keys are taken up from here
 *   live   typing one of those, then back into the loop
 *   exit   the scroll's: the hands take the board away down the page, and bring it back
 *   away   the plate is gone above the window; the lights are the ledger's
 *   still  one pose, held; everything on the sheet is there
 */
export type Phase = "boot" | "load" | "enter" | "type" | "idle" | "live" | "exit" | "away" | "still";

/** where each phase may go; anything else is a fault, and says so in development */
export const EDGES: Record<Phase, readonly Phase[]> = {
  boot: ["load", "still"],
  load: ["enter", "type", "idle", "still"],
  enter: ["type", "exit", "load", "still"],
  type: ["idle", "exit", "load", "still"],
  idle: ["live", "exit", "load", "still", "enter"],
  live: ["live", "idle", "exit", "load", "still"],
  exit: ["enter", "type", "idle", "away", "load", "still"],
  away: ["exit", "load", "still"],
  still: ["load", "enter"],
};

/** the phases the hands' clock runs in, and the board is the reader's (it can be taken away) */
export const PLAYING: ReadonlySet<Phase> = new Set(["enter", "type", "idle", "live"]);

/** one step the machine took (or was asked to take and refused: ok false), and why */
export type Step = { t: number; from: Phase; to: Phase; why: string; ok: boolean };

export type Machine = {
  readonly phase: Phase;
  /** when the phase began (performance.now()) */
  readonly since: number;
  /** the last TRACE steps, oldest first (refused ones too) */
  readonly trace: readonly Step[];
  /** take an edge, saying why: its leave and enter run now, in that order; false (and nothing
   * done but the refusal traced) if there is no such edge */
  go(to: Phase, why: string, now?: number): boolean;
};

const TRACE = 160;

/**
 * With `marks`, each phase is a span on the DevTools Performance panel's Timings track
 * (performance.measure "plate:<phase>", its detail the step that began it and the one that ended
 * it), and each refusal a mark: the hero's story lines up with the frames it cost.
 */
export function createMachine(initial: Phase, hooks: {
  enter?: Partial<Record<Phase, (from: Phase, now: number) => void>>;
  leave?: Partial<Record<Phase, (to: Phase, now: number) => void>>;
  change?: (to: Phase, from: Phase, why: string) => void;
}, marks = false): Machine {
  let phase = initial, since = performance.now(), began = "start";
  const trace: Step[] = [];
  const note = (st: Step) => { trace.push(st); if (trace.length > TRACE) trace.shift(); };
  return {
    get phase() { return phase; },
    get since() { return since; },
    get trace() { return trace; },
    go(to, why, now = performance.now()) {
      const from = phase;
      if (!EDGES[from].includes(to)) {
        note({ t: now, from, to, why, ok: false });
        if (marks) performance.mark(`plate: no edge ${from} → ${to}`, { startTime: now, detail: why });
        if (process.env.NODE_ENV !== "production") console.warn(`plate: no edge ${from} → ${to} (${why})`);
        return false;
      }
      note({ t: now, from, to, why, ok: true });
      if (marks) performance.measure(`plate:${from}`, { start: since, end: Math.max(since, now), detail: { began, ended: why } });
      hooks.leave?.[from]?.(to, now);
      phase = to;
      since = now;
      began = why;
      hooks.enter?.[to]?.(from, now);
      hooks.change?.(to, from, why);
      return true;
    },
  };
}
