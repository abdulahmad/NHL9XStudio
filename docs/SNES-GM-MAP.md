# SNES instruments <-> General MIDI

How `data/audio/nhl93s-gm-map.json` (NHLPA '93) and `data/audio/nhl94s-gm-map.json` (NHL '94) were made. Same approach as the Genesis maps ([NHL92-GM-MAP.md](NHL92-GM-MAP.md)): **opinions backed by measurements**. Nothing was auditioned; every row is meant to be corrected by ear.

| File | What it is |
|---|---|
| `data/audio/nhl93s-gm-map.json`, `nhl94s-gm-map.json` | **The maps.** Each row has a reason, a confidence (`high` / `medium` / `low`) and a runner-up. Edit these. |
| `data/audio/nhl93s-instrument-analysis.json`, `nhl94s-sound-analysis.json` | Generated measurements. Do not edit. |
| `lib/audio/snes-gm-analysis.js` | Plays and measures the probes, counts song usage. |
| `tools/build-snes-gm-analysis.js` | Rewrites (or `--check`s) the two analysis files. |
| `test/snes-gm-analysis.js` | Tests, part of `node test.js`. |

## Method

1. **Usage.** Every retail song is walked (the '93 timeline, the '94 track events) to count, per instrument or sound entry, the notes, the pitch range, the songs, and whether it only ever plays one key or sits on the drum track.
2. **Probe note.** Each instrument is played once through the game's own SPC700 program: a one-channel song at the median pitch the songs use it at (C4 if none does), held 656 ms and released. '93 uses a song written by `nhl93s-midi.js` and played as cue 7; '94 uses a one-track song (or `PlaySound` for entries that only the drum track plays).
3. **Measure.** The same measurements as the Genesis patches (`measureNote` in `nhl92-gm-analysis.js`): envelope shape, attack, level at key-off, release, brightness (spectral centroid / pitch), noisiness, periodicity. "Release" in the data is capped by the 2.4 s render, so a sustaining sample shows a long release; read the shape and key-off level instead.
4. **Match** by role and register first, then envelope class, then spectrum class; drum-track and fixed-key instruments go to drum notes, swells and noise to GM sound-effect programs. Every row keeps a runner-up and a confidence that reflects how much evidence there is.

## What the measurements changed

Compared with the earlier name-and-usage maps:

- '94 `SampleCrashBack` (menu 4) swells for 400 ms and is played as a melodic note, so it is now GM program 119 (reverse cymbal) instead of crash 2; GM crash 2 (drum note 57) now goes to `SampleCrash` (menu 14).
- '94 game-set crowd samples (18, 19, 28) map to applause (126) and `SampleWhistle` (21) to whistle (78).
- '93 instrument 4 is a sustained, bright bass (not a pluck), still synth bass 1; instrument 8 is only 125 ms long, so splash cymbal is its runner-up; instrument 9 (noise) is mapped to breath noise at low confidence.
- All other earlier picks held up: nothing measured contradicted them. Where a name or a role is the only evidence (the '94 `Dist` guitar sounds mellow, brightness 1.1x, so overdriven guitar is its runner-up), the row says so.

## Tables

### NHLPA 93 (SNES)

| Set | Instrument | GM | Confidence | Runner-up | Measured |
|---|---|---|---|---|---|
| boot | 0 | program 33 | medium | program 35 fretless bass | plucked, att 70 ms, -30 dB, bright 3.1x, per 0.98 |
| boot | 1 | drum 36 (key 19) | high | drum 35 acoustic bass drum | plucked, att 5 ms, -60 dB, bright 1.8x, per 0.99 |
| boot | 2 | drum 38 (key 19) | high | drum 40 electric snare | plucked, att 10 ms, -60 dB, bright 4.8x, per 0.91 |
| boot | 3 | program 81 | medium | program 82 calliope lead | sustained, att 5 ms, -1 dB, bright 3.5x, per 1 |
| boot | 4 | program 38 | medium | program 39 synth bass 2 | sustained, att 55 ms, -2 dB, bright 14.2x, per 0.92 |
| boot | 5 | drum 42 (key 19) | high | drum 44 pedal hi-hat | plucked, att 5 ms, -60 dB, bright 11x, per 0.96 |
| boot | 6 | program 80 | medium | program 81 sawtooth lead | sustained, att 10 ms, 0 dB, bright 2.3x, per 1 |
| boot | 7 | program 18 | medium | program 16 drawbar organ | sustained, att 5 ms, -2 dB, bright 7.5x, per 1 |
| boot | 8 | drum 49 (key 24) | low | drum 55 splash cymbal (the burst is only 125 ms) | plucked, att 10 ms, -60 dB, bright 36.9x, per 0.4 |
| boot | 9 | program 121 | low | program 122 seashore | sustained, att 35 ms, -1 dB, bright 10x, per 0.17 |
| game | 10 | program 78 | medium | program 79 ocarina | sustained, att 0 ms, 0 dB, bright 4.4x, per 1 |
| game | 11 | program 126 | medium | program 122 seashore | swell, att 275 ms, -8 dB, bright 27.4x, per 0.76 |
| game | 27 | program 62 | medium | program 61 brass section | sustained, att 0 ms, -1 dB, bright 8.8x, per 1 |
| game | 28 | drum 39 (key 23) | medium | drum 40 electric snare | plucked, att 0 ms, -60 dB, bright 25.1x, per 0.22 |

Sound-effect-only instruments (game set 12-26, unmapped): 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26. Measured but not matched; their pitch is swept by the effect programs.

### NHL 94 (SNES)

| Set | Entry | Sample | GM | Confidence | Runner-up | Measured |
|---|---|---|---|---|---|---|
| menu | 0 | SampleKick | drum 36 | high | drum 35 acoustic bass drum | plucked, att 20 ms, -28 dB, bright 0.2x, per 0.99 |
| menu | 1 | SampleKick | drum 36 | high | drum 35 acoustic bass drum | plucked, att 10 ms, -13 dB, bright 0.3x, per 0.99 |
| menu | 2 | SampleBass | program 33 | medium | program 32 acoustic bass | plucked, att 20 ms, -28 dB, bright 0.3x, per 1 |
| menu | 3 | SampleSnare | drum 38 | high | drum 40 electric snare | plucked, att 5 ms, -19 dB, bright 3x, per 0.87 |
| menu | 4 | SampleCrashBack | program 119 | medium | drum 57 crash cymbal 2 | swell, att 400 ms, -60 dB, bright 7.4x, per 0.54 |
| menu | 5 | SampleClosedHat | drum 42 | high | drum 44 pedal hi-hat | plucked, att 5 ms, -52 dB, bright 8.8x, per 0.52 |
| menu | 6 | SampleTom | drum 43 | high |  | plucked, att 15 ms, -6 dB, bright 0.5x, per 0.98 |
| menu | 7 | SampleClosedHat | drum 42 | high | drum 44 pedal hi-hat | plucked, att 0 ms, -48 dB, bright 32.1x, per 0.31 |
| menu | 8 | SampleTom | drum 45 | high |  | plucked, att 20 ms, -7 dB, bright 0.5x, per 0.97 |
| menu | 9 | SampleOpenHat | drum 46 | medium | drum 44 pedal hi-hat | plucked, att 0 ms, -12 dB, bright 13x, per 0.48 |
| menu | 10 | SampleTom | drum 47 | high |  | plucked, att 5 ms, -6 dB, bright 0.5x, per 0.97 |
| menu | 11 | SampleOpenHat | drum 44 | medium | drum 44 pedal hi-hat | plucked, att 5 ms, -8 dB, bright 12.7x, per 0.48 |
| menu | 12 | SampleTom | drum 48 | high |  | plucked, att 15 ms, -8 dB, bright 0.5x, per 0.97 |
| menu | 13 | SampleTom | drum 50 | high |  | plucked, att 5 ms, -13 dB, bright 0.6x, per 0.96 |
| menu | 14 | SampleCrash | drum 49 | medium | drum 57 crash cymbal 2 | plucked, att 30 ms, -17 dB, bright 7x, per 0.27 |
| menu | 15 | SampleCrash | drum 52 | medium | drum 57 crash cymbal 2 | plucked, att 30 ms, -17 dB, bright 7.3x, per 0.28 |
| menu | 16 | SampleBrass | program 61 | medium | program 62 synth brass 1 | sustained, att 35 ms, 0 dB, bright 2.4x, per 0.91 |
| menu | 17 | SampleBrass | program 61 | medium | program 62 synth brass 1 | sustained, att 35 ms, 0 dB, bright 2.4x, per 0.91 |
| menu | 18 | SampleChug | program 28 | medium | program 30 distortion guitar | plucked, att 45 ms, -60 dB, bright 0.3x, per 0.89 |
| menu | 19 | SampleOrch | program 55 | medium | program 48 string ensemble | plucked, att 25 ms, -58 dB, bright 1x, per 0.52 |
| menu | 20 | SampleBrass | program 61 | low | program 62 synth brass 1 | sustained, att 110 ms, -4 dB, bright 2.5x, per 0.85 |
| menu | 21 | SampleCowbell | drum 56 | high | drum 76 high wood block | plucked, att 5 ms, -60 dB, bright 1.6x, per 0.94 |
| menu | 22 | SampleTimp | program 47 | high | program 116 taiko drum | plucked, att 10 ms, -50 dB, bright 0.7x, per 0.72 |
| menu | 23 | SampleBrass | program 61 | low | program 62 synth brass 1 | sustained, att 110 ms, -4 dB, bright 2.5x, per 0.85 |
| menu | 24 | SampleBrass | program 61 | low | program 62 synth brass 1 | sustained, att 110 ms, -4 dB, bright 2.5x, per 0.85 |
| menu | 25 | SampleBrass | program 61 | medium | program 62 synth brass 1 | sustained, att 35 ms, 0 dB, bright 2.4x, per 0.91 |
| menu | 26 | SampleBrass | program 61 | low | program 62 synth brass 1 | sustained, att 110 ms, -4 dB, bright 2.5x, per 0.85 |
| menu | 27 | SampleDist | program 30 | medium | program 29 overdriven guitar | sustained, att 10 ms, -6 dB, bright 1.1x, per 0.66 |
| menu | 28 | SampleDist | program 30 | medium | program 29 overdriven guitar | sustained, att 10 ms, -5 dB, bright 1.1x, per 0.75 |
| menu | 29 | SampleDist | program 30 | medium | program 29 overdriven guitar | sustained, att 10 ms, -5 dB, bright 1.1x, per 0.75 |
| menu | 30 | SampleBrass | program 61 | medium | program 62 synth brass 1 | slow decay, att 30 ms, -10 dB, bright 2.4x, per 0.91 |
| menu | 31 | SamplePlayoffOrgan | program 17 | medium | program 18 rock organ | sustained, att 5 ms, 0 dB, bright 1.8x, per 1 |
| menu | 32 | SampleOpenHat | drum 46 | medium | drum 44 pedal hi-hat | plucked, att 5 ms, -18 dB, bright 5.8x, per 0.5 |
| menu | 33 | SampleDist | program 30 | medium | program 29 overdriven guitar | slow decay, att 35 ms, -7 dB, bright 1.1x, per 0.88 |
| menu | 34 | SampleDist | program 30 | medium | program 29 overdriven guitar | slow decay, att 35 ms, -7 dB, bright 1.1x, per 0.88 |
| menu | 35 | SampleCowbell | drum 56 | high | drum 76 high wood block | plucked, att 5 ms, -60 dB, bright 1.6x, per 0.95 |
| menu | 36 | SampleDist | program 30 | medium | program 29 overdriven guitar | slow decay, att 15 ms, -6 dB, bright 1.1x, per 0.76 |
| menu | 37 | SampleDist | program 30 | medium | program 29 overdriven guitar | slow decay, att 15 ms, -6 dB, bright 1.1x, per 0.76 |
| menu | 38 | SampleDist | program 30 | medium | program 29 overdriven guitar | slow decay, att 15 ms, -6 dB, bright 1.1x, per 0.76 |
| menu | 39 | SampleChug | program 28 | medium | program 30 distortion guitar | plucked, att 70 ms, -60 dB, bright 0.5x, per 0.82 |
| menu | 40 | SampleBrass | program 61 | medium | program 62 synth brass 1 | sustained, att 30 ms, -3 dB, bright 2.4x, per 0.91 |
| menu | 41 | SampleAPower | program 29 | medium | program 30 distortion guitar | swell, att 290 ms, -3 dB, bright 1.4x, per 0.96 |
| menu | 42 | SampleAPower | program 29 | medium | program 30 distortion guitar | swell, att 290 ms, -3 dB, bright 1.4x, per 0.96 |
| menu | 43 | SampleAPower | program 29 | medium | program 30 distortion guitar | swell, att 290 ms, -3 dB, bright 1.4x, per 0.96 |
| menu | 44 | SampleBrass | program 61 | medium | program 62 synth brass 1 | sustained, att 30 ms, -2 dB, bright 2.4x, per 0.91 |
| menu | 45 | SampleBrass | program 61 | medium | program 62 synth brass 1 | sustained, att 25 ms, -1 dB, bright 2.4x, per 0.89 |
| menu | 46 | SampleBrass | program 61 | medium | program 62 synth brass 1 | sustained, att 35 ms, -2 dB, bright 2.3x, per 0.9 |
| menu | 47 | SamplePlayoffOrgan | program 17 | medium | program 18 rock organ | sustained, att 5 ms, -1 dB, bright 1.8x, per 1 |
| menu | 48 | SampleDist | program 30 | medium | program 29 overdriven guitar | slow decay, att 35 ms, -10 dB, bright 1.1x, per 0.85 |
| menu | 49 | SampleDist | program 30 | medium | program 29 overdriven guitar | slow decay, att 35 ms, -8 dB, bright 1x, per 0.85 |
| menu | 50 | SampleChug | program 28 | medium | program 30 distortion guitar | plucked, att 75 ms, -60 dB, bright 0.6x, per 0.78 |
| menu | 51 | SampleChug | program 28 | medium | program 30 distortion guitar | plucked, att 95 ms, -60 dB, bright 0.6x, per 0.78 |
| menu | 52 | SampleTimp | program 47 | high | program 116 taiko drum | plucked, att 10 ms, -60 dB, bright 1.2x, per 0.83 |
| menu | 53 | SampleTimp | program 47 | high | program 116 taiko drum | plucked, att 10 ms, -60 dB, bright 1.2x, per 0.8 |
| menu | 54 | SampleDist | program 30 | medium | program 29 overdriven guitar | sustained, att 10 ms, -2 dB, bright 2.6x, per 0.62 |
| menu | 55 | SamplePlayoffOrgan | program 17 | medium | program 18 rock organ | sustained, att 5 ms, -1 dB, bright 4.2x, per 1 |
| game | 11 | SampleOrgan | program 16 | medium | program 18 rock organ | sustained, att 5 ms, -1 dB, bright 1.8x, per 1 |
| game | 12 | SampleOrgan | program 16 | medium | program 18 rock organ | sustained, att 5 ms, -2 dB, bright 1.8x, per 1 |
| game | 18 | SampleCrowd1 | program 126 | medium | program 122 seashore | sustained, att 5 ms, -1 dB, bright 6.4x, per 0.41 |
| game | 19 | SampleCrowd2 | program 126 | medium | program 122 seashore | sustained, att 10 ms, -2 dB, bright 3.8x, per 0.19 |
| game | 20 | SampleClap | drum 39 | high | drum 40 electric snare | plucked, att 25 ms, -35 dB, bright 4.7x, per 0.22 |
| game | 21 | SampleWhistle | program 78 | high | drum 72 long whistle | plucked, att 15 ms, -27 dB, bright 22x, per 0.86 |
| game | 28 | SampleCrowd2 | program 126 | medium | program 122 seashore | sustained, att 10 ms, -2 dB, bright 3.8x, per 0.19 |

## Limits

Signal measurements describe the render; words like "bright" are read off the numbers. The '94 game-set effects (passes, shots, pucks) and the '93 effect-only instruments are not instruments and are not mapped.
