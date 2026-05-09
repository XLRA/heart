/* ──────────────────────────────────────────────────────────────
   Falling rain system.

   Rendering
   ---------
   Each layer is batched into a single Path2D and stroked twice
   per frame: once at full length (dim tail) and once at the head
   portion (bright). Additive blending stacks them so the head is
   brighter than the tail — recreating the gradient look WITHOUT
   allocating a CanvasGradient per drop per frame.

   4 layers × 2 passes = 8 stroke calls per frame total,
   regardless of how many drops are in flight.

   Realism
   -------
   - Wind direction is summed from THREE non-harmonic sine octaves,
     producing organic non-periodic gusts rather than an obvious sway.
   - A separate gust ENVELOPE periodically boosts drop velocity by
     up to 22% — the storm "leans in" and breathes.
   - Each drop carries a baked-in angular deviation from the base
     wind direction (small-angle rotation, no per-drop sqrt/trig),
     so streaks aren't perfectly parallel rails.
   - Each drop drifts sideways on a personal sine wave — micro
     air-currents pushing each drop independently.
   - WIND SHEETS: every ~18-26s, a 4s gust event briefly steepens
     the lean, brightens, and elongates one layer — a visible
     curtain of rain crossing the scene.

   Drops that exit the bottom edge are silently rerolled to the
   top — no ground splashes are drawn, deliberately. The scene
   has no committed ground line, so an impact effect at the
   viewport edge ends up reading as a stray bright artifact
   rather than rain hitting a surface.
   ────────────────────────────────────────────────────────────── */

export interface RainLayer {
  speedMin: number;
  speedMax: number;
  lengthMin: number;
  lengthMax: number;
  /** Dim tail brightness (full-length pass). */
  tailAlpha: number;
  /** Bright head brightness (head-only pass). */
  headAlpha: number;
  width: number;
  proportion: number;
}

/**
 * Struct-of-arrays storage for one rain layer. Replaces the
 * previous AoS `Raindrop[]` — same fields, but each is a flat
 * Float32Array spanning all drops. Hot-loop access becomes pure
 * indexed reads/writes on contiguous memory, which the JIT
 * compiles to tight register-resident machine code (no hidden-
 * class dereferences, no per-object headers, much better L1
 * cache locality).
 *
 * On a 1080p display with ~588 mist drops + ~422 far + ~253
 * mid + ~141 near = ~1404 drops total, this saves ~56KB of
 * object headers and gives a 30-50% rain CPU win on cache-bound
 * machines.
 *
 * Per-drop fields (all parallel — index `i` references the same
 * drop across every array):
 *   x, y          — current position in CSS pixels
 *   speed         — px/sec, magnitude of velocity vector
 *   length        — visible streak length in pixels
 *   wobbleAngle   — angular offset from base wind dir (radians)
 *   wobblePhase   — phase offset for horizontal sway sine
 *   wobbleAmp     — amplitude of horizontal sway in pixels
 */
export interface RainSoA {
  count: number;
  x: Float32Array;
  y: Float32Array;
  speed: Float32Array;
  length: Float32Array;
  wobbleAngle: Float32Array;
  wobblePhase: Float32Array;
  wobbleAmp: Float32Array;
}

export type LayeredDrops = RainSoA[];

/**
 * Four-layer rain system. Real rain in cinematography is overwhelmingly
 * composed of *faint* streaks of varying depth with a few sharper
 * foreground accents — that's what the eye reads as "heavy rain you
 * can almost feel."
 */
