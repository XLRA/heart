/* ──────────────────────────────────────────────────────────────
   Falling rain system.

   Rendering
   ---------
   Five depth layers, drawn two ways:

   • PATH layers (mist, far) — each layer is batched into a single
     path and stroked twice per frame: once at full length (dim
     tail) and once at the head portion (bright). Additive blending
     stacks them so the head is brighter than the tail. These drops
     are tiny and faint; per-drop shading would be invisible, so
     they stay on the cheapest possible path.

   • SPRITE layers (mid, near, bokeh) — each drop is a drawImage of
     a pre-rendered streak sprite under a per-drop transform. The
     sprite carries what a photographed streak actually looks like:
     a soft gaussian cross-section, a tail that thins and fades, a
     bright rounded leading edge. Because every drop is its own
     draw, it can carry its own brightness — which is what lets the
     bolt, the wordmark, gusts and glints light drops individually.
     ~30% of the budget, so a few hundred cheap GPU blits per frame.

   Realism
   -------
   - SHUTTER: streak length = on-screen speed × a single virtual
     exposure time (~1/72s), so speed, gusts and length are always
     physically consistent — gusting air visibly stretches streaks.
   - OUT-OF-FOCUS FOREGROUND: a sparse fifth layer of wide, soft,
     very faint streaks right in front of the lens (the camera is
     focused further back). The strongest depth cue rain has.
     During a strike these catch the light hard.
   - WIND FIELD: lean + local gust speed are sampled per drop from
     a per-frame column table (WIND_COLS columns across the screen).
     Two slow turbulence octaves travel downwind, and each wind
     sheet sweeps across the screen as a FRONT — the upwind side
     leans in first, the far side ~0.9s later. Expressed entirely
     through drop angle + speed (no overlay geometry).
   - Each drop carries a baked-in angular deviation from the local
     wind direction (small-angle rotation, no per-drop sqrt/trig),
     and drifts sideways on a personal sine wave.
   - LIGHTNING:
       • strobe freeze — a return stroke is far shorter than the
         virtual shutter, so at the peak the streaks collapse into
         short bright dashes (rain "frozen" by the flash) for a
         couple of frames, then stretch back out.
       • channel lighting — sprite drops near the active bolt
         channel flare far brighter than drops across the screen.
       • glints — a rotating sparse subset of foreground drops
         sparkles during flash peaks.
   - WORDMARK BACKLIGHT: foreground drops passing near the glowing
     wordmark pick up its light (elliptical falloff around it).
   - DEPTH PARALLAX: each layer carries a depth factor on the same
     axis as the CSS sky (+4, far) / stage (-7, near) parallax.
   - GROUND HAZE: a faint neutral haze pools in the bottom third,
     breathing with the gust envelope and catching every flash.
   - STORM LIFECYCLE: a slow scene-wide intensity arc (see
     stormCycle.ts) scales drop speed, streak brightness, and haze
     here — density is modulated by the orchestrator through
     applyRainDensity.

   Drops that exit the bottom edge are silently rerolled to the
   top — no ground splashes are drawn, deliberately. The scene
   has no committed ground line, so an impact effect at the
   viewport edge ends up reading as a stray bright artifact
   rather than rain hitting a surface.

   Zero per-frame allocations: SoA typed arrays, module-level
   scratch tables, cached gradient + sprites, and colors applied
   through globalAlpha rather than per-frame rgba() strings.
   ────────────────────────────────────────────────────────────── */

type RenderKind = 'path' | 'streak' | 'bokeh';

export interface RainLayer {
  speedMin: number;
  speedMax: number;
  /** Dim tail brightness (path layers: full-length pass). */
  tailAlpha: number;
  /** Bright head brightness (path layers: head pass; sprite
   *  layers: tail + head together set the sprite's peak alpha). */
  headAlpha: number;
  /** Visible core width in px (bokeh: full blur-disc width). */
  width: number;
  proportion: number;
  kind: RenderKind;
  /** How hard a strike's strobe collapses this layer's streaks
   *  (0 = unaffected, 1 = fully frozen to a dot). */
  strobe: number;
  /** Flash brightening gain — big near drops catch far more. */
  flashGain: number;
}

/**
 * Struct-of-arrays storage for one rain layer. Each field is a
 * flat Float32Array spanning all drops — hot-loop access becomes
 * pure indexed reads/writes on contiguous memory.
 *
 * Per-drop fields (all parallel — index `i` references the same
 * drop across every array):
 *   x, y          — current position in CSS pixels
 *   speed         — px/sec, magnitude of velocity vector
 *   length        — streak length at gust 1.0 (speed × shutter)
 *   wobbleAngle   — angular offset from local wind dir (radians)
 *   swaySin/Cos   — sin/cos of the drop's sway phase offset, baked
 *                   at spawn (angle-addition identity — no trig in
 *                   the hot loop)
 *   wobbleAmp     — amplitude of horizontal sway in pixels
 *   size          — per-drop size factor (sprite width + alpha);
 *                   skewed so most drops are slim with the odd fat one
 */
