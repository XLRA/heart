/* ──────────────────────────────────────────────────────────────
   Breach engine — what pushes through the wall, and when.

   The wall itself never moves. A breakthrough is two things layered
   on a rigid curtain: a flush of light across a region of it, and a
   cloud of points lifting straight out of that region toward the
   viewer (shaders/cloud.glsl.ts). Both are described here as EVENTS:
   up to EV_N soft regions on the wall plane, each eight floats —

     x, y      centre on the wall (world units)
     rx, ry    radii
     level     how far its points are pushed out, 0..1 (a held click
               and a forward leap go a little past 1)
     flush     how brightly the wall under it is lit, 0..1
     seed      fresh per event: its outline and its billow never
               repeat. A negative seed marks a cold (cobalt) twitch.
     fade      0 while it stands; 0..1 as it thins out and recedes

   Slot 0 is the wide strain rupture, 1–2 the localized breakthrough
   zones, 3–5 belong to the visitor's hand (the last of those is
   borrowed by the calm phase's probe twitches while it is free).

   GLITCHY SMOOTHNESS. Two things are layered, and neither is the
   whole motion:

   • The BASE is continuous. Every event follows smooth envelopes at
     the display's own frame rate: it pushes out, creeps at its peak,
     recedes. The cloud's billow flows on a smooth clock.

   • On top, an irregular scheduler fires INTERRUPTS while anything
     is pushing: a tug-of-war between what is behind the wall and the
     wall itself. Each is a single-frame teleport, after which the
     smooth motion simply carries on from wherever it landed:

       yank-back     the wall's ICE shoves the push back by 20–38%
                     and rewinds the billow a little
       forward leap  the push lurches 18–34% further out, into a
                     later, wilder pose
       hitch         everything about the breakthrough freezes for
                     110–210 ms, then lets go with a small jolt

     A teleport is not one jump for the whole cloud. An eruption is
     split into BANDS (irregular slices and thread-bundle zones, see
     bandWarp in the shaders), each with its own offset on the push.
     When an interrupt fires most bands take the jump; the rest lag
     a few frames behind, resist it, or lurch the other way, so part
     of the cloud is sucked back into the wall while a lobe beside
     it still claws forward. Each offset then decays: after a yank
     it hesitates for a tenth of a second under the wall's weight,
     then pushes its way out again. A yank also sends a brief
     shudder through the cloud and leaves a scar flashing down the
     threads behind it. The engine draws the pre-teleport pose once more
     as a fading ghost, and a short burst of tears (and, on a yank,
     cobalt ICE slivers) marks the instant.

   The flush never takes part in the teleports: it lights a large
   area, and a large bright region must not strobe.

   The shaders also read a 1-D "pressure field" along the wall's X
   axis (FIELD_N texels, RGBA float), rebuilt every frame:

     R  push    how hard the wall is being leaned on at this X
     G  glow    hot light: drives smear, the floor's reach
     B  strain  tension: hairline glitches
     A  probe   pointer proximity

   All state lives in typed arrays allocated here once.
   ────────────────────────────────────────────────────────────── */

export const FIELD_N = 512;
const MAX_BREACHES = 3;
const STRIDE = 16;

/** Events, and floats per event (two vec4 in the Frame block). */
export const EV_N = 6;
export const EV_FLOATS = EV_N * 8;
const E_X = 0;
const E_Y = 1;
const E_RX = 2;
const E_RY = 3;
const E_LVL = 4;
const E_FLUSH = 5;
const E_SEED = 6;
const E_FADE = 7;
/** First event slot used by the visitor's clicks. */
const EV_CLICK = 3;
/** Glow written to the pressure field per unit of flush, by slot. */
const GLOW_K = [0.22, 0.45, 0.45, 0.8, 0.8, 0.8];

/** Bands an eruption's teleports are split across. */
export const BAND_N = 4;

/** Interrupt kinds (BreachEngine.teleport, and the debug trace). */
export const I_YANK = 1;
export const I_LEAP = 2;
export const I_HITCH = 3;

// Slots in BreachEngine.p.
/** Per-frame inputs to updateBreaches. */
export const B_DT = 0; // ms
export const B_HALF_W = 1; // visible half-width of the wall (world units)
export const B_SPAN = 2; // half-width covered by the field texture
export const B_PROBE_X = 3; // pointer position on the wall (world X)
export const B_PROBE_K = 4; // pointer proximity 0..1
export const B_DRAG = 5; // extra strain under a dragging touch 0..1
/** Per-frame outputs. */
export const B_PEAK_GLOW = 6; // strongest glow of any live event this frame
export const B_PEAK_STRAIN = 7;
/** Inputs to spawnBreach. */
export const B_SPAWN_X = 8;
export const B_SPAWN_Y = 9;
export const B_SPAWN_AMP = 10;
export const B_SPAWN_RAD = 11;
/** Internal scratch. */
const B_RND = 12;
const T_LVL = 13;
const T_FLUSH = 14;
const T_FADE = 15;
const T_GROW = 16;
const T_STRAIN = 17;
/** The wall's own cycle (see newCycle). */
const H_T = 18; // ms into the current cycle
const H_CALM = 19;
const M_ATK = 20;
const M_PEAK = 21;
const M_COL = 22;
const M_KIND = 23; // 0 = wide strain rupture, 1 = localized breakthrough zones
const K_TWO = 24; // 1 when a localized breakthrough has a second zone
const K_LAG = 25; // delay of the second zone
const A_ON = 26; // 1 when this cycle has an aftershock
const A_GAP = 27; // ms between the collapse and the aftershock
const A_ATK = 28;
const A_PEAK = 29;
const A_COL = 30;
const A_AMP = 31;
const H_TOTAL = 32;
/** Outputs: pre-surge charge 0..1, and the strongest level this frame. */
export const B_CHARGE = 33;
export const B_HEART = 34;
/** Input: strength (1 = full; lower for reduced motion). */
export const B_HEART_GAIN = 35;
/** Input: 1 to let interrupts fire, 0 for the smooth base alone
 *  (reduced motion). */
