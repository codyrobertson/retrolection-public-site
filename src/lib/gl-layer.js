/**
 * Tiled WebGL overlay for live DOM. Shared plumbing for the ink (text) and
 * marker (fills) layers.
 *
 * The DOM stays the source of truth. A layer collects items from the page,
 * paints them into a mask canvas (colour) and a meta canvas (per-item shader
 * parameters), blurs the mask on the GPU, and runs one composite fragment shader.
 *
 *  - The page is cut into 1024px tiles; each tile is a canvas that scrolls natively
 *    with the document (no scroll-sync lag). A small pool of tiles — canvas, GL
 *    context, compiled programs, textures — is reused, so scrolling or rebuilding
 *    only re-uploads a mask; it never creates contexts or compiles shaders.
 *  - Blurs run once per layout. The wide blur and the meta map are low-res.
 *  - Static layers draw once per load; animated layers draw visible tiles at
 *    30fps and pause when hidden or under reduced motion.
 */

import { surface, onSurface } from "./surface-mode.js";
import { linked } from "./gl-ready.js";
import { NIGHT, night, nightIn, onNight } from "./night.js";

export const TILE_H = 1024;
export const PAD = 16; // css px of mask beyond each tile edge so blur/halo cross seams
const MARGIN = 512;

const VS = `attribute vec2 p;varying vec2 uv;varying vec2 uvv;void main(){uvv=uv=p*.5+.5;gl_Position=vec4(p,0,1);}`;
const BLUR = `precision mediump float;varying vec2 uv;uniform sampler2D tex;uniform vec2 stp;
void main(){vec4 s=vec4(0.);float w=0.;for(int i=-6;i<=6;i++){float x=float(i)*.5;float k=exp(-x*x*.5);s+=texture2D(tex,uv+stp*x)*k;w+=k;}gl_FragColor=s/w;}`;

/**
 * Injected before every composite shader's main(): the analog/digital mode helpers.
 * DG is 0 (analog) or 1 (digital) for this pixel, already resolved through the sweep
 * front and its dithered boundary. Shaders branch on it.
 */
const SURF = `uniform float uFrom,uTo,uFront;float DG;
float b2f(vec2 q){return mod(2.*q.x+3.*q.y,4.);}
float bayer8(vec2 p){p=floor(p);return (b2f(mod(p,2.))*16.+b2f(mod(floor(p/2.),2.))*4.+b2f(mod(floor(p/4.),2.))+.5)/64.;}
float bh(vec2 q){q=fract(q*vec2(.1031,.1030));q+=dot(q,q.yx+33.33);return fract((q.x+q.y)*q.x);}
`;
// The switch is a short eased dither crossfade: uFront runs 0..1 in time, every pixel flips when it crosses its Bayer threshold.
const withSurface = (frag, gate) => {
  const i = frag.lastIndexOf("void main(){");
  const body = frag.slice(i + "void main(){".length);
  const head = frag.slice(0, i).replace("varying vec2 uv;", "varying vec2 uvv;vec2 uv;");
  return head + SURF + NIGHT + "void main0(){" + body +
    `void main(){uv=uvv;float fl=1.;
  if(uFront<1e8) fl=uFront;
  DG=mix(uFrom,uTo,step(bayer8(gl_FragCoord.xy*.5),fl));
  ${gate === "analog" ? "if(DG>.5){gl_FragColor=vec4(0.);return;}" : gate === "digital" ? "if(DG<.5){gl_FragColor=vec4(0.);return;}" : ""}
  main0();
  vec4 o=gl_FragColor;                                        // the lights' front (night.js), in the layer's own px
  if(o.a>.0){float y=y0+(1.-uv.y)*th;gl_FragColor=vec4(lights(o.rgb/o.a,y)*o.a,o.a);}}`;
};

const noop = { rebuild() {}, destroy() {} };

