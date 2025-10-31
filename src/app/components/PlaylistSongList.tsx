'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useWebPlayer } from '../context/WebPlayerContext';

interface SpotifyTrack {
  name: string;
  artists: Array<{ name: string }>;
  album: { images: Array<{ url: string }> };
  duration_ms: number;
  id: string;
  uri?: string;
  external_urls?: { spotify: string };
}

interface PlaylistSongListProps {
  playlist: {
    id: string;
    name: string;
    images?: Array<{ url: string }>;
    tracks?: {
      items?: Array<{
        track: SpotifyTrack;
      }>;
    };
  };
  isVisible: boolean;
  onClose: () => void;
  currentTrackId?: string | null;
  isPlayerExtended?: boolean;
}

const PlaylistSongList = ({ playlist, isVisible, onClose, currentTrackId, isPlayerExtended = false }: PlaylistSongListProps) => {
  const { playTrack, isReady, deviceId } = useWebPlayer();
  const [hoveredTrackId, setHoveredTrackId] = useState<string | null>(null);

  if (!playlist.tracks?.items) return null;

  const tracks = playlist.tracks.items.filter(item => item.track).map(item => item.track);

  const handleTrackClick = (track: SpotifyTrack) => {
    if (!isReady || !deviceId) {
      console.warn('Spotify player not ready');
      return;
    }

    // Try to get URI from track, or construct it from ID
    let trackUri: string;
    if (track.uri) {
      trackUri = track.uri;
    } else if (track.external_urls?.spotify) {
      // Convert external URL to URI format
      const urlMatch = track.external_urls.spotify.match(/track\/([^?]+)/);
      if (urlMatch) {
        trackUri = `spotify:track:${urlMatch[1]}`;
      } else {
        trackUri = `spotify:track:${track.id}`;
      }
    } else {
      // Fallback: construct URI from ID
      trackUri = `spotify:track:${track.id}`;
    }
    
    playTrack(trackUri);
  };

  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
  };

  // Calculate transform: when visible, adjust for player-track position, when hidden, slide up and fade
  const getTransform = () => {
    if (!isVisible) {
      return 'translate3d(0, -30px, 0)'; // Hidden: slide up slightly and fade (avoids going under player)
    }
    // Visible: account for player-track being extended (it's 92px higher when extended)
    const playerOffset = isPlayerExtended ? -92 : 0;
    return `translate3d(0, ${playerOffset}px, 0)`;
  };

  return (
    <div style={{
      position: 'absolute',
      bottom: '100%',
      left: '15px',
      right: '15px',
      maxHeight: '400px',
      backgroundColor: '#151518',
      borderRadius: '15px 15px 12px 12px',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderBottom: 'none',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 1,
      overflow: 'hidden',
      boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.3)',
      transform: getTransform(),
      opacity: isVisible ? 1 : 0,
      transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      pointerEvents: isVisible ? 'auto' : 'none',
      willChange: 'transform, opacity',
      backfaceVisibility: 'hidden',
      WebkitBackfaceVisibility: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
          {playlist.images && playlist.images.length > 0 && (
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '6px',
              overflow: 'hidden',
              backgroundColor: '#252529',
              flexShrink: 0
            }}>
              <Image
                src={playlist.images[0].url}
                alt={playlist.name}
                width={40}
                height={40}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
              />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{
              color: '#f1f1f1',
              fontSize: '16px',
              fontWeight: 'bold',
              margin: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {playlist.name}
            </h3>
            <p style={{
              color: '#8f8f9d',
              fontSize: '12px',
              margin: '2px 0 0 0'
            }}>
              {tracks.length} tracks
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            backgroundColor: 'transparent',
            border: 'none',
            color: '#8f8f9d',
            cursor: 'pointer',
            padding: '8px',
            borderRadius: '8px',
            transition: 'all 0.2s ease',
            flexShrink: 0
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#252529';
            e.currentTarget.style.color = '#ffffff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = '#8f8f9d';
          }}
          title="Close playlist"
        >
          <i className="fas fa-chevron-down" style={{ fontSize: '14px' }}></i>
        </button>
      </div>

      {/* Song List */}
      <div 
        className="playlist-songs-container"
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '8px 12px'
        }}
      >
        {tracks.length === 0 ? (
          <div style={{
            textAlign: 'center',
            color: '#8f8f9d',
            padding: '40px 20px'
          }}>
            <i className="fas fa-music" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.5 }}></i>
            <p>No tracks available</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {tracks.map((track, index) => {
              const isCurrentTrack = currentTrackId === track.id;
              const isHovered = hoveredTrackId === track.id;
              
              return (
                <div
                  key={track.id || index}
                  onClick={() => handleTrackClick(track)}
                  onMouseEnter={() => setHoveredTrackId(track.id)}
                  onMouseLeave={() => setHoveredTrackId(null)}
                  style={{
                    backgroundColor: isCurrentTrack ? '#252529' : (isHovered ? '#1a1a1d' : 'transparent'),
                    borderRadius: '8px',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    border: '1px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    borderColor: isCurrentTrack ? 'rgba(29, 185, 84, 0.3)' : (isHovered ? 'rgba(255, 255, 255, 0.1)' : 'transparent')
                  }}
                >
                  {/* Track Number or Play Icon */}
                  <div style={{
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    {isCurrentTrack ? (
                      <i className="fas fa-volume-up" style={{ 
                        color: '#1db954', 
                        fontSize: '12px' 
                      }}></i>
                    ) : isHovered ? (
                      <i className="fas fa-play" style={{ 
                        color: '#f1f1f1', 
                        fontSize: '10px' 
                      }}></i>
                    ) : (
                      <span style={{
                        color: '#8f8f9d',
                        fontSize: '13px'
                      }}>{index + 1}</span>
                    )}
                  </div>

                  {/* Track Image */}
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    backgroundColor: '#252529',
                    flexShrink: 0
                  }}>
                    {track.album?.images && track.album.images.length > 0 ? (
                      <Image
                        src={track.album.images[0].url}
                        alt={track.name}
                        width={48}
                        height={48}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover'
                        }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: '#252529',
                        color: '#8f8f9d'
                      }}>
                        <i className="fas fa-music" style={{ fontSize: '16px' }}></i>
                      </div>
                    )}
                  </div>

                  {/* Track Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      color: isCurrentTrack ? '#1db954' : '#f1f1f1',
                      fontSize: '14px',
                      fontWeight: isCurrentTrack ? 'bold' : 'normal',
                      margin: 0,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {track.name}
                    </div>
                    <div style={{
                      color: '#8f8f9d',
                      fontSize: '12px',
                      margin: '2px 0 0 0',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {track.artists.map(artist => artist.name).join(', ')}
                    </div>
                  </div>

                  {/* Duration */}
                  <div style={{
                    color: '#8f8f9d',
                    fontSize: '12px',
                    flexShrink: 0,
                    marginLeft: '8px'
                  }}>
                    {formatDuration(track.duration_ms)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style jsx global>{`
        .playlist-songs-container::-webkit-scrollbar {
          width: 8px;
        }
        
        .playlist-songs-container::-webkit-scrollbar-track {
          background: #151518;
          border-radius: 4px;
        }
        
        .playlist-songs-container::-webkit-scrollbar-thumb {
          background: #252529;
          border-radius: 4px;
        }
        
        .playlist-songs-container::-webkit-scrollbar-thumb:hover {
          background: #353539;
        }
        
        .playlist-songs-container {
          scrollbar-width: thin;
          scrollbar-color: #252529 #151518;
        }
      `}</style>
    </div>
  );
};

export default PlaylistSongList;

