/* ──────────────────────────────────────────────────────────────
   Lightning strike timing & envelope math.

   Three SCRIPTED strikes drive the intro sequence (primary +
   secondary + tertiary in the first 1.4s). Additional AD-HOC
   strikes are spawned by user clicks; they live in their own
   array and share the same envelope math but with arbitrary
   start times.

   The envelope functions are pure — given an `elapsed` time
   relative to a strike's start, they return its current intensity
   in 0..1. The rAF loop calls them every frame and `Math.max`s
   the result into the per-variant intensity buffer that drives
   canvas rendering.
   ────────────────────────────────────────────────────────────── */

export interface ScriptedStrike {
  /** Time since scene start in ms when this strike fires. */
  t: number;
  /** Peak intensity 0..1. */
  intensity: number;
  /** Index into the bolt-variant pool (see boltRender.ts). */
  variant: number;
}

/** Fixed three-strike intro sequence — primary, secondary, tertiary. */
export const STRIKES: readonly ScriptedStrike[] = [
  { t: 1000, intensity: 1.0,  variant: 0 },
  { t: 1180, intensity: 0.65, variant: 1 },
  { t: 1340, intensity: 0.35, variant: 2 },
];

/** When (relative to scene start) the brightest strike fires. */
export const PRIMARY_STRIKE_T = STRIKES[0].t;

export interface AdHocStrike {
  /** performance.now() when the strike fired. */
  startTime: number;
  intensity: number;
  variant: number;
}

/** Strike fully decayed after this — adHocStrikes can be pruned. */
export const AD_HOC_STRIKE_LIFETIME_MS = 1700;

/** Minimum gap between user-triggered strikes (avoids audio overload). */
export const CLICK_STRIKE_COOLDOWN_MS = 500;

/**
 * Strike envelope. Sharp 25ms peak at full intensity, then fast
 * 55ms decay to 30%, then slow 200ms decay to 0. Total bright
 * window ≈ 280ms.
 */
export function strikeEnvelope(elapsed: number): number {
  if (elapsed < 0) return 0;
  if (elapsed < 25) return 1;
  if (elapsed < 80) return 1 - ((elapsed - 25) / 55) * 0.7;
  if (elapsed < 280) return 0.3 - ((elapsed - 80) / 200) * 0.3;
  return 0;
}

/**
 * Faint after-image trace — the eye/camera "remembers" the bolt
 * for ~800ms after the main flash. Adds to per-variant intensity
 * separately from the envelope.
 */
export function afterImage(elapsed: number): number {
  if (elapsed < 80) return 0;
  if (elapsed < 900) return 0.07 * (1 - (elapsed - 80) / 820);
  return 0;
}

/** Persistent ionization trail that lingers after the primary strike. */
export function ionizationLinger(elapsed: number): number {
  if (elapsed < 100) return 0;
  if (elapsed < 1700) return 0.045 * (1 - (elapsed - 100) / 1600);
  return 0;
}