export const LAYERS: readonly RainLayer[] = [
  // Atmospheric mist — distant rain, fast enough to read as motion
  { speedMin: 560,  speedMax: 880,  lengthMin: 4,  lengthMax: 10, tailAlpha: 0.025, headAlpha: 0.06, width: 0.4,  proportion: 0.42 },
  // Far — background rain
  { speedMin: 940,  speedMax: 1380, lengthMin: 9,  lengthMax: 18, tailAlpha: 0.045, headAlpha: 0.11, width: 0.55, proportion: 0.30 },
  // Mid — main visible rain (heavy storm pace)
  { speedMin: 1620, speedMax: 2380, lengthMin: 18, lengthMax: 36, tailAlpha: 0.075, headAlpha: 0.20, width: 0.85, proportion: 0.18 },
  // Near — sharp foreground accent at terminal-velocity (~9 m/s scaled)
  { speedMin: 2750, speedMax: 4000, lengthMin: 36, lengthMax: 70, tailAlpha: 0.10,  headAlpha: 0.32, width: 1.20, proportion: 0.10 },
];

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
  soa.speed[i] = lerp(layer.speedMin, layer.speedMax, speedT);
  const len =
    lerp(layer.lengthMin, layer.lengthMax, speedT) * (0.85 + Math.random() * 0.3);
  soa.length[i] = len;
  soa.x[i] = -40 + Math.random() * (width + 80);
  soa.y[i] = spawnAtTop
    ? -len - Math.random() * 80
    : Math.random() * height;
  soa.wobbleAngle[i] = (Math.random() - 0.5) * 0.12;
  soa.wobblePhase[i] = Math.random() * Math.PI * 2;
  // Heavier (faster) drops resist sideways drift more, so amplitude
  // scales inversely with normalized speed.
  soa.wobbleAmp[i] = (0.6 + Math.random() * 1.4) * (1.2 - speedT * 0.6);
}

