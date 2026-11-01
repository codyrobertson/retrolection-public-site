/**
 * The lights fade only where they can be seen. Colour is inherited, so a page whose body fades
 * its colour restyles every element on it on every frame of the fade (two thousand of them, the
 * whole of a phone's frame). So backgrounds and rules fade everywhere (they are not inherited:
 * each is one element), and colour only in the blocks on screen, marked [data-fade] for the length
 * of the fade (globals.css). Off screen it simply changes, where no one is looking.
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
  for (const el of blocks(document.body, [])) {
    if (!near.has(el)) { near.set(el, true); io?.observe(el); }
    if (near.get(el)) { el.setAttribute("data-fade", ""); marked.push(el); }
  }
}

export function unmarkFade() {
  for (const el of marked) el.removeAttribute("data-fade");
  marked = [];
}
