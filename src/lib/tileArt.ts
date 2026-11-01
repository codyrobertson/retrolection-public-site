/**
 * Each project's tile carries an abstract drawing in the plates' graphite: never a picture
 * of the thing, a mark for the kind of work. Design work is form (rings, planes laid in with
 * hatching, the line it was constructed on); code is structure (indented runs of line, a
 * lattice, a bracket); work that is both has a form cut through by structure. The same slug
 * always draws the same mark, so it can be drawn on the server and drawn again on hover.
 */
import type { Discipline } from "./content";

export type Stroke = { d: string; w: number; tone: number; accent?: boolean };
export type Art = { strokes: Stroke[]; clips: { id: string; d: string }[]; hatched: { clip: string; d: string; tone: number }[] };

const W = 400, H = 300;

function rngOf(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (v: number) => v.toFixed(1);

export function tileArt(slug: string, discipline: Discipline, active: boolean): Art {
  const r = rngOf(slug), between = (a: number, b: number) => a + (b - a) * r();
  const strokes: Stroke[] = [], clips: Art["clips"] = [], hatched: Art["hatched"] = [];
  const jag = (amp: number) => (r() - 0.5) * amp;

  /** a hand-drawn line: a few points off true, as a pencil goes */
  const line = (x0: number, y0: number, x1: number, y1: number, w = 1, tone = 0.8) => {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 40));
    let d = `M${f(x0)} ${f(y0)}`;
    for (let i = 1; i <= n; i++) {
      const t = i / n, nx = -(y1 - y0), ny = x1 - x0, l = Math.hypot(nx, ny) || 1, o = i < n ? jag(2.4) : 0;
      d += ` L${f(x0 + (x1 - x0) * t + (nx / l) * o)} ${f(y0 + (y1 - y0) * t + (ny / l) * o)}`;
    }
    strokes.push({ d, w, tone });
  };
  /** a ring that runs on a little past where it started, as a drawn circle does */
  const ring = (cx: number, cy: number, rad: number, w = 1.1, tone = 0.85, from = r() * 6.3, sweep = 6.6) => {
    let d = "";
    for (let i = 0; i <= 48; i++) {
      const a = from + (sweep * i) / 48, rr = rad * (1 + jag(0.025));
      d += `${i ? " L" : "M"}${f(cx + Math.cos(a) * rr)} ${f(cy + Math.sin(a) * rr)}`;
    }
    strokes.push({ d, w, tone });
    return `M${f(cx + rad)} ${f(cy)} A${f(rad)} ${f(rad)} 0 1 0 ${f(cx - rad)} ${f(cy)} A${f(rad)} ${f(rad)} 0 1 0 ${f(cx + rad)} ${f(cy)} Z`;
  };
  /** parallel strokes laid over a clip, the way the plates lay tone */
  const hatch = (clip: string, angle: number, gap: number, tone: number) => {
    const c = Math.cos(angle), s = Math.sin(angle), R = Math.hypot(W, H);
    let d = "";
    for (let k = -R; k <= R; k += gap) {
      const ox = W / 2 + -s * k, oy = H / 2 + c * k, a = 0.82 + r() * 0.18;
      d += ` M${f(ox - c * R * a)} ${f(oy - s * R * a)} L${f(ox + c * R * a)} ${f(oy + s * R * a)}`;
    }
    hatched.push({ clip, d, tone });
  };
  const clip = (d: string) => { const id = `${slug}-${clips.length}`; clips.push({ id, d }); return id; };

  const form = () => {
    const cx = between(W * 0.35, W * 0.7), cy = between(H * 0.3, H * 0.6), rad = between(70, 120);
    const disc = ring(cx, cy, rad);
    hatch(clip(disc), between(-0.9, -0.5), between(5, 7), 0.32);
    ring(cx + between(-60, 60), cy + between(-40, 40), rad * between(0.35, 0.6), 0.9, 0.6);
    // a plane laid in behind it
    const px = between(20, W * 0.4), py = between(H * 0.45, H * 0.7), pw = between(120, 200), ph = between(60, 110);
    hatch(clip(`M${f(px)} ${f(py)} h${f(pw)} v${f(ph)} h${f(-pw)} Z`), between(0.6, 1), between(4, 6), 0.22);
    line(px, py, px + pw, py, 0.9, 0.7);
    // the construction line it was set out on, run long past it
    const a = between(-0.5, 0.5);
    line(cx - Math.cos(a) * 260, cy - Math.sin(a) * 260, cx + Math.cos(a) * 260, cy + Math.sin(a) * 260, 0.6, 0.35);
  };
  const structure = (dense: number) => {
    // indented runs, as a page of code is from a distance
    const x0 = between(28, 70), rows = Math.round(between(8, 12) * dense), lh = between(15, 19);
    let y = between(30, 60), indent = 0;
    for (let i = 0; i < rows && y < H - 20; i++, y += lh) {
      if (r() < 0.12) continue;                              // a blank line
      indent = Math.max(0, Math.min(4, indent + (r() < 0.3 ? 1 : r() < 0.3 ? -1 : 0)));
      const x = x0 + indent * 18, len = between(40, 210 - indent * 18);
      line(x, y, x + len, y, 1.4, 0.75);
      if (r() < 0.35) line(x + len + 10, y, x + len + 10 + between(16, 50), y, 1.4, 0.45);
    }
    // a lattice of marks under it
    const g = between(22, 30);
    for (let gx = g; gx < W; gx += g) for (let gy = g; gy < H; gy += g) if (r() < 0.55) line(gx - 2, gy, gx + 2, gy, 0.7, 0.3);
    // a bracket, large, at one side
    const bx = between(W * 0.72, W * 0.86), by = between(40, 70), bh = between(150, 210);
    line(bx, by, bx + 22, by, 1.2, 0.8); line(bx + 22, by, bx + 22, by + bh, 1.2, 0.8); line(bx + 22, by + bh, bx, by + bh, 1.2, 0.8);
  };

  if (discipline === "design") form();
  else if (discipline === "code") structure(1.2);
  else { form(); structure(0.7); }
  // the live ones carry the plates' one colour, once
  if (active) {
    const ax = between(W * 0.15, W * 0.85), ay = between(H * 0.15, H * 0.5);
    strokes.push({ d: `M${f(ax - 7)} ${f(ay)} A7 7 0 1 0 ${f(ax + 7)} ${f(ay)} A7 7 0 1 0 ${f(ax - 7)} ${f(ay)}`, w: 2, tone: 1, accent: true });
  }
  return { strokes, clips, hatched };
}

export const ART_BOX = `0 0 ${W} ${H}`;
