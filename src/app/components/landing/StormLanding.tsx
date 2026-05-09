'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './StormLanding.module.css';
import {
  generateLightning,
  strokePoints,
  type Lightning,
  type Pt,
} from './generateBolt';
import { StormAudio } from './stormAudio';

/* ──────────────────────────────────────────────────────────────
   Realistic lightning rendered on <canvas>, with the wordmark
   coupled to the bolt's live brightness.

   Coupling
   --------
   Each rAF tick writes the current bolt + flash intensity to
   CSS custom properties on the scene root. The wordmark's
   text-shadow and the sky's brightness filter both read those
   vars, so the entire scene literally pulses with each strike
   and re-strike. The wordmark's reveal isn't a separate event —
   it's lit BY the bolt.

   Bolt rendering
   --------------
   3 bolt variants are pre-rendered to offscreen canvases (same
   source/dest, different seeds), so the primary / secondary /
   tertiary strikes use slightly different geometry rather than
   re-flashing the same shape. Each bolt is rendered with
   shadowBlur halos and tapered branches (stroked at full / 60% /
   30% length so additive stacking creates an apparent taper).
   Each frame composites the active bolt 3x with `globalCompositeOperation
   = 'lighter'` to blow out the white core photographically.

   Timeline
   --------
       0    ms  scene appears (dark, sky drifting)
     420    ms  pre-flash (faint horizon brightening)
    1000    ms  PRIMARY STRIKE (variant A, intensity 1.0, scene shake)
    1180    ms  secondary       (variant B, intensity 0.65)
    1340    ms  tertiary        (variant C, intensity 0.35)
    1100–2700 ms  ionization linger (variant A at ~3% fading out)
    1000–1340 ms  wordmark FLICKERS in sync with the 3 lightning strikes
                  (visible at each peak, near-invisible in the dark gaps)
    1340–2400 ms  wordmark resolves into permanent ambient visibility
    1000/1180/1340 ms  thunder triggered alongside each strike (audio
                       only audible if user has unlocked sound)
    2700+ ms  rAF loop continues forever (rain + parallax + bg flashes,
              click-anywhere triggers ad-hoc strike + thunder)
   ────────────────────────────────────────────────────────────── */

const STRIKES = [
  { t: 1000, intensity: 1.0,  variant: 0 },
  { t: 1180, intensity: 0.65, variant: 1 },
  { t: 1340, intensity: 0.35, variant: 2 },
];

const PRIMARY_STRIKE_T = STRIKES[0].t;

/* ── Ad-hoc strikes ──────────────────────────────────────
   User-triggered strikes (click anywhere) live in a separate
   array. The tick loop computes their envelope contribution
   alongside the scripted STRIKES array, then prunes any whose
   envelope has fully decayed. */
interface AdHocStrike {
  startTime: number;  // performance.now()
  intensity: number;
  variant: number;
}
const AD_HOC_STRIKE_LIFETIME_MS = 1700;
const CLICK_STRIKE_COOLDOWN_MS = 500;

function strikeEnvelope(elapsed: number): number {
  if (elapsed < 0) return 0;
  if (elapsed < 25) return 1;
  if (elapsed < 80) return 1 - ((elapsed - 25) / 55) * 0.7;
  if (elapsed < 280) return 0.3 - ((elapsed - 80) / 200) * 0.3;
  return 0;
}

function afterImage(elapsed: number): number {
  if (elapsed < 80) return 0;
  if (elapsed < 900) return 0.07 * (1 - (elapsed - 80) / 820);
  return 0;
}

/** Persistent ionization trail that lingers after the primary strike. */
function ionizationLinger(elapsed: number): number {
  if (elapsed < 100) return 0;
  if (elapsed < 1700) return 0.045 * (1 - (elapsed - 100) / 1600);
  return 0;
}

/**
 * Pre-render a bolt variant to an offscreen canvas with a
 * shadowBlur halo and tapered branches.
 */
