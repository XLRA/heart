/**
 * Server-side metadata gathering for Track Intelligence. Server-only (used by
 * the /api/track-intel routes): upstreams either lack CORS (MusicBrainz,
 * AcousticBrainz, the Spotify embed page) or need a polite, cached, single
 * point of contact.
 *
 *   ReccoBeats      Spotify ID -> ISRC + audio features (tempo, energy, ...).
 *                   Free, no key. Stands in for Spotify's deprecated
 *                   /audio-features.
 *   Spotify embed   Spotify ID -> the track's 30 s preview MP3 (the exact
 *                   master Spotify streams). The Web API stopped returning
 *                   preview_url for new apps; the public embed page still
 *                   carries it.
 *   Deezer          ISRC / search -> preview MP3 + BPM (fallback clip).
 *   iTunes Search   search -> preview AAC (last-resort clip).
 *   MusicBrainz +   ISRC -> recording -> full-song beat positions computed by
 *   AcousticBrainz  Essentia (read-only archive; strong coverage of pre-2022
 *                   catalog music). Gives the whole song's beat phase and
 *                   tempo drift, which a 30 s clip cannot.
 */

const UA = 'heart-music-player/1.0 (+https://sleeep.dev)';
const TIMEOUT_MS = 6000;

async function getJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'user-agent': UA, accept: 'application/json', ...(init?.headers || {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; heart-music-player)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Small TTL cache shared by the routes within one server instance. */
export class TtlCache<V> {
  private map = new Map<string, { v: V; exp: number }>();
  private max: number;
  constructor(max: number) {
    this.max = max;
  }
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.exp < Date.now()) { this.map.delete(key); return undefined; }
    return hit.v;
  }
  set(key: string, v: V, ttlMs: number) {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { v, exp: Date.now() + ttlMs });
  }
}

// --- Normalization helpers ---------------------------------------------------------
const norm = (s: string) =>
  s.toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\s-\s.*$/, ' ')
    .replace(/feat\.?.*$|ft\.?.*$/, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const similar = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  return x === y || x.includes(y) || y.includes(x);
};

// --- ReccoBeats ------------------------------------------------------------------------
export interface AudioFeatures {
  isrc: string | null;
  tempo: number | null;
  energy: number | null;
  danceability: number | null;
  valence: number | null;
  loudness: number | null;
}

interface ReccoFeatures {
  content?: Array<{ href?: string; isrc?: string; tempo?: number; energy?: number; danceability?: number; valence?: number; loudness?: number }>;
}

export async function reccoFeatures(spotifyId: string): Promise<AudioFeatures | null> {
  const data = await getJson<ReccoFeatures>(`https://api.reccobeats.com/v1/audio-features?ids=${spotifyId}`);
  const row = data?.content?.find((r) => r.href?.endsWith(spotifyId)) || data?.content?.[0];
  if (!row) return null;
  return {
    isrc: row.isrc || null,
    tempo: typeof row.tempo === 'number' && row.tempo > 0 ? row.tempo : null,
    energy: row.energy ?? null,
    danceability: row.danceability ?? null,
    valence: row.valence ?? null,
    loudness: row.loudness ?? null,
  };
}

// --- Preview clips -----------------------------------------------------------------------
export interface PreviewClip {
  url: string;
  source: 'spotify' | 'deezer' | 'itunes';
}

