'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type ParticleLevel = 'low' | 'medium' | 'high';
export type LyricsMode = 'center' | 'alternating';
export type FrameRate = '30' | '60';
export type CanvasResolution = '0.5' | '0.75' | '1';

interface SettingsContextType {
  particleLevel: ParticleLevel;
  setParticleLevel: (level: ParticleLevel) => void;
  lyricsMode: LyricsMode;
  setLyricsMode: (mode: LyricsMode) => void;
  frameRate: FrameRate;
  setFrameRate: (rate: FrameRate) => void;
  canvasResolution: CanvasResolution;
  setCanvasResolution: (res: CanvasResolution) => void;
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

// Frame interval in ms for each frame rate
export const FRAME_INTERVALS: Record<FrameRate, number> = {
  '30': 33,  // ~30fps
  '60': 16,  // ~60fps
};

// Canvas resolution multipliers
export const RESOLUTION_MULTIPLIERS: Record<CanvasResolution, number> = {
  '0.5': 0.5,
  '0.75': 0.75,
  '1': 1,
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [particleLevel, setParticleLevelState] = useState<ParticleLevel>('high');
  const [lyricsMode, setLyricsModeState] = useState<LyricsMode>('center');
  const [frameRate, setFrameRateState] = useState<FrameRate>('60');
  const [canvasResolution, setCanvasResolutionState] = useState<CanvasResolution>('1');

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedParticleLevel = localStorage.getItem('particleLevel') as ParticleLevel;
    const savedLyricsMode = localStorage.getItem('lyricsMode') as LyricsMode;
    const savedFrameRate = localStorage.getItem('frameRate') as FrameRate;
    const savedCanvasResolution = localStorage.getItem('canvasResolution') as CanvasResolution;
    
    if (savedParticleLevel && ['low', 'medium', 'high'].includes(savedParticleLevel)) {
      setParticleLevelState(savedParticleLevel);
    }
    if (savedLyricsMode && ['center', 'alternating'].includes(savedLyricsMode)) {
      setLyricsModeState(savedLyricsMode);
    }
    if (savedFrameRate && ['30', '60'].includes(savedFrameRate)) {
      setFrameRateState(savedFrameRate);
    }
    if (savedCanvasResolution && ['0.5', '0.75', '1'].includes(savedCanvasResolution)) {
      setCanvasResolutionState(savedCanvasResolution);
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

  const setFrameRate = (rate: FrameRate) => {
    setFrameRateState(rate);
    localStorage.setItem('frameRate', rate);
  };

  const setCanvasResolution = (res: CanvasResolution) => {
    setCanvasResolutionState(res);
    localStorage.setItem('canvasResolution', res);
  };

  return (
    <SettingsContext.Provider value={{ 
      particleLevel, setParticleLevel, 
      lyricsMode, setLyricsMode,
      frameRate, setFrameRate,
      canvasResolution, setCanvasResolution
    }}>
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
