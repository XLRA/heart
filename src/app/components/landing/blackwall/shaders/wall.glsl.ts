/* ──────────────────────────────────────────────────────────────
   The wall and the floor.

   WALL_FS — the thread curtain.
   The wall is a sheet of hairline vertical threads carrying a slow,
   marbled image, like a corrupted picture shown on a mesh of
   filaments. It is ray-cast per pixel onto three thread strata at
   different depths.

   About a third of the FRONT stratum is cut away into true-black
   cavities; the rest is shaded continuously, from brooding deep
   crimson up to blazing crests. The two strata behind it are dim
   (never above ~0.28) and lower in frequency, so a cavity opens
   onto ghostly folds receding into depth rather than a flat hole.

   For each stratum:
     • X is quantised into threads. The marbled field is sampled at
       the THREAD'S centre, so the picture is constant across a
       thread and breaks cleanly at each black gap.
     • Every thread reads the picture at its own vertical offset,
       so no edge in it can cross the threads cleanly: cavity rims
       and the hotspot's outline tear into staggered vertical tips.
     • In "sort zones" a thread also holds the picture from one
       height and drags it down its length — the pixel-sorted drip.
     • A fainter horizontal bead pattern breaks threads into
       micro-dashes (the mesh look), and every thread has its own
       feathered tip, brightness and, toward the flanks, a rising
       chance of simply not being there.

   The composition is anchored so it survives any random seed:
   ghostly arches at the far left, a tall saturated sheet left of
   centre, a dark cleft, and right of centre the hotspot — the same
   curtain driven to saturation, with a woven wake of orange-white
   filaments running across its threads. The anchors do not ADD to
   the marbled field; they remap its range into the lit side of the
   cut, so they are always present and still carry its folds.

   Channels written:  R energy   G heat (filaments)   B violet

   FLOOR_FS — the stippled floor.
   Copies the wall through, and below the wall's foot draws a
   perspective dust of fine dots on the ground plane. Each dot
   takes its light from the wall texture at the point a mirror
   reflection would hit (blurred through the mip chain and scattered
   by roughness), so every pulse and flare on the wall moves on the
   floor with it — it is the same light, not a second simulation.
   ────────────────────────────────────────────────────────────── */

import { HEADER, COMMON } from './common.glsl';

/* Shared between the marble pre-pass and the wall: the wall-space
   rectangle the marble texture covers. X spans a little more than
   the visible wall (it follows the camera); Y spans the wall plus
   room for sort slips. */
const MARBLE_SPACE = /* glsl */ `
const float MARBLE_Y0 = -0.16;
const float MARBLE_YH = 1.44;
float marbleSpan(){ return max(abs(uXL), abs(uXR)) * 1.3 + 0.6; }
// The raw field hovers around 0.5 and only a narrow band of it
// matters, so it is stored contrast-stretched to survive 8 bits.
float encField(float v){ return clamp((v - 0.5) * 3.0 + 0.5, 0.0, 1.0); }
`;

/* MARBLE_FS — the ink-marbled field, once per frame, small.

   The picture on the threads is low-frequency (its voids are a
   tenth to a quarter of the viewport wide), so it does not need to
   be evaluated per screen pixel. This pass writes the warped field
   for all three strata into one small wall-space texture; the wall
   pass then cuts its hard-edged cavities by THRESHOLDING a bilinear
   lookup — the edge stays razor sharp at any size, and the wall's
   per-pixel cost drops from ~35 noise evaluations to three fetches.

     R  front field      G  front brightness
     B  middle field     A  back field                            */
