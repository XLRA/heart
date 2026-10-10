/**
 * Phase sync: lock the groove engine to what is actually coming out of the
 * speakers, from a few seconds of audio.
 *
 * The engine already knows the song's tempo and groove; what it may not know
 * is WHERE the beats fall in Spotify's playback timeline (and which beat is
 * the "one"). That is two numbers -- a time shift and a bar offset -- so a
 * handful of seconds of real audio is plenty: we correlate the captured
 * audio's onset curve against the song's bar-averaged onset pattern for every
 * candidate (shift, bar) and pick the peak. A matched filter against a KNOWN
 * pattern is far more robust than live beat detection: room noise, voices
 * and speaker coloration add uncorrelated energy that averages out.
 *
 * The resulting shift absorbs every latency in the chain (output buffering,
 * Bluetooth, mic input) because it is measured acoustically.
 *
 * Pure functions only; capture lives in micCapture.ts.
 */

import type { GrooveEngine, PhaseLock } from './engine';

export interface CapturedOnsets {
  /** Normalized onset curves of the captured audio (analysis.ts output). */
  full: Float32Array;
  low: Float32Array;
  fps: number;
  /** Raw playback-clock song time (seconds, no latency correction) of
   *  captured frame 0. Frames are 1 / fps apart. */
  songTimeAtFrame0: number;
}

export interface SyncResult {
  lock: PhaseLock;
  /** Beat-phase confidence: peak z-score of the stage-1 matched filter.
   *  > ~4 is a confident lock. */
  confidence: number;
  /** Downbeat confidence: best bar score / runner-up bar score. > ~1.08 is
   *  a usable downbeat decision. */
  barMargin: number;
}

export interface SolveOptions {
  /** Range of shifts to search, seconds (one beat is enough: whole-beat
   *  ambiguity is resolved by the bar stage). For a phase-unknown grid pass
   *  [0, period); for a beat map pass a latency window. */
  shiftMin: number;
  shiftMax: number;
  /** Search the downbeat too (otherwise `bar` is kept). */
  solveBar: boolean;
  bar: number;
  stepS?: number;
}

/** Weight of the kick-band correlation relative to full-band. The kick band
 *  is what disambiguates the downbeat (bar) for backbeat-driven music. */
const LOW_WEIGHT = 0.8;

/**
 * Two-stage matched filter.
 *   1. Beat phase: correlate against the template folded to ONE beat (the
 *      average of its four beats). Insensitive to the downbeat and to bar-to-
 *      bar pattern variation, so it is very robust.
 *   2. Downbeat: with the shift fixed (+-12 ms), score each of the four bar
 *      offsets against the full bar template.
 */
