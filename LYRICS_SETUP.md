# Live Lyrics Feature Setup Guide

## Overview

The live lyrics feature displays synchronized lyrics beneath the heart animation, appearing one line at a time like in music videos. The lyrics automatically sync with the current playback position.

## Features

- **Real-time synchronization**: Lyrics appear in sync with the music
- **Smooth animations**: Lines fade in/out smoothly with slide-in effects
- **Beautiful styling**: White text with shadows for visibility over the heart animation
- **Multiple API support**: Works with Genius API, Musixmatch API, or demo mode

## Setup Instructions

### Option 1: Genius API (Recommended - FREE!)

Genius provides a **completely free API** with web scraping for full lyrics. This is now fully implemented and working!

1. **Create a Genius API Client**
   - Visit: https://genius.com/api-clients
   - Click "New API Client"
   - Fill in the form:
     - **App Name**: `Heart Music Player` (or your choice)
     - **App Website URL**: `https://sleeep.dev` (or your domain)
     - **Redirect URI**: `https://sleeep.dev/callback` (not used, but required)
   - Submit the form

2. **Get your Client Access Token**
   - After creating the client, you'll see your credentials
   - **Copy the "Client Access Token"** (this is what you need!)
   - You don't need the Client ID or Client Secret

3. **Add to your `.env.local` file**
   ```bash
   GENIUS_ACCESS_TOKEN=your_client_access_token_here
   ```

4. **Restart your dev server**
   ```bash
   npm run dev
   ```

That's it! Lyrics will now be fetched and displayed automatically.

### Option 2: Musixmatch API

Musixmatch requires a paid subscription (no free tier available).

1. **Sign up for Musixmatch API** (Paid)
   - Visit: https://developer.musixmatch.com
   - Choose a paid plan
   - Get your API key from the dashboard

2. **Add to your `.env.local` file**
   ```bash
   MUSIXMATCH_API_KEY=your_musixmatch_api_key
   ```

### Option 3: Demo Mode (No API Key Required)

If you don't configure any API keys, the app will automatically use demo/placeholder lyrics to demonstrate the feature. This is perfect for testing the UI without API setup.

## Configuration

Create or update your `.env.local` file in the project root:

```bash
# Spotify API Configuration (Required for Spotify features)
NEXT_PUBLIC_SPOTIFY_CLIENT_ID=your_spotify_client_id
NEXT_PUBLIC_SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
NEXT_PUBLIC_SPOTIFY_REDIRECT_URI=http://localhost:3000/callback

# Lyrics API Configuration (Optional - for live lyrics)
# Genius API (FREE - Recommended!)
GENIUS_ACCESS_TOKEN=your_genius_client_access_token

# OR Musixmatch (Paid subscription required)
MUSIXMATCH_API_KEY=your_musixmatch_api_key
```

## How It Works

### Architecture

1. **LiveLyrics Component** (`src/app/components/LiveLyrics.tsx`)
   - Displays lyrics in real-time
   - Syncs with current playback position
   - Handles animations and styling

2. **Lyrics API Endpoint** (`src/app/api/lyrics/route.ts`)
   - **Genius Integration** (Primary - FREE):
     1. Uses Genius API to search for the song
     2. Gets the Genius webpage URL for the song
     3. Scrapes the lyrics from the webpage using Cheerio
     4. Parses HTML and extracts clean lyrics text
     5. Removes section markers ([Verse], [Chorus], etc.)
     6. Estimates timing based on track duration
   - **Musixmatch Integration** (Fallback - Paid):
     - Direct API access if configured
   - Caches results for 1 hour to improve performance
   - Falls back to demo mode if no APIs configured

3. **Integration** (`src/app/page.tsx`)
   - LiveLyrics is positioned beneath the HeartAnimation
   - Receives track info and playback position from player state
   - Updates in real-time as song plays

### Genius Web Scraping Process

```
User plays Spotify track
       ↓
LiveLyrics component detects track change
       ↓
Sends request to /api/lyrics
       ↓
API uses Genius token to search for song
       ↓
Gets Genius webpage URL
       ↓
Fetches and parses HTML with Cheerio
       ↓
Extracts lyrics from multiple possible selectors
       ↓
Cleans up HTML tags and formatting
       ↓
Estimates line timing (distributes evenly across song duration)
       ↓
Returns timestamped lyrics array
       ↓
LiveLyrics displays current line based on playback position
```

### Lyric Timing

The API automatically estimates lyric timing by:
1. Fetching plain text lyrics from the API
2. Calculating average line duration based on track length
3. Distributing lines evenly across the song

For more accurate timing, you could integrate with services that provide timestamped lyrics (like Spotify's internal lyrics API or specialized lyrics timing services).

## Customization

### Styling

You can customize the lyrics appearance in `src/app/components/LiveLyrics.tsx`:

```typescript
// Current line (main lyrics)
fontSize: '32px',
fontWeight: '700',
color: '#ffffff',

// Next line (preview)
fontSize: '20px',
fontWeight: '500',
color: 'rgba(255, 255, 255, 0.4)',
```

### Position

Adjust the vertical position in the LiveLyrics component:

```typescript
top: '55%',  // Change this value to move lyrics up/down
```

### Animation Speed

Modify animation duration in the CSS:

```css
animation: 'lyricsSlideIn 0.4s ease-out',  // Change 0.4s to adjust speed
```

## Troubleshooting

### Lyrics Not Appearing

1. **Check API keys**: Ensure your API key is correctly set in `.env.local`
2. **Restart dev server**: After adding environment variables, restart your Next.js dev server
3. **Check console**: Look for errors in the browser console
4. **Network tab**: Check if API requests are being made and their responses

### Lyrics Out of Sync

The current implementation uses estimated timing. For perfect sync, you would need:
- Access to timestamped lyrics (LRC format)
- A lyrics API that provides timing information
- Or manual timing adjustment for each song

### API Rate Limits

- **Genius Free**: 1,000 requests/day (completely free forever!)
- **Musixmatch**: Requires paid subscription (no free tier)

The app includes 1-hour caching to minimize API calls and stay well within rate limits.

## Future Enhancements

Potential improvements for the lyrics feature:

1. **LRC Format Support**: Add support for timestamped lyrics files (.lrc format)
2. **Manual Timing Adjustment**: Allow users to adjust lyric timing
3. **Multiple Language Support**: Display lyrics in different languages
4. **Karaoke Mode**: Highlight words as they're sung
5. **User-Uploaded Lyrics**: Allow users to upload their own lyrics files
6. **Lyrics Database**: Build a local database of frequently played songs

## API Documentation

### Genius API (Recommended - FREE!)
- **API Docs**: https://docs.genius.com/
- **Create Client**: https://genius.com/api-clients
- **Pricing**: 100% FREE - 1,000 requests/day
- **What You Get**: 
  - Client Access Token (all you need!)
  - Search functionality via API
  - Full lyrics via web scraping (implemented!)
- **Implementation**: 
  - Uses `cheerio` for HTML parsing
  - Multiple selector fallbacks for reliability
  - Automatic HTML cleaning and formatting

### Musixmatch API (Paid Alternative)
- **Docs**: https://developer.musixmatch.com/documentation
- **Pricing**: https://developer.musixmatch.com/plans
- **Note**: No free tier available (requires paid subscription)

## Credits

The lyrics feature integrates with:
- **Genius API** for free lyrics data (primary source)
- **Cheerio** for HTML parsing and web scraping
- **Musixmatch API** as fallback (paid subscription required)
- **Spotify Web API** for track information

