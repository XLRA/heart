'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useSpotify } from '../context/SpotifyContext';
import { useWebPlayer } from '../context/WebPlayerContext';

const SpotifyLogin = () => {
  const { login, isAuthenticated, user, logout } = useSpotify();
  const { initializePlayer } = useWebPlayer();
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [isAccessForbidden, setIsAccessForbidden] = useState(false);

  // Listen for rate limit and access forbidden events
  useEffect(() => {
    const handleRateLimit = () => {
      setIsRateLimited(true);
      setTimeout(() => setIsRateLimited(false), 5000);
    };

    const handleAccessForbidden = () => {
      setIsAccessForbidden(true);
      // Keep the message visible until user manually dismisses or retries
    };

    window.addEventListener('spotifyRateLimited', handleRateLimit);
    window.addEventListener('spotifyAccessForbidden', handleAccessForbidden);
    
    return () => {
      window.removeEventListener('spotifyRateLimited', handleRateLimit);
      window.removeEventListener('spotifyAccessForbidden', handleAccessForbidden);
    };
  }, []);

  // Initialize Web Player when authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      const token = localStorage.getItem('spotify_access_token');
      if (token) {
        // Wait for SDK to be ready
        if (window.Spotify) {
          initializePlayer(token);
        } else {
          // Listen for the custom SDK ready event
          const handleSDKReady = () => {
            console.log('Spotify Web Playback SDK is ready via event');
            initializePlayer(token);
          };
          
          window.addEventListener('spotifySDKReady', handleSDKReady);
          
          return () => {
            window.removeEventListener('spotifySDKReady', handleSDKReady);
          };
        }
      }
    }
  }, [isAuthenticated, user, initializePlayer]);

  if (isAuthenticated && user) {
    return (
      <div className="fixed top-4 right-4 z-50">
        <div style={{
          backgroundColor: '#151518',
          borderRadius: '15px',
          padding: '15px 20px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          minWidth: '200px'
        }}>
          {user.images && user.images.length > 0 && (
            <Image
              src={user.images[0].url}
              alt={user.display_name || 'User'}
              width={32}
              height={32}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                objectFit: 'cover'
              }}
              onError={(e) => {
                console.warn('User image failed to load:', user.images?.[0]?.url);
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              color: '#f1f1f1',
              fontSize: '14px',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {user.display_name || 'User'}
            </div>
            <div style={{
              color: isRateLimited ? '#ff6b6b' : isAccessForbidden ? '#ff6b6b' : '#8f8f9d',
              fontSize: '12px'
            }}>
              {isRateLimited ? 'Loading... (Rate limited)' : 
               isAccessForbidden ? 'Access restricted - Try again' : 
               'Connected to Spotify'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {isAccessForbidden && (
              <button
                onClick={() => {
                  setIsAccessForbidden(false);
                  // Trigger a re-check of auth state
                  window.dispatchEvent(new CustomEvent('spotifyTokenUpdated'));
                }}
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: '#1db954',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '6px',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#252529';
                  e.currentTarget.style.color = '#1ed760';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = '#1db954';
                }}
                title="Retry connection"
              >
                <i className="fas fa-redo" style={{ fontSize: '12px' }}></i>
              </button>
            )}
            <button
              onClick={logout}
              style={{
                backgroundColor: 'transparent',
                border: 'none',
                color: '#8f8f9d',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '6px',
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
              title="Disconnect from Spotify"
            >
              <i className="fas fa-sign-out-alt" style={{ fontSize: '14px' }}></i>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed top-4 right-4 z-50">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
        {isAccessForbidden && (
          <div style={{
            backgroundColor: '#ff6b6b',
            color: '#ffffff',
            padding: '8px 12px',
            borderRadius: '8px',
            fontSize: '12px',
            maxWidth: '200px',
            textAlign: 'center'
          }}>
            Spotify access restricted in your region. Try using a VPN or contact support.
          </div>
        )}
        <button
          onClick={login}
          style={{
            backgroundColor: '#1db954',
            color: '#ffffff',
            border: 'none',
            borderRadius: '15px',
            padding: '12px 20px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px',
            fontWeight: 'bold',
            transition: 'all 0.2s ease',
            boxShadow: '0 4px 12px rgba(29, 185, 84, 0.3)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#1ed760';
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 6px 16px rgba(29, 185, 84, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#1db954';
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(29, 185, 84, 0.3)';
          }}
        >
          <i className="fab fa-spotify" style={{ fontSize: '16px' }}></i>
          Connect Spotify
        </button>
      </div>
    </div>
  );
};

export default SpotifyLogin;
