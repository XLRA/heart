/* ──────────────────────────────────────────────────────────────
   Bolt rendering pipeline.

   Each bolt VARIANT is generated once (via generateBolt) and
   pre-rendered to TWO offscreen canvases:
     • trunk-only  — the main descending channel
     • branches-only — the smaller forks coming off the trunk

   At runtime, the rAF loop composites each layer with its own
   intensity (branches decay faster than the trunk during late
   strike phase — physically realistic, since branches carry
   less current and cool sooner). Both layers use additive 3-stack
   compositing for white-hot bloom.

   Variant 0 is the canonical "primary" bolt — the center channel
   the scripted intro fires through the wordmark. Variants 1 and 2
   are tightly-clustered RIBBON offsets sharing roughly the same
   path with a small lateral wind drift. Variants 3-7 are a
   fresh-channel pool with totally different angles; clicks and
   ambient auto-strikes draw randomly from all six channels.

   Each variant also carries a small JITTER offset baked at build
   time — applied at composite time so subsequent strokes through
   the same channel appear shifted by a few pixels (the ionized
   plasma channel literally moves between strokes in real lightning).

   Memory cost: 8 variants × 2 offscreens (trunk + branches) ×
   ~2MB on a 1080p display ≈ 32MB. Re-render cost on resize: ~80ms.

   Fill-rate budget (why strikes used to hitch on weak GPUs)
   -----------------------------------------------------------
   A strike is pure GPU fill: every lit frame used to blit each
   full-screen offscreen 3× (trunk + branches = 6 viewport-sized
   blits per variant, held for the whole ~0.9s afterimage) plus up
   to seven full-screen gradient fills. Three changes cut that
   without changing a single visible pixel:
     • TILES — at prerender time we record which cells (64px wide,
       a third of the viewport tall) each bolt can touch (polyline +
       a blur margin far past where the shadow quantizes to 0).
       Composites blit only those runs — ~3 per layer, covering
       ~30-37% of the screen instead of 100%.
     • STACKING — three additive draws at alpha I equal ceil(3I)
       draws whose alphas sum to 3I ('lighter' saturates, and
       saturating addition of non-negatives is associative). The
       dim afterimage tail (I < 1/3) becomes one blit instead of 3.
     • GRADIENTS — every glow fill is clipped to its gradient's
       bounding box (outside it the gradient is transparent and
       adds nothing), and gradients are cached per position with
       the strength applied through globalAlpha — strike frames no
       longer allocate gradient objects or rgba() strings.
   ────────────────────────────────────────────────────────────── */

import { strokePoints, mulberry32, type Lightning, type Pt } from './generateBolt';

export const VARIANT_COUNT = 8;

/**
 * Source/destination as fractions of (width, height). Y values are
 * applied as -60 above viewport for sources and +60 below for
 * destinations so the bolt enters/exits cleanly off-screen.
 *
 * Variant 0 is the canonical top-right → bottom-left diagonal.
 * Its straight-line path crosses x≈0.5 at mid-height — exactly
 * where the wordmark sits — so the scripted intro strike reads as
 * the bolt slashing down through the word on its way to ground.
 * Variants 1-2 are RIBBON offsets of that channel — minor lateral
 * drift, used by the click pool and the intro's re-flashes.
 */
export const VARIANT_PATHS: readonly { srcX: number; dstX: number }[] = [
  { srcX: 0.92, dstX: 0.08 },   // 0 — primary: top-right → bottom-left through the wordmark
  { srcX: 0.915, dstX: 0.092 }, // 1 — ribbon: small drift viewer-left
  { srcX: 0.928, dstX: 0.075 }, // 2 — ribbon: small drift the other way
  { srcX: 0.55, dstX: 0.12 },   // 3 — top-center → bottom-left
  { srcX: 0.48, dstX: 0.85 },   // 4 — top-center → bottom-right
  { srcX: 0.15, dstX: 0.88 },   // 5 — top-left → bottom-right
  { srcX: 0.30, dstX: 0.72 },   // 6 — top-center-left → bottom-right
  { srcX: 0.10, dstX: 0.55 },   // 7 — top-left → bottom-center
];

/** Per-variant PRNG seeds — controls the unique jaggedness of each bolt. */
export const SEEDS: readonly number[] = [37, 91, 143, 211, 67, 153, 89, 257];

