/**
 * The lights, as a front down the window. Whoever pulls them (the plate's hands, taking the board
 * away) sets where it is: above `night.y` (window css px) it is night, below it day. The page's
 * theme (html[data-theme]) only changes once the front has gone the whole way, so the restyle and
 * the GL layers' new colours happen with nothing left to show them; until then every GL layer
 * turns its own pixels on the far side of the front (NIGHT, in its composite shader), whatever
 * colours they were drawn in. y = -Infinity: day all over; +Infinity: night all over.
 */

export const night = { y: -Infinity };
const subs = new Set();
let sy = 0;

/** move the front (or, with it standing in the window, the page under it): the layers redraw in this frame */
export function setNight(y) {
  if (y === night.y && (!Number.isFinite(y) || scrollY === sy)) return;
  night.y = y; sy = scrollY;
  for (const f of subs) f();
}
export const onNight = (f) => { subs.add(f); return () => subs.delete(f); };

/** the front in a canvas's own css px, given where that canvas's top is in the window (finite, for a uniform) */
export const nightIn = (top) => Math.max(-1e6, Math.min(1e6, night.y - top));

/**
 * Injected into a composite shader: lights(rgb, y) is the colour as it should look at css px y
 * of the canvas, given uNightY (the front, in the same px) and uDark (1 if the canvas was drawn in
 * the night's colours). Turning is the theme's own mapping, fitted to its tokens: the stock and the
 * ink trade lightness (L' = .998 - .977 L), greys keep the little warmth each theme gives them
 * (chroma goes with lightness), and a colour (the vermilion) keeps its own.
 */
export const NIGHT = `uniform float uNightY,uDark;
vec3 turnTo(vec3 c,float toNight){
  float L=dot(c,vec3(.299,.587,.114)); vec3 ch=c-L;
  float L2=toNight>.5?.998-.977*L:(.998-L)/.977;
  float sat=smoothstep(.05,.2,length(ch));
  return clamp(L2+ch*mix(clamp(L2/max(L,.04),.2,6.),1.,sat),0.,1.);}
vec3 lights(vec3 c,float y){
  float want=1.-smoothstep(uNightY-56.,uNightY,y);           // a soft edge, the width of a line of type
  float k=abs(want-uDark);
  return k<.002?c:mix(c,turnTo(c,1.-uDark),k);}
`;
