/**
 * Unified real-time audio analyzer for both local-file playback (MediaElementSource)
 * and tab capture (MediaStreamSource).
 *
 * Pipeline per frame:
 *   1. getFloatFrequencyData() into a Float32Array (post pre-emphasis).
 *   2. Per-bin: compute magnitude, accumulate per-band energy + per-band positive flux.
 *   3. Update long-term loudness (slow EMA, only on non-silent frames).
 *   4. Apply AGC: scale per-band magnitudes by clamped target/longTermLoudness ratio.
 *      Beat detection is gain-invariant (deltas + relative threshold), so AGC only
 *      affects the displayed envelope values.
 *   5. Noise gate (silence -> output decays to zero, beats suppressed).
 *   6. Per-band asymmetric envelope follower (different attack/decay per band for
 *      a more "musical" feel: bass snaps, mid sustains, treble sparkles).
 *   7. Per-band beat detection with median + MAD adaptive threshold (robust to
 *      outliers - a single big hit doesn't ratchet the threshold up for the next):
 *        - Kick : sub-bass band (20-150 Hz), tight refractory (~220ms)
 *        - Snare: upper-mid band (2-6 kHz), shorter refractory (~130ms)
 *   8. Tempo tracking (median IBI + MAD confidence over recent kicks):
 *        - Reject detected kicks that fall too close to the last kick (false positives).
 *        - When confidence is high, fire a predicted beat if detection missed one.
 *
 * The factory creates a side-chain (sourceNode -> preEmphasis -> analyser) that does
 * NOT touch the audible signal path. The caller is responsible for connecting the
 * source to the destination (or not, for tab capture where the tab handles output).
 */

export interface AudioReactiveData {
  bass: number;
  mid: number;
  treble: number;
  overall: number;
  /** Generic beat (kick OR snare OR predicted). Kept for backward compatibility. */
  beat: boolean;
  beatStrength: number;
  /** Sub-bass kick onset this frame. */
  kick: boolean;
  kickStrength: number;
  /** Upper-mid snare/hi-hat onset this frame. */
  snare: boolean;
  snareStrength: number;
  /** Spectral centroid mapped to a perceptual 0..1 scale via log-Hz. Smoothed.
   *  ~0 = bass-heavy / dark, ~0.5 = balanced, ~1 = bright / treble-rich. */
  centroid: number;
  /** Spectral flatness (geometric mean / arithmetic mean of magnitudes). Smoothed.
   *  ~0 = pure tone (sustained vocals/strings), ~1 = noise (cymbals/snare/static). */
  flatness: number;
  /** Locked tempo in BPM. 0 when no lock yet. */
  tempo: number;
  /** Lock confidence in [0, 1]. Derived from MAD over recent IBIs. */
  tempoConfidence: number;
  /** Milliseconds until the next predicted beat. Infinity when no lock. Used for
   *  anticipatory animation that peaks ON the beat instead of trailing it. */
  nextBeatIn: number;
  /** Phase position within the current beat cycle in [0, 1) (0 = on the beat).
   *  Continuous + wraps cleanly; suitable as a sin() argument for tempo-locked
   *  baseline animations. NaN / 0 when no lock. */
  beatPhase: number;
  /** Long-term loudness EMA (~10 s). Useful for clients that want their own
   *  thresholds; section detection uses it internally. */
  loudness: number;
  /** Fires for one frame when a sustained-loudness jump is detected (chorus,
   *  drop, post-breakdown re-entry). Throttled by an internal cooldown. */
  section: boolean;
  /** Magnitude of the most recent section transition in [0, 1]. Persists for
   *  the cooldown window so visualization can ramp/fade against it. */
  sectionStrength: number;
}

export interface AudioAnalyzerConfig {
  audioContext: AudioContext;
  sourceNode: AudioNode;
}

export interface AudioAnalyzer {
  /** Read the latest analysis frame. Returns a fresh object each call. */
  read(): AudioReactiveData;
  /** Tear down internal nodes. Idempotent. */
  dispose(): void;
}

