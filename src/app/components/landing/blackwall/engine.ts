/* ──────────────────────────────────────────────────────────────
   Blackwall — render engine.

   One WebGL2 context, all fullscreen passes:

     1  wall       ray-cast thread curtain (three depth strata)
        → mipmapped, so the floor can read it blurred
     2  floor      wall copied through + stippled reflective floor
        + cloud    points pushed out of the wall toward the camera,
                   and the void dust (one GL_POINTS draw over both)
     3  feedback   ping-pong pixel-sort / afterimage
     4  bloom      threshold → separable blur at ½ and ¼ resolution
     5  composite  to the canvas: tear, split, dither, colour

   Rules this file holds itself to:

   • No per-frame JS allocation. Every typed array and GL object is
     created at init; fractional state lives in typed arrays (`S`,
     the camera's `f`, the breach engine's `p`); frame-path functions
     exchange values through those arrays rather than as fractional
     arguments; and every per-frame uniform goes to the GPU in ONE
     bufferSubData on a uniform block.

   • Performance is scaled ONLY by the frame-time governor, and only
     along axes that do not change what the wall is: internal render
     resolution and pixel-sort tap count.

   • The GL context can be lost at any time. On loss the loop idles
     and every resource handle is dropped; on restore initGL rebuilds
     all of it.
   ────────────────────────────────────────────────────────────── */

import {
  type GL,
  type Target,
  type Uniforms,
  createTarget,
  deleteTarget,
  link,
  mulberry32,
  resizeTarget,
  uniforms,
} from './gl';
import {
  C_ASPECT,
  C_NDC_X,
  C_NDC_Y,
  C_OUT_X,
  C_OUT_Y,
  C_PAR_X,
  C_PAR_Y,
  C_PORTRAIT,
  C_SHIFT_Y,
  C_TAN_HALF,
  C_TIME,
  C_ZOOM,
  C_V,
  createCamera,
  unprojectToWall,
  updateCamera,
} from './camera';
import {
  B_CHARGE,
  heartPhases,
  B_HEART,
  B_HEART_GAIN,
  B_JITTER,
  B_CHUNK,
  B_FROZEN,
  B_ICEK,
  B_STRAINK,
  B_SCAR,
  B_SCAR_SEED,
  B_SHUDDER,
  B_SIL_X,
  B_SIL_W,
  B_SIL_H,
  B_SIL_A,
  B_SIL_SEED,
  BAND_N,
  EV_FLOATS,
  I_HITCH,
  I_YANK,
  B_DRAG,
  B_DT,
  B_HALF_W,
  B_PEAK_GLOW,
  B_PROBE_K,
  B_PROBE_X,
  B_SPAN,
  B_SPAWN_AMP,
  B_SPAWN_RAD,
  B_SPAWN_X,
  B_SPAWN_Y,
  FIELD_N,
  createBreachEngine,
  releaseBreach,
  skipToSurge,
  spawnBreach,
  updateBreaches,
} from './breach';
import {
  FRAME_FLOATS,
  FULLSCREEN_VS,
  F_CAM_FWD,
  F_CAM_POS,
  F_CAM_RIGHT,
  F_GRID,
  F_CLOCK,
  F_FX,
  F_AUX,
  F_EV,
  F_GLITCH,
  F_GLITCH2,
  F_BAND,
  F_FIGHT,
  F_SIL,
  F_MAP,
  F_RES,
  F_SEED,
  F_VIEW_PROJ,
} from './shaders/common.glsl';
import { FLOOR_FS, MARBLE_FS, WALL_FS } from './shaders/wall.glsl';
import { BEAD_FS, BEAD_VS } from './shaders/curtain.glsl';
import { createBlackwallAudio } from './audio';
import { CLOUD_FS, CLOUD_SLICES, CLOUD_VS, DUST_N } from './shaders/cloud.glsl';
import { BLUR_FS, BRIGHT_FS, COMPOSITE_FS, FEEDBACK_FS } from './shaders/post.glsl';

/** World half-width the pressure field covers. */
const XMAX = 4.6;
const MAX_DPR = 2;
/** Internal render-target pixel budget before governor scaling. */
const MAX_INTERNAL_PIXELS = 2_800_000;
/** How far a full-strength event pushes its cloud out of the wall,
 *  toward the camera (world units; the wall is 1 tall). */
const CLOUD_Z = 0.58;
/** The cloud's emitters sit on every Nth thread and every Nth bead. */
const CLOUD_STRIDE = 2;
/** How fast the cloud's billow flows, against the smooth clock. */
const BILLOW_RATE = 2;
const FRAME_BINDING = 0;

/* ── Governor tiers ───────────────────────────────────────────
   Tier 0 is full quality. Each step trades internal resolution and
   sort taps — never composition, colour or timing. Thread pitch is
   defined in internal pixels, so threads stay hairline at any tier. */
const TIER_SCALE = [1, 0.85, 0.72, 0.6, 0.5];
const TIER_TAPS = [12, 10, 8, 6, 4];
const LAST_TIER = TIER_SCALE.length - 1;

const NOISE_N = 64;
const NOISE_UNIT = 4;
const MARBLE_UNIT = 5;
/** The marble pre-pass target. The field is low-frequency, so this
 *  stays small whatever the screen size. */
const MARBLE_W = 640;
const MARBLE_H = 192;
const MARBLE_U = ['uNoise'] as const;
const WALL_U = ['uField', 'uNoise', 'uMarble'] as const;
const FLOOR_U = ['uWall', 'uNoise', 'uField'] as const;
const BEAD_U = ['uField', 'uNoise', 'uMarble'] as const;
const CLOUD_U = ['uNoise', 'uWall'] as const;
const FEEDBACK_U = ['uField', 'uScene', 'uPrev', 'uTaps'] as const;
const BRIGHT_U = ['uTex'] as const;
const BLUR_U = ['uTex', 'uDir'] as const;
const COMPOSITE_U = ['uField', 'uFb', 'uBloomA', 'uBloomB', 'uNoise'] as const;

