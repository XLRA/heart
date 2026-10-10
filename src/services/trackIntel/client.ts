/**
 * Track Intelligence client: turns "a track is playing" into a running
 * GrooveEngine, as fast as possible, using the best data available.
 *
 * Spotify track:
 *   1. /api/track-intel        -> tempo/energy (ReccoBeats) + preview clip URL
 *   2. preview clip            -> fetched (CORS-enabled CDNs), decoded, and
 *                                 analyzed in a worker -> GrooveModel
 *   3. beat map, in parallel   -> Spotify /audio-analysis if this app still
 *                                 has access (beats + bars + sections), else
 *                                 /api/track-intel/beatmap (AcousticBrainz)
 *   Engine goes live after (2); (3) upgrades it in place when it lands.
 *
 * Local file: the whole file is decoded and analyzed -> exact 'full' engine.
 */

import { analyzePcm, fitGrid, ANALYSIS_VERSION, type GrooveModel } from './analysis';
import { createGrooveEngine, createSyntheticModel, type GrooveEngine, type PhaseLock } from './engine';

export interface SpotifyTrackRef {
  id: string;
  name: string;
  artist: string;
  durationMs: number;
}

export type ClipSource = 'spotify' | 'deezer' | 'itunes' | 'synthetic' | 'local';
export type BeatMapSource = 'spotify-analysis' | 'acousticbrainz' | null;

export interface LoadedTrack {
  key: string;
  engine: GrooveEngine;
  clip: ClipSource;
  /** Resolves when the beat-map attempt finishes (true if one was applied). */
  beatMap: Promise<BeatMapSource>;
  /** Key under which a mic/tap phase lock for this exact analysis is stored. */
  lockKey: string;
}

interface IntelMeta {
  id: string;
  isrc: string | null;
  features: { energy: number | null } | null;
  tempo: number | null;
  preview: { url: string; source: 'spotify' | 'deezer' | 'itunes' } | null;
}

// --- Worker-backed analysis --------------------------------------------------------
let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, { resolve: (m: GrooveModel) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ id: number; model?: GrooveModel; error?: string }>) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.model) p.resolve(e.data.model);
        else p.reject(new Error(e.data.error || 'analysis failed'));
      };
      worker.onerror = () => {
        workerBroken = true;
        for (const p of pending.values()) p.reject(new Error('analysis worker crashed'));
        pending.clear();
        worker = null;
      };
    } catch {
      workerBroken = true;
      return null;
    }
  }
  return worker;
}

export function analyzeAsync(pcm: Float32Array, sampleRate: number, bpmHint?: number): Promise<GrooveModel> {
  const w = getWorker();
  if (!w) return Promise.resolve(analyzePcm(pcm, sampleRate, { bpmHint }));
  const id = nextId++;
  // The PCM buffer is transferred (zero-copy), so it's gone from this thread
  // afterwards: a worker failure rejects rather than re-analyzing here.
  return new Promise<GrooveModel>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, pcm, sampleRate, bpmHint }, [pcm.buffer]);
  });
}

// --- Decoding ----------------------------------------------------------------------------
const DECODE_RATE = 44100;

export async function decodeToMono(data: ArrayBuffer): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const Ctx = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new Ctx(1, 1, DECODE_RATE);
  const buf = await ctx.decodeAudioData(data);
  const n = buf.length;
  const pcm = new Float32Array(n);
  const channels = buf.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < n; i++) pcm[i] += ch[i] / channels;
  }
  return { pcm, sampleRate: buf.sampleRate };
}

// --- Persisted phase locks + device latency --------------------------------------------
const LOCKS_KEY = 'heart.phaseLocks.v1';
const LATENCY_KEY = 'heart.deviceLatency.v1';
const ANALYSIS_ACCESS_KEY = 'heart.spotifyAnalysisAccess.v1';
/** Typical browser + SDK output latency before any measurement. */
export const DEFAULT_DEVICE_LATENCY_S = 0.05;

interface StoredLock extends PhaseLock { via: 'mic' | 'tap'; at: number }