const FFT_SIZE = 4096; // ~11.7 Hz/bin at 48 kHz, ~10.7 Hz/bin at 44.1 kHz

const PRE_EMPHASIS_FREQ = 2000;
const PRE_EMPHASIS_GAIN_DB = 6;

const BAND_EDGES_HZ = {
  subBass: 150,
  bass: 250,
  mid: 2000,
  upperMid: 6000,
  treble: 16000,
};

const ENV = {
  bass:    { attack: 0.70, decay: 0.10 },
  mid:     { attack: 0.50, decay: 0.04 },
  treble:  { attack: 0.65, decay: 0.12 },
  overall: { attack: 0.50, decay: 0.05 },
};

// Beat detection: median + MAD * 1.4826 (consistent estimator of sigma for normal dist)
const FLUX_HISTORY_FRAMES = 43;
const KICK_REFRACTORY_MS = 220;
const KICK_THRESHOLD_K = 1.5;
const SNARE_REFRACTORY_MS = 130;
const SNARE_THRESHOLD_K = 1.7;
const MAD_TO_SIGMA = 1.4826;

const NOISE_FLOOR = 0.08;

// Loudness AGC
const LOUDNESS_TARGET = 0.45;
const LOUDNESS_TIME_CONSTANT_FRAMES = 600; // ~10 seconds at 60 fps
const AGC_MIN_GAIN = 0.5;
const AGC_MAX_GAIN = 4.0;

// Section detection. Compares short-term loudness (~2 s) to the long-term EMA
// (~10 s, the AGC tracker). When the ratio jumps past SECTION_RATIO_THRESHOLD
// we fire a one-frame `section` flag (cooled down for SECTION_COOLDOWN_MS so
// each chorus/drop fires exactly once). SECTION_MIN_LOUDNESS prevents false
// positives on very quiet songs / song starts where small absolute changes
// produce huge ratios.
const SHORT_LOUDNESS_TIME_CONSTANT_FRAMES = 120; // ~2 s at 60 fps
const SECTION_RATIO_THRESHOLD = 1.30;
const SECTION_COOLDOWN_MS = 6000;
const SECTION_MIN_LOUDNESS = 0.15;
// Section strength persists for the cooldown so visuals can sustain. After
// cooldown it's zeroed for the next ramp-up. Decay below is per-frame at 60 fps.
const SECTION_STRENGTH_HOLD_FRAMES = 360; // ~6 s

// Spectral descriptors
// Log-Hz normalization: centroid in [CENTROID_HZ_MIN, CENTROID_HZ_MAX] -> [0, 1].
// Below the floor or above the ceiling clamps. Tuned to perceptually meaningful range.
const CENTROID_HZ_MIN = 200;
const CENTROID_HZ_MAX = 4000;
// Smoothing time constants (per-frame alpha at ~60 fps): fast enough to track musical
// changes (verses vs choruses), slow enough not to jitter on individual hits.
const CENTROID_SMOOTH_ALPHA = 0.10; // ~150 ms time constant
const FLATNESS_SMOOTH_ALPHA = 0.05; // ~300 ms time constant
const FLATNESS_LOG_EPS = 1e-6;

// Tempo tracking
const TEMPO_MAX_KICKS = 16;
const TEMPO_MIN_KICKS_FOR_LOCK = 6;
const TEMPO_GRID_REJECT_RATIO = 0.5;     // reject kick < 50% of period since last kick
const TEMPO_PREDICT_CONFIDENCE = 0.7;    // confidence threshold to fire predicted beats
const TEMPO_GRID_CONFIDENCE = 0.6;       // confidence threshold for grid suppression
const TEMPO_MIN_BPM_PERIOD_MS = 333;     // 180 BPM
const TEMPO_MAX_BPM_PERIOD_MS = 1000;    // 60 BPM

