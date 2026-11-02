/**
 * Pulp print: any `<img data-pulp>` is re-printed on pulp stock by one shared WebGL context.
 *
 * Frequency-modulated: four plates (C, M, Y, K) of single-pixel grains thresholded by interleaved-gradient
 * noise, so there is no screen angle and no rosette. Paper fibres only bend the threshold, which is where the
 * grains clump. Fibres, tooth and flecks are procedural and multiply under the ink, so highlights stay paper.
 *
 * Each image is rendered once (lazily, when it nears the viewport, and again on resize) into a 2D canvas that
 * sits where the img was; the img stays in the DOM, visually hidden, for alt text and as the digital-mode view.
 * Options per image: data-pulp-scale (paper scale), data-pulp-gain (ink gain), data-pulp-fibre, data-pulp-seed,
 * data-pulp-tint (0 white … 1 yellowed).
 */

const FRAG = `precision highp float;
uniform sampler2D tex; uniform vec2 res; uniform float dpr,scale,gain,fibreAmt,seed,tint;
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+17.;a*=.5;}return s;}
vec3 im(vec2 uv){return texture2D(tex,clamp(uv,0.,1.)).rgb;}
vec3 imS(vec2 uv){vec2 o=.55*dpr/res;return (im(uv)*2.+im(uv+vec2(o.x,0.))+im(uv-vec2(o.x,0.))+im(uv+vec2(0.,o.y))+im(uv-vec2(0.,o.y)))/6.;}
float fibres(vec2 q){                      // long thin streaks along a slowly turning direction field
  float a=fbm(q*.012+seed)*6.2832; vec2 d=vec2(cos(a),sin(a)); vec2 r=vec2(dot(q,d),dot(q,vec2(-d.y,d.x)));
  return .6*vn(r*vec2(.12,1.5)+seed*3.1)+.4*vn(r*vec2(.3,3.)+9.7);}
float ign(vec2 p){return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));}
void main(){
  vec2 uv=gl_FragCoord.xy/res, q=gl_FragCoord.xy/dpr/scale;
  float fib=fibres(q), tooth=.6*fbm(q*.8+seed)+.4*vn(q*2.1+3.), form=fbm(q*.02+seed*2.);
  vec3 pc=mix(vec3(.965,.96,.945),vec3(.93,.885,.79),tint)*(.95+.1*form);
  pc*=1.-fibreAmt*.10*(fib-.45); pc*=1.-.07*(tooth-.45);
  vec2 c0=floor(q*.2); float hs=h21(c0+seed); vec2 ctr=c0+.2+.6*vec2(h21(c0+3.),h21(c0+8.));
  pc=mix(pc,vec3(.36,.26,.16),step(.96,hs)*smoothstep(.2,.0,length(q*.2-ctr))*.5*fibreAmt);
  vec3 c=imS(uv)*.965+.02; vec3 cmy=1.-c; float k=min(cmy.r,min(cmy.g,cmy.b)); k=smoothstep(.55,1.,k)*.8;
  cmy=clamp((cmy-k*.85)/(1.-k*.85),0.,1.);
  vec2 g=floor(gl_FragCoord.xy); float fb=(fib-.5)*.16*fibreAmt;
  float tC=ign(g)*.8+.1+fb, tM=ign(g+vec2(17.,31.))*.8+.1+fb, tY=ign(g+vec2(41.,7.))*.8+.1+fb, tK=ign(g+vec2(5.,53.))*.8+.1+fb;
  float e=.07/(1.+gain*.3);
  vec3 col=mix(vec3(1),vec3(.16,.56,.78),smoothstep(tC-e,tC+e,cmy.r)*.95);
  col*=mix(vec3(1),vec3(.82,.22,.5),smoothstep(tM-e,tM+e,cmy.g)*.93);
  col*=mix(vec3(1),vec3(.97,.86,.28),smoothstep(tY-e,tY+e,cmy.b)*.9);
  col*=mix(vec3(1),vec3(.16,.15,.17),smoothstep(tK-e,tK+e,k)*.95);
  gl_FragColor=vec4(pc*col,1.);}`;

const MAX_W = 2400; // device px; larger images are printed at this width and scaled by the browser

export function startPulp() {
  const gl = document.createElement("canvas").getContext("webgl", { antialias: false, premultipliedAlpha: false });
  if (!gl) return { rebuild() {}, destroy() {} };

  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}"));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return { rebuild() {}, destroy() {} };
  gl.useProgram(pr);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const u = (n) => gl.getUniformLocation(pr, n);

  /** @type {Map<HTMLImageElement, {canvas: HTMLCanvasElement, w: number}>} */
  const items = new Map();
  const num = (img, name, def) => { const v = parseFloat(img.getAttribute(name) ?? ""); return Number.isFinite(v) ? v : def; };

  function print(img, item) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = item.canvas.clientWidth || img.naturalWidth;
    const w = Math.min(MAX_W, Math.round(cssW * dpr)), h = Math.round((w * img.naturalHeight) / img.naturalWidth);
    if (!w || !h) return;
    if (gl.canvas.width !== w || gl.canvas.height !== h) { gl.canvas.width = w; gl.canvas.height = h; }
    if (item.canvas.width !== w || item.canvas.height !== h) { item.canvas.width = w; item.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img); } catch { return false; }
    gl.uniform1i(u("tex"), 0);
    gl.uniform2f(u("res"), w, h);
    gl.uniform1f(u("dpr"), w / cssW);
    gl.uniform1f(u("scale"), num(img, "data-pulp-scale", 1));
    gl.uniform1f(u("gain"), num(img, "data-pulp-gain", 1));
    gl.uniform1f(u("fibreAmt"), num(img, "data-pulp-fibre", 1));
    gl.uniform1f(u("seed"), num(img, "data-pulp-seed", 7));
    gl.uniform1f(u("tint"), num(img, "data-pulp-tint", 0.45));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    item.canvas.getContext("2d")?.drawImage(gl.canvas, 0, 0);
    item.w = w;
    return true;
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const img = /** @type {HTMLImageElement} */ (e.target), item = items.get(img);
      if (!item) continue;
      io.unobserve(img);
      if (print(img, item) !== false) img.setAttribute("data-pulp-ready", "");
    }
  }, { rootMargin: "300px" });

  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const img = [...items.keys()].find((i) => items.get(i)?.canvas === e.target), item = img && items.get(img);
      if (img && item && img.hasAttribute("data-pulp-ready") && Math.abs(Math.round(item.canvas.clientWidth * Math.min(2, window.devicePixelRatio || 1)) - item.w) > 2) print(img, item);
    }
  });

  function add(img) {
    if (items.has(img)) return;
    const canvas = document.createElement("canvas");
    canvas.className = img.className;
    canvas.setAttribute("data-pulp-canvas", "");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    img.after(canvas);
    items.set(img, { canvas, w: 0 });
    ro.observe(canvas);
    io.observe(img);
  }
  function scan() {
    for (const img of document.querySelectorAll("img[data-pulp]")) {
      const i = /** @type {HTMLImageElement} */ (img);
      if (i.complete && i.naturalWidth) add(i);
      else i.addEventListener("load", () => add(i), { once: true });
    }
  }
  scan();

  return {
    rebuild() { for (const [img, item] of items) { io.unobserve(img); print(img, item); } scan(); },
    destroy() {
      io.disconnect(); ro.disconnect();
      for (const [img, item] of items) { item.canvas.remove(); img.removeAttribute("data-pulp-ready"); }
      items.clear();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
