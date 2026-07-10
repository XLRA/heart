/* ──────────────────────────────────────────────────────────────
   stormAudio — real-sample storm SFX + background music via Web Audio.

   Audio graph:

     destination
       ← master         (MASTER_VOLUME, or 0 when muted via the speaker icon)
           ← stormGain  (rain-slider volume 0..1) ── the "rain" bus
               ← rainGain    (RAIN_LEVEL × lifecycle + thunder ducking)
                   ← rainSource (looping rain sample)
               ← [thunder]   (one gain+filter chain per strike)
               ← windGain    (gust envelopes, idles at 0)
                   ← windFilter (bandpass ~340Hz whoosh)
                       ← windSource (looping synthesized noise)
           ← songGain   (song-slider volume → SONG_MAX) ── the "song" bus
               ← songSource  (current track; advances through SONG_FILES)

   Two user-facing volumes (persisted across reloads/pages): one for
   the rain/storm bus (rain loop + thunder ride along, since thunder is
   part of the storm) and one for the song bus. The speaker icon is a
   master mute layered on top of both.

   Rain ambient
   ------------
   A single seamless rain loop streamed through the storm bus. Fades in
   over 1.5s on unlock so it never pops in. Its steady level rides the
   storm lifecycle (setStormIntensity) so the soundscape calms and
   surges with the visuals.

   Wind
   ----
   Fully synthesized — no sample file. A looping white-noise buffer
   through a low bandpass (~340Hz) idles at zero gain; each visual
   wind sheet triggers triggerWindGust with the sheet's own envelope
   timings, so the audible swell attacks, holds, and dies in lockstep
   with the rain leaning in on screen. The filter sweeps brighter
   toward the gust peak — the classic wind "whoosh."

   Thunder
   -------
   Two role-based sample pools. NEAR for close strikes (clicks + intro),
   FAR for background flashes + the welcome rumble. Each trigger picks
   the pool by distance, then a sample (avoiding back-to-back dupes),
   pitches it ±15%, applies a distance-driven low-pass + amplitude
   envelope, and schedules it sample-accurate from the AudioContext
   clock. Routed through the storm bus so the rain slider rides thunder
   too — muting the rain mutes the whole storm soundscape.

   Song
   ----
   A looping playlist (SONG_FILES). Each track is decoded to an
   AudioBuffer and played through the song bus; on natural end the
   engine advances to the next track (wrapping), prefetching the
   upcoming buffer so the handoff is seamless. A single-entry playlist
   just loops in place.

   Files (drop into /public/audio/...):
     audio/storm/rain.mp3          — long, seamlessly loopable rain
     audio/storm/thunder-near.mp3  — close strike (sharp crack)
     audio/storm/thunder-far.mp3   — distant flash (hollow rumble)
     audio/songs/*.m4a             — background songs (see SONG_FILES)

   The whole module is gated behind explicit unlock() to comply with
   browser autoplay policies.
   ────────────────────────────────────────────────────────────── */

type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };

interface ThunderOptions {
  /** 0 = overhead strike (sharp + bright), 1 = distant rumble. Default 0. */
  distance?: number;
  /** Overall amplitude scaling 0..1. Default 1. */
  intensity?: number;
  /** Schedule offset in seconds from "now". Default 0 (immediate). */
  delay?: number;
}

/** Master output level — caps the entire scene at this fraction of
 *  unity. The speaker icon toggles this between MASTER_VOLUME and 0. */
const MASTER_VOLUME = 0.78;

/** Steady rain ambient level within the storm bus. */
const RAIN_LEVEL = 0.55;

/** Thunder peak level (per trigger) before distance attenuation. */
const THUNDER_LEVEL = 0.85;

/** Wind gust peak level within the storm bus. Sits well under the
 *  rain — a gust should be felt as pressure, not heard as a hair
 *  dryer. Scaled further by each sheet's own peak (0.75-1). */
const WIND_LEVEL = 0.38;

/** Song-bus gain when the song slider is at 100%. Sits a touch UNDER
 *  the rain so music + rain stay balanced even at full song volume —
 *  music is perceptually louder than broadband rain hiss at equal gain. */
const SONG_MAX = 0.42;

/** Default slider positions on first visit (no persisted value yet). */
export const DEFAULT_RAIN_VOLUME = 0.7;
export const DEFAULT_SONG_VOLUME = 0.6;

