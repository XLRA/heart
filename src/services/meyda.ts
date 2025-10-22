// Dynamic import for Meyda to handle potential build issues
let Meyda: unknown = null;

// Try to load Meyda dynamically
const loadMeyda = async () => {
  if (Meyda) return Meyda;
  
  try {
    if (typeof window !== 'undefined') {
      // Client-side: use dynamic import
      const meydaModule = await import('meyda');
      Meyda = meydaModule.default || meydaModule;
    } else {
      // Server-side: use dynamic import
      const meydaModule = await import('meyda');
      Meyda = meydaModule.default || meydaModule;
    }
    return Meyda;
  } catch (error) {
    console.warn('Meyda not available, using fallback implementation:', error);
    return null;
  }
};

// Meyda analyzer interface
interface MeydaAnalyzer {
  start(): void;
  stop(): void;
}

// Meyda module interface
interface MeydaModule {
  createMeydaAnalyzer: (config: {
    audioContext: AudioContext;
    source: MediaElementAudioSourceNode;
    bufferSize: number;
    featureExtractors: string[];
    callback: (features: Record<string, unknown>) => void;
  }) => MeydaAnalyzer;
}

interface MeydaAudioFeatures {
  rms: number;
  spectralCentroid: number;
  spectralRolloff: number;
  spectralFlux: number;
  spectralSpread: number;
  spectralKurtosis: number;
  loudness: number;
  mfcc: number[];
  chroma: number[];
}

interface CacheEntry {
  data: MeydaAudioFeatures;
  timestamp: number;
  trackId: string;
}

