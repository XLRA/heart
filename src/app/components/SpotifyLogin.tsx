'use client';

import Image from 'next/image';
import { useSpotify } from '../context/SpotifyContext';

const SpotifyLogin = () => {
  const { login, isAuthenticated, user, logout } = useSpotify();

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
              color: '#8f8f9d',
              fontSize: '12px'
            }}>
              Connected to Spotify
            </div>
          </div>
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
    );
  }

  return (
    <div className="fixed top-4 right-4 z-50">
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
  );
};

export default SpotifyLogin;