export interface RainSoA {
  /** Allocated capacity — every Float32Array is sized to this. */
  count: number;
  /** Drops actually simulated + drawn (≤ count). Lowered by the
   *  adaptive density governor when frames run long, restored when
   *  headroom returns. On fast machines this always equals count. */
  active: number;
  x: Float32Array;
  y: Float32Array;
  speed: Float32Array;
  length: Float32Array;
  wobbleAngle: Float32Array;
  swaySin: Float32Array;
  swayCos: Float32Array;
  wobbleAmp: Float32Array;
  size: Float32Array;
}

export type LayeredDrops = RainSoA[];

/**
 * Five-layer rain system. Real rain in cinematography is overwhelmingly
 * composed of *faint* streaks of varying depth with a few sharper
 * foreground accents, plus the odd out-of-focus smear right at the lens.
 */
export const LAYERS: readonly RainLayer[] = [
  // Atmospheric mist — distant rain, fast enough to read as motion
  { speedMin: 560,  speedMax: 880,  tailAlpha: 0.025, headAlpha: 0.06, width: 0.4,  proportion: 0.42,  kind: 'path',   strobe: 0.35, flashGain: 0.7 },
  // Far — background rain
  { speedMin: 940,  speedMax: 1380, tailAlpha: 0.045, headAlpha: 0.11, width: 0.55, proportion: 0.30,  kind: 'path',   strobe: 0.55, flashGain: 0.7 },
  // Mid — main visible rain (heavy storm pace)
  { speedMin: 1620, speedMax: 2380, tailAlpha: 0.075, headAlpha: 0.20, width: 0.85, proportion: 0.18,  kind: 'streak', strobe: 0.78, flashGain: 0.8 },
  // Near — sharp foreground accent at terminal velocity
  { speedMin: 2750, speedMax: 4000, tailAlpha: 0.10,  headAlpha: 0.32, width: 1.20, proportion: 0.10,  kind: 'streak', strobe: 0.85, flashGain: 0.9 },
  // Out-of-focus foreground — wide soft smears right at the lens
  { speedMin: 3300, speedMax: 4600, tailAlpha: 0,     headAlpha: 0.034, width: 15,  proportion: 0.018, kind: 'bokeh',  strobe: 0.2,  flashGain: 1.4 },
];

/** Index of the mid layer — the one sprite layer the governor may
 *  drop back to path rendering on struggling devices. */
const MID_LAYER = 2;

/**
 * Per-layer parallax depth, on the SAME axis the CSS layers use:
 * the sky (farthest) translates at +4 × parallax, the stage at -7.
 * Mist sits just in front of the sky; near streaks sit closer to
 * the camera than the wordmark; the out-of-focus layer is right at
 * the lens and swings hardest of all.
 */
const PARALLAX_DEPTH: readonly number[] = [3, 0.5, -3, -9, -16];

/** Virtual exposure time (s). One shutter for every layer — far
 *  drops are shorter purely because they cross the screen slower. */
const SHUTTER_S = 1 / 60;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Reroll drop `i` in `soa` to a fresh randomized state. Used both
 * at spawn (spawnAtTop=false → distribute across viewport) and on
 * exit (spawnAtTop=true → respawn just above the top edge).
 */
function rerollDrop(
  soa: RainSoA,
  i: number,
  layer: RainLayer,
  width: number,
  height: number,
  spawnAtTop: boolean,
) {
  // Bias drops toward the FAST end of their layer's range — heavy
  // storm rain reads as fast streaks with occasional slower drops.
  const t = Math.random();
  const speedT = Math.sqrt(t);
  const speed = lerp(layer.speedMin, layer.speedMax, speedT);
  soa.speed[i] = speed;
  const len = speed * SHUTTER_S * (0.85 + Math.random() * 0.3);
  soa.length[i] = len;
  soa.x[i] = -40 + Math.random() * (width + 80);
  soa.y[i] = spawnAtTop
    ? -len * 2 - Math.random() * 80
    : Math.random() * height;
  soa.wobbleAngle[i] = (Math.random() - 0.5) * 0.12;
  const phase = Math.random() * Math.PI * 2;
  soa.swaySin[i] = Math.sin(phase);
  soa.swayCos[i] = Math.cos(phase);
  // Heavier (faster) drops resist sideways drift more, so amplitude
  // scales inversely with normalized speed.
  soa.wobbleAmp[i] = (0.6 + Math.random() * 1.4) * (1.2 - speedT * 0.6);
  // Cubic skew: most drops slim, the odd fat one. Bokeh blur discs
  // vary more evenly (they're all big; focus distance varies).
  const r = Math.random();
  soa.size[i] = layer.kind === 'bokeh' ? 0.65 + r * 0.8 : 0.8 + r * r * r * 0.75;
}

