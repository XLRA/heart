'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import SpotifyWebApi from 'spotify-web-api-js';

interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album: {
    name: string;
    images: Array<{ url: string }>;
  };
  preview_url: string | null;
  duration_ms: number;
  external_urls: {
    spotify: string;
  };
}

interface SpotifyPlaylist {
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
  owner?: {
    display_name?: string;
  };
}

interface SpotifyUser {
  id: string;
  display_name?: string;
  images?: Array<{ url: string }>;
  email?: string;
}

interface SpotifyContextType {
  isAuthenticated: boolean;
  user: SpotifyUser | null;
  playlists: SpotifyPlaylist[];
  currentPlaylist: SpotifyPlaylist | null;
  spotifyApi: SpotifyWebApi.SpotifyWebApiJs | null;
  login: () => void;
  logout: () => void;
  setCurrentPlaylist: (playlist: SpotifyPlaylist | null) => void;
  loadUserPlaylists: () => Promise<void>;
  loadPlaylistTracks: (playlistId: string) => Promise<SpotifyTrack[]>;
}

const SpotifyContext = createContext<SpotifyContextType | undefined>(undefined);

const CLIENT_ID = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID || '';
const REDIRECT_URI = process.env.NEXT_PUBLIC_SPOTIFY_REDIRECT_URI || 'http://localhost:3000/callback';
const SCOPES = [
  'user-read-private',
  'user-read-email',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read'
].join(' ');

export const SpotifyProvider = ({ children }: { children: ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<SpotifyUser | null>(null);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [currentPlaylist, setCurrentPlaylist] = useState<SpotifyPlaylist | null>(null);
  const [spotifyApi, setSpotifyApi] = useState<SpotifyWebApi.SpotifyWebApiJs | null>(null);
  const [isLoadingUserData, setIsLoadingUserData] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);
  const eventListenersSetup = useRef(false);

  const logout = useCallback(() => {
    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('spotify_token_type');
    localStorage.removeItem('spotify_expires_in');
    setSpotifyApi(null);
    setIsAuthenticated(false);
    setUser(null);
    setPlaylists([]);
    setCurrentPlaylist(null);
  }, []);

  const loadUserPlaylists = useCallback(async (api?: SpotifyWebApi.SpotifyWebApiJs) => {
    const apiInstance = api || spotifyApi;
    if (!apiInstance) return;

    try {
      const playlistsData = await apiInstance.getUserPlaylists();
      setPlaylists(playlistsData.items);
    } catch (error) {
      console.error('Error loading playlists:', error);
    }
  }, [spotifyApi]);

  const loadUserData = useCallback(async (api: SpotifyWebApi.SpotifyWebApiJs) => {
    if (isLoadingUserData) {
      console.log('Already loading user data, skipping...');
      return;
    }
    
    setIsLoadingUserData(true);
    
    try {
      const userData = await api.getMe();
      setUser(userData);
      
      // Add a small delay before loading playlists to avoid rate limiting
      setTimeout(async () => {
        try {
          await loadUserPlaylists(api);
        } catch (playlistError) {
          console.error('Error loading playlists (non-critical):', playlistError);
          // Don't logout for playlist errors, just log them
        }
      }, 1000);
      
    } catch (error: unknown) {
      console.error('Error loading user data:', error);
      
      // Check error type and handle accordingly
      if (error && typeof error === 'object' && 'status' in error) {
        const status = (error as { status: number }).status;
        
        if (status === 429) {
          // Rate limit error - retry after delay
          console.log('Rate limit hit, retrying in 5 seconds...');
          window.dispatchEvent(new CustomEvent('spotifyRateLimited'));
          setTimeout(() => {
            setIsLoadingUserData(false);
            loadUserData(api);
          }, 5000);
          return;
        } else if (status === 403) {
          // Forbidden error - likely regional/account issue
          console.error('Spotify API access forbidden (403). This may be due to regional restrictions or account limitations.');
          console.error('Full error details:', error);
          window.dispatchEvent(new CustomEvent('spotifyAccessForbidden'));
          // Don't logout immediately, show user-friendly message
          setIsLoadingUserData(false);
          return;
        } else if (status === 401) {
          // Unauthorized - token expired or invalid
          console.error('Spotify token expired or invalid (401). Logging out.');
          logout();
          return;
        }
      }
      
      // For other errors, logout
      console.error('Unexpected error, logging out');
      logout();
    } finally {
      setIsLoadingUserData(false);
    }
  }, [logout, loadUserPlaylists, isLoadingUserData]);

  const checkAuthState = useCallback(() => {
    if (hasInitialized) {
      console.log('Already initialized, skipping auth check');
      return;
    }
    
    const token = localStorage.getItem('spotify_access_token');
    console.log('Checking for existing token:', token ? 'Token found' : 'No token');
    
    if (token) {
      console.log('Setting up Spotify API with existing token');
      const api = new SpotifyWebApi();
      api.setAccessToken(token);
      setSpotifyApi(api);
      setIsAuthenticated(true);
      
      // Add a small delay to prevent rapid-fire API calls
      setTimeout(() => {
        if (!isLoadingUserData) {
          loadUserData(api);
        }
      }, 500);
    } else {
      console.log('No existing token found, user not authenticated');
      setIsAuthenticated(false);
      setSpotifyApi(null);
      setUser(null);
    }
    
    setHasInitialized(true);
  }, [hasInitialized, isLoadingUserData, loadUserData]); // Include loadUserData dependency

  useEffect(() => {
    // Only run once on mount
    checkAuthState();
    
    // Only set up event listeners once
    if (!eventListenersSetup.current) {
      // Listen for storage changes (when token is added from callback)
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key === 'spotify_access_token' && e.newValue) {
          console.log('Token storage changed, re-checking auth state');
          setHasInitialized(false); // Reset initialization flag
          checkAuthState();
        }
      };
      
      // Listen for custom token update event
      const handleTokenUpdate = () => {
        console.log('Custom token update event received, re-checking auth state');
        setHasInitialized(false); // Reset initialization flag
        checkAuthState();
      };
      
      window.addEventListener('storage', handleStorageChange);
      window.addEventListener('spotifyTokenUpdated', handleTokenUpdate);
      eventListenersSetup.current = true;
      
      return () => {
        window.removeEventListener('storage', handleStorageChange);
        window.removeEventListener('spotifyTokenUpdated', handleTokenUpdate);
        eventListenersSetup.current = false;
      };
    }
  }, [checkAuthState]); // Include checkAuthState dependency

  const login = () => {
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}&show_dialog=true`;
    window.location.href = authUrl;
  };

  const loadPlaylistTracks = async (playlistId: string): Promise<SpotifyTrack[]> => {
    if (!spotifyApi) return [];

    try {
      const tracksData = await spotifyApi.getPlaylistTracks(playlistId);
      return tracksData.items
        .map(item => item.track)
        .filter(track => track && 'preview_url' in track && track.preview_url) as SpotifyTrack[];
    } catch (error) {
      console.error('Error loading playlist tracks:', error);
      return [];
    }
  };

  const value: SpotifyContextType = {
    isAuthenticated,
    user,
    playlists,
    currentPlaylist,
    spotifyApi,
    login,
    logout,
    setCurrentPlaylist,
    loadUserPlaylists,
    loadPlaylistTracks
  };

  return (
    <SpotifyContext.Provider value={value}>
      {children}
    </SpotifyContext.Provider>
  );
};

export const useSpotify = () => {
  const context = useContext(SpotifyContext);
  if (context === undefined) {
    throw new Error('useSpotify must be used within a SpotifyProvider');
  }
  return context;
};
