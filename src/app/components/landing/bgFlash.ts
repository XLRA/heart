/* ──────────────────────────────────────────────────────────────
   Background lightning — perpetual distant flashes.

   Brief radial brightening on the left or right edge of the
   viewport, suggesting lightning behind the horizon off-screen.
   No bolt is drawn — just the impression of one happening
   somewhere just out of sight.

   Each "event" produces 1-2 flashes (40% chance of a quick
   double-tap, very common in real distant lightning).

   Cloud banks
   -----------
   A smooth gradient alone reads as a glow, not as WEATHER. Two
   pre-rendered cloud-bank sprites (one lit from the left edge,
   one mirrored) give each flash lumpy interior structure — the
   flash reveals cloud shapes lit from within, which is the
   photographic signature of distant storm cells. The sprites are
   built once per viewport size (buildCloudBank, called from the
   orchestrator's prerender pass); per frame they cost a single
   drawImage. The edge-side brightness falloff is BAKED into the
   sprite so no per-frame masking is needed.

   Thunder swells
   --------------
   Roughly 20% of events are flagged as SWELLS — large storm-cell
   activity off-screen. Swells trigger a chain of 3-4 thunder
   bursts at increasing volume + delay, building over 4-6s. The
   audio caller should pass the swell schedule directly to its
   audio engine when consuming `pendingThunder`.
   ────────────────────────────────────────────────────────────── */

export interface BgFlash {
  side: 'left' | 'right';
  /** performance.now() based. */
  startTime: number;
  duration: number;
  peak: number;
  /** Vertical center as fraction of height. */
  yFraction: number;
}

export interface ThunderBurst {
  /** Distance 0..1 (further = quieter, more low-end). */
  distance: number;
  /** Intensity 0..1. */
  intensity: number;
  /** Audio-engine delay in seconds. */
  delay: number;
}

/**
 * Result of a spawn — flashes are pushed to the queue, and
 * `thunder` lists the audio bursts that should fire alongside.
 */
export interface SpawnResult {
  thunder: ThunderBurst[];
  /** True if this was a "swell" event (for debug overlay). */
  isSwell: boolean;
}

/* ── Cloud-bank sprites ─────────────────────────────────────── */

let cloudLeft: HTMLCanvasElement | null = null;
let cloudRight: HTMLCanvasElement | null = null;
let cloudW = 0;
let cloudH = 0;

/**
 * Render one edge-lit cloud bank into an offscreen canvas. Puffy
 * masses are built from clusters of overlapping soft radial blobs
 * (bright shoulder, fading core — overlaps read as billows), with
 * brightness falling off away from the lit edge (x=0) so a flash
 * on that side illuminates nearby clouds hardest. Neutral grays
 * only, matching the scene's monochrome identity.
 */
