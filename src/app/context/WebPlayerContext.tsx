'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, ReactNode } from 'react';

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

// Categorised player errors so the UI can show actionable guidance instead of
// an indefinite "Connecting to Spotify..." spinner. EME maps to "browser DRM
// disabled" (the Web Playback SDK requires Widevine to decode protected audio
// — common reasons: chrome://settings/content/protectedContent toggled off,
// hardened browser, missing Widevine package on Linux). Account maps to
// "Premium required". Auth maps to "stale token, please re-login".
export type PlayerErrorCode =
  | 'eme'
  | 'initialization'
  | 'authentication'
  | 'account'
  | 'connection';

export interface PlayerError {
  code: PlayerErrorCode;
  message: string;
}

interface WebPlayerContextType {
  player: SpotifyPlayer | null;
  playerState: WebPlayerState;
  isReady: boolean;
  deviceId: string | null;
  playerError: PlayerError | null;
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
  const [playerError, setPlayerError] = useState<PlayerError | null>(null);
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
  const isInitializingRef = useRef<boolean>(false);
  const stateCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const positionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastPositionUpdateRef = useRef<number>(Date.now());
  // Ref mirrors of isReady/deviceId. The SDK listeners and the polling
  // interval are closures created once inside initializePlayer; reading the
  // STATE values there reads the render they were created in (isReady was
  // still false when the `ready` listener registered, which left the old
  // polling permanently dead, and deviceId was still null). Refs always read
  // current.
  const isReadyRef = useRef(false);
  const deviceIdRef = useRef<string | null>(null);

  // Safety-net polling. player_state_changed events carry the real updates;
  // this only catches drift (e.g. a missed event after a network blip), so a
  // slow cadence is plenty and keeps SDK traffic low.
  const startStatePolling = useCallback(() => {
    if (stateCheckIntervalRef.current) {
      clearInterval(stateCheckIntervalRef.current);
    }

    stateCheckIntervalRef.current = setInterval(async () => {
      if (playerRef.current && isReadyRef.current) {
        try {
          const state = await playerRef.current.getCurrentState();
          if (state) {
            const stateObj = state as Record<string, unknown>;
            const currentTrack = (stateObj.track_window as Record<string, unknown>)?.current_track as Record<string, unknown> | undefined;

            // Update position timestamp when we get new position from API
            lastPositionUpdateRef.current = Date.now();

            setPlayerState(prev => ({
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
              volume: prev.volume, // Keep current volume
              device_id: deviceIdRef.current
            }));
          } else {
            // If no state, set as inactive
            setPlayerState(prev => ({
              ...prev,
              is_active: false,
              current_track: null,
              position: 0,
              duration: 0
            }));
          }
        } catch (error) {
          // Only log errors, not warnings for normal state checks
          console.error('Error getting current state:', error);
        }
      }
    }, 5000);
  }, []);

  const stopStatePolling = useCallback(() => {
    if (stateCheckIntervalRef.current) {
      clearInterval(stateCheckIntervalRef.current);
      stateCheckIntervalRef.current = null;
    }
  }, []);

  // Smooth position interpolation for better UI responsiveness
  const startPositionInterpolation = useCallback(() => {
    if (positionIntervalRef.current) {
      clearInterval(positionIntervalRef.current);
    }

    positionIntervalRef.current = setInterval(() => {
      setPlayerState(prev => {
        // Only interpolate if music is playing and active
        if (prev.is_paused || !prev.is_active || !prev.current_track) {
          return prev;
        }
        
        // Calculate time elapsed since last update
        const now = Date.now();
        const elapsed = now - lastPositionUpdateRef.current;
        
        // Increment position by elapsed time (in milliseconds)
        const newPosition = prev.position + elapsed;
        
        // Don't exceed track duration
        const maxPosition = prev.duration || prev.current_track.duration_ms || 0;
        const clampedPosition = Math.min(newPosition, maxPosition);
        
        lastPositionUpdateRef.current = now;
        
        return {
          ...prev,
          position: clampedPosition
        };
      });
    }, 100); // Update every 100ms for smooth progress
  }, []);

  const stopPositionInterpolation = useCallback(() => {
    if (positionIntervalRef.current) {
      clearInterval(positionIntervalRef.current);
      positionIntervalRef.current = null;
    }
  }, []);