// Robust order statistics over a small history. Sorts a copy each call;
// FLUX_HISTORY_FRAMES is small (~43) so this is cheap.
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

function medianAbsoluteDeviation(values: readonly number[], med: number): number {
  if (values.length === 0) return 0;
  const deviations = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) deviations[i] = Math.abs(values[i] - med);
  deviations.sort((a, b) => a - b);
  return deviations[deviations.length >> 1];
}

interface TempoTracker {
  register(time: number): void;
  /** True if this candidate hit fits the locked tempo grid. Always true with no lock. */
  fitsGrid(time: number, lastKickTime: number): boolean;
  /** True if we should fire a predicted beat now (detection missed and confidence high). */
  shouldFirePredicted(now: number, lastFiredBeatTime: number): boolean;
  readonly tempo: number;
  readonly confidence: number;
}

function createTempoTracker(): TempoTracker {
  const kickTimes: number[] = [];
  let tempoBpm = 0;
  let confidence = 0;

  const recompute = () => {
    if (kickTimes.length < 4) {
      tempoBpm = 0;
      confidence = 0;
      return;
    }

    // Inter-beat intervals, normalized to plausible 60-180 BPM range.
    // Half/double-time hits get folded onto the canonical period.
    const normalized: number[] = [];
    for (let i = 1; i < kickTimes.length; i++) {
      let ibi = kickTimes[i] - kickTimes[i - 1];
      while (ibi < TEMPO_MIN_BPM_PERIOD_MS) ibi *= 2;
      while (ibi > TEMPO_MAX_BPM_PERIOD_MS) ibi /= 2;
      normalized.push(ibi);
    }

    const med = median(normalized);
    const mad = medianAbsoluteDeviation(normalized, med);
    if (med <= 0) {
      tempoBpm = 0;
      confidence = 0;
      return;
    }

    const relativeMad = mad / med;
    confidence = Math.max(0, Math.min(1, 1 - relativeMad * 3));
    tempoBpm = 60000 / med;
  };

  return {
    register(time: number) {
      kickTimes.push(time);
      if (kickTimes.length > TEMPO_MAX_KICKS) kickTimes.shift();
      recompute();
    },
    fitsGrid(time: number, lastKickTime: number): boolean {
      if (confidence < TEMPO_GRID_CONFIDENCE || tempoBpm === 0 || lastKickTime === 0) return true;
      const period = 60000 / tempoBpm;
      return (time - lastKickTime) >= period * TEMPO_GRID_REJECT_RATIO;
    },
    shouldFirePredicted(now: number, lastFiredBeatTime: number): boolean {
      if (
        confidence < TEMPO_PREDICT_CONFIDENCE ||
        tempoBpm === 0 ||
        kickTimes.length < TEMPO_MIN_KICKS_FOR_LOCK ||
        lastFiredBeatTime === 0
      ) return false;
      const period = 60000 / tempoBpm;
      const elapsed = now - lastFiredBeatTime;
      // Fire if we're between 100% and 150% of one period overdue. Single firing per slot
      // is enforced by the caller updating lastFiredBeatTime on fire.
      return elapsed > period && elapsed < period * 1.5;
    },
    get tempo() { return tempoBpm; },
    get confidence() { return confidence; },
  };
}

