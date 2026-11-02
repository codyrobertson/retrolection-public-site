/**
 * One clock for every mark's strokes drawing themselves in (WorkIndex). A mark is some eighty
 * strokes set off one after another; as CSS transitions each was an animation of its own from
 * the moment its line was done, waiting out its delay, and the page restyled every one of them
 * every frame (seven hundred at once as the index came up: 30 ms a frame on a slow phone). Here
 * only the strokes under way are written, and only when they have moved: the rest cost nothing.
 */

type Job = { paths: SVGGeometryElement[]; start: number; gap: number; dur: number; next: number; last: Float32Array };

const jobs = new Map<Element, Job>();
const inked = new WeakSet<Element>();          // drawn before: its strokes are written, and go back to nothing first
let raf = 0;

// cubic-bezier(0.5, 0, 0.2, 1), the pen's stroke: tabled once
const EASE = (() => {
  const x1 = 0.5, y1 = 0, x2 = 0.2, y2 = 1, N = 256, out = new Float32Array(N + 1);
  const b = (a: number, c: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * c * s * s * (1 - s) + s ** 3;
  for (let i = 0, s = 0; i <= N; i++) {
    const x = i / N;
    while (s < 1 && b(x1, x2, s) < x) s += 1 / 2048;
    out[i] = b(y1, y2, s);
  }
  return out;
})();
const ease = (t: number) => EASE[Math.round(t * 256)];

function tick(now: number) {
  raf = 0;
  for (const [el, J] of jobs) {
    for (let i = J.next; i < J.paths.length; i++) {
      const t = (now - J.start - i * J.gap) / J.dur;
      if (t <= 0) break;                                       // in order: the rest have not set off
      // a 400th of a stroke is less than a pixel of any mark
      const v = t >= 1 ? 0 : Math.round((1 - ease(t)) * 400) / 400;
      if (v !== J.last[i]) { J.last[i] = v; J.paths[i].style.strokeDashoffset = String(v); }
      if (t >= 1 && i === J.next) J.next++;
    }
    if (J.next >= J.paths.length) jobs.delete(el);
  }
  if (jobs.size) raf = requestAnimationFrame(tick);
}

/**
 * Draw the strokes in `svg` (those matching `sel`, in order) in from nothing: each `dur` ms,
 * set off `gap` ms apart. Drawing it again starts it over.
 */
export function draw(svg: Element, sel: string, gap: number, dur: number) {
  const paths = [...svg.querySelectorAll<SVGGeometryElement>(sel)];
  if (!paths.length) return;
  const last = new Float32Array(paths.length).fill(1);
  if (inked.has(svg)) for (const p of paths) p.style.strokeDashoffset = "1";
  inked.add(svg);
  jobs.set(svg, { paths, start: performance.now(), gap, dur, next: 0, last });
  if (!raf) raf = requestAnimationFrame(tick);
}
