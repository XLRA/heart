'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import Image from 'next/image';
import { useSpotify } from '../context/SpotifyContext';
import { useWebPlayer } from '../context/WebPlayerContext';
import PlaylistSelector from './PlaylistSelector';

interface Song {
  title: string;
  artist: string;
  url: string;
  cover: string;
  duration?: number;
  id?: string;
  uri?: string;
}

interface SpotifyPlaylistData {
  id: string;
  name: string;
  description?: string | null;
  images?: Array<{ url: string }>;
  tracks?: {
    total: number;
    href?: string;
    items?: Array<{
      track: {
        name: string;
        artists: Array<{ name: string }>;
        preview_url: string | null;
        album: { images: Array<{ url: string }> };
        duration_ms: number;
        id: string;
        external_urls?: { spotify: string };
      };
    }>;
  };
  owner?: { display_name?: string };
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
  
  const [showSeekTime, setShowSeekTime] = useState(false);
  const [seekTimeValue, setSeekTimeValue] = useState('00:00');
  const [seekHoverPosition, setSeekHoverPosition] = useState(0);
  const [previousVolume, setPreviousVolume] = useState(0.47);
  const [isMuted, setIsMuted] = useState(false);
  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const [showPlaylistSelector, setShowPlaylistSelector] = useState(false);
  const [currentPlaylistSongs, setCurrentPlaylistSongs] = useState<Song[]>([]);
  const [isUsingSpotifyPlayer, setIsUsingSpotifyPlayer] = useState(false);
  const [localPlayerState, setLocalPlayerState] = useState({
    is_paused: true,
    is_active: false,
    position: 0,
    duration: 0,
    volume: 0.5
  });
  
  const [localPosition, setLocalPosition] = useState(0);
  const localPositionRef = useRef<NodeJS.Timeout | null>(null);
  const isSeekingRef = useRef<boolean>(false);
  const seekTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const volumeBarRef = useRef<HTMLDivElement>(null);

  const defaultSongs = useMemo<Song[]>(() => [
    {
      title: "What You Need",
      artist: "The Weeknd - Durdnn Remix",
      url: "/music/song1.mp3",
      cover: "/covers/cover1.jpg"
    },
    {
      title: "No. 1 Party Anthem",
      artist: "Arctic Monkeys",
      url: "/music/song2.mp3",
      cover: "/covers/cover2.png"
    }
  ], []);

