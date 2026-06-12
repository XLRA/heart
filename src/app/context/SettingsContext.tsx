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

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [particleLevel, setParticleLevelState] = useState<ParticleLevel>('high');
  const [lyricsMode, setLyricsModeState] = useState<LyricsMode>('center');
  const [uiHidden, setUiHidden] = useState(false);

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedParticleLevel = localStorage.getItem('particleLevel') as ParticleLevel;
    const savedLyricsMode = localStorage.getItem('lyricsMode') as LyricsMode;
    
    if (savedParticleLevel && ['low', 'medium', 'high'].includes(savedParticleLevel)) {
      setParticleLevelState(savedParticleLevel);
    }
    if (savedLyricsMode && ['center', 'alternating'].includes(savedLyricsMode)) {
      setLyricsModeState(savedLyricsMode);
    }
  }, []);

  const setParticleLevel = (level: ParticleLevel) => {
    setParticleLevelState(level);
    localStorage.setItem('particleLevel', level);
  };

  const setLyricsMode = (mode: LyricsMode) => {
    setLyricsModeState(mode);
    localStorage.setItem('lyricsMode', mode);
  };

  return (
    <SettingsContext.Provider value={{ particleLevel, setParticleLevel, lyricsMode, setLyricsMode, uiHidden, setUiHidden }}>
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