export const MARBLE_FS = `${HEADER}${COMMON}${MARBLE_SPACE}
in vec2 vUv;
out vec4 o;

float field(vec2 p, float t, float detail, out float bright){
  vec3 q = vec3(p, t * 0.030) + uSeed;
  vec2 w1 = vec2(fbmN(q + vec3(1.7, 9.2, 0.0), 2),
                 fbmN(q + vec3(8.3, 2.8, 4.1), 2)) - 0.5;
  vec2 w2 = vec2(0.0);
  if (detail > 0.5) {
    vec3 q2 = vec3(p + 2.4 * w1, t * 0.045) + uSeed.yzx;
    w2 = vec2(fbmN(q2 + vec3(3.1, 5.7, 1.0), 2),
              fbmN(q2 + vec3(6.6, 1.3, 2.0), 2)) - 0.5;
  }
  float v = fbmN(vec3(p + 2.4 * w1 + 1.8 * w2, t * 0.040) + uSeed.zxy, 3);
  bright = smoothstep(0.50, 0.66, v + 0.30 * w1.y + 0.15 * w2.x);
  return v;
}

void main(){
  float x = (vUv.x * 2.0 - 1.0) * marbleSpan();
  float y = MARBLE_Y0 + vUv.y * MARBLE_YH;
  float t = uTime * 0.45;   // glacial at rest (must match the bead curtain)
  float bright;
  float unused;
  // Voids a tenth to a quarter of the viewport wide in front; the
  // strata behind are lower in frequency still.
  vec2 pf = vec2(x * 1.30 * uMarbleK, y * 1.45);
  float vf = field(pf, t, 1.0, bright);
  float vb = field(pf * 0.72 + vec2(3.7, 1.9), t, 0.0, unused);
  float vc = field(pf * 0.72 + vec2(7.4, 3.8), t, 0.0, unused);
  o = vec4(encField(vf), bright, encField(vb), encField(vc));
}
`;

/* Shared by the deep strata (WALL_FS) and the front bead curtain
   (curtain.glsl.ts): how a thread reads and shades the picture. */
export const WALL_SHARED = /* glsl */ `${MARBLE_SPACE}
uniform sampler2D uMarble;

// Read the marbled field for thread (xc, ys), in the stored
// contrast-stretched units (0.5 is the field's mean), plus a bias
// the composition adds before the cut.
float marbleField(float xc, float ys, float li, float bias){
  vec2 uv = vec2(xc / marbleSpan() * 0.5 + 0.5, (ys - MARBLE_Y0) / MARBLE_YH);
  vec4 s = texture(uMarble, uv);
  return (li < 0.5 ? s.r : (li < 1.5 ? s.b : s.a)) + bias;
}

// Continuous shading of the field: black below lo, then a real
// tonal range — brooding deep crimson, arterial folds, blazing
// crests — instead of a flat poster cutout. x: energy, y: lit mask.
vec2 shade(float v, float lo, float hi){
  float s = smoothstep(lo, hi, v);
  float lit = smoothstep(0.0, 0.05, s);
  return vec2(lit * (0.10 + 0.90 * pow(s, 1.25)), lit);
}
`;

/* WALL_FS — the two deep strata, ray-cast. They are the taut wall
   that stays put behind the front curtain when it heaves. (The
   `front` branches in stratum() are inert here; the front stratum
   is drawn as beads by curtain.glsl.ts.) */
