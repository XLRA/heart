'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useSpotify } from '../context/SpotifyContext';

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

interface PlaylistSelectorProps {
  onPlaylistSelect: (playlist: SpotifyPlaylistData) => void;
  isVisible: boolean;
  onClose: () => void;
}

const PlaylistSelector = ({ onPlaylistSelect, isVisible, onClose }: PlaylistSelectorProps) => {
  const { playlists, loadUserPlaylists, loadPlaylistTracks } = useSpotify();
  const [loading, setLoading] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyPlaylistData | null>(null);

  useEffect(() => {
    if (isVisible && playlists.length === 0) {
      loadUserPlaylists();
    }
  }, [isVisible, playlists.length, loadUserPlaylists]);

  const handlePlaylistClick = async (playlist: SpotifyPlaylistData) => {
    setLoading(true);
    setSelectedPlaylist(playlist);
    
    try {
      const tracks = await loadPlaylistTracks(playlist.id);
      const playlistWithTracks: SpotifyPlaylistData = {
        ...playlist,
        tracks: {
          total: tracks.length,
          items: tracks.map(track => ({ track }))
        }
      };
      onPlaylistSelect(playlistWithTracks);
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
          <h2 style={{
            color: '#f1f1f1',
            fontSize: '20px',
            fontWeight: 'bold',
            margin: 0
          }}>
            Select a Playlist
          </h2>
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
            <i className="fas fa-times" style={{ fontSize: '16px' }}></i>
          </button>
        </div>

        {/* Playlist List */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 24px'
        }}>
          {playlists.length === 0 ? (
            <div style={{
              textAlign: 'center',
              color: '#8f8f9d',
              padding: '40px 20px'
            }}>
              <i className="fas fa-music" style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}></i>
              <p>No playlists found</p>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gap: '12px'
            }}>
              {playlists.map((playlist) => (
                <div
                  key={playlist.id}
                  onClick={() => handlePlaylistClick(playlist)}
                  style={{
                    backgroundColor: selectedPlaylist?.id === playlist.id ? '#252529' : 'transparent',
                    borderRadius: '12px',
                    padding: '16px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    border: '1px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px'
                  }}
                  onMouseEnter={(e) => {
                    if (selectedPlaylist?.id !== playlist.id) {
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
                      />
                    ) : (
                      <i className="fas fa-music" style={{ color: '#8f8f9d', fontSize: '20px' }}></i>
                    )}
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
                    <i 
                      className="fas fa-chevron-right" 
                      style={{ 
                        color: '#8f8f9d', 
                        fontSize: '14px',
                        opacity: selectedPlaylist?.id === playlist.id ? 1 : 0.5
                      }}
                    ></i>
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
      `}</style>
    </div>
  );
};

export default PlaylistSelector;
