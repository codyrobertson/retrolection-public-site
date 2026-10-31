// @ts-check
/**
 * Copic-style alcohol marker fills over live DOM/SVG (see gl-layer.js).
 *
 * Opt in per element with `data-marker` (optionally `data-marker="#e85d4a"` to
 * override the colour; `data-marker-angle="deg"`, `data-marker-nib="px"`).
 * Works on SVG geometry (path, rect, circle, ellipse, polygon, polyline, line —
 * fill and/or stroke) and on plain HTML boxes (background + border-radius).
 *
 * The shader lays the fill down as overlapping parallel strokes along the shape's
 * long axis: each stroke has its own ink load, adjacent strokes lap over each other
 * into a darker band, ink pools at the wet edge and feathers a little into the
 * paper, and the paper tooth breaks the colour up. The result is translucent so the
 * paper shows through (multiply-blended on light paper).
 */
import { createLayer } from "./gl-layer.js";

const FRAG = `precision highp float;varying vec2 uv;
uniform sampler2D mask,b1,b2,meta;uniform vec2 res;uniform float dpr,t,settle,y0,th,pad;
float h(vec2 p){p=fract(p*vec2(443.897,441.423));p+=dot(p,p.yx+19.19);return fract((p.x+p.y)*p.x);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
// Marker ink is a saturated, even, translucent film. Layers do not add light or gaps: each one
// multiplies the ink *density* up. d=1 is a single clean pass.
float lanes(vec2 p,float ang,float nib,float seed,float shift,out float over){
  vec2 d=vec2(cos(ang),sin(ang)),n=vec2(-d.y,d.x);
  float u=dot(p,d),vv=dot(p,n)/nib+shift,k=floor(vv),f=fract(vv);
  float load=(h(vec2(k,seed))-.5)*.16+(vn(vec2(u*.006+k*2.9,k+seed))-.5)*.10;     // each sweep a touch heavier/lighter
  over=smoothstep(0.,.08,f)*(1.-smoothstep(.12,.30,f))*(.3+.7*h(vec2(k,seed+5.)))*(.55+.45*vn(vec2(u*.008+k*4.1,seed)));                          // soft darker strip where this sweep laps the last
  float streak=(vn(vec2(u*.018,vv*20.+seed))-.5)*.07;                            // faint nib streaks
  return load+streak;
}
void main(){
  vec2 cp=vec2(uv.x,1.-uv.y)*vec2(res.x/dpr,th);
  vec2 mu=vec2(uv.x,1.-(cp.y+pad)/(th+2.*pad));
  vec4 cc=texture2D(b2,mu); vec4 mk=texture2D(mask,mu);
  if(cc.a<.004&&mk.a<.004){gl_FragColor=vec4(0.);return;}
  vec4 mt=texture2D(meta,mu);
  float nib=max(mt.r*32.,6.), ang=mt.g*3.14159265, seed=mt.b*37.;
  vec2 p=vec2(cp.x,y0+cp.y);
  float c1=texture2D(b1,mu).a, c2=cc.a;
  float G=vn(p*2.1)*.55+vn(p*5.3+4.)*.3+vn(p*11.+9.)*.15;
  float fib=vn(vec2(dot(p,vec2(.8,.6))*.9,dot(p,vec2(-.6,.8))*.07)+seed);

  // density budget: 1.0 = one pass
  float o1,o2;
  float dn=1.+lanes(p,ang,nib,seed,0.,o1)+.50*o1;                                // pass 1, long axis
  // pass 2: a second coat laid at ~20deg over part of the shape. Its edge is where the nib stopped:
  // a clean boundary with a thin darker line of pooled ink.
  vec2 sd=vec2(cos(ang+.33),sin(ang+.33)); vec2 sp=vec2(dot(p,sd)*.0035,dot(p,vec2(-sd.y,sd.x))*.022);
  float pn=vn(sp+seed*3.)+.25*vn(sp*3.+seed)-.12+.10*(c2-.5);
  float cover=smoothstep(.45,.50,pn);
  float line=exp(-pow((pn-.475)/.014,2.));
  dn+=cover*(.42+lanes(p,ang+.33,nib*.9,seed+11.,.43,o2)+.10*o2)+.30*line;
  // third light glaze, wide and soft, so big areas carry a gentle tonal swell
  dn+=.16*smoothstep(.35,.75,vn(p*.0045+seed*7.));
  dn*=.95+.10*G;                                                                  // paper tooth
  float edge=4.*c1*(1.-c1);
  dn+=.55*smoothstep(.3,.8,edge);                                                 // pigment pools at the dried edge

  float body=smoothstep(.30,.60,c1+((vn(p*.45)-.5)*.12+(G-.5)*.08+(fib-.5)*.08)*settle);
  float A0=.66;
  float a=body*clamp(1.-pow(1.-A0,dn),0.,.97);
  float wick=smoothstep(.05,.40,c2+(fib-.5)*.28+(G-.5)*.1)*.13;                   // alcohol creeping along fibres past the edge
  a=clamp(a+wick*(1.-body),0.,1.);
  vec3 col=cc.rgb/max(cc.a,.001);
  col=pow(col,vec3(.82+.32*dn));                                                  // denser ink = deeper, richer colour
  gl_FragColor=vec4(col*a,a);
}`;

const num = (v, d = 0) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };

/** Polygon-ish / geometry element → Path2D in its own user space. */
function pathFor(el) {
  const tag = el.tagName.toLowerCase();
  const a = (n) => num(el.getAttribute(n));
  if (tag === "path") return new Path2D(el.getAttribute("d") || "");
  const p = new Path2D();
  if (tag === "rect") {
    const x = a("x"), y = a("y"), w = a("width"), h = a("height");
    const rx = Math.min(num(el.getAttribute("rx"), num(el.getAttribute("ry"))), w / 2), ry = Math.min(num(el.getAttribute("ry"), rx), h / 2);
    if (rx || ry) p.ellipse(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI * 1.5), p.lineTo(x + w - rx, y), p.ellipse(x + w - rx, y + ry, rx, ry, 0, -Math.PI / 2, 0), p.lineTo(x + w, y + h - ry),
      p.ellipse(x + w - rx, y + h - ry, rx, ry, 0, 0, Math.PI / 2), p.lineTo(x + rx, y + h), p.ellipse(x + rx, y + h - ry, rx, ry, 0, Math.PI / 2, Math.PI), p.closePath();
    else p.rect(x, y, w, h);
  } else if (tag === "circle") p.arc(a("cx"), a("cy"), a("r"), 0, Math.PI * 2);
  else if (tag === "ellipse") p.ellipse(a("cx"), a("cy"), a("rx"), a("ry"), 0, 0, Math.PI * 2);
  else if (tag === "line") { p.moveTo(a("x1"), a("y1")); p.lineTo(a("x2"), a("y2")); }
  else if (tag === "polygon" || tag === "polyline") {
    const pts = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number);
    for (let i = 0; i + 1 < pts.length; i += 2) i ? p.lineTo(pts[i], pts[i + 1]) : p.moveTo(pts[i], pts[i + 1]);
    if (tag === "polygon") p.closePath();
  } else return null;
  return p;
}

/** Rounded-rect path in page px for an HTML box. */
function boxPath(x, y, w, h, r) {
  const p = new Path2D(); r = Math.min(r, w / 2, h / 2);
  p.moveTo(x + r, y); p.arcTo(x + w, y, x + w, y + h, r); p.arcTo(x + w, y + h, x, y + h, r); p.arcTo(x, y + h, x, y, r); p.arcTo(x, y, x + w, y, r); p.closePath();
  return p;
}

function collect(root) {
  const out = [];
  const sx = scrollX, sy = scrollY;
  let k = 0;
  root.querySelectorAll("[data-marker]").forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const override = el.getAttribute("data-marker");
    const color = override && override !== "true" ? override : null;
    const op = parseFloat(cs.opacity || "1");
    const seed = ((k++ * 0.6180339887) % 1);
    const w = Math.max(r.width, 1), h = Math.max(r.height, 1);
    const angDeg = el.getAttribute("data-marker-angle");
    const tilt = (seed - 0.5) * 0.1;
    const ang = angDeg != null ? (num(angDeg) * Math.PI) / 180 : (w >= h ? 0 : Math.PI / 2) + tilt;
    const nib = num(el.getAttribute("data-marker-nib"), Math.min(30, Math.max(14, Math.min(w, h) * 0.45)));
    const meta = `rgb(${Math.round(Math.min(nib / 32, 1) * 255)},${Math.round((((ang % Math.PI) + Math.PI) % Math.PI) / Math.PI * 255)},${Math.round(seed * 255)})`;
    const base = { y: r.top + sy - 8, h: r.height + 16, meta, op, m: null };

    if (el instanceof SVGElement) {
      const path = pathFor(el); if (!path) return;
      const ctm = /** @type {SVGGraphicsElement} */ (el).getScreenCTM(); if (!ctm) return;
      const fill = color ?? (cs.fill !== "none" ? cs.fill : null), stroke = color && cs.stroke === "none" ? null : cs.stroke !== "none" ? color ?? cs.stroke : null;
      const fo = parseFloat(cs.fillOpacity || "1"), so = parseFloat(cs.strokeOpacity || "1");
      out.push({ ...base, path, m: [ctm.a, ctm.b, ctm.c, ctm.d, ctm.e + sx, ctm.f + sy], fill, stroke, fo, so, lw: num(cs.strokeWidth, 1), cap: cs.strokeLinecap, join: cs.strokeLinejoin, x: r.left + sx, w: r.width });
    } else {
      const bg = color ?? cs.backgroundColor;
      if (!color && /rgba?\(.*,\s*0\)$/.test(bg)) return;
      const rad = num(cs.borderTopLeftRadius);
      out.push({ ...base, path: boxPath(r.left + sx, r.top + sy, r.width, r.height, rad), fill: bg, stroke: null, fo: 1, so: 1, lw: 0, x: r.left + sx, w: r.width });
    }
  });
  return out;
}

export function startMarker() {
  return createLayer({
    id: "marker-gl", z: 1, readyClass: "marker-gl", frag: FRAG, sigmas: [0.6, 2.2], metaScale: 0.5, metaNearest: true, animated: false,
    attributes: ["d", "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "points", "transform", "style", "class", "data-marker", "fill", "stroke"],
    padding: 8,
    collect: (root) => collect(root),
    begin(mx, tx) { mx.globalAlpha = 1; tx.lineJoin = "round"; },
    paint(mx, tx, s) {
      mx.save(); tx.save();
      if (s.m) { mx.transform(...s.m); tx.transform(...s.m); }
      if (s.fill) { mx.globalAlpha = s.op * s.fo; mx.fillStyle = s.fill; mx.fill(s.path); }
      if (s.stroke) { mx.globalAlpha = s.op * s.so; mx.strokeStyle = s.stroke; mx.lineWidth = s.lw; mx.lineCap = s.cap || "butt"; mx.lineJoin = s.join || "miter"; mx.stroke(s.path); }
      tx.fillStyle = tx.strokeStyle = s.meta; tx.lineWidth = Math.max(s.lw, 0) + 6;
      if (s.fill) tx.fill(s.path);
      tx.stroke(s.path);
      mx.restore(); tx.restore();
    },
  });
}
