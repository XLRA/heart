/* ──────────────────────────────────────────────────────────────
   The cloud — what actually comes through the wall.

   The curtain behind this layer never moves. A pulse is a lattice of
   fine points lifting STRAIGHT OUT of it, along the wall's normal
   (+Z, toward the viewer), from the region an event covers. One
   GL_POINTS draw, no vertex buffer:

     vertices 0 … DUST_N-1   void dust: sparse pinpricks drifting in
                             the dark above and in front of the wall
     then, per emitter       SLICES points along its push-out vector

   An emitter is a point of the wall's own lattice (every few threads,
   every few beads). Where an event is pushing, the emitter's outer
   point rides a billowing canopy: a smooth surface of noise seeded by
   the event, so neighbouring points move together and the cloud
   keeps the lattice's rows as feathered, curving lines. The points
   behind it step back at fixed fractions of the same vector to the
   emitter's own place on the wall — dotted depth trails that tie the
   canopy to the straight columns it came from. Perspective makes
   those straight vectors fan out and up over the viewer.

   As an event dissolves its points drift back toward the wall while
   they are thinned out one by one: it never snaps shut.

   Channels written:  R energy   G 0   B 0   A pulse tint
   ────────────────────────────────────────────────────────────── */

import { HEADER, COMMON } from './common.glsl';

/** Void dust motes, and points per emitter. Must match the shader. */
export const DUST_N = 620;
export const CLOUD_SLICES = 19;