const RAIN_VOLUME_KEY = 'stormRainVolume';
const SONG_VOLUME_KEY = 'stormSongVolume';

/** A landing-scene song. Add entries to grow the playlist — the engine
 *  plays index 0 on unlock and advances through the list on each track
 *  end, wrapping back to the start. */
export interface LandingSong {
  /** Public path under /public (e.g. '/audio/songs/foo.m4a'). */
  src: string;
  /** Display title shown in the audio tab. */
  title: string;
}

/** Songs bundled with the landing. Highest-bitrate sources available
 *  (AAC 130k m4a) — decoded through the Web Audio graph like the rain
 *  loop, so they get the same gain/balance + tab-suspend treatment. */
export const SONG_FILES: LandingSong[] = [
  {
    src: '/audio/songs/bear.m4a',
    title: 'rock burwell — bear',
  },
  {
    src: '/audio/songs/neverending-cycle.m4a',
    title: 'arimasen, trapeia — neverending cycle',
  },
  {
    src: '/audio/songs/bipolar.m4a',
    title: '.diedlonely — bipolar',
  },
];

const RAIN_FILE = '/audio/storm/rain.mp3';
/** Sharp, full-bandwidth thunder for close strikes (distance ≤ 0.5). */
const THUNDER_NEAR_FILES = ['/audio/storm/thunder-near.mp3'];
/** Hollow, distant boom for background flashes (distance > 0.5). */
const THUNDER_FAR_FILES = ['/audio/storm/thunder-far.mp3'];

/** Distance value at which we switch from the NEAR pool to the FAR pool. */
const NEAR_FAR_THRESHOLD = 0.5;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function readPersistedVolume(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = Number.parseFloat(raw);
    if (!Number.isFinite(v)) return fallback;
    return clamp01(v);
  } catch {
    return fallback;
  }
}

function writePersistedVolume(key: string, v: number) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, String(v));
  } catch {
    /* quota / private mode — silently ignored */
  }
}

/** Persisted rain-slider value (0..1). Safe before mount / on SSR. */
export function readPersistedRainVolume(): number {
  return readPersistedVolume(RAIN_VOLUME_KEY, DEFAULT_RAIN_VOLUME);
}

/** Persisted song-slider value (0..1). Safe before mount / on SSR. */
export function readPersistedSongVolume(): number {
  return readPersistedVolume(SONG_VOLUME_KEY, DEFAULT_SONG_VOLUME);
}

