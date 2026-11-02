/**
 * The page, heard: off until the reader turns it on (SoundToggle), and then every motion that
 * makes a sound makes its own, synthesised here as it happens, nothing downloaded. The hero's
 * keys strike as a typewriter's (each at the frame its key bottoms out: plate.ts), the pen
 * scratches as a mark draws itself (pen.ts), the foot's cigarette catches with a lighter's
 * flick, the fingers knock on the wood and the index ticks the ash off (SmokeFooter,
 * cig-break). Under it, a band that never repeats: a Rhodes, an upright, brushes, and a vibes
 * line now and then, in the late-night Tokyo way, over a record's crackle.
 *
 * One AudioContext, made on the first turn-on (browsers allow sound only after a gesture);
 * everything is a call that does nothing while the sound is off.
 */

type Bus = { ac: AudioContext; sfx: GainNode; music: GainNode; verb: GainNode; noise: AudioBuffer; wow: GainNode };

const KEY = "retrolection:sound";
let B: Bus | null = null;
let on = false;
const subs = new Set<(on: boolean) => void>();

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

// ---- the room ---------------------------------------------------------------------------

function boot(): Bus {
  if (B) return B;
  const ac = new AudioContext({ latencyHint: "interactive" });
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
  comp.connect(ac.destination);

  // a small room: a stereo tail of noise, darkened as it dies
  const len = Math.round(ac.sampleRate * 2.6), ir = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len, k = 0.25 + 0.7 * t;                 // later, darker
      lp += (Math.random() * 2 - 1 - lp) * (1 - k);
      d[i] = lp * Math.pow(1 - t, 3.2);
    }
  }
  const conv = ac.createConvolver(); conv.buffer = ir;
  const verb = ac.createGain(); verb.gain.value = 1;
  const wet = ac.createGain(); wet.gain.value = 0.32;
  verb.connect(conv).connect(wet).connect(comp);

  const sfx = ac.createGain(); sfx.gain.value = 0.8; sfx.connect(comp);
  const sfxSend = ac.createGain(); sfxSend.gain.value = 0.12; sfx.connect(sfxSend).connect(verb);

  // the band through a warm, rolled-off tape: a soft clip and no top
  const music = ac.createGain(); music.gain.value = 0;
  const shape = ac.createWaveShaper();
  shape.curve = Float32Array.from({ length: 1024 }, (_, i) => { const x = (i / 1023) * 2 - 1; return Math.tanh(1.6 * x) / Math.tanh(1.6); });
  const tone = ac.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 8500; tone.Q.value = 0.5;
  const low = ac.createBiquadFilter(); low.type = "highpass"; low.frequency.value = 55;
  music.connect(shape).connect(tone).connect(low).connect(comp);
  const musicSend = ac.createGain(); musicSend.gain.value = 0.55; low.connect(musicSend).connect(verb);

  const noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  // the tape's wow: every pitched voice of the band hangs off this, a few cents either way
  const lfo = ac.createOscillator(); lfo.frequency.value = 0.42;
  const wow = ac.createGain(); wow.gain.value = 5;
  lfo.connect(wow); lfo.start();

  B = { ac, sfx, music, verb, noise, wow };
  document.addEventListener("visibilitychange", () => {
    if (!B) return;
    if (document.hidden) void B.ac.suspend(); else if (on) void B.ac.resume();
  });
  return B;
}

const live = () => (on && B && B.ac.state === "running" ? B : null);

