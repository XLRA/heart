/**
 * Offline music analysis: decoded PCM in, a "groove model" out.
 *
 * This is the brain of the Track Intelligence system. Spotify's Web Playback
 * SDK audio is DRM-protected, so the page can never hear what Spotify plays.
 * What it CAN get is a short, legally public clip of the exact same master
 * (Spotify's 30 s preview, with Deezer/iTunes as fallbacks) and, for local
 * files, the whole track. This module turns that audio into everything the
 * heart needs to move with the song *without listening live*:
 *
 *   - Per-frame envelopes (bass / mid / treble / overall, spectral centroid
 *     and flatness) computed exactly the way the live analyzer
 *     (services/audioAnalyzer.ts) computes them -- same band edges, same
 *     pre-emphasis, same AGC + per-band balance, same envelope followers --
 *     so the heart's tuning carries over unchanged.
 *   - Kick and snare onset EVENTS with strengths (median + MAD adaptive
 *     threshold, identical semantics to the live detector).
 *   - Tempo (autocorrelation with an optional external hint), a dynamic-
 *     programming beat track (Ellis 2007), a robust linear grid fit, a
 *     gridness/confidence score, and a 4/4 downbeat estimate.
 *   - A normalized onset-strength curve used by the sync layer to lock the
 *     model's phase against a few seconds of microphone audio.
 *
 * Pure TypeScript, no DOM, no imports: runs in a Web Worker, on the main
 * thread, or in Node (the offline test bench runs it with type stripping).
 */

export const ANALYSIS_VERSION = 3;

export interface OnsetEvent {
  /** Seconds from the start of the analyzed audio. */
  t: number;
  /** Strength in [0, 1], same scale as the live analyzer's kick/snareStrength. */
  s: number;
}

export interface GrooveModel {
  version: number;
  /** Seconds of audio analyzed. */
  duration: number;
  /** Feature frames per second. Frame i is centered at i / fps seconds. */
  fps: number;
  bass: Float32Array;
  mid: Float32Array;
  treble: Float32Array;
  overall: Float32Array;
  centroid: Float32Array;
  flatness: Float32Array;
  /** Normalized full-band onset strength (unit std, >= 0). For phase sync. */
  onset: Float32Array;
  /** Normalized low-band (kick) onset strength. For bar-level phase sync. */
  lowOnset: Float32Array;
  kicks: OnsetEvent[];
  snares: OnsetEvent[];
  bpm: number;
  /** Beat period in seconds (from the grid fit when the track is grid-like). */
  period: number;
  /** Tracked beat times in seconds (sub-frame refined). */
  beats: number[];
  /** Linear beat grid: beat k at gridT0 + k * period. */
  gridT0: number;
  /** Fraction of tracked beats within 6% of a period of the linear grid. */
  gridness: number;
  /** Index into `beats` of the first downbeat (0..3). */
  downbeat: number;
  /** [0, 1]: how much to trust bpm/beats (peak clarity x gridness). */
  tempoConfidence: number;
  /** Mean raw loudness of non-silent frames (pre-AGC). */
  loudness: number;
}

export interface AnalysisOptions {
  /** External tempo estimate (e.g. from ReccoBeats/Deezer). Constrains the
   *  tempo search to +-6% of this value when provided. */
  bpmHint?: number;
}

// --- Constants mirrored from the live analyzer --------------------------------
const PRE_EMPHASIS_FREQ = 2000;
const PRE_EMPHASIS_GAIN_DB = 6;
const BAND = { subBass: 150, bass: 250, mid: 2000, upperMid: 6000, treble: 16000 };
const ENV = {
  bass: { attack: 0.70, decay: 0.10 },
  mid: { attack: 0.50, decay: 0.04 },
  treble: { attack: 0.65, decay: 0.12 },
  overall: { attack: 0.50, decay: 0.05 },
};
const NOISE_FLOOR = 0.08;
const LOUDNESS_TARGET = 0.45;
const AGC_MIN_GAIN = 0.5;
const AGC_MAX_GAIN = 4.0;
const BAND_BALANCE_MIN = 0.75;
const BAND_BALANCE_MAX = 1.5;
const CENTROID_HZ_MIN = 200;
const CENTROID_HZ_MAX = 4000;
const CENTROID_SMOOTH_ALPHA = 0.10;
const FLATNESS_SMOOTH_ALPHA = 0.05;
const KICK_THRESHOLD_K = 1.5;
const SNARE_THRESHOLD_K = 1.7;
const KICK_MIN_GAP_S = 0.15;
const SNARE_MIN_GAP_S = 0.09;

