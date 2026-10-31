// @ts-check
/**
 * Ballpoint ink, rendered in WebGL over live DOM text.
 *
 * DOM text stays the source of truth (selectable, indexable, painted instantly).
 * After idle each word is rasterised with its computed font/colour into a mask,
 * blurred on the GPU, and composited by a fragment shader that models paper-fibre
 * edge roughness, a feathered halo, pooling, dry skips and granulation. Only then
 * are the DOM glyphs made transparent (not removed).
 *
 * Performance model
 *  - Page is cut into 1024px tiles; each is a canvas that scrolls natively with
 *    the document (no scroll-sync lag). A small pool of tiles (canvas + GL context
 *    + compiled programs + textures) is *reused* — scrolling or rebuilding only
 *    re-uploads a mask, it never creates contexts or compiles shaders.
 *  - Blurs are computed once per layout, not per frame. The wide blur and the
 *    strength map are low-res. Per frame only visible tiles run one composite pass
 *    (30fps, paused when hidden or under reduced motion); most pixels early-out.
 *  - Effect strength scales with font size so small type stays crisp.
 */

const TILE_H = 1024;
const PAD = 16; // css px of mask beyond each tile edge so blur/halo cross seams
const MARGIN = 512; // keep tiles within this distance of the viewport
const META_SCALE = 0.25; // strength map resolution relative to css px
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "SVG", "CANVAS", "CODE", "PRE"]);

const VS = `attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0,1);}`;

const BLUR = `precision mediump float;varying vec2 uv;uniform sampler2D tex;uniform vec2 stp;
void main(){vec4 s=vec4(0.);float w=0.;for(int i=-6;i<=6;i++){float x=float(i)*.5;float k=exp(-x*x*.5);s+=texture2D(tex,uv+stp*x)*k;w+=k;}gl_FragColor=s/w;}`;

