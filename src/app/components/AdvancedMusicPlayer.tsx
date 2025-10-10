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
      if (playerState.is_paused) {
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
    const currentDuration = isUsingSpotifyPlayer ? playerState.duration / 1000 : playerState.duration / 1000;
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
    const currentDuration = isUsingSpotifyPlayer ? playerState.duration / 1000 : playerState.duration / 1000;
    const seekLoc = currentDuration * (seekT / seekBarContainer.offsetWidth);
    
    if (isUsingSpotifyPlayer && isReady) {
      seek(seekLoc * 1000); // Convert to milliseconds for Spotify
    } else if (audioRef.current) {
      audioRef.current.currentTime = seekLoc;
    }
    
    setSeekHoverPosition(0);
    setShowSeekTime(false);
  };

  const handleVolumeChange = useCallback((e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
    if (volumeBarRef.current) {
      const rect = volumeBarRef.current.getBoundingClientRect();
      const volumeValue = Math.max(0, Math.min(1, (e.clientX - rect.left) / volumeBarRef.current.offsetWidth));
      if (isUsingSpotifyPlayer && isReady) {
        setVolume(volumeValue);
      } else if (audioRef.current) {
        audioRef.current.volume = volumeValue;
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
      if (isUsingSpotifyPlayer && isReady) {
        setVolume(previousVolume);
      } else if (audioRef.current) {
        audioRef.current.volume = previousVolume;
      }
    } else {
      setPreviousVolume(playerState.volume);
      if (isUsingSpotifyPlayer && isReady) {
        setVolume(0);
      } else if (audioRef.current) {
        audioRef.current.volume = 0;
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
          top: (!playerState.is_paused && playerState.is_active) ? '-92px' : '0',
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
              color: (!playerState.is_paused && playerState.is_active) ? '#8f8f9d' : 'transparent',
              fontSize: '11px',
              backgroundColor: (!playerState.is_paused && playerState.is_active) ? 'transparent' : '#252529',
              borderRadius: '10px',
              transition: '0.3s ease all'
            }}>{formatTime(playerState.position / 1000)}</div>
            <div id="track-length" style={{
              float: 'right',
              color: (!playerState.is_paused && playerState.is_active) ? '#8f8f9d' : 'transparent',
              fontSize: '11px',
              backgroundColor: (!playerState.is_paused && playerState.is_active) ? 'transparent' : '#252529',
              borderRadius: '10px',
              transition: '0.3s ease all'
            }}>{formatTime(playerState.duration / 1000)}</div>
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
              width: `${playerState.duration > 0 ? (playerState.position / playerState.duration) * 100 : 0}%`,
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
            top: (!playerState.is_paused && playerState.is_active) ? '-60px' : '-40px',
            width: '115px',
            height: '115px',
            marginLeft: '40px',
            transform: 'rotateZ(0)',
            transition: '0.3s ease all',
            boxShadow: (!playerState.is_paused && playerState.is_active) ? '0 0 0 4px #23232b, 0 30px 50px -15px #23232b' : '0 0 0 10px #18181f',
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
                animation: (!playerState.is_paused && playerState.is_active) ? 'rotateAlbumArt 3s linear 0s infinite forwards' : 'none'
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
              opacity: (!playerState.is_active && isReady) ? 1 : 0,
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
                }} className={playerState.is_paused ? "fas fa-play" : "fas fa-pause"}></i>
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
            }} className={isMuted ? "fas fa-volume-mute" : playerState.volume === 0 ? "fas fa-volume-off" : playerState.volume < 0.5 ? "fas fa-volume-down" : "fas fa-volume-up"}></i>
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
              width: `${playerState.volume * 100}%`,
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