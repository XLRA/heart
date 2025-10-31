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

### 🎤 Live Lyrics
- **Synchronized Lyrics**: Real-time lyrics that sync with playback position
- **Music Video Style**: Lyrics appear one line at a time with smooth animations
- **Beautiful Presentation**: White text with shadows, positioned beneath the heart
- **FREE - No API Key**: Uses Lyrics.ovh API (completely free, no setup required!)
- **Smart Timing**: Automatic lyric timing estimation
- **Preview Lines**: Shows upcoming lyric line subtly
- **Plug & Play**: Works immediately without any configuration

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
```

**Note**: Lyrics work automatically with no API keys required! Just configure Spotify credentials for full functionality.

See [SPOTIFY_SETUP.md](./SPOTIFY_SETUP.md) for Spotify setup instructions.

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
└── README.md                              # This file
```

## 🎯 Key Components

### LiveLyrics Component
- Automatically fetches lyrics from Lyrics.ovh API when track changes
- Syncs with playback position in real-time
- Beautiful animations and transitions
- Shows current line prominently, next line as preview
- Works immediately - no configuration needed!

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

### Lyrics Pipeline
```
Current Track Info (with Spotify Track ID)
    ↓
LiveLyrics Component
    ↓
/api/lyrics endpoint
    ↓
Lyricstify API (TIME-SYNCED!)
    ↓
Precise Timestamped Lyrics
    ↓
Synchronized Display
```

**Lyrics Source:**
- **Lyricstify**: Time-synced lyrics with exact timestamps from Spotify
- Completely FREE and requires no API keys!
- Falls back to demo lyrics if time-synced lyrics aren't available

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

- **Automatic**: Lyrics appear automatically when playing any Spotify track
- **No Setup Required**: Works immediately with Lyrics.ovh API (free!)
- **Always Available**: No API keys, no configuration needed
- **Customization**: Adjust position, styling, and timing in `LiveLyrics.tsx`

## 🔧 Configuration

### Environment Variables

Required:
- `NEXT_PUBLIC_SPOTIFY_CLIENT_ID` - Your Spotify app client ID
- `NEXT_PUBLIC_SPOTIFY_CLIENT_SECRET` - Your Spotify app client secret
- `NEXT_PUBLIC_SPOTIFY_REDIRECT_URI` - OAuth callback URL

**Note**: Lyrics require no environment variables - they work automatically!

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

- [SPOTIFY_SETUP.md](./SPOTIFY_SETUP.md) - Spotify API setup instructions
- [REAUTHENTICATE_SPOTIFY.md](./REAUTHENTICATE_SPOTIFY.md) - Spotify reauth guide
- [MEYDA_INTEGRATION.md](./MEYDA_INTEGRATION.md) - Audio analysis documentation

## 🚀 Deployment

This project is deployed at [sleeep.dev](https://sleeep.dev) using Vercel.

### Deploy Your Own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/XLRA/heart)

**Important**: Set environment variables in your Vercel project settings before deploying.

## 🐛 Troubleshooting

### Lyrics Not Showing
- Check browser console for lyrics fetch logs
- **Time-synced lyrics** powered by Lyricstify (requires Spotify track ID)
- Available for most popular Spotify tracks
- Try a different song if lyrics aren't found
- Demo lyrics will show if time-synced lyrics are unavailable

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
- Additional visualization patterns
- Mobile responsive improvements
- Playlist management enhancements
- Performance optimizations
- Additional lyrics API sources

## 📝 License

This project is open source and available under the MIT License.

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) - React framework
- [Spotify Web API](https://developer.spotify.com/) - Music streaming
- [Meyda](https://meyda.js.org/) - Audio feature extraction
- [Lyricstify](https://github.com/akashrchandran/spotify-lyrics-api) - Time-synced Spotify lyrics

---

Built with ❤️ and lots of ☕