export async function spotifyPreview(spotifyId: string): Promise<PreviewClip | null> {
  const html = await getText(`https://open.spotify.com/embed/track/${spotifyId}`);
  const m = html?.match(/"audioPreview":\{"url":"(https:\/\/p\.scdn\.co\/mp3-preview\/[a-zA-Z0-9]+)/);
  return m ? { url: m[1], source: 'spotify' } : null;
}

interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  isrc?: string;
  preview?: string;
  bpm?: number;
  artist?: { name: string };
}

export async function deezerByIsrc(isrc: string): Promise<DeezerTrack | null> {
  const t = await getJson<DeezerTrack & { error?: unknown }>(`https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`);
  return t && !t.error && t.id ? t : null;
}

export async function deezerSearch(artist: string, title: string, durationMs?: number): Promise<DeezerTrack | null> {
  const q = `artist:"${artist.replace(/"/g, '')}" track:"${norm(title)}"`;
  const data = await getJson<{ data?: DeezerTrack[] }>(`https://api.deezer.com/search?limit=10&q=${encodeURIComponent(q)}`);
  const list = data?.data || [];
  const scored = list
    .filter((t) => similar(t.title, title) && (!t.artist || similar(t.artist.name, artist) || norm(artist).includes(norm(t.artist.name))))
    .map((t) => ({ t, d: durationMs ? Math.abs(t.duration * 1000 - durationMs) : 0 }))
    .sort((a, b) => a.d - b.d);
  const best = scored[0];
  if (!best || (durationMs && best.d > 4000)) return null;
  // Search results omit bpm; the track endpoint has it.
  const full = await getJson<DeezerTrack>(`https://api.deezer.com/track/${best.t.id}`);
  return full?.id ? full : best.t;
}

export async function itunesPreview(artist: string, title: string, durationMs?: number): Promise<PreviewClip | null> {
  const data = await getJson<{ results?: Array<{ trackName: string; artistName: string; previewUrl?: string; trackTimeMillis?: number }> }>(
    `https://itunes.apple.com/search?entity=song&limit=10&term=${encodeURIComponent(`${artist} ${norm(title)}`)}`,
  );
  const hit = (data?.results || [])
    .filter((r) => r.previewUrl && similar(r.trackName, title) && similar(r.artistName, artist))
    .map((r) => ({ r, d: durationMs && r.trackTimeMillis ? Math.abs(r.trackTimeMillis - durationMs) : 0 }))
    .sort((a, b) => a.d - b.d)[0];
  if (!hit || (durationMs && hit.d > 4000)) return null;
  return { url: hit.r.previewUrl as string, source: 'itunes' };
}

// --- MusicBrainz / AcousticBrainz ------------------------------------------------------------
// MusicBrainz allows ~1 request/second per client; serialize our calls.
let mbChain: Promise<unknown> = Promise.resolve();
function mbThrottled<T>(fn: () => Promise<T>): Promise<T> {
  const run = mbChain.then(fn, fn);
  mbChain = run.then(
    () => new Promise((r) => setTimeout(r, 1100)),
    () => new Promise((r) => setTimeout(r, 1100)),
  );
  return run;
}

interface MbRecording {
  id: string;
  length?: number;
  title?: string;
}

async function mbRecordingsByIsrc(isrc: string): Promise<MbRecording[]> {
  const data = await mbThrottled(() => getJson<{ recordings?: MbRecording[] }>(`https://musicbrainz.org/ws/2/isrc/${encodeURIComponent(isrc)}?fmt=json`));
  return data?.recordings || [];
}

async function mbRecordingsBySearch(artist: string, title: string): Promise<MbRecording[]> {
  const q = `recording:"${norm(title)}" AND artist:"${artist.replace(/"/g, '')}"`;
  const data = await mbThrottled(() => getJson<{ recordings?: MbRecording[] }>(`https://musicbrainz.org/ws/2/recording?fmt=json&limit=8&query=${encodeURIComponent(q)}`));
  return (data?.recordings || []).filter((r) => r.title && similar(r.title, title));
}

export interface BeatMap {
  /** Beat positions in seconds (ms precision). */
  beats: number[];
  bpm: number;
  /** Length of the analyzed file, seconds. */
  length: number;
  mbid: string;
}

interface AbLowLevel {
  metadata?: { audio_properties?: { length?: number } };
  rhythm?: { beats_position?: number[]; bpm?: number };
}

export async function acousticBrainzBeatMap(opts: { isrc?: string | null; artist?: string; title?: string; durationMs?: number }): Promise<BeatMap | null> {
  let recs: MbRecording[] = [];
  if (opts.isrc) recs = await mbRecordingsByIsrc(opts.isrc);
  if (recs.length === 0 && opts.artist && opts.title) recs = await mbRecordingsBySearch(opts.artist, opts.title);
  if (opts.durationMs) {
    const d = opts.durationMs;
    recs = recs.filter((r) => !r.length || Math.abs(r.length - d) < 5000);
  }
  const ids = recs.slice(0, 8).map((r) => r.id);
  if (ids.length === 0) return null;

  const counts = await getJson<Record<string, { count?: number }>>(`https://acousticbrainz.org/api/v1/count?recording_ids=${ids.join(';')}`);
  const withData = ids.filter((id) => (counts?.[id]?.count || 0) > 0);
  if (withData.length === 0) return null;

  // First submission of up to 4 recordings, plus the 2nd/3rd of the first
  // (different rips of the same recording differ in leading silence).
  const keys: string[] = withData.slice(0, 4).map((id) => `${id}:0`);
  const firstCount = counts?.[withData[0]]?.count || 0;
  for (let k = 1; k < Math.min(3, firstCount); k++) keys.push(`${withData[0]}:${k}`);
  const ll = await getJson<Record<string, Record<string, AbLowLevel>>>(`https://acousticbrainz.org/api/v1/low-level?recording_ids=${keys.join(';')}`);
  if (!ll) return null;

  let best: BeatMap | null = null;
  let bestDiff = Infinity;
  for (const key of keys) {
    const [id, offset] = key.split(':');
    const sub = ll[id]?.[offset];
    const beats = sub?.rhythm?.beats_position;
    const length = sub?.metadata?.audio_properties?.length;
    if (!beats || beats.length < 32 || !length) continue;
    const diff = opts.durationMs ? Math.abs(length * 1000 - opts.durationMs) : 0;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { beats: beats.map((b) => Math.round(b * 1000) / 1000), bpm: sub?.rhythm?.bpm || 0, length, mbid: id };
    }
  }
  // A different edit (radio/extended) would put every beat in the wrong place.
  if (!best || (opts.durationMs && bestDiff > 2500)) return null;
  return best;
}