const FFT_SIZE = 2048;

// --- FFT ------------------------------------------------------------------------
interface FFT {
  n: number;
  rev: Uint32Array;
  cos: Float64Array;
  sin: Float64Array;
}

function makeFFT(n: number): FFT {
  const bits = Math.log2(n) | 0;
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  return { n, rev, cos, sin };
}

function fftInPlace(f: FFT, re: Float64Array, im: Float64Array): void {
  const { n, rev, cos, sin } = f;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sin[k * step];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

/**
 * Spectral flatness (power geometric/arithmetic mean, ~0.001 for tonal music
 * up to ~0.5 for noise) mapped log-wise onto [0, 1]: 0.001 -> 0, 1 -> 1.
 * Shared with the live analyzer so both paths report the same scale.
 */
export function flatnessToUnit(flatness: number): number {
  const v = Math.log10(Math.max(1e-3, flatness) * 1000) / 3;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// --- Small statistics helpers -----------------------------------------------------
function median(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return 0;
  const s = Array.prototype.slice.call(values) as number[];
  s.sort((a, b) => a - b);
  return s[n >> 1];
}

function percentile(values: ArrayLike<number>, p: number): number {
  const s = Array.prototype.slice.call(values) as number[];
  if (s.length === 0) return 0;
  s.sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}

function movingAverage(x: Float32Array, radius: number): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  let sum = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - radius);
    const b = Math.min(n - 1, i + radius);
    while (hi < b) sum += x[++hi];
    while (lo < a) sum -= x[lo++];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

function stdOf(x: Float32Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) m += x[i];
  m /= Math.max(1, x.length);
  let v = 0;
  for (let i = 0; i < x.length; i++) v += (x[i] - m) * (x[i] - m);
  return Math.sqrt(v / Math.max(1, x.length));
}

/** Onset curve -> zero-floored, locally de-meaned, unit-std curve. */
function normalizeOnset(flux: Float32Array, fps: number): Float32Array {
  const local = movingAverage(flux, Math.max(1, Math.round(0.1 * fps)));
  const out = new Float32Array(flux.length);
  for (let i = 0; i < flux.length; i++) out[i] = Math.max(0, flux[i] - local[i]);
  const sd = stdOf(out) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= sd;
  return out;
}

// --- Event picking ------------------------------------------------------------------
/**
 * Drum onset detection function: the dB rise of a band's energy over ~23 ms.
 * A kick drum lifts the 40-130 Hz band by 10-20 dB almost instantly; a bass
 * guitar note change or a sustained 808 tail barely moves it. Working on
 * band ENERGY (not per-bin log flux) is what separates the drum hit from
 * the pitched low end -- per-bin flux fires on every bass note.
 */
function energyRise(energy: Float32Array, fps: number): Float32Array {
  const n = energy.length;
  const lagFrames = Math.max(1, Math.round(0.023 * fps));
  // Floor relative to the clip's typical level so silence doesn't produce
  // huge ratios from numerical noise.
  const floor = Math.max(1e-12, percentile(energy, 0.5) * 0.01);
  const out = new Float32Array(n);
  for (let i = lagFrames; i < n; i++) {
    const rise = 10 * Math.log10((energy[i] + floor) / (energy[i - lagFrames] + floor));
    out[i] = rise > 0 ? rise : 0;
  }
  return out;
}

/**
 * Adaptive-threshold peak picking. Threshold = local mean + k * local std over
 * a sliding ~2 s window (computed per 0.25 s block and interpolated); onset
 * curves are mostly zeros, so median/MAD statistics collapse to ~0 and let
 * everything through -- mean/std does not. Strength = how far the peak clears
 * the threshold relative to the local 95th percentile, so ordinary hits land
 * mid-scale and accents saturate (instead of every event reading 1.0).
 */
