/**
 * Black ink spilled on the dark stock, as a live WebGL layer under a dark section's words.
 *
 * Two spills, layered: an old one, dried and browner, under a fresh one with a pale tide line
 * where the pigment wicked into the fibres, a wet film, a darker rim, and a glossy deep pool
 * the room's light slides across. One fragment pass; the paper's own hairs (paper-gl.js) show
 * through where the ink is thin. A 256px tile of noise is baked once. The canvas is sticky in
 * a box over the section, so its buffer is the size of the window rather than the page, while
 * the shader works in the section's own css px: the ink stays glued to the paper as it scrolls.
 * One context per section, made only when it is first on screen in the dark, and it draws
 * only on screen, in the dark, at ~30fps, at a capped pixel count. The lights fade is driven
 * here (uFade), as the page's theme change overrides CSS transitions.
 *
 * The gloss is the surface's own reflection and nothing else (carbon black swallows the rest):
 * Schlick Fresnel, F0 .021 for the wet pool (n~1.34) and .043 for the dried film (n~1.52),
 * under a Blinn lobe, narrow on the wet meniscus and broad on the dried stain. Where the light
 * sits follows the phone's tilt (gravity from devicemotion, or deviceorientation) measured from
 * how it was first held; with no sensor, or reduced motion, it stays where it was.
 */

const VS = `attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}`;

const TILE = 256; // px of the baked noise tile; only periodicity matters
const MAX_PX = 450000; // pixel budget of the buffer: a phone at 3x lands near 456x987
const MIN_K = 0.75; // but the edge is ~1.5 css px, so no buffer below 3/4 px per css px,
const HARD_PX = 1100000; // unless that is over this
const STEP = 30; // ms between idle frames

const BAKE = `precision highp float;
uniform float px;
float h21(vec2 p){p=fract(p*vec2(443.897,441.423));p+=dot(p,p.yx+19.19);return fract((p.x+p.y)*p.x);}
float hp(vec2 c,vec2 n){return h21(mod(c,n)+n*.013);}                       // periodic hash, per axis
float vnp(vec2 p,vec2 n){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hp(i,n),hp(i+vec2(1,0),n),f.x),mix(hp(i+vec2(0,1),n),hp(i+vec2(1,1),n),f.x),f.y);}
void main(){
  vec2 p=gl_FragCoord.xy/px;
  float r=vnp(p*4.,vec2(4.))*.5+vnp(p*8.+3.1,vec2(8.))*.3+vnp(p*16.+7.7,vec2(16.))*.2;     // pool bodies
  float g=vnp(p*5.+11.3,vec2(5.)), b=vnp(p*5.+17.9,vec2(5.));                                // warp
  float a=vnp(p*vec2(28.,3.)+1.3,vec2(28.,3.))*.4                                            // fibre hairs, three headings
         +vnp(p*vec2(3.,28.)+5.7,vec2(3.,28.))*.3
         +vnp(vec2(p.x+p.y,p.y)*vec2(28.,3.)+9.1,vec2(28.,3.))*.3;
  gl_FragColor=vec4(r,g,b,a);
}`;

