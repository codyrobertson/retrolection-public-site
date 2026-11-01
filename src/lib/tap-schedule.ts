/**
 * The resting hand's fingers, tapping arrhythmically (SmokeFooter): when to lift and press
 * which finger. No metronome: rests are long and lopsided (a few seconds, now and then a very
 * long one), a burst is one to seven taps whose gaps wander, a finger may double, and the run
 * of fingers drifts to a neighbour more often than it jumps. A burst is never the one before.
 *
 * It only says which frame of the hand's sheet to show (0: at rest; for finger d, 3d - 2: half
 * lifted, 3d - 1: lifted, 3d: pressed) and when. A tap rises through the half frame, falls back
 * through it faster, presses, and lets go. Nothing runs while
 * `active()` is false: the timer stops where it is, the hand goes back to rest, and `kick()`
 * starts it fresh.
 */

type Tap = { d: number; gap: number };

const WEIGHTS = [0, 0.36, 0.3, 0.21, 0.13];           // index, middle, ring, little: the near fingers tap most
const chance = (p: number) => Math.random() < p;
const between = (a: number, b: number) => a + (b - a) * Math.random();
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const normal = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
const finger = () => {
  let r = Math.random();
  for (let d = 1; d <= 4; d++) if ((r -= WEIGHTS[d]) <= 0) return d;
  return 1;
};

let dir = 1;                                          // which way along the hand the last run was going
/** a burst of one to seven taps: gaps around 120ms, some doubled, fingers mostly walking */
function taps(): Tap[] {
  let n = 1;
  while (n < 7 && !chance(0.42)) n++;
  let d = finger();
  if (chance(0.5)) dir = -dir;
  const out: Tap[] = [];
  for (let i = 0; i < n; i++) {
    let gap = clamp(120 + 45 * normal(), 60, 260), next: number;
    if (i < n - 1 && chance(0.18)) { gap = between(40, 70); next = d; }
    else next = chance(0.5) ? clamp(d + dir, 1, 4) : chance(0.4) ? d : finger();
    out.push({ d, gap });
    d = next;
  }
  return out;
}
/** a run across the hand, index to little finger or back */
function ripple(): Tap[] {
  const order = chance(0.5) ? [1, 2, 3, 4] : [4, 3, 2, 1];
  return order.map((d) => ({ d, gap: between(0, 25) }));
}
const signature = (b: Tap[]) => b.map((t) => `${t.d}:${Math.round(t.gap / 50)}`).join(",");

export function startTapping(show: (frame: number) => void, active: () => boolean) {
  let timer = 0, parked = true, dead = false, last = "";

  /** wait, then go on, unless the page has gone quiet in the meantime */
  const after = (ms: number, next: () => void) => {
    timer = window.setTimeout(() => (active() ? next() : park()), ms);
  };
  const park = () => { parked = true; timer = 0; show(0); };

  const rest = () => {
    // mostly under two seconds, a lopsided tail of longer ones, now and then a long stillness
    const ms = chance(0.12) ? between(8000, 14000) : clamp(Math.exp(Math.log(1800) + 0.65 * normal()), 500, 7000);
    show(0);
    after(ms, burst);
  };
  const burst = () => {
    let b = chance(0.15) ? ripple() : taps();
    for (let tries = 0; tries < 3 && signature(b) === last; tries++) b = chance(0.15) ? ripple() : taps();
    last = signature(b);
    let i = 0;
    const tap = () => {
      const { d, gap } = b[i], half = 3 * d - 2;
      show(half);
      after(between(45, 65), () => {
        show(half + 1);
        after(between(55, 95), () => {
          show(half);
          after(between(28, 40), () => {
            show(half + 2);
            after(between(50, 80), () => {
              show(0);
              if (++i < b.length) after(gap, tap);
              else rest();
            });
          });
        });
      });
    };
    tap();
  };

  const kick = () => {
    if (dead || !parked || !active()) return;
    parked = false;
    rest();
  };
  kick();
  return {
    kick,
    stop() { dead = true; window.clearTimeout(timer); show(0); },
  };
}