const COMP = `precision highp float;varying vec2 uv;
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
const noop = { rebuild() {}, destroy() {} };

export function startInk() {
  const probe = document.createElement("canvas").getContext("webgl");
  if (!probe) return noop; // no WebGL → plain DOM text, untouched
  const maxTex = probe.getParameter(probe.MAX_TEXTURE_SIZE);
  probe.getExtension("WEBGL_lose_context")?.loseContext();

  const root = document.body;
  const docEl = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const perf = (window.__ink = { buildMs: 0, collectMs: 0, rasterMs: 0, tiles: 0, words: 0, frames: 0, contexts: 0 });

  /** @type {any[]} */ let words = [];
  /** @type {Map<number, any[]>} */ let buckets = new Map();
  /** @type {Map<number, any>} */ const active = new Map();
  /** @type {any[]} */ const free = [];
  let docW = 0, docH = 0, dpr = 1, alive = true, raf = 0, lastDraw = 0, first = true, timer = 0, roReady = false;
  const t0 = performance.now();

  const host = document.createElement("div");
  host.id = "ink-gl";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;overflow:hidden;z-index:2";
  document.body.appendChild(host);

  /* ---------- DOM → words ---------- */
  function collect() {
    root.querySelectorAll("[data-ink-off]").forEach((e) => e.removeAttribute("data-ink-off"));
    const styles = new Map(), ok = new Map(), op = new Map(), off = [];
    const style = (el) => { let s = styles.get(el); if (!s) styles.set(el, (s = getComputedStyle(el))); return s; };
    const eligible = (el) => {
      if (!el || el === docEl) return true;
      let v = ok.get(el); if (v !== undefined) return v;
      if (!eligible(el.parentElement)) { ok.set(el, false); return false; }
      const s = style(el);
      const own = !SKIP_TAGS.has(el.tagName.toUpperCase()) && !el.hasAttribute("data-ink-skip") &&
        s.display !== "none" && s.visibility === "visible" && s.position !== "fixed" && s.position !== "sticky" &&
        s.transform === "none" && s.opacity !== "0" && (el === root || (s.overflowX === "visible" && s.overflowY === "visible"));
      if (!own) off.push(el); // tag after reading, so we never dirty style mid-collect
      ok.set(el, own);
      op.set(el, ((el.parentElement && op.get(el.parentElement)) || 1) * parseFloat(s.opacity || "1"));
      return own;
    };
    const out = [];
    const range = document.createRange();
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const sx = scrollX, sy = scrollY;
    for (let n; (n = tw.nextNode()); ) {
      const data = /** @type {Text} */ (n).data;
      if (!/\S/.test(data)) continue;
      const el = n.parentElement;
      if (!el || host.contains(el) || !eligible(el)) continue;
      const s = style(el);
      const size = parseFloat(s.fontSize);
      const base = {
        font: `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`, color: s.color, alpha: op.get(el) ?? 1,
        ls: s.letterSpacing === "normal" ? "0px" : s.letterSpacing, size, S: strengthFor(size),
      };
      const up = s.textTransform === "uppercase", low = s.textTransform === "lowercase";
      for (const m of data.matchAll(/\S+/g)) {
        range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
        const rects = range.getClientRects();
        const push = (txt, r) => out.push({ ...base, text: up ? txt.toUpperCase() : low ? txt.toLowerCase() : txt, x: r.left + sx, y: r.top + sy, w: r.width, h: r.height });
        if (rects.length === 1) push(m[0], rects[0]);
        else for (let k = 0; k < m[0].length; k++) { range.setStart(n, m.index + k); range.setEnd(n, m.index + k + 1); const r = range.getClientRects()[0]; if (r) push(m[0][k], r); }
      }
    }
    off.forEach((e) => e.setAttribute("data-ink-off", ""));
    return out;
  }

  function bucketize() {
    buckets = new Map();
    for (const w of words) {
      const lo = Math.max(0, Math.floor((w.y - PAD) / TILE_H)), hi = Math.floor((w.y + w.h + PAD) / TILE_H);
      for (let i = lo; i <= hi; i++) { let b = buckets.get(i); if (!b) buckets.set(i, (b = [])); b.push(w); }
    }
  }

  /* ---------- tile (canvas + GL context + programs + textures), reusable ---------- */
  const ascents = new Map();
  function createTile() {
    const cv = document.createElement("canvas");
    const g = cv.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false });
    if (!g) return null;
    perf.contexts++;
    const mkS = (type, src) => { const o = g.createShader(type); g.shaderSource(o, src); g.compileShader(o); return o; };
    const prog = (fs) => { const pr = g.createProgram(); g.attachShader(pr, mkS(g.VERTEX_SHADER, VS)); g.attachShader(pr, mkS(g.FRAGMENT_SHADER, fs)); g.bindAttribLocation(pr, 0, "p"); g.linkProgram(pr); const c = {}; return { pr, u: (n) => (c[n] ??= g.getUniformLocation(pr, n)) }; };
    const blurP = prog(BLUR), compP = prog(COMP);
    g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    const tex = () => { const x = g.createTexture(); g.bindTexture(g.TEXTURE_2D, x);
      for (const k of [g.TEXTURE_MIN_FILTER, g.TEXTURE_MAG_FILTER]) g.texParameteri(g.TEXTURE_2D, k, g.LINEAR);
      for (const k of [g.TEXTURE_WRAP_S, g.TEXTURE_WRAP_T]) g.texParameteri(g.TEXTURE_2D, k, g.CLAMP_TO_EDGE); return x; };
    const target = () => ({ t: tex(), fb: g.createFramebuffer(), w: 0, h: 0 });
    const T = { mask: tex(), meta: tex(), tmp: target(), tmpH: target(), b1: target(), b2: target() };
    const maskC = document.createElement("canvas"), metaC = document.createElement("canvas");
    const mx = maskC.getContext("2d"), tx = metaC.getContext("2d");
    const alloc = (r, w, h) => { if (r.w === w && r.h === h) return; r.w = w; r.h = h;
      g.bindTexture(g.TEXTURE_2D, r.t); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
      g.bindFramebuffer(g.FRAMEBUFFER, r.fb); g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, r.t, 0); };
    const pass = (src, dst, dx, dy, sig) => {
      g.bindFramebuffer(g.FRAMEBUFFER, dst.fb); g.viewport(0, 0, dst.w, dst.h); g.disable(g.BLEND); g.useProgram(blurP.pr);
      g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, src); g.uniform1i(blurP.u("tex"), 0);
      g.uniform2f(blurP.u("stp"), (dx * sig) / dst.w, (dy * sig) / dst.h); g.drawArrays(g.TRIANGLE_STRIP, 0, 4); g.enable(g.BLEND);
    };

    const tile = {
      i: -1, th: 0, cv, lost: false, start: 0,
      /** (Re)load this tile for page tile index i: rasterise words, upload, blur. */
      load(i, th, settleFromZero) {
        tile.i = i; tile.th = th;
        const mwC = docW, mhC = th + 2 * PAD, ty = i * TILE_H - PAD;
        const cw = Math.ceil(docW * dpr), ch = Math.ceil(th * dpr);
        if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
        cv.style.cssText = `position:absolute;left:0;top:${i * TILE_H}px;width:${docW}px;height:${th}px;display:block`;
        const mw = Math.ceil(mwC * dpr), mh = Math.ceil(mhC * dpr);
        if (maskC.width !== mw || maskC.height !== mh) { maskC.width = mw; maskC.height = mh; }
        const qw = Math.max(1, Math.ceil(mwC * META_SCALE)), qh = Math.max(1, Math.ceil(mhC * META_SCALE));
        if (metaC.width !== qw || metaC.height !== qh) { metaC.width = qw; metaC.height = qh; }

        const tr = performance.now();
        mx.setTransform(1, 0, 0, 1, 0, 0); mx.clearRect(0, 0, mw, mh);
        mx.setTransform(dpr, 0, 0, dpr, 0, -ty * dpr); mx.textBaseline = "alphabetic";
        tx.setTransform(1, 0, 0, 1, 0, 0); tx.fillStyle = "#000"; tx.fillRect(0, 0, qw, qh);
        tx.setTransform(META_SCALE, 0, 0, META_SCALE, 0, -ty * META_SCALE);
        let font = "", ls = "", color = "", alpha = -1, S = -1;
        for (const w of buckets.get(i) || []) {
          if (w.font !== font) { mx.font = font = w.font; }
          if ("letterSpacing" in mx && w.ls !== ls) { mx.letterSpacing = ls = w.ls; }
          if (w.color !== color) { mx.fillStyle = color = w.color; }
          if (w.alpha !== alpha) { mx.globalAlpha = alpha = w.alpha; }
          let a = ascents.get(w.font);
          if (a === undefined) { a = mx.measureText("Hg").fontBoundingBoxAscent ?? null; ascents.set(w.font, a); }
          mx.fillText(w.text, w.x, w.y + (a ?? w.h * 0.8), w.w + 0.5);
          if (w.S !== S) { tx.fillStyle = `rgb(${Math.round(w.S * 255)},0,0)`; S = w.S; }
          tx.fillRect(w.x - 6, w.y - 6, w.w + 12, w.h + 12);
        }
        perf.rasterMs += performance.now() - tr;

        g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true); g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.bindTexture(g.TEXTURE_2D, T.mask); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, maskC);
        g.bindTexture(g.TEXTURE_2D, T.meta); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, metaC);
        const hw = Math.max(1, mw >> 1), hh = Math.max(1, mh >> 1);
        alloc(T.tmp, mw, mh); alloc(T.b1, mw, mh); alloc(T.tmpH, hw, hh); alloc(T.b2, hw, hh);
        pass(T.mask, T.tmp, 1, 0, 0.45 * dpr); pass(T.tmp.t, T.b1, 0, 1, 0.45 * dpr);      // tight blur: stroke body
        pass(T.mask, T.tmpH, 1, 0, 2.3 * dpr * 0.5); pass(T.tmpH.t, T.b2, 0, 1, 2.3 * dpr * 0.5); // wide blur at half-res: halo
        g.bindFramebuffer(g.FRAMEBUFFER, null); g.viewport(0, 0, cw, ch);
        tile.start = performance.now() - (settleFromZero ? 0 : 3000);
      },
      draw(t, now) {
        const { th: h } = tile;
        g.useProgram(compP.pr);
        [T.mask, T.b1.t, T.b2.t, T.meta].forEach((x, k) => { g.activeTexture(g.TEXTURE0 + k); g.bindTexture(g.TEXTURE_2D, x); });
        ["mask", "b1", "b2", "meta"].forEach((n, k) => g.uniform1i(compP.u(n), k));
        g.uniform2f(compP.u("res"), cv.width, cv.height); g.uniform1f(compP.u("dpr"), dpr);
        g.uniform1f(compP.u("t"), t); g.uniform1f(compP.u("y0"), tile.i * TILE_H); g.uniform1f(compP.u("th"), h); g.uniform1f(compP.u("pad"), PAD);
        g.uniform1f(compP.u("settle"), reduced.matches ? 1 : 1 - Math.pow(1 - Math.min(1, (now - tile.start) / 3000), 3));
        g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
      },
    };
    cv.addEventListener("webglcontextlost", (e) => { e.preventDefault(); tile.lost = true; });
    cv.addEventListener("webglcontextrestored", () => { tile.lost = false; scheduleBuild(); });
    host.appendChild(cv);
    return tile;
  }

  /* ---------- tile lifecycle ---------- */
  function wanted() {
    const lo = Math.max(0, Math.floor((scrollY - MARGIN) / TILE_H)), hi = Math.floor((scrollY + innerHeight + MARGIN) / TILE_H);
    const vlo = Math.max(0, Math.floor(scrollY / TILE_H)), vhi = Math.floor((scrollY + innerHeight) / TILE_H);
    return { lo, hi, vlo, vhi };
  }
  function sync(force = false) {
    const { lo, hi } = wanted();
    for (const [i, t] of active) {
      const th = Math.min(TILE_H, docH - i * TILE_H);
      if (i < lo || i > hi || th <= 0) { t.cv.style.display = "none"; free.push(t); active.delete(i); }
      else if (force) t.load(i, th, false);
    }
    for (let i = lo; i <= hi; i++) {
      const th = Math.min(TILE_H, docH - i * TILE_H);
      if (th <= 0 || active.has(i)) continue;
      const t = free.pop() || createTile();
      if (!t) continue;
      t.load(i, th, first); active.set(i, t);
    }
    perf.tiles = active.size;
  }
  function render(now) {
    const { vlo, vhi } = wanted(); const t = (now - t0) / 1000;
    for (const [i, tile] of active) if (i >= vlo && i <= vhi && !tile.lost) tile.draw(t, now);
    perf.frames++;
  }
  function loop(now) {
    raf = 0; if (!alive) return;
    if (now - lastDraw >= 30) { render(now); lastDraw = now; }
    if (!reduced.matches && !document.hidden) raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (!raf && alive) raf = requestAnimationFrame(loop); };

  function build() {
    const t1 = performance.now();
    docW = docEl.clientWidth; docH = Math.max(docEl.scrollHeight, 1);
    dpr = Math.min(devicePixelRatio || 1, 2, maxTex / Math.max(docW, 1));
    host.style.width = docW + "px"; host.style.height = docH + "px";
    perf.rasterMs = 0;
    const tc = performance.now(); words = collect(); perf.words = words.length; perf.collectMs = performance.now() - tc;
    bucketize();
    sync(true); render(performance.now());
    if (first) { docEl.classList.add("ink-gl"); first = false; }
    perf.buildMs = performance.now() - t1;
    for (const k of ["buildMs", "collectMs", "rasterMs"]) perf[k] = +perf[k].toFixed(2);
    kick();
  }
  function scheduleBuild() { clearTimeout(timer); timer = window.setTimeout(build, 120); }

  /* ---------- wiring ---------- */
  const onScroll = () => { sync(); if (reduced.matches || document.hidden) render(performance.now()); kick(); };
  addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", kick);
  const ro = new ResizeObserver(() => { if (roReady) scheduleBuild(); }); ro.observe(root);
  const mo = new MutationObserver((m) => { if (m.some((r) => !host.contains(r.target))) scheduleBuild(); });
  mo.observe(root, { childList: true, subtree: true, characterData: true });
  const scheme = matchMedia("(prefers-color-scheme: dark)"); scheme.addEventListener("change", scheduleBuild);
  const themeMo = new MutationObserver(scheduleBuild); themeMo.observe(docEl, { attributes: true, attributeFilter: ["data-theme"] });
  const onFonts = () => scheduleBuild();
  document.fonts?.addEventListener("loadingdone", onFonts);
  document.fonts.ready.then(() => { if (!alive) return; build(); roReady = true; });

  return {
    rebuild: build,
    destroy() {
      alive = false; cancelAnimationFrame(raf); clearTimeout(timer);
      removeEventListener("scroll", onScroll); ro.disconnect(); mo.disconnect(); themeMo.disconnect();
      scheme.removeEventListener("change", scheduleBuild); document.fonts?.removeEventListener("loadingdone", onFonts);
      document.removeEventListener("visibilitychange", kick);
      host.querySelectorAll("canvas").forEach((c) => /** @type {WebGLRenderingContext} */ (c.getContext("webgl"))?.getExtension("WEBGL_lose_context")?.loseContext());
      host.remove(); docEl.classList.remove("ink-gl"); root.querySelectorAll("[data-ink-off]").forEach((e) => e.removeAttribute("data-ink-off"));
    },
  };
}
