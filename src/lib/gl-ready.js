/**
 * A program links in the GPU process, and the first call that needs the result (a uniform's place, useProgram,
 * its LINK_STATUS) waits for it: 50 ms and more for a shader the GPU has not seen. KHR_parallel_shader_compile
 * lets a page ask whether it is done without waiting, so a layer draws from the frame its programs are ready
 * and shows nothing new until then.
 */

/** @type {WeakMap<WebGLRenderingContext, any>} */
const ext = new WeakMap();

/**
 * Whether every program has linked, asked without waiting; true at once without the extension (the first use
 * waits, as it always would).
 * @param {WebGLRenderingContext} g
 * @param {...WebGLProgram} progs
 */
export function linked(g, ...progs) {
  if (!ext.has(g)) ext.set(g, g.getExtension("KHR_parallel_shader_compile"));
  const k = ext.get(g);
  return !k || progs.every((p) => g.getProgramParameter(p, k.COMPLETION_STATUS_KHR));
}
