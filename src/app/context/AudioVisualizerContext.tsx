'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

interface AudioVisualizerContextType {
  audioElement: HTMLAudioElement | null;
  isPlaying: boolean;
  isSpotifyMode: boolean;
  spotifyTrackData: {
    tempo?: number;
    energy?: number;
    danceability?: number;
    valence?: number;
  } | null;
  meydaData: {
    rms: number;
    spectralCentroid: number;
    spectralRolloff: number;
    spectralFlux: number;
    spectralSpread: number;
    spectralKurtosis: number;
    loudness: number;
    mfcc: number[];
    chroma: number[];
  } | null;
  setAudioElement: (element: HTMLAudioElement | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setSpotifyMode: (isSpotify: boolean) => void;
  setSpotifyTrackData: (data: {
    tempo?: number;
    energy?: number;
    danceability?: number;
    valence?: number;
  } | null) => void;
  setMeydaData: (data: {
    rms: number;
    spectralCentroid: number;
    spectralRolloff: number;
    spectralFlux: number;
    spectralSpread: number;
    spectralKurtosis: number;
    loudness: number;
    mfcc: number[];
    chroma: number[];
  } | null) => void;
}

const AudioVisualizerContext = createContext<AudioVisualizerContextType | undefined>(undefined);

export const useAudioVisualizer = () => {
  const context = useContext(AudioVisualizerContext);
  if (context === undefined) {
    throw new Error('useAudioVisualizer must be used within an AudioVisualizerProvider');
  }
  return context;
};

interface AudioVisualizerProviderProps {
  children: ReactNode;
}

export const AudioVisualizerProvider = ({ children }: AudioVisualizerProviderProps) => {
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSpotifyMode, setSpotifyMode] = useState(false);
  const [spotifyTrackData, setSpotifyTrackData] = useState<{
    tempo?: number;
    energy?: number;
    danceability?: number;
    valence?: number;
  } | null>(null);
  const [meydaData, setMeydaData] = useState<{
    rms: number;
    spectralCentroid: number;
    spectralRolloff: number;
    spectralFlux: number;
    spectralSpread: number;
    spectralKurtosis: number;
    loudness: number;
    mfcc: number[];
    chroma: number[];
  } | null>(null);

  return (
    <AudioVisualizerContext.Provider
      value={{
        audioElement,
        isPlaying,
        isSpotifyMode,
        spotifyTrackData,
        meydaData,
        setAudioElement,
        setIsPlaying,
        setSpotifyMode,
        setSpotifyTrackData,
        setMeydaData,
      }}
    >
      {children}
    </AudioVisualizerContext.Provider>
  );
};
