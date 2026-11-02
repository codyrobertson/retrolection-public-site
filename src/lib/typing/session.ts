/**
 * The hero's state, held for the reader's visit rather than the component's life: once the
 * hands have typed the plate out, it stays typed (back from another page, back up from the
 * contact form), and a line of the index typed once stays typed. A page loaded afresh (typed
 * in, a link from elsewhere, a reload) is a new look: the performance starts over; only the
 * browser's back and forward pick the visit up again.
 *
 *   intro ──(the last letter of the hero goes down)──▶ typed
 *
 * Within `typed` the board still comes and goes with the sheet (TypingPlate's clock); that is
 * position, not progress, and is never stored. A visit left for longer than STALE_MS starts
 * over, with the dateline set again.
 */

export type Phase = "intro" | "typed";
type Saved = { phase: Phase; stamp: string; rows: string[]; at: number };

const KEY = "plate:v1";
const STALE_MS = 30 * 60_000;

let mem: Saved | null = null;
let looked = false;

/** how this document was come to: only back/forward is a return */
function returning() {
  const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  return nav?.type === "back_forward";
}

function read(): Saved | null {
  if (mem) return mem;
  try {
    // once per document: a fresh load forgets what an earlier one typed
    if (!looked) { looked = true; if (!returning()) sessionStorage.removeItem(KEY); }
    const raw = sessionStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Saved) : null;
    if (s && s.phase && typeof s.stamp === "string" && Date.now() - s.at < STALE_MS) mem = s;
  } catch {}
  return mem;
}
function write(next: Saved) {
  mem = next;
  try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch {}
}

/** the visit so far, or null on a first look */
export const visit = (): Saved | null => (typeof window === "undefined" ? null : read());

/** the dateline is set once per visit, then held */
export function stampFor(make: () => string) {
  const s = read();
  if (s) return s.stamp;
  const stamp = make();
  write({ phase: "intro", stamp, rows: [], at: Date.now() });
  return stamp;
}

export function markTyped() {
  const s = read();
  if (s && s.phase !== "typed") write({ ...s, phase: "typed", at: Date.now() });
}

export function markRows(ids: string[]) {
  const s = read();
  if (!s) return;
  const add = ids.filter((id) => !s.rows.includes(id));
  if (add.length) write({ ...s, rows: [...s.rows, ...add], at: Date.now() });
}

/** keep the visit alive while the reader is on it */
export function touch() {
  const s = read();
  if (s && Date.now() - s.at > 60_000) write({ ...s, at: Date.now() });
}
