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
  if(DG>.5){                                                  // digital: 9-pin dot-matrix, one dot per grid cell
    float pitch=mix(1.,1.7,S);
    vec2 pp=vec2(cp.x,y0+cp.y), cell=floor(pp/pitch), ctr=(cell+.5)*pitch, dd=ctr-pp;
    vec2 mc=mu+vec2(dd.x/(res.x/dpr),-dd.y/(th+2.*pad));
    float cov=texture2D(b1,mc).a;
    vec4 sc=texture2D(b2,mc);
    float r=pitch*.5*(.95+.5*cov);            // each pin strikes a little differently
    float dotA=smoothstep(.1,.38,cov)*smoothstep(r,r-.45,length(pp-ctr))*(.95+.05*h(cell+3.7));
    vec3 dc=sc.rgb/max(sc.a,.001);
    gl_FragColor=vec4(dc*dotA,dotA);return;
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

/** Walk the DOM and return one item per word, tagging elements the overlay can't track. */
function collect(root, host) {
  const docEl = document.documentElement;
  root.querySelectorAll("[data-ink-off]").forEach((e) => e.removeAttribute("data-ink-off"));
  const styles = new Map(), ok = new Map(), op = new Map(), off = [];
  const style = (el) => { let s = styles.get(el); if (!s) styles.set(el, (s = getComputedStyle(el))); return s; };
  const eligible = (el) => {
    if (!el || el === docEl) return true;
    let v = ok.get(el); if (v !== undefined) return v;
    if (!eligible(el.parentElement)) { ok.set(el, false); return false; }
    const s = style(el);
    const own = !SKIP_TAGS.has(el.tagName.toUpperCase()) && !el.hasAttribute("data-ink-skip") && !el.hasAttribute("data-gl-host") &&
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

export function startInk() {
  const ascents = new Map();
  let font = "", ls = "", color = "", alpha = -1, S = -1;
  const layer = createLayer({
    id: "ink-gl", z: 2, readyClass: "ink-gl", frag: INK_FRAG, sigmas: [0.45, 2.3], metaScale: 0.25, animated: true,
    collect,
    begin(mx) { font = ls = color = ""; alpha = S = -1; mx.textBaseline = "alphabetic"; },
    paint(mx, tx, w) {
      if (w.font !== font) mx.font = font = w.font;
      if ("letterSpacing" in mx && w.ls !== ls) /** @type {any} */ (mx).letterSpacing = ls = w.ls;
      if (w.color !== color) mx.fillStyle = color = w.color;
      if (w.alpha !== alpha) mx.globalAlpha = alpha = w.alpha;
      let a = ascents.get(w.font);
      if (a === undefined) { a = mx.measureText("Hg").fontBoundingBoxAscent ?? null; ascents.set(w.font, a); }
      mx.fillText(w.text, w.x, w.y + (a ?? w.h * 0.8), w.w + 0.5);
      if (w.S !== S) { tx.fillStyle = `rgb(${Math.round(w.S * 255)},0,0)`; S = w.S; }
      tx.fillRect(w.x - 6, w.y - 6, w.w + 12, w.h + 12);
    },
  });
  return {
    rebuild: layer.rebuild,
    destroy() { layer.destroy(); document.querySelectorAll("[data-ink-off]").forEach((e) => e.removeAttribute("data-ink-off")); },
  };
}