export const CLOUD_VS = `${HEADER}${COMMON}
flat out vec4 vCol;     // energy, heat, cold, tint
flat out vec3 vShape;   // half-width px, half-length px, sprite size px
flat out vec2 vDir;     // the dash's long axis on screen

uniform sampler2D uWall;   // the wall as drawn this frame, mipmapped

#define DUST_N 620
#define SLICES 19

void cull(){
  vCol = vec4(0.0);
  vShape = vec3(0.0, 0.0, 1.0);
  vDir = vec2(0.0, 1.0);
  gl_PointSize = 1.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}

void main(){
  float t = uTime;
  int id = gl_VertexID;

  // ── Void dust ────────────────────────────────────────────
  if (id < DUST_N) {
    // (The dust is the one thing here on the smooth clock: it drifts
    // while the wall stutters, so it is the wall that reads as
    // corrupted, not the browser.)
    if (uGhost > 0.0) { cull(); return; }
    float fi = float(id);
    vec3 h = vec3(hash11(fi * 1.31 + uSeed.x), hash11(fi * 2.17 + uSeed.y), hash11(fi * 3.71 + uSeed.z));
    float hw = max(abs(uXL), abs(uXR)) * 1.2;
    vec3 p = vec3((fract(h.x + t * 0.0035 * (h.z - 0.35)) * 2.0 - 1.0) * hw,
                  0.12 + fract(h.y + t * 0.005 * (0.3 + h.x)) * 1.55,
                  0.10 + h.z * h.z * uCamPos.z * 0.72);
    // Each mote fades slowly in and out on its own period. Most are a
    // dim arterial red; about one in four is a faint cool white-pink.
    float a = smoothstep(0.42, 0.90, 0.5 + 0.5 * sin(t * (0.22 + 0.45 * h.y) + fi * 2.4));
    // A mote is a short vertical streak, as in the game: most are a
    // warm ember, some a cool white-pink, a few arterial red.
    float kd = hash11(fi * 5.13 + 1.0);
    float warm = step(kd, 0.58);
    float pale = step(0.58, kd) * step(kd, 0.82);
    vCol = vec4(mix(0.80, 0.34, warm) * a, 0.62 * warm * a, 0.0, 0.92 * pale * a);
    float r = mix(0.55, 0.80, hash11(fi * 7.7)) * max(uResK, 0.7);
    float dlen = r * mix(2.0, 4.5, hash11(fi * 3.3 + 2.0));
    vShape = vec3(r, dlen, ceil(2.0 * dlen) + 1.0);
    vDir = vec2(0.0, 1.0);
    gl_PointSize = vShape.z;
    gl_Position = uViewProj * vec4(p, 1.0);
    if (a < 0.02) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // ── Which emitter, which of its points ───────────────────
  // The billow flows on its own smooth clock, so between interrupts
  // the cloud moves like living mist. An interrupt teleports that
  // clock (back a little on a yank, well forward on a leap), and the
  // flow simply carries on from the pose it lands in.
  float gt = uGTime + uPose;
  id -= DUST_N;
  int em = id / SLICES;
  int sl = id - em * SLICES;
  int rows = int(uCloud.y);
  int colI = em / rows;
  float rj = float(em - colI * rows);
  float stride = uCloud.z;
  float tb = (floor(uGrid.z / stride) + float(colI)) * stride;
  // The emitter stands exactly on one of the wall's threads. (Its
  // points are scattered off the lattice only once they have come a
  // little way out: see below. At the wall they are still in line
  // with the thread they are shredding out of.)
  vec2 ho = hash22(vec2(tb, rj) + 0.5);
  float x = (tb + 0.5) * uPitch;
  float y = (rj + 0.5) * stride * uPitch;

  // ── The strongest event pushing here ─────────────────────
  float push = 0.0;
  float deep = 0.0;
  float fade = 0.0;
  float seed = 0.0;
  vec4 evA = vec4(0.0, 0.0, 1.0, 1.0);
  for (int i = 0; i < EV_N; i++) {
    vec4 eb = uEv[2 * i + 1];
    if (eb.x < 0.004) continue;
    vec4 ea = uEv[2 * i];
    if (abs(x - ea.x) > 2.6 * ea.z || abs(y - ea.y) > 2.6 * ea.w) continue;
    float sh = evShape(ea, eb.z, x, y, gt);
    float w = eb.x * smoothstep(0.10, 0.78, sh);
    if (w > push) { push = w; deep = sh; fade = eb.w; seed = abs(eb.z); evA = ea; }
  }
  // Nothing comes out of the flanks or the top fringe of the wall.
  // (Toward the flanks the push is held back as well: out there
  // perspective would rake a straight push-out sideways.)
  float xn = (x - 0.5 * (uXL + uXR)) / (0.5 * (uXR - uXL));
  push *= (1.0 - smoothstep(0.84, 1.0, abs(xn))) * (1.0 - 0.45 * smoothstep(0.45, 0.95, abs(xn)))
        * smoothstep(0.02, 0.10, y) * (1.0 - smoothstep(0.86, 0.97, y))
        * (1.0 - 0.35 * smoothstep(0.60, 0.90, y));
  // The cloud's outline is clipped on a grid of blocks, hard, and the
  // grid's pattern is re-rolled on every pose snap: even the first
  // tick of a burst is a torn, stepped shape, not an oval.
  vec2 cb = vec2(floor(tb / (stride * 8.0)), floor(rj / 6.0));
  vec2 cbc = vec2((cb.x + 0.5) * stride * 8.0 * uPitch, (cb.y + 0.5) * 6.0 * stride * uPitch);
  float shB = evShape(evA, seed, cbc.x, cbc.y, gt)
            * (0.55 + 0.90 * hash21(cb * 1.3 + floor(uPose) + floor(seed * 811.0)));
  push *= smoothstep(0.30, 0.33, shB);
  if (push < 0.012) { cull(); return; }

  // ── The fight ────────────────────────────────────────────
  // This point's band takes its own share of every teleport...
  float bw = bandWarp(x, y, seed);
  float pe = push * (1.0 + bw);
  // ...and the push runs into a containment ceiling. Past about
  // four fifths of full strength it is compressed asymptotically:
  // the plume flattens against something invisible, and sizzles.
  float ceilK = smoothstep(0.78, 1.05, pe);
  float over = max(pe - 0.78, 0.0);
  push = pe - over + over / (1.0 + 2.4 * over);

  // ── Turbulence ───────────────────────────────────────────
  // The event's soft oval is only an envelope. Inside it a warped,
  // re-seeded turbulence decides everything: where points lift at all,
  // how far, and how hot. Peaks erupt, valleys stay low and dark, and
  // the outline is whatever the turbulence leaves standing.
  vec3 sd = vec3(seed * 17.0, seed * 5.0, seed * 11.0);
  vec3 cq = vec3(x * 1.4, y * 1.4, sd.z + gt * 0.10);
  vec2 curl = vec2(vnoise3(cq), vnoise3(cq + vec3(9.0, 4.0, 0.0))) - 0.5;
  vec3 tp = vec3((vec2(x, y) + curl * 0.24) * 3.1, sd.x + gt * 0.13);
  float turb = fbmN(tp, 3);
  float mask = smoothstep(0.30, 0.60, turb);
  // Canyons. About a third of the envelope is cut clean away by a
  // slower, larger field, so the eruption is never one cushion: the
  // wall's straight threads show through holes inside it.
  // (A wide rupture loses a little less of itself than a small one.)
  float canLo = mix(0.455, 0.40, smoothstep(0.20, 0.55, evA.z));
  float canyon = smoothstep(canLo, canLo + 0.05,
                            fbmN(vec3((vec2(x, y) + curl * 0.35) * 1.45, sd.y + 3.0 + gt * 0.045), 2));
  push *= canyon;
  if (push < 0.012) { cull(); return; }
  // A second, finer turbulence carves troughs across the broad
  // ridges, so a wide event stands as two or three uneven crests
  // with dark valleys between, never one band.
  float carve = smoothstep(0.34, 0.58, vnoise3(tp * 2.4 + vec3(5.1, 1.7, 0.0)));
  mask *= mix(1.0, 0.45 + 0.55 * carve, smoothstep(0.20, 0.55, evA.z));
  float fine = vnoise3(vec3(x * 6.0, y * 6.0, sd.y - gt * 0.25));
  // Energy: how hard this point is being driven, 0..1.
  // (It cools as its event dissolves: the white goes out first.)
  // A small event burns hotter than a wide one: the bursts sparkle.
  float en = min(push * (0.20 + 0.80 * mask) * (0.80 + 0.20 * fine) * (1.0 - 0.55 * fade)
                 * (1.28 - 0.28 * smoothstep(0.20, 0.55, evA.z)), 1.0);

  vec3 hh = vec3(hash21(vec2(tb, rj)), hash21(vec2(rj + 3.3, tb * 1.7)), hash21(vec2(tb + 7.7, rj * 1.3)));
  // Dense on the peaks, sparse in the valleys, thinning to the rim.
  if (hh.x > 1.15 * smoothstep(0.05, 0.38, deep) * (0.26 + 0.74 * mask)) { cull(); return; }
  // Core first. It never lifts off all at once like a lid: a weak
  // push peels only the hottest veins of the turbulence off the wall
  // (a fifth to a third of the footprint at push 0.3), and the rest
  // of the footprint stays bare, straight thread until the push grows.
  if (turb + (hh.z - 0.5) * 0.04 < mix(0.64, 0.30, smoothstep(0.0, 1.0, push))) { cull(); return; }
  // Collapse. The cloud recedes and thins smoothly; chunks of it go
  // at once only when it twitches forward and is slammed back; and a
  // handful of stubborn sparks hang on after everything round them
  // has gone.
  float bh = hash21(vec2(floor(tb / (stride * 7.0)), floor(rj / 5.0)) * 1.7 + floor(seed * 613.0));
  float stub = step(0.955, hh.y);
  // It thins out smoothly, point by point, as it recedes...
  if (stub < 0.5 && hh.y < fade * 0.98) { cull(); return; }
  // ...and each time it twitches forward against the collapse, the
  // wall knocks whole chunks of it out at once.
  if (stub < 0.5 && bh < min(fade, uChunk) * 1.04) { cull(); return; }
  if (stub > 0.5 && fade > 0.93) { cull(); return; }
  // Integrity loss, during a glitch burst only: a bundle of threads
  // inside the rupture goes dead and takes its part of the cloud.
  if (dropoutAt(floor(tb / 9.0), y) * uShear * step(0.01, uStrainK) > 0.5) { cull(); return; }

  // Every emitter has an outer point. The hottest of them, bunched in
  // the bright pillars, also draw a ray: closely spaced dots stepping
  // straight back along the push-out vector to the emitter's own
  // place on the wall. The rest add a couple of dim points inside the
  // cloud, so it has a body.
  float outer = step(float(SLICES) - 1.5, float(sl));
  float rayOn = step(0.50, en) * step(hh.z, 0.36);
  float hs = hash21(vec2(tb * 1.9 + float(sl) * 3.7, rj * 2.3));
  // Fraction of the vector this point sits at.
  float s = 1.0;
  if (outer < 0.5) {
    if (rayOn > 0.5) {
      // 18 steps over 0.06 to 0.94, shifted per emitter so the steps
      // of neighbouring rays never line up into sheets.
      s = 0.06 + 0.0518 * float(sl) + (hh.x - 0.5) * 0.04;
    } else {
      if (sl > 4) { cull(); return; }
      s = 0.30 + 0.62 * hs;
    }
  }

  // ── Where it stands ──────────────────────────────────────
  // (Each point also stands a little nearer or further than its
  // neighbours: a smooth surface would fold over at its rim and draw
  // its own outline as a line of dots.)
  // (Peaks jut several times further than the valleys beside them,
  // from the first frame.)
  float zp = uCloud.w * push * (0.06 + 0.94 * pow(mask, 1.85) * (0.72 + 0.28 * fine))
           * (0.84 + 0.32 * hash21(vec2(rj * 1.7 + float(sl) * 0.31 * (1.0 - rayOn), tb * 0.93)));
  // The vector is straight at the wall and curls as it leaves it;
  // it rises a little and spreads away from the event's centre, so
  // even an eruption dead ahead of the camera opens out; and a finer
  // advection gathers points along its ridges and leaves gaps between.
  vec2 away = (vec2(x, y) - evA.xy) / evA.zw;
  away *= 0.22 / max(length(away), 0.35);
  vec2 adv = vec2(vnoise3(tp * 1.3 + vec3(3.3, 0.0, 0.0)), vnoise3(tp * 1.3 + vec3(0.0, 7.7, 0.0))) - 0.5;
  // (Against the ceiling the turbulence quickens.)
  adv += (vec2(vnoise3(tp * 2.6 + vec3(gt * 0.6, 1.0, 0.0)), vnoise3(tp * 2.6 + vec3(4.0, gt * 0.6, 0.0))) - 0.5)
       * 0.55 * ceilK;
  float zn = zp / uCloud.w;
  // Off the lattice only once it is out of the wall.
  vec2 stray = (ho - 0.5) * 0.5 * stride * uPitch * smoothstep(0.04, 0.26, zp * s);
  vec3 world = vec3(vec2(x, y) + stray, 0.0)
             + vec3((vec2(curl.x, min(curl.y, 0.12)) * 0.60 + away + vec2(0.0, 0.05)) * zp * s * s
                    + adv * 0.17 * zn * s, zp * s);
  // On the crests the outer points break into a loose spray.
  float isRay = rayOn * (1.0 - outer);
  float chaos = smoothstep(0.55, 0.95, en) * s * s;
  vec3 hj = vec3(hh.xy, hs) - 0.5;
  world += hj * vec3(0.09, 0.09, 0.20) * chaos * uCloud.w * (1.0 - isRay);
  // (The points inside the cloud are scattered off their emitter's
  // vector, or they would line up as a second, sparser ray.)
  world.xy += (vec2(hs, hash21(vec2(rj * 1.1 + float(sl), tb))) - 0.5) * 0.07 * zn * (1.0 - outer) * (1.0 - isRay);
  // One hot outer point in nine tears loose past the silhouette.
  float loose = step(0.89, hs) * step(0.55, en) * outer;
  world += vec3(away * 2.2 + hj.xy * 1.6, 1.0) * mix(0.075, 0.165, hh.y) * loose;
  world.xy += hj.xy * 0.14 * fade * s;
  // Pressed against the ceiling, the outer shell chatters: a
  // centimetre or so each way, re-rolled every frame or two.
  vec2 jt = hash22(vec2(float(em) * 0.71 + float(sl), floor(uTime * 48.0))) - 0.5;
  world.xz += jt * 2.0 * mix(0.008, 0.014, hh.x) * ceilK * (1.0 - isRay);
  // And for a moment after the wall yanks a band back, that band
  // shudders mechanically before it starts to push again.
  world.xz += jt.yx * 2.0 * 0.012 * uShudder * clamp(-bw * 5.0, 0.0, 1.0);

  // ── Light ────────────────────────────────────────────────
  // Valleys are a deep brooding crimson; the body runs through hot
  // magenta-red to pale pink; only the hottest crests burn white,
  // and those shimmer.
  float tw = hash21(vec2(float(em) * 0.37, floor(uTick / 2.0)));
  float shim = (0.70 + 0.30 * sin(gt * 11.0 + hh.z * 40.0)) * (0.55 + 0.45 * step(0.30, tw));
  float white = smoothstep(0.64, 0.80, en) * step(hs, 0.50) * (1.0 - isRay);
  // (A point is translucent on its own: it is where fine points
  // overlap that the cloud fuses into luminous mist.)
  // About half the cloud stays a deep arterial crimson, yanked or
  // not; only the crests of ridges carry hot rose.
  float eBody = mix(0.26, 0.58, smoothstep(0.15, 0.75, en));
  float tBody = mix(0.02, 0.44, smoothstep(0.36, 0.70, en)) + 0.22 * smoothstep(0.66, 0.86, en);
  float e = mix(eBody, 2.0 * shim, white) * mix(0.70, 1.0, outer);
  float tint = mix(tBody, 1.0, white) * mix(0.85, 1.0, outer);
  // A ray is dim at the wall and gathers light on the way out, in
  // deep crimson running to hot red.
  e = mix(e, (0.10 + 0.48 * pow(s, 1.5)) * 1.9, isRay);
  tint = mix(tint, 0.34 * s * s, isRay);
  // A loose spark is crisp and twinkles on its own.
  e = mix(e, 1.6 * step(0.35, tw), loose);
  tint = mix(tint, 0.95, loose);
  // Born of the wall. Close to it, and early in a push, a point is
  // still mostly the colour of the threads it peels off: arterial
  // red or electric cobalt, or dark where the wall is dark. It heats
  // toward rose and white only as it comes out.
  vec4 c0 = uViewProj * vec4(x, y, 0.0, 1.0);
  vec2 n0 = c0.xy / c0.w;
  vec4 wl = textureLod(uWall, n0 * 0.5 + 0.5, 2.0);
  float born = 0.82 * max(1.0 - smoothstep(0.20, 0.42, s), 1.0 - smoothstep(0.25, 0.45, push)) * (1.0 - loose);
  e = mix(e, min(wl.r * 2.4, 1.0) + 0.04, born);
  tint = mix(tint, wl.a, born);
  float cold = min(wl.b * 2.4, 1.0) * born;
  float vis = smoothstep(0.010, 0.05, zp * s);
  // Ghost pass: the pose the cloud had just before it was teleported,
  // left behind and fading while the live cloud moves on from where
  // it landed. Darker, and colder when it was the wall that yanked.
  float gk = step(0.0001, uGhost);
  e *= vis * mix(1.0, uGhost, gk);
  tint *= vis * mix(1.0, 0.45, gk);

  // ── Sprite ───────────────────────────────────────────────
  // A point is a short dash laid along its own push-out vector as
  // the camera sees it (the further it has come across the screen,
  // the longer), a little larger as it nears the viewer and where it
  // burns white.
  float persp = uCamPos.z / max(uCamPos.z - world.z, 0.4);
  float r = mix(mix(0.85, 1.02, outer) + 0.13 * hs + 0.18 * white, mix(0.82, 1.00, s), isRay);
  r = min(mix(r, 0.85, loose) * pow(persp, 0.9), 1.45) * max(uResK, 0.7);
  vec4 cw = uViewProj * vec4(world, 1.0);
  vec2 dpx = (cw.xy / cw.w - n0) * uRes * 0.5;
  float dl = length(dpx);
  vDir = dl > 0.5 ? dpx / dl : vec2(0.0, 1.0);
  // A point is a crisp dot. It streaks into a dash only while it is
  // being thrown: for the tenth of a second after its band is yanked
  // or leaps (the harder the jump, the longer the streak), and on the
  // loose sparks tearing off the outside.
  float thrown = max(uStrainK * smoothstep(0.08, 0.32, abs(bw)), 0.35 * loose);
  float elong = clamp(dl / 10.0, 0.0, 1.0) * thrown * mix(1.2, 2.4, hh.x) * (1.0 - 0.6 * isRay);
  float dlen = r * (1.0 + elong);
  e /= 1.0 + 0.30 * elong;
  vCol = vec4(e, 0.0, max(0.5 * e * gk * uGhostCold, cold * vis * mix(1.0, uGhost, gk)), tint);
  vShape = vec3(r, dlen, ceil(2.0 * dlen) + 1.0);
  gl_PointSize = vShape.z;
  gl_Position = cw;
}
`;

export const CLOUD_FS = `${HEADER}
flat in vec4 vCol;
flat in vec3 vShape;
flat in vec2 vDir;
out vec4 o;
void main(){
  // (gl_PointCoord runs top-down; the dash's axis is in NDC, bottom-up.)
  vec2 pc = (gl_PointCoord - 0.5) * vShape.z;
  pc.y = -pc.y;
  float al = abs(dot(pc, vDir));
  float ac = abs(dot(pc, vec2(-vDir.y, vDir.x)));
  float cov = clamp(vShape.x + 0.5 - ac, 0.0, 1.0) * clamp(vShape.y + 0.5 - al, 0.0, 1.0);
  o = vec4(vCol.rgb * cov, vCol.a * step(0.4, cov));
}
`;
