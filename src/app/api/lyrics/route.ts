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

// Custom Spotify Lyrics API response types
interface CustomAPILine {
  startTimeMs: string;
  words: string;
  syllables: unknown[];
  endTimeMs: string;
}

interface CustomAPIResponse {
  error: boolean;
  syncType: 'LINE_SYNCED' | 'UNSYNCED';
  lines: CustomAPILine[];
  message?: string;
}

// In-memory cache for lyrics (helps reduce API calls)
const lyricsCache = new Map<string, { data: LyricsResponse; timestamp: number }>();
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

/**
 * Fetch lyrics from custom Spotify Lyrics API (sleep-lyrics-api.vercel.app)
 * This API returns REAL time-synced lyrics from Spotify with precise timestamps!
 */
async function fetchFromCustomAPI(trackId: string): Promise<LyricsResponse | null> {
  try {
    console.log(`[Custom API] Fetching time-synced lyrics for track ID: ${trackId}`);
    
    const url = `https://sleep-lyrics-api.vercel.app/?trackid=${trackId}&format=id3`;
    console.log(`[Custom API] API URL: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });
    
    console.log(`[Custom API] Response status: ${response.status}`);
    
    if (!response.ok) {
      console.error(`[Custom API] API failed: ${response.status}`);
      return null;
    }

    const data: CustomAPIResponse = await response.json();
    
    if (data.error) {
      console.error(`[Custom API] API error: ${data.message || 'Unknown error'}`);
      return null;
    }
    
    if (data.syncType === 'LINE_SYNCED' && data.lines && data.lines.length > 0) {
      // Parse time-synced lyrics
      const lyrics = data.lines.map(line => ({
        text: line.words,
        startTime: parseInt(line.startTimeMs, 10),
        endTime: parseInt(line.endTimeMs, 10) || 0
      }));
      
      console.log(`[Custom API] ✅ Successfully fetched ${lyrics.length} time-synced lyrics lines`);
      console.log(`[Custom API] First line: "${lyrics[0].text}" at ${lyrics[0].startTime}ms`);
      
      return {
        lyrics,
        source: 'Spotify (time-synced)'
      };
    } else if (data.syncType === 'UNSYNCED' && data.lines && data.lines.length > 0) {
      // Handle unsynced lyrics - distribute evenly
      const totalLines = data.lines.length;
      const estimatedDuration = 180000; // 3 minutes default
      const lineInterval = estimatedDuration / totalLines;
      
      const lyrics = data.lines.map((line, index) => ({
        text: line.words,
        startTime: Math.floor(index * lineInterval),
        endTime: Math.floor((index + 1) * lineInterval)
      }));
      
      console.log(`[Custom API] ⚠️ Fetched ${lyrics.length} UNSYNCED lyrics lines (estimated timing)`);
      
      return {
        lyrics,
        source: 'Spotify (unsynced - estimated timing)'
      };
    }
    
    console.log('[Custom API] No lyrics in response');
    return null;
  } catch (error) {
    console.error('[Custom API] Error fetching lyrics:', error);
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

  // TrackId is required for the custom API
  if (!trackId) {
    return NextResponse.json(
      { error: 'Missing trackId parameter' },
      { status: 400 }
    );
  }

  console.log(`[API] Fetching lyrics for track ID: ${trackId}`);

  // Check cache first
  const cacheKey = trackId.toLowerCase();
  const cached = lyricsCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('[API] 💾 Returning cached lyrics for track ID:', trackId);
    return NextResponse.json(cached.data);
  }

  // Fetch lyrics from custom Spotify API
  let result: LyricsResponse | null = null;

  console.log(`[API] 📝 Fetching time-synced lyrics from custom Spotify API...`);
  result = await fetchFromCustomAPI(trackId);
  
  if (result) {
    console.log(`[API] ✅ Successfully fetched lyrics (${result.lyrics.length} lines, source: ${result.source})`);
  } else {
    console.log('[API] ❌ Custom API failed, using demo lyrics');
    result = generateDemoLyrics(track || 'Unknown Track', artist || 'Unknown Artist');
  }

  // Cache the result
  lyricsCache.set(cacheKey, {
    data: result,
    timestamp: Date.now()
  });

  console.log(`[API] Returning lyrics: source="${result.source}", lines=${result.lyrics.length}`);

  return NextResponse.json(result);
}


