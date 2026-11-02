/**
 * Text that flows round a spot illustration's silhouette, line by line (Pretext does the breaking).
 *
 * Without JS a spot is a float with `shape-outside` from its alpha, which wraps but can't hang into the
 * margin (an image shape is stretched over the float's margin box). Here the spot comes out of the
 * float, hangs past the column, and the paragraphs after it are re-broken: each line's width is the
 * room the cut-out leaves across that line's height, read from the image's alpha. Links, code chips
 * and emphasis keep their elements; each line is painted as its own nowrap row.
 *
 * A spot sits right or left of the column. Only the paragraphs right after it flow; whatever follows
 * them is pushed below the picture.
 */
import {
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  prepareRichInline,
  type RichInlineCursor,
} from "@chenglou/pretext/rich-inline";

const ALPHA = 150;      // an alpha at or under this is background: soft washes and drop shadows can sit under the text gap
const GAP_EM = 0.8;     // clear space between text and ink
const MIN_LINE_EM = 7;  // narrower than this and the line is left empty, as shape-outside does
const STEP_EM = 0.5;    // line edges snap to this, away from the picture, so the contour steps instead of wobbling

type Piece = { text: string; font: string; letterSpacing: number; chain: Element[]; pad: number };
type Profile = { w: number; h: number; lo: Int16Array; hi: Int16Array }; // per row: first and last inked column, -1 when none

