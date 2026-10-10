/**
 * Groove engine: playback position in, AudioReactiveData out.
 *
 * Instead of listening to the music (impossible for Spotify's DRM-protected
 * stream), the engine KNOWS the music: it reads a GrooveModel (see
 * analysis.ts) along a song-time beat clock and emits, every frame, the same
 * fields the live analyzer produces -- envelopes, kick/snare events, tempo,
 * beat phase, time-to-next-hit. Because it reads ahead instead of detecting
 * after the fact, it has zero detection latency and genuinely anticipates
 * hits, which a live analyzer can only approximate.
 *
 * Three ways the song-time beat clock is established, best first:
 *   - 'full'      : the model IS the whole track (local files). Exact.
 *   - 'beatmap'   : full-song beat positions from AcousticBrainz, with the
 *                   30 s preview's groove (kicks, snares, envelopes) mapped
 *                   onto every bar of the song by beat index. Phase-exact,
 *                   follows live-band tempo drift.
 *   - 'synced'    : preview grid whose phase was locked by mic or tap sync.
 *   - 'estimated' : preview grid, phase unknown (tempo and groove are still
 *                   the song's own; hits are softened until synced).
 *
 * Pure TypeScript, no DOM: unit-testable in Node.
 */

import type { GrooveModel, OnsetEvent } from './analysis';
import type { AudioReactiveData } from '../audioAnalyzer';

export type PhaseSource = 'full' | 'beatmap' | 'synced' | 'estimated';

/** Systematic lateness of AcousticBrainz (Essentia) beat positions relative
 *  to our onset-based beats, measured on matched audio (~14-20 ms). */
const BEATMAP_BIAS_S = 0.016;

/** How strongly to play hits whose phase we can't vouch for. */
const ESTIMATED_HIT_SCALE = 0.65;

/** Minimum fraction of clip bars a 16th-note slot must be hit in to enter
 *  the groove template. */
const TEMPLATE_MIN_RATE = 0.4;
const SNARE_SALIENCE_RATIO = 0.5;

const SECTION_RATIO_THRESHOLD = 1.3;
const SECTION_COOLDOWN_S = 6;
const SECTION_MIN_LOUDNESS = 0.15;

// --- Beat clocks -------------------------------------------------------------------

export interface BeatClock {
  /** Continuous beat coordinate at song time s (beat j starts at integer j). */
  coord(s: number): number;
  /** Song time of continuous beat coordinate x. */
  timeOf(x: number): number;
}

export function gridClock(t0: number, period: number): BeatClock {
  return {
    coord: (s) => (s - t0) / period,
    timeOf: (x) => t0 + x * period,
  };
}

/** Beat clock over an explicit (possibly drifting) beat list; extrapolates
 *  past either end with the edge inter-beat interval. */
export function listClock(beats: number[]): BeatClock {
  const n = beats.length;
  if (n < 2) return gridClock(beats[0] || 0, 0.5);
  const first = beats[1] - beats[0];
  const last = beats[n - 1] - beats[n - 2];
  const find = (s: number) => {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] <= s) lo = mid; else hi = mid;
    }
    return lo;
  };
  return {
    coord(s) {
      if (s < beats[0]) return (s - beats[0]) / first;
      if (s >= beats[n - 1]) return n - 1 + (s - beats[n - 1]) / last;
      const i = find(s);
      return i + (s - beats[i]) / (beats[i + 1] - beats[i]);
    },
    timeOf(x) {
      if (x < 0) return beats[0] + x * first;
      if (x >= n - 1) return beats[n - 1] + (x - (n - 1)) * last;
      const i = Math.floor(x);
      return beats[i] + (x - i) * (beats[i + 1] - beats[i]);
    },
  };
}

/**
 * Turn raw AcousticBrainz beat positions into a clock. Grid-like songs get a
 * robust linear fit (immune to the tracker's occasional off-beat flips); songs
 * that drift (live bands) keep the beat list with gaps and doubles repaired.
 */
