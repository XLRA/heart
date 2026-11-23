/* ──────────────────────────────────────────────────────────────
   Feedback pixel-sort, bloom, final composite.

   Upstream passes write three scalars, not colours:
     R  energy   how much light
     G  heat     incandescent horizontal streaks
     B  violet   cool rim light in the mid-shadows
   The composite is the only place a colour is produced. Energy
   runs up a fixed black → crimson ramp; heat pushes that toward
   red-orange and warm white; violet adds a desaturated lavender.
   Because the accents each have their own channel, they can only
   appear where the wall pass explicitly put them.
   ────────────────────────────────────────────────────────────── */

import { HEADER, COMMON } from './common.glsl';

/* ── Ping-pong feedback ───────────────────────────────────────
   out = max(scene, carried(prev), held(prev))

   "Carried" is the pixel-sort: each pixel looks UPSTREAM along a
   direction and takes the brightest previous value there, decayed.
   A bright source drags a streak downstream that is brightest at
   the source and falls off monotonically — the ordered ramp a true
   per-span sort produces — and because it is a thresholded max
   rather than an average, the streak stays sharp and ends abruptly.

   Only a hashed subset of thread-wide columns carries. The subset
   is very sparse at rest and widens with local glow and strain.
   Under a flare some row bands carry horizontally instead — the
   shear-tear. "Held" is the in-place afterimage. */
export const FEEDBACK_FS = `${HEADER}${COMMON}
in vec2 vUv;
out vec4 o;

uniform sampler2D uScene;
uniform sampler2D uPrev;
uniform int   uTaps;     // governor-controlled; set on tier change only

void main(){
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uScene, ip, 0);
  vec4 pv = texelFetch(uPrev, ip, 0);

  float xw = mix(uXL, uXR, vUv.x);
  vec4 f = fieldAt(xw);
  float g = clamp(f.g, 0.0, 1.6);
  float g1 = min(g, 1.0);
  float st = clamp(f.b, 0.0, 1.5);
  float k = uRes.y / 1080.0;

  // Comb columns, one thread wide. The pattern holds for a few
  // ticks so a streak has time to grow, then reshuffles.
  float cw = max(1.0, floor(2.5 * k + 0.5));
  float cid = floor(gl_FragCoord.x / cw);
  float epoch = floor(uTick / 5.0);
  float cr = hash21(vec2(cid, epoch + uSeed.x));
  float cs = hash21(vec2(cid * 1.7 + 3.0, uSeed.y));
  float density = 0.03 + 0.55 * g1 + 0.16 * st;
  float colOn = step(1.0 - density, cr);
  float dirV = cs < 0.3 ? -1.0 : 1.0;

  // Tear rows — only where a flare is actually hot.
  float rh = max(2.0, floor(mix(2.0, 14.0, hash11(floor(gl_FragCoord.y / (18.0 * k)) + uTick)) * k));
  float rid = floor(gl_FragCoord.y / rh);
  float rr = hash21(vec2(rid, uTick + 11.0));
  float rs = hash21(vec2(rid * 2.3, uTick + 29.0));
  // Tears stay inside the wall's rows — nothing rips the void.
  float inWall = step(0.30, vUv.y) * step(vUv.y, 0.79);
  float tear = step(1.0 - 0.09 * smoothstep(0.35, 1.0, g), rr) * inWall;

  vec2 dir = mix(vec2(0.0, dirV), vec2(rs < 0.5 ? -1.0 : 1.0, 0.0), tear);
  // Vertical carry is short: thread tips spike a few percent of the
  // wall's height at most, with a wispy decay.
  float lenV = (4.0 + 11.0 * cs) * (0.20 + 0.32 * g);
  float lenH = 30.0 * g * (0.4 + rs);
  float len = mix(lenV, lenH, tear) * k * uDt60 * uSmear;

  float carry = 0.0;
  if (max(colOn, tear) > 0.5 && len > 0.5) {
    ivec2 hi = ivec2(uRes) - 1;
    for (int i = 1; i <= uTaps; i++) {
      float fi = float(i) / float(uTaps);
      ivec2 q = clamp(ip - ivec2(dir * (fi * len)), ivec2(0), hi);
      carry = max(carry, texelFetch(uPrev, q, 0).r * (1.0 - 0.35 * fi));
    }
  }
  // Nonlinear decay with a hard floor: streaks end, they do not fade out.
  float thr = mix(0.42, 0.30, g1);
  carry *= smoothstep(thr, thr + 0.08, carry);
  carry = max(0.0, carry * mix(0.78, 0.85, g1) - 0.014);

  float hold = max(0.0, pv.r * mix(0.25, 0.84, min(g + 0.5 * st, 1.0)) * uSmear - 0.02);

  float E = max(s.r, max(carry, hold));
  float heat = max(s.g, pv.g * 0.55 - 0.03);
  // Displacement tint lingers a few frames, so a snap-back leaves a
  // brief pink ghost where the sheet was.
  float tint = max(s.a, pv.a * 0.82 - 0.03);
  o = vec4(E, heat, s.b, tint);
}
`;

