# Spotify Integration Setup

This music player now supports Spotify integration! Here's how to set it up:

## 1. Create a Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Log in with your Spotify account
3. Click "Create App"
4. Fill in the app details:
   - App name: "Heart Music Player" (or any name you prefer)
   - App description: "A beautiful music player with Spotify integration"
   - Website: `http://localhost:3000` (for development)
   - Redirect URI: `http://localhost:3000/callback`
5. Click "Save"

## 2. Get Your Credentials

1. In your app dashboard, click on your app
2. Copy the "Client ID"
3. Note the "Client Secret" (you won't need it for this implementation)

## 3. Set Up Environment Variables

Create a `.env.local` file in your project root with:

```
NEXT_PUBLIC_SPOTIFY_CLIENT_ID=your_client_id_here
NEXT_PUBLIC_SPOTIFY_REDIRECT_URI=http://localhost:3000/callback
```

Replace `your_client_id_here` with your actual Client ID from step 2.

## 4. Install Dependencies

Run the following command to install the Spotify Web API:

```bash
npm install
```

## 5. Start the Application

```bash
npm run dev
```

## Features

- **Spotify Authentication**: Click "Connect Spotify" to authenticate with your Spotify account
- **Playlist Selection**: Once connected, click the Spotify icon in the player to select from your playlists
- **Seamless Integration**: Switch between your local music and Spotify playlists
- **Preview Playback**: Play 30-second previews of Spotify tracks
- **Beautiful UI**: Maintains the original heart animation and player design

## How to Use

1. Start the app and you'll see a "Connect Spotify" button in the top-right
2. Click it to authenticate with Spotify
3. Once connected, you'll see your profile info in the top-right
4. Click the Spotify icon in the music player to open the playlist selector
5. Choose any playlist to start playing previews
6. Use the "×" button next to the track name to return to default music

## Notes

- Only tracks with preview URLs will be playable (30-second previews)
- The app uses Spotify's Web API for authentication and playlist access
- Your Spotify credentials are stored locally and securely
- You can disconnect anytime by clicking the logout button

Enjoy your enhanced music experience! 🎵
