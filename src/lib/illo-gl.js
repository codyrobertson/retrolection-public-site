/**
 * Pencil field-guide illustrations: 3B graphite, 9H hard pencil and ballpoint line work on 80lb paper.
 *
 * Author an illo as a plain inline SVG of centerline strokes and mark it `data-illo`. The tool is a
 * `data-pen` on the shape or any ancestor `<g>`:
 *
 *   ballpoint  dark blue-black line: pools at the edges, skips on light pressure     (default)
 *   3b         soft graphite: grain only catches the paper's tooth, builds up when strokes overlap
 *   9h         pale hard line: thin, scratchy, only shows on the tooth (construction lines, guides)
 *
 * Per shape (or ancestor):  data-w="1.4" width multiplier · data-a=".4" stroke alpha · data-pass="2" go over it twice
 * Shading:                  data-hatch="angle gap [cross]" on any closed shape fills it with hand hatching
 *                           (e.g. data-hatch="45 4", or "45 4 cross" for crosshatch). The shape's outline is not drawn.
 *
 * Stroke order is document order and the sheet draws on in that order on first load. Width is pen pressure
 * (tapers in and out); wobble is added here, so clean paths read as sketched. The page shows the plain SVG
 * until the layer is ready, then the shader takes over (see surface.css). Digital mode renders the same
 * strokes as dot-matrix (ballpoint), ordered dither (graphite) and 1px bitmap lines (9H).
 *
 * Mask channels: R = ballpoint, G = 3B, B = 9H, additive, so overlaps build. Meta: R = on dark paper, G = draw-on order.
 */
import { createLayer } from "./gl-layer.js";

const PENS = {
  ballpoint: { ch: [255, 0, 0], w: 1.5, a: 0.92, amp: 0.55 },
  "3b": { ch: [0, 255, 0], w: 2.6, a: 0.66, amp: 0.8 },
  "9h": { ch: [0, 0, 255], w: 0.9, a: 0.85, amp: 0.35 },
};
const HATCH_A = 0.36;

const ILLO_FRAG = `precision highp float;varying vec2 uv;
uniform sampler2D mask,b1,b2,meta;uniform vec2 res;uniform float dpr,t,settle,y0,th,pad;
float h(vec2 p){p=fract(p*vec2(443.897,441.423));p+=dot(p,p.yx+19.19);return fract((p.x+p.y)*p.x);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fibre(vec2 p){float a=0.;
  for(int i=0;i<3;i++){float an=float(i)*1.0472+.35;float c=cos(an),s=sin(an);vec2 q=vec2(c*p.x-s*p.y,s*p.x+c*p.y);a+=vn(q*vec2(1.1,.14)+float(i)*13.7);}
  return a/3.;}
vec4 over(vec4 d,vec3 c,float a){return vec4(c*a,a)+d*(1.-a);}
void main(){
  vec2 cp=vec2(uv.x,1.-uv.y)*vec2(res.x/dpr,th);
  vec2 mu=vec2(uv.x,1.-(cp.y+pad)/(th+2.*pad));
  vec4 m0=texture2D(mask,mu), c2=texture2D(b2,mu);
  if(m0.a<.004&&c2.a<.004){gl_FragColor=vec4(0.);return;}
  vec4 mt=texture2D(meta,mu);
  float dark=mt.r, u=mt.g;
  float front=settle*1.08;                                    // draw-on: pixels appear as the pen reaches them
  float shown=1.-smoothstep(front-.04,front,u);
  vec3 inkC=mix(vec3(.10,.13,.30),vec3(.93,.91,.85),dark);
  vec3 grC =mix(vec3(.17,.17,.19),vec3(.80,.80,.82),dark);
  vec3 hC  =mix(vec3(.38,.39,.43),vec3(.62,.63,.66),dark);
  vec2 pp=vec2(cp.x,y0+cp.y);
  float W=res.x/dpr, H=th+2.*pad;
  vec4 o=vec4(0.);
  if(DG>.5){                                                  // digital: bitmap media, sampled at each cell's centre
    float pitch=1.6, row=floor(pp.y/pitch), off=mod(row,2.)*.5;
    vec2 dc=vec2((floor(pp.x/pitch-off)+off+.5)*pitch,(row+.5)*pitch), dd=dc-pp;
    float dotA=step(.3,texture2D(b1,mu+vec2(dd.x/W,-dd.y/H)).r)*smoothstep(pitch*.72,pitch*.5,length(dd)); // dot-matrix ballpoint, staggered rows
    vec2 gc=(floor(pp/2.)+.5)*2., gd=gc-pp;
    float sg=texture2D(b1,mu+vec2(gd.x/W,-gd.y/H)).g;
    float onG=step(bayer8(floor(pp/2.)),clamp(sg*1.7,0.,1.));  // graphite: 2px ordered dither on tone
    vec2 hd=floor(pp)+.5-pp;
    float onH=step(.4,texture2D(b1,mu+vec2(hd.x/W,-hd.y/H)).b)*.6; // 9H: crisp 1px
    o=over(o,hC,onH); o=over(o,grC,onG*.9); o=over(o,inkC,dotA);
    gl_FragColor=o*step(.5,shown);return;
  }
  vec4 c1=texture2D(b1,mu);
  float F=fibre(pp), G=vn(pp*1.9)*.5+vn(pp*4.3+7.)*.32+vn(pp*9.1+3.)*.18;
  float T=mix(G,F,.35);                                       // paper tooth: 80lb stock, mild
  float a9=smoothstep(.1,.45,c1.b*1.2+(T-.5)*.6)*.7;          // 9H: only the peaks of the tooth take it
  float d=min(c1.g,1.);
  float dep=smoothstep(.02,.34,d*1.25+(T-.5)*.55);            // 3B: grain deposits on the tooth, denser where strokes overlap
  float a3=clamp(dep*(.30+.62*smoothstep(.1,.9,d))+c2.g*.2*(.7+.6*G),0.,.95);
  vec3 gc3=grC+(1.-dark)*.05*dep*smoothstep(.5,1.,d);         // graphite sheen at high build-up
  float body=smoothstep(.2,.5,c1.r+(T-.5)*.26*(1.-c1.r*.5));  // ballpoint
  float skip=smoothstep(.62,.9,vn(pp*.33+vec2(4.,9.)))*(1.-smoothstep(.55,.95,c1.r))*.6;
  float a1=body*(1.-skip)*mix(.8,1.,smoothstep(.5,1.,c1.r))*(1.-.07*G);
  float edge=4.*c1.r*(1.-c1.r);
  vec3 ic=mix(inkC,inkC*.6,edge*.6*(1.-dark));
  a1=clamp(a1+smoothstep(.15,.5,c2.r)*.08*(1.-a1),0.,1.);
  o=over(o,hC,a9); o=over(o,gc3,a3); o=over(o,ic,a1);
  gl_FragColor=o*shown;
}`;

