/**
 * Paper, as a live WebGL layer.
 *
 * Two seamless tiles (analog fibre/grain/wash, and a "digital" pixel screen with grid,
 * LCD subpixel tint and ordered-dither wash) are rendered once into textures by the tile
 * shader. A fixed full-viewport canvas then composites them every time the page scrolls or
 * the surface mode moves: a few texture reads per pixel, no per-frame fibre work. The mode
 * switch is the shared print-head sweep (surface-mode.js): above the front the page is
 * already in the new mode, the boundary dissolves through an ordered dither, and a scan bar
 * rides the front. Everything, including the wash and the bar, is drawn in the shader.
 */
import { surface, onSurface } from "./surface-mode.js";
import { linked } from "./gl-ready.js";

const SIZE = 400; // css px per tile; only periodicity matters

const FRAG = `precision highp float;
uniform float px,K,dark,dig;
float h21(vec2 p){p=fract(p*vec2(443.897,441.423));p+=dot(p,p.yx+19.19);return fract((p.x+p.y)*p.x);}
float h(vec2 c,float n){return h21(mod(c,n)+n*.01);}                      // periodic hash
float vnp(vec2 p,float n){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);     // periodic value noise, n cells per tile
  return mix(mix(h(i,n),h(i+vec2(1,0),n),f.x),mix(h(i+vec2(0,1),n),h(i+vec2(1,1),n),f.x),f.y);}
float b2f(vec2 q){return mod(2.*q.x+3.*q.y,4.);}
float bayer8(vec2 p){p=floor(p);return (b2f(mod(p,2.))*16.+b2f(mod(floor(p/2.),2.))*4.+b2f(mod(floor(p/4.),2.))+.5)/64.;}
float seg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float t=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*t);}
void main(){
  vec2 p=(gl_FragCoord.xy-1.)/px;             // 0..1 across the tile; 1px periodic border so sampling wraps seamlessly
  const float G=20.;                          // fibre grid: 20x20 cells, ~20 css px each
  vec2 g=p*G, cell=floor(g);
  float tone=0.;                              // <0 shadow, >0 light
  // fibres: short curved hairs, each a random segment; look at the 3x3 neighbourhood of cells
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    vec2 c=cell+vec2(float(i),float(j));
    for(int k=0;k<2;k++){
      float s=float(k)*17.3;
      vec2 hc=vec2(h(c+s,G),h(c+s+7.1,G));
      float ang=h(c+s+3.7,G)*3.14159, len=.25+.75*h(c+s+9.9,G), sgn=h(c+s+13.1,G);
      float bend=(h(c+s+21.7,G)-.5)*.8;
      vec2 ctr=c+hc, d=vec2(cos(ang),sin(ang))*len*.9, nn=vec2(-d.y,d.x)*bend*.5;
      // two half-segments with a slight bend; wrap the position so the tile is seamless
      vec2 q=g-ctr; q-=G*floor(q/G+.5);
      float dist=min(seg(q,-d,nn),seg(q,nn,d))*(px/G);               // distance in device px
      float w=.45+.35*h(c+s+31.,G);
      float a=smoothstep(w+.6,w*.4,dist)*(.35+.65*h(c+s+41.,G));
      tone+=a*(sgn>.42?-1.:1.)*(sgn>.42?.05:.07);                      // mostly faint dark hairs, a few light ones
    }
  }
  // tooth: fine grain at device-pixel scale
  float grain=h21(gl_FragCoord.xy*.731+3.1)-.5;
  tone+=grain*.055;
  // wash: broad periodic mottling (cloudiness of the sheet)
  float wash=vnp(p*3.,3.)*.55+vnp(p*7.,7.)*.3+vnp(p*13.,13.)*.15;
  tone+=(wash-.5)*.07;
  // rare inclusions: tiny dark flecks
  vec2 fc=floor(p*(px/6.));float fh=h21(fc*1.7+5.);
  tone-=smoothstep(.992,1.,fh)*smoothstep(.5,0.,length(fract(p*(px/6.))-.5))*.16;

  float amt=mix(1.,.8,dark);
  float a=clamp(abs(tone)*amt,0.,1.);
  vec3 shade=mix(vec3(.36,.28,.18),vec3(0.),dark);                     // warm umber on light paper, black on dark
  vec3 lite =mix(vec3(1.),vec3(.88,.82,.72),dark);                     // white on light paper, warm grey on dark
  if(dig>.5){
    // a faintly pixelated screen: 4px cells, a 1-device-px grid, LCD subpixel tint,
    // and the sheet's wash re-quantised through an ordered dither
    const float N=100.;
    vec2 g=p*N,ci=floor(g),f=fract(g);
    float cd=px/N;
    float lvl=(wash-.5)*1.7+.5;
    float tn=(step(bayer8(ci),lvl)-.5)*.05+(h21(ci+7.)-.5)*.016;
    float grid=max(step(f.x,1./cd),step(f.y,1./cd))*.03;
    float sub=floor(f.x*3.);
    vec3 tint=vec3(sub<.5?1.:0.,(sub>.5&&sub<1.5)?1.:0.,sub>1.5?1.:0.)-.3333;
    float a1=abs(tn)*amt;
    vec3 c1=(tn<0.?shade:lite)*a1+shade*grid;
    float aa=clamp(a1+grid+.012,0.,1.);
    gl_FragColor=vec4(clamp(c1+tint*.012,0.,aa),aa);
    return;
  }
  vec3 col=tone<0.?shade:lite;
  gl_FragColor=vec4(col*a,a);
}`;

