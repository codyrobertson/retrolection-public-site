// A few workers, each holding the same scene. Jobs queue here (not in the workers) so
// they can be reordered by when they are needed and dropped the moment the scene is
// reconfigured: a slider drag never waits behind frames for a pose it has left.

export function createPool(size) {
  const workers = Array.from({ length: size }, () => ({
    w: new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }),
    pending: 0,
  }));
  const replies = new Map();
  const queue = [];
  const cache = new Map();
  const stats = {};          // per job type: count and worker milliseconds, for ?tune and debugging
  let seq = 0, gen = 0;

  const post = (W, type, req) => {
    const id = ++seq;
    W.pending++;
    W.w.postMessage({ seq: id, type, req });
    return new Promise((resolve) => replies.set(id, resolve));
  };
  for (const W of workers) {
    W.w.onmessage = ({ data }) => {
      W.pending--;
      const done = replies.get(data.seq);
      replies.delete(data.seq);
      if (done) done(data);
      pump();
    };
  }
  function pump() {
    for (const W of workers) {
      if (W.pending || !queue.length) continue;
      let best = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i].pri < queue[best].pri) best = i;
      const job = queue.splice(best, 1)[0];
      if (job.queued) (stats[job.type] ||= { n: 0, ms: 0, wait: 0 }).wait += performance.now() - job.queued;
      const t0 = performance.now();
      post(W, job.type, job.req).then(({ out, error }) => {
        const st = (stats[job.type] ||= { n: 0, ms: 0, wait: 0 });
        st.n++; st.ms += performance.now() - t0;
        const stale = job.gen !== gen;
        if (stale && out && out.bitmap) out.bitmap.close();
        if (stale) job.reject(STALE);
        else if (error) job.reject(new Error(error));
        else job.resolve(out);
      });
    }
  }

  /** run one job on whichever worker frees first; same request, same answer (until reconfigured) */
  function get(type, req = {}, pri = 0) {
    const key = type + JSON.stringify(req);
    const hit = cache.get(key);
    if (hit) {
      if (hit.job && pri < hit.job.pri) hit.job.pri = pri;
      return hit.promise;
    }
    const entry = {};
    entry.promise = new Promise((resolve, reject) => {
      entry.job = { type, req, pri, gen, resolve, reject, queued: performance.now() };
      queue.push(entry.job);
    });
    entry.promise.then(() => { entry.job = null; }, () => { if (cache.get(key) === entry) cache.delete(key); });
    cache.set(key, entry);
    pump();
    return entry.promise;
  }

  /** a new scene everywhere; everything queued or cached for the old one is dropped */
  function configure(params) {
    gen++;
    for (const job of queue.splice(0)) job.reject(STALE);
    // finished layers may still be on screen until the new scene's first frame: the caller
    // holds them, and lets them go
    cache.clear();
    const inits = workers.map((W) => post(W, 'init', { params }));
    return Promise.all(inits).then((all) => {
      const bad = all.find((r) => r.error);
      if (bad) throw new Error(bad.error);
      pump();
      return all[0].out;
    });
  }

  /** the plate has gone: nothing still waiting is wanted (what is already drawn is kept) */
  function drop() {
    for (const job of queue.splice(0)) job.reject(STALE);
  }
  /** a layer the caller has let go: asked for again, it is drawn again */
  function forget(type, req) { cache.delete(type + JSON.stringify(req)); }

  const dispose = () => { drop(); workers.forEach((W) => W.w.terminate()); };
  return { get, configure, drop, forget, dispose, size, stats, generation: () => gen, queued: () => queue.length };
}

export const STALE = new Error('stale');