/**
 * Lateral jitter offset (in CSS pixels) applied at composite time
 * for each variant. Two purposes:
 *   • For ribbon variants (0-2): each sub-stroke through the channel
 *     appears at a slightly different position — the wind is moving
 *     the ionized air between flashes.
 *   • For all variants: keeps the same variant from rendering
 *     pixel-identical to itself across re-strikes.
 *
 * Values are small (±3px) so the channel still reads as "the same
 * bolt." Variant 0 uses zero jitter as the canonical reference.
 */
export const VARIANT_JITTER: readonly { dx: number; dy: number }[] = [
  { dx:  0,    dy: 0 },     // 0 — anchor (no jitter)
  { dx: -2.4,  dy: 0.6 },   // 1 — ribbon offset left
  { dx:  2.8,  dy: -0.4 },  // 2 — ribbon offset right
  { dx: -1.5,  dy: 0 },     // 3 — click pool: small left
  { dx:  1.8,  dy: 0 },     // 4 — small right
  { dx: -2.2,  dy: 0.3 },   // 5
  { dx:  1.2,  dy: -0.3 },  // 6
  { dx: -1.0,  dy: 0.5 },   // 7
];

/* ── Color palette ──────────────────────────────────────────────
   Pure-white temperature gradient — broad outer bloom is a soft
   neutral white, progressively brightening to the overexposed
   #ffffff channel core. Intentionally devoid of any cool/warm
   tint so the bolt reads as a clean, monochrome white discharge
   (no purple/orange/blue color cast anywhere in the stack). */
const HALO_OUTER_COLOR  = 'rgba(232, 232, 232, 1)';   // soft neutral white
const HALO_OUTER_STROKE = 'rgba(240, 240, 240, 0.85)';
const HALO_INNER_COLOR  = 'rgba(248, 248, 248, 1)';   // brighter neutral white
const HALO_INNER_STROKE = 'rgba(252, 252, 252, 0.95)';
/* Pass 3 + 4 stay pure white — the channel core is overexposed. */

const TAPER = [1.0, 0.6, 0.3];

function strokeBranches(
  ctx: CanvasRenderingContext2D,
  branches: Pt[][],
) {
  for (const t of TAPER) {
    for (const br of branches) {
      const n = Math.max(2, Math.ceil(br.length * t));
      strokePoints(ctx, br.slice(0, n));
    }
  }
}

/**
 * Stroke a polyline in short chunks with per-chunk width variation.
 * Real plasma channels have hot spots — segments where the discharge
 * is locally brighter/thicker. A constant-width hairline core reads
 * as vector art; the ±35% chunked variation reads as a photograph.
 * Chunks overlap by one point and use round caps so joints blend.
 */
function strokeVariedCore(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  baseWidth: number,
  rng: () => number,
) {
  const CHUNK = 7;
  for (let i = 0; i < pts.length - 1; i += CHUNK) {
    const seg = pts.slice(i, Math.min(pts.length, i + CHUNK + 1));
    ctx.lineWidth = baseWidth * (0.72 + rng() * 0.66);
    strokePoints(ctx, seg);
  }
}

/* ── Tile coverage ──────────────────────────────────────────────
   Per offscreen: a flat list of [x, y, w, h] rects (CSS px) — the
   horizontal runs of cells that the bolt can light. Cells are
   TILE_W wide and a third of the viewport tall: tall bands keep
   the run count at ~3 per layer (each run is one drawImage, so the
   afterimage tail issues the same call count as the old 3-stack
   full blits) while covering only ~30-37% of the screen. Keyed by
   the offscreen canvas itself, so composites look their rects up
   without any API change; a missing entry falls back to a
   full-viewport blit. */
const TILE_W = 64;
const TILE_BANDS = 3;
/** Distance from any stroke point beyond which the offscreen is
 *  exactly transparent. The widest pass is shadowBlur 32 (gaussian
 *  sigma 16 canvas px — ≤16 CSS px at any DPR); at 80px the shadow
 *  is ~exp(-12.5) of peak, which quantizes to 0. */
const TILE_MARGIN = 80;
const BOLT_TILES = new WeakMap<HTMLCanvasElement, Float32Array>();

