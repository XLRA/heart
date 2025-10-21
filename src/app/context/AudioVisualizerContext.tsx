'use client';

import { createContext, useContext, useState, ReactNode } from 'react';
import { ReccoBeatsAudioFeatures } from '../../types/reccobeats';

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
  reccoBeatsData: ReccoBeatsAudioFeatures | null;
  setAudioElement: (element: HTMLAudioElement | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setSpotifyMode: (isSpotify: boolean) => void;
  setSpotifyTrackData: (data: {
    tempo?: number;
    energy?: number;
    danceability?: number;
    valence?: number;
  } | null) => void;
  setReccoBeatsData: (data: ReccoBeatsAudioFeatures | null) => void;
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
  const [reccoBeatsData, setReccoBeatsData] = useState<ReccoBeatsAudioFeatures | null>(null);

  return (
    <AudioVisualizerContext.Provider
      value={{
        audioElement,
        isPlaying,
        isSpotifyMode,
        spotifyTrackData,
        reccoBeatsData,
        setAudioElement,
        setIsPlaying,
        setSpotifyMode,
        setSpotifyTrackData,
        setReccoBeatsData,
      }}
    >
      {children}
    </AudioVisualizerContext.Provider>
  );
};