/* ── Bloom: threshold, then separable blur ─────────────────────
   Two channels: energy above a high threshold, and heat. Bloom is
   added back as energy and heat, so it only pushes a pixel further
   along the same ramp. */
export const BRIGHT_FS = `${HEADER}
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
void main(){
  vec4 c = texture(uTex, vUv);
  float m = max(0.0, c.r - 0.72) * 2.4;
  o = vec4(min(m, 1.0), c.g, 0.0, 1.0);
}
`;

export const BLUR_FS = `${HEADER}
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uDir;   // one texel along the blur axis
void main(){
  vec2 c = texture(uTex, vUv).rg * 0.2270270270;
  c += (texture(uTex, vUv + uDir * 1.3846153846).rg
      + texture(uTex, vUv - uDir * 1.3846153846).rg) * 0.3162162162;
  c += (texture(uTex, vUv + uDir * 3.2307692308).rg
      + texture(uTex, vUv - uDir * 3.2307692308).rg) * 0.0702702703;
  o = vec4(c, 0.0, 1.0);
}
`;

/* ── Optical composite ────────────────────────────────────────
   In order: stepped shear-tear, chromatic split, bloom, faint
   scanlines and sparse glitch hairlines, the envelope that forces
   the outer viewport to exactly zero, ordered Bayer dither in the
   dark falloff, and finally the scalar → colour mapping. */