// Slots in the engine's Float64Array state block (see `S` below).
const S_LAST = 0; // timestamp of the previous frame
const S_EMA = 1; // smoothed frame time (ms)
const S_TIME = 2; // smooth clock (s)
const S_TICK_ACC = 3;
const S_TICK_INT = 4;
const S_PAR_X = 5; // smoothed parallax
const S_PAR_Y = 6;
const S_PROBE_X = 7; // smoothed probe position / strength
const S_PROBE_K = 8;
const S_DRAG = 9;
const S_TIER_T = 10; // time of the last tier change
const S_STEP_UP_T = 11;
const S_EMA_DOWN = 12; // frame time when the governor last stepped down
const S_STAND_MS = 13;
const S_STAND_UNTIL = 14;
const S_PTR_X = 15; // raw pointer, NDC
const S_PTR_Y = 16;
const S_DOWN_X = 17; // pointer-down position (CSS px) and time
const S_DOWN_Y = 18;
const S_DOWN_T = 19;
const S_FRAME_MS = 20;
const S_DT = 21;
const S_PROX = 22;
const S_TMP = 23;
const S_GTIME = 24; // the billow's clock: smooth, held still by a hitch
const S_POSE = 25; // offset on that clock: jumps when an interrupt teleports it
const S_GHOST = 26; // ghost afterimage opacity, fading to 0
const S_GTIME_PREV = 27; // the clock and offset the ghost is frozen at
const S_POSE_PREV = 28;
const S_GHOST_RATE = 29; // opacity lost per second
const S_GHOST_COLD = 30; // 1 when the ghost is of a yank-back
const S_GTIME_LAST = 31; // the billow's clock as drawn last frame
const S_TRACE_T = 32; // simulated ms since the debug trace last sampled
const S_SIM = 33; // simulated ms since boot (debug trace)
const S_IDLE_T = 34; // seconds since the visitor last did anything
const S_IDLE = 35; // idle creep 0..1
const S_ACT_X = 36; // where the pointer was when it last counted as moving (CSS px)
const S_ACT_Y = 37;
const S_COUNT = 38;

interface Resources {
  pMarble: WebGLProgram;
  marble: Target;
  pWall: WebGLProgram;
  pBead: WebGLProgram;
  pCloud: WebGLProgram;
  pFloor: WebGLProgram;
  pFeedback: WebGLProgram;
  uFeedback: Uniforms<(typeof FEEDBACK_U)[number]>;
  pBright: WebGLProgram;
  pBlur: WebGLProgram;
  uBlur: Uniforms<(typeof BLUR_U)[number]>;
  pComposite: WebGLProgram;
  vao: WebGLVertexArrayObject;
  frameUbo: WebGLBuffer;
  fieldTex: WebGLTexture;
  noiseTex: WebGLTexture;
  wall: Target;
  scene: Target;
  fb0: Target;
  fb1: Target;
  bloomH0: Target;
  bloomH1: Target;
  bloomQ0: Target;
  bloomQ1: Target;
}

export interface BlackwallHandle {
  dispose(): void;
  /** Mute or unmute. Call from a user gesture: turning sound on is
   *  also what unlocks it in the browser. */
  setAudio(on: boolean): void;
}

/** Shape of the opt-in `?debug` inspection hook (window.__blackwall). */
interface DebugHook {
  /** [fps, tier, internalW, internalH, flares, peakGlow, pitchPx,
   *   0, 0, edgeMax, litShare, 0] */
  stats: Float32Array;
  breach(ndcX: number): void;
  hold(ndcX: number): void;
  release(): void;
  point(ndcX: number, ndcY: number): void;
  /** Read back the next composited frame into stats[9..10]. */
  measure(): void;
  /** Jump the cycle to offsetMs into its breakthrough, forced wide
   *  (kind 1, the default) or localized (kind 2); or to its first
   *  probe twitch (kind 3). */
  surge(offsetMs?: number, kind?: number): void;
  /** This cycle's phase durations (ms), then time into it. */
  phases(): number[];
  /** Fire an interrupt now (1 yank-back, 2 forward leap, 3 hitch).
   *  With holdGhost, the ghost it leaves fades ten times slower, so
   *  a screenshot can catch it. */
  interrupt(kind: number, holdGhost?: boolean): void;
  /** Bring a silhouette on behind the wall now (calm phase only). */
  silhouette(): void;
  /** Set the idle creep's clock, in seconds since the last activity. */
  idle(seconds: number): void;
  /** The ambience track: 'none' before the first gesture, 'loading',
   *  then 'file' once it plays or 'missing' if no file is served. */
  audio(): string;
  /** The last rows of the motion trace, oldest first: simulated ms,
   *  the effective push of bands 0, 1 and 2, how hard the hottest
   *  band is pressed against the containment ceiling (0..1), the
   *  slam-shut scar's energy (1..0), and the kind of the interrupt
   *  that fired since the previous row (0 none, 1 yank-back, 2
   *  forward leap, 3 hitch). Sampled every ~100 ms of simulated time
   *  while something is pushing. */
  trace(): number[][];
}

