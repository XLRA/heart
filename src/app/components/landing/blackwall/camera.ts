/* ──────────────────────────────────────────────────────────────
   Camera — a low viewpoint in front of the thread curtain.

   World: the curtain stands in the plane z = 0, from the floor
   (y = 0) to its top (y = 1). The floor is the plane y = 0 and
   runs from the foot of the curtain toward the camera.

   The camera never pitches. Threads must stay perfectly vertical
   on screen, so instead of tilting up at the wall the projection
   is shifted vertically (a lens shift). The shift is recomputed
   every frame so the wall's foot always lands on the same screen
   row whatever the camera height — pointer parallax then changes
   the floor's perspective and slides the depth layers against each
   other, while the wall itself stays locked in frame:

       20% black   ·   wall ≈ 51% of the height   ·   floor ≈ 29%

   Everything is pre-allocated, and no fractional value crosses a
   call as an argument — inputs and outputs live in the `f` block.
   ────────────────────────────────────────────────────────────── */

// Slots in Camera.f.
/** Inputs to updateCamera. */
export const C_ASPECT = 0;
export const C_PAR_X = 1; // smoothed pointer parallax, -1..1
export const C_PAR_Y = 2;
export const C_TIME = 3; // smooth clock (s), for micro-drift
export const C_ZOOM = 13; // 0..1: how far the camera has leaned in on an idle visitor
/** Derived by updateCamera. */
export const C_TAN_HALF = 4; // tan(fovY / 2)
export const C_V = 5; // view half-height at the wall plane (world units)
export const C_SHIFT_Y = 6; // vertical lens shift, in NDC
export const C_PORTRAIT = 7; // 0 = landscape framing, 1 = full portrait
/** unprojectToWall: NDC in, world (x, y) on the wall plane out. */
export const C_NDC_X = 8;
export const C_NDC_Y = 9;
export const C_OUT_X = 10;
export const C_OUT_Y = 11;
const C_TMP = 12;
const C_COUNT = 14;

/** The wall is 1 world unit tall and fills this share of the viewport height. */
const WALL_SHARE = 0.51;
/** Screen row (NDC) of the wall's foot: 29% of the height is floor. */
const FOOT_NDC = -0.42;
/** View half-height at the wall plane. */
const V = 1 / (2 * WALL_SHARE);

export interface Camera {
  pos: Float32Array;
  right: Float32Array;
  up: Float32Array;
  fwd: Float32Array;
  view: Float32Array;
  proj: Float32Array;
  viewProj: Float32Array;
  f: Float64Array;
}

export function createCamera(): Camera {
  const f = new Float64Array(C_COUNT);
  f[C_ASPECT] = 1.78;
  f[C_TAN_HALF] = 0.4;
  f[C_V] = V;
  const up = new Float32Array(3);
  up[1] = 1;
  return {
    pos: new Float32Array(3),
    right: new Float32Array(3),
    up,
    fwd: new Float32Array(3),
    view: new Float32Array(16),
    proj: new Float32Array(16),
    viewProj: new Float32Array(16),
    f,
  };
}

