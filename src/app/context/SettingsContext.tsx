'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type ParticleLevel = 'low' | 'medium' | 'high';
export type LyricsMode = 'center' | 'alternating';

interface SettingsContextType {
  particleLevel: ParticleLevel;
  setParticleLevel: (level: ParticleLevel) => void;
  lyricsMode: LyricsMode;
  setLyricsMode: (mode: LyricsMode) => void;
  /** Clean mode: hides all UI chrome so only the heart (and lyrics) remain.
   *  Deliberately NOT persisted -- a reload always starts with the UI
   *  visible so nobody gets stranded on a blank screen. */
  uiHidden: boolean;
  setUiHidden: (hidden: boolean) => void;
  /** Manual visual-sync nudge in ms: positive = visuals later (use when the
   *  heart hits before you hear the beat, e.g. Bluetooth headphones). */
  syncNudgeMs: number;
  setSyncNudgeMs: (ms: number) => void;
  /** Re-sync every new track with a few seconds of microphone audio (only
   *  takes effect once mic permission has been granted). */
  micAutoSync: boolean;
  setMicAutoSync: (on: boolean) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

// Particle multipliers for each level
export const PARTICLE_MULTIPLIERS: Record<ParticleLevel, number> = {
  low: 0.25,      // 25% of particles
  medium: 0.5,    // 50% of particles
  high: 1.0,      // 100% of particles (current)
};

// Trace count for each level (affects trail length)
export const TRACE_COUNTS: Record<ParticleLevel, number> = {
  low: 20,
  medium: 35,
  high: 50,
};

export const SYNC_NUDGE_LIMIT_MS = 300;

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [particleLevel, setParticleLevelState] = useState<ParticleLevel>('high');
  const [lyricsMode, setLyricsModeState] = useState<LyricsMode>('center');
  const [uiHidden, setUiHidden] = useState(false);
  const [syncNudgeMs, setSyncNudgeState] = useState(0);
  const [micAutoSync, setMicAutoSyncState] = useState(false);

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedParticleLevel = localStorage.getItem('particleLevel') as ParticleLevel;
    const savedLyricsMode = localStorage.getItem('lyricsMode') as LyricsMode;
    const savedNudge = Number(localStorage.getItem('syncNudgeMs'));

    if (savedParticleLevel && ['low', 'medium', 'high'].includes(savedParticleLevel)) {
      setParticleLevelState(savedParticleLevel);
    }
    if (savedLyricsMode && ['center', 'alternating'].includes(savedLyricsMode)) {
      setLyricsModeState(savedLyricsMode);
    }
    if (Number.isFinite(savedNudge) && Math.abs(savedNudge) <= SYNC_NUDGE_LIMIT_MS) {
      setSyncNudgeState(savedNudge);
    }
    setMicAutoSyncState(localStorage.getItem('micAutoSync') === '1');
  }, []);

  const setParticleLevel = (level: ParticleLevel) => {
    setParticleLevelState(level);
    localStorage.setItem('particleLevel', level);
  };

  const setLyricsMode = (mode: LyricsMode) => {
    setLyricsModeState(mode);
    localStorage.setItem('lyricsMode', mode);
  };

  const setSyncNudgeMs = (ms: number) => {
    const v = Math.max(-SYNC_NUDGE_LIMIT_MS, Math.min(SYNC_NUDGE_LIMIT_MS, Math.round(ms)));
    setSyncNudgeState(v);
    localStorage.setItem('syncNudgeMs', String(v));
  };

  const setMicAutoSync = (on: boolean) => {
    setMicAutoSyncState(on);
    localStorage.setItem('micAutoSync', on ? '1' : '0');
  };

  return (
    <SettingsContext.Provider
      value={{
        particleLevel, setParticleLevel,
        lyricsMode, setLyricsMode,
        uiHidden, setUiHidden,
        syncNudgeMs, setSyncNudgeMs,
        micAutoSync, setMicAutoSync,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