/** Allocate a single empty layer. */
function emptySoA(count: number): RainSoA {
  return {
    count,
    active:      count,
    x:           new Float32Array(count),
    y:           new Float32Array(count),
    speed:       new Float32Array(count),
    length:      new Float32Array(count),
    wobbleAngle: new Float32Array(count),
    swaySin:     new Float32Array(count),
    swayCos:     new Float32Array(count),
    wobbleAmp:   new Float32Array(count),
    size:        new Float32Array(count),
  };
}

/**
 * Initial-state factory for the orchestrator. Returns a layered
 * SoA with zero drops per layer — used as the placeholder before
 * the first real `makeRaindrops()` call.
 */
export function makeEmptyDrops(): LayeredDrops {
  return LAYERS.map(() => emptySoA(0));
}

export function makeRaindrops(
  width: number,
  height: number,
  total: number,
): LayeredDrops {
  ensureSprites();
  const layered: LayeredDrops = [];
  for (let li = 0; li < LAYERS.length; li++) {
    // Bokeh is a handful regardless of viewport — at least a few
    // so small screens still get the foreground depth cue.
    const raw = Math.round(total * LAYERS[li].proportion);
    const count = LAYERS[li].kind === 'bokeh' ? Math.max(5, raw) : raw;
    const soa = emptySoA(count);
    for (let i = 0; i < count; i++) {
      rerollDrop(soa, i, LAYERS[li], width, height, false);
    }
    layered.push(soa);
  }
  return layered;
}

/** Compute drop count for a viewport based on density target + cap. */
export function rainBudget(width: number, height: number): number {
  // Density: ~1 drop per ~5500 viewport pixels (≈ 380 drops on a
  // 1080p screen, ~670 on a 1440p). The cap is a safety net for
  // ultrawide displays.
  return Math.min(1400, Math.max(160, Math.floor((width * height) / 5500)));
}

/* ── Adaptive density ─────────────────────────────────────────
   Professional real-time scenes never render a fixed particle
   budget — they scale load to the frame budget. The orchestrator
   watches a smoothed frame time and calls this with a factor in
   [0.35, 1]. Layers shed drops UNEVENLY: mist (42% of the budget,
   alpha 0.025 — individually invisible) sheds hardest, the sharp
   near accents barely at all, so the storm keeps its character
   while the fill-rate/path load drops.

   Weights per layer: effective factor = 1 - (1 - factor) × weight.
   At the 0.35 floor: mist keeps ~19%, far ~29%, mid ~48%, near ~67%,
   bokeh ~67% of their drops. On machines holding 60fps this never
   engages — zero visual change. */
const DENSITY_LAYER_WEIGHT: readonly number[] = [1.25, 1.1, 0.8, 0.5, 0.5];

export function applyRainDensity(
  layers: LayeredDrops,
  factor: number,
  width: number,
  height: number,
): void {
  for (let li = 0; li < layers.length; li++) {
    const soa = layers[li];
    if (soa.count === 0) continue;
    const w = DENSITY_LAYER_WEIGHT[li] ?? 1;
    const layerFactor = Math.max(0, Math.min(1, 1 - (1 - factor) * w));
    const target = Math.round(soa.count * layerFactor);
    // Drops coming BACK into the active window have stale positions
    // (frozen where they were deactivated) — reroll them just above
    // the top edge so they rain back in instead of popping mid-air.
    for (let i = soa.active; i < target; i++) {
      rerollDrop(soa, i, LAYERS[li], width, height, true);
    }
    soa.active = target;
  }
}

/* ── Streak sprites ───────────────────────────────────────────
   Built once (resolution-independent, drawn scaled), white on
   transparent; tinted to the scene's neutral grays via the RGB
   baked here and per-drop globalAlpha.

   STREAK — vertical, tail at the top (v=0) → head at the bottom
   (v=1). Gaussian cross-section whose sigma tapers toward the
   tail; brightness ramps up along the length (pow) into a soft
   rounded leading cap.

   BOKEH — an out-of-focus drop smeared by motion: a flat-topped
   soft disc profile with a faint brighter rim (the spherical-drop
   highlight ring of real bokeh), capsule-shaped soft ends, nearly
   uniform along its length. */
const STREAK_SW = 8;
const STREAK_SH = 128;
const STREAK_SIGMA = 1.0;
/** Sprite-px FWHM of the head cross-section — drawn sprite width
 *  is scaled so this maps onto the layer's visible core width. */
const STREAK_FWHM = 2.355 * STREAK_SIGMA;
const BOKEH_SW = 32;
const BOKEH_SH = 128;

