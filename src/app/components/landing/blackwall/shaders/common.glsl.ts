/* ──────────────────────────────────────────────────────────────
   Shared GLSL: version header, the Frame uniform block, hashes,
   value noise and the pressure-field lookup.

   GLSL lives in .glsl.ts modules (template strings) rather than
   raw .glsl files so the project needs no bundler loader — the
   sources ship exactly as written here.
   ────────────────────────────────────────────────────────────── */

/** Must be the very first bytes of every shader. Samplers are
 *  forced to highp: their default is lowp, which on mobile GPUs
 *  would quantize the float pressure field to ~8 bits. */
export const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/** Float count of the Frame uniform block (std140: one mat4, ten
 *  vec4, then two vec4 per event). */
export const FRAME_FLOATS = 124;

// Offsets into the Frame block's Float32Array, in floats.
export const F_VIEW_PROJ = 0; // mat4
export const F_CAM_POS = 16; // xyz, w = tan(fov/2)
export const F_CAM_RIGHT = 20; // xyz, w = aspect
export const F_GRID = 24; // bead columns, bead rows, first thread index, w = world size of one internal pixel
export const F_CAM_FWD = 28; // xyz, w = marble domain X scale
export const F_CLOCK = 32; // time, tick, dt in 60 Hz frames, pre-surge charge
export const F_SEED = 36; // xyz, w = thread pitch (world units)
export const F_RES = 40; // internal w, h, canvas w, h
export const F_MAP = 44; // wall x at left edge, at right edge, px scale, dither cell
export const F_FX = 48; // bulge Z, lens shift Y, shear, smear
export const F_AUX = 52; // cloud lattice: columns, rows, stride in thread pitches, max push-out (world)
export const F_EV = 56; // six events, eight floats each (see breach.ts)
export const F_GLITCH = 104; // billow clock (s), its teleport offset, ghost opacity (0 = live pass), glitch burst 0..1
export const F_GLITCH2 = 108; // ICE burst 0..1, chunk-out fade, ghost is cold 0/1, silhouette seed
export const F_BAND = 112; // the four bands' teleport offsets
export const F_FIGHT = 116; // post-yank shudder 1..0, slam-shut scar 1..0, scar seed, idle creep 0..1
export const F_SIL = 120; // the silhouette behind the wall: centre X, half-width, height, opacity (negative = cold)