/** Recompute the camera from f[C_ASPECT..C_TIME]. */
export function updateCamera(c: Camera): void {
  const f = c.f;
  const aspect = f[C_ASPECT];
  const t = f[C_TIME];

  // portrait = 1 - smoothstep(0.6, 1.25, aspect)
  f[C_TMP] = (aspect - 0.6) / 0.65;
  if (f[C_TMP] < 0) f[C_TMP] = 0;
  else if (f[C_TMP] > 1) f[C_TMP] = 1;
  const s = f[C_TMP];
  const portrait = 1 - s * s * (3 - 2 * s);

  // A wider lens up close in portrait: the same wall share, but a
  // deeper-feeling floor and stronger parallax on a narrow screen.
  const tanHalf = 0.40 + 0.08 * portrait;
  // Idle creep: the view half-height at the wall shrinks by up to
  // 2.8%, and the camera dollies in to match. The wall's foot stays
  // on its row, so the wall seems to lean closer.
  const Vz = V / (1 + 0.028 * f[C_ZOOM]);
  const dist = Vz / tanHalf;
  f[C_PORTRAIT] = portrait;
  f[C_V] = Vz;
  f[C_TAN_HALF] = tanHalf;

  // Micro-drift: two non-harmonic sines per axis, never settling.
  const driftX = Math.sin(t * 0.13) * 0.035 + Math.sin(t * 0.31 + 1.0) * 0.014;
  const driftY = Math.sin(t * 0.17 + 2.0) * 0.012 + Math.sin(t * 0.41) * 0.005;

  const px = f[C_PAR_X] * 0.3 + driftX;
  const py = 0.15 + f[C_PAR_Y] * 0.05 + driftY;
  const pz = dist;
  c.pos[0] = px;
  c.pos[1] = py;
  c.pos[2] = pz;

  // Keep the wall's foot on a fixed screen row.
  const shift = FOOT_NDC + py / Vz;
  f[C_SHIFT_Y] = shift;

  // Yaw only — look slightly back toward the wall centre as the
  // camera slides, so depth layers shear against each other.
  let fx = px * 0.45 - px;
  let fz = -pz;
  const fl = 1 / Math.sqrt(fx * fx + fz * fz);
  fx *= fl;
  fz *= fl;
  // right = fwd × up(0,1,0)
  const rx = -fz;
  const rz = fx;

  c.fwd[0] = fx;
  c.fwd[1] = 0;
  c.fwd[2] = fz;
  c.right[0] = rx;
  c.right[1] = 0;
  c.right[2] = rz;

  const v = c.view;
  v[0] = rx;
  v[1] = 0;
  v[2] = -fx;
  v[3] = 0;
  v[4] = 0;
  v[5] = 1;
  v[6] = 0;
  v[7] = 0;
  v[8] = rz;
  v[9] = 0;
  v[10] = -fz;
  v[11] = 0;
  v[12] = -(rx * px + rz * pz);
  v[13] = -py;
  v[14] = fx * px + fz * pz;
  v[15] = 1;

  const near = 0.05;
  const far = dist + 8;
  const p = c.proj;
  const k = 1 / tanHalf;
  p[0] = k / aspect;
  p[1] = 0;
  p[2] = 0;
  p[3] = 0;
  p[4] = 0;
  p[5] = k;
  p[6] = 0;
  p[7] = 0;
  p[8] = 0;
  p[9] = -shift; // lens shift: ndc.y = k·y/depth + shift
  p[10] = (far + near) / (near - far);
  p[11] = -1;
  p[12] = 0;
  p[13] = 0;
  p[14] = (2 * far * near) / (near - far);
  p[15] = 0;

  // viewProj = proj × view (column-major).
  const o = c.viewProj;
  for (let col = 0; col < 4; col++) {
    const b0 = v[col * 4];
    const b1 = v[col * 4 + 1];
    const b2 = v[col * 4 + 2];
    const b3 = v[col * 4 + 3];
    o[col * 4] = p[0] * b0 + p[4] * b1 + p[8] * b2 + p[12] * b3;
    o[col * 4 + 1] = p[1] * b0 + p[5] * b1 + p[9] * b2 + p[13] * b3;
    o[col * 4 + 2] = p[2] * b0 + p[6] * b1 + p[10] * b2 + p[14] * b3;
    o[col * 4 + 3] = p[3] * b0 + p[7] * b1 + p[11] * b2 + p[15] * b3;
  }
}

/**
 * Intersect the view ray through f[C_NDC_X], f[C_NDC_Y] with the
 * wall plane (z = 0) and write world (x, y) to f[C_OUT_X], f[C_OUT_Y].
 */
export function unprojectToWall(c: Camera): void {
  const f = c.f;
  const sx = f[C_NDC_X] * f[C_TAN_HALF] * f[C_ASPECT];
  const sy = (f[C_NDC_Y] - f[C_SHIFT_Y]) * f[C_TAN_HALF];
  const dx = c.fwd[0] + c.right[0] * sx;
  const dz = c.fwd[2] + c.right[2] * sx;
  const t = -c.pos[2] / dz;
  f[C_OUT_X] = c.pos[0] + dx * t;
  f[C_OUT_Y] = c.pos[1] + sy * t;
}
