# Landing songs

The landing scene plays a looping background song alongside the rain
ambience (see `src/app/components/landing/stormAudio.ts`). The song is
decoded through the same Web Audio graph as the rain, so it shares the
master volume, the per-voice mute, and the tab-suspend battery saver.

A missing/corrupt file is skipped silently — the rain + thunder still
play.

## Bundled files

| Filename                  | Source                                       | Length | Bitrate     | Role                          |
| ------------------------- | -------------------------------------------- | ------ | ----------- | ----------------------------- |
| `neverending-cycle.m4a`   | YouTube `aKo5mR3j-98` (arimasen, trapeia)    | 2:05   | AAC 130 kbps | Background song — looped       |

Downloaded at the highest available bitrate (format 140, AAC 130k m4a)
via `yt-dlp -f 140`. AAC-in-MP4 decodes natively in every modern
browser through `decodeAudioData`.

## Balance

The song sits **under** the rain so neither overpowers the other:

- Master volume caps everything at 78 % of unity.
- Rain ambient: `RAIN_LEVEL` = 0.55 of master.
- Song: `SONG_LEVEL` = 0.34 of master — deliberately below the rain.

Tune `SONG_LEVEL` in `stormAudio.ts` for a more (or less) song-forward
mix.

## Adding more songs

1. Drop the audio file in this folder (m4a / mp3 / ogg all work).
2. Append an entry to `SONG_FILES` in `stormAudio.ts`:

   ```ts
   export const SONG_FILES: LandingSong[] = [
     { src: '/audio/songs/neverending-cycle.m4a', title: 'arimasen, trapeia — neverending cycle' },
     { src: '/audio/songs/your-new-song.m4a',     title: 'artist — title' },
   ];
   ```

The engine currently plays index 0 on unlock and the audio tab exposes
a single song on/off switch. Per-song selection / skip can build on the
`currentSongIndex` plumbing already in `stormAudio.ts`.

### Downloading at highest bitrate

```bash
yt-dlp -F "<youtube-url>"          # list formats, find the highest ABR audio
yt-dlp -f <id> -o "public/audio/songs/<name>.m4a" "<youtube-url>"
```
