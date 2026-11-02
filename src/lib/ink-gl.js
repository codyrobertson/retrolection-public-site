/**
 * Ballpoint ink over live DOM text (see gl-layer.js for the shared GL plumbing).
 *
 * After idle each word is rasterised with its computed font/colour into a mask;
 * the shader models paper-fibre edge roughness, a feathered halo, pooling, dry
 * skips and granulation. Effect strength scales with font size so small type
 * stays crisp. DOM glyphs are made transparent (not removed) once the first frame
 * is on screen, so text stays selectable and there is never a flash.
 */
import { createLayer } from "./gl-layer.js";

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "SVG", "CANVAS", "CODE", "PRE"]);

export const INK_FRAG = `precision highp float;varying vec2 uv;
uniform sampler2D mask,b1,b2,meta;uniform vec2 res;uniform float dpr,t,settle,y0,th,pad;
float h(vec2 p){p=fract(p*vec2(443.897,441.423));p+=dot(p,p.yx+19.19);return fract((p.x+p.y)*p.x);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
// paper fibres: three noise layers, each stretched ~8:1 along a different heading
float fibre(vec2 p,float seed){float a=0.;
  for(int i=0;i<3;i++){float an=float(i)*1.0472+.35+seed;float c=cos(an),s=sin(an);vec2 q=vec2(c*p.x-s*p.y,s*p.x+c*p.y);a+=vn(q*vec2(1.1,.14)+float(i)*13.7+seed*7.);}
  return a/3.;}
void main(){
  vec2 cp=vec2(uv.x,1.-uv.y)*vec2(res.x/dpr,th);              // css px inside tile, y down
  vec2 mu=vec2(uv.x,1.-(cp.y+pad)/(th+2.*pad));
  vec4 cc=texture2D(b2,mu); vec4 mk=texture2D(mask,mu);
  if(cc.a<.004&&mk.a<.004){gl_FragColor=vec4(0.);return;}    // most pixels: nothing near them
  float S=texture2D(meta,mu).r;                               // per-run effect strength (size-aware)
  if(DG>.5){                                                  // digital: dot-matrix on a device-pixel grid, sampled from the crisp glyph mask
    float pitch=mix(1.,2.,step(.55,S))/dpr;                    // body text: 1 device px (crisp bitmap); headlines: 2px dots
    vec2 pp=vec2(cp.x,y0+cp.y), cell=floor(pp/pitch), ctr=(cell+.5)*pitch, dd=ctr-pp;
    vec2 mc=mu+vec2(dd.x/(res.x/dpr),-dd.y/(th+2.*pad));
    vec4 g=texture2D(mask,mc);
    float big=step(.55,S);
    float on=mix(pow(g.a,.8),smoothstep(.38,.62,g.a),big);   // small type keeps its anti-aliasing: thresholding thin strokes makes it unreadable
    float dotA=on*mix(1.,smoothstep(pitch*.68,pitch*.52,length(pp-ctr)),big);
    gl_FragColor=vec4(g.rgb/max(g.a,.001)*dotA,dotA);return;
  }
  float c1=texture2D(b1,mu).a, c2=cc.a;
  vec3 col=cc.rgb/max(cc.a,.001);
  float lum=dot(col,vec3(.3,.6,.1));
  float lightInk=smoothstep(.4,.7,lum);                       // light ink on dark paper reads as glow if it blooms
  vec2 p=vec2(cp.x,y0+cp.y);                                  // page px: fibres continue across tiles
  float F=fibre(p+vec2(0.,t*.1),0.), D=fibre(p*.55,2.1), G=vn(p*2.6)*.5+vn(p*6.3+9.)*.5;
  float M=vn(p*.28+vec2(t*.02,0.));                           // low-frequency mottling: long soft wobble, not grit
  float breath=1.+.06*sin(t*.31)+.035*sin(t*.77+1.3);
  float tooth=mix(F,M,.4);
  float rough=(tooth-.5)*(.18+.2*settle);
  float body=mix(mk.a,smoothstep(.22,.52,c1+rough),S);        // S=0 → untouched glyph, S=1 → ragged edge
  float halo=smoothstep(.17,.52,c2*breath+(F-.5)*.37)*.15*settle*(.6+.8*G)*S*mix(1.,.55,lightInk);
  float edge=4.*c1*(1.-c1);
  float dens=.965+.035*edge*mix(.7,.3,lightInk);
  dens*=mix(.9,1.,smoothstep(.22,.62,c2));
  dens*=1.-.04*G;
  dens*=1.-smoothstep(.70,.88,D)*.1;
  float a=body*mix(1.,dens,S);
  a=clamp(a+halo*(1.-body),0.,1.);
  col=mix(col,vec3(.10,.13,.30),.14*(1.-lightInk)*S*(1.-edge*.5)); // blue-black ballpoint on light paper
  gl_FragColor=vec4(col*a,a);
}`;

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const strengthFor = (size) => 0.22 + 0.78 * sstep(12, 34, size);

