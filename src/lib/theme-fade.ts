/**
 * The lights fade only where they can be seen. Colour is inherited, so a page whose body fades
 * its colour restyles every element on it on every frame of the fade (two thousand of them, the
 * whole of a phone's frame). So backgrounds and rules fade everywhere (they are not inherited:
 * each is one element), and colour only in the blocks on screen, marked [data-fade] for the length
 * of the fade (globals.css). Off screen it simply changes, where no one is looking. Where the
 * GL ink paints the letters (most of the page), even the blocks on screen fade only their grounds,
 * rules and drawings: fading the colour of letters no one sees cost a slow phone 25 ms a frame.
 *
 * A block is the largest element under the body with at most BLOCK elements in it.
 */
const BLOCK = 150;
const SKIP = "script, style, template, canvas, next-route-announcer, [id$='-gl']";

let io: IntersectionObserver | null = null;
const near = new WeakMap<Element, boolean>();
let marked: Element[] = [];

function blocks(root: Element, out: Element[]) {
  for (const el of root.children) {
    if (el.matches(SKIP)) continue;
    if (el.getElementsByTagName("*").length > BLOCK) blocks(el, out);
    else out.push(el);
  }
  return out;
}

/** keep track of which blocks are on screen (or nearly: the page may be scrolling as it fades) */
export function watchFade() {
  io ??= new IntersectionObserver((es) => { for (const e of es) near.set(e.target, e.isIntersecting); }, { rootMargin: "35% 0px" });
  for (const el of blocks(document.body, [])) if (!near.has(el)) { near.set(el, true); io.observe(el); }
  return () => { io?.disconnect(); io = null; };
}

/** the blocks in sight take the fade; one not yet seen by the observer is taken to be in sight */
export function markFade() {
  unmarkFade();
  const gl = document.documentElement.classList.contains("ink-gl");
  for (const el of blocks(document.body, [])) {
    if (!near.has(el)) { near.set(el, true); io?.observe(el); }
    if (near.get(el)) { el.setAttribute("data-fade", gl && inked(el) ? "ink" : ""); marked.push(el); }
  }
}

/** text the page paints itself under the ink layers (ink.css): a part they can't track, a field,
 * a live part whose own layer is not on yet */
const PAINTED = "[data-ink-off], input, textarea, select, [data-gl-skip]:not([data-inked], [data-inked] *)";
/** every letter in the block is the GL ink's (its own are transparent): their colour is never seen,
 * and the layer reads it again once the lights have moved, so only the block's marks need fade */
const inked = (el: Element) =>
  getComputedStyle(el).webkitTextFillColor === "rgba(0, 0, 0, 0)" && !el.querySelector(PAINTED);   // what is above it, its own fill says

export function unmarkFade() {
  for (const el of marked) el.removeAttribute("data-fade");
  marked = [];
}
