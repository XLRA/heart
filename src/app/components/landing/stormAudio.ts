/* ──────────────────────────────────────────────────────────────
   stormAudio — real-sample storm SFX via Web Audio.

   Two voices, both backed by real recordings:

     • Rain ambient: a single seamless rain loop streamed through
       a master gain. Fades in over 1.5s on unlock so it never
       pops in.

     • Thunder: two role-based sample pools.
         NEAR  — used for close strikes (the click-to-strike
                 event + the scripted intro). Sharp transient,
                 full-bandwidth crack.
         FAR   — used for background flashes + the welcome
                 rumble. Long, hollow, distant boom.
       Each triggerThunder() call picks the pool by distance,
       then a sample from that pool (avoiding back-to-back
       duplicates), pitches it ±15% for variety, applies a
       distance-driven low-pass + amplitude envelope, and
       schedules it sample-accurate from the AudioContext clock.

   Distance modeling
   -----------------
   Air absorbs high frequencies over distance. Real distant
   thunder loses its crackle and reads as bassy rumble. On top
   of choosing the right SAMPLE, we apply a single biquad
   low-pass whose cutoff sweeps from ~22kHz (close, untouched)
   down to ~600Hz (very distant, muffled). Combined with a
   power-law amplitude roll-off, the engine renders a wide
   spectrum of strikes from just two source samples.

   Files (drop into /public/audio/storm/):
     rain.mp3            — long, seamlessly loopable rain ambient
     thunder-near.mp3    — close strike (sharp crack)
     thunder-far.mp3     — distant flash (hollow rumble)

   See /public/audio/storm/README.md for sourcing notes.

   The whole module is gated behind explicit unlock() to comply
   with browser autoplay policies.
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

/** Master output level — caps the entire scene at this fraction of unity. */
const MASTER_VOLUME = 0.78;

/** Steady rain ambient level relative to master. */
const RAIN_LEVEL = 0.55;

/** Thunder peak level (per trigger) before distance attenuation. */
const THUNDER_LEVEL = 0.85;

const RAIN_FILE = '/audio/storm/rain.mp3';
/** Sharp, full-bandwidth thunder for close strikes (distance ≤ 0.5). */
const THUNDER_NEAR_FILES = ['/audio/storm/thunder-near.mp3'];
/** Hollow, distant boom for background flashes (distance > 0.5). */
const THUNDER_FAR_FILES = ['/audio/storm/thunder-far.mp3'];

