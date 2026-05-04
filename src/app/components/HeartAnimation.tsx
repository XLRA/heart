'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { ParticleLevel, PARTICLE_MULTIPLIERS, TRACE_COUNTS } from '../context/SettingsContext';
import type { AlbumColors } from '../../services/colorExtractor';
import { createAudioAnalyzer, type AudioAnalyzer, type AudioReactiveData } from '../../services/audioAnalyzer';

// Legacy audio frames from non-analyzer paths (Meyda, Spotify simulation/analysis fallback)
// only carry the original six fields. The unified ref shape adds kick/snare/centroid/flatness
// derived from the legacy values when the richer data isn't available.
type LegacyAudioFields = Pick<AudioReactiveData, 'bass' | 'mid' | 'treble' | 'overall' | 'beat' | 'beatStrength'>;
type AudioFrameInput = LegacyAudioFields & Partial<AudioReactiveData>;

const NEUTRAL_SPECTRAL = 0.5;
const INDICATOR_THROTTLE_MS = 50; // ~20 Hz; plenty for the 10x10 px dot

// A3 anticipatory pulse. Window over which we ramp into a predicted beat.
// 130 ms gives a perceptible build without bleeding into the previous beat's
// decay at common tempos. Gain scales with tempoConfidence so unstable locks
// don't push false anticipations.
const ANTICIPATION_WINDOW_MS = 130;
const ANTICIPATION_GAIN = 0.3;

// A4 tempo-locked breathing. A subtle continuous sine at the song's tempo so
// the heart breathes *with* the music between hits. Smaller than the per-beat
// kick spike on purpose -- this is the bed, kicks are the spike.
const TEMPO_BREATHE_GAIN = 0.06;

// A5 section transition. Decay rate of the section glow and the strength of the
// one-shot radial burst that fires on the rising edge.
const SECTION_DECAY_60 = 0.992; // ~3 s half-life at 60 fps
const SECTION_BURST_STRENGTH = 8.0;

// Particles operate under constant-force radial pull within this distance from
// their target (preserves the original "stretch out, drift back" feel). Beyond
// this, pull amplifies linearly with distance so particles can't fly so far
// off-screen that their slow return leaves a persistent streak. Tuned to the
// heart's natural radius (~250 px) plus headroom for normal beat excursions.
//
// Long-running bug this fixes: outer-ring spike pushes particles radially
// outward from SCREEN CENTER, but particles aimed at the heart's bottom point
// (~247 px below center) get accelerated nearly straight down. With constant
// force pull-back, recovery from far excursions takes 1-2 seconds, during which
// the slowly-returning particle paints a pixel every frame. At equilibrium with
// the trail-erase fade rate, this produces a faint persistent streak below the
// heart that looks like a frozen afterimage but is actually being continuously
// refreshed.
const MAX_FREE_EXCURSION = 300;

