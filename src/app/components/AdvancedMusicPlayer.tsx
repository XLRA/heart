'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useSpotify } from '../context/SpotifyContext';
import { useWebPlayer } from '../context/WebPlayerContext';
import { useAudioVisualizer } from '../context/AudioVisualizerContext';
import { meydaAudioService } from '../../services/meyda';
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
  const { setAudioElement, setIsPlaying, setSpotifyMode, spotifyTrackData, setSpotifyTrackData, setMeydaData } = useAudioVisualizer();
  
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
  
  const isSeekingRef = useRef<boolean>(false);
  const seekTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const meydaInitializedTrackRef = useRef<string | null>(null);
  
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

  const handleNextSong = useCallback(() => {
    if (isUsingSpotifyPlayer && isReady) {
      nextTrack();
    }
    // For local songs, we'd need to implement this differently
  }, [isUsingSpotifyPlayer, isReady, nextTrack]);

  const handlePreviousSong = useCallback(() => {
    if (isUsingSpotifyPlayer && isReady) {
      previousTrack();
    }
    // For local songs, we'd need to implement this differently
  }, [isUsingSpotifyPlayer, isReady, previousTrack]);

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
    if (isReady && deviceId) {
      // Use Spotify Web Player for full playback
      // IMMEDIATELY stop and clear local audio BEFORE state updates (synchronous)
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current.load(); // Reset the audio element
      }
      
      // Now set Spotify mode to prevent local audio from loading
      setIsUsingSpotifyPlayer(true);
      setCurrentPlaylist(playlist);
      setShowPlaylistSelector(false);
      setShowPlaylistSongs(true); // Show playlist songs panel
      
      // Start playback after state is set
      const playlistUri = `spotify:playlist:${playlist.id}`;
      playPlaylist(playlistUri);
    } else {
      // Fallback to preview URLs (limited functionality)
      // Process tracks asynchronously to prevent UI freeze
      setTimeout(() => {
        const spotifySongs: Song[] = (playlist.tracks?.items || []).map((item) => {
          const track = item.track;
          return {
            title: track.name,
            artist: track.artists.map((artist) => artist.name).join(', '),
            url: track.preview_url || '',
            cover: track.album.images && track.album.images.length > 0 ? track.album.images[0].url : '/covers/cover1.jpg',
            duration: track.duration_ms / 1000,
            id: track.id,
            uri: track.external_urls?.spotify || `spotify:track:${track.id}`
          };
        }).filter((song: Song) => song.url); // Only include songs with preview URLs

        setCurrentPlaylistSongs(spotifySongs);
        setCurrentPlaylist(playlist);
        setIsUsingSpotifyPlayer(false);
        setShowPlaylistSelector(false);
        setShowPlaylistSongs(true); // Show playlist songs panel
      }, 0);
    }
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
    if (!isUsingSpotifyPlayer && audioRef.current && songs.length > 0 && songs[0].url) {
      // Double check that the song URL is actually a local file path (starts with /)
      // This prevents accidentally loading if a Spotify track sneaks through
      if (songs[0].url.startsWith('/')) {
        audioRef.current.src = songs[0].url;
        audioRef.current.load(); // Reload the audio element with new source
        // Set audio element for visualizer
        setAudioElement(audioRef.current);
      }
    }
  }, [songs, setAudioElement, isUsingSpotifyPlayer]);

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

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [isUsingSpotifyPlayer, setIsPlaying]);

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
      setSpotifyTrackData(null);
    }
  }, [isUsingSpotifyPlayer, playerState.is_paused, playerState.is_active, setIsPlaying, setSpotifyMode, setSpotifyTrackData]);

  // Fetch Spotify track audio features
  useEffect(() => {
    if (!isUsingSpotifyPlayer || !playerState.current_track?.id) {
      setSpotifyTrackData(null);
      setMeydaData(null);
      meydaAudioService.stopAnalysis();
      return;
    }

    let isMounted = true;

    const fetchTrackFeatures = async () => {
      // Check if audio-features endpoint is deprecated (cached)
      const isDeprecated = localStorage.getItem('spotify_audio_features_deprecated') === 'true';
      
      if (isDeprecated) {
        // Skip API call and use fallback values immediately
        if (isMounted) {
          setSpotifyTrackData({
            tempo: 120,
            energy: 0.5,
            danceability: 0.5,
            valence: 0.5
          });
        }
        return;
      }

      try {
        const token = localStorage.getItem('spotify_access_token');
        if (!token) {
          if (isMounted) {
            setSpotifyTrackData({
              tempo: 120,
              energy: 0.5,
              danceability: 0.5,
              valence: 0.5
            });
          }
          return;
        }

        // Try the audio-features endpoint first
        const response = await fetch(`https://api.spotify.com/v1/audio-features/${playerState.current_track?.id}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!isMounted) return;

        if (response.ok) {
          const features = await response.json();
          if (isMounted) {
            setSpotifyTrackData({
              tempo: features.tempo,
              energy: features.energy,
              danceability: features.danceability,
              valence: features.valence
            });
          }
        } else if (response.status === 403) {
          // Cache deprecation status to avoid repeated calls
          localStorage.setItem('spotify_audio_features_deprecated', 'true');
          // Use fallback values when API is deprecated
          if (isMounted) {
            setSpotifyTrackData({
              tempo: 120,
              energy: 0.5,
              danceability: 0.5,
              valence: 0.5
            });
          }
        } else {
          if (isMounted) {
            setSpotifyTrackData({
              tempo: 120,
              energy: 0.5,
              danceability: 0.5,
              valence: 0.5
            });
          }
        }
      } catch {
        // Fallback to default values
        if (isMounted) {
          setSpotifyTrackData({
            tempo: 120,
            energy: 0.5,
            danceability: 0.5,
            valence: 0.5
          });
        }
      }
    };

    fetchTrackFeatures();
    
    return () => {
      isMounted = false;
    };
  }, [isUsingSpotifyPlayer, playerState.current_track?.id, setSpotifyTrackData, setMeydaData]);

  // Initialize Meyda analysis separately - only when track ID changes
  useEffect(() => {
    if (!isUsingSpotifyPlayer || !playerState.current_track?.id) {
      meydaInitializedTrackRef.current = null;
      meydaAudioService.stopAnalysis();
      return;
    }

    const currentTrackId = playerState.current_track.id;

    // Only initialize if we haven't already initialized for this track
    if (meydaInitializedTrackRef.current === currentTrackId) {
      return;
    }

    // Only initialize if we have track data (wait for it to be set)
    if (!spotifyTrackData) {
      return;
    }

    let isMounted = true;

    const initializeMeyda = async () => {
      if (!isMounted || meydaInitializedTrackRef.current === currentTrackId) return;
      
      meydaInitializedTrackRef.current = currentTrackId;

      try {
        // Initialize Meyda audio context (creates synthetic audio source for Spotify)
        await meydaAudioService.initializeAudioContext();
        
        // Start Meyda analysis with callback and track data
        await meydaAudioService.startAnalysis((features) => {
          if (isMounted && meydaInitializedTrackRef.current === currentTrackId) {
            setMeydaData(features);
          }
        }, spotifyTrackData);
      } catch (error) {
        console.error('Error initializing Meyda analysis:', error);
        if (isMounted) {
          setMeydaData(null);
        }
        meydaInitializedTrackRef.current = null;
      }
    };

    initializeMeyda();
    
    return () => {
      isMounted = false;
      if (meydaInitializedTrackRef.current === currentTrackId) {
        meydaAudioService.stopAnalysis();
      }
    };
  }, [isUsingSpotifyPlayer, playerState.current_track?.id, spotifyTrackData, setMeydaData]);

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
            title={songs[0]?.title}
            artist={songs[0]?.artist}
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
              cover={songs[0]?.cover} 
              title={songs[0]?.title} 
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
