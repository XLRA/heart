'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './StormLanding.module.css';
import { generateLightning } from './generateBolt';
import { StormAudio, readPersistedVolume } from './stormAudio';
import {
  STRIKES,
  PRIMARY_STRIKE_T,
  LEADER_DURATION_MS,
  AD_HOC_STRIKE_LIFETIME_MS,
  CLICK_STRIKE_COOLDOWN_MS,
  strikeEnvelope,
  branchIntensityFromTrunk,
  afterImage,
  ionizationLinger,
  sweepProgress,
  type AdHocStrike,
} from './strikes';
import {
  VARIANT_COUNT,
  VARIANT_PATHS,
  VARIANT_JITTER,
  buildVariantRange,
  compositeBolt,
  compositeBoltSweep,
  renderFlash,
  renderCloudGlow,
  renderCloudRim,
  renderSkyWash,
  renderDirectionalFlash,
  renderAnchorExplosion,
  renderIrisReflex,
} from './boltRender';
import {
  makeRaindrops,
  makeEmptyDrops,
  rainBudget,
  tickRain,
  createWindSheetState,
  type LayeredDrops,
} from './rain';
import {
  spawnBgFlashEvent,
  renderBgFlash,
  bgFlashIntensity,
  type BgFlash,
} from './bgFlash';
import DebugOverlay, {
  createDebugMetrics,
  isDebugEnabled,
  type DebugMetrics,
} from './DebugOverlay';

/* ──────────────────────────────────────────────────────────────
   Storm landing — orchestrator.

   The heavy lifting lives in sibling modules:
     • strikes.ts     — scripted/ad-hoc strike envelope math
     • boltRender.ts  — bolt prerender + composite + flash render
     • rain.ts        — falling rain + splashes + wind sheets
     • bgFlash.ts     — distant flashes + thunder swells
     • stormAudio.ts  — Web Audio rain ambient + thunder synth
     • DebugOverlay.tsx — dev-only ?debug panel

   This component holds:
     - DOM refs + audio toggle state
     - The single rAF loop wiring all the subsystems together
     - JSX layout

   Intro timeline (unchanged from the inline version):
       0    ms  scene fades in from black (~700ms)
     420    ms  pre-flash (faint horizon brightening)
    1000    ms  PRIMARY STRIKE (variant A, intensity 1.0, scene shake)
    1180    ms  secondary       (variant B, intensity 0.65)
    1340    ms  tertiary        (variant C, intensity 0.35)
    1100–2700 ms  ionization linger (variant A at ~3% fading out)
    1000–1340 ms  wordmark FLICKERS in sync with the 3 lightning strikes
    1340–2400 ms  wordmark resolves into permanent ambient visibility
    1000/1180/1340 ms  thunder triggered alongside each strike
    2700+ ms  rAF loop continues forever (rain + parallax + bg flashes
              + wind sheets + thunder swells; click anywhere for an
              ad-hoc strike + thunder)
   ────────────────────────────────────────────────────────────── */