export function solvePhase(engine: GrooveEngine, cap: CapturedOnsets, opts: SolveOptions): SyncResult | null {
  const { full: tf, low: tl, binsPerBar } = engine.onsetTemplate;
  const n = Math.min(cap.full.length, cap.low.length);
  if (n < cap.fps * 3) return null;
  const step = opts.stepS ?? 0.004;

  const demean = (x: Float32Array) => {
    let m = 0;
    for (let i = 0; i < n; i++) m += x[i];
    m /= n;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = x[i] - m;
    return out;
  };
  const mf = demean(cap.full);
  const ml = demean(cap.low);

  const perBeat = binsPerBar / 4;
  const fold = (t: Float32Array) => {
    const out = new Float32Array(perBeat);
    for (let k = 0; k < binsPerBar; k++) out[k % perBeat] += t[k] / 4;
    return out;
  };
  const bf = fold(tf), bl = fold(tl);
  const lerpCyclic = (t: Float32Array, x: number) => {
    const len = t.length;
    const i = Math.floor(x);
    const f = x - i;
    const a = t[((i % len) + len) % len];
    const b = t[(((i + 1) % len) + len) % len];
    return a + (b - a) * f;
  };
  const score = (lock: PhaseLock, folded: boolean) => {
    let v = 0;
    for (let i = 0; i < n; i += 2) {
      const s = cap.songTimeAtFrame0 + i / cap.fps;
      const pos = engine.barPositionAt(s, lock); // beats into the bar
      if (folded) {
        const x = (pos - Math.floor(pos)) * perBeat;
        v += mf[i] * lerpCyclic(bf, x) + LOW_WEIGHT * ml[i] * lerpCyclic(bl, x);
      } else {
        const x = pos * perBeat;
        v += mf[i] * lerpCyclic(tf, x) + LOW_WEIGHT * ml[i] * lerpCyclic(tl, x);
      }
    }
    return v;
  };

  // --- Stage 1: beat phase ---
  const shifts: number[] = [];
  const vals: number[] = [];
  for (let shift = opts.shiftMin; shift <= opts.shiftMax + 1e-9; shift += step) {
    shifts.push(shift);
    vals.push(score({ shift, bar: opts.bar }, true));
  }
  if (vals.length < 4) return null;
  let bi = 0;
  let mean = 0;
  for (let i = 0; i < vals.length; i++) { mean += vals[i]; if (vals[i] > vals[bi]) bi = i; }
  mean /= vals.length;
  let sd = 0;
  for (const v of vals) sd += (v - mean) * (v - mean);
  sd = Math.sqrt(sd / vals.length) || 1;
  let shift = shifts[bi];
  if (bi > 0 && bi < vals.length - 1) {
    const a = vals[bi - 1], b = vals[bi], c = vals[bi + 1];
    const den = a - 2 * b + c;
    if (den < 0) shift += step * Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
  }
  const confidence = (vals[bi] - mean) / sd;

  // --- Stage 2: downbeat ---
  let bar = opts.bar;
  let barMargin = 1;
  if (opts.solveBar) {
    const barScores = [0, 1, 2, 3].map((b) => {
      let best = -Infinity;
      for (let d = -0.012; d <= 0.0121; d += 0.004) best = Math.max(best, score({ shift: shift + d, bar: b }, false));
      return best;
    });
    const order = [0, 1, 2, 3].sort((x, y) => barScores[y] - barScores[x]);
    bar = order[0];
    const top = barScores[order[0]], next = barScores[order[1]];
    barMargin = next > 0 ? top / next : top > 0 ? Infinity : 1;
  }
  return { lock: { shift, bar }, confidence, barMargin };
}

/**
 * Tap sync: the listener taps along to the beat. Each tap is a raw playback
 * clock time; people tap ~30 ms ahead of the beat they hear, so we compensate.
 * Returns the shift that puts the engine's beats on the taps (bar unchanged --
 * taps carry no downbeat information).
 */
export const TAP_ANTICIPATION_S = 0.03;

export function solveTaps(engine: GrooveEngine, tapSongTimes: number[], current: PhaseLock): PhaseLock | null {
  if (tapSongTimes.length < 4) return null;
  // Where each tap falls within the beat under the CURRENT lock (0 = on a
  // beat), as a circular mean.
  let c = 0, s = 0;
  for (const t of tapSongTimes) {
    const pos = engine.barPositionAt(t + TAP_ANTICIPATION_S, current);
    const ph = pos - Math.floor(pos);
    c += Math.cos(2 * Math.PI * ph);
    s += Math.sin(2 * Math.PI * ph);
  }
  const R = Math.hypot(c, s) / tapSongTimes.length;
  if (R < 0.6) return null; // taps too scattered to trust
  // Taps sit `ph` of a beat after the engine's beats: move beats later by
  // that much (wrapped to the nearest half beat either way).
  let ph = Math.atan2(s, c) / (2 * Math.PI);
  if (ph > 0.5) ph -= 1;
  if (ph < -0.5) ph += 1;
  const period = engine.periodAt(tapSongTimes[tapSongTimes.length - 1]);
  return { shift: current.shift + ph * period, bar: current.bar };
}