/**
 * @typedef {object} LayerConfig
 * @property {string} id               host element id
 * @property {number} z                z-index of the host
 * @property {string} readyClass       added to <html> once the first frame is on screen
 * @property {string} frag             composite shader; receives mask,b1,b2,meta,res,dpr,t,settle,y0,th,pad
 * @property {[number, number]} sigmas css px blur radii: [tight, wide]
 * @property {number} metaScale        meta map resolution relative to css px
 * @property {boolean} [metaNearest]   sample meta without filtering (for angles/ids)
 * @property {boolean} animated        redraw visible tiles at 30fps
 * @property {"analog" | "digital"} [gate] draw only in this surface mode
 * @property {(root: HTMLElement, host: HTMLElement) => any[]} collect  items need numeric y,h
 * @property {(mx: CanvasRenderingContext2D, tx: CanvasRenderingContext2D) => void} begin  called per tile before painting
 * @property {(mx: CanvasRenderingContext2D, tx: CanvasRenderingContext2D, item: any) => void} paint
 * @property {string[]} [attributes]   attributes whose mutation should rebuild
 * @property {number} [padding]        extra css px items are bucketed with
 * @property {HTMLElement} [root]      the part of the page the layer covers (default: the body). A
 *                                     scoped root carries the host inside it, so the layer scrolls,
 *                                     clips and stacks as that element does; it must be positioned
 * @property {number} [debounce]       ms a change waits before a rebuild (default 120); a scoped
 *                                     layer under live typing wants about a frame
 */

