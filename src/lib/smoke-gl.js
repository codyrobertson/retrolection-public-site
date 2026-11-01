/**
 * The smoke off the cigarette (SmokeFooter), as a live WebGL layer.
 *
 * One small canvas over the vignette, a plume rising from the ember to the scrim: curling,
 * widening and thinning as it goes, its lean wandering over tens of seconds. It is drawn in
 * graphite the way the rest of the page is: grain, not fog. The
 * shader is stateless, a function of time alone, so pausing and resuming cost nothing and
 * nothing accumulates. 30 fps, at a fraction of the canvas's css size.
 *
 * The footer's own ink and vermilion are read from the canvas's custom properties (the footer
 * is always on the light stock: graphite, even where the page above has gone dark).
 */

const VS = `attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}`;

const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 res,ember;
uniform float t,rise,dark,breath,grow;
uniform vec3 ink,glow;
float h21(vec2 p){p=fract(p*vec2(443.897,441.423));p+=dot(p,p.yx+19.19);return fract((p.x+p.y)*p.x);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
// One strand of smoke, x across and h up (0 at the ember, 1 at the scrim), in height units. It
// leaves the ember as a straight thread, begins to swing, folds over on itself into curls, and
// opens out and breaks apart toward the top: the laminar column going turbulent.
float strand(float x,float h,float ph,float t,float lean,float wid){
  float g=smoothstep(.1,.55,h);                                          // how far it has left the thread
  float q=1.+.24*sin(ph*2.7);                                            // each strand curls at its own pace
  float c=lean*h*h+(.03*sin(h*6.5*q-t*1.25+ph)+.028*sin(h*3.1*q-t*.65+ph*1.9))*h;
  float xx=x-c;
  xx+=.03*g*sin(h*14.*q-t*2.1+ph*3.);                                      // the small kinks
  xx+=.045*g*h*sin(h*9.*q+xx*34.-t*1.55+ph*2.);                             // folds: x warps by itself
  float w=(.0036+.045*h*h)*wid;                                          // 1px at the ember, opening
  float core=exp(-xx*xx/(w*w));
  float nb=fbm(vec2(h*5.2-t*.55,ph*.7));                                 // along the strand: it thins and breaks
  core*=mix(1.,smoothstep(.22,.62,nb),smoothstep(.4,.95,h));
  return core;
}
void main(){
  vec2 uv=gl_FragCoord.xy/res;
  vec2 p=(uv-ember)*vec2(res.x/res.y,1.);              // height units, the ember the origin
  float h=p.y/rise;
  float r=length(p*vec2(1.,1.4))/grow;
  float em=.55+.45*breath;
  float halo=(exp(-r*r*2600.)*1.+exp(-r*r*280.)*.26)*em;
  float a=0.;
  if(h>-.03&&h<1.02){
    float lean=(fbm(vec2(t*.04,3.1))-.5)*.34;                            // the whole column's drift, over tens of seconds
    float d=strand(p.x,h,0.,t,lean,1.);
    d=max(d,.85*strand(p.x-.02*h,h,2.9,t*1.05,lean,.8)*smoothstep(.1,.32,h));
    d=max(d,.7*strand(p.x+.03*h,h,5.3,t*.95,lean,1.1)*smoothstep(.26,.5,h));
    // the billows: a soft broad body that gathers above the curls
    float bx=p.x-lean*h*h*.9-.03*sin(h*3.3-t*.7);
    float bw=.02+.14*h;
    float billow=exp(-bx*bx/(bw*bw)*1.2)*fbm(vec2(bx*7.,h*3.2-t*.5))*smoothstep(.28,.6,h)*.8;
    d=max(d,billow);
    d*=smoothstep(0.,.02,h)*(1.-smoothstep(.7,1.,h));
    float tooth=h21(floor(gl_FragCoord.xy)+.7);                          // paper tooth: modulates the ribbon's density
    a=d*(.7+.3*tooth)*mix(.64,.58,dark);
    a*=smoothstep(.015,.07,a+(tooth-.5)*.05);                            // and breaks only the thin edges
  }
  gl_FragColor=vec4(ink*a+glow*halo,clamp(a+halo,0.,1.));
}`;

const rgb = (s) => {
  s = s.trim();
  if (s[0] === "#") { const h = s.length === 4 ? s.replace(/[^#]/g, "$&$&").slice(1) : s.slice(1); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); }
  const m = s.match(/[\d.]+/g) || [0, 0, 0];
  return [0, 1, 2].map((i) => +m[i] / 255);
};
const FRAME_MS = 30;

/**
 * Starts the smoke on `canvas`. `ember()` gives the ember's place in the canvas, 0..1 across
 * and up, and how big the drawing is (1 at full size: the glow keeps to the cigarette). Returns
 * null where there is no WebGL. `onFrame` fires when the first frame is drawn (and false if the
 * context is lost).
 */
export function startSmoke(canvas, { ember, onFrame }) {
  const g = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
  if (!g) return null;
  const sh = (type, src) => { const o = g.createShader(type); g.shaderSource(o, src); g.compileShader(o); return o; };
  const pr = g.createProgram();
  g.attachShader(pr, sh(g.VERTEX_SHADER, VS)); g.attachShader(pr, sh(g.FRAGMENT_SHADER, FS));
  g.bindAttribLocation(pr, 0, "p"); g.linkProgram(pr);
  if (!g.getProgramParameter(pr, g.LINK_STATUS)) return null;
  g.useProgram(pr);
  const loc = {};
  const u = (n) => (loc[n] ??= g.getUniformLocation(pr, n));
  g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
  g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
  g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);

  const cs = getComputedStyle(canvas), paper = rgb(cs.getPropertyValue("--paper"));
  const tint = { ink: rgb(cs.getPropertyValue("--ink")), glow: rgb(cs.getPropertyValue("--vermilion")), dark: (paper[0] + paper[1] + paper[2]) / 3 < 0.5 ? 1 : 0 };

  let raf = 0, running = false, last = -1e9, t0 = performance.now(), paused = 0, lit = false, alive = true;

  function resize() {
    const k = devicePixelRatio >= 2 ? 1.5 : 1;                             // the threads are 1 css px: drawn at a pixel or more
    const w = Math.max(96, Math.floor(canvas.clientWidth * k)), h = Math.max(72, Math.floor(canvas.clientHeight * k));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; g.viewport(0, 0, w, h); }
  }
  function draw(now) {
    if (!alive || g.isContextLost()) return;
    const T = (now - t0 - paused) / 1000, [ex, ey, grow] = ember();
    const breath = 0.5 + 0.5 * (0.6 * Math.sin(T * 0.9) + 0.25 * Math.sin(T * 2.7 + 1.3) + 0.15 * Math.sin(T * 0.23));
    g.uniform2f(u("res"), canvas.width, canvas.height); g.uniform2f(u("ember"), ex, ey);
    g.uniform1f(u("t"), T + 40); g.uniform1f(u("rise"), 1 - ey); g.uniform1f(u("dark"), tint.dark); g.uniform1f(u("breath"), breath); g.uniform1f(u("grow"), grow);
    g.uniform3fv(u("ink"), tint.ink); g.uniform3fv(u("glow"), tint.glow);
    g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    if (!lit) { lit = true; onFrame?.(); }
  }
  function tick(now) {
    raf = 0;
    if (!running) return;
    raf = requestAnimationFrame(tick);
    if (now - last < FRAME_MS) return;
    last = now;
    draw(now);
  }
  let pausedAt = 0;
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); canvas.hidden = true; lit = false; onFrame?.(false); });
  resize();

  return {
    resize() { resize(); if (!running) draw(performance.now()); },
    play() { if (running || !alive) return; running = true; if (pausedAt) { paused += performance.now() - pausedAt; pausedAt = 0; } raf = requestAnimationFrame(tick); },
    pause() { if (!running) return; running = false; pausedAt = performance.now(); cancelAnimationFrame(raf); raf = 0; },
    destroy() {
      alive = false; running = false; cancelAnimationFrame(raf);
    },
  };
}