let streakSprite: HTMLCanvasElement | null = null;
let bokehSprite: HTMLCanvasElement | null = null;

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function buildSprite(
  w: number,
  h: number,
  rgb: number,
  alphaAt: (x: number, y: number) => number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d')!;
  const img = c.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      d[k] = d[k + 1] = d[k + 2] = rgb;
      d[k + 3] = Math.round(Math.max(0, Math.min(1, alphaAt(x, y))) * 255);
    }
  }
  c.putImageData(img, 0, 0);
  return canvas;
}

function ensureSprites() {
  if (streakSprite && bokehSprite) return;
  const scx = (STREAK_SW - 1) / 2;
  streakSprite = buildSprite(STREAK_SW, STREAK_SH, 245, (x, y) => {
    const v = (y + 0.5) / STREAK_SH;
    let along = Math.pow(v, 1.15);
    if (v > 0.92) along *= 1 - Math.pow((v - 0.92) / 0.08, 2);
    const sigma = STREAK_SIGMA * (0.55 + 0.45 * v);
    const dx = x - scx;
    return along * Math.exp(-(dx * dx) / (2 * sigma * sigma));
  });
  const bcx = (BOKEH_SW - 1) / 2;
  bokehSprite = buildSprite(BOKEH_SW, BOKEH_SH, 235, (x, y) => {
    const v = (y + 0.5) / BOKEH_SH;
    const along = smoothstep(0, 0.2, v) * (1 - smoothstep(0.8, 1, v));
    const r = Math.abs(x - bcx) / (BOKEH_SW / 2 - 1);
    const body = 1 - smoothstep(0.1, 1, r);
    const rim = 0.2 * Math.exp(-((r - 0.78) * (r - 0.78)) / (2 * 0.09 * 0.09));
    return along * (0.85 * body + rim);
  });
}

/* ── Wind sheets ──────────────────────────────────────────
   Periodic gust events. Every ~18-26s a ~4s "sheet" fires:
   - Wind lean steepens by up to ~75%
   - One foreground layer's brightness + length scale up
   - The front SWEEPS across the screen from the upwind side over
     SHEET_TRAVEL_MS, so the lean visibly travels instead of the
     whole field snapping at once
   The gust reads entirely through the drops' own motion — no
   overlay band (an earlier sheen "curtain" swept the screen and
   read as an artificial vertical wave, so it was removed).

   Envelope 0..1 with three phases: ramp-up (~600ms, ease-out),
   plateau (~1.6s), ramp-down (~1.8s, ease-in).
   ────────────────────────────────────────────────────────── */

/** Time for a gust front to cross the full screen width. */
const SHEET_TRAVEL_MS = 900;

export interface WindSheetState {
  /** When the next sheet should fire (ms, performance.now()). */
  nextAt: number;
  /** Current sheet, or null if none active. */
  active: ActiveSheet | null;
}

interface ActiveSheet {
  startTime: number;
  /** Envelope duration in ms (rampUp + plateau + rampDown) as felt
   *  at any one point; the sheet lives SHEET_TRAVEL_MS longer while
   *  the front finishes crossing. */
  duration: number;
  rampUp: number;
  plateau: number;
  rampDown: number;
  /** Peak intensity 0..1 (scales the visual effect). */
  peak: number;
  /** Layer index whose brightness/length visibly thickens. 2 or 3. */
  targetLayer: number;
  /** Sign of the lean steepening (-1 = leans further left, +1 = right). */
  leanDir: number;
}

export function createWindSheetState(now: number): WindSheetState {
  return {
    // Wait 8-15s before the FIRST sheet so the intro lightning lands
    // before the first dramatic gust.
    nextAt: now + 8000 + Math.random() * 7000,
    active: null,
  };
}

function spawnSheet(now: number): ActiveSheet {
  const rampUp = 500 + Math.random() * 250;
  const plateau = 1300 + Math.random() * 800;
  const rampDown = 1500 + Math.random() * 600;
  return {
    startTime: now,
    duration: rampUp + plateau + rampDown,
    rampUp,
    plateau,
    rampDown,
    peak: 0.75 + Math.random() * 0.25,
    // Heavier (closer) layer most of the time — that's what reads
    // as "a sheet of rain just blew past."
    targetLayer: Math.random() < 0.7 ? 3 : 2,
    leanDir: Math.random() < 0.5 ? -1 : 1,
  };
}

/** Sheet envelope 0..1 at `e` ms after the front reached a point. */
function sheetEnvelope(a: ActiveSheet, e: number): number {
  if (e <= 0 || e >= a.duration) return 0;
  if (e < a.rampUp) {
    // Ease-out (fast attack, gust hits hard)
    const t = e / a.rampUp;
    return 1 - (1 - t) * (1 - t);
  }
  if (e < a.rampUp + a.plateau) return 1;
  // Ease-in (slow release as the gust dies away)
  const t = (e - a.rampUp - a.plateau) / a.rampDown;
  return (1 - t) * (1 - t);
}