  const songs = useMemo<Song[]>(() => {
    if (isUsingSpotifyPlayer && playerState.current_track) {
      // Convert Spotify track to our Song format
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
        position: localPosition // Use local position for smooth updates
      };
    }
    return localPlayerState;
  }, [isUsingSpotifyPlayer, playerState, localPlayerState, localPosition]);

  const formatTime = (time: number): string => {
    if (isNaN(time)) return '00:00';
    
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    
    return `${minutes < 10 ? '0' + minutes : minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
  };

  const handleTogglePlay = () => {
    if (isUsingSpotifyPlayer && isReady) {
      togglePlay();
    } else if (audioRef.current) {
      if (localPlayerState.is_paused) {
        audioRef.current.play();
      } else {
        audioRef.current.pause();
      }
    }
  };

  const handleNextSong = () => {
    if (isUsingSpotifyPlayer && isReady) {
      nextTrack();
    }
    // For local songs, we'd need to implement this differently
  };

  const handlePreviousSong = () => {
    if (isUsingSpotifyPlayer && isReady) {
      previousTrack();
    }
    // For local songs, we'd need to implement this differently
  };

  const handleSeekHover = (e: React.MouseEvent<HTMLDivElement>) => {
    const seekBarContainer = e.currentTarget;
    const rect = seekBarContainer.getBoundingClientRect();
    const seekT = e.clientX - rect.left;
    // Fix duration calculation - ensure we're working with seconds consistently
    const currentDuration = isUsingSpotifyPlayer ? 
      (currentPlayerState.duration > 0 ? currentPlayerState.duration / 1000 : 0) : 
      (currentPlayerState.duration > 0 ? currentPlayerState.duration / 1000 : 0);
    
    if (currentDuration <= 0) return; // Don't show seek time if no duration
    
    const seekLoc = currentDuration * (seekT / seekBarContainer.offsetWidth);
    
    setSeekHoverPosition(seekT);
    
    const cM = seekLoc / 60;
    const ctMinutes = Math.floor(cM);
    const ctSeconds = Math.floor(seekLoc - ctMinutes * 60);
    
    if (ctMinutes < 0 || ctSeconds < 0) return;
    
    const formattedMinutes = ctMinutes < 10 ? `0${ctMinutes}` : `${ctMinutes}`;
    const formattedSeconds = ctSeconds < 10 ? `0${ctSeconds}` : `${ctSeconds}`;
    
    setSeekTimeValue(`${formattedMinutes}:${formattedSeconds}`);
    setShowSeekTime(true);
  };

  const handleSeekLeave = () => {
    setSeekHoverPosition(0);
    setShowSeekTime(false);
  };

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const seekBarContainer = e.currentTarget;
    const rect = seekBarContainer.getBoundingClientRect();
    const seekT = e.clientX - rect.left;
    // Fix duration calculation - ensure we're working with seconds consistently
    const currentDuration = isUsingSpotifyPlayer ? 
      (currentPlayerState.duration > 0 ? currentPlayerState.duration / 1000 : 0) : 
      (currentPlayerState.duration > 0 ? currentPlayerState.duration / 1000 : 0);
    
    if (currentDuration <= 0) return; // Don't seek if no duration
    
    const seekLoc = currentDuration * (seekT / seekBarContainer.offsetWidth);
    
    // Prevent multiple seek operations
    if (isSeekingRef.current) return;
    
    if (isUsingSpotifyPlayer && isReady) {
      isSeekingRef.current = true;
      
      // Clear any existing seek timeout
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
      }
      
      // Update local position immediately for responsive UI
      setLocalPosition(seekLoc * 1000);
      
      // Debounce the actual seek operation
      seekTimeoutRef.current = setTimeout(() => {
        seek(seekLoc * 1000); // Convert to milliseconds for Spotify
        isSeekingRef.current = false;
      }, 100); // Small delay to prevent rapid-fire seeks
    } else if (audioRef.current) {
      audioRef.current.currentTime = seekLoc;
      setLocalPlayerState(prev => ({ ...prev, position: seekLoc * 1000 }));
    }
    
    setSeekHoverPosition(0);
    setShowSeekTime(false);
  };

  const handleVolumeChange = useCallback((e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
    if (volumeBarRef.current) {
      const rect = volumeBarRef.current.getBoundingClientRect();
      const volumeValue = Math.max(0, Math.min(1, (e.clientX - rect.left) / volumeBarRef.current.offsetWidth));
      
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
    }
  }, [isUsingSpotifyPlayer, isReady, setVolume]);

  const handleVolumeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDraggingVolume(true);
    handleVolumeChange(e);
  };

  const handleVolumeMouseMove = useCallback((e: MouseEvent) => {
    if (isDraggingVolume) {
      handleVolumeChange(e);
    }
  }, [isDraggingVolume, handleVolumeChange]);

  const handleVolumeMouseUp = () => {
    setIsDraggingVolume(false);
  };

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

  const handlePlaylistSelect = (playlist: SpotifyPlaylistData) => {
    if (isReady && deviceId) {
      // Use Spotify Web Player for full playback
      const playlistUri = `spotify:playlist:${playlist.id}`;
      playPlaylist(playlistUri);
      setCurrentPlaylist(playlist);
      setIsUsingSpotifyPlayer(true);
      setShowPlaylistSelector(false);
    } else {
      // Fallback to preview URLs (limited functionality)
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
    }
  };

  const handlePlaylistToggle = () => {
    if (isAuthenticated) {
      setShowPlaylistSelector(!showPlaylistSelector);
    }
  };

  const handleBackToDefault = () => {
    setCurrentPlaylistSongs([]);
    setCurrentPlaylist(null);
    setIsUsingSpotifyPlayer(false);
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

  // Set audio source when current song changes
  useEffect(() => {
    if (audioRef.current && songs.length > 0 && songs[0].url) {
      audioRef.current.src = songs[0].url;
      audioRef.current.load(); // Reload the audio element with new source
    }
  }, [songs]);

  // Add audio event listeners for local playback
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || isUsingSpotifyPlayer) return; // Only handle local audio when not using Spotify

    const handlePlay = () => {
      setLocalPlayerState(prev => ({ ...prev, is_paused: false, is_active: true }));
    };

    const handlePause = () => {
      setLocalPlayerState(prev => ({ ...prev, is_paused: true }));
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
  }, [isUsingSpotifyPlayer]);

  // Local position timer for smooth seek bar updates
  useEffect(() => {
    if (isUsingSpotifyPlayer && playerState.is_active && !playerState.is_paused) {
      // Start local position timer for smooth updates
      localPositionRef.current = setInterval(() => {
        setLocalPosition(prev => {
          const newPosition = prev + 1000; // Add 1 second (1000ms)
          // Don't exceed the track duration
          if (playerState.duration > 0 && newPosition >= playerState.duration) {
            return playerState.duration;
          }
          return newPosition;
        });
      }, 1000); // Update every second
    } else {
      // Stop timer when paused or not active
      if (localPositionRef.current) {
        clearInterval(localPositionRef.current);
        localPositionRef.current = null;
      }
    }
    
    return () => {
      if (localPositionRef.current) {
        clearInterval(localPositionRef.current);
        localPositionRef.current = null;
      }
    };
  }, [isUsingSpotifyPlayer, playerState.is_active, playerState.is_paused, playerState.duration]);

  // Sync local position with Spotify position when it updates (but only if significantly different)
  useEffect(() => {
    if (isUsingSpotifyPlayer && playerState.position > 0 && !isSeekingRef.current) {
      const positionDiff = Math.abs(playerState.position - localPosition);
      // Only sync if the difference is more than 3 seconds to avoid conflicts with local timer
      if (positionDiff > 3000) {
        setLocalPosition(playerState.position);
      }
    }
  }, [isUsingSpotifyPlayer, playerState.position, localPosition]);

  useEffect(() => {
    if (isDraggingVolume) {
      window.addEventListener('mousemove', handleVolumeMouseMove);
      window.addEventListener('mouseup', handleVolumeMouseUp);
    }
    
    return () => {
      window.removeEventListener('mousemove', handleVolumeMouseMove);
      window.removeEventListener('mouseup', handleVolumeMouseUp);
    };
  }, [isDraggingVolume, handleVolumeMouseMove]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="fixed bottom-8 left-0 z-50" style={{ padding: '0 0 0 20px' }}>
      <div id="player-container" style={{
        width: '500px',
        height: '100px',
        position: 'relative',
        marginBottom: '50px'
      }}>
        <div id="player-track" style={{
          position: 'absolute',
          top: (!currentPlayerState.is_paused && currentPlayerState.is_active) ? '-92px' : '0',
          right: '15px',
          left: '15px',
          padding: '13px 22px 10px 184px',
          backgroundColor: '#151518',
          borderRadius: '15px 15px 0 0',
          transition: '0.3s ease top',
          zIndex: 1,
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderBottom: 'none'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <div id="album-name" style={{
              color: '#f1f1f1',
              fontSize: '17px',
              fontWeight: 'bold',
              flex: 1
            }}>{songs[0]?.title || 'No track'}</div>
            {currentPlaylist && (
              <button
                onClick={handleBackToDefault}
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: '#8f8f9d',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#252529';
                  e.currentTarget.style.color = '#ffffff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = '#8f8f9d';
                }}
                title="Back to default playlist"
              >
                <i className="fas fa-times"></i>
              </button>
            )}
          </div>
          <div id="track-name" style={{
            color: '#8f8f9d',
            fontSize: '13px',
            margin: '2px 0 8px 0'
          }}>
            {songs[0]?.artist || 'No artist'}
            {currentPlaylist && (
              <span style={{ color: '#1db954', marginLeft: '8px' }}>
                • {currentPlaylist.name}
              </span>
            )}
          </div>
          <div id="track-time" style={{
            height: '12px',
            marginBottom: '2px',
            overflow: 'hidden'
          }}>
            <div id="current-time" style={{
              float: 'left',
              color: (!currentPlayerState.is_paused && currentPlayerState.is_active) ? '#8f8f9d' : 'transparent',
              fontSize: '11px',
              backgroundColor: (!currentPlayerState.is_paused && currentPlayerState.is_active) ? 'transparent' : '#252529',
              borderRadius: '10px',
              transition: '0.3s ease all'
            }}>{formatTime(currentPlayerState.position / 1000)}</div>
            <div id="track-length" style={{
              float: 'right',
              color: (!currentPlayerState.is_paused && currentPlayerState.is_active) ? '#8f8f9d' : 'transparent',
              fontSize: '11px',
              backgroundColor: (!currentPlayerState.is_paused && currentPlayerState.is_active) ? 'transparent' : '#252529',
              borderRadius: '10px',
              transition: '0.3s ease all'
            }}>{formatTime(currentPlayerState.duration / 1000)}</div>
          </div>
          <div id="seek-bar-container" 
            style={{
              position: 'relative',
              height: '4px',
              borderRadius: '4px',
              backgroundColor: '#252529',
              cursor: 'pointer'
            }}
            onMouseMove={handleSeekHover}
            onMouseLeave={handleSeekLeave}
            onClick={handleSeekClick}
          >
            <div id="seek-time" style={{
              position: 'absolute',
              top: '-29px',
              color: '#fff',
              fontSize: '12px',
              whiteSpace: 'pre',
              padding: '5px 6px',
              borderRadius: '4px',
              display: showSeekTime ? 'block' : 'none',
              backgroundColor: '#151518',
              left: `${seekHoverPosition}px`,
              marginLeft: '-21px'
            }}>{seekTimeValue}</div>
            <div id="s-hover" style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: `${seekHoverPosition}px`,
              opacity: 0.2,
              zIndex: 2,
              backgroundColor: '#8f8f9d'
            }}></div>
            <div id="seek-bar" style={{
              content: '',
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: `${currentPlayerState.duration > 0 ? (currentPlayerState.position / currentPlayerState.duration) * 100 : 0}%`,
              backgroundColor: '#8f8f9d',
              transition: '0.2s ease width',
              zIndex: 1
            }}></div>
          </div>
        </div>
        <div id="player-content" style={{
          position: 'relative',
          height: '100%',
          backgroundColor: '#101012',
          boxShadow: '0 30px 80px #101012',
          borderRadius: '15px',
          zIndex: 2,
          border: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <div id="album-art" style={{
            position: 'absolute',
            top: (!currentPlayerState.is_paused && currentPlayerState.is_active) ? '-60px' : '-40px',
            width: '115px',
            height: '115px',
            marginLeft: '40px',
            transform: 'rotateZ(0)',
            transition: '0.3s ease all',
            boxShadow: (!currentPlayerState.is_paused && currentPlayerState.is_active) ? '0 0 0 4px #23232b, 0 30px 50px -15px #23232b' : '0 0 0 10px #18181f',
            borderRadius: '50%',
            overflow: 'hidden',
            backgroundColor: '#151518'
          }}>
            <Image 
              src={songs[0]?.cover || '/covers/cover1.jpg'}
              alt={`${songs[0]?.title || 'No track'} cover`}
              width={115}
              height={115}
              onError={(e) => {
                console.warn('Image loading error for:', songs[0]?.cover);
                e.currentTarget.style.display = 'none';
                // Show fallback
                const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                if (fallback) fallback.style.display = 'flex';
              }}
              className="w-full h-full object-cover"
              style={{
                animation: (!currentPlayerState.is_paused && currentPlayerState.is_active) ? 'rotateAlbumArt 3s linear 0s infinite forwards' : 'none'
              }}
            />
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'none',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#252529',
              color: '#8f8f9d',
              fontSize: '24px'
            }}>
              <i className="fas fa-music"></i>
            </div>
            <div id="buffer-box" style={{
              position: 'absolute',
              top: '50%',
              right: 0,
              left: 0,
              height: '13px',
              color: '#fff',
              fontSize: '13px',
              fontFamily: 'Helvetica',
              textAlign: 'center',
              fontWeight: 'bold',
              lineHeight: 1,
              padding: '6px',
              margin: '-12px auto 0 auto',
              backgroundColor: 'rgba(36, 36, 48, 0.7)',
              opacity: (!currentPlayerState.is_active && isReady) ? 1 : 0,
              zIndex: 2
            }}>Buffering ...</div>
          </div>
          <div id="player-controls" style={{
            width: '320px',
            height: '100%',
            margin: '0 5px 0 141px',
            float: 'right',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            {/* Playlist Button */}
            <div className="control" style={{
              width: '25%',
              display: 'flex',
              justifyContent: 'center',
              padding: '12px 0'
            }}>
              <div 
                className="button" 
                onClick={isAuthenticated ? handlePlaylistToggle : undefined}
                style={{
                  width: '76px',
                  height: '76px',
                  backgroundColor: 'transparent',
                  borderRadius: '16px',
                  cursor: isAuthenticated ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: isAuthenticated ? 1 : 0.3
                }}
                title={isAuthenticated ? (currentPlaylist ? 'Switch Playlist' : 'Select Playlist') : 'Connect to Spotify to access playlists'}
              >
                <i style={{
                  color: currentPlaylist ? '#1db954' : '#b0b3c6',
                  fontSize: '26px'
                }} className="fab fa-spotify"></i>
              </div>
            </div>
            <div className="control" style={{
              width: '25%',
              display: 'flex',
              justifyContent: 'center',
              padding: '12px 0'
            }}>
              <div 
                className="button" 
                onClick={handlePreviousSong}
                style={{
                  width: '76px',
                  height: '76px',
                  backgroundColor: 'transparent',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <i style={{
                  color: '#b0b3c6',
                  fontSize: '26px'
                }} className="fas fa-backward"></i>
              </div>
            </div>
            <div className="control" style={{
              width: '25%',
              display: 'flex',
              justifyContent: 'center',
              padding: '12px 0'
            }}>
              <div 
                className="button" 
                onClick={handleTogglePlay}
                style={{
                  width: '76px',
                  height: '76px',
                  backgroundColor: 'transparent',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <i style={{
                  color: '#b0b3c6',
                  fontSize: '26px'
                }} className={currentPlayerState.is_paused ? "fas fa-play" : "fas fa-pause"}></i>
              </div>
            </div>
            <div className="control" style={{
              width: '25%',
              display: 'flex',
              justifyContent: 'center',
              padding: '12px 0'
            }}>
              <div 
                className="button" 
                onClick={handleNextSong}
                style={{
                  width: '76px',
                  height: '76px',
                  backgroundColor: 'transparent',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <i style={{
                  color: '#b0b3c6',
                  fontSize: '26px'
                }} className="fas fa-forward"></i>
              </div>
            </div>
          </div>
        </div>
        <div id="volume-control" style={{
          position: 'absolute',
          top: '100%',
          right: '15px',
          left: '15px',
          padding: '13px 22px',
          backgroundColor: '#151518',
          borderRadius: '0 0 15px 15px',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: '15px',
          height: '50px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderTop: 'none'
        }}>
          <div 
            className="button"
            onClick={handleMuteToggle}
            style={{
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
              backgroundColor: 'transparent',
              cursor: 'pointer'
            }}
          >
            <i style={{
              color: '#8f8f9d',
              fontSize: '16px'
            }} className={isMuted ? "fas fa-volume-mute" : currentPlayerState.volume === 0 ? "fas fa-volume-off" : currentPlayerState.volume < 0.5 ? "fas fa-volume-down" : "fas fa-volume-up"}></i>
          </div>
          <div id="volume-bar-container" 
            ref={volumeBarRef}
            style={{
              position: 'relative',
              flex: 1,
              height: '4px',
              borderRadius: '4px',
              backgroundColor: '#252529',
              cursor: 'pointer'
            }}
            onClick={handleVolumeChange}
            onMouseDown={handleVolumeMouseDown}
          >
            <div id="volume-bar" style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: `${currentPlayerState.volume * 100}%`,
              backgroundColor: '#fff',
              transition: '0.2s ease width',
              borderRadius: '4px'
            }}></div>
          </div>
        </div>
      </div>
      <audio ref={audioRef} />
      <PlaylistSelector
        onPlaylistSelect={handlePlaylistSelect}
        isVisible={showPlaylistSelector}
        onClose={() => setShowPlaylistSelector(false)}
      />
      <style jsx>{`
        @keyframes rotateAlbumArt {
          0% { transform: rotateZ(0); }
          100% { transform: rotateZ(360deg); }
        }
        
        #album-art:before {
          content: "";
          position: absolute;
          top: 50%;
          right: 0;
          left: 0;
          width: 20px;
          height: 20px;
          margin: -10px auto 0 auto;
          background-color: #252529;
          border-radius: 50%;
          box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.2);
          z-index: 2;
        }

        .button {
          transition: all 0.2s ease;
        }
        
        .button i {
          transition: all 0.2s ease;
        }
        
        .button:hover {
          background-color: #252529 !important;
        }
        
        .button:hover i {
          color: #ffffff !important;
        }

        #volume-bar-container:hover #volume-bar {
          background-color: #ffffff !important;
        }
      `}</style>
    </div>
  );
};

export default AdvancedMusicPlayer; 