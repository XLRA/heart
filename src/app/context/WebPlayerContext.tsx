'use client';

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';

interface WebPlayerTrack {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album: {
    name: string;
    images: Array<{ url: string }>;
  };
  duration_ms: number;
  uri: string;
}

interface WebPlayerState {
  is_paused: boolean;
  is_active: boolean;
  current_track: WebPlayerTrack | null;
  position: number;
  duration: number;
  volume: number;
  device_id: string | null;
}

interface SpotifyPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, callback: (...args: unknown[]) => void): void;
  removeListener(event: string, callback?: (...args: unknown[]) => void): void;
  getCurrentState(): Promise<unknown | null>;
  setName(name: string): Promise<void>;
  getVolume(): Promise<number>;
  setVolume(volume: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  togglePlay(): Promise<void>;
  seek(position_ms: number): Promise<void>;
  previousTrack(): Promise<void>;
  nextTrack(): Promise<void>;
}

interface WebPlayerContextType {
  player: SpotifyPlayer | null;
  playerState: WebPlayerState;
  isReady: boolean;
  deviceId: string | null;
  initializePlayer: (token: string) => void;
  playTrack: (trackUri: string) => void;
  playPlaylist: (playlistUri: string) => void;
  togglePlay: () => void;
  nextTrack: () => void;
  previousTrack: () => void;
  setVolume: (volume: number) => void;
  seek: (position: number) => void;
}

const WebPlayerContext = createContext<WebPlayerContextType | undefined>(undefined);

export const WebPlayerProvider = ({ children }: { children: ReactNode }) => {
  const [player, setPlayer] = useState<SpotifyPlayer | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [playerState, setPlayerState] = useState<WebPlayerState>({
    is_paused: true,
    is_active: false,
    current_track: null,
    position: 0,
    duration: 0,
    volume: 0.5,
    device_id: null
  });

  const playerRef = useRef<SpotifyPlayer | null>(null);

  const initializePlayer = (token: string) => {
    if (typeof window === 'undefined' || !window.Spotify) {
      console.error('Spotify Web Playback SDK not loaded');
      return;
    }

    // Disconnect existing player if any
    if (playerRef.current) {
      playerRef.current.disconnect();
    }

    // Prevent multiple initializations
    if (isReady) {
      console.log('Web Player already initialized, skipping...');
      return;
    }

    const newPlayer = new window.Spotify.Player({
      name: 'Heart Music Player',
      getOAuthToken: (cb: (token: string) => void) => {
        cb(token);
      },
      volume: 0.5
    });

    // Error handling
    newPlayer.addListener('initialization_error', (...args) => {
      const error = args[0] as { message: string };
      console.error('Failed to initialize Spotify player:', error.message);
    });

    newPlayer.addListener('authentication_error', (...args) => {
      const error = args[0] as { message: string };
      console.error('Failed to authenticate with Spotify:', error.message);
    });

    newPlayer.addListener('account_error', (...args) => {
      const error = args[0] as { message: string };
      console.error('Failed to validate Spotify account:', error.message);
    });

    newPlayer.addListener('playback_error', (...args) => {
      const error = args[0] as { message: string };
      console.error('Failed to perform playback:', error.message);
    });

    // Playback status updates
    newPlayer.addListener('player_state_changed', (state: unknown) => {
      if (!state || typeof state !== 'object') {
        setPlayerState(prev => ({
          ...prev,
          is_active: false,
          current_track: null
        }));
        return;
      }

      const stateObj = state as Record<string, unknown>;
      const currentTrack = (stateObj.track_window as Record<string, unknown>)?.current_track as Record<string, unknown> | undefined;
      
      setPlayerState({
        is_paused: Boolean(stateObj.paused),
        is_active: true,
        current_track: currentTrack ? {
          id: String(currentTrack.id),
          name: String(currentTrack.name),
          artists: (currentTrack.artists as Array<{ name: string }>) || [],
          album: (currentTrack.album as { name: string; images: Array<{ url: string }> }) || { name: '', images: [] },
          duration_ms: Number(currentTrack.duration_ms) || 0,
          uri: String(currentTrack.uri)
        } : null,
        position: Number(stateObj.position) || 0,
        duration: Number(currentTrack?.duration_ms) || 0,
        volume: Number(stateObj.volume) || 0.5,
        device_id: deviceId
      });
    });

    // Ready
    newPlayer.addListener('ready', (...args) => {
      const data = args[0] as { device_id: string };
      console.log('Spotify Web Player is ready with Device ID:', data.device_id);
      setDeviceId(data.device_id);
      setIsReady(true);
      setPlayerState(prev => ({
        ...prev,
        device_id: data.device_id
      }));
    });

    // Not Ready
    newPlayer.addListener('not_ready', (...args) => {
      const data = args[0] as { device_id: string };
      console.log('Spotify Web Player device has gone offline:', data.device_id);
      setIsReady(false);
    });

    // Connect to the player
    newPlayer.connect().then((success) => {
      if (success) {
        console.log('Successfully connected to Spotify Web Player');
        setPlayer(newPlayer);
        playerRef.current = newPlayer;
      } else {
        console.error('Failed to connect to Spotify Web Player');
      }
    });
  };

  const playTrack = (trackUri: string) => {
    if (!player || !deviceId) {
      console.error('Player not ready or device ID not available');
      return;
    }

    player.getCurrentState().then((state: unknown) => {
      if (!state) {
        console.error('User is not playing music through the Web Playback SDK');
        return;
      }

      // Use the Web API to start playback
      fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        body: JSON.stringify({
          uris: [trackUri]
        }),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('spotify_access_token')}`
        }
      }).catch(error => {
        console.error('Error starting playback:', error);
      });
    });
  };

  const playPlaylist = (playlistUri: string) => {
    if (!player || !deviceId) {
      console.error('Player not ready or device ID not available');
      return;
    }

    player.getCurrentState().then((state: unknown) => {
      if (!state) {
        console.error('User is not playing music through the Web Playback SDK');
        return;
      }

      // Use the Web API to start playlist playback
      fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        body: JSON.stringify({
          context_uri: playlistUri
        }),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('spotify_access_token')}`
        }
      }).catch(error => {
        console.error('Error starting playlist playback:', error);
      });
    });
  };

  const togglePlay = () => {
    if (!player) {
      console.error('Player not available');
      return;
    }
    player.togglePlay();
  };

  const nextTrack = () => {
    if (!player) {
      console.error('Player not available');
      return;
    }
    player.nextTrack();
  };

  const previousTrack = () => {
    if (!player) {
      console.error('Player not available');
      return;
    }
    player.previousTrack();
  };

  const setVolume = (volume: number) => {
    if (!player) {
      console.error('Player not available');
      return;
    }
    player.setVolume(volume);
  };

  const seek = (position: number) => {
    if (!player) {
      console.error('Player not available');
      return;
    }
    player.seek(position);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        playerRef.current.disconnect();
      }
    };
  }, []);

  const value: WebPlayerContextType = {
    player,
    playerState,
    isReady,
    deviceId,
    initializePlayer,
    playTrack,
    playPlaylist,
    togglePlay,
    nextTrack,
    previousTrack,
    setVolume,
    seek
  };

  return (
    <WebPlayerContext.Provider value={value}>
      {children}
    </WebPlayerContext.Provider>
  );
};

export const useWebPlayer = () => {
  const context = useContext(WebPlayerContext);
  if (context === undefined) {
    throw new Error('useWebPlayer must be used within a WebPlayerProvider');
  }
  return context;
};
