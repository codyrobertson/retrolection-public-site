/**
 * Borders for boxes: opt in with `data-frame`. The element's own border is hidden
 * and redrawn by one of two WebGL layers, depending on the surface mode:
 *
 *   analog  — a hand-drawn double pass in ballpoint (the ink shader, so it bleeds like the type)
 *   digital — ASCII box drawing: `+---+` / `|` snapped to an 8x16 character grid
 *
 * Each layer is gated to its own mode, so the print-head sweep that switches the rest of
 * the page turns one border into the other in place.
 */
import { createLayer } from "./gl-layer.js";
import { INK_FRAG } from "./ink-gl.js";

const CW = 8, CH = 16; // character cell, css px

const colors = new WeakMap(); // the CSS border is hidden once we draw it, so remember its colour from before

function collect(root) {
  const out = [];
  const sx = scrollX, sy = scrollY;
  let k = 0;
  root.querySelectorAll("[data-frame]").forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const bw = parseFloat(cs.borderTopWidth) || 0;
    let color = colors.get(el);
    if (!color) { color = bw > 0 && cs.borderTopStyle !== "none" ? cs.borderTopColor : cs.color; colors.set(el, color); }
    out.push({ x: r.left + sx, y: r.top + sy, w: r.width, h: r.height, color, seed: (k++ * 0.6180339887) % 1, y0: r.top + sy });
  });
  out.forEach((o) => { o.y = o.y0 - 10; o.h = o.h + 20; });
  return out;
}

const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** a slightly wandering rectangle: points every ~16px nudged by a smooth hash, joined by quadratics */
function wobblyRect(c, x, y, w, h, seed, amp, over) {
  const pts = [];
  const edge = (x0, y0, x1, y1, id) => {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.round(len / 16));
    for (let i = 0; i < n; i++) {
      const t = i / n, nx = -(y1 - y0) / len, ny = (x1 - x0) / len, o = (hash(seed * 91 + id * 13 + i) - 0.5) * 2 * amp;
      pts.push([x0 + (x1 - x0) * t + nx * o, y0 + (y1 - y0) * t + ny * o]);
    }
  };
  const ox = over * (hash(seed * 7) - 0.5), oy = over * (hash(seed * 5 + 1) - 0.5);
  edge(x - ox, y, x + w + ox, y, 1); edge(x + w, y - oy, x + w, y + h + oy, 2);
  edge(x + w + ox, y + h, x - ox, y + h, 3); edge(x, y + h + oy, x, y - oy, 4);
  c.beginPath();
  const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const s0 = m(pts[pts.length - 1], pts[0]);
  c.moveTo(s0[0], s0[1]);
  for (let i = 0; i < pts.length; i++) { const mid = m(pts[i], pts[(i + 1) % pts.length]); c.quadraticCurveTo(pts[i][0], pts[i][1], mid[0], mid[1]); }
  c.closePath();
}

const ASCII_FRAG = `precision highp float;varying vec2 uv;
uniform sampler2D mask,b1,b2,meta;uniform vec2 res;uniform float dpr,t,settle,y0,th,pad;
void main(){
  vec2 cp=vec2(uv.x,1.-uv.y)*vec2(res.x/dpr,th);
  vec2 mu=vec2(uv.x,1.-(cp.y+pad)/(th+2.*pad));
  vec2 p=vec2(cp.x,y0+cp.y), cs=vec2(${CW}.,${CH}.);
  vec2 ctr=(floor(p/cs)+.5)*cs, dd=ctr-p;
  vec2 mc=mu+vec2(dd.x/(res.x/dpr),-dd.y/(th+2.*pad));
  vec4 mk=texture2D(mask,mc);
  if(mk.a<.5){gl_FragColor=vec4(0.);return;}
  vec3 kd=texture2D(meta,mc).rgb;
  vec2 q=p-ctr;                                              // inside the cell, y down
  float aa=.55;
  float hb=(1.-smoothstep(3.9-aa,3.9+aa,abs(q.x)))*(1.-smoothstep(1.-aa*.5,1.+aa*.5,abs(q.y-.5)));   // '-'  (gap between cells)
  float vb=(1.-smoothstep(1.-aa*.5,1.+aa*.5,abs(q.x)))*(1.-smoothstep(7.6-aa,7.6+aa,abs(q.y)));      // '|'
  float cr=(1.-smoothstep(3.4-aa,3.4+aa,abs(q.x)))*(1.-smoothstep(1.-aa*.5,1.+aa*.5,abs(q.y-.5)));   // '+' bar
  float a=kd.r>.5?hb:kd.g>.5?vb:max(cr,vb);
  vec3 col=mk.rgb/mk.a;
  gl_FragColor=vec4(col*a,a);
}`;

export function startFrames() {
  const ink = createLayer({
    id: "frame-ink-gl", z: 2, readyClass: "frame-gl", frag: INK_FRAG, gate: "analog", sigmas: [0.45, 2.3], metaScale: 0.25, animated: false,
    attributes: ["style", "class", "data-frame"],
    collect: (root) => collect(root),
    begin(mx) { mx.lineCap = "round"; mx.lineJoin = "round"; },
    paint(mx, tx, s) {
      const x = s.x, y = s.y0, w = s.w, h = s.h;
      mx.strokeStyle = s.color;
      mx.globalAlpha = 0.95; mx.lineWidth = 1.5; wobblyRect(mx, x, y, w, h, s.seed, 0.7, 3); mx.stroke();     // the pen goes round once…
      mx.globalAlpha = 0.5; mx.lineWidth = 1.1; wobblyRect(mx, x, y, w, h, s.seed + 0.37, 0.9, 5); mx.stroke(); // …and again, a hair off
      mx.globalAlpha = 1;
      tx.fillStyle = "rgb(235,0,0)"; tx.fillRect(x - 10, y - 10, w + 20, h + 20);
    },
  });

  const ascii = createLayer({
    id: "frame-ascii-gl", z: 2, readyClass: "frame-ascii-gl", frag: ASCII_FRAG, gate: "digital", sigmas: [0.3, 1], metaScale: 1, metaNearest: true, animated: false,
    attributes: ["style", "class", "data-frame"],
    collect: (root) => collect(root),
    begin(mx, tx) { mx.globalAlpha = 1; },
    paint(mx, tx, s) {
      const c0 = Math.round(s.x / CW), c1 = Math.max(c0 + 1, Math.round((s.x + s.w) / CW) - 1);
      const r0 = Math.round(s.y0 / CH), r1 = Math.max(r0 + 1, Math.round((s.y0 + s.h) / CH) - 1);
      mx.fillStyle = s.color;
      const cell = (c, r, kind) => {
        mx.fillRect(c * CW, r * CH, CW, CH);
        tx.fillStyle = kind === 0 ? "rgb(255,0,0)" : kind === 1 ? "rgb(0,255,0)" : "rgb(0,0,255)";
        tx.fillRect(c * CW, r * CH, CW, CH);
      };
      for (let c = c0; c <= c1; c++) { const corner = c === c0 || c === c1; cell(c, r0, corner ? 2 : 0); cell(c, r1, corner ? 2 : 0); }
      for (let r = r0 + 1; r < r1; r++) { cell(c0, r, 1); cell(c1, r, 1); }
    },
  });

  return {
    rebuild() { ink.rebuild(); ascii.rebuild(); },
    destroy() { ink.destroy(); ascii.destroy(); },
  };
}