export function beatMapClock(
  raw: number[],
  fitGrid: (b: number[]) => { period: number; t0: number; gridness: number },
  bias = BEATMAP_BIAS_S,
): BeatClock {
  const beats = raw.map((b) => b - bias).filter((b, i, a) => i === 0 || b > a[i - 1]);
  const fit = fitGrid(beats);
  if (fit.gridness >= 0.85) return gridClock(fit.t0, fit.period);
  // Repair: drop beats that make implausibly short intervals, interpolate
  // across gaps (missed beats), against a running local median period.
  const out: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    const lo = Math.max(1, i - 8);
    const hi = Math.min(beats.length - 1, i + 8);
    const ibis: number[] = [];
    for (let j = lo; j <= hi; j++) ibis.push(beats[j] - beats[j - 1]);
    ibis.sort((a, b) => a - b);
    const p = ibis[ibis.length >> 1] || fit.period;
    if (out.length === 0) { out.push(beats[i]); continue; }
    const gap = beats[i] - out[out.length - 1];
    if (gap < 0.6 * p) continue;
    const missing = Math.round(gap / p) - 1;
    for (let m = 1; m <= missing && missing <= 4; m++) out.push(out[out.length - 1] + gap / (missing + 1));
    out.push(beats[i]);
  }
  return listClock(out);
}

// --- Engine --------------------------------------------------------------------------

interface BeatEvent {
  frac: number;
  s: number;
}

export interface EngineOptions {
  model: GrooveModel;
  /** True when the model covers the whole song (local file): model time IS song time. */
  fullTrack: boolean;
  /** Whole-song beat positions (AcousticBrainz), seconds. */
  beatMap?: number[] | null;
  /** Grid fitter (analysis.fitGrid), injected to keep this module import-light. */
  fitGrid: (b: number[]) => { period: number; t0: number; gridness: number };
  /** Spotify/ReccoBeats energy in [0, 1]; gently scales intensity. */
  energy?: number;
}

export interface PhaseLock {
  /** Seconds added to the beat clock's beat times. */
  shift: number;
  /** Which song beat index (mod 4) is the downbeat. */
  bar: number;
}

export interface GrooveEngine {
  readonly source: PhaseSource;
  readonly bpm: number;
  readonly model: GrooveModel;
  /** Frame for song time `s` (seconds, already latency-corrected). */
  read(s: number, playing: boolean): AudioReactiveData;
  /** Lock the phase (mic/tap sync). Does not apply in 'full' mode. */
  setPhaseLock(lock: PhaseLock | null, source?: 'synced' | 'estimated'): void;
  getPhaseLock(): PhaseLock;
  /** Upgrade to a whole-song beat map once it arrives. `downbeat` (a song
   *  time known to be a bar's first beat, e.g. from Spotify's bars) fixes the
   *  bar; `bias` overrides the AcousticBrainz timing bias; `shift` is the
   *  initial latency compensation. */
  setBeatMap(beats: number[], info?: { downbeat?: number; bias?: number; shift?: number }): void;
  /** Song-time section changes (chorus/drop), e.g. from Spotify's sections. */
  setSections(list: Array<{ t: number; s: number }>): void;
  /** Model time (seconds into the analyzed clip) that song time s maps to,
   *  under a hypothetical lock. Used by the sync layer's matched filter. */
  modelTimeAt(s: number, lock: PhaseLock): number;
  /** Beat period (seconds) near song time s. */
  periodAt(s: number): number;
  /** Continuous position within the bar, in beats [0, 4), at song time s
   *  under a hypothetical lock. */
  barPositionAt(s: number, lock: PhaseLock): number;
  /** Bar-averaged onset strength of the clip (full band and kick band),
   *  TEMPLATE_BINS bins per bar. The sync layer's matched filter. */
  readonly onsetTemplate: { full: Float32Array; low: Float32Array; binsPerBar: number };
}