function prerenderBolt(
  off: HTMLCanvasElement,
  bolt: Lightning,
  width: number,
  height: number,
  dpr: number,
) {
  off.width = Math.floor(width * dpr);
  off.height = Math.floor(height * dpr);
  const ctx = off.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Helper: stroke each branch three times at decreasing length.
  // Additive stacking under our composite makes the trunk-ends
  // brighter and the tips fainter — an apparent taper.
  const TAPER = [1.0, 0.6, 0.3];
  const strokeBranches = (bs: Pt[][]) => {
    for (const t of TAPER) {
      for (const br of bs) {
        const n = Math.max(2, Math.ceil(br.length * t));
        strokePoints(ctx, br.slice(0, n));
      }
    }
  };

  // Pass 1 — outer halo. Neutral white-gray, very faint warmth toward
  // the channel — keeps the bolt photographically white-hot rather
  // than reading as "blue lightning."
  ctx.shadowBlur = 32;
  ctx.shadowColor = 'rgba(220, 220, 220, 1)';
  ctx.strokeStyle = 'rgba(240, 240, 240, 0.85)';
  ctx.lineWidth = 1.6;
  strokePoints(ctx, bolt.trunk);
  ctx.lineWidth = 1.0;
  strokeBranches(bolt.branches);

  // Pass 2 — inner halo.
  ctx.shadowBlur = 14;
  ctx.shadowColor = 'rgba(245, 245, 245, 1)';
  ctx.strokeStyle = 'rgba(252, 252, 252, 0.95)';
  ctx.lineWidth = 1.2;
  strokePoints(ctx, bolt.trunk);
  ctx.lineWidth = 0.8;
  strokeBranches(bolt.branches);

  // Pass 3 — bright sheath.
  ctx.shadowBlur = 5;
  ctx.shadowColor = 'rgba(255, 255, 255, 1)';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.0;
  strokePoints(ctx, bolt.trunk);
  ctx.lineWidth = 0.6;
  strokeBranches(bolt.branches);

  // Pass 4 — pure-white hairline core (no shadow).
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.5;
  strokePoints(ctx, bolt.trunk);
  ctx.lineWidth = 0.35;
  for (const br of bolt.branches) strokePoints(ctx, br);
}

