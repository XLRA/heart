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
// don't push false anticipations. Gain halved (0.3 -> 0.15) in the ring-pulse
// rework: the pre-beat swell must stay SMALLER than the on-beat pump or the
// rhythm hierarchy reads backwards.
const ANTICIPATION_WINDOW_MS = 130;
const ANTICIPATION_GAIN = 0.15;

// A4 tempo-locked breathing. A subtle continuous sine at the song's tempo so
// the heart breathes *with* the music between hits. Smaller than the per-beat
// kick spike on purpose -- this is the bed, kicks are the spike.
const TEMPO_BREATHE_GAIN = 0.06;

// A5 section transition. Decay rate of the section glow and the strength of the
// one-shot radial burst that fires on the rising edge.
const SECTION_DECAY_60 = 0.992; // ~3 s half-life at 60 fps
const SECTION_BURST_STRENGTH = 8.0;

// Radial-pull shaping. Three zones, by distance from target:
//   < SOFT_PULL_RADIUS    : pull TAPERS toward the target. The old constant-
//                           force pull made particles perpetually overshoot
//                           and orbit, and the audio speed multipliers raised
//                           that orbit amplitude exactly when the music got
//                           loud -- the main reason the silhouette fattened
//                           into a blob during loud passages. Tapering kills
//                           the overshoot loop near the rim while the taper
//                           floor (SOFT_PULL_FLOOR) keeps enough residual
//                           motion that the rim still shimmers organically.
//   .. MAX_FREE_EXCURSION : constant force -- the original "stretch out,
//                           drift back" feel, unchanged.
//   > MAX_FREE_EXCURSION  : pull stiffens linearly (divided by
//                           EXCURSION_STIFFNESS). Pulled in from 550 to 260
//                           and steepened so spark flights stay visible but
//                           displaced particles snap home in a fraction of
//                           the old time -- between beats the silhouette
//                           fully re-forms instead of staying a cloud.
// Spiked particles (per-particle u.spike = 1 at launch, decaying at
// SPIKE_FADE_60, ~0.35 s lifetime) glow for the flight and get a MILD recall
// boost that ramps in as the spike fades (1 -> 1 + SPIKE_RETURN_GAIN).
//
// Two failure modes are deliberately designed out here -- both shipped
// briefly and sent particles flying across the whole screen:
//   * Damping relief ("glide") on fresh spikes: coast distance scales as
//     1/(1 - retention), so relieving damping is EXPONENTIALLY stronger for
//     high-retention particles -- u.force=0.9 particles became near-
//     frictionless and crossed the screen. Launches are instead ballistic-
//     normalized at the source (see the needle-launch code), and damping is
//     never modified.
//   * A strong recall (gain 3.0): falling home from 200+ px under 4x pull
//     builds ~100 px/frame and SLINGSHOTS the particle through the heart and
//     out the far side, repeatedly. Gain 0.8 caps return pull at 1.8x; the
//     small residual overshoot reads as the original "trace back" look.
const SOFT_PULL_RADIUS = 110;
const SOFT_PULL_FLOOR = 0.45;
const MAX_FREE_EXCURSION = 260;
const EXCURSION_STIFFNESS = 180;
const SPIKE_RETURN_GAIN = 0.8;
const SPIKE_FADE_60 = 0.93;

// Ring-pulse system. A kick hits the INNER ring first and propagates outward
// (inner -> mid -> outer) through two chase filters, so the heart visibly
// pumps from its core like a contraction instead of inflating uniformly.
// Each ring also carries its own frequency band (treble -> inner, mid ->
// middle, bass -> outer), giving the silhouette spatial spectral separation.
// Crucially, ALL of these displacements move the TARGETS, which scales the
// silhouette coherently -- the shape never dissolves, unlike per-particle
// shoves.
const KICK_PULSE_DECAY_60 = 0.92;   // pump-wave envelope, ~190 ms visible tail
const RING_CHASE_60 = 0.30;         // chase rate: mid follows inner, outer follows mid (~75 ms core-to-rim)
const SNARE_FLARE_DECAY_60 = 0.78;  // fast outer-ring flare on snares, ~50 ms half-life

