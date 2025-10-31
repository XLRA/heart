'use client';

import HeartAnimation from './components/HeartAnimation';
import AdvancedMusicPlayer from './components/AdvancedMusicPlayer';
import SpotifyLogin from './components/SpotifyLogin';
import LiveLyrics from './components/LiveLyrics';
import { SpotifyProvider } from './context/SpotifyContext';
import { WebPlayerProvider, useWebPlayer } from './context/WebPlayerContext';
import { AudioVisualizerProvider, useAudioVisualizer } from './context/AudioVisualizerContext';

function AppContent() {
  const { audioElement, isPlaying, isSpotifyMode, meydaData, spotifyTrackData } = useAudioVisualizer();
  const { playerState } = useWebPlayer();
  
  return (
    <main className="min-h-screen bg-black relative">
      <HeartAnimation 
        audioElement={audioElement} 
        isPlaying={isPlaying}
        isSpotifyMode={isSpotifyMode}
        spotifyTrackData={spotifyTrackData}
        meydaData={meydaData}
        currentTrackId={playerState.current_track?.id || null}
        currentPosition={playerState.position}
      />
      <LiveLyrics
        currentTrackId={playerState.current_track?.id || null}
        currentTrackName={playerState.current_track?.name}
        currentArtist={playerState.current_track?.artists.map(a => a.name).join(', ')}
        currentPosition={playerState.position}
        currentDuration={playerState.duration || playerState.current_track?.duration_ms}
        isPlaying={isPlaying}
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
