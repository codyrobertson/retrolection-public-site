/**
 * Masking tape over live DOM (see gl-layer.js): pins illustrations and photos to the page.
 *
 * Opt in with an empty element carrying `data-tape` and laid out where the strip should sit; its
 * untransformed box is the strip and `data-tape-angle="-8"` (deg) turns it. The element itself paints
 * nothing (surface.css), so without WebGL the page simply has no tape.
 *
 * The strip is crepe paper: warm, translucent (what it is stuck over shows through), with fibres along
 * its length, crinkles across it, torn serrated ends, and a slightly denser edge where the adhesive
 * caught dust. Meta: R = seed, G = angle.
 */
import { createLayer } from "./gl-layer.js";

const FRAG = `precision highp float;varying vec2 uv;
uniform sampler2D mask,b1,b2,meta;uniform vec2 res;uniform float dpr,t,settle,y0,th,pad;
float h(vec2 p){p=fract(p*vec2(443.897,441.423));p+=dot(p,p.yx+19.19);return fract((p.x+p.y)*p.x);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
void main(){
  vec2 cp=vec2(uv.x,1.-uv.y)*vec2(res.x/dpr,th);
  vec2 mu=vec2(uv.x,1.-(cp.y+pad)/(th+2.*pad));
  float m=texture2D(mask,mu).a, soft=texture2D(b1,mu).a;
  if(soft<.004){gl_FragColor=vec4(0.);return;}
  vec4 mt=texture2D(meta,mu);
  float seed=mt.r*61., ang=mt.g*3.14159265-1.5708;
  vec2 p=vec2(cp.x,y0+cp.y), d=vec2(cos(ang),sin(ang)), n=vec2(-d.y,d.x);
  float u=dot(p,d), v=dot(p,n);
  float fib=vn(vec2(u*.08,v*1.3)+seed)*.6+vn(vec2(u*.3,v*4.)+seed*2.)*.4;      // fibres run along the strip
  float crinkle=smoothstep(.55,.95,vn(vec2(u*.11+seed,v*.02)))*.5;             // creases across it
  float blot=vn(p*.035+seed)*.5+vn(p*.11+seed)*.5;
  float edge=clamp(1.-(soft-.55)/.4,0.,1.)*m;                                  // denser rim at the torn ends and sides
  vec3 c=vec3(.90,.85,.72)-(fib-.5)*.06-crinkle*.07+edge*vec3(-.05,-.06,-.08);
  c+=smoothstep(.62,.9,vn(vec2(u*.11+seed,v*.02)+.13))*.06;                    // light catching the crease
  float a=(.62+.14*blot+.12*edge)*smoothstep(.25,.6,m);
  if(DG>.5){a=step(bayer8(floor(p/2.)),a*.9);c=vec3(.86,.82,.70);}             // digital: dithered strip
  gl_FragColor=vec4(c*a,a);
}`;

const rand = (s) => { let x = Math.sin(s * 127.1) * 43758.5453; return x - Math.floor(x); };

function collect(root) {
  const out = [], sx = scrollX, sy = scrollY;
  let k = 0;
  root.querySelectorAll("[data-tape]").forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    const r = el.getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight;
    if (!w || !hh) return;
    const ang = (parseFloat(el.getAttribute("data-tape-angle") || "0") * Math.PI) / 180;
    const cx = r.left + sx + r.width / 2, cy = r.top + sy + r.height / 2, seed = (++k * 0.618) % 1;
    const ext = Math.abs(w * Math.cos(ang)) + Math.abs(hh * Math.sin(ang)), exy = Math.abs(w * Math.sin(ang)) + Math.abs(hh * Math.cos(ang));
    out.push({ x: cx - ext / 2, y: cy - exy / 2 - 4, h: exy + 8, cx, cy, w, hh, ang, seed });
  });
  return out;
}

export function startTape() {
  const layer = createLayer({
    id: "tape-gl", z: 4, readyClass: "tape-gl", frag: FRAG, sigmas: [1.2, 3], metaScale: 1, metaNearest: true, animated: false,
    attributes: ["style", "class", "data-tape", "data-tape-angle"],
    collect,
    begin() {},
    paint(mx, tx, it) {
      const { cx, cy, w, hh, ang, seed } = it;
      const pts = [], teeth = Math.max(5, Math.round(hh / 4));
      for (let i = 0; i <= teeth; i++) pts.push([w / 2 - rand(seed * 31 + i) * 5, -hh / 2 + (hh * i) / teeth]);       // torn right end
      pts.push([-w / 2 + 2, hh / 2 + (rand(seed + 9) - 0.5) * 1.5]);
      for (let i = teeth; i >= 0; i--) pts.push([-w / 2 + rand(seed * 17 + i) * 5, -hh / 2 + (hh * i) / teeth]);       // torn left end
      const c = Math.cos(ang), s = Math.sin(ang);
      const path = new Path2D();
      pts.forEach(([x, y], i) => { const X = cx + x * c - y * s, Y = cy + x * s + y * c; if (i) path.lineTo(X, Y); else path.moveTo(X, Y); });
      path.closePath();
      mx.fillStyle = "#fff"; mx.fill(path);
      tx.fillStyle = `rgb(${Math.round(seed * 255)},${Math.round(((ang + Math.PI / 2) / Math.PI) * 255)},0)`; tx.fill(path);
    },
  });
  return { rebuild: layer.rebuild, destroy: layer.destroy };
}
