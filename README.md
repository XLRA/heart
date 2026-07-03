# sleep

[![Next.js](https://img.shields.io/badge/Next.js-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com)

An atmospheric music experience built with Next.js, live at [sleeep.dev](https://sleeep.dev). It has two faces:

- **`/` — Storm landing**: a cinematic canvas thunderstorm with procedural lightning, rain, thunder, and background music.
- **`/music` — Music player**: an audio-reactive particle heart with Spotify integration and live synchronized lyrics.

## ⛈️ Storm Landing (`/`)

A full-screen storm scene rendered on a single canvas with a hand-tuned intro timeline: the scene fades in from black, a stepped leader crawls down from the sky, and the primary strike hits the "sleep" wordmark — which blows out white-hot and throws off sparks.

- **Realistic lightning**: stepped leaders, return-stroke sweeps, multi-stroke flicker through the same ionized channel, plasma shimmer during decay, cloud-source glows, anchor-point explosions, and an "iris reflex" that briefly dims the scene after the brightest peaks
- **Living storm**: layered rain with wind sheets and splashes, distant background flashes with thunder swells, and ambient auto-strikes every ~20–42s so the storm never goes static
- **Interactive**: click anywhere to fire a bolt (random channel, never repeating the last two), with synchronized thunder and wordmark flicker; mouse parallax on the sky and stage layers
- **Storm audio**: Web Audio engine with a looping rain ambience, sample-based near/far thunder (pitch-shifted, distance-filtered), and a background song playlist — mixed via a hover-out mini mixer with independent rain/song volume bars persisted across reloads
- **Considerate**: honors `prefers-reduced-motion`, suspends audio and rendering when the tab is hidden, defers non-critical bolt prerenders to idle time, and ships a `?debug` FPS/metrics overlay

## 💖 Music Player (`/music`)

### Music Playback
- **Spotify Integration**: full Spotify Web Player support — connect your account, browse playlists, and control playback
- **Local Audio**: play bundled MP3s (`/public/music`) with real Web Audio analysis
- **Full Controls**: play/pause, next/previous, seek, and volume

### Audio-Reactive Heart
- **Particle heart animation** that beats and reacts to bass, mids, treble, kicks, and snares
- **Custom audio analyzer** (`src/services/audioAnalyzer.ts`): per-band envelope followers, gain-invariant beat detection with median+MAD adaptive thresholds, tempo locking with beat prediction, spectral centroid/flatness features, and AGC
- **Live tab-audio capture** (Chrome/Edge): capture the tab's audio so the heart reacts to *real* Spotify sound — otherwise Spotify playback falls back to a position-seeded simulation (the SDK's audio is DRM-protected and can't be tapped)
- **Album-art theming**: dominant colors are extracted from the current album cover and tint the visuals

### Live Lyrics
- **Time-synced lyrics** with millisecond-precise timestamps, displayed one line at a time like a music video
- **No API key needed** — fetched server-side through `/api/lyrics` from a custom Spotify lyrics API, with in-memory caching and smart timing estimation for unsynced tracks
- **Two display modes**: centered or alternating, switchable in settings

### Settings & Clean Mode
- **Settings panel**: particle density (low/medium/high), lyrics mode, and tab-audio capture toggle
- **Clean mode**: press `H` to hide all UI chrome and leave just the heart and lyrics; `Esc` (or the mouse-reveal button) brings it back

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
# Spotify API (required for Spotify features)
NEXT_PUBLIC_SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
NEXT_PUBLIC_SPOTIFY_REDIRECT_URI=http://localhost:3000/music/callback
```

The client secret is server-only (used by the token/refresh API routes) — do **not** prefix it with `NEXT_PUBLIC_`. Lyrics and the storm landing need no configuration at all.

See [SPOTIFY_SETUP.md](./SPOTIFY_SETUP.md) for Spotify app setup instructions.

### 3. Start the Dev Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the storm landing, or [http://localhost:3000/music](http://localhost:3000/music) for the player.

## 📁 Project Structure

```
heart/
├── src/
│   ├── app/
│   │   ├── page.tsx                        # Storm landing entry
│   │   ├── components/
│   │   │   ├── landing/                    # Storm scene modules
│   │   │   │   ├── StormLanding.tsx        #   Orchestrator + rAF loop
│   │   │   │   ├── generateBolt.ts         #   Procedural lightning geometry
│   │   │   │   ├── boltRender.ts           #   Bolt prerender + composite passes
│   │   │   │   ├── strikes.ts              #   Strike envelope / timing math
│   │   │   │   ├── rain.ts                 #   Rain, splashes, wind sheets
│   │   │   │   ├── bgFlash.ts              #   Distant flashes + thunder swells
│   │   │   │   ├── sparks.ts               #   Wordmark spark bursts
│   │   │   │   ├── stormAudio.ts           #   Rain/thunder/song audio engine
│   │   │   │   └── DebugOverlay.tsx        #   ?debug metrics panel
│   │   │   ├── HeartAnimation.tsx          # Audio-reactive particle heart
│   │   │   ├── AdvancedMusicPlayer.tsx     # Player shell
│   │   │   ├── player/                     # Player sub-components
│   │   │   ├── LiveLyrics.tsx              # Synchronized lyrics display
│   │   │   ├── SettingsPanel.tsx           # Settings + tab-audio capture
│   │   │   ├── PlaylistSelector.tsx        # Spotify playlist browser
│   │   │   ├── PlaylistSongList.tsx        # Playlist track list
│   │   │   └── SpotifyLogin.tsx            # Authentication UI
│   │   ├── context/
│   │   │   ├── SpotifyContext.tsx          # Spotify auth & API
│   │   │   ├── WebPlayerContext.tsx        # Spotify Web Player SDK
│   │   │   ├── AudioVisualizerContext.tsx  # Shared audio state
│   │   │   └── SettingsContext.tsx         # User settings
│   │   ├── music/
│   │   │   ├── page.tsx                    # Music player page
│   │   │   └── callback/                   # Spotify OAuth callback
│   │   └── api/
│   │       ├── lyrics/route.ts             # Time-synced lyrics proxy + cache
│   │       └── spotify/
│   │           ├── token/route.ts          # OAuth code → token exchange
│   │           └── refresh/route.ts        # Token refresh
│   ├── services/
│   │   ├── audioAnalyzer.ts                # Real-time audio feature extraction
│   │   └── colorExtractor.ts               # Album-art color extraction
│   └── types/                              # TypeScript definitions
└── public/
    ├── audio/
    │   ├── storm/                          # Rain loop + thunder samples
    │   └── songs/                          # Landing background songs
    ├── music/                              # Local player MP3s
    └── covers/                             # Local album artwork
```

## 🎮 How to Use

### Storm Landing
1. Click the speaker icon (bottom-right) to unlock audio — rain fades in and the background song starts
2. Hover the icon to open the mixer: balance rain vs. song, skip tracks
3. Click anywhere in the sky to fire a lightning strike
4. Follow the **music** link to the player

### Music Player
1. **Connect Spotify** via the button in the top-right
2. **Pick a playlist** from the Spotify icon in the player and click a track
3. **Optional**: enable tab-audio capture in settings so the heart reacts to the real Spotify audio
4. **Press `H`** for clean mode — just the heart and lyrics

### Local Audio Files
1. Drop MP3s into `/public/music/` and covers into `/public/covers/`
2. Update the default song list in `AdvancedMusicPlayer.tsx`
3. Play without any Spotify authentication

## 🔧 Configuration

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SPOTIFY_CLIENT_ID` | client | Spotify app client ID |
| `SPOTIFY_CLIENT_SECRET` | server only | Used by the token/refresh API routes |
| `NEXT_PUBLIC_SPOTIFY_REDIRECT_URI` | client | OAuth callback (default `http://localhost:3000/music/callback`) |

Landing audio assets live under `/public/audio/` — `storm/` holds the rain loop and near/far thunder samples, `songs/` holds the background playlist (see `SONG_FILES` in `stormAudio.ts`).

## 📚 Documentation

- [SPOTIFY_SETUP.md](./SPOTIFY_SETUP.md) — Spotify API setup instructions
- [REAUTHENTICATE_SPOTIFY.md](./REAUTHENTICATE_SPOTIFY.md) — Spotify reauth guide

## 🚀 Deployment

Deployed at [sleeep.dev](https://sleeep.dev) via Vercel.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/XLRA/heart)

Set the environment variables above in your Vercel project settings before deploying (and update the redirect URI to your production domain).

## 🐛 Troubleshooting

### Lyrics Not Showing
- Check the browser console for `[API]` / `[Custom API]` fetch logs
- Demo lyrics appear when a track has no lyrics on Spotify — try another track

### Heart Not Reacting to Spotify
- This is expected without capture: Spotify's SDK audio is DRM-protected, so the heart runs a simulation
- Enable **tab-audio capture** in the settings panel (Chrome/Edge) and select "Share tab audio" in the picker for real analysis

### No Storm Audio
- Browsers block autoplay — click the speaker icon once to unlock
- Check that the rain/song volume bars in the mixer aren't at zero

### Spotify Login Issues
- Verify the redirect URI matches your Spotify app settings exactly (note the `/music/callback` path)
- Clear browser cache/cookies and see [SPOTIFY_SETUP.md](./SPOTIFY_SETUP.md)

## 📝 License

This project is open source and available under the MIT License.

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) — React framework
- [Spotify Web API](https://developer.spotify.com/) — music streaming
- [spotify-lyrics-api](https://github.com/akashrchandran/spotify-lyrics-api) — time-synced lyrics
- [ColorThief](https://lokeshdhakar.com/projects/color-thief/) — album-art color extraction

---

Built with ❤️ and lots of ☕