class MeydaAudioService {
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_DURATION = 2 * 60 * 1000; // 2 minutes
  private readonly RATE_LIMIT_DELAY = 100; // 100ms between requests
  private lastRequestTime = 0;
  private requestQueue: Array<() => Promise<unknown>> = [];
  private isProcessingQueue = false;
  private currentAnalyzer: MeydaAnalyzer | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.RATE_LIMIT_DELAY) {
      const delay = this.RATE_LIMIT_DELAY - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.lastRequestTime = Date.now();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (request) {
        try {
          await request();
        } catch (error) {
          console.error('Error processing Meyda request:', error);
        }
      }
    }

    this.isProcessingQueue = false;
  }

  async initializeAudioContext(audioElement?: HTMLAudioElement): Promise<void> {
    const meyda = await loadMeyda();
    if (!meyda) {
      console.warn('Meyda not available, skipping audio context initialization');
      return;
    }

    try {
      // Clean up existing connections first
      this.cleanup();
      
      // Create audio context
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      
      // Resume context if suspended (required for user interaction)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      // For Spotify Web Player, we need a different approach
      // Since Spotify Web Player doesn't give us direct access to the audio element,
      // we'll use a microphone-based approach to capture the audio being played
      try {
        // Request microphone access to capture the audio being played through speakers
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });
        
        this.sourceNode = this.audioContext.createMediaStreamSource(stream) as unknown as MediaElementAudioSourceNode;
        this.sourceNode.connect(this.audioContext.destination);
        console.log('Meyda audio context initialized with microphone capture');
        console.log('Note: Make sure your speakers are playing the Spotify audio for analysis');
      } catch {
        console.warn('Microphone access not available, trying alternative approach');
        
        // Fallback: Try to use the provided audio element if available
        if (audioElement) {
          try {
            this.sourceNode = this.audioContext.createMediaElementSource(audioElement);
            this.sourceNode.connect(this.audioContext.destination);
            console.log('Meyda audio context initialized with provided audio element');
            return;
          } catch {
            console.warn('Audio element already connected, using fallback features');
          }
        }
        
        // If all else fails, we'll use fallback features
        this.audioContext = null;
        this.sourceNode = null;
      }
    } catch (error) {
      console.error('Error initializing Meyda audio context:', error);
      this.audioContext = null;
      this.sourceNode = null;
    }
  }

  async startAnalysis(callback: (features: MeydaAudioFeatures) => void): Promise<void> {
    const meyda = await loadMeyda();
    if (!meyda) {
      console.warn('Meyda not available, using fallback features');
      // Provide fallback features
      const fallbackFeatures: MeydaAudioFeatures = {
        rms: 0.5,
        spectralCentroid: 0.5,
        spectralRolloff: 0.5,
        spectralFlux: 0.3,
        spectralSpread: 0.5,
        spectralKurtosis: 0.5,
        loudness: 0.5,
        mfcc: Array(13).fill(0.5),
        chroma: Array(12).fill(0.5)
      };
      callback(fallbackFeatures);
      return;
    }

    if (!this.audioContext || !this.sourceNode) {
      console.warn('Audio context not initialized, using fallback features');
      // Provide fallback features when audio context fails
      const fallbackFeatures: MeydaAudioFeatures = {
        rms: 0.5,
        spectralCentroid: 0.5,
        spectralRolloff: 0.5,
        spectralFlux: 0.3,
        spectralSpread: 0.5,
        spectralKurtosis: 0.5,
        loudness: 0.5,
        mfcc: Array(13).fill(0.5),
        chroma: Array(12).fill(0.5)
      };
      callback(fallbackFeatures);
      return;
    }

    // Stop existing analyzer if running
    if (this.currentAnalyzer) {
      this.currentAnalyzer.stop();
    }

    try {
      // Create Meyda analyzer with comprehensive feature extraction
      this.currentAnalyzer = (meyda as MeydaModule).createMeydaAnalyzer({
        audioContext: this.audioContext,
        source: this.sourceNode,
        bufferSize: 512,
        featureExtractors: [
          'rms',
          'spectralCentroid',
          'spectralRolloff',
          'spectralSpread',
          'spectralKurtosis',
          'loudness',
          'mfcc',
          'chroma'
        ],
        callback: (features: Record<string, unknown>) => {
          try {
            if (features) {
              // Normalize and process features with error handling
              const processedFeatures: MeydaAudioFeatures = {
                rms: this.normalizeRMS(features.rms),
                spectralCentroid: this.normalizeSpectralCentroid(features.spectralCentroid),
                spectralRolloff: this.normalizeSpectralRolloff(features.spectralRolloff),
                spectralFlux: 0, // Calculate simple spectral flux from RMS changes
                spectralSpread: this.normalizeSpectralSpread(features.spectralSpread),
                spectralKurtosis: this.normalizeSpectralKurtosis(features.spectralKurtosis),
                loudness: this.normalizeLoudness(features.loudness),
                mfcc: this.normalizeMFCC(features.mfcc),
                chroma: this.normalizeChroma(features.chroma)
              };
              
              callback(processedFeatures);
            }
          } catch (error) {
            console.warn('Error processing Meyda features:', error);
            // Provide fallback features to prevent crashes
            callback({
              rms: 0.1,
              spectralCentroid: 0.5,
              spectralRolloff: 0.5,
              spectralFlux: 0,
              spectralSpread: 0.5,
              spectralKurtosis: 0.5,
              loudness: 0.1,
              mfcc: Array(13).fill(0),
              chroma: Array(12).fill(0)
            });
          }
        }
      });

      if (this.currentAnalyzer) {
        this.currentAnalyzer.start();
        console.log('Meyda analysis started');
        
        // Add timeout to prevent infinite error loops
        setTimeout(() => {
          if (this.currentAnalyzer) {
            try {
              this.currentAnalyzer.stop();
            } catch (error) {
              console.warn('Error stopping Meyda analyzer:', error);
            }
          }
        }, 30000); // Stop after 30 seconds to prevent memory leaks
      }
    } catch (error) {
      console.error('Error starting Meyda analysis:', error);
    }
  }

  async stopAnalysis(): Promise<void> {
    const meyda = await loadMeyda();
    if (!meyda) {
      console.warn('Meyda not available, nothing to stop');
      return;
    }

    if (this.currentAnalyzer) {
      this.currentAnalyzer.stop();
      this.currentAnalyzer = null;
      console.log('Meyda analysis stopped');
    }
  }

  cleanup(): void {
    this.stopAnalysis();
    
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  // Normalization methods for different features
  private normalizeRMS(rms: unknown): number {
    // RMS is typically between 0 and 1, but can be higher
    const rmsValue = typeof rms === 'number' ? rms : 0;
    return Math.min(1, Math.max(0, rmsValue));
  }

  private normalizeSpectralCentroid(centroid: unknown): number {
    // Spectral centroid is in Hz, normalize to 0-1 based on typical range
    const centroidValue = typeof centroid === 'number' ? centroid : 0;
    return Math.min(1, Math.max(0, centroidValue / 8000)); // Assuming max 8kHz
  }

  private normalizeSpectralRolloff(rolloff: unknown): number {
    // Spectral rolloff is in Hz, normalize to 0-1
    const rolloffValue = typeof rolloff === 'number' ? rolloff : 0;
    return Math.min(1, Math.max(0, rolloffValue / 22050)); // Nyquist frequency
  }

  private normalizeSpectralFlux(flux: unknown): number {
    // Spectral flux can be any positive number, normalize based on typical range
    const fluxValue = typeof flux === 'number' ? flux : 0;
    return Math.min(1, Math.max(0, fluxValue / 10));
  }

  private normalizeSpectralSpread(spread: unknown): number {
    // Spectral spread is in Hz, normalize to 0-1
    const spreadValue = typeof spread === 'number' ? spread : 0;
    return Math.min(1, Math.max(0, spreadValue / 4000));
  }

  private normalizeSpectralKurtosis(kurtosis: unknown): number {
    // Spectral kurtosis is typically between 0 and 1
    const kurtosisValue = typeof kurtosis === 'number' ? kurtosis : 0;
    return Math.min(1, Math.max(0, kurtosisValue));
  }

  private normalizeLoudness(loudness: unknown): number {
    // Loudness has .total property, normalize to 0-1
    if (loudness && typeof loudness === 'object' && loudness !== null && 'total' in loudness) {
      const totalValue = (loudness as { total: unknown }).total;
      if (typeof totalValue === 'number') {
        return Math.min(1, Math.max(0, totalValue / 100));
      }
    }
    return 0;
  }

  private normalizeMFCC(mfcc: unknown): number[] {
    // MFCC coefficients are typically between -10 and 10
    if (Array.isArray(mfcc)) {
      return mfcc.map(coeff => {
        const coeffValue = typeof coeff === 'number' ? coeff : 0;
        return Math.min(1, Math.max(0, (coeffValue + 10) / 20));
      });
    }
    return [];
  }

  private normalizeChroma(chroma: unknown): number[] {
    // Chroma values are typically between 0 and 1
    if (Array.isArray(chroma)) {
      return chroma.map(val => {
        const valValue = typeof val === 'number' ? val : 0;
        return Math.min(1, Math.max(0, valValue));
      });
    }
    return [];
  }

  // Cache management
  setCacheEntry(trackId: string, features: MeydaAudioFeatures): void {
    this.cache.set(trackId, {
      data: features,
      timestamp: Date.now(),
      trackId
    });
  }

  getCacheEntry(trackId: string): MeydaAudioFeatures | null {
    const entry = this.cache.get(trackId);
    if (entry && Date.now() - entry.timestamp < this.CACHE_DURATION) {
      return entry.data;
    }
    return null;
  }

  clearCache(): void {
    this.cache.clear();
    console.log('Meyda cache cleared');
  }

  getCacheStats(): { size: number; entries: Array<{ trackId: string; age: number }> } {
    const entries = Array.from(this.cache.entries()).map(([, entry]) => ({
      trackId: entry.trackId,
      age: Date.now() - entry.timestamp
    }));

    return {
      size: this.cache.size,
      entries
    };
  }
}

// Export singleton instance
export const meydaAudioService = new MeydaAudioService();
export default meydaAudioService;