/** Advance the sheet scheduler; returns the live sheet or null. */
function updateWindSheet(state: WindSheetState, now: number): ActiveSheet | null {
  if (state.active) {
    if (now - state.active.startTime >= state.active.duration + SHEET_TRAVEL_MS) {
      state.active = null;
      // Next sheet 18-26s out.
      state.nextAt = now + 18000 + Math.random() * 8000;
    }
  } else if (now >= state.nextAt) {
    state.active = spawnSheet(now);
  }
  return state.active;
}

/* ── Wind field ───────────────────────────────────────────────
   Per-frame column table: WIND_COLS+1 samples across the screen
   of the local fall direction (unit VX/VY), the local gust speed
   multiplier, and the local sheet envelope. Built once per frame
   (65 sqrt + a few sines), read per drop with one index — so the
   whole field costs nothing per drop beyond a table lookup.
   Adjacent columns differ by a fraction of a degree, so nearest-
   column sampling is visually seamless. */
const WIND_COLS = 64;
const WIND_VX = new Float32Array(WIND_COLS + 1);
const WIND_VY = new Float32Array(WIND_COLS + 1);
const WIND_G = new Float32Array(WIND_COLS + 1);
const WIND_SHEET = new Float32Array(WIND_COLS + 1);

function buildWindField(
  windLean: number,
  sheet: ActiveSheet | null,
  now: number,
  elapsed: number,
) {
  const sheetAge = sheet ? now - sheet.startTime : 0;
  for (let c = 0; c <= WIND_COLS; c++) {
    const xn = c / WIND_COLS;
    // Turbulence — two octaves of lean variation travelling
    // DOWNWIND (toward -x, the way the base lean blows). Small
    // (≈ ±20% of the base lean): felt as the rain field never
    // being perfectly parallel, never seen as a wave.
    const turb =
      Math.sin(xn * 7.1 + elapsed * 0.0013 + 1.3) * 0.028 +
      Math.sin(xn * 15.3 + elapsed * 0.0029 + 0.4) * 0.013;
    let env = 0;
    let lean = windLean + turb;
    if (sheet) {
      // The front reaches the upwind edge first.
      const delay = SHEET_TRAVEL_MS * (sheet.leanDir > 0 ? 1 - xn : xn);
      env = sheetEnvelope(sheet, sheetAge - delay) * sheet.peak;
      lean += sheet.leanDir * 0.18 * env;
    }
    const mag = Math.sqrt(1 + lean * lean);
    WIND_VX[c] = -lean / mag;
    WIND_VY[c] = 1 / mag;
    WIND_G[c] = 1 + 0.18 * env;
    WIND_SHEET[c] = env;
  }
}

/* ── Per-frame rain rendering ───────────────────────────────── */

/**
 * Per-frame inputs. The orchestrator allocates ONE of these
 * (createRainFrame) and mutates it every frame — no per-frame
 * options object.
 */
export interface TickRainOpts {
  ctx: CanvasRenderingContext2D | null;
  layers: LayeredDrops;
  dt: number;
  width: number;
  height: number;
  /** Canvas device-pixel ratio — sprite drops set the full
   *  transform per draw, so they need the base scale. */
  dpr: number;
  /** Scene elapsed in ms. */
  elapsed: number;
  /** performance.now() for sheet timing. */
  now: number;
  /** Lightning flash signal, 0..1. Brightens rain at strike peaks. */
  flashIntensity: number;
  /** Strike strobe 0..1 — return-stroke peaks only (no distant bg
   *  flashes). Collapses streaks into frozen dashes. */
  strobe: number;
  /** Active bolt channel as a straight line (CSS px, screen space)
   *  with its lighting strength 0..1 (0 = no bolt lighting). */
  boltX0: number;
  boltY0: number;
  boltX1: number;
  boltY1: number;
  boltLight: number;
  /** Wordmark center (screen space, parallax-shifted) + how lit
   *  it is 0..1 (0 until the intro strike reveals it). */
  wordX: number;
  wordY: number;
  wordLight: number;
  windSheet: WindSheetState | null;
  /** Smoothed mouse parallax, -1..1 (0 when parallax is inactive).
   *  Drives per-layer depth offsets so the rain reads as a volume. */
  parallaxX: number;
  parallaxY: number;
  /** Storm lifecycle 0..1 (stormCycle.ts). Scales drop speed,
   *  streak brightness, and haze. Density is handled by the
   *  orchestrator (it owns applyRainDensity). */
  lifecycle: number;
  /** Governor says the device is struggling — the mid layer drops
   *  back to cheap batched paths. */
  lowQuality: boolean;
}

