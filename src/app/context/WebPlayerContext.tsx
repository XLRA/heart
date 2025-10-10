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

interface SpotifyDevice {
  id: string;
  is_active: boolean;
  is_private_session: boolean;
  is_restricted: boolean;
  name: string;
  type: string;
  volume_percent: number;
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

  const checkAvailableDevices = (): Promise<boolean> => {
    const token = localStorage.getItem('spotify_access_token');
    if (!token) return Promise.resolve(false);

    return fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }).then(response => {
      if (!response.ok) {
        throw new Error(`Failed to get devices: ${response.status}`);
      }
      return response.json();
    }).then(data => {
      console.log('Available devices:', data.devices);
      const ourDevice = data.devices.find((device: SpotifyDevice) => device.id === deviceId);
      if (ourDevice) {
        console.log('Our device found:', ourDevice);
        console.log('Device is active:', ourDevice.is_active);
        return true;
      } else {
        console.log('Our device not found in available devices list');
        return false;
      }
    }).catch(error => {
      console.error('Error checking available devices:', error);
      return false;
    });
  };

  const waitForDeviceRegistration = async (maxAttempts: number = 10, delay: number = 1000): Promise<boolean> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`Checking device registration (attempt ${attempt}/${maxAttempts})`);
      const isRegistered = await checkAvailableDevices();
      if (isRegistered) {
        console.log('Device successfully registered with Spotify');
        return true;
      }
      
      if (attempt < maxAttempts) {
        console.log(`Device not yet registered, waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    console.error('Device failed to register with Spotify after maximum attempts');
    return false;
  };

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
    newPlayer.addListener('ready', async (...args) => {
      const data = args[0] as { device_id: string };
      console.log('Spotify Web Player is ready with Device ID:', data.device_id);
      setDeviceId(data.device_id);
      setPlayerState(prev => ({
        ...prev,
        device_id: data.device_id
      }));
      
      // Wait for device to be registered with Spotify servers
      const isRegistered = await waitForDeviceRegistration();
      if (isRegistered) {
        setIsReady(true);
        console.log('Web Player is fully ready and registered');
      } else {
        console.error('Web Player failed to register with Spotify servers');
        setIsReady(false);
      }
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
        
        // Wait a bit for the device to be fully registered
        setTimeout(() => {
          console.log('Device should be registered now, device ID:', deviceId);
        }, 2000);
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

    // Use the Web API to start playback directly
    fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
      method: 'PUT',
      body: JSON.stringify({
        uris: [trackUri]
      }),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('spotify_access_token')}`
      }
    }).then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      console.log('Track playback started successfully');
    }).catch(error => {
      console.error('Error starting track playback:', error);
    });
  };

  const playPlaylist = async (playlistUri: string) => {
    if (!player || !deviceId) {
      console.error('Player not ready or device ID not available');
      return;
    }

    const token = localStorage.getItem('spotify_access_token');
    if (!token) {
      console.error('No access token found');
      return;
    }

    console.log('Starting playlist playback with device ID:', deviceId);
    console.log('Playlist URI:', playlistUri);
    console.log('Token (first 20 chars):', token.substring(0, 20) + '...');

    // Verify device is still registered before attempting playback
    const isDeviceRegistered = await checkAvailableDevices();
    if (!isDeviceRegistered) {
      console.error('Device not registered with Spotify, cannot start playback');
      return;
    }

    // Use the Web API to start playlist playback
    try {
      const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        body: JSON.stringify({
          context_uri: playlistUri
        }),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Spotify API Error Response:', errorText);
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }
      console.log('Playlist playback started successfully');
    } catch (error) {
      console.error('Error starting playlist playback:', error);
    }
  };

  const togglePlay = async () => {
    if (!player || !deviceId) {
      console.error('Player not available or device ID not available');
      return;
    }

    // Verify device is still registered before attempting playback
    const isDeviceRegistered = await checkAvailableDevices();
    if (!isDeviceRegistered) {
      console.error('Device not registered with Spotify, cannot toggle playback');
      return;
    }

    // Use the Web API to toggle playback
    const action = playerState.is_paused ? 'play' : 'pause';
    console.log(`Toggling playback: ${action} with device ID:`, deviceId);
    
    try {
      const response = await fetch(`https://api.spotify.com/v1/me/player/${action}?device_id=${deviceId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('spotify_access_token')}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }
      console.log(`Playback ${action} successful`);
    } catch (error) {
      console.error(`Error ${action}ing playback:`, error);
    }
  };

  const nextTrack = async () => {
    if (!player || !deviceId) {
      console.error('Player not available or device ID not available');
      return;
    }

    // Verify device is still registered before attempting playback
    const isDeviceRegistered = await checkAvailableDevices();
    if (!isDeviceRegistered) {
      console.error('Device not registered with Spotify, cannot skip to next track');
      return;
    }

    try {
      const response = await fetch(`https://api.spotify.com/v1/me/player/next?device_id=${deviceId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('spotify_access_token')}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }
      console.log('Next track successful');
    } catch (error) {
      console.error('Error skipping to next track:', error);
    }
  };

  const previousTrack = async () => {
    if (!player || !deviceId) {
      console.error('Player not available or device ID not available');
      return;
    }

    // Verify device is still registered before attempting playback
    const isDeviceRegistered = await checkAvailableDevices();
    if (!isDeviceRegistered) {
      console.error('Device not registered with Spotify, cannot skip to previous track');
      return;
    }

    try {
      const response = await fetch(`https://api.spotify.com/v1/me/player/previous?device_id=${deviceId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('spotify_access_token')}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }
      console.log('Previous track successful');
    } catch (error) {
      console.error('Error skipping to previous track:', error);
    }
  };

  const setVolume = async (volume: number) => {
    if (!player || !deviceId) {
      console.error('Player not available or device ID not available');
      return;
    }

    // Verify device is still registered before attempting playback
    const isDeviceRegistered = await checkAvailableDevices();
    if (!isDeviceRegistered) {
      console.error('Device not registered with Spotify, cannot set volume');
      return;
    }

    try {
      const response = await fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${Math.round(volume * 100)}&device_id=${deviceId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('spotify_access_token')}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }
      console.log('Volume set successfully');
    } catch (error) {
      console.error('Error setting volume:', error);
    }
  };

  const seek = async (position: number) => {
    if (!player || !deviceId) {
      console.error('Player not available or device ID not available');
      return;
    }

    // Verify device is still registered before attempting playback
    const isDeviceRegistered = await checkAvailableDevices();
    if (!isDeviceRegistered) {
      console.error('Device not registered with Spotify, cannot seek');
      return;
    }

    try {
      const response = await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${Math.round(position)}&device_id=${deviceId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('spotify_access_token')}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }
      console.log('Seek successful');
    } catch (error) {
      console.error('Error seeking:', error);
    }
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