function readLocks(): Record<string, StoredLock> {
  try { return JSON.parse(localStorage.getItem(LOCKS_KEY) || '{}'); } catch { return {}; }
}

export function loadStoredLock(lockKey: string): StoredLock | null {
  return readLocks()[lockKey] || null;
}

export function storeLock(lockKey: string, lock: PhaseLock, via: 'mic' | 'tap') {
  const all = readLocks();
  all[lockKey] = { ...lock, via, at: Date.now() };
  const keys = Object.keys(all);
  if (keys.length > 400) {
    keys.sort((a, b) => all[a].at - all[b].at);
    for (const k of keys.slice(0, keys.length - 400)) delete all[k];
  }
  try { localStorage.setItem(LOCKS_KEY, JSON.stringify(all)); } catch { /* quota */ }
}

export function clearStoredLock(lockKey: string) {
  const all = readLocks();
  delete all[lockKey];
  try { localStorage.setItem(LOCKS_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

export function getDeviceLatency(): number {
  const v = Number(localStorage.getItem(LATENCY_KEY));
  return Number.isFinite(v) && v > -0.1 && v < 0.5 && localStorage.getItem(LATENCY_KEY) !== null ? v : DEFAULT_DEVICE_LATENCY_S;
}

export function setDeviceLatency(seconds: number) {
  try { localStorage.setItem(LATENCY_KEY, String(Math.round(seconds * 1000) / 1000)); } catch { /* ignore */ }
}

// --- Spotify audio-analysis (only for apps that kept access) --------------------------------
interface SpotifyAnalysis {
  beats?: Array<{ start: number; confidence: number }>;
  bars?: Array<{ start: number; confidence: number }>;
  sections?: Array<{ start: number; loudness: number; confidence: number }>;
}

async function trySpotifyAnalysis(id: string): Promise<SpotifyAnalysis | null> {
  const token = localStorage.getItem('spotify_access_token');
  if (!token) return null;
  // Remember a 403 for a week: apps created after Nov 2024 never get access,
  // and hammering the endpoint for every track is pointless.
  const denied = Number(localStorage.getItem(ANALYSIS_ACCESS_KEY));
  if (denied && Date.now() - denied < 7 * 86400_000) return null;
  try {
    const res = await fetch(`https://api.spotify.com/v1/audio-analysis/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 403 || res.status === 401) {
      if (res.status === 403) localStorage.setItem(ANALYSIS_ACCESS_KEY, String(Date.now()));
      return null;
    }
    if (!res.ok) return null;
    return (await res.json()) as SpotifyAnalysis;
  } catch {
    return null;
  }
}

/** Section changes worth a visual "lift": a section that is >= 3 dB louder
 *  than the one before it (chorus entries, drops). */
function sectionLifts(sections: NonNullable<SpotifyAnalysis['sections']>): Array<{ t: number; s: number }> {
  const out: Array<{ t: number; s: number }> = [];
  for (let i = 1; i < sections.length; i++) {
    const jump = sections[i].loudness - sections[i - 1].loudness;
    if (jump >= 3) out.push({ t: sections[i].start, s: Math.min(1, (jump - 3) / 6 + 0.3) });
  }
  return out;
}

// --- Loading ---------------------------------------------------------------------------------
const cache = new Map<string, Promise<LoadedTrack | null>>();
const CACHE_LIMIT = 16;

function remember(key: string, p: Promise<LoadedTrack | null>) {
  cache.set(key, p);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  // Don't pin failures: a later attempt may succeed (network blip).
  p.then((r) => { if (!r) cache.delete(key); }, () => cache.delete(key));
}

export function loadSpotifyTrack(track: SpotifyTrackRef): Promise<LoadedTrack | null> {
  const key = `spotify:${track.id}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = loadSpotifyTrackUncached(track);
  remember(key, p);
  return p;
}

async function loadSpotifyTrackUncached(track: SpotifyTrackRef): Promise<LoadedTrack | null> {
  const qs = new URLSearchParams({ id: track.id, name: track.name, artist: track.artist, durationMs: String(Math.round(track.durationMs)) });
  let meta: IntelMeta | null = null;
  try {
    const res = await fetch(`/api/track-intel?${qs}`);
    if (res.ok) meta = (await res.json()) as IntelMeta;
  } catch { /* fall through to synthetic */ }

  // Start the beat-map lookups immediately; they run while the clip loads.
  const spotifyAnalysis = trySpotifyAnalysis(track.id);
  const abParams = new URLSearchParams({ name: track.name, artist: track.artist, durationMs: String(Math.round(track.durationMs)) });
  if (meta?.isrc) abParams.set('isrc', meta.isrc);
  const acousticBrainz = spotifyAnalysis.then(async (sa) => {
    if (sa?.beats?.length) return null;
    try {
      const res = await fetch(`/api/track-intel/beatmap?${abParams}`);
      if (!res.ok) return null;
      const body = (await res.json()) as { beatMap: { beats: number[]; length: number } | null };
      return body.beatMap;
    } catch {
      return null;
    }
  });

  let model: GrooveModel | null = null;
  let clip: ClipSource = 'synthetic';
  if (meta?.preview) {
    try {
      const audio = await fetch(meta.preview.url);
      if (audio.ok) {
        const { pcm, sampleRate } = await decodeToMono(await audio.arrayBuffer());
        model = await analyzeAsync(pcm, sampleRate, meta.tempo || undefined);
        clip = meta.preview.source;
      }
    } catch (error) {
      console.warn('[TrackIntel] Preview analysis failed:', error);
    }
  }
  if (!model) {
    // No clip: fall back to the song's tempo driving a neutral backbeat. If
    // even the tempo is unknown, wait for the beat map's tempo.
    let bpm = meta?.tempo || null;
    if (!bpm) {
      const ab = await acousticBrainz;
      if (ab && ab.beats.length > 16) bpm = 60 / fitGrid(ab.beats).period;
    }
    if (!bpm) return null;
    model = createSyntheticModel(bpm, meta?.features?.energy ?? 0.6);
  }

  const engine = createGrooveEngine({ model, fullTrack: false, fitGrid, energy: meta?.features?.energy ?? undefined });
  const lockKey = `${track.id}:${ANALYSIS_VERSION}:${clip}`;

  const beatMap: Promise<BeatMapSource> = (async () => {
    const sa = await spotifyAnalysis;
    if (sa?.beats && sa.beats.length > 16) {
      // Spotify's own beats are in Spotify's own timeline: no AB bias, and
      // bars give the downbeat directly.
      engine.setBeatMap(sa.beats.map((b) => b.start), {
        bias: 0,
        downbeat: sa.bars?.find((b) => b.confidence > 0.3)?.start ?? sa.bars?.[0]?.start,
        shift: getDeviceLatency(),
      });
      if (sa.sections) engine.setSections(sectionLifts(sa.sections));
      return 'spotify-analysis';
    }
    const ab = await acousticBrainz;
    if (ab && ab.beats.length > 16) {
      engine.setBeatMap(ab.beats, { shift: getDeviceLatency() });
      return 'acousticbrainz';
    }
    return null;
  })();

  // A stored mic/tap lock for this exact analysis wins over defaults -- but
  // only once the beat map question is settled, since setBeatMap resets it.
  beatMap.then(() => {
    const stored = loadStoredLock(lockKey);
    if (stored) engine.setPhaseLock({ shift: stored.shift, bar: stored.bar }, 'synced');
  });

  return { key: `spotify:${track.id}`, engine, clip, beatMap, lockKey };
}

export function loadLocalTrack(url: string): Promise<LoadedTrack | null> {
  const key = `local:${url}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async (): Promise<LoadedTrack | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const { pcm, sampleRate } = await decodeToMono(await res.arrayBuffer());
      const model = await analyzeAsync(pcm, sampleRate);
      const engine = createGrooveEngine({ model, fullTrack: true, fitGrid });
      return { key, engine, clip: 'local' as const, beatMap: Promise.resolve(null), lockKey: `${key}:${ANALYSIS_VERSION}` };
    } catch (error) {
      console.warn('[TrackIntel] Local analysis failed:', error);
      return null;
    }
  })();
  remember(key, p);
  return p;
}