export const B_JITTER = 36;
/** Per-cycle geometry, as fractions of the visible half-width. */
const G_WX = 37;
const G_WRX = 38;
const G_K1X = 39;
const G_K1RX = 40;
const G_K2X = 41;
const G_K2RX = 42;
/** Interrupt scheduler. */
const I_NEXT = 43; // ms until the next interrupt
const I_BURST = 44; // ms left of the current glitch burst
const I_FREEZE = 45; // ms left of the current hitch
const I_ACTIVE = 46; // 1 while something was pushing last frame
const I_TW_LIVE = 47; // 1 while a probe twitch was pushing last frame
/** Outputs. Glitch burst strength 0..1 (tears, dropouts), its ICE
 *  share 0..1 (cobalt slivers: yank-backs only), the fade at which
 *  the last collapse twitch knocked chunks out, and 1 while a hitch
 *  holds the breakthrough's clock still. */
export const B_STRAINK = 48;
export const B_ICEK = 49;
export const B_CHUNK = 50;
export const B_FROZEN = 51;
/** Outputs: the post-yank shudder 1..0, the slam-shut scar 1..0 and
 *  the seed that picks which thread bundles carry it. */
export const B_SHUDDER = 52;
export const B_SCAR = 53;
export const B_SCAR_SEED = 54;
const I_SHUD = 55; // ms left of the shudder, and its length
const I_SHUD_LEN = 56;
const I_SCAR = 57; // ms left of the scar, and its length
const I_SCAR_LEN = 58;
/** Outputs: world X of whatever is pushing hardest (for stereo
 *  panning), and of the last probe twitch. */
export const B_FOCUS_X = 59;
export const B_TWITCH_X = 60;
/** The silhouette behind the wall. Outputs: its centre X, half-width
 *  and height (world units), opacity 0..1 (negative: the cold slate
 *  variant) and seed. Internal: ms until the next one, ms into this
 *  one (< 0: none), its fade-in / drift / fade-out lengths, start X,
 *  speed (world units a second) and a fast-fade multiplier. */
export const B_SIL_X = 61;
export const B_SIL_W = 62;
export const B_SIL_H = 63;
export const B_SIL_A = 64;
export const B_SIL_SEED = 65;
const SIL_NEXT = 66;
const SIL_T = 67;
const SIL_DRIFT = 68;
const SIL_X0 = 69;
const SIL_V = 70;
const SIL_KILL = 71;
const SIL_COLD = 72;
/** ms left before the bed is ducked again (so it happens once). */
const CUE_ARMED = 73;
/** Probe twitches in the calm: count, then start / length (ms),
 *  x (fraction of half-width), y, radius, seed (negative = cobalt). */
const TW_N = 74;
const TW_0 = 75;
const TW_STRIDE = 6;
const TW_MAX = 2;
const B_COUNT = TW_0 + TW_STRIDE * TW_MAX;

// Slot layout of one breach (a click).
const ACTIVE = 0;
const X = 1;
const PHASE = 2;
const PT = 3; // ms into the current phase
const DB = 5;
const DC = 6;
const AMP = 7;
const RAD = 8;
const HELD = 9; // 1 while the pointer is still down
const Y = 10;
const C_LVL = 11; // values captured at the moment the release begins
const C_GLOW = 12;
const SEED = 14;
const C_RADK = 15;

const PH_B = 1;
const PH_S = 2;
const PH_C = 3;

export interface BreachEngine {
  /** FIELD_N × RGBA, uploaded to the field texture each frame. */
  field: Float32Array;
  /** EV_N events × 8 floats: what the shaders see this frame. */
  ev: Float32Array;
  /** Each event's smooth base level, before its teleport offset. */
  base: Float32Array;
  /** Each band's teleport offset, as a fraction of the base level:
   *  set by an interrupt, then decaying smoothly to zero. */
  band: Float32Array;
  /** A jump a lagging band has yet to take, and the ms until it does. */
  bandPend: Float32Array;
  bandDelay: Float32Array;
  /** ms since each band last jumped. */
  bandAge: Float32Array;
  slots: Float32Array;
  rng: Uint32Array;
  p: Float64Array;
  activeCount: number;
  /** Set on the frame an interrupt fires: its kind (I_YANK, I_LEAP,
   *  I_HITCH), and how far to jump the billow's clock. The renderer
   *  reads both, then clears them. */
  teleport: number;
  poseJump: number;
  /** Interrupts fired so far (debug). */
  interrupts: number;
  /** How hard the interrupt was, 0.5 or 1: the ghost is fainter
   *  behind a small one. */
  strength: number;
  /** Set when the yank that just fired was a probe twitch snapping
   *  shut (a quiet tick, not a thud). The renderer clears it. */
  twitchSnap: boolean;
  /** Sound cues, set for one frame and cleared by the renderer:
   *  1 = a breakthrough is a fifth of a second away, 2 = it has begun. */
  cue: number;
  /** Debug: bring the next silhouette on now. */
  silNow: boolean;
  /** Debug: fire an interrupt of this kind on the next frame. */
  force: number;
}