const COMP = `#extension GL_OES_standard_derivatives : enable
precision highp float;
uniform sampler2D tN;
uniform vec2 uRes;               // buffer px
uniform vec2 uSize;              // canvas css px
uniform vec2 uSec;               // section css px
uniform float uOff;              // css px from the section's top to the canvas's (sticky)
uniform vec2 uCol;               // text column left, right in css px
uniform float uT;                // seconds, wrapped
uniform float uFade;             // 0 light .. 1 dark
uniform float uMotion;           // 1, or 0 under reduced motion
uniform vec2 uSeed;
uniform vec4 uP[4];              // pools: centre x, y (css px), radius (css px), phase
uniform vec3 cInk,cStain,cSheen;
uniform vec3 uL;                 // the light, unit, in screen px axes (x right, y down, z out of the glass)
float h21(vec2 p){p=fract(p*vec2(443.897,441.423));p+=dot(p,p.yx+19.19);return fract((p.x+p.y)*p.x);}
vec4 N(vec2 p){return texture2D(tN,p);}
float blob(vec4 s,vec2 q,float t){                                          // a pool that swells and shrinks a few percent
  float r=s.z*(1.+.025*sin(t*.09+s.w)); vec2 d=(q-s.xy)/r; float dd=dot(d,d); return 1./(1.+dd*dd);}
vec4 over(vec4 b,vec3 c,float a){return vec4(c*a+b.rgb*(1.-a),a+b.a*(1.-a));}
void main(){
  vec2 cp=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uRes*uSize;
  vec2 p=cp+vec2(0.,uOff);                                                  // section css px
  float S=clamp(uSec.x,320.,1100.), k=uRes.x/uSize.x;                       // k: buffer px per css px
  float t=uT*uMotion;
  vec2 w=(N(p/(1.6*S)+uSeed+vec2(t*.001,t*.0007)).gb-.5)*2.;                // the outline creeps
  vec2 q=p+w*S*.04;
  vec2 q2=p+w.yx*S*.03+vec2(.11,-.07)*S;                                    // the old spill sits off the fresh one
  float f=0.,f2=0.;
  for(int i=0;i<4;i++){
    f+=blob(uP[i],q,t);
    f2+=blob(uP[i]*vec4(1.,1.,1.35,1.)+vec4(.06*S,-.04*S,0.,2.),q2,t*.5);
  }
  float n=N(q/(.85*S)+uSeed*1.7).r, n2=N(q/(.3*S)+uSeed*2.3+vec2(0.,t*.003)).r, n3=N(q/(.07*S)+uSeed*5.7).r;
  float fib=N(p/(.4*S)+uSeed*.6).a, wick=fib-.5;                            // hairs: the margin feathers along them
  float ramp=smoothstep(0.,.12*S,p.y)*smoothstep(0.,.12*S,uSec.y-p.y);      // the pools close up short of the section's top and foot
  float col=smoothstep(-90.,10.,cp.x-uCol.x)*smoothstep(-90.,10.,uCol.y-cp.x);
  // the fresh spill: an edge ~1.5 css px wide whatever the buffer, a little wavy (n3)
  float F=(f*1.15+(n-.5)+(n2-.5)*.22)*ramp+wick*.1+(n3-.5)*.07;
  vec2 gd=vec2(dFdx(F),-dFdy(F)); float gm=max(length(gd),1e-4);
  float ew=gm*max(.75*k,.7), dist=(F-.56)/(gm*k);                            // dist: css px in from the edge, negative outside
  float body=smoothstep(.56-ew,.56+ew,F);
  float rim=body*(1.-smoothstep(1.,5.5,dist));                              // dried ink gathers dark just inside the edge
  float ring=(1.-body)*smoothstep(0.,1.2,-dist)*(1.-smoothstep(2.,7.,-dist)); // the tide line just outside it
  float stain=smoothstep(.34-ew*3.,.34+ew*3.,F+wick*.35);                   // the margin that bled into the fibres
  float thin=smoothstep(.6,.7,N(q/(.2*S)+uSeed*5.3).r);                     // thinner film: browner, less dense
  // the old spill: dried, browner, its own edge
  float G=(f2*.9+(N(q2/(.7*S)+uSeed*3.1).r-.5)*1.1)*ramp+wick*.12;
  vec2 go=vec2(dFdx(G),-dFdy(G)); float gmo=max(length(go),1e-4), ewo=gmo*max(.75*k,.7), disto=(G-.6)/(gmo*k);
  float oldBody=smoothstep(.6-ewo,.6+ewo,G);
  float oldRing=(1.-oldBody)*smoothstep(0.,1.2,-disto)*(1.-smoothstep(2.,6.,-disto));
  float oldStain=smoothstep(.34-ewo*3.,.34+ewo*3.,G+wick*.4);
  // gloss: the meniscus domes up to its edge, so near it the normal leans out; where that lean puts the
  // half vector H on the normal (Blinn, narrow) the room's light shows, as a thin line along the edge.
  // Schlick uses the light's incidence on the pool (uL.z): it climbs as the light goes to grazing, and
  // is compressed (^.4) and capped so the peak stays about +8 grey at the rest hold, +18 at the most.
  vec3 H=normalize(uL+vec3(0.,0.,1.));
  float lean=.9*(1.-smoothstep(0.,22.,dist));
  vec3 nrm=normalize(vec3(-gd/gm*lean,1.));
  float band=smoothstep(.5,2.,dist)*(1.-smoothstep(14.,26.,dist));
  float glint=smoothstep(.5,.7,N(q/(.5*S)+uSeed*6.1+vec2(t*.004,t*.0025)).g);
  float ci=clamp(uL.z,0.,1.), sc=pow(1.-ci,5.), sr=pow(1.-.59,5.);          // sr: the rest light's
  float lift=min(pow((.021+.979*sc)/(.021+.979*sr),.4),2.25);
  float spec=pow(max(dot(nrm,H),0.),120.)*band*glint*lift*(1.-.65*col);
  // the dried film: F0 .043, rough, so a broad weak lobe on its gentle edge slope
  vec3 nro=normalize(vec3(-go/gmo*.25*(1.-smoothstep(0.,40.,disto)),1.));
  float bando=smoothstep(.5,6.,disto)*(1.-smoothstep(10.,60.,disto))*oldBody;
  float liftO=min(pow((.043+.957*sc)/(.043+.957*sr),.4),2.25);
  float specO=pow(max(dot(nro,H),0.),20.)*bando*liftO*(1.-.65*col);
  vec4 o=vec4(0.);
  o=over(o,cStain*vec3(1.,.95,.88),oldStain*.1*(.7+.3*fib));
  o=over(o,cStain*vec3(1.,.95,.88),oldRing*.08);
  o=over(o,mix(cInk,cStain,.4),oldBody*.28);
  o=over(o,cStain,stain*(.13-.04*col)*(.75+.25*fib));
  o=over(o,cStain,ring*(.1-.03*col));
  o=over(o,mix(cInk,mix(cInk,cStain,.55),thin*.8),body*mix(.42,.26,thin));
  o=over(o,vec3(0.),rim*.22*(1.-.5*col));
  o.rgb+=cSheen*(spec*.2+specO*.03);
  o.rgb+=(h21(gl_FragCoord.xy)-.5)*(2./255.)*min(1.,o.a*4.);                // dither: near-black gradients band at 8 bits
  gl_FragColor=o*uFade;
}`;