function pickEvents(odf: Float32Array, fps: number, k: number, minGapS: number): OnsetEvent[] {
  const n = odf.length;
  if (n < 3) return [];
  const block = Math.max(1, Math.round(0.25 * fps));
  const win = Math.max(2, Math.round(1.0 * fps));
  const nBlocks = Math.ceil(n / block);
  const thrB = new Float32Array(nBlocks);
  const topB = new Float32Array(nBlocks);
  for (let b = 0; b < nBlocks; b++) {
    const c = b * block + (block >> 1);
    const lo = Math.max(0, c - win);
    const hi = Math.min(n, c + win);
    let m = 0;
    for (let i = lo; i < hi; i++) m += odf[i];
    m /= Math.max(1, hi - lo);
    let v = 0;
    for (let i = lo; i < hi; i++) v += (odf[i] - m) * (odf[i] - m);
    const sd = Math.sqrt(v / Math.max(1, hi - lo));
    thrB[b] = Math.max(m + k * sd, 1.5); // at least a 1.5 dB rise
    topB[b] = percentile(odf.subarray(lo, hi), 0.995);
  }
  const at = (arr: Float32Array, i: number) => {
    const pos = i / block - 0.5;
    const b0 = Math.max(0, Math.min(nBlocks - 1, Math.floor(pos)));
    const b1 = Math.min(nBlocks - 1, b0 + 1);
    const f = Math.max(0, Math.min(1, pos - b0));
    return arr[b0] + (arr[b1] - arr[b0]) * f;
  };

  const halfPeak = Math.max(1, Math.round(0.03 * fps));
  const minGap = minGapS * fps;
  const events: OnsetEvent[] = [];
  let lastIdx = -Infinity;
  let lastS = 0;
  for (let i = 1; i < n - 1; i++) {
    const v = odf[i];
    const thr = at(thrB, i);
    if (v <= thr) continue;
    let isPeak = true;
    for (let j = Math.max(0, i - halfPeak); j <= Math.min(n - 1, i + halfPeak); j++) {
      if (odf[j] > v || (odf[j] === v && j < i)) { isPeak = false; break; }
    }
    if (!isPeak) continue;
    // The ODF peaks at the END of the rise window; the hit itself starts
    // roughly half a lag earlier. Walk back to where the curve first
    // cleared half the peak height for a sharper onset time.
    let j = i;
    while (j > 0 && odf[j - 1] > v * 0.5 && i - j < halfPeak * 2) j--;
    const top = Math.max(thr + 1, at(topB, i));
    const s = Math.max(0.05, Math.min(1, (v - thr) / (top - thr)));
    const t = j / fps;
    if (i - lastIdx < minGap) {
      if (s > lastS) {
        events[events.length - 1] = { t, s };
        lastIdx = i;
        lastS = s;
      }
      continue;
    }
    events.push({ t, s });
    lastIdx = i;
    lastS = s;
  }
  return events;
}

// --- Tempo -----------------------------------------------------------------------------
interface TempoEstimate {
  bpm: number;
  /** Autocorrelation peak prominence in [0, 1]. */
  clarity: number;
}