export function createRainFrame(): TickRainOpts {
  return {
    ctx: null,
    layers: [],
    dt: 0,
    width: 0,
    height: 0,
    dpr: 1,
    elapsed: 0,
    now: 0,
    flashIntensity: 0,
    strobe: 0,
    boltX0: 0,
    boltY0: 0,
    boltX1: 0,
    boltY1: 0,
    boltLight: 0,
    wordX: 0,
    wordY: 0,
    wordLight: 0,
    windSheet: null,
    parallaxX: 0,
    parallaxY: 0,
    lifecycle: 1,
    lowQuality: false,
  };
}

/* ── Head-segment scratch buffer (path layers) ────────────────
   Module-level singleton, reused across frames + layers. The
   tail pass populates this buffer with [headStartX, headStartY,
   headEndX, headEndY] for every drop — the head pass then just
   iterates the buffer and emits moveTo/lineTo.
   Sized for the largest possible layer (1400 × 0.42 ≈ 588 drops
   × 4 floats), rounded up to 4096 floats. */
const HEAD_SCRATCH = new Float32Array(4096);

/* ── Cached ground-haze gradient ──────────────────────────────
   Pure geometry; the per-frame brightness is applied through
   ctx.globalAlpha. Rebuilt only when the viewport height changes. */
let hazeGradient: CanvasGradient | null = null;
let hazeGradientH = -1;

/** Strength of bolt-channel lighting on sprite drops (alpha ×). */
const BOLT_LIGHT_K = 2.6;
/** Strength of the wordmark backlight on sprite drops (alpha ×). */
const WORD_LIGHT_K = 1.4;

/**
 * One full rain render pass. Mutates `layers` (drops advance +
 * reroll on exit). Returns the active drop count for the debug
 * overlay (a bare number — no per-frame result object).
 */
