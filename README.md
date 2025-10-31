# Heart Music Player

[![Next.js](https://img.shields.io/badge/Next.js-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com)

A modern, elegant music player web application built with Next.js. Features a stunning audio-reactive heart animation, Spotify integration, real-time audio visualization, and **live synchronized lyrics** that appear like in music videos.

## ✨ Features

### 🎵 Music Playback
- **Spotify Integration**: Full Spotify Web Player support with playlist management
- **Local Audio Support**: Play local MP3 files with Web Audio API analysis
- **Advanced Controls**: Play/Pause, Next/Previous, Seek, Volume control
- **Playlist Management**: Browse and play your Spotify playlists
- **Track Information**: Display album art, artist, and track details

### 🎤 Live Lyrics (NEW!)
- **Synchronized Lyrics**: Real-time lyrics that sync with playback position
- **Music Video Style**: Lyrics appear one line at a time with smooth animations
- **Beautiful Presentation**: White text with shadows, positioned beneath the heart
- **FREE API Integration**: Uses Genius API with web scraping (completely free!)
- **Smart Timing**: Automatic lyric timing estimation
- **Preview Lines**: Shows upcoming lyric line subtly
- **Robust Scraping**: Multiple selector fallbacks for reliability

### 💖 Audio Visualization
- **Particle Heart Animation**: Real-time particle system forming a beating heart
- **Audio Reactive**: Responds to bass, mids, treble, and beats
- **Spotify Mode**: Uses Meyda audio analysis for Spotify tracks
- **Local Mode**: Direct Web Audio API frequency analysis for local files
- **Smooth Animations**: Optimized 60 FPS canvas rendering

### 🎨 Beautiful UI/UX
- **Modern Design**: Clean, dark theme with smooth transitions
- **Responsive Layout**: Works on desktop and mobile
- **Hover Effects**: Interactive feedback throughout
- **Status Indicators**: Visual feedback for audio analysis mode
- **Loading States**: Smooth loading and error handling
  
### 🔧 Technical Features
- **Next.js 15**: Latest React framework with App Router
- **TypeScript**: Full type safety throughout
- **Context API**: Clean state management with React Context
- **Meyda Integration**: Advanced audio feature extraction
- **API Routes**: Server-side lyrics fetching and caching
- **Performance Optimized**: Efficient rendering and caching strategies

## Getting Started

### 1. Clone and Install

```bash
git clone https://github.com/XLRA/heart.git
cd heart
npm install
```

### 2. Configure Environment Variables

Create a `.env.local` file in the root directory:

```bash
# Spotify API (Required for Spotify features)
NEXT_PUBLIC_SPOTIFY_CLIENT_ID=your_spotify_client_id
NEXT_PUBLIC_SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
NEXT_PUBLIC_SPOTIFY_REDIRECT_URI=http://localhost:3000/callback

# Lyrics API (Optional - for live lyrics feature)
# Genius API - FREE! (Recommended)
GENIUS_ACCESS_TOKEN=your_genius_access_token

# OR Musixmatch API (Requires paid subscription)
MUSIXMATCH_API_KEY=your_musixmatch_api_key
```

**Note**: The app works without lyrics API keys (demo mode), but you'll need Spotify credentials for full functionality.

See [SPOTIFY_SETUP.md](./SPOTIFY_SETUP.md) for Spotify setup instructions.
See [LYRICS_SETUP.md](./LYRICS_SETUP.md) for lyrics API setup instructions.

### 3. Start Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## 📁 Project Structure

```
heart/
├── src/
│   ├── app/
│   │   ├── components/
│   │   │   ├── AdvancedMusicPlayer.tsx   # Main player UI
│   │   │   ├── HeartAnimation.tsx         # Audio-reactive particle animation
│   │   │   ├── LiveLyrics.tsx             # 🆕 Synchronized lyrics display
│   │   │   ├── PlaylistSelector.tsx       # Spotify playlist browser
│   │   │   ├── PlaylistSongList.tsx       # Playlist track list
│   │   │   └── SpotifyLogin.tsx           # Authentication UI
│   │   ├── context/
│   │   │   ├── AudioVisualizerContext.tsx # Audio state management
│   │   │   ├── SpotifyContext.tsx         # Spotify auth & API
│   │   │   └── WebPlayerContext.tsx       # Spotify Web Player SDK
│   │   ├── api/
│   │   │   ├── lyrics/
│   │   │   │   └── route.ts               # 🆕 Lyrics API endpoint
│   │   │   └── spotify/
│   │   │       └── token/
│   │   │           └── route.ts           # Spotify OAuth callback
│   │   ├── page.tsx                       # Main app page
│   │   ├── layout.tsx                     # Root layout
│   │   └── globals.css                    # Global styles
│   ├── services/
│   │   └── meyda.ts                       # Audio analysis service
│   └── types/
│       └── spotify.d.ts                   # TypeScript definitions
├── public/
│   ├── music/                             # Local audio files
│   └── covers/                            # Album artwork
├── LYRICS_SETUP.md                        # 🆕 Lyrics API setup guide
├── LYRICS_IMPLEMENTATION.md               # 🆕 Implementation details
└── README.md                              # This file
```

## 🎯 Key Components

### LiveLyrics Component (NEW!)
- Fetches lyrics from API when track changes
- Syncs with playback position in real-time
- Beautiful animations and transitions
- Shows current line prominently, next line as preview
- Handles loading and error states gracefully

### HeartAnimation Component
- Canvas-based particle system
- Audio-reactive beats and frequency response
- Supports both Spotify and local audio
- 60 FPS optimized rendering

### AdvancedMusicPlayer Component
- Full playback controls
- Spotify Web Player integration
- Local audio file support
- Volume control and seeking
- Playlist management

### Audio Analysis Pipeline
```
Audio Source (Spotify/Local)
    ↓
Meyda/Web Audio API Analysis
    ↓
AudioVisualizerContext (shared state)
    ↓
HeartAnimation (visual feedback)
```

### Lyrics Pipeline (NEW!)
```
Current Track Info
    ↓
LiveLyrics Component
    ↓
/api/lyrics endpoint
    ↓
Musixmatch/Genius API
    ↓
Timestamped Lyrics
    ↓
Synchronized Display
```

## 🎮 How to Use

### Playing Music

1. **Connect to Spotify**: Click the "Connect Spotify" button in the top-right
2. **Select a Playlist**: Click the Spotify icon in the player to browse your playlists
3. **Play a Song**: Click any track to start playback
4. **Enjoy**: Watch the heart animation react to the music and lyrics appear in sync!

### Local Audio Files

1. Add MP3 files to `/public/music/`
2. Add cover images to `/public/covers/`
3. Update the `defaultSongs` array in `AdvancedMusicPlayer.tsx`
4. Play directly without Spotify authentication

### Lyrics Feature

- **Automatic**: Lyrics appear automatically when playing Spotify tracks
- **Demo Mode**: Works immediately without API keys (shows placeholder text)
- **Full Mode**: Configure API keys for real lyrics (see [LYRICS_SETUP.md](./LYRICS_SETUP.md))
- **Customization**: Adjust position, styling, and timing in `LiveLyrics.tsx`

## 🔧 Configuration

### Environment Variables

Required:
- `NEXT_PUBLIC_SPOTIFY_CLIENT_ID` - Your Spotify app client ID
- `NEXT_PUBLIC_SPOTIFY_CLIENT_SECRET` - Your Spotify app client secret
- `NEXT_PUBLIC_SPOTIFY_REDIRECT_URI` - OAuth callback URL

Optional (for lyrics):
- `GENIUS_ACCESS_TOKEN` - Genius API client access token (FREE - recommended!)
- `MUSIXMATCH_API_KEY` - Musixmatch API key (paid subscription required)

### Customization Options

**Lyrics Position**
```typescript
// src/app/components/LiveLyrics.tsx
top: '55%',  // Adjust vertical position
```

**Lyrics Style**
```typescript
// Current line
fontSize: '32px',
color: '#ffffff',

// Next line preview
fontSize: '20px',
color: 'rgba(255, 255, 255, 0.4)',
```

**Animation Duration**
```css
animation: 'lyricsSlideIn 0.4s ease-out',  // Adjust timing
```

## 📚 Documentation

- [LYRICS_SETUP.md](./LYRICS_SETUP.md) - Complete guide to setting up lyrics APIs
- [LYRICS_IMPLEMENTATION.md](./LYRICS_IMPLEMENTATION.md) - Technical implementation details
- [SPOTIFY_SETUP.md](./SPOTIFY_SETUP.md) - Spotify API setup instructions
- [MEYDA_INTEGRATION.md](./MEYDA_INTEGRATION.md) - Audio analysis documentation

## 🚀 Deployment

This project is deployed at [sleeep.dev](https://sleeep.dev) using Vercel.

### Deploy Your Own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/XLRA/heart)

**Important**: Set environment variables in your Vercel project settings before deploying.

## 🐛 Troubleshooting

### Lyrics Not Showing
- Check console for API errors
- Verify API keys in `.env.local`
- Restart dev server after adding environment variables
- Check [LYRICS_SETUP.md](./LYRICS_SETUP.md) for detailed troubleshooting

### Heart Animation Not Reacting
- Ensure music is playing
- Check browser console for Web Audio API errors
- Try toggling between local and Spotify playback

### Spotify Login Issues
- Verify redirect URI matches exactly
- Check Spotify app settings
- Clear browser cache and cookies
- See [SPOTIFY_SETUP.md](./SPOTIFY_SETUP.md)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Areas for Contribution
- LRC format support for precise lyric timing
- Additional lyrics API integrations
- Mobile responsive improvements
- Visualization enhancements
- Performance optimizations

## 📝 License

This project is open source and available under the MIT License.

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) - React framework
- [Spotify Web API](https://developer.spotify.com/) - Music streaming
- [Meyda](https://meyda.js.org/) - Audio feature extraction
- [Genius API](https://docs.genius.com/) - FREE lyrics data (primary source)
- [Cheerio](https://cheerio.js.org/) - HTML parsing for lyrics scraping
- [Musixmatch API](https://developer.musixmatch.com/) - Alternative lyrics source

---

Built with ❤️ and lots of ☕
