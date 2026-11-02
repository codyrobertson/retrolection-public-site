/**
 * The resting hand's fingers drumming (SmokeFooter): when to lift and press which finger. Slow and
 * even, as a hand idles on a table while its owner thinks: a phrase is a few rolls (little finger
 * to index, da-da-da-dum) or a few soft taps of one finger, on a steady beat held for the phrase
 * (only a breath of give in it), then a long stillness. Phrases change little from one to the next.
 *
 * It only says which frame of the hand's sheet to show (0: at rest; for finger d, 3d - 2: half
 * lifted, 3d - 1: lifted, 3d: pressed) and when. A finger rises through the half frame, comes down
 * through it a little quicker, and rests pressed a moment. Nothing runs while `active()` is false:
 * the timer stops where it is, the hand goes back to rest, and `kick()` starts it fresh.
 *
 * Given `pause` (cig-break), every few phrases the stillness is spent instead on the cigarette: the
 * first after a phrase or two, then every three to five.
 */

type Step = { f: number; ms: number };

const chance = (p: number) => Math.random() < p;
const between = (a: number, b: number) => a + (b - a) * Math.random();
/** a breath of give: a few percent either way */
const give = (ms: number) => ms * between(0.96, 1.04);

/** one finger's tap, `pace` its length overall (ms): up, held, down, pressed */
function tap(d: number, pace: number): Step[] {
  const half = 3 * d - 2;
  return [
    { f: half, ms: pace * 0.22 },
    { f: half + 1, ms: pace * 0.3 },
    { f: half, ms: pace * 0.14 },
    { f: half + 2, ms: pace * 0.34 },
  ];
}

/** a roll, little finger to index: each finger down as the next comes up, the last held longer */
function roll(pace: number): Step[] {
  return [4, 3, 2, 1].flatMap((d, i) => tap(d, give(i === 3 ? pace * 1.25 : pace)));
}

/** a phrase: two to four rolls a beat apart, or three to five taps of the index or middle finger */
function phrase(): Step[] {
  const out: Step[] = [];
  if (chance(0.7)) {
    const pace = between(190, 230), beat = between(1250, 1500), n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const r = roll(pace), used = r.reduce((t, s) => t + s.ms, 0);
      out.push(...r, { f: 0, ms: Math.max(220, give(beat - used)) });
    }
  } else {
    const d = chance(0.7) ? 1 : 2, pace = between(300, 360), beat = between(850, 1000), n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) out.push(...tap(d, give(pace)), { f: 0, ms: Math.max(200, give(beat - pace)) });
  }
  return out;
}

type Pause = (done: (finished: boolean) => void) => { stop(): void };

export function startTapping(show: (frame: number) => void, active: () => boolean, pause?: Pause) {
  let timer = 0, parked = true, dead = false, away: { stop(): void } | null = null;
  let untilPause = 1 + Math.floor(Math.random() * 2);

  /** wait, then go on, unless the page has gone quiet in the meantime */
  const after = (ms: number, next: () => void) => {
    timer = window.setTimeout(() => (active() ? next() : park()), ms);
  };
  const park = () => { parked = true; timer = 0; show(0); };
  const smoke = () => {
    untilPause = 3 + Math.floor(Math.random() * 3);
    away = pause!((finished) => { away = null; if (dead) return; if (finished && active()) rest(); else park(); });
  };

  // a stillness of four to nine seconds between phrases
  const rest = (first = false) => {
    show(0);
    after(first ? between(900, 1600) : between(4000, 9000), () => (pause && untilPause-- <= 0 ? smoke() : play()));
  };
  const play = () => {
    const steps = phrase();
    let i = 0;
    const next = () => {
      if (i >= steps.length) return rest();
      const { f, ms } = steps[i++];
      show(f);
      after(ms, next);
    };
    next();
  };

  const kick = () => {
    if (dead || !parked || !active()) return;
    parked = false;
    rest(true);
  };
  kick();
  return {
    kick,
    stop() { dead = true; window.clearTimeout(timer); away?.stop(); show(0); },
  };
}