export const COMPOSITE_FS = `${HEADER}${COMMON}
in vec2 vUv;
out vec4 o;

uniform sampler2D uFb;
uniform sampler2D uBloomA;   // tight
uniform sampler2D uBloomB;   // wide

float bayer2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a){ return bayer4(0.5 * a) * 0.25 + bayer2(a); }

// Energy ramp: black → deep arterial crimson → peak red.
// Energy 0 is #000000 exactly.
vec3 ramp(float e){
  const vec3 c1 = vec3(0.431, 0.0, 0.039);   // #6e000a
  const vec3 c2 = vec3(0.851, 0.0, 0.094);   // #d90018
  const vec3 c3 = vec3(1.0, 0.102, 0.180);   // #ff1a2e
  e = clamp(e, 0.0, 1.0);
  if (e < 0.34) return c1 * (e / 0.34);
  if (e < 0.74) return mix(c1, c2, (e - 0.34) / 0.40);
  return mix(c2, c3, (e - 0.74) / 0.26);
}

void main(){
  vec2 uv = vUv;
  float ndcY = uv.y * 2.0 - 1.0;
  float xw = mix(uXL, uXR, uv.x);
  vec4 f = fieldAt(xw);
  float g = clamp(f.g, 0.0, 1.6);

  // Slice tears. For a tenth of a second after an interrupt (a
  // yank-back, a forward leap) the picture itself shears: a handful
  // of horizontal bands across the rupture, 4 to 32 px tall, jump 10
  // to 55 px sideways (wall and cloud together) and snap back.
  // Between interrupts there are none.
  float wy = uCamPos.y + (ndcY - uShiftY) * uTanHalf * uCamPos.z;
  float act = 0.0;
  for (int i = 0; i < EV_N; i++) {
    vec4 eb = uEv[2 * i + 1];
    if (eb.y < 0.02) continue;
    vec4 ea = uEv[2 * i];
    vec2 dd = (vec2(xw, wy) - ea.xy) / (ea.zw * vec2(1.35, 1.25));
    act = max(act, eb.y * (1.0 - eb.w) * exp(-dot(dd, dd)));
  }
  float px = uCanvas.y / 1080.0;
  float cellH = 32.0 * px;
  float cell = floor(gl_FragCoord.y / cellH);
  float nsub = 1.0 + floor(hash21(vec2(cell, uTick)) * 4.0);
  float bandId = cell * 8.0 + floor(fract(gl_FragCoord.y / cellH) * nsub);
  float lasts = step(0.5, hash11(bandId * 0.73));
  float tk = mix(uTick, floor(uTick / 2.0) + 0.5, lasts);
  float sel = hash21(vec2(bandId, tk));
  float sub = hash21(vec2(bandId * 3.1, tk + 5.0));
  float tearOn = step(1.0 - 0.34 * uStrainK * smoothstep(0.18, 0.60, act), sel)
               * step(-0.44, ndcY) * step(ndcY, 0.92) * uShear;
  uv.x += tearOn * (sub < 0.5 ? -1.0 : 1.0) * mix(10.0, 55.0, fract(sub * 7.3)) * px / uCanvas.x;

  vec4 c = texture(uFb, uv);
  // ICE split: along a tear, red and cold blue part company by 3 to 8 px.
  float splitPx = mix(3.0, 8.0, fract(sub * 3.7)) * px / uCanvas.x;
  float iceSplit = tearOn * max(0.0, texture(uFb, uv + vec2(splitPx, 0.0)).r - c.r) * (0.4 + 0.6 * uStrainK);
  float gate = smoothstep(0.25, 0.8, c.g + 0.6 * smoothstep(0.4, 1.2, g));

  // Chromatic split in energy space, only where it is hot.
  float off = (1.0 + 1.5 * gate) * uDpx / uCanvas.x;
  float eL = texture(uFb, uv - vec2(off, 0.0)).r;
  float eR = texture(uFb, uv + vec2(off, 0.0)).r;
  float E = mix(c.r, eL, gate * 0.6);
  float cyan = max(0.0, eR - c.r) * gate;

  vec2 bloom = texture(uBloomA, vUv).rg * 0.55 + texture(uBloomB, vUv).rg * 0.60;
  E += bloom.r;
  float heat = clamp(c.g + bloom.g * 0.45, 0.0, 1.0);

  // Faint scanlines (the bead mesh already carries most of this).
  float line = step(0.5, fract(gl_FragCoord.y / (2.0 * uDpx)));
  E *= 1.0 - line * (0.03 + 0.18 * gate);

  // Sparse razor-thin glitch hairlines that bleed into the flanks.
  float row = floor(gl_FragCoord.y / uDpx);
  float hl = step(0.988, hash21(vec2(row, floor(uTick / 2.0) + uSeed.z)));
  float hlSpan = step(hash21(vec2(row * 1.3, 4.0)), 0.5 + 0.5 * sin(uv.x * 9.0 + row));
  float inBand = step(-0.5, ndcY) * step(ndcY, 0.66);
  E += hl * hlSpan * inBand * 0.075 * uShear;

  // Outer viewport resolves to true black.
  // (The top limit sits near the edge: a heaving crest rises well
  // above the resting wall and must not be cut flat.)
  float env = (1.0 - smoothstep(0.94, 0.995, ndcY)) * smoothstep(-1.0, -0.93, ndcY);
  E *= env;

  // Ordered dither in the dark falloff: the light dissolves into
  // grain, not a smooth gradient. floor(0 + b) = 0, so zero stays zero.
  float b = bayer8(floor(gl_FragCoord.xy / uDpx));
  const float q = 0.055;
  float Eq = floor(E / q + b) * q;
  E = mix(Eq, E, smoothstep(0.22, 0.40, E));

  vec3 col = ramp(E);
  // Heat: red-orange, then incandescent warm white at the core.
  heat *= env;
  col = mix(col, vec3(1.0, 0.180, 0.094), smoothstep(0.12, 0.55, heat));   // #ff2e18
  col = mix(col, vec3(1.0, 0.910, 0.800), smoothstep(0.55, 0.98, heat));   // #ffe8cc
  // Pulse tint. A flushed region of the wall runs from crimson
  // through magenta; the cloud's trails sit in that range, its outer
  // shell is rose, and only its sparkling crest reaches white.
  float lum = clamp(E * 1.35 + heat * 0.5, 0.0, 1.0);
  float d = c.a * env;
  col = mix(col, vec3(0.93, 0.03, 0.27) * mix(lum, 1.0, 0.25), smoothstep(0.08, 0.30, d) * 0.75);
  col = mix(col, vec3(1.0, 0.09, 0.40) * mix(lum, 1.0, 0.35), smoothstep(0.30, 0.52, d) * 0.90);
  col = mix(col, vec3(1.0, 0.62, 0.77) * mix(lum, 1.0, 0.55), smoothstep(0.50, 0.68, d) * 0.90);    // #ff9ec4
  col = mix(col, vec3(1.0, 0.96, 0.98) * mix(lum, 1.0, 0.75), smoothstep(0.68, 0.86, d) * 0.96);    // #fff5fa
  // Cold light: electric steel-blue to cobalt, wandering between the
  // two across the wall.
  float cn = vnoise3(vec3(xw * 1.1, vUv.y * 2.6, uTime * 0.09) + uSeed.yzx);
  vec3 cool = mix(vec3(0.16, 0.36, 0.88), vec3(0.32, 0.48, 0.95), smoothstep(0.35, 0.65, cn));
  // At full strength it is the wall's ICE: sharper, electric cobalt.
  cool = mix(cool, vec3(0.14, 0.50, 1.0), smoothstep(0.72, 0.98, c.b));
  col += cool * c.b * env * 1.20;
  col += vec3(0.0, 0.94, 1.0) * min(cyan, 1.0) * 0.05 * env;
  col += vec3(0.22, 0.58, 1.0) * min(iceSplit, 1.0) * 0.60 * env;
  o = vec4(col, 1.0);
}
`;