const buildAudioFrame = (input: AudioFrameInput): AudioReactiveData => ({
  bass: input.bass,
  mid: input.mid,
  treble: input.treble,
  overall: input.overall,
  beat: input.beat,
  beatStrength: input.beatStrength,
  // Legacy paths fuse kick + snare into `beat`. Mirror them with slight asymmetry so
  // the visualization at least gets *some* differentiation while playing local files
  // with Meyda or Spotify simulation. Tab capture and local-file modes pass full data
  // and overwrite these defaults.
  kick: input.kick ?? input.beat,
  kickStrength: input.kickStrength ?? (input.beat ? input.beatStrength : 0),
  snare: input.snare ?? input.beat,
  snareStrength: input.snareStrength ?? (input.beat ? input.beatStrength * 0.7 : 0),
  centroid: input.centroid ?? NEUTRAL_SPECTRAL,
  flatness: input.flatness ?? NEUTRAL_SPECTRAL,
  // Tempo / section signals are only produced by the unified analyzer paths.
  // Legacy paths get safe defaults that disable anticipation, tempo-breathing, and
  // section transitions -- so those features only kick in when we actually have
  // FFT-grade data flowing.
  tempo: input.tempo ?? 0,
  tempoConfidence: input.tempoConfidence ?? 0,
  nextBeatIn: input.nextBeatIn ?? Infinity,
  beatPhase: input.beatPhase ?? 0,
  loudness: input.loudness ?? 0,
  section: input.section ?? false,
  sectionStrength: input.sectionStrength ?? 0,
});

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
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const localAnalyzerRef = useRef<AudioAnalyzer | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Canvas-side audio data lives in a ref so the animation loop reads it with zero
  // React-render overhead and zero one-frame staleness. All five audio paths write
  // here directly via writeAudioData.
  const audioDataRef = useRef<AudioReactiveData>(buildAudioFrame({
    bass: 0, mid: 0, treble: 0, overall: 0, beat: false, beatStrength: 0,
  }));

  // The indicator dot is the only React consumer of audio data. It's updated at
  // ~20 Hz instead of 60 Hz; carries only the two fields the JSX uses.
  const [indicatorData, setIndicatorData] = useState<{ overall: number; beat: boolean }>({
    overall: 0, beat: false,
  });
  const lastIndicatorUpdateRef = useRef(0);

  const [spotifyAnalysis, setSpotifyAnalysis] = useState<SpotifyAudioAnalysis | null>(null);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);

  const isPlayingRef = useRef(isPlaying);

  // Color transition refs
  const currentColorsRef = useRef<string[]>([]);
  const targetColorsRef = useRef<string[]>([]);
  const colorTransitionProgressRef = useRef(1); // 1 = complete, 0 = just started
  const colorTransitionStartTimeRef = useRef(0);
  const COLOR_TRANSITION_DURATION = 1500; // 1.5 seconds for smooth transition

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Single write-path for audio frames. Analyzer paths pass the full AudioReactiveData;
  // legacy paths pass just the six core fields and we synthesize the rest. Throttles
  // the React state update for the indicator dot so we don't churn renders at 60 Hz.
  const writeAudioData = useCallback((input: AudioFrameInput) => {
    const frame = buildAudioFrame(input);
    audioDataRef.current = frame;
    const now = performance.now();
    if (now - lastIndicatorUpdateRef.current >= INDICATOR_THROTTLE_MS) {
      lastIndicatorUpdateRef.current = now;
      setIndicatorData({ overall: frame.overall, beat: frame.beat });
    }
  }, []);
  
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

      writeAudioData({
        bass,
        mid,
        treble,
        overall,
        beat,
        beatStrength: beat ? 0.5 : 0,
      });
    };

    // Update immediately
    convertMeydaToAudioData();

    // Set up interval for continuous updates
    const interval = setInterval(convertMeydaToAudioData, 50); // Update every 50ms
    
    return () => clearInterval(interval);
  }, [meydaData, isPlaying, tabAudioStream, writeAudioData]);

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

  // Initialize Web Audio API (only for local audio files).
  // Audio graph:
  //   source ──> destination          (audible: user hears unmodified track)
  //   source ──> [analyzer side-chain] (analysis: pre-emphasis -> analyser node)
  // The analyzer factory builds the side-chain internally; we only wire the audible path here.
  useEffect(() => {
    if (!audioElement || !canvasRef.current || isSpotifyMode) return;

    const initAudioContext = async () => {
      try {
        audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        if (audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
        }

        sourceRef.current = audioContextRef.current.createMediaElementSource(audioElement);
        sourceRef.current.connect(audioContextRef.current.destination);

        localAnalyzerRef.current = createAudioAnalyzer({
          audioContext: audioContextRef.current,
          sourceNode: sourceRef.current,
        });

        console.log('Audio visualizer initialized');
      } catch (error) {
        console.error('Error initializing audio context:', error);
        audioContextRef.current = null;
        sourceRef.current = null;
        localAnalyzerRef.current = null;
      }
    };

    initAudioContext();

    return () => {
      if (localAnalyzerRef.current) {
        localAnalyzerRef.current.dispose();
        localAnalyzerRef.current = null;
      }
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(); } catch { /* already disconnected */ }
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

  // Audio analysis loop for local audio files. Reads from the unified analyzer
  // built in the init effect (see createAudioAnalyzer).
  useEffect(() => {
    if (!localAnalyzerRef.current || !isPlaying || isSpotifyMode || tabAudioStream) return;

    const analyzer = localAnalyzerRef.current;

    const tick = () => {
      if (localAnalyzerRef.current === analyzer && isPlayingRef.current) {
        writeAudioData(analyzer.read());
      }
      animationFrameRef.current = requestAnimationFrame(tick);
    };

    tick();

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, isSpotifyMode, tabAudioStream, writeAudioData]);

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
        
        writeAudioData({
          bass,
          mid,
          treble,
          overall,
          beat: Boolean(beatPattern),
          beatStrength: beatPattern ? 0.5 : 0,
        });
      };

      const interval = setInterval(simulateEnhancedAudioData, 50);
      return () => clearInterval(interval);
    }
  }, [isSpotifyMode, isPlaying, currentPosition, spotifyAnalysis, meydaData, spotifyTrackData, tabAudioStream, writeAudioData]);

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
        
        writeAudioData({
          bass: Math.max(0, Math.min(1, bass)),
          mid: Math.max(0, Math.min(1, mid)),
          treble: Math.max(0, Math.min(1, treble)),
          overall: loudnessNormalized,
          beat: Boolean(isBeat),
          beatStrength: isBeat ? 0.6 : 0,
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
        
        writeAudioData({
          bass: Math.max(0, Math.min(1, bass)),
          mid: Math.max(0, Math.min(1, mid)),
          treble: Math.max(0, Math.min(1, treble)),
          overall: loudnessNormalized,
          beat: false,
          beatStrength: 0,
        });
      }
    };

    const interval = setInterval(updateAudioDataFromAnalysis, 50); // Update every 50ms
    
    return () => clearInterval(interval);
  }, [isSpotifyMode, isPlaying, spotifyAnalysis, currentPosition, tabAudioStream, writeAudioData]);

  // Tab audio capture: real-time analysis of audio shared via getDisplayMedia.
  // Uses the unified analyzer (pre-emphasis + per-band beat detection + noise gate).
  // No connection to destination -- the captured tab is already audible to the user.
  useEffect(() => {
    if (!tabAudioStream) return;

    let frameId: number;
    let audioCtx: AudioContext | null = null;
    let analyzer: AudioAnalyzer | null = null;
    let cleanedUp = false;

    const setup = async () => {
      try {
        audioCtx = new AudioContext();
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
        if (cleanedUp) {
          if (audioCtx.state !== 'closed') await audioCtx.close();
          return;
        }

        const source = audioCtx.createMediaStreamSource(tabAudioStream);
        analyzer = createAudioAnalyzer({ audioContext: audioCtx, sourceNode: source });

        const tick = () => {
          if (cleanedUp || !analyzer) return;
          if (isPlayingRef.current) {
            writeAudioData(analyzer.read());
          }
          frameId = requestAnimationFrame(tick);
        };

        tick();
      } catch (error) {
        console.error('Error setting up tab audio capture:', error);
      }
    };

    setup();

    return () => {
      cleanedUp = true;
      if (frameId) cancelAnimationFrame(frameId);
      if (analyzer) {
        analyzer.dispose();
        analyzer = null;
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.close();
      }
    };
  }, [tabAudioStream, writeAudioData]);

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

    // Debug overlay toggle (press D to show/hide)
    let showDebug = false;
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'd' || ev.key === 'D') showDebug = !showDebug;
    };
    window.addEventListener('keydown', handleKeyDown);

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
    const outerRingCount = pointsOrigin.length;
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

    // Frame-rate decoupling. Every motion coefficient in this loop was tuned at
    // 60 fps. We compute `dtFrames` (current frame interval / a 60-fps frame
    // interval) each tick and:
    //   * multiply linear additions by it          (e.g. `time +=`, position += vx)
    //   * raise multiplicative decays to its power (e.g. glow *= 0.84)
    // This makes wall-clock motion identical across 60 / 120 / 144 / 240 Hz, on
    // battery vs plugged in, and across throttled environments.
    const FRAME_DT_60_MS = 1000 / 60;
    // Cap dtFrames so a tab returning from the background or a 30-second hitch
    // doesn't translate to an enormous single-frame physics jump.
    const MAX_DT_FRAMES = 4;
    // Global animation speed multiplier. The original code was frame-rate-bound
    // and ran at "2.4x" on a 144 Hz monitor versus a 60 Hz monitor. We tuned the
    // visual feel against that 144 Hz speed, so apply the same multiplier
    // uniformly across all displays. Lower this for a chiller animation, raise
    // it for a more frenetic one. NOTE: changing this has no effect on FPS or
    // CPU/GPU cost -- we do the same work per frame, the simulation just steps
    // farther per frame.
    const SPEED_MULTIPLIER = 144 / 60;

    let time = 0;
    let lastBeatTime = 0;
    let lastFrameTime = 0;
    let animationId: number;
    // Independent envelope-followed glow trackers for kick (sub-bass) and snare
    // (upper-mid). Kick drives the central heart pulse + speed boost; snare drives
    // the outer-ring radial spike. They overlap on most beats but separate on
    // off-beats so the visualization decomposes the rhythm.
    let kickGlow = 0;
    let snareGlow = 0;
    // A5 section glow: rises on a detected loudness-jump (chorus/drop) and decays
    // slowly (~3 s) so the visual lift is sustained, unlike the per-beat glows.
    let sectionGlow = 0;
    
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
    
    // Helper to get interpolated color for a particle.
    //   hueShift (deg): centroid-driven warmth/coolness offset on the album hue.
    //   saturationMod (0..1): flatness-driven saturation multiplier. 1 = album
    //     palette unchanged; <1 = desaturate. Tonal/melodic passages stay vivid;
    //     noisy/percussive passages drain toward grayscale, mirroring the audio
    //     spectrum's loss of tonal peaks.
    const getInterpolatedColor = (
      colorIndex: number,
      audioIntensity: number = 0.4,
      lightnessBoost: number = 0,
      hueShift: number = 0,
      saturationMod: number = 1,
    ): string => {
      const currentColors = currentColorsRef.current;
      const targetColors = targetColorsRef.current;
      const progress = colorTransitionProgressRef.current;

      const finalHue = (h: number) => Math.round(((h + hueShift) % 360 + 360) % 360);
      const finalSat = (s: number) => Math.max(0, Math.min(100, Math.round(s * saturationMod)));

      if (currentColors.length === 0 || targetColors.length === 0) {
        const boostedL = Math.min(100, 50 + lightnessBoost);
        return `hsla(${finalHue(320)}, ${finalSat(80)}%, ${boostedL}%, ${audioIntensity})`;
      }

      const currentColor = currentColors[colorIndex % currentColors.length];
      const targetColor = targetColors[colorIndex % targetColors.length];

      if (progress >= 1) {
        const parsed = parseHsla(targetColor);
        const boostedL = Math.min(100, parsed.l + lightnessBoost);
        return `hsla(${finalHue(parsed.h)}, ${finalSat(parsed.s)}%, ${boostedL}%, ${audioIntensity})`;
      }

      const interpolated = interpolateColor(currentColor, targetColor, progress);
      const parsed = parseHsla(interpolated);
      const boostedL = Math.min(100, parsed.l + lightnessBoost);
      return `hsla(${finalHue(parsed.h)}, ${finalSat(parsed.s)}%, ${boostedL}%, ${audioIntensity})`;
    };
    
    const loop = () => {
      // Frame-rate normalization. dtFrames = 1.0 at 60 fps, 0.5 at 120 fps,
      // 2.0 at 30 fps. Capped at MAX_DT_FRAMES so a returning background tab
      // doesn't blow up the integration. On the very first frame, lastFrameTime
      // is 0 -> synthesize one 60-fps step so dtFrames isn't astronomical.
      const now = performance.now();
      const rawDt = lastFrameTime === 0 ? FRAME_DT_60_MS : Math.max(0, now - lastFrameTime);
      lastFrameTime = now;
      // Cap real-time dt first (safety against background-tab huge jumps),
      // then apply SPEED_MULTIPLIER. This keeps the safety bound in wall-clock
      // terms rather than letting a 1-second hitch become 9.6 dt-frames of motion.
      const dtFrames = Math.min(rawDt / FRAME_DT_60_MS, MAX_DT_FRAMES) * SPEED_MULTIPLIER;

      // Precompute multiplicative decays so we don't redo the Math.pow per particle.
      // (Per-particle velocity damping `Math.pow(u.force, dtFrames)` is unavoidable
      // since u.force varies per particle.)
      const kickDecay = Math.pow(0.84, dtFrames);
      const snareDecay = Math.pow(0.78, dtFrames);
      const sectionDecayDt = Math.pow(SECTION_DECAY_60, dtFrames);
      const tracePullFactor = 1 - Math.pow(1 - config.traceK, dtFrames);

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
      
      const currentKickStrength = currentAudioData.kickStrength;
      const currentSnareStrength = currentAudioData.snareStrength;

      // Kick: 0.84 per-frame at 60 fps -> ~70 ms half-life. dt-corrected.
      if (currentAudioData.kick && currentIsPlaying) {
        kickGlow = Math.max(kickGlow, 0.4 + currentKickStrength * 0.6);
      } else {
        kickGlow *= kickDecay;
        if (kickGlow < 0.01) kickGlow = 0;
      }

      // Snare: 0.78 per-frame at 60 fps -> ~50 ms half-life. dt-corrected.
      if (currentAudioData.snare && currentIsPlaying) {
        snareGlow = Math.max(snareGlow, 0.5 + currentSnareStrength * 0.5);
      } else {
        snareGlow *= snareDecay;
        if (snareGlow < 0.01) snareGlow = 0;
      }

      // A5: section glow. Rises sharply on the rising edge of `section`, then
      // decays slowly (~3 s half-life). We capture the rising edge BEFORE
      // updating sectionGlow, since we'll use this flag inside the particle
      // loop for the one-shot radial burst.
      const sectionRisingEdge = currentAudioData.section && currentIsPlaying;
      if (sectionRisingEdge) {
        sectionGlow = Math.max(sectionGlow, 0.7 + currentAudioData.sectionStrength * 0.3);
      } else {
        sectionGlow *= sectionDecayDt;
        if (sectionGlow < 0.005) sectionGlow = 0;
      }

      // Used by global lightness/trail effects: any beat brightens the scene.
      // Section folds in too so chorus/drop lifts everything for its full tail.
      const combinedGlow = Math.max(kickGlow, snareGlow, sectionGlow * 0.8);

      // Pulse: energy envelope + KICK spike (not generic beat) for heart size changes.
      // Snares no longer pulse the heart -- they drive the outer ring instead.
      let pulseFactor = 1.0;
      if (currentIsPlaying && currentAudioData.overall > 0) {
        pulseFactor += currentAudioData.overall * 0.2;
        pulseFactor += currentAudioData.bass * 0.1;

        if (currentAudioData.kick) {
          pulseFactor += 0.25 + currentKickStrength * 0.35;
          lastBeatTime = time;
        } else {
          const timeSinceBeat = time - lastBeatTime;
          const beatDecay = Math.exp(-timeSinceBeat * 6);
          pulseFactor += beatDecay * 0.3;
        }

        // A3: Anticipatory pulse. When tempo is locked, ramp the pulse up *before*
        // the predicted beat lands so the visual peak coincides with the hit
        // instead of trailing it. Without this, kicks visibly arrive before the
        // animation responds (~30-80 ms detection latency on tab capture).
        // Window of 130 ms gives a noticeable ramp without overlapping the
        // previous beat's decay tail at typical tempos (>= 100 BPM => 600 ms period).
        if (
          currentAudioData.tempoConfidence > 0.7 &&
          currentAudioData.nextBeatIn < ANTICIPATION_WINDOW_MS
        ) {
          const proximity = 1 - currentAudioData.nextBeatIn / ANTICIPATION_WINDOW_MS;
          // Squared falloff so it rises gently at the edge and steepens as we approach.
          pulseFactor += proximity * proximity * currentAudioData.tempoConfidence * ANTICIPATION_GAIN;
        }
      }

      // A4: Baseline breathing. When tempo is locked, replace the generic time-based
      // sine with one phased to the actual song tempo -- the heart breathes *with*
      // the music instead of at an arbitrary rate. Falls back to the generic baseline
      // when no lock (silence, tempo loss, song just started).
      if (
        currentIsPlaying &&
        currentAudioData.tempoConfidence > 0.7 &&
        currentAudioData.tempo > 0
      ) {
        // beatPhase in [0, 1) -> sin maps to a single cycle per beat. Phase-shift
        // by -PI/2 so the trough lands on the beat (where the kick spike is) and
        // the peak lands at the *off* (between beats), creating an anticipatory
        // breath that exhales into each kick.
        const breath = Math.sin(currentAudioData.beatPhase * 2 * Math.PI - Math.PI / 2);
        pulseFactor += breath * TEMPO_BREATHE_GAIN * currentAudioData.tempoConfidence;
      } else {
        pulseFactor += Math.sin(time * 2) * 0.04;
      }
      const clampedPulse = Math.max(0.8, Math.min(1.8, pulseFactor));
      pulse(clampedPulse, clampedPulse);

      const timeMultiplier = currentIsPlaying ? (1 + currentAudioData.overall * 0.5) : 1;
      time += ((Math.sin(time)) < 0 ? 12 : (pulseFactor > 1.15) ? .3 : 1.5) * config.timeDelta * timeMultiplier * dtFrames;

      // Trail erase: a black overlay with low alpha each frame multiplicatively
      // fades old trails. Higher Hz means more applications/sec, so trails fade
      // faster on high-Hz displays. Apply the multiplicative-decay correction
      // (same trick as the glow decays) so wall-clock fade rate is constant.
      const baseTrailAlpha = currentIsPlaying
        ? 0.04 + currentAudioData.overall * 0.08 + combinedGlow * 0.06
        : 0.08;
      const trailOpacity = 1 - Math.pow(1 - baseTrailAlpha, dtFrames);
      ctx.fillStyle = `rgba(0,0,0,${trailOpacity})`;
      ctx.fillRect(0, 0, width, height);

      const cX = window.innerWidth / 2;
      const cY = window.innerHeight / 2;

      // --- Flatness-driven scene parameters (computed once per frame, applied per-particle) ---
      // Flatness ~ 0 (tonal: vocals, melody) -> heart silhouette stays crisp + vivid.
      // Flatness ~ 0.5+ (noisy: drums, distortion) -> particles wander tangentially,
      // saturation drains. Coefficients are conservative: max ~25% effect at peak
      // flatness so the heart never dissolves and the album palette stays legible.
      const currentFlatness = currentIsPlaying ? currentAudioData.flatness : 0;
      // Tangential jitter magnitude: scales by both flatness AND overall (so silence
      // doesn't twitch the heart even if flatness happens to be high momentarily).
      const tangentialJitter = currentFlatness * currentAudioData.overall * 0.7;
      // Saturation multiplier: 1.0 at flatness=0, 0.65 at flatness=1. Mostly stays
      // in [0.78, 1.0] for typical music since flatness rarely exceeds ~0.6.
      const saturationMod = 1 - currentFlatness * 0.35;

      for (let i = e.length; i--;) {
        const u = e[i];
        const q = targetPoints[u.q];
        const dx = u.trace[0].x - q[0];
        const dy = u.trace[0].y - q[1];
        const length = Math.sqrt(dx * dx + dy * dy);

        if (10 > length) {
          // Target switching: 5% chance / direction flip: 1% chance, both at 60 fps.
          // Linear scaling by dtFrames keeps event rate per second constant.
          // (Linear is a fine approximation for small probabilities; capped dtFrames
          // keeps it well-behaved.)
          if (Math.random() < 0.05 * dtFrames) {
            u.q = ~~(Math.random() * heartPointsCount);
          } else {
            if (Math.random() < 0.01 * dtFrames) {
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
        // Speed boost now keyed to KICK, the rhythmic anchor. Snare-only hits don't
        // accelerate the particle wash (they already get the radial spike below).
        const beatSpeedMult = currentAudioData.kick ? 1.2 + currentKickStrength * 0.2 : 1.0;
        const totalSpeedMultiplier = audioSpeedMultiplier * bassMultiplier * beatSpeedMult;

        // Radial pull (acceleration): scales linearly with dt. Within
        // MAX_FREE_EXCURSION it's constant force (the original feel); beyond,
        // amplifies linearly with distance so particles can't fly off-screen
        // and leave a persistent streak. See MAX_FREE_EXCURSION declaration
        // for the full bug write-up.
        const excursionFactor = length > MAX_FREE_EXCURSION
          ? 1 + (length - MAX_FREE_EXCURSION) / MAX_FREE_EXCURSION
          : 1;
        const radialAccel = u.speed * totalSpeedMultiplier * excursionFactor * dtFrames;
        u.vx += -dx / length * radialAccel;
        u.vy += -dy / length * radialAccel;

        // Tangential jitter: perpendicular to the radial pull, scaled by flatness.
        // Random sign per frame -> particles wander circumferentially. Stochastic
        // accelerations need sqrt(dt) scaling (not linear) to preserve per-second
        // variance: half the dt with twice the rate => sqrt(2) factor on amplitude.
        if (tangentialJitter > 0.01 && length > 1) {
          const tangX = -dy / length;
          const tangY = dx / length;
          const jitter = (Math.random() - 0.5) * tangentialJitter * Math.sqrt(dtFrames);
          u.vx += tangX * jitter;
          u.vy += tangY * jitter;
        }

        // Outer-ring expressiveness. Two coupled responses:
        //
        // 1. Snare spike (expansion). Pushes outer-ring particles outward from
        //    screen center. Magnitude was `snareGlow * 4.0` (only reactive to
        //    snare detection). Now scales with the full music signature:
        //    snareGlow envelope * (overall energy + bass weight + treble
        //    sparkle). Quiet passages produce subtle blooms; loud, full-spectrum
        //    drops produce dramatic ones -- same detection, much wider dynamic
        //    range. On big hits (intensity > 1.3) every outer-ring particle
        //    responds instead of every 3rd, with per-particle strength halved
        //    to keep total energy similar.
        //
        // 2. Kick contraction. On kicks, outer-ring particles get an extra pull
        //    toward target scaled by kickStrength. Combined with (1), this
        //    creates a breathe-in-on-kick / breathe-out-on-snare rhythm:
        //    expressive motion in the outer ring instead of just brightness.
        const isOuterRing = u.q < outerRingCount;
        if (isOuterRing) {
          if (snareGlow > 0.15) {
            const snareSpikeIntensity = snareGlow * (
              1 +
              currentAudioData.overall * 0.5 +
              currentAudioData.bass * 0.4 +
              currentAudioData.treble * 0.2
            );
            const widerNet = snareSpikeIntensity > 1.3;
            if (widerNet || i % 3 === 0) {
              const spDx = u.trace[0].x - cX;
              const spDy = u.trace[0].y - cY;
              const spDist = Math.sqrt(spDx * spDx + spDy * spDy);
              if (spDist > 10) {
                // Halve per-particle force when wider net is active (~3x more
                // particles affected, so /2 keeps the heart from launching).
                const perParticleBase = widerNet ? 2.2 : 4.0;
                const radial = snareSpikeIntensity * perParticleBase * dtFrames;
                u.vx += (spDx / spDist) * radial;
                u.vy += (spDy / spDist) * radial;
              }
            }
          }
          if (currentAudioData.kick) {
            // Pull toward target (heart silhouette). dx/dy already point from
            // particle to target, so -dx/length is the toward-target unit vector.
            const kickPull = currentKickStrength * 5.0 * dtFrames;
            u.vx += -dx / length * kickPull;
            u.vy += -dy / length * kickPull;
          }
        }

        // A5: section burst. Fires once on the rising edge of a chorus/drop.
        // Unlike the snare spike, this affects EVERY particle (not just outer
        // ring, not every-3rd) and pushes them outward harder -- so a drop
        // visibly explodes the heart silhouette outward before the radial pull
        // brings it back. dtFrames-scaled like other accelerations. Strength
        // is impulse-style (single frame), so we don't multiply by sectionGlow
        // here -- it's the rising edge itself that gates this.
        if (sectionRisingEdge) {
          const bDx = u.trace[0].x - cX;
          const bDy = u.trace[0].y - cY;
          const bDist = Math.sqrt(bDx * bDx + bDy * bDy);
          if (bDist > 10) {
            const burst = SECTION_BURST_STRENGTH * (0.6 + currentAudioData.sectionStrength * 0.4);
            u.vx += (bDx / bDist) * burst * dtFrames;
            u.vy += (bDy / bDist) * burst * dtFrames;
          }
        }

        // Position integration (vx is "units / 60-fps frame"; multiply by dt).
        u.trace[0].x += u.vx * dtFrames;
        u.trace[0].y += u.vy * dtFrames;
        // Velocity damping: was per-frame retention. Math.pow per particle since
        // u.force is per-particle (~0.7..0.9). Cost: ~50ns x particle count.
        const dampingPow = Math.pow(u.force, dtFrames);
        u.vx *= dampingPow;
        u.vy *= dampingPow;

        // Trail interpolation: per-frame multiplicative pull. tracePullFactor
        // is the dt-corrected lerp coefficient (precomputed once per frame).
        for (let k = 0; k < u.trace.length - 1;) {
          const T = u.trace[k];
          const N = u.trace[++k];
          N.x -= tracePullFactor * (N.x - T.x);
          N.y -= tracePullFactor * (N.y - T.y);
        }

        const baseIntensity = currentIsPlaying ? 0.25 + currentAudioData.overall * 0.5 : 0.4;
        const bassIntensity = currentIsPlaying ? currentAudioData.bass * 0.2 : 0;
        // Brightness flash on either kick OR snare so any beat brightens the scene.
        const glowIntensity = combinedGlow * 0.35;
        const trebleSparkle = currentIsPlaying ? currentAudioData.treble * 0.1 : 0;
        const colorIntensity = Math.min(1.0, baseIntensity + bassIntensity + glowIntensity + trebleSparkle);
        const lightnessBoost = combinedGlow * 15;
        // Spectral centroid -> hue shift. Centroid is in [0, 1] (perceptual log-Hz).
        // Map [0, 1] to [-12, +12] degrees: bass-heavy passages cool the palette,
        // bright passages (cymbals, vocals, leads) warm it up. Subtle on purpose --
        // the album palette stays the visual anchor.
        const centroidShift = currentIsPlaying ? (currentAudioData.centroid - 0.5) * 24 : 0;
        // Flatness -> saturation desaturation (computed once per frame above).
        u.f = getInterpolatedColor(u.colorIndex, colorIntensity, lightnessBoost, centroidShift, saturationMod);

        ctx.fillStyle = u.f;
        for (let k = 0; k < u.trace.length; k++) {
          ctx.fillRect(u.trace[k].x, u.trace[k].y, 1, 1);
        }
      }
      
      // Debug overlay (press D to toggle). Shows the bands, all glow trackers,
      // beat-strength sources, spectral descriptors, and tempo/section signals.
      // Indicator dots: green = kick fired this frame, magenta = snare fired,
      // cyan = section transition this frame.
      if (showDebug) {
        ctx.save();
        const pad = 12;
        const barW = 90;
        const lineH = 14;
        const rows = 14;
        let dbgY = pad;
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(pad - 4, pad - 4, barW + 80, lineH * rows + 12);
        ctx.font = '10px monospace';
        const drawBar = (label: string, val: number, color: string) => {
          ctx.fillStyle = '#777';
          ctx.fillText(`${label} ${val.toFixed(2)}`, pad, dbgY + 10);
          ctx.fillStyle = color;
          ctx.fillRect(pad + 52, dbgY + 2, Math.max(0, Math.min(val, 1)) * barW, 8);
          dbgY += lineH;
        };
        drawBar('bass', currentAudioData.bass, '#f55');
        drawBar('mid ', currentAudioData.mid, '#5f5');
        drawBar('trbl', currentAudioData.treble, '#55f');
        drawBar('ovrl', currentAudioData.overall, '#ff5');
        drawBar('kGlw', kickGlow, '#0ff');
        drawBar('sGlw', snareGlow, '#f0f');
        drawBar('plse', clampedPulse - 0.8, '#fff');
        drawBar('kStr', currentKickStrength, '#fa0');
        drawBar('sStr', currentSnareStrength, '#a0f');
        drawBar('cent', currentAudioData.centroid, '#0fa');
        drawBar('flat', currentAudioData.flatness, '#f80');
        // Tempo: BPM read out as text, normalized for the bar to [0, 200] BPM.
        ctx.fillStyle = '#777';
        ctx.fillText(`bpm  ${currentAudioData.tempo.toFixed(0)}`, pad, dbgY + 10);
        ctx.fillStyle = '#5af';
        ctx.fillRect(pad + 52, dbgY + 2, Math.min(currentAudioData.tempo / 200, 1) * barW, 8);
        dbgY += lineH;
        drawBar('conf', currentAudioData.tempoConfidence, '#5af');
        drawBar('sect', sectionGlow, '#0cf');
        // Kick / snare / section indicator dots stacked on the right.
        ctx.fillStyle = currentAudioData.kick ? '#0f0' : '#333';
        ctx.beginPath();
        ctx.arc(pad + barW + 60, pad + lineH, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = currentAudioData.snare ? '#f0f' : '#333';
        ctx.beginPath();
        ctx.arc(pad + barW + 60, pad + lineH * 3, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = currentAudioData.section ? '#0cf' : '#333';
        ctx.beginPath();
        ctx.arc(pad + barW + 60, pad + lineH * 5, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      animationId = requestAnimationFrame(loop);
    };

    // Start the animation loop
    animationId = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
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
                ? `hsl(${180 + indicatorData.overall * 40}, 70%, 60%)`
                : isSpotifyMode
                  ? (meydaData ? `hsl(${120 + indicatorData.overall * 40}, 70%, 60%)` : `hsl(${30 + indicatorData.overall * 40}, 70%, 60%)`)
                  : `hsl(${280 + indicatorData.overall * 40}, 70%, 60%)`,
            opacity: 0.7,
            zIndex: 1000,
            transition: 'all 0.1s ease',
            transform: `scale(${1 + indicatorData.overall * 0.5})`,
            boxShadow: indicatorData.beat ? '0 0 20px rgba(255, 0, 150, 0.8)' : 'none'
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