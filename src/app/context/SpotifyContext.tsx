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

// Exchange the stored refresh token for a fresh access token via our API
// route. Persists the new token (and rotated refresh token / expiry) to
// localStorage so every consumer that reads the token at call time picks it
// up. Returns the new access token, or null when refresh isn't possible.
async function refreshStoredToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('spotify_refresh_token');
  if (!refreshToken) return null;

  try {
    const response = await fetch('/api/spotify/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!response.ok) {
      console.error('Spotify token refresh failed:', response.status);
      return null;
    }
    const data = await response.json();
    if (!data.access_token) return null;

    localStorage.setItem('spotify_access_token', data.access_token);
    if (data.refresh_token) localStorage.setItem('spotify_refresh_token', data.refresh_token);
    if (data.expires_in) {
      localStorage.setItem(
        'spotify_token_expires_at',
        String(Date.now() + Number(data.expires_in) * 1000)
      );
    }
    return data.access_token;
  } catch (error) {
    console.error('Error refreshing Spotify token:', error);
    return null;
  }
}

// True when the stored token expires within `ms` (or already has). Unknown
// expiry (older sessions that never stored it) counts as NOT expiring -- the
// 401-retry path covers those.
function tokenExpiresWithin(ms: number): boolean {
  const expiresAt = Number(localStorage.getItem('spotify_token_expires_at'));
  if (!expiresAt) return false;
  return Date.now() > expiresAt - ms;
}

const CLIENT_ID = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID || '';
const REDIRECT_URI = process.env.NEXT_PUBLIC_SPOTIFY_REDIRECT_URI || 'http://localhost:3000/music/callback';
const SCOPES = [
  'user-read-private',
  'user-read-email',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played'
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
  // Guards the 401 -> refresh -> retry path against looping when the API
  // keeps rejecting a freshly refreshed token.
  const hasRetriedAuthRef = useRef(false);

  const logout = useCallback(() => {
    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('spotify_token_type');
    localStorage.removeItem('spotify_expires_in'); // legacy key
    localStorage.removeItem('spotify_refresh_token');
    localStorage.removeItem('spotify_token_expires_at');
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
      const allPlaylists: SpotifyPlaylist[] = [];
      let offset = 0;
      const limit = 50; // Spotify's max per request for playlists
      let hasMore = true;

      // Paginate through all playlists
      while (hasMore) {
        // getUserPlaylists accepts (userId?, options?) - pass undefined for current user
        const playlistsData = await apiInstance.getUserPlaylists(undefined, { offset, limit });
        
        if (playlistsData.items && playlistsData.items.length > 0) {
          allPlaylists.push(...playlistsData.items);
        }
        
        // Check if there are more playlists to fetch
        hasMore = playlistsData.next !== null;
        offset += limit;
        
        // Safety limit
        if (offset > 500) {
          console.warn('Reached safety limit of 500 playlists');
          break;
        }
      }

      console.log(`[SpotifyContext] Loaded ${allPlaylists.length} playlists (including Blends)`);
      setPlaylists(allPlaylists);
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
      hasRetriedAuthRef.current = false;

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
          // Unauthorized - token expired or invalid. Try a one-shot refresh
          // before giving up; only logout when refresh isn't possible.
          if (!hasRetriedAuthRef.current) {
            hasRetriedAuthRef.current = true;
            const newToken = await refreshStoredToken();
            if (newToken) {
              console.log('Spotify token refreshed after 401, retrying...');
              api.setAccessToken(newToken);
              setIsLoadingUserData(false);
              loadUserData(api);
              return;
            }
          }
          console.error('Spotify token expired and refresh failed (401). Logging out.');
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

  const checkAuthState = useCallback(async () => {
    if (hasInitialized) {
      console.log('Already initialized, skipping auth check');
      return;
    }
    setHasInitialized(true);

    let token = localStorage.getItem('spotify_access_token');
    console.log('Checking for existing token:', token ? 'Token found' : 'No token');

    // Refresh up-front when the stored token is expired or about to expire,
    // so returning visitors don't start their session with a guaranteed 401.
    if (token && tokenExpiresWithin(60_000)) {
      console.log('Stored Spotify token expired/expiring, refreshing...');
      const refreshed = await refreshStoredToken();
      if (refreshed) {
        token = refreshed;
      } else if (tokenExpiresWithin(0)) {
        // Definitely expired and unrefreshable -- treat as logged out.
        token = null;
      }
    }

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
      console.log('No valid token found, user not authenticated');
      setIsAuthenticated(false);
      setSpotifyApi(null);
      setUser(null);
    }
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

  // Proactive token refresh: schedule a refresh ~2 minutes before the stored
  // expiry so long listening sessions never hit a mid-playback 401. The Web
  // Playback SDK and all Web API calls read the token from localStorage at
  // call time, so they pick the new token up automatically.
  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      const expiresAt = Number(localStorage.getItem('spotify_token_expires_at'));
      if (!expiresAt) return; // no expiry info (legacy session) -- rely on 401 retry
      const delay = Math.max(10_000, expiresAt - Date.now() - 120_000);
      timer = setTimeout(async () => {
        const newToken = await refreshStoredToken();
        if (cancelled) return;
        if (newToken) {
          spotifyApi?.setAccessToken(newToken);
          schedule();
        } else {
          console.warn('Proactive Spotify token refresh failed; session will expire at', new Date(expiresAt).toISOString());
        }
      }, delay);
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isAuthenticated, spotifyApi]);

  const login = () => {
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}&show_dialog=true`;
    window.location.href = authUrl;
  };

  const loadPlaylistTracks = async (playlistId: string): Promise<SpotifyTrack[]> => {
    if (!spotifyApi) return [];

    try {
      const allTracks: SpotifyTrack[] = [];
      let offset = 0;
      const limit = 100; // Spotify's max per request
      let hasMore = true;

      // Paginate through all tracks
      while (hasMore) {
        const tracksData = await spotifyApi.getPlaylistTracks(playlistId, { offset, limit });
        
        const tracks = tracksData.items
          .map(item => item.track)
          .filter(track => track && 'preview_url' in track && track.preview_url) as SpotifyTrack[];
        
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

      console.log(`[SpotifyContext] Loaded ${allTracks.length} tracks from playlist`);
      return allTracks;
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
