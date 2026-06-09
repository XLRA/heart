/* ──────────────────────────────────────────────────────────────
   Word spark burst.

   When the intro bolt slashes through the wordmark, the word
   throws off a handful of tiny white sparks — thin streaks that
   shoot outward from the letterforms, decelerate, droop slightly
   under gravity, and fade in under half a second. Paired with the
   wordmark's white-hot CSS blow-out, it sells "the word got HIT"
   rather than "the word lit up."

   Deliberately restrained: ~14 sparks on the primary stroke, ~6 on
   the first re-flash, all pure white on the additive canvas — no
   color cast, consistent with the monochrome discharge aesthetic.
   The whole system is a flat array of value objects pruned in
   place; zero cost once the burst has decayed.
   ────────────────────────────────────────────────────────────── */

export interface Spark {
  /** performance.now() at spawn. */
  born: number;
  /** Lifetime in ms. */
  life: number;
  /** Outward direction (radians). */
  angle: number;
  /** Total outward travel distance in px. */
  speed: number;
  /** Spawn radius from the burst center — sparks leave from the
   *  word's letterforms, not from a single point. */
  startR: number;
  /** Streak length in px (shrinks as the spark dies). */
  len: number;
  width: number;
}

/** Push `count` fresh sparks into the pool. `strength` 0..1 scales
 *  how far the burst throws them. */
export function spawnSparkBurst(
  sparks: Spark[],
  now: number,
  count: number,
  strength: number,
) {
  for (let i = 0; i < count; i++) {
    sparks.push({
      born: now,
      life: 280 + Math.random() * 320,
      angle: Math.random() * Math.PI * 2,
      speed: (38 + Math.random() * 70) * (0.6 + strength * 0.4),
      startR: 12 + Math.random() * 34,
      len: 6 + Math.random() * 12,
      width: 0.7 + Math.random() * 0.7,
    });
  }
}

/**
 * Render + advance all live sparks around (cx, cy), pruning dead
 * ones in place. Position is derived from age each frame (no
 * per-spark integration state), so the system is allocation-free
 * after spawn.
 */
export function renderSparks(
  ctx: CanvasRenderingContext2D,
  sparks: Spark[],
  cx: number,
  cy: number,
  now: number,
) {
  if (sparks.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    const t = (now - s.born) / s.life;
    if (t >= 1) {
      sparks.splice(i, 1);
      continue;
    }
    // Ease-out travel (launched hard, decelerating) + a slight
    // gravity droop late in life.
    const ease = 1 - (1 - t) * (1 - t);
    const dist = s.startR + s.speed * ease;
    const dx = Math.cos(s.angle);
    const dy = Math.sin(s.angle);
    const droop = 26 * t * t;
    const hx = cx + dx * dist;
    const hy = cy + dy * dist + droop;
    const tailLen = s.len * (1 - t * 0.55);
    const alpha = (1 - t) * (1 - t) * 0.85;
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.lineWidth = s.width;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - dx * tailLen, hy - dy * tailLen - droop * 0.25);
    ctx.stroke();
  }
  ctx.restore();
}
