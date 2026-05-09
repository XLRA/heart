'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './StormLanding.module.css';
import { generateLightning } from './generateBolt';
import { StormAudio } from './stormAudio';
import {
  STRIKES,
  PRIMARY_STRIKE_T,
  AD_HOC_STRIKE_LIFETIME_MS,
  CLICK_STRIKE_COOLDOWN_MS,
  strikeEnvelope,
  afterImage,
  ionizationLinger,
  type AdHocStrike,
} from './strikes';
import {
  VARIANT_COUNT,
  buildVariantRange,
  compositeBolt,
  renderFlash,
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

  useEffect(() => {
    const canvas = canvasRef.current;
    const sceneEl = sceneRef.current;
    if (!canvas || !sceneEl) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const offscreens: HTMLCanvasElement[] = Array.from(
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
          offscreens, generateLightning, width, height, dpr,
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
        offscreens, generateLightning, width, height, dpr,
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

    const handleSceneClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('a, button')) return;
      const now = performance.now();
      if (now - lastClickStrikeTime < CLICK_STRIKE_COOLDOWN_MS) return;
      lastClickStrikeTime = now;

      // Click strikes draw from the full 8-variant pool so each click
      // can come from a different angle. If the chosen variant hasn't
      // been prerendered yet (idle build still pending), fall back to
      // a guaranteed-ready intro variant so the click never produces
      // an empty bolt.
      let variant = Math.floor(Math.random() * VARIANT_COUNT);
      if (!variantReady[variant]) {
        variant = Math.floor(Math.random() * INTRO_VARIANT_COUNT);
      }
      const intensity = 0.7 + Math.random() * 0.3;
      adHocStrikes.push({ startTime: now, variant, intensity });
      pulseWordmark(intensity);

      // Sync thunder to the bolt — close + immediate.
      audioRef.current?.triggerThunder({
        distance: 0.05 + Math.random() * 0.15,
        intensity: 0.85 + Math.random() * 0.15,
        delay: 0.04,
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

    /* Per-frame intensity buffer — reused across frames to skip a
       per-frame allocation. Float32Array is exactly the right shape
       for this hot read/write pattern. */
    const variantIntensity = new Float32Array(VARIANT_COUNT);

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

      // Per-variant intensity so each strike uses its own bolt geometry.
      variantIntensity.fill(0);
      let flashIntensity = 0;
      for (const s of STRIKES) {
        const local = elapsed - s.t;
        const env = strikeEnvelope(local) * s.intensity;
        const after = afterImage(local) * s.intensity;
        variantIntensity[s.variant] = Math.max(
          variantIntensity[s.variant],
          env + after,
        );
        flashIntensity = Math.max(flashIntensity, env);
      }

      // Persistent ionization linger from primary bolt.
      const linger = ionizationLinger(elapsed - PRIMARY_STRIKE_T);
      variantIntensity[0] = Math.max(variantIntensity[0], linger);

      // Ad-hoc strikes — same envelope math, pruned in place when decayed.
      for (let i = adHocStrikes.length - 1; i >= 0; i--) {
        const s = adHocStrikes[i];
        const local = now - s.startTime;
        if (local > AD_HOC_STRIKE_LIFETIME_MS) {
          adHocStrikes.splice(i, 1);
          continue;
        }
        const env = strikeEnvelope(local) * s.intensity;
        const after = afterImage(local) * s.intensity;
        variantIntensity[s.variant] = Math.max(
          variantIntensity[s.variant],
          env + after,
        );
        flashIntensity = Math.max(flashIntensity, env);
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

      for (let i = 0; i < VARIANT_COUNT; i++) {
        compositeBolt(ctx, offscreens[i], width, height, variantIntensity[i]);
      }

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
