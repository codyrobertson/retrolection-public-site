/**
 * Paper: fibres, tooth and a faint wash, generated once by a fragment shader into a
 * seamless tile and handed to CSS as a background image.
 *
 * Why a tile and not a live canvas: the page background then scrolls on the
 * compositor like any other background — zero per-frame cost, no scroll sync, no
 * GL context kept alive. The shader runs once (and again on a theme change).
 * Everything is periodic, so the tile repeats without seams. The low-frequency
 * "wash" is plain CSS gradients (paper.css) so it never repeats.
 */

const SIZE = 400; // css px per tile; a power of two isn't needed, only periodicity

const FRAG = `precision highp float;
uniform float px,K,dark;
float h21(vec2 p){p=fract(p*vec2(443.897,441.423));p+=dot(p,p.yx+19.19);return fract((p.x+p.y)*p.x);}
float h(vec2 c,float n){return h21(mod(c,n)+n*.01);}                      // periodic hash
float vnp(vec2 p,float n){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);     // periodic value noise, n cells per tile
  return mix(mix(h(i,n),h(i+vec2(1,0),n),f.x),mix(h(i+vec2(0,1),n),h(i+vec2(1,1),n),f.x),f.y);}
float seg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float t=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*t);}
void main(){
  vec2 p=gl_FragCoord.xy/px;                  // 0..1 across the tile
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
  vec3 col=tone<0.?shade:lite;
  gl_FragColor=vec4(col*a,a);
}`;

function render(dpr, dark) {
  const px = Math.round(SIZE * dpr);
  const cv = document.createElement("canvas");
  cv.width = cv.height = px;
  const g = cv.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, preserveDrawingBuffer: true });
  if (!g) return null;
  const sh = (type, src) => { const o = g.createShader(type); g.shaderSource(o, src); g.compileShader(o); return o; };
  const pr = g.createProgram();
  g.attachShader(pr, sh(g.VERTEX_SHADER, "attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}"));
  g.attachShader(pr, sh(g.FRAGMENT_SHADER, FRAG));
  g.bindAttribLocation(pr, 0, "p"); g.linkProgram(pr); g.useProgram(pr);
  g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
  g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
  g.uniform1f(g.getUniformLocation(pr, "px"), px); g.uniform1f(g.getUniformLocation(pr, "K"), 1); g.uniform1f(g.getUniformLocation(pr, "dark"), dark ? 1 : 0);
  g.viewport(0, 0, px, px); g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  return cv;
}

export function startPaper() {
  const docEl = document.documentElement;
  let url = "", alive = true, token = 0;

  function isDark() {
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g);
    return !!m && (+m[0] + +m[1] + +m[2]) / 3 < 128;
  }
  function build() {
    const my = ++token;
    const cv = render(Math.min(devicePixelRatio || 1, 2), isDark());
    if (!cv) return;
    cv.toBlob((blob) => {
      if (!alive || !blob || my !== token) return;
      const next = URL.createObjectURL(blob);
      docEl.style.setProperty("--paper-grain", `url("${next}")`);
      docEl.style.setProperty("--paper-size", SIZE + "px");
      docEl.classList.add("paper-gl");
      if (url) URL.revokeObjectURL(url);
      url = next;
      cv.getContext("webgl")?.getExtension("WEBGL_lose_context")?.loseContext();
    }, "image/png");
  }

  build();
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", build);
  const mo = new MutationObserver(build); mo.observe(docEl, { attributes: true, attributeFilter: ["data-theme"] });

  return {
    rebuild: build,
    destroy() {
      alive = false; scheme.removeEventListener("change", build); mo.disconnect();
      docEl.classList.remove("paper-gl"); docEl.style.removeProperty("--paper-grain"); docEl.style.removeProperty("--paper-size");
      if (url) URL.revokeObjectURL(url);
    },
  };
}
