/* ──────────────────────────────────────────────────────────────
   stormAudio — fully procedural storm SFX via Web Audio API.

   Two voices:
     • Rain ambient: pink-noise loop through a bandpass + highpass
       filter pair, with a slow LFO on gain for natural variation.
       Sounds like a steady downpour (not perfectly identifiable as
       any specific recording — which is the goal: ambient bed,
       not "I recognize this rain sample").

     • Thunder: synthesized per-trigger from layered brown-noise
       crackle bursts + a sub-bass rumble layer. The "distance"
       parameter controls the crackle high-frequency content,
       attack sharpness, and rumble ratio — closer thunder is
       brighter and sharper, distant thunder is bassier and longer.

   Why procedural?
     - Zero asset payload (no .mp3 / .wav files to host)
     - Sample-accurate sync to the canvas strikes via ctx.currentTime
     - Each thunder is unique — no repeat-sample fatigue
     - Easy to swap in real samples later (same API surface)

   The whole module is gated behind an explicit unlock() call so we
   comply with browser autoplay policies (no audio without a user
   gesture). Master gain ramps smoothly to avoid pops on mute/unmute.
   ────────────────────────────────────────────────────────────── */

type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };

interface ThunderOptions {
  /** 0 = close strike (sharp + bright), 1 = distant rumble. Default 0. */
  distance?: number;
  /** Overall amplitude scaling 0..1. Default 1. */
  intensity?: number;
  /** Schedule offset in seconds from "now". Default 0 (immediate). */
  delay?: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class StormAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rainBuffer: AudioBuffer | null = null;
  private rainSource: AudioBufferSourceNode | null = null;
  private rainGainNode: GainNode | null = null;
  private muted = true;

  /** Has the user gesture happened yet? (required for autoplay) */
  private unlocked = false;

  isUnlocked(): boolean {
    return this.unlocked;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /**
   * Initialize the audio context, resume it (requires a user gesture),
   * and start the rain ambient bed. Idempotent — safe to call multiple
   * times.
   */
  async unlock(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    this.unlocked = true;
    this.muted = false;

    if (this.master) {
      const t = ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(1, t + 0.6);
    }
    this.startRainAmbient();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const target = muted ? 0 : 1;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(target, t + 0.35);
  }

  /**
   * Synthesize and schedule a thunder event. Safe to call before
   * unlock() — it will be a no-op (silent until unlocked).
   */
  triggerThunder(opts: ThunderOptions = {}): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.unlocked) return;

    const distance = Math.max(0, Math.min(1, opts.distance ?? 0));
    const intensity = Math.max(0, Math.min(1, opts.intensity ?? 1));
    const startTime = ctx.currentTime + (opts.delay ?? 0);

    // Distance-driven shaping
    const sharpness = lerp(0.005, 0.18, distance);   // crackle attack
    const decay = lerp(2.2, 5.5, distance);          // rumble length
    const lowCutoff = lerp(450, 110, distance);      // crackle filter freq
    const rumbleVol = lerp(0.55, 0.95, distance);
    const crackleVol = lerp(1.0, 0.35, distance);
    const numCrackles = distance < 0.4 ? 5 : distance < 0.75 ? 3 : 2;

    const sampleRate = ctx.sampleRate;

    // ── Layer 1: Crackle bursts (the sharp claps + echoes off clouds)
    for (let i = 0; i < numCrackles; i++) {
      // First crackle is the main "boom"; subsequent are echoes.
      const crackleDelay = i === 0 ? 0 : 0.04 + Math.random() * 0.18 + i * 0.05;
      const crackleStart = startTime + crackleDelay;
      const crackleDur = 0.55 + Math.random() * 0.9;

      const buffer = ctx.createBuffer(
        1,
        Math.ceil(sampleRate * crackleDur),
        sampleRate,
      );
      const data = buffer.getChannelData(0);
      // Brown noise: integrated white noise with leakage to prevent drift.
      let last = 0;
      for (let j = 0; j < data.length; j++) {
        last = (last + (Math.random() * 2 - 1) * 0.05) * 0.96;
        data[j] = last;
      }

      const src = ctx.createBufferSource();
      src.buffer = buffer;

      // Lowpass that sweeps DOWN over the crackle duration — gives the
      // characteristic "crack-to-rumble" tonal arc of real thunder.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(lowCutoff * 2.8, crackleStart);
      lp.frequency.exponentialRampToValueAtTime(
        Math.max(40, lowCutoff * 0.7),
        crackleStart + crackleDur,
      );
      lp.Q.value = 0.7;

      const env = ctx.createGain();
      const peak = intensity * crackleVol * (i === 0 ? 1 : 0.55 + Math.random() * 0.25);
      env.gain.setValueAtTime(0, crackleStart);
      env.gain.linearRampToValueAtTime(peak, crackleStart + sharpness);
      env.gain.exponentialRampToValueAtTime(0.001, crackleStart + crackleDur);

      src.connect(lp);
      lp.connect(env);
      env.connect(master);
      src.start(crackleStart);
      src.stop(crackleStart + crackleDur + 0.05);
    }

