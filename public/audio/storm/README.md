# Storm audio assets

The landing scene loads these files from `/audio/storm/` at runtime
(see `src/app/components/landing/stormAudio.ts`).

If a file is missing, that voice is silently skipped — the rest of
the scene still works.

## Bundled files

All files are sourced from [Mixkit](https://mixkit.co/license/#sfxFree)
under the Mixkit License (free for commercial + personal use, no
attribution required).

| Filename            | Source              | Length | Size  | Role                                                  |
| ------------------- | ------------------- | ------ | ----- | ----------------------------------------------------- |
| `rain.mp3`          | mixkit sfx **2394** | 0:57   | 1.7MB | Steady rain ambience — looped continuously            |
| `thunder-near.mp3`  | mixkit sfx **1278** | 0:13   | 387KB | Sharp close strike — used for clicks + intro lightning |
| `thunder-far.mp3`   | mixkit sfx **1296** | 0:18   | 554KB | Hollow distant rumble — used for background flashes   |

## How the engine picks a sample

`stormAudio.ts` exposes one method: `triggerThunder({ distance, intensity, delay })`.
The `distance` parameter (0 = right overhead, 1 = far horizon)
selects the pool:

- `distance ≤ 0.5` → **NEAR pool** (`thunder-near.mp3`) — sharp transient
- `distance > 0.5` → **FAR pool** (`thunder-far.mp3`)  — hollow rumble

On top of pool selection, every trigger:
- Pitches the sample ±15% so the same file never sounds identical
- Routes through a low-pass whose cutoff sweeps with `distance`
  (22kHz → 600Hz log-space) — distant strikes lose their crackle
- Applies inverse-square amplitude attenuation
- Triggers a subtle rain duck (-12% for 1.6s) on close + intense
  strikes only

This is why a single near-thunder file can render dozens of
unique-feeling close strikes over a session.

## Adding more samples

Drop additional files in this folder and append their paths to
`THUNDER_NEAR_FILES` or `THUNDER_FAR_FILES` in `stormAudio.ts`.
The engine treats each pool as a list and rotates through it
(avoiding back-to-back duplicates).

Recommended sources for additions:

- **Mixkit** — <https://mixkit.co/free-sound-effects/storm/> · no attribution
- **Pixabay** — <https://pixabay.com/sound-effects/search/thunder/> · no attribution
- **Freesound (CC0)** — <https://freesound.org/search/?q=thunder&f=license:%22Creative+Commons+0%22>

## Tips for picking good samples

- **Rain**: Avoid recordings with audible thunder, splashes, or
  cars — anything that repeats will be obvious in a loop. The
  best rain loops are a steady, even hiss with subtle texture.
- **Thunder**: Pick samples that DON'T already have rain mixed
  in — the engine layers thunder over the rain ambient, so any
  rain in the thunder file will phase against the loop.
- **Close thunder**: short attack (< 200ms), full HF content,
  punchy transient. Reads as "right above you."
- **Far thunder**: slow attack, hollow body, long tail. Reads
  as "across the valley." Even mids are fine — the engine will
  filter the highs anyway.
- **Format**: MP3 (~128–192 kbps) keeps payload small. WAV/OGG
  also work — just rename in `stormAudio.ts`.

## Volume

The engine caps everything at 78 % of unity (master volume), then:
- Rain ambient sits at 55 % of master ≈ 43 % final
- Thunder peaks at 85 % of master ≈ 66 % final (close strikes)

Adjust `MASTER_VOLUME`, `RAIN_LEVEL`, `THUNDER_LEVEL` in
`stormAudio.ts` to taste.