export function createAudioAnalyzer(config: AudioAnalyzerConfig): AudioAnalyzer {
  const { audioContext, sourceNode } = config;

  const preEmphasis = audioContext.createBiquadFilter();
  preEmphasis.type = 'highshelf';
  preEmphasis.frequency.value = PRE_EMPHASIS_FREQ;
  preEmphasis.gain.value = PRE_EMPHASIS_GAIN_DB;

  const analyser = audioContext.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.3;
  analyser.minDecibels = -100;
  analyser.maxDecibels = -10;

  sourceNode.connect(preEmphasis);
  preEmphasis.connect(analyser);

  const bufferLength = analyser.frequencyBinCount;
  const floatData = new Float32Array(bufferLength);
  const prevFloatData = new Float32Array(bufferLength);
  prevFloatData.fill(-100);

  const binWidth = audioContext.sampleRate / analyser.fftSize;
  const subBassEnd  = Math.min(bufferLength, Math.ceil(BAND_EDGES_HZ.subBass  / binWidth));
  const bassEnd     = Math.min(bufferLength, Math.ceil(BAND_EDGES_HZ.bass     / binWidth));
  const midEnd      = Math.min(bufferLength, Math.ceil(BAND_EDGES_HZ.mid      / binWidth));
  const upperMidEnd = Math.min(bufferLength, Math.ceil(BAND_EDGES_HZ.upperMid / binWidth));
  const trebleEnd   = Math.min(bufferLength, Math.ceil(BAND_EDGES_HZ.treble   / binWidth));

  let envBass = 0, envMid = 0, envTreble = 0, envOverall = 0;

  const kickFluxHistory: number[] = [];
  const snareFluxHistory: number[] = [];
  let lastKickTime = 0;
  let lastSnareTime = 0;
  let lastFiredBeatTime = 0; // detected OR predicted, used for prediction debounce

  // AGC state
  let longTermLoudness = 0;
  const loudnessAlpha = 1 / LOUDNESS_TIME_CONSTANT_FRAMES;

  // Section detection state. shortTermLoudness tracks ~2 s, longTermLoudness ~10 s.
  // When short jumps significantly above long (and absolute level is high enough),
  // we fire a one-frame section event. lastSectionStrength holds the magnitude so
  // the visualization can fade against it for the cooldown duration.
  let shortTermLoudness = 0;
  const shortLoudnessAlpha = 1 / SHORT_LOUDNESS_TIME_CONSTANT_FRAMES;
  let lastSectionTime = 0;
  let lastSectionStrength = 0;
  const sectionStrengthDecay = Math.exp(-1 / SECTION_STRENGTH_HOLD_FRAMES);

  // Spectral descriptor smoothing state
  let smoothedCentroid = 0.5; // start neutral so the first few frames don't slam to 0
  let smoothedFlatness = 0.5;

  // Precompute log-Hz mapping bounds for centroid normalization (avoids per-frame Math.log).
  const centroidLogMin = Math.log(CENTROID_HZ_MIN);
  const centroidLogRange = Math.log(CENTROID_HZ_MAX) - centroidLogMin;

  const tempo = createTempoTracker();

  const applyEnvelope = (current: number, raw: number, attack: number, decay: number) => {
    const rate = raw > current ? attack : decay;
    return current + rate * (raw - current);
  };

  const robustThreshold = (history: number[], k: number) => {
    if (history.length === 0) return { threshold: Infinity, scale: 0 };
    const med = median(history);
    const mad = medianAbsoluteDeviation(history, med);
    const sigma = mad * MAD_TO_SIGMA;
    return { threshold: Math.max(med + k * sigma, 0.005), scale: sigma };
  };

  const pushFlux = (history: number[], value: number) => {
    history.push(value);
    if (history.length > FLUX_HISTORY_FRAMES) history.shift();
  };

  const clamp01 = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;

  let disposed = false;

  function read(): AudioReactiveData {
    if (disposed) {
      return {
        bass: 0, mid: 0, treble: 0, overall: 0,
        beat: false, beatStrength: 0,
        kick: false, kickStrength: 0,
        snare: false, snareStrength: 0,
        centroid: 0.5, flatness: 0.5,
        tempo: 0, tempoConfidence: 0,
        nextBeatIn: Infinity, beatPhase: 0,
        loudness: 0, section: false, sectionStrength: 0,
      };
    }

    analyser.getFloatFrequencyData(floatData);

    let subBassSum = 0, bassSum = 0, midSum = 0, upperMidSum = 0, trebleSum = 0;
    let subBassCount = 0, bassCount = 0, midCount = 0, upperMidCount = 0, trebleCount = 0;
    let kickFlux = 0, snareFlux = 0;
    // Centroid: bin-weighted magnitude mean. Flatness: log-sum for geometric mean.
    let centroidNumerator = 0;
    let centroidDenominator = 0;
    let logMagSum = 0;

    for (let i = 1; i < trebleEnd; i++) {
      const magnitude = (floatData[i] + 100) / 90;
      const m = magnitude > 0 ? magnitude : 0;
      const prev = (prevFloatData[i] + 100) / 90;
      const p = prev > 0 ? prev : 0;
      const delta = m - p;
      const positiveDelta = delta > 0 ? delta : 0;

      if (i < subBassEnd) {
        subBassSum += m; subBassCount++;
        kickFlux += positiveDelta;
      } else if (i < bassEnd) {
        bassSum += m; bassCount++;
      } else if (i < midEnd) {
        midSum += m; midCount++;
      } else if (i < upperMidEnd) {
        upperMidSum += m; upperMidCount++;
        snareFlux += positiveDelta;
      } else {
        trebleSum += m; trebleCount++;
      }

      // Centroid: weighted mean of bin index (proxy for frequency, scaled later by binWidth)
      centroidNumerator += i * m;
      centroidDenominator += m;
      // Flatness: epsilon-protected log so silent bins don't blow up to -Infinity
      logMagSum += Math.log(m + FLATNESS_LOG_EPS);
    }
    prevFloatData.set(floatData);

    const rawSubBass  = subBassCount  > 0 ? subBassSum  / subBassCount  : 0;
    const rawBass     = bassCount     > 0 ? bassSum     / bassCount     : 0;
    const rawMid      = midCount      > 0 ? midSum      / midCount      : 0;
    const rawUpperMid = upperMidCount > 0 ? upperMidSum / upperMidCount : 0;
    const rawTreble   = trebleCount   > 0 ? trebleSum   / trebleCount   : 0;

    const combinedBass = rawSubBass * 0.65 + rawBass * 0.35;
    const combinedMid  = rawMid     * 0.60 + rawUpperMid * 0.40;
    const rawOverall   = combinedBass * 0.35 + combinedMid * 0.35 + rawTreble * 0.30;

    if (rawOverall < NOISE_FLOOR) {
      // Decay to silence; don't update AGC, centroid, or flatness trackers (silence is
      // not informative about the song's character, and updating would drag them around).
      envBass    = applyEnvelope(envBass,    0, ENV.bass.attack,    ENV.bass.decay);
      envMid     = applyEnvelope(envMid,     0, ENV.mid.attack,     ENV.mid.decay);
      envTreble  = applyEnvelope(envTreble,  0, ENV.treble.attack,  ENV.treble.decay);
      envOverall = applyEnvelope(envOverall, 0, ENV.overall.attack, ENV.overall.decay);
      pushFlux(kickFluxHistory, 0);
      pushFlux(snareFluxHistory, 0);
      // Section strength decays even through silence so a long break doesn't keep
      // the previous section glow alive forever.
      lastSectionStrength *= sectionStrengthDecay;
      return {
        bass: envBass, mid: envMid, treble: envTreble, overall: envOverall,
        beat: false, beatStrength: 0,
        kick: false, kickStrength: 0,
        snare: false, snareStrength: 0,
        centroid: smoothedCentroid, flatness: smoothedFlatness,
        tempo: tempo.tempo, tempoConfidence: tempo.confidence,
        nextBeatIn: Infinity, beatPhase: 0,
        loudness: longTermLoudness,
        section: false, sectionStrength: lastSectionStrength,
      };
    }

    // --- Spectral descriptors (only updated on non-silent frames) ---------------------
    // Centroid: convert bin-weighted mean to Hz, then log-normalize to 0..1.
    if (centroidDenominator > 0) {
      const centroidBin = centroidNumerator / centroidDenominator;
      const centroidHz = Math.max(centroidBin * binWidth, CENTROID_HZ_MIN);
      const rawCentroid = Math.max(0, Math.min(1,
        (Math.log(centroidHz) - centroidLogMin) / centroidLogRange
      ));
      smoothedCentroid += CENTROID_SMOOTH_ALPHA * (rawCentroid - smoothedCentroid);
    }
    // Flatness: geometric mean / arithmetic mean. Both computed over the same bin set
    // [1, trebleEnd), so they share the same N. Use the centroid sum as arith.
    const totalBins = trebleEnd - 1;
    if (totalBins > 0 && centroidDenominator > 0) {
      const arithMean = centroidDenominator / totalBins;
      const geoMean = Math.exp(logMagSum / totalBins);
      const rawFlatness = Math.max(0, Math.min(1, geoMean / arithMean));
      smoothedFlatness += FLATNESS_SMOOTH_ALPHA * (rawFlatness - smoothedFlatness);
    }

    // Long-term loudness EMA, only updated on non-silent frames so silence doesn't
    // drag the tracker down (which would over-amplify the next loud passage).
    longTermLoudness += loudnessAlpha * (rawOverall - longTermLoudness);
    // Short-term loudness on the same input. Together they form a 2 s vs 10 s
    // ratio that signals chorus / drop transitions.
    shortTermLoudness += shortLoudnessAlpha * (rawOverall - shortTermLoudness);

    // AGC gain: target / longTermLoudness, clamped. Pre-envelope so the envelope
    // follower sees normalized dynamics across loud/quiet songs.
    const agcGain = longTermLoudness > 0.001
      ? Math.min(AGC_MAX_GAIN, Math.max(AGC_MIN_GAIN, LOUDNESS_TARGET / longTermLoudness))
      : 1;

    const gainedBass    = clamp01(combinedBass * agcGain);
    const gainedMid     = clamp01(combinedMid  * agcGain);
    const gainedTreble  = clamp01(rawTreble    * agcGain);
    const gainedOverall = clamp01(rawOverall   * agcGain);

    envBass    = applyEnvelope(envBass,    gainedBass,    ENV.bass.attack,    ENV.bass.decay);
    envMid     = applyEnvelope(envMid,     gainedMid,     ENV.mid.attack,     ENV.mid.decay);
    envTreble  = applyEnvelope(envTreble,  gainedTreble,  ENV.treble.attack,  ENV.treble.decay);
    envOverall = applyEnvelope(envOverall, gainedOverall, ENV.overall.attack, ENV.overall.decay);

    // Beat detection runs on raw flux (gain-invariant: scaling kickFlux scales the
    // threshold proportionally, so AGC doesn't bias detection).
    pushFlux(kickFluxHistory, kickFlux);
    pushFlux(snareFluxHistory, snareFlux);

    const now = performance.now();

    const { threshold: kickThreshold, scale: kickScale } =
      robustThreshold(kickFluxHistory, KICK_THRESHOLD_K);
    let kickHit = kickFlux > kickThreshold && (now - lastKickTime) > KICK_REFRACTORY_MS;
    // Tempo grid suppression: reject kicks that violate the locked tempo period.
    if (kickHit && !tempo.fitsGrid(now, lastKickTime)) {
      kickHit = false;
    }
    const kickStrength = kickHit
      ? Math.min(1, (kickFlux - kickThreshold) / Math.max(0.005, kickScale * 2))
      : 0;
    if (kickHit) {
      lastKickTime = now;
      tempo.register(now);
      lastFiredBeatTime = now;
    }

    const { threshold: snareThreshold, scale: snareScale } =
      robustThreshold(snareFluxHistory, SNARE_THRESHOLD_K);
    const snareHit = snareFlux > snareThreshold && (now - lastSnareTime) > SNARE_REFRACTORY_MS;
    if (snareHit) lastSnareTime = now;
    const snareStrength = snareHit
      ? Math.min(1, (snareFlux - snareThreshold) / Math.max(0.005, snareScale * 2))
      : 0;

    // Tempo prediction: if we have a confident tempo lock and detection missed,
    // synthesize a beat at the predicted time. Uses lastFiredBeatTime to debounce.
    let predictedBeat = false;
    if (!kickHit && tempo.shouldFirePredicted(now, lastFiredBeatTime)) {
      predictedBeat = true;
      lastFiredBeatTime = now;
    }

    const isBeat = kickHit || snareHit || predictedBeat;
    // Predicted beats use a moderate strength (0.55) so they're visible but not
    // overwhelming. Detected hits scale with their flux above threshold.
    const detectedStrength = Math.max(kickStrength, snareStrength * 0.8);
    const beatStrength = predictedBeat
      ? Math.max(detectedStrength, 0.55)
      : detectedStrength;

    // For the legacy `beat` flag, predicted beats are reported as "kick" since they
    // continue the rhythmic pulse even when detection missed.
    const kickEvent = kickHit || predictedBeat;
    const reportedKickStrength = predictedBeat
      ? Math.max(kickStrength, 0.55)
      : kickStrength;

    // --- Section detection: short-vs-long loudness ratio ----------------------------
    // Fires once per chorus / drop. Cooldown prevents spamming on sustained loud
    // sections; min-loudness prevents false fires when the song is just starting up.
    let sectionThisFrame = false;
    if (
      longTermLoudness > SECTION_MIN_LOUDNESS &&
      now - lastSectionTime > SECTION_COOLDOWN_MS
    ) {
      const ratio = shortTermLoudness / longTermLoudness;
      if (ratio > SECTION_RATIO_THRESHOLD) {
        sectionThisFrame = true;
        lastSectionTime = now;
        // Strength: 0.0 at threshold, 1.0 at 80% above threshold (ratio = 1.30 + 0.40 = 1.70).
        // Most "drops" land in [1.4, 1.8]; full-on chorus jumps can exceed that.
        lastSectionStrength = Math.min(1, (ratio - SECTION_RATIO_THRESHOLD) / 0.4);
      }
    }
    // Decay strength regardless of whether we fired this frame, so the visual fades.
    if (!sectionThisFrame) {
      lastSectionStrength *= sectionStrengthDecay;
    }

    // --- Tempo phase + lookahead ----------------------------------------------------
    let nextBeatIn = Infinity;
    let beatPhase = 0;
    if (tempo.tempo > 0 && lastFiredBeatTime > 0) {
      const period = 60000 / tempo.tempo;
      const elapsed = now - lastFiredBeatTime;
      // beatPhase: 0 immediately after the beat fires, climbs toward 1 over `period`,
      // then wraps. We cap at 1.5 periods elapsed so a long drop-out doesn't make
      // phase nonsensical (it'll re-anchor on the next detection/prediction).
      if (elapsed < period * 1.5) {
        beatPhase = (elapsed / period) % 1;
        nextBeatIn = Math.max(0, period - elapsed);
      }
    }

    return {
      bass: envBass,
      mid: envMid,
      treble: envTreble,
      overall: envOverall,
      beat: isBeat,
      beatStrength,
      kick: kickEvent,
      kickStrength: reportedKickStrength,
      snare: snareHit,
      snareStrength,
      centroid: smoothedCentroid,
      flatness: smoothedFlatness,
      tempo: tempo.tempo,
      tempoConfidence: tempo.confidence,
      nextBeatIn,
      beatPhase,
      loudness: longTermLoudness,
      section: sectionThisFrame,
      sectionStrength: lastSectionStrength,
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    try { sourceNode.disconnect(preEmphasis); } catch { /* already disconnected */ }
    try { preEmphasis.disconnect(); } catch { /* already disconnected */ }
    try { analyser.disconnect(); } catch { /* already disconnected */ }
  }

  return { read, dispose };
}