/**
 * Where the ink lies, per section: {x,y} fractions of the section's width and height, r in
 * units of S (the section's width, 320..1100 css px), ph the pool's phase in its breathing.
 */
const SPILLS = {
  experience: { seed: [0.23, 0.61], pools: [
    { x: 0.08, y: 0.08, r: 0.50, ph: 0.0 }, // ran in from the top-left gutter, its tail under the title
    { x: 0.20, y: 0.30, r: 0.34, ph: 1.7 }, // and down the left edge
    { x: 0.88, y: 0.58, r: 0.40, ph: 3.1 }, // the right gutter, mid-ledger
    { x: 0.30, y: 0.90, r: 0.28, ph: 4.4 }, // a small one near the foot (the practice)
  ] },
  contact: { seed: [0.71, 0.17], pools: [
    { x: 0.80, y: 0.55, r: 0.58, ph: 0.9 }, // the puddle, lower right
    { x: 0.64, y: 0.88, r: 0.32, ph: 2.6 }, // its drip
    { x: 0.10, y: 0.22, r: 0.24, ph: 3.9 }, // a splash, top left
    { x: 0.42, y: 0.06, r: 0.16, ph: 5.2 },
  ] },
};

const FALLBACK = { "--spill-ink": [8, 8, 10], "--spill-stain": [42, 36, 28], "--spill-sheen": [107, 100, 90] };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** "#rrggbb" or "#rgb" to 0..1 channels; null if it isn't one */
function hex(s) {
  const m = /^#([\da-f]{3}|[\da-f]{6})$/i.exec((s || "").trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

/** the light as it is with the phone held still, and with nothing to tell us otherwise (unit, y down) */
const L0 = (() => { const v = [-0.5, -0.65, 0.6], m = Math.hypot(...v); return v.map((c) => c / m); })();

/** iOS gives out motion only after a prompt, answered from a tap; false leaves iOS on the static light */
export const ASK_IOS_TILT = true;

const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const needsAsk = () => typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function";
const TAU = 200, BASE_MS = 1000; // low-pass time constant of the gravity vector; how long the hold is watched to find "rest"

/**
 * One reading of gravity for the page, shared by the sections that want it: `u` is "up" in the
 * phone's axes (x right, y up the glass, z out of it), low-passed; `base` is its mean over the
 * first second after listening starts. light() turns the phone away from that by the same
 * rotation on the rest light, so a light fixed in the room swings across the glass as it tilts.
 */
const tilt = {
  users: new Set(), allowed: false, on: false, motion: false, u: null, last: 0, t0: 0, acc: [0, 0, 0], n: 0, base: null,
  feed(v, now) {
    const m = Math.hypot(v[0], v[1], v[2]);
    if (!(m > 1e-3)) return;
    const w = [v[0] / m, v[1] / m, v[2] / m];
    if (!this.u) { this.u = w; this.t0 = now; }
    else { const k = 1 - Math.exp(-clamp(now - this.last, 1, 500) / TAU), u = this.u; for (let i = 0; i < 3; i++) u[i] += (w[i] - u[i]) * k; const l = Math.hypot(u[0], u[1], u[2]) || 1; u[0] /= l; u[1] /= l; u[2] /= l; }
    this.last = now;
    if (!this.base) {
      for (let i = 0; i < 3; i++) this.acc[i] += this.u[i];
      this.n++;
      if (now - this.t0 >= BASE_MS) { const a = this.acc, l = Math.hypot(a[0], a[1], a[2]) || 1; this.base = [a[0] / l, a[1] / l, a[2] / l]; }
    }
  },
  onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    tilt.motion = true;
    const s = IOS ? -1 : 1; // iOS reads gravity the other way up from Android
    tilt.feed([a.x * s, a.y * s, a.z * s], performance.now());
  },
  onOrient(e) {
    if (tilt.motion || e.beta == null || e.gamma == null) return;
    const b = (e.beta * Math.PI) / 180, g = (e.gamma * Math.PI) / 180;
    tilt.feed([-Math.sin(g) * Math.cos(b), Math.sin(b), Math.cos(g) * Math.cos(b)], performance.now());
  },
  sync() {
    const want = this.allowed && this.users.size > 0;
    if (want === this.on) return;
    this.on = want;
    const f = want ? "addEventListener" : "removeEventListener";
    window[f]("devicemotion", this.onMotion); window[f]("deviceorientation", this.onOrient);
    if (want) { this.u = null; this.base = null; this.acc = [0, 0, 0]; this.n = 0; this.motion = false; }
  },
  /** the rest light turned by the phone's turn from rest, into `out` (screen axes) */
  light(out) {
    const ub = this.base, uc = this.u;
    if (!ub || !uc) return L0;
    const c = ub[0] * uc[0] + ub[1] * uc[1] + ub[2] * uc[2];
    let kx = ub[1] * uc[2] - ub[2] * uc[1], ky = ub[2] * uc[0] - ub[0] * uc[2], kz = ub[0] * uc[1] - ub[1] * uc[0];
    const s = Math.hypot(kx, ky, kz);
    if (s < 1e-6) return L0;
    kx /= s; ky /= s; kz /= s;
    const lx = L0[0], ly = -L0[1], lz = L0[2]; // to the phone's own axes (y up)
    const d = kx * lx + ky * ly + kz * lz, e = 1 - c;
    const rx = lx * c + (ky * lz - kz * ly) * s + kx * d * e, ry = ly * c + (kz * lx - kx * lz) * s + ky * d * e, rz = lz * c + (kx * ly - ky * lx) * s + kz * d * e;
    const m = Math.hypot(rx, ry, rz) || 1;
    out[0] = rx / m; out[1] = -ry / m; out[2] = rz / m;
    return out;
  },
};