function compositeBolt(
  ctx: CanvasRenderingContext2D,
  off: HTMLCanvasElement,
  width: number,
  height: number,
  intensity: number,
) {
  if (intensity <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, intensity);
  // 3 stacked draws blow out the core to overexposed white.
  ctx.drawImage(off, 0, 0, width, height);
  ctx.drawImage(off, 0, 0, width, height);
  ctx.drawImage(off, 0, 0, width, height);
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ── Falling rain ───────────────────────────────────────────
   Atmospheric rain rendered in three discrete depth layers
   (far / mid / near). Each layer has its own speed, length,
   alpha, and stroke width — drops in the back are short, dim,
   thin, and slow; drops in the front are long, bright, thicker,
   and fast. This is what produces real photographic depth, more
   than random speed scaling alone.

   Wind leans the whole rain pattern, with the angle smoothly
   oscillating over a ~25s sine wave (a coherent "gust") rather
   than jittering per drop.
   ────────────────────────────────────────────────────────── */

interface Raindrop {
  x: number;
  y: number;
  speed: number;
  length: number;
  // Per-drop angular deviation from base wind direction, in radians.
  // Applied each frame via small-angle rotation of the velocity vector
  // (cheap: 2 multiplies + 2 adds, no trig). Without this, all drops
  // form perfectly parallel rails — the dead giveaway that rain is fake.
  wobbleAngle: number;
  // Phase + amplitude of a per-drop horizontal sine sway, simulating
  // micro air-currents pushing each drop independently as it falls.
  wobblePhase: number;
  wobbleAmp: number;
}

interface RainLayer {
  speedMin: number;
  speedMax: number;
  lengthMin: number;
  lengthMax: number;
  tailAlpha: number;   // dim tail brightness (full-length pass)
  headAlpha: number;   // bright head brightness (head-only pass)
  width: number;
  proportion: number;
}

/*
   Four-layer rain system. Real rain in cinematography is overwhelmingly
   composed of *faint* streaks of varying depth with a few sharper
   foreground accents — that's what the eye reads as "heavy rain you
   can almost feel." We mirror that distribution: 60% atmospheric
   mist + far drops, 25% mid, 15% near. The sharper layers are kept
   sparse on purpose; if they outnumber the mist the scene looks
   like falling needles.

   Performance note: each layer is rendered as a single batched
   Path2D regardless of drop count, then stroked twice (tail + head).
   So total per-frame canvas work is exactly 8 stroke calls no matter
   how many drops are in flight.
*/
const LAYERS: RainLayer[] = [
  // Atmospheric mist — distant rain, fast enough to read as motion
  { speedMin: 560, speedMax: 880,  lengthMin: 4,  lengthMax: 10, tailAlpha: 0.025, headAlpha: 0.06, width: 0.4,  proportion: 0.42 },
  // Far — background rain
  { speedMin: 940, speedMax: 1380, lengthMin: 9,  lengthMax: 18, tailAlpha: 0.045, headAlpha: 0.11, width: 0.55, proportion: 0.30 },
  // Mid — main visible rain (heavy storm pace)
  { speedMin: 1620, speedMax: 2380, lengthMin: 18, lengthMax: 36, tailAlpha: 0.075, headAlpha: 0.20, width: 0.85, proportion: 0.18 },
  // Near — sharp foreground accent at terminal-velocity (~9 m/s scaled)
  { speedMin: 2750, speedMax: 4000, lengthMin: 36, lengthMax: 70, tailAlpha: 0.10, headAlpha: 0.32, width: 1.20, proportion: 0.10 },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function rerollRaindrop(
  d: Raindrop,
  layer: RainLayer,
  width: number,
  height: number,
  spawnAtTop: boolean,
) {
  // Bias drops toward the FAST end of their layer's range — heavy
  // storm rain reads as fast streaks with occasional slower drops,
  // not slow mist with occasional fast ones. sqrt(t) skews the
  // distribution toward 1.
  const t = Math.random();
  const speedT = Math.sqrt(t);
  d.speed = lerp(layer.speedMin, layer.speedMax, speedT);
  // Length stays correlated with speed (faster drops show more motion
  // blur) but with ±15% jitter so visually identical streaks don't
  // appear side-by-side.
  d.length =
    lerp(layer.lengthMin, layer.lengthMax, speedT) * (0.85 + Math.random() * 0.3);
  // Spawn anywhere along a band wider than the viewport so wind drift
  // doesn't leave the right edge bare.
  d.x = -40 + Math.random() * (width + 80);
  d.y = spawnAtTop
    ? -d.length - Math.random() * 80
    : Math.random() * height;
  // Per-drop turbulence parameters (see Raindrop interface).
  // ~±3.5° angular deviation, baked once at spawn — the small-angle
  // approximation keeps the per-frame cost to a couple of FLOPs.
  d.wobbleAngle = (Math.random() - 0.5) * 0.12;
  d.wobblePhase = Math.random() * Math.PI * 2;
  // Heavier (faster) drops resist sideways drift more, so amplitude
  // scales inversely with normalized speed.
  d.wobbleAmp = (0.6 + Math.random() * 1.4) * (1.2 - speedT * 0.6);
}

/* ── Splashes ──────────────────────────────────────────────
   Tiny horizontal "impact" lines that appear when a near-or-mid
   raindrop reaches the bottom of the viewport. Each splash grows
   slightly outward and fades over ~0.5s.

   Rendered in 3 alpha buckets (young/mid/old) so we get a smooth
   per-splash fade without giving up batched Path2D rendering.
   3 stroke calls per frame total for the whole splash field. */

interface Splash {
  x: number;
  age: number;     // seconds since spawn
  life: number;    // total seconds before removal
  width: number;   // base half-width in pixels
}

const MAX_SPLASHES = 220;

/** Drops partitioned by layer so each frame can batch-stroke per layer. */
type LayeredDrops = Raindrop[][];

function makeRaindrops(width: number, height: number, total: number): LayeredDrops {
  const layered: LayeredDrops = LAYERS.map(() => []);
  for (let li = 0; li < LAYERS.length; li++) {
    const count = Math.round(total * LAYERS[li].proportion);
    for (let i = 0; i < count; i++) {
      const d: Raindrop = {
        x: 0, y: 0, speed: 0, length: 0,
        wobbleAngle: 0, wobblePhase: 0, wobbleAmp: 0,
      };
      rerollRaindrop(d, LAYERS[li], width, height, false);
      layered[li].push(d);
    }
  }
  return layered;
}

/* ── Background lightning (perpetual distant flashes) ───────
   Brief radial brightening on the left or right edge of the
   viewport, suggesting lightning behind the horizon off-screen.
   No bolt is drawn — just the impression of one happening
   somewhere just out of sight. */

interface BgFlash {
  side: 'left' | 'right';
  startTime: number;  // performance.now() based
  duration: number;
  peak: number;
  yFraction: number;  // vertical center as fraction of height
}

function spawnBgFlashEvent(now: number, queue: BgFlash[]) {
  const side: 'left' | 'right' = Math.random() < 0.5 ? 'left' : 'right';
  const yFraction = 0.25 + Math.random() * 0.4; // upper-middle range
  // Primary
  queue.push({
    side,
    startTime: now,
    duration: 280 + Math.random() * 360,
    peak: 0.12 + Math.random() * 0.16,
    yFraction,
  });
  // 40% chance of a quick double-tap re-flash (very common in real distant lightning)
  if (Math.random() < 0.4) {
    queue.push({
      side,
      startTime: now + 100 + Math.random() * 110,
      duration: 200 + Math.random() * 260,
      peak: 0.06 + Math.random() * 0.1,
      yFraction,
    });
  }
}

function renderBgFlash(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  flash: BgFlash,
  now: number,
): boolean {
  const elapsed = now - flash.startTime;
  if (elapsed < 0) return true; // not started yet, keep
  const t = elapsed / flash.duration;
  if (t >= 1) return false;

  // Quick rise (first 12%), slow fade (rest)
  const intensity =
    t < 0.12 ? (t / 0.12) * flash.peak : flash.peak * (1 - (t - 0.12) / 0.88);
  if (intensity <= 0) return true;

  const cx = flash.side === 'left' ? -width * 0.05 : width * 1.05;
  const cy = height * flash.yFraction;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, width * 0.65);
  grad.addColorStop(0,    `rgba(220, 220, 220, ${intensity})`);
  grad.addColorStop(0.35, `rgba(170, 170, 170, ${intensity * 0.5})`);
  grad.addColorStop(0.7,  `rgba(110, 110, 110, ${intensity * 0.18})`);
  grad.addColorStop(1,    'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  return true;
}

function renderFlash(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  centerX: number,
  centerY: number,
  intensity: number,
) {
  if (intensity <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const grad = ctx.createRadialGradient(
    centerX,
    centerY,
    0,
    centerX,
    centerY,
    Math.max(w, h),
  );
  grad.addColorStop(0,    `rgba(255, 255, 255, ${1.0 * intensity})`);
  grad.addColorStop(0.15, `rgba(245, 245, 245, ${0.78 * intensity})`);
  grad.addColorStop(0.45, `rgba(195, 195, 195, ${0.4 * intensity})`);
  grad.addColorStop(0.8,  `rgba(120, 120, 120, ${0.18 * intensity})`);
  grad.addColorStop(1,    `rgba(80, 80, 80, ${0.08 * intensity})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

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

    /* Eight bolt variants pre-rendered to offscreen canvases at
       startup. Each variant has its own jaggedness seed AND its own
       source/destination angle so click strikes feel like fresh
       lightning from a different part of the sky each time, not
       just the same bolt rotated.

       Variants 0-2 keep the original top-right → bottom-left geometry
       so the SCRIPTED 3-strike intro looks identical to before.
       Variants 3-7 add new angles for the click-triggered pool.

       Memory cost: 8 × ~2MB on a 1080p screen = 16MB. Fine.
       Re-render cost on resize: ~60ms. */
    const VARIANT_COUNT = 8;
    const offscreens: HTMLCanvasElement[] = Array.from(
      { length: VARIANT_COUNT },
      () => document.createElement('canvas'),
    );
    // Source/dest as fractions of (width, height). The y values are
    // applied as: -60 above viewport for sources, +60 below for dests
    // so the bolt enters/exits cleanly off-screen.
    const VARIANT_PATHS: Array<{ srcX: number; dstX: number }> = [
      { srcX: 0.92, dstX: 0.08 },  // 0 — primary: top-right → bottom-left (original)
      { srcX: 0.85, dstX: 0.18 },  // 1 — secondary: same direction, slightly different angle
      { srcX: 0.78, dstX: 0.10 },  // 2 — tertiary: same direction
      { srcX: 0.55, dstX: 0.12 },  // 3 — top-center → bottom-left
      { srcX: 0.48, dstX: 0.85 },  // 4 — top-center → bottom-right (opposite!)
      { srcX: 0.15, dstX: 0.88 },  // 5 — top-left → bottom-right
      { srcX: 0.30, dstX: 0.72 },  // 6 — top-center-left → bottom-right
      { srcX: 0.10, dstX: 0.55 },  // 7 — top-left → bottom-center
    ];
    const SEEDS = [37, 91, 143, 211, 67, 153, 89, 257];

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = window.innerWidth;
    let height = window.innerHeight;
    let rainLayers: LayeredDrops = LAYERS.map(() => []);

    const generateAndPrerender = () => {
      const sway = Math.min(120, width * 0.1);
      for (let i = 0; i < VARIANT_COUNT; i++) {
        const path = VARIANT_PATHS[i];
        const source: Pt = [width * path.srcX, -60];
        const dest: Pt = [width * path.dstX, height + 60];
        const bolt = generateLightning(SEEDS[i], source, dest, sway, 4);
        prerenderBolt(offscreens[i], bolt, width, height, dpr);
      }
      // Density: ~1 drop per ~5500 viewport pixels (≈ 750 drops on a
      // 1080p screen, ~1100 on a 1440p). The atmospheric-mist layer
      // absorbs most of this count — visually subtle, perf-cheap.
      // Profile shows the rain loop uses <1% CPU so we have huge
      // headroom; the cap is a safety net for ultrawide displays.
      const total = Math.min(
        1400,
        Math.max(160, Math.floor((width * height) / 5500)),
      );
      rainLayers = makeRaindrops(width, height, total);
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      generateAndPrerender();
    };

    resize();
    window.addEventListener('resize', resize);

    const start = performance.now();
    let rafId = 0;
    let lastTick = start;

    // Skip rain + bg flashes if the user prefers reduced motion.
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    // Background lightning state.
    const bgFlashes: BgFlash[] = [];
    // First bg flash a bit after the main strike sequence so it doesn't
    // compete with it. Then random intervals 6–20 seconds.
    let nextBgFlashAt = start + 4500 + Math.random() * 6000;

    // User-triggered strikes from clicks.
    const adHocStrikes: AdHocStrike[] = [];
    let lastClickStrikeTime = 0;

    // Splash particle field (shared across all rain layers).
    const splashes: Splash[] = [];

    /* ── Mouse parallax ──────────────────────────────────────
       Track normalized cursor position (-1..1), smooth toward
       it each frame, then apply opposing translate3d() to the
       sky and stage layers. The canvas itself doesn't move —
       its content (rain + bolt) already drifts via wind.

       Skipped on touch-only devices (no useful "cursor" signal).
       Smoothing factor (0.06) is intentionally slow so the
       parallax feels like inertia, not a 1:1 cursor follower. */
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

    /* ── Click-to-strike ────────────────────────────────────
       Click anywhere (except on links/buttons) to trigger a
       fresh lightning strike + thunder + wordmark re-flash.
       Cooldown prevents audio overload from rapid clicking. */

    /** Re-trigger the wordmark glow pulse via WAAPI. Each call
        starts a fresh animation that overlays any previous one,
        so the wordmark always responds to a click — even mid-
        decay from a previous click. The keyframes mirror the
        first frame of the initial CSS wordPulse so the visual
        signature is consistent. */
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
      // can come from a different angle (top-left, top-center,
      // top-right, etc.) — much more variety than the scripted intro,
      // which always uses variants 0/1/2 from the top-right.
      const variant = Math.floor(Math.random() * VARIANT_COUNT);
      const intensity = 0.7 + Math.random() * 0.3;
      adHocStrikes.push({ startTime: now, variant, intensity });
      pulseWordmark(intensity);

      // Sync thunder to the bolt — the strike's audible peak should
      // arrive ~50ms after the visual peak (closer than real-world
      // lightning since "the user is at the strike location").
      audioRef.current?.triggerThunder({
        distance: 0.05 + Math.random() * 0.15,
        intensity: 0.85 + Math.random() * 0.15,
        delay: 0.04,
      });
    };
    sceneEl.addEventListener('click', handleSceneClick);

    // Fire the wordmark flicker animation at the EXACT instant the
    // primary strike peaks. Triggering this from JS rather than a CSS
    // animation-delay guarantees the wordmark and the canvas bolt
    // share a single source of timing truth — they both measure from
    // the same `start` reference inside this useEffect.
    const flickerTimer = window.setTimeout(() => {
      wordmarkRef.current?.classList.add(styles.flicker!);
    }, PRIMARY_STRIKE_T);

    const shakeTimer = window.setTimeout(() => {
      sceneEl.classList.add(styles.shake!);
      window.setTimeout(() => sceneEl.classList.remove(styles.shake!), 240);
    }, PRIMARY_STRIKE_T);

    /* ── Schedule thunder for the scripted strike sequence ──
       Timed off `start` (same reference as the canvas bolt + the
       wordmark flicker) so all three are sample-accurate. The
       audio is a no-op if not unlocked yet — but if the user
       enables sound during the 1s pre-strike window, they'll catch
       the full storm intro in sync. */
    const thunderTimers: number[] = [];
    for (const s of STRIKES) {
      thunderTimers.push(
        window.setTimeout(() => {
          audioRef.current?.triggerThunder({
            // Primary is closest, secondary slightly further, tertiary further still.
            distance: s.variant * 0.18,
            intensity: s.intensity,
            delay: 0.025,
          });
        }, s.t),
      );
    }

    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);

      const elapsed = now - start;

      // Run at the display's native refresh rate (typically 60Hz, often
      // 120/144Hz on modern monitors). Profiling shows this loop uses
      // <2% CPU even at full speed, so throttling buys nothing and just
      // makes fast-moving rain streaks look choppy. The dt cap below
      // already keeps physics stable if the tab loses focus.
      const dt = Math.min(0.05, (now - lastTick) / 1000);
      lastTick = now;

      ctx.clearRect(0, 0, width, height);

      // Pre-flash brightening before primary.
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

      // Per-variant intensity, so each re-strike uses its own bolt geometry.
      const variantIntensity: number[] = new Array(VARIANT_COUNT).fill(0);
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

      // User-triggered ad-hoc strikes. Same envelope math as the
      // scripted ones, just driven off each strike's own startTime
      // instead of the global `start`. Pruned in place once their
      // full envelope has decayed.
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

      // Flash centered at the wordmark (vertical center) so the visual
      // illumination radiates from the same point the wordmark occupies.
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

      /* ── Background lightning ──────────────────────────────
         Schedule the next event when the timer fires, then iterate
         active flashes (some of which may not have started yet —
         scheduled re-flashes have future startTimes). */
      if (!reduceMotion) {
        if (now >= nextBgFlashAt) {
          spawnBgFlashEvent(now, bgFlashes);
          nextBgFlashAt = now + 6000 + Math.random() * 14000;
          // Distant thunder follows the visible flash. The audio
          // delay (~0.4–0.9s) sells the "this is happening miles
          // away" feel — sound trails the flash like it would
          // across a few km of open air.
          audioRef.current?.triggerThunder({
            distance: 0.85 + Math.random() * 0.15,
            intensity: 0.35 + Math.random() * 0.25,
            delay: 0.4 + Math.random() * 0.5,
          });
        }
        let totalBgFlash = 0;
        for (let i = bgFlashes.length - 1; i >= 0; i--) {
          const f = bgFlashes[i];
          const keep = renderBgFlash(ctx, width, height, f, now);
          if (!keep) {
            bgFlashes.splice(i, 1);
            continue;
          }
          // Track contribution for CSS coupling so the sky brightens too.
          const e = now - f.startTime;
          if (e >= 0 && e < f.duration) {
            const t = e / f.duration;
            const intensity =
              t < 0.12
                ? (t / 0.12) * f.peak
                : f.peak * (1 - (t - 0.12) / 0.88);
            totalBgFlash = Math.max(totalBgFlash, intensity);
          }
        }
        // Compose into the same flash signal that drives sky brightness.
        flashIntensity = Math.max(flashIntensity, totalBgFlash);
      }

      // NOTE: We deliberately do NOT write any CSS variables here.
      // All visual brightness response (sky, scene flash) is rendered
      // on the canvas via additive overlays — that's GPU-composited.
      // Driving paint-properties (text-shadow, filter) from a per-frame
      // CSS var causes paint-thread thrash and grows over time as
      // background flashes keep firing. The wordmark pulse is handled
      // by a bounded CSS keyframe animation instead (see wordPulse).

      /* ── Falling rain ────────────────────────────────────────
         Each layer is batched into a single Path2D and stroked twice
         per frame: once at full length (dim tail) and once at the
         head portion (bright). Additive blending stacks them so the
         head is brighter than the tail — recreating the gradient look
         WITHOUT allocating a CanvasGradient per drop per frame.

         4 layers × 2 passes = 8 stroke calls per frame total,
         regardless of how many drops are in flight.

         Realism layer:
         - Wind direction is summed from THREE sine octaves at
           different frequencies, producing organic non-periodic
           gusts instead of an obvious sway.
         - A separate gust ENVELOPE periodically boosts drop velocity
           by up to 22% — the storm "leans in" and breathes.
         - Each drop carries a baked-in angular deviation from the
           base wind direction (small-angle rotation, no per-drop
           sqrt/trig), so streaks aren't perfectly parallel rails.
         - Each drop also drifts sideways on a personal sine wave —
           micro air-currents pushing each drop independently. */
      if (!reduceMotion) {
        // ─ Multi-octave wind. The three frequencies are deliberately
        //   non-harmonic so they never re-align into a recognizable cycle.
        const windBase = 0.14;
        const wind1 = Math.sin(elapsed * 0.00018 + 0.5) * 0.05;
        const wind2 = Math.sin(elapsed * 0.00071 + 2.1) * 0.025;
        const wind3 = Math.sin(elapsed * 0.00193 + 4.2) * 0.012;
        const windLean = windBase + wind1 + wind2 + wind3;
        const mag = Math.sqrt(1 + windLean * windLean);
        const baseVy = 1 / mag;
        const baseVx = -windLean / mag;

        // ─ Gust envelope. Half-rectified sum of two slow sines.
        //   At rest = 1.0, peaks at ~1.22 during a strong gust.
        const gustRaw =
          Math.sin(elapsed * 0.00045 - 1) * 0.6 +
          Math.sin(elapsed * 0.00091) * 0.4;
        const gust = 1 + Math.max(0, gustRaw) * 0.22;

        // ─ Time argument for per-drop horizontal sway.
        const swayT = elapsed * 0.0014;

        const flashBoost = 1 + flashIntensity * 0.7;
        const HEAD_FRACTION = 0.32;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        for (let li = 0; li < LAYERS.length; li++) {
          const layer = LAYERS[li];
          const drops = rainLayers[li];
          if (drops.length === 0) continue;

          // Tail pass — full length, dim. Updates positions, builds path.
          ctx.beginPath();
          for (let i = 0; i < drops.length; i++) {
            const d = drops[i];

            // Per-drop velocity = base wind, rotated by drop's wobbleAngle.
            // Small-angle approximation keeps this to 2 mults + 2 adds.
            const dvx = baseVx + baseVy * d.wobbleAngle;
            const dvy = baseVy - baseVx * d.wobbleAngle;

            // Integrate position with global gust multiplier.
            d.x += dvx * d.speed * gust * dt;
            d.y += dvy * d.speed * gust * dt;

            if (d.y - d.length > height || d.x < -60 || d.x > width + 60) {
              // Splash spawn — only for the two faster layers (mid + near)
              // and only when the drop exited via the BOTTOM (not the
              // sides via wind drift). Splashes off-screen would be
              // wasted work.
              const exitedBottom = d.y - d.length > height;
              if (
                exitedBottom &&
                li >= 2 &&
                splashes.length < MAX_SPLASHES &&
                Math.random() < (li === 3 ? 0.55 : 0.30)
              ) {
                splashes.push({
                  // Use the visible streak position (with sway), clamped
                  // into the viewport so splashes appear where the eye
                  // actually saw the drop.
                  x: Math.max(2, Math.min(width - 2, d.x)),
                  age: 0,
                  life: 0.40 + Math.random() * 0.30,
                  width: li === 3 ? 6 + Math.random() * 8 : 3 + Math.random() * 5,
                });
              }
              rerollRaindrop(d, layer, width, height, true);
              continue;
            }

            // Per-drop sideways sway — same offset applied to both
            // endpoints so the streak shifts uniformly (it's a position
            // offset, not a kink in the streak shape).
            const sway = Math.sin(swayT + d.wobblePhase) * d.wobbleAmp;
            const px = d.x + sway;
            ctx.moveTo(px, d.y);
            ctx.lineTo(px - dvx * d.length, d.y - dvy * d.length);
          }
          ctx.lineWidth = layer.width;
          ctx.strokeStyle = `rgba(225, 225, 225, ${Math.min(0.9, layer.tailAlpha * flashBoost)})`;
          ctx.stroke();

          // Head pass — leading 32% of each drop, brighter. Same
          // per-drop velocity + sway as the tail pass so the head
          // sits exactly on the streak.
          ctx.beginPath();
          for (let i = 0; i < drops.length; i++) {
            const d = drops[i];
            const dvx = baseVx + baseVy * d.wobbleAngle;
            const dvy = baseVy - baseVx * d.wobbleAngle;
            const sway = Math.sin(swayT + d.wobblePhase) * d.wobbleAmp;
            const px = d.x + sway;
            const headLen = d.length * HEAD_FRACTION;
            ctx.moveTo(px, d.y);
            ctx.lineTo(px - dvx * headLen, d.y - dvy * headLen);
          }
          ctx.strokeStyle = `rgba(240, 240, 240, ${Math.min(0.95, layer.headAlpha * flashBoost)})`;
          ctx.stroke();
        }

        /* ── Splashes ───────────────────────────────────────
           Bucket each active splash into one of three age tiers
           (young / mid / old). Render each tier in a single
           batched stroke pass with its own alpha + width — this
           gives smooth per-splash fading without breaking
           batching (3 stroke calls total for the whole field). */
        if (splashes.length > 0) {
          const SPLASH_ALPHAS = [0.26, 0.16, 0.07];
          const SPLASH_WIDTHS = [0.75, 0.55, 0.40];
          // Bucket holds direct references to splash objects rather
          // than array indices — splicing the splashes array
          // mid-iteration would otherwise invalidate any cached
          // indices that point past the splice point.
          const bucketed: Splash[][] = [[], [], []];

          for (let i = splashes.length - 1; i >= 0; i--) {
            const s = splashes[i];
            s.age += dt;
            if (s.age >= s.life) {
              splashes.splice(i, 1);
              continue;
            }
            const t = s.age / s.life;
            const bucket = t < 0.33 ? 0 : t < 0.66 ? 1 : 2;
            bucketed[bucket].push(s);
          }

          // Splash y is just above the bottom edge — implies a
          // ground line without committing to a visible surface.
          const splashY = height - 1;
          for (let b = 0; b < 3; b++) {
            const bucket = bucketed[b];
            if (bucket.length === 0) continue;
            ctx.beginPath();
            for (let k = 0; k < bucket.length; k++) {
              const s = bucket[k];
              const t = s.age / s.life;
              // Splash expands ~50% over its lifetime as it fades.
              const w = s.width * (0.55 + t * 0.55);
              ctx.moveTo(s.x - w * 0.5, splashY);
              ctx.lineTo(s.x + w * 0.5, splashY);
            }
            ctx.lineWidth = SPLASH_WIDTHS[b];
            ctx.strokeStyle = `rgba(225, 225, 225, ${
              SPLASH_ALPHAS[b] * flashBoost
            })`;
            ctx.stroke();
          }
        }

        ctx.restore();
      }

      /* ── Mouse parallax ────────────────────────────────────
         Smooth toward the cursor each frame and apply opposing
         transforms to the sky and stage layers. transform is a
         compositor property — these mutations don't trigger
         paint, just a cheap layer composite. */
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

    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(shakeTimer);
      window.clearTimeout(flickerTimer);
      for (const id of thunderTimers) window.clearTimeout(id);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      sceneEl.removeEventListener('click', handleSceneClick);
    };
  }, []);

  // Dispose audio on full unmount only (separate effect so it doesn't
  // re-run when handleToggleAudio changes — which it doesn't, but
  // future-proofing against React Compiler / Strict Mode behaviors).
  useEffect(() => {
    return () => {
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, []);

  return (
    <main ref={sceneRef} className={styles.scene}>
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
      {/* Speaker cone */}
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