const mulberry = (a) => () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const n1 = (x) => { const i = Math.floor(x), f = x - i, k = f * f * (3 - 2 * f); return hash(i) * (1 - k) + hash(i + 1) * k; };
const attr = (el, name, def) => el.closest(`[${name}]`)?.getAttribute(name) ?? def;

/** Page-space polyline for a geometry element, one point about every 2 css px. */
function sample(el, m, sx, sy) {
  const L = el.getTotalLength(), k = Math.hypot(m.a, m.b) || 1, n = Math.max(2, Math.ceil((L * k) / 2));
  const pts = [];
  for (let i = 0; i <= n; i++) { const q = el.getPointAtLength((L * i) / n); pts.push(m.a * q.x + m.c * q.y + m.e + sx, m.b * q.x + m.d * q.y + m.f + sy); }
  return pts;
}

/** Wobble a polyline, give it a pressure profile and turn it into a ribbon polygon plus per-sample widths. */
function shape(pts, pen, wMul, alpha, seed, ampMul = 1) {
  const n = pts.length / 2, P = PENS[pen];
  const s = new Float32Array(n);
  let L = 0;
  for (let i = 1; i < n; i++) { L += Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]); s[i] = L; }
  const x = new Float32Array(n), y = new Float32Array(n), w = new Float32Array(n), poly = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let tx = pts[2 * b] - pts[2 * a], ty = pts[2 * b + 1] - pts[2 * a + 1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const off = ((n1(s[i] / 16 + seed * 13) - 0.5) * 2 * P.amp + (n1(s[i] / 3.1 + seed * 7) - 0.5) * 0.3) * ampMul;
    x[i] = pts[2 * i] - ty * off; y[i] = pts[2 * i + 1] + tx * off;
    const taper = Math.min(1, 0.4 + s[i] / 6) * Math.min(1, 0.4 + (L - s[i]) / 11);
    w[i] = P.w * wMul * taper * (0.82 + 0.36 * n1(s[i] / 22 + seed * 5));
    const nx = -ty * w[i] / 2, ny = tx * w[i] / 2;
    poly[2 * i] = x[i] + nx; poly[2 * i + 1] = y[i] + ny;
    poly[4 * n - 2 * i - 2] = x[i] - nx; poly[4 * n - 2 * i - 1] = y[i] - ny;
  }
  return { x, y, w, poly, L, pen, alpha };
}

