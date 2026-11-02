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

export type Machine = {
  readonly phase: Phase;
  /** when the phase began (performance.now()) */
  readonly since: number;
  /** take an edge: its leave and enter run now, in that order; false (and nothing done) if there is no such edge */
  go(to: Phase, now?: number): boolean;
};

export function createMachine(initial: Phase, hooks: {
  enter?: Partial<Record<Phase, (from: Phase, now: number) => void>>;
  leave?: Partial<Record<Phase, (to: Phase, now: number) => void>>;
  change?: (to: Phase, from: Phase) => void;
}): Machine {
  let phase = initial, since = performance.now();
  return {
    get phase() { return phase; },
    get since() { return since; },
    go(to, now = performance.now()) {
      const from = phase;
      if (!EDGES[from].includes(to)) {
        if (process.env.NODE_ENV !== "production") console.warn(`plate: no edge ${from} → ${to}`);
        return false;
      }
      hooks.leave?.[from]?.(to, now);
      phase = to;
      since = now;
      hooks.enter?.[to]?.(from, now);
      hooks.change?.(to, from);
      return true;
    },
  };
}
