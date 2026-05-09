/**
 * Procedural lightning generation using the midpoint-displacement /
 * random-walk-with-smoothing algorithm (Hoffman, 2013).
 *
 * The reason hand-drawn zigzag paths look fake is that real lightning
 * is mostly straight with hundreds of tiny correlated displacements,
 * not a small number of big sharp corners. This algorithm produces
 * paths that read as photographic.
 *
 * Algorithm:
 *   1. Sample many random positions along the source→dest line.
 *   2. Sort them.
 *   3. Displace each perpendicular to the line by a random amount.
 *   4. Smooth: pull each displacement toward the previous one
 *      (proportional to how close adjacent positions are).
 *   5. Envelope: clamp displacement near the endpoint so the bolt
 *      lands cleanly on its target.
 *
 * Branches use the same algorithm rooted at a random midpoint of
 * the main bolt, fired off at a small angle from the local trunk
 * direction, with a fraction of the trunk's length.
 */

type Pt = [number, number];

/** mulberry32: small fast deterministic PRNG. Same seed → same bolt. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface BoltResult {
  path: string;
  points: Pt[];
}

function generateBolt(
  source: Pt,
  dest: Pt,
  sway: number,
  rng: () => number,
  density = 4,
): BoltResult {
  const tx = dest[0] - source[0];
  const ty = dest[1] - source[1];
  const length = Math.hypot(tx, ty);
  if (length === 0) {
    return { path: `M ${source[0]} ${source[1]}`, points: [source] };
  }

  // Perpendicular unit normal.
  const nx = ty / length;
  const ny = -tx / length;

  const samples = Math.max(8, Math.floor(length / density));
  const positions: number[] = [0];
  for (let i = 0; i < samples; i++) positions.push(rng());
  positions.sort((a, b) => a - b);

  const jaggedness = 1 / sway;

  let prevDisp = 0;
  const points: Pt[] = [source];

  for (let i = 1; i < positions.length; i++) {
    const pos = positions[i];
    // scale prevents sharp angles between very-close positions.
    const scale = length * jaggedness * (pos - positions[i - 1]);
    // envelope tapers displacement near the endpoint.
    const envelope = pos > 0.95 ? 20 * (1 - pos) : 1;

    let disp = (rng() * 2 - 1) * sway;
    disp -= (disp - prevDisp) * (1 - scale);
    disp *= envelope;

    points.push([
      source[0] + pos * tx + disp * nx,
      source[1] + pos * ty + disp * ny,
    ]);
    prevDisp = disp;
  }

  points.push(dest);

  const path =
    'M ' +
    points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ');

  return { path, points };
}

function generateBranches(
  mainPoints: Pt[],
  count: number,
  rng: () => number,
  sway = 30,
): string[] {
  const branches: string[] = [];
  const minIdx = Math.floor(mainPoints.length * 0.15);
  const maxIdx = Math.floor(mainPoints.length * 0.85);

  for (let i = 0; i < count; i++) {
    const idx =
      minIdx + Math.floor(rng() * Math.max(1, maxIdx - minIdx));
    const origin = mainPoints[idx];

    // Local trunk direction (a few points ahead).
    const next = mainPoints[Math.min(idx + 4, mainPoints.length - 1)];
    const dx = next[0] - origin[0];
    const dy = next[1] - origin[1];
    const mag = Math.hypot(dx, dy) || 1;
    const ux = dx / mag;
    const uy = dy / mag;

    // Rotate trunk direction by ±20–55° to fork outward.
    const sign = rng() < 0.5 ? -1 : 1;
    const angle = sign * (0.35 + rng() * 0.6);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const rx = ux * c - uy * s;
    const ry = ux * s + uy * c;

    const branchLen = 90 + rng() * 220;
    const dest: Pt = [
      origin[0] + rx * branchLen,
      origin[1] + ry * branchLen,
    ];

    const { path } = generateBolt(origin, dest, sway, rng, 5);
    branches.push(path);
  }

  return branches;
}

export interface Lightning {
  mainPath: string;
  branches: string[];
}

/**
 * Generate one full lightning strike — main bolt + branches.
 * Seed is fixed by default so the bolt is stable across renders;
 * pass a different seed to roll a new shape.
 */
export function generateLightning(
  seed = 7,
  source: Pt = [900, -40],
  dest: Pt = [680, 1040],
): Lightning {
  const rng = mulberry32(seed);
  const main = generateBolt(source, dest, 110, rng, 4);
  const branches = generateBranches(main.points, 7, rng, 32);
  return { mainPath: main.path, branches };
}
