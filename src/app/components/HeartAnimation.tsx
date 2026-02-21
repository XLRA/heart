'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { ParticleLevel, PARTICLE_MULTIPLIERS, TRACE_COUNTS } from '../context/SettingsContext';

// Album colors interface (matches AudioVisualizerContext)
interface AlbumColors {
  dominant: string;
  palette: string[];
  raw: {
    dominant: [number, number, number];
    palette: [number, number, number][];
  };
}

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
  albumColors?: AlbumColors | null;
  currentTrackId?: string | null;
  currentPosition?: number;
  particleLevel?: ParticleLevel;
  tabAudioStream?: MediaStream | null;
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
  albumColors = null,
  currentTrackId = null,
  currentPosition = 0,
  particleLevel = 'high',
  tabAudioStream = null
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
    beatStrength: number;
  }>({
    bass: 0,
    mid: 0,
    treble: 0,
    overall: 0,
    beat: false,
    beatStrength: 0
  });

  const [spotifyAnalysis, setSpotifyAnalysis] = useState<SpotifyAudioAnalysis | null>(null);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  
  // Use refs to access current values in animation loop
  const audioDataRef = useRef(audioData);
  const isPlayingRef = useRef(isPlaying);
  
  // Color transition refs
  const currentColorsRef = useRef<string[]>([]);
  const targetColorsRef = useRef<string[]>([]);
  const colorTransitionProgressRef = useRef(1); // 1 = complete, 0 = just started
  const colorTransitionStartTimeRef = useRef(0);
  const COLOR_TRANSITION_DURATION = 1500; // 1.5 seconds for smooth transition
  
  // Update refs when values change
  useEffect(() => {
    audioDataRef.current = audioData;
  }, [audioData]);
  
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  
  // Handle album color changes with fade transition
  useEffect(() => {
    if (!albumColors) return;
    
    console.log('[HeartAnimation] Album colors changed, starting transition');
    
    // Set target colors from album
    targetColorsRef.current = albumColors.palette;
    
    // If this is the first time setting colors, don't animate
    if (currentColorsRef.current.length === 0) {
      currentColorsRef.current = albumColors.palette;
      colorTransitionProgressRef.current = 1;
    } else {
      // Start transition
      colorTransitionProgressRef.current = 0;
      colorTransitionStartTimeRef.current = performance.now();
    }
  }, [albumColors]);

  // Convert Meyda real-time data to audioData format for heart animation
  useEffect(() => {
    if (!meydaData || !isPlaying || tabAudioStream) return;

    const convertMeydaToAudioData = () => {
      // Convert Meyda features to audioData format (normal amplification)
      const bass = Math.max(0.1, Math.min(1, meydaData.rms * 2)); // Normal amplification for bass
      const mid = Math.max(0.1, Math.min(1, meydaData.spectralCentroid)); // Normal amplification for mid
      const treble = Math.max(0.1, Math.min(1, meydaData.spectralRolloff / 20000)); // Normal amplification for treble
      const overall = Math.max(0.2, Math.min(1, meydaData.loudness / 100)); // Normal amplification for overall
      
      // Beat detection from spectral flux and RMS
      const beat = meydaData.spectralFlux > 0.1 || meydaData.rms > 0.3;

      setAudioData({
        bass,
        mid,
        treble,
        overall,
        beat,
        beatStrength: beat ? 0.5 : 0
      });
    };

    // Update immediately
    convertMeydaToAudioData();

    // Set up interval for continuous updates
    const interval = setInterval(convertMeydaToAudioData, 50); // Update every 50ms
    
    return () => clearInterval(interval);
  }, [meydaData, isPlaying, tabAudioStream]);

  // Fetch Spotify audio analysis data with fallback
  const fetchSpotifyAudioAnalysis = useCallback(async (trackId: string) => {
    if (!trackId) return;
    
    // Check if audio-analysis endpoint is deprecated (cached)
    const isDeprecated = localStorage.getItem('spotify_audio_analysis_deprecated') === 'true';
    
    if (isDeprecated) {
      // Skip API call and use enhanced simulation
      setSpotifyAnalysis(null);
      setIsLoadingAnalysis(false);
      return;
    }
    
    setIsLoadingAnalysis(true);
    try {
      const token = localStorage.getItem('spotify_access_token');
      if (!token) {
        setSpotifyAnalysis(null);
        setIsLoadingAnalysis(false);
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
      } else if (response.status === 403) {
        // Cache deprecation status to avoid repeated calls
        localStorage.setItem('spotify_audio_analysis_deprecated', 'true');
        // Don't set analysis, will fall back to enhanced simulation
        setSpotifyAnalysis(null);
      } else {
        setSpotifyAnalysis(null);
      }
    } catch {
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
  // Uses the same spectral flux + envelope follower approach as tab capture
  useEffect(() => {
    if (!analyserRef.current || !isPlaying || isSpotifyMode || tabAudioStream) return;

    const analyser = analyserRef.current;
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.3;

    const bufferLength = analyser.frequencyBinCount;
    const floatData = new Float32Array(bufferLength);
    const prevFloatData = new Float32Array(bufferLength);
    prevFloatData.fill(-100);

    const sampleRate = audioContextRef.current?.sampleRate || 44100;
    const binWidth = sampleRate / analyser.fftSize;
    const subBassEnd = Math.ceil(80 / binWidth);
    const bassEnd = Math.ceil(250 / binWidth);
    const midEnd = Math.ceil(2000 / binWidth);
    const trebleEnd = Math.min(bufferLength, Math.ceil(16000 / binWidth));

    let envBass = 0, envMid = 0, envTreble = 0, envOverall = 0;
    const ENV_ATTACK = 0.6;
    const ENV_DECAY = 0.05;

    let lastBeatTime = 0;
    const fluxHistory: number[] = [];

    const applyEnvelope = (current: number, raw: number) => {
      const rate = raw > current ? ENV_ATTACK : ENV_DECAY;
      return current + rate * (raw - current);
    };

    const analyzeAudio = () => {
      if (!analyserRef.current) return;

      analyserRef.current.getFloatFrequencyData(floatData);

      let subBassSum = 0, bassSum = 0, midSum = 0, trebleSum = 0;
      let subBassCount = 0, bassCount = 0, midCount = 0, trebleCount = 0;
      let bassFlux = 0, totalFlux = 0;

      for (let i = 1; i < trebleEnd; i++) {
        const magnitude = Math.max(0, (floatData[i] + 100) / 90);
        const prevMagnitude = Math.max(0, (prevFloatData[i] + 100) / 90);

        const delta = magnitude - prevMagnitude;
        if (delta > 0) {
          totalFlux += delta;
          if (i < bassEnd) bassFlux += delta;
        }

        if (i < subBassEnd) { subBassSum += magnitude; subBassCount++; }
        else if (i < bassEnd) { bassSum += magnitude; bassCount++; }
        else if (i < midEnd) { midSum += magnitude; midCount++; }
        else { trebleSum += magnitude; trebleCount++; }
      }

      prevFloatData.set(floatData);

      const rawBass = (subBassCount > 0 ? subBassSum / subBassCount : 0) * 0.65 +
                      (bassCount > 0 ? bassSum / bassCount : 0) * 0.35;
      const rawMid = midCount > 0 ? midSum / midCount : 0;
      const rawTreble = trebleCount > 0 ? trebleSum / trebleCount : 0;
      const rawOverall = rawBass * 0.35 + rawMid * 0.35 + rawTreble * 0.3;

      envBass = applyEnvelope(envBass, rawBass);
      envMid = applyEnvelope(envMid, rawMid);
      envTreble = applyEnvelope(envTreble, rawTreble);
      envOverall = applyEnvelope(envOverall, rawOverall);

      const weightedFlux = bassFlux * 3 + totalFlux;
      fluxHistory.push(weightedFlux);
      if (fluxHistory.length > 43) fluxHistory.shift();

      const sorted = [...fluxHistory].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const avg = fluxHistory.reduce((a, b) => a + b, 0) / fluxHistory.length;
      const fluxThreshold = Math.max(median + avg * 0.6, 0.005);

      const currentTime = Date.now();
      const timeSinceLastBeat = currentTime - lastBeatTime;

      const isBeat = weightedFlux > fluxThreshold && timeSinceLastBeat > 150;
      const strength = isBeat ? Math.min(1, (weightedFlux - fluxThreshold) / Math.max(0.01, fluxThreshold * 2)) : 0;

      if (isBeat) lastBeatTime = currentTime;

      setAudioData({
        bass: envBass,
        mid: envMid,
        treble: envTreble,
        overall: envOverall,
        beat: isBeat,
        beatStrength: strength
      });

      animationFrameRef.current = requestAnimationFrame(analyzeAudio);
    };

    analyzeAudio();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, isSpotifyMode, tabAudioStream]);

  // Spotify mode: Enhanced simulation when audio analysis is not available
  useEffect(() => {
    if (!isSpotifyMode || !isPlaying || !currentPosition) return;
    
    // Tab capture provides real audio data -- skip simulation
    if (tabAudioStream) return;
    
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
          beat: Boolean(beatPattern),
          beatStrength: beatPattern ? 0.5 : 0
        });
      };

      const interval = setInterval(simulateEnhancedAudioData, 50);
      return () => clearInterval(interval);
    }
  }, [isSpotifyMode, isPlaying, currentPosition, spotifyAnalysis, meydaData, spotifyTrackData, tabAudioStream]);

  // Spotify mode: Real audio-reactive behavior based on audio analysis
  useEffect(() => {
    if (!isSpotifyMode || !isPlaying || !spotifyAnalysis || !currentPosition || tabAudioStream) return;

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
          beat: Boolean(isBeat),
          beatStrength: isBeat ? 0.6 : 0
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
          beat: false,
          beatStrength: 0
        });
      }
    };

    const interval = setInterval(updateAudioDataFromAnalysis, 50); // Update every 50ms
    
    return () => clearInterval(interval);
  }, [isSpotifyMode, isPlaying, spotifyAnalysis, currentPosition, tabAudioStream]);

  // Tab audio capture: professional-grade frequency analysis from browser tab audio
  // Uses getFloatFrequencyData for precision, spectral flux onset detection,
  // and asymmetric envelope followers (fast attack / slow decay) per band.
  useEffect(() => {
    if (!tabAudioStream) return;

    let frameId: number;
    let audioCtx: AudioContext | null = null;
    let cleanedUp = false;

    const setup = async () => {
      try {
        audioCtx = new AudioContext();
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }

        const source = audioCtx.createMediaStreamSource(tabAudioStream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.3;
        analyser.minDecibels = -100;
        analyser.maxDecibels = -10;
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const floatData = new Float32Array(bufferLength);
        const prevFloatData = new Float32Array(bufferLength);
        prevFloatData.fill(-100);

        // Hz-accurate band boundaries (sampleRate / fftSize ≈ 21.5 Hz per bin at 44.1kHz)
        const sampleRate = audioCtx.sampleRate;
        const binWidth = sampleRate / analyser.fftSize;
        const subBassEnd = Math.ceil(80 / binWidth);
        const bassEnd = Math.ceil(250 / binWidth);
        const midEnd = Math.ceil(2000 / binWidth);
        const highMidEnd = Math.ceil(4000 / binWidth);
        const trebleEnd = Math.min(bufferLength, Math.ceil(16000 / binWidth));

        // Asymmetric envelope followers per band (fast attack, slow decay)
        let envBass = 0, envMid = 0, envTreble = 0, envOverall = 0;
        const ENV_ATTACK = 0.6;
        const ENV_DECAY = 0.05;

        // Spectral flux history for adaptive beat threshold
        let lastBeatTime = 0;
        const fluxHistory: number[] = [];

        const applyEnvelope = (current: number, raw: number) => {
          const rate = raw > current ? ENV_ATTACK : ENV_DECAY;
          return current + rate * (raw - current);
        };

        const analyze = () => {
          if (cleanedUp) return;

          if (isPlayingRef.current) {
            analyser.getFloatFrequencyData(floatData);

            let subBassSum = 0, bassSum = 0, midSum = 0, highMidSum = 0, trebleSum = 0;
            let subBassCount = 0, bassCount = 0, midCount = 0, highMidCount = 0, trebleCount = 0;
            let bassFlux = 0, totalFlux = 0;

            for (let i = 1; i < trebleEnd; i++) {
              // dB to perceptual 0-1: map [-100, -10] to [0, 1]
              const magnitude = Math.max(0, (floatData[i] + 100) / 90);
              const prevMagnitude = Math.max(0, (prevFloatData[i] + 100) / 90);

              // Spectral flux: half-wave rectified difference (only energy increases)
              const delta = magnitude - prevMagnitude;
              if (delta > 0) {
                totalFlux += delta;
                if (i < bassEnd) bassFlux += delta;
              }

              // Accumulate per-band energy
              if (i < subBassEnd) { subBassSum += magnitude; subBassCount++; }
              else if (i < bassEnd) { bassSum += magnitude; bassCount++; }
              else if (i < midEnd) { midSum += magnitude; midCount++; }
              else if (i < highMidEnd) { highMidSum += magnitude; highMidCount++; }
              else { trebleSum += magnitude; trebleCount++; }
            }

            prevFloatData.set(floatData);

            // Compute raw band averages
            const rawSubBass = subBassCount > 0 ? subBassSum / subBassCount : 0;
            const rawBass = bassCount > 0 ? bassSum / bassCount : 0;
            const rawMid = midCount > 0 ? midSum / midCount : 0;
            const rawHighMid = highMidCount > 0 ? highMidSum / highMidCount : 0;
            const rawTreble = trebleCount > 0 ? trebleSum / trebleCount : 0;

            // Combine sub-bass + bass (kick drum emphasis)
            const combinedBass = rawSubBass * 0.65 + rawBass * 0.35;
            const combinedMid = rawMid * 0.6 + rawHighMid * 0.4;
            const rawOverall = combinedBass * 0.35 + combinedMid * 0.35 + rawTreble * 0.3;

            // Apply envelope followers
            envBass = applyEnvelope(envBass, combinedBass);
            envMid = applyEnvelope(envMid, combinedMid);
            envTreble = applyEnvelope(envTreble, rawTreble);
            envOverall = applyEnvelope(envOverall, rawOverall);

            // Beat detection via bass-weighted spectral flux
            const weightedFlux = bassFlux * 3 + totalFlux;

            fluxHistory.push(weightedFlux);
            if (fluxHistory.length > 43) fluxHistory.shift();

            // Adaptive threshold: median + scaled average of recent flux
            const sorted = [...fluxHistory].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            const avg = fluxHistory.reduce((a, b) => a + b, 0) / fluxHistory.length;
            const fluxThreshold = Math.max(median + avg * 0.6, 0.005);

            const currentTime = Date.now();
            const timeSinceLastBeat = currentTime - lastBeatTime;

            const isBeat = weightedFlux > fluxThreshold && timeSinceLastBeat > 150;
            const strength = isBeat ? Math.min(1, (weightedFlux - fluxThreshold) / Math.max(0.01, fluxThreshold * 2)) : 0;

            if (isBeat) lastBeatTime = currentTime;

            setAudioData({
              bass: envBass,
              mid: envMid,
              treble: envTreble,
              overall: envOverall,
              beat: isBeat,
              beatStrength: strength
            });
          }

          frameId = requestAnimationFrame(analyze);
        };

        analyze();
      } catch (error) {
        console.error('Error setting up tab audio capture:', error);
      }
    };

    setup();

    return () => {
      cleanedUp = true;
      if (frameId) cancelAnimationFrame(frameId);
      if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.close();
      }
    };
  }, [tabAudioStream]);

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

    // Get particle settings based on level
    const particleMultiplier = PARTICLE_MULTIPLIERS[particleLevel];
    const traceCount = TRACE_COUNTS[particleLevel];
    
    const pointsOrigin: [number, number][] = [];
    // Adjust dr (delta radius) based on particle level - higher dr = fewer points
    const baseDr = 0.1;
    const dr = baseDr / particleMultiplier;

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
      colorIndex: number; // Index into the color palette
    }

    // Default colors (pink/purple) for fallback
    const defaultColors = [
      'hsla(320, 80%, 50%, 0.5)',
      'hsla(280, 70%, 45%, 0.45)',
      'hsla(340, 75%, 55%, 0.4)',
      'hsla(300, 65%, 40%, 0.35)',
      'hsla(260, 60%, 50%, 0.3)',
      'hsla(330, 85%, 60%, 0.4)',
      'hsla(290, 70%, 55%, 0.35)',
      'hsla(310, 75%, 45%, 0.3)',
    ];
    
    // Initialize current colors if empty
    if (currentColorsRef.current.length === 0) {
      currentColorsRef.current = defaultColors;
    }
    if (targetColorsRef.current.length === 0) {
      targetColorsRef.current = defaultColors;
    }

    // Helper function to get a color from the palette
    const getParticleColor = (index: number): string => {
      const colors = currentColorsRef.current.length > 0 ? currentColorsRef.current : defaultColors;
      return colors[index % colors.length];
    };

    // Initialize particles at the heart center so they spread outward naturally
    const e: Particle[] = [];
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    for (let i = 0; i < heartPointsCount; i++) {
      const x = centerX;
      const y = centerY;
      e[i] = {
        vx: 0,
        vy: 0,
        R: 2,
        speed: Math.random() + 5,
        q: ~~(Math.random() * heartPointsCount),
        D: 2 * (i % 2) - 1,
        force: 0.2 * Math.random() + 0.7,
        f: getParticleColor(i),
        trace: Array(traceCount).fill(null).map(() => ({ x, y })),
        colorIndex: i // Store which color index this particle uses
      } as Particle;
    }

    const config = {
      traceK: 0.4,
      timeDelta: 0.005
    };

    let time = 0;
    let lastBeatTime = 0;
    let animationId: number;
    
    // Helper function to parse HSLA color string
    const parseHsla = (hsla: string): { h: number; s: number; l: number; a: number } => {
      const match = hsla.match(/hsla?\((\d+),\s*(\d+)%,\s*(\d+)%,?\s*([\d.]+)?\)/);
      if (match) {
        return {
          h: parseInt(match[1]),
          s: parseInt(match[2]),
          l: parseInt(match[3]),
          a: parseFloat(match[4] || '0.4')
        };
      }
      return { h: 320, s: 70, l: 50, a: 0.4 }; // Default pink
    };
    
    // Helper function to interpolate between two colors
    const interpolateColor = (color1: string, color2: string, progress: number): string => {
      const c1 = parseHsla(color1);
      const c2 = parseHsla(color2);
      
      // Handle hue interpolation (circular)
      let hDiff = c2.h - c1.h;
      if (hDiff > 180) hDiff -= 360;
      if (hDiff < -180) hDiff += 360;
      
      const h = Math.round((c1.h + hDiff * progress + 360) % 360);
      const s = Math.round(c1.s + (c2.s - c1.s) * progress);
      const l = Math.round(c1.l + (c2.l - c1.l) * progress);
      const a = c1.a + (c2.a - c1.a) * progress;
      
      return `hsla(${h}, ${s}%, ${l}%, ${a.toFixed(2)})`;
    };
    
    // Helper to get interpolated color for a particle
    const getInterpolatedColor = (colorIndex: number, audioIntensity: number = 0.4, lightnessBoost: number = 0): string => {
      const currentColors = currentColorsRef.current;
      const targetColors = targetColorsRef.current;
      const progress = colorTransitionProgressRef.current;
      
      if (currentColors.length === 0 || targetColors.length === 0) {
        const boostedL = Math.min(100, 50 + lightnessBoost);
        return `hsla(320, 80%, ${boostedL}%, ${audioIntensity})`;
      }
      
      const currentColor = currentColors[colorIndex % currentColors.length];
      const targetColor = targetColors[colorIndex % targetColors.length];
      
      if (progress >= 1) {
        const parsed = parseHsla(targetColor);
        const boostedL = Math.min(100, parsed.l + lightnessBoost);
        return `hsla(${parsed.h}, ${parsed.s}%, ${boostedL}%, ${audioIntensity})`;
      }
      
      const interpolated = interpolateColor(currentColor, targetColor, progress);
      const parsed = parseHsla(interpolated);
      const boostedL = Math.min(100, parsed.l + lightnessBoost);
      return `hsla(${parsed.h}, ${parsed.s}%, ${boostedL}%, ${audioIntensity})`;
    };
    
    const loop = () => {
      // Get current values from refs
      const currentAudioData = audioDataRef.current;
      const currentIsPlaying = isPlayingRef.current;
      
      // Update color transition progress
      if (colorTransitionProgressRef.current < 1) {
        const elapsed = performance.now() - colorTransitionStartTimeRef.current;
        colorTransitionProgressRef.current = Math.min(1, elapsed / COLOR_TRANSITION_DURATION);
        
        // When transition completes, update current colors to target
        if (colorTransitionProgressRef.current >= 1) {
          currentColorsRef.current = [...targetColorsRef.current];
          console.log('[HeartAnimation] Color transition complete');
        }
      }
      
      // Pulse: energy envelope for gentle sway, spectral-flux beats for dramatic spikes
      let pulseFactor = 1.0;
      const currentBs = currentAudioData.beatStrength || 0.5;
      
      if (currentIsPlaying && currentAudioData.overall > 0) {
        pulseFactor += currentAudioData.overall * 0.3;
        pulseFactor += currentAudioData.bass * 0.2;
        
        if (currentAudioData.beat) {
          pulseFactor += 0.3 + currentBs * 0.5;
          lastBeatTime = time;
        } else {
          // Slower decay so particles have time to respond visually
          const timeSinceBeat = time - lastBeatTime;
          const beatDecay = Math.exp(-timeSinceBeat * 4);
          pulseFactor += beatDecay * 0.4;
        }
      }
      
      pulseFactor += Math.sin(time * 2) * 0.04;
      
      const clampedPulse = Math.max(0.8, Math.min(2.0, pulseFactor));
      
      pulse(clampedPulse, clampedPulse);
      
      const timeMultiplier = currentIsPlaying ? (1 + currentAudioData.overall * 0.5) : 1;
      time += ((Math.sin(time)) < 0 ? 12 : (pulseFactor > 1.15) ? .3 : 1.5) * config.timeDelta * timeMultiplier;
      
      // Trail opacity: short trails on beats (crisp snap), long trails between (smooth flow)
      const beatTrailBoost = currentAudioData.beat ? 0.12 : 0;
      const trailOpacity = currentIsPlaying ? 0.04 + currentAudioData.overall * 0.08 + beatTrailBoost : 0.08;
      ctx.fillStyle = `rgba(0,0,0,${trailOpacity})`;
      ctx.fillRect(0, 0, width, height);

      // Pre-compute beat-related values once per frame (not per particle)
      const isBeatFrame = currentIsPlaying && currentAudioData.beat;
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const particleSize = isBeatFrame ? 2 : 1;

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

        const audioSpeedMultiplier = currentIsPlaying ? (1 + currentAudioData.overall * 0.35) : 1;
        const bassMultiplier = currentIsPlaying ? (1 + currentAudioData.bass * 0.2) : 1;
        const beatMultiplier = currentAudioData.beat ? 1.3 + currentBs * 0.3 : 1.0;
        
        const totalSpeedMultiplier = audioSpeedMultiplier * bassMultiplier * beatMultiplier;
        
        u.vx += -dx / length * u.speed * totalSpeedMultiplier;
        u.vy += -dy / length * u.speed * totalSpeedMultiplier;

        // Direct outward velocity kick on beats -- bypasses sluggish target physics
        if (isBeatFrame) {
          const kickDx = u.trace[0].x - centerX;
          const kickDy = u.trace[0].y - centerY;
          const kickDist = Math.sqrt(kickDx * kickDx + kickDy * kickDy);
          if (kickDist > 1) {
            const kickStrength = currentBs * 2.5;
            u.vx += (kickDx / kickDist) * kickStrength;
            u.vy += (kickDy / kickDist) * kickStrength;
          }
        }

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

        // Color: base from energy envelope, flash brightness on beats, treble sparkle
        const baseIntensity = currentIsPlaying ? 0.25 + currentAudioData.overall * 0.5 : 0.4;
        const bassIntensity = currentIsPlaying ? currentAudioData.bass * 0.2 : 0;
        const beatFlash = isBeatFrame ? 0.25 + currentBs * 0.35 : 0;
        const trebleSparkle = currentIsPlaying ? currentAudioData.treble * 0.1 : 0;
        const colorIntensity = Math.min(1.0, baseIntensity + bassIntensity + beatFlash + trebleSparkle);
        
        // Lightness boost: particles physically flash brighter on beats
        const lightnessBoost = isBeatFrame ? 15 + currentBs * 25 : 0;
        u.f = getInterpolatedColor(u.colorIndex, colorIntensity, lightnessBoost);

        ctx.fillStyle = u.f;
        for (let k = 0; k < u.trace.length; k++) {
          ctx.fillRect(u.trace[k].x, u.trace[k].y, particleSize, particleSize);
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
  }, [particleLevel]); // Re-create when particle level changes

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
              ? '#ff6b6b'
              : tabAudioStream
                ? `hsl(${180 + audioData.overall * 40}, 70%, 60%)`
                : isSpotifyMode 
                  ? (meydaData ? `hsl(${120 + audioData.overall * 40}, 70%, 60%)` : `hsl(${30 + audioData.overall * 40}, 70%, 60%)`)
                  : `hsl(${280 + audioData.overall * 40}, 70%, 60%)`,
            opacity: 0.7,
            zIndex: 1000,
            transition: 'all 0.1s ease',
            transform: `scale(${1 + audioData.overall * 0.5})`,
            boxShadow: audioData.beat ? '0 0 20px rgba(255, 0, 150, 0.8)' : 'none'
          }}
            title={
            isLoadingAnalysis
              ? "Loading Audio Analysis..." 
              : tabAudioStream
                ? "Live Tab Audio Capture (Real-time)"
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