const VS = `attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}`;

const COMP = `precision highp float;
uniform sampler2D tA,tD;uniform vec2 res,doc;uniform float dpr,uSize,uPx,uScroll,uFrom,uTo,uFront;
uniform vec4 wA,wB;uniform vec3 fg;
float b2f(vec2 q){return mod(2.*q.x+3.*q.y,4.);}
float bayer8(vec2 p){p=floor(p);return (b2f(mod(p,2.))*16.+b2f(mod(floor(p/2.),2.))*4.+b2f(mod(floor(p/4.),2.))+.5)/64.;}
float bh(vec2 q){q=fract(q*vec2(.1031,.1030));q+=dot(q,q.yx+33.33);return fract((q.x+q.y)*q.x);}
void main(){
  vec2 fc=gl_FragCoord.xy, cp=vec2(fc.x,res.y-fc.y)/dpr, p=vec2(cp.x,cp.y+uScroll);
  float s=1.;
  if(uFront<1e8) s=uFront;
  float dg=mix(uFrom,uTo,step(bayer8(fc*.5),s));
  vec2 tu=(fract(p/uSize)*uPx+1.)/(uPx+2.);
  vec4 o;
  if(dg>.5) o=texture2D(tD,tu);
  else{
    o=texture2D(tA,tu);
    vec2 dp=p/doc;
    float fa=clamp(1.-length((dp-vec2(.15,0.))/vec2(.9,.7))/.7,0.,1.);
    float fb=clamp(1.-length((dp-vec2(1.,1.))/vec2(.8,.6))/.7,0.,1.);
    vec4 w=vec4(wA.rgb*wA.a*fa,wA.a*fa); w+=vec4(wB.rgb*wB.a*fb,wB.a*fb)*(1.-w.a);
    o=o+w*(1.-o.a);
  }
  gl_FragColor=o;
}`;

const num = (str) => (str.match(/[\d.]+/g) || []).map(Number);