export const COMMON = /* glsl */ `
/* Every per-frame value reaches every shader through this ONE
   uniform block: a single pre-allocated Float32Array uploaded with
   a single bufferSubData per frame. The #defines keep shader
   bodies readable. */
layout(std140) uniform Frame {
  mat4 uViewProj;
  vec4 uCam0;      // camPos.xyz, tanHalf
  vec4 uCam1;      // camRight.xyz, aspect
  vec4 uCam2;      // bead cols, bead rows, first thread index, pxWorld
  vec4 uCam3;      // camFwd.xyz, marbleK
  vec4 uClock;     // time, tick, dt60, charge
  vec4 uSeedSpan;  // seed.xyz, thread pitch
  vec4 uResAll;    // internal res, canvas res
  vec4 uMap;       // xL, xR, resK, dpx
  vec4 uFx;        // bulgeZ, shiftY, shear, smear
  vec4 uAux;       // cloud columns, rows, stride, max push-out
  vec4 uEv[12];    // per event: (x, y, rx, ry), (level, flush, seed, fade)
  vec4 uGlitch;    // billow clock, teleport offset, ghost opacity, glitch burst
  vec4 uGlitch2;   // ICE burst, chunk-out fade, cold ghost, silhouette seed
  vec4 uBand;      // each band's teleport offset on the push
  vec4 uFight;     // shudder, scar, scar seed, idle creep
  vec4 uSil;       // silhouette: centre X, half-width, height, opacity
};
#define EV_N 6
#define uCamPos    uCam0.xyz
#define uTanHalf   uCam0.w
#define uCamRight  uCam1.xyz
#define uAspect    uCam1.w
#define uGrid      uCam2.xyz  // bead columns, rows, first thread index
#define uPxWorld   uCam2.w    // world size of one internal pixel at the wall
#define uCamFwd    uCam3.xyz
#define uMarbleK   uCam3.w    // marble domain X scale (>1 in portrait)
#define uTime      uClock.x   // smooth clock (s)
#define uTick      uClock.y   // stepped clock (12-18 Hz tick counter)
#define uDt60      uClock.z   // frame time in 60 Hz frames
#define uCharge    uClock.w   // pre-surge charge 0..1
#define uFieldSpan 4.6        // world half-width the field covers (XMAX in engine.ts)
#define uSeed      uSeedSpan.xyz  // per-page-load noise offset
#define uPitch     uSeedSpan.w    // thread pitch (world units)
#define uRes       uResAll.xy // internal resolution (px)
#define uCanvas    uResAll.zw // output resolution (px)
#define uXL        uMap.x     // wall x at the left / right screen edge
#define uXR        uMap.y
#define uResK      uMap.z     // px scale relative to 1080p
#define uDpx       uMap.w     // dither / scanline cell size (px)
#define uGTime     uGlitch.x  // the billow's clock: smooth, except that a hitch holds it still
#define uPose      uGlitch.y  // offset on it: jumps when an interrupt teleports the cloud
#define uGhost     uGlitch.z  // > 0 while the cloud draws its pre-teleport pose as a ghost: its opacity
#define uStrainK   uGlitch.w  // glitch burst, 0..1: non-zero only for ~0.1 s after an interrupt
#define uIce       uGlitch2.x // the burst's cobalt ICE share (yank-backs only)
#define uChunk     uGlitch2.y // the fade at which the last collapse twitch knocked chunks out
#define uGhostCold uGlitch2.z // 1 when the ghost is of a yank-back
#define uShudder   uFight.x   // 1..0 for ~0.13 s after the wall yanks part of a cloud back
#define uScar      uFight.y   // 1..0 for ~0.22 s after it: the scar down the threads behind
#define uScarSeed  uFight.z   // picks which thread bundles carry the scar
#define uIdle      uFight.w   // 0..1 as the wall leans in on a visitor who has stopped moving
#define uSilSeed   uGlitch2.w // re-rolled for each silhouette
#define uShiftY    uFx.y      // vertical lens shift (NDC)
#define uShear     uFx.z      // 0 disables tearing (reduced motion)
#define uSmear     uFx.w      // <1 damps carry (reduced motion)
#define uCloud     uAux       // cloud lattice: columns, rows, stride (thread pitches), max push-out

uniform sampler2D uField;   // 1-D pressure field: R bulge, G glow, B strain, A probe

// Hash-without-sine (Hoskins) — stable across GPU vendors.
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float hash31(vec3 p3){
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// 3-D value noise from a 64³ random texture. Smoothing the
// fractional part before the lookup makes the GPU's trilinear
// filter produce exactly the smoothstep-interpolated lattice a
// hashed value noise would — in one fetch instead of eight hashes.
// The wall evaluates this ~60 times per pixel, so that is the
// difference between a workstation-only shader and one a laptop
// can run.
uniform highp sampler3D uNoise;
float vnoise3(vec3 p){
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return texture(uNoise, (i + f + 0.5) * (1.0 / 64.0)).r;
}

// fBm with a caller-chosen octave count, normalised to 0..1.
float fbmN(vec3 p, int n){
  float a = 0.5;
  float s = 0.0;
  float w = 0.0;
  for (int i = 0; i < n; i++) {
    s += a * vnoise3(p);
    w += a;
    p = p * 2.03 + vec3(17.1, 3.7, 9.2);
    a *= 0.5;
  }
  return s / w;
}

float pow2(float x){ return x * x; }

vec4 fieldAt(float x){
  return texture(uField, vec2(x / uFieldSpan * 0.5 + 0.5, 0.5));
}

// How deep a point of the wall sits inside an event, 0..1: a soft
// oval, its outline warped by noise that is seeded by the event, so
// no two are the same shape. a = (x, y, rx, ry).
float evShape(vec4 a, float seed, float x, float y, float t){
  seed = abs(seed);
  vec3 q = vec3(x * 1.3, y * 1.7, seed * 31.0 + t * 0.05);
  vec2 w = vec2(vnoise3(q), vnoise3(q + vec3(7.0, 3.0, 0.0))) - 0.5;
  vec2 d = (vec2(x, y) - a.xy) / a.zw + w * 1.25;
  // Sheared one way or the other by its seed: never a symmetrical oval.
  d.x += (fract(seed * 7.31) - 0.5) * 1.3 * d.y;
  return exp(-dot(d, d));
}

// The fight is not fought everywhere at once. An eruption is split
// into a few irregular bands (horizontal slices crossed with zones of
// thread bundles, feathered where they meet), and each band has its
// own teleport offset: when the wall yanks, most of the cloud goes
// back while one lobe lags, resists or lurches the other way, and a
// crisp, jagged cliff stands between them.
float bandWarp(float x, float y, float seed){
  seed = abs(seed);
  // (The slices come from smooth noise; the zones are hard cuts on
  // bundles of 8 to 24 threads.)
  float bx = floor(x / (uPitch * 16.0) + 0.5 * sin(x * 7.3 + seed * 40.0));
  float q = 2.6 * vnoise3(vec3(x * 1.7, y * 4.3, seed * 23.0))
          + 2.6 * hash11(bx * 1.37 + floor(seed * 97.0));
  float i0 = floor(q);
  float f = smoothstep(0.965, 1.0, q - i0);
  return mix(uBand[int(mod(i0, 4.0))], uBand[int(mod(i0 + 1.0, 4.0))], f);
}

// A stretch of one thread bundle singled out for a tick or two: 1
// inside it. salt separates independent uses, thr sets how rare.
float segAt(float bundle, float y, float salt, float thr){
  float tk = floor(uTick / 2.0);
  float sel = step(thr, hash21(vec2(bundle * 1.37, tk + salt)));
  float yc = 0.25 + 0.55 * hash21(vec2(bundle, tk + salt * 0.31));
  float len = 0.05 + 0.13 * hash21(vec2(tk + salt, bundle * 2.1));
  return sel * step(yc - len, y) * step(y, yc + len);
}

// Signal dropout: a bundle of threads that has lost integrity. Only
// ever applied inside an active rupture.
float dropoutAt(float bundle, float y){
  return segAt(bundle, y, 17.0, 0.955);
}

// View ray through an NDC point. The camera never pitches; the
// vertical framing is a lens shift, so threads stay vertical.
vec3 viewRay(vec2 ndc){
  return uCamFwd
       + uCamRight * (ndc.x * uTanHalf * uAspect)
       + vec3(0.0, 1.0, 0.0) * ((ndc.y - uShiftY) * uTanHalf);
}

// Resting luminance shimmer, 0..1 around 0.5. The wall's real pulse
// is the heartbeat written into the pressure field (breach.ts): a
// physical heave, not a brightness wave. At rest the wall is taut,
// and this only keeps it from being perfectly still.
float pulse(float x, float t){
  float c = vnoise3(vec3(x * 0.5 - t * 0.12, 3.3, t * 0.2));
  return clamp(0.5 + 0.22 * (c - 0.5), 0.0, 1.0);
}
`;

/** Fullscreen triangle from gl_VertexID — no vertex buffer. */
export const FULLSCREEN_VS = `${HEADER}
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;