/**
 * On iOS, ask for motion on the reader's first tap in the section (the prompt needs a gesture
 * and is the system's own; no button of ours). A "no", or any failure, leaves the static light.
 * Returns its undo.
 * @param {HTMLElement} el
 */
export function armTiltPermission(el) {
  if (!ASK_IOS_TILT || !needsAsk()) return () => {};
  let prior = ""; try { prior = sessionStorage.getItem("black-ink-tilt") || ""; } catch {}
  if (prior === "denied") return () => {};
  const off = () => { el.removeEventListener("touchend", ask); el.removeEventListener("click", ask); };
  function ask() {
    off();
    Promise.resolve(DeviceMotionEvent.requestPermission()).then((r) => {
      try { sessionStorage.setItem("black-ink-tilt", r === "granted" ? "granted" : "denied"); } catch {}
      if (r === "granted") { tilt.allowed = true; tilt.sync(); }
    }).catch(() => {});
  }
  el.addEventListener("touchend", ask); el.addEventListener("click", ask);
  return off;
}
tilt.allowed = typeof DeviceMotionEvent !== "undefined" && !needsAsk();
tilt.onMotion = tilt.onMotion.bind(tilt); tilt.onOrient = tilt.onOrient.bind(tilt);

/**
 * Put the spill in `wrap`, the empty box at the head of a dark section (BlackInk.tsx). Nothing
 * is made, and nothing drawn, without WebGL.
 * @param {HTMLElement} wrap
 * @param {{ id: string, kind: "experience" | "contact" }} cfg
 * @returns {{ rebuild: () => void, destroy: () => void }}
 */