/** Hand hatching inside a closed shape: parallel strokes found by probing isPointInFill, slightly bowed and uneven. */
function hatch(el, m, sx, sy, gap, angles, rng) {
  const bb = el.getBBox(), cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2, R = Math.hypot(bb.width, bb.height) / 2 + 2;
  const k = Math.hypot(m.a, m.b) || 1, stepU = 6 / k, gapU = gap / k;
  const out = [];
  let flip = false;
  for (const ang of angles) {
    for (let off = -R; off <= R; off += gapU * (0.8 + 0.4 * rng())) {
      const a = (ang * Math.PI) / 180 + (rng() - 0.5) * 0.06, dx = Math.cos(a), dy = Math.sin(a), ox = cx - dy * off, oy = cy + dx * off;
      const inside = (t) => el.isPointInFill(new DOMPoint(ox + dx * t, oy + dy * t));
      const edge = (a, b, ia) => { for (let q = 0; q < 3; q++) { const mid = (a + b) / 2; if (inside(mid) === ia) a = mid; else b = mid; } return (a + b) / 2; };
      let run = null, prev = -R, pin = false;
      for (let t = -R + stepU; t <= R + stepU; t += stepU) {
        const tin = t <= R && inside(t);
        if (tin !== pin) {                                      // crossed the outline between prev and t: bisect to find it
          const e = edge(prev, t, pin);
          if (tin) run = e;
          else {
            let t0 = run + (rng() - 0.35) * gapU * 0.6, t1 = e - (rng() - 0.35) * gapU * 0.6; // ends stop short or overshoot a little
            run = null;
            if ((t1 - t0) * k >= 3) {
              if (flip) [t0, t1] = [t1, t0];
              flip = !flip;
              const bow = ((rng() - 0.5) * 1.2) / k, pts = [];
              for (let j = 0; j <= 4; j++) {
                const f = j / 4, tt = t0 + (t1 - t0) * f, q = Math.sin(f * Math.PI) * bow, px = ox + dx * tt - dy * q, py = oy + dy * tt + dx * q;
                pts.push(m.a * px + m.c * py + m.e + sx, m.b * px + m.d * py + m.f + sy);
              }
              out.push(pts);
            }
          }
        }
        pin = tin; prev = t;
      }
    }
  }
  return out;
}

function collect(root) {
  const out = [], sx = scrollX, sy = scrollY;
  let seedN = 0;
  root.querySelectorAll("svg[data-illo]").forEach((svg) => {
    const r = svg.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || getComputedStyle(svg).display === "none") return;
    const col = getComputedStyle(svg).color.match(/[\d.]+/g) || [0, 0, 0];
    const dark = (0.3 * +col[0] + 0.6 * +col[1] + 0.1 * +col[2]) / 255 > 0.5;
    const seed = ++seedN, rng = mulberry(seed * 7919), strokes = [];
    svg.querySelectorAll("path,circle,ellipse,line,polyline,polygon,rect").forEach((el) => {
      if (el.closest("defs,clipPath,mask,symbol")) return;
      const pen = attr(el, "data-pen", "ballpoint");
      const m = el.getScreenCTM();
      if (!PENS[pen] || !m) return;
      const wMul = parseFloat(attr(el, "data-w", "1")), hat = el.getAttribute("data-hatch");
      if (hat) {
        const [ang, gap = "4", cross] = hat.trim().split(/\s+/);
        const alpha = parseFloat(attr(el, "data-a", String(pen === "3b" ? HATCH_A : PENS[pen].a * 0.5)));
        const angles = [parseFloat(ang)]; if (cross) angles.push(parseFloat(ang) + 80);
        for (const pts of hatch(el, m, sx, sy, parseFloat(gap), angles, rng)) strokes.push(shape(pts, pen, wMul, alpha * (0.8 + 0.4 * rng()), rng() * 50, 0.45));
        return;
      }
      if (el.hasAttribute("data-raw")) {                      // pre-traced strokes ("M x y L x y ..." absolute, dense): skips DOM sampling
        const rawA = parseFloat(attr(el, "data-a", String(PENS[pen].a))), amp = parseFloat(attr(el, "data-amp", "1"));
        for (const sub of (el.getAttribute("d") || "").split("M")) {
          const nums = sub.match(/-?[\d.]+/g);
          if (!nums || nums.length < 4) continue;
          const pts = [];
          for (let i = 0; i + 1 < nums.length; i += 2) { const x = +nums[i], y = +nums[i + 1]; pts.push(m.a * x + m.c * y + m.e + sx, m.b * x + m.d * y + m.f + sy); }
          strokes.push(shape(pts, pen, wMul, rawA * (0.8 + 0.4 * rng()), rng() * 50, amp));
        }
        return;
      }
      const alpha = parseFloat(attr(el, "data-a", String(PENS[pen].a)));
      const passes = parseInt(attr(el, "data-pass", "1"), 10);
      // getPointAtLength runs across subpaths as one line, so each `M` (absolute) becomes its own stroke
      const subs = el.tagName === "path" ? (el.getAttribute("d") || "").split(/(?=M)/).filter((d) => d.trim()) : [null];
      for (const d of subs) {
        let tmp = null;
        if (d && subs.length > 1) { tmp = document.createElementNS("http://www.w3.org/2000/svg", "path"); tmp.setAttribute("d", d); el.after(tmp); }
        const pts = sample(tmp || el, m, sx, sy);
        tmp?.remove();
        for (let p = 0; p < passes; p++) strokes.push(shape(pts, pen, wMul * (p ? 0.8 : 1), alpha * (p ? 0.7 : 0.85 + 0.15 * rng()), rng() * 50, p ? 1.5 : 1));
      }
    });
    let total = 0; strokes.forEach((s) => (total += s.L + 6));
    let run = 0; strokes.forEach((s) => { s.u0 = run / total; s.u1 = (run + s.L) / total; run += s.L + 6; });
    out.push({ x: r.left + sx, y: r.top + sy, w: r.width, h: r.height, dark, strokes });
  });
  return out;
}