export const WALL_FS = `${HEADER}${COMMON}${WALL_SHARED}
in vec2 vUv;
out vec4 o;

// Something behind the wall. A towering shape standing deep in the
// strata (z = -0.62): two or three staggered slabs, each top cut at
// its own oblique angle, split by hairline fractures. Nothing in it
// is a face or a figure. x = its body, y = its rims and fractures;
// the caller holds both barely above black.
vec2 silhouette(vec3 ro, vec3 rd){
  float a = abs(uSil.w);
  if (a < 0.004) return vec2(0.0);
  vec3 p = ro + rd * ((-0.62 - ro.z) / rd.z);
  float u = (p.x - uSil.x) / uSil.y;
  if (abs(u) > 1.0 || p.y < 0.0) return vec2(0.0);
  float sd = uSilSeed;
  // Where one slab ends and the next begins.
  float e1 = -0.42 + 0.30 * hash11(sd * 3.1);
  float e2 = 0.18 + 0.34 * hash11(sd * 5.7);
  float si = step(e1, u) + step(e2, u);
  // (About one in three has only two slabs.)
  float present = mix(1.0, step(0.35, hash11(sd * 9.3)), step(1.5, si));
  float cx = si < 0.5 ? 0.5 * (e1 - 1.0) : (si < 1.5 ? 0.5 * (e1 + e2) : 0.5 * (e2 + 1.0));
  float lx = (u - cx) * uSil.y;
  float topY = uSil.z * (0.60 + 0.40 * hash11(sd * 7.7 + si * 5.3))
             + (hash11(sd * 2.3 + si * 3.9) - 0.5) * 0.9 * lx;
  // It is built of the same broken thread data as everything else:
  // its top is ragged thread by thread, and its sides are not ruled
  // lines but thin out over a few columns.
  float col = floor(p.x / uPitch + 0.37);
  topY += (hash11(col * 1.7 + sd) - 0.5) * 2.0 * mix(0.018, 0.028, hash11(col * 0.31 + sd * 3.0));
  float px = uPxWorld * (ro.z + 0.62) / ro.z * 1.4;
  float edge = min(min(abs(u - e1), abs(u - e2)), 1.0 - abs(u)) * uSil.y;
  float inside = step(p.y, topY) * present * smoothstep(0.0, uPitch * 4.0, edge - 0.012)
               * step(hash11(col * 2.9 + sd * 1.3), 0.35 + 0.65 * smoothstep(0.0, uPitch * 5.0, edge - 0.012));
  // Two fractures cross each slab obliquely.
  float f1 = abs(p.y - topY * (0.30 + 0.25 * hash11(sd * 4.1 + si)) - (hash11(sd * 6.3 + si * 2.0) - 0.5) * 2.2 * lx);
  float f2 = abs(p.y - topY * (0.62 + 0.20 * hash11(sd * 8.9 + si)) + (hash11(sd * 1.7 + si * 4.0) - 0.5) * 1.6 * lx);
  float crack = 1.0 - smoothstep(0.0, px, min(f1, f2));
  float rim = 1.0 - smoothstep(0.0, px, topY - p.y);
  // It stands among the deep threads, and is quantised by them.
  float th = 0.62 + 0.38 * step(0.42, fract(p.x / uPitch + 0.37));
  return vec2(inside, inside * max(crack, rim)) * a * th;
}

// One thread stratum. rgb = (energy, heat, violet), a = occlusion.
vec4 stratum(vec3 ro, vec3 rd, float zs, float li, float xn){
  float t = uTime * 0.45;   // glacial at rest (must match the bead curtain)
  float tt = (zs - ro.z) / rd.z;
  vec3 p = ro + rd * tt;

  // Pressure bows the sheet toward the camera: one refinement step
  // of the ray against the displaced plane.
  vec4 fp = fieldAt(p.x);
  float P = pulse(p.x, t);
  float bow = sin(3.14159 * clamp(p.y, 0.0, 1.0));
  float zb = zs + (P - 0.5) * 0.03 * bow * (1.0 - 0.3 * li);
  tt = (zb - ro.z) / rd.z;
  p = ro + rd * tt;
  if (p.y <= 0.0 || p.y > 1.12) return vec4(0.0);

  // ── Thread identity ──────────────────────────────────────
  float u = p.x / uPitch + li * 0.37;
  float ti = floor(u);
  float fx = fract(u);
  float xc = (ti + 0.5 - li * 0.37) * uPitch;
  float h1 = hash11(ti * 1.31 + li * 17.0 + uSeed.x);
  float h2 = hash11(ti * 2.17 + li * 29.0 + uSeed.y);
  float h3 = hash11(ti * 3.71 + li * 41.0 + uSeed.z);
  float bundle = floor(ti / 9.0);
  float hb = hash11(bundle * 1.9 + li * 7.0 + uSeed.y);
  // The pressure field is read at a per-thread, per-bundle offset,
  // so a flare's sides are ragged threads, not a rectangular column.
  vec4 f = fieldAt(xc + (h1 - 0.5) * 0.12 + (hb - 0.5) * 0.16);
  float g = max(f.g, 0.0);
  bool front = li < 0.5;

  // ── Composition envelope (screen-anchored, slowly breathing) ──
  float cleftC = -0.05 + 0.035 * sin(t * 0.045 + 1.0);
  float cleftW = 0.040 + 0.026 * vnoise3(vec3(p.y * 2.2, t * 0.06, 7.0));
  float cdx = (xn - cleftC + 0.07 * (vnoise3(vec3(p.y * 1.7, t * 0.05, 2.0)) - 0.5)) / cleftW;
  float cleft = exp(-cdx * cdx);
  // A tall saturated sheet standing just left of the cleft, drifting.
  float sheets = exp(-pow2((xn + 0.19 + 0.02 * sin(t * 0.05)) / 0.13));
  // The far-left third: where the dark arches are carved.
  float leftArch = 1.0 - smoothstep(-0.62, -0.34, xn);
  float side = smoothstep(0.62, 0.98, abs(xn));
  // The hotspot is not a shape. It is a broad, soft region right of
  // centre where the SAME curtain is driven to saturation, so its
  // outline is whatever the marbling and the torn threads make it.
  vec2 hcen = vec2(0.44 + 0.03 * sin(t * 0.06), 0.52 + 0.03 * sin(t * 0.083 + 2.0));
  float hotW = front ? exp(-(pow2((xn - hcen.x) / 0.25) + pow2((p.y - hcen.y) / 0.36))) : 0.0;
  // A fold of negative space kept strictly under its lower-right
  // flank, where it frames the hotspot's base without touching the
  // streaks above.
  float pocket = exp(-(pow2((xn - hcen.x - 0.07) / 0.15) + pow2((p.y - 0.10) / 0.13)));

  // ── Vertical tear and smear along the thread ─────────────
  // Every thread reads the picture at its own height, so no edge
  // in the picture can cross the threads cleanly: cavity rims,
  // fold crests and the hotspot's outline all break into staggered
  // vertical tips. Three scales: a per-thread hash, a stepped
  // offset shared by small bundles, and stronger shear in bands.
  float sz = vnoise3(vec3(xc * 0.9 + li * 5.0, t * 0.04, 1.0) + uSeed);
  float zone = smoothstep(0.50, 0.78, sz);
  float tear = (h1 - 0.5) * 0.09
             + (hb - 0.5) * 0.10
             + (h2 - 0.5) * 0.24 * zone
             + (h2 - 0.5) * 0.18 * exp(-pow2((xn - hcen.x - 0.24) / 0.08));
  // In "sort zones" a thread also HOLDS the picture from one
  // height and drags it down its length — the pixel-sorted drip.
  float st = clamp(0.70 * zone + 0.75 * sheets + 0.5 * f.b, 0.0, 0.9);
  float holdY = 0.35 + 0.6 * h2;
  float held = step(h3, st) * step(p.y, holdY);
  float ys = mix(p.y, holdY - (holdY - p.y) * 0.06, held);
  // Stepped-clock sort slips: small groups of threads jump vertically.
  float grp = floor(ti / 6.0);
  float slipSel = hash21(vec2(grp + li * 9.0, floor(uTick / 3.0)));
  float slipOn = step(0.95 - 0.45 * clamp(f.b + g, 0.0, 1.0), slipSel);
  float slip = (hash21(vec2(grp, uTick)) - 0.5) * 0.22 * slipOn * uShear;
  ys += tear + slip;

  // ── The picture ──────────────────────────────────────────
  // Composition pushes the field before it is cut: more of it lit
  // in the hotspot and along the foot (threads stay anchored to the
  // floor across the middle of the span), less in the pocket.
  float grounded = (1.0 - smoothstep(0.0, 0.16, p.y))
                 * (1.0 - smoothstep(0.46, 0.62, abs(xn - 0.07)));
  float v = marbleField(xc, ys, li, 0.0);
  if (front) {
    // The page draws a new seed on every load, and an additive push
    // cannot outvote an unlucky field. So the composition's anchors
    // REMAP the field instead: inside each, the field's whole range
    // is squeezed into the lit side of the cut. The anchor is then
    // lit on every seed, and still carries the field's own folds.
    // Their weights are warped at low frequency so the outlines
    // stay ragged rather than tracing a Gaussian.
    float wob = vnoise3(vec3(xn * 2.3, p.y * 1.9, t * 0.05) + uSeed.zxy);
    float wob2 = vnoise3(vec3(xn * 6.1, p.y * 5.0, t * 0.07) + uSeed);
    // The hotspot's weight is measured at the thread's TORN height,
    // so its outline breaks into staggered tips like every other edge.
    float hotT = exp(-(pow2((xn - hcen.x) / 0.25) + pow2((ys - hcen.y) / 0.36)));
    float wHot = smoothstep(0.30, 0.56, hotT * (0.40 + 0.85 * wob + 0.35 * wob2));
    float wSheet = smoothstep(0.35, 0.75, sheets * (0.75 + 0.50 * wob));
    v = mix(v, 0.62 + 0.37 * v, wHot);
    v = mix(v, 0.57 + 0.38 * v, wSheet);
    v = mix(v, 0.56 + 0.36 * v, grounded * 0.85);
    // And the pocket squeezes it the other way, into black.
    float wPocket = pocket * (1.0 - smoothstep(0.24, 0.34, p.y))
                  * (0.45 + 1.1 * vnoise3(vec3(xn * 7.0, p.y * 6.0, t * 0.05) + uSeed));
    v = mix(v, 0.42 * v, clamp(wPocket * 1.3, 0.0, 1.0));
  }
  // About a third of the front stratum is true black; the strata
  // behind are mostly black with sparse dim folds. On the far left
  // the cut bites harder and the rise is steeper, so that flank is
  // sweeping dark arches between bright ribs, not an even wash.
  vec2 sh = front ? shade(v, 0.515 + 0.02 * leftArch, 0.96 - 0.13 * leftArch)
                  : shade(v, 0.52, 0.82);
  float e = sh.x;
  float lit = sh.y;
  // Inside the hotspot a steeper gain: its folds climb to full.
  float hot = hotW * hotW * lit;
  e = mix(e, smoothstep(0.10, 0.46, e) * 1.15, clamp(hotW * 1.25, 0.0, 1.0));

  // Exposure: blacks stay pinned at zero, the crests are electric.
  float env = (1.10 + 0.14 * sheets) * (1.0 - 0.95 * cleft) * mix(1.0, 0.62, side);
  e = min(e * env, 1.25);

  // ── Thread tips, foot, flanks ────────────────────────────
  // A gentle arch: fullest across the middle, tapering toward the
  // flanks, each thread dissolving over its own feathered length.
  float arch = 0.14 * smoothstep(0.42, 1.0, abs(xn - 0.08));
  float top = 1.0 - arch - 0.02 * vnoise3(vec3(xc * 0.9, 5.0, t * 0.03)) - 0.035 * h2 * h2 - 0.015 * li;
  float tipLen = 0.02 + 0.03 * h1;
  float ends = (1.0 - smoothstep(top - tipLen, top, p.y)) * smoothstep(0.0, 0.02, p.y);
  float flank = 1.0 - smoothstep(0.80, 1.02, abs(xn));
  float alive = ends * flank * step(h1, 0.18 + 0.82 * flank * flank) * mix(0.22, 1.0, step(0.07, h3));

  // A ghostly canopy: dim threads hold the arched top edge across
  // the cleft and every cavity, so it always reads as one wall.
  float canopy = 0.0;
  if (front) {
    canopy = smoothstep(top - 0.20, top - 0.03, p.y) * (0.12 + 0.16 * h3);
    e = max(e, canopy);
    lit = max(lit, step(0.01, canopy) * 0.6);
  }

  // A flare lifts the sheet, but unevenly: turbulent stretched noise
  // and, on the stepped clock, bands of threads that drop out — so
  // its interior tears instead of clipping to a flat slab.
  float gz = clamp(g, 0.0, 1.0) * 0.35;
  float churn = 0.55 + 0.45 * vnoise3(vec3(p.x * 3.0, p.y * 42.0, t * 0.7) + uSeed);
  float drop = step(0.72, hash21(vec2(floor(p.y * 46.0) + bundle * 3.0, uTick)));
  e *= (0.76 + 0.40 * h3) * (0.70 + 0.46 * P) * (1.0 + 0.2 * g + 0.5 * f.a) * alive;
  e *= mix(1.0, churn * (1.0 - 0.28 * drop), gz);
  // Never past full: the black gaps between threads survive a flare.
  e = min(e, 1.0);

  // ── Thread profile and bead mesh ─────────────────────────
  float pitchPx = uPitch / (uPxWorld * (ro.z - zb) / ro.z);
  float dpx = abs(fx - 0.5) * pitchPx;
  float c = mix(0.08, 1.0, clamp(1.30 - dpx, 0.0, 1.0));
  float bead = 1.0 - 0.24 * (0.5 + 0.5 * cos(6.28318 * (p.y / uPitch) + h1 * 6.28318));
  float threadMask = c * bead;

  // ── Heat: a woven wake of filaments inside the hotspot ───
  float heat = 0.0;
  if (front) {
    // Two octaves of strongly stretched, gently curved fBm (about
    // 18:1 and 36:1): dozens of fine filaments sweeping together.
    float wy = p.y + 0.014 * sin(p.x * 5.0 + t * 0.4)
             + 0.035 * (vnoise3(vec3(p.x * 1.8, p.y * 1.5, t * 0.12)) - 0.5);
    float n1 = fbmN(vec3(p.x * 3.3 - t * 0.22, wy * 60.0, t * 0.35) + uSeed, 2);
    float n2 = fbmN(vec3(p.x * 2.6 + t * 0.15, wy * 94.0, t * 0.5) + uSeed.yzx, 2);
    float n = 0.58 * n1 + 0.42 * n2;
    // The brush sweeps the hotspot's centre-right, a wide woven band.
    float brush = exp(-(pow2((xn - hcen.x - 0.02) / 0.21) + pow2((p.y - hcen.y - 0.03) / 0.15)));
    float fil = smoothstep(0.45 - 0.07 * brush, 0.60, n);
    float wisp = smoothstep(0.545, 0.64, n) * brush;
    // Irregular flare surges on top of a steady simmer.
    float surge = 0.80 + 0.50 * pow2(vnoise3(vec3(t * 0.45, 9.1, 3.3)));
    // A few wisps trail past the hotspot's right shoulder into the dark.
    float tail = exp(-(pow2((xn - hcen.x - 0.27) / 0.10) + pow2((p.y - hcen.y - 0.03) / 0.10)));
    float idle = surge * (hot * brush * (0.80 * fil + 0.95 * wisp) + 0.55 * tail * wisp);
    // A click flare heats its own band, capped well below a whiteout.
    float fz = clamp(g, 0.0, 1.4) * exp(-pow2((p.y - 0.5) / 0.33));
    float flare = fz * (0.34 * fil + 0.50 * smoothstep(0.545, 0.64, n) + 0.08 * smoothstep(0.42, 0.60, n));
    // The filaments ride ACROSS the threads, they do not cover them.
    heat = clamp(idle + flare, 0.0, 1.0) * mix(1.0, threadMask, 0.70) * flank * ends;
  }

  float E = e * threadMask;
  E = max(E, heat * 0.9);

  // ── Violet: thread-quantised, never a haze ───────────────
  // Two homes. Inside the cleft, which is otherwise pitch black:
  // broken pale filaments that appear only where the fold behind
  // and a vertical noise both allow, never a continuous stripe.
  // And, low on the wall either side of centre, threads whose red
  // sits in the mid-shadow band (about 0.15–0.38) where a lit fold
  // rolls off into a cavity.
  float violet = 0.0;
  if (front) {
    float midShadow = smoothstep(0.10, 0.18, e) * (1.0 - smoothstep(0.34, 0.46, e));
    float lowY = 1.0 - smoothstep(0.30, 0.66, p.y);
    float zones = lowY * (exp(-pow2((xn + 0.21) / 0.11)) + exp(-pow2((xn - 0.38) / 0.16)));
    float fold = smoothstep(0.47, 0.60, marbleField(xc, ys, 1.0, 0.0));
    float broken = smoothstep(0.52, 0.70,
                     vnoise3(vec3(ti * 0.17, p.y * 7.0 + h2 * 9.0, t * 0.15) + uSeed));
    float filament = cleft * step(0.58, h3) * fold * broken * 0.46;
    violet = (midShadow * clamp(zones, 0.0, 1.0) * 0.55 + filament) * threadMask * alive;
  }

  return vec4(E, heat, violet, clamp(lit * c * 0.92, 0.0, 1.0));
}

void main(){
  vec2 ndc = vUv * 2.0 - 1.0;
  // Nothing of the wall exists above its tips or below its foot.
  // (Alpha carries the front curtain's displacement tint; it is zero here.)
  if (ndc.y > 0.72 || ndc.y < -0.46) { o = vec4(0.0); return; }
  vec3 ro = uCamPos;
  vec3 rd = viewRay(ndc);

  vec4 b = stratum(ro, rd, -0.16, 1.0, ndc.x);
  vec4 c = stratum(ro, rd, -0.40, 2.0, ndc.x);

  // The deep strata are lifted on the left third, where tall ghostly
  // ribs should rise the full height behind the dark arches.
  float leftLift = 1.0 + 0.35 * (1.0 - smoothstep(-0.62, -0.30, ndc.x));
  float back = (b.r * 0.22 + (1.0 - b.a) * c.r * 0.12) * leftLift;
  // While the front curtain heaves, the strata behind it burn a
  // little brighter: straight taut lines seen through the veils.
  back *= 1.0 + 0.18 * clamp(fieldAt(mix(uXL, uXR, vUv.x)).r, 0.0, 1.0);
  // Before a surge a cool glow swells BEHIND the threads.
  float cool = uCharge * (b.r * 0.55 + c.r * 0.35);
  // Whatever is passing behind: a bruised arterial shadow, or a cold
  // slate, at a tenth of full light and a little more on its rims.
  // The curtain is drawn over it, so it shows mostly in the cavities.
  vec2 sil = silhouette(ro, rd);
  float silE = sil.x * 0.085 + sil.y * 0.035;
  back += silE * step(0.0, uSil.w);
  cool += silE * 1.25 * step(uSil.w, 0.0);
  o = vec4(clamp(back, 0.0, 1.0), 0.0, clamp(cool, 0.0, 1.0), 0.0);
}
`;

