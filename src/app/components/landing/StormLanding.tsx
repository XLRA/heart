'use client';

import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './StormLanding.module.css';
import { generateLightning } from './generateBolt';
import {
  StormAudio,
  SONG_FILES,
  readPersistedRainVolume,
  readPersistedSongVolume,
} from './stormAudio';
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
  leaderProgress,
  type AdHocStrike,
} from './strikes';
import {
  VARIANT_COUNT,
  VARIANT_PATHS,
  VARIANT_JITTER,
  buildVariantRange,
  compositeBolt,
  compositeBoltSweep,
  compositeBoltLeader,
  renderLeaderTip,
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
import { spawnSparkBurst, renderSparks, type Spark } from './sparks';
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

   Intro timeline:
       0    ms  scene fades in from black (~700ms)
     420    ms  pre-flash (faint horizon brightening)
     860    ms  stepped leader begins crawling down from the top right
    1000    ms  PRIMARY STRIKE — top-right → bottom-left diagonal that
                crosses the wordmark at mid-screen (intensity 1.0,
                scene shake). The word blows out white-hot and throws
                off a burst of sparks — electrified by the hit
    1095/1190 ms  two fast dim re-flashes through the same channel
    1100–2700 ms  ionization linger (center channel at ~3% fading out)
    1000–1190 ms  wordmark FLICKERS in sync with the strike + re-flashes
    1190–2400 ms  wordmark resolves into permanent ambient visibility
    1000/1095/1190 ms  thunder triggered alongside each pulse
    2700+ ms  rAF loop continues forever (rain + parallax + bg flashes
              + wind sheets + thunder swells; click anywhere for an
              ad-hoc strike + thunder)
   16-30  s  first ambient auto-strike (then every ~20-42s) — the
              storm keeps producing real bolts without user input
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
  // Per-voice volumes in the audio tab (0..1). Independent of the master
  // mute above — the tab balances rain (storm) vs. song individually.
  // The rain bar rides the rain loop AND thunder; the song bar rides the
  // music. Hydrated from localStorage on mount so the user's mix carries
  // across reloads / page navigation (SSR returns the default).
  const [rainVolume, setRainVolumeState] = useState<number>(0.7);
  const [songVolume, setSongVolumeState] = useState<number>(0.6);
  const [songTitle, setSongTitle] = useState('');
  const audioRef = useRef<StormAudio | null>(null);
  useEffect(() => {
    setRainVolumeState(readPersistedRainVolume());
    setSongVolumeState(readPersistedSongVolume());
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
        // First click unlocks everything: rain ambience AND the song
        // both start (the song fades in softly beneath the rain).
        await audio.unlock();
        setAudioState('on');
        // Sync sliders with whatever the engine hydrated pre-unlock, and
        // keep the now-playing label in step with playlist auto-advance.
        setRainVolumeState(audio.getRainVolume());
        setSongVolumeState(audio.getSongVolume());
        setSongTitle(audio.getCurrentSongTitle());
        audio.setSongChangeHandler(setSongTitle);
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
   * Per-voice volume handler factory. Updates local state immediately
   * for a responsive bar, drives the engine, and — if the user nudges a
   * bar above 0 while the master is muted — auto-unmutes as a one-shot
   * convenience (mirrors how native OS volume sliders behave). Persists
   * even pre-unlock so the mix is ready when the user clicks the icon.
   */
  const makeVolumeHandler = useCallback(
    (
      setLocal: (v: number) => void,
      apply: (audio: StormAudio, v: number) => void,
      persistKey: string,
    ) =>
      (next: number) => {
        setLocal(next);
        const audio = audioRef.current;
        if (audio) {
          apply(audio, next);
          if (next > 0 && audioState === 'off') {
            audio.setMuted(false);
            setAudioState('on');
          }
        } else {
          try {
            window.localStorage.setItem(persistKey, String(next));
          } catch { /* ignore */ }
        }
      },
    [audioState],
  );

  const handleRainVolumeChange = useMemo(
    () =>
      makeVolumeHandler(
        setRainVolumeState,
        (audio, v) => audio.setRainVolume(v),
        'stormRainVolume',
      ),
    [makeVolumeHandler],
  );

  const handleSongVolumeChange = useMemo(
    () =>
      makeVolumeHandler(
        setSongVolumeState,
        (audio, v) => audio.setSongVolume(v),
        'stormSongVolume',
      ),
    [makeVolumeHandler],
  );

  const handlePrevSong = useCallback(() => audioRef.current?.prevSong(), []);
  const handleNextSong = useCallback(() => audioRef.current?.nextSong(), []);
  // Transport (skip/back) only makes sense with a real playlist.
  const hasPlaylist = SONG_FILES.length > 1;

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

    // Ambient auto-strike scheduler — the storm keeps producing real
    // visible bolts after the intro, no clicks required. First one
    // 16-30s in, then every ~20-42s.
    let nextAutoStrikeAt = start + 16000 + Math.random() * 14000;

    // User-triggered strikes from clicks.
    const adHocStrikes: AdHocStrike[] = [];
    let lastClickStrikeTime = 0;

    // Sparks thrown off the wordmark when the intro bolt hits it.
    const wordSparks: Spark[] = [];

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

    /* ── Random variant selection ──────────────────────────────
       Strikes are NOT anchored to the click position — every click
       (and ambient auto-strike) fires a random channel, with a
       short memory of the last two channels so repeated clicks
       never replay the bolt the user just watched.

       Variants 1-2 are ribbon offsets of variant 0's channel (near-
       identical paths), so the whole 0-2 group counts as ONE channel
       for both the candidate list and the no-repeat memory. When
       channel 0 wins, a random ribbon member is substituted so even
       that channel doesn't render pixel-identically twice. */
    const recentStrikeChannels: number[] = [];

    const recordStrikeChannel = (variant: number) => {
      recentStrikeChannels.push(variant <= 2 ? 0 : variant);
      if (recentStrikeChannels.length > 2) recentStrikeChannels.shift();
    };

    const pickRandomVariant = (): number => {
      // Candidate channels: 0 (the ribbon group) + ready variants 3-7,
      // minus whatever fired in the last two strikes.
      let candidates: number[] = [];
      for (let i = 0; i < VARIANT_COUNT; i++) {
        if (!variantReady[i]) continue;
        if (i >= 1 && i <= 2) continue;  // ribbon dupes of channel 0
        if (recentStrikeChannels.includes(i)) continue;
        candidates.push(i);
      }
      // History excluded everything (early clicks while the idle
      // build is pending) — fall back to all ready channels.
      if (candidates.length === 0) {
        for (let i = 0; i < VARIANT_COUNT; i++) {
          if (variantReady[i] && (i === 0 || i >= 3)) candidates.push(i);
        }
      }
      if (candidates.length === 0) candidates = [0];
      let variant = candidates[Math.floor(Math.random() * candidates.length)];
      // Channel 0 → random ribbon member for intra-channel variety.
      if (variant === 0) variant = Math.floor(Math.random() * 3);
      recordStrikeChannel(variant);
      return variant;
    };

    const handleSceneClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('a, button, input, [role="slider"]')) return;
      const now = performance.now();
      if (now - lastClickStrikeTime < CLICK_STRIKE_COOLDOWN_MS) return;
      lastClickStrikeTime = now;

      // Random channel — deliberately NOT anchored to the click
      // position, and guaranteed different from the last two strikes.
      const variant = pickRandomVariant();
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
        jx: (Math.random() * 2 - 1) * 1.2,
        jy: (Math.random() * 2 - 1) * 0.6,
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
         per stroke for natural variation. Each sub-stroke carries
         its own few-px channel offset (jx/jy) — the plasma channel
         physically re-routes between re-strikes, so the flicker
         visibly shifts instead of redrawing pixel-identical. */
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
          jx: (Math.random() * 2 - 1) * 3.2,
          jy: (Math.random() * 2 - 1) * 1.2,
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

    // Spark bursts off the wordmark — full burst at the impact
    // instant, a smaller one with the first channel re-flash.
    const sparkTimers = [
      window.setTimeout(
        () => spawnSparkBurst(wordSparks, performance.now(), 14, 1),
        PRIMARY_STRIKE_T,
      ),
      window.setTimeout(
        () => spawnSparkBurst(wordSparks, performance.now(), 6, 0.5),
        STRIKES[1].t,
      ),
    ];

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
    // Leader descent progress 0..1 per variant (2 = no leader active)
    // and the youngest strike's per-stroke channel re-route offset.
    const variantLeader = new Float32Array(VARIANT_COUNT);
    const variantStrokeJX = new Float32Array(VARIANT_COUNT);
    const variantStrokeJY = new Float32Array(VARIANT_COUNT);

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
      variantLeader.fill(2);           // 2 = sentinel "no leader descending"
      variantStrokeJX.fill(0);
      variantStrokeJY.fill(0);
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
        strokeJX = 0,
        strokeJY = 0,
      ) => {
        const env = strikeEnvelope(local, hasLeader) * intensity;
        const after = afterImage(local) * intensity;
        const total = env + after;
        if (total > variantIntensity[variant]) {
          variantIntensity[variant] = total;
        }
        // Leader descent — while the stepped leader is propagating
        // (negative local), record its spatial progress so the
        // composite pass can clip-reveal the channel top-down.
        if (hasLeader && local < 0) {
          const p = leaderProgress(local);
          if (p > 0 && p < variantLeader[variant]) variantLeader[variant] = p;
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
            // The youngest strike's channel re-route offset wins —
            // it's the stroke currently driving the visible channel.
            variantStrokeJX[variant] = strokeJX;
            variantStrokeJY[variant] = strokeJY;
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
        accumulateStrike(elapsed - s.t, s.intensity, s.variant, !!s.hasLeader,
                         s.jx ?? 0, s.jy ?? 0);
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
        accumulateStrike(local, s.intensity, s.variant, !!s.hasLeader,
                         s.jx ?? 0, s.jy ?? 0);
      }

      /* ── Plasma flicker ──────────────────────────────────────
         High-frequency brightness shimmer during the decay phase.
         Real lightning channels don't fade smoothly — the plasma
         flickers as the current fluctuates. Two incommensurate
         sine products give cheap pseudo-noise; amplitude is scaled
         by (1 - v) so the bright peak and the near-zero tail are
         untouched and only the visible mid-decay shimmers. Skipped
         while a leader is descending (the dim trace should creep,
         not sparkle). */
      for (let i = 0; i < VARIANT_COUNT; i++) {
        const v = variantIntensity[i];
        if (v > 0.05 && v < 0.92 && variantLeader[i] >= 1) {
          const n = Math.sin(now * 0.041 + i * 11.3) *
                    Math.sin(now * 0.127 + i * 5.1);
          variantIntensity[i] = Math.max(0, v * (1 + n * 0.10 * (1 - v)));
        }
      }

      /* ── Ambient auto-strikes ────────────────────────────────
         The storm stays alive without user input: every ~20-42s a
         real bolt fires from the click-only variant pool at low-mid
         intensity, complete with stepped leader, multi-stroke
         flicker, wordmark pulse, and thunder. Deferred briefly if
         the user just clicked (their strike owns the moment). */
      if (!reduceMotion && now >= nextAutoStrikeAt) {
        if (now - lastClickStrikeTime < 4000) {
          nextAutoStrikeAt = now + 6000;
        } else {
          nextAutoStrikeAt = now + 20000 + Math.random() * 22000;
          // Shares the click picker's two-strike no-repeat memory, so
          // an auto-strike never replays the channel the user just
          // fired (and vice versa).
          const variant = pickRandomVariant();
          const intensity = 0.42 + Math.random() * 0.30;
          const peakTime = now + LEADER_DURATION_MS;
          adHocStrikes.push({
            startTime: peakTime,
            variant,
            intensity,
            hasLeader: true,
            jx: (Math.random() * 2 - 1) * 1.2,
            jy: (Math.random() * 2 - 1) * 0.6,
          });
          const subCount = 1 + Math.floor(Math.random() * 2);
          let subOffset = 0;
          for (let i = 0; i < subCount; i++) {
            subOffset += 50 + Math.random() * 70;
            adHocStrikes.push({
              startTime: peakTime + subOffset,
              variant,
              intensity: Math.max(0.14, intensity * Math.pow(0.62, i + 1)),
              hasLeader: false,
              jx: (Math.random() * 2 - 1) * 3.2,
              jy: (Math.random() * 2 - 1) * 1.2,
            });
          }
          window.setTimeout(
            () => pulseWordmark(intensity * 0.8),
            LEADER_DURATION_MS,
          );
          audioRef.current?.triggerThunder({
            distance: 0.30 + Math.random() * 0.35,
            intensity: 0.45 + intensity * 0.40,
            delay: LEADER_DURATION_MS / 1000 + 0.15 + Math.random() * 0.25,
          });
        }
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
        // Baked variant jitter + the youngest stroke's re-route offset.
        const jx = j.dx + variantStrokeJX[i];
        const jy = j.dy + variantStrokeJY[i];
        const leaderP = variantLeader[i];
        const sweep = variantSweep[i];
        if (leaderP < 1) {
          // Stepped leader descending — reveal the channel top-down,
          // branches included, with a hot glow at the advancing tip.
          compositeBoltLeader(ctx, trunkOffscreens[i], width, height,
                              trunkI, leaderP, jx, jy);
          if (branchI > 0) {
            compositeBoltLeader(ctx, branchOffscreens[i], width, height,
                                branchI, leaderP, jx, jy);
          }
          const path = VARIANT_PATHS[i];
          const tipX = width * (path.srcX + (path.dstX - path.srcX) * leaderP);
          renderLeaderTip(ctx, tipX + jx, height * leaderP + jy, trunkI);
        } else if (sweep < 1) {
          // Return-stroke sweep is active — apply to both trunk + branches
          // so the upward brightness sweep reads as a unified flash.
          compositeBoltSweep(ctx, trunkOffscreens[i], width, height,
                             trunkI, sweep, jx, jy);
          if (branchI > 0) {
            compositeBoltSweep(ctx, branchOffscreens[i], width, height,
                               branchI, sweep, jx, jy);
          }
        } else {
          compositeBolt(ctx, trunkOffscreens[i], width, height, trunkI, jx, jy);
          if (branchI > 0) {
            compositeBolt(ctx, branchOffscreens[i], width, height, branchI, jx, jy);
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

      // Wordmark sparks — drawn at the stage's parallax-shifted
      // center so the burst stays glued to the word as it moves.
      renderSparks(
        ctx,
        wordSparks,
        width * 0.5 - parallaxX * 7,
        height * 0.5 - parallaxY * 5,
        now,
      );

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
          // Smoothed values from the previous frame's parallax pass —
          // one frame of lag is invisible at the 0.06 smoothing rate.
          parallaxX,
          parallaxY,
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
      for (const id of sparkTimers) window.clearTimeout(id);
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
        {/* Mini audio mixer — collapsed to nothing in steady state so it
            doesn't clutter the corner; slides open on hover/focus of the
            cluster. A dark card (styled after the music player) with one
            volume bar per voice + the now-playing track. */}
        <div className={styles.audioPanel} aria-hidden={audioState === 'locked'}>
          <span className={styles.panelTitle}>mix</span>

          <div className={styles.voiceGroup}>
            <VoiceSlider
              ariaLabel="Rain volume"
              value={rainVolume}
              onChange={handleRainVolumeChange}
              icon={<RainGlyph />}
            />
            <VoiceSlider
              ariaLabel="Song volume"
              value={songVolume}
              onChange={handleSongVolumeChange}
              icon={<NoteGlyph />}
            />
          </div>

          {songTitle && (
            <div className={styles.songSection}>
              <div className={styles.nowPlaying}>
                <span className={styles.nowPlayingDot} aria-hidden />
                <span className={styles.nowPlayingText}>{songTitle}</span>
              </div>

              {hasPlaylist && (
                <div className={styles.transport}>
                  <button
                    type="button"
                    className={styles.transportBtn}
                    aria-label="Previous song"
                    onClick={handlePrevSong}
                  >
                    <SkipGlyph dir="prev" />
                  </button>
                  <button
                    type="button"
                    className={styles.transportBtn}
                    aria-label="Next song"
                    onClick={handleNextSong}
                  >
                    <SkipGlyph dir="next" />
                  </button>
                </div>
              )}
            </div>
          )}
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

/** One volume bar in the mixer: a voice icon, a styled range input, and
    a percentage readout. The filled portion is driven by a CSS variable
    (--vol) so the visual fill tracks the value with zero per-frame JS.
    Clicks/drags are stopped from bubbling to the scene so adjusting
    volume never fires a lightning strike. */
function VoiceSlider({
  ariaLabel,
  value,
  onChange,
  icon,
}: {
  ariaLabel: string;
  value: number;
  onChange: (v: number) => void;
  icon: ReactNode;
}) {
  const pct = Math.round(value * 100);
  return (
    <div className={styles.voiceRow}>
      <span className={styles.voiceIcon} aria-hidden>{icon}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className={styles.voiceSlider}
        aria-label={ariaLabel}
        aria-valuetext={`${pct} percent`}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ ['--vol' as string]: `${pct}%` }}
      />
      <span className={styles.voicePct}>{pct}</span>
    </div>
  );
}

/** Skip-back / skip-forward transport glyph (triangle + end bar). The
    'next' shape is drawn; 'prev' mirrors it across its own center. */
function SkipGlyph({ dir }: { dir: 'prev' | 'next' }) {
  return (
    <svg
      width="13" height="13" viewBox="0 0 16 16" fill="currentColor"
      aria-hidden
      style={dir === 'prev' ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M3.5 4 L10 8 L3.5 12 Z" />
      <rect x="10.6" y="4" width="1.7" height="8" rx="0.6" />
    </svg>
  );
}

/** Rain glyph — a small cloud with two falling streaks. */
function RainGlyph() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="M4.5 9 A2.5 2.5 0 0 1 4.8 4 A3 3 0 0 1 10.7 4.3 A2.2 2.2 0 0 1 11 8.7" />
      <path d="M5.5 11 L4.7 13" />
      <path d="M8 11 L7.2 13.4" />
      <path d="M10.5 11 L9.7 13" />
    </svg>
  );
}

/** Music-note glyph for the song bar. */
function NoteGlyph() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="M6 12.5 V5 L12 3.3 V10.5" />
      <circle cx="4.4" cy="12.4" r="1.7" />
      <circle cx="10.4" cy="10.4" r="1.7" />
    </svg>
  );
}