/**
 * Walk the DOM and return one item per word, tagging elements the overlay can't track. Text
 * in a box that clips (overflow hidden) is clipped to it; text that is hidden (opacity 0) is
 * left out but not tagged, so it is inked as soon as it shows. On the body, a part of the page
 * marked data-gl-skip is left to the layer scoped to it (startSheetInk).
 *
 * A layer keeps what it learnt (`memo`) from one walk to the next. When all that has changed is
 * the DOM itself (`changes.dirty`: the elements the layer's MutationObserver saw change, a letter
 * going down), only those elements and what is in them are asked their styles again; the rest
 * keep theirs, and every run of text has its place read again (one box) so nothing moved is missed.
 * @param {{ full: boolean, dirty: Set<Element> }} [changes]
 */
function collect(root, host, share = false, memo = { words: new WeakMap(), els: new WeakMap() }, changes) {
  const docEl = document.documentElement, scoped = root !== document.body;
  const part = !!changes && !changes.full;
  if (!part) root.querySelectorAll("[data-ink-off]").forEach((e) => e.removeAttribute("data-ink-off"));
  const o = scoped ? root.getBoundingClientRect() : { left: -scrollX, top: -scrollY };
  const styles = new Map(), ok = new Map(), op = new Map(), clips = new Map(), off = [], on = [], sibs = new Map(), moved = new Map();
  /** an element the DOM changed in, or in one that did */
  const touched = (el) => {
    if (!part) return true;
    if (!el || el === root) return false;
    let v = moved.get(el); if (v !== undefined) return v;
    v = changes.dirty.has(el) || touched(el.parentElement); moved.set(el, v); return v;
  };
  // a part that types itself is hundreds of spans a letter each, and its layer is rebuilt as each goes down:
  // spans alike (one parent, one class, the same attributes) are styled alike, so they are asked once
  // (only spans, only there: nothing on the page styles a span by its place among its siblings)
  const style = (el) => {
    let s = styles.get(el); if (s) return s;
    let k = null, sib;
    if (share && el.tagName === "SPAN" && !el.id && !el.style.length && el.parentElement) {
      k = el.className; for (const a of el.attributes) if (a.name !== "class") k += `|${a.name}=${a.value}`;
      sib = sibs.get(el.parentElement); s = sib?.get(k);
    }
    if (!s) {
      s = getComputedStyle(el);
      if (k !== null) { if (!sib) sibs.set(el.parentElement, (sib = new Map())); sib.set(k, s); }
    }
    styles.set(el, s); return s;
  };
  const eligible = (el) => {
    if (!el || el === docEl || (scoped && !root.contains(el))) return true;
    let v = ok.get(el); if (v !== undefined) return v;
    // as it was, unless the DOM changed in it (a box that clips is always looked at again: it may have moved)
    const was = memo.els.get(el);
    if (was && !was.clip && !touched(el) && eligible(el.parentElement) === was.up) {
      op.set(el, was.alpha); ok.set(el, was.own); return was.own;
    }
    const up = eligible(el.parentElement);
    if (!up) { ok.set(el, false); memo.els.set(el, { own: false, up, alpha: 0, clip: null }); return false; }
    const s = style(el);
    const alpha = ((el.parentElement && op.get(el.parentElement)) || 1) * parseFloat(s.opacity || "1");
    op.set(el, alpha);
    const ov = (v) => v === "visible" ? 0 : v === "hidden" || v === "clip" ? 1 : 2;
    const flow = el === root ? 0 : Math.max(ov(s.overflowX), ov(s.overflowY));
    let clip = el.parentElement && clips.get(el.parentElement);
    if (flow === 1) {
      const r = el.getBoundingClientRect(), c = { x0: r.left - o.left, y0: r.top - o.top, x1: r.right - o.left, y1: r.bottom - o.top };
      clip = clip ? { x0: Math.max(clip.x0, c.x0), y0: Math.max(clip.y0, c.y0), x1: Math.min(clip.x1, c.x1), y1: Math.min(clip.y1, c.y1) } : c;
    }
    if (clip) clips.set(el, clip);
    // a closed <details> keeps its body laid out (content-visibility), so it has to be asked
    const shut = el.parentElement instanceof HTMLDetailsElement && !el.parentElement.open && el.tagName !== "SUMMARY";
    const hidden = shut || alpha < 0.01 || s.display === "none" || s.visibility !== "visible" || (!scoped && el.hasAttribute("data-gl-skip"));
    const own = !hidden && !SKIP_TAGS.has(el.tagName.toUpperCase()) && !el.hasAttribute("data-ink-skip") && !el.hasAttribute("data-gl-host") &&
      s.position !== "fixed" && s.position !== "sticky" && s.transform === "none" && flow < 2;
    if (!own && !hidden) off.push(el); // tag after reading, so we never dirty style mid-collect
    else if (part) on.push(el);
    ok.set(el, own);
    memo.els.set(el, { own, up, alpha, clip: clip || null });
    return own;
  };
  const out = [];
  const range = document.createRange();
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = tw.nextNode()); ) {
    const data = /** @type {Text} */ (n).data;
    if (!/\S/.test(data)) continue;
    const el = n.parentElement;
    if (!el || host.contains(el) || !eligible(el)) continue;
    const e = /** @type {any} */ (memo.els.get(el));
    if (!e.base || touched(el) || e.clip || e.base.alpha !== op.get(el)) {
      const s = style(el), size = parseFloat(s.fontSize);
      e.base = {
        font: `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`, color: s.color, alpha: op.get(el) ?? 1,
        ls: s.letterSpacing === "normal" ? "0px" : s.letterSpacing, size, S: strengthFor(size), clip: clips.get(el),
      };
      e.up = s.textTransform === "uppercase"; e.low = s.textTransform === "lowercase";
    }
    const base = e.base, up = e.up, low = e.low;
    // the words' boxes are kept, as offsets in the box of the element they're in, while the text, its font and
    // that box's size are as they were: one box read for the run rather than one for each word. (Text that shares
    // its element is only kept while nothing in that element changed: what's beside it could have moved it.)
    const pr = el.getBoundingClientRect(), px = pr.left - o.left, py = pr.top - o.top;
    const keepable = (el.firstChild === n && el.lastChild === n) || !touched(el);
    const sig = `${data}\u0000${base.font}\u0000${base.ls}\u0000${up}${low}\u0000${pr.width}\u0000${pr.height}`;
    let words = keepable ? memo.words.get(n) : null;
    if (!words || words.sig !== sig) {
      words = { sig, list: [] };
      const keep = (txt, r) => words.list.push({ text: up ? txt.toUpperCase() : low ? txt.toLowerCase() : txt, dx: r.left - pr.left, dy: r.top - pr.top, w: r.width, h: r.height });
      for (const m of data.matchAll(/\S+/g)) {
        range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
        const rects = range.getClientRects();
        if (rects.length === 1) keep(m[0], rects[0]);
        else for (let k = 0; k < m[0].length; k++) { range.setStart(n, m.index + k); range.setEnd(n, m.index + k + 1); const r = range.getClientRects()[0]; if (r) keep(m[0][k], r); }
      }
      memo.words.set(n, words);
    }
    for (const w of words.list) out.push({ ...base, text: w.text, x: px + w.dx, y: py + w.dy, w: w.w, h: w.h });
  }
  off.forEach((e) => e.setAttribute("data-ink-off", ""));
  on.forEach((e) => e.hasAttribute("data-ink-off") && e.removeAttribute("data-ink-off"));
  return out;
}