export default function StormLanding() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const wordmarkRef = useRef<HTMLHeadingElement | null>(null);
  const skyRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // Audio is gated behind a user gesture (browser autoplay policy).
  // 'locked' = never unlocked, 'on' = playing, 'off' = unlocked but muted.
  const [audioState, setAudioState] = useState<'locked' | 'on' | 'off'>('locked');
  const audioRef = useRef<StormAudio | null>(null);
  // User-controlled volume slider (0..1). Hydrated from localStorage
  // on mount so navigation between pages preserves the user's choice.
  // SSR returns the default; the effect below upgrades to persisted.
  const [volume, setVolumeState] = useState<number>(0.40);
  useEffect(() => {
    setVolumeState(readPersistedVolume());
  }, []);

  // Debug overlay — opt-in via `?debug` query param. The metrics object
  // is allocated once and mutated in place by the rAF loop; the overlay
  // polls it 4× per second for snapshot rendering.
  const debugEnabled = useMemo(() => isDebugEnabled(), []);
  const debugMetricsRef = useRef<DebugMetrics>(createDebugMetrics());

  const handleToggleAudio = useCallback(async () => {
    try {
      if (!audioRef.current) audioRef.current = new StormAudio();
      const audio = audioRef.current;
      if (!audio.isUnlocked()) {
        await audio.unlock();
        setAudioState('on');
        // Sync state with whatever volume the slider was showing pre-unlock.
        setVolumeState(audio.getVolume());
        // Welcome rumble so the user gets immediate confirmation
        // that audio is alive — distant, soft, builds atmosphere.
        audio.triggerThunder({ distance: 0.85, intensity: 0.55, delay: 0.3 });
      } else if (audio.isMuted()) {
        audio.setMuted(false);
        setAudioState('on');
      } else {
        audio.setMuted(true);
        setAudioState('off');
      }
    } catch {
      // Audio failure shouldn't crash the scene — just stay 'locked'.
    }
  }, []);

  /**
   * Volume slider handler. Persists immediately (via setVolume) so
   * the value survives reloads even if the user never interacts with
   * the icon. If the user drags the slider above 0 while currently
   * muted, auto-unmute as a one-shot convenience — mirrors how
   * basically every native OS volume slider behaves.
   */
  const handleVolumeChange = useCallback((next: number) => {
    setVolumeState(next);
    const audio = audioRef.current;
    if (audio) {
      audio.setVolume(next);
      if (next > 0 && audioState === 'off') {
        audio.setMuted(false);
        setAudioState('on');
      }
    } else {
      // Audio not yet unlocked — still persist so the value is applied
      // when the user next clicks the speaker icon to unlock.
      try {
        window.localStorage.setItem('stormVolume', String(next));
      } catch { /* ignore */ }
    }
  }, [audioState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const sceneEl = sceneRef.current;
    if (!canvas || !sceneEl) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Two offscreen pools per variant: the trunk (main descending channel)
    // and the branches (smaller forks). Composited separately so branches
    // can decay faster than the trunk during the late strike phase —
    // physically realistic, branches carry less current and cool sooner.
    const trunkOffscreens: HTMLCanvasElement[] = Array.from(
      { length: VARIANT_COUNT },
      () => document.createElement('canvas'),
    );
    const branchOffscreens: HTMLCanvasElement[] = Array.from(
      { length: VARIANT_COUNT },
      () => document.createElement('canvas'),
    );

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = window.innerWidth;
    let height = window.innerHeight;
    let rainLayers: LayeredDrops = makeEmptyDrops();

    /* Variant readiness — variants 0-2 are required for the scripted
       intro and are always rendered synchronously on init / resize.
       Variants 3-7 are click-only and rendered in idle time so they
       don't block first paint. If the user clicks before idle finishes,
       handleSceneClick falls back to a ready variant. */
    const INTRO_VARIANT_COUNT = 3;
    const variantReady = new Array<boolean>(VARIANT_COUNT).fill(false);
    let idleHandle: number | null = null;

    const cancelIdleVariantBuild = () => {
      if (idleHandle === null) return;
      // requestIdleCallback / setTimeout return ids in the same numeric
      // space; cancel both ways to be safe across the polyfill path.
      const w = window as Window & {
        cancelIdleCallback?: (h: number) => void;
      };
      if (typeof w.cancelIdleCallback === 'function') {
        w.cancelIdleCallback(idleHandle);
      }
      window.clearTimeout(idleHandle);
      idleHandle = null;
    };

    const scheduleClickVariantBuild = () => {
      cancelIdleVariantBuild();
      const build = () => {
        idleHandle = null;
        buildVariantRange(
          trunkOffscreens, branchOffscreens, generateLightning,
          width, height, dpr,
          INTRO_VARIANT_COUNT, VARIANT_COUNT,
        );
        for (let i = INTRO_VARIANT_COUNT; i < VARIANT_COUNT; i++) {
          variantReady[i] = true;
        }
      };
      const w = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      };
      if (typeof w.requestIdleCallback === 'function') {
        idleHandle = w.requestIdleCallback(build, { timeout: 2000 });
      } else {
        // Safari fallback. Still defers to next tick + a short delay
        // so first paint isn't blocked by ~5 prerenders.
        idleHandle = window.setTimeout(build, 500);
      }
    };

    const generateAndPrerender = () => {
      // Mark all click-only variants as not-ready before rebuild, so
      // a click during the rebuild window falls back to an intro
      // variant rather than drawing an empty offscreen.
      for (let i = INTRO_VARIANT_COUNT; i < VARIANT_COUNT; i++) {
        variantReady[i] = false;
      }
      buildVariantRange(
        trunkOffscreens, branchOffscreens, generateLightning,
        width, height, dpr,
        0, INTRO_VARIANT_COUNT,
      );
      for (let i = 0; i < INTRO_VARIANT_COUNT; i++) variantReady[i] = true;
      rainLayers = makeRaindrops(width, height, rainBudget(width, height));
      scheduleClickVariantBuild();
    };

    /* Resize handling is split into a LIGHT pass that runs on every
       resize event (canvas dimensions only — the canvas would visibly
       stretch otherwise) and a HEAVY pass (bolt prerenders + rain
       layer rebuild) that's debounced. Window-drag-resize stops
       hitching, steady-state visuals are unchanged. */
    const lightResize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    let heavyResizeTimer: number | null = null;
    const handleResize = () => {
      lightResize();
      if (heavyResizeTimer !== null) window.clearTimeout(heavyResizeTimer);
      heavyResizeTimer = window.setTimeout(() => {
        heavyResizeTimer = null;
        generateAndPrerender();
      }, 200);
    };

    lightResize();
    generateAndPrerender();
    window.addEventListener('resize', handleResize);

    const start = performance.now();
    let rafId = 0;
    let lastTick = start;

    // Skip rain + bg flashes if the user prefers reduced motion.
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    // Background lightning state. First flash a bit after the main
    // strike sequence so it doesn't compete with it.
    const bgFlashes: BgFlash[] = [];
    let nextBgFlashAt = start + 4500 + Math.random() * 6000;

    // Wind-sheet scheduler — starts the first sheet 8–15s in.
    const windSheet = createWindSheetState(start);

    // User-triggered strikes from clicks.
    const adHocStrikes: AdHocStrike[] = [];
    let lastClickStrikeTime = 0;

    // FPS measurement (rolling 30-frame window for the debug overlay).
    const fpsBuf: number[] = [];
    let fpsSum = 0;

    /* ── Mouse parallax ──────────────────────────────────────
       Track normalized cursor position (-1..1), smooth toward
       it each frame, then apply opposing translate3d() to the
       sky and stage layers. */
    const isPointerFine = window.matchMedia('(pointer: fine)').matches;
    let parallaxTargetX = 0;
    let parallaxTargetY = 0;
    let parallaxX = 0;
    let parallaxY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      parallaxTargetX = (e.clientX / width - 0.5) * 2;
      parallaxTargetY = (e.clientY / height - 0.5) * 2;
    };
    if (isPointerFine && !reduceMotion) {
      window.addEventListener('mousemove', handleMouseMove);
    }

    /** Re-trigger the wordmark glow pulse via WAAPI. */
    const pulseWordmark = (intensity: number) => {
      const el = wordmarkRef.current;
      if (!el) return;
      const k = Math.max(0.5, Math.min(1, intensity));
      el.animate(
        [
          {
            color: '#ffffff',
            transform: `scale(${1 + 0.025 * k})`,
            filter: `brightness(${1 + 0.4 * k})`,
            textShadow: `
              0 0 3px   rgba(255, 255, 255, ${1 * k}),
              0 0 10px  rgba(255, 255, 255, ${0.95 * k}),
              0 0 26px  rgba(255, 255, 255, ${0.85 * k}),
              0 0 60px  rgba(255, 255, 255, ${0.62 * k}),
              0 0 130px rgba(245, 245, 245, ${0.42 * k}),
              0 0 240px rgba(220, 220, 220, ${0.26 * k}),
              0 0 380px rgba(180, 180, 180, ${0.14 * k})
            `,
            offset: 0,
          },
          {
            color: '#f5f5f5',
            transform: 'scale(1.008)',
            filter: 'brightness(1.12)',
            textShadow: `
              0 0 12px  rgba(255, 255, 255, ${0.4 * k}),
              0 0 50px  rgba(245, 245, 245, ${0.26 * k}),
              0 0 100px rgba(220, 220, 220, ${0.13 * k})
            `,
            offset: 0.18,
          },
          {
            color: '#f0f0f0',
            transform: 'scale(1.0)',
            filter: 'brightness(1.0)',
            textShadow: `
              0 0 18px rgba(230, 230, 230, 0.28),
              0 0 50px rgba(180, 180, 180, 0.12)
            `,
            offset: 1,
          },
        ],
        {
          duration: 750,
          easing: 'ease-out',
          fill: 'forwards',
        },
      );
    };

    /**
     * Pick the prerendered variant whose destination X best matches a
     * given click X (in CSS pixels). Anchors the visible strike to
     * the user's cursor — clicks on the left side fire variants that
     * land on the left, clicks on the right fire ones that land on
     * the right. Falls back to ANY ready variant if the closest one
     * hasn't been prerendered yet (idle build still pending).
     */
    const pickVariantForClickX = (clickX: number): number => {
      const targetFrac = clickX / Math.max(1, width);
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < VARIANT_COUNT; i++) {
        if (!variantReady[i]) continue;
        const d = Math.abs(VARIANT_PATHS[i].dstX - targetFrac);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      // If somehow nothing is ready (shouldn't happen — intro
      // variants are always rendered synchronously on init), fall
      // back to the canonical primary variant 0.
      if (bestDist === Infinity) bestIdx = 0;
      return bestIdx;
    };

    const handleSceneClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('a, button, input, [role="slider"]')) return;
      const now = performance.now();
      if (now - lastClickStrikeTime < CLICK_STRIKE_COOLDOWN_MS) return;
      lastClickStrikeTime = now;

      // Anchor the strike to the cursor — the chosen variant lands
      // closest to the click position.
      const variant = pickVariantForClickX(e.clientX);
      const intensity = 0.78 + Math.random() * 0.22;

      // Primary return stroke. Push the bright peak forward by
      // LEADER_DURATION_MS so the stepped-leader pre-phase is visible
      // immediately on click (faint dim trace) and the bright return
      // stroke fires ~80ms later. Wordmark + thunder fire AT peak so
      // all subsystems stay in lock-step.
      const peakTime = now + LEADER_DURATION_MS;
      adHocStrikes.push({
        startTime: peakTime,
        variant,
        intensity,
        hasLeader: true,
      });

      /* ── Multi-stroke flicker ────────────────────────────────
         Real natural cloud-to-ground strikes have on average 3-4
         RETURN STROKES through the same ionized channel, ~40-100ms
         apart. The first is the brightest; subsequent strokes are
         dimmer because the channel cools between flashes. This is
         THE iconic, instantly-recognizable visual signature of real
         lightning — a single flash reads as cartoon lightning, the
         flicker reads as a photograph.

         We spawn 1-3 sub-strokes through the SAME variant (same
         channel), with NO leader (channel is already ionized — the
         sub-stroke is instantaneous), each at progressively lower
         intensity. Inter-stroke spacing is 45-110ms, randomized
         per stroke for natural variation. */
      const subStrokeCount = 1 + Math.floor(Math.random() * 3); // 1..3
      let strokeOffset = 0;
      for (let i = 0; i < subStrokeCount; i++) {
        strokeOffset += 45 + Math.random() * 65;
        // Each sub-stroke is dimmer than the previous: 0.62, 0.42, 0.28.
        const decay = Math.pow(0.68, i + 1);
        const subIntensity = Math.max(0.18, intensity * decay);
        adHocStrikes.push({
          startTime: peakTime + strokeOffset,
          variant,
          intensity: subIntensity,
          hasLeader: false,
        });
        // Tiny extra wordmark twitch on the brightest sub-stroke
        // (the first one) so the wordmark flickers WITH the channel,
        // not just on the primary peak.
        if (i === 0) {
          window.setTimeout(
            () => pulseWordmark(subIntensity * 0.7),
            LEADER_DURATION_MS + strokeOffset,
          );
        }
        // Soft thunder crackle after the brightest sub-stroke — sells
        // the rolling/cracking quality real strikes have. Quieter and
        // slightly more distant than the main bolt.
        if (i === 0 && audioRef.current) {
          audioRef.current.triggerThunder({
            distance: 0.18 + Math.random() * 0.18,
            intensity: 0.32 + subIntensity * 0.35,
            delay: (LEADER_DURATION_MS + strokeOffset) / 1000 + 0.06,
          });
        }
      }

      window.setTimeout(() => pulseWordmark(intensity), LEADER_DURATION_MS);
      audioRef.current?.triggerThunder({
        distance: 0.04 + Math.random() * 0.12,
        intensity: 0.85 + Math.random() * 0.15,
        // Audio delay = leader duration + standard 40ms render-to-thunder gap.
        delay: 0.04 + LEADER_DURATION_MS / 1000,
      });
    };
    sceneEl.addEventListener('click', handleSceneClick);

    // Wordmark flicker fires at the EXACT instant the primary strike
    // peaks — same `start` reference as the canvas bolt for sync.
    const flickerTimer = window.setTimeout(() => {
      wordmarkRef.current?.classList.add(styles.flicker!);
    }, PRIMARY_STRIKE_T);

    const shakeTimer = window.setTimeout(() => {
      sceneEl.classList.add(styles.shake!);
      window.setTimeout(() => sceneEl.classList.remove(styles.shake!), 240);
    }, PRIMARY_STRIKE_T);

    // Schedule thunder for the scripted strike sequence.
    const thunderTimers: number[] = [];
    for (const s of STRIKES) {
      thunderTimers.push(
        window.setTimeout(() => {
          audioRef.current?.triggerThunder({
            distance: s.variant * 0.18,
            intensity: s.intensity,
            delay: 0.025,
          });
        }, s.t),
      );
    }

    /* Per-frame intensity buffers — reused across frames to skip a
       per-frame allocation. Float32Array is exactly the right shape
       for these hot read/write patterns.
         • variantIntensity   — trunk brightness 0..1 (drives main composite)
         • variantSweep       — return-stroke sweep progress 0..1 (1 = done)
         • variantSourceX     — px-x of the brightest active strike's source
                                (drives cloud-source glow position)
         • variantAnchorX     — px-x of the brightest active strike's destination
                                (drives anchor-point explosion position)
       Source/anchor X are tracked from the YOUNGEST active strike on
       each variant — that's the strike currently driving the visible
       brightness, so its source/anchor are the right glow centers. */
    const variantIntensity = new Float32Array(VARIANT_COUNT);
    const variantSweep = new Float32Array(VARIANT_COUNT);
    const variantSourceX = new Float32Array(VARIANT_COUNT);
    const variantAnchorX = new Float32Array(VARIANT_COUNT);

    /* ── Iris reflex state ─────────────────────────────────────
       The iris reflex (Tier C #4) dims the whole scene briefly
       60-260ms AFTER each bright peak — the eye/camera adjusting
       to the burst. We trigger on the rising edge of `flashIntensity`
       crossing the IRIS_TRIGGER_THRESHOLD: only the brightest peaks
       (intensity >= 0.85) fire the reflex, so dim ribbon strikes and
       distant bg flashes don't spam the dim. `prevFlashIntensity`
       is the across-frame edge detector. */
    const IRIS_TRIGGER_THRESHOLD = 0.85;
    const IRIS_DELAY_MS = 60;
    const IRIS_DURATION_MS = 200;
    const IRIS_PEAK_ALPHA = 0.08;
    let lastPeakTime = -Infinity;
    let prevFlashIntensity = 0;

    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);

      // Tab is hidden — skip all canvas work. rAF self-throttles to
      // ~0Hz when hidden in modern browsers so this rarely fires, but
      // some power-saver modes still wake it occasionally.
      if (typeof document !== 'undefined' && document.hidden) return;

      const elapsed = now - start;
      const dt = Math.min(0.05, (now - lastTick) / 1000);
      lastTick = now;

      // FPS rolling average (debug only — but cheap enough to always run).
      if (debugEnabled && dt > 0) {
        const f = 1 / dt;
        fpsBuf.push(f);
        fpsSum += f;
        if (fpsBuf.length > 30) fpsSum -= fpsBuf.shift()!;
      }

      ctx.clearRect(0, 0, width, height);

      // Pre-flash brightening before primary strike.
      if (elapsed > 380 && elapsed < 480) {
        const k = 1 - Math.abs(elapsed - 430) / 50;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(
          width * 0.5,
          height * 0.7,
          0,
          width * 0.5,
          height * 0.7,
          width * 0.7,
        );
        g.addColorStop(0, `rgba(180, 180, 180, ${0.16 * k})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }

      // Per-variant accumulators — reset each frame.
      variantIntensity.fill(0);
      variantSweep.fill(2);            // 2 = sentinel "no sweep / past sweep"
      variantSourceX.fill(0);
      variantAnchorX.fill(0);
      // Track per-variant "youngest age" so source/anchor X follow the
      // currently-driving strike (matters when ribbon strikes overlap).
      // Use a small stack-like array — VARIANT_COUNT is fixed at 8.
      const variantYoungestAge = [
        Infinity, Infinity, Infinity, Infinity,
        Infinity, Infinity, Infinity, Infinity,
      ];
      let flashIntensity = 0;

      // Helper: feed a single strike's contribution into all the
      // per-variant accumulators. Inlined twice (scripted + ad-hoc).
      const accumulateStrike = (
        local: number,
        intensity: number,
        variant: number,
        hasLeader: boolean,
      ) => {
        const env = strikeEnvelope(local, hasLeader) * intensity;
        const after = afterImage(local) * intensity;
        const total = env + after;
        if (total > variantIntensity[variant]) {
          variantIntensity[variant] = total;
        }
        // Decoupled flashIntensity — drives the scene flash + rain
        // brightening signal. Computed WITHOUT the leader phase so
        // rain only reacts to the bright return stroke (identical to
        // pre-Tier-A behavior). The bolt itself still uses the
        // leader-inclusive envelope above for its own dim pre-trace.
        const flashEnv = local >= 0 ? strikeEnvelope(local, false) * intensity : 0;
        if (flashEnv > flashIntensity) flashIntensity = flashEnv;
        // Track youngest active strike on this variant — its source/anchor
        // X feed the cloud glow + anchor explosion. "Youngest" defined as
        // smallest absolute |local| (closest to peak) among contributors.
        if (env > 0.01) {
          const age = Math.abs(local);
          if (age < variantYoungestAge[variant]) {
            variantYoungestAge[variant] = age;
            const path = VARIANT_PATHS[variant];
            variantSourceX[variant] = width * path.srcX;
            variantAnchorX[variant] = width * path.dstX;
          }
        }
        // Track sweep — only when a strike is in its return-stroke window
        // (0..RETURN_STROKE_SWEEP_MS). Take the LOWEST progress (most
        // recent strike) as the dominant sweep state for the variant.
        if (local >= 0) {
          const p = sweepProgress(local);
          if (p < variantSweep[variant]) variantSweep[variant] = p;
        }
      };

      for (const s of STRIKES) {
        accumulateStrike(elapsed - s.t, s.intensity, s.variant, !!s.hasLeader);
      }

      // Persistent ionization linger from primary bolt — small extra
      // glow on variant 0's trunk only.
      const linger = ionizationLinger(elapsed - PRIMARY_STRIKE_T);
      if (linger > variantIntensity[0]) variantIntensity[0] = linger;

      // Ad-hoc strikes — pruned in place when decayed (note: leader
      // pre-phase makes `local` negative for ~80ms; pruning is still
      // gated on the upper bound so future-strikes are kept alive).
      for (let i = adHocStrikes.length - 1; i >= 0; i--) {
        const s = adHocStrikes[i];
        const local = now - s.startTime;
        if (local > AD_HOC_STRIKE_LIFETIME_MS) {
          adHocStrikes.splice(i, 1);
          continue;
        }
        accumulateStrike(local, s.intensity, s.variant, !!s.hasLeader);
      }

      // ── Sky-wide tonal wash (Tier C #2) ─────────────────────
      // Uniform thin cool-white additive across the whole canvas
      // during peak. Foundation for the more localized effects below.
      // Threshold-gated to flashIntensity > 0.40 so it only fires
      // during the bright peak — never bleeds into rain via afterimage.
      if (flashIntensity > 0.40) {
        renderSkyWash(ctx, width, height, flashIntensity);
      }

      // Flash centered at the wordmark so illumination radiates from
      // the same point the wordmark occupies.
      renderFlash(
        ctx,
        width,
        height,
        width * 0.5,
        height * 0.5,
        Math.min(1, flashIntensity),
      );

      // Cloud-source glow + cloud rim — drawn BEFORE the bolts so the
      // bolts read as emerging from a lit cloud field. Per-variant,
      // anchored at each variant's source X, scaled by trunk intensity.
      //
      // Both threshold gated at 0.30 so they only fire during the
      // bright peak / fast-decay phase (~80ms per strike), NOT during
      // the long ~900ms afterimage tail. Without the threshold,
      // afterimage glow leaks into the rain via additive compositing
      // (see the 'lighter' blend in tickRain) and rain looks
      // perpetually brighter than the hosted version.
      for (let i = 0; i < VARIANT_COUNT; i++) {
        const intensity = variantIntensity[i];
        if (intensity > 0.30) {
          renderCloudGlow(ctx, width, height, variantSourceX[i], intensity);
          // Tier C #1: cloud rim — secondary cloud illumination at
          // the upper-mid sky level on the same source side.
          renderCloudRim(ctx, width, height, variantSourceX[i], intensity);
        }
      }

      // Bolt composite — trunk + branches separately, with per-variant
      // jitter and (when active) return-stroke sweep.
      //   • trunk uses full envelope intensity (peak + slow late decay)
      //   • branches use branchIntensityFromTrunk (faster late decay)
      //   • jitter (VARIANT_JITTER) shifts the composite by ±a few px
      //     per variant — sub-strokes through the channel appear at
      //     slightly different positions, like real plasma re-routing
      //     on each re-flash
      //   • sweep (variantSweep) renders the bolt as bottom-bright /
      //     top-dim during the first ~11ms of the return stroke
      for (let i = 0; i < VARIANT_COUNT; i++) {
        const trunkI = variantIntensity[i];
        if (trunkI <= 0) continue;
        const branchI = branchIntensityFromTrunk(trunkI);
        const j = VARIANT_JITTER[i];
        const sweep = variantSweep[i];
        if (sweep < 1) {
          // Return-stroke sweep is active — apply to both trunk + branches
          // so the upward brightness sweep reads as a unified flash.
          compositeBoltSweep(ctx, trunkOffscreens[i], width, height,
                             trunkI, sweep, j.dx, j.dy);
          if (branchI > 0) {
            compositeBoltSweep(ctx, branchOffscreens[i], width, height,
                               branchI, sweep, j.dx, j.dy);
          }
        } else {
          compositeBolt(ctx, trunkOffscreens[i], width, height, trunkI, j.dx, j.dy);
          if (branchI > 0) {
            compositeBolt(ctx, branchOffscreens[i], width, height, branchI, j.dx, j.dy);
          }
        }
      }

      // Anchor-point explosion — small white-hot glow at the
      // destination point of each bright-peak strike. Drawn AFTER the
      // bolts so the explosion sits visually "in front of" the channel
      // contact (which matches strike photography).
      for (let i = 0; i < VARIANT_COUNT; i++) {
        const intensity = variantIntensity[i];
        if (intensity > 0.45) {
          renderAnchorExplosion(ctx, width, height, variantAnchorX[i], intensity);
        }
      }

      // ── Directional flash (Tier C #3) ───────────────────────
      // Brightens the lower-mid portion of the canvas with a strong
      // source-side bias. Rain composites additively over it (rain
      // is rendered next), so drops on the source half of the screen
      // visually pop brighter than drops on the far side — exactly
      // matches "drops closer to the strike catch more light." Uses
      // the brightest currently-active variant's source X as the
      // gradient center.
      if (flashIntensity > 0.30) {
        // Pick the highest-intensity variant — that's the visual
        // dominant strike whose source the directional bias should track.
        let dominantI = 0;
        let dominantMax = variantIntensity[0];
        for (let i = 1; i < VARIANT_COUNT; i++) {
          if (variantIntensity[i] > dominantMax) {
            dominantMax = variantIntensity[i];
            dominantI = i;
          }
        }
        renderDirectionalFlash(
          ctx,
          width,
          height,
          variantSourceX[dominantI],
          flashIntensity,
        );
      }

      // ── Iris reflex edge detection (Tier C #4) ──────────────
      // Trigger the reflex on the rising edge of flashIntensity
      // crossing the trigger threshold. Only the brightest peaks
      // fire it — ribbon strikes (intensity 0.65, 0.35) and most bg
      // flashes don't reach 0.85. Click strikes with intensity >= 0.85
      // do trigger; weaker clicks don't, which adds variation.
      if (
        flashIntensity > IRIS_TRIGGER_THRESHOLD &&
        prevFlashIntensity <= IRIS_TRIGGER_THRESHOLD
      ) {
        lastPeakTime = now;
      }
      prevFlashIntensity = flashIntensity;

      // Background lightning + thunder swells.
      if (!reduceMotion) {
        if (now >= nextBgFlashAt) {
          const result = spawnBgFlashEvent(now, bgFlashes);
          // Big-cell swells space themselves out further (their audio
          // chain runs 4-6s, no point overlapping). Normal events
          // resume the original 6-20s spacing.
          nextBgFlashAt = now + (result.isSwell ? 14000 + Math.random() * 12000
                                                : 6000 + Math.random() * 14000);
          // Fire all thunder bursts the spawn produced.
          const a = audioRef.current;
          if (a) for (const burst of result.thunder) a.triggerThunder(burst);
        }
        for (let i = bgFlashes.length - 1; i >= 0; i--) {
          if (!renderBgFlash(ctx, width, height, bgFlashes[i], now)) {
            bgFlashes.splice(i, 1);
          }
        }
        // Compose bg flash brightness into the global flash signal so
        // the rain pass also brightens during distant flashes.
        flashIntensity = Math.max(
          flashIntensity,
          bgFlashIntensity(bgFlashes, now),
        );
      }

      // Falling rain + wind sheet.
      let rainResult = { totalDrops: 0 };
      if (!reduceMotion) {
        rainResult = tickRain({
          ctx,
          layers: rainLayers,
          dt,
          width,
          height,
          elapsed,
          now,
          flashIntensity,
          windSheet,
        });
      }

      // ── Iris reflex apply (Tier C #4) ────────────────────────
      // Drawn LAST so it dims rain, bolts, glows, and the sky CSS
      // layer beneath the canvas (visible through canvas alpha). The
      // wordmark sits in the DOM stack ABOVE the canvas and stays
      // bright — exactly mirrors how a viewer's eye reacts to a
      // bright flash: the focal point you were looking at stays
      // sharp while peripheral vision dims for ~200ms.
      //
      // Envelope shape: 60ms hold-out after peak, then 60ms ramp up,
      // 80ms hold at 0.08 alpha, 60ms decay. Total reflex window
      // 60-260ms post-peak.
      const sincePeak = now - lastPeakTime;
      if (sincePeak >= IRIS_DELAY_MS && sincePeak < IRIS_DELAY_MS + IRIS_DURATION_MS) {
        const t = (sincePeak - IRIS_DELAY_MS) / IRIS_DURATION_MS;
        let irisAlpha: number;
        if (t < 0.30)      irisAlpha = IRIS_PEAK_ALPHA * (t / 0.30);            // ramp up
        else if (t < 0.70) irisAlpha = IRIS_PEAK_ALPHA;                          // hold
        else               irisAlpha = IRIS_PEAK_ALPHA * (1 - (t - 0.70) / 0.30); // decay
        renderIrisReflex(ctx, width, height, irisAlpha);
      }

      // Mouse parallax.
      if (isPointerFine && !reduceMotion) {
        parallaxX += (parallaxTargetX - parallaxX) * 0.06;
        parallaxY += (parallaxTargetY - parallaxY) * 0.06;
        if (skyRef.current) {
          skyRef.current.style.transform =
            `translate3d(${parallaxX * 4}px, ${parallaxY * 3}px, 0)`;
        }
        if (stageRef.current) {
          stageRef.current.style.transform =
            `translate3d(${-parallaxX * 7}px, ${-parallaxY * 5}px, 0)`;
        }
      }

      // Debug metrics — written into the shared object the overlay polls.
      if (debugEnabled) {
        const m = debugMetricsRef.current;
        m.fps = fpsBuf.length ? fpsSum / fpsBuf.length : 0;
        m.drops = rainResult.totalDrops;
        m.adHocStrikes = adHocStrikes.length;
        m.bgFlashes = bgFlashes.length;
        m.windSheetActive = windSheet.active !== null;
        m.windSheetIntensity = windSheet.active
          ? // Recompute envelope cheaply (same shape as in rain.ts).
            (() => {
              const a = windSheet.active!;
              const e = now - a.startTime;
              if (e < a.rampUp) {
                const t = e / a.rampUp;
                return (1 - (1 - t) * (1 - t)) * a.peak;
              }
              if (e < a.rampUp + a.plateau) return a.peak;
              const t = (e - a.rampUp - a.plateau) / a.rampDown;
              return (1 - t) * (1 - t) * a.peak;
            })()
          : 0;
      }
    };

    rafId = requestAnimationFrame(tick);

    /* Tab-visibility coupling. The AudioContext keeps consuming CPU
       at full rate even when the tab is hidden — Chrome ~5-15% on
       weaker laptops. Suspending it on hide is the single biggest
       battery win on this scene. We also reset lastTick on resume
       so the dt cap doesn't kick in for one frame after returning. */
    const handleVisibilityChange = () => {
      if (document.hidden) {
        audioRef.current?.suspend();
      } else {
        lastTick = performance.now();
        audioRef.current?.resume();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelAnimationFrame(rafId);
      cancelIdleVariantBuild();
      if (heavyResizeTimer !== null) window.clearTimeout(heavyResizeTimer);
      window.clearTimeout(shakeTimer);
      window.clearTimeout(flickerTimer);
      for (const id of thunderTimers) window.clearTimeout(id);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      sceneEl.removeEventListener('click', handleSceneClick);
    };
  }, [debugEnabled]);

  // Dispose audio on full unmount only.
  useEffect(() => {
    return () => {
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, []);

  return (
    <main ref={sceneRef} className={`${styles.scene} ${styles.fadeIn}`}>
      <div ref={skyRef} className={styles.sky} aria-hidden />
      <div className={styles.skyDrift} aria-hidden />
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden />
      <div className={styles.grain} aria-hidden />
      <div className={styles.vignette} aria-hidden />

      <div ref={stageRef} className={styles.stage}>
        <h1 ref={wordmarkRef} className={styles.wordmark}>sleep</h1>
      </div>

      <div className={`${styles.corner} ${styles.cornerBL}`}>
        mmxxvi
      </div>

      <div className={styles.audioControl}>
        <div className={styles.volumePopover} aria-hidden={audioState === 'locked'}>
          <span className={styles.volumeLabel}>{Math.round(volume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(volume * 100)}
            onChange={(e) => handleVolumeChange(Number(e.target.value) / 100)}
            className={styles.volumeSlider}
            aria-label="Site volume"
            aria-valuetext={`${Math.round(volume * 100)} percent`}
            // Block the slider's value-change clicks from also
            // triggering a scene click → lightning strike.
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            // CSS-side rendering uses a CSS variable so the filled
            // portion of the track tracks the value with no JS work.
            style={{ ['--volPct' as string]: `${Math.round(volume * 100)}%` }}
          />
        </div>
        <button
          type="button"
          className={styles.audioToggle}
          aria-label={
            audioState === 'on' ? 'Mute storm audio' : 'Enable storm audio'
          }
          onClick={handleToggleAudio}
        >
          <SoundIcon state={audioState} />
        </button>
      </div>

      <Link href="/music" className={styles.musicLink}>
        music
      </Link>

      {debugEnabled && <DebugOverlay metricsRef={debugMetricsRef} />}
    </main>
  );
}

/** Minimal speaker icon — three states share the speaker glyph; muted
    state overlays a slash, locked state shows a single sound wave. */
function SoundIcon({ state }: { state: 'locked' | 'on' | 'off' }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 3 L4.5 6 H2 V10 H4.5 L8 13 Z" />
      {state === 'on' && (
        <>
          <path d="M10.5 5.5 Q12 8 10.5 10.5" />
          <path d="M12.5 4 Q15 8 12.5 12" />
        </>
      )}
      {state === 'off' && <path d="M11 5 L15 11 M15 5 L11 11" />}
      {state === 'locked' && <path d="M10.5 5.5 Q12 8 10.5 10.5" />}
    </svg>
  );
}