/** a burst of noise through a band: the stuff of every click, slap and scrape */
function burst(b: Bus, dest: AudioNode, t: number, o: { f: number; q: number; gain: number; decay: number; attack?: number; type?: BiquadFilterType; rate?: number }) {
  const src = b.ac.createBufferSource(), f = b.ac.createBiquadFilter(), g = b.ac.createGain();
  src.buffer = b.noise; src.playbackRate.value = o.rate ?? rnd(0.9, 1.1);
  f.type = o.type ?? "bandpass"; f.frequency.value = o.f; f.Q.value = o.q;
  const a = o.attack ?? 0.0015;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.gain, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + o.decay);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 1.5); src.stop(t + a + o.decay + 0.05);
}
/** a struck partial: a sine that falls in pitch (a thud) or holds (a ring) */
function ping(b: Bus, dest: AudioNode, t: number, o: { f: number; to?: number; gain: number; decay: number; type?: OscillatorType }) {
  const osc = b.ac.createOscillator(), g = b.ac.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.f, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.decay);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.gain, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + o.decay);
  osc.connect(g).connect(dest);
  osc.start(t); osc.stop(t + o.decay + 0.05);
}

// ---- the motions ----------------------------------------------------------------------------

/** a key bottoming out, as a typewriter's: the type bar slapping the platen, the bar's ring, the
    carriage's thud; the space bar only the escapement; Enter the bell and the carriage run home */
export function strike(name: string) {
  const b = live(); if (!b) return;
  const t = b.ac.currentTime + 0.004, v = rnd(0.85, 1.15), out = b.sfx;
  if (/ENTER|RETURN/.test(name)) {
    ping(b, out, t, { f: 2093 * rnd(0.998, 1.002), gain: 0.16, decay: 1.4 });           // the bell
    ping(b, out, t, { f: 2093 * 2.76, gain: 0.05, decay: 0.7 });
    for (let k = 0; k < 9; k++) burst(b, out, t + 0.12 + 0.028 * k * (1 - k * 0.04), { f: 3000, q: 3, gain: 0.07, decay: 0.012 });   // the ratchet
    burst(b, out, t + 0.1, { f: 900, q: 0.8, gain: 0.05, decay: 0.32, attack: 0.08 });  // the carriage's run
    burst(b, out, t + 0.42, { f: 220, q: 1.2, gain: 0.3, decay: 0.12 });                // home
    return;
  }
  if (name === "SPACE") {
    burst(b, out, t, { f: 1700 * v, q: 2, gain: 0.12, decay: 0.02 });
    ping(b, out, t, { f: 95 * v, to: 60, gain: 0.3, decay: 0.08 });
    return;
  }
  if (/SHIFT/.test(name)) {                                                             // the basket lifting
    ping(b, out, t, { f: 70, to: 48, gain: 0.4, decay: 0.16 });
    burst(b, out, t, { f: 500, q: 1, gain: 0.12, decay: 0.08 });
    return;
  }
  if (/BACK/.test(name)) { burst(b, out, t, { f: 2600, q: 2, gain: 0.12, decay: 0.02 }); ping(b, out, t, { f: 140, to: 90, gain: 0.18, decay: 0.05 }); return; }
  burst(b, out, t, { f: 2800 * v, q: 0.9, gain: 0.34, decay: 0.022 });                 // the slap
  burst(b, out, t + 0.001, { f: 6200 * v, q: 3, gain: 0.07, decay: 0.008 });
  ping(b, out, t, { f: 3150 * v, gain: 0.035, decay: 0.07 });                           // the bar ringing
  ping(b, out, t, { f: 4710 * v, gain: 0.02, decay: 0.05 });
  ping(b, out, t, { f: 135 * v, to: 78, gain: 0.34, decay: 0.07 });                    // the platen
  burst(b, out, t, { f: 520 * v, q: 2, gain: 0.14, decay: 0.045 });
}

/** a mark drawing itself in pencil: `n` strokes set off `gap` ms apart, each `dur` ms. The
    graphite's grain under all of it, loudest where most strokes are under way, a catch of the
    point at each one's start */
