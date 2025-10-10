'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
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
    try {
      const userData = await api.getMe();
      setUser(userData);
      await loadUserPlaylists(api);
    } catch (error) {
      console.error('Error loading user data:', error);
      logout();
    }
  }, [logout, loadUserPlaylists]);

  useEffect(() => {
    // Check for existing access token
    const token = localStorage.getItem('spotify_access_token');
    if (token) {
      const api = new SpotifyWebApi();
      api.setAccessToken(token);
      setSpotifyApi(api);
      setIsAuthenticated(true);
      loadUserData(api);
    }
  }, [loadUserData]);

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
