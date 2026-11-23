/* ──────────────────────────────────────────────────────────────
   The front curtain — beads in three dimensions.

   The wall's front stratum is not a picture of threads; it is the
   threads. One GL_POINTS draw, no vertex buffer: bead n belongs to
   column n / rows (a thread) at row n % rows (its height), both
   recovered from gl_VertexID. Beads sit one thread-pitch apart in
   both axes, so at rest neighbouring beads overlap along a thread
   and it reads as a continuous hairline with a faint bead rhythm —
   the same look the ray-cast stratum had.

   The curtain is RIGID. No bead ever leaves its place: the threads
   stand razor-straight in the plane z = 0 through every pulse and
   every click. A pulse reaches this layer only as light: the region
   an event covers flushes from crimson through magenta to rose, and
   that tint travels in the alpha channel to the composite. What
   comes out of the wall toward the viewer is a separate layer of
   points (cloud.glsl.ts) drawn over this one.

   Channels written:  R energy   G heat   B violet   A pulse tint
   ────────────────────────────────────────────────────────────── */

import { HEADER, COMMON } from './common.glsl';
import { WALL_SHARED } from './wall.glsl';

export const BEAD_VS = `${HEADER}${COMMON}${WALL_SHARED}
flat out vec4 vCol;     // energy, heat, violet, tint
flat out vec4 vShape;   // half-width px, half-height px, sprite size px, disc 0..1

void main(){
  int rows = int(uGrid.y);
  int colI = gl_VertexID / rows;
  float rj = float(gl_VertexID - colI * rows);
  float ti = uGrid.z + float(colI);
  float xc = (ti + 0.5) * uPitch;      // the thread's column
  float y0 = (rj + 0.5) * uPitch;      // the bead's resting height
  // At rest the wall is glacial: massive, barely breathing.
  float t = uTime * 0.45;
  // Everything a breakthrough does runs on the billow's clock instead:
  // smooth, but teleported by interrupts.
  float gt = uGTime + uPose;

  // The composition is anchored to the screen; a bead takes its
  // place in it from where it RESTS, wherever it is thrown.
  vec4 c0 = uViewProj * vec4(xc, y0, 0.0, 1.0);
  float xn = c0.x / c0.w;

  // ── Thread identity ──────────────────────────────────────
  float h1 = hash11(ti * 1.31 + uSeed.x);
  float h2 = hash11(ti * 2.17 + uSeed.y);
  float h3 = hash11(ti * 3.71 + uSeed.z);
  float bundle = floor(ti / 9.0);
  float hb = hash11(bundle * 1.9 + uSeed.y);
  // The pressure field is read at a per-thread, per-bundle offset,
  // so a flare's sides are ragged threads, not a rectangular column.
  vec4 f = fieldAt(xc + (h1 - 0.5) * 0.12 + (hb - 0.5) * 0.16);
  float g = max(f.g, 0.0);

  // ── Composition envelope (slowly breathing) ──────────────
  float cleftC = -0.05 + 0.035 * sin(t * 0.045 + 1.0);
  float cleftW = 0.040 + 0.026 * vnoise3(vec3(y0 * 2.2, t * 0.06, 7.0));
  float cdx = (xn - cleftC + 0.07 * (vnoise3(vec3(y0 * 1.7, t * 0.05, 2.0)) - 0.5)) / cleftW;
  float cleft = exp(-cdx * cdx);
  // A tall saturated sheet standing just left of the cleft, drifting.
  float sheets = exp(-pow2((xn + 0.19 + 0.02 * sin(t * 0.05)) / 0.13));
  // The far-left third: where the dark arches are carved.
  float leftArch = 1.0 - smoothstep(-0.62, -0.34, xn);
  float side = smoothstep(0.62, 0.98, abs(xn));
  // The hotspot is not a shape. It is a broad, soft region right of
  // centre where the SAME curtain is driven to saturation.
  vec2 hcen = vec2(0.44 + 0.03 * sin(t * 0.06), 0.52 + 0.03 * sin(t * 0.083 + 2.0));
  float hotW = exp(-(pow2((xn - hcen.x) / 0.25) + pow2((y0 - hcen.y) / 0.36)));
  // A fold of negative space kept under its lower-right flank.
  float pocket = exp(-(pow2((xn - hcen.x - 0.07) / 0.15) + pow2((y0 - 0.10) / 0.13)));

  // ── Vertical tear and smear along the thread ─────────────
  // Every thread reads the picture at its own height, so no edge
  // in the picture can cross the threads cleanly.
  float sz = vnoise3(vec3(xc * 0.9, t * 0.04, 1.0) + uSeed);
  float zone = smoothstep(0.50, 0.78, sz);
  float tear = (h1 - 0.5) * 0.09
             + (hb - 0.5) * 0.10
             + (h2 - 0.5) * 0.24 * zone
             + (h2 - 0.5) * 0.18 * exp(-pow2((xn - hcen.x - 0.24) / 0.08));
  // In "sort zones" a thread also HOLDS the picture from one
  // height and drags it down its length — the pixel-sorted drip.
  float st = clamp(0.70 * zone + 0.75 * sheets + 0.5 * f.b, 0.0, 0.9);
  float holdY = 0.35 + 0.6 * h2;
  float held = step(h3, st) * step(y0, holdY);
  float ys = mix(y0, holdY - (holdY - y0) * 0.06, held);
  // Stepped-clock sort slips: small groups of threads jump vertically.
  float grp = floor(ti / 6.0);
  float slipSel = hash21(vec2(grp, floor(uTick / 3.0)));
  float slipOn = step(0.95 - 0.45 * clamp(f.b + g, 0.0, 1.0), slipSel);
  float slip = (hash21(vec2(grp, uTick)) - 0.5) * 0.22 * slipOn * uShear;
  // Slam-shut scar. When the wall yanks part of a cloud back into
  // itself, the energy goes down the threads behind it: for a fifth
  // of a second a few narrow bundles (3 to 9 threads) under the
  // rupture flash, and the picture on them slips vertically.
  float scarK = 0.0;
  if (uScar > 0.001) {
    float foot = 0.0;
    for (int i = 0; i < EV_N; i++) {
      vec4 eb = uEv[2 * i + 1];
      if (eb.y < 0.02) continue;
      vec4 ea = uEv[2 * i];
      foot = max(foot, eb.y * (1.0 - smoothstep(0.55, 1.0, abs(xc - ea.x) / ea.z))
                     * (1.0 - smoothstep(ea.y + 1.1 * ea.w, ea.y + 1.5 * ea.w, y0)));
    }
    float sh = hash21(vec2(bundle, floor(uScarSeed)));
    float pick = step(0.80, sh) * step(ti - bundle * 9.0, 2.0 + floor(fract(sh * 53.0) * 6.99));
    scarK = uScar * pick * foot * uShear;
    slip += (fract(sh * 17.0) < 0.5 ? -1.0 : 1.0) * mix(0.03, 0.06, fract(sh * 29.0)) * scarK;
  }
  ys += tear + slip;

  // ── The picture ──────────────────────────────────────────
  float grounded = (1.0 - smoothstep(0.0, 0.16, y0))
                 * (1.0 - smoothstep(0.46, 0.62, abs(xn - 0.07)));
  float v = marbleField(xc, ys, 0.0, 0.0);
  // The page draws a new seed on every load, and an additive push
  // cannot outvote an unlucky field. So the composition's anchors
  // REMAP the field instead: inside each, the field's whole range
  // is squeezed into the lit side of the cut. The anchor is then
  // lit on every seed, and still carries the field's own folds.
  float wob = vnoise3(vec3(xn * 2.3, y0 * 1.9, t * 0.05) + uSeed.zxy);
  float wob2 = vnoise3(vec3(xn * 6.1, y0 * 5.0, t * 0.07) + uSeed);
  // The hotspot's weight is measured at the thread's TORN height,
  // so its outline breaks into staggered tips like every other edge.
  // (It reaches a little higher than the hotspot itself, so the heat
  // filaments always sit inside lit crimson, whatever the seed.)
  float hotT = exp(-(pow2((xn - hcen.x) / 0.25) + pow2((ys - hcen.y - 0.027) / 0.387)));
  float wHot = smoothstep(0.30, 0.56, hotT * (0.40 + 0.85 * wob + 0.35 * wob2));
  // And whatever the seed does to that outline, a margin a quarter
  // wider than the heat brush is always lit: the filaments sit deep
  // inside a slab of crimson, never out on their own in the dark.
  float brushM = exp(-(pow2((xn - hcen.x - 0.02) / 0.2625) + pow2((ys - hcen.y - 0.03) / 0.1875)));
  wHot = max(wHot, smoothstep(0.22, 0.50, brushM * (0.85 + 0.30 * wob2)));
  float wSheet = smoothstep(0.35, 0.75, sheets * (0.75 + 0.50 * wob));
  v = mix(v, 0.62 + 0.37 * v, wHot);
  v = mix(v, 0.57 + 0.38 * v, wSheet);
  v = mix(v, 0.56 + 0.36 * v, grounded * 0.85);
  // And the pocket squeezes it the other way, into black.
  float wPocket = pocket * (1.0 - smoothstep(0.24, 0.34, y0))
                * (0.45 + 1.1 * vnoise3(vec3(xn * 7.0, y0 * 6.0, t * 0.05) + uSeed));
  v = mix(v, 0.42 * v, clamp(wPocket * 1.3, 0.0, 1.0));
  // One soft dark arch is always carved into the left third, so no
  // seed can fill that side into a flat red wall.
  float archX = (xn + 0.58 + 0.05 * (vnoise3(vec3(y0 * 1.6, t * 0.04, 4.0) + uSeed) - 0.5)) / 0.11;
  float archY = (ys - 0.565) / 0.24;
  float wArch = exp(-(archX * archX + archY * archY))
              * (0.55 + 0.9 * vnoise3(vec3(xn * 5.0, y0 * 3.0, t * 0.05) + uSeed.yzx));
  v = mix(v, 0.42 * v, clamp(wArch * 1.25, 0.0, 1.0));

  // About a third of the curtain is true black; the rest is shaded
  // continuously. On the far left the cut bites a little harder.
  vec2 sh = shade(v, 0.515 + 0.02 * leftArch, 0.96 - 0.13 * leftArch);
  float e = sh.x;
  float lit = sh.y;
  // Inside the hotspot a steeper gain: its folds climb to full.
  float hot = hotW * hotW * lit;
  e = mix(e, smoothstep(0.10, 0.46, e) * 1.15, clamp(hotW * 1.25, 0.0, 1.0));

  // Exposure: blacks stay pinned at zero, the crests are electric.
  e = min(e * (1.10 + 0.14 * sheets) * (1.0 - 0.95 * cleft) * mix(1.0, 0.62, side), 1.25);

  // ── Thread tips, foot, flanks ────────────────────────────
  float arch = 0.14 * smoothstep(0.42, 1.0, abs(xn - 0.08));
  float top = 1.0 - arch - 0.02 * vnoise3(vec3(xc * 0.9, 5.0, t * 0.03)) - 0.035 * h2 * h2;
  float tipLen = 0.02 + 0.03 * h1;
  float ends = (1.0 - smoothstep(top - tipLen, top, y0)) * smoothstep(0.0, 0.02, y0);
  float flank = 1.0 - smoothstep(0.80, 1.02, abs(xn));
  float alive = ends * flank * step(h1, 0.18 + 0.82 * flank * flank) * mix(0.22, 1.0, step(0.07, h3));

  // A ghostly canopy: dim threads hold the arched top edge across
  // the cleft and every cavity, so it always reads as one wall.
  e = max(e, smoothstep(top - 0.20, top - 0.03, y0) * (0.12 + 0.16 * h3));

  // A flare lifts the sheet, but unevenly — turbulent stretched noise
  // and, on the stepped clock, bands of threads that drop out.
  float P = pulse(xc, t);
  // (The 1-D field knows only X. Whatever it does to the wall it does
  // to the full height of a column, so it is kept slight: a rupture
  // must not stand on a lit stem.)
  float gz = clamp(g, 0.0, 1.0) * 0.35;
  float churn = 0.55 + 0.45 * vnoise3(vec3(xc * 3.0, y0 * 42.0, t * 0.7) + uSeed);
  float drop = step(0.72, hash21(vec2(floor(y0 * 46.0) + bundle * 3.0, uTick)));
  e *= (0.76 + 0.40 * h3) * (0.70 + 0.46 * P) * (1.0 + 0.2 * g + 0.5 * f.a) * alive;
  // The wall is under pressure even when nothing is breaking through.
  // Signal currents run up or down each bundle of threads: a slow
  // swell of light, about a tenth either way, travelling at an eighth
  // to a third of the wall's height a second. Nothing moves sideways.
  float curV = mix(0.12, 0.32, hash11(bundle * 3.3 + 7.0)) * (hb < 0.5 ? -1.0 : 1.0);
  float cur = vnoise3(vec3(bundle * 5.7, (y0 - curV * uTime) * 3.2, 1.5) + uSeed);
  e *= 1.0 + 0.24 * (cur - 0.5);
  e *= mix(1.0, churn * (1.0 - 0.28 * drop), gz);

  // ── Heat: a woven wake of filaments inside the hotspot ───
  float wy = y0 + 0.014 * sin(xc * 5.0 + t * 0.4)
           + 0.035 * (vnoise3(vec3(xc * 1.8, y0 * 1.5, t * 0.12)) - 0.5);
  float n1 = fbmN(vec3(xc * 3.3 - t * 0.22, wy * 60.0, t * 0.35) + uSeed, 2);
  float n2 = fbmN(vec3(xc * 2.6 + t * 0.15, wy * 94.0, t * 0.5) + uSeed.yzx, 2);
  float n = 0.58 * n1 + 0.42 * n2;
  float brush = exp(-(pow2((xn - hcen.x - 0.02) / 0.21) + pow2((y0 - hcen.y - 0.03) / 0.15)));
  float fil = smoothstep(0.45 - 0.07 * brush, 0.60, n);
  float wisp = smoothstep(0.545, 0.64, n) * brush;
  float surge = 0.80 + 0.50 * pow2(vnoise3(vec3(t * 0.45, 9.1, 3.3)));
  float tail = exp(-(pow2((xn - hcen.x - 0.27) / 0.10) + pow2((y0 - hcen.y - 0.03) / 0.10)));
  // (At rest the streaks are embers, well short of incandescent:
  // white belongs to the eruptions.)
  float idle = 0.45 * surge * (hot * brush * (0.80 * fil + 0.95 * wisp) + 0.55 * tail * wisp);
  float fz = clamp(g, 0.0, 1.4) * exp(-pow2((y0 - 0.5) / 0.33));
  float flare = fz * (0.34 * fil + 0.50 * smoothstep(0.545, 0.64, n) + 0.08 * smoothstep(0.42, 0.60, n));
  float heat = clamp(idle + flare, 0.0, 1.0) * flank * ends;

  // ── Violet: thread-quantised, never a haze ───────────────
  float midShadow = smoothstep(0.10, 0.18, e) * (1.0 - smoothstep(0.34, 0.46, e));
  float lowY = 1.0 - smoothstep(0.30, 0.66, y0);
  float zones = lowY * (exp(-pow2((xn + 0.21) / 0.11)) + exp(-pow2((xn - 0.38) / 0.16)));
  float fold = smoothstep(0.47, 0.60, marbleField(xc, ys, 1.0, 0.0));
  float broken = smoothstep(0.52, 0.70,
                   vnoise3(vec3(ti * 0.17, y0 * 7.0 + h2 * 9.0, t * 0.15) + uSeed));
  float filament = cleft * step(0.58, h3) * fold * broken * 0.46;
  float violet = (midShadow * clamp(zones, 0.0, 1.0) * 0.55 + filament) * alive;
  // Before a surge, a cool charge wells up in the mid-shadow folds.
  violet += uCharge * 0.45 * smoothstep(0.04, 0.22, e) * (1.0 - smoothstep(0.40, 0.80, e));

  // ── Living cold columns ──────────────────────────────────
  // Deep in the dim mid-shadow folds, some of the sheet runs electric
  // steel-blue to cobalt instead of crimson. It is a field of its own:
  // low-frequency, warped, sheared tall along the threads, and read at
  // each thread's torn height, so its edges are the same ragged thread
  // tips as every red cavity's. No boxes, no horizontal cuts.
  float coldW = vnoise3(vec3(xc * 0.9, ys * 0.7, t * 0.03 + 4.0) + uSeed.zxy) - 0.5;
  float coldF = fbmN(vec3(xc * 1.25 + coldW * 1.1, ys * 0.42 + coldW * 0.5, t * 0.035) + uSeed.yzx, 2);
  float coldFold = smoothstep(0.595, 0.665, coldF + (h1 - 0.5) * 0.035 + (hb - 0.5) * 0.03);
  // (Kept out of the ghostly canopy along the top rim.)
  float dimFold = smoothstep(0.03, 0.12, e) * (1.0 - smoothstep(0.42, 0.66, e))
                * (1.0 - smoothstep(top - 0.26, top - 0.10, y0));
  float coldK = coldFold * dimFold * (1.0 - heat);
  // (While the wall leans in on an idle visitor, the cold folds
  // brighten by a fifth.)
  violet += coldK * (0.42 + 0.34 * h3) * alive * (1.0 + 0.20 * uIdle);
  e *= 1.0 - 0.55 * coldK;

  // And single threads spit: sharp flickers a few hundredths of a
  // second long, on about one stretch of thread in seventy at any
  // instant, strongest along the rims of the dark cavities and in the
  // cobalt folds.
  float fk = step(0.9855 - 0.0095 * uIdle, hash21(vec2(ti + floor(y0 * 5.0) * 37.0, floor(uTime * 15.0)))) * uShear;
  float rimM = smoothstep(0.03, 0.14, e) * (1.0 - smoothstep(0.28, 0.50, e));
  e *= 1.0 + fk * (0.35 + 1.40 * rimM);
  violet *= 1.0 + fk * 1.2;

  // ── The pulse: light on the wall, never motion ───────────
  // The curtain is rigid. Every thread stays exactly where it stands,
  // straight from the floor to its tip, through every pulse and every
  // click. What a pulse does to the wall itself is flush a region of
  // it: crimson through magenta to rose where it is hottest. What
  // comes out of the wall is another layer entirely (cloud.glsl.ts).
  // The region's edge is read at each thread's torn height and stepped
  // in blocks, so it breaks into ragged panels like every other edge
  // in the picture.
  // The region is read mostly on a coarse grid of blocks, so its
  // silhouette is stepped panels: as the shape drifts, panels join
  // and leave it whole. Its light drains smoothly as it collapses.
  float fl = 0.0;
  float lv = 0.0;
  float cold = 0.0;
  float rim = 0.0;
  float leak = 0.0;
  vec2 blk = vec2(floor(ti / 14.0), floor(y0 / 0.052));
  float xb = mix(xc + (hb - 0.5) * 0.10, (blk.x + 0.5) * 14.0 * uPitch, 0.72);
  float yb = mix(ys, (blk.y + 0.5) * 0.052, 0.72);
  for (int i = 0; i < EV_N; i++) {
    vec4 eb = uEv[2 * i + 1];
    if (eb.x + eb.y < 0.003) continue;
    vec4 ea = uEv[2 * i];
    if (abs(xc - ea.x) > 2.8 * ea.z) continue;
    float sd = abs(eb.z);
    float bn = hash21(blk + floor(sd * 977.0));
    float sh = evShape(ea, sd, xb, yb, gt) * (0.84 + 0.32 * bn);
    // Collapse: the flush drains smoothly; whole blocks of it go only
    // when the wall knocks chunks out on a collapse twitch.
    float kept = step(min(eb.w, uChunk) * 1.04, hash21(blk * 1.7 + floor(sd * 613.0)));
    // The panel keeps to the event's own band of the wall. Below it
    // only a few thin discharge threads, two to six wide and re-drawn
    // every few ticks, run down to the floor seam.
    float band = 1.0 - smoothstep(1.15, 1.40, abs(yb - ea.y) / ea.w);
    // The lit panel hugs the lobes that are actually erupting: where
    // the cloud has a canyon (the same field cloud.glsl.ts cuts it
    // with), the wall behind stays mostly dark.
    float canLo = mix(0.455, 0.40, smoothstep(0.20, 0.55, ea.z));
    float canyon = smoothstep(canLo, canLo + 0.05,
                              fbmN(vec3(vec2(xb, yb) * 1.45, sd * 5.0 + 3.0 + gt * 0.045), 2));
    float fv = eb.y * smoothstep(0.10, 0.62, sh) * kept * band * (0.30 + 0.70 * canyon);
    float dg = floor(ti / 6.0);
    float gh = hash21(vec2(dg, floor(sd * 977.0) + floor(uPose * 0.7)));
    float dl = step(0.90, gh) * step(ti - dg * 6.0, 1.0 + floor(fract(gh * 37.0) * 4.99));
    leak = max(leak, eb.y * step(0.0, eb.z) * (1.0 - eb.w) * dl * step(y0, ea.y)
                   * (1.0 - smoothstep(0.55, 0.85, abs(xc - ea.x) / ea.z))
                   * (0.55 + 0.45 * hash21(vec2(ti, floor(y0 * 40.0) + uTick))));
    if (eb.z < 0.0) cold = max(cold, fv); else fl = max(fl, fv);
    lv = max(lv, min(eb.x, 1.0) * smoothstep(0.30, 0.90, sh) * kept);
    rim = max(rim, eb.y * smoothstep(0.08, 0.16, sh) * (1.0 - smoothstep(0.24, 0.40, sh)));
  }
  // Integrity loss: now and then a bundle inside the rupture goes
  // dead black for a tick or two.
  float dead = dropoutAt(bundle, y0) * step(0.30, max(fl, cold)) * uShear * step(0.01, uStrainK);
  // The wall's ICE clamping down: beside a rupture, slivers of one to
  // four threads flash hard electric cobalt for a tick or two, each
  // thread at its own staggered height. Threads, never a filled box.
  float inB = ti - bundle * 9.0;
  float ice = step(0.01, uIce) * segAt(bundle, y0 + (h1 - 0.5) * 0.16, 41.0, 0.84)
            * step(inB, floor(hash21(vec2(bundle, floor(uTick / 2.0) + 9.0)) * 3.99))
            * step(0.5, rim) * uShear;
  float pulseK = fl * ends * flank;
  // A flushed thread is lit a little even where the picture left it
  // black, unevenly; the wall's own folds and cavities still show
  // through, and it is brightest under the push itself.
  float grain = 0.80 + 0.40 * vnoise3(vec3(xc * 7.0, y0 * 30.0, gt * 0.5) + uSeed.zxy);
  e = max(e, pulseK * (0.22 + 0.18 * h3) * grain);
  e = min(e * (1.0 + 0.70 * pulseK) + (0.06 + 0.24 * lv) * pulseK * grain, 1.30);
  violet *= 1.0 - 0.9 * pulseK;
  float tint = pulseK * (0.34 + 0.34 * lv) * grain * (0.35 + 0.65 * smoothstep(0.06, 0.40, e));
  // Discharge threads under a rupture.
  float leakK = leak * ends * flank * (1.0 - pulseK);
  e = max(e, leakK * 0.70);
  tint = max(tint, leakK * 0.36);
  // A cold probe twitch lights its patch cobalt instead of crimson:
  // about a third of its threads, so it is slivers and not a slab.
  float coldK2 = cold * ends * flank * step(0.64, h3);
  violet = max(violet, coldK2 * (0.85 + 0.30 * h1) * grain);
  e *= 1.0 - 0.85 * coldK2;
  violet = max(violet, ice * (1.0 + 0.30 * h3) * ends * flank);
  e *= 1.0 - 0.92 * ice;
  tint *= 1.0 - ice;
  // The scar itself: a narrow flash, crimson to pale rose.
  float scarL = scarK * ends * flank;
  e = min(e * (1.0 + 0.45 * scarL) + 0.12 * scarL, 1.30);
  tint = max(tint, 0.46 * scarL * smoothstep(0.04, 0.30, e));
  e *= 1.0 - dead;
  heat *= 1.0 - dead;
  violet *= 1.0 - dead;
  tint *= 1.0 - dead;

  vec3 world = vec3(xc, y0, 0.0);

  // ── Sprite shape ─────────────────────────────────────────
  // A soft-edged mark 1.3 px half-wide (the thread's core) and tall
  // enough to overlap its neighbours into a line.
  float s = (uPitch / uPxWorld) / 3.0;
  float hx = 1.30 * s;
  float hy = 1.90 * s;
  float size = ceil(2.0 * max(hx, hy)) + 1.0;

  vCol = vec4(e, heat, violet, tint * step(0.02, max(e, heat)));
  vShape = vec4(hx, hy, size, 0.0);
  gl_PointSize = size;
  gl_Position = uViewProj * vec4(world, 1.0);
  // Unlit beads are not drawn at all.
  if (max(e, max(heat, violet)) < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const BEAD_FS = `${HEADER}
flat in vec4 vCol;
flat in vec4 vShape;
out vec4 o;
void main(){
  // Analytic coverage around the bead's true sub-pixel centre: the
  // threads do not crawl as the camera drifts.
  vec2 d = abs(gl_PointCoord - 0.5) * vShape.z;
  float cov = clamp(vShape.x - d.x, 0.0, 1.0) * clamp(vShape.y - d.y, 0.0, 1.0);
  o = vec4(vCol.rgb * cov, vCol.a * step(0.3, cov));
}
`;
