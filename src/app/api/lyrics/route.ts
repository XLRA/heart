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

// In-memory cache for lyrics (optional, helps reduce API calls)
const lyricsCache = new Map<string, { data: LyricsResponse; timestamp: number }>();
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

/**
 * Parse plain text lyrics into timed lines
 * This is a simple parser that estimates timing based on track duration
 */
function parsePlainLyrics(plainText: string, estimatedDuration: number = 180000): LyricsLine[] {
  // Split by lines and filter empty lines
  const lines = plainText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('[') && !line.startsWith('#'));

  if (lines.length === 0) {
    return [];
  }

  // Estimate timing: distribute lines evenly across the track duration
  const averageLineTime = estimatedDuration / lines.length;
  
  return lines.map((text, index) => ({
    text,
    startTime: Math.floor(index * averageLineTime),
    endTime: Math.floor((index + 1) * averageLineTime)
  }));
}


/**
 * Fetch lyrics from Lyrics.ovh API (FREE, no API key required!)
 * Primary lyrics source - simple, reliable, and free!
 */
async function fetchFromLyricsOvh(track: string, artist: string): Promise<LyricsResponse | null> {
  try {
    console.log(`[Lyrics.ovh] Attempting to fetch lyrics for: "${track}" by "${artist}"`);
    
    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(track)}`;
    console.log(`[Lyrics.ovh] API URL: ${url}`);
    
    const response = await fetch(url);
    
    console.log(`[Lyrics.ovh] Response status: ${response.status}`);
    
    if (!response.ok) {
      console.error(`[Lyrics.ovh] API failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (data.lyrics) {
      const lines = parsePlainLyrics(data.lyrics);
      console.log(`[Lyrics.ovh] ✅ Successfully fetched ${lines.length} lyrics lines`);
      
      return {
        lyrics: lines,
        source: 'lyrics.ovh'
      };
    }
    
    console.log('[Lyrics.ovh] No lyrics in response');
    return null;
  } catch (error) {
    console.error('[Lyrics.ovh] Error fetching lyrics:', error);
    return null;
  }
}


/**
 * Fallback: Generate demo/sample lyrics for testing
 * This creates a simple demo experience when APIs are not configured
 */
function generateDemoLyrics(track: string, artist: string): LyricsResponse {
  // Create a simple demo with the track name
  const demoLines = [
    `♪ ${track} ♪`,
    `by ${artist}`,
    '',
    'Lyrics not available for this song',
    '',
    'Try a different track'
  ];

  return {
    lyrics: parsePlainLyrics(demoLines.join('\n'), 30000), // 30 second demo
    source: 'demo'
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const track = searchParams.get('track');
  const artist = searchParams.get('artist');

  if (!track || !artist) {
    return NextResponse.json(
      { error: 'Missing track or artist parameter' },
      { status: 400 }
    );
  }

  // Check cache first
  const cacheKey = `${artist.toLowerCase()}-${track.toLowerCase()}`;
  const cached = lyricsCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('Returning cached lyrics for:', track);
    return NextResponse.json(cached.data);
  }

  // Fetch lyrics from Lyrics.ovh
  let result: LyricsResponse | null = null;

  console.log(`[API] Fetching lyrics for: "${track}" by "${artist}"`);

  // Use Lyrics.ovh API (completely free, no API key needed!)
  result = await fetchFromLyricsOvh(track, artist);
  
  if (result) {
    console.log(`[API] ✅ Successfully fetched lyrics from Lyrics.ovh (${result.lyrics.length} lines)`);
  } else {
    // Fallback to demo lyrics if Lyrics.ovh failed
    console.log('[API] ❌ Lyrics.ovh failed, using demo lyrics for:', track);
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

