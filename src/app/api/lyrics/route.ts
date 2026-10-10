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
 * LRCLIB (lrclib.net): free, keyless, community-synced lyrics. Used when the
 * Spotify-backed API is down (its SP_DC cookie expires periodically, which
 * silently turned every track into demo lyrics). Matched by artist + title +
 * duration (+-2 s, per LRCLIB's own matching rule).
 */
function parseLrc(lrc: string): LyricsLine[] {
  const lines: LyricsLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (stamps.length === 0) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) {
      lines.push({ text, startTime: Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000), endTime: 0 });
    }
  }
  lines.sort((a, b) => a.startTime - b.startTime);
  // Empty LRC lines mark instrumental gaps; they end the previous line.
  for (let i = 0; i < lines.length - 1; i++) lines[i].endTime = lines[i + 1].startTime;
  return lines.filter((l) => l.text.length > 0);
}

async function fetchFromLrclib(track: string, artist: string, durationMs?: number): Promise<LyricsResponse | null> {
  const headers = { 'user-agent': 'heart-music-player/1.0 (+https://sleeep.dev)' };
  const primaryArtist = artist.split(/,| feat\.? | & /i)[0].trim();
  const title = track.replace(/\s*[(\[].*?[)\]]\s*/g, ' ').replace(/\s-\s.*$/, '').trim() || track;
  try {
    const params = new URLSearchParams({ artist_name: primaryArtist, track_name: title });
    if (durationMs) params.set('duration', String(Math.round(durationMs / 1000)));
    let res = await fetch(`https://lrclib.net/api/get?${params}`, { headers, signal: AbortSignal.timeout(6000) });
    let data: { syncedLyrics?: string | null; plainLyrics?: string | null } | null = res.ok ? await res.json() : null;
    if (!data?.syncedLyrics) {
      // Fuzzy fallback: search and take the closest-duration synced match.
      res = await fetch(`https://lrclib.net/api/search?${new URLSearchParams({ artist_name: primaryArtist, track_name: title })}`, { headers, signal: AbortSignal.timeout(6000) });
      const list: Array<{ syncedLyrics?: string | null; duration?: number }> = res.ok ? await res.json() : [];
      const synced = list.filter((r) => r.syncedLyrics);
      if (durationMs) synced.sort((a, b) => Math.abs((a.duration || 0) * 1000 - durationMs) - Math.abs((b.duration || 0) * 1000 - durationMs));
      const pick = synced[0];
      if (pick && (!durationMs || Math.abs((pick.duration || 0) * 1000 - durationMs) < 4000)) data = pick;
    }
    if (!data?.syncedLyrics) return null;
    const lyrics = parseLrc(data.syncedLyrics);
    return lyrics.length > 0 ? { lyrics, source: 'LRCLIB (time-synced)' } : null;
  } catch (error) {
    console.error('[LRCLIB] Error fetching lyrics:', error);
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
  const durationMs = Number(searchParams.get('durationMs')) || undefined;

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
  result = await fetchFromCustomAPI(encodeURIComponent(trackId));
  if (!result && track && artist) {
    console.log('[API] Custom API unavailable, trying LRCLIB...');
    result = await fetchFromLrclib(track, artist, durationMs);
  }
  
  if (result) {
    console.log(`[API] ✅ Successfully fetched lyrics (${result.lyrics.length} lines, source: ${result.source})`);
    // Only cache real lyrics. Caching the demo fallback used to pin a track
    // to "no lyrics" for an hour even when the upstream API only had a
    // transient hiccup.
    lyricsCache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });
  } else {
    console.log('[API] ❌ No lyrics source succeeded, using demo lyrics (not cached)');
    result = generateDemoLyrics(track || 'Unknown Track', artist || 'Unknown Artist');
  }

  console.log(`[API] Returning lyrics: source="${result.source}", lines=${result.lyrics.length}`);

  return NextResponse.json(result);
}


