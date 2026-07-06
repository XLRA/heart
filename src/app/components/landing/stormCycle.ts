/* ──────────────────────────────────────────────────────────────
   Storm lifecycle — the slow intensity arc of the whole scene.

   Real storms aren't statistically flat: they build, peak, ease
   into near-drizzle, and surge again over minutes. Without this,
   the scene is identical at minute 1 and minute 10 — a looping
   screensaver. With it, lingering on the page feels like weather.

   One deterministic signal 0..1 (0 = settling drizzle, 1 = peak
   downpour), a pure function of scene elapsed time — no state, no
   allocations, safe to call every frame from anywhere.

   Shape: three non-harmonic sine octaves (periods ≈ 6.3 min,
   2.5 min, 1.2 min) summed, then pushed through a smoothstep.
   Non-harmonic periods mean the pattern never visibly repeats;
   the smoothstep makes the signal LINGER in its calm and heavy
   phases and move briskly between them, so the storm reads as
   having distinct moods rather than endlessly sliding around the
   middle. Phases are chosen so t=0 lands ≈ 0.87 — the scripted
   intro strike fires into a storm near its peak, then the first
   few minutes ease off naturally.

   Consumers (all take the same value, so everything breathes
   together):
     • rain density, drop speed, streak brightness, ground haze
       (StormLanding → rain.ts)
     • ambient auto-strike cadence     (StormLanding)
     • background-flash cadence        (StormLanding)
     • rain-loop audio level           (StormLanding → stormAudio)
   ────────────────────────────────────────────────────────────── */

const TAU = Math.PI * 2;

/** Storm lifecycle intensity 0..1 for a given scene elapsed (ms). */
export function stormIntensity(elapsedMs: number): number {
  const e = elapsedMs * 0.001;
  const raw =
    Math.sin(e * (TAU / 380) + 0.9) * 0.55 +
    Math.sin(e * (TAU / 147) + 2.0) * 0.30 +
    Math.sin(e * (TAU / 71)  + 4.5) * 0.15;
  const n = 0.5 + raw * 0.5;
  // Smoothstep — fast through the middle, lingering at the ends.
  return n * n * (3 - 2 * n);
}