export function startPaper() {
  const docEl = document.documentElement;
  const cv = document.createElement("canvas");
  cv.id = "paper-gl";
  cv.setAttribute("data-gl-host", ""); cv.setAttribute("aria-hidden", "true");
  cv.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;display:block";
  const g = cv.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false });
  if (!g) return { rebuild() {}, destroy() {} };
  document.body.prepend(cv);

  const sh = (type, src) => { const o = g.createShader(type); g.shaderSource(o, src); g.compileShader(o); return o; };
  const prog = (fs) => { const pr = g.createProgram(); g.attachShader(pr, sh(g.VERTEX_SHADER, VS)); g.attachShader(pr, sh(g.FRAGMENT_SHADER, fs)); g.bindAttribLocation(pr, 0, "p"); g.linkProgram(pr);
    const c = {}; return { pr, u: (n) => (c[n] ??= g.getUniformLocation(pr, n)) }; };
  const tileP = prog(FRAG), compP = prog(COMP);
  g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
  g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
  g.disable(g.BLEND);

  const mkTex = (nearest) => { const t = g.createTexture(); g.bindTexture(g.TEXTURE_2D, t);
    for (const k of [g.TEXTURE_MIN_FILTER, g.TEXTURE_MAG_FILTER]) g.texParameteri(g.TEXTURE_2D, k, nearest ? g.NEAREST : g.LINEAR);
    for (const k of [g.TEXTURE_WRAP_S, g.TEXTURE_WRAP_T]) g.texParameteri(g.TEXTURE_2D, k, g.CLAMP_TO_EDGE); return t; };
  const tex = [mkTex(false), mkTex(true)], fb = g.createFramebuffer();

  let alive = true, raf = 0, dpr = 1, px = 0, docW = 1, docH = 1, ready = false, compiled = false, wait = 0;
  const col = { wA: [0, 0, 0, 0], wB: [0, 0, 0, 0], fg: [0, 0, 0] };

  function readColours() {
    const cs = getComputedStyle(docEl), bs = getComputedStyle(document.body);
    const a = num(cs.getPropertyValue("--paper-wash-a")), b = num(cs.getPropertyValue("--paper-wash-b")), f = num(bs.color);
    col.wA = a.length >= 3 ? [a[0] / 255, a[1] / 255, a[2] / 255, a[3] ?? 1] : [0, 0, 0, 0];
    col.wB = b.length >= 3 ? [b[0] / 255, b[1] / 255, b[2] / 255, b[3] ?? 1] : [0, 0, 0, 0];
    col.fg = f.length >= 3 ? [f[0] / 255, f[1] / 255, f[2] / 255] : [0, 0, 0];
    const bg = num(bs.backgroundColor);
    return bg.length >= 3 ? (bg[0] + bg[1] + bg[2]) / 3 < 128 : false;
  }

  /** render both tiles into textures (with a 1px periodic border); nothing until the programs have linked */
  function bake() {
    if (!compiled) return;
    const dark = readColours();
    dpr = Math.min(devicePixelRatio || 1, 2);
    px = Math.round(SIZE * dpr);
    g.bindFramebuffer(g.FRAMEBUFFER, fb);
    g.useProgram(tileP.pr);
    g.uniform1f(tileP.u("px"), px); g.uniform1f(tileP.u("K"), 1); g.uniform1f(tileP.u("dark"), dark ? 1 : 0);
    g.viewport(0, 0, px + 2, px + 2);
    for (let k = 0; k < 2; k++) {
      g.bindTexture(g.TEXTURE_2D, tex[k]);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, px + 2, px + 2, 0, g.RGBA, g.UNSIGNED_BYTE, null);
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex[k], 0);
      g.uniform1f(tileP.u("dig"), k);
      g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    }
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    ready = true; size(); request();
  }

  function size() {
    const w = Math.max(1, Math.round(docEl.clientWidth * dpr)), h = Math.max(1, Math.round(innerHeight * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    docW = Math.max(docEl.clientWidth, 1); docH = Math.max(docEl.scrollHeight, 1);
  }

  function draw() {
    raf = 0;
    if (!alive || !ready || g.isContextLost()) return;
    g.viewport(0, 0, cv.width, cv.height);
    g.useProgram(compP.pr);
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, tex[0]); g.uniform1i(compP.u("tA"), 0);
    g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, tex[1]); g.uniform1i(compP.u("tD"), 1);
    g.uniform2f(compP.u("res"), cv.width, cv.height); g.uniform2f(compP.u("doc"), docW, docH);
    g.uniform1f(compP.u("dpr"), dpr); g.uniform1f(compP.u("uSize"), SIZE); g.uniform1f(compP.u("uPx"), px);
    g.uniform1f(compP.u("uScroll"), Math.round(scrollY * dpr) / dpr);   // device-pixel aligned so the grid never shimmers
    g.uniform1f(compP.u("uFrom"), surface.from); g.uniform1f(compP.u("uTo"), surface.to); g.uniform1f(compP.u("uFront"), surface.front);
    g.uniform4fv(compP.u("wA"), col.wA); g.uniform4fv(compP.u("wB"), col.wB); g.uniform3fv(compP.u("fg"), col.fg);
    g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  }
  function request() { if (!raf && alive) raf = requestAnimationFrame(draw); }

  const onResize = () => { size(); request(); };
  const off = onSurface(request);
  addEventListener("scroll", request, { passive: true });
  addEventListener("resize", onResize);
  const ro = new ResizeObserver(onResize); ro.observe(document.body);
  const scheme = matchMedia("(prefers-color-scheme: dark)"); scheme.addEventListener("change", bake);
  const mo = new MutationObserver(bake); mo.observe(docEl, { attributes: true, attributeFilter: ["data-theme"] });
  // the paper's colour is read from the body: when the lights change it is still on its way, so
  // look again when it lands
  const landed = (e) => { if (e.target === document.body && e.propertyName === "background-color") bake(); };
  document.body.addEventListener("transitionend", landed);
  cv.addEventListener("webglcontextlost", (e) => e.preventDefault());
  cv.addEventListener("webglcontextrestored", () => location.reload());

  // the paper comes in the frame its programs are linked (gl-ready): until then the page's own stock shows
  const start = () => {
    wait = 0;
    if (!alive) return;
    if (!linked(g, tileP.pr, compP.pr)) { wait = requestAnimationFrame(start); return; }
    compiled = true; bake();
    docEl.classList.add("paper-gl");
  };
  start();

  return {
    rebuild: bake,
    destroy() {
      alive = false; cancelAnimationFrame(raf); cancelAnimationFrame(wait); off(); ro.disconnect(); mo.disconnect(); document.body.removeEventListener("transitionend", landed);
      scheme.removeEventListener("change", bake); removeEventListener("scroll", request); removeEventListener("resize", onResize);
      g.getExtension("WEBGL_lose_context")?.loseContext(); cv.remove(); docEl.classList.remove("paper-gl");
    },
  };
}