export const TEMPLATE_BINS = 192;

export function createGrooveEngine(opts: EngineOptions): GrooveEngine {
  const { model, fullTrack } = opts;
  const fps = model.fps;
  const nFrames = model.overall.length;
  const energyGain = opts.energy != null ? 0.88 + 0.24 * Math.max(0, Math.min(1, opts.energy)) : 1;

  // ---- Model-side beat grid (the clip's own beats) ----
  // Grid-like clips use the fitted grid (sub-ms phase, no tracker jitter);
  // others use the tracked beats.
  const useGrid = model.gridness >= 0.8 && model.beats.length >= 4;
  const pb: number[] = [];
  let pd = 0; // index into pb of the first downbeat
  if (useGrid) {
    const kMin = Math.ceil((0 - model.gridT0) / model.period);
    const kMax = Math.floor((model.duration - model.gridT0) / model.period);
    for (let k = kMin; k <= kMax; k++) pb.push(model.gridT0 + k * model.period);
    const dbTime = model.beats[Math.min(model.downbeat, model.beats.length - 1)];
    const kd = Math.round((dbTime - model.gridT0) / model.period) - kMin;
    pd = ((kd % 4) + 4) % 4;
  } else {
    for (const b of model.beats) pb.push(b);
    pd = model.downbeat % 4;
  }
  if (pb.length < 6) {
    // Degenerate clip: fall back to a pure grid at the model tempo.
    pb.length = 0;
    for (let t = 0; t < model.duration; t += model.period) pb.push(t);
    pd = 0;
  }
  const lastUsable = pb.length - 2; // need pb[i + 1] for interpolation
  const nBars = Math.max(1, Math.floor((lastUsable - pd + 1) / 4));
  const loopBeats = nBars * 4;

  /**
   * Consensus groove template. Real drummers (and many producers) vary the
   * pattern bar to bar, so replaying raw clip bars at other points in the song
   * lands a lot of hits where the song has none. Instead, per 16th-note slot
   * of the bar, we keep a hit only if it recurs in >= TEMPLATE_MIN_RATE of the
   * clip's bars, at its mean strength and mean micro-timing. Measured on a
   * live-drummed rock track this lifts whole-song kick precision substantially
   * over raw looping, and on looped electronic music it is lossless.
   */
  const buildTemplate = (events: OnsetEvent[], salienceRatio: number) => {
    const count = new Float64Array(16), str = new Float64Array(16), off = new Float64Array(16);
    for (const e of events) {
      // Locate the event's beat in the clip grid.
      let i = -1;
      for (let b = pd; b < pd + loopBeats; b++) if (pb[b] <= e.t && e.t < pb[b + 1]) { i = b; break; }
      if (i < 0) continue;
      const posInBar = (i - pd) % 4 + (e.t - pb[i]) / (pb[i + 1] - pb[i]);
      const slotF = posInBar * 4;
      const slot = Math.round(slotF) % 16;
      count[slot]++;
      str[slot] += e.s;
      off[slot] += slotF - Math.round(slotF);
    }
    const byBeat: BeatEvent[][] = [[], [], [], []];
    // Salience = recurrence x mean strength. Busy detectors (snare picking
    // up strummed guitars) clear the recurrence bar on most slots; keeping
    // only slots within TEMPLATE_SALIENCE_RATIO of the most salient one
    // leaves the actual backbeat.
    let maxSalience = 0;
    for (let slot = 0; slot < 16; slot++) {
      if (count[slot] > 0) maxSalience = Math.max(maxSalience, (count[slot] / nBars) * (str[slot] / count[slot]));
    }
    for (let slot = 0; slot < 16; slot++) {
      const rate = count[slot] / nBars;
      if (count[slot] === 0 || rate < TEMPLATE_MIN_RATE) continue;
      if (rate * (str[slot] / count[slot]) < salienceRatio * maxSalience) continue;
      const pos = (slot + off[slot] / count[slot]) / 4; // beats into the bar
      const beat = Math.min(3, Math.max(0, Math.floor(pos)));
      byBeat[beat].push({ frac: Math.max(0, Math.min(0.999, pos - beat)), s: (str[slot] / count[slot]) * Math.min(1, 0.4 + rate) });
    }
    for (const list of byBeat) list.sort((a, b) => a.frac - b.frac);
    return byBeat;
  };
  // Kicks keep every recurring slot (the low end really is that busy);
  // snares keep only the salient backbeat.
  const kickTemplate = buildTemplate(model.kicks, 0);
  const snareTemplate = buildTemplate(model.snares, SNARE_SALIENCE_RATIO);
  /** Events of song beat j (bar-relative position from the phase lock). */
  const eventsOf = (template: BeatEvent[][], j: number, bar: number) => template[(((j - bar) % 4) + 4) % 4];

  const sample = (arr: Float32Array, t: number) => {
    const x = t * fps;
    if (x <= 0) return arr[0] || 0;
    if (x >= nFrames - 1) return arr[nFrames - 1] || 0;
    const i = Math.floor(x);
    const f = x - i;
    return arr[i] + (arr[i + 1] - arr[i]) * f;
  };

  // Beat-synchronous average of the clip's onset curves over its bars.
  const onsetTemplate = (() => {
    const full = new Float32Array(TEMPLATE_BINS), low = new Float32Array(TEMPLATE_BINS);
    const perBeat = TEMPLATE_BINS / 4;
    for (let b = 0; b < nBars; b++) {
      for (let k = 0; k < TEMPLATE_BINS; k++) {
        const pos = k / perBeat;
        const i = pd + b * 4 + Math.floor(pos);
        const tau = pb[i] + (pos - Math.floor(pos)) * (pb[i + 1] - pb[i]);
        full[k] += sample(model.onset, tau) / nBars;
        low[k] += sample(model.lowOnset, tau) / nBars;
      }
    }
    return { full, low, binsPerBar: TEMPLATE_BINS };
  })();

  // ---- Song-side beat clock ----
  let source: PhaseSource = fullTrack ? 'full' : 'estimated';
  let baseClock: BeatClock;
  if (fullTrack) {
    baseClock = useGrid ? gridClock(model.gridT0, model.period) : listClock(model.beats);
  } else if (opts.beatMap && opts.beatMap.length > 16) {
    baseClock = beatMapClock(opts.beatMap, opts.fitGrid);
    source = 'beatmap';
  } else {
    // Phase unknown: the clip's own grid phase is as good as any guess.
    baseClock = gridClock(model.gridT0, model.period);
  }
  // Downbeat convention for beat-map clocks: songs overwhelmingly start on
  // a downbeat, so the first beat at or after ~0 s is "1".
  const defaultBar = (clock: BeatClock) => {
    const x0 = Math.ceil(clock.coord(-0.05));
    return ((x0 % 4) + 4) % 4;
  };
  let lock: PhaseLock = { shift: 0, bar: fullTrack ? pd : source === 'beatmap' ? defaultBar(baseClock) : 0 };
  // What setPhaseLock(null) restores: the beat map's own alignment (with its
  // latency compensation), or the bare grid's arbitrary phase.
  let defaultLock: PhaseLock = { ...lock };
  if (fullTrack) {
    // In full mode beat indices are model beat indices; the downbeat is the
    // model's (relative to beat 0 of the clock).
    const firstBeat = useGrid ? Math.ceil((0 - model.gridT0) / model.period) : 0;
    lock = { shift: 0, bar: (((firstBeat + pd) % 4) + 4) % 4 };
  }

  // Song beat coordinate -> model (clip) time.
  const mapBeat = (j: number, bar: number) => {
    const rel = j - bar;
    const barIdx = Math.floor(rel / 4);
    const pos = rel - barIdx * 4;
    return pd + (((barIdx % nBars) + nBars) % nBars) * 4 + pos;
  };
  const modelTimeFromCoord = (x: number, bar: number) => {
    const j = Math.floor(x);
    const frac = x - j;
    const i = mapBeat(j, bar);
    return pb[i] + frac * (pb[i + 1] - pb[i]);
  };

  // ---- Section events (full-track only; a looped clip would fake drops) ----
  let sections: Array<{ t: number; s: number }> = [];
  if (fullTrack) {
    const aShort = 1 - Math.exp(-1 / (2 * fps));
    const aLong = 1 - Math.exp(-1 / (10 * fps));
    let st = 0, lt = 0, last = -Infinity;
    for (let f = 0; f < nFrames; f++) {
      const v = model.overall[f];
      st += aShort * (v - st);
      lt += aLong * (v - lt);
      const t = f / fps;
      if (t > 4 && lt > SECTION_MIN_LOUDNESS && t - last > SECTION_COOLDOWN_S && st / lt > SECTION_RATIO_THRESHOLD) {
        sections.push({ t, s: Math.min(1, (st / lt - SECTION_RATIO_THRESHOLD) / 0.4) });
        last = t;
      }
    }
  }

  // ---- Runtime state ----
  let prevS: number | null = null;
  let prevX = 0;
  let envBass = 0, envMid = 0, envTreble = 0, envOverall = 0;
  let lastSectionStrength = 0;
  let lastReadS = 0;

  const silentFrame = (): AudioReactiveData => ({
    bass: envBass, mid: envMid, treble: envTreble, overall: envOverall,
    beat: false, beatStrength: 0, kick: false, kickStrength: 0, snare: false, snareStrength: 0,
    centroid: 0.5, flatness: 0.5, tempo: 0, tempoConfidence: 0, nextBeatIn: Infinity, beatPhase: 0,
    loudness: model.loudness, section: false, sectionStrength: lastSectionStrength, downbeat: false,
  });

  const coordAt = (s: number) => baseClock.coord(s - lock.shift);
  const periodAt = (s: number) => {
    const x = coordAt(s);
    return Math.max(0.2, baseClock.timeOf(Math.floor(x) + 1) - baseClock.timeOf(Math.floor(x)));
  };

  function read(s: number, playing: boolean): AudioReactiveData {
    if (!playing) {
      // Let envelopes fall while paused so a resume starts clean.
      envBass *= 0.9; envMid *= 0.9; envTreble *= 0.9; envOverall *= 0.9;
      prevS = null;
      return silentFrame();
    }
    const dt = prevS == null ? 1 / 60 : Math.max(0, s - lastReadS);
    lastReadS = s;
    const x = coordAt(s);
    const jumped = prevS == null || s < prevS - 0.05 || s - prevS > 0.5;

    // --- Events crossed since the last frame ---
    let kick = false, kickS = 0, snare = false, snareS = 0, downbeat = false, section = false;
    if (!jumped) {
      if (fullTrack) {
        const scan = (events: OnsetEvent[]) => {
          let best = -1;
          // Events are time-sorted; binary search the window start.
          let lo = 0, hi = events.length;
          while (lo < hi) { const m = (lo + hi) >> 1; if (events[m].t < (prevS as number)) lo = m + 1; else hi = m; }
          for (let i = lo; i < events.length && events[i].t < s; i++) best = Math.max(best, events[i].s);
          return best;
        };
        kickS = scan(model.kicks);
        snareS = scan(model.snares);
      } else {
        kickS = -1; snareS = -1;
        for (let j = Math.floor(prevX); j <= Math.floor(x); j++) {
          const lo = j === Math.floor(prevX) ? prevX - j : 0;
          const hi = j === Math.floor(x) ? x - j : 1;
          for (const e of eventsOf(kickTemplate, j, lock.bar)) if (e.frac >= lo && e.frac < hi) kickS = Math.max(kickS, e.s);
          for (const e of eventsOf(snareTemplate, j, lock.bar)) if (e.frac >= lo && e.frac < hi) snareS = Math.max(snareS, e.s);
        }
      }
      for (const sec of sections) {
        if (sec.t >= (prevS as number) && sec.t < s) { section = true; lastSectionStrength = sec.s; }
      }
      // Downbeat: crossing the start of a bar.
      for (let j = Math.floor(prevX) + 1; j <= Math.floor(x); j++) {
        if ((((j - lock.bar) % 4) + 4) % 4 === 0) downbeat = true;
      }
      kick = kickS >= 0;
      snare = snareS >= 0;
      if (!kick) kickS = 0;
      if (!snare) snareS = 0;
    }
    prevS = s;
    prevX = x;

    const hitScale = source === 'estimated' ? ESTIMATED_HIT_SCALE : 1;
    kickS *= hitScale;
    snareS *= hitScale;

    // --- Envelopes from the model at the mapped clip time ---
    const tau = fullTrack ? s : modelTimeFromCoord(x, lock.bar);
    const tb = Math.min(1, sample(model.bass, tau) * energyGain);
    const tm = Math.min(1, sample(model.mid, tau) * energyGain);
    const tt = Math.min(1, sample(model.treble, tau) * energyGain);
    const to = Math.min(1, sample(model.overall, tau) * energyGain);
    // Light runtime follower: absorbs the step at the clip-loop seam and at
    // jumps without adding perceptible lag to the model's own envelopes.
    const k = jumped ? 1 : 1 - Math.pow(1 - 0.55, Math.max(0.25, Math.min(4, dt * 60)));
    envBass += (tb - envBass) * k;
    envMid += (tm - envMid) * k;
    envTreble += (tt - envTreble) * k;
    envOverall += (to - envOverall) * k;

    // --- Tempo / lookahead ---
    const j = Math.floor(x);
    const beatPhase = x - j;
    const beatStart = baseClock.timeOf(j) + lock.shift;
    const beatEnd = baseClock.timeOf(j + 1) + lock.shift;
    const period = Math.max(0.2, beatEnd - beatStart);
    // Time to the next kick within the next ~1.5 beats (what the heart's
    // anticipation should ramp into), else to the next beat.
    let nextHit = (beatEnd - s) * 1000;
    if (!fullTrack) {
      outer: for (let jj = j; jj <= j + 1; jj++) {
        for (const e of eventsOf(kickTemplate, jj, lock.bar)) {
          const xe = jj + e.frac;
          if (xe > x && e.s > 0.3) { nextHit = (baseClock.timeOf(xe) + lock.shift - s) * 1000; break outer; }
        }
      }
    } else {
      for (const e of model.kicks) if (e.t > s && e.s > 0.3) { nextHit = (e.t - s) * 1000; break; }
    }
    const confidence = model.tempoConfidence * (source === 'estimated' ? 0.55 : 1);

    if (!section) lastSectionStrength *= Math.pow(0.9972, Math.max(0.25, dt * 60));

    return {
      bass: envBass,
      mid: envMid,
      treble: envTreble,
      overall: envOverall,
      beat: kick || snare,
      beatStrength: Math.max(kickS, snareS * 0.8),
      kick,
      kickStrength: kickS,
      snare,
      snareStrength: snareS,
      centroid: sample(model.centroid, tau),
      flatness: sample(model.flatness, tau),
      tempo: 60 / period,
      tempoConfidence: confidence,
      nextBeatIn: Math.max(0, nextHit),
      beatPhase,
      loudness: model.loudness,
      section,
      sectionStrength: lastSectionStrength,
      downbeat,
    };
  }

  return {
    get source() { return source; },
    get bpm() { return 60 / model.period; },
    model,
    read,
    setPhaseLock(next, src = 'synced') {
      if (fullTrack) return;
      if (next) {
        lock = { shift: next.shift, bar: ((next.bar % 4) + 4) % 4 };
        // A beat map stays a beat map (the lock just fine-tunes it); a bare
        // grid becomes 'synced' once something real locked its phase.
        if (src === 'synced' && source === 'estimated') source = 'synced';
      } else {
        lock = { ...defaultLock };
        if (source === 'synced') source = 'estimated';
      }
      prevS = null;
    },
    getPhaseLock: () => ({ ...lock }),
    setBeatMap(beats, info = {}) {
      if (fullTrack || beats.length <= 16) return;
      baseClock = beatMapClock(beats, opts.fitGrid, info.bias);
      source = 'beatmap';
      const bar = info.downbeat != null
        ? ((Math.round(baseClock.coord(info.downbeat - (info.bias ?? BEATMAP_BIAS_S))) % 4) + 4) % 4
        : defaultBar(baseClock);
      lock = { shift: info.shift ?? 0, bar };
      defaultLock = { ...lock };
      prevS = null;
    },
    setSections(list) {
      sections = list.slice().sort((a, b) => a.t - b.t);
    },
    modelTimeAt(s, l) {
      if (fullTrack) return s;
      return modelTimeFromCoord(baseClock.coord(s - l.shift), ((l.bar % 4) + 4) % 4);
    },
    periodAt,
    barPositionAt(s, l) {
      const x = baseClock.coord(s - l.shift) - (((l.bar % 4) + 4) % 4);
      return ((x % 4) + 4) % 4;
    },
    onsetTemplate,
  };
}

