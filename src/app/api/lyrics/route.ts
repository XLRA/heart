import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

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
 * Scrape lyrics from Genius
 * Genius API provides search but lyrics must be scraped from the webpage
 */
async function fetchFromGenius(track: string, artist: string): Promise<LyricsResponse | null> {
  const GENIUS_ACCESS_TOKEN = process.env.GENIUS_ACCESS_TOKEN;
  
  if (!GENIUS_ACCESS_TOKEN) {
    console.warn('GENIUS_ACCESS_TOKEN not configured, skipping Genius API');
    return null;
  }

  console.log(`[Genius] Attempting to fetch lyrics for: "${track}" by "${artist}"`);

  try {
    // Step 1: Search for the song using Genius API
    const searchUrl = `https://api.genius.com/search?q=${encodeURIComponent(track + ' ' + artist)}`;
    console.log(`[Genius] Search URL: ${searchUrl}`);
    
    const searchResponse = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${GENIUS_ACCESS_TOKEN}`
      }
    });

    console.log(`[Genius] Search response status: ${searchResponse.status}`);

    if (!searchResponse.ok) {
      console.error(`[Genius] Search failed with status ${searchResponse.status}`);
      const errorText = await searchResponse.text();
      console.error(`[Genius] Error response: ${errorText}`);
      return null;
    }

    const searchData = await searchResponse.json();
    console.log(`[Genius] Search returned ${searchData.response?.hits?.length || 0} results`);
    
    if (!searchData.response?.hits || searchData.response.hits.length === 0) {
      console.log('No results found on Genius');
      return null;
    }

    // Get the best match (first result)
    const songUrl = searchData.response.hits[0].result.url;
    const songTitle = searchData.response.hits[0].result.title;
    
    console.log(`[Genius] Found song: ${songTitle} - ${songUrl}`);
    
    // Step 2: Scrape lyrics from the song page
    console.log(`[Genius] Fetching page: ${songUrl}`);
    const pageResponse = await fetch(songUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    console.log(`[Genius] Page response status: ${pageResponse.status}`);

    if (!pageResponse.ok) {
      console.error(`[Genius] Failed to fetch page: ${pageResponse.status}`);
      return null;
    }

    const html = await pageResponse.text();
    console.log(`[Genius] Received HTML, length: ${html.length} characters`);
    
    // Step 3: Parse HTML and extract lyrics
    const $ = cheerio.load(html);
    
    // Genius uses multiple possible selectors for lyrics
    let lyricsText = '';
    
    // Try different selectors (Genius changes their structure sometimes)
    const selectors = [
      '[data-lyrics-container="true"]',
      '[class*="Lyrics__Container"]',
      '.lyrics',
      '[class*="lyrics"]'
    ];
    
    console.log(`[Genius] Trying ${selectors.length} different CSS selectors...`);
    
    for (const selector of selectors) {
      const elements = $(selector);
      console.log(`[Genius] Selector "${selector}" found ${elements.length} elements`);
      
      if (elements.length > 0) {
        // Concatenate all matching elements (lyrics are sometimes split across multiple divs)
        elements.each((_, element) => {
          // Get text and preserve line breaks
          const text = $(element).html();
          if (text) {
            // Replace <br> tags with newlines and clean up HTML
            const cleaned = text
              .replace(/<br\s*\/?>/gi, '\n')
              .replace(/<\/div>/gi, '\n')
              .replace(/<[^>]+>/g, '') // Remove remaining HTML tags
              .replace(/\[.*?\]/g, '') // Remove [Verse], [Chorus] etc
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#039;/g, "'");
            
            lyricsText += cleaned + '\n';
          }
        });
        
        if (lyricsText.trim()) {
          console.log(`[Genius] Successfully extracted lyrics using selector: ${selector}`);
          console.log(`[Genius] Lyrics length: ${lyricsText.length} characters`);
          break; // Found lyrics, stop trying other selectors
        }
      }
    }
    
    if (!lyricsText.trim()) {
      console.error('[Genius] Could not extract lyrics from page - none of the selectors matched');
      console.error('[Genius] Page might have a new structure. First 500 chars of HTML:', html.substring(0, 500));
      return null;
    }
    
    // Step 4: Parse and return lyrics with timing
    const lines = parsePlainLyrics(lyricsText);
    
    if (lines.length === 0) {
      console.error('No lyrics lines parsed');
      return null;
    }
    
    console.log(`Successfully scraped ${lines.length} lines from Genius`);
    
    return {
      lyrics: lines,
      source: 'genius'
    };
    
  } catch (error) {
    console.error('[Genius] Error fetching lyrics:', error);
    if (error instanceof Error) {
      console.error('[Genius] Error message:', error.message);
      console.error('[Genius] Error stack:', error.stack);
    }
    return null;
  }
}

/**
 * Fetch lyrics from Musixmatch API (requires API key)
 */
async function fetchFromMusixmatch(track: string, artist: string): Promise<LyricsResponse | null> {
  const MUSIXMATCH_API_KEY = process.env.MUSIXMATCH_API_KEY;
  
  if (!MUSIXMATCH_API_KEY) {
    console.warn('MUSIXMATCH_API_KEY not configured, skipping Musixmatch API');
    return null;
  }

  try {
    // Search for the track
    const searchUrl = `https://api.musixmatch.com/ws/1.1/matcher.lyrics.get?q_track=${encodeURIComponent(track)}&q_artist=${encodeURIComponent(artist)}&apikey=${MUSIXMATCH_API_KEY}`;
    
    const response = await fetch(searchUrl);
    
    if (!response.ok) {
      console.error('Musixmatch API failed:', response.status);
      return null;
    }

    const data = await response.json();
    
    if (data.message?.header?.status_code === 200 && data.message?.body?.lyrics?.lyrics_body) {
      const lyricsText = data.message.body.lyrics.lyrics_body;
      const lines = parsePlainLyrics(lyricsText);
      
      return {
        lyrics: lines,
        source: 'musixmatch'
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching from Musixmatch:', error);
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
    'Lyrics streaming coming soon...',
    '',
    'Configure GENIUS_ACCESS_TOKEN or MUSIXMATCH_API_KEY',
    'in your .env.local file to enable real lyrics'
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

  // Try to fetch from various sources
  let result: LyricsResponse | null = null;

  console.log(`[API] Fetching lyrics for: "${track}" by "${artist}"`);

  // Try Genius (web scraping with free API token)
  result = await fetchFromGenius(track, artist);
  
  if (result) {
    console.log(`[API] Successfully fetched lyrics from Genius (${result.lyrics.length} lines)`);
  } else {
    console.log('[API] Genius fetch failed, trying Musixmatch...');
    // Try Musixmatch if Genius failed (requires paid API key)
    result = await fetchFromMusixmatch(track, artist);
    
    if (result) {
      console.log(`[API] Successfully fetched lyrics from Musixmatch (${result.lyrics.length} lines)`);
    }
  }

  // Fallback to demo lyrics if all sources failed
  if (!result) {
    console.log('[API] All sources failed, using demo lyrics for:', track);
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

