// The keys, heard: a round-cap mechanical board bottoming out. Synthesised, so there is
// nothing to download; started only from a click, as browsers require.

export function createThock() {
  let ctx = null, noise = null, out = null;

  function start() {
    if (ctx) return ctx.resume();
    ctx = new AudioContext();
    out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(ctx.destination);
    noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.12), ctx.sampleRate);
    const ch = noise.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    return ctx.resume();
  }

  const burst = (t, { freq, q, gain, decay }) => {
    const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(bp).connect(g).connect(out);
    src.start(t);
    src.stop(t + decay + 0.02);
  };
  const body = (t, { from, to, gain, decay }) => {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + decay);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + decay + 0.02);
  };

  /** a key reaching the bottom of its travel: the cap's clack over the case's thump */
  function down(name) {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.005, big = name === 'SPACE' || /SHIFT|ENTER|BACK/.test(name);
    const v = 0.92 + Math.random() * 0.16;
    burst(t, { freq: (big ? 1500 : 2300) * v, q: 1.1, gain: big ? 0.32 : 0.42, decay: 0.03 });
    burst(t, { freq: (big ? 420 : 640) * v, q: 2.2, gain: 0.26, decay: big ? 0.09 : 0.06 });
    body(t, { from: (big ? 105 : 150) * v, to: big ? 62 : 90, gain: big ? 0.55 : 0.4, decay: big ? 0.11 : 0.075 });
    if (big) burst(t + 0.012, { freq: 3200, q: 4, gain: 0.05, decay: 0.05 });   // the stabiliser wire
  }

  /** the spring bringing it back up: a lighter tick */
  function up() {
    if (!ctx || ctx.state !== 'running') return;
    burst(ctx.currentTime + 0.005, { freq: 3600, q: 1.5, gain: 0.07, decay: 0.014 });
  }

  const stop = () => ctx && ctx.suspend();
  return { start, stop, down, up };
}