export function createBreachEngine(seed: number): BreachEngine {
  const rng = new Uint32Array(1);
  rng[0] = seed >>> 0 || 0x1234567;
  const p = new Float64Array(B_COUNT);
  p[B_HEART_GAIN] = 1;
  p[SIL_T] = -1;
  p[SIL_NEXT] = 11000;
  p[B_JITTER] = 1;
  const e: BreachEngine = {
    field: new Float32Array(FIELD_N * 4),
    ev: new Float32Array(EV_FLOATS),
    base: new Float32Array(EV_N),
    band: new Float32Array(BAND_N),
    bandPend: new Float32Array(BAND_N),
    bandDelay: new Float32Array(BAND_N),
    bandAge: new Float32Array(BAND_N),
    slots: new Float32Array(MAX_BREACHES * STRIDE),
    rng,
    p,
    activeCount: 0,
    teleport: 0,
    poseJump: 0,
    interrupts: 0,
    force: 0,
    twitchSnap: false,
    cue: 0,
    silNow: false,
    strength: 1,
  };
  newCycle(e);
  // The first attempt should not keep a visitor waiting: a short
  // calm, with one probe twitch in it.
  p[H_TOTAL] -= p[H_CALM] - 3600;
  p[H_CALM] = 3600;
  p[TW_N] = 1;
  p[TW_0] = 1500;
  return e;
}

/* ── The wall's own cycle ─────────────────────────────────────
   Dread, not rhythm. The wall sits dead still for a long while,
   something tests it once or twice, and then one attempt is made:

     brooding calm      6.5–11.5 s  nothing moves, except 1–2 probe
                                    twitches: a small patch begins to
                                    push for ~0.2 s and is yanked back
                                    to nothing in a single frame
     one breakthrough   65%: one or two localized zones
                        35%: a wide strain rupture
                        strained push 1.4–2.4 s, tug-of-war peak
                        2.4–3.8 s, resisting collapse 3–4.4 s
     aftershock         25% of the time, 2.5–4 s later, smaller

   Everything is re-rolled each cycle: durations, places, sizes, seeds. */
function newCycle(e: BreachEngine): void {
  const p = e.p;
  const ev = e.ev;
  p[H_CALM] = span(e, 6500, 11500);
  roll(e);
  p[M_KIND] = p[B_RND] < 0.65 ? 1 : 0;
  rollAttempt(e);
  roll(e);
  p[K_TWO] = p[B_RND] < 0.5 ? 1 : 0;
  p[K_LAG] = span(e, 300, 1100);
  roll(e);
  p[A_ON] = p[B_RND] < 0.25 ? 1 : 0;
  p[A_GAP] = span(e, 2500, 4000);
  p[A_ATK] = span(e, 800, 1200);
  p[A_PEAK] = span(e, 900, 1500);
  p[A_COL] = span(e, 1800, 2600);
  roll(e);
  p[A_AMP] = 0.5 + p[B_RND] * 0.15;

  // The wide rupture: a broad region of the upper-middle wall.
  roll(e);
  p[G_WX] = (p[B_RND] * 2 - 1) * 0.45;
  roll(e);
  p[G_WRX] = 0.36 + p[B_RND] * 0.08;
  roll(e);
  ev[E_Y] = 0.56 + p[B_RND] * 0.1;
  roll(e);
  ev[E_RY] = 0.3 + p[B_RND] * 0.06;
  roll(e);
  ev[E_SEED] = 0.02 + 0.96 * p[B_RND];

  // The localized zones: small, apart from each other.
  roll(e);
  p[G_K1X] = (p[B_RND] * 2 - 1) * 0.62;
  roll(e);
  p[G_K2X] = p[G_K1X] + (p[G_K1X] > 0 ? -1 : 1) * (0.42 + p[B_RND] * 0.4);
  if (p[G_K2X] > 0.62) p[G_K2X] = 0.62;
  else if (p[G_K2X] < -0.62) p[G_K2X] = -0.62;
  for (let i = 1; i <= 2; i++) {
    const o = i * 8;
    roll(e);
    p[i === 1 ? G_K1RX : G_K2RX] = 0.11 + p[B_RND] * 0.07;
    roll(e);
    ev[o + E_Y] = 0.55 + p[B_RND] * 0.2;
    roll(e);
    ev[o + E_RY] = 0.15 + p[B_RND] * 0.07;
    roll(e);
    ev[o + E_SEED] = 0.02 + 0.96 * p[B_RND];
  }

  // Probe twitches, spread through the calm.
  roll(e);
  const n = 1 + Math.floor(p[B_RND] * 1.999);
  p[TW_N] = n;
  for (let k = 0; k < TW_MAX; k++) {
    const o = TW_0 + k * TW_STRIDE;
    roll(e);
    p[o] = 1400 + ((k + 0.15 + 0.7 * p[B_RND]) / n) * (p[H_CALM] - 3200);
    roll(e);
    p[o + 1] = 180 + p[B_RND] * 90;
    roll(e);
    p[o + 2] = (p[B_RND] * 2 - 1) * 0.72;
    roll(e);
    p[o + 3] = 0.3 + p[B_RND] * 0.48;
    roll(e);
    p[o + 4] = 0.07 + p[B_RND] * 0.06;
    roll(e);
    p[o + 5] = 0.02 + 0.96 * p[B_RND];
    roll(e);
    if (p[B_RND] < 0.45) p[o + 5] = -p[o + 5];
  }

  p[H_T] = 0;
  p[H_TOTAL] =
    p[H_CALM] + p[M_ATK] + p[M_PEAK] + p[M_COL] + p[M_KIND] * p[K_TWO] * p[K_LAG] +
    p[A_ON] * (p[A_GAP] + p[A_ATK] + p[A_PEAK] + p[A_COL]);
}

/** Durations of the breakthrough, by kind: a wide rupture is a
 *  little slower at everything than a localized zone. */
function rollAttempt(e: BreachEngine): void {
  const p = e.p;
  if (p[M_KIND] !== 0) {
    p[M_ATK] = span(e, 1400, 2000);
    p[M_PEAK] = span(e, 2400, 3400);
    p[M_COL] = span(e, 3000, 4000);
  } else {
    p[M_ATK] = span(e, 1800, 2400);
    p[M_PEAK] = span(e, 2600, 3800);
    p[M_COL] = span(e, 3400, 4400);
  }
}

