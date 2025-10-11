'use client';

import HeartAnimation from './components/HeartAnimation';
import AdvancedMusicPlayer from './components/AdvancedMusicPlayer';
import SpotifyLogin from './components/SpotifyLogin';
import { SpotifyProvider } from './context/SpotifyContext';
import { WebPlayerProvider } from './context/WebPlayerContext';
import { AudioVisualizerProvider, useAudioVisualizer } from './context/AudioVisualizerContext';

function AppContent() {
  const { audioElement, isPlaying, isSpotifyMode, spotifyTrackData } = useAudioVisualizer();
  
  return (
    <main className="min-h-screen bg-black relative">
      <HeartAnimation 
        audioElement={audioElement} 
        isPlaying={isPlaying}
        isSpotifyMode={isSpotifyMode}
        spotifyTrackData={spotifyTrackData}
      />
      <SpotifyLogin />
      <div className="absolute bottom-0 left-0 z-10">
        <AdvancedMusicPlayer />
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <SpotifyProvider>
      <WebPlayerProvider>
        <AudioVisualizerProvider>
          <AppContent />
        </AudioVisualizerProvider>
      </WebPlayerProvider>
    </SpotifyProvider>
  );
}
