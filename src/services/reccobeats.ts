import { ReccoBeatsAudioFeatures, ReccoBeatsTrack, ReccoBeatsAlbum, ReccoBeatsMultipleTracks, ReccoBeatsError } from '../types/reccobeats';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  trackId: string;
}

class ReccoBeatsService {
  private cache = new Map<string, CacheEntry<unknown>>();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  private readonly RATE_LIMIT_DELAY = 1000; // 1 second between requests
  private lastRequestTime = 0;
  private requestQueue: Array<() => Promise<unknown>> = [];
  private isProcessingQueue = false;

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
          console.error('Error processing ReccoBeats request:', error);
        }
      }
    }

    this.isProcessingQueue = false;
  }

  private async makeRequest<T>(endpoint: string, trackId: string): Promise<T> {
    // Check cache first
    const cacheKey = `${endpoint}_${trackId}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      console.log(`Using cached ReccoBeats data for track ${trackId}`);
      return cached.data as T;
    }

    // Add to queue for rate limiting
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          await this.rateLimit();
          
          const response = await fetch(`https://api.reccobeats.com/v1${endpoint}`, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            const errorData: ReccoBeatsError = await response.json().catch(() => ({
              error: {
                status: response.status,
                message: `HTTP ${response.status}: ${response.statusText}`
              }
            }));
            throw new Error(`ReccoBeats API error: ${errorData.error.message}`);
          }

          const data: T = await response.json();
          
          // Cache the result
          this.cache.set(cacheKey, {
            data,
            timestamp: Date.now(),
            trackId
          });

          console.log(`Fetched ReccoBeats data for track ${trackId}`);
          resolve(data);
        } catch (error) {
          reject(error);
        }
      });

      // Process queue
      this.processQueue();
    });
  }

  async getTrackAudioFeatures(trackId: string): Promise<ReccoBeatsAudioFeatures> {
    if (!trackId) {
      throw new Error('Track ID is required');
    }

    return this.makeRequest<ReccoBeatsAudioFeatures>(`/track/${trackId}/audio-features`, trackId);
  }

  async getTrackDetails(trackId: string): Promise<ReccoBeatsTrack> {
    if (!trackId) {
      throw new Error('Track ID is required');
    }

    return this.makeRequest<ReccoBeatsTrack>(`/track/${trackId}`, trackId);
  }

  async getTrackAlbum(trackId: string): Promise<ReccoBeatsAlbum> {
    if (!trackId) {
      throw new Error('Track ID is required');
    }

    return this.makeRequest<ReccoBeatsAlbum>(`/track/${trackId}/album`, trackId);
  }

  async getMultipleTracks(trackIds: string[]): Promise<ReccoBeatsMultipleTracks> {
    if (!trackIds || trackIds.length === 0) {
      throw new Error('Track IDs are required');
    }

    const idsParam = trackIds.join(',');
    return this.makeRequest<ReccoBeatsMultipleTracks>(`/tracks?ids=${idsParam}`, trackIds.join('_'));
  }

  // Clear cache for a specific track (useful when track changes)
  clearTrackCache(trackId: string): void {
    const keysToDelete: string[] = [];
    for (const [key, entry] of this.cache.entries()) {
      if (entry.trackId === trackId) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.cache.delete(key));
    console.log(`Cleared ReccoBeats cache for track ${trackId}`);
  }

  // Clear all cache
  clearAllCache(): void {
    this.cache.clear();
    console.log('Cleared all ReccoBeats cache');
  }

  // Get cache statistics
  getCacheStats(): { size: number; entries: Array<{ key: string; trackId: string; age: number }> } {
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
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
export const reccoBeatsService = new ReccoBeatsService();
export default reccoBeatsService;