/** A duration between lo and hi, then stretched ±10%. */
function span(e: BreachEngine, lo: number, hi: number): number {
  roll(e);
  const base = lo + e.p[B_RND] * (hi - lo);
  roll(e);
  return base * (0.9 + 0.2 * e.p[B_RND]);
}

function smooth(s: number): number {
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  return s * s * (3 - 2 * s);
}

/** Fast out of the gate, easing into its target. */
function easeOut(s: number): number {
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  const r = 1 - s;
  return 1 - r * r * r;
}

/** One attempt at `u` ms after it begins, as smooth envelopes: a
 *  strained push `a`, a creeping peak `pk`, a resisting collapse `c`.
 *  Level, flush, fade and radius growth are left in p[T_*]. */
function attempt(p: Float64Array, u: number, a: number, pk: number, c: number): void {
  p[T_LVL] = 0;
  p[T_FLUSH] = 0;
  p[T_FADE] = 0;
  p[T_GROW] = 1;
  if (u <= 0) return;
  if (u < a) {
    const s = u / a;
    p[T_LVL] = 0.88 * easeOut(s);
    // (The flush trails the push: brooding and subordinate while the
    // first of the cloud tears out, at full strength only at the peak.)
    p[T_FLUSH] = Math.pow(easeOut(s), 1.55);
    p[T_GROW] = 0.82 + 0.18 * easeOut(s);
    return;
  }
  if (u < a + pk) {
    const s = (u - a) / pk;
    p[T_LVL] = 0.88 + 0.12 * smooth(s);
    p[T_FLUSH] = 1;
    p[T_GROW] = 1 + 0.12 * s;
    return;
  }
  const v = (u - a - pk) / c;
  if (v >= 1) return;
  const sv = smooth(v);
  p[T_LVL] = 1 - 0.7 * sv;
  p[T_FADE] = sv;
  p[T_FLUSH] = (1 - v) * (1 - v);
  p[T_GROW] = 1.12 + 0.08 * v;
}

/** Debug: this cycle's durations in ms — calm, push, peak, collapse,
 *  aftershock gap (0 when there is none) — then its kind (0 wide,
 *  1 localized) and the time into the cycle. Allocates. */
export function heartPhases(e: BreachEngine): number[] {
  const p = e.p;
  return [p[H_CALM], p[M_ATK], p[M_PEAK], p[M_COL], p[A_ON] * p[A_GAP], p[M_KIND], p[H_T]];
}

/** Debug: jump the cycle to `offsetMs` into its breakthrough, forcing
 *  it wide (kind 1) or localized (kind 2); or to its first probe
 *  twitch (kind 3). */
export function skipToSurge(e: BreachEngine, offsetMs: number, kind: number): void {
  const p = e.p;
  if (kind === 3) {
    p[H_T] = p[TW_0] + offsetMs;
    return;
  }
  const want = kind === 2 ? 1 : 0;
  if (want !== p[M_KIND]) {
    const rest = p[H_TOTAL] - p[M_ATK] - p[M_PEAK] - p[M_COL] - p[M_KIND] * p[K_TWO] * p[K_LAG];
    p[M_KIND] = want;
    rollAttempt(e);
    p[H_TOTAL] = rest + p[M_ATK] + p[M_PEAK] + p[M_COL] + p[M_KIND] * p[K_TWO] * p[K_LAG];
  }
  p[H_T] = p[H_CALM] + offsetMs;
}

/** xorshift32 in place. The draw (0..1) is left in p[B_RND]. */
function roll(e: BreachEngine): void {
  let s = e.rng[0];
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  e.rng[0] = s;
  e.p[B_RND] = e.rng[0] / 4_294_967_296;
}

/**
 * Start a breach under the visitor's hand at p[B_SPAWN_X],
 * p[B_SPAWN_Y] with amplitude p[B_SPAWN_AMP] and radius
 * p[B_SPAWN_RAD]. Returns the slot index, or -1 if every slot is
 * still rising or held. `held` breaches sustain until releaseBreach.
 */
export function spawnBreach(e: BreachEngine, held: boolean): number {
  const s = e.slots;
  const p = e.p;
  // A free slot, or failing that the one furthest into its collapse.
  let slot = -1;
  let oldest = -1;
  for (let i = 0; i < MAX_BREACHES; i++) {
    const o = i * STRIDE;
    if (s[o + ACTIVE] === 0) {
      slot = i;
      break;
    }
    if (s[o + PHASE] === PH_C && s[o + PT] > oldest) {
      oldest = s[o + PT];
      slot = i;
    }
  }
  if (slot < 0) return -1;
  const o = slot * STRIDE;
  s[o + ACTIVE] = 1;
  s[o + X] = p[B_SPAWN_X];
  s[o + Y] = p[B_SPAWN_Y];
  s[o + PHASE] = PH_B;
  s[o + PT] = 0;
  roll(e);
  s[o + DB] = 520 + p[B_RND] * 260;
  roll(e);
  s[o + DC] = 2400 + p[B_RND] * 800;
  s[o + AMP] = p[B_SPAWN_AMP];
  s[o + RAD] = p[B_SPAWN_RAD];
  s[o + HELD] = held ? 1 : 0;
  roll(e);
  s[o + SEED] = 0.02 + 0.96 * p[B_RND];
  return slot;
}

/** Pointer released — the held breach recedes once it has risen. */
export function releaseBreach(e: BreachEngine, slot: number): void {
  if (slot < 0 || slot >= MAX_BREACHES) return;
  e.slots[slot * STRIDE + HELD] = 0;
}

/** Add one event's pressure to the field: a gaussian of radius `r`
 *  at world X `bx`. */
