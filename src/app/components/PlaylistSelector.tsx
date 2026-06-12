'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Icon from './Icon';
import { useSpotify } from '../context/SpotifyContext';
import { useWebPlayer } from '../context/WebPlayerContext';

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
        uri?: string;
        external_urls?: { spotify: string };
      };
    }>;
  };
  owner?: { display_name?: string };
}

interface PlaylistSelectorProps {
  onPlaylistSelect: (playlist: SpotifyPlaylistData) => void;
  isVisible: boolean;
  onClose: () => void;
}

const PlaylistSelector = ({ onPlaylistSelect, isVisible, onClose }: PlaylistSelectorProps) => {
  const { playlists, loadUserPlaylists, loadPlaylistTracks, spotifyApi } = useSpotify();
  const { isReady: isPlayerReady, playerError } = useWebPlayer();
  const [loading, setLoading] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyPlaylistData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (isVisible && playlists.length === 0) {
      loadUserPlaylists();
    }
    // Clear search when modal opens
    if (isVisible) {
      setSearchQuery('');
    }
  }, [isVisible, playlists.length, loadUserPlaylists]);

  // Filter playlists based on search query
  const filteredPlaylists = playlists.filter((playlist) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const nameMatch = playlist.name?.toLowerCase().includes(query);
    const ownerMatch = playlist.owner?.display_name?.toLowerCase().includes(query);
    return nameMatch || ownerMatch;
  });

  const handlePlaylistClick = async (playlist: SpotifyPlaylistData) => {
    if (!isPlayerReady) {
      console.warn('[PlaylistSelector] Spotify player not ready yet, ignoring click');
      return;
    }
    setLoading(true);
    setSelectedPlaylist(playlist);
    
    try {
      // Load all tracks (not just those with preview URLs) for Web Player compatibility
      if (spotifyApi) {
        const allTracks: Array<{
          name: string;
          artists: SpotifyApi.ArtistObjectSimplified[];
          album: SpotifyApi.AlbumObjectSimplified;
          duration_ms: number;
          id: string;
          preview_url: string | null;
          uri: string;
          external_urls: { spotify: string };
        }> = [];
        
        let offset = 0;
        const limit = 100; // Spotify's max per request
        let hasMore = true;

        // Paginate through all tracks
        while (hasMore) {
          const tracksData = await spotifyApi.getPlaylistTracks(playlist.id, { offset, limit });
          
          const tracks = tracksData.items
            .map(item => item.track)
            .filter((track): track is SpotifyApi.TrackObjectFull => 
              track !== null && track !== undefined && 'type' in track && track.type === 'track'
            )
            .map(track => ({
              name: track.name,
              artists: track.artists || [],
              album: track.album || { images: [] },
              duration_ms: track.duration_ms || 0,
              id: track.id,
              preview_url: track.preview_url || null,
              uri: track.uri || `spotify:track:${track.id}`,
              external_urls: track.external_urls || { spotify: `https://open.spotify.com/track/${track.id}` }
            }));
          
          allTracks.push(...tracks);
          
          // Check if there are more tracks to fetch
          hasMore = tracksData.next !== null;
          offset += limit;
          
          // Safety limit to prevent infinite loops
          if (offset > 500) {
            console.warn('Reached safety limit of 500 tracks');
            break;
          }
        }

        console.log(`[PlaylistSelector] Loaded ${allTracks.length} tracks from playlist "${playlist.name}"`);
        
        const playlistWithTracks: SpotifyPlaylistData = {
          ...playlist,
          tracks: {
            total: allTracks.length,
            items: allTracks.map(track => ({ track }))
          }
        };
        onPlaylistSelect(playlistWithTracks);
      } else {
        // Fallback to preview URLs only if no API available
        const tracks = await loadPlaylistTracks(playlist.id);
        const playlistWithTracks: SpotifyPlaylistData = {
          ...playlist,
          tracks: {
            total: tracks.length,
            items: tracks.map(track => ({ track }))
          }
        };
        onPlaylistSelect(playlistWithTracks);
      }
    } catch (error) {
      console.error('Error loading playlist tracks:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isVisible) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{
        backgroundColor: '#151518',
        borderRadius: '20px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        maxWidth: '600px',
        width: '100%',
        maxHeight: '80vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <h2 style={{
              color: '#f1f1f1',
              fontSize: '20px',
              fontWeight: 'bold',
              margin: 0
            }}>
              Select a Playlist
            </h2>
            {!isPlayerReady && !playerError && (
              <span style={{
                color: '#8f8f9d',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <span style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#1db954',
                  animation: 'connectingPulse 1.2s ease-in-out infinite'
                }} />
                Connecting to Spotify...
              </span>
            )}
            {!isPlayerReady && playerError && (
              <span style={{
                color: '#ff6b6b',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <span style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#ff6b6b'
                }} />
                {playerError.code === 'eme'
                  ? 'Browser DRM disabled — playback unavailable'
                  : playerError.code === 'account'
                    ? 'Spotify Premium required for in-app playback'
                    : playerError.code === 'authentication'
                      ? 'Spotify session expired — please log out and back in'
                      : 'Spotify player failed to initialise'}
              </span>
            )}
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
          >
            <Icon name="times" style={{ fontSize: '16px' }} />
          </button>
        </div>

        {/* Search Bar */}
        <div style={{
          padding: '0 24px 16px 24px',
        }}>
          <div style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center'
          }}>
            <Icon
              name="search"
              style={{
                position: 'absolute',
                left: '14px',
                color: '#8f8f9d',
                fontSize: '14px',
                pointerEvents: 'none'
              }}
            />
            <input
              type="text"
              placeholder="Search playlists..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: '#1a1a1d',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '10px',
                padding: '12px 14px 12px 40px',
                color: '#f1f1f1',
                fontSize: '14px',
                outline: 'none',
                transition: 'all 0.2s ease'
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'rgba(29, 185, 84, 0.5)';
                e.currentTarget.style.backgroundColor = '#202024';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.backgroundColor = '#1a1a1d';
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '10px',
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: '#8f8f9d',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#ffffff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#8f8f9d';
                }}
              >
                <Icon name="times" style={{ fontSize: '12px' }} />
              </button>
            )}
          </div>
        </div>

        {/* Player error banner (EME / account / auth / connection). Renders
            inside the modal body so the user can actually see *why* clicking
            a playlist does nothing, instead of an indefinite spinner. */}
        {playerError && (
          <div style={{
            margin: '0 24px 12px 24px',
            padding: '12px 14px',
            borderRadius: '10px',
            backgroundColor: 'rgba(255, 107, 107, 0.08)',
            border: '1px solid rgba(255, 107, 107, 0.35)',
            color: '#ffd6d6',
            fontSize: '12px',
            lineHeight: 1.5,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4, color: '#ff8a8a' }}>
              {playerError.code === 'eme' && 'Browser DRM is required for Spotify playback'}
              {playerError.code === 'account' && 'Spotify Premium required'}
              {playerError.code === 'authentication' && 'Spotify session expired'}
              {playerError.code === 'initialization' && 'Spotify player failed to start'}
              {playerError.code === 'connection' && 'Could not reach Spotify'}
            </div>
            {playerError.code === 'eme' && (
              <div>
                Spotify’s Web Playback SDK uses encrypted media (Widevine).
                In Chrome, enable it at{' '}
                <code style={{
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  padding: '1px 4px',
                  borderRadius: 4,
                }}>chrome://settings/content/protectedContent</code>{' '}
                → “Sites can play protected content”, then reload.
                Some hardened browsers (Brave, LibreWolf) and privacy
                extensions block this by design.
              </div>
            )}
            {playerError.code === 'account' && (
              <div>
                In-browser playback requires a Spotify Premium account.
                Free accounts can still browse playlists, but cannot stream
                from this player.
              </div>
            )}
            {playerError.code === 'authentication' && (
              <div>
                Your Spotify access token is no longer valid. Please log out
                from the badge in the top-right and log back in.
              </div>
            )}
            {(playerError.code === 'initialization' || playerError.code === 'connection') && (
              <div>
                {playerError.message}. Try reloading the page; if it persists,
                disable strict ad/tracker blockers for this site.
              </div>
            )}
          </div>
        )}

        {/* Playlist List */}
        <div 
          className="playlist-list-container"
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '16px 24px'
          }}>
          {playlists.length === 0 ? (
            <div style={{
              textAlign: 'center',
              color: '#8f8f9d',
              padding: '40px 20px'
            }}>
              <Icon name="music" style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }} />
              <p>No playlists found</p>
            </div>
          ) : filteredPlaylists.length === 0 ? (
            <div style={{
              textAlign: 'center',
              color: '#8f8f9d',
              padding: '40px 20px'
            }}>
              <Icon name="search" style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }} />
              <p>No playlists match &quot;{searchQuery}&quot;</p>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gap: '12px'
            }}>
              {filteredPlaylists.map((playlist) => (
                <div
                  key={playlist.id}
                  onClick={() => handlePlaylistClick(playlist)}
                  style={{
                    backgroundColor: selectedPlaylist?.id === playlist.id ? '#252529' : 'transparent',
                    borderRadius: '12px',
                    padding: '16px',
                    cursor: isPlayerReady ? 'pointer' : 'not-allowed',
                    transition: 'all 0.2s ease',
                    border: '1px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    opacity: isPlayerReady ? 1 : 0.5
                  }}
                  onMouseEnter={(e) => {
                    if (isPlayerReady && selectedPlaylist?.id !== playlist.id) {
                      e.currentTarget.style.backgroundColor = '#1a1a1d';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedPlaylist?.id !== playlist.id) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.borderColor = 'transparent';
                    }
                  }}
                >
                  {/* Playlist Image */}
                  <div style={{
                    width: '60px',
                    height: '60px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    backgroundColor: '#252529',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {playlist.images && playlist.images.length > 0 ? (
                      <Image
                        src={playlist.images[0].url}
                        alt={playlist.name}
                        width={60}
                        height={60}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover'
                        }}
                        onError={(e) => {
                          console.warn('Playlist image failed to load:', playlist.images?.[0]?.url);
                          e.currentTarget.style.display = 'none';
                          // Show fallback icon
                          const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                          if (fallback) fallback.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <Icon
                      name="music"
                      style={{
                        color: '#8f8f9d',
                        fontSize: '20px',
                        display: playlist.images && playlist.images.length > 0 ? 'none' : 'block',
                        margin: 'auto'
                      }}
                    />
                  </div>

                  {/* Playlist Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{
                      color: '#f1f1f1',
                      fontSize: '16px',
                      fontWeight: 'bold',
                      margin: '0 0 4px 0',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {playlist.name}
                    </h3>
                    <p style={{
                      color: '#8f8f9d',
                      fontSize: '14px',
                      margin: '0 0 4px 0',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {playlist.owner?.display_name || 'Unknown'}
                    </p>
                    <p style={{
                      color: '#8f8f9d',
                      fontSize: '12px',
                      margin: 0
                    }}>
                      {playlist.tracks?.total || 0} tracks
                    </p>
                  </div>

                  {/* Loading or Select Indicator */}
                  {selectedPlaylist?.id === playlist.id && loading ? (
                    <div style={{
                      width: '20px',
                      height: '20px',
                      border: '2px solid #8f8f9d',
                      borderTop: '2px solid #1db954',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite'
                    }}></div>
                  ) : (
                    <Icon
                      name="chevron-right"
                      style={{
                        color: '#8f8f9d',
                        fontSize: '14px',
                        opacity: selectedPlaylist?.id === playlist.id ? 1 : 0.5
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes connectingPulse {
          0%, 100% { opacity: 0.4; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
      <style jsx global>{`
        .playlist-list-container::-webkit-scrollbar {
          width: 8px;
        }
        
        .playlist-list-container::-webkit-scrollbar-track {
          background: #151518;
          border-radius: 4px;
        }
        
        .playlist-list-container::-webkit-scrollbar-thumb {
          background: #252529;
          border-radius: 4px;
        }
        
        .playlist-list-container::-webkit-scrollbar-thumb:hover {
          background: #353539;
        }
        
        .playlist-list-container {
          scrollbar-width: thin;
          scrollbar-color: #252529 #151518;
        }
      `}</style>
    </div>
  );
};

export default PlaylistSelector;