/** Distance value at which we switch from the NEAR pool to the FAR pool. */
const NEAR_FAR_THRESHOLD = 0.5;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class StormAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private rainSource: AudioBufferSourceNode | null = null;
  private rainBuffer: AudioBuffer | null = null;
  private thunderNearBuffers: AudioBuffer[] = [];
  private thunderFarBuffers: AudioBuffer[] = [];
  private muted = true;
  private unlocked = false;
  /** Avoid playing the same sample twice in a row, per pool. */
  private lastIdx = { near: -1, far: -1 };

  isUnlocked(): boolean {
    return this.unlocked;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /**
   * Create the AudioContext, decode all samples, and start the
   * rain loop. Must be called from a user gesture handler — the
   * browser's autoplay policy refuses to start audio otherwise.
   * Resolves once everything is playing (or has failed gracefully).
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

    this.master = this.ctx.createGain();
    this.master.gain.value = MASTER_VOLUME;
    this.master.connect(this.ctx.destination);

    // Decode rain + both thunder pools in parallel. Any individual
    // failure (404, unsupported format, decode error) is swallowed
    // — the missing voice just stays silent rather than tearing
    // down the whole scene. Lets the storm "work" even with a
    // partial install.
    const nearStart = 1;
    const farStart = nearStart + THUNDER_NEAR_FILES.length;
    const buffers = await Promise.all([
      this.loadSample(RAIN_FILE),
      ...THUNDER_NEAR_FILES.map((f) => this.loadSample(f)),
      ...THUNDER_FAR_FILES.map((f) => this.loadSample(f)),
    ]);
    const notNull = (b: AudioBuffer | null): b is AudioBuffer => b !== null;

    this.rainBuffer = buffers[0];
    this.thunderNearBuffers = buffers.slice(nearStart, farStart).filter(notNull);
    this.thunderFarBuffers = buffers.slice(farStart).filter(notNull);

    this.startRainLoop();

    this.muted = false;
    this.unlocked = true;
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
    if (!this.ctx || !this.master || !this.rainBuffer) return;

    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rainGain.connect(this.master);

    this.rainSource = this.ctx.createBufferSource();
    this.rainSource.buffer = this.rainBuffer;
    this.rainSource.loop = true;
    this.rainSource.connect(this.rainGain);
    this.rainSource.start();

    // Fade in over 1.5s — instant rain start sounds harsh.
    const t = this.ctx.currentTime;
    this.rainGain.gain.setValueAtTime(0, t);
    this.rainGain.gain.linearRampToValueAtTime(RAIN_LEVEL, t + 1.5);
  }

  /**
   * Trigger a single thunder hit. Cheap (no allocations beyond
   * one AudioBufferSourceNode + one filter + one gain), so it's
   * safe to call dozens of times during a swell.
   */
  triggerThunder(opts: ThunderOptions = {}) {
    if (!this.ctx || !this.master) return;

    const distance = clamp01(opts.distance ?? 0);
    const intensity = clamp01(opts.intensity ?? 1);
    const delay = Math.max(0, opts.delay ?? 0);

    // Pool selection by distance. A sharp click-strike sample
    // stretched into a "distant rumble" via low-pass alone never
    // sounds quite right — the transient still reads as close.
    // Picking the right SOURCE first, then sculpting with the
    // filter, gets us the full close→far spectrum cleanly.
    const useNear = distance <= NEAR_FAR_THRESHOLD;
    const pool = useNear ? this.thunderNearBuffers : this.thunderFarBuffers;
    if (pool.length === 0) {
      // Fall back to the other pool if the requested one is empty
      // (e.g. user only installed one thunder file).
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
    if (!this.ctx || !this.master) return;

    // Pick a sample, avoid back-to-back duplicates so thunder
    // stays unpredictable when fired in rapid succession.
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

    // Distance-driven low-pass. Air absorbs HF; distant thunder
    // is just sub-bass rumble. Cutoff sweeps logarithmically from
    // 22kHz (close, full bandwidth) → 600Hz (far, muffled).
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    // Log-space lerp so the perceptual change feels linear.
    const cutoffOctaves = lerp(0, Math.log2(22000 / 600), 1 - distance);
    lp.frequency.value = 600 * Math.pow(2, cutoffOctaves);
    lp.Q.value = 0.7;

    // Distance attenuation — closer to inverse-square than linear.
    // Close (0): full intensity. Far (1): ~28% — still audible but
    // clearly "across the valley."
    const distanceAtten = lerp(1.0, 0.28, distance * distance);

    const g = this.ctx.createGain();
    g.gain.value = intensity * distanceAtten * THUNDER_LEVEL;

    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);

    src.start(t);

    // ─ Subtle rain ducking ──────────────────────────────────
    // Dip rain by up to 12% during a close thunder so the strike
    // has audible presence. Distant thunder doesn't duck — it
    // would feel artificial since real distant thunder sits
    // alongside rain rather than replacing it.
    if (this.rainGain && distance < 0.5 && intensity > 0.4) {
      const duck = (1 - distance * 2) * intensity * 0.12;
      const rg = this.rainGain.gain;
      // Quick dip down, slow recovery — same envelope shape as a
      // sidechain compressor on a kick + bass bus.
      rg.cancelScheduledValues(t);
      rg.setValueAtTime(rg.value, t);
      rg.linearRampToValueAtTime(RAIN_LEVEL - duck, t + 0.06);
      rg.linearRampToValueAtTime(RAIN_LEVEL, t + 1.6);
    }
  }

  /**
   * Suspend the AudioContext — call when the tab goes hidden.
   * The context stops consuming CPU until resume() is called.
   * No-op if not unlocked yet, not muted, or already suspended.
   * Mute state is preserved across suspend/resume.
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
    g.linearRampToValueAtTime(muted ? 0 : MASTER_VOLUME, t + 0.15);
  }

  dispose() {
    if (this.rainSource) {
      try { this.rainSource.stop(); } catch { /* already stopped */ }
      this.rainSource.disconnect();
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => { /* ignore */ });
    }
    this.ctx = null;
    this.master = null;
    this.rainGain = null;
    this.rainSource = null;
    this.rainBuffer = null;
    this.thunderNearBuffers = [];
    this.thunderFarBuffers = [];
    this.lastIdx = { near: -1, far: -1 };
    this.unlocked = false;
  }
}