export class StormAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Rain bus — rain loop + thunder. Gain = rain-slider value. */
  private stormGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private rainSource: AudioBufferSourceNode | null = null;
  private rainBuffer: AudioBuffer | null = null;
  /** Wind chain — synthesized noise → bandpass → gust-envelope gain. */
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windSource: AudioBufferSourceNode | null = null;
  /** Storm-lifecycle scaling of the steady rain level (0.72..1.05). */
  private rainLevelK = 1;
  /** Song bus — gain = song-slider value × SONG_MAX. */
  private songGain: GainNode | null = null;
  private songSource: AudioBufferSourceNode | null = null;
  /** Decoded song buffers, cached by SONG_FILES index. */
  private songBuffers = new Map<number, AudioBuffer>();
  /** Debounce handle for manual skip crossfades. */
  private skipTimer: number | null = null;
  private thunderNearBuffers: AudioBuffer[] = [];
  private thunderFarBuffers: AudioBuffer[] = [];
  private muted = true;
  private unlocked = false;
  /** Avoid playing the same sample twice in a row, per pool. */
  private lastIdx = { near: -1, far: -1 };
  /** User-controlled bus volumes in 0..1. */
  private rainVolume = readPersistedRainVolume();
  private songVolume = readPersistedSongVolume();
  /** Index into SONG_FILES of the currently-playing song. */
  private currentSongIndex = 0;
  /** Fired when the playing song changes (track advance), with its title. */
  private onSongChange: ((title: string) => void) | null = null;

  isUnlocked(): boolean {
    return this.unlocked;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Current rain-slider value in 0..1. */
  getRainVolume(): number {
    return this.rainVolume;
  }

  /** Current song-slider value in 0..1. */
  getSongVolume(): number {
    return this.songVolume;
  }

  /** Display title of the currently-playing song (for the audio tab). */
  getCurrentSongTitle(): string {
    return SONG_FILES[this.currentSongIndex]?.title ?? '';
  }

  /** Register a callback fired whenever the playing song changes, so the
   *  UI can keep its now-playing label in sync with auto-advance. */
  setSongChangeHandler(cb: ((title: string) => void) | null) {
    this.onSongChange = cb;
  }

  /** Effective master gain (mute is the only thing it gates now —
   *  per-voice level lives on the storm / song buses). */
  private effectiveMaster(): number {
    return this.muted ? 0 : MASTER_VOLUME;
  }

  /**
   * Set the rain/storm-bus volume (0..1). Persists immediately and
   * smoothly ramps the storm-bus gain over 80ms to avoid clicks. The
   * rain loop AND thunder ride this bus, so it dims the whole storm.
   */
  setRainVolume(v: number) {
    const c = clamp01(v);
    this.rainVolume = c;
    writePersistedVolume(RAIN_VOLUME_KEY, c);
    if (!this.ctx || !this.stormGain) return;
    const t = this.ctx.currentTime;
    const g = this.stormGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(c, t + 0.08);
  }

  /**
   * Set the song-bus volume (0..1). Persists immediately and smoothly
   * ramps the song-bus gain (scaled by SONG_MAX) over 80ms.
   */
  setSongVolume(v: number) {
    const c = clamp01(v);
    this.songVolume = c;
    writePersistedVolume(SONG_VOLUME_KEY, c);
    if (!this.ctx || !this.songGain) return;
    const t = this.ctx.currentTime;
    const g = this.songGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(c * SONG_MAX, t + 0.08);
  }

  /**
   * Create the AudioContext, decode all samples, and start the rain
   * loop + first song. Must be called from a user gesture handler — the
   * browser's autoplay policy refuses to start audio otherwise. Resolves
   * once everything is playing (or has failed gracefully).
   */
  async unlock(): Promise<void> {
    if (this.unlocked) return;
    const Ctx =
      window.AudioContext ||
      (window as WindowWithWebkit).webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio not supported');

    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    // Master — unmuted on unlock (the user just asked for sound).
    this.master = this.ctx.createGain();
    this.master.gain.value = MASTER_VOLUME;
    this.master.connect(this.ctx.destination);

    // Storm bus — rain + thunder, scaled by the rain slider.
    this.stormGain = this.ctx.createGain();
    this.stormGain.gain.value = this.rainVolume;
    this.stormGain.connect(this.master);

    // Song bus — scaled by the song slider × SONG_MAX. Starts at 0 and
    // fades in once the first track is playing (startSong).
    this.songGain = this.ctx.createGain();
    this.songGain.gain.value = 0;
    this.songGain.connect(this.master);

    // Decode rain + song 0 + both thunder pools in parallel. Any single
    // failure (404, unsupported format, decode error) is swallowed — the
    // missing voice just stays silent rather than tearing down the scene.
    const songStart = 1;
    const nearStart = songStart + 1;
    const farStart = nearStart + THUNDER_NEAR_FILES.length;
    const song0 = SONG_FILES[0]?.src;
    const buffers = await Promise.all([
      this.loadSample(RAIN_FILE),
      song0 ? this.loadSample(song0) : Promise.resolve(null),
      ...THUNDER_NEAR_FILES.map((f) => this.loadSample(f)),
      ...THUNDER_FAR_FILES.map((f) => this.loadSample(f)),
    ]);
    const notNull = (b: AudioBuffer | null): b is AudioBuffer => b !== null;

    this.rainBuffer = buffers[0];
    if (buffers[songStart]) this.songBuffers.set(0, buffers[songStart]!);
    this.thunderNearBuffers = buffers.slice(nearStart, farStart).filter(notNull);
    this.thunderFarBuffers = buffers.slice(farStart).filter(notNull);

    this.startRainLoop();
    this.startWindBed();
    this.startSong();

    this.muted = false;
    this.unlocked = true;
  }

  /** Current steady rain-loop level (base × lifecycle scaling).
   *  Thunder ducking recovers to THIS, not the raw constant, so a
   *  duck during a calm phase doesn't ramp the rain back up. */
  private currentRainLevel(): number {
    return RAIN_LEVEL * this.rainLevelK;
  }

  /**
   * Couple the rain loop's steady level to the storm lifecycle
   * (0 = drizzle, 1 = peak downpour). Long 2.5s ramp — the arc
   * itself moves over minutes, the audio should drift with it,
   * never audibly "step." Safe to call before unlock (the value
   * is picked up when the loop starts) and cheap to call often.
   */
  setStormIntensity(intensity: number) {
    const k = lerp(0.72, 1.05, clamp01(intensity));
    if (Math.abs(k - this.rainLevelK) < 0.01) return;
    this.rainLevelK = k;
    if (!this.ctx || !this.rainGain) return;
    const t = this.ctx.currentTime;
    const g = this.rainGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.currentRainLevel(), t + 2.5);
  }

  /** Start the always-running (gain 0) wind chain. The noise is
   *  synthesized in place — 2s of white noise looped through a low
   *  bandpass reads as wind; no sample file needed. An idle source
   *  + biquad at zero gain costs effectively nothing. */
  private startWindBed() {
    if (!this.ctx || !this.stormGain) return;
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, sr * 2, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 340;
    this.windFilter.Q.value = 0.6;

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.stormGain);
    src.start();
    this.windSource = src;
  }

  /**
   * Audible gust swell, envelope-matched to a visual wind sheet.
   * The caller passes the sheet's own ramp/plateau/release timings
   * (ms) and peak (0..1) so sound and rain lean in together. The
   * bandpass sweeps brighter toward the peak — the "whoosh."
   */
  triggerWindGust(opts: {
    rampUpMs: number;
    plateauMs: number;
    rampDownMs: number;
    peak: number;
  }) {
    if (!this.ctx || !this.windGain || !this.windFilter) return;
    const t = this.ctx.currentTime;
    const peak = clamp01(opts.peak);
    const up = Math.max(0.05, opts.rampUpMs / 1000);
    const hold = Math.max(0, opts.plateauMs / 1000);
    const down = Math.max(0.2, opts.rampDownMs / 1000);
    const target = WIND_LEVEL * (0.6 + peak * 0.4);

    const g = this.windGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(target, t + up);
    g.setValueAtTime(target, t + up + hold);
    g.linearRampToValueAtTime(0, t + up + hold + down);

    const f = this.windFilter.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    f.linearRampToValueAtTime(340 + 420 * peak, t + up);
    f.linearRampToValueAtTime(300, t + up + hold + down);
  }

  private async loadSample(url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) {
        console.warn(`[stormAudio] ${url} → HTTP ${res.status}`);
        return null;
      }
      const arr = await res.arrayBuffer();
      return await this.ctx.decodeAudioData(arr);
    } catch (e) {
      console.warn(`[stormAudio] failed to load ${url}:`, e);
      return null;
    }
  }

  private startRainLoop() {
    if (!this.ctx || !this.stormGain || !this.rainBuffer) return;

    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rainGain.connect(this.stormGain);

    this.rainSource = this.ctx.createBufferSource();
    this.rainSource.buffer = this.rainBuffer;
    this.rainSource.loop = true;
    this.rainSource.connect(this.rainGain);
    this.rainSource.start();

    // Fade in over 1.5s — instant rain start sounds harsh.
    const t = this.ctx.currentTime;
    this.rainGain.gain.setValueAtTime(0, t);
    this.rainGain.gain.linearRampToValueAtTime(this.currentRainLevel(), t + 1.5);
  }

  /** Start the playlist at the current index, fading the song bus in
   *  over 2s so the track eases in beneath the rain. */
  private startSong() {
    if (!this.ctx || !this.songGain) return;
    const buf = this.songBuffers.get(this.currentSongIndex);
    if (!buf) return;
    this.playSongBuffer(this.currentSongIndex, buf);

    const t = this.ctx.currentTime;
    const g = this.songGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(this.songVolume * SONG_MAX, t + 2.0);
  }

  /** Swap the song bus to a decoded buffer and start it. On natural end
   *  (multi-song playlist) advances to the next track + prefetches the
   *  one after; a single-song playlist just loops in place. */
  private playSongBuffer(index: number, buf: AudioBuffer) {
    if (!this.ctx || !this.songGain) return;

    if (this.songSource) {
      // Clear onended BEFORE stopping so the manual stop doesn't fire the
      // advance handler (stop() triggers 'ended' too).
      this.songSource.onended = null;
      try { this.songSource.stop(); } catch { /* already stopped */ }
      this.songSource.disconnect();
    }

    this.currentSongIndex = index;
    const single = SONG_FILES.length <= 1;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = single;
    src.connect(this.songGain);
    if (!single) {
      src.onended = () => {
        const next = (this.currentSongIndex + 1) % SONG_FILES.length;
        void this.advanceToSong(next);
      };
    }
    src.start();
    this.songSource = src;

    this.onSongChange?.(SONG_FILES[index]?.title ?? '');

    // Prefetch the next track so the handoff is gapless.
    if (!single) {
      void this.ensureSongBuffer((index + 1) % SONG_FILES.length);
    }
  }

  /** Decode + cache a song buffer by index (idempotent). */
  private async ensureSongBuffer(index: number): Promise<AudioBuffer | null> {
    const cached = this.songBuffers.get(index);
    if (cached) return cached;
    const src = SONG_FILES[index]?.src;
    if (!src) return null;
    const buf = await this.loadSample(src);
    if (buf) this.songBuffers.set(index, buf);
    return buf;
  }

  private async advanceToSong(index: number) {
    const buf = await this.ensureSongBuffer(index);
    // Context may have been disposed while decoding — playSongBuffer
    // guards on ctx/songGain so a late resolve is harmless.
    if (!buf) return;
    this.playSongBuffer(index, buf);
  }

  /** Skip to the next song in the playlist (wraps to the start). */
  nextSong() {
    this.skip(1);
  }

  /** Skip to the previous song in the playlist (wraps to the end). */
  prevSong() {
    this.skip(-1);
  }

  /**
   * Crossfade the song bus to another playlist track. The current track
   * fades out over ~60ms (so the hard cut never clicks), then the new
   * track starts and fades back in. Debounced so mashing skip only lands
   * the final track; the index + now-playing label update optimistically
   * so the UI stays responsive while a (possibly uncached) buffer loads.
   */
  private skip(dir: number) {
    const len = SONG_FILES.length;
    if (len <= 1 || !this.ctx || !this.songGain) return;

    const index = (this.currentSongIndex + dir + len) % len;
    this.currentSongIndex = index;
    this.onSongChange?.(SONG_FILES[index]?.title ?? '');

    const t = this.ctx.currentTime;
    const g = this.songGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + 0.06);

    if (this.skipTimer !== null) window.clearTimeout(this.skipTimer);
    this.skipTimer = window.setTimeout(() => {
      this.skipTimer = null;
      void this.swapToSong(index);
    }, 80);
  }

  private async swapToSong(index: number) {
    const buf = await this.ensureSongBuffer(index);
    if (!buf || !this.ctx || !this.songGain) return;
    // The target may have moved again during an async buffer load (rapid
    // skips) — only commit if this is still the wanted track.
    if (index !== this.currentSongIndex) return;
    this.playSongBuffer(index, buf);
    const t = this.ctx.currentTime;
    const g = this.songGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(this.songVolume * SONG_MAX, t + 0.14);
  }

  /**
   * Trigger a single thunder hit. Cheap (no allocations beyond one
   * AudioBufferSourceNode + one filter + one gain), so it's safe to call
   * dozens of times during a swell.
   */
  triggerThunder(opts: ThunderOptions = {}) {
    if (!this.ctx || !this.stormGain) return;

    const distance = clamp01(opts.distance ?? 0);
    const intensity = clamp01(opts.intensity ?? 1);
    const delay = Math.max(0, opts.delay ?? 0);

    // Pool selection by distance. A sharp click-strike sample stretched
    // into a "distant rumble" via low-pass alone never sounds quite right
    // — the transient still reads as close. Pick the right SOURCE first,
    // then sculpt with the filter.
    const useNear = distance <= NEAR_FAR_THRESHOLD;
    const pool = useNear ? this.thunderNearBuffers : this.thunderFarBuffers;
    if (pool.length === 0) {
      const fallback = useNear ? this.thunderFarBuffers : this.thunderNearBuffers;
      if (fallback.length === 0) return;
      this.playThunderFromPool(fallback, useNear ? 'far' : 'near', distance, intensity, delay);
      return;
    }
    this.playThunderFromPool(pool, useNear ? 'near' : 'far', distance, intensity, delay);
  }

  private playThunderFromPool(
    pool: AudioBuffer[],
    poolKey: 'near' | 'far',
    distance: number,
    intensity: number,
    delay: number,
  ) {
    if (!this.ctx || !this.stormGain) return;

    // Pick a sample, avoid back-to-back duplicates so thunder stays
    // unpredictable when fired in rapid succession.
    let idx = Math.floor(Math.random() * pool.length);
    if (idx === this.lastIdx[poolKey] && pool.length > 1) {
      idx = (idx + 1) % pool.length;
    }
    this.lastIdx[poolKey] = idx;

    const buf = pool[idx];
    const t = this.ctx.currentTime + delay;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // ±15% pitch shift — same sample never sounds identical twice.
    src.playbackRate.value = 0.85 + Math.random() * 0.30;

    // Distance-driven low-pass. Air absorbs HF; distant thunder is just
    // sub-bass rumble. Cutoff sweeps logarithmically from 22kHz (close,
    // full bandwidth) → 600Hz (far, muffled).
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const cutoffOctaves = lerp(0, Math.log2(22000 / 600), 1 - distance);
    lp.frequency.value = 600 * Math.pow(2, cutoffOctaves);
    lp.Q.value = 0.7;

    // Distance attenuation — closer to inverse-square than linear.
    const distanceAtten = lerp(1.0, 0.28, distance * distance);

    const g = this.ctx.createGain();
    g.gain.value = intensity * distanceAtten * THUNDER_LEVEL;

    src.connect(lp);
    lp.connect(g);
    g.connect(this.stormGain);

    src.start(t);

    // ─ Subtle rain ducking ──────────────────────────────────
    // Dip rain by up to 12% during a close thunder so the strike has
    // audible presence. Distant thunder doesn't duck — it would feel
    // artificial since real distant thunder sits alongside the rain.
    if (this.rainGain && distance < 0.5 && intensity > 0.4) {
      // Duck fraction (≈ up to 22%) of the CURRENT lifecycle-scaled
      // level, and recover to it — same proportional dip as the old
      // absolute 0.12 off RAIN_LEVEL, but correct in calm phases.
      const duckK = (1 - distance * 2) * intensity * 0.22;
      const base = this.currentRainLevel();
      const rg = this.rainGain.gain;
      rg.cancelScheduledValues(t);
      rg.setValueAtTime(rg.value, t);
      rg.linearRampToValueAtTime(base * (1 - duckK), t + 0.06);
      rg.linearRampToValueAtTime(base, t + 1.6);
    }
  }

  /**
   * Suspend the AudioContext — call when the tab goes hidden. The
   * context stops consuming CPU until resume() is called. No-op if not
   * running. Mute + playback state survive across suspend/resume.
   */
  suspend(): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    void this.ctx.suspend().catch(() => { /* ignore */ });
  }

  /** Resume the AudioContext — call when the tab becomes visible. */
  resume(): void {
    if (!this.ctx || this.ctx.state !== 'suspended') return;
    void this.ctx.resume().catch(() => { /* ignore */ });
  }

  /** Smooth ramp so mute/unmute never pops. */
  setMuted(muted: boolean) {
    if (!this.ctx || !this.master) return;
    this.muted = muted;
    const t = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.effectiveMaster(), t + 0.15);
  }

  dispose() {
    if (this.skipTimer !== null) {
      window.clearTimeout(this.skipTimer);
      this.skipTimer = null;
    }
    if (this.rainSource) {
      try { this.rainSource.stop(); } catch { /* already stopped */ }
      this.rainSource.disconnect();
    }
    if (this.windSource) {
      try { this.windSource.stop(); } catch { /* already stopped */ }
      this.windSource.disconnect();
    }
    if (this.songSource) {
      this.songSource.onended = null;
      try { this.songSource.stop(); } catch { /* already stopped */ }
      this.songSource.disconnect();
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => { /* ignore */ });
    }
    this.ctx = null;
    this.master = null;
    this.stormGain = null;
    this.rainGain = null;
    this.rainSource = null;
    this.rainBuffer = null;
    this.windGain = null;
    this.windFilter = null;
    this.windSource = null;
    this.rainLevelK = 1;
    this.songGain = null;
    this.songSource = null;
    this.songBuffers.clear();
    this.thunderNearBuffers = [];
    this.thunderFarBuffers = [];
    this.lastIdx = { near: -1, far: -1 };
    this.onSongChange = null;
    this.unlocked = false;
  }
}