export function createBlackwall(canvas: HTMLCanvasElement): BlackwallHandle | null {
  const ctx = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!ctx) return null;
  const gl: GL = ctx;

  /* ── CPU-side state, allocated once ───────────────────────── */

  // A fresh seed per page load: marbling, thread identities and the
  // flare schedule all differ every visit.
  const seedBase = (Math.random() * 0xffffffff) >>> 0;
  const seedRng = mulberry32(seedBase);

  const cam = createCamera();
  const cf = cam.f;
  const breach = createBreachEngine(seedBase ^ 0x9e3779b9);
  const bp = breach.p;
  const stats = new Float32Array(16);
  // Debug motion trace: a ring of TRACE_N rows of five floats.
  const TRACE_N = 48;
  const trace = new Float32Array(TRACE_N * 6);
  let traceHead = 0;
  let traceCount = 0;
  let traceKind = 0;
  let slowGhost = false;

  // Sound: the ambience track and nothing else. Silent until the
  // visitor's first gesture.
  const audio = createBlackwallAudio();
  // Random lattice for the noise texture (kept for context restore).
  const noiseData = new Uint8Array(NOISE_N * NOISE_N * NOISE_N);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = (seedRng() * 256) | 0;

  /** CPU copy of the Frame uniform block — the only per-frame
   *  uniform data there is. */
  const U = new Float32Array(FRAME_FLOATS);
  /** The block from the events on: all that differs between the
   *  cloud's two draws (this tick's pose, and last tick's as a ghost). */
  const Utail = U.subarray(F_EV);
  /** The events as they stood on the frame before a teleport: what
   *  the ghost afterimage is drawn from. */
  const evPrev = new Float32Array(EV_FLOATS);
  /** The events as drawn last frame. */
  const evLast = new Float32Array(EV_FLOATS);
  /** The band offsets on those same two frames. */
  const bandPrev = new Float32Array(BAND_N);
  const bandLast = new Float32Array(BAND_N);
  // Blur step vectors, rewritten on resize and passed by reference.
  const dirHalfX = new Float32Array(2);
  const dirHalfY = new Float32Array(2);
  const dirQuarterX = new Float32Array(2);
  const dirQuarterY = new Float32Array(2);

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const timeScale = reduceMotion ? 0.45 : 1;
  const parGain = reduceMotion ? 0.35 : 1;
  bp[B_HEART_GAIN] = reduceMotion ? 0.45 : 1;
  // Reduced motion: the smooth base alone. No teleports, tears or ghosts.
  bp[B_JITTER] = reduceMotion ? 0 : 1;
  bp[B_SPAN] = XMAX;

  // Values in the block that never change after boot.
  U[F_SEED] = seedRng() * 97;
  U[F_SEED + 1] = seedRng() * 97;
  U[F_SEED + 2] = seedRng() * 97;
  U[F_AUX + 2] = CLOUD_STRIDE;
  U[F_FX + 2] = reduceMotion ? 0 : 1; // shear
  U[F_FX + 3] = reduceMotion ? 0.6 : 1; // smear

  let R: Resources | null = null;
  let raf = 0;
  let lost = false;
  let disposed = false;
  let needResize = true;

  /* Every fractional number that changes per frame or per event
     lives in this one Float64Array; integers and booleans stay as
     plain variables. */
  const S = new Float64Array(S_COUNT);
  S[S_TIME] = seedRng() * 400;
  S[S_TICK_INT] = 1 / 14;
  S[S_GTIME] = S[S_TIME];
  S[S_GTIME_PREV] = S[S_TIME];
  S[S_GTIME_LAST] = S[S_TIME];
  S[S_EMA] = 16.7;
  S[S_STEP_UP_T] = -1e9;
  S[S_STAND_MS] = 15000;

  // Stepped clock tick counter (integer): micro-corruption only.
  let tick = 0;

  // Sizes (integers).
  let cssW = 1;
  let cssH = 1;
  let cw = 1;
  let ch = 1;
  let iw = 1;
  let ih = 1;
  let pitchPx = 3;
  let beadCols = 1;
  let beadRows = 1;
  let cloudPoints = 0;
  let flip = false;

  // Governor.
  const nav = navigator as Navigator & { deviceMemory?: number };
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  let tier = weak ? 2 : coarse ? 1 : 0;
  /** Best tier the device has proven it cannot hold — the governor
   *  will not climb back above it, which prevents oscillation. */
  let ceilingTier = 0;
  let provingStep = false;

  // Pointer (positions and smoothed values live in S).
  let ptrActive = false;
  let ptrDown = false;
  let pendingTouch = false;
  let dragging = false;
  let heldSlot = -1;

  // Debug readback (only ever touched when ?debug asks for it).
  let measureRequested = false;
  let measureBuf: Uint8Array | null = null;

  /* ── GL resource construction ─────────────────────────────── */

  function initGL(): Resources {
    const pMarble = link(gl, FULLSCREEN_VS, MARBLE_FS, 'marble');
    const pWall = link(gl, FULLSCREEN_VS, WALL_FS, 'wall');
    const pBead = link(gl, BEAD_VS, BEAD_FS, 'bead');
    const pCloud = link(gl, CLOUD_VS, CLOUD_FS, 'cloud');
    const pFloor = link(gl, FULLSCREEN_VS, FLOOR_FS, 'floor');
    const pFeedback = link(gl, FULLSCREEN_VS, FEEDBACK_FS, 'feedback');
    const pBright = link(gl, FULLSCREEN_VS, BRIGHT_FS, 'bright');
    const pBlur = link(gl, FULLSCREEN_VS, BLUR_FS, 'blur');
    const pComposite = link(gl, FULLSCREEN_VS, COMPOSITE_FS, 'composite');

    // Point every program's Frame block at binding 0.
    for (const p of [pMarble, pWall, pBead, pCloud, pFloor, pFeedback, pComposite]) {
      const idx = gl.getUniformBlockIndex(p, 'Frame');
      if (idx !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, idx, FRAME_BINDING);
    }

    const uFeedback = uniforms(gl, pFeedback, FEEDBACK_U);
    const uBright = uniforms(gl, pBright, BRIGHT_U);
    const uBlur = uniforms(gl, pBlur, BLUR_U);
    const uComposite = uniforms(gl, pComposite, COMPOSITE_U);

    // Sampler bindings never change: unit 0 is always the field.
    gl.useProgram(pMarble);
    gl.uniform1i(uniforms(gl, pMarble, MARBLE_U).uNoise, NOISE_UNIT);
    const uWall = uniforms(gl, pWall, WALL_U);
    gl.useProgram(pWall);
    gl.uniform1i(uWall.uField, 0);
    gl.uniform1i(uWall.uNoise, NOISE_UNIT);
    gl.uniform1i(uWall.uMarble, MARBLE_UNIT);
    const uBead = uniforms(gl, pBead, BEAD_U);
    gl.useProgram(pBead);
    gl.uniform1i(uBead.uField, 0);
    gl.uniform1i(uBead.uNoise, NOISE_UNIT);
    gl.uniform1i(uBead.uMarble, MARBLE_UNIT);
    gl.useProgram(pCloud);
    const uCloud = uniforms(gl, pCloud, CLOUD_U);
    gl.uniform1i(uCloud.uNoise, NOISE_UNIT);
    // The cloud reads the wall it is torn out of: unit 1 holds the
    // wall target whenever the cloud is drawn.
    gl.uniform1i(uCloud.uWall, 1);
    const uFloor = uniforms(gl, pFloor, FLOOR_U);
    gl.useProgram(pFloor);
    gl.uniform1i(uFloor.uWall, 1);
    gl.uniform1i(uFloor.uNoise, NOISE_UNIT);
    gl.uniform1i(uFloor.uField, 0);
    gl.useProgram(pFeedback);
    gl.uniform1i(uFeedback.uField, 0);
    gl.uniform1i(uFeedback.uScene, 1);
    gl.uniform1i(uFeedback.uPrev, 2);
    gl.useProgram(pBright);
    gl.uniform1i(uBright.uTex, 1);
    gl.useProgram(pBlur);
    gl.uniform1i(uBlur.uTex, 1);
    gl.useProgram(pComposite);
    gl.uniform1i(uComposite.uField, 0);
    gl.uniform1i(uComposite.uFb, 1);
    gl.uniform1i(uComposite.uBloomA, 2);
    gl.uniform1i(uComposite.uBloomB, 3);
    gl.uniform1i(uComposite.uNoise, NOISE_UNIT);

    // Every pass is a fullscreen triangle generated from gl_VertexID.
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('[blackwall] VAO allocation failed');

    // Frame uniform block. It stays bound to UNIFORM_BUFFER for the
    // life of the context — nothing else ever uses that target.
    const frameUbo = gl.createBuffer();
    if (!frameUbo) throw new Error('[blackwall] uniform buffer allocation failed');
    gl.bindBuffer(gl.UNIFORM_BUFFER, frameUbo);
    gl.bufferData(gl.UNIFORM_BUFFER, U, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, FRAME_BINDING, frameUbo);

    // Pressure field: FIELD_N × 1, half-float so it filters linearly
    // everywhere without an extension.
    const fieldTex = gl.createTexture();
    if (!fieldTex) throw new Error('[blackwall] field texture allocation failed');
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, FIELD_N, 1, 0, gl.RGBA, gl.FLOAT, breach.field);

    // Noise lattice: 64³ random bytes, repeating, trilinear. It
    // lives on its own texture unit for the life of the context.
    const noiseTex = gl.createTexture();
    if (!noiseTex) throw new Error('[blackwall] noise texture allocation failed');
    gl.activeTexture(gl.TEXTURE0 + NOISE_UNIT);
    gl.bindTexture(gl.TEXTURE_3D, noiseTex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(
      gl.TEXTURE_3D, 0, gl.R8, NOISE_N, NOISE_N, NOISE_N, 0, gl.RED, gl.UNSIGNED_BYTE, noiseData,
    );
    gl.activeTexture(gl.TEXTURE0);

    // Marble pre-pass target: fixed size, bound to its own unit for
    // the life of the context (it is never sampled while written).
    gl.activeTexture(gl.TEXTURE0 + MARBLE_UNIT);
    const marble = createTarget(gl, gl.LINEAR);
    resizeTarget(gl, marble, MARBLE_W, MARBLE_H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);

    // The wall target is read by the floor through its mip chain.
    const wall = createTarget(gl, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, wall.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

    return {
      pMarble, marble,
      pWall, pBead, pCloud, pFloor, pFeedback, uFeedback, pBright, pBlur, uBlur, pComposite,
      vao, frameUbo, fieldTex, noiseTex, wall,
      scene: createTarget(gl, gl.LINEAR),
      fb0: createTarget(gl, gl.LINEAR),
      fb1: createTarget(gl, gl.LINEAR),
      bloomH0: createTarget(gl, gl.LINEAR),
      bloomH1: createTarget(gl, gl.LINEAR),
      bloomQ0: createTarget(gl, gl.LINEAR),
      bloomQ1: createTarget(gl, gl.LINEAR),
    };
  }

  function destroyGL(r: Resources): void {
    gl.deleteProgram(r.pMarble);
    deleteTarget(gl, r.marble);
    gl.deleteProgram(r.pWall);
    gl.deleteProgram(r.pBead);
    gl.deleteProgram(r.pCloud);
    gl.deleteProgram(r.pFloor);
    gl.deleteProgram(r.pFeedback);
    gl.deleteProgram(r.pBright);
    gl.deleteProgram(r.pBlur);
    gl.deleteProgram(r.pComposite);
    gl.deleteVertexArray(r.vao);
    gl.deleteBuffer(r.frameUbo);
    gl.deleteTexture(r.fieldTex);
    gl.deleteTexture(r.noiseTex);
    deleteTarget(gl, r.wall);
    deleteTarget(gl, r.scene);
    deleteTarget(gl, r.fb0);
    deleteTarget(gl, r.fb1);
    deleteTarget(gl, r.bloomH0);
    deleteTarget(gl, r.bloomH1);
    deleteTarget(gl, r.bloomQ0);
    deleteTarget(gl, r.bloomQ1);
  }

  /** (Re)size the canvas and every render target for the current
   *  viewport and governor tier, and recompute everything that only
   *  depends on those. Runs on resize and tier change — never in a
   *  steady-state frame, so it is free to allocate. */
  function applyResize(r: Resources): void {
    needResize = false;
    cssW = Math.max(1, canvas.clientWidth);
    cssH = Math.max(1, canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    cw = Math.max(2, Math.round(cssW * dpr));
    ch = Math.max(2, Math.round(cssH * dpr));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;

    const cap = Math.min(1, Math.sqrt(MAX_INTERNAL_PIXELS / (cw * ch)));
    const scale = TIER_SCALE[tier] * cap;
    iw = Math.max(2, Math.round(cw * scale));
    ih = Math.max(2, Math.round(ch * scale));

    resizeTarget(gl, r.wall, iw, ih);
    gl.generateMipmap(gl.TEXTURE_2D);
    resizeTarget(gl, r.scene, iw, ih);
    resizeTarget(gl, r.fb0, iw, ih);
    resizeTarget(gl, r.fb1, iw, ih);
    const hw = Math.max(1, iw >> 1);
    const hh = Math.max(1, ih >> 1);
    resizeTarget(gl, r.bloomH0, hw, hh);
    resizeTarget(gl, r.bloomH1, hw, hh);
    const qw = Math.max(1, iw >> 2);
    const qh = Math.max(1, ih >> 2);
    resizeTarget(gl, r.bloomQ0, qw, qh);
    resizeTarget(gl, r.bloomQ1, qw, qh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    dirHalfX[0] = 1 / hw;
    dirHalfX[1] = 0;
    dirHalfY[0] = 0;
    dirHalfY[1] = 1 / hh;
    dirQuarterX[0] = 1 / qw;
    dirQuarterX[1] = 0;
    dirQuarterY[0] = 0;
    dirQuarterY[1] = 1 / qh;

    gl.useProgram(r.pFeedback);
    gl.uniform1i(r.uFeedback.uTaps, TIER_TAPS[tier]);

    // Framing depends on aspect alone, so everything derived from
    // the visible width is settled here rather than per frame.
    cf[C_ASPECT] = cw / ch;
    updateCamera(cam);
    bp[B_HALF_W] = cf[C_ASPECT] * cf[C_V];

    // Thread pitch is a whole number of internal pixels: ~3 px at
    // 1080p, never fewer than 2.
    const resK = ih / 1080;
    pitchPx = Math.max(2, Math.round(2.5 * resK));
    const pxWorld = (2 * cf[C_V]) / ih;
    U[F_GRID + 3] = pxWorld;
    U[F_SEED + 3] = pitchPx * pxWorld;

    // The bead curtain: one column per thread across the visible
    // wall (plus a margin for parallax), one bead per thread-pitch
    // of height. Its size follows the internal resolution, so the
    // governor scales the bead count without a separate dial.
    const pitch = pitchPx * pxWorld;
    beadCols = Math.ceil((2 * bp[B_HALF_W] * 1.14 + 0.6) / pitch);
    beadRows = Math.ceil(1 / pitch);
    U[F_GRID] = beadCols;
    U[F_GRID + 1] = beadRows;
    // The cloud's emitters: a coarser lattice over the same threads.
    // (In portrait the camera stands closer, so the same push-out
    // would come further across the screen; it is held back a little.)
    const cloudCols = Math.ceil(beadCols / CLOUD_STRIDE) + 1;
    const cloudRows = Math.ceil(beadRows / CLOUD_STRIDE);
    cloudPoints = cloudCols * cloudRows * CLOUD_SLICES;
    U[F_AUX] = cloudCols;
    U[F_AUX + 1] = cloudRows;
    U[F_AUX + 3] = CLOUD_Z * (1 - 0.3 * cf[C_PORTRAIT]);
    U[F_CAM_FWD + 3] = 1 + 0.9 * cf[C_PORTRAIT];
    U[F_RES] = iw;
    U[F_RES + 1] = ih;
    U[F_RES + 2] = cw;
    U[F_RES + 3] = ch;
    U[F_MAP + 2] = resK;
    U[F_MAP + 3] = Math.max(1, Math.floor(ch / 900));
  }

  /* ── Frame ────────────────────────────────────────────────── */

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    const r = R;
    if (r === null || lost || document.hidden) {
      S[S_LAST] = now;
      return;
    }
    if (S[S_LAST] === 0) {
      S[S_LAST] = now;
      S[S_TIER_T] = now + 2500; // settle-in grace
    }
    S[S_FRAME_MS] = now - S[S_LAST];
    S[S_LAST] = now;
    if (S[S_FRAME_MS] > 100) S[S_FRAME_MS] = 100;
    const frameMs = S[S_FRAME_MS];
    S[S_DT] = frameMs / 1000;
    if (S[S_DT] > 0.05) S[S_DT] = 0.05;
    const dt = S[S_DT];

    /* ── Governor ───────────────────────────────────────────
       Smoothed frame time decides the tier. Down fast (2.5 s
       cooldown), up slowly (9 s). If a step up is followed by a
       step down within 7 s the device has shown its ceiling, and
       the governor stops retrying — no visible oscillation.

       Every step down is then PROVED: if frame time has not
       improved 2.5 s later, the cap is not this renderer (a
       throttled rAF, a 30 Hz low-power mode, another tab hogging
       the GPU), so the quality is given back and the governor
       stands down for a while, longer each time. Stalls (≥100 ms)
       are pauses, not load, and never enter the average. */
    if (frameMs > 0 && frameMs < 100) S[S_EMA] += (frameMs - S[S_EMA]) * 0.06;
    const ema = S[S_EMA];
    if (now - S[S_TIER_T] > 2500) {
      if (provingStep) {
        provingStep = false;
        if (ema > S[S_EMA_DOWN] * 0.88) {
          tier--;
          S[S_TIER_T] = now;
          needResize = true;
          S[S_STAND_MS] *= 2;
          if (S[S_STAND_MS] > 300000) S[S_STAND_MS] = 300000;
          S[S_STAND_UNTIL] = now + S[S_STAND_MS];
        }
      } else if (now < S[S_STAND_UNTIL]) {
        // externally capped — leave quality alone
      } else if (ema > 21.5 && tier < LAST_TIER) {
        if (now - S[S_STEP_UP_T] < 7000) ceilingTier = tier + 1;
        tier++;
        S[S_TIER_T] = now;
        needResize = true;
        provingStep = true;
        S[S_EMA_DOWN] = ema;
      } else if (ema < 17.5 && tier > ceilingTier && now - S[S_TIER_T] > 9000) {
        tier--;
        S[S_TIER_T] = now;
        S[S_STEP_UP_T] = now;
        needResize = true;
      }
    }
    if (needResize) applyResize(r);

    /* ── Clocks ─────────────────────────────────────────────
       The smooth clock advances every frame at native refresh; the
       camera, the void dust and the resting wall's slow drift read
       it. The billow's clock (uGTime) is smooth too, and runs
       faster, but it belongs to the breakthroughs: a hitch holds it
       still, and an interrupt teleports it (see below, after the
       breach engine has decided whether one fires this frame).
       `tick` is the stepped clock, ~14 Hz, quicker during a glitch
       burst: only tear patterns and other micro-corruption read it. */
    S[S_TIME] += dt * timeScale;
    S[S_TICK_ACC] += dt;
    if (S[S_TICK_ACC] >= S[S_TICK_INT]) {
      S[S_TICK_ACC] = 0;
      tick = (tick + 1) & 0xffff;
      S[S_TICK_INT] = bp[B_STRAINK] > 0 ? 1 / 24 : 1 / 14;
    }

    /* ── Pointer → camera, probe ────────────────────────────── */
    const kPar = 1 - Math.exp(-dt * 3.2);
    S[S_PAR_X] += (S[S_PTR_X] * parGain - S[S_PAR_X]) * kPar;
    S[S_PAR_Y] += (S[S_PTR_Y] * parGain - S[S_PAR_Y]) * kPar;
    cf[C_PAR_X] = S[S_PAR_X];
    cf[C_PAR_Y] = S[S_PAR_Y];
    cf[C_TIME] = S[S_TIME];

    /* ── Idle creep ─────────────────────────────────────────
       It leans closer when you stop moving. Nothing for the first
       eight seconds of stillness; over the next fourteen the wall
       eases in: the camera dollies forward a few percent, the cold
       folds brighten, more threads spit. The moment the visitor
       moves, it recoils within about a quarter of a second. */
    S[S_IDLE_T] += dt;
    S[S_TMP] = (S[S_IDLE_T] - 8) / 14;
    if (S[S_TMP] < 0) S[S_TMP] = 0;
    else if (S[S_TMP] > 1) S[S_TMP] = 1;
    S[S_TMP] = S[S_TMP] * S[S_TMP] * (3 - 2 * S[S_TMP]);
    if (S[S_TMP] < S[S_IDLE]) S[S_IDLE] += (S[S_TMP] - S[S_IDLE]) * (1 - Math.exp(-dt / 0.075));
    else S[S_IDLE] = S[S_TMP];
    cf[C_ZOOM] = reduceMotion ? 0 : S[S_IDLE];
    updateCamera(cam);

    cf[C_NDC_X] = S[S_PTR_X];
    cf[C_NDC_Y] = S[S_PTR_Y];
    unprojectToWall(cam);
    const wx = cf[C_OUT_X];
    // Proximity: 1 while the pointer is over the wall, fading out
    // within half a wall-height above or below it.
    S[S_PROX] = 0;
    if (ptrActive) {
      S[S_TMP] = 0;
      if (cf[C_OUT_Y] < 0) S[S_TMP] = -cf[C_OUT_Y];
      else if (cf[C_OUT_Y] > 1) S[S_TMP] = cf[C_OUT_Y] - 1;
      S[S_TMP] = (S[S_TMP] - 0.05) / 0.5;
      if (S[S_TMP] < 0) S[S_TMP] = 0;
      else if (S[S_TMP] > 1) S[S_TMP] = 1;
      const pt = S[S_TMP];
      S[S_PROX] = 1 - pt * pt * (3 - 2 * pt);
    }
    const prox = S[S_PROX];
    S[S_PROBE_K] += (prox - S[S_PROBE_K]) * (1 - Math.exp(-dt * 8));
    S[S_PROBE_X] += (wx - S[S_PROBE_X]) * (1 - Math.exp(-dt * 16));
    S[S_DRAG] += ((dragging ? 1 : 0) - S[S_DRAG]) * (1 - Math.exp(-dt * 6));

    // A touch held still becomes a sustained flare.
    if (pendingTouch && now - S[S_DOWN_T] > 180) {
      pendingTouch = false;
      heldSlot = fireAtPointer(true);
    }

    bp[B_DT] = dt * 1000;
    bp[B_PROBE_X] = S[S_PROBE_X];
    bp[B_PROBE_K] = S[S_PROBE_K];
    bp[B_DRAG] = S[S_DRAG];
    updateBreaches(breach);

    /* ── Teleports ──────────────────────────────────────────
       Between interrupts everything a breakthrough does is smooth.
       On the frame one fires, the pose it had a frame ago is kept
       as a ghost (drawn below at 0.42 opacity, fading out over
       180–260 ms while the real cloud carries on from where it
       landed), and the billow's clock jumps: back a little on a
       yank, well forward on a leap. */
    breach.cue = 0;
    breach.twitchSnap = false;
    if (breach.teleport !== 0) {
      traceKind = breach.teleport;
      if (breach.teleport !== I_HITCH) {
        evPrev.set(evLast);
        bandPrev.set(bandLast);
        S[S_GTIME_PREV] = S[S_GTIME_LAST];
        S[S_POSE_PREV] = S[S_POSE];
        S[S_GHOST] = 0.42 * (0.3 + 0.7 * breach.strength);
        S[S_GHOST_RATE] = (S[S_GHOST] / (0.18 + seedRng() * 0.08)) * (slowGhost ? 0.1 : 1);
        slowGhost = false;
        S[S_GHOST_COLD] = breach.teleport === I_YANK ? 1 : 0;
        S[S_POSE] += breach.poseJump;
      }
      breach.teleport = 0;
      breach.poseJump = 0;
    }
    if (S[S_GHOST] > 0) {
      S[S_GHOST] -= S[S_GHOST_RATE] * dt;
      if (S[S_GHOST] < 0) S[S_GHOST] = 0;
    }
    if (bp[B_FROZEN] === 0) S[S_GTIME] += dt * timeScale * BILLOW_RATE;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, r.fieldTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, FIELD_N, 1, gl.RGBA, gl.FLOAT, breach.field);

    /* ── Frame uniform block ────────────────────────────────── */
    U.set(cam.viewProj, F_VIEW_PROJ);
    U[F_CAM_POS] = cam.pos[0];
    U[F_CAM_POS + 1] = cam.pos[1];
    U[F_CAM_POS + 2] = cam.pos[2];
    U[F_CAM_POS + 3] = cf[C_TAN_HALF];
    U[F_CAM_RIGHT] = cam.right[0];
    U[F_CAM_RIGHT + 1] = cam.right[1];
    U[F_CAM_RIGHT + 2] = cam.right[2];
    U[F_CAM_RIGHT + 3] = cf[C_ASPECT];
    U[F_CAM_FWD] = cam.fwd[0];
    U[F_CAM_FWD + 1] = cam.fwd[1];
    U[F_CAM_FWD + 2] = cam.fwd[2];
    U[F_CLOCK] = S[S_TIME];
    U[F_CLOCK + 1] = tick;
    U[F_CLOCK + 2] = dt * 60;
    // (The pre-surge charge is a faint cold cast, not a colour change.)
    U[F_CLOCK + 3] = bp[B_CHARGE] * 0.35;
    U.set(breach.ev, F_EV);
    U[F_GLITCH] = S[S_GTIME];
    U[F_GLITCH + 1] = S[S_POSE];
    U[F_GLITCH + 2] = 0;
    U[F_GLITCH + 3] = bp[B_STRAINK];
    U[F_GLITCH2] = bp[B_ICEK];
    U[F_GLITCH2 + 1] = bp[B_CHUNK];
    U[F_GLITCH2 + 2] = S[S_GHOST_COLD];
    U[F_GLITCH2 + 3] = bp[B_SIL_SEED];
    U[F_SIL] = bp[B_SIL_X];
    U[F_SIL + 1] = bp[B_SIL_W];
    U[F_SIL + 2] = bp[B_SIL_H];
    U[F_SIL + 3] = bp[B_SIL_A];
    U.set(breach.band, F_BAND);
    U[F_FIGHT] = bp[B_SHUDDER];
    U[F_FIGHT + 1] = bp[B_SCAR];
    U[F_FIGHT + 2] = bp[B_SCAR_SEED];
    U[F_FIGHT + 3] = S[S_IDLE];
    U[F_FX + 1] = cf[C_SHIFT_Y];
    // Wall X at the left and right screen edges, for the post passes.
    cf[C_NDC_Y] = 0;
    cf[C_NDC_X] = -1;
    unprojectToWall(cam);
    U[F_MAP] = cf[C_OUT_X];
    cf[C_NDC_X] = 1;
    unprojectToWall(cam);
    U[F_MAP + 1] = cf[C_OUT_X];
    // First thread index of the bead grid: centred on what is in view.
    U[F_GRID + 2] = Math.floor(
      ((U[F_MAP] + U[F_MAP + 1]) * 0.5) / U[F_SEED + 3] - beadCols * 0.5,
    );
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, U);

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(r.vao);

    /* ── Pass 0 — the marbled field, small ──────────────────── */
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.marble.fbo);
    gl.viewport(0, 0, MARBLE_W, MARBLE_H);
    gl.useProgram(r.pMarble);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* ── Pass 1 — the wall ──────────────────────────────────── */
    // The two deep strata, ray-cast: the taut wall that stays put.
    gl.viewport(0, 0, iw, ih);
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.wall.fbo);
    gl.useProgram(r.pWall);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // The front curtain: one draw of beads, in three dimensions.
    // Light adds; the displacement tint in alpha takes the maximum.
    gl.enable(gl.BLEND);
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(r.pBead);
    gl.drawArrays(gl.POINTS, 0, beadCols * beadRows);
    gl.disable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);

    /* ── Pass 2 — wall + reflective floor ───────────────────── */
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, r.wall.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.scene.fbo);
    gl.useProgram(r.pFloor);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // The cloud and the void dust, over wall and floor alike: points
    // pushed out of the wall toward the camera. The dust is always
    // drawn; the emitters only while something is pushing.
    gl.enable(gl.BLEND);
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(r.pCloud);
    gl.drawArrays(gl.POINTS, 0, DUST_N + (bp[B_HEART] > 0.004 ? cloudPoints : 0));
    // Teleport ghost: the pose the cloud had on the frame before it was
    // yanked back or leapt forward, drawn again behind the live one
    // while it fades. Only the tail of the block differs.
    if (S[S_GHOST] > 0.004) {
      U.set(evPrev, F_EV);
      U.set(bandPrev, F_BAND);
      U[F_GLITCH] = S[S_GTIME_PREV];
      U[F_GLITCH + 1] = S[S_POSE_PREV];
      U[F_GLITCH + 2] = S[S_GHOST];
      gl.bufferSubData(gl.UNIFORM_BUFFER, F_EV * 4, Utail);
      gl.drawArrays(gl.POINTS, 0, DUST_N + cloudPoints);
      U.set(breach.ev, F_EV);
      U.set(breach.band, F_BAND);
      U[F_GLITCH] = S[S_GTIME];
      U[F_GLITCH + 1] = S[S_POSE];
      U[F_GLITCH + 2] = 0;
      gl.bufferSubData(gl.UNIFORM_BUFFER, F_EV * 4, Utail);
    }
    evLast.set(breach.ev);
    bandLast.set(breach.band);
    S[S_GTIME_LAST] = S[S_GTIME];
    gl.disable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);

    /* ── Pass 3 — feedback ping-pong ────────────────────────── */
    const prev = flip ? r.fb1 : r.fb0;
    const next = flip ? r.fb0 : r.fb1;
    flip = !flip;
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
    gl.useProgram(r.pFeedback);
    gl.bindTexture(gl.TEXTURE_2D, r.scene.tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, prev.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* ── Pass 4 — bloom ─────────────────────────────────────── */
    // Unbind unit 2 so `prev` is free to become next frame's target.
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE1);

    gl.bindFramebuffer(gl.FRAMEBUFFER, r.bloomH0.fbo);
    gl.viewport(0, 0, r.bloomH0.w, r.bloomH0.h);
    gl.useProgram(r.pBright);
    gl.bindTexture(gl.TEXTURE_2D, next.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(r.pBlur);
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.bloomH1.fbo);
    gl.bindTexture(gl.TEXTURE_2D, r.bloomH0.tex);
    gl.uniform2fv(r.uBlur.uDir, dirHalfX);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.bloomH0.fbo);
    gl.bindTexture(gl.TEXTURE_2D, r.bloomH1.tex);
    gl.uniform2fv(r.uBlur.uDir, dirHalfY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, r.bloomQ1.fbo);
    gl.viewport(0, 0, r.bloomQ0.w, r.bloomQ0.h);
    gl.bindTexture(gl.TEXTURE_2D, r.bloomH0.tex);
    gl.uniform2fv(r.uBlur.uDir, dirQuarterX);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.bloomQ0.fbo);
    gl.bindTexture(gl.TEXTURE_2D, r.bloomQ1.tex);
    gl.uniform2fv(r.uBlur.uDir, dirQuarterY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* ── Pass 5 — composite to the canvas ───────────────────── */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(r.pComposite);
    gl.bindTexture(gl.TEXTURE_2D, next.tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, r.bloomH0.tex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, r.bloomQ0.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Leave units 1–3 unbound so their textures can be render
    // targets again next frame without a feedback loop.
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);

    if (measureRequested) runMeasure();

    stats[0] = 1000 / S[S_EMA];
    stats[1] = tier;
    stats[2] = iw;
    stats[3] = ih;
    stats[4] = breach.activeCount;
    stats[5] = bp[B_PEAK_GLOW];
    stats[6] = pitchPx;
    stats[7] = beadCols * beadRows;
    stats[8] = bp[B_HEART];
    stats[12] = S[S_IDLE];
    stats[13] = bp[B_SIL_A];

    // Debug motion trace, in simulated time (so it reads the same
    // however the browser is throttling this tab).
    if (debug) {
      S[S_SIM] += bp[B_DT];
      S[S_TRACE_T] += bp[B_DT];
      if (bp[B_HEART] > 0.004 && S[S_TRACE_T] >= 100) {
        S[S_TRACE_T] = 0;
        const k = traceHead * 6;
        // The strongest event's base level, and what three of its
        // bands make of it.
        let lv = 0;
        for (let i = 4; i < EV_FLOATS; i += 8) if (breach.ev[i] > lv) lv = breach.ev[i];
        trace[k] = S[S_SIM];
        trace[k + 1] = lv * (1 + breach.band[0]);
        trace[k + 2] = lv * (1 + breach.band[1]);
        trace[k + 3] = lv * (1 + breach.band[2]);
        // How hard the hottest band is pressed against the ceiling.
        S[S_TMP] = (bp[B_HEART] - 0.78) / 0.27;
        if (S[S_TMP] < 0) S[S_TMP] = 0;
        else if (S[S_TMP] > 1) S[S_TMP] = 1;
        trace[k + 4] = S[S_TMP] * S[S_TMP] * (3 - 2 * S[S_TMP]);
        trace[k + 5] = bp[B_SCAR] + traceKind * 10;
        traceKind = 0;
        traceHead = (traceHead + 1) % TRACE_N;
        if (traceCount < TRACE_N) traceCount++;
      }
    }
  }

  /** Debug-only readback of the frame just composited. Allocates,
   *  which is why it is never called unless ?debug asked for it. */
  function runMeasure(): void {
    measureRequested = false;
    const size = cw * ch * 4;
    if (measureBuf === null || measureBuf.length !== size) measureBuf = new Uint8Array(size);
    gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, measureBuf);
    const buf = measureBuf;
    const edgeRows = Math.max(1, Math.floor(ch * 0.05));
    let edgeMax = 0;
    let lit = 0;
    let wallPx = 0;
    // GL rows run bottom-up: the wall spans NDC -0.42 … 0.60.
    const y0 = Math.floor(ch * 0.29);
    const y1 = Math.ceil(ch * 0.8);
    for (let y = 0; y < ch; y++) {
      const edge = y >= ch - edgeRows;
      const band = y >= y0 && y < y1;
      if (!edge && !band) continue;
      for (let x = 0; x < cw; x++) {
        const k = (y * cw + x) * 4;
        if (edge) {
          const m = Math.max(buf[k], buf[k + 1], buf[k + 2]);
          if (m > edgeMax) edgeMax = m;
        }
        if (band) {
          wallPx++;
          if (buf[k] > 24) lit++;
        }
      }
    }
    stats[9] = edgeMax;
    stats[10] = wallPx > 0 ? lit / wallPx : 0;

    // Share of the wall that reads as true black (< 5% luminance),
    // judged on 6×6 px blocks so thread gaps inside a lit mass do
    // not count as black. Sampled inside the wall's bounds.
    const B = 6;
    const bx0 = Math.floor(cw * 0.12);
    const bx1 = Math.floor(cw * 0.88);
    const by0 = Math.floor(ch * 0.31);
    const by1 = Math.floor(ch * 0.74);
    let blocks = 0;
    let dark = 0;
    for (let y = by0; y + B <= by1; y += B) {
      for (let x = bx0; x + B <= bx1; x += B) {
        let sum = 0;
        for (let j = 0; j < B; j++) {
          for (let i = 0; i < B; i++) {
            const k = ((y + j) * cw + x + i) * 4;
            // Red channel, not Rec.709 luminance: a saturated red of
            // 23% intensity has a "luminance" of 5% yet is plainly lit.
            sum += buf[k];
          }
        }
        blocks++;
        if (sum / (B * B) < 0.05 * 255) dark++;
      }
    }
    stats[11] = blocks > 0 ? dark / blocks : 0;
  }

  /* ── Events ───────────────────────────────────────────────── */

  /** The visitor did something: the idle creep starts over. */
  function wake(): void {
    S[S_IDLE_T] = 0;
  }

  function onKey(): void {
    wake();
    audio?.unlock();
  }

  function setPointer(e: PointerEvent): void {
    S[S_PTR_X] = (e.clientX / cssW) * 2 - 1;
    S[S_PTR_Y] = 1 - (e.clientY / cssH) * 2;
  }

  /** Start an eruption under the pointer (S_PTR_X/Y): at its X, and
   *  at its height held inside the body of the wall. The radius
   *  narrows in portrait framing, where the same world width is a
   *  much larger share of the screen. */
  function fireAtPointer(held: boolean): number {
    cf[C_NDC_X] = S[S_PTR_X];
    cf[C_NDC_Y] = S[S_PTR_Y];
    unprojectToWall(cam);
    bp[B_SPAWN_X] = cf[C_OUT_X];
    bp[B_SPAWN_Y] = cf[C_OUT_Y];
    if (bp[B_SPAWN_Y] < 0.32) bp[B_SPAWN_Y] = 0.32;
    else if (bp[B_SPAWN_Y] > 0.74) bp[B_SPAWN_Y] = 0.74;
    bp[B_SPAWN_AMP] = 1;
    bp[B_SPAWN_RAD] = 0.24 * (1 - 0.4 * cf[C_PORTRAIT]);
    return spawnBreach(breach, held);
  }

  function onPointerMove(e: PointerEvent): void {
    setPointer(e);
    // (A 6 px deadzone: a hand resting on a mouse is still idle.)
    if (Math.abs(e.clientX - S[S_ACT_X]) + Math.abs(e.clientY - S[S_ACT_Y]) > 6) {
      S[S_ACT_X] = e.clientX;
      S[S_ACT_Y] = e.clientY;
      wake();
    }
    if (e.pointerType !== 'touch' || ptrDown) ptrActive = true;
    if (ptrDown && pendingTouch) {
      if (Math.abs(e.clientX - S[S_DOWN_X]) + Math.abs(e.clientY - S[S_DOWN_Y]) > 14) {
        pendingTouch = false;
        dragging = true;
      }
    }
  }

  function onPointerDown(e: PointerEvent): void {
    wake();
    audio?.unlock();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    setPointer(e);
    ptrDown = true;
    ptrActive = true;
    S[S_DOWN_X] = e.clientX;
    S[S_DOWN_Y] = e.clientY;
    S[S_DOWN_T] = performance.now();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety, not a requirement */
    }
    if (e.pointerType === 'touch') {
      // Decide between tap, hold and drag once we know more.
      pendingTouch = true;
      dragging = false;
    } else {
      heldSlot = fireAtPointer(true);
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (!ptrDown) return;
    ptrDown = false;
    if (pendingTouch) {
      // Quick tap: a full surge at that X.
      pendingTouch = false;
      fireAtPointer(false);
    }
    if (heldSlot >= 0) {
      releaseBreach(breach, heldSlot);
      heldSlot = -1;
    }
    dragging = false;
    if (e.pointerType === 'touch') ptrActive = false;
  }

  function onPointerLeave(): void {
    if (!ptrDown) ptrActive = false;
  }

  /** The pointer-up never arrived (capture lost, window blurred,
   *  tab hidden). A held flare must not stay open forever. */
  function onPointerAbandon(): void {
    ptrDown = false;
    pendingTouch = false;
    dragging = false;
    ptrActive = false;
    if (heldSlot >= 0) {
      releaseBreach(breach, heldSlot);
      heldSlot = -1;
    }
  }

  function onResize(): void {
    needResize = true;
  }

  function onContextLost(e: Event): void {
    // Without preventDefault the browser never fires `restored`.
    e.preventDefault();
    lost = true;
    R = null; // every handle is dead; do not delete, just drop
  }

  function onContextRestored(): void {
    if (disposed) return;
    try {
      R = initGL();
      lost = false;
      needResize = true;
      flip = false;
      S[S_LAST] = 0;
    } catch (err) {
      console.error(err);
    }
  }

  /* ── Boot ─────────────────────────────────────────────────── */

  try {
    R = initGL();
  } catch (err) {
    console.error(err);
    return null;
  }

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('lostpointercapture', onPointerUp);
  window.addEventListener('blur', onPointerAbandon);
  document.addEventListener('visibilitychange', onPointerAbandon);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKey);
  window.addEventListener('wheel', wake, { passive: true });

  const debug =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');
  if (debug) {
    const hook: DebugHook = {
      stats,
      breach(ndcX) {
        S[S_PTR_X] = ndcX;
        S[S_PTR_Y] = 0.1;
        fireAtPointer(false);
      },
      hold(ndcX) {
        S[S_PTR_X] = ndcX;
        S[S_PTR_Y] = 0.1;
        heldSlot = fireAtPointer(true);
      },
      release() {
        if (heldSlot >= 0) releaseBreach(breach, heldSlot);
        heldSlot = -1;
      },
      point(ndcX, ndcY) {
        S[S_PTR_X] = ndcX;
        S[S_PTR_Y] = ndcY;
        ptrActive = true;
      },
      surge(offsetMs = 0, kind = 1) {
        skipToSurge(breach, offsetMs, kind);
      },
      silhouette() {
        breach.silNow = true;
      },
      idle(seconds) {
        S[S_IDLE_T] = seconds;
      },
      audio() {
        return audio === null ? 'unavailable' : audio.state();
      },
      interrupt(kind, holdGhost = false) {
        breach.force = kind;
        slowGhost = holdGhost;
      },
      trace() {
        const rows: number[][] = [];
        for (let i = 0; i < traceCount; i++) {
          const k = ((traceHead - traceCount + i + TRACE_N) % TRACE_N) * 6;
          const kind = Math.floor(trace[k + 5] / 10);
          rows.push([
            Math.round(trace[k]),
            +trace[k + 1].toFixed(3),
            +trace[k + 2].toFixed(3),
            +trace[k + 3].toFixed(3),
            +trace[k + 4].toFixed(2),
            +(trace[k + 5] - kind * 10).toFixed(2),
            kind,
          ]);
        }
        return rows;
      },
      phases() {
        return heartPhases(breach);
      },
      measure() {
        measureRequested = true;
      },
    };
    (window as unknown as { __blackwall?: DebugHook }).__blackwall = hook;
  }

  raf = requestAnimationFrame(frame);

  return {
    setAudio(on) {
      if (audio === null) return;
      if (on) audio.unlock();
      audio.setEnabled(on);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('lostpointercapture', onPointerUp);
      window.removeEventListener('blur', onPointerAbandon);
      document.removeEventListener('visibilitychange', onPointerAbandon);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', wake);
      audio?.dispose();
      if (debug) delete (window as unknown as { __blackwall?: DebugHook }).__blackwall;
      if (R !== null && !gl.isContextLost()) destroyGL(R);
      R = null;
    },
  };
}
