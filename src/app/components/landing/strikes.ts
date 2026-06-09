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

   Strikes flagged with `hasLeader: true` get a stepped-leader
   pre-phase: a faint, dim trace appears for ~80ms BEFORE the
   bright return stroke (negative elapsed). This is the most
   cinematically realistic detail real lightning has — the ionized
   channel feels its way down from the cloud first, then the
   return stroke roars back up. Channel re-flashes (sub-strikes
   reusing an established channel within ~200ms) skip the leader
   because the channel is already ionized.
   ────────────────────────────────────────────────────────────── */

/** Stepped leader duration — how long the dim leader-trace is
 *  visible before the bright return stroke. Real camera-visible
 *  leaders run ~20-100ms; we sit slightly above that so the
 *  descent animation is perceptible at 60fps (~8-9 frames). */
export const LEADER_DURATION_MS = 140;

/** Number of discrete propagation steps in the leader descent.
 *  Real stepped leaders advance in ~50m bursts with micro-pauses —
 *  quantizing the descent reproduces that stutter. */
export const LEADER_STEPS = 6;

/**
 * Spatial progress (0..1) of the stepped-leader descent for a strike
 * at the given local elapsed time (negative during the leader phase).
 * The descent ACCELERATES toward the ground (pow ease-in) and is
 * quantized into LEADER_STEPS discrete jumps. `ceil` (not floor) so
 * the first channel segment is visible the instant the leader spawns.
 * Returns 1 once the return stroke has fired (elapsed >= 0).
 */
export function leaderProgress(elapsed: number): number {
  if (elapsed >= 0) return 1;
  if (elapsed < -LEADER_DURATION_MS) return 0;
  const t = (elapsed + LEADER_DURATION_MS) / LEADER_DURATION_MS;
  const eased = Math.pow(t, 1.35);
  return Math.min(1, Math.ceil(eased * LEADER_STEPS) / LEADER_STEPS);
}

/** Return-stroke spatial-sweep duration — how long the brightness
 *  takes to climb from destination → source. Real return stroke is
 *  closer to ~1ms (1/3 c over a 100m channel) but we slow it for
 *  visual perceptibility. */
export const RETURN_STROKE_SWEEP_MS = 11;

export interface ScriptedStrike {
  /** Time since scene start in ms when the BRIGHT PEAK fires.
   *  If `hasLeader` is true, the leader becomes visible at
   *  `t - LEADER_DURATION_MS`. */
  t: number;
  /** Peak intensity 0..1. */
  intensity: number;
  /** Index into the bolt-variant pool (see boltRender.ts). */
  variant: number;
  /** Show the stepped-leader pre-phase. Reserved for the
   *  primary strike of a fresh channel. */
  hasLeader?: boolean;
  /** Channel re-route offset (CSS px) — gives re-flashes through
   *  the same variant a visible plasma shift. */
  jx?: number;
  jy?: number;
}

/** Scripted intro — ONE cloud-to-ground strike from the top right
 *  down to the bottom left (variant 0 crosses mid-screen right
 *  behind the wordmark, so the bolt visually HITS the word),
 *  followed by two fast, dim re-flashes through the SAME ionized
 *  channel. Reads as a single natural multi-stroke flash
 *  electrifying the word, then dissipating — not a barrage.
 *  Only the primary descends with a stepped leader; the re-flashes
 *  reuse the channel and fire instantly, each with a small
 *  re-route offset so the plasma visibly shifts between pulses. */
export const STRIKES: readonly ScriptedStrike[] = [
  { t: 1000, intensity: 1.0,  variant: 0, hasLeader: true },
  { t: 1095, intensity: 0.50, variant: 0, jx:  2.6, jy: -0.8 },
  { t: 1190, intensity: 0.24, variant: 0, jx: -2.2, jy:  0.6 },
];

/** When (relative to scene start) the brightest strike fires. */
export const PRIMARY_STRIKE_T = STRIKES[0].t;

export interface AdHocStrike {
  /** performance.now() when the BRIGHT PEAK fires. With leader, the
   *  leader becomes visible at `startTime - LEADER_DURATION_MS`. */
  startTime: number;
  intensity: number;
  variant: number;
  hasLeader?: boolean;
  /** Per-stroke channel re-route offset (CSS px). Real plasma
   *  channels physically move a few px between re-strikes — each
   *  sub-stroke gets its own random offset on top of the variant's
   *  baked jitter so the flicker visibly re-routes. */
  jx?: number;
  jy?: number;
}

/** Strike fully decayed after this — adHocStrikes can be pruned. */
export const AD_HOC_STRIKE_LIFETIME_MS = 1700;

/** Minimum gap between user-triggered strikes (avoids audio overload). */
export const CLICK_STRIKE_COOLDOWN_MS = 500;

/**
 * Strike envelope. Three phases:
 *   • Leader (only when hasLeader): -LEADER_DURATION_MS..0
 *     Faint, slowly building dim trace — the stepped leader feeling
 *     its way down from the cloud. Builds 0.05 → 0.15 over the
 *     descent, then a fast pre-stroke ramp 0.15 → 0.35 in the final
 *     12ms. (Slightly brighter than the pre-descent version: only
 *     the swept-out portion of the channel is visible now, so the
 *     trace needs a touch more punch to read.)
 *   • Peak: 0..25ms — full brightness (clamped 1.0).
 *   • Decay: fast 25..80ms (1.0 → 0.3), slow 80..280ms (0.3 → 0).
 *
 * Total visible window is 280ms (or 420ms with leader).
 */
export function strikeEnvelope(elapsed: number, hasLeader = false): number {
  if (hasLeader) {
    if (elapsed < -LEADER_DURATION_MS) return 0;
    // Stepped-leader build-up phase — slow.
    if (elapsed < -12) {
      const t = (elapsed + LEADER_DURATION_MS) / (LEADER_DURATION_MS - 12);
      return 0.05 + t * 0.10;
    }
    // Pre-stroke ramp — fast.
    if (elapsed < 0) {
      const t = (elapsed + 12) / 12;
      return 0.15 + t * 0.20;
    }
  } else if (elapsed < 0) {
    return 0;
  }
  if (elapsed < 25) return 1;
  if (elapsed < 80) return 1 - ((elapsed - 25) / 55) * 0.7;
  if (elapsed < 280) return 0.3 - ((elapsed - 80) / 200) * 0.3;
  return 0;
}

/**
 * Branch intensity — tracks trunk envelope at peak but DECAYS FASTER
 * during the late phase. Real lightning branches carry less current,
 * cool sooner, and the visible bloom dies away first while the trunk
 * keeps glowing for another ~150ms.
 *
 * At peak (trunk=1.0): branches=1.0 (equal).
 * At 0.5: branches ≈ 0.30 (already noticeably dimmer).
 * At 0.2: branches ≈ 0.05 (essentially gone).
 */
export function branchIntensityFromTrunk(trunk: number): number {
  if (trunk <= 0) return 0;
  if (trunk >= 0.95) return trunk;        // peak — equal brightness
  // Quadratic-ish fall-off below peak.
  const decayed = trunk * trunk * 1.2;
  return decayed > trunk ? trunk : decayed;
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

/** Sweep progress in [0..1] for a strike at the given local elapsed
 *  time. >=1 means sweep complete (use uniform composite). */
export function sweepProgress(elapsed: number): number {
  if (elapsed < 0) return 0;
  if (elapsed >= RETURN_STROKE_SWEEP_MS) return 1;
  return elapsed / RETURN_STROKE_SWEEP_MS;
}