/**
 * @param {{ id?: string, readyClass?: string, root?: HTMLElement, debounce?: number, attributes?: string[], share?: boolean }} [opts]
 *   the page's ink by default; scoped to a part of it that types itself (startSheetInk)
 */
export function startInk(opts = {}) {
  const ascents = new Map(), memo = { words: new WeakMap(), els: new WeakMap() };
  let font = "", ls = "", color = "", alpha = -1, S = -1;
  const root = opts.root ?? document.body;
  const layer = createLayer({
    id: opts.id ?? "ink-gl", z: 2, readyClass: opts.readyClass ?? "ink-gl", frag: INK_FRAG, sigmas: [0.45, 2.3], metaScale: 0.25, animated: true,
    root: opts.root, debounce: opts.debounce, attributes: opts.attributes,
    collect: (root, host, changes) => collect(root, host, !!opts.share, memo, changes),
    begin(mx) { font = ls = color = ""; alpha = S = -1; mx.textBaseline = "alphabetic"; },
    paint(mx, tx, w) {
      if (w.font !== font) mx.font = font = w.font;
      if ("letterSpacing" in mx && w.ls !== ls) /** @type {any} */ (mx).letterSpacing = ls = w.ls;
      if (w.color !== color) mx.fillStyle = color = w.color;
      if (w.alpha !== alpha) mx.globalAlpha = alpha = w.alpha;
      let a = ascents.get(w.font);
      if (a === undefined) { a = mx.measureText("Hg").fontBoundingBoxAscent ?? null; ascents.set(w.font, a); }
      if (w.clip) { mx.save(); mx.beginPath(); mx.rect(w.clip.x0, w.clip.y0, w.clip.x1 - w.clip.x0, w.clip.y1 - w.clip.y0); mx.clip(); }
      mx.fillText(w.text, w.x, w.y + (a ?? w.h * 0.8), w.w + 0.5);
      if (w.clip) mx.restore();
      if (w.S !== S) { tx.fillStyle = `rgb(${Math.round(w.S * 255)},0,0)`; S = w.S; }
      tx.fillRect(w.x - 6, w.y - 6, w.w + 12, w.h + 12);
    },
  });
  return {
    rebuild: layer.rebuild,
    destroy() { layer.destroy(); root.querySelectorAll("[data-ink-off]").forEach((e) => e.removeAttribute("data-ink-off")); },
  };
}

/**
 * Ink for a part of the page that changes as it is read: the hero's sheet the hands type on,
 * the experience lines that print when opened. The layer rides inside `root`, so it scrolls,
 * clips and stacks as that element does (on the sheet: under the board, cut at the platen);
 * and it keeps up, a rebuild a frame or two behind each change (a letter going down: data-on)
 * rather than waiting for the page to settle. Mark the part data-gl-skip so the page's own
 * layer leaves it alone; `root` (positioned) is marked data-inked once its ink is on screen.
 * @param {HTMLElement} root
 * @param {string} id unique per page
 */
export function startLiveInk(root, id) {
  return startInk({ id, readyClass: id, root, debounce: 24, share: true, attributes: ["data-on", "data-state", "data-ready", "data-drawn", "data-seen", "open"] });
}
