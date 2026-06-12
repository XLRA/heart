'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useSpotify } from '../context/SpotifyContext';
import { useWebPlayer } from '../context/WebPlayerContext';
import { useAudioVisualizer } from '../context/AudioVisualizerContext';
import { extractColorsFromImage, getSmallestImageUrl, getDefaultColors } from '../../services/colorExtractor';
import PlaylistSelector from './PlaylistSelector';
import PlaylistSongList from './PlaylistSongList';
import { SpotifyPlaylistData } from '../../types/spotify';

// Sub-components
import AlbumArt from './player/AlbumArt';
import TrackInfo from './player/TrackInfo';
import ProgressBar from './player/ProgressBar';
import PlayerControls from './player/PlayerControls';
import VolumeControl from './player/VolumeControl';

interface Song {
  title: string;
  artist: string;
  url: string;
  cover: string;
  duration?: number;
  id?: string;
  uri?: string;
}

const AdvancedMusicPlayer = () => {
  const { isAuthenticated, currentPlaylist, setCurrentPlaylist } = useSpotify();
  const { 
    playerState, 
    isReady, 
    deviceId, 
    playPlaylist, 
    togglePlay, 
    nextTrack, 
    previousTrack, 
    setVolume, 
    seek 
  } = useWebPlayer();
  const { setAudioElement, setIsPlaying, setSpotifyMode, setAlbumColors } = useAudioVisualizer();
  
  const [previousVolume, setPreviousVolume] = useState(0.47);
  const [isMuted, setIsMuted] = useState(false);
  const [showPlaylistSelector, setShowPlaylistSelector] = useState(false);
  const [showPlaylistSongs, setShowPlaylistSongs] = useState(false);
  const [currentPlaylistSongs, setCurrentPlaylistSongs] = useState<Song[]>([]);
  const [isUsingSpotifyPlayer, setIsUsingSpotifyPlayer] = useState(false);
  const [localPlayerState, setLocalPlayerState] = useState({
    is_paused: true,
    is_active: false,
    position: 0,
    duration: 0,
    volume: 0.5
  });
  // Index into the local song list (playlist songs or bundled defaults).
  const [localSongIndex, setLocalSongIndex] = useState(0);

  const isSeekingRef = useRef<boolean>(false);
  const seekTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Set when a local track change should keep playing (next/prev while
  // playing, or auto-advance on 'ended'); consumed by the src-loading effect.
  const autoPlayNextLoadRef = useRef(false);

  const audioRef = useRef<HTMLAudioElement>(null);

  const defaultSongs = useMemo<Song[]>(() => [
    {
      title: "No. 1 Party Anthem",
      artist: "Arctic Monkeys",
      url: "/music/song2.mp3",
      cover: "/covers/cover2.png"
    },
    {
      title: "What You Need",
      artist: "The Weeknd - Durdnn Remix",
      url: "/music/song1.mp3",
      cover: "/covers/cover1.jpg"
    }
  ], []);

  const songs = useMemo<Song[]>(() => {
    if (isUsingSpotifyPlayer) {
      // When using Spotify Web Player, ONLY show Spotify tracks
      // Don't fall back to local songs even if current_track is null
      if (playerState.current_track) {
        return [{
          title: playerState.current_track.name,
          artist: playerState.current_track.artists.map(artist => artist.name).join(', '),
          url: '', // Not used for Spotify tracks
          cover: playerState.current_track.album.images[0]?.url || '/covers/cover1.jpg',
          duration: playerState.current_track.duration_ms / 1000,
          id: playerState.current_track.id,
          uri: playerState.current_track.uri
        }];
      }
      // Return placeholder when Spotify mode but no track yet
      return [{
        title: 'Loading...',
        artist: 'Spotify',
        url: '', // No URL for Spotify mode
        cover: '/covers/cover1.jpg'
      }];
    }
    // Only use local playlist songs or default songs when NOT in Spotify mode
    if (currentPlaylistSongs.length > 0) {
      return currentPlaylistSongs;
    }
    return defaultSongs;
  }, [currentPlaylistSongs, defaultSongs, isUsingSpotifyPlayer, playerState.current_track]);

  // The track shown in the UI / loaded into the <audio> element. In Spotify
  // mode `songs` is always a single-entry list; in local mode it's the full
  // local list indexed by localSongIndex (wrapped for safety).
  const currentSong = useMemo<Song | undefined>(() => {
    if (isUsingSpotifyPlayer) return songs[0];
    if (songs.length === 0) return undefined;
    return songs[localSongIndex % songs.length];
  }, [isUsingSpotifyPlayer, songs, localSongIndex]);

  // Reset the local index when the local list itself changes (playlist
  // loaded / cleared) so we never start mid-list.
  useEffect(() => {
    setLocalSongIndex(0);
  }, [currentPlaylistSongs]);

  // Use appropriate player state based on whether we're using Spotify or local audio
  const currentPlayerState = useMemo(() => {
    if (isUsingSpotifyPlayer) {
      return {
        ...playerState,
        position: playerState.position // Use Spotify position directly
      };
    }
    return localPlayerState;
  }, [isUsingSpotifyPlayer, playerState, localPlayerState]);

  const handleTogglePlay = useCallback(() => {
    if (isUsingSpotifyPlayer && isReady) {
      togglePlay();
    } else if (audioRef.current) {
      if (localPlayerState.is_paused) {
        audioRef.current.play();
      } else {
        audioRef.current.pause();
      }
    }
  }, [isUsingSpotifyPlayer, isReady, togglePlay, localPlayerState.is_paused]);

  // Local-mode track stepping. Wraps around the list; if the player was
  // playing, the newly loaded track auto-plays (via autoPlayNextLoadRef,
  // consumed in the src-loading effect).
  const stepLocalSong = useCallback((direction: 1 | -1) => {
    if (songs.length === 0) return;
    autoPlayNextLoadRef.current = !localPlayerState.is_paused;
    setLocalSongIndex(prev => (prev + direction + songs.length) % songs.length);
  }, [songs.length, localPlayerState.is_paused]);

  const handleNextSong = useCallback(() => {
    if (isUsingSpotifyPlayer && isReady) {
      nextTrack();
    } else if (!isUsingSpotifyPlayer) {
      stepLocalSong(1);
    }
  }, [isUsingSpotifyPlayer, isReady, nextTrack, stepLocalSong]);

  const handlePreviousSong = useCallback(() => {
    if (isUsingSpotifyPlayer && isReady) {
      previousTrack();
    } else if (!isUsingSpotifyPlayer) {
      // Standard player behavior: restart the current track when it's been
      // playing for a few seconds, otherwise go to the previous one.
      if (audioRef.current && audioRef.current.currentTime > 3) {
        audioRef.current.currentTime = 0;
      } else {
        stepLocalSong(-1);
      }
    }
  }, [isUsingSpotifyPlayer, isReady, previousTrack, stepLocalSong]);

  const handleSeek = (newPositionMs: number) => {
    // Prevent multiple seek operations
    if (isSeekingRef.current) return;
    
    if (isUsingSpotifyPlayer && isReady) {
      isSeekingRef.current = true;
      
      // Clear any existing seek timeout
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
      }
      
      // Debounce the actual seek operation
      seekTimeoutRef.current = setTimeout(() => {
        seek(newPositionMs);
        isSeekingRef.current = false;
      }, 100); // Small delay to prevent rapid-fire seeks
    } else if (audioRef.current) {
      audioRef.current.currentTime = newPositionMs / 1000;
      setLocalPlayerState(prev => ({ ...prev, position: newPositionMs }));
    }
  };

  const handleVolumeChange = useCallback((volumeValue: number) => {
    // Update local state immediately for responsive UI
    if (isUsingSpotifyPlayer) {
      setLocalPlayerState(prev => ({ ...prev, volume: volumeValue }));
      if (isReady) {
        setVolume(volumeValue);
      }
    } else if (audioRef.current) {
      audioRef.current.volume = volumeValue;
      setLocalPlayerState(prev => ({ ...prev, volume: volumeValue }));
    }
  }, [isUsingSpotifyPlayer, isReady, setVolume]);

  const handleMuteToggle = () => {
    if (isMuted) {
      // Unmute - restore previous volume
      if (isUsingSpotifyPlayer) {
        setLocalPlayerState(prev => ({ ...prev, volume: previousVolume }));
        if (isReady) {
          setVolume(previousVolume);
        }
      } else if (audioRef.current) {
        audioRef.current.volume = previousVolume;
        setLocalPlayerState(prev => ({ ...prev, volume: previousVolume }));
      }
    } else {
      // Mute - save current volume and set to 0
      setPreviousVolume(currentPlayerState.volume);
      if (isUsingSpotifyPlayer) {
        setLocalPlayerState(prev => ({ ...prev, volume: 0 }));
        if (isReady) {
          setVolume(0);
        }
      } else if (audioRef.current) {
        audioRef.current.volume = 0;
        setLocalPlayerState(prev => ({ ...prev, volume: 0 }));
      }
    }
    setIsMuted(!isMuted);
  };

  const handlePlaylistSelect = useCallback((playlist: SpotifyPlaylistData) => {
    // The PlaylistSelector blocks clicks until isReady, so we should always
    // hit the Spotify Web Player path here. The preview_url fallback that
    // used to live in this else branch was the source of the "selecting a
    // playlist plays the local Arctic Monkeys track" bug: Spotify nulled out
    // most preview_urls in late 2024, so .filter(s => s.url) produced an
    // empty list and `songs` fell back to defaultSongs (local files).
    if (!isReady || !deviceId) {
      console.warn('[AdvancedMusicPlayer] Playlist selected before Web Player was ready - ignoring');
      return;
    }

    // Stop and clear local audio synchronously before state updates so it
    // can't sneak in between renders.
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current.load();
    }

    setIsUsingSpotifyPlayer(true);
    setCurrentPlaylist(playlist);
    setShowPlaylistSelector(false);
    setShowPlaylistSongs(true);

    const playlistUri = `spotify:playlist:${playlist.id}`;
    playPlaylist(playlistUri);
  }, [isReady, deviceId, playPlaylist, setCurrentPlaylist]);

  const handlePlaylistToggle = () => {
    if (isAuthenticated) {
      setShowPlaylistSelector(!showPlaylistSelector);
    }
  };

  const handleBackToDefault = () => {
    setCurrentPlaylistSongs([]);
    setCurrentPlaylist(null);
    setIsUsingSpotifyPlayer(false);
    setShowPlaylistSongs(false);
    // Stop Spotify playback if active
    if (isReady && deviceId) {
      fetch('https://api.spotify.com/v1/me/player/pause', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('spotify_access_token')}`
        }
      }).catch(error => {
        console.error('Error pausing Spotify playback:', error);
      });
    }
  };

  const handlePlaylistSongsToggle = () => {
    if (currentPlaylist) {
      setShowPlaylistSongs(!showPlaylistSongs);
    }
  };

  // Set audio source when current song changes (only for local playback)
  useEffect(() => {
    // Only load local audio when NOT using Spotify player AND we have a valid local URL
    // Double check that the song URL is actually a local file path (starts with /)
    // This prevents accidentally loading if a Spotify track sneaks through
    if (!isUsingSpotifyPlayer && audioRef.current && currentSong?.url?.startsWith('/')) {
      const audio = audioRef.current;
      // Skip the reload when this source is already loaded (e.g. effect
      // re-run from a mode round trip) so playback position survives.
      if (!audio.src.endsWith(currentSong.url)) {
        audio.src = currentSong.url;
        audio.load(); // Reload the audio element with new source
        if (autoPlayNextLoadRef.current) {
          autoPlayNextLoadRef.current = false;
          audio.play().catch(err => console.warn('Auto-play after track change failed:', err));
        }
      }
      // Set audio element for visualizer
      setAudioElement(audio);
    }
  }, [currentSong, setAudioElement, isUsingSpotifyPlayer]);

  // Add audio event listeners for local playback
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // If using Spotify, prevent local audio from playing
    if (isUsingSpotifyPlayer) {
      // Immediately pause if audio somehow starts playing
      const preventPlay = () => {
        console.log('Preventing local audio from playing during Spotify mode');
        audio.pause();
      };
      
      audio.addEventListener('play', preventPlay);
      
      return () => {
        audio.removeEventListener('play', preventPlay);
      };
    }

    // Handle local audio playback when NOT using Spotify
    const handlePlay = () => {
      setLocalPlayerState(prev => ({ ...prev, is_paused: false, is_active: true }));
      setIsPlaying(true);
    };

    const handlePause = () => {
      setLocalPlayerState(prev => ({ ...prev, is_paused: true }));
      setIsPlaying(false);
    };

    const handleTimeUpdate = () => {
      setLocalPlayerState(prev => ({ 
        ...prev, 
        position: audio.currentTime * 1000,
        duration: audio.duration * 1000 || prev.duration
      }));
    };

    const handleLoadedMetadata = () => {
      setLocalPlayerState(prev => ({
        ...prev,
        duration: audio.duration * 1000 || prev.duration
      }));
    };

    // Auto-advance to the next local track when the current one finishes.
    const handleEnded = () => {
      if (songs.length === 0) return;
      autoPlayNextLoadRef.current = true;
      setLocalSongIndex(prev => (prev + 1) % songs.length);
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [isUsingSpotifyPlayer, setIsPlaying, songs.length]);

  // Update visualizer state based on Spotify player state
  useEffect(() => {
    if (isUsingSpotifyPlayer) {
      setIsPlaying(!playerState.is_paused && playerState.is_active);
      setSpotifyMode(true);
      // Pause and clear local audio element when switching to Spotify mode
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    } else {
      setSpotifyMode(false);
    }
  }, [isUsingSpotifyPlayer, playerState.is_paused, playerState.is_active, setIsPlaying, setSpotifyMode]);

  // Extract album colors when track changes (supports both Spotify and local tracks)
  useEffect(() => {
    let isMounted = true;
    
    // Determine the image URL based on whether we're using Spotify or local files
    let imageUrl: string | null = null;
    
    if (isUsingSpotifyPlayer && playerState.current_track?.album?.images) {
      // Spotify track - get the smallest image for faster extraction
      imageUrl = getSmallestImageUrl(playerState.current_track.album.images);
    } else if (!isUsingSpotifyPlayer && songs.length > 0 && songs[0].cover) {
      // Local track - use the cover path directly
      imageUrl = songs[0].cover;
    }
    
    if (!imageUrl) {
      // No album art available, use default colors
      console.log('[AdvancedMusicPlayer] No album art found, using default colors');
      setAlbumColors(getDefaultColors());
      return;
    }

    const extractColors = async () => {
      try {
        console.log('[AdvancedMusicPlayer] Extracting colors from:', imageUrl);
        const colors = await extractColorsFromImage(imageUrl!);
        
        if (isMounted) {
          if (colors) {
            console.log('[AdvancedMusicPlayer] ✅ Album colors extracted successfully');
            setAlbumColors(colors);
          } else {
            console.log('[AdvancedMusicPlayer] ⚠️ Color extraction failed, using defaults');
            setAlbumColors(getDefaultColors());
          }
        }
      } catch (error) {
        console.error('[AdvancedMusicPlayer] Error extracting colors:', error);
        if (isMounted) setAlbumColors(getDefaultColors());
      }
    };

    extractColors();

    return () => {
      isMounted = false;
    };
  }, [playerState.current_track?.id, playerState.current_track?.album?.images, isUsingSpotifyPlayer, songs, setAlbumColors]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
      }
    };
  }, []);

  const isActive = !currentPlayerState.is_paused && currentPlayerState.is_active;

  return (
    <>
      <div className="fixed bottom-8 left-0 z-50 pl-5">
        <div id="player-container" className="w-[500px] h-[100px] relative mb-[50px]">
          
          {currentPlaylist && (
            <PlaylistSongList
              playlist={currentPlaylist}
              isVisible={showPlaylistSongs}
              onClose={() => setShowPlaylistSongs(false)}
              currentTrackId={playerState.current_track?.id || null}
              isPlayerExtended={isActive}
            />
          )}

          <TrackInfo
            title={currentSong?.title ?? ''}
            artist={currentSong?.artist ?? ''}
            currentPlaylist={currentPlaylist}
            showPlaylistSongs={showPlaylistSongs}
            onPlaylistSongsToggle={handlePlaylistSongsToggle}
            onBackToDefault={handleBackToDefault}
            isActive={isActive}
          >
            <ProgressBar 
              position={currentPlayerState.position} 
              duration={currentPlayerState.duration} 
              onSeek={handleSeek}
              isActive={isActive}
            />
          </TrackInfo>

          {/* Player Content */}
          <div className="relative h-full bg-[#101012] shadow-[0_30px_80px_#101012] rounded-[15px] z-[2] border border-white/10">
            <AlbumArt
              cover={currentSong?.cover ?? ''}
              title={currentSong?.title ?? ''}
              isActive={isActive}
              isBuffering={!currentPlayerState.is_active && isReady}
            />

            <PlayerControls 
              isAuthenticated={isAuthenticated}
              isPaused={currentPlayerState.is_paused}
              currentPlaylistId={currentPlaylist?.id || null}
              onTogglePlay={handleTogglePlay}
              onNext={handleNextSong}
              onPrevious={handlePreviousSong}
              onPlaylistToggle={handlePlaylistToggle}
            />
          </div>

          <VolumeControl 
            volume={currentPlayerState.volume} 
            isMuted={isMuted} 
            onVolumeChange={handleVolumeChange} 
            onMuteToggle={handleMuteToggle} 
          />
        </div>

        <audio ref={audioRef} />
        
        <PlaylistSelector
          onPlaylistSelect={handlePlaylistSelect}
          isVisible={showPlaylistSelector}
          onClose={() => setShowPlaylistSelector(false)}
        />
      </div>
    </>
  );
};

export default AdvancedMusicPlayer;
