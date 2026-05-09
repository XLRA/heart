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

export interface Raindrop {
  x: number;
  y: number;
  speed: number;
  length: number;
  /**
   * Per-drop angular deviation from base wind direction, in
   * radians. Applied each frame via small-angle rotation of the
   * velocity vector (cheap: 2 multiplies + 2 adds, no trig).
   * Without this, all drops form perfectly parallel rails — the
   * dead giveaway that rain is fake.
   */
  wobbleAngle: number;
  /** Phase + amplitude of a per-drop horizontal sine sway. */
  wobblePhase: number;
  wobbleAmp: number;
}

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

export type LayeredDrops = Raindrop[][];

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

export function rerollRaindrop(
  d: Raindrop,
  layer: RainLayer,
  width: number,
  height: number,
  spawnAtTop: boolean,
) {
  // Bias drops toward the FAST end of their layer's range.
  const t = Math.random();
  const speedT = Math.sqrt(t);
  d.speed = lerp(layer.speedMin, layer.speedMax, speedT);
  d.length =
    lerp(layer.lengthMin, layer.lengthMax, speedT) * (0.85 + Math.random() * 0.3);
  d.x = -40 + Math.random() * (width + 80);
  d.y = spawnAtTop
    ? -d.length - Math.random() * 80
    : Math.random() * height;
  d.wobbleAngle = (Math.random() - 0.5) * 0.12;
  d.wobblePhase = Math.random() * Math.PI * 2;
  d.wobbleAmp = (0.6 + Math.random() * 1.4) * (1.2 - speedT * 0.6);
}

export function makeRaindrops(
  width: number,
  height: number,
  total: number,
): LayeredDrops {
  const layered: LayeredDrops = LAYERS.map(() => []);
  for (let li = 0; li < LAYERS.length; li++) {
    const count = Math.round(total * LAYERS[li].proportion);
    for (let i = 0; i < count; i++) {
      const d: Raindrop = {
        x: 0, y: 0, speed: 0, length: 0,
        wobbleAngle: 0, wobblePhase: 0, wobbleAmp: 0,
      };
      rerollRaindrop(d, LAYERS[li], width, height, false);
      layered[li].push(d);
    }
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
  // Sheets accelerate too — the gust front pushes the air harder.
  if (sheet.intensity > 0) gust *= 1 + 0.18 * sheet.intensity;

  const swayT = elapsed * 0.0014;

  const flashBoost = 1 + flashIntensity * 0.7;
  const HEAD_FRACTION = 0.32;

  let totalDrops = 0;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (let li = 0; li < LAYERS.length; li++) {
    const layer = LAYERS[li];
    const drops = layers[li];
    if (drops.length === 0) continue;
    totalDrops += drops.length;

    // Per-layer sheet boost — applied to the targeted layer only.
    // Brightness AND visible streak length both ramp up so the
    // sheet reads as "denser, harder rain."
    const layerSheetBoost = li === sheet.targetLayer ? sheet.intensity : 0;
    const layerBrightBoost = 1 + layerSheetBoost * 0.55;
    const layerLengthBoost = 1 + layerSheetBoost * 0.30;

    // Tail pass — full length, dim. Updates positions, builds path.
    ctx.beginPath();
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];

      const dvx = baseVx + baseVy * d.wobbleAngle;
      const dvy = baseVy - baseVx * d.wobbleAngle;

      d.x += dvx * d.speed * gust * dt;
      d.y += dvy * d.speed * gust * dt;

      if (d.y - d.length > height || d.x < -60 || d.x > width + 60) {
        rerollRaindrop(d, layer, width, height, true);
        continue;
      }

      const sway = Math.sin(swayT + d.wobblePhase) * d.wobbleAmp;
      const px = d.x + sway;
      const dl = d.length * layerLengthBoost;
      ctx.moveTo(px, d.y);
      ctx.lineTo(px - dvx * dl, d.y - dvy * dl);
    }
    ctx.lineWidth = layer.width;
    ctx.strokeStyle = `rgba(225, 225, 225, ${Math.min(0.95, layer.tailAlpha * flashBoost * layerBrightBoost)})`;
    ctx.stroke();

    // Head pass — leading 32% of each drop, brighter.
    ctx.beginPath();
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      const dvx = baseVx + baseVy * d.wobbleAngle;
      const dvy = baseVy - baseVx * d.wobbleAngle;
      const sway = Math.sin(swayT + d.wobblePhase) * d.wobbleAmp;
      const px = d.x + sway;
      const headLen = d.length * HEAD_FRACTION * layerLengthBoost;
      ctx.moveTo(px, d.y);
      ctx.lineTo(px - dvx * headLen, d.y - dvy * headLen);
    }
    ctx.lineWidth = layer.width;
    ctx.strokeStyle = `rgba(245, 245, 245, ${Math.min(1, layer.headAlpha * flashBoost * layerBrightBoost)})`;
    ctx.stroke();
  }

  ctx.restore();

  return { totalDrops };
}
