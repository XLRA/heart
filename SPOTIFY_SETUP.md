# Spotify Integration Setup

## 1. Create a Spotify App

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in
2. Click **Create app** and fill in:
   - App name: anything (e.g. "Heart Music Player")
   - Website: `http://localhost:3000` (for development)
   - Redirect URI: `http://localhost:3000/music/callback` (note the `/music` prefix)
   - APIs used: **Web API** and **Web Playback SDK**
3. Save

## 2. Credentials and Environment Variables

From the app's settings, copy the **Client ID** and **Client Secret**, then create `.env.local` in the project root:

```bash
NEXT_PUBLIC_SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
NEXT_PUBLIC_SPOTIFY_REDIRECT_URI=http://localhost:3000/music/callback
```

The secret is **server-only**: it's used by `/api/spotify/token` (code → token exchange) and `/api/spotify/refresh` (token refresh). Never prefix it with `NEXT_PUBLIC_`.

While the app is in Development Mode, add each Spotify account that should be able to log in under **User Management** in the dashboard.

## 3. Run

```bash
npm install
npm run dev
```

Open <http://localhost:3000/music>, click **Connect Spotify**, then pick a playlist from the Spotify icon in the player.

## Notes

- In-browser playback uses the Web Playback SDK, which requires **Spotify Premium** and a browser with Widevine DRM enabled (Chrome: `chrome://settings/content/protectedContent`). The playlist picker explains which of these is missing if the player can't start.
- The heart's reactivity doesn't need any extra Spotify permissions: it works from public preview clips, ReccoBeats, and AcousticBrainz (see the README). If your app was created before November 2024 and still has access to the legacy `/audio-analysis` endpoint, it's used automatically for even better timing.
- For production, add your deployed callback (e.g. `https://sleeep.dev/music/callback`) as a redirect URI and set `NEXT_PUBLIC_SPOTIFY_REDIRECT_URI` accordingly.