function computeTiles(polylines: Pt[][], width: number, height: number): Float32Array {
  const tileH = Math.max(1, Math.ceil(height / TILE_BANDS));
  const cols = Math.max(1, Math.ceil(width / TILE_W));
  const rows = Math.max(1, Math.ceil(height / tileH));
  const mask = new Uint8Array(cols * rows);
  for (const pts of polylines) {
    for (const [px, py] of pts) {
      const c0 = Math.max(0, Math.floor((px - TILE_MARGIN) / TILE_W));
      const c1 = Math.min(cols - 1, Math.floor((px + TILE_MARGIN) / TILE_W));
      const r0 = Math.max(0, Math.floor((py - TILE_MARGIN) / tileH));
      const r1 = Math.min(rows - 1, Math.floor((py + TILE_MARGIN) / tileH));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) mask[r * cols + c] = 1;
      }
    }
  }
  const rects: number[] = [];
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (!mask[r * cols + c]) { c++; continue; }
      const start = c;
      while (c < cols && mask[r * cols + c]) c++;
      const x = start * TILE_W;
      const y = r * tileH;
      rects.push(x, y, Math.min(width, c * TILE_W) - x, Math.min(height, y + tileH) - y);
    }
  }
  return new Float32Array(rects);
}

function clearOffscreen(off: HTMLCanvasElement, width: number, height: number, dpr: number) {
  off.width = Math.floor(width * dpr);
  off.height = Math.floor(height * dpr);
  const ctx = off.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return ctx;
}

/**
 * Render the trunk-only halo stack to an offscreen.
 * Same 4-pass shadowBlur stack the original used, just without
 * the branch strokes. The cool color tint sits in passes 1-2;
 * passes 3-4 are pure white (the overexposed channel core).
 */
export function prerenderTrunk(
  off: HTMLCanvasElement,
  bolt: Lightning,
  width: number,
  height: number,
  dpr: number,
) {
  const ctx = clearOffscreen(off, width, height, dpr);
  if (!ctx) return;
  BOLT_TILES.set(off, computeTiles([bolt.trunk], width, height));

  // Pass 1 — outer halo (cool tinted).
  ctx.shadowBlur = 32;
  ctx.shadowColor = HALO_OUTER_COLOR;
  ctx.strokeStyle = HALO_OUTER_STROKE;
  ctx.lineWidth = 1.6;
  strokePoints(ctx, bolt.trunk);

  // Pass 2 — inner halo (subtle cool tint).
  ctx.shadowBlur = 14;
  ctx.shadowColor = HALO_INNER_COLOR;
  ctx.strokeStyle = HALO_INNER_STROKE;
  ctx.lineWidth = 1.2;
  strokePoints(ctx, bolt.trunk);

  // Pass 3 — bright sheath (pure white, near-the-core temp).
  ctx.shadowBlur = 5;
  ctx.shadowColor = 'rgba(255, 255, 255, 1)';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.0;
  strokePoints(ctx, bolt.trunk);

  // Pass 4 — pure-white hairline core (overexposed channel) with
  // per-chunk hot-spot width variation along the channel.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#ffffff';
  strokeVariedCore(ctx, bolt.trunk, 0.55, mulberry32(7919 + bolt.trunk.length));
}

/**
 * Render the branches-only halo stack to an offscreen.
 * Same 4-pass approach as trunk but stroking only the branches
 * (with the existing 3-tier taper for the apparent thickness fall-off
 * from the trunk junction toward branch tips).
 */
export function prerenderBranches(
  off: HTMLCanvasElement,
  bolt: Lightning,
  width: number,
  height: number,
  dpr: number,
) {
  const ctx = clearOffscreen(off, width, height, dpr);
  if (!ctx) return;
  BOLT_TILES.set(off, computeTiles(bolt.branches, width, height));

  // Pass 1 — outer halo (cool tinted).
  ctx.shadowBlur = 32;
  ctx.shadowColor = HALO_OUTER_COLOR;
  ctx.strokeStyle = HALO_OUTER_STROKE;
  ctx.lineWidth = 1.0;
  strokeBranches(ctx, bolt.branches);

  // Pass 2 — inner halo.
  ctx.shadowBlur = 14;
  ctx.shadowColor = HALO_INNER_COLOR;
  ctx.strokeStyle = HALO_INNER_STROKE;
  ctx.lineWidth = 0.8;
  strokeBranches(ctx, bolt.branches);

  // Pass 3 — bright sheath.
  ctx.shadowBlur = 5;
  ctx.shadowColor = 'rgba(255, 255, 255, 1)';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.6;
  strokeBranches(ctx, bolt.branches);

  // Pass 4 — pure-white hairline core (no shadow), with the same
  // hot-spot width variation as the trunk core.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#ffffff';
  const coreRng = mulberry32(1543 + bolt.branches.length);
  for (const br of bolt.branches) strokeVariedCore(ctx, br, 0.38, coreRng);
}

