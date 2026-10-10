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

### Audio-Reactive Heart — Track Intelligence
Spotify's Web Playback SDK audio is DRM-protected: the page can never *hear* what Spotify plays. So instead of listening, the heart **knows the song** — with zero setup:

1. **Real audio of the exact track.** `/api/track-intel` finds Spotify's own 30 s preview of the same master (from the public embed page; Deezer / iTunes as fallbacks) plus tempo/energy from ReccoBeats. The browser decodes the clip and analyzes it in a Web Worker (`src/services/trackIntel/analysis.ts`): tempo, a dynamic-programming beat track and grid fit, kick/snare onsets (band-energy rise detectors), and the same envelopes the live analyzer produces.
2. **The whole song's beat map.** `/api/track-intel/beatmap` looks the track up (ISRC → MusicBrainz → AcousticBrainz) and returns every beat position in the song, including live-band tempo drift. If your Spotify app still has the legacy `/audio-analysis` endpoint, its beats, bars and sections are used instead.
3. **A predictive engine** (`engine.ts`) plays the clip's groove — a consensus kick/snare template per 16th-note slot — along the song's beat clock, driven by a high-resolution playback clock. Because it reads *ahead*, there's no detection latency, and the heart genuinely anticipates each hit.
4. **One-tap sync for anything else.** Songs without a beat map (mostly 2022+) start with the correct tempo and groove but an unknown beat phase. **Sync with microphone** (settings) listens for a few seconds and locks phase *and* downbeat with a matched filter against the known groove — it also measures your speaker latency. Or press **`T` on the beat** four times. Locks are remembered per track.

Local files get a full-song analysis (exact). Optional **live tab capture** (Chrome/Edge) remains under *advanced*. The indicator dot shows the source: green = exact/beat-mapped/synced, amber = tempo + groove locked, cyan = live capture.

- **Particle heart animation** that pumps core-to-rim on kicks, flares on snares, accents bar downbeats, and lifts on section changes
- **Real-time analyzer** (`src/services/audioAnalyzer.ts`) for live capture: band-energy-rise drum detection with mean+std thresholds, tempo locking with beat prediction, spectral centroid/flatness, and AGC
- **Album-art theming**: dominant colors are extracted from the current album cover and tint the visuals

### Live Lyrics
- **Time-synced lyrics** displayed one line at a time like a music video
- **No API key needed** — fetched server-side through `/api/lyrics`: a custom Spotify lyrics API first, then [LRCLIB](https://lrclib.net) (matched by artist, title and duration), with in-memory caching
- **Two display modes**: centered or alternating, switchable in settings

### Settings & Clean Mode
- **Settings panel**: reactivity status + mic sync / auto-sync + timing nudge, particle density (low/medium/high), lyrics mode, and live tab capture
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
│   │   │   ├── ReactivityContext.tsx       # Track Intelligence ↔ heart, mic/tap sync
│   │   │   └── SettingsContext.tsx         # User settings
│   │   ├── music/
│   │   │   ├── page.tsx                    # Music player page
│   │   │   └── callback/                   # Spotify OAuth callback
│   │   └── api/
│   │       ├── lyrics/route.ts             # Time-synced lyrics proxy + cache
│   │       ├── track-intel/route.ts        # Preview clip + audio features
│   │       ├── track-intel/beatmap/        # Whole-song beat map (AcousticBrainz)
│   │       └── spotify/
│   │           ├── token/route.ts          # OAuth code → token exchange
│   │           └── refresh/route.ts        # Token refresh
│   ├── services/
│   │   ├── trackIntel/                     # Track Intelligence
│   │   │   ├── analysis.ts                 #   Offline groove analysis (tempo, beats, drums, envelopes)
│   │   │   ├── engine.ts                   #   Predictive per-frame engine + beat clocks
│   │   │   ├── sync.ts                     #   Mic matched-filter + tap phase sync
│   │   │   ├── micCapture.ts               #   AudioWorklet mic capture
│   │   │   ├── client.ts                   #   Loading pipeline, worker, caches
│   │   │   └── server.ts                   #   Upstream lookups (server-only)
│   │   ├── audioAnalyzer.ts                # Real-time audio feature extraction
│   │   ├── audioGraph.ts                   # Shared Web Audio graph for <audio>
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
3. The heart locks onto the song by itself within a couple of seconds (watch the dot turn green or amber)
4. **Optional**: if the dot is amber, press `T` on the beat 4 times — or open settings → **Sync with microphone** (and tick auto-sync to do it for every new track)
5. **Press `H`** for clean mode — just the heart and lyrics

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

## 🚀 Deployment

Deployed at [sleeep.dev](https://sleeep.dev) via Vercel.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/XLRA/heart)

Set the environment variables above in your Vercel project settings before deploying (and update the redirect URI to your production domain).

## 🐛 Troubleshooting

### Lyrics Not Showing
- Check the server log for `[API]` / `[Custom API]` / `[LRCLIB]` lines
- The custom Spotify lyrics API depends on an `SP_DC` cookie that expires; when it does, LRCLIB takes over automatically
- Demo lyrics appear only when neither source has the track

### Heart Off the Beat (Spotify)
- **Amber dot**: tempo and groove are right but the beat phase is a guess (common for 2022+ songs with no public beat map) — press `T` on the beat 4 times or use **Sync with microphone**
- **Consistently early/late**: drag the **Timing nudge** slider (Bluetooth headphones add 150–250 ms)
- **Hits on the wrong beats of the bar** (kick/snare swapped): mic sync also locks the downbeat
- **Grey "No analysis for this track"**: no preview clip and no tempo metadata exist; live tab capture still works

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
- [spotify-lyrics-api](https://github.com/akashrchandran/spotify-lyrics-api) and [LRCLIB](https://lrclib.net) — time-synced lyrics
- [ReccoBeats](https://reccobeats.com), [MusicBrainz](https://musicbrainz.org) and [AcousticBrainz](https://acousticbrainz.org) — audio features and whole-song beat maps
- Deezer and iTunes Search — fallback preview clips
- [ColorThief](https://lokeshdhakar.com/projects/color-thief/) — album-art color extraction

---

Built with ❤️ and lots of ☕