function estimateTempo(onset: Float32Array, fps: number, hint?: number): TempoEstimate {
  const n = onset.length;
  let minBpm = 60;
  let maxBpm = 200;
  if (hint && hint > 30 && hint < 300) {
    minBpm = hint * 0.94;
    maxBpm = hint * 1.06;
  }
  const minLag = Math.max(2, Math.floor((60 * fps) / maxBpm));
  const maxLag = Math.min(n - 2, Math.ceil((60 * fps) / minBpm));
  if (maxLag <= minLag) return { bpm: hint || 120, clarity: 0 };

  // Full-range ACF (60-200 BPM) for the clarity measure, regardless of hint.
  const fullMin = Math.max(2, Math.floor((60 * fps) / 200));
  const fullMax = Math.min(n - 2, Math.ceil((60 * fps) / 60));
  const lo = Math.min(minLag, fullMin);
  const hi = Math.max(maxLag, fullMax);
  const acf = new Float64Array(hi + 2);
  for (let lag = lo; lag <= hi + 1; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += onset[i] * onset[i - lag];
    acf[lag] = s / (n - lag);
  }
  // Log-Gaussian tempo prior around 120 BPM (only without a hint), plus a
  // comb: a true beat lag also has energy at 2x lag (the bar's half-note).
  const score = (lag: number) => {
    const comb = acf[lag] + 0.5 * (2 * lag <= hi ? acf[2 * lag] : 0);
    if (hint) return comb;
    const bpm = (60 * fps) / lag;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.0, 2));
    return comb * w;
  };
  let best = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) if (score(lag) > score(best)) best = lag;
  // Parabolic refinement of the raw ACF peak.
  let lagF = best;
  if (best > lo && best < hi) {
    const a = acf[best - 1], b = acf[best], c = acf[best + 1];
    const den = a - 2 * b + c;
    if (den !== 0) lagF = best + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
  }
  // Clarity: peak height relative to the ACF's mean over the tempo range.
  let mean = 0;
  let count = 0;
  for (let lag = fullMin; lag <= fullMax; lag++) { mean += acf[lag]; count++; }
  mean /= Math.max(1, count);
  let maxV = 0;
  for (let lag = fullMin; lag <= fullMax; lag++) maxV = Math.max(maxV, acf[lag]);
  const clarity = maxV > mean ? Math.max(0, Math.min(1, (acf[best] - mean) / (maxV - mean + 1e-9))) : 0;
  return { bpm: (60 * fps) / lagF, clarity };
}

// --- Beat tracking (dynamic programming, Ellis 2007) -------------------------------------
function trackBeats(onset: Float32Array, fps: number, bpm: number): number[] {
  const n = onset.length;
  const period = (60 * fps) / bpm;
  if (n < period * 3) return [];
  // Local score: onset smoothed with a Gaussian of width period/32.
  const sigma = Math.max(1, period / 32);
  const radius = Math.ceil(sigma * 3);
  const kernel = new Float64Array(radius * 2 + 1);
  for (let i = -radius; i <= radius; i++) kernel[i + radius] = Math.exp(-0.5 * (i / sigma) * (i / sigma));
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < n) s += onset[j] * kernel[k + radius];
    }
    local[i] = s;
  }
  const tightness = 100;
  const cum = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const minW = Math.max(1, Math.round(period / 2));
  const maxW = Math.round(period * 2);
  for (let i = 0; i < n; i++) {
    let bestV = -Infinity;
    let bestJ = -1;
    for (let j = i - maxW; j <= i - minW; j++) {
      if (j < 0) continue;
      const r = Math.log((i - j) / period);
      const v = cum[j] - tightness * r * r;
      if (v > bestV) { bestV = v; bestJ = j; }
    }
    cum[i] = local[i] + (bestJ >= 0 ? Math.max(0, bestV) : 0);
    back[i] = bestV > 0 ? bestJ : -1;
  }
  // Start from the best cumulative score within the final period.
  let end = n - 1;
  let endV = -Infinity;
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) {
    if (cum[i] > endV) { endV = cum[i]; end = i; }
  }
  const idx: number[] = [];
  for (let i = end; i >= 0; i = back[i]) {
    idx.push(i);
    if (back[i] < 0) break;
  }
  idx.reverse();
  // Trim weak beats at the edges (silence lead-in / fade-out).
  let rms = 0;
  for (const i of idx) rms += local[i] * local[i];
  rms = Math.sqrt(rms / Math.max(1, idx.length));
  let a = 0;
  let b = idx.length - 1;
  while (a < b && local[idx[a]] < 0.5 * rms) a++;
  while (b > a && local[idx[b]] < 0.5 * rms) b--;
  const out: number[] = [];
  for (let k = a; k <= b; k++) {
    const i = idx[k];
    // Sub-frame refinement on the local score.
    let off = 0;
    if (i > 0 && i < n - 1) {
      const p = local[i - 1], q = local[i], r = local[i + 1];
      const den = p - 2 * q + r;
      if (den < 0) off = Math.max(-0.5, Math.min(0.5, (0.5 * (p - r)) / den));
    }
    out.push((i + off) / fps);
  }
  return out;
}

// --- Grid fit ------------------------------------------------------------------------------
export interface GridFit {
  period: number;
  t0: number;
  /** Fraction of beats within 6% of a period of the fitted grid. */
  gridness: number;
}