/** Blit an offscreen's covered tile runs (or the whole viewport if
 *  it has no tile list). Source rects scale by the offscreen's own
 *  backing-store ratio — the same mapping a full-viewport blit uses. */
function blitCovered(
  ctx: CanvasRenderingContext2D,
  off: HTMLCanvasElement,
  width: number,
  height: number,
) {
  const rects = BOLT_TILES.get(off);
  if (!rects) {
    ctx.drawImage(off, 0, 0, width, height);
    return;
  }
  const sx = off.width / width;
  const sy = off.height / height;
  for (let i = 0; i < rects.length; i += 4) {
    const x = rects[i];
    const y = rects[i + 1];
    const w = rects[i + 2];
    const h = rects[i + 3];
    ctx.drawImage(off, x * sx, y * sy, w * sx, h * sy, x, y, w, h);
  }
}

/**
 * Composite a pre-rendered offscreen onto the live canvas at the
 * given intensity, with optional jitter offset. Three stacked
 * draws under additive compositing blow out the core to over-
 * exposed white — issued as ceil(3I) draws whose alphas sum to 3I
 * (identical under saturating 'lighter'), each blitting only the
 * bolt's covered tiles.
 */
export function compositeBolt(
  ctx: CanvasRenderingContext2D,
  off: HTMLCanvasElement,
  width: number,
  height: number,
  intensity: number,
  jitterX = 0,
  jitterY = 0,
) {
  if (intensity <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (jitterX !== 0 || jitterY !== 0) ctx.translate(jitterX, jitterY);
  let remaining = 3 * Math.min(1, intensity);
  while (remaining > 1e-4) {
    const a = remaining > 1 ? 1 : remaining;
    ctx.globalAlpha = a;
    blitCovered(ctx, off, width, height);
    remaining -= a;
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * Composite with a return-stroke spatial sweep — the bolt brightness
 * sweeps UP from the destination point over ~10ms. Real lightning
 * does this: the return stroke travels up the established channel
 * at ~1/3 the speed of light. On a 1080p screen that's barely a
 * frame, but the upward brightness gradient sells the directionality.
 *
 * Mechanism:
 *   • Composite the bolt at LOW intensity (the leader-trace remnant)
 *     — visible across the full bolt.
 *   • Then composite the bolt at HIGH intensity, clipped to a
 *     bottom-anchored rectangle that grows upward.
 *
 * The hard clip-edge is only visible 1-2 frames at most, then
 * sweep completes and the bolt is uniformly bright. Imperceptible
 * in motion.
 */
export function compositeBoltSweep(
  ctx: CanvasRenderingContext2D,
  off: HTMLCanvasElement,
  width: number,
  height: number,
  intensity: number,
  sweepProgress: number,
  jitterX = 0,
  jitterY = 0,
) {
  if (intensity <= 0) return;
  if (sweepProgress >= 1) {
    compositeBolt(ctx, off, width, height, intensity, jitterX, jitterY);
    return;
  }
  // Background trace (leader-class brightness across the full path).
  compositeBolt(ctx, off, width, height, intensity * 0.18, jitterX, jitterY);
  // Lit portion — clipped to the swept area below the cutoff.
  const cutoffY = height * (1 - sweepProgress);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, cutoffY, width, height - cutoffY);
  ctx.clip();
  compositeBolt(ctx, off, width, height, intensity * 0.85, jitterX, jitterY);
  ctx.restore();
}

/**
 * Composite with a stepped-leader descent — the bolt is revealed
 * top-down, clipped to a top-anchored rectangle that grows downward
 * as the leader propagates from cloud toward ground. Branches pass
 * through the same clip, so forks pop into view as the descent
 * passes their junctions — exactly how stepped leaders branch in
 * high-speed footage.
 */
export function compositeBoltLeader(
  ctx: CanvasRenderingContext2D,
  off: HTMLCanvasElement,
  width: number,
  height: number,
  intensity: number,
  progress: number,
  jitterX = 0,
  jitterY = 0,
) {
  if (intensity <= 0 || progress <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height * progress);
  ctx.clip();
  compositeBolt(ctx, off, width, height, intensity, jitterX, jitterY);
  ctx.restore();
}

/* ── Gradient cache ─────────────────────────────────────────────
   Glow gradients are pure geometry once their alpha ramp is
   normalized (peak stop = 1); each call scales them by the old
   per-frame strength through globalAlpha — the same pixels the
   strength-baked stops produced, since every stop scaled linearly
   with it. Positions are fixed per variant (source/anchor X) or per
   viewport, so a handful of entries serve every strike. Cleared
   whenever the viewport size changes. */
const G_FLASH = 1;
const G_CLOUD = 2;
const G_RIM = 3;
const G_ANCHOR = 4;
const G_DIRECTIONAL = 5;
const G_TIP = 6;
let gradCacheW = -1;
let gradCacheH = -1;
const gradCache = new Map<number, CanvasGradient>();

/** Cache key for (kind, x) — x quantized to 1/8 px. Integer math
 *  only, so lookups never allocate. */
function gradKey(kind: number, width: number, height: number, x: number): number {
  if (width !== gradCacheW || height !== gradCacheH) {
    gradCache.clear();
    gradCacheW = width;
    gradCacheH = height;
  }
  return kind * 1_000_000 + Math.round(x * 8);
}

/** Fill only the bounding box of a radial gradient whose outer stop
 *  is fully transparent — outside it the fill would add nothing. */
function fillRadialBox(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  width: number,
  height: number,
) {
  const x0 = Math.max(0, cx - r);
  const y0 = Math.max(0, cy - r);
  const x1 = Math.min(width, cx + r);
  const y1 = Math.min(height, cy + r);
  if (x1 > x0 && y1 > y0) ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

/**
 * Bright spot at the descending leader's tip. The tip is where new
 * air is being ionized, so it glows hotter than the channel behind
 * it — the single detail that makes the descent read as "something
 * alive crawling down" rather than a wipe reveal.
 *
 * Tip coordinates are the caller's straight-line approximation of
 * the channel (lerp of the variant's src/dst); the glow is soft
 * enough that the few-px mismatch with the jagged path is invisible.
 */
export function renderLeaderTip(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  intensity: number,
) {
  if (intensity <= 0) return;
  const a = Math.min(1, intensity * 2.4);
  const r = 28;
  // Cached at the origin and translated — the tip moves every frame.
  const key = gradKey(G_TIP, gradCacheW, gradCacheH, 0);
  let grad = gradCache.get(key);
  if (!grad) {
    grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0,   'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.4, `rgba(240, 240, 240, ${0.22 / 0.55})`);
    grad.addColorStop(1,   'rgba(0, 0, 0, 0)');
    gradCache.set(key, grad);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.55 * a;
  ctx.translate(tipX, tipY);
  ctx.fillStyle = grad;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();
}

/**
 * Soft radial brightening centered on (centerX, centerY). Used as
 * the scene-wide flash that radiates outward from the strike point.
 */
export function renderFlash(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  centerX: number,
  centerY: number,
  intensity: number,
) {
  if (intensity <= 0) return;
  // Outer stop is not transparent — this one must cover the viewport.
  // (centerY is always viewport-derived, so size + X identify it.)
  const key = gradKey(G_FLASH, w, h, centerX);
  let grad = gradCache.get(key);
  if (!grad) {
    grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(w, h));
    grad.addColorStop(0,    'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.15, 'rgba(245, 245, 245, 0.78)');
    grad.addColorStop(0.45, 'rgba(195, 195, 195, 0.4)');
    grad.addColorStop(0.8,  'rgba(120, 120, 120, 0.18)');
    grad.addColorStop(1,    'rgba(80, 80, 80, 0.08)');
    gradCache.set(key, grad);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, intensity);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * Cloud-source illumination — the cloud the bolt comes from briefly
 * flashes brighter at the source point. Localized cool-tinted radial
 * gradient anchored just above the top edge of the viewport, on the
 * source X of the active variant.
 *
 * Real cloud-to-ground strikes show this prominently in photography:
 * the sky around the bolt's origin glows visibly brighter than the
 * scene-wide flash.
 */
export function renderCloudGlow(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  sourceX: number,
  intensity: number,
) {
  if (intensity <= 0) return;
  // Anchor 5% above the top edge so the glow reads as the cloud
  // (not the air right below the cloud) being lit.
  const cy = -height * 0.05;
  const radius = Math.max(width, height) * 0.42;
  const key = gradKey(G_CLOUD, width, height, sourceX);
  let grad = gradCache.get(key);
  if (!grad) {
    grad = ctx.createRadialGradient(sourceX, cy, 0, sourceX, cy, radius);
    // Pure neutral white at center — visually couples the cloud
    // illumination to the bolt's own neutral-white halo (no color
    // cast). Normalized to the 0.55 peak (applied via globalAlpha).
    grad.addColorStop(0,    'rgba(235, 235, 235, 1)');
    grad.addColorStop(0.35, `rgba(185, 185, 185, ${0.28 / 0.55})`);
    grad.addColorStop(0.7,  `rgba(125, 125, 125, ${0.10 / 0.55})`);
    grad.addColorStop(1,    'rgba(0, 0, 0, 0)');
    gradCache.set(key, grad);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, 0.55 * intensity);
  ctx.fillStyle = grad;
  fillRadialBox(ctx, sourceX, cy, radius, width, height);
  ctx.restore();
}

/**
 * Anchor-point bright explosion — the brief, intense bright spot
 * where the bolt connects with the ground. Only visible during the
 * actual return-stroke peak (intensity > THRESHOLD), then fades.
 *
 * Pure white-hot center, cooler outer ring — matches the overexposed
 * "contact discharge" you see in close-strike photographs.
 */
export function renderAnchorExplosion(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  anchorX: number,
  intensity: number,
) {
  // Only show during the BRIGHT peak — sub-threshold strikes
  // (afterimage/linger phases) don't produce visible contact glow.
  const THRESHOLD = 0.45;
  if (intensity <= THRESHOLD) return;
  const punch = (intensity - THRESHOLD) / (1 - THRESHOLD);  // 0..1
  // Anchor 2% below the bottom so the explosion reads as
  // happening at "ground level" off-screen.
  const cy = height + height * 0.02;
  const radius = Math.max(width, height) * 0.28;
  const key = gradKey(G_ANCHOR, width, height, anchorX);
  let grad = gradCache.get(key);
  if (!grad) {
    grad = ctx.createRadialGradient(anchorX, cy, 0, anchorX, cy, radius);
    // Normalized to the 0.72 peak (applied via globalAlpha).
    grad.addColorStop(0,    'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.18, `rgba(238, 238, 238, ${0.50 / 0.72})`);
    grad.addColorStop(0.45, `rgba(190, 190, 190, ${0.22 / 0.72})`);
    grad.addColorStop(1,    'rgba(0, 0, 0, 0)');
    gradCache.set(key, grad);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, 0.72 * punch);
  ctx.fillStyle = grad;
  fillRadialBox(ctx, anchorX, cy, radius, width, height);
  ctx.restore();
}

/**
 * Cloud rim lighting — clouds in the upper-mid sky region brighten on
 * the bolt-source side during peak. Distinct from `renderCloudGlow`
 * (which targets the cloud the bolt comes FROM, anchored above the top
 * edge). Cloud rim lights the BOTTOMS of the broader cloud field that
 * sits visually around 30% from the top of the viewport.
 *
 * Together, source glow + rim build the impression of a multi-cloud
 * sky catching the strike, not just one cloud.
 */
export function renderCloudRim(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  sourceX: number,
  intensity: number,
) {
  if (intensity <= 0) return;
  // Anchor at ~32% from top — visually where the cloud bases sit in
  // the .skyDrift CSS layer behind the canvas.
  const cy = height * 0.32;
  const radius = Math.max(width, height) * 0.55;
  const key = gradKey(G_RIM, width, height, sourceX);
  let grad = gradCache.get(key);
  if (!grad) {
    grad = ctx.createRadialGradient(sourceX, cy, 0, sourceX, cy, radius);
    // Normalized to the 0.20 peak (applied via globalAlpha).
    grad.addColorStop(0,    'rgba(232, 232, 232, 1)');
    grad.addColorStop(0.40, 'rgba(185, 185, 185, 0.5)');
    grad.addColorStop(0.85, 'rgba(110, 110, 110, 0.15)');
    grad.addColorStop(1,    'rgba(0, 0, 0, 0)');
    gradCache.set(key, grad);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, 0.20 * intensity);
  ctx.fillStyle = grad;
  fillRadialBox(ctx, sourceX, cy, radius, width, height);
  ctx.restore();
}

/**
 * Sky-wide tonal wash — uniform thin neutral-white additive across
 * the entire canvas during peak. Like the entire atmosphere catches
 * the flash for a fraction of a second. Subtle (~6% peak alpha);
 * meant to be a foundation other strike effects sit on top of.
 *
 * No source position — uniform fill, since the wash is the whole sky
 * being lit, not a directional source.
 */
export function renderSkyWash(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  intensity: number,
) {
  if (intensity <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, 0.06 * intensity);
  ctx.fillStyle = 'rgb(220, 220, 220)';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/**
 * Directional flash — brightens the lower-mid portion of the canvas
 * with a strong source-side bias. Rain composites additively over it
 * (rain renders with `globalCompositeOperation = 'lighter'`), so rain
 * drops on the source half of the screen visually pop brighter than
 * drops on the far side. Physically correct: drops closer to the
 * strike catch more reflected light.
 *
 * Threshold-gated to peak only — without that, the post-strike
 * afterimage would bleed into rain over hundreds of milliseconds and
 * make the rain look perpetually brighter than the hosted version.
 */
export function renderDirectionalFlash(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  sourceX: number,
  intensity: number,
) {
  if (intensity <= 0) return;
  // Centered horizontally at sourceX, vertically 60% down (where the
  // rain is densest). Wide radius for smooth fall-off across the screen.
  const cy = height * 0.60;
  const radius = Math.max(width, height) * 0.85;
  const key = gradKey(G_DIRECTIONAL, width, height, sourceX);
  let grad = gradCache.get(key);
  if (!grad) {
    grad = ctx.createRadialGradient(sourceX, cy, 0, sourceX, cy, radius);
    // Normalized to the 0.10 peak (applied via globalAlpha).
    grad.addColorStop(0,    'rgba(238, 238, 238, 1)');
    grad.addColorStop(0.40, 'rgba(180, 180, 180, 0.5)');
    grad.addColorStop(1,    'rgba(0, 0, 0, 0)');
    gradCache.set(key, grad);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, 0.10 * intensity);
  ctx.fillStyle = grad;
  fillRadialBox(ctx, sourceX, cy, radius, width, height);
  ctx.restore();
}

/**
 * Iris darkening reflex — applies a thin black layer over the entire
 * canvas to simulate the eye/camera adjusting after a bright flash.
 * Drawn LAST in the frame so it dims rain, bolts, glows, and shows
 * through to the sky CSS layer beneath the canvas. The wordmark is
 * outside the canvas in the DOM stack and stays unaffected — exactly
 * matches how a viewer's eye would react: the focal point you were
 * looking at stays bright while peripheral sky dims.
 */
export function renderIrisReflex(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  alpha: number,
) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/**
 * Generate fresh lightning + pre-render variant indices [startIdx, endIdx)
 * to BOTH the trunk and branches offscreen pools. Called on init for
 * the always-needed intro variants (0..3) and deferred via
 * requestIdleCallback for the click-only variants (3..VARIANT_COUNT).
 */
export function buildVariantRange(
  trunkOffscreens: HTMLCanvasElement[],
  branchOffscreens: HTMLCanvasElement[],
  generateLightning: (
    seed: number,
    source: Pt,
    dest: Pt,
    sway: number,
    branchDepth: number,
  ) => Lightning,
  width: number,
  height: number,
  dpr: number,
  startIdx: number,
  endIdx: number,
) {
  const sway = Math.min(120, width * 0.1);
  const lo = Math.max(0, startIdx);
  const hi = Math.min(VARIANT_COUNT, endIdx);
  for (let i = lo; i < hi; i++) {
    const path = VARIANT_PATHS[i];
    const source: Pt = [width * path.srcX, -60];
    const dest: Pt = [width * path.dstX, height + 60];
    const bolt = generateLightning(SEEDS[i], source, dest, sway, 4);
    prerenderTrunk(trunkOffscreens[i], bolt, width, height, dpr);
    prerenderBranches(branchOffscreens[i], bolt, width, height, dpr);
  }
}
