'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useWebPlayer } from './WebPlayerContext';
import { useAudioVisualizer } from './AudioVisualizerContext';
import { useSettings } from './SettingsContext';
import type { AudioReactiveData } from '../../services/audioAnalyzer';
import type { PhaseSource } from '../../services/trackIntel/engine';
import {
  loadSpotifyTrack,
  loadLocalTrack,
  analyzeAsync,
  storeLock,
  clearStoredLock,
  loadStoredLock,
  setDeviceLatency,
  type LoadedTrack,
  type ClipSource,
  type BeatMapSource,
} from '../../services/trackIntel/client';
import { solvePhase, solveTaps, type CapturedOnsets, type SyncResult } from '../../services/trackIntel/sync';
import { openMicSession, isMicSupported, micPermissionState } from '../../services/trackIntel/micCapture';
import { elementOutputLatency } from '../../services/audioGraph';

// Reactivity: the bridge between "what is playing" and the heart.
//
// The heart's audio data comes from, in priority order:
//   1. Live tab capture, when the user explicitly enabled it (HeartAnimation).
//   2. The Track Intelligence engine for the current track (this context):
//      zero-setup, predictive, works for DRM-protected Spotify playback.
//   3. The real-time analyzer on local files while their analysis loads.

export type ReactivityStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'live'; source: PhaseSource; clip: ClipSource; beatMap: BeatMapSource; bpm: number };

export type MicSyncState =
  | { state: 'idle' }
  | { state: 'listening'; seconds: number }
  | { state: 'done'; message: string }
  | { state: 'failed'; message: string };

interface ReactivityContextType {
  status: ReactivityStatus;
  micSync: MicSyncState;
  micSupported: boolean;
  /** Called by the heart once per animation frame. */
  readFrame: () => AudioReactiveData | null;
  syncWithMic: () => void;
  clearSync: () => void;
  /** Last tap-sync feedback, e.g. "Synced to your taps" (cleared after a while). */
  tapMessage: string | null;
}

const ReactivityContext = createContext<ReactivityContextType | undefined>(undefined);

export function useReactivity() {
  const ctx = useContext(ReactivityContext);
  if (!ctx) throw new Error('useReactivity must be used within a ReactivityProvider');
  return ctx;
}

/** Mic capture windows (seconds) at which the matched filter is re-solved;
 *  sync completes as soon as two consecutive solves agree. */
const MIC_SOLVE_POINTS = [6, 9, 12, 15];
const TAP_RESET_MS = 2500;
const TAP_MIN = 4;

