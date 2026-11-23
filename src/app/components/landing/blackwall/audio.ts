/* ──────────────────────────────────────────────────────────────
   Blackwall — sound.

   One thing only: the Blackwall ambience track, looped, at 65 %.
   Nothing is synthesised and nothing reacts to the wall.

   The track is streamed by an <audio> element (it is about twelve
   minutes long, far too much to decode into memory) and starts on
   the visitor's first click or key press, because a browser will not
   let a page make sound before one. Where Web Audio exists the
   element is routed through a single gain node, so the level holds
   on phones that ignore an element's own volume and so mute, unmute
   and a hidden tab fade instead of cutting.

   If none of AMBIENCE_URLS is served the page is simply silent.
   ────────────────────────────────────────────────────────────── */

/** Where the ambience is looked for, in order. */
export const AMBIENCE_URLS = [
  '/audio/blackwall/ambience.m4a',
  '/audio/blackwall/ambience.mp3',
  '/audio/blackwall/ambience.ogg',
  '/audio/blackwall/ambience.webm',
];

/** Playback level, 0..1. */
const VOLUME = 0.65;

export type AmbienceState = 'none' | 'loading' | 'file' | 'missing';

export interface BlackwallAudio {
  /** Call from inside a user gesture: starts or resumes the track. */
  unlock(): void;
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  /** 'none' before the first gesture, 'loading' while a file is being
   *  tried, 'file' once it plays, 'missing' when no file is served. */
  state(): AmbienceState;
  dispose(): void;
}

export function createBlackwallAudio(): BlackwallAudio | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;

  let el: HTMLAudioElement | null = null;
  let ctx: AudioContext | null = null;
  let gain: GainNode | null = null;
  let enabled = true;
  let disposed = false;
  let state: AmbienceState = 'none';
  let urlIndex = 0;

  function wanted(): boolean {
    return enabled && !document.hidden && !disposed;
  }

  /** Bring the level to where it should be, and play or pause. */
  function apply(): void {
    if (!el || state === 'missing') return;
    const on = wanted();
    if (gain && ctx) {
      // ~300 ms either way; the element keeps running underneath so
      // the fade is heard, except in a hidden tab, where it stops.
      gain.gain.setTargetAtTime(on ? VOLUME : 0, ctx.currentTime, 0.1);
      if (on) {
        if (ctx.state === 'suspended') void ctx.resume();
        void el.play().catch(() => {});
      } else if (document.hidden) {
        el.pause();
      }
    } else {
      el.volume = VOLUME;
      if (on) void el.play().catch(() => {});
      else el.pause();
    }
  }

  function tryNext(): void {
    if (!el || disposed) return;
    if (urlIndex >= AMBIENCE_URLS.length) {
      state = 'missing';
      return;
    }
    state = 'loading';
    el.src = AMBIENCE_URLS[urlIndex++];
    apply();
  }

  function onPlaying(): void {
    state = 'file';
  }

  function onError(): void {
    // Not there, or not playable here: try the next.
    if (state !== 'file') tryNext();
  }

  function onVisibility(): void {
    apply();
  }
  document.addEventListener('visibilitychange', onVisibility);

  return {
    unlock() {
      if (disposed) return;
      if (!el) {
        el = new Audio();
        el.loop = true;
        el.preload = 'auto';
        el.addEventListener('playing', onPlaying);
        el.addEventListener('error', onError);
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctor) {
          try {
            ctx = new Ctor();
            gain = ctx.createGain();
            gain.gain.value = 0;
            ctx.createMediaElementSource(el).connect(gain);
            gain.connect(ctx.destination);
          } catch {
            ctx = null;
            gain = null;
          }
        }
        tryNext();
        return;
      }
      apply();
    },
    setEnabled(on) {
      enabled = on;
      apply();
    },
    isEnabled() {
      return enabled;
    },
    state() {
      return state;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (el) {
        el.removeEventListener('playing', onPlaying);
        el.removeEventListener('error', onError);
        el.pause();
        el.removeAttribute('src');
        el.load();
        el = null;
      }
      if (ctx) {
        void ctx.close();
        ctx = null;
        gain = null;
      }
    },
  };
}