const fontOf = (cs: CSSStyleDeclaration) => `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
const spacing = (cs: CSSStyleDeclaration) => (cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing) || 0);

/** The paragraph's text as runs, each with the inline elements it sits in. */
function piecesOf(p: HTMLElement): Piece[] | null {
  const out: Piece[] = [];
  const walk = (node: Node, chain: Element[]): boolean => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const host = (chain[chain.length - 1] ?? p) as HTMLElement;
        const cs = getComputedStyle(host);
        const pad = chain.reduce((n, el) => {
          const s = getComputedStyle(el);
          return n + parseFloat(s.paddingLeft) + parseFloat(s.paddingRight) + parseFloat(s.borderLeftWidth) + parseFloat(s.borderRightWidth);
        }, 0);
        if (child.textContent) out.push({ text: child.textContent, font: fontOf(cs), letterSpacing: spacing(cs), chain, pad });
      } else if (child instanceof HTMLElement) {
        const cs = getComputedStyle(child);
        if (cs.float !== "none" || cs.display !== "inline" || child.matches("img,br,svg,video")) return false; // not plain inline text
        if (!walk(child, [...chain, child])) return false;
      }
    }
    return true;
  };
  return walk(p, []) && out.length ? out : null;
}

async function profileOf(img: HTMLImageElement, w: number, h: number): Promise<Profile> {
  await img.decode().catch(() => {});
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const lo = new Int16Array(h).fill(-1), hi = new Int16Array(h).fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > ALPHA) { lo[y] = x; break; }
    for (let x = w - 1; x >= 0; x--) if (d[(y * w + x) * 4 + 3] > ALPHA) { hi[y] = x; break; }
  }
  return { w, h, lo, hi };
}

type Flow = { undo: () => void };

type Side = "right" | "left";

/** Lays out one spot and the paragraphs after it. Returns how to put everything back. */
async function flowSpot(fig: HTMLElement): Promise<Flow | null> {
  const img = fig.querySelector("img");
  if (!img) return null;
  const run: HTMLElement[] = [];
  for (let el = fig.nextElementSibling; el instanceof HTMLElement && el.tagName === "P"; el = el.nextElementSibling) run.push(el);
  const pieces = run.map(piecesOf);
  const n = pieces.findIndex((x) => !x);
  if (n === 0 || !run.length) return null;
  if (n > 0) run.length = n;

  const fonts = new Set(pieces.slice(0, run.length).flatMap((ps) => ps!.map((x) => x.font)));
  await Promise.all([...fonts].map((f) => document.fonts.load(f).catch(() => {})));

  return layoutRun(fig, img, run, pieces as Piece[][], fig.dataset.side === "left" ? "left" : "right");
}

async function layoutRun(fig: HTMLElement, img: HTMLImageElement, run: HTMLElement[], pieces: Piece[][], side: Side): Promise<Flow | null> {
  fig.dataset.flow = side;
  const ir = img.getBoundingClientRect();
  const prof = await profileOf(img, Math.round(ir.width), Math.round(ir.height));
  const after = run[run.length - 1].nextElementSibling as HTMLElement | null;
  const saved = run.map((p) => [...p.childNodes]);
  const afterMargin = after?.style.marginTop ?? "";

  const undo = () => {
    run.forEach((p, i) => p.replaceChildren(...saved[i]));
    if (after) after.style.marginTop = afterMargin;
    delete fig.dataset.flow;
  };

  try {
    const imgBox = img.getBoundingClientRect();
    const scale = prof.h / imgBox.height;
    for (let i = 0; i < run.length; i++) {
      const p = run[i];
      const cs = getComputedStyle(p);
      const fs = parseFloat(cs.fontSize), lh = parseFloat(cs.lineHeight) || fs * 1.6, gap = GAP_EM * fs, step = STEP_EM * fs;
      const pr = p.getBoundingClientRect();
      const colW = Math.floor(p.clientWidth);
      const top0 = pr.top - imgBox.top, imgL = imgBox.left - pr.left;

      // the stretches of the line spanning [y, y + lh) that the picture leaves free, in the paragraph's coordinates
      const room = (y: number): [number, number][] => {
        let lo = Infinity, hi = -Infinity;
        const r0 = Math.max(0, Math.floor((top0 + y - gap) * scale)), r1 = Math.min(prof.h - 1, Math.ceil((top0 + y + lh + gap) * scale));
        for (let r = r0; r <= r1; r++) {
          if (prof.lo[r] < 0) continue;
          lo = Math.min(lo, imgL + prof.lo[r] / scale - gap);
          hi = Math.max(hi, imgL + prof.hi[r] / scale + gap);
        }
        if (lo > hi) return [[0, colW]];
        const cut = Math.floor(lo / step) * step, resume = Math.ceil(hi / step) * step;
        const segs: [number, number][] = side === "right" ? [[0, Math.min(colW, cut)]] : [[Math.max(0, resume), colW]];
        return segs.map(([a, b]) => [Math.round(a), Math.round(b)] as [number, number]).filter(([a, b]) => b - a >= MIN_LINE_EM * fs);
      };

      const ps = pieces[i];
      const prepared = prepareRichInline(
        ps.map((x) => ({ text: x.text, font: x.font, letterSpacing: x.letterSpacing, extraWidth: x.pad || undefined, break: x.pad && x.text.length < 28 ? "never" as const : "normal" as const })),
      );
      const rows: HTMLElement[] = [];
      let cursor: RichInlineCursor | undefined;
      let done = false;
      for (let y = 0; !done && rows.length < 400; y += lh) {
        const row = document.createElement("span");
        row.className = "flowLine";
        row.style.height = `${lh}px`;
        rows.push(row);
        for (const [x0, x1] of room(y)) {
          const range = layoutNextRichInlineLineRange(prepared, x1 - x0, cursor);
          if (!range) { done = true; break; }
          const seg = document.createElement("span");
          seg.className = "flowSeg";
          seg.style.left = `${x0}px`;
          for (const f of materializeRichInlineLineRange(prepared, range).fragments) {
            const src = ps[f.itemIndex];
            let node: Node = document.createTextNode(f.text);
            for (let k = src.chain.length - 1; k >= 0; k--) {
              const el = src.chain[k].cloneNode(false) as Element;
              el.removeAttribute("id");
              el.append(node);
              node = el;
            }
            if (f.gapBefore > 0) seg.append(" ");
            seg.append(node);
          }
          row.append(seg);
          cursor = range.end;
        }
        if (done && !row.childNodes.length) rows.pop();
      }
      p.replaceChildren(...rows);
    }
    // whatever follows the run clears the picture
    if (after) {
      const below = imgBox.bottom + GAP_EM * 16 - after.getBoundingClientRect().top;
      if (below > 0) after.style.marginTop = `${parseFloat(getComputedStyle(after).marginTop) + below}px`;
    }
  } catch {
    undo();
    return null;
  }
  return { undo };
}

/** Flows every spot inside `root`, again whenever the column changes width. */
export function startSpotFlow(root: HTMLElement) {
  let flows: Flow[] = [];
  let width = 0, gen = 0;
  const run = async () => {
    const mine = ++gen;
    flows.forEach((f) => f.undo());
    flows = [];
    await document.fonts.ready;
    for (const fig of root.querySelectorAll<HTMLElement>("figure[data-spot]")) {
      if (mine !== gen) return;
      const f = await flowSpot(fig);
      if (f) flows.push(f);
    }
  };
  const ro = new ResizeObserver(([e]) => {
    const w = Math.round(e.contentRect.width);
    if (w !== width) { width = w; void run(); }
  });
  ro.observe(root);
  return () => { gen++; ro.disconnect(); flows.forEach((f) => f.undo()); };
}
