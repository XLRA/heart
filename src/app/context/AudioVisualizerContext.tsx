'use client';

import { createContext, useContext, useState, ReactNode } from 'react';
import type { AlbumColors } from '../../services/colorExtractor';

export type { AlbumColors };

// Shared state between the music player and the heart visualizer.
//
// Audio-reactive data reaches the heart through exactly three paths, in
// priority order (see HeartAnimation):
//   1. tabAudioStream -- real analysis of tab-captured audio (live audio).
//   2. audioElement   -- real analysis of local-file playback via Web Audio.
//   3. Simulation     -- position-seeded synthetic motion for Spotify
//      playback without capture (Spotify's SDK audio is DRM-protected and
//      cannot be tapped; their audio-features/analysis endpoints are
//      deprecated for new apps).
// The previous Meyda subsystem -- which "analyzed" a synthetic sine loop and
// reported constants -- was removed along with the deprecated-endpoint
// plumbing (spotifyTrackData).
interface AudioVisualizerContextType {
  audioElement: HTMLAudioElement | null;
  isPlaying: boolean;
  isSpotifyMode: boolean;
  albumColors: AlbumColors | null;
  tabAudioStream: MediaStream | null;
  setAudioElement: (element: HTMLAudioElement | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setSpotifyMode: (isSpotify: boolean) => void;
  setAlbumColors: (colors: AlbumColors | null) => void;
  setTabAudioStream: (stream: MediaStream | null) => void;
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
  const [albumColors, setAlbumColors] = useState<AlbumColors | null>(null);
  const [tabAudioStream, setTabAudioStream] = useState<MediaStream | null>(null);

  return (
    <AudioVisualizerContext.Provider
      value={{
        audioElement,
        isPlaying,
        isSpotifyMode,
        albumColors,
        tabAudioStream,
        setAudioElement,
        setIsPlaying,
        setSpotifyMode,
        setAlbumColors,
        setTabAudioStream,
      }}
    >
      {children}
    </AudioVisualizerContext.Provider>
  );
};
