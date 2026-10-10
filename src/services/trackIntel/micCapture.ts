/**
 * Microphone capture for phase sync. Opens the mic with every speech
 * "enhancement" disabled (echo cancellation would subtract the very music we
 * want to hear), records mono PCM through an AudioWorklet, and timestamps it
 * on the performance.now() clock so it can be placed on the Spotify playback
 * timeline. Sessions are short (seconds) and fully closed afterwards so the
 * browser's recording indicator goes away.
 */

const WORKLET_SOURCE = `
class HeartCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.n = 0;
    this.start = -1;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      if (this.start < 0) this.start = currentFrame;
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage({ frame: this.start, data: this.buf });
          this.buf = new Float32Array(4096);
          this.n = 0;
          this.start = currentFrame + i + 1;
        }
      }
    }
    return true;
  }
}
registerProcessor('heart-capture', HeartCapture);
`;

export interface MicSnapshot {
  pcm: Float32Array;
  sampleRate: number;
  /** performance.now() (ms) at which sample 0 reached the microphone. */
  perfAtSample0: number;
}

export interface MicSession {
  /** Copy of everything captured so far. */
  snapshot(): MicSnapshot | null;
  /** Seconds captured so far. */
  readonly seconds: number;
  close(): void;
}

export function isMicSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== 'undefined';
}

/** 'granted' | 'denied' | 'prompt' | 'unknown' without triggering a prompt. */
export async function micPermissionState(): Promise<string> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}

export async function openMicSession(): Promise<MicSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    } as MediaTrackConstraints,
  });
  const track = stream.getAudioTracks()[0];
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') await ctx.resume();
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'heart-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
  source.connect(node);

  const chunks: Float32Array[] = [];
  let firstFrame = -1;
  let total = 0;
  node.port.onmessage = (e: MessageEvent<{ frame: number; data: Float32Array }>) => {
    if (firstFrame < 0) firstFrame = e.data.frame;
    chunks.push(e.data.data);
    total += e.data.data.length;
  };

  // Context frame -> performance.now() at which that frame's input sample hit
  // the mic. getOutputTimestamp() relates context time to the moment it is
  // PRESENTED at the output; input for the same render quantum was captured
  // roughly (output latency + input latency) earlier.
  const settings = track.getSettings() as MediaTrackSettings & { latency?: number };
  const inputLatency = typeof settings.latency === 'number' ? settings.latency : 0.01;
  const perfOfFrame = (frame: number): number => {
    const t = frame / ctx.sampleRate;
    const ts = ctx.getOutputTimestamp?.();
    const outLatency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined) {
      return ts.performanceTime + (t - ts.contextTime) * 1000 - (outLatency + inputLatency) * 1000;
    }
    return performance.now() - (ctx.currentTime - t) * 1000 - inputLatency * 1000;
  };

  let closed = false;
  return {
    snapshot() {
      if (total === 0 || firstFrame < 0) return null;
      const pcm = new Float32Array(total);
      let o = 0;
      for (const c of chunks) { pcm.set(c, o); o += c.length; }
      return { pcm, sampleRate: ctx.sampleRate, perfAtSample0: perfOfFrame(firstFrame) };
    },
    get seconds() {
      return total / ctx.sampleRate;
    },
    close() {
      if (closed) return;
      closed = true;
      try { source.disconnect(); } catch { /* ignore */ }
      try { node.disconnect(); } catch { /* ignore */ }
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    },
  };
}
