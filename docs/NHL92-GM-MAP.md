# NHL '92 ↔ General MIDI instrument map

Two-way mappings between the 22 FM patches of NHL '92's retail Z80 driver and General MIDI (GM), for converting NHL '92 music to GM and GM music to NHL '92. The mappings are **opinions backed by measurements**: nothing here was checked against the retail game or an emulator, and every match is meant to be corrected by ear.

This is a mapping layer on top of the sound stack. It reads the parsed sound data and the step 4 renders; it does not change the drivers, the patches or any sound data.

| File | What it is |
|---|---|
| `data/audio/nhl92-gm-map.json` | **The mappings** (both directions), with a reason and a runner-up for every match. Edit this. |
| `data/audio/nhl92-patch-analysis.json` | Generated facts: decoded YM2612 parameters, where each patch is used, measurements of a probe note. Do not edit. |
| `lib/audio/nhl92-gm-map.js` | GM constants (program names, families, drum notes), the family-default/override resolver, `validate()`. |
| `lib/audio/nhl92-gm-analysis.js`, `nhl92-patch-analysis.js` | Patch decoding, song/SFX usage walk, note measurements. |
| `lib/audio/gm-reference.js` | The plain GM-style reference sounds used by the audition (not a soundfont). |
| `tools/build-nhl92-patch-analysis.js` | Rewrites (or `--check`s) the analysis JSON. |
| `tools/build-nhl92-gm-map-doc.js` | Rewrites (or `--check`s) the tables in this doc. |
| `test/nhl92-gm-map.js` | Tests, part of `node test.js`. |

## Conventions

- **Pitch.** MIDI note = note-table index + 12. Index 0 is C0 (MIDI 12) and index 48 is C4 (MIDI 60); the table has 96 entries, so the driver reaches MIDI 12–107. GM notes outside that range need an octave shift when converting to NHL '92. The songs use indexes 9–90.
- **GM programs** are numbered 0–127 (not 1–128). **GM drums** are channel 10, notes 35–81.
- **Patch notes.** Patch 4's note offset is −3 (the only non-zero one); the pitches in the tables already include it.
- **DAC targets** name the game's SFX ID (`sfx_pointer_table`) that starts the sample, using the IDs and EA names in [NHL92-68K-DRIVER.md](NHL92-68K-DRIVER.md#sfx-labels-in-soundasm-are-shifted-against-the-ids), not the disassembly's shifted handler labels.

## Method

### 1. Decode every patch