export function startBlackInk(wrap, { id, kind }) {
  const none = { rebuild() {}, destroy() {} };
  const section = wrap.parentElement, recipe = SPILLS[kind];
  if (!section || !recipe) return none;
  const probe = document.createElement("canvas").getContext("webgl");
  if (!probe || !probe.getExtension("OES_standard_derivatives")) return none;
  probe.getExtension("WEBGL_lose_context")?.loseContext(); // only asked whether it can; the real context comes when it's wanted

  const docEl = document.documentElement;
  const cv = document.createElement("canvas");
  cv.setAttribute("data-gl-host", ""); cv.setAttribute("aria-hidden", "true");
  cv.style.cssText = "position:sticky;top:0;width:100%;height:min(100vh,100%);display:block;pointer-events:none;visibility:hidden";
  wrap.appendChild(cv);

  /** @type {WebGLRenderingContext | null} */
  let g = null;
  /** @type {any} */
  let progBake, progComp, tile = null;
  let dark = docEl.dataset.theme === "dark", onScreen = false, hidden = document.hidden, lost = false, failed = false, dead = false;
  const reducedMq = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = reducedMq.matches, tiltHeld = false;
  const light = [0, 0, 1];
  let fade = dark ? 1 : 0, fadeFrom = fade, fadeTarget = fade, fadeStart = 0, fadeMs = 900;
  let dirty = true, raf = 0, lastDraw = 0;
  const t0 = performance.now();
  let dpr = 1, bw = 0, bh = 0, cw = 0, ch = 0, secW = 0, secH = 0, poolsW = -1;
  const colX = [0, 0], pools = new Float32Array(16);
  let tokens = { ink: FALLBACK["--spill-ink"].map((c) => c / 255), stain: FALLBACK["--spill-stain"].map((c) => c / 255), sheen: FALLBACK["--spill-sheen"].map((c) => c / 255) };
  const perf = ((window.__gl ??= {})[id] = { draws: 0, cpuMs: 0, cpuTotal: 0, buffer: [0, 0], running: false, fade, error: "", bench: (n) => bench(n) });

  const want = () => onScreen && !hidden && !lost && !failed && (dark || fade > 0);

  function readTokens() {
    const cs = getComputedStyle(docEl);
    const tok = (k) => hex(cs.getPropertyValue(k)) || FALLBACK[k].map((c) => c / 255);
    tokens = { ink: tok("--spill-ink"), stain: tok("--spill-stain"), sheen: tok("--spill-sheen") };
    const ms = parseFloat(cs.getPropertyValue("--theme-time")) * 1000;
    fadeMs = ms > 0 ? ms : 900;
  }

  /** compile + link; the info log goes to perf.error, as nothing here should throw at a reader */
  function prog(fs) {
    const sh = (type, src) => {
      const o = g.createShader(type); g.shaderSource(o, src); g.compileShader(o);
      if (!g.getShaderParameter(o, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(o) || "shader");
      return o;
    };
    const pr = g.createProgram();
    g.attachShader(pr, sh(g.VERTEX_SHADER, VS)); g.attachShader(pr, sh(g.FRAGMENT_SHADER, fs));
    g.bindAttribLocation(pr, 0, "p"); g.linkProgram(pr);
    if (!g.getProgramParameter(pr, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(pr) || "link");
    const c = {};
    return { pr, u: (n) => (c[n] ??= g.getUniformLocation(pr, n)) };
  }

  /** programs, the quad, and the noise tile rendered once into a texture */
  function build() {
    progBake = prog(BAKE); progComp = prog(COMP);
    g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.disable(g.BLEND);
    tile = g.createTexture(); g.bindTexture(g.TEXTURE_2D, tile);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, TILE, TILE, 0, g.RGBA, g.UNSIGNED_BYTE, null);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.REPEAT);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.REPEAT);
    const fb = g.createFramebuffer();
    g.bindFramebuffer(g.FRAMEBUFFER, fb);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tile, 0);
    g.viewport(0, 0, TILE, TILE);
    g.useProgram(progBake.pr); g.uniform1f(progBake.u("px"), TILE);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.generateMipmap(g.TEXTURE_2D);
    g.deleteFramebuffer(fb);
    readTokens();
    fitBuffer(true);
  }

  /** the context, made the first time it's wanted */
  function open() {
    try {
      g = cv.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
      if (!g || !g.getExtension("OES_standard_derivatives")) throw new Error("no context");
      build();
    } catch (err) { failed = true; perf.error = String(err && err.message || err); }
  }

  function fitBuffer(force) {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    const area = Math.max(1, cw * ch);
    const k = clamp(Math.min(dpr, Math.max(MIN_K, Math.sqrt(MAX_PX / area)), Math.sqrt(HARD_PX / area)), 0.35, 1.5);
    const w = Math.max(1, Math.round(cw * k)), h = Math.max(1, Math.round(ch * k));
    if (force || w !== bw || h !== bh) { cv.width = bw = w; cv.height = bh = h; perf.buffer = [w, h]; }
  }

  /** sizes, the column, and (when the width changes) the pools in css px; the pools stay put as the height does */
  function measure() {
    if (dead) return;
    cw = cv.clientWidth; ch = cv.clientHeight;
    if (!cw || !ch) return;
    const sr = section.getBoundingClientRect(), cr = cv.getBoundingClientRect();
    secW = sr.width; secH = sr.height;
    const inner = section.querySelector(":scope > [data-gl-skip]");
    if (inner) { const r = inner.getBoundingClientRect(); colX[0] = r.left - cr.left; colX[1] = r.right - cr.left; }
    else { colX[0] = 0; colX[1] = cw; }
    if (poolsW !== secW) {
      poolsW = secW;
      const S = clamp(secW, 320, 1100);
      recipe.pools.forEach((p, i) => { pools.set([p.x * secW, p.y * secH, p.r * S * 0.75, p.ph], i * 4); });
    }
    if (g) fitBuffer(false);
    dirty = true; kick();
  }

  function draw(now) {
    const c0 = performance.now();
    const sr = section.getBoundingClientRect(), cr = cv.getBoundingClientRect();
    g.viewport(0, 0, bw, bh);
    g.useProgram(progComp.pr);
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, tile);
    const u = progComp.u;
    g.uniform1i(u("tN"), 0);
    g.uniform2f(u("uRes"), bw, bh); g.uniform2f(u("uSize"), cw, ch); g.uniform2f(u("uSec"), secW, secH);
    g.uniform1f(u("uOff"), cr.top - sr.top);
    g.uniform2f(u("uCol"), colX[0], colX[1]);
    g.uniform1f(u("uT"), reduced ? 7 : ((now - t0) / 1000) % 3600);
    g.uniform1f(u("uFade"), fade); g.uniform1f(u("uMotion"), reduced ? 0 : 1);
    g.uniform2f(u("uSeed"), recipe.seed[0], recipe.seed[1]);
    g.uniform4fv(u("uP"), pools);
    const L = tiltHeld ? tilt.light(light) : L0;
    g.uniform3f(u("uL"), L[0], L[1], L[2]);
    g.uniform3fv(u("cInk"), tokens.ink); g.uniform3fv(u("cStain"), tokens.stain); g.uniform3fv(u("cSheen"), tokens.sheen);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    const ms = performance.now() - c0;
    perf.fade = fade; perf.draws++; perf.cpuMs = ms; perf.cpuTotal += ms;
  }

  function frame(now) {
    raf = 0;
    syncTilt();
    if (!want()) { away(); perf.running = false; return; }
    if (!g) { open(); if (!g) { perf.running = false; return; } fadeStart = now; }
    if (!cw || !ch) measure();
    if (fade !== fadeTarget) {
      const k = Math.min(1, (now - fadeStart) / fadeMs);
      fade = fadeFrom + (fadeTarget - fadeFrom) * k * k * (3 - 2 * k);
      if (k >= 1) fade = fadeTarget;
      dirty = true;
    }
    if (cv.style.visibility !== "visible" && fade > 0) cv.style.visibility = "visible";
    if (bw && (dirty || (!reduced && now - lastDraw >= STEP))) { draw(now); lastDraw = now; dirty = false; }
    if (!dark && fade === 0) { g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT); cv.style.visibility = "hidden"; perf.running = false; return; }
    if (reduced && !dirty && fade === fadeTarget) { perf.running = false; return; }
    if (!raf) raf = requestAnimationFrame(frame);
    perf.running = true;
  }

  /** in the light and out of sight: the ink is gone, whatever fade it was in the middle of */
  function away() {
    if (dark || fade === 0 && cv.style.visibility === "hidden" || (onScreen && !hidden)) return;
    fade = fadeFrom = fadeTarget = 0;
    if (g && !lost) { g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT); }
    cv.style.visibility = "hidden";
  }

  /** hold the shared sensor while this is on screen and moving (it reads nothing otherwise) */
  function syncTilt() {
    const need = want() && !reduced;
    if (need === tiltHeld) return;
    tiltHeld = need;
    if (need) tilt.users.add(light); else tilt.users.delete(light);
    tilt.sync();
  }

  function kick() {
    syncTilt(); if (!raf && !dead && want()) { raf = requestAnimationFrame(frame); perf.running = true; } }

  function bench(n) {
    if (!g || !bw) return NaN;
    const a = performance.now();
    for (let i = 0; i < n; i++) { draw(performance.now()); g.finish(); }
    return (performance.now() - a) / n;
  }

  const theme = new MutationObserver(() => {
    const d = docEl.dataset.theme === "dark";
    if (d === dark) return;
    dark = d; readTokens();
    fadeFrom = fade; fadeTarget = d ? 1 : 0; fadeStart = performance.now(); dirty = true;
    if (reduced || !onScreen || hidden) {                             // nobody to watch it, or no motion: snap
      fade = fadeFrom = fadeTarget;
      if (!d && g && fade === 0) { g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT); cv.style.visibility = "hidden"; }
    }
    if (d && g && fade > 0) cv.style.visibility = "visible";
    kick();
  });
  theme.observe(docEl, { attributes: true, attributeFilter: ["data-theme"] });

  const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; dirty = true; away(); kick(); }, { rootMargin: "25% 0px" });
  io.observe(section);
  const ro = new ResizeObserver(measure);
  ro.observe(cv); ro.observe(section);
  const inner = section.querySelector(":scope > [data-gl-skip]");
  if (inner) ro.observe(inner);

  const onScroll = () => { dirty = true; kick(); };
  const onVis = () => { hidden = document.hidden; dirty = true; away(); kick(); };
  const onMotion = () => { reduced = reducedMq.matches; dirty = true; kick(); };
  const onLost = (e) => { e.preventDefault(); lost = true; perf.running = false; };
  const onRestored = () => { lost = false; try { build(); } catch (err) { failed = true; perf.error = String(err && err.message || err); } dirty = true; kick(); };
  const disarm = armTiltPermission(section);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", measure);
  document.addEventListener("visibilitychange", onVis);
  reducedMq.addEventListener("change", onMotion);
  cv.addEventListener("webglcontextlost", onLost);
  cv.addEventListener("webglcontextrestored", onRestored);
  measure();

  return {
    rebuild() { poolsW = -1; measure(); },
    destroy() {
      dead = true; cancelAnimationFrame(raf); raf = 0; disarm(); tiltHeld = false; tilt.users.delete(light); tilt.sync();
      io.disconnect(); ro.disconnect(); theme.disconnect();
      window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", measure);
      document.removeEventListener("visibilitychange", onVis); reducedMq.removeEventListener("change", onMotion);
      cv.removeEventListener("webglcontextlost", onLost); cv.removeEventListener("webglcontextrestored", onRestored);
      g?.getExtension("WEBGL_lose_context")?.loseContext();
      cv.remove();
      delete window.__gl?.[id];
    },
  };
}