function splat(
  e: BreachEngine, bx: number, r: number, push: number, glow: number, strain: number,
): void {
  const field = e.field;
  const sp = e.p[B_SPAN];
  const texel = (2 * sp) / FIELD_N;
  const rG = r * 0.8;
  const rS = r * 1.5;
  const invB = 1 / (r * r);
  const invG = 1 / (rG * rG);
  const invS = 1 / (rS * rS);
  const reach = rS * 2.6;
  let i0 = Math.floor((bx - reach + sp) / texel) | 0;
  let i1 = Math.ceil((bx + reach + sp) / texel) | 0;
  if (i0 < 0) i0 = 0;
  if (i1 > FIELD_N - 1) i1 = FIELD_N - 1;
  for (let j = i0; j <= i1; j++) {
    const dx = (j + 0.5) * texel - sp - bx;
    const d2 = dx * dx;
    const k = j * 4;
    field[k] += push * Math.exp(-d2 * invB);
    field[k + 1] += glow * Math.exp(-d2 * invG);
    field[k + 2] += strain * Math.exp(-d2 * invS);
  }
}

/** Write one of the wall's own events from p[T_*]. */
function setEvent(e: BreachEngine, slot: number, x: number, rx: number, amp: number): void {
  const p = e.p;
  const o = slot * 8;
  const gain = p[B_HEART_GAIN];
  e.ev[o + E_X] = x;
  e.ev[o + E_RX] = rx * p[T_GROW];
  e.base[slot] = p[T_LVL] * amp * gain;
  e.ev[o + E_FLUSH] = p[T_FLUSH] * (amp < 1 ? 0.75 : 1) * (0.55 + 0.45 * gain);
  e.ev[o + E_FADE] = p[T_FADE];
}

/** Jump one band by `a` (a fraction of the base level). */
function jumpBand(e: BreachEngine, b: number, a: number): void {
  let w = e.band[b] + a;
  if (w < -0.55) w = -0.55;
  else if (w > 0.45) w = 0.45;
  e.band[b] = w;
  e.bandAge[b] = 0;
}

/** An interrupt lands on the bands. `amount` is the primary jump.
 *  About two bands in three take it (never fewer than one); of the
 *  rest, some lag 45–110 ms behind, some resist at a quarter of the
 *  strength, and some lurch the other way. */
function jolt(e: BreachEngine, amount: number): void {
  const p = e.p;
  const sure = e.interrupts % BAND_N;
  for (let b = 0; b < BAND_N; b++) {
    roll(e);
    const r = b === sure ? 0 : p[B_RND];
    roll(e);
    if (r < 0.66) {
      jumpBand(e, b, amount * (0.85 + 0.3 * p[B_RND]));
    } else if (r < 0.8) {
      e.bandPend[b] = amount;
      e.bandDelay[b] = 45 + 65 * p[B_RND];
    } else if (r < 0.92) {
      jumpBand(e, b, amount * 0.25);
    } else {
      jumpBand(e, b, -amount * 0.5);
    }
  }
}

/** The wall slams part of the cloud shut: a brief shudder runs
 *  through what was yanked, and a scar flashes down the threads
 *  behind it. */
function slam(e: BreachEngine): void {
  const p = e.p;
  roll(e);
  p[I_SHUD_LEN] = 100 + 60 * p[B_RND];
  p[I_SHUD] = p[I_SHUD_LEN];
  roll(e);
  p[I_SCAR_LEN] = 180 + 80 * p[B_RND];
  p[I_SCAR] = p[I_SCAR_LEN];
  roll(e);
  p[B_SCAR_SEED] = 1 + p[B_RND] * 96;
}

/** Open a short glitch burst: tears and dropouts for `ms`, and on a
 *  yank-back the wall's cobalt ICE slivers with them. */
function burst(e: BreachEngine, ms: number, ice: boolean): void {
  const p = e.p;
  p[I_BURST] = ms;
  roll(e);
  p[B_STRAINK] = 0.6 + 0.4 * p[B_RND];
  p[B_ICEK] = ice ? 1 : 0;
}

/**
 * Advance the cycle and every click by p[B_DT], fire any interrupt
 * that is due, and rebuild the events and the pressure field.
 */
