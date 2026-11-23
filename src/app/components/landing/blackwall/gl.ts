/* ──────────────────────────────────────────────────────────────
   Thin WebGL2 helpers — program linking, typed uniform lookup,
   and resizable render targets. Everything here runs at init or
   on resize; nothing is called from the per-frame hot path
   except through handles it returned.
   ────────────────────────────────────────────────────────────── */

export type GL = WebGL2RenderingContext;

function compile(gl: GL, type: number, src: string, label: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error(`[blackwall] createShader failed (${label})`);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(sh) ?? '';
    gl.deleteShader(sh);
    throw new Error(`[blackwall] ${label} compile error:\n${log}`);
  }
  return sh;
}

export function link(gl: GL, vsSrc: string, fsSrc: string, label: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, `${label}.vert`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, `${label}.frag`);
  const prog = gl.createProgram();
  if (!prog) throw new Error(`[blackwall] createProgram failed (${label})`);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(prog) ?? '';
    gl.deleteProgram(prog);
    throw new Error(`[blackwall] ${label} link error:\n${log}`);
  }
  return prog;
}

export type Uniforms<K extends string> = Record<K, WebGLUniformLocation | null>;

/** Resolve a fixed list of uniform names once. Unused uniforms come
 *  back null, and gl.uniform*(null, …) is a defined no-op. */
export function uniforms<K extends string>(
  gl: GL,
  prog: WebGLProgram,
  names: readonly K[],
): Uniforms<K> {
  const out = {} as Uniforms<K>;
  for (const n of names) out[n] = gl.getUniformLocation(prog, n);
  return out;
}

/** A colour texture with its own framebuffer. Storage is (re)allocated
 *  by resizeTarget; the GL objects themselves live until deleteTarget. */
export interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export function createTarget(gl: GL, filter: number): Target {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) throw new Error('[blackwall] target allocation failed');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { fbo, tex, w: 0, h: 0 };
}

export function resizeTarget(gl: GL, t: Target, w: number, h: number): void {
  t.w = w;
  t.h = h;
  gl.bindTexture(gl.TEXTURE_2D, t.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

export function deleteTarget(gl: GL, t: Target): void {
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}

/** mulberry32 — small deterministic PRNG for init-time layout. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