export function tickRain(opts: TickRainOpts): number {
  const { ctx, layers, dt, width, height, dpr, elapsed, now, flashIntensity } = opts;
  if (!ctx || !opts.windSheet) return 0;
  const parX = opts.parallaxX;
  const parY = opts.parallaxY;

  // ─ Multi-octave wind. Three non-harmonic frequencies so the
  //   pattern never re-aligns into a recognizable cycle.
  const windLean =
    0.14 +
    Math.sin(elapsed * 0.00018 + 0.5) * 0.05 +
    Math.sin(elapsed * 0.00071 + 2.1) * 0.025 +
    Math.sin(elapsed * 0.00193 + 4.2) * 0.012;

  // ─ Wind sheet + per-column wind field.
  const sheet = updateWindSheet(opts.windSheet, now);
  buildWindField(windLean, sheet, now, elapsed);
  const sheetLayer = sheet ? sheet.targetLayer : -1;

  // ─ Global gust envelope (the local sheet boost rides WIND_G).
  const gustRaw =
    Math.sin(elapsed * 0.00045 - 1) * 0.6 +
    Math.sin(elapsed * 0.00091) * 0.4;
  let gust = 1 + Math.max(0, gustRaw) * 0.22;
  // Flash downdraft kick — a nearby strike's pressure wave briefly
  // accelerates the rain. Small (≤10%), peak-gated like flashBoost.
  gust *= 1 + flashIntensity * 0.10;
  // Storm lifecycle — at the calm end drops fall ~12% slower (and
  // streaks shorten with them, since length rides the shutter); at
  // peak they push ~6% past baseline.
  const LC = opts.lifecycle;
  gust *= 0.88 + LC * 0.18;

  // Sway phasor — sin/cos of the shared sway clock, computed ONCE
  // per frame. Each drop combines these with its baked sin/cos
  // phase (angle-addition identity) instead of calling Math.sin.
  const swayT = elapsed * 0.0014;
  const S1 = Math.sin(swayT);
  const C1 = Math.cos(swayT);

  // Streak brightness rides the lifecycle too — a drizzle phase
  // reads dimmer as well as sparser.
  const lcBright = 0.90 + LC * 0.14;
  const HF = 0.32;
  const strobe = opts.strobe;

  // ─ Bolt channel as a line: unit normal + offset, so a drop's
  //   distance to it is one dot product.
  const boltLight = opts.boltLight;
  let bnx = 0;
  let bny = 0;
  let bc = 0;
  let invBoltR = 0;
  if (boltLight > 0) {
    const ldx = opts.boltX1 - opts.boltX0;
    const ldy = opts.boltY1 - opts.boltY0;
    const ll = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
    bnx = -ldy / ll;
    bny = ldx / ll;
    bc = bnx * opts.boltX0 + bny * opts.boltY0;
    invBoltR = 1 / (Math.max(width, height) * 0.11);
  }

  // ─ Wordmark backlight ellipse (word is ~2.4× wider than tall).
  const wordLight = opts.wordLight;
  const wordRx = Math.max(100, Math.min(220, width * 0.1));
  const invRx = 1 / wordRx;
  const invRy = 1 / (wordRx * 0.6);
  const wordX = opts.wordX;
  const wordY = opts.wordY;

  // Rotating glint window — which seventh of each foreground
  // layer's drops sparkles this frame. Advances every 50ms so
  // successive frames of one flash light DIFFERENT drops.
  const glintStep = ((now / 50) | 0) % 7;
  const glintOn = flashIntensity > 0.25;

  const W = width;
  const H = height;
  const DT = dt;
  const colScale = WIND_COLS / W;

  let totalDrops = 0;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  /* ── Ground haze ──────────────────────────────────────────
     Faint neutral haze pooling in the bottom third — the spray /
     suspended water the storm kicks up. Breathes with the gust
     envelope; flashes light it up hard. Drawn BEFORE the streaks
     so the rain falls through it, not behind it. */
  const hazeK =
    (0.7 + Math.max(0, gustRaw) * 0.3 + flashIntensity * 2.2) *
    (0.7 + LC * 0.3);
  const hazeAlpha = Math.min(0.12, 0.030 * hazeK);
  const hazeTop = H * 0.62;
  if (hazeGradient === null || hazeGradientH !== H) {
    hazeGradientH = H;
    hazeGradient = ctx.createLinearGradient(0, hazeTop, 0, H);
    hazeGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    hazeGradient.addColorStop(1, 'rgba(205, 205, 205, 1)');
  }
  ctx.globalAlpha = hazeAlpha;
  ctx.fillStyle = hazeGradient;
  ctx.fillRect(0, hazeTop, W, H - hazeTop);
  ctx.globalAlpha = 1;

  for (let li = 0; li < LAYERS.length; li++) {
    const layer = LAYERS[li];
    const soa = layers[li];
    if (!soa) continue;
    const n = soa.active;
    if (n === 0) continue;
    totalDrops += n;

    const flashBoost = (1 + flashIntensity * layer.flashGain) * lcBright;
    const strobeLen = 1 - strobe * layer.strobe;
    const pf = PARALLAX_DEPTH[li];
    const offX = parX * pf;
    const offY = parY * pf * 0.7;

    const xs     = soa.x;
    const ys     = soa.y;
    const speeds = soa.speed;
    const lens   = soa.length;
    const wAngs  = soa.wobbleAngle;
    const wSins  = soa.swaySin;
    const wCoss  = soa.swayCos;
    const wAmps  = soa.wobbleAmp;
    const sizes  = soa.size;

    const useSprite =
      layer.kind !== 'path' && !(opts.lowQuality && li === MID_LAYER);

    if (useSprite) {
      /* ── Sprite layer — one transformed blit per drop ────────
         Local sprite space: +y = the drop's direction of travel,
         head at y=0, tail stretching back to y=-length. */
      const isBokeh = layer.kind === 'bokeh';
      const sprite = isBokeh ? bokehSprite : streakSprite;
      if (!sprite) continue;
      // Streak sprites: ×1.25 matches the integrated light of the old
      // tail+head line pair, and ×1.2 width gives the soft core a
      // touch more body than a hairline. Bokeh is capped so a lit
      // smear stays translucent instead of turning into a solid bar.
      const baseA = (layer.tailAlpha + layer.headAlpha) * flashBoost * (isBokeh ? 1 : 1.25);
      const widthScale = isBokeh ? layer.width : layer.width * 1.2 * (STREAK_SW / STREAK_FWHM);
      const maxA = isBokeh ? 0.22 : 1;
      const isSheetLayer = li === sheetLayer;
      const strobeBright = 1 + strobe * 0.9;
      const glintK = glintOn && !isBokeh ? 3.0 * flashIntensity : 0;

      for (let i = 0; i < n; i++) {
        let col = ((xs[i] * colScale) | 0);
        if (col < 0) col = 0; else if (col > WIND_COLS) col = WIND_COLS;
        const vx = WIND_VX[col];
        const vy = WIND_VY[col];
        const wAng = wAngs[i];
        const dvx = vx + vy * wAng;
        const dvy = vy - vx * wAng;
        const g = gust * WIND_G[col];
        const speed = speeds[i];
        const len = lens[i];
        const x = xs[i] + dvx * speed * g * DT;
        const y = ys[i] + dvy * speed * g * DT;

        if (y - len * 2 > H || x < -60 || x > W + 60) {
          // Respawns above the top edge — nothing to draw this frame.
          rerollDrop(soa, i, layer, W, H, true);
          continue;
        }
        xs[i] = x;
        ys[i] = y;

        const size = sizes[i];
        const sheetL = isSheetLayer ? WIND_SHEET[col] : 0;
        const wd = widthScale * size;
        let dl = len * g * (1 + sheetL * 0.30) * strobeLen;
        if (isBokeh) dl += wd * 1.4;

        const sx = x + (S1 * wCoss[i] + C1 * wSins[i]) * wAmps[i] + offX;
        const sy = y + offY;

        let light = (1 + sheetL * 0.55) * strobeBright;
        if (boltLight > 0) {
          const dd = (sx * bnx + sy * bny - bc) * invBoltR;
          light += (boltLight * BOLT_LIGHT_K) / (1 + dd * dd);
        }
        if (wordLight > 0) {
          const ex = (sx - wordX) * invRx;
          const ey = (sy - dl * 0.5 * dvy - wordY) * invRy;
          const q = 1 + ex * ex + ey * ey;
          light += (wordLight * WORD_LIGHT_K) / (q * q);
        }
        if (glintK > 0 && (i + glintStep) % 7 === 0) light += glintK;

        let a = baseA * (0.6 + 0.4 * size) * light;
        if (a < 0.004) continue;
        if (a > maxA) a = maxA;
        ctx.globalAlpha = a;
        ctx.setTransform(
          dvy * dpr, -dvx * dpr,
          dvx * dpr, dvy * dpr,
          sx * dpr, sy * dpr,
        );
        ctx.drawImage(sprite, -wd * 0.5, -dl, wd, dl);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      continue;
    }

    /* ── Path layer — two batched strokes (+ glints) ─────────── */
    const hasParallax = offX !== 0 || offY !== 0;
    if (hasParallax) {
      ctx.save();
      ctx.translate(offX, offY);
    }
    // Only the governor-demoted mid layer can be a sheet target here.
    const layerSheet = li === sheetLayer ? WIND_SHEET[WIND_COLS >> 1] : 0;
    const layerLen = (1 + layerSheet * 0.30) * strobeLen;
    const layerBright = (1 + layerSheet * 0.55) * flashBoost;

    let headIdx = 0;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      let col = ((xs[i] * colScale) | 0);
      if (col < 0) col = 0; else if (col > WIND_COLS) col = WIND_COLS;
      const vx = WIND_VX[col];
      const vy = WIND_VY[col];
      const wAng = wAngs[i];
      const dvx = vx + vy * wAng;
      const dvy = vy - vx * wAng;
      const g = gust * WIND_G[col];
      const speed = speeds[i];
      const len = lens[i];
      const x = xs[i] + dvx * speed * g * DT;
      const y = ys[i] + dvy * speed * g * DT;

      if (y - len * 2 > H || x < -60 || x > W + 60) {
        rerollDrop(soa, i, layer, W, H, true);
        continue;
      }
      xs[i] = x;
      ys[i] = y;

      const px = x + (S1 * wCoss[i] + C1 * wSins[i]) * wAmps[i];
      const dl = len * g * layerLen;
      const hl = dl * HF;

      // Tail (full-length, dim) — emitted now.
      ctx.moveTo(px, y);
      ctx.lineTo(px - dvx * dl, y - dvy * dl);

      // Head (32% leading edge, bright) — stashed for the second
      // stroke so the style swaps without reiterating.
      HEAD_SCRATCH[headIdx]     = px;
      HEAD_SCRATCH[headIdx + 1] = y;
      HEAD_SCRATCH[headIdx + 2] = px - dvx * hl;
      HEAD_SCRATCH[headIdx + 3] = y - dvy * hl;
      headIdx += 4;
    }
    ctx.lineWidth = layer.width;
    ctx.strokeStyle = 'rgb(225, 225, 225)';
    ctx.globalAlpha = Math.min(0.95, layer.tailAlpha * layerBright);
    ctx.stroke();

    // Heads stroke slightly wider than tails: a fatter bright
    // leading edge tapering into a thin tail.
    ctx.beginPath();
    for (let j = 0; j < headIdx; j += 4) {
      ctx.moveTo(HEAD_SCRATCH[j],     HEAD_SCRATCH[j + 1]);
      ctx.lineTo(HEAD_SCRATCH[j + 2], HEAD_SCRATCH[j + 3]);
    }
    ctx.lineWidth = layer.width * 1.25;
    ctx.strokeStyle = 'rgb(245, 245, 245)';
    ctx.globalAlpha = Math.min(1, layer.headAlpha * layerBright);
    ctx.stroke();

    // Glints for a demoted foreground layer (sprite layers carry
    // their glints per drop).
    if (glintOn && li >= MID_LAYER) {
      ctx.beginPath();
      for (let j = glintStep * 4; j < headIdx; j += 28) {
        ctx.moveTo(HEAD_SCRATCH[j],     HEAD_SCRATCH[j + 1]);
        ctx.lineTo(HEAD_SCRATCH[j + 2], HEAD_SCRATCH[j + 3]);
      }
      ctx.lineWidth = layer.width * 1.7;
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = Math.min(0.9, layer.headAlpha * 3.2 * flashIntensity);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (hasParallax) ctx.restore();
  }

  ctx.restore();

  return totalDrops;
}
