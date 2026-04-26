/**
 * Unified real-time audio analyzer for both local-file playback (MediaElementSource)
 * and tab capture (MediaStreamSource).
 *
 * Pipeline per frame:
 *   1. getFloatFrequencyData() into a Float32Array (post pre-emphasis)
 *   2. Per-bin: compute magnitude, accumulate per-band energy + per-band positive flux
 *   3. Noise gate (silence -> output decays to zero, beats suppressed)
 *   4. Per-band asymmetric envelope follower (different attack/decay per band for
 *      a more "musical" feel: bass snaps, mid sustains, treble sparkles)
 *   5. Per-band adaptive beat detection:
 *        - Kick    : sub-bass band (20-150 Hz), tight refractory (~220ms)
 *        - Snare   : upper-mid band (2-6 kHz), shorter refractory (~130ms)
 *        - Beat    : either fired hit; strength is max of the two (snare attenuated 0.8x)
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
  beat: boolean;
  beatStrength: number;
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

// Pre-emphasis: high-shelf boost so treble is visible on bass-heavy mixes.
// Sits ONLY in the analysis branch -- listener hears unmodified audio.
const PRE_EMPHASIS_FREQ = 2000;
const PRE_EMPHASIS_GAIN_DB = 6;

// Frequency band edges in Hz. Sub-bass / upper-mid are sized for kick & snare onset
// detection; bass / mid / treble are reported visualization bands.
const BAND_EDGES_HZ = {
  subBass: 150,
  bass: 250,
  mid: 2000,
  upperMid: 6000,
  treble: 16000,
};

// Asymmetric envelope coefficients (per-frame alpha; tuned at ~60 fps).
// attack >> decay yields fast pop, slow fade.
const ENV = {
  bass:    { attack: 0.70, decay: 0.10 }, // kicks: pop hard, settle in ~150ms
  mid:     { attack: 0.50, decay: 0.04 }, // vocals/pads: smoother
  treble:  { attack: 0.65, decay: 0.12 }, // hats/cymbals: snappy
  overall: { attack: 0.50, decay: 0.05 },
};

// Beat detection
const FLUX_HISTORY_FRAMES = 43; // ~1 second of history at FFT-bound update rate
const KICK_REFRACTORY_MS = 220; // 4 hits/sec max -> ~272 BPM ceiling, fine
const KICK_THRESHOLD_K = 1.5;   // mean + 1.5*sigma
const SNARE_REFRACTORY_MS = 130;
const SNARE_THRESHOLD_K = 1.7;  // a touch higher: snares are noisier statistically

// Noise gate: if frame's combined magnitude is below this, treat as silence.
// Magnitudes are normalized via (dBFS + 100) / 90, so 0.08 ~ -92.8 dB.
const NOISE_FLOOR = 0.08;

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

  const applyEnvelope = (current: number, raw: number, attack: number, decay: number) => {
    const rate = raw > current ? attack : decay;
    return current + rate * (raw - current);
  };

  const computeAdaptiveThreshold = (history: number[], k: number) => {
    const n = history.length;
    if (n === 0) return { threshold: Infinity, stdDev: 0 };
    let sum = 0;
    for (let i = 0; i < n; i++) sum += history[i];
    const mean = sum / n;
    let varSum = 0;
    for (let i = 0; i < n; i++) {
      const d = history[i] - mean;
      varSum += d * d;
    }
    const stdDev = Math.sqrt(varSum / n);
    return { threshold: Math.max(mean + stdDev * k, 0.005), stdDev };
  };

  const pushFlux = (history: number[], value: number) => {
    history.push(value);
    if (history.length > FLUX_HISTORY_FRAMES) history.shift();
  };

  let disposed = false;

  function read(): AudioReactiveData {
    if (disposed) {
      return { bass: 0, mid: 0, treble: 0, overall: 0, beat: false, beatStrength: 0 };
    }

    analyser.getFloatFrequencyData(floatData);

    let subBassSum = 0, bassSum = 0, midSum = 0, upperMidSum = 0, trebleSum = 0;
    let subBassCount = 0, bassCount = 0, midCount = 0, upperMidCount = 0, trebleCount = 0;
    let kickFlux = 0, snareFlux = 0;

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
      envBass    = applyEnvelope(envBass,    0, ENV.bass.attack,    ENV.bass.decay);
      envMid     = applyEnvelope(envMid,     0, ENV.mid.attack,     ENV.mid.decay);
      envTreble  = applyEnvelope(envTreble,  0, ENV.treble.attack,  ENV.treble.decay);
      envOverall = applyEnvelope(envOverall, 0, ENV.overall.attack, ENV.overall.decay);
      pushFlux(kickFluxHistory, 0);
      pushFlux(snareFluxHistory, 0);
      return {
        bass: envBass, mid: envMid, treble: envTreble, overall: envOverall,
        beat: false, beatStrength: 0,
      };
    }

    envBass    = applyEnvelope(envBass,    combinedBass, ENV.bass.attack,    ENV.bass.decay);
    envMid     = applyEnvelope(envMid,     combinedMid,  ENV.mid.attack,     ENV.mid.decay);
    envTreble  = applyEnvelope(envTreble,  rawTreble,    ENV.treble.attack,  ENV.treble.decay);
    envOverall = applyEnvelope(envOverall, rawOverall,   ENV.overall.attack, ENV.overall.decay);

    pushFlux(kickFluxHistory, kickFlux);
    pushFlux(snareFluxHistory, snareFlux);

    const now = performance.now();

    const { threshold: kickThreshold, stdDev: kickStd } =
      computeAdaptiveThreshold(kickFluxHistory, KICK_THRESHOLD_K);
    const kickHit = kickFlux > kickThreshold && (now - lastKickTime) > KICK_REFRACTORY_MS;
    if (kickHit) lastKickTime = now;
    const kickStrength = kickHit
      ? Math.min(1, (kickFlux - kickThreshold) / Math.max(0.005, kickStd * 2))
      : 0;

    const { threshold: snareThreshold, stdDev: snareStd } =
      computeAdaptiveThreshold(snareFluxHistory, SNARE_THRESHOLD_K);
    const snareHit = snareFlux > snareThreshold && (now - lastSnareTime) > SNARE_REFRACTORY_MS;
    if (snareHit) lastSnareTime = now;
    const snareStrength = snareHit
      ? Math.min(1, (snareFlux - snareThreshold) / Math.max(0.005, snareStd * 2))
      : 0;

    const isBeat = kickHit || snareHit;
    const beatStrength = Math.max(kickStrength, snareStrength * 0.8);

    return {
      bass: envBass,
      mid: envMid,
      treble: envTreble,
      overall: envOverall,
      beat: isBeat,
      beatStrength,
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