export function updateBreaches(e: BreachEngine): void {
  const field = e.field;
  const ev = e.ev;
  const base = e.base;
  const band = e.band;
  const s = e.slots;
  const p = e.p;
  const real = p[B_DT];
  const hw = p[B_HALF_W];
  field.fill(0);

  // ── Hitch ──────────────────────────────────────────────────
  // While one lasts, the breakthrough's own clock stands still (the
  // renderer holds the billow's clock too). The dust keeps drifting.
  let dtMs = real;
  p[B_FROZEN] = 0;
  if (p[I_FREEZE] > 0) {
    p[I_FREEZE] -= real;
    dtMs = 0;
    p[B_FROZEN] = 1;
    if (p[I_FREEZE] <= 0) {
      // It lets go with a small jolt, each band its own way.
      for (let b = 0; b < BAND_N; b++) {
        roll(e);
        jumpBand(e, b, (p[B_RND] < 0.5 ? -1 : 1) * 0.1);
      }
      burst(e, 70, false);
    }
  }
  if (p[I_BURST] > 0) {
    p[I_BURST] -= real;
    if (p[I_BURST] <= 0) {
      p[B_STRAINK] = 0;
      p[B_ICEK] = 0;
    }
  }

  // ── The wall's own cycle ───────────────────────────────────
  p[H_T] += dtMs;
  if (p[H_T] >= p[H_TOTAL]) newCycle(e);
  const tm = p[H_T];
  const tw = tm - p[H_CALM];
  // Sound cues: the bed is ducked a fifth of a second before the
  // push begins, and let go on the frame it does.
  if (tw > -210 && tw <= 0 && p[CUE_ARMED] === 0) {
    p[CUE_ARMED] = 1;
    e.cue = 1;
  } else if (tw > 0 && p[CUE_ARMED] === 1) {
    p[CUE_ARMED] = 2;
    e.cue = 2;
  } else if (tw < -210) {
    p[CUE_ARMED] = 0;
  }
  // Charge: a cool tension wells up through the last of the calm and
  // bleeds off into the push.
  p[B_CHARGE] = 0;
  if (tw > -1500 && tw <= 0) p[B_CHARGE] = smooth(1 + tw / 1500);
  else if (tw > 0 && tw < 1200) p[B_CHARGE] = 1 - tw / 1200;

  const major = p[M_ATK] + p[M_PEAK] + p[M_COL] + p[M_KIND] * p[K_TWO] * p[K_LAG];
  const ta = tw - major - p[A_GAP];
  const after = p[A_ON] !== 0 && ta > 0;
  const wide = p[M_KIND] === 0;

  // Slot 0: the wide strain rupture.
  if (after) attempt(p, wide ? ta : 0, p[A_ATK], p[A_PEAK], p[A_COL]);
  else attempt(p, wide ? tw : 0, p[M_ATK], p[M_PEAK], p[M_COL]);
  setEvent(e, 0, p[G_WX] * hw, p[G_WRX] * hw, after ? p[A_AMP] : 1);

  // Slots 1–2: the localized zones.
  for (let i = 1; i <= 2; i++) {
    const o = i * 8;
    const lag = i === 2 ? p[K_LAG] : 0;
    const on = !wide && (i === 1 || p[K_TWO] !== 0);
    if (after) attempt(p, on && i === 1 ? ta : 0, p[A_ATK], p[A_PEAK], p[A_COL]);
    else attempt(p, on ? tw - lag : 0, p[M_ATK], p[M_PEAK], p[M_COL]);
    // (Never narrower than its height would allow: a portrait wall
    // is less than one unit wide.)
    p[T_STRAIN] = p[i === 1 ? G_K1RX : G_K2RX] * hw;
    if (p[T_STRAIN] < 0.7 * ev[o + E_RY]) p[T_STRAIN] = 0.7 * ev[o + E_RY];
    setEvent(e, i, p[i === 1 ? G_K1X : G_K2X] * hw, p[T_STRAIN], after ? p[A_AMP] : 1);
  }

  // ── The visitor's breaches ─────────────────────────────────
  let active = 0;
  for (let i = 0; i < MAX_BREACHES; i++) {
    const o = i * STRIDE;
    const q = (EV_CLICK + i) * 8;
    if (s[o + ACTIVE] === 0) {
      base[EV_CLICK + i] = 0;
      ev[q + E_FLUSH] = 0;
      ev[q + E_FADE] = 0;
      continue;
    }
    const amp = s[o + AMP];
    s[o + PT] += dtMs;
    if (s[o + PHASE] === PH_B && s[o + PT] >= s[o + DB]) {
      s[o + PT] -= s[o + DB];
      if (s[o + HELD] !== 0) {
        s[o + PHASE] = PH_S;
      } else {
        s[o + PHASE] = PH_C;
        s[o + C_LVL] = amp;
        s[o + C_GLOW] = amp;
        s[o + C_RADK] = 1;
      }
    }
    if (s[o + PHASE] === PH_S && s[o + HELD] === 0) {
      // Capture how far the hold had escalated.
      const hold = 1 - Math.exp(-s[o + PT] / 1400);
      s[o + C_LVL] = amp * (1 + 0.3 * hold);
      s[o + C_GLOW] = amp * (1 + 0.5 * hold);
      s[o + C_RADK] = 1 + 0.45 * hold;
      s[o + PT] = 0;
      s[o + PHASE] = PH_C;
    }

    const phase = s[o + PHASE] | 0;
    const pt = s[o + PT];
    let glow = 0;
    p[T_FADE] = 0;
    if (phase === PH_B) {
      const u = easeOut(pt / s[o + DB]);
      p[T_LVL] = amp * u;
      glow = amp * (0.3 + 0.7 * u);
      p[T_GROW] = 0.8 + 0.2 * u;
    } else if (phase === PH_S) {
      const hold = 1 - Math.exp(-pt / 1400);
      p[T_LVL] = amp * (1 + 0.3 * hold);
      glow = amp * (1 + 0.5 * hold);
      p[T_GROW] = 1 + 0.45 * hold;
    } else {
      const v = pt / s[o + DC];
      if (v >= 1) {
        s[o + ACTIVE] = 0;
        base[EV_CLICK + i] = 0;
        ev[q + E_FLUSH] = 0;
        ev[q + E_FADE] = 0;
        continue;
      }
      // It recedes the way the wall's own attempts do.
      const sv = smooth(v);
      p[T_LVL] = s[o + C_LVL] * (1 - 0.7 * sv);
      p[T_FADE] = sv;
      glow = s[o + C_GLOW] * (1 - v) * (1 - v);
      p[T_GROW] = s[o + C_RADK] * (1 + 0.1 * v);
    }
    active++;
    const r = s[o + RAD] * p[T_GROW];
    ev[q + E_X] = s[o + X];
    ev[q + E_Y] = s[o + Y];
    ev[q + E_RX] = r;
    ev[q + E_RY] = r * 0.85;
    base[EV_CLICK + i] = p[T_LVL];
    ev[q + E_FLUSH] = glow > 1 ? 1 : glow;
    ev[q + E_SEED] = s[o + SEED];
    ev[q + E_FADE] = p[T_FADE];
  }
  e.activeCount = active;

  // A probe twitch, while the calm lasts, borrows the last of the
  // visitor's slots whenever it is free. It begins to push, smoothly,
  // and a fifth of a second later the wall yanks it back to nothing
  // in one frame.
  let twitch = false;
  if (tw < 0 && s[(MAX_BREACHES - 1) * STRIDE + ACTIVE] === 0) {
    const q = (EV_N - 1) * 8;
    for (let k = 0; k < p[TW_N]; k++) {
      const o = TW_0 + k * TW_STRIDE;
      if (tm < p[o] || tm >= p[o] + p[o + 1]) continue;
      twitch = true;
      p[B_TWITCH_X] = p[o + 2] * hw;
      const u = easeOut((tm - p[o]) / p[o + 1]);
      ev[q + E_X] = p[o + 2] * hw;
      ev[q + E_Y] = p[o + 3];
      ev[q + E_RX] = p[o + 4] * 1.6;
      ev[q + E_RY] = p[o + 4];
      base[EV_N - 1] = 0.8 * u * p[B_HEART_GAIN];
      ev[q + E_FLUSH] = 0.4 + 0.6 * u;
      ev[q + E_SEED] = p[o + 5];
      ev[q + E_FADE] = 0;
    }
  }
  if (!twitch && p[I_TW_LIVE] !== 0 && p[B_JITTER] !== 0) {
    e.twitchSnap = true;
    e.teleport = I_YANK;
    e.strength = 1;
    e.poseJump = 0;
    e.interrupts++;
    burst(e, 130, true);
    slam(e);
  }
  p[I_TW_LIVE] = twitch ? 1 : 0;

  // ── Interrupts ─────────────────────────────────────────────
  let pushing = false;
  let rising = false;
  let fading = 0;
  for (let i = 0; i < EV_N; i++) {
    if (base[i] <= 0.05) continue;
    if (twitch && i === EV_N - 1) continue;
    pushing = true;
    if (ev[i * 8 + E_FADE] > 0) {
      if (ev[i * 8 + E_FADE] > fading) fading = ev[i * 8 + E_FADE];
    } else {
      rising = true;
    }
  }
  if (!pushing) {
    p[I_ACTIVE] = 0;
    p[B_CHUNK] = 0;
    if (!twitch) {
      for (let b = 0; b < BAND_N; b++) {
        band[b] = 0;
        e.bandPend[b] = 0;
      }
    }
  } else if (p[B_JITTER] !== 0) {
    if (p[I_ACTIVE] === 0) {
      // Something has just begun to push: the first fight comes soon.
      p[I_ACTIVE] = 1;
      roll(e);
      p[I_NEXT] = 380 + p[B_RND] * 420;
    }
    p[I_NEXT] -= dtMs;
    if (e.force !== 0) p[I_NEXT] = 0;
    if (p[I_NEXT] <= 0 && dtMs > 0) {
      e.interrupts++;
      roll(e);
      let pick = p[B_RND];
      if (e.force === I_YANK) pick = 0;
      else if (e.force === I_LEAP) pick = 0.6;
      else if (e.force === I_HITCH) pick = 0.9;
      const forced = e.force !== 0;
      e.force = 0;
      if (!rising && !forced) {
        // Collapsing: a desperate forward twitch, and whole chunks of
        // the cloud are knocked out as the wall slams back on it.
        e.teleport = I_LEAP;
        e.strength = 1;
        roll(e);
        jolt(e, 0.18 + 0.08 * p[B_RND]);
        roll(e);
        e.poseJump = 1.2 + 1.6 * p[B_RND];
        p[B_CHUNK] = fading;
        burst(e, 110, false);
        slam(e);
        roll(e);
        p[I_NEXT] = 1100 + p[B_RND] * 900;
      } else {
        // Half of them are full-blooded; the other half only half as
        // hard: it is knocked back a little, or edges forward.
        roll(e);
        const hard = forced || p[B_RND] < 0.5 ? 1 : 0.5;
        e.strength = hard;
        if (pick < 0.45) {
          // The wall's ICE yanks it back.
          e.teleport = I_YANK;
          roll(e);
          jolt(e, -(0.22 + 0.18 * p[B_RND]) * hard);
          roll(e);
          e.poseJump = -(0.6 + 0.6 * p[B_RND]) * hard;
          roll(e);
          burst(e, 90 + 70 * p[B_RND], true);
          slam(e);
        } else if (pick < 0.8) {
          // What is behind it tears forward.
          e.teleport = I_LEAP;
          roll(e);
          jolt(e, (0.18 + 0.16 * p[B_RND]) * hard);
          roll(e);
          e.poseJump = (2 + 2.5 * p[B_RND]) * hard;
          roll(e);
          burst(e, 70 + 70 * p[B_RND], false);
        } else {
          // A buffer hitch: it freezes dead.
          e.teleport = I_HITCH;
          e.poseJump = 0;
          roll(e);
          p[I_FREEZE] = 110 + 100 * p[B_RND];
        }
        roll(e);
        p[I_NEXT] = 280 + p[B_RND] * 340;
        // Now and then a double-tap.
        roll(e);
        if (p[B_RND] < 0.2) {
          roll(e);
          p[I_NEXT] = 120 + p[B_RND] * 70;
        }
      }
    }
  }

  // ── Bands ──────────────────────────────────────────────────
  // Lagging bands take their jump when their delay runs out. Every
  // offset then decays smoothly, so a leap settles and a yanked band
  // pushes its way back out; but a yanked band first hesitates for
  // about 120 ms, held under the wall's weight, before it gives.
  let top = 0;
  let mean = 0;
  for (let b = 0; b < BAND_N; b++) {
    if (e.bandPend[b] !== 0) {
      e.bandDelay[b] -= dtMs;
      if (e.bandDelay[b] <= 0) {
        jumpBand(e, b, e.bandPend[b]);
        e.bandPend[b] = 0;
      }
    }
    e.bandAge[b] += dtMs;
    band[b] *= Math.exp(-dtMs / (band[b] < 0 && e.bandAge[b] < 120 ? 1600 : 400));
    if (band[b] > top) top = band[b];
    mean += band[b] / BAND_N;
  }
  if (p[I_SHUD] > 0) p[I_SHUD] -= real;
  if (p[I_SCAR] > 0) p[I_SCAR] -= real;
  p[B_SHUDDER] = p[I_SHUD] > 0 ? p[I_SHUD] / p[I_SHUD_LEN] : 0;
  p[B_SCAR] = p[I_SCAR] > 0 ? p[I_SCAR] / p[I_SCAR_LEN] : 0;

  // ── Events: the smooth base. (The shaders add each point's own
  // band offset to it.) ──
  p[B_HEART] = 0;
  for (let i = 0; i < EV_N; i++) {
    const lvl = base[i] > 1.35 ? 1.35 : base[i];
    ev[i * 8 + E_LVL] = lvl;
    if (lvl * (1 + top) > p[B_HEART]) {
      p[B_HEART] = lvl * (1 + top);
      p[B_FOCUS_X] = ev[i * 8 + E_X];
    }
  }

  // ── Pressure field ─────────────────────────────────────────
  p[B_PEAK_GLOW] = 0;
  p[B_PEAK_STRAIN] = 0;
  for (let i = 0; i < EV_N; i++) {
    const o = i * 8;
    const lvl = ev[o + E_LVL];
    const fl = ev[o + E_FLUSH];
    if (lvl <= 0 && fl <= 0) continue;
    const glow = GLOW_K[i] * fl;
    const strain = (i === 0 ? 0.5 : i < EV_CLICK ? 0.7 : 1) * (lvl > 1 ? 1 : lvl) * (1 - ev[o + E_FADE]);
    // (The push the floor feels is what the bands are doing on average:
    // it surges with a leap and recoils with a yank.)
    splat(e, ev[o + E_X], ev[o + E_RX] * 1.2, 0.8 * lvl * (1 + mean), glow, strain);
    if (glow > p[B_PEAK_GLOW]) p[B_PEAK_GLOW] = glow;
    if (strain > p[B_PEAK_STRAIN]) p[B_PEAK_STRAIN] = strain;
  }

  // ── Something behind the wall ──────────────────────────────
  // Rarely, and only in the calm, a towering shape drifts across
  // the deep strata behind the curtain for two or three seconds: a
  // few staggered slabs, barely above black, glimpsed through the
  // dark cavities. If anything breaks through, or the visitor
  // touches the wall, it is gone within a tenth of a second.
  const quiet = tw < -2000 && active === 0 && !twitch && !pushing;
  if (p[SIL_T] < 0) {
    p[B_SIL_A] = 0;
    if (quiet) p[SIL_NEXT] -= real;
    if ((p[SIL_NEXT] <= 0 && quiet && tw < -5200) || e.silNow) {
      e.silNow = false;
      roll(e);
      p[SIL_NEXT] = 18000 + p[B_RND] * 16000;
      p[SIL_T] = 0;
      p[SIL_KILL] = 1;
      roll(e);
      p[SIL_DRIFT] = 1200 + p[B_RND] * 1000;
      roll(e);
      p[B_SIL_W] = hw * (0.16 + 0.12 * p[B_RND]);
      roll(e);
      p[B_SIL_H] = 0.58 + 0.28 * p[B_RND];
      roll(e);
      // 0.018 to 0.032 wall-widths a second, either way.
      p[SIL_V] = 2 * hw * (0.018 + 0.014 * p[B_RND]);
      roll(e);
      if (p[B_RND] < 0.5) p[SIL_V] = -p[SIL_V];
      roll(e);
      p[SIL_X0] = (p[B_RND] * 2 - 1) * hw * 0.62;
      roll(e);
      p[B_SIL_SEED] = 1 + p[B_RND] * 96;
      roll(e);
      p[SIL_COLD] = p[B_RND] < 0.4 ? 1 : 0;
    }
  } else {
    p[SIL_T] += real;
    const life = 700 + p[SIL_DRIFT] + 600;
    if (!quiet) p[SIL_KILL] -= real / 120;
    let a = 1;
    if (p[SIL_T] < 700) a = smooth(p[SIL_T] / 700);
    else if (p[SIL_T] > 700 + p[SIL_DRIFT]) a = 1 - smooth((p[SIL_T] - 700 - p[SIL_DRIFT]) / 600);
    if (p[SIL_KILL] < 0) p[SIL_KILL] = 0;
    a *= p[SIL_KILL];
    p[B_SIL_X] = p[SIL_X0] + (p[SIL_V] * p[SIL_T]) / 1000;
    p[B_SIL_A] = p[SIL_COLD] !== 0 ? -a : a;
    if (p[SIL_T] >= life || p[SIL_KILL] <= 0) {
      p[SIL_T] = -1;
      p[B_SIL_A] = 0;
    }
  }

  // ── Pointer probe ──────────────────────────────────────────
  const probeK = p[B_PROBE_K];
  if (probeK > 0.002) {
    const sp = p[B_SPAN];
    const texel = (2 * sp) / FIELD_N;
    const probeX = p[B_PROBE_X];
    const strainK = probeK * (0.38 + 0.6 * p[B_DRAG]);
    const r = 0.24;
    const inv = 1 / (2 * r * r);
    const reach = r * 3.4;
    let i0 = Math.floor((probeX - reach + sp) / texel) | 0;
    let i1 = Math.ceil((probeX + reach + sp) / texel) | 0;
    if (i0 < 0) i0 = 0;
    if (i1 > FIELD_N - 1) i1 = FIELD_N - 1;
    for (let j = i0; j <= i1; j++) {
      const dx = (j + 0.5) * texel - sp - probeX;
      const g = Math.exp(-dx * dx * inv);
      const k = j * 4;
      field[k + 2] += g * strainK;
      field[k + 3] += g * probeK;
    }
  }
}