/** `<svg data-illo data-src="/illos/self.svg" viewBox="...">`: pull in a generated illo (see scripts/illo-from-photo.py). */
async function loadSources() {
  await Promise.all([...document.querySelectorAll("svg[data-illo][data-src]")].map(async (svg) => {
    try {
      const doc = new DOMParser().parseFromString(await (await fetch(svg.getAttribute("data-src"))).text(), "image/svg+xml");
      svg.replaceChildren(...[...doc.documentElement.childNodes].map((n) => document.importNode(n, true)));
      svg.removeAttribute("data-src");
    } catch { /* leave the svg empty */ }
  }));
}

export function startIllos() {
  loadSources();                                              // the layer rebuilds itself when the strokes land (mutation observer)
  const layer = createLayer({
    id: "illo-gl", z: 2, readyClass: "illo-gl", frag: ILLO_FRAG, sigmas: [0.45, 2.3], metaScale: 1, metaNearest: true, animated: true, live: false,
    collect: (root) => collect(root),
    begin(mx, tx) { mx.lineJoin = "round"; tx.lineCap = "round"; tx.lineJoin = "round"; },
    paint(mx, tx, it) {
      tx.fillStyle = it.dark ? "rgb(255,0,0)" : "rgb(0,0,0)";
      tx.fillRect(it.x - 6, it.y - 6, it.w + 12, it.h + 12);
      for (const s of it.strokes) {
        const [r, g, b] = PENS[s.pen].ch, n = s.x.length;
        const path = new Path2D();
        path.moveTo(s.poly[0], s.poly[1]);
        for (let i = 1; i < 2 * n; i++) path.lineTo(s.poly[2 * i], s.poly[2 * i + 1]);
        path.closePath();
        mx.globalCompositeOperation = "lighter"; mx.fillStyle = `rgba(${r},${g},${b},${s.alpha})`; mx.fill(path);
        mx.globalCompositeOperation = "source-over";
        const red = it.dark ? 255 : 0;
        if (s.L < 60) {                                          // short strokes appear all at once as the draw-on front passes
          tx.fillStyle = tx.strokeStyle = `rgb(${red},${Math.round(((s.u0 + s.u1) / 2) * 255)},0)`; tx.lineWidth = 3; tx.fill(path); tx.stroke(path);
        } else {                                                 // long ones ramp along their length; wider than the ink so edges never read as "not yet drawn"
          tx.lineWidth = Math.max(...s.w) + 3;
          const stp = Math.max(2, Math.round(n / (s.L / 24)));
          for (let i = 0; i < n - 1; i += stp) {
            const j = Math.min(n - 1, i + stp), u = s.u0 + ((s.u1 - s.u0) * (i + 1)) / n;
            tx.strokeStyle = `rgb(${red},${Math.round(u * 255)},0)`;
            tx.beginPath(); tx.moveTo(s.x[i], s.y[i]); tx.lineTo(s.x[j], s.y[j]); tx.stroke();
          }
        }
      }
    },
  });
  return { rebuild: layer.rebuild, destroy: layer.destroy };
}
