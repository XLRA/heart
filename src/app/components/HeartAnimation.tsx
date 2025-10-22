'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface AudioVisualizerProps {
  audioElement?: HTMLAudioElement | null;
  isPlaying?: boolean;
  isSpotifyMode?: boolean;
  spotifyTrackData?: {
    tempo?: number;
    energy?: number;
    danceability?: number;
    valence?: number;
  } | null;
  meydaData?: {
    rms: number;
    spectralCentroid: number;
    spectralRolloff: number;
    spectralFlux: number;
    spectralSpread: number;
    spectralKurtosis: number;
    loudness: number;
    mfcc: number[];
    chroma: number[];
  } | null;
  currentTrackId?: string | null;
  currentPosition?: number;
}

interface SpotifyAudioAnalysis {
  track: {
    tempo: number;
    loudness: number;
    duration: number;
  };
  beats: Array<{
    start: number;
    duration: number;
    confidence: number;
  }>;
  segments: Array<{
    start: number;
    duration: number;
    loudness_start: number;
    loudness_max: number;
    loudness_max_time: number;
    loudness_end: number;
    pitches: number[];
    timbre: number[];
  }>;
  sections: Array<{
    start: number;
    duration: number;
    loudness: number;
    tempo: number;
    key: number;
    mode: number;
  }>;
}