export function ReactivityProvider({ children }: { children: ReactNode }) {
  const { playerState, getSongTimeAt } = useWebPlayer();
  const { audioElement, isPlaying, isSpotifyMode, tabAudioStream } = useAudioVisualizer();
  const { syncNudgeMs, micAutoSync } = useSettings();

  const [status, setStatus] = useState<ReactivityStatus>({ kind: 'idle' });
  const [micSync, setMicSync] = useState<MicSyncState>({ state: 'idle' });
  const [tapMessage, setTapMessage] = useState<string | null>(null);
  const [localSrc, setLocalSrc] = useState<string | null>(null);
  const [micSupported, setMicSupported] = useState(false);

  const loadedRef = useRef<LoadedTrack | null>(null);
  // Refs mirrored for the per-frame read (no React re-render coupling).
  const isPlayingRef = useRef(isPlaying);
  const spotifyModeRef = useRef(isSpotifyMode);
  const tabRef = useRef<MediaStream | null>(tabAudioStream);
  const nudgeRef = useRef(syncNudgeMs / 1000);
  const audioRef = useRef<HTMLAudioElement | null>(audioElement);
  const micBusyRef = useRef(false);
  // Tracks (by lock key) auto-sync already tried this session, so a track is
  // listened to at most once automatically.
  const autoTriedRef = useRef<Set<string>>(new Set());
  const tapsRef = useRef<number[]>([]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { spotifyModeRef.current = isSpotifyMode; }, [isSpotifyMode]);
  useEffect(() => { tabRef.current = tabAudioStream; }, [tabAudioStream]);
  useEffect(() => { nudgeRef.current = syncNudgeMs / 1000; }, [syncNudgeMs]);
  useEffect(() => { audioRef.current = audioElement; }, [audioElement]);
  useEffect(() => { setMicSupported(isMicSupported()); }, []);

  const publish = useCallback((loaded: LoadedTrack | null, beatMap: BeatMapSource = null) => {
    if (!loaded) return;
    setStatus({ kind: 'live', source: loaded.engine.source, clip: loaded.clip, beatMap, bpm: loaded.engine.bpm });
  }, []);

  /** Song time the visuals should show right now (seconds), or null. */
  const songTimeNow = useCallback((): number | null => {
    if (spotifyModeRef.current) {
      const s = getSongTimeAt();
      return s == null ? null : s - nudgeRef.current;
    }
    const el = audioRef.current;
    if (!el) return null;
    return el.currentTime - elementOutputLatency(el) - nudgeRef.current;
  }, [getSongTimeAt]);

  const readFrame = useCallback((): AudioReactiveData | null => {
    if (tabRef.current) return null;
    const loaded = loadedRef.current;
    if (!loaded) return null;
    const s = songTimeNow();
    if (s == null) return null;
    const playing = spotifyModeRef.current ? isPlayingRef.current : !!audioRef.current && !audioRef.current.paused;
    return loaded.engine.read(s, playing);
  }, [songTimeNow]);

  // --- Spotify: load the current track, prefetch the next ---
  const trackId = isSpotifyMode ? playerState.current_track?.id ?? null : null;
  const trackRef = useRef(playerState.current_track);
  trackRef.current = playerState.current_track;

  useEffect(() => {
    if (!trackId) return;
    const t = trackRef.current;
    if (!t) return;
    let cancelled = false;
    loadedRef.current = null;
    setStatus({ kind: 'loading' });
    setMicSync({ state: 'idle' });
    tapsRef.current = [];
    loadSpotifyTrack({
      id: t.id,
      name: t.name,
      artist: t.artists.map((a) => a.name).join(', '),
      durationMs: t.duration_ms,
    }).then((loaded) => {
      if (cancelled) return;
      if (!loaded) { setStatus({ kind: 'unavailable' }); return; }
      loadedRef.current = loaded;
      publish(loaded);
      loaded.beatMap.then((bm) => { if (!cancelled && loadedRef.current === loaded) publish(loaded, bm); });
    });
    return () => { cancelled = true; };
  }, [trackId, publish]);

  const nextTrack = isSpotifyMode ? playerState.next_track : null;
  const nextId = nextTrack?.id;
  useEffect(() => {
    if (!nextId || !nextTrack) return;
    // Prefetch so the next song is reactive from its first beat.
    const timer = setTimeout(() => {
      loadSpotifyTrack({ id: nextTrack.id, name: nextTrack.name, artist: nextTrack.artists.map((a) => a.name).join(', '), durationMs: nextTrack.duration_ms });
    }, 4000);
    return () => clearTimeout(timer);
    // nextTrack identity changes every state event; the id is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextId]);

  // --- Local files: analyze the whole file ---
  useEffect(() => {
    if (!audioElement) return;
    const update = () => {
      const src = audioElement.getAttribute('src');
      setLocalSrc(src && src.startsWith('/') ? src : null);
    };
    update();
    audioElement.addEventListener('loadstart', update);
    audioElement.addEventListener('emptied', update);
    return () => {
      audioElement.removeEventListener('loadstart', update);
      audioElement.removeEventListener('emptied', update);
    };
  }, [audioElement]);

  useEffect(() => {
    if (isSpotifyMode) return;
    if (!localSrc) { loadedRef.current = null; setStatus({ kind: 'idle' }); return; }
    let cancelled = false;
    loadedRef.current = null;
    setStatus({ kind: 'loading' });
    loadLocalTrack(localSrc).then((loaded) => {
      if (cancelled) return;
      if (!loaded) { setStatus({ kind: 'unavailable' }); return; }
      loadedRef.current = loaded;
      publish(loaded);
    });
    return () => { cancelled = true; };
  }, [isSpotifyMode, localSrc, publish]);

  useEffect(() => {
    if (!isSpotifyMode && !localSrc) setStatus({ kind: 'idle' });
  }, [isSpotifyMode, localSrc]);

  // --- Mic sync ---
  const runMicSync = useCallback(async (auto: boolean) => {
    const loaded = loadedRef.current;
    if (!loaded || loaded.engine.source === 'full' || micBusyRef.current) return;
    if (!isPlayingRef.current) {
      if (!auto) setMicSync({ state: 'failed', message: 'Start playback first, then sync.' });
      return;
    }
    micBusyRef.current = true;
    setMicSync({ state: 'listening', seconds: 0 });
    let session: Awaited<ReturnType<typeof openMicSession>> | null = null;
    try {
      session = await openMicSession();
    } catch (error) {
      micBusyRef.current = false;
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      setMicSync({ state: 'failed', message: denied ? 'Microphone permission was denied.' : 'Could not open the microphone.' });
      return;
    }
    const engine = loaded.engine;
    let prev: SyncResult | null = null;
    let result: SyncResult | null = null;
    let aborted = false;
    try {
      for (const target of MIC_SOLVE_POINTS) {
        while (session.seconds < target) {
          await new Promise((r) => setTimeout(r, 250));
          setMicSync({ state: 'listening', seconds: Math.floor(session.seconds) });
          if (loadedRef.current !== loaded || !isPlayingRef.current) { aborted = true; break; }
        }
        if (aborted) break;
        const snap = session.snapshot();
        if (!snap) continue;
        const raw = getSongTimeAt(snap.perfAtSample0);
        const rawEnd = getSongTimeAt(snap.perfAtSample0 + (snap.pcm.length / snap.sampleRate) * 1000);
        const nowRaw = getSongTimeAt();
        // A seek or pause during capture breaks the time mapping: start over.
        if (raw == null || rawEnd == null || nowRaw == null || Math.abs(rawEnd - raw - snap.pcm.length / snap.sampleRate) > 0.15) { prev = null; continue; }
        const model = await analyzeAsync(snap.pcm, snap.sampleRate);
        const cap: CapturedOnsets = { full: model.onset, low: model.lowOnset, fps: model.fps, songTimeAtFrame0: raw - nudgeRef.current };
        const period = engine.periodAt(cap.songTimeAtFrame0);
        const shiftMin = engine.source === 'beatmap' ? -0.1 : 0;
        const r = solvePhase(engine, cap, { shiftMin, shiftMax: shiftMin + period - 0.004, solveBar: true, bar: 0 });
        if (!r) continue;
        if (prev && prev.lock.bar === r.lock.bar && Math.abs(prev.lock.shift - r.lock.shift) < 0.025) { result = r; break; }
        prev = r;
      }
      if (!result && prev && prev.barMargin > 1.1) result = prev;
    } finally {
      session.close();
      micBusyRef.current = false;
    }
    if (aborted) { setMicSync({ state: 'idle' }); return; }
    if (!result) {
      setMicSync({ state: 'failed', message: 'Couldn’t hear the music clearly. Turn it up (speakers, not headphones) and try again.' });
      return;
    }
    engine.setPhaseLock(result.lock, 'synced');
    storeLock(loaded.lockKey, result.lock, 'mic');
    // On beat-mapped tracks the measured shift IS this device's playback
    // latency; remember it so future beat-mapped tracks start in sync.
    if (engine.source === 'beatmap') setDeviceLatency(result.lock.shift);
    setMicSync({ state: 'done', message: 'Synced to your speakers.' });
    publish(loaded, (await loaded.beatMap) ?? null);
  }, [getSongTimeAt, publish]);

  const syncWithMic = useCallback(() => { runMicSync(false); }, [runMicSync]);

  // Auto-sync each new Spotify track once permission exists and the user
  // opted in. Waits a few seconds into playback so the intro isn't the only
  // thing it hears.
  useEffect(() => {
    if (!micAutoSync || status.kind !== 'live' || status.source === 'full' || status.source === 'synced' || !isPlaying) return;
    const loaded = loadedRef.current;
    if (!loaded || autoTriedRef.current.has(loaded.lockKey) || loadStoredLock(loaded.lockKey)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled || loadedRef.current !== loaded) return;
      if ((await micPermissionState()) !== 'granted') return;
      autoTriedRef.current.add(loaded.lockKey);
      runMicSync(true);
    }, 3000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [micAutoSync, status, isPlaying, runMicSync]);

  const clearSync = useCallback(() => {
    const loaded = loadedRef.current;
    if (!loaded) return;
    clearStoredLock(loaded.lockKey);
    loaded.engine.setPhaseLock(null);
    loaded.beatMap.then((bm) => publish(loaded, bm));
    setMicSync({ state: 'idle' });
  }, [publish]);

  // --- Tap sync: press T on the beat (4+ taps) ---
  useEffect(() => {
    let messageTimer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 't' && e.key !== 'T') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const loaded = loadedRef.current;
      if (!loaded || loaded.engine.source === 'full' || !isPlayingRef.current) return;
      const raw = getSongTimeAt();
      if (raw == null) return;
      const s = raw - nudgeRef.current;
      const taps = tapsRef.current;
      if (taps.length && (s - taps[taps.length - 1]) * 1000 > TAP_RESET_MS) taps.length = 0;
      taps.push(s);
      if (taps.length > 12) taps.shift();
      if (taps.length >= TAP_MIN) {
        const lock = solveTaps(loaded.engine, taps, loaded.engine.getPhaseLock());
        if (lock) {
          loaded.engine.setPhaseLock(lock, 'synced');
          storeLock(loaded.lockKey, lock, 'tap');
          setTapMessage(`Synced to your taps (${taps.length})`);
          publish(loaded);
        } else {
          setTapMessage('Keep tapping on the beat…');
        }
      } else {
        setTapMessage(`Tap ${TAP_MIN - taps.length} more…`);
      }
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = setTimeout(() => setTapMessage(null), 2500);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (messageTimer) clearTimeout(messageTimer);
    };
  }, [getSongTimeAt, publish]);

  const value = useMemo<ReactivityContextType>(() => ({
    status,
    micSync,
    micSupported,
    readFrame,
    syncWithMic,
    clearSync,
    tapMessage,
  }), [status, micSync, micSupported, readFrame, syncWithMic, clearSync, tapMessage]);

  return <ReactivityContext.Provider value={value}>{children}</ReactivityContext.Provider>;
}