// Cap the dt used for POSITION integration only (velocity update + glow decays
// still use the full dtFrames so they recover properly after a hitch). Without
// this, a returning background tab can integrate ~10 frames worth of stale
// velocity in a single step, teleporting particles 500-700 px below the heart.
// Capping at 2.5 means tab-return causes a slow-motion catchup over the next
// few frames instead of one giant fling. Tuned just above 60 Hz nominal
// (dtFrames = 2.4 with SPEED_MULTIPLIER) so normal frames are unaffected.
const MAX_INTEGRATION_DT = 2.5;

// Music-reactive spike effect: SHARP NEEDLES on the beat. On each detected
// kick, a handful of "spike sites" -- stratified random angles around the
// silhouette -- fire simultaneously: every particle inside a site's narrow
// angular slice launches together along a tightly collimated outward ray
// (±3.5 deg jitter), with force peaking at the site center so each spike is
// pointed, not box-shaped. A few neighboring 50-dot trails overlapping on
// one ray render as a single bright needle sticking ~150-250 px out of the
// rim, holding for ~200 ms, then snapping back (see the SPIKE_* two-phase
// flight constants above).
//
// History: v1 scattered ~55% of ALL particles ±22 deg on every kick -- the
// whole heart dissolved into a cloud ("blob"). v2 cut that to ~30% with a
// fast recall, which fixed the blob but made the effect nearly invisible:
// the same energy spread over scattered singletons with ~70 ms flights reads
// as faint mist. v3 (this) concentrates the energy: FEW locations x MANY
// coherent neighbors x LONG flight = unmistakable spikes, while >85% of the
// silhouette never moves -- the heart stays a heart.
//
// Spike events are edge-triggered with a refractory (see spikeEvent in the
// loop): legacy audio paths (Meyda, Spotify simulation) hold `kick` high for
// many consecutive frames, and a level-triggered roll would re-launch
// particles every frame -- the continuous-fountain failure mode.
const KICK_SPIKE_MIN_STRENGTH = 0.12;        // permissive floor; weak kicks still spike a little
const KICK_SPIKE_LEN_BASE = 200;             // commanded needle drift in px (pre-braking)
const KICK_SPIKE_LEN_RANDOM = 120;           // + random extra commanded drift
const KICK_SPIKE_ANGLE_JITTER = 0.12;        // ±0.06 rad (~±3.5 deg): collimated, needle-like
const KICK_SPIKE_REFRACTORY_MS = 250;        // min gap between spike events
const SPIKE_SITE_BASE = 2;                   // sites on the weakest qualifying kick
const SPIKE_SITE_PER_STRENGTH = 3;           // + up to this many at full kick strength
const SPIKE_SITE_HALF_WIDTH = 0.11;          // rad; widened at lower particle densities
const SPIKE_SITE_PROB = 0.92;                // launch prob for particles inside a site
const KICK_SPIKE_SCATTER_PROB = 0.05;        // soft all-over sparkle outside the sites
// Manual test trigger: press 'B' to fire a maximum-strength burst on demand,
// independent of the audio. Useful for visually calibrating the effect when
// the music isn't producing strong kicks. Sets manualBurstFlag for one frame.

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

    // Get device pixel ratio for retina displays. Re-read on every resize:
    // browser zoom changes it mid-session (Ctrl +/- fires a resize).
    let dpr = window.devicePixelRatio || 1;

    // `width`/`height` are CSS pixels -- the coordinate space everything in
    // this loop draws in (the context is scaled by dpr). The full-canvas
    // fills below MUST use CSS dims: passing the backing-store size
    // (css * dpr) only covers css * dpr^2 device pixels, which is SMALLER
    // than the canvas whenever dpr < 1 (Chrome zoomed out / scaled-down
    // displays). That left a never-faded strip along the bottom and right
    // where every particle pixel persisted forever -- the "frozen particles
    // at the bottom center" bug under live audio, where kick spikes
    // constantly launch particles down into that strip.
    let width = window.innerWidth;
    let height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    // Scale canvas style size
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    // Scale context to account for device pixel ratio
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(0, 0, width, height);

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
      dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "rgba(0,0,0,1)";
      ctx.fillRect(0, 0, width, height);
    };

    window.addEventListener('resize', handleResize);

    // Debug overlay toggle (press D to show/hide).
    // Manual burst trigger (press B) -- fires a kick-spike at maximum strength
    // for one frame, useful for visually calibrating the effect when the
    // music isn't producing strong-enough kicks.
    let showDebug = false;
    let manualBurstFlag = false;
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'd' || ev.key === 'D') showDebug = !showDebug;
      else if (ev.key === 'b' || ev.key === 'B') manualBurstFlag = true;
    };
    window.addEventListener('keydown', handleKeyDown);

    // Tab visibility tracking. When the tab returns from hidden, the trail
    // chain (50 trace points per particle, lerped toward each other every
    // frame) can be left in a stretched-out state because rAF didn't fire
    // while hidden -- and even if our dt cap prevents physics teleports,
    // the chain itself doesn't auto-collapse. We snap all trace[k] to
    // trace[0] on visibility return; see pendingTrailCollapse declaration
    // below for details. Also reset lastFrameTime so the first post-return
    // frame uses a synthesized 60 fps dt instead of the cap.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        pendingTrailCollapse = true;
        lastFrameTime = 0;
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

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
    const midRingEnd = pointsOrigin.length;
    for (let i = 0; i < Math.PI * 2; i += dr) {
      pointsOrigin.push(scaleAndTranslate(heartPosition(i), 90, 5, 0, 0));
    }

    const heartPointsCount = pointsOrigin.length;
    const targetPoints: [number, number][] = [];

    // Per-ring scaling: each of the three silhouette rings gets its own scale
    // factor so the kick pump wave can travel core -> rim and each ring can
    // carry its own frequency band. Scaling targets (rather than shoving
    // particles) is what keeps every audio response shape-preserving.
    const pulse = (kOuter: number, kMid: number, kInner: number) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      for (let i = 0; i < pointsOrigin.length; i++) {
        const k = i < outerRingCount ? kOuter : i < midRingEnd ? kMid : kInner;
        targetPoints[i] = [
          k * pointsOrigin[i][0] + cx,
          k * pointsOrigin[i][1] + cy
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
      /** 1 right after a kick-spark launch, decaying toward 0. Drives both the
       *  extra return pull (SPIKE_RETURN_GAIN) and the spark's glow in the
       *  color pass, so launched particles read as bright streamers. */
      spike: number;
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
        colorIndex: i, // Store which color index this particle uses
        spike: 0
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

    // Tab-return trail collapse. The "wedge of stuck particles below the heart
    // after tabbing back" bug is *not* a framebuffer ghost (an earlier theory)
    // -- the pixels are too bright. It's the per-particle trail chain getting
    // stretched out across the screen during a tab-return frame and then
    // taking many seconds to converge: each trace[k] follows trace[k-1] via
    // lerp(traceK), so a chain of length 50 with a small per-frame pull leaves
    // a long visible tail any time trace[0] makes a big jump. Edge with
    // software canvas had it too in principle, but the absence of the
    // GPU-accel rounding artifact masked it visually.
    //
    // Fix is surgical: when the tab becomes visible again, snap every
    // particle's trace[1..N] to its trace[0]. This eliminates accumulated
    // chain-stretch from however long the tab was hidden without affecting
    // any normal-runtime motion. We set this flag from the visibilitychange
    // listener and consume it on the next animation frame.
    let pendingTrailCollapse = false;

    let time = 0;
    let lastFrameTime = 0;
    let animationId: number;
    // Kick edge detection + spike refractory. Legacy audio paths (Meyda,
    // Spotify simulation) report `kick` as a LEVEL that can stay true for
    // seconds; analyzer paths report one-frame events. Edge-triggering both
    // unifies them and prevents the every-frame re-launch fountains.
    let prevKick = false;
    let lastSpikeLaunchTime = 0;
    // Ring-pulse state. kickPulse is the pump-wave source (attacks on kick
    // edges, exponential release); midRingPulse / outerRingPulse chase it in
    // series so the pulse physically propagates core -> rim. snareFlare is a
    // fast outer-ring-only flare -- the snare's "expansion" now scales the
    // silhouette instead of scattering its particles.
    let kickPulse = 0;
    let midRingPulse = 0;
    let outerRingPulse = 0;
    let snareFlare = 0;
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

      // Collapse stretched trails on tab return. Set by the visibilitychange
      // listener; consumed exactly once. Snapping trace[1..N] -> trace[0]
      // and zeroing velocity removes any chain-stretch the trail accumulated
      // while hidden (when rAF was paused but conceptual time advanced).
      // Also paint a fully opaque black so any *real* framebuffer ghost from
      // before the hide is dropped in one frame instead of fading slowly.
      if (pendingTrailCollapse) {
        pendingTrailCollapse = false;
        for (const u of e) {
          const headX = u.trace[0].x;
          const headY = u.trace[0].y;
          for (let k = 1; k < u.trace.length; k++) {
            u.trace[k].x = headX;
            u.trace[k].y = headY;
          }
          u.vx = 0;
          u.vy = 0;
        }
        ctx.fillStyle = 'rgba(0,0,0,1)';
        ctx.fillRect(0, 0, width, height);
      }

      // Precompute multiplicative decays so we don't redo the Math.pow per particle.
      // (Per-particle velocity damping `Math.pow(u.force, dtFrames)` is unavoidable
      // since u.force varies per particle.)
      const kickDecay = Math.pow(0.84, dtFrames);
      const snareDecay = Math.pow(0.78, dtFrames);
      const sectionDecayDt = Math.pow(SECTION_DECAY_60, dtFrames);
      const tracePullFactor = 1 - Math.pow(1 - config.traceK, dtFrames);
      const kickPulseDecay = Math.pow(KICK_PULSE_DECAY_60, dtFrames);
      const snareFlareDecay = Math.pow(SNARE_FLARE_DECAY_60, dtFrames);
      const spikeFade = Math.pow(SPIKE_FADE_60, dtFrames);
      const ringChase = 1 - Math.pow(1 - RING_CHASE_60, dtFrames);

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

      // --- Ring-pulse envelopes -------------------------------------------------
      // Kick edge: fires once per detected kick regardless of whether the
      // audio path reports `kick` as a one-frame event or a held level.
      const kickEdge = currentAudioData.kick && !prevKick;
      prevKick = currentAudioData.kick;

      // Pump wave source. Attack on the kick edge (scaled by strength),
      // exponential release. midRingPulse and outerRingPulse chase it in
      // series, so the pump visibly travels inner -> mid -> outer over ~75 ms
      // -- the heart contracts from its core like a real heartbeat instead of
      // inflating in one rigid step.
      if (kickEdge && currentIsPlaying) {
        kickPulse = Math.max(kickPulse, 0.45 + 0.55 * currentKickStrength);
      }
      kickPulse *= kickPulseDecay;
      if (kickPulse < 0.005) kickPulse = 0;
      midRingPulse += (kickPulse - midRingPulse) * ringChase;
      outerRingPulse += (midRingPulse - outerRingPulse) * ringChase;

      // Snare flare: the snare's visual is now an outer-ring SCALE bump (plus
      // the brightness flash via snareGlow) -- shape-preserving, unlike the
      // old radial particle shove.
      if (currentAudioData.snare && currentIsPlaying) {
        snareFlare = Math.max(snareFlare, 0.4 + 0.6 * currentSnareStrength);
      } else {
        snareFlare *= snareFlareDecay;
        if (snareFlare < 0.005) snareFlare = 0;
      }

      // --- Base pulse (shared by all rings) -------------------------------------
      // Energy bed + anticipation + tempo breathing. The per-beat spike lives
      // in the ring envelopes above, so the base stays a slow, smooth bed.
      let basePulse = 1.0;
      if (currentIsPlaying && currentAudioData.overall > 0) {
        basePulse += currentAudioData.overall * 0.12;

        // A3: Anticipatory pulse. When tempo is locked, ramp the pulse up *before*
        // the predicted beat lands so the visual peak coincides with the hit
        // instead of trailing it. Without this, kicks visibly arrive before the
        // animation responds (~30-80 ms detection latency on tab capture).
        if (
          currentAudioData.tempoConfidence > 0.7 &&
          currentAudioData.nextBeatIn < ANTICIPATION_WINDOW_MS
        ) {
          const proximity = 1 - currentAudioData.nextBeatIn / ANTICIPATION_WINDOW_MS;
          // Squared falloff so it rises gently at the edge and steepens as we approach.
          basePulse += proximity * proximity * currentAudioData.tempoConfidence * ANTICIPATION_GAIN;
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
        basePulse += breath * TEMPO_BREATHE_GAIN * currentAudioData.tempoConfidence;
      } else {
        basePulse += Math.sin(time * 2) * 0.04;
      }

      // --- Per-ring scales: band mapping + pump wave ----------------------------
      // treble -> inner, mid -> middle, bass -> outer: the spectrum is laid
      // out spatially across the silhouette, so a hi-hat run shivers the
      // core while a bass drop swells the rim. The pump wave rides on top
      // with growing amplitude toward the rim (0.12 / 0.18 / 0.26) -- the
      // outward-traveling contraction is the signature kick visual. Clamps
      // are much tighter than the old [0.8, 1.8]: large scale jumps combined
      // with particle lag smeared the rim into an annulus.
      const trebleBand = currentIsPlaying ? currentAudioData.treble : 0;
      const midBand = currentIsPlaying ? currentAudioData.mid : 0;
      const bassBand = currentIsPlaying ? currentAudioData.bass : 0;
      const innerScale = Math.max(0.85, Math.min(1.45,
        basePulse + kickPulse * 0.12 + trebleBand * 0.05));
      const midScale = Math.max(0.85, Math.min(1.5,
        basePulse + midRingPulse * 0.18 + midBand * 0.06));
      const outerScale = Math.max(0.85, Math.min(1.6,
        basePulse + outerRingPulse * 0.26 + bassBand * 0.10
        + snareFlare * 0.08 + sectionGlow * 0.05));
      pulse(outerScale, midScale, innerScale);

      const timeMultiplier = currentIsPlaying ? (1 + currentAudioData.overall * 0.5) : 1;
      time += ((Math.sin(time)) < 0 ? 12 : (outerScale > 1.12) ? .3 : 1.5) * config.timeDelta * timeMultiplier * dtFrames;

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

      // One spark EVENT per detected kick: edge-triggered + refractory. The
      // per-particle probability roll happens inside the loop; this gate just
      // guarantees a "kick" that stays high for several frames (legacy paths)
      // or arrives in a rapid burst can't re-launch particles continuously.
      const spikeEvent = kickEdge &&
        currentIsPlaying &&
        currentKickStrength > KICK_SPIKE_MIN_STRENGTH &&
        now - lastSpikeLaunchTime > KICK_SPIKE_REFRACTORY_MS;
      if (spikeEvent) lastSpikeLaunchTime = now;

      // Build this kick's spike sites: stratified random angles (one per arc
      // segment, jittered within it) so the needles spread around the heart
      // instead of clumping on one side. Site count scales with kick strength.
      // The manual 'B' burst fires the same path at full strength so it
      // previews the real effect.
      let spikeSites: number[] | null = null;
      let spikeStrength = 0;
      if (spikeEvent || manualBurstFlag) {
        spikeStrength = manualBurstFlag ? 1 : currentKickStrength;
        const siteCount = SPIKE_SITE_BASE + Math.round(spikeStrength * SPIKE_SITE_PER_STRENGTH);
        spikeSites = [];
        for (let s = 0; s < siteCount; s++) {
          spikeSites.push(((s + Math.random()) / siteCount) * Math.PI * 2);
        }
      }
      // Lower particle densities have wider gaps between silhouette points;
      // widen each site so a needle always catches a few particles.
      const siteHalfWidth = SPIKE_SITE_HALF_WIDTH / Math.sqrt(particleMultiplier);

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

        // Speed multipliers, tamed from (0.35 / 0.2 / 0.2+0.2k). These scale
        // the pull acceleration, and with a constant-force pull the orbit
        // amplitude around each target scales with acceleration -- so the old
        // gains made the rim FUZZIER exactly when the music got loud. Loudness
        // now expresses itself mainly through the ring scales and brightness;
        // the multipliers just add a touch of urgency to the wash.
        const audioSpeedMultiplier = currentIsPlaying ? (1 + currentAudioData.overall * 0.18) : 1;
        const bassMultiplier = currentIsPlaying ? (1 + currentAudioData.bass * 0.10) : 1;
        // Speed boost keyed to KICK, the rhythmic anchor.
        const beatSpeedMult = currentAudioData.kick ? 1.10 + currentKickStrength * 0.10 : 1.0;
        const totalSpeedMultiplier = audioSpeedMultiplier * bassMultiplier * beatSpeedMult;

        // Radial pull (acceleration): scales linearly with dt. Three zones --
        // tapered near the target (kills the overshoot/orbit fuzz at the rim),
        // constant in the mid-band (original drift feel), stiffening beyond
        // MAX_FREE_EXCURSION (fast recovery from spark flights). Recently
        // spiked particles get an extra return boost so accents resolve before
        // the next beat lands. See the constant declarations for the full
        // write-up.
        const excursionFactor = length > MAX_FREE_EXCURSION
          ? 1 + (length - MAX_FREE_EXCURSION) / EXCURSION_STIFFNESS
          : 1;
        const proximityTaper = length < SOFT_PULL_RADIUS
          ? SOFT_PULL_FLOOR + (1 - SOFT_PULL_FLOOR) * (length / SOFT_PULL_RADIUS)
          : 1;
        const spikeReturn = u.spike > 0 ? 1 + SPIKE_RETURN_GAIN * (1 - u.spike) : 1;
        const radialAccel = u.speed * totalSpeedMultiplier * excursionFactor
          * proximityTaper * spikeReturn * dtFrames;
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

        // Outer-ring expressiveness. The breathe-in-on-kick / breathe-out-on-
        // snare rhythm survives the rework, but the snare's main displacement
        // moved from particle shoves to the snareFlare target scale (computed
        // above): pushing particles radially from SCREEN center was not the
        // silhouette's normal direction -- it shoved the bottom tip (farthest
        // from center) hardest and smeared the shape asymmetrically. What
        // remains here is:
        //
        // 1. Snare texture scatter. Every 3rd outer-ring particle gets a small
        //    center-radial nudge so the flare has organic grain on top of the
        //    coherent target expansion. Magnitude is ~1/3 of the old shove and
        //    no longer escalates with overall/bass (those drove the wider-net
        //    full-ring blasts that dissolved the rim on loud choruses).
        //
        // 2. Kick contraction. Outer-ring particles get an extra pull toward
        //    target riding the kickPulse ENVELOPE (not the raw flag), so it
        //    tracks the pump wave and works identically on one-shot and
        //    level-style kick reporting.
        const isOuterRing = u.q < outerRingCount;
        if (isOuterRing) {
          if (snareGlow > 0.2 && i % 3 === 0) {
            const spDx = u.trace[0].x - cX;
            const spDy = u.trace[0].y - cY;
            const spDist = Math.sqrt(spDx * spDx + spDy * spDy);
            if (spDist > 10) {
              const radial = snareGlow * (1 + currentAudioData.treble * 0.5) * 1.3 * dtFrames;
              u.vx += (spDx / spDist) * radial;
              u.vy += (spDy / spDist) * radial;
            }
          }
          if (kickPulse > 0.05) {
            // Pull toward target (heart silhouette). dx/dy already point from
            // particle to target, so -dx/length is the toward-target unit vector.
            const kickPull = kickPulse * 4.0 * dtFrames;
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
            // Mark as spiked: the burst glows and recovers fast, same as sparks.
            u.spike = 1;
          }
        }

        // Music-reactive spike needles. On a spike event (or manual 'B' press)
        // each particle checks its angular position from screen center against
        // this kick's spike sites:
        //   IN a site  -> launch (92%) along its own radial with tiny jitter,
        //                 commanded drift peaking at the site center
        //                 (quadratic falloff) so the spike is pointed.
        //                 Neighbors in the same slice fly together: their
        //                 trails overlap into one needle. Outer + mid rings
        //                 only -- inner-ring particles crossing the whole
        //                 body read as chaos, not spikes.
        //   OUTSIDE    -> small chance of a soft scatter at 40% length for
        //                 all-over sparkle texture (u.spike = 0.55 -> dimmer
        //                 glow).
        // Particles already in flight (u.spike >= 0.2) are skipped: re-hits
        // stack velocity on top of existing velocity and ratchet particles
        // off-screen over consecutive beats.
        // No dt scaling on the rolls: spikeEvent fires once per detected kick
        // (edge + refractory above); selection is per-event, not per-second.
        if (spikeSites && u.spike < 0.2) {
          const pdx = u.trace[0].x - cX;
          const pdy = u.trace[0].y - cY;
          const pdist = Math.sqrt(pdx * pdx + pdy * pdy);
          if (pdist > 1) {
            const pAngle = Math.atan2(pdy, pdx);
            let nearest = Infinity;
            for (let s = 0; s < spikeSites.length; s++) {
              let d = Math.abs(pAngle - spikeSites[s]);
              if (d > Math.PI) d = Math.PI * 2 - d;
              if (d < nearest) nearest = d;
            }
            // Ballistic normalization: launch velocity is sized so the
            // particle's total coast distance equals the commanded length,
            // compensating per-particle damping. u.force spans 0.7..0.9,
            // which is a ~4x spread in coast distance per unit velocity --
            // uniform launch forces send low-friction particles flying
            // across the screen while high-friction ones barely move.
            const damp = Math.pow(u.force, SPEED_MULTIPLIER);
            const ballistic = (1 - damp) / SPEED_MULTIPLIER;
            if (nearest < siteHalfWidth && u.q < midRingEnd && Math.random() < SPIKE_SITE_PROB) {
              const tip = 1 - (nearest / siteHalfWidth) * (nearest / siteHalfWidth) * 0.5;
              const angle = pAngle + (Math.random() - 0.5) * KICK_SPIKE_ANGLE_JITTER;
              // Needle length scales with kick strength AND overall loudness,
              // so a hard kick in a loud chorus throws ~2x the length of a
              // kick in a quiet verse.
              const loudnessFactor = manualBurstFlag ? 1.2 : (0.75 + currentAudioData.overall * 0.5);
              const lengthPx = (KICK_SPIKE_LEN_BASE + Math.random() * KICK_SPIKE_LEN_RANDOM)
                * (0.7 + spikeStrength * 0.4)
                * loudnessFactor
                * tip;
              u.vx += Math.cos(angle) * lengthPx * ballistic;
              u.vy += Math.sin(angle) * lengthPx * ballistic;
              // Light the spark: drives the glow in the color pass and the
              // fade-in recall.
              u.spike = 1;
            } else if (nearest >= siteHalfWidth && Math.random() < spikeStrength * KICK_SPIKE_SCATTER_PROB) {
              const angle = pAngle + (Math.random() - 0.5) * (Math.PI / 4);
              const lengthPx = (KICK_SPIKE_LEN_BASE + Math.random() * KICK_SPIKE_LEN_RANDOM)
                * 0.4 * (0.7 + spikeStrength * 0.4);
              u.vx += Math.cos(angle) * lengthPx * ballistic;
              u.vy += Math.sin(angle) * lengthPx * ballistic;
              u.spike = 0.55;
            }
          }
        }

        // Position integration. dt is capped at MAX_INTEGRATION_DT so a single
        // huge-dt frame (tab returning from background) can't teleport
        // particles 500+ px in one step. Velocity update above uses full
        // dtFrames so damping still recovers properly; only position is bounded.
        const integrationDt = dtFrames > MAX_INTEGRATION_DT ? MAX_INTEGRATION_DT : dtFrames;
        u.trace[0].x += u.vx * integrationDt;
        u.trace[0].y += u.vy * integrationDt;
        // Velocity damping: was per-frame retention. Math.pow per particle since
        // u.force is per-particle (~0.7..0.9). Cost: ~50ns x particle count.
        // NEVER modified for spikes -- see the SPIKE_* constant block for why
        // damping relief is catastrophic for high-retention particles.
        const dampingPow = Math.pow(u.force, dtFrames);
        u.vx *= dampingPow;
        u.vy *= dampingPow;

        // Spark state fade (~0.35 s glow; recall ramps in as it fades).
        if (u.spike > 0) {
          u.spike *= spikeFade;
          if (u.spike < 0.02) u.spike = 0;
        }

        // Trail interpolation: per-frame multiplicative pull. tracePullFactor
        // is the dt-corrected lerp coefficient (precomputed once per frame).
        //
        // Two safety clamps after the lerp:
        //   1. Per-link cap (MAX_LINK_DIST). Caps individual link length.
        //      Catches single-frame teleports.
        //   2. Per-particle MAX trail extent. Caps how far any trace[k] can
        //      be from the head trace[0]. Catches the slow accumulation
        //      case (chain stretches gradually over many frames without any
        //      single link being huge) which produced the "wedge of frozen
        //      particles below the heart" bug. Both clamps are cheap (no
        //      sqrt unless we're over budget) and only trigger in pathological
        //      cases -- normal motion has links of <10 px and trails of
        //      <150 px, well under the bounds.
        const MAX_LINK_DIST = 32;
        const MAX_LINK_DIST_SQ = MAX_LINK_DIST * MAX_LINK_DIST;
        const MAX_TRAIL_EXTENT = 220;
        const MAX_TRAIL_EXTENT_SQ = MAX_TRAIL_EXTENT * MAX_TRAIL_EXTENT;
        const headX = u.trace[0].x;
        const headY = u.trace[0].y;
        for (let k = 0; k < u.trace.length - 1;) {
          const T = u.trace[k];
          const N = u.trace[++k];
          N.x -= tracePullFactor * (N.x - T.x);
          N.y -= tracePullFactor * (N.y - T.y);

          const lx = N.x - T.x;
          const ly = N.y - T.y;
          const linkSq = lx * lx + ly * ly;
          if (linkSq > MAX_LINK_DIST_SQ) {
            const scale = MAX_LINK_DIST / Math.sqrt(linkSq);
            N.x = T.x + lx * scale;
            N.y = T.y + ly * scale;
          }

          // Bound trace[k] within MAX_TRAIL_EXTENT of trace[0].
          const ex = N.x - headX;
          const ey = N.y - headY;
          const extentSq = ex * ex + ey * ey;
          if (extentSq > MAX_TRAIL_EXTENT_SQ) {
            const scale = MAX_TRAIL_EXTENT / Math.sqrt(extentSq);
            N.x = headX + ex * scale;
            N.y = headY + ey * scale;
          }
        }

        const baseIntensity = currentIsPlaying ? 0.25 + currentAudioData.overall * 0.5 : 0.4;
        const bassIntensity = currentIsPlaying ? currentAudioData.bass * 0.2 : 0;
        // Brightness flash on either kick OR snare so any beat brightens the scene.
        const glowIntensity = combinedGlow * 0.35;
        const trebleSparkle = currentIsPlaying ? currentAudioData.treble * 0.1 : 0;
        // Spiked particles burn brighter (alpha + lightness) for the duration
        // of their flight. This is what lets the spark effect read STRONGER
        // than the old tuning despite launching far fewer particles: a few
        // luminous streamers against an intact heart beat dozens of dim dots
        // inside a cloud.
        const colorIntensity = Math.min(1.0,
          baseIntensity + bassIntensity + glowIntensity + trebleSparkle + u.spike * 0.35);
        const lightnessBoost = combinedGlow * 15 + u.spike * 22;
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

      // Manual burst is a one-frame impulse: clear the flag after the particle
      // loop has consumed it so the next frame doesn't re-trigger.
      manualBurstFlag = false;
      
      // Debug overlay (press D to toggle). Shows the bands, all glow trackers,
      // beat-strength sources, spectral descriptors, and tempo/section signals.
      // Indicator dots: green = kick fired this frame, magenta = snare fired,
      // cyan = section transition this frame.
      if (showDebug) {
        ctx.save();
        const pad = 12;
        const barW = 90;
        const lineH = 14;
        const rows = 17;
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
        // Ring scales shown relative to their 0.85 floor; kPls/flre are the
        // pump-wave source and the snare target-flare envelopes.
        drawBar('oScl', outerScale - 0.85, '#fff');
        drawBar('iScl', innerScale - 0.85, '#ccc');
        drawBar('kPls', kickPulse, '#fc0');
        drawBar('flre', snareFlare, '#c6f');
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
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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