export function scratch(n: number, gap: number, dur: number) {
  const b = live(); if (!b || n < 1) return;
  const ac = b.ac, t0 = ac.currentTime + 0.01, total = ((n - 1) * gap + dur) / 1000;
  const src = ac.createBufferSource(); src.buffer = b.noise; src.loop = true; src.playbackRate.value = 0.8;
  const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1800;
  const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 4200; bp.Q.value = 0.6;
  const g = ac.createGain(); g.gain.value = 0;
  src.connect(hp).connect(bp).connect(g).connect(b.sfx);
  // how many strokes are moving at each moment (each eases in fast and slows: the pen's own curve)
  const STEP = 0.025, peak = Math.min(n, dur / Math.max(gap, 1));
  g.gain.setValueAtTime(0, t0);
  for (let s = 0; s <= total; s += STEP) {
    let busy = 0;
    const lo = Math.max(0, Math.floor((s * 1000 - dur) / gap)), hi = Math.min(n - 1, Math.floor((s * 1000) / gap));
    for (let i = lo; i <= hi; i++) { const u = (s * 1000 - i * gap) / dur; if (u > 0 && u < 1) busy += (1 - u) * (1 - u); }
    const level = 0.11 * Math.sqrt(busy / Math.max(1, peak * 0.33)) * rnd(0.55, 1.15);
    g.gain.linearRampToValueAtTime(Math.min(0.14, level), t0 + s);
    bp.frequency.linearRampToValueAtTime(rnd(3200, 5600), t0 + s);
  }
  g.gain.linearRampToValueAtTime(0, t0 + total + 0.05);
  src.start(t0, Math.random()); src.stop(t0 + total + 0.1);
  for (let i = 0; i < Math.min(n, 48); i += 1 + (n > 24 ? 1 : 0)) burst(b, b.sfx, t0 + (i * gap) / 1000, { f: rnd(5000, 7500), q: 2, gain: 0.03, decay: 0.01 });
}

/** a lighter: the thumb runs the wheel over the flint, the spark, and the flame catching */
export function lighter() {
  const b = live(); if (!b) return;
  const t = b.ac.currentTime + 0.01, out = b.sfx;
  for (let k = 0; k < 14; k++) burst(b, out, t + k * 0.0075 + rnd(0, 0.002), { f: rnd(2400, 3600), q: 2.5, gain: 0.09 * (1 - k / 18), decay: 0.006 });   // the wheel
  burst(b, out, t, { f: 1800, q: 0.7, gain: 0.05, decay: 0.12 });
  burst(b, out, t + 0.105, { f: 7000, q: 1.5, gain: 0.12, decay: 0.01 });             // the spark
  burst(b, out, t + 0.112, { f: 5200, q: 2, gain: 0.06, decay: 0.014 });
  // the flame: a soft roar coming up and falling to a hiss, with a flutter in it
  const ac = b.ac, src = ac.createBufferSource(); src.buffer = b.noise; src.loop = true;
  const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.9;
  const g = ac.createGain(), t1 = t + 0.12;
  lp.frequency.setValueAtTime(300, t1); lp.frequency.exponentialRampToValueAtTime(1400, t1 + 0.08); lp.frequency.exponentialRampToValueAtTime(700, t1 + 0.9);
  g.gain.setValueAtTime(0, t1); g.gain.linearRampToValueAtTime(0.22, t1 + 0.07);
  for (let s = 0.1; s < 0.9; s += 0.05) g.gain.linearRampToValueAtTime(0.09 * (1 - s) * rnd(0.6, 1.3), t1 + s);
  g.gain.linearRampToValueAtTime(0, t1 + 1);
  src.connect(lp).connect(g).connect(out);
  src.start(t1); src.stop(t1 + 1.05);
}

/** a fingertip coming down on the table */
export function knock() {
  const b = live(); if (!b) return;
  const t = b.ac.currentTime + 0.004, v = rnd(0.9, 1.1);
  ping(b, b.sfx, t, { f: 190 * v, to: 120, gain: 0.16, decay: 0.06 });
  burst(b, b.sfx, t, { f: 950 * v, q: 3, gain: 0.07, decay: 0.03 });
}

/** the index flicking the ash off: a tick on the paper */
export function flick() {
  const b = live(); if (!b) return;
  const t = b.ac.currentTime + 0.004;
  burst(b, b.sfx, t, { f: 4200, q: 2, gain: 0.08, decay: 0.012 });
  burst(b, b.sfx, t + 0.002, { f: 1500, q: 2, gain: 0.05, decay: 0.02 });
}

// ---- the band -------------------------------------------------------------------------------

type Chord = [root: number, quality: keyof typeof Q];
/** voicings over the root, rootless: thirds, sevenths and the colours, as a Rhodes player leaves them */
const Q = {
  maj9: [4, 7, 11, 14], m9: [3, 7, 10, 14], m11: [3, 10, 14, 17], d13: [4, 10, 14, 21], d7b9: [4, 10, 13, 20], maj711: [4, 11, 14, 18],
} as const;
/** four bars each; a bar of two chords splits it */
const SONGS: Chord[][][] = [
  [[[49, "maj9"]], [[48, "m9"]], [[53, "m9"]], [[46, "m11"], [51, "d13"]]],          // Db  Cm  Fm  Bbm Eb
  [[[53, "maj9"]], [[52, "m11"], [57, "d7b9"]], [[50, "m9"]], [[55, "m9"], [48, "d13"]]],
  [[[51, "maj9"]], [[50, "m11"], [55, "d7b9"]], [[48, "m9"]], [[53, "m9"], [58, "d13"]]],
  [[[58, "maj9"]], [[57, "m9"]], [[55, "m9"]], [[48, "m9"], [53, "d13"]]],
  [[[56, "maj711"]], [[55, "m9"]], [[53, "m11"]], [[51, "m9"], [56, "d13"]]],
];
const BPM = 68, BEAT = 60 / BPM, SWING = 0.64;

/** a Rhodes tine: FM, the bell of the tine at the strike, a slow fall */
function rhodes(b: Bus, out: AudioNode, t: number, midi: number, len: number, vel: number) {
  const ac = b.ac, f = hz(midi);
  const car = ac.createOscillator(), mod = ac.createOscillator(), mg = ac.createGain(), g = ac.createGain();
  car.frequency.value = f; mod.frequency.value = f;
  b.wow.connect(car.detune); b.wow.connect(mod.detune);
  mg.gain.setValueAtTime(f * 2.4 * vel, t); mg.gain.exponentialRampToValueAtTime(f * 0.25, t + 0.7);
  mod.connect(mg).connect(car.frequency);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.17 * vel, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.075 * vel, t + 0.9); g.gain.setTargetAtTime(0.0001, t + len, 0.18);
  car.connect(g).connect(out);
  const tine = ac.createOscillator(), tg = ac.createGain();
  tine.frequency.value = f * 7.1; tg.gain.setValueAtTime(0.02 * vel, t); tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  tine.connect(tg).connect(out);
  const end = t + len + 1;
  for (const o of [car, mod, tine]) { o.start(t); o.stop(end); }
  car.onended = () => { try { b.wow.disconnect(car.detune); b.wow.disconnect(mod.detune); } catch { /* gone */ } };
}
/** an upright: the pluck, the wood, a short bloom */
function upright(b: Bus, out: AudioNode, t: number, midi: number, len: number) {
  const ac = b.ac, f = hz(midi);
  const o1 = ac.createOscillator(), o2 = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
  o1.type = "triangle"; o1.frequency.value = f; o2.frequency.value = f; b.wow.connect(o1.detune);
  lp.type = "lowpass"; lp.Q.value = 1.4; lp.frequency.setValueAtTime(1500, t); lp.frequency.exponentialRampToValueAtTime(380, t + 0.25);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.17, t + 0.01); g.gain.exponentialRampToValueAtTime(0.07, t + 0.3);
  g.gain.setTargetAtTime(0.0001, t + len * 0.85, 0.06);
  o1.connect(lp); o2.connect(lp); lp.connect(g).connect(out);
  burst(b, out, t, { f: 700, q: 2, gain: 0.045, decay: 0.03 });                          // the finger off the string
  for (const o of [o1, o2]) { o.start(t); o.stop(t + len + 0.4); }
  o1.onended = () => { try { b.wow.disconnect(o1.detune); } catch { /* gone */ } };
}
/** a vibraphone bar, the motor's tremolo on it */
function vibes(b: Bus, out: AudioNode, t: number, midi: number) {
  const ac = b.ac, f = hz(midi), g = ac.createGain(), trem = ac.createOscillator(), tg = ac.createGain();
  trem.frequency.value = 5.2; tg.gain.value = 0.35; trem.connect(tg).connect(g.gain);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
  const v = ac.createGain(); v.gain.value = 0.14;
  for (const [m, a] of [[1, 1], [4, 0.18], [10, 0.04]] as const) {
    const o = ac.createOscillator(), og = ac.createGain(); o.frequency.value = f * m; og.gain.value = a;
    b.wow.connect(o.detune); o.connect(og).connect(g); o.start(t); o.stop(t + 2.3);
    o.onended = () => { try { b.wow.disconnect(o.detune); } catch { /* gone */ } };
  }
  g.connect(v).connect(out);
  trem.start(t); trem.stop(t + 2.3);
}
/** the kit, brushed and far back */
const ride = (b: Bus, out: AudioNode, t: number, a: number) => { burst(b, out, t, { f: 6800, q: 0.8, gain: 0.08 * a, decay: 0.32, type: "bandpass" }); burst(b, out, t, { f: 5200, q: 6, gain: 0.02 * a, decay: 0.5 }); };
const swish = (b: Bus, out: AudioNode, t: number, a: number) => burst(b, out, t, { f: 2600, q: 0.5, gain: 0.08 * a, decay: 0.2, attack: 0.03 });
const kick = (b: Bus, out: AudioNode, t: number) => ping(b, out, t, { f: 75, to: 50, gain: 0.1, decay: 0.2 });