/**
 * A stand-in model when no audio clip could be found: the song's tempo (from
 * ReccoBeats/Deezer metadata) driving a neutral backbeat -- kicks on 1 and 3,
 * snares on 2 and 4, eighth-note hats. Honest about what it is: the engine
 * treats it as 'estimated' and plays its hits softly.
 */
export function createSyntheticModel(bpm: number, energy = 0.6): GrooveModel {
  const fps = 100;
  const period = 60 / bpm;
  const bars = 8;
  const duration = bars * 4 * period + period;
  const n = Math.ceil(duration * fps);
  const bass = new Float32Array(n), mid = new Float32Array(n), treble = new Float32Array(n), overall = new Float32Array(n);
  const centroid = new Float32Array(n).fill(0.6), flatness = new Float32Array(n).fill(0.3);
  const onset = new Float32Array(n), lowOnset = new Float32Array(n);
  const kicks: OnsetEvent[] = [], snares: OnsetEvent[] = [], beats: number[] = [];
  const base = 0.3 + 0.25 * energy;
  for (let b = 0; b <= bars * 4; b++) {
    const t = b * period;
    beats.push(t);
    if (b % 2 === 0) kicks.push({ t, s: b % 4 === 0 ? 0.85 : 0.65 });
    else snares.push({ t, s: 0.7 });
  }
  for (let f = 0; f < n; f++) {
    const t = f / fps;
    const ph = (t / period) % 1;
    const beatIdx = Math.floor(t / period);
    const kickEnv = beatIdx % 2 === 0 ? Math.exp(-ph * 6) : 0;
    const snareEnv = beatIdx % 2 === 1 ? Math.exp(-ph * 8) : 0;
    const hat = Math.exp(-((t / (period / 2)) % 1) * 10);
    bass[f] = Math.min(1, base + 0.35 * kickEnv);
    mid[f] = Math.min(1, base + 0.25 * snareEnv);
    treble[f] = Math.min(1, base * 0.8 + 0.15 * hat);
    overall[f] = Math.min(1, base + 0.15 * (kickEnv + snareEnv));
    onset[f] = kickEnv > 0.95 || snareEnv > 0.95 ? 3 : hat > 0.95 ? 1 : 0;
    lowOnset[f] = kickEnv > 0.95 ? 3 : 0;
  }
  return {
    version: 0, duration, fps, bass, mid, treble, overall, centroid, flatness, onset, lowOnset,
    kicks, snares, bpm, period, beats, gridT0: 0, gridness: 1, downbeat: 0, tempoConfidence: 0.5, loudness: base,
  };
}