Each patch is 26 YM2612 register bytes. The Z80 writes them to registers `$30,$38,$34,$3C,$40,…,$B0,$B4` (table at Z80 `$00C5`), so within each group of four the operators are **op1, op2, op3, op4** (the chip's own slot order is op1, op3, op2, op4). The groups are DT/MUL, TL, RS/AR, AM/D1R, D2R and SL/RR, then feedback/algorithm and pan/AMS/FMS. Carriers follow the algorithm (0–3: op4; 4: op2, op4; 5 and 6: op2, op3, op4; 7: all). Multiplier 0 means ×½. The decoded values are in the first table below; all 22 patches are panned to both channels (`$B4` pan bits set) with no amplitude modulation and no LFO sensitivity.

### 2. Where each patch is used

The usage walk (`nhl92-gm-analysis.js`) plays each channel's order list once with the parser's data: patterns in order, repeats expanded, stopping at the first restart or song switch (the one-vblank SngTitle fall-through is not followed). For every note it records the patch in effect, the pitch (after patch note offset and transpose) and the length (duration × tempo). SFX use comes from the `$80 id` instrument commands in the FM SFX streams.

Result: **8 patches play in the songs** (1, 3, 4, 5, 6, 17, 18, 21), **9 are only SFX instruments** (0, 9, 10, 13, 14, 15, 16, 19, 20) and **5 are never selected** by any song or SFX (2, 7, 8, 11, 12). Matches for the last 14 rest on the measurements alone.

### 3. Measure a probe note

Each patch plays one note through the step 4 pipeline (the retail Z80 driver driving ymfm), held 40 frames (667 ms) and released, at the patch's median song pitch (C4 if no song uses it). The same pipeline reproduces the pinned `patch-NN.wav` renders exactly (all 22 hashes match). From the render:

| Measure | Meaning |
|---|---|
| Shape | `sustained` (within 6 dB of its peak at key-off), `slow decay`, `plucked` (more than 20 dB down by key-off) or `swell` (attack of 150 ms or more) |
| Attack / levels / release | 5 ms RMS windows: time to 90% of peak, level 100 and 400 ms after onset, time to fall 20 dB after key-off |
| Brightness | spectral centroid ÷ the note's frequency (1× is a pure tone) |
| Noisiness | spectral flatness over 40 Hz–16 kHz (0 tonal, 1 noise) |
| Periodicity | best normalised autocorrelation (1 is perfectly periodic, low is noisy or inharmonic) |

**These are measurements, not listening.** The brief asked for each render to be listened to; this was done by signal analysis instead, because the author of this table cannot hear audio. Descriptions such as "round", "harsh" or "hollow" are read off the numbers and the harmonic make-up (odd vs even partials at C5) and need an ear check.

### 4. Match

The rules, in order:

1. **Role and register first** where the songs show one: the only bass line, the drum track, the melody duet.
2. **Envelope class**: sustained, plucked, swelling, noisy burst.
3. **Spectrum class**: near-sine, hollow (odd harmonics), saw-like (all harmonics), dense and harsh, noisy.
4. **Percussive patches map to drum notes** on channel 10 (patches 3, 4, 9, 10, 12, 13, 19, 20). Two noise patches with no struck attack (11, 15) go to GM sound-effect programs instead.
5. Every match gets a **runner-up** and a **confidence** (high, medium, low) that reflects how much evidence there is, not how it sounds.

For **GM → NHL '92** only 22 patches cover 128 programs, so many programs share a patch. Each of the 16 GM families has a **default**; a program uses its **override** if it has one, otherwise its family default. An override is only added where a different patch is a clearly better fit than the family default, and the file's validator rejects an override that repeats its default. The 47 drum notes are mapped separately, to the closest percussive patch (with a suggested pitch) or a DAC sample, with a fit rating of `good`, `rough` or `none`.

The two directions are consistent where they overlap: for example patch 18 → GM 81 and GM 81 → patch 18, patch 21 ↔ GM 80, patch 17 ↔ GM 18, patch 5 ↔ GM 30, patch 1 ↔ GM 39. They are not strict inverses: patches 6 and 18 are the same lead voice with different modulator levels and both map to GM 81, while GM 81 returns to patch 18.

## Patch analysis

### YM2612 parameters

Carriers are in **bold**. MUL is shown as ×n, DT as the signed detune step, TL 0–127 (each step 0.75 dB), AR/D1R/D2R 0–31, SL 0–15, RR 0–15, RS only when non-zero.

<!-- GENERATED:params -->
| Patch | Alg | FB | Operator 1 | Operator 2 | Operator 3 | Operator 4 |
|---|---|---|---|---|---|---|
| 0 | 2 | 1 | ×½<br>TL 23<br>AR 31<br>D1R 4 D2R 0<br>SL 15 RR 9 | ×½ dt+2<br>TL 12<br>AR 31<br>D1R 4 D2R 0<br>SL 15 RR 9 | ×2 dt-2<br>TL 18<br>AR 31<br>D1R 4 D2R 0<br>SL 15 RR 9 | **×½ dt+1**<br>**TL 10**<br>**AR 7**<br>**D1R 4 D2R 0**<br>**SL 15 RR 9** |
| 1 | 0 | 5 | ×6 dt+3<br>TL 25<br>AR 31 RS1<br>D1R 6 D2R 6<br>SL 2 RR 3 | ×3<br>TL 32<br>AR 28 RS1<br>D1R 9 D2R 4<br>SL 3 RR 3 | ×½<br>TL 32<br>AR 29 RS1<br>D1R 2 D2R 1<br>SL 1 RR 3 | **×1**<br>**TL 14**<br>**AR 31 RS1**<br>**D1R 5 D2R 0**<br>**SL 0 RR 8** |
| 2 | 4 | 5 | ×2 dt+2<br>TL 19<br>AR 16<br>D1R 8 D2R 0<br>SL 3 RR 7 | **×2 dt-3**<br>**TL 26**<br>**AR 17**<br>**D1R 0 D2R 0**<br>**SL 0 RR 9** | ×2 dt-3<br>TL 16<br>AR 13<br>D1R 6 D2R 0<br>SL 2 RR 7 | **×2 dt+3**<br>**TL 26**<br>**AR 16**<br>**D1R 2 D2R 0**<br>**SL 0 RR 9** |
| 3 | 2 | 0 | ×½<br>TL 0<br>AR 31<br>D1R 13 D2R 0<br>SL 15 RR 5 | ×4<br>TL 0<br>AR 31<br>D1R 0 D2R 15<br>SL 15 RR 10 | ×½ dt-3<br>TL 16<br>AR 31<br>D1R 22 D2R 7<br>SL 6 RR 8 | **×½**<br>**TL 8**<br>**AR 31**<br>**D1R 15 D2R 20**<br>**SL 15 RR 12** |
| 4 | 4 | 7 | ×15<br>TL 0<br>AR 31<br>D1R 0 D2R 0<br>SL 0 RR 5 | **×3**<br>**TL 0**<br>**AR 31**<br>**D1R 3 D2R 14**<br>**SL 0 RR 8** | ×1<br>TL 0<br>AR 31<br>D1R 20 D2R 8<br>SL 7 RR 5 | **×1**<br>**TL 0**<br>**AR 31**<br>**D1R 24 D2R 14**<br>**SL 0 RR 8** |
| 5 | 0 | 7 | ×12 dt+3<br>TL 25<br>AR 31 RS3<br>D1R 4 D2R 4<br>SL 15 RR 7 | ×9 dt+3<br>TL 40<br>AR 31<br>D1R 5 D2R 4<br>SL 0 RR 7 | ×½<br>TL 0<br>AR 31<br>D1R 4 D2R 4<br>SL 1 RR 7 | **×4 dt+1**<br>**TL 16**<br>**AR 31 RS3**<br>**D1R 1 D2R 2**<br>**SL 10 RR 12** |
| 6 | 0 | 5 | ×6 dt-1<br>TL 44<br>AR 31<br>D1R 2 D2R 7<br>SL 15 RR 0 | ×5 dt+1<br>TL 44<br>AR 31<br>D1R 3 D2R 7<br>SL 15 RR 5 | ×½ dt+1<br>TL 23<br>AR 31<br>D1R 7 D2R 7<br>SL 15 RR 6 | **×2 dt-3**<br>**TL 14**<br>**AR 31**<br>**D1R 0 D2R 6**<br>**SL 15 RR 8** |
| 7 | 4 | 5 | ×1 dt+3<br>TL 57<br>AR 31<br>D1R 3 D2R 7<br>SL 0 RR 15 | **×1**<br>**TL 26**<br>**AR 31**<br>**D1R 4 D2R 0**<br>**SL 0 RR 15** | ×½ dt+1<br>TL 14<br>AR 31 RS1<br>D1R 31 D2R 10<br>SL 0 RR 15 | **×1 dt+2**<br>**TL 22**<br>**AR 31**<br>**D1R 31 D2R 0**<br>**SL 0 RR 15** |
| 8 | 3 | 7 | ×15 dt-1<br>TL 0<br>AR 31<br>D1R 21 D2R 19<br>SL 2 RR 6 | ×2 dt-1<br>TL 40<br>AR 31<br>D1R 21 D2R 12<br>SL 2 RR 6 | ×7<br>TL 28<br>AR 31<br>D1R 21 D2R 13<br>SL 3 RR 6 | **×2**<br>**TL 12**<br>**AR 31 RS2**<br>**D1R 31 D2R 16**<br>**SL 0 RR 9** |
| 9 | 0 | 5 | ×½<br>TL 9<br>AR 31<br>D1R 15 D2R 0<br>SL 15 RR 15 | ×4<br>TL 18<br>AR 31<br>D1R 0 D2R 15<br>SL 15 RR 10 | ×15 dt-3<br>TL 19<br>AR 31<br>D1R 18 D2R 7<br>SL 6 RR 8 | **×½**<br>**TL 10**<br>**AR 31**<br>**D1R 17 D2R 0**<br>**SL 15 RR 9** |
| 10 | 2 | 0 | ×½<br>TL 0<br>AR 31<br>D1R 8 D2R 0<br>SL 15 RR 5 | ×2<br>TL 0<br>AR 31<br>D1R 0 D2R 15<br>SL 15 RR 10 | ×½ dt-3<br>TL 19<br>AR 31<br>D1R 18 D2R 7<br>SL 6 RR 8 | **×½**<br>**TL 5**<br>**AR 31**<br>**D1R 12 D2R 0**<br>**SL 15 RR 12** |
| 11 | 2 | 7 | ×½ dt+3<br>TL 13<br>AR 31<br>D1R 0 D2R 0<br>SL 0 RR 9 | ×½ dt+2<br>TL 0<br>AR 31<br>D1R 31 D2R 0<br>SL 9 RR 15 | ×½<br>TL 96<br>AR 31<br>D1R 31 D2R 0<br>SL 0 RR 9 | **×7 dt-3**<br>**TL 7**<br>**AR 8**<br>**D1R 31 D2R 0**<br>**SL 0 RR 9** |
| 12 | 2 | 6 | ×1 dt+3<br>TL 5<br>AR 17<br>D1R 0 D2R 0<br>SL 0 RR 9 | ×½ dt+2<br>TL 127<br>AR 0<br>D1R 31 D2R 0<br>SL 9 RR 15 | ×½<br>TL 127<br>AR 0<br>D1R 31 D2R 0<br>SL 9 RR 15 | **×7 dt-3**<br>**TL 10**<br>**AR 14**<br>**D1R 12 D2R 0**<br>**SL 9 RR 10** |
| 13 | 2 | 3 | ×½<br>TL 18<br>AR 31<br>D1R 0 D2R 0<br>SL 15 RR 5 | ×2<br>TL 0<br>AR 31<br>D1R 0 D2R 15<br>SL 15 RR 10 | ×½ dt-3<br>TL 18<br>AR 31<br>D1R 18 D2R 7<br>SL 6 RR 8 | **×½**<br>**TL 5**<br>**AR 31**<br>**D1R 13 D2R 0**<br>**SL 15 RR 12** |
| 14 | 3 | 6 | ×2<br>TL 32<br>AR 31<br>D1R 31 D2R 3<br>SL 1 RR 5 | ×2<br>TL 48<br>AR 31<br>D1R 31 D2R 0<br>SL 0 RR 5 | ×1<br>TL 16<br>AR 31<br>D1R 31 D2R 0<br>SL 13 RR 5 | **×1**<br>**TL 7**<br>**AR 18**<br>**D1R 0 D2R 0**<br>**SL 15 RR 10** |
| 15 | 3 | 7 | ×½<br>TL 0<br>AR 24 RS3<br>D1R 0 D2R 7<br>SL 13 RR 9 | ×5 dt-3<br>TL 0<br>AR 8 RS2<br>D1R 29 D2R 6<br>SL 9 RR 9 | ×½ dt-3<br>TL 0<br>AR 8 RS2<br>D1R 29 D2R 6<br>SL 9 RR 9 | **×15 dt-3**<br>**TL 3**<br>**AR 8 RS2**<br>**D1R 29 D2R 6**<br>**SL 15 RR 9** |
| 16 | 5 | 5 | ×1<br>TL 18<br>AR 13 RS1<br>D1R 4 D2R 0<br>SL 0 RR 7 | **×1**<br>**TL 0**<br>**AR 16**<br>**D1R 31 D2R 0**<br>**SL 10 RR 9** | **×1 dt+3**<br>**TL 10**<br>**AR 15**<br>**D1R 3 D2R 4**<br>**SL 14 RR 8** | **×1 dt+3**<br>**TL 10**<br>**AR 15**<br>**D1R 3 D2R 4**<br>**SL 14 RR 7** |
| 17 | 1 | 4 | ×5 dt+3<br>TL 44<br>AR 31 RS3<br>D1R 4 D2R 4<br>SL 15 RR 5 | ×½ dt+3<br>TL 80<br>AR 31<br>D1R 5 D2R 4<br>SL 0 RR 5 | ×½<br>TL 0<br>AR 31<br>D1R 4 D2R 4<br>SL 1 RR 5 | **×4 dt+1**<br>**TL 12**<br>**AR 31 RS3**<br>**D1R 1 D2R 2**<br>**SL 8 RR 5** |
| 18 | 0 | 5 | ×6 dt-1<br>TL 35<br>AR 31<br>D1R 2 D2R 7<br>SL 15 RR 0 | ×5 dt+1<br>TL 47<br>AR 31<br>D1R 3 D2R 7<br>SL 15 RR 5 | ×½ dt+1<br>TL 24<br>AR 31<br>D1R 2 D2R 6<br>SL 15 RR 6 | **×2 dt-3**<br>**TL 12**<br>**AR 31**<br>**D1R 3 D2R 5**<br>**SL 15 RR 8** |
| 19 | 2 | 0 | ×½<br>TL 0<br>AR 31<br>D1R 8 D2R 0<br>SL 15 RR 5 | ×2<br>TL 0<br>AR 31<br>D1R 0 D2R 15<br>SL 15 RR 10 | ×½ dt-3<br>TL 19<br>AR 31<br>D1R 18 D2R 7<br>SL 6 RR 8 | **×½**<br>**TL 9**<br>**AR 31**<br>**D1R 12 D2R 0**<br>**SL 15 RR 12** |
| 20 | 2 | 0 | ×½<br>TL 0<br>AR 31<br>D1R 8 D2R 0<br>SL 15 RR 5 | ×2<br>TL 0<br>AR 31<br>D1R 0 D2R 15<br>SL 15 RR 10 | ×½ dt-3<br>TL 19<br>AR 31<br>D1R 18 D2R 7<br>SL 6 RR 8 | **×½**<br>**TL 13**<br>**AR 31**<br>**D1R 12 D2R 0**<br>**SL 15 RR 12** |
| 21 | 0 | 5 | ×6 dt-1<br>TL 40<br>AR 31<br>D1R 3 D2R 7<br>SL 15 RR 0 | ×5 dt+1<br>TL 67<br>AR 31<br>D1R 3 D2R 7<br>SL 15 RR 5 | ×½ dt+1<br>TL 22<br>AR 31<br>D1R 8 D2R 6<br>SL 15 RR 6 | **×2 dt-3**<br>**TL 13**<br>**AR 31**<br>**D1R 8 D2R 5**<br>**SL 15 RR 8** |
<!-- /GENERATED:params -->

### Measured probe notes

<!-- GENERATED:measured -->
| Patch | Probe | Shape | Attack | Level at 100 / 400 ms | Release | Brightness | Noisiness | Periodicity |
|---|---|---|---|---|---|---|---|---|
| 0 | C4 | swell | 555 ms | -19 / -7 dB | 100 ms | 11.9× (3100 Hz) | 0.07 | 0.95 |
| 1 | A2 | sustained | 5 ms | -1 / -3 dB | 110 ms | 6.5× (700 Hz) | 0 | 0.99 |
| 2 | C4 | sustained | 45 ms | -3 / -1 dB | 140 ms | 5× (1300 Hz) | 0 | 0.99 |
| 3 | A0 | plucked | 0 ms | -6 / -24 dB | 0 ms | 23.8× (650 Hz) | 0.01 | 0.74 |
| 4 | F#1 | plucked | 0 ms | -4 / -20 dB | 280 ms | 65.1× (3000 Hz) | 0.22 | 0.48 |
| 5 | G3 | sustained | 0 ms | -1 / -2 dB | 10 ms | 27.6× (5400 Hz) | 0.33 | 0.54 |
| 6 | G5 | sustained | 0 ms | -1 / -1 dB | 185 ms | 3.8× (2950 Hz) | 0 | 1 |
| 7 | C4 | swell | 440 ms | -6 / -3 dB | 10 ms | 2.1× (550 Hz) | 0 | 0.99 |
| 8 | C4 | plucked | 0 ms | -21 / -60 dB | 0 ms | 4.2× (1100 Hz) | 0.01 | 0.98 |
| 9 | C4 | plucked | 0 ms | -18 / -60 dB | 0 ms | 4.4× (1150 Hz) | 0.07 | 0.76 |
| 10 | C4 | plucked | 0 ms | -3 / -14 dB | 20 ms | 12.4× (3250 Hz) | 0.01 | 0.97 |
| 11 | C4 | swell | 495 ms | -23 / -3 dB | 125 ms | 26.5× (6950 Hz) | 0.47 | 0.52 |
| 12 | C4 | slow decay | 70 ms | -1 / -11 dB | 60 ms | 24.8× (6500 Hz) | 0.45 | 0.2 |
| 13 | C4 | plucked | 0 ms | -6 / -20 dB | 15 ms | 11.2× (2950 Hz) | 0.01 | 0.98 |
| 14 | C4 | sustained | 15 ms | -1 / 0 dB | 30 ms | 1.1× (300 Hz) | 0 | 1 |
| 15 | C4 | swell | 160 ms | -5 / -60 dB | 0 ms | 27.5× (7200 Hz) | 0.51 | 0.39 |
| 16 | C4 | sustained | 20 ms | -2 / -2 dB | 155 ms | 2.6× (700 Hz) | 0 | 0.96 |
| 17 | E4 | sustained | 0 ms | -1 / -4 dB | 195 ms | 18.5× (6100 Hz) | 0.01 | 0.97 |
| 18 | D#6 | sustained | 0 ms | -1 / -2 dB | 145 ms | 2.7× (3400 Hz) | 0 | 1 |
| 19 | C4 | plucked | 0 ms | -3 / -13 dB | 20 ms | 12.4× (3250 Hz) | 0.01 | 0.97 |
| 20 | C4 | plucked | 0 ms | -3 / -13 dB | 20 ms | 12.4× (3250 Hz) | 0.01 | 0.97 |
| 21 | C6 | slow decay | 0 ms | -2 / -5 dB | 235 ms | 2.1× (2200 Hz) | 0 | 1 |
<!-- /GENERATED:measured -->

### Where each patch is used

Channels are FM1–FM6 (channel index + 1), with the number of notes in the walk. Range is the pitch the note table plays, not necessarily the pitch you hear (see below). SFX IDs are the game's.

<!-- GENERATED:usage -->
| Patch | Songs: channels (notes) | Range | SFX |
|---|---|---|---|
| 0 | none | – | 0 |
| 1 | endofperiod: FM1 (123); splash: FM1 (521); unused: FM1 (256); endofgame: FM1 (256); playofftree: FM1 (192) | D2–B3, median A2 | none |
| 2 | none | – | none |
| 3 | endofperiod: FM6 (126); splash: FM6 (360); unused: FM6 (163); endofgame: FM6 (163); playofftree: FM6 (6) | A0–A0, median A0 | none |
| 4 | endofperiod: FM6 (70); splash: FM6 (193); unused: FM6 (100); endofgame: FM6 (100); playofftree: FM6 (2) | F#1–F#1, median F#1 | none |
| 5 | endofperiod: FM2 (104), FM4 (104); splash: FM2 (16), FM3 (1), FM4 (16) | E2–A4, median G3 | none |
| 6 | endofperiod: FM3 (146), FM5 (140); splash: FM3 (40), FM5 (54) | D4–F#7, median G5 | none |
| 7 | none | – | none |
| 8 | none | – | none |
| 9 | none | – | 5, 8 |
| 10 | none | – | 6, 7, 15, 16, 17 |
| 11 | none | – | none |
| 12 | none | – | none |
| 13 | none | – | 9 |
| 14 | none | – | 1, 2, 10 |
| 15 | none | – | 14 |
| 16 | none | – | 24 |
| 17 | splash: FM2 (300), FM4 (300); unused: FM2 (144), FM4 (144); endofgame: FM2 (144), FM4 (144); playofftree: FM2 (92), FM3 (92) | D3–A4, median E4 | none |
| 18 | splash: FM3 (326), FM5 (243); unused: FM3 (222), FM5 (264); endofgame: FM3 (494), FM5 (516); playofftree: FM4 (35), FM5 (35) | G4–D7, median D#6 | none |
| 19 | none | – | 27, 29 |
| 20 | none | – | 28, 30, 32, 33, 34 |
| 21 | playofftree: FM4 (64), FM5 (64) | A4–D7, median C6 | none |
<!-- /GENERATED:usage -->

Things the usage shows:

- **FM1** is always patch 1 (the bass line), and **FM6** is always the drum track: patch 3 on the pulse and patch 4 once every four steps, at one pitch each (A0 and F#1).
- **FM3 and FM5** (FM4 and FM5 in SngPO) play the melody duet with the lead family (patches 6, 18, 21). Nearly every lead note carries a modulation (vibrato) command, and all but patch 18's SngPO notes also carry a pitch envelope.
- **FM2 and FM4** carry the accompaniment: patch 5 in SngEOP (and SngTitle's long opening chords), patch 17 in the body of SngTitle, the Reprise, SngEOG and SngPO (FM2 with FM3 in SngPO).
- Patches 10, 19 and 20 differ only in carrier total level (5, 9, 13): the same board-hit sound at three volumes.

## NHL '92 → GM

Targets marked *Drum* are GM drum notes on channel 10; all others are GM programs.

<!-- GENERATED:nhl92-to-gm -->
| Patch | Character | GM match | Why | Runner-up | Sure? |
|---|---|---|---|---|---|
| 0 | Siren swell. 0.55 s fade-in (carrier attack rate 7), bright full-harmonic tone (centroid about 12x the note), no decay. Only SFX 0 (siren) loads it; no song does. | **GM 63 Synth Brass 2** | Slow swell into a bright, harmonically full sustained tone is the Synth Brass 2 shape. GM has no siren, so this matches the envelope and spectrum, not the role. | GM 81 Lead 2 (sawtooth) | low |
| 1 | Round, sustained near-sine bass. Carrier MUL 1, no decay, attack 5 ms, harmonics about 35 dB down. FM1 in all five songs: 1,348 notes, D2-B3 (median A2). | **GM 39 Synth Bass 2** | Role (the only bass line, FM1, D2-B3) and shape (instant attack, no decay, near-sine) both say synth bass; Synth Bass 2 is the rounder of the two GM synth basses. | GM 35 Fretless Bass | medium |
| 2 | Unused by any song or SFX. Organ-like: two carriers at MUL 2, 45 ms attack, no decay, even harmonics, centroid about 5x the note. | **GM 20 Reed Organ** | Sustained with no decay and an even-harmonic reedy spectrum; the 45 ms attack is a soft organ onset. | GM 19 Church Organ | low |
| 3 | Kick. Instant attack, decays to -24 dB by 400 ms, low thump with a bright click (centroid 650 Hz on a 27.5 Hz note). FM6 in all five songs, always A0: 818 notes on the steady pulse. | **Drum 36 Bass Drum 1** | Role and sound agree: one low pitch on the pulse, with the pitched thump and click of an FM kick. | Drum 35 Acoustic Bass Drum | high |
| 4 | Snare. Noisy and bright (flatness 0.22, centroid 3 kHz), 0.28 s tail. FM6 beside the kick, always F#1 (patch note offset -3): 465 notes, one in every four steps (the backbeat). | **Drum 38 Acoustic Snare** | Backbeat role plus a noisy, bright burst with a short tail is a snare; the noise comes from feedback 7 with a MUL 15 modulator. | Drum 40 Electric Snare | medium |
| 5 | Harsh and dense. Feedback 7, flatness 0.33, strong partials from 0.5x to 6x the note, sustained. endofperiod FM2 and FM4 together (E3-E4 with E2-A3, 0.5 s notes) and long chords (1.3-3.2 s) in splash. | **GM 30 Distortion Guitar** | Noisy, harmonically dense and sustained, in the E2-A3 range as two parts moving together (power-chord pairs): a distorted rhythm voice. Weak spot: the same numbers fit a harsh organ or a brass stab. | GM 29 Overdriven Guitar | low |
| 6 | Bright vibrato lead. Instant attack, sustained, tonal, strong partials at 1x, 1.5x and 3x the note. Vibrato and pitch envelope on 98% of its notes. FM3 and FM5 in endofperiod and splash: 380 notes, D4-F#7 (median G5). | **GM 81 Lead 2 (sawtooth)** | Melody-duet voice, sustained and bright with vibrato on nearly every note; the strong third harmonic points to a saw-like tone. The 1.5x partial gives it a brassy edge, hence the runner-up. | GM 62 Synth Brass 1 | medium |
| 7 | Unused. Hollow swell: 0.44 s fade-in, strong at 0.5x to 2x the note then falling fast, sustained, near-sine highs. | **GM 89 Pad 2 (warm)** | A slow-onset sustained tone with few high harmonics is the warm-pad shape. | GM 52 Choir Aahs | low |
| 8 | Unused. Very short tonal blip: -21 dB by 100 ms, silent by 400 ms, near-pure tone (periodicity 0.98). | **GM 45 Pizzicato Strings** | A plucked tone that stops before it can sustain; pizzicato is the shortest pitched GM voice. It reads as a blip, not a mallet or a drum. | GM 108 Kalimba | low |
| 9 | Puck-hit click. Very short (-18 dB by 100 ms), mid-bright, slightly noisy (periodicity 0.76). Only SFX 5 (hit puck) and 8 (puck faceoff) load it. | **Drum 37 Side Stick** | A short dry tick is the side-stick sound, and it is the puck-on-stick SFX. | Drum 76 Hi Wood Block | low |
| 10 | Board hit. Same FM structure as patches 3, 19 and 20 (a kick-family thump) with a brighter body: centroid 3.2 kHz at C4, -14 dB by 400 ms. SFX 6, 7 (hit board) and 15, 16, 17 (player hits boards). | **Drum 41 Low Floor Tom** | A pitched, decaying low thump with a bright attack is tom-like; patch 3 is already the kick. The SFX streams add a falling pitch sweep that the probe note does not have. | Drum 45 Low Tom | low |
| 11 | Unused. Noise swell: flatness 0.47, centroid 7 kHz, 0.5 s fade-in peaking at 0.6 s. | **GM 119 Reverse Cymbal** | Noise that grows for half a second and then cuts is the reverse-cymbal shape; a struck cymbal would peak at once. | Drum 49 Crash Cymbal 1 | low |
| 12 | Unused. Noise with a fast attack and a long decay: flatness 0.45, centroid 6.5 kHz, -11 dB by 400 ms. | **Drum 49 Crash Cymbal 1** | Bright noise that rings out is cymbal-like, and no other patch has this much noise with a sustained tail. | Drum 57 Crash Cymbal 2 | low |
| 13 | Post ping. Tonal and metallic (centroid 3 kHz at C4, flatness 0.01), rings to -20 dB by 400 ms. SFX 9 (post). | **Drum 53 Ride Bell** | A struck-metal ping with a short ring is the bell of a ride cymbal, and the game uses it for the puck hitting the post. | Drum 81 Open Triangle | low |
| 14 | Pure tone. Almost a sine (harmonics 15 dB or more down), instant attack, sustained. The beeps (SFX 1, 2) and the whistle (SFX 10). | **GM 78 Whistle** | The game uses it for its whistle and beeps, and a sine-like sustained tone without a harmonic bite is also what the GM whistle is. | GM 79 Ocarina | medium |
| 15 | Whiff. Noisy sweep (flatness 0.51): 0.16 s swell, gone by 400 ms. SFX 14 (whiff). | **GM 121 Breath Noise** | A short noisy whoosh that fades in and out; Breath Noise is GM's air-noise voice. | GM 122 Seashore | low |
| 16 | Foghorn. Sustained; three carriers at MUL 1 with detunes 0, +3, +3 (slow beating); harmonic series falling from the 2nd partial; 155 ms release. SFX 24 (foghorn). | **GM 61 Brass Section** | A horn blast: a sustained harmonic stack with slight beating between carriers, like a section of brass. | GM 58 Tuba | medium |
| 17 | Bright organ-like voice. Tonal but very bright (centroid 6 kHz at E4, about 18x the note), sustained, 195 ms release. splash, Reprise, EOG and PO: FM2 paired with FM4 (FM3 in PO), 1,360 notes cycling 3-7 pitches per part (D3-A4). | **GM 18 Rock Organ** | A bright, sustained, harmonically dense tone playing repeated short figures in the middle register is the rock-organ role. Weak spot: dense and harsh like patch 5, so a guitar is also plausible. | GM 29 Overdriven Guitar | low |
| 18 | Main lead. Bright, tonal, sustained (-2 dB at key-off). Vibrato and pitch envelope on 99% of its notes. Four songs, FM3 and FM5 (FM4 and FM5 in PO): 2,135 notes (G4-D7, median D#6). | **GM 81 Lead 2 (sawtooth)** | The most-used melodic voice. Partials at 1x, 1.5x, 2x and 3x all within 7 dB is saw-like, and vibrato on every note is how a synth lead is played. Same voice family as patches 6 and 21 with different modulator levels. | GM 80 Lead 1 (square) | medium |
| 19 | Quieter board hit. The same sound as patch 10 with the carrier level 3 dB lower (TL 9 against 5). SFX 27, 29. | **Drum 41 Low Floor Tom** | Same FM thump as patch 10 with a lower carrier level: the same instrument hit softer. Map to the same drum at a lower velocity. | Drum 45 Low Tom | low |
| 20 | Quietest board hit. The same sound as patch 10 with the carrier level 6 dB lower (TL 13 against 5). SFX 28, 30, 32, 33, 34. | **Drum 41 Low Floor Tom** | Same FM thump as patch 10 with a lower carrier level: the same instrument hit softer. Map to the same drum at a lower velocity. | Drum 45 Low Tom | low |
| 21 | Hollow high lead. Odd harmonics dominate (3x about as loud as the note, 2x 12 dB down), slow decay (-8 dB at key-off). Vibrato on 91% of notes. playofftree only, FM4 and FM5: 128 notes (A4-D7, median C6). | **GM 80 Lead 1 (square)** | Odd-harmonic-heavy, hollow and sustained is the square-wave lead shape; it is the playofftree duet voice. | GM 73 Flute | medium |
<!-- /GENERATED:nhl92-to-gm -->

## GM → NHL '92

### Family defaults

<!-- GENERATED:families -->
| Family | Programs | Default patch | Why | Runner-up | Sure? |
|---|---|---|---|---|---|
| Piano | 0–7 (4 overridden) | **Patch 21** | No patch has a real piano decay. Patch 21 is the only one with an instant attack and a slow decay (-8 dB at 0.65 s) without a metallic ring or harsh noise. | Patch 13 | low |
| Chromatic percussion | 8–15 (3 overridden) | **Patch 13** | Struck, tonal and metallic, ringing to -20 dB by 0.4 s: the closest thing to bells, mallets and tines. | Patch 8 | low |
| Organ | 16–23 (2 overridden) | **Patch 2** | Sustained with no decay and an even-harmonic reedy spectrum (patch 2 is unused in the game). | Patch 17 | low |
| Guitar | 24–31 (3 overridden) | **Patch 8** | The shortest tonal pluck: it decays before it can sustain, like a picked string. | Patch 13 | low |
| Bass | 32–39 (0 overridden) | **Patch 1** | The only low, round, sustained patch, and the game's own bass voice (FM1, D2-B3, all five songs). | Patch 16 | medium |
| Strings | 40–47 (5 overridden) | **Patch 6** | Sustained and bright with a strong third harmonic, written for vibrato; the nearest to a bowed tone. | Patch 18 | low |
| Ensemble | 48–55 (3 overridden) | **Patch 7** | Slow onset (0.44 s) and a hollow, sustained tone: the pad and choir shape (patch 7 is unused in the game). | Patch 6 | low |
| Brass | 56–63 (4 overridden) | **Patch 16** | Sustained harmonic stack with slight carrier beating, used by the game for its horn. | Patch 18 | medium |
| Reed | 64–71 (4 overridden) | **Patch 2** | Sustained with an even-harmonic reedy tone and a soft onset. | Patch 21 | low |
| Pipe | 72–79 (1 overridden) | **Patch 14** | Almost a pure sine, sustained: the flute, whistle and ocarina shape. | Patch 21 | medium |
| Synth lead | 80–87 (6 overridden) | **Patch 18** | The game's own main lead: bright, sustained and written with vibrato on every note. | Patch 6 | medium |
| Synth pad | 88–95 (4 overridden) | **Patch 7** | Slow onset and a hollow, sustained tone. | Patch 0 | low |
| Synth effects | 96–103 (3 overridden) | **Patch 0** | Slow swell into a bright, full tone; the least conventional pitched patch. | Patch 7 | low |
| Ethnic | 104–111 (4 overridden) | **Patch 8** | Short plucked tones for the plucked instruments in this family. | Patch 13 | low |
| Percussive | 112–119 (5 overridden) | **Patch 13** | Struck, tonal and metallic: bells, agogo and steel drums. The drum programs and the reverse cymbal are overridden. | Patch 8 | low |
| Sound effects | 120–127 (4 overridden) | **Patch 15** | Noisy whoosh, the nearest to air, sea and rotor noise. | Patch 12 | low |
<!-- /GENERATED:families -->

### All 128 programs

Programs with no override show their family default.

<!-- GENERATED:programs -->
| GM | Program | NHL 92 match | From | Why | Runner-up | Sure? |
|---|---|---|---|---|---|---|
| 0 | Acoustic Grand Piano | **Patch 21** | family default | (piano default) | Patch 13 | low |
| 1 | Bright Acoustic Piano | **Patch 21** | family default | (piano default) | Patch 13 | low |
| 2 | Electric Grand Piano | **Patch 21** | family default | (piano default) | Patch 13 | low |
| 3 | Honky-tonk Piano | **Patch 21** | family default | (piano default) | Patch 13 | low |
| 4 | Electric Piano 1 | **Patch 13** | override | Tine and bell ring on the attack suits patch 13's ping better than patch 21's plain tone. | Patch 21 | low |
| 5 | Electric Piano 2 | **Patch 13** | override | Tine and bell ring on the attack suits patch 13's ping better than patch 21's plain tone. | Patch 21 | low |
| 6 | Harpsichord | **Patch 8** | override | Short bright pluck with no sustain. | Patch 13 | low |
| 7 | Clavinet | **Patch 8** | override | Short, percussive, bright pluck. | Patch 13 | low |
| 8 | Celesta | **Patch 13** | family default | (chromatic percussion default) | Patch 8 | low |
| 9 | Glockenspiel | **Patch 13** | family default | (chromatic percussion default) | Patch 8 | low |
| 10 | Music Box | **Patch 13** | family default | (chromatic percussion default) | Patch 8 | low |
| 11 | Vibraphone | **Patch 14** | override | Soft, sine-like ringing tone. | Patch 13 | low |
| 12 | Marimba | **Patch 8** | override | Short, woody, plucked tone. | Patch 13 | low |
| 13 | Xylophone | **Patch 8** | override | Short, woody, plucked tone. | Patch 13 | low |
| 14 | Tubular Bells | **Patch 13** | family default | (chromatic percussion default) | Patch 8 | low |
| 15 | Dulcimer | **Patch 13** | family default | (chromatic percussion default) | Patch 8 | low |
| 16 | Drawbar Organ | **Patch 2** | family default | (organ default) | Patch 17 | low |
| 17 | Percussive Organ | **Patch 17** | override | Bright and sustained, with the repeated-figure organ role patch 17 has in splash. | Patch 2 | low |
| 18 | Rock Organ | **Patch 17** | override | Patch 17 is the other table's match for this program: bright, sustained and harmonically dense. | Patch 2 | low |
| 19 | Church Organ | **Patch 2** | family default | (organ default) | Patch 17 | low |
| 20 | Reed Organ | **Patch 2** | family default | (organ default) | Patch 17 | low |
| 21 | Accordion | **Patch 2** | family default | (organ default) | Patch 17 | low |
| 22 | Harmonica | **Patch 2** | family default | (organ default) | Patch 17 | low |
| 23 | Tango Accordion | **Patch 2** | family default | (organ default) | Patch 17 | low |
| 24 | Acoustic Guitar (nylon) | **Patch 8** | family default | (guitar default) | Patch 13 | low |
| 25 | Acoustic Guitar (steel) | **Patch 8** | family default | (guitar default) | Patch 13 | low |
| 26 | Electric Guitar (jazz) | **Patch 8** | family default | (guitar default) | Patch 13 | low |
| 27 | Electric Guitar (clean) | **Patch 8** | family default | (guitar default) | Patch 13 | low |
| 28 | Electric Guitar (muted) | **Patch 8** | family default | (guitar default) | Patch 13 | low |
| 29 | Overdriven Guitar | **Patch 17** | override | Bright, harmonically dense and sustained; less noisy than patch 5. | Patch 5 | low |
| 30 | Distortion Guitar | **Patch 5** | override | Noisy, dense, sustained, and played as paired low parts in endofperiod; the same patch the other table maps to this program. | Patch 17 | medium |
| 31 | Guitar Harmonics | **Patch 14** | override | Pure, sustained, bell-like tone. | Patch 13 | low |
| 32 | Acoustic Bass | **Patch 1** | family default | (bass default) | Patch 16 | medium |
| 33 | Electric Bass (finger) | **Patch 1** | family default | (bass default) | Patch 16 | medium |
| 34 | Electric Bass (pick) | **Patch 1** | family default | (bass default) | Patch 16 | medium |
| 35 | Fretless Bass | **Patch 1** | family default | (bass default) | Patch 16 | medium |
| 36 | Slap Bass 1 | **Patch 1** | family default | (bass default) | Patch 16 | medium |
| 37 | Slap Bass 2 | **Patch 1** | family default | (bass default) | Patch 16 | medium |
| 38 | Synth Bass 1 | **Patch 1** | family default | (bass default) | Patch 16 | medium |
| 39 | Synth Bass 2 | **Patch 1** | family default | (bass default) | Patch 16 | medium |
| 40 | Violin | **Patch 6** | family default | (strings default) | Patch 18 | low |
| 41 | Viola | **Patch 6** | family default | (strings default) | Patch 18 | low |
| 42 | Cello | **Patch 16** | override | Mellow harmonic stack, lower and less bright than patch 6. | Patch 6 | low |
| 43 | Contrabass | **Patch 1** | override | Low, round and sustained. | Patch 16 | low |
| 44 | Tremolo Strings | **Patch 6** | family default | (strings default) | Patch 18 | low |
| 45 | Pizzicato Strings | **Patch 8** | override | Short plucked tone: pizzicato is the other table's match for patch 8. | Patch 13 | low |
| 46 | Orchestral Harp | **Patch 13** | override | Plucked tone with a ring. | Patch 8 | low |
| 47 | Timpani | **Patch 10** | override | Pitched, decaying low thump: the board-hit patch is the nearest to a tuned drum. | Patch 3 | low |
| 48 | String Ensemble 1 | **Patch 6** | override | Sustained with vibrato, as the strings default; a pad swell is too slow for a string section. | Patch 7 | low |
| 49 | String Ensemble 2 | **Patch 6** | override | Sustained with vibrato, as the strings default; a pad swell is too slow for a string section. | Patch 7 | low |
| 50 | Synth Strings 1 | **Patch 7** | family default | (ensemble default) | Patch 6 | low |
| 51 | Synth Strings 2 | **Patch 7** | family default | (ensemble default) | Patch 6 | low |
| 52 | Choir Aahs | **Patch 7** | family default | (ensemble default) | Patch 6 | low |
| 53 | Voice Oohs | **Patch 7** | family default | (ensemble default) | Patch 6 | low |
| 54 | Synth Voice | **Patch 7** | family default | (ensemble default) | Patch 6 | low |
| 55 | Orchestra Hit | **Patch 5** | override | A loud harsh, dense stab. | Patch 17 | low |
| 56 | Trumpet | **Patch 18** | override | Bright, sustained and brassy; brighter than the foghorn. | Patch 16 | low |
| 57 | Trombone | **Patch 16** | family default | (brass default) | Patch 18 | medium |
| 58 | Tuba | **Patch 16** | family default | (brass default) | Patch 18 | medium |
| 59 | Muted Trumpet | **Patch 21** | override | Thin, hollow, odd-harmonic tone: a muted trumpet is thin and nasal. | Patch 18 | low |
| 60 | French Horn | **Patch 16** | family default | (brass default) | Patch 18 | medium |
| 61 | Brass Section | **Patch 16** | family default | (brass default) | Patch 18 | medium |
| 62 | Synth Brass 1 | **Patch 6** | override | Bright, brassy edge from the 1.5x partial. | Patch 18 | low |
| 63 | Synth Brass 2 | **Patch 0** | override | Slow swell into a bright full tone (the other table maps patch 0 here). | Patch 16 | medium |
| 64 | Soprano Sax | **Patch 2** | family default | (reed default) | Patch 21 | low |
| 65 | Alto Sax | **Patch 2** | family default | (reed default) | Patch 21 | low |
| 66 | Tenor Sax | **Patch 2** | family default | (reed default) | Patch 21 | low |
| 67 | Baritone Sax | **Patch 16** | override | Lower and mellower than the reed default. | Patch 2 | low |
| 68 | Oboe | **Patch 6** | override | Bright and nasal with strong mid harmonics. | Patch 2 | low |
| 69 | English Horn | **Patch 2** | family default | (reed default) | Patch 21 | low |
| 70 | Bassoon | **Patch 16** | override | Lower and mellower than the reed default. | Patch 2 | low |
| 71 | Clarinet | **Patch 21** | override | Odd harmonics dominate, as in a clarinet. | Patch 2 | medium |
| 72 | Piccolo | **Patch 21** | override | High, thin and slightly brighter than a pure sine. | Patch 14 | low |
| 73 | Flute | **Patch 14** | family default | (pipe default) | Patch 21 | medium |
| 74 | Recorder | **Patch 14** | family default | (pipe default) | Patch 21 | medium |
| 75 | Pan Flute | **Patch 14** | family default | (pipe default) | Patch 21 | medium |
| 76 | Blown Bottle | **Patch 14** | family default | (pipe default) | Patch 21 | medium |
| 77 | Shakuhachi | **Patch 14** | family default | (pipe default) | Patch 21 | medium |
| 78 | Whistle | **Patch 14** | family default | (pipe default) | Patch 21 | medium |
| 79 | Ocarina | **Patch 14** | family default | (pipe default) | Patch 21 | medium |
| 80 | Lead 1 (square) | **Patch 21** | override | Odd-harmonic square-wave shape (the other table maps patch 21 here). | Patch 18 | medium |
| 81 | Lead 2 (sawtooth) | **Patch 18** | family default | (synth lead default) | Patch 6 | medium |
| 82 | Lead 3 (calliope) | **Patch 14** | override | Almost a pure tone: plain, like a calliope. | Patch 18 | low |
| 83 | Lead 4 (chiff) | **Patch 6** | override | Bright, sustained, with a strong attack from the 1.5x partial. | Patch 18 | low |
| 84 | Lead 5 (charang) | **Patch 5** | override | Distorted, dense lead. | Patch 18 | low |
| 85 | Lead 6 (voice) | **Patch 7** | override | Hollow, slow-onset, vowel-like tone. | Patch 14 | low |
| 86 | Lead 7 (fifths) | **Patch 6** | override | Its strong 1.5x partial is a fifth above the note, which is the sound of a fifths lead. | Patch 18 | medium |
| 87 | Lead 8 (bass + lead) | **Patch 18** | family default | (synth lead default) | Patch 6 | medium |
| 88 | Pad 1 (new age) | **Patch 7** | family default | (synth pad default) | Patch 0 | low |
| 89 | Pad 2 (warm) | **Patch 7** | family default | (synth pad default) | Patch 0 | low |
| 90 | Pad 3 (polysynth) | **Patch 17** | override | Bright, dense, sustained. | Patch 7 | low |
| 91 | Pad 4 (choir) | **Patch 7** | family default | (synth pad default) | Patch 0 | low |
| 92 | Pad 5 (bowed) | **Patch 6** | override | Sustained and bowed-sounding with a bright harmonic stack. | Patch 7 | low |
| 93 | Pad 6 (metallic) | **Patch 17** | override | Bright, harmonically dense, sustained: the nearest to a metallic pad. | Patch 13 | low |
| 94 | Pad 7 (halo) | **Patch 7** | family default | (synth pad default) | Patch 0 | low |
| 95 | Pad 8 (sweep) | **Patch 0** | override | Slow swell into a bright full tone. | Patch 7 | low |
| 96 | FX 1 (rain) | **Patch 7** | override | Soft, slow, hollow pad. | Patch 0 | low |
| 97 | FX 2 (soundtrack) | **Patch 7** | override | Soft, slow, hollow pad. | Patch 0 | low |
| 98 | FX 3 (crystal) | **Patch 13** | override | Ringing, tonal and metallic. | Patch 14 | low |
| 99 | FX 4 (atmosphere) | **Patch 0** | family default | (synth effects default) | Patch 7 | low |
| 100 | FX 5 (brightness) | **Patch 0** | family default | (synth effects default) | Patch 7 | low |
| 101 | FX 6 (goblins) | **Patch 0** | family default | (synth effects default) | Patch 7 | low |
| 102 | FX 7 (echoes) | **Patch 0** | family default | (synth effects default) | Patch 7 | low |
| 103 | FX 8 (sci-fi) | **Patch 0** | family default | (synth effects default) | Patch 7 | low |
| 104 | Sitar | **Patch 13** | override | Metallic plucked ring. | Patch 8 | low |
| 105 | Banjo | **Patch 8** | family default | (ethnic default) | Patch 13 | low |
| 106 | Shamisen | **Patch 8** | family default | (ethnic default) | Patch 13 | low |
| 107 | Koto | **Patch 8** | family default | (ethnic default) | Patch 13 | low |
| 108 | Kalimba | **Patch 8** | family default | (ethnic default) | Patch 13 | low |
| 109 | Bagpipe | **Patch 2** | override | Sustained reedy tone with no decay. | Patch 5 | low |
| 110 | Fiddle | **Patch 6** | override | Bright, sustained, vibrato-ready bowed lead. | Patch 18 | low |
| 111 | Shanai | **Patch 2** | override | Sustained reedy tone. | Patch 21 | low |
| 112 | Tinkle Bell | **Patch 13** | family default | (percussive default) | Patch 8 | low |
| 113 | Agogo | **Patch 13** | family default | (percussive default) | Patch 8 | low |
| 114 | Steel Drums | **Patch 13** | family default | (percussive default) | Patch 8 | low |
| 115 | Woodblock | **Patch 9** | override | Short dry click. | Patch 8 | low |
| 116 | Taiko Drum | **Patch 10** | override | Low pitched thump with a bright attack. | Patch 3 | low |
| 117 | Melodic Tom | **Patch 10** | override | Pitched, decaying thump: closest to a tuned tom. | Patch 3 | low |
| 118 | Synth Drum | **Patch 10** | override | Pitched, decaying thump with a bright attack. | Patch 3 | low |
| 119 | Reverse Cymbal | **Patch 11** | override | Noise that grows for half a second then cuts (the other table maps patch 11 here). | Patch 15 | medium |
| 120 | Guitar Fret Noise | **Patch 15** | family default | (sound effects default) | Patch 12 | low |
| 121 | Breath Noise | **Patch 15** | family default | (sound effects default) | Patch 12 | low |
| 122 | Seashore | **Patch 15** | family default | (sound effects default) | Patch 12 | low |
| 123 | Bird Tweet | **Patch 14** | override | Pure high tone; a tweet is a short sine glide. | Patch 13 | low |
| 124 | Telephone Ring | **Patch 14** | override | Pure repeated tones are the shape of a ring. | Patch 13 | low |
| 125 | Helicopter | **Patch 15** | family default | (sound effects default) | Patch 12 | low |
| 126 | Applause | **DAC SFX 25 (crowd cheer)** | override | The game plays a crowd-cheer sample (the EA list names SFX 25 "crowd cheer"; 27,007 bytes, about 3.7 s). | Patch 15 | medium |
| 127 | Gunshot | **DAC SFX 13 (slap shot)** | override | The slap-shot crack is the closest percussive burst in the DAC set (EA list: SFX 13 "slap shot"). | Patch 12 | low |
<!-- /GENERATED:programs -->

### GM drum kit (channel 10, notes 35–81)

A patch target's pitch is where to play the patch: the retail pitch for the kick (A0) and snare (F#1), and a starting guess for everything else, to be tuned by ear. Playing a patch short or long (key-off timing) shapes whistles, guiros and hats.

<!-- GENERATED:drums -->
| Note | GM drum | NHL 92 match | Fit | Why | Runner-up |
|---|---|---|---|---|---|
| 35 | Acoustic Bass Drum | **Patch 3 @ A0 (MIDI 21)** | good | Patch 3 is the game's own kick; played at its retail pitch (A0). | Patch 10 @ F1 (MIDI 29) |
| 36 | Bass Drum 1 | **Patch 3 @ A0 (MIDI 21)** | good | Patch 3 is the game's own kick; played at its retail pitch (A0). | Patch 10 @ F1 (MIDI 29) |
| 37 | Side Stick | **Patch 9** | rough | Short dry tick, the puck-on-stick SFX patch. | Patch 8 @ C5 (MIDI 72) |
| 38 | Acoustic Snare | **Patch 4 @ F#1 (MIDI 30)** | good | Patch 4 is the game's snare (backbeat on FM6); played at its retail pitch (F#1). | Patch 12 |
| 39 | Hand Clap | **Patch 4 @ F#1 (MIDI 30)** | rough | A noisy burst is the closest to a clap; there is no patch with a clap's spread of attacks. | DAC SFX 13 (slap shot) |
| 40 | Electric Snare | **Patch 4 @ F#1 (MIDI 30)** | good | Patch 4 is the game's snare; played at its retail pitch (F#1). | Patch 12 |
| 41 | Low Floor Tom | **Patch 10 @ F2 (MIDI 41)** | rough | Pitched, decaying thump with a bright attack; pitch chosen to match the tom (by ear). | Patch 3 @ A1 (MIDI 33) |
| 42 | Closed Hi-Hat | **Patch 12** | none | No tight, noisy tick exists. Patch 12 is the nearest noise, but its 70 ms attack is far too slow for a closed hat. | Patch 9 |
| 43 | High Floor Tom | **Patch 10 @ G2 (MIDI 43)** | rough | Pitched, decaying thump; pitch chosen to match the tom (by ear). | Patch 3 @ B1 (MIDI 35) |
| 44 | Pedal Hi-Hat | **Patch 12** | none | No tight, noisy tick exists (as the closed hat). | Patch 9 |
| 45 | Low Tom | **Patch 10 @ A2 (MIDI 45)** | rough | Pitched, decaying thump; pitch chosen to match the tom (by ear). | Patch 3 @ C#2 (MIDI 37) |
| 46 | Open Hi-Hat | **Patch 12** | rough | Bright noise with a slow decay: a washy, open sound. | Patch 15 |
| 47 | Low-Mid Tom | **Patch 10 @ B2 (MIDI 47)** | rough | Pitched, decaying thump; pitch chosen to match the tom (by ear). | Patch 3 @ D#2 (MIDI 39) |
| 48 | Hi-Mid Tom | **Patch 10 @ C3 (MIDI 48)** | rough | Pitched, decaying thump; pitch chosen to match the tom (by ear). | Patch 3 @ E2 (MIDI 40) |
| 49 | Crash Cymbal 1 | **Patch 12** | rough | Bright noise that rings out. | Patch 11 |
| 50 | High Tom | **Patch 10 @ D3 (MIDI 50)** | rough | Pitched, decaying thump; pitch chosen to match the tom (by ear). | Patch 3 @ F#2 (MIDI 42) |
| 51 | Ride Cymbal 1 | **Patch 13 @ C4 (MIDI 60)** | rough | Metallic ping with a short ring; a ride is a ping over a wash, and there is no wash. | Patch 12 |
| 52 | Chinese Cymbal | **Patch 12** | rough | Bright noise with a long decay. | Patch 11 |
| 53 | Ride Bell | **Patch 13 @ C4 (MIDI 60)** | rough | Struck-metal ping with a short ring; the game uses it for the post. | Patch 9 @ C6 (MIDI 84) |
| 54 | Tambourine | **Patch 12** | none | A tambourine is short, high and jingly; patch 12 has the noise but not the length or the jingle. | Patch 9 |
| 55 | Splash Cymbal | **Patch 12** | rough | Bright noise that rings out; play it short for a splash. | Patch 15 |
| 56 | Cowbell | **Patch 13 @ C5 (MIDI 72)** | rough | Tonal metal hit that rings briefly. | Patch 9 @ C5 (MIDI 72) |
| 57 | Crash Cymbal 2 | **Patch 12** | rough | Bright noise that rings out. | Patch 11 |
| 58 | Vibraslap | **Patch 15** | none | A vibraslap rattles and rings; the nearest noise is the whiff patch, which does neither. | Patch 12 |
| 59 | Ride Cymbal 2 | **Patch 13 @ C4 (MIDI 60)** | rough | Metallic ping with a short ring. | Patch 12 |
| 60 | Hi Bongo | **Patch 8 @ G5 (MIDI 79)** | rough | Short tonal blip, played high. | Patch 9 @ G5 (MIDI 79) |
| 61 | Low Bongo | **Patch 8 @ C5 (MIDI 72)** | rough | Short tonal blip, played lower. | Patch 10 @ G3 (MIDI 55) |
| 62 | Mute Hi Conga | **Patch 8 @ D5 (MIDI 74)** | rough | Short tonal blip: a muted conga slap. | Patch 9 @ D5 (MIDI 74) |
| 63 | Open Hi Conga | **Patch 10 @ G3 (MIDI 55)** | rough | Pitched, decaying thump: an open conga tone. | Patch 8 @ G4 (MIDI 67) |
| 64 | Low Conga | **Patch 10 @ C3 (MIDI 48)** | rough | Pitched, decaying thump, played lower. | Patch 8 @ C4 (MIDI 60) |
| 65 | High Timbale | **Patch 8 @ C6 (MIDI 84)** | rough | Short tonal blip, played high. | Patch 13 @ C6 (MIDI 84) |
| 66 | Low Timbale | **Patch 8 @ F5 (MIDI 77)** | rough | Short tonal blip, played lower than the high timbale. | Patch 13 @ F5 (MIDI 77) |
| 67 | High Agogo | **Patch 13 @ C6 (MIDI 84)** | rough | Tonal metal hit that rings briefly, played high. | Patch 8 @ C6 (MIDI 84) |
| 68 | Low Agogo | **Patch 13 @ F5 (MIDI 77)** | rough | Tonal metal hit that rings briefly, played lower. | Patch 8 @ F5 (MIDI 77) |
| 69 | Cabasa | **Patch 12** | none | A cabasa is a short scratchy rattle; patch 12 is the noisiest patch but is washy, not scratchy. | Patch 15 |
| 70 | Maracas | **Patch 12** | none | A maraca is a short, dry rattle; patch 12 is the nearest noise. | Patch 9 |
| 71 | Short Whistle | **Patch 14 @ C6 (MIDI 84)** | good | A pure sustained tone: the game itself uses patch 14 for its whistle. Play a short note. | Patch 21 @ C6 (MIDI 84) |
| 72 | Long Whistle | **Patch 14 @ C6 (MIDI 84)** | good | A pure sustained tone: the game itself uses patch 14 for its whistle. Play a long note. | Patch 21 @ C6 (MIDI 84) |
| 73 | Short Guiro | **DAC SFX 3 (skating)** | rough | The skating sample (EA list SFX 3) is the only scraping sound; cut it short for a short guiro. Not heard by the author of this table. | Patch 12 |
| 74 | Long Guiro | **DAC SFX 3 (skating)** | rough | The skating sample (EA list SFX 3) is the only scraping sound; play it whole for a long guiro. Not heard by the author of this table. | Patch 12 |
| 75 | Claves | **Patch 9 @ C5 (MIDI 72)** | rough | Short dry tick, played high. | Patch 8 @ C6 (MIDI 84) |
| 76 | Hi Wood Block | **Patch 9 @ G4 (MIDI 67)** | rough | Short dry tick. | Patch 8 @ G5 (MIDI 79) |
| 77 | Low Wood Block | **Patch 9 @ G3 (MIDI 55)** | rough | Short dry tick, played low. | Patch 8 @ G4 (MIDI 67) |
| 78 | Mute Cuica | **Patch 14 @ C5 (MIDI 72)** | none | A cuica is a pitch-sliding squeak; the nearest is the sine-like patch, played short. | Patch 8 @ C5 (MIDI 72) |
| 79 | Open Cuica | **Patch 14 @ C5 (MIDI 72)** | none | A cuica is a pitch-sliding squeak; the nearest is the sine-like patch. | Patch 8 @ C5 (MIDI 72) |
| 80 | Mute Triangle | **Patch 13 @ C7 (MIDI 96)** | rough | Short metallic ping, played high. | Patch 9 @ C6 (MIDI 84) |
| 81 | Open Triangle | **Patch 13 @ C7 (MIDI 96)** | rough | Metallic ping that rings, played high. | Patch 9 @ C6 (MIDI 84) |
<!-- /GENERATED:drums -->

Summary:

<!-- GENERATED:drum-summary -->
- **No good match (8):** 42 Closed Hi-Hat; 44 Pedal Hi-Hat; 54 Tambourine; 58 Vibraslap; 69 Cabasa; 70 Maracas; 78 Mute Cuica; 79 Open Cuica.
- **Good match (6):** 35 Acoustic Bass Drum; 36 Bass Drum 1; 38 Acoustic Snare; 40 Electric Snare; 71 Short Whistle; 72 Long Whistle.
- **Rough (33):** every other drum note from 35 to 81.
<!-- /GENERATED:drum-summary -->

The kit has one kick, one snare, one board-thump family, one noisy cymbal-like patch, one metallic ping and a few clicks and tones; there is no closed hi-hat, tambourine, maraca, cabasa, vibraslap or cuica. The DAC samples are hockey effects (checks, puck hits, a slap shot, crowd noises), so only the slap shot, the skating scrape and the crowd cheer are used, and the scrape is a guess.

## Least sure

By count:

<!-- GENERATED:least-sure-counts -->
- NHL 92 → GM patches marked low: 0, 2, 5, 7, 8, 9, 10, 11, 12, 13, 15, 17, 19, 20.
- GM families whose default is marked low: piano, chromatic-percussion, organ, guitar, strings, ensemble, reed, synth-pad, synth-effects, ethnic, percussive, sound-effects.
- Overrides marked low: 48 of 55.
<!-- /GENERATED:least-sure-counts -->

The ones most worth a listen:

- **Patch 5 → GM 30 (Distortion Guitar) and patch 17 → GM 18 (Rock Organ).** Both are harsh, dense and sustained, and the guitar/organ split rests on register and how the songs use them, not timbre. They could swap, or both be organs or both be guitars.
- **Patches 6 and 18 → GM 81, patch 21 → GM 80.** The lead family is saw-like (6, 18) and hollow (21) by harmonic profile, but the measurements cannot separate "saw lead" from "brass" or "square lead" from "clarinet".
- **Patch 1 → GM 39 vs 35 or 38.** Round and sustained with no pluck; which synth or fretless bass is closest is a taste call.
- **Patches 10, 19, 20 → tom (drum 41).** They sound like kick-family thumps; the SFX streams add a falling pitch sweep that the probe note does not, so a kick or a tom could be nearer.
- **Patches 11, 12, 13, 15 and the unused 0, 2, 7, 8.** Matched on measurements only; nothing in the songs says what they were meant to be. Patch 0 (siren → Synth Brass 2) is a sound-alike by envelope, not by role.
- **Registers.** The tables use the note-table pitch. FM sidebands put strong partials at other octaves for several patches (notably 5 and 17), so "same register" is approximate; the lead family measured at its nominal pitch.
- **GM defaults.** Piano → patch 21 and ensemble → patch 7 are low-confidence stand-ins; 22 patches have no real piano or strings.
- **Drums 73 and 74 → the skating DAC sample** are untested guesses: the sample is a skating sound by the EA list but the disassembly labels it "whistle".

## Editing a match

1. Edit `data/audio/nhl92-gm-map.json`: change a `target`, `reason`, `runnerUp` or `confidence`/`fit`. To change a whole GM family, edit its entry under `families`; to change one program, add or edit an entry under `overrides` (programs without one follow the family).
2. `node test/nhl92-gm-map.js` checks the file (see Tests).
3. `node tools/build-nhl92-gm-map-doc.js` refreshes the tables above.

The analysis file only changes if the data or the render pipeline changes; `node tools/build-nhl92-patch-analysis.js --check` confirms it is current.

## Audition

The **Audio** section (NHL 92) has a *Mapping audition* entry in its collapsible *Instruments* list. Choose a direction (NHL '92 patch → GM, GM program → NHL '92, or GM drum → NHL '92), pick the patch, program or drum note, and read the match, runner-up, confidence and reason shown under it. Buttons: *Play pick, then match* (the pick, a short pause, the mapped sound), *Pick only*, *Match only* and *Runner-up only*. Pitched sounds play an eight-note C-major scale; percussive patches play three hits (the kick and snare at their retail pitch). DAC targets play the sample through the retail Z80 driver. Page checks were done in headless Chromium (the card loads the JSON, renders and builds the playback buffer); nobody has listened to it. The reference sounds are plain synth stand-ins made by `gm-reference.js` (a waveform, an envelope, a little vibrato; noise and sweeps for drums), not a soundfont, so they say which instrument family was meant rather than how a real GM synth sounds. Both sides are played at the same level so loudness does not bias the comparison. The viewer's default view (NHL 92 with the SPA tab) is unchanged.

## Tests (`test/nhl92-gm-map.js`, part of `node test.js`)

- The JSON parses, is valid under `validate()`, and parses identically each time.
- All 22 patches, all 128 GM programs (through the family/override rule) and drum notes 35–81 are mapped, once each.
- Every target exists: GM programs 0–127 and drum notes 35–81 with the standard names, patches 0–21, and DAC targets that really start a DAC sample according to the parser.
- No override repeats its family default; no runner-up repeats its match.
- The generated tables in this doc and the analysis JSON are current (analysis checked with small tolerances on the measured values).
- The GM reference renders every program and drum note deterministically and non-silently.
- The audition planner plans every pick in all three directions (match and runner-up), and every distinct NHL '92 side (patch scales, drum hits, DAC samples) renders audibly through the retail driver.

## Not verified

- **Nothing was listened to.** Matches come from decoded parameters, usage and measured renders; none was compared by ear with a retail game, an emulator or a GM synth.
- The step 4 render is the pipeline's output (retail Z80 driver → ymfm); how it compares with a real YM2612 is open (see [NHL92-SOUND-CHAIN.md](NHL92-SOUND-CHAIN.md)).
- SFX patches are measured as notes, but the game plays them with pitch sweeps (siren, horn, whiff, board hits), which the probe note does not capture.
- The DAC samples were measured but not heard.
- The GM reference is a basic stand-in; "closest to GM program N" means closest to the idea of that instrument, not to any particular soundfont.