function renderCloudBank(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'lighter';

  const clusterCount = 4 + Math.floor(Math.random() * 2);
  for (let c = 0; c < clusterCount; c++) {
    // Clusters bias toward the lit edge — that's where structure
    // should pop. pow() skews the distribution left.
    const cx = Math.pow(Math.random(), 1.6) * w * 0.85;
    const cy = h * (0.18 + Math.random() * 0.55);
    const blobCount = 8 + Math.floor(Math.random() * 6);
    for (let b = 0; b < blobCount; b++) {
      const r = h * (0.07 + Math.random() * 0.10);
      const bx = cx + (Math.random() - 0.5) * r * 3.2;
      const by = cy + (Math.random() - 0.5) * r * 1.6;
      // Baked lighting falloff from the lit edge.
      const falloff = Math.pow(Math.max(0, 1 - bx / w), 1.5);
      const a = (0.05 + Math.random() * 0.09) * falloff;
      if (a < 0.004) continue;
      const g = ctx.createRadialGradient(bx, by, r * 0.15, bx, by, r);
      g.addColorStop(0,    `rgba(200, 200, 200, ${a * 0.55})`);
      g.addColorStop(0.55, `rgba(190, 190, 190, ${a})`);
      g.addColorStop(1,    'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(bx - r, by - r, r * 2, r * 2);
    }
  }

  // Feather the top and bottom so the bank melts into the sky
  // instead of ending at the sprite rectangle.
  ctx.globalCompositeOperation = 'destination-out';
  const fade = ctx.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0,    'rgba(0, 0, 0, 0.9)');
  fade.addColorStop(0.22, 'rgba(0, 0, 0, 0)');
  fade.addColorStop(0.68, 'rgba(0, 0, 0, 0)');
  fade.addColorStop(1,    'rgba(0, 0, 0, 1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);

  return canvas;
}

/**
 * (Re)build both cloud-bank sprites for the current viewport.
 * Call from the debounced heavy-resize path — generation walks
 * ~60 gradient blobs, cheap as a one-off but not per-frame work.
 * Sprites render at 1× (not DPR-scaled): clouds are soft masses,
 * and the upscale blur is indistinguishable — free VRAM savings.
 */
export function buildCloudBank(width: number, height: number): void {
  cloudW = Math.max(1, Math.round(width * 0.72));
  cloudH = Math.max(1, Math.round(height * 0.52));
  cloudLeft = renderCloudBank(cloudW, cloudH);
  const right = document.createElement('canvas');
  right.width = cloudW;
  right.height = cloudH;
  const rc = right.getContext('2d')!;
  rc.translate(cloudW, 0);
  rc.scale(-1, 1);
  rc.drawImage(cloudLeft, 0, 0);
  cloudRight = right;
}

export function spawnBgFlashEvent(
  now: number,
  queue: BgFlash[],
): SpawnResult {
  const side: 'left' | 'right' = Math.random() < 0.5 ? 'left' : 'right';
  const yFraction = 0.25 + Math.random() * 0.4;

  // ~20% of bg events are swells. Skewed slightly higher in the
  // first 30s of the page so the user notices the system early.
  const isSwell = Math.random() < 0.22;

  if (isSwell) {
    return spawnSwell(now, side, yFraction, queue);
  }

  // Normal: 1 primary flash, 40% chance of a double-tap.
  queue.push({
    side,
    startTime: now,
    duration: 280 + Math.random() * 360,
    peak: 0.12 + Math.random() * 0.16,
    yFraction,
  });
  if (Math.random() < 0.4) {
    queue.push({
      side,
      startTime: now + 100 + Math.random() * 110,
      duration: 200 + Math.random() * 260,
      peak: 0.06 + Math.random() * 0.1,
      yFraction,
    });
  }

  // Single distant thunder, delayed 0.4-0.9s — sells the "miles
  // away" feel.
  return {
    thunder: [
      {
        distance: 0.85 + Math.random() * 0.15,
        intensity: 0.35 + Math.random() * 0.25,
        delay: 0.4 + Math.random() * 0.5,
      },
    ],
    isSwell: false,
  };
}

/**
 * Big distant storm cell. Visually: 3-4 chained flashes building
 * in intensity over 1.5-2.5s. Audibly: 3-4 thunder rolls building
 * over 4-6s, simulating sound bouncing across distance + the cell
 * being huge and continuing to discharge.
 */
function spawnSwell(
  now: number,
  side: 'left' | 'right',
  yFraction: number,
  queue: BgFlash[],
): SpawnResult {
  // Visual chain — 3-4 progressive flashes, each slightly brighter
  // than the last, ending with a sustained brightening.
  const flashCount = 3 + (Math.random() < 0.5 ? 1 : 0);
  let t = 0;
  for (let i = 0; i < flashCount; i++) {
    const isLast = i === flashCount - 1;
    queue.push({
      side,
      startTime: now + t,
      duration: isLast ? 700 + Math.random() * 400 : 220 + Math.random() * 200,
      // Builds: 0.10, 0.16, 0.22, 0.30 (sustained final)
      peak: 0.10 + i * 0.06 + (isLast ? 0.04 : 0),
      yFraction: yFraction + (Math.random() - 0.5) * 0.06,
    });
    t += 280 + Math.random() * 380;
  }

  // Audio chain — 3-4 thunder bursts building over 4-6s.
  // Distance starts very far and pulls slightly closer; intensity
  // builds. The final crackle is the "BOOM" reaching the listener.
  const thunder: ThunderBurst[] = [];
  const burstCount = 3 + (Math.random() < 0.6 ? 1 : 0);
  let delay = 0.5 + Math.random() * 0.4;
  for (let i = 0; i < burstCount; i++) {
    const progress = i / Math.max(1, burstCount - 1);
    thunder.push({
      // Pulls from 0.95 (very far) toward 0.6 (still distant but
      // perceptible) over the chain.
      distance: 0.95 - progress * 0.35,
      // Builds from 0.30 to 0.85.
      intensity: 0.30 + progress * 0.55,
      delay,
    });
    delay += 1.0 + Math.random() * 0.8;
  }

  return { thunder, isSwell: true };
}

/**
 * Render one bg flash. Returns false if the flash has fully
 * decayed and should be pruned.
 */
export function renderBgFlash(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  flash: BgFlash,
  now: number,
): boolean {
  const elapsed = now - flash.startTime;
  if (elapsed < 0) return true;
  const t = elapsed / flash.duration;
  if (t >= 1) return false;

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

  // Cloud structure lit from within — the sprite for the flash's
  // side, faded by the flash envelope. One drawImage; the additive
  // blend stacks it over the base glow so cloud lumps brighten
  // hardest near the flash edge (falloff is baked into the sprite).
  const sprite = flash.side === 'left' ? cloudLeft : cloudRight;
  if (sprite) {
    ctx.globalAlpha = Math.min(1, intensity * 2.2);
    ctx.drawImage(
      sprite,
      flash.side === 'left' ? 0 : width - cloudW,
      height * 0.03,
      cloudW,
      cloudH,
    );
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  return true;
}

/**
 * Compute the brightness contribution of all active bg flashes
 * to the global flash signal (so sky + wordmark also pulse).
 */
export function bgFlashIntensity(flashes: BgFlash[], now: number): number {
  let total = 0;
  for (const f of flashes) {
    const e = now - f.startTime;
    if (e < 0 || e >= f.duration) continue;
    const t = e / f.duration;
    const intensity =
      t < 0.12 ? (t / 0.12) * f.peak : f.peak * (1 - (t - 0.12) / 0.88);
    if (intensity > total) total = intensity;
  }
  return total;
}
