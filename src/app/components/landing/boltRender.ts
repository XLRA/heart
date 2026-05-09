/* ──────────────────────────────────────────────────────────────
   Bolt rendering pipeline.

   Each bolt VARIANT is generated once (via generateBolt) and
   pre-rendered to an offscreen canvas with stacked shadowBlur
   passes for photographic bloom. At runtime, the rAF loop just
   composites the pre-rendered offscreens onto the main canvas
   with `globalCompositeOperation = 'lighter'` × 3 — that 3-stack
   blows out the white core to overexposed.

   Variants 0-2 keep the original top-right → bottom-left geometry
   so the SCRIPTED 3-strike intro always looks the same. Variants
   3-7 add new source/destination angles for the click-triggered
   pool — top-center, top-left → bottom-right, etc. — so each
   click-strike feels like fresh lightning from a different part
   of the sky rather than the same bolt rotated.

   Memory cost: 8 offscreen canvases × ~2MB on a 1080p display ≈ 16MB.
   Re-render cost on resize: ~60ms.
   ────────────────────────────────────────────────────────────── */

import { strokePoints, type Lightning, type Pt } from './generateBolt';

export const VARIANT_COUNT = 8;

/**
 * Source/destination for each pre-rendered bolt as fractions of
 * (width, height). Y values are applied as -60 above viewport for
 * sources and +60 below for destinations so the bolt enters/exits
 * cleanly off-screen.
 */
export const VARIANT_PATHS: readonly { srcX: number; dstX: number }[] = [
  { srcX: 0.92, dstX: 0.08 },  // 0 — primary: top-right → bottom-left (original)
  { srcX: 0.85, dstX: 0.18 },  // 1 — secondary: same direction, slightly different angle
  { srcX: 0.78, dstX: 0.10 },  // 2 — tertiary: same direction
  { srcX: 0.55, dstX: 0.12 },  // 3 — top-center → bottom-left
  { srcX: 0.48, dstX: 0.85 },  // 4 — top-center → bottom-right (opposite!)
  { srcX: 0.15, dstX: 0.88 },  // 5 — top-left → bottom-right
  { srcX: 0.30, dstX: 0.72 },  // 6 — top-center-left → bottom-right
  { srcX: 0.10, dstX: 0.55 },  // 7 — top-left → bottom-center
];

/** Per-variant PRNG seeds — controls the unique jaggedness of each bolt. */
export const SEEDS: readonly number[] = [37, 91, 143, 211, 67, 153, 89, 257];

/**
 * Pre-render a bolt variant to an offscreen canvas with stacked
 * shadowBlur halos and tapered branches.
 *
 * The branches are stroked THREE times at 100% / 60% / 30% of
 * their original length. Under the additive composite at runtime,
 * the trunk-ends are stacked the most and the tips the least —
 * an apparent taper without per-segment width math.
 */
export function prerenderBolt(
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

/**
 * Composite a pre-rendered bolt onto the live canvas at the given
 * intensity. Three stacked draws under additive compositing blow
 * out the core to overexposed white.
 */
export function compositeBolt(
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
  ctx.drawImage(off, 0, 0, width, height);
  ctx.drawImage(off, 0, 0, width, height);
  ctx.drawImage(off, 0, 0, width, height);
  ctx.globalAlpha = 1;
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

/**
 * Generate fresh lightning + pre-render to all VARIANT_COUNT
 * offscreens. Called on init and on resize.
 */
export function buildVariantPool(
  offscreens: HTMLCanvasElement[],
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
) {
  const sway = Math.min(120, width * 0.1);
  for (let i = 0; i < VARIANT_COUNT; i++) {
    const path = VARIANT_PATHS[i];
    const source: Pt = [width * path.srcX, -60];
    const dest: Pt = [width * path.dstX, height + 60];
    const bolt = generateLightning(SEEDS[i], source, dest, sway, 4);
    prerenderBolt(offscreens[i], bolt, width, height, dpr);
  }
}
