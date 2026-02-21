'use client';

import HeartAnimation from './components/HeartAnimation';
import AdvancedMusicPlayer from './components/AdvancedMusicPlayer';
import SpotifyLogin from './components/SpotifyLogin';
import LiveLyrics from './components/LiveLyrics';
import SettingsPanel from './components/SettingsPanel';
import { SpotifyProvider } from './context/SpotifyContext';
import { WebPlayerProvider, useWebPlayer } from './context/WebPlayerContext';
import { AudioVisualizerProvider, useAudioVisualizer } from './context/AudioVisualizerContext';
import { SettingsProvider, useSettings } from './context/SettingsContext';

function AppContent() {
  const { audioElement, isPlaying, isSpotifyMode, meydaData, spotifyTrackData, albumColors, tabAudioStream } = useAudioVisualizer();
  const { playerState } = useWebPlayer();
  const { particleLevel, lyricsMode } = useSettings();
  
  return (
    <main className="min-h-screen bg-black relative">
      <HeartAnimation 
        audioElement={audioElement} 
        isPlaying={isPlaying}
        isSpotifyMode={isSpotifyMode}
        spotifyTrackData={spotifyTrackData}
        meydaData={meydaData}
        albumColors={albumColors}
        currentTrackId={playerState.current_track?.id || null}
        currentPosition={playerState.position}
        particleLevel={particleLevel}
        tabAudioStream={tabAudioStream}
      />
      <LiveLyrics
        currentTrackId={playerState.current_track?.id || null}
        currentTrackName={playerState.current_track?.name}
        currentArtist={playerState.current_track?.artists.map(a => a.name).join(', ')}
        currentPosition={playerState.position}
        isPlaying={isPlaying}
        lyricsMode={lyricsMode}
      />
      <SettingsPanel />
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
          <SettingsProvider>
            <AppContent />
          </SettingsProvider>
        </AudioVisualizerProvider>
      </WebPlayerProvider>
    </SpotifyProvider>
  );
}