const HeartAnimation = ({ 
  audioElement, 
  isPlaying = false, 
  isSpotifyMode = false, 
  spotifyTrackData = null,
  meydaData = null,
  currentTrackId = null,
  currentPosition = 0
}: AudioVisualizerProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [audioData, setAudioData] = useState<{
    bass: number;
    mid: number;
    treble: number;
    overall: number;
    beat: boolean;
  }>({
    bass: 0,
    mid: 0,
    treble: 0,
    overall: 0,
    beat: false
  });

  const [spotifyAnalysis, setSpotifyAnalysis] = useState<SpotifyAudioAnalysis | null>(null);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  
  // Use refs to access current values in animation loop
  const audioDataRef = useRef(audioData);
  const isPlayingRef = useRef(isPlaying);
  
  // Update refs when values change
  useEffect(() => {
    audioDataRef.current = audioData;
  }, [audioData]);
  
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Convert Meyda real-time data to audioData format for heart animation
  useEffect(() => {
    if (!meydaData || !isPlaying) return;

    const convertMeydaToAudioData = () => {
      // Convert Meyda features to audioData format
      const bass = Math.max(0, Math.min(1, meydaData.rms * 2)); // RMS for bass
      const mid = Math.max(0, Math.min(1, meydaData.spectralCentroid)); // Spectral centroid for mid
      const treble = Math.max(0, Math.min(1, meydaData.spectralRolloff / 20000)); // Spectral rolloff for treble
      const overall = Math.max(0, Math.min(1, meydaData.loudness / 100)); // Loudness for overall
      
      // Beat detection from spectral flux (if available) or RMS changes
      const beat = meydaData.spectralFlux > 0.1 || meydaData.rms > 0.3;

      console.log('Converting Meyda to audioData:', { bass, mid, treble, overall, beat, meydaData });

      setAudioData({
        bass,
        mid,
        treble,
        overall,
        beat
      });
    };

    // Update immediately
    convertMeydaToAudioData();

    // Set up interval for continuous updates
    const interval = setInterval(convertMeydaToAudioData, 50); // Update every 50ms
    
    return () => clearInterval(interval);
  }, [meydaData, isPlaying]);

  // Fetch Spotify audio analysis data with fallback
  const fetchSpotifyAudioAnalysis = useCallback(async (trackId: string) => {
    if (!trackId) return;
    
    setIsLoadingAnalysis(true);
    try {
      const token = localStorage.getItem('spotify_access_token');
      if (!token) {
        console.error('No Spotify access token found');
        return;
      }

      const response = await fetch(`https://api.spotify.com/v1/audio-analysis/${trackId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const analysis = await response.json();
        setSpotifyAnalysis(analysis);
        console.log('Spotify audio analysis loaded:', analysis);
      } else if (response.status === 403) {
        console.warn('Audio analysis endpoint deprecated by Spotify (403 Forbidden) - using enhanced simulation');
        // Don't set analysis, will fall back to enhanced simulation
        setSpotifyAnalysis(null);
      } else {
        console.error('Failed to fetch audio analysis:', response.status);
        setSpotifyAnalysis(null);
      }
    } catch (error) {
      console.error('Error fetching Spotify audio analysis:', error);
      setSpotifyAnalysis(null);
    } finally {
      setIsLoadingAnalysis(false);
    }
  }, []);

  // Fetch audio analysis when track changes
  useEffect(() => {
    if (isSpotifyMode && currentTrackId) {
      // Check if we need to fetch analysis for a new track
      const lastTrackId = localStorage.getItem('lastAnalyzedTrackId');
      if (currentTrackId !== lastTrackId) {
        fetchSpotifyAudioAnalysis(currentTrackId);
        localStorage.setItem('lastAnalyzedTrackId', currentTrackId);
      }
    }
  }, [isSpotifyMode, currentTrackId, fetchSpotifyAudioAnalysis]);

  // Initialize Web Audio API (only for local audio files)
  useEffect(() => {
    if (!audioElement || !canvasRef.current || isSpotifyMode) return;

    const initAudioContext = async () => {
      try {
        // Create audio context
        audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        
        // Resume context if suspended (required for user interaction)
        if (audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
        }
        
        // Create analyser node
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 256;
        analyserRef.current.smoothingTimeConstant = 0.8;
        
        // Create source from audio element
        sourceRef.current = audioContextRef.current.createMediaElementSource(audioElement);
        
        // Connect the audio graph
        sourceRef.current.connect(analyserRef.current);
        analyserRef.current.connect(audioContextRef.current.destination);
        
        console.log('Audio visualizer initialized');
      } catch (error) {
        console.error('Error initializing audio context:', error);
        // Reset refs on error
        audioContextRef.current = null;
        analyserRef.current = null;
        sourceRef.current = null;
      }
    };

    initAudioContext();

    return () => {
      if (sourceRef.current) {
        sourceRef.current.disconnect();
      }
      if (analyserRef.current) {
        analyserRef.current.disconnect();
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, [audioElement, isSpotifyMode]);

  // Handle user interaction to resume audio context
  useEffect(() => {
    const handleUserInteraction = async () => {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        try {
          await audioContextRef.current.resume();
          console.log('Audio context resumed after user interaction');
        } catch (error) {
          console.error('Error resuming audio context:', error);
        }
      }
    };

    // Add event listeners for user interaction
    document.addEventListener('click', handleUserInteraction);
    document.addEventListener('keydown', handleUserInteraction);
    document.addEventListener('touchstart', handleUserInteraction);

    return () => {
      document.removeEventListener('click', handleUserInteraction);
      document.removeEventListener('keydown', handleUserInteraction);
      document.removeEventListener('touchstart', handleUserInteraction);
    };
  }, []);

  // Audio analysis loop (only for local audio files)
  useEffect(() => {
    if (!analyserRef.current || !isPlaying || isSpotifyMode) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let lastBeatTime = 0;
    let beatThreshold = 0.3;
    const beatHistory: number[] = [];

    const analyzeAudio = () => {
      if (!analyserRef.current) return;

      analyserRef.current.getByteFrequencyData(dataArray);
      
      // Calculate frequency bands
      const bassEnd = Math.floor(bufferLength * 0.1);
      const midEnd = Math.floor(bufferLength * 0.4);
      
      let bassSum = 0;
      let midSum = 0;
      let trebleSum = 0;
      let overallSum = 0;
      
      for (let i = 0; i < bufferLength; i++) {
        const value = dataArray[i] / 255;
        overallSum += value;
        
        if (i < bassEnd) {
          bassSum += value;
        } else if (i < midEnd) {
          midSum += value;
        } else {
          trebleSum += value;
        }
      }
      
      const bass = bassSum / bassEnd;
      const mid = midSum / (midEnd - bassEnd);
      const treble = trebleSum / (bufferLength - midEnd);
      const overall = overallSum / bufferLength;
      
      // Beat detection
      const currentTime = Date.now();
      const timeSinceLastBeat = currentTime - lastBeatTime;
      
      // Dynamic threshold based on recent history
      if (beatHistory.length > 10) {
        beatHistory.shift();
      }
      beatHistory.push(overall);
      
      const avgLevel = beatHistory.reduce((a, b) => a + b, 0) / beatHistory.length;
      beatThreshold = avgLevel * 1.5;
      
      // Detect beat
      const isBeat = overall > beatThreshold && timeSinceLastBeat > 200;
      
      if (isBeat) {
        lastBeatTime = currentTime;
      }
      
      setAudioData({
        bass,
        mid,
        treble,
        overall,
        beat: isBeat
      });
      
      animationFrameRef.current = requestAnimationFrame(analyzeAudio);
    };

    analyzeAudio();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, isSpotifyMode]);

  // Spotify mode: Enhanced simulation when audio analysis is not available
  useEffect(() => {
    if (!isSpotifyMode || !isPlaying || !currentPosition) return;
    
    // If we have Meyda real-time data, don't override it with simulation
    if (meydaData) return;
    
    // If we have audio analysis, use it; otherwise use enhanced simulation
    if (!spotifyAnalysis) {
      // Enhanced simulation based on track features and time
      const simulateEnhancedAudioData = () => {
        const currentTimeSeconds = currentPosition / 1000;
        
        // Use Spotify track data for simulation (Meyda data is handled separately)
        let baseIntensity = 0.6;
        let energyMultiplier = 1;
        let danceabilityMultiplier = 1;
        let valenceMultiplier = 1;
        
        if (spotifyTrackData) {
          // Use Spotify track data for simulation
          baseIntensity = spotifyTrackData.energy || 0.6;
          energyMultiplier = spotifyTrackData.energy || 1;
          danceabilityMultiplier = spotifyTrackData.danceability || 1;
          valenceMultiplier = spotifyTrackData.valence || 1;
        }
        
        // Create more realistic simulation patterns based on audio features
        const timeBasedIntensity = Math.sin(currentTimeSeconds * 0.3) * 0.4 + baseIntensity;
        const beatPattern = Math.sin(currentTimeSeconds * 1.5) > 0.7 ? 1 : 0;
        
        // Add some randomness for more natural feel
        const randomVariation = (Math.random() - 0.5) * 0.1;
        
        // Simulate frequency bands with more realistic distribution based on audio features
        const bass = Math.max(0, Math.min(1, timeBasedIntensity * 0.7 * energyMultiplier + randomVariation + 0.1));
        const mid = Math.max(0, Math.min(1, timeBasedIntensity * 0.5 * danceabilityMultiplier + randomVariation + 0.2));
        const treble = Math.max(0, Math.min(1, timeBasedIntensity * 0.3 * valenceMultiplier + randomVariation + 0.1));
        const overall = (bass + mid + treble) / 3;
        
        setAudioData({
          bass,
          mid,
          treble,
          overall,
          beat: Boolean(beatPattern)
        });
      };

      const interval = setInterval(simulateEnhancedAudioData, 50);
      return () => clearInterval(interval);
    }
  }, [isSpotifyMode, isPlaying, currentPosition, spotifyAnalysis, meydaData, spotifyTrackData]);

  // Spotify mode: Real audio-reactive behavior based on audio analysis
  useEffect(() => {
    if (!isSpotifyMode || !isPlaying || !spotifyAnalysis || !currentPosition) return;

    const updateAudioDataFromAnalysis = () => {
      const currentTimeSeconds = currentPosition / 1000; // Convert ms to seconds
      
      // Find current segment
      const currentSegment = spotifyAnalysis.segments.find(segment => 
        currentTimeSeconds >= segment.start && 
        currentTimeSeconds < segment.start + segment.duration
      );
      
      // Find current beat
      const currentBeat = spotifyAnalysis.beats.find(beat => 
        currentTimeSeconds >= beat.start && 
        currentTimeSeconds < beat.start + beat.duration
      );
      
      // Find current section
      const currentSection = spotifyAnalysis.sections.find(section => 
        currentTimeSeconds >= section.start && 
        currentTimeSeconds < section.start + section.duration
      );

      if (currentSegment) {
        // Use real segment data for frequency analysis
        const pitches = currentSegment.pitches || [];
        
        // Map pitches to frequency bands (12 pitch classes)
        const bass = pitches.slice(0, 3).reduce((sum, val) => sum + val, 0) / 3;
        const mid = pitches.slice(3, 8).reduce((sum, val) => sum + val, 0) / 5;
        const treble = pitches.slice(8, 12).reduce((sum, val) => sum + val, 0) / 4;
        
        // Use loudness data for overall intensity
        const loudnessNormalized = Math.max(0, Math.min(1, 
          (currentSegment.loudness_max + 60) / 60 // Normalize from -60dB to 0dB
        ));
        
        // Enhanced beat detection based on actual beat timing
        const isBeat = currentBeat && 
          (currentTimeSeconds - currentBeat.start) < 0.15; // Within 150ms of beat start for more responsive detection
        
        setAudioData({
          bass: Math.max(0, Math.min(1, bass)),
          mid: Math.max(0, Math.min(1, mid)),
          treble: Math.max(0, Math.min(1, treble)),
          overall: loudnessNormalized,
          beat: Boolean(isBeat)
        });
      } else if (currentSection) {
        // Fallback to section data with more dramatic values
        const loudnessNormalized = Math.max(0, Math.min(1, 
          (currentSection.loudness + 60) / 60
        ));
        
        // Create more dynamic frequency distribution
        const bass = loudnessNormalized * 0.9 + Math.random() * 0.1;
        const mid = loudnessNormalized * 0.7 + Math.random() * 0.1;
        const treble = loudnessNormalized * 0.5 + Math.random() * 0.1;
        
        setAudioData({
          bass: Math.max(0, Math.min(1, bass)),
          mid: Math.max(0, Math.min(1, mid)),
          treble: Math.max(0, Math.min(1, treble)),
          overall: loudnessNormalized,
          beat: false
        });
      }
    };

    const interval = setInterval(updateAudioDataFromAnalysis, 50); // Update every 50ms
    
    return () => clearInterval(interval);
  }, [isSpotifyMode, isPlaying, spotifyAnalysis, currentPosition]);

  // Initialize canvas and particles once, then animate continuously
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get device pixel ratio for retina displays
    const dpr = window.devicePixelRatio || 1;

    // Set canvas size accounting for device pixel ratio
    let width = canvas.width = window.innerWidth * dpr;
    let height = canvas.height = window.innerHeight * dpr;
    
    // Scale canvas style size
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    
    // Scale context to account for device pixel ratio
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    const heartPosition = (rad: number): [number, number] => {
      return [
        Math.pow(Math.sin(rad), 3),
        -(15 * Math.cos(rad) - 5 * Math.cos(2 * rad) - 2 * Math.cos(3 * rad) - Math.cos(4 * rad))
      ];
    };

    const scaleAndTranslate = (pos: [number, number], sx: number, sy: number, dx: number, dy: number): [number, number] => {
      return [dx + pos[0] * sx, dy + pos[1] * sy];
    };

    const handleResize = () => {
      width = canvas.width = window.innerWidth * dpr;
      height = canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "rgba(0,0,0,1)";
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    const traceCount = 50;
    const pointsOrigin: [number, number][] = [];
    const dr = 0.1;

    for (let i = 0; i < Math.PI * 2; i += dr) {
      pointsOrigin.push(scaleAndTranslate(heartPosition(i), 210, 13, 0, 0));
    }
    for (let i = 0; i < Math.PI * 2; i += dr) {
      pointsOrigin.push(scaleAndTranslate(heartPosition(i), 150, 9, 0, 0));
    }
    for (let i = 0; i < Math.PI * 2; i += dr) {
      pointsOrigin.push(scaleAndTranslate(heartPosition(i), 90, 5, 0, 0));
    }

    const heartPointsCount = pointsOrigin.length;
    const targetPoints: [number, number][] = [];

    const pulse = (kx: number, ky: number) => {
      for (let i = 0; i < pointsOrigin.length; i++) {
        targetPoints[i] = [
          kx * pointsOrigin[i][0] + window.innerWidth / 2,
          ky * pointsOrigin[i][1] + window.innerHeight / 2
        ];
      }
    };

    interface Particle {
      vx: number;
      vy: number;
      R: number;
      speed: number;
      q: number;
      D: number;
      force: number;
      f: string;
      trace: { x: number; y: number }[];
    }

    // Initialize particles once
    const e: Particle[] = [];
    for (let i = 0; i < heartPointsCount; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      e[i] = {
        vx: 0,
        vy: 0,
        R: 2,
        speed: Math.random() + 5,
        q: ~~(Math.random() * heartPointsCount),
        D: 2 * (i % 2) - 1,
        force: 0.2 * Math.random() + 0.7,
        f: `hsla(${Math.random() < 0.5 ? 320 + Math.random() * 20 : 280 + Math.random() * 20},${~~(60 * Math.random() + 70)}%,${~~(80 * Math.random() + 15)}%,.4)`,
        trace: Array(traceCount).fill(null).map(() => ({ x, y }))
      };
    }

    const config = {
      traceK: 0.4,
      timeDelta: 0.005
    };

    let time = 0;
    let lastBeatTime = 0;
    let animationId: number;
    
    const loop = () => {
      // Get current values from refs
      const currentAudioData = audioDataRef.current;
      const currentIsPlaying = isPlayingRef.current;
      
      // Calculate dramatic audio-reactive pulse
      let basePulse = 1;
      let beatPulse = 1;
      let bassPulse = 1;
      
      if (currentIsPlaying && currentAudioData.overall > 0) {
        // Base pulse from overall audio level (enhanced for Meyda)
        basePulse = 1 + (currentAudioData.overall * 0.5);
        
        // Bass-driven pulse (heart thumping) - more dramatic
        bassPulse = 1 + (currentAudioData.bass * 0.6);
        
        // Beat detection for strong heart beats - more responsive
        if (currentAudioData.beat) {
          beatPulse = 1.6 + (currentAudioData.bass * 0.5); // More dramatic beat
          lastBeatTime = time;
        } else {
          // Beat decay - heart returns to normal size after beat
          const timeSinceBeat = time - lastBeatTime;
          const beatDecay = Math.max(0, 1 - timeSinceBeat * 0.03);
          beatPulse = 1 + beatDecay * 0.3;
        }
      }
      
      // Create a more reasonable natural heartbeat rhythm
      const naturalHeartbeat = Math.sin(time * 2) * 0.15 + 1; // More subtle
      
      // Combine all pulse factors for balanced effect
      const finalPulse = basePulse * bassPulse * beatPulse * naturalHeartbeat;
      
      // Ensure minimum and maximum pulse bounds (more reasonable)
      const clampedPulse = Math.max(0.5, Math.min(1.8, finalPulse));
      
      pulse(clampedPulse, clampedPulse);
      
      // Adjust time progression based on audio intensity for more dynamic movement
      const timeMultiplier = currentIsPlaying ? (1 + currentAudioData.overall * 1.2) : 1;
      time += ((Math.sin(time)) < 0 ? 12 : (naturalHeartbeat > 1.2) ? .3 : 1.5) * config.timeDelta * timeMultiplier;
      
      // Adjust trail opacity based on audio (more dramatic)
      const trailOpacity = currentIsPlaying ? 0.02 + currentAudioData.overall * 0.15 : 0.08;
      ctx.fillStyle = `rgba(0,0,0,${trailOpacity})`;
      ctx.fillRect(0, 0, width, height);

      for (let i = e.length; i--;) {
        const u = e[i];
        const q = targetPoints[u.q];
        const dx = u.trace[0].x - q[0];
        const dy = u.trace[0].y - q[1];
        const length = Math.sqrt(dx * dx + dy * dy);

        if (10 > length) {
          if (0.95 < Math.random()) {
            u.q = ~~(Math.random() * heartPointsCount);
          } else {
            if (0.99 < Math.random()) {
              u.D *= -1;
            }
            u.q += u.D;
            u.q %= heartPointsCount;
            if (0 > u.q) {
              u.q += heartPointsCount;
            }
          }
        }

        // Adjust particle speed based on audio intensity (more reasonable)
        const audioSpeedMultiplier = currentIsPlaying ? (1 + currentAudioData.overall * 0.6) : 1;
        const bassMultiplier = currentIsPlaying ? (1 + currentAudioData.bass * 0.4) : 1;
        const beatMultiplier = currentAudioData.beat ? 1.5 : 1.0;
        
        const totalSpeedMultiplier = audioSpeedMultiplier * bassMultiplier * beatMultiplier;
        
        u.vx += -dx / length * u.speed * totalSpeedMultiplier;
        u.vy += -dy / length * u.speed * totalSpeedMultiplier;
        u.trace[0].x += u.vx;
        u.trace[0].y += u.vy;
        u.vx *= u.force;
        u.vy *= u.force;

        for (let k = 0; k < u.trace.length - 1;) {
          const T = u.trace[k];
          const N = u.trace[++k];
          N.x -= config.traceK * (N.x - T.x);
          N.y -= config.traceK * (N.y - T.y);
        }

        // Adjust particle color intensity based on audio (more dramatic)
        if (currentIsPlaying) {
          const baseIntensity = 0.3 + currentAudioData.overall * 0.7;
          const bassIntensity = currentAudioData.bass * 0.3;
          const beatIntensity = currentAudioData.beat ? 0.4 : 0;
          const colorIntensity = Math.min(1.0, baseIntensity + bassIntensity + beatIntensity);
          u.f = u.f.replace(/,\s*[\d.]+\)/, `,${colorIntensity})`);
        }

        ctx.fillStyle = u.f;
        for (let k = 0; k < u.trace.length; k++) {
          ctx.fillRect(u.trace[k].x, u.trace[k].y, 1, 1);
        }
      }

      animationId = requestAnimationFrame(loop);
    };

    // Start the animation loop
    animationId = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, []); // Remove dependencies to prevent recreation

  return (
    <>
      <canvas ref={canvasRef} id="heart" />
      {isPlaying && (
        <div 
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            backgroundColor: isLoadingAnalysis
              ? '#ff6b6b' // Red when loading
              : isSpotifyMode 
                ? (meydaData ? `hsl(${120 + audioData.overall * 40}, 70%, 60%)` : `hsl(${30 + audioData.overall * 40}, 70%, 60%)`) // Green when Meyda active, orange for enhanced simulation
                : `hsl(${280 + audioData.overall * 40}, 70%, 60%)`, // Purple for real-time mode
            opacity: 0.7,
            zIndex: 1000,
            transition: 'all 0.1s ease',
            transform: `scale(${1 + audioData.overall * 0.5})`,
            boxShadow: audioData.beat ? '0 0 20px rgba(255, 0, 150, 0.8)' : 'none'
          }}
            title={
            isLoadingAnalysis
              ? "Loading Audio Analysis..." 
              : isSpotifyMode 
                ? (meydaData ? "Spotify Visualizer (Meyda Real-time Analysis)" : "Spotify Visualizer (Enhanced Simulation)")
                : "Real-time Audio Visualizer"
          }
        />
      )}
    </>
  );
};

export default HeartAnimation; 