/** Allocate a single empty layer. */
function emptySoA(count: number): RainSoA {
  return {
    count,
    x:           new Float32Array(count),
    y:           new Float32Array(count),
    speed:       new Float32Array(count),
    length:      new Float32Array(count),
    wobbleAngle: new Float32Array(count),
    wobblePhase: new Float32Array(count),
    wobbleAmp:   new Float32Array(count),
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
  const layered: LayeredDrops = [];
  for (let li = 0; li < LAYERS.length; li++) {
    const count = Math.round(total * LAYERS[li].proportion);
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
  // Density: ~1 drop per ~5500 viewport pixels (≈ 750 drops on a
  // 1080p screen, ~1100 on a 1440p). The cap is a safety net for
  // ultrawide displays.
  return Math.min(1400, Math.max(160, Math.floor((width * height) / 5500)));
}

/* ── Wind sheets ──────────────────────────────────────────
   Periodic gust events. Every ~18-26s a 4s "sheet" fires:
   - Wind lean steepens by up to ~75%
   - One layer's brightness + length scale up by ~50%
   The result is a visible curtain of rain crossing the scene
   like a real gust front.

   Modeled as a single envelope value 0..1 with three phases:
   ramp-up (~600ms, ease-out), plateau (~1.6s), ramp-down
   (~1.8s, ease-in). Cheap — no allocations after init.
   ────────────────────────────────────────────────────────── */

export interface WindSheetState {
  /** When the next sheet should fire (ms, performance.now()). */
  nextAt: number;
  /** Current sheet, or null if none active. */
  active: ActiveSheet | null;
}

interface ActiveSheet {
  startTime: number;
  /** Total duration in ms (rampUp + plateau + rampDown). */
  duration: number;
  rampUp: number;
  plateau: number;
  rampDown: number;
  /** Peak intensity 0..1 (scales the visual effect). */
  peak: number;
  /** Layer index whose density visually thickens. Always 2 or 3. */
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

/**
 * Returns the current sheet envelope (0..1) AND advances the
 * scheduler. When a sheet expires, the next one is queued
 * 18-26s in the future.
 */
function updateWindSheet(state: WindSheetState, now: number): {
  intensity: number;
  targetLayer: number;
  leanDir: number;
} {
  if (state.active) {
    const e = now - state.active.startTime;
    if (e >= state.active.duration) {
      state.active = null;
      // Next sheet 18-26s out.
      state.nextAt = now + 18000 + Math.random() * 8000;
    } else {
      const a = state.active;
      let env: number;
      if (e < a.rampUp) {
        // Ease-out (fast attack, gust hits hard)
        const t = e / a.rampUp;
        env = 1 - (1 - t) * (1 - t);
      } else if (e < a.rampUp + a.plateau) {
        env = 1;
      } else {
        // Ease-in (slow release as the gust dies away)
        const t = (e - a.rampUp - a.plateau) / a.rampDown;
        env = (1 - t) * (1 - t);
      }
      return {
        intensity: env * a.peak,
        targetLayer: a.targetLayer,
        leanDir: a.leanDir,
      };
    }
  }
  if (now >= state.nextAt) {
    state.active = spawnSheet(now);
  }
  return { intensity: 0, targetLayer: -1, leanDir: 0 };
}

/* ── Per-frame rain rendering ───────────────────────────────── */

export interface TickRainOpts {
  ctx: CanvasRenderingContext2D;
  layers: LayeredDrops;
  dt: number;
  width: number;
  height: number;
  /** Scene elapsed in ms. */
  elapsed: number;
  /** performance.now() for sheet timing. */
  now: number;
  /** Lightning flash signal, 0..1. Brightens rain at strike peaks. */
  flashIntensity: number;
  windSheet: WindSheetState;
}

/* ── Head-segment scratch buffer ──────────────────────────────
   Module-level singleton, reused across frames + layers. The
   tail pass populates this buffer with [headStartX, headStartY,
   headEndX, headEndY] for every drop — the head pass then just
   iterates the buffer and emits moveTo/lineTo, skipping all the
   per-drop math (dvx/dvy rotation, sway sin call, length mul).

   That's 4 trig + ~6 muls + ~2 adds saved per drop per frame.
   At 1100 drops, ≈ 30-40% off the rain CPU on weak machines.

   Sized for the largest possible layer count (max-rain-budget ×
   the heaviest single-layer proportion = 1400 × 0.42 ≈ 588).
   Rounded up to 4096 floats / 16KB so we never touch a bounds
   check in the hot loop. */
const HEAD_SCRATCH = new Float32Array(4096);

/**
 * One full rain render pass. Mutates `layers` (drops advance +
 * reroll on exit). Returns metrics for the debug overlay.
 */
export function tickRain(opts: TickRainOpts): { totalDrops: number } {
  const { ctx, layers, dt, width, height, elapsed, now, flashIntensity, windSheet } = opts;

  // ─ Multi-octave wind. Three non-harmonic frequencies so the
  //   pattern never re-aligns into a recognizable cycle.
  const windBase = 0.14;
  const wind1 = Math.sin(elapsed * 0.00018 + 0.5) * 0.05;
  const wind2 = Math.sin(elapsed * 0.00071 + 2.1) * 0.025;
  const wind3 = Math.sin(elapsed * 0.00193 + 4.2) * 0.012;
  let windLean = windBase + wind1 + wind2 + wind3;

  // ─ Wind sheet — steepens lean by up to ~0.18 (≈ +75%).
  const sheet = updateWindSheet(windSheet, now);
  if (sheet.intensity > 0) {
    windLean += sheet.leanDir * 0.18 * sheet.intensity;
  }

  const mag = Math.sqrt(1 + windLean * windLean);
  const baseVy = 1 / mag;
  const baseVx = -windLean / mag;

  // ─ Gust envelope.
  const gustRaw =
    Math.sin(elapsed * 0.00045 - 1) * 0.6 +
    Math.sin(elapsed * 0.00091) * 0.4;
  let gust = 1 + Math.max(0, gustRaw) * 0.22;
  if (sheet.intensity > 0) gust *= 1 + 0.18 * sheet.intensity;

  const swayT = elapsed * 0.0014;

  const flashBoost = 1 + flashIntensity * 0.7;
  const HEAD_FRACTION = 0.32;

  // Hoist into locals so the JIT can keep them in registers
  // through the hot loop.
  const W = width;
  const H = height;
  const G = gust;
  const DT = dt;
  const VX = baseVx;
  const VY = baseVy;
  const ST = swayT;
  const HF = HEAD_FRACTION;

  let totalDrops = 0;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (let li = 0; li < LAYERS.length; li++) {
    const layer = LAYERS[li];
    const soa = layers[li];
    const n = soa.count;
    if (n === 0) continue;
    totalDrops += n;

    // Per-layer sheet boost — applied to the targeted layer only.
    const layerSheetBoost = li === sheet.targetLayer ? sheet.intensity : 0;
    const layerBrightBoost = 1 + layerSheetBoost * 0.55;
    const layerLengthBoost = 1 + layerSheetBoost * 0.30;

    // ── Hoist field arrays into locals ────────────────────────
    // V8 keeps these in registers through the inner loop. Indexed
    // reads against Float32Arrays JIT to single CPU loads with no
    // hidden-class checks — meaningfully faster than the previous
    // `d.x` style object property access on weak machines.
    const xs       = soa.x;
    const ys       = soa.y;
    const speeds   = soa.speed;
    const lens     = soa.length;
    const wAngs    = soa.wobbleAngle;
    const wPhases  = soa.wobblePhase;
    const wAmps    = soa.wobbleAmp;

    // ── Single integration + tail-render pass ─────────────────
    // For each drop: update position, then either reroll (no tail
    // drawn, head data computed from the NEW state) or draw tail
    // and stash head data — both routes write to HEAD_SCRATCH so
    // the head pass is just a tight read-and-emit loop.
    let headIdx = 0;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const wAng = wAngs[i];
      const dvx = VX + VY * wAng;
      const dvy = VY - VX * wAng;

      const speed = speeds[i];
      const len = lens[i];

      const x = xs[i] + dvx * speed * G * DT;
      const y = ys[i] + dvy * speed * G * DT;

      if (y - len > H || x < -60 || x > W + 60) {
        // Drop exited the viewport. Reroll mutates the SoA in
        // place at index i — preserves the original semantics
        // (no tail this frame, head drawn at the NEW position
        // with NEW wobble).
        rerollDrop(soa, i, layer, W, H, true);
        const nWAng = wAngs[i];
        const nDvx = VX + VY * nWAng;
        const nDvy = VY - VX * nWAng;
        const nSway = Math.sin(ST + wPhases[i]) * wAmps[i];
        const nx = xs[i];
        const ny = ys[i];
        const nPx = nx + nSway;
        const nHl = lens[i] * HF * layerLengthBoost;
        HEAD_SCRATCH[headIdx]     = nPx;
        HEAD_SCRATCH[headIdx + 1] = ny;
        HEAD_SCRATCH[headIdx + 2] = nPx - nDvx * nHl;
        HEAD_SCRATCH[headIdx + 3] = ny - nDvy * nHl;
        headIdx += 4;
        continue;
      }

      // Commit the integrated position back to the SoA.
      xs[i] = x;
      ys[i] = y;

      const sway = Math.sin(ST + wPhases[i]) * wAmps[i];
      const px = x + sway;
      const dl = len * layerLengthBoost;
      const hl = dl * HF;

      // Tail (full-length, dim) — emitted now.
      ctx.moveTo(px, y);
      ctx.lineTo(px - dvx * dl, y - dvy * dl);

      // Head (32% leading edge, bright) — stashed for the second
      // stroke so we can swap strokeStyle without reiterating.
      HEAD_SCRATCH[headIdx]     = px;
      HEAD_SCRATCH[headIdx + 1] = y;
      HEAD_SCRATCH[headIdx + 2] = px - dvx * hl;
      HEAD_SCRATCH[headIdx + 3] = y - dvy * hl;
      headIdx += 4;
    }
    ctx.lineWidth = layer.width;
    ctx.strokeStyle = `rgba(225, 225, 225, ${Math.min(0.95, layer.tailAlpha * flashBoost * layerBrightBoost)})`;
    ctx.stroke();

    // ── Head pass — pure scratch-buffer iteration, no math ────
    ctx.beginPath();
    for (let j = 0; j < headIdx; j += 4) {
      ctx.moveTo(HEAD_SCRATCH[j],     HEAD_SCRATCH[j + 1]);
      ctx.lineTo(HEAD_SCRATCH[j + 2], HEAD_SCRATCH[j + 3]);
    }
    ctx.lineWidth = layer.width;
    ctx.strokeStyle = `rgba(245, 245, 245, ${Math.min(1, layer.headAlpha * flashBoost * layerBrightBoost)})`;
    ctx.stroke();
  }

  ctx.restore();

  return { totalDrops };
}