  const checkAvailableDevices = useCallback((targetDeviceId?: string, verbose: boolean = false): Promise<boolean> => {
    const token = localStorage.getItem('spotify_access_token');
    if (!token) return Promise.resolve(false);

    // Use the provided device ID or fall back to the current device ID
    const checkDeviceId = targetDeviceId || deviceIdRef.current;
    if (!checkDeviceId) {
      if (verbose) console.log('No device ID available for verification');
      return Promise.resolve(false);
    }

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
      if (verbose) {
        console.log('Available devices:', data.devices);
        console.log('Looking for device ID:', checkDeviceId);
      }
      const ourDevice = data.devices.find((device: SpotifyDevice) => device.id === checkDeviceId);
      if (ourDevice) {
        if (verbose) {
          console.log('Our device found:', ourDevice);
          console.log('Device is active:', ourDevice.is_active);
        }
        return true;
      } else {
        if (verbose) {
          console.log('Our device not found in available devices list');
          console.log('Available device IDs:', data.devices.map((d: SpotifyDevice) => d.id));
        }
        return false;
      }
    }).catch(error => {
      console.error('Error checking available devices:', error);
      return false;
    });
  }, []);

  const initializePlayer = useCallback((token: string) => {
    if (typeof window === 'undefined' || !window.Spotify) {
      console.error('Spotify Web Playback SDK not loaded');
      return;
    }

    // Prevent multiple initializations - check if already initializing or ready
    if (isInitializingRef.current || isReadyRef.current || playerRef.current) {
      console.log('Web Player already initialized or initializing, skipping...');
      return;
    }

    // Set initialization flag
    isInitializingRef.current = true;
    setPlayerError(null);
    console.log('Starting Web Player initialization...');

    // Disconnect existing player if any (cleanup)
    if (playerRef.current) {
      console.log('Disconnecting existing player before reinitializing...');
      try {
        (playerRef.current as SpotifyPlayer).disconnect();
      } catch (error) {
        console.warn('Error disconnecting existing player:', error);
      }
      playerRef.current = null;
    }

    const newPlayer = new window.Spotify.Player({
      name: 'Heart Music Player',
      getOAuthToken: (cb: (token: string) => void) => {
        // Read at call time: the SDK invokes this whenever it needs a token,
        // so tokens refreshed by SpotifyContext are picked up automatically
        // instead of the SDK holding the (eventually expired) initial one.
        cb(localStorage.getItem('spotify_access_token') || token);
      },
      volume: 0.5
    });

    // Error handling. Spotify's SDK reports errors via these listeners; we
    // categorise the message so the UI can render actionable guidance instead
    // of a perpetual "Connecting to Spotify..." spinner. Initialization
    // failures most commonly originate from EME (Widevine missing/disabled);
    // sniff the message string to detect that case specifically.
    newPlayer.addListener('initialization_error', (...args) => {
      const error = args[0] as { message: string };
      const message = error?.message ?? 'Unknown initialization error';
      console.error('Failed to initialize Spotify player:', message);
      const looksLikeEme = /eme|keysystem|widevine|encrypted|drm/i.test(message);
      setPlayerError({
        code: looksLikeEme ? 'eme' : 'initialization',
        message,
      });
      isInitializingRef.current = false;
    });

    newPlayer.addListener('authentication_error', (...args) => {
      const error = args[0] as { message: string };
      console.error('Failed to authenticate with Spotify:', error.message);
      setPlayerError({
        code: 'authentication',
        message: error?.message ?? 'Authentication failed',
      });
      isInitializingRef.current = false;
    });

    newPlayer.addListener('account_error', (...args) => {
      const error = args[0] as { message: string };
      console.error('Failed to validate Spotify account:', error.message);
      setPlayerError({
        code: 'account',
        message: error?.message ?? 'Account error',
      });
      isInitializingRef.current = false;
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

      // Fresh position from the SDK: re-anchor the interpolation clock.
      lastPositionUpdateRef.current = Date.now();

      setPlayerState(prev => ({
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
        volume: prev.volume, // Keep current volume since Spotify doesn't provide it in state
        device_id: deviceIdRef.current
      }));
    });

    // Ready - SDK guarantees the device is registered when this fires.
    // Trust the event and skip the previous 10x1s pre-flight polling that
    // produced a long window where the player looked online but isReady was
    // still false (causing playlist clicks to silently fall through to local
    // audio mode). The per-action checkAvailableDevices guards still catch
    // any rare propagation delay.
    newPlayer.addListener('ready', (...args) => {
      const data = args[0] as { device_id: string };
      console.log('Spotify Web Player is ready with Device ID:', data.device_id);
      deviceIdRef.current = data.device_id;
      isReadyRef.current = true;
      setDeviceId(data.device_id);
      setPlayerState(prev => ({
        ...prev,
        device_id: data.device_id
      }));
      setIsReady(true);
      setPlayerError(null);
      startStatePolling();
      startPositionInterpolation();
      isInitializingRef.current = false;
    });

    // Not Ready
    newPlayer.addListener('not_ready', (...args) => {
      const data = args[0] as { device_id: string };
      console.log('Spotify Web Player device has gone offline:', data.device_id);
      isReadyRef.current = false;
      setIsReady(false);
      stopStatePolling();
      stopPositionInterpolation();
    });

    // Connect to the player
    newPlayer.connect().then((success) => {
      if (success) {
        console.log('Successfully connected to Spotify Web Player');
        setPlayer(newPlayer);
        playerRef.current = newPlayer;
      } else {
        console.error('Failed to connect to Spotify Web Player');
        setPlayerError({
          code: 'connection',
          message: 'Could not connect to Spotify Web Player',
        });
        isInitializingRef.current = false;
      }
    }).catch((error) => {
      console.error('Error connecting to Spotify Web Player:', error);
      setPlayerError({
        code: 'connection',
        message: error instanceof Error ? error.message : 'Connection error',
      });
      isInitializingRef.current = false;
    });
  }, [startStatePolling, startPositionInterpolation, stopStatePolling, stopPositionInterpolation]);

  // Starting playback of a track/context is the ONE thing the SDK has no
  // local method for -- it requires the Web API. Everything else (toggle,
  // seek, volume, next/previous) uses the SDK's local methods below: they
  // act on this device directly with no network round trip, no token read,
  // and no device checks, so the controls respond instantly.
  const playTrack = useCallback((trackUri: string) => {
    const targetDeviceId = deviceIdRef.current;
    if (!playerRef.current || !targetDeviceId) {
      console.error('Player not ready or device ID not available');
      return;
    }

    fetch(`https://api.spotify.com/v1/me/player/play?device_id=${targetDeviceId}`, {
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
  }, []);

  const playPlaylist = useCallback(async (playlistUri: string) => {
    const targetDeviceId = deviceIdRef.current;
    if (!playerRef.current || !targetDeviceId) {
      console.error('Player not ready or device ID not available');
      return;
    }

    const token = localStorage.getItem('spotify_access_token');
    if (!token) {
      console.error('No access token found');
      return;
    }

    // Verify device is still registered before starting a new playback
    // context (this is the one action where a stale registration commonly
    // bites, e.g. after the SDK device dropped while the tab slept).
    const isDeviceRegistered = await checkAvailableDevices(targetDeviceId, false);
    if (!isDeviceRegistered) {
      console.error('Device not registered with Spotify, cannot start playback');
      return;
    }

    try {
      const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${targetDeviceId}`, {
        method: 'PUT',
        body: JSON.stringify({
          context_uri: playlistUri
        }),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Spotify API Error Response:', errorText);
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }
      console.log('Playlist playback started successfully');
    } catch (error) {
      console.error('Error starting playlist playback:', error);
    }
  }, [checkAvailableDevices]);

  const togglePlay = useCallback(async () => {
    if (!playerRef.current) {
      console.error('Player not available');
      return;
    }
    try {
      await playerRef.current.togglePlay();
    } catch (error) {
      console.error('Error toggling playback:', error);
    }
  }, []);

  const nextTrack = useCallback(async () => {
    if (!playerRef.current) {
      console.error('Player not available');
      return;
    }
    try {
      await playerRef.current.nextTrack();
    } catch (error) {
      console.error('Error skipping to next track:', error);
    }
  }, []);

  const previousTrack = useCallback(async () => {
    if (!playerRef.current) {
      console.error('Player not available');
      return;
    }
    try {
      await playerRef.current.previousTrack();
    } catch (error) {
      console.error('Error skipping to previous track:', error);
    }
  }, []);

  const setVolume = useCallback(async (volume: number) => {
    if (!playerRef.current) {
      console.error('Player not available');
      return;
    }

    // Update local state immediately for responsive UI
    setPlayerState(prev => ({
      ...prev,
      volume: volume
    }));

    try {
      await playerRef.current.setVolume(volume);
    } catch (error) {
      console.error('Error setting volume:', error);
    }
  }, []);

  const seek = useCallback(async (position: number) => {
    if (!playerRef.current) {
      console.error('Player not available');
      return;
    }
    try {
      await playerRef.current.seek(Math.round(position));
      // Re-anchor interpolation so the progress bar doesn't jump while the
      // next state event is in flight.
      lastPositionUpdateRef.current = Date.now();
      setPlayerState(prev => ({ ...prev, position: Math.round(position) }));
    } catch (error) {
      console.error('Error seeking:', error);
    }
  }, []);


  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStatePolling();
      stopPositionInterpolation();
      if (playerRef.current) {
        console.log('Cleaning up Web Player...');
        try {
          (playerRef.current as SpotifyPlayer).disconnect();
        } catch (error) {
          console.warn('Error disconnecting player during cleanup:', error);
        }
        playerRef.current = null;
      }
      setPlayer(null);
      setIsReady(false);
      setDeviceId(null);
      isReadyRef.current = false;
      deviceIdRef.current = null;
      isInitializingRef.current = false;
      setPlayerState({
        is_paused: true,
        is_active: false,
        current_track: null,
        position: 0,
        duration: 0,
        volume: 0.5,
        device_id: null
      });
    };
  }, [stopStatePolling, stopPositionInterpolation]);

  // Memoized so consumers' effects keyed on these functions don't re-run on
  // every provider render.
  const value: WebPlayerContextType = useMemo(() => ({
    player,
    playerState,
    isReady,
    deviceId,
    playerError,
    initializePlayer,
    playTrack,
    playPlaylist,
    togglePlay,
    nextTrack,
    previousTrack,
    setVolume,
    seek
  }), [player, playerState, isReady, deviceId, playerError, initializePlayer, playTrack, playPlaylist, togglePlay, nextTrack, previousTrack, setVolume, seek]);

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
