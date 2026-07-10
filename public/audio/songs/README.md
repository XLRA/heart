# Landing songs

The landing scene plays a looping playlist of background songs alongside
the rain ambience (see `src/app/components/landing/stormAudio.ts`). Each
song is decoded through the same Web Audio graph as the rain, so it
shares the master mute, the per-voice volume, and the tab-suspend battery
saver.

A missing/corrupt file is skipped silently — the rain + thunder still
play.

## Bundled files

| Filename                  | Source                                     | Length | Bitrate      | Role                    |
| ------------------------- | ------------------------------------------ | ------ | ------------ | ----------------------- |
| `bear.m4a`                | YouTube `DVCYPUtlFwY` (rock burwell)       | 1:55   | AAC 130 kbps | Playlist track 1        |
| `neverending-cycle.m4a`   | YouTube `aKo5mR3j-98` (arimasen, trapeia)  | 2:05   | AAC 130 kbps | Playlist track 2        |
| `bipolar.m4a`             | YouTube `v06CVZR-dH4` (.diedlonely)        | 2:12   | AAC 130 kbps | Playlist track 3        |

Downloaded at the highest available bitrate (format 140, AAC 130k m4a)
via `yt-dlp -f 140`. AAC-in-MP4 decodes natively in every modern browser
through `decodeAudioData`.

## Playback

`SONG_FILES` in `stormAudio.ts` is the playlist. The engine plays index
0 on unlock and **auto-advances** to the next track when one ends,
wrapping back to the start, prefetching the upcoming buffer so the
handoff is gapless. A single-entry playlist just loops in place. The
audio tab shows the now-playing title and keeps it in sync with
auto-advance via a change callback.

## Balance / the mixer

The audio tab (top-right) is a small mixer with **two volume bars** —
one per voice — layered under a master mute (the speaker icon):

- **rain bar** → the storm bus: the rain loop **and** thunder (thunder is
  part of the storm, so muting the rain quiets the whole soundscape).
- **song bar** → the song bus.

Gain model (`stormAudio.ts`):

- `MASTER_VOLUME` = 0.78 — caps everything; the speaker icon mutes it.
- Storm bus gain = the rain bar value (0..1); the rain loop sits at
  `RAIN_LEVEL` = 0.55 within it.
- Song bus gain = the song bar value × `SONG_MAX` (0.42) — kept a touch
  under the rain so music + rain stay balanced even at full song volume.
- Defaults: `DEFAULT_RAIN_VOLUME` = 0.7, `DEFAULT_SONG_VOLUME` = 0.6.
  Both persist to `localStorage` (`stormRainVolume` / `stormSongVolume`).

## Adding more songs

1. Drop the audio file in this folder (m4a / mp3 / ogg all work).
2. Append an entry to `SONG_FILES` in `stormAudio.ts`:

   ```ts
   export const SONG_FILES: LandingSong[] = [
     { src: '/audio/songs/neverending-cycle.m4a', title: 'arimasen, trapeia — neverending cycle' },
     { src: '/audio/songs/bipolar.m4a',           title: '.diedlonely — bipolar' },
     { src: '/audio/songs/your-new-song.m4a',     title: 'artist — title' },
   ];
   ```

The new track joins the auto-advancing rotation automatically — no other
changes needed.

### Downloading at highest bitrate

```bash
yt-dlp -F "<youtube-url>"          # list formats, find the highest ABR audio
yt-dlp -f <id> -o "public/audio/songs/<name>.m4a" "<youtube-url>"
```
