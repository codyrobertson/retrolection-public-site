/**
 * Analog <-> digital surface mode, shared by every GL layer.
 *
 * One tiny state object (window.__surface) is read by each layer's draw call and
 * handed to its shader as uFrom / uTo / uFront. A switch is a print-head sweep:
 * a front travels down the viewport, everything above it is already in the new
 * mode, everything below is still in the old one, and the boundary dissolves
 * through an ordered dither. Layers outside the viewport simply flip when the
 * sweep ends. When nothing is transitioning, front is "infinite" and each shader
 * takes exactly one branch.
 */

const FAR = 1e9;
const DURATION = 1100;

/** @type {{ from: number, to: number, front: number, dir: number }} */
export const surface = (window.__surface ??= { from: 0, to: 0, front: FAR, dir: 1 });

const subs = new Set();
/** @param {() => void} fn  @returns {() => void} */
export const onSurface = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const notify = () => subs.forEach((fn) => fn());

let raf = 0;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export const getSurfaceMode = () => (surface.to ? "digital" : "analog");

/**
 * @param {"analog" | "digital"} mode
 * @param {{ instant?: boolean }} [opts]
 */
export function setSurfaceMode(mode, opts = {}) {
  const to = mode === "digital" ? 1 : 0;
  if (to === surface.to && !raf) return;
  cancelAnimationFrame(raf); raf = 0;
  const docEl = document.documentElement;
  surface.from = surface.to; surface.to = to; surface.dir = to ? 1 : -1;
  docEl.dataset.surface = mode;
  try { localStorage.setItem("surface-mode", mode); } catch {}

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (opts.instant || reduced) { surface.from = to; surface.front = FAR; notify(); return; }

  const a = scrollY - 70, b = scrollY + innerHeight + 70, t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / DURATION);
    if (k >= 1) { surface.from = surface.to; surface.front = FAR; raf = 0; notify(); return; }
    surface.front = a + (b - a) * ease(k);
    notify();
    raf = requestAnimationFrame(step);
  };
  surface.front = a; notify();
  raf = requestAnimationFrame(step);
}

export const isTransitioning = () => surface.front !== FAR;

export function restoreSurfaceMode() {
  let m = "analog";
  try { m = localStorage.getItem("surface-mode") || "analog"; } catch {}
  if (m === "digital") setSurfaceMode("digital", { instant: true });
  else document.documentElement.dataset.surface = "analog";
}