/** the largest texture the GPU takes, 0 without WebGL: asked once a page, of a context made and let go for the asking */
let maxTex = -1;
function maxTexture() {
  if (maxTex < 0) {
    const probe = document.createElement("canvas").getContext("webgl");
    maxTex = probe ? probe.getParameter(probe.MAX_TEXTURE_SIZE) : 0;
    probe?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return maxTex;
}

/** one new context a frame, across every layer on the page: each is ~3-20 ms of the GPU's answering, and the
 *  page's layers starting together made a dozen in one frame */
let spent = false;
function spend() {
  if (spent) return false;
  spent = true;
  requestAnimationFrame(() => setTimeout(() => (spent = false), 0));
  return true;
}

/** @param {LayerConfig} cfg */
export function createLayer(cfg) {
  const maxTex = maxTexture();
  if (!maxTex) return noop; // no WebGL → page is left exactly as authored

  const root = cfg.root ?? document.body;
  const scoped = root !== document.body;
  const docEl = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const perf = (window.__gl ??= {})[cfg.id] = { buildMs: 0, collectMs: 0, rasterMs: 0, tiles: 0, items: 0, contexts: 0 };
  const bucketPad = cfg.padding ?? PAD;

  /** @type {any[]} */ let items = [];
  /** @type {Map<number, any[]>} */ let buckets = new Map();
  /** @type {Map<number, any>} */ const active = new Map();
  /** @type {any[]} */ const free = [];
  let docW = 0, docH = 0, dpr = 1, alive = true, raf = 0, lastDraw = 0, first = true, timer = 0, roReady = false;
  // the colours the layer was last drawn in, and where the lights' front is over it (night.js)
  let drawnDark = 0, nightY = -1e6;
  const origin = () => (scoped ? root.getBoundingClientRect().top : -scrollY);
  const t0 = performance.now();

  const host = document.createElement("div");
  host.id = cfg.id;
  host.setAttribute("data-gl-host", "");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:absolute;top:0;left:0;pointer-events:none;overflow:hidden;z-index:${cfg.z};visibility:hidden`;
  root.appendChild(host);

  function bucketize() {
    buckets = new Map();
    for (const it of items) {
      const lo = Math.max(0, Math.floor((it.y - bucketPad) / TILE_H)), hi = Math.floor((it.y + it.h + bucketPad) / TILE_H);
      for (let i = lo; i <= hi; i++) { let b = buckets.get(i); if (!b) buckets.set(i, (b = [])); b.push(it); }
    }
  }

  function createTile() {
    const cv = document.createElement("canvas");
    const g = cv.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false });
    if (!g) return null;
    perf.contexts++;
    const mkS = (type, src) => { const o = g.createShader(type); g.shaderSource(o, src); g.compileShader(o); return o; };
    const prog = (fs) => { const pr = g.createProgram(); g.attachShader(pr, mkS(g.VERTEX_SHADER, VS)); g.attachShader(pr, mkS(g.FRAGMENT_SHADER, fs)); g.bindAttribLocation(pr, 0, "p"); g.linkProgram(pr); const c = {}; return { pr, u: (n) => (c[n] ??= g.getUniformLocation(pr, n)) }; };
    const blurP = prog(BLUR), compP = prog(withSurface(cfg.frag, cfg.gate));
    g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    const tex = (nearest = false) => { const x = g.createTexture(); g.bindTexture(g.TEXTURE_2D, x);
      for (const k of [g.TEXTURE_MIN_FILTER, g.TEXTURE_MAG_FILTER]) g.texParameteri(g.TEXTURE_2D, k, nearest ? g.NEAREST : g.LINEAR);
      for (const k of [g.TEXTURE_WRAP_S, g.TEXTURE_WRAP_T]) g.texParameteri(g.TEXTURE_2D, k, g.CLAMP_TO_EDGE); return x; };
    const target = () => ({ t: tex(), fb: g.createFramebuffer(), w: 0, h: 0 });
    const T = { mask: tex(), meta: tex(!!cfg.metaNearest), tmp: target(), tmpH: target(), b1: target(), b2: target() };
    const maskC = document.createElement("canvas"), metaC = document.createElement("canvas");
    const mx = /** @type {CanvasRenderingContext2D} */ (maskC.getContext("2d")), tx = /** @type {CanvasRenderingContext2D} */ (metaC.getContext("2d", { willReadFrequently: false }));
    const alloc = (r, w, h) => { if (r.w === w && r.h === h) return; r.w = w; r.h = h;
      g.bindTexture(g.TEXTURE_2D, r.t); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
      g.bindFramebuffer(g.FRAMEBUFFER, r.fb); g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, r.t, 0); };
    const pass = (src, dst, dx, dy, sig) => {
      g.bindFramebuffer(g.FRAMEBUFFER, dst.fb); g.viewport(0, 0, dst.w, dst.h); g.disable(g.BLEND); g.useProgram(blurP.pr);
      g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, src); g.uniform1i(blurP.u("tex"), 0);
      g.uniform2f(blurP.u("stp"), (dx * sig) / dst.w, (dy * sig) / dst.h); g.drawArrays(g.TRIANGLE_STRIP, 0, 4); g.enable(g.BLEND);
    };

    cv.style.display = "none";
    const tile = {
      i: -1, th: 0, cv, lost: false, start: 0, sig: "",
      linked: () => linked(g, blurP.pr, compP.pr),
      load(i, th, settleFromZero) {
        tile.i = i; tile.th = th;
        const mhC = th + 2 * PAD, ty = i * TILE_H - PAD;
        const cw = Math.ceil(docW * dpr), ch = Math.ceil(th * dpr);
        if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
        cv.style.cssText = `position:absolute;left:0;top:${i * TILE_H}px;width:${docW}px;height:${th}px;display:block`;
        const mw = Math.ceil(docW * dpr), mh = Math.ceil(mhC * dpr);
        if (maskC.width !== mw || maskC.height !== mh) { maskC.width = mw; maskC.height = mh; }
        const qw = Math.max(1, Math.ceil(docW * cfg.metaScale)), qh = Math.max(1, Math.ceil(mhC * cfg.metaScale));
        if (metaC.width !== qw || metaC.height !== qh) { metaC.width = qw; metaC.height = qh; }

        const tr = performance.now();
        mx.setTransform(1, 0, 0, 1, 0, 0); mx.clearRect(0, 0, mw, mh);
        tx.setTransform(1, 0, 0, 1, 0, 0); tx.fillStyle = "#000"; tx.fillRect(0, 0, qw, qh);
        mx.setTransform(dpr, 0, 0, dpr, 0, -ty * dpr);
        tx.setTransform(cfg.metaScale, 0, 0, cfg.metaScale, 0, -ty * cfg.metaScale);
        cfg.begin(mx, tx);
        for (const it of buckets.get(i) || []) cfg.paint(mx, tx, it);
        perf.rasterMs += performance.now() - tr;

        g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true); g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.bindTexture(g.TEXTURE_2D, T.mask); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, maskC);
        g.bindTexture(g.TEXTURE_2D, T.meta); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, metaC);
        const hw = Math.max(1, mw >> 1), hh = Math.max(1, mh >> 1);
        alloc(T.tmp, mw, mh); alloc(T.b1, mw, mh); alloc(T.tmpH, hw, hh); alloc(T.b2, hw, hh);
        const [s1, s2] = cfg.sigmas;
        pass(T.mask, T.tmp, 1, 0, s1 * dpr); pass(T.tmp.t, T.b1, 0, 1, s1 * dpr);
        pass(T.mask, T.tmpH, 1, 0, s2 * dpr * 0.5); pass(T.tmpH.t, T.b2, 0, 1, s2 * dpr * 0.5);
        g.bindFramebuffer(g.FRAMEBUFFER, null); g.viewport(0, 0, cw, ch);
        tile.start = performance.now() - (settleFromZero ? 0 : 3000);
      },
      draw(now) {
        g.useProgram(compP.pr);
        [T.mask, T.b1.t, T.b2.t, T.meta].forEach((x, k) => { g.activeTexture(g.TEXTURE0 + k); g.bindTexture(g.TEXTURE_2D, x); });
        ["mask", "b1", "b2", "meta"].forEach((n, k) => g.uniform1i(compP.u(n), k));
        g.uniform2f(compP.u("res"), cv.width, cv.height); g.uniform1f(compP.u("dpr"), dpr);
        g.uniform1f(compP.u("t"), cfg.animated ? (now - t0) / 1000 : 0);
        g.uniform1f(compP.u("y0"), tile.i * TILE_H); g.uniform1f(compP.u("th"), tile.th); g.uniform1f(compP.u("pad"), PAD);
        g.uniform1f(compP.u("settle"), !cfg.animated || reduced.matches ? 1 : 1 - Math.pow(1 - Math.min(1, (now - tile.start) / 3000), 3));
        g.uniform1f(compP.u("uFrom"), surface.from); g.uniform1f(compP.u("uTo"), surface.to); g.uniform1f(compP.u("uFront"), surface.front);
        g.uniform1f(compP.u("uNightY"), nightY); g.uniform1f(compP.u("uDark"), drawnDark);
        g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
      },
    };
    cv.addEventListener("webglcontextlost", (e) => { e.preventDefault(); tile.lost = true; });
    cv.addEventListener("webglcontextrestored", () => { tile.lost = false; tile.sig = ""; scheduleBuild(); });
    host.appendChild(cv);
    return tile;
  }

  /** everything a tile's textures are made from: its size, the page's, and each word as it was
   *  painted (null where an item holds something that can't be read back, as a Path2D: never skipped) */
  const sigOf = (i, th) => {
    let k = `${th}:${docW}:${dpr}`;
    for (const it of buckets.get(i) || []) {
      k += "\n";
      for (const f in it) {
        const v = it[f];
        if (v === null || typeof v !== "object") k += `${v},`;
        else if (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype) k += `${Object.values(v).join(" ")},`;
        else return null;
      }
    }
    return k;
  };
  function wanted() {
    const top = scoped ? -root.getBoundingClientRect().top : scrollY;   // the window's top, in the layer's px
    const lo = Math.max(0, Math.floor((top - MARGIN) / TILE_H)), hi = Math.floor((top + innerHeight + MARGIN) / TILE_H);
    const vlo = Math.max(0, Math.floor(top / TILE_H)), vhi = Math.floor((top + innerHeight) / TILE_H);
    return { lo, hi, vlo, vhi };
  }
  let left = false, tickF = 0, tickT = 0;
  /** @type {any[]} */ const baking = [];
  function sync(force = false) {
    const { lo, hi, vlo, vhi } = wanted();
    const now = performance.now();
    for (const [i, t] of active) {
      const th = Math.min(TILE_H, docH - i * TILE_H);
      if (i < lo || i > hi || th <= 0 || !buckets.get(i)?.length) { t.cv.style.display = "none"; free.push(t); active.delete(i); t.sig = ""; }
      else if (force) {
        // a tile whose words are all as they were is drawn from the same textures: only the
        // tiles a change touched (under live typing, the one the letter went down in) are raised again
        const sig = sigOf(i, th);
        if (sig !== null && sig === t.sig) t.start = now - 3000;
        else { t.load(i, th, false); t.sig = sig; }
        t.draw(now);
      }
    }
    // new tiles, the window's first, one a frame where one can wait. A tile is a context (one a frame, page-wide:
    // spend), two programs that link off the thread (made ahead into `baking`, used once linked: gl-ready) and its
    // first textures. One in the window once the page's glyphs are hidden cannot wait: it is made now, and waits
    const todo = [];
    for (let i = lo; i <= hi; i++) if (i * TILE_H < docH && !active.has(i) && buckets.get(i)?.length) todo.push(i);
    const seen = (i) => i >= vlo && i <= vhi;
    todo.sort((a, b) => +seen(b) - +seen(a));
    let made = 0;
    left = false;
    for (const i of todo) {
      const must = seen(i) && !first;
      if (made && !must) { left = true; break; }
      const k = baking.findIndex((b) => b.linked());
      let t = free.pop() ?? (k >= 0 ? baking.splice(k, 1)[0] : must ? baking.shift() ?? createTile() : null);
      if (!t) {
        if (must) continue;
        if (!baking.length && spend()) { const n = createTile(); if (n) baking.push(n); }
        left = true; break;
      }
      const th = Math.min(TILE_H, docH - i * TILE_H);
      t.load(i, th, first); t.sig = sigOf(i, th); t.draw(now); active.set(i, t); made++;
    }
    perf.tiles = active.size;
    if (left && !tickF) tickF = requestAnimationFrame(() => (tickT = window.setTimeout(() => { tickF = tickT = 0; sync(); reveal(); }, 0)));
  }
  /** the first tiles all made: the layer shows, and the page's own glyphs go, in the same frame */
  function reveal() {
    if (!first || left || !alive) return;
    host.style.visibility = "";
    docEl.classList.add(cfg.readyClass); if (scoped) root.setAttribute("data-inked", "");
    first = false;
  }
  function loop(now) {
    raf = 0; if (!alive) return;
    if (now - lastDraw >= 30) {
      const { vlo, vhi } = wanted();
      for (const [i, tile] of active) if (i >= vlo && i <= vhi && !tile.lost) tile.draw(now);
      lastDraw = now;
    }
    if (cfg.animated && !reduced.matches && !document.hidden) raf = requestAnimationFrame(loop);
  }
  const offSurface = onSurface(() => {
    if (waiting && needed()) { clearTimeout(timer); timer = 0; build(); }
    const { vlo, vhi } = wanted(), now = performance.now();
    for (const [i, tile] of active) if (i >= vlo && i <= vhi && !tile.lost) tile.draw(now);
  });
  const kick = () => { if (cfg.animated && !raf && alive) raf = requestAnimationFrame(loop); };
  // the lights' front moved (or the page under it): every tile made is drawn again, if it is over them at all
  const offNight = onNight(() => {
    if (!alive) return;
    const y = nightIn(origin()), was = nightY;
    nightY = y;
    const lo = Math.min(y, was), hi = Math.max(y, was);
    if (hi < -60 || lo > docH + 60) return;
    const now = performance.now();
    for (const tile of active.values()) if (!tile.lost) tile.draw(now);
  });

  // a layer gated to the other surface draws nothing, so it makes no tiles (their contexts and programs are most of
  // a page's start) until the surface turns, or is turning, to its own
  const needed = () => !cfg.gate || (cfg.gate === "digital" ? !!(surface.from || surface.to) : !surface.from || !surface.to);
  let waiting = false;
  function build() {
    if (!needed()) { waiting = true; return; }
    waiting = false;
    const t1 = performance.now();
    docW = scoped ? root.clientWidth : docEl.clientWidth; docH = Math.max(scoped ? root.scrollHeight : docEl.scrollHeight, 1);
    dpr = Math.min(devicePixelRatio || 1, 2, maxTex / Math.max(docW, 1));
    host.style.width = docW + "px"; host.style.height = docH + "px";
    perf.rasterMs = 0;
    // what the colours are: the stock they were chosen for, where the layer is (a part of the page can be in the other theme's)
    const paper = getComputedStyle(root).getPropertyValue("--paper").trim(), hex = /^#([\da-f]{6})$/i.exec(paper);
    drawnDark = hex && parseInt(hex[1].slice(0, 2), 16) + parseInt(hex[1].slice(2, 4), 16) + parseInt(hex[1].slice(4), 16) < 384 ? 1 : 0;
    nightY = nightIn(origin());
    const tc = performance.now(); items = cfg.collect(root, host); perf.items = items.length; perf.collectMs = performance.now() - tc;
    bucketize();
    sync(true);
    reveal();
    perf.buildMs = performance.now() - t1; lastBuild = performance.now();
    for (const k of ["buildMs", "collectMs", "rasterMs"]) perf[k] = +perf[k].toFixed(2);
    kick();
  }
  // a change waits for the page to settle (a burst of edits is one rebuild); under live typing
  // (a short debounce) it is a steady beat instead, so the ink keeps up with the keys
  const wait = cfg.debounce ?? 120;
  let lastBuild = 0;
  function scheduleBuild() {
    if (wait >= 60) { clearTimeout(timer); timer = window.setTimeout(build, wait); return; }
    if (timer) return;
    timer = window.setTimeout(() => { timer = 0; build(); }, Math.max(0, wait - (performance.now() - lastBuild)));
  }

  const onScroll = () => { sync(); kick(); };
  addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", kick);
  const ro = new ResizeObserver(() => { if (roReady) scheduleBuild(); }); ro.observe(root);
  // a layer's own host, or a part of the page that animates its own DOM (data-gl-skip: the hero's
  // live typing), never asks for a rebuild
  // (a scoped layer is the one that covers such a part, so only its own host is ignored)
  const ignore = scoped ? "[data-gl-host]" : "[data-gl-host],[data-gl-skip]";
  const inHost = (n) => (n instanceof Element ? n : n.parentElement)?.closest(ignore);
  const mo = new MutationObserver((m) => { if (m.some((r) => !inHost(r.target))) scheduleBuild(); });
  // what is read at a rebuild (an opacity, a colour) can still be on its way: look again when it lands
  const landed = (e) => { if (!inHost(e.target) && /opacity|color/.test(e.propertyName)) scheduleBuild(); };
  root.addEventListener("transitionend", landed);
  mo.observe(root, { childList: true, subtree: true, characterData: true, ...(cfg.attributes ? { attributes: true, attributeFilter: cfg.attributes } : {}) });
  const scheme = matchMedia("(prefers-color-scheme: dark)"); scheme.addEventListener("change", scheduleBuild);
  const themeMo = new MutationObserver(scheduleBuild); themeMo.observe(docEl, { attributes: true, attributeFilter: ["data-theme", "data-theme-moving"] });   // and again once the fade has landed
  document.fonts?.addEventListener("loadingdone", scheduleBuild);
  document.fonts.ready.then(() => { if (!alive) return; build(); roReady = true; });

  return {
    rebuild: build,
    destroy() {
      alive = false; cancelAnimationFrame(raf); clearTimeout(timer); cancelAnimationFrame(tickF); clearTimeout(tickT); offSurface(); offNight();
      removeEventListener("scroll", onScroll); ro.disconnect(); mo.disconnect(); themeMo.disconnect();
      root.removeEventListener("transitionend", landed);
      scheme.removeEventListener("change", scheduleBuild); document.fonts?.removeEventListener("loadingdone", scheduleBuild);
      document.removeEventListener("visibilitychange", kick);
      host.querySelectorAll("canvas").forEach((c) => /** @type {WebGLRenderingContext} */ (c.getContext("webgl"))?.getExtension("WEBGL_lose_context")?.loseContext());
      host.remove(); docEl.classList.remove(cfg.readyClass); if (scoped) root.removeAttribute("data-inked");
    },
  };
}