/**
 * Robust linear fit of beat times to t0 + k * period.
 *
 * Index-assignment fits (sequential or rounding) are fragile: one spurious or
 * missing beat from a tracker shifts every later index and wrecks the
 * regression -- which made perfectly gridded songs look tempo-unstable. This
 * fit never assigns indices up front. It searches the period that maximizes
 * the phase coherence of all beats (|mean e^(2 pi i t / P)|, the classic
 * circular statistic), which inserted/missing beats barely affect, then
 * refines period and phase by least squares on the inliers of that grid.
 */
export function fitGrid(beats: number[], periodGuess?: number): GridFit {
  const n = beats.length;
  if (n < 2) return { period: periodGuess || 0.5, t0: beats[0] || 0, gridness: 0 };
  const ibis: number[] = [];
  for (let i = 1; i < n; i++) ibis.push(beats[i] - beats[i - 1]);
  const p0 = periodGuess || median(ibis);
  const coherence = (P: number) => {
    let c = 0, s = 0;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * beats[i]) / P;
      c += Math.cos(a);
      s += Math.sin(a);
    }
    return { r: Math.hypot(c, s) / n, phase: Math.atan2(s, c) };
  };
  // Coarse-to-fine search over +-3% (the coherence peak narrows as the span
  // grows, so the step must resolve span-level drift: dP/P ~ P / span).
  const span = Math.max(1, beats[n - 1] - beats[0]);
  let bestP = p0;
  let best = coherence(p0);
  const fine = Math.max(1e-5, (0.05 * p0) / span);
  for (const [range, step] of [[0.03, Math.max(fine * 8, 2e-4)], [Math.max(fine * 16, 4e-4), fine]] as Array<[number, number]>) {
    const center = bestP;
    for (let f = -range; f <= range; f += step) {
      const P = center * (1 + f);
      const c = coherence(P);
      if (c.r > best.r) { best = c; bestP = P; }
    }
  }
  let period = bestP;
  let t0 = (best.phase / (2 * Math.PI)) * period;
  // Least-squares refinement on inliers.
  for (let it = 0; it < 2; it++) {
    let m = 0, mx = 0, my = 0;
    const ks: number[] = [];
    const ts: number[] = [];
    for (let i = 0; i < n; i++) {
      const k = Math.round((beats[i] - t0) / period);
      if (Math.abs(beats[i] - (t0 + k * period)) < 0.15 * period) { ks.push(k); ts.push(beats[i]); m++; mx += k; my += beats[i]; }
    }
    if (m < 2) break;
    mx /= m; my /= m;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < m; i++) { sxy += (ks[i] - mx) * (ts[i] - my); sxx += (ks[i] - mx) * (ks[i] - mx); }
    if (sxx <= 0) break;
    period = sxy / sxx;
    t0 = my - period * mx;
  }
  // Express t0 as the grid beat nearest the first tracked beat.
  t0 = t0 + Math.round((beats[0] - t0) / period) * period;
  let within = 0;
  for (let i = 0; i < n; i++) {
    const k = Math.round((beats[i] - t0) / period);
    if (Math.abs(beats[i] - (t0 + k * period)) < 0.06 * period) within++;
  }
  return { period, t0, gridness: within / n };
}