export const FLOOR_FS = `${HEADER}${COMMON}
in vec2 vUv;
out vec4 o;

uniform sampler2D uWall;

// Wall-texture UV of the mirror reflection seen at floor point (x, z).
vec3 reflectUv(vec3 ro, vec2 fxz, vec2 scatter){
  vec3 M = vec3(ro.x, -ro.y, ro.z);          // camera mirrored in the floor
  float s = M.z / (M.z - fxz.y);
  vec2 H = M.xy + (vec2(fxz.x, 0.0) - M.xy) * s;   // hit on the wall plane
  H += scatter;
  vec4 clip = uViewProj * vec4(H, 0.0, 1.0);
  return vec3(clip.xy / clip.w * 0.5 + 0.5, H.y);
}

// One octave of floor dust: a jittered lattice of ~1px dots, each
// lit by its own scattered reflection of the wall. rgb = light,
// already multiplied by dot coverage.
vec3 dust(vec3 ro, vec2 wp, vec2 cs, float pxd, float fore, float oct){
  vec2 cell = floor(wp / cs);
  vec2 hj = hash22(cell + uSeed.xy + oct * 19.0);
  vec2 cpos = (cell + 0.5 + (hj - 0.5) * 0.76) * cs;
  vec2 dpx = vec2(wp.x - cpos.x, (wp.y - cpos.y) * fore) / pxd;
  float hr = hash21(cell * 1.7 + 3.1 + oct);
  // A round dot of 0.7–1.1 px radius in SCREEN pixels — never stretched.
  float dotc = clamp(mix(0.7, 1.1, hr) + 0.5 - length(dpx), 0.0, 1.0);

  vec2 hs = hash22(cell + 7.3 + oct * 5.0);
  vec2 scatter = vec2((hs.y - 0.5) * 0.12 * cpos.y, (hs.x - 0.5) * 0.34 * (0.25 + cpos.y));
  vec3 ruv = reflectUv(ro, cpos, scatter);
  // A rough floor gathers light from the whole column above, not one
  // mirror point: three taps climbing the wall, read well blurred, so
  // a tall bright sheet still throws a pool forward over a dark foot.
  float lod = 1.2 + 3.4 * clamp(cpos.y / 1.2, 0.0, 1.0);
  vec3 refl = textureLod(uWall, ruv.xy, lod).rgb * 0.5
            + textureLod(uWall, reflectUv(ro, cpos, scatter + vec2(0.0, 0.16)).xy, lod + 0.6).rgb * 0.3
            + textureLod(uWall, reflectUv(ro, cpos, scatter + vec2(0.0, 0.36)).xy, lod + 1.0).rgb * 0.2;
  refl *= step(0.0, ruv.z);
  // Contrast before the knee: pools concentrate under the bright
  // sheets, the floor under a cavity falls dark.
  refl = pow(refl, vec3(1.65));

  // Dots are present where the reflection is bright: light breaks
  // into granular pools instead of a uniform carpet.
  float present = step(hash21(cell * 2.3 + 11.0 + oct), clamp(0.06 + 14.0 * refl.r, 0.0, 0.96));
  // Coarser octaves hold fewer dots per area; each carries more light.
  return dotc * present * (refl * 34.0 + vec3(0.045, 0.0, 0.0)) * (1.0 + 0.9 * oct);
}

void main(){
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 wall = texelFetch(uWall, ivec2(gl_FragCoord.xy), 0);
  vec3 ro = uCamPos;
  vec3 rd = viewRay(ndc);
  if (rd.y > -1e-5) { o = wall; return; }
  vec3 pf = ro + rd * (-ro.y / rd.y);
  if (pf.z <= 0.0) { o = wall; return; }   // the ray meets the wall first

  float x = pf.x;
  float z = pf.z;

  // Low-frequency surface ripples warp the dust so nothing lines up.
  vec2 wp = vec2(x, z) + 0.09 * (vec2(
      vnoise3(vec3(x * 2.1, z * 2.7, 1.0) + uSeed),
      vnoise3(vec3(x * 2.6, z * 1.9, 5.0) + uSeed)) - 0.5);

  float depth = max(ro.z - z, 0.05);
  float pxd = uPxWorld * depth / ro.z;       // world size of a pixel at this depth
  float fore = ro.y / depth;                 // foreshortening of floor depth

  // Base lattice 1.3 × 1.75 thread pitches. Toward the wall the rows
  // foreshorten below a pixel and would smear into dashes, so the
  // lattice is coarsened in whole octaves to keep rows ≥ ~2.4 px
  // apart, cross-fading between neighbouring octaves.
  vec2 cs0 = vec2(uPitch * 1.1, uPitch * 1.35);
  float rowPx = cs0.y * fore / pxd;
  float lv = max(0.0, log2(2.4 / max(rowPx, 1e-4)));
  float l0 = floor(lv);
  float lf = smoothstep(0.25, 0.75, lv - l0);
  vec3 d0 = dust(ro, wp, cs0 * exp2(l0), pxd, fore, l0);
  vec3 d1 = dust(ro, wp, cs0 * exp2(l0 + 1.0), pxd, fore, l0 + 1.0);
  vec3 col = mix(d0, d1, lf);

  // Slow roughness: where the floor is glossier the pools are fuller.
  float rough = smoothstep(0.42, 0.62,
      vnoise3(vec3(x * 1.1, z * 0.9, uTime * 0.04) + uSeed.yzx));
  // When the wall heaves toward the viewer its light reaches further
  // across the floor.
  float heave = clamp(fieldAt(x).r, 0.0, 1.0);
  col *= (0.18 + 1.12 * rough) * exp(-z * 0.62 * (1.0 - 0.55 * heave));
  // Soft knee: idle pools are bright, a click flare does not clip.
  col = col / (1.0 + 0.55 * col);

  // Only a whisper of continuous bleed where the threads meet the ground.
  vec3 buv = reflectUv(ro, vec2(x, z), vec2(0.0));
  vec3 bleed = textureLod(uWall, buv.xy, 2.0).rgb * exp(-z * 26.0) * 0.10;
  col = max(col, bleed);

  // Flanks: wide at the foot, pinching in toward the camera so the
  // bottom corners resolve to black.
  float nearK = 1.0 - smoothstep(-1.0, -0.42, ndc.y);
  float e0 = mix(0.72, 0.40, nearK);
  float e1 = mix(0.98, 0.70, nearK);
  float fl = 1.0 - smoothstep(e0, e1, abs(ndc.x));
  float bf = smoothstep(-1.0, -0.76, ndc.y);
  col *= fl * bf;

  // The pools pick up the surge's heat from the wall above, capped
  // just past scarlet: the floor stays red, with only a trace of the
  // crest's rose in its very hottest dots.
  float tint = textureLod(uWall, buv.xy + vec2(0.0, 0.12), 3.5).a * fl * bf;
  o = vec4(clamp(col, 0.0, 1.0) * vec3(1.0, 0.55, 0.6), clamp(tint * 0.8, 0.0, 0.82));
}
`;
