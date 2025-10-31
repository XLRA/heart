import { NextRequest, NextResponse } from 'next/server';

interface LyricsLine {
  text: string;
  startTime: number;
  endTime: number;
}

interface LyricsResponse {
  lyrics: LyricsLine[];
  source: string;
}

// Lyricstify API response types
interface LyricstifyLine {
  startTimeMs: string;
  words: string;
  syllables?: unknown[];
  endTimeMs: string;
}

interface LyricstifyResponse {
  lyrics: {
    syncType: string;
    lines: LyricstifyLine[];
    language: string;
  };
}

// In-memory cache for lyrics (optional, helps reduce API calls)
const lyricsCache = new Map<string, { data: LyricsResponse; timestamp: number }>();
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

/**
 * Fetch time-synced lyrics from Lyricstify API
 * Returns lyrics with ACTUAL timestamps from Spotify!
 */
async function fetchFromLyricstify(trackId: string): Promise<LyricsResponse | null> {
  try {
    console.log(`[Lyricstify] Attempting to fetch synced lyrics for track ID: ${trackId}`);
    
    const url = `https://lyricstify.vercel.app/api/v1/lyrics/${trackId}`;
    console.log(`[Lyricstify] API URL: ${url}`);
    
    const response = await fetch(url);
    
    console.log(`[Lyricstify] Response status: ${response.status}`);
    
    if (!response.ok) {
      console.error(`[Lyricstify] API failed: ${response.status}`);
      return null;
    }

    const data: LyricstifyResponse = await response.json();
    
    if (data.lyrics && data.lyrics.lines && Array.isArray(data.lyrics.lines)) {
      const lines = data.lyrics.lines
        .filter(line => line.words && line.words.trim() !== '')
        .map((line) => ({
          text: line.words,
          startTime: parseInt(line.startTimeMs, 10),
          endTime: parseInt(line.endTimeMs, 10)
        }));
      
      console.log(`[Lyricstify] ✅ Successfully fetched ${lines.length} synced lyrics lines (syncType: ${data.lyrics.syncType})`);
      
      return {
        lyrics: lines,
        source: 'lyricstify (time-synced)'
      };
    }
    
    console.log('[Lyricstify] No synced lyrics in response');
    return null;
  } catch (error) {
    console.error('[Lyricstify] Error fetching lyrics:', error);
    return null;
  }
}

/**
 * Fallback: Generate demo/sample lyrics when no synced lyrics are available
 */
function generateDemoLyrics(track: string, artist: string): LyricsResponse {
  const demoLines = [
    { text: `♪ ${track} ♪`, startTime: 0, endTime: 5000 },
    { text: `by ${artist}`, startTime: 5000, endTime: 10000 },
    { text: '', startTime: 10000, endTime: 12000 },
    { text: 'Time-synced lyrics not available', startTime: 12000, endTime: 17000 },
    { text: '', startTime: 17000, endTime: 19000 },
    { text: 'Try a different track', startTime: 19000, endTime: 24000 }
  ];

  return {
    lyrics: demoLines,
    source: 'demo'
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const trackId = searchParams.get('trackId');
  const track = searchParams.get('track');
  const artist = searchParams.get('artist');
  const durationStr = searchParams.get('duration');
  const duration = durationStr ? parseInt(durationStr, 10) : 180000; // Default 3 minutes

  if (!track || !artist) {
    return NextResponse.json(
      { error: 'Missing track or artist parameter' },
      { status: 400 }
    );
  }

  console.log(`[API] Fetching lyrics for: "${track}" by "${artist}" (trackId: ${trackId || 'none'}, duration: ${(duration/1000).toFixed(1)}s)`);

  // Check cache first
  const cacheKey = `${artist.toLowerCase()}-${track.toLowerCase()}`;
  const cached = lyricsCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('Returning cached lyrics for:', track);
    return NextResponse.json(cached.data);
  }

  // Fetch lyrics from Lyricstify (time-synced)
  let result: LyricsResponse | null = null;

  // Try Lyricstify for time-synced lyrics (requires Spotify track ID)
  if (trackId) {
    console.log(`[API] 🎯 Fetching time-synced lyrics from Lyricstify...`);
    result = await fetchFromLyricstify(trackId);
    
    if (result) {
      console.log(`[API] ✅ Successfully fetched time-synced lyrics (${result.lyrics.length} lines)`);
    } else {
      console.log('[API] ❌ Lyricstify failed, using demo lyrics');
    }
  } else {
    console.log('[API] ⚠️  No track ID provided, cannot fetch time-synced lyrics');
  }

  // Fall back to demo lyrics if Lyricstify failed or no track ID
  if (!result) {
    result = generateDemoLyrics(track, artist);
  }

  // Cache the result
  lyricsCache.set(cacheKey, {
    data: result,
    timestamp: Date.now()
  });

  console.log(`[API] Returning lyrics: source="${result.source}", lines=${result.lyrics.length}`);

  return NextResponse.json(result);
}