// --- Main entry ------------------------------------------------------------------------------
export function analyzePcm(pcm: Float32Array, sampleRate: number, options: AnalysisOptions = {}): GrooveModel {
  const sr = sampleRate;
  const durationSec = pcm.length / sr;
  // ~5.8 ms hop for clips, ~11.6 ms for full songs (keeps a 5-minute track
  // well under a second of worker time).
  const hop = Math.max(64, Math.round(sr * (durationSec > 90 ? 0.0116 : 0.0058)));
  const fps = sr / hop;
  const N = FFT_SIZE;
  const halfN = N >> 1;
  const nFrames = Math.max(0, Math.floor(pcm.length / hop));
  const fft = makeFFT(N);
  const window = new Float64Array(N);
  for (let i = 0; i < N; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

  const binHz = sr / N;
  const binOf = (hz: number) => Math.min(halfN, Math.ceil(hz / binHz));
  const subBassEnd = binOf(BAND.subBass);
  const bassEnd = binOf(BAND.bass);
  const midEnd = binOf(BAND.mid);
  const upperMidEnd = binOf(BAND.upperMid);
  const trebleEnd = binOf(BAND.treble);
  const kickLo = Math.max(1, Math.floor(30 / binHz));
  const kickHi = binOf(150);

  // Pre-emphasis high shelf, in dB per bin (smooth ramp an octave below).
  const shelfDb = new Float64Array(halfN + 1);
  for (let k = 0; k <= halfN; k++) {
    const f = k * binHz;
    if (f >= PRE_EMPHASIS_FREQ) shelfDb[k] = PRE_EMPHASIS_GAIN_DB;
    else if (f > PRE_EMPHASIS_FREQ / 2) shelfDb[k] = PRE_EMPHASIS_GAIN_DB * Math.log2(f / (PRE_EMPHASIS_FREQ / 2));
  }

  const rawBass = new Float32Array(nFrames);
  const rawMid = new Float32Array(nFrames);
  const rawTreble = new Float32Array(nFrames);
  const rawOverall = new Float32Array(nFrames);
  const rawCentroid = new Float32Array(nFrames);
  const rawFlatness = new Float32Array(nFrames);
  const fluxAll = new Float32Array(nFrames);
  const fluxKick = new Float32Array(nFrames);
  // Linear band power for the drum detectors. Onsets are dB RISES of these
  // energies. Kick: 40-130 Hz thump. Snare: body (150-400 Hz) AND noise
  // burst (1.5-6 kHz) rising together -- hi-hats only move the top band.
  const eKick = new Float32Array(nFrames);
  const eBody = new Float32Array(nFrames);
  const eSnare = new Float32Array(nFrames);
  const bodyLo = binOf(150);
  const bodyHi = binOf(400);
  const snareLo = binOf(1500);
  const snareHi = binOf(6000);
  const kickBandLo = Math.max(1, Math.floor(40 / binHz));
  const kickBandHi = binOf(130);

  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const lag = Math.max(1, Math.round(0.0116 * fps));
  // Ring of previous log-compressed spectra for the lagged flux.
  const ring: Float64Array[] = [];
  for (let r = 0; r <= lag; r++) ring.push(new Float64Array(halfN + 1));

  const shelfLin = new Float64Array(halfN + 1);
  for (let k = 0; k <= halfN; k++) shelfLin[k] = Math.pow(10, shelfDb[k] / 20);
  const centroidLogMin = Math.log(CENTROID_HZ_MIN);
  const centroidLogRange = Math.log(CENTROID_HZ_MAX) - centroidLogMin;
  const totalBins = trebleEnd - 1;

  for (let f = 0; f < nFrames; f++) {
    const start = f * hop - halfN; // frame f is centered at f * hop
    for (let i = 0; i < N; i++) {
      const s = start + i;
      re[i] = s >= 0 && s < pcm.length ? pcm[s] * window[i] : 0;
      im[i] = 0;
    }
    fftInPlace(fft, re, im);

    const cur = ring[f % (lag + 1)];
    const prev = ring[(f + 1) % (lag + 1)]; // the frame `lag` steps back
    let subSum = 0, bassSum = 0, midSum = 0, upSum = 0, trebSum = 0;
    let subN = 0, bassN = 0, midN = 0, upN = 0, trebN = 0;
    let cNum = 0, cDen = 0, logSum = 0, pSum = 0;
    let ek = 0, eb = 0, es = 0;
    for (let k = 1; k <= halfN; k++) {
      const pw = re[k] * re[k] + im[k] * im[k];
      if (k >= kickBandLo && k < kickBandHi) ek += pw;
      else if (k >= bodyLo && k < bodyHi) eb += pw;
      else if (k >= snareLo && k < snareHi) es += pw;
      const mag = Math.sqrt(pw) / N;
      cur[k] = Math.log1p(1000 * mag);
      if (k >= trebleEnd) continue;
      const db = 20 * Math.log10(mag + 1e-12) + shelfDb[k];
      const m0 = (db + 100) / 90;
      const m = m0 > 0 ? m0 : 0;
      if (k < subBassEnd) { subSum += m; subN++; }
      else if (k < bassEnd) { bassSum += m; bassN++; }
      else if (k < midEnd) { midSum += m; midN++; }
      else if (k < upperMidEnd) { upSum += m; upN++; }
      else { trebSum += m; trebN++; }
      // Centroid / flatness on LINEAR (pre-emphasized) magnitude. Weighting
      // by the dB-normalized value made every bin count nearly equally, so
      // the many high bins pinned the centroid at the 4 kHz ceiling.
      const lin = mag * shelfLin[k];
      cNum += k * lin;
      cDen += lin;
      logSum += Math.log(lin * lin + 1e-20);
      pSum += lin * lin;
    }
    eKick[f] = ek;
    eBody[f] = eb;
    eSnare[f] = es;
    if (f >= lag) {
      let all = 0, kick = 0;
      for (let k = 1; k < trebleEnd; k++) {
        // SuperFlux-style: compare against the max of the neighbouring bins
        // in the lagged frame, suppressing vibrato/pitch-glide false onsets.
        const p = Math.max(prev[k - 1] || 0, prev[k], prev[k + 1] || 0);
        const d = cur[k] - p;
        if (d > 0) {
          all += d;
          if (k >= kickLo && k < kickHi) kick += d;
        }
      }
      fluxAll[f] = all;
      fluxKick[f] = kick;
    }

    const sub = subN ? subSum / subN : 0;
    const bas = bassN ? bassSum / bassN : 0;
    const mi = midN ? midSum / midN : 0;
    const up = upN ? upSum / upN : 0;
    const tr = trebN ? trebSum / trebN : 0;
    const cb = sub * 0.65 + bas * 0.35;
    const cm = mi * 0.6 + up * 0.4;
    rawBass[f] = cb;
    rawMid[f] = cm;
    rawTreble[f] = tr;
    rawOverall[f] = cb * 0.35 + cm * 0.35 + tr * 0.3;
    if (cDen > 0) {
      const hz = Math.max((cNum / cDen) * binHz, CENTROID_HZ_MIN);
      rawCentroid[f] = Math.max(0, Math.min(1, (Math.log(hz) - centroidLogMin) / centroidLogRange));
      rawFlatness[f] = flatnessToUnit(Math.exp(logSum / totalBins) / (pSum / totalBins + 1e-20));
    } else {
      rawCentroid[f] = 0.5;
      rawFlatness[f] = 0.5;
    }
  }

  // --- AGC + per-band balance (global; the live analyzer uses ~10 s EMAs) ---
  let L = 0, lb = 0, lm = 0, lt = 0, ln = 0;
  for (let f = 0; f < nFrames; f++) {
    if (rawOverall[f] < NOISE_FLOOR) continue;
    L += rawOverall[f]; lb += rawBass[f]; lm += rawMid[f]; lt += rawTreble[f]; ln++;
  }
  if (ln > 0) { L /= ln; lb /= ln; lm /= ln; lt /= ln; }
  const agc = L > 0.001 ? Math.min(AGC_MAX_GAIN, Math.max(AGC_MIN_GAIN, LOUDNESS_TARGET / L)) : 1;
  const balance = (band: number) => (band > 0.002 && L > 0.002 ? Math.min(BAND_BALANCE_MAX, Math.max(BAND_BALANCE_MIN, L / band)) : 1);
  const gB = agc * balance(lb), gM = agc * balance(lm), gT = agc * balance(lt);

  const dtFrames = 60 / fps;
  const rate = (base: number) => 1 - Math.pow(1 - base, dtFrames);
  const env = (raw: Float32Array, gain: number, e: { attack: number; decay: number }) => {
    const out = new Float32Array(nFrames);
    const ra = rate(e.attack), rd = rate(e.decay);
    let v = 0;
    for (let f = 0; f < nFrames; f++) {
      const silent = rawOverall[f] < NOISE_FLOOR;
      const target = silent ? 0 : Math.min(1, raw[f] * gain);
      v += (target > v ? ra : rd) * (target - v);
      out[f] = v;
    }
    return out;
  };
  const bass = env(rawBass, gB, ENV.bass);
  const mid = env(rawMid, gM, ENV.mid);
  const treble = env(rawTreble, gT, ENV.treble);
  const overall = env(rawOverall, agc, ENV.overall);
  const smooth = (raw: Float32Array, alpha: number) => {
    const out = new Float32Array(nFrames);
    const r = rate(alpha);
    let v = 0.5;
    for (let f = 0; f < nFrames; f++) {
      if (rawOverall[f] >= NOISE_FLOOR) v += r * (raw[f] - v);
      out[f] = v;
    }
    return out;
  };
  const centroid = smooth(rawCentroid, CENTROID_SMOOTH_ALPHA);
  const flatness = smooth(rawFlatness, FLATNESS_SMOOTH_ALPHA);

  // --- Events ---
  const kickOdf = energyRise(eKick, fps);
  const kicks = pickEvents(kickOdf, fps, KICK_THRESHOLD_K, KICK_MIN_GAP_S);
  const bodyOdf = energyRise(eBody, fps);
  const noiseOdf = energyRise(eSnare, fps);
  const snareOdf = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    // Geometric mean: both bands must rise. Kick-dominated frames are
    // discounted so a kick's upper harmonics don't double as a snare.
    const both = Math.sqrt(bodyOdf[i] * noiseOdf[i]);
    snareOdf[i] = both * Math.max(0, 1 - kickOdf[i] / 24);
  }
  const snares = pickEvents(snareOdf, fps, SNARE_THRESHOLD_K, SNARE_MIN_GAP_S);

  // --- Tempo, beats, grid ---
  const onset = normalizeOnset(fluxAll, fps);
  const lowOnset = normalizeOnset(fluxKick, fps);
  const tempo = estimateTempo(onset, fps, options.bpmHint);
  const beats = trackBeats(onset, fps, tempo.bpm);
  const grid = fitGrid(beats, 60 / tempo.bpm);
  // Trust the grid period when the beats really are on a grid; otherwise the
  // ACF tempo is the better global estimate.
  const period = grid.gridness >= 0.8 ? grid.period : 60 / tempo.bpm;
  const bpm = 60 / period;

  // --- Downbeat (4/4): kicks on 1 & 3, snares on 2 & 4, strongest kick on 1 ---
  const strengthNear = (events: OnsetEvent[], t: number, tol: number) => {
    let best = 0;
    for (const e of events) {
      if (e.t < t - tol) continue;
      if (e.t > t + tol) break;
      if (e.s > best) best = e.s;
    }
    return best;
  };
  const K = [0, 0, 0, 0], S = [0, 0, 0, 0], C = [0, 0, 0, 0];
  for (let i = 0; i < beats.length; i++) {
    const tol = Math.min(0.07, period * 0.15);
    K[i % 4] += strengthNear(kicks, beats[i], tol);
    S[i % 4] += strengthNear(snares, beats[i], tol);
    C[i % 4]++;
  }
  for (let j = 0; j < 4; j++) { K[j] /= Math.max(1, C[j]); S[j] /= Math.max(1, C[j]); }
  let downbeat = 0;
  let bestScore = -Infinity;
  for (let b = 0; b < 4; b++) {
    const sc = K[b] + 0.6 * K[(b + 2) % 4] + S[(b + 1) % 4] + S[(b + 3) % 4] - 0.5 * (S[b] + S[(b + 2) % 4]) + 0.3 * (K[b] - K[(b + 2) % 4]);
    if (sc > bestScore) { bestScore = sc; downbeat = b; }
  }

  const tempoConfidence = Math.max(0, Math.min(1, 0.35 + 0.65 * grid.gridness)) * (0.6 + 0.4 * tempo.clarity);

  return {
    version: ANALYSIS_VERSION,
    duration: durationSec,
    fps,
    bass, mid, treble, overall, centroid, flatness,
    onset, lowOnset,
    kicks, snares,
    bpm,
    period,
    beats,
    gridT0: grid.t0,
    gridness: grid.gridness,
    downbeat,
    tempoConfidence,
    loudness: L,
  };
}

/** Peak-normalized percentile helper for callers that want event-strength stats. */
export function eventStrengthP90(events: OnsetEvent[]): number {
  return percentile(events.map((e) => e.s), 0.9);
}
