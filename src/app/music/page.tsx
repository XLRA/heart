'use client';

import { useEffect, useRef, useState } from 'react';
import HeartAnimation from '../components/HeartAnimation';
import AdvancedMusicPlayer from '../components/AdvancedMusicPlayer';
import SpotifyLogin from '../components/SpotifyLogin';
import LiveLyrics from '../components/LiveLyrics';
import SettingsPanel from '../components/SettingsPanel';
import { SpotifyProvider } from '../context/SpotifyContext';
import { WebPlayerProvider, useWebPlayer } from '../context/WebPlayerContext';
import { AudioVisualizerProvider, useAudioVisualizer } from '../context/AudioVisualizerContext';
import { SettingsProvider, useSettings } from '../context/SettingsContext';

function AppContent() {
  const { audioElement, isPlaying, isSpotifyMode, albumColors, tabAudioStream } = useAudioVisualizer();
  const { playerState } = useWebPlayer();
  const { particleLevel, lyricsMode, uiHidden, setUiHidden } = useSettings();

  // While the UI is hidden, moving the mouse briefly reveals a small restore
  // button so clean mode stays discoverable without the keyboard shortcut.
  const [showRestoreHint, setShowRestoreHint] = useState(false);
  const hintTimerRef = useRef<number | null>(null);

  // 'H' toggles clean mode; Escape always restores the UI. Keystrokes inside
  // inputs (e.g. the playlist search box) are ignored.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        setUiHidden(!uiHidden);
      } else if (e.key === 'Escape' && uiHidden) {
        setUiHidden(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [uiHidden, setUiHidden]);

  useEffect(() => {
    if (!uiHidden) {
      setShowRestoreHint(false);
      return;
    }
    const handleMouseMove = () => {
      setShowRestoreHint(true);
      if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current);
      hintTimerRef.current = window.setTimeout(() => setShowRestoreHint(false), 2500);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current);
    };
  }, [uiHidden]);

  return (
    <main className="min-h-screen bg-black relative">
      <HeartAnimation
        audioElement={audioElement}
        isPlaying={isPlaying}
        isSpotifyMode={isSpotifyMode}
        albumColors={albumColors}
        currentPosition={playerState.position}
        particleLevel={particleLevel}
        tabAudioStream={tabAudioStream}
        hideIndicator={uiHidden}
      />
      <LiveLyrics
        currentTrackId={playerState.current_track?.id || null}
        currentTrackName={playerState.current_track?.name}
        currentArtist={playerState.current_track?.artists.map(a => a.name).join(', ')}
        currentPosition={playerState.position}
        isPlaying={isPlaying}
        lyricsMode={lyricsMode}
      />
      {/* UI chrome wrapper. Faded (not unmounted!) in clean mode: the
          AdvancedMusicPlayer owns the <audio> element, so unmounting it
          would stop local playback. */}
      <div
        style={{
          opacity: uiHidden ? 0 : 1,
          pointerEvents: uiHidden ? 'none' : 'auto',
          transition: 'opacity 0.6s ease',
        }}
        aria-hidden={uiHidden}
      >
        <SettingsPanel />
        <SpotifyLogin />
        <div className="absolute bottom-0 left-0 z-10">
          <AdvancedMusicPlayer />
        </div>
      </div>
      {/* Clean-mode restore button: appears on mouse movement, fades out. */}
      {uiHidden && (
        <button
          onClick={() => setUiHidden(false)}
          className="fixed bottom-6 right-6 z-50 px-4 py-2 rounded-xl bg-[#1a1a1d]/80 border border-white/10 text-[#8f8f9d] text-[12px] backdrop-blur-sm hover:bg-[#252529] hover:text-white"
          style={{
            opacity: showRestoreHint ? 1 : 0,
            pointerEvents: showRestoreHint ? 'auto' : 'none',
            transition: 'opacity 0.4s ease',
          }}
        >
          Show interface (H)
        </button>
      )}
    </main>
  );
}

export default function MusicPage() {
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