/** the record under it all: dust on the groove and a little hiss, looped */
function crackle(b: Bus) {
  const ac = b.ac, n = ac.sampleRate * 5, buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * 0.012;
  for (let k = 0; k < 140; k++) {
    const at = Math.floor(Math.random() * (n - 400)), big = Math.random() < 0.08, amp = big ? rnd(0.4, 0.8) : rnd(0.05, 0.25);
    for (let j = 0; j < (big ? 260 : 40); j++) d[at + j] += amp * (Math.random() * 2 - 1) * Math.exp(-j / (big ? 50 : 8));
  }
  const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
  const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 900;
  const g = ac.createGain(); g.gain.value = 0.22;
  src.connect(hp).connect(g).connect(b.music); src.start();
  return src;
}

function band(b: Bus) {
  let timer = 0, next = 0, song = pick(SONGS), bar = 0, played = 0, melody = false, lastMel = 72, prevRoot = 0;
  let dust: AudioBufferSourceNode | null = null;
  const at = (barT: number, beat: number) => barT + (Math.floor(beat) + (beat % 1 ? SWING : 0)) * BEAT;
  const voice = (root: number, q: keyof typeof Q) => Q[q].map((iv) => { let m = root + iv; while (m < 57) m += 12; while (m > 76) m -= 12; return m; }).sort((x, y) => x - y);

  function playBar(T: number) {
    const chords = song[bar % song.length], half = chords.length > 1;
    const keys = b.music;
    // the comping
    const comp = half ? pick([[[0, 1.8], [2, 1.8]], [[0, 1.4], [1.5, 2.4]]]) : pick([[[0, 3.6]], [[0, 1.4], [1.5, 2.3]], [[0, 2], [2.5, 1.4]], [[0.5, 3]]]);
    comp.forEach(([beat, len], k) => {
      const [root, q] = chords[half ? Math.min(k, 1) : 0], vel = rnd(0.6, 0.85);
      voice(root, q).forEach((m, j) => rhodes(b, keys, at(T, beat) + j * rnd(0.004, 0.014), m, len * BEAT, vel * (j ? 0.9 : 1)));
    });
    // the bass: two to a bar mostly, walking now and then, a step into the next chord
    const walk = Math.random() < 0.4, nextChord = song[(bar + 1) % song.length][0];
    const beats = walk ? [0, 1, 2, 3] : [0, 2];
    beats.forEach((beat) => {
      const [root, q] = chords[half && beat >= 2 ? 1 : 0];
      let m = 36 + ((root - 36) % 12 + 12) % 12;
      if (beat === 3) m = 36 + ((nextChord[0] - 36) % 12 + 12) % 12 + pick([-1, 1]);
      else if (beat === 1) m += Q[q][1] === 7 ? 7 : pick([7, Q[q][0]]);
      else if (beat === 2 && !half) m += pick([0, 7]);
      if (beat === 0 && m === prevRoot && Math.random() < 0.3) m += 12;
      if (beat === 0) prevRoot = m;
      upright(b, keys, at(T, beat), m, (walk ? 1 : 2) * BEAT);
    });
    // the brushes
    [0, 1, 1.5, 2, 3, 3.5].forEach((beat) => ride(b, keys, at(T, beat) + rnd(-0.008, 0.008), beat % 1 ? 0.6 : beat % 2 ? 1 : 0.8));
    [1, 3].forEach((beat) => swish(b, keys, at(T, beat), rnd(0.8, 1.1)));
    kick(b, keys, at(T, 0));
    if (Math.random() < 0.35) kick(b, keys, at(T, 2.5));
    // a line on the vibes, some phrases: chord tones and their neighbours, mostly by step, with rests
    if (melody) {
      const [root, q] = chords[0], tones = Q[q].map((iv) => root + iv);
      for (let e = 0; e < 8; e++) {
        if (Math.random() > 0.38) continue;
        const near = tones.flatMap((m) => [m, m + 12, m + 24]).filter((m) => m >= 64 && m <= 86);
        near.sort((x, y) => Math.abs(x - lastMel) - Math.abs(y - lastMel));
        lastMel = pick(near.slice(0, 3));
        vibes(b, keys, at(T, e / 2), lastMel);
      }
    }
    bar++; played++;
    if (bar % song.length === 0) {
      melody = Math.random() < 0.55;
      if (played >= song.length * 2) { song = pick(SONGS); bar = 0; played = 0; }
    }
  }

  function tick() {
    const now = b.ac.currentTime;
    while (next < now + 0.8) { playBar(Math.max(next, now + 0.05)); next = Math.max(next, now + 0.05) + 4 * BEAT; }
  }
  return {
    start() {
      if (timer) return;
      next = b.ac.currentTime + 0.3; bar = 0; played = 0; melody = false;
      dust ??= crackle(b);
      b.music.gain.cancelScheduledValues(b.ac.currentTime);
      b.music.gain.setTargetAtTime(0.24, b.ac.currentTime, 1.2);
      tick(); timer = window.setInterval(tick, 200);
    },
    stop() {
      window.clearInterval(timer); timer = 0;
      b.music.gain.cancelScheduledValues(b.ac.currentTime);
      b.music.gain.setTargetAtTime(0, b.ac.currentTime, 0.25);
    },
  };
}
let player: ReturnType<typeof band> | null = null;

// ---- on and off -----------------------------------------------------------------------------

export const soundOn = () => on;
/** the reader's choice last time (this browser only); never on by itself, only armed */
export function soundWanted() { try { return localStorage.getItem(KEY) === "on"; } catch { return false; } }
export function onSound(fn: (on: boolean) => void) { subs.add(fn); return () => { subs.delete(fn); }; }

/** turn it on or off; on must come from a gesture (a click, a key) */
export async function setSound(next: boolean) {
  on = next;
  try { localStorage.setItem(KEY, next ? "on" : "off"); } catch { /* private window */ }
  subs.forEach((fn) => fn(on));
  if (next) {
    const b = boot();
    await b.ac.resume();
    if (!on) return;
    (player ??= band(b)).start();
  } else if (B) {
    player?.stop();
    const b = B;
    window.setTimeout(() => { if (!on) void b.ac.suspend(); }, 1400);
  }
}