    // ── Layer 2: Long sub-bass rumble (the chest-felt rolling decay)
    const rumbleBuffer = ctx.createBuffer(
      1,
      Math.ceil(sampleRate * decay),
      sampleRate,
    );
    const rumbleData = rumbleBuffer.getChannelData(0);
    let r = 0;
    for (let j = 0; j < rumbleData.length; j++) {
      r = (r + (Math.random() * 2 - 1) * 0.03) * 0.985;
      rumbleData[j] = r;
    }

    const rumbleSrc = ctx.createBufferSource();
    rumbleSrc.buffer = rumbleBuffer;

    const rumbleLP = ctx.createBiquadFilter();
    rumbleLP.type = 'lowpass';
    rumbleLP.frequency.value = lerp(95, 65, distance);
    rumbleLP.Q.value = 1.1;

    const rumbleEnv = ctx.createGain();
    rumbleEnv.gain.setValueAtTime(0, startTime);
    rumbleEnv.gain.linearRampToValueAtTime(
      intensity * rumbleVol * 0.8,
      startTime + Math.max(0.08, sharpness * 1.5),
    );
    rumbleEnv.gain.exponentialRampToValueAtTime(0.0001, startTime + decay);

    rumbleSrc.connect(rumbleLP);
    rumbleLP.connect(rumbleEnv);
    rumbleEnv.connect(master);
    rumbleSrc.start(startTime);
    rumbleSrc.stop(startTime + decay + 0.05);
  }

  dispose(): void {
    const ctx = this.ctx;
    if (ctx && ctx.state !== 'closed') {
      ctx.close().catch(() => {});
    }
    this.ctx = null;
    this.master = null;
    this.rainSource = null;
    this.rainGainNode = null;
    this.rainBuffer = null;
    this.unlocked = false;
  }

  // ── Internals ────────────────────────────────────────────

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const w = window as WindowWithWebkit;
    const Ctx = window.AudioContext ?? w.webkitAudioContext;
    if (!Ctx) {
      throw new Error('Web Audio API not supported in this browser');
    }
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0; // Start silent; ramps up on unlock
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    return ctx;
  }

  /**
   * Generate ~3 seconds of pink noise (1/f spectrum). Pink noise sounds
   * far more like rain than white noise — white noise sounds like
   * digital static, pink noise has the natural "swoosh" character of
   * water droplets at varying scales.
   *
   * Uses the Voss-McCartney algorithm — six leaky integrators at
   * different time constants, summed.
   */
  private generatePinkNoise(ctx: AudioContext, durationSec: number): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * durationSec);
    const buffer = ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        data[i] = pink * 0.11;
      }
    }
    return buffer;
  }

  private startRainAmbient(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    if (!this.rainBuffer) {
      this.rainBuffer = this.generatePinkNoise(ctx, 3.0);
    }
    if (this.rainSource) return; // already running

    const source = ctx.createBufferSource();
    source.buffer = this.rainBuffer;
    source.loop = true;

    // Bandpass through ~600-3500Hz to shape pink noise into "rain"
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1700;
    bandpass.Q.value = 0.9;

    // Highpass cuts the low rumble that would muddy the lightning.
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 500;

    const rainGain = ctx.createGain();
    rainGain.gain.value = 0.16;

    // Slow LFO on rain volume — natural ebb and flow.
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.frequency.value = 0.11;
    lfoDepth.gain.value = 0.035;
    lfo.connect(lfoDepth);
    lfoDepth.connect(rainGain.gain);
    lfo.start();

    source.connect(bandpass);
    bandpass.connect(highpass);
    highpass.connect(rainGain);
    rainGain.connect(master);
    source.start();

    this.rainSource = source;
    this.rainGainNode = rainGain;
  }
}
