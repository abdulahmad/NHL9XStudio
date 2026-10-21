# NHL '94 (SNES) sound data (`nhl94s-sound.json`, `nhl94s-sound-data.js`)

Step 2a of the SNES sound work: the data the '94 SNES music needs for playback, extracted into the repo and parsed. **No playback yet.** The cores it will run on are in [SNES-SOUND-CORE.md](SNES-SOUND-CORE.md).

| File | What it is |
|---|---|
| `data/audio/nhl94s-sound.json` | The extracted slices (about 340 KB): 56 songs, 45 BRR samples, the sound tables and sample lists, pitch and volume tables, TeamSongs/DefaultSongs, and the SPC700 sound program. ROM-derived; only what playback needs. |
| `tools/extract-nhl94s-sound.js` | Writes (or `--check`s) that file from the [NHL94SNES disassembly](https://github.com/abdulahmad/NHL94SNES) and its ROM (SHA-1 `10dcd21b…5ff569b36cf5` is checked). |
| `lib/audio/nhl94s-sound-data.js` | Parses the pack: songs and their events, loop walking, tick timing, sound entries, samples. |
| `test/nhl94s-sound-data.js` | Tests, part of `node test.js`. |

## How the pack is made

The disassembly names every label and gives its ROM address (`docs/name_map.csv`) and byte count (the `db`/`dw`/`dd`/`incbin` lines of its data files). The extractor takes the bytes from the ROM at those addresses and compares every numeric `db`/`dw` of the data files with them (222,580 bytes compared, no mismatch). Pointer tables (`GameSampleList`, `TeamSongs`, …) are stored as names, resolved through the label addresses. Every table song and listed sample must exist in the pack.

JSON layout: `source`, `pitchTable` (128 words), `volumeCurve` (128 bytes), `sets.{game,title,menu,intro}` (`sampleList` names; `sounds` = 48-byte entries, the title set uses the menu's), `streamSounds`, `samples.<name>` = `{ loop, length, brr }` (BRR as base64; `loop`/`length` are the sample's 4-byte header, both multiples of the 9-byte block), `songs.<name>` (base64), `teams`, `teamSongs` (6 per team, null = none), `defaultSongs`, `driver` (`load` $0400 and the 1,097-byte SPC700 program).

## Song format (as the main CPU's player reads it)

- **Header:** 8 bytes — byte 1 is the tempo, byte 6 the track count — then word offsets (from the song start) of the tracks, ended by a zero word. Track *k* is the *k*-th offset; in `TitleSong` track 9 is `drums`. Each track sits in a `TRAK` chunk (size word, tag) and starts with an `$E7` name event.
- **Records:** `[delay][event]`. The delay (7 bits per byte, top bit = more) is the wait before the event, **except the first record of a track, whose delay the player reads and drops**. After a loop jump the same applies to the record the jump lands on.
- **Events** (`ReadTrackEvent`, `StepTrack`): below `$D9` a note — the code, a velocity byte, a variable-length duration; `$D9`/`$DA` stop; `$DB` loop jump; `$DC n` instrument (sound `n`, with `$6A` meaning sound `$14`); `$DD n` tempo (tick length); `$DE n` track volume; `$DF c v` controller (`c` = 7 is the volume); `$E2 n` loop mark; `$E3` (no operand); `$E5 a b` pitch bend; `$E7 len …` track name; `$EA n` (stored, unused). Anything else `≥ $D9` takes no operand. All 56 songs parse with no unknown event, every track ends in stop or loop, and track counts match the headers.
- **Loops:** `$DB` jumps to the last `$E2` mark executed, or the track start. The jump lands on the mark's own record (`TrackLoop` is the pointer to its delay), and `walk(track, { repeat })` follows that.
- **Timing** (`MusicStart`, `SequencerTick`): the tempo byte divides 10080 (NTSC) or 8160 (PAL, `STAT78` bit 4); the result (low 8 bits) is the tick length, in units of the frame counter, which gains 64 each video frame. `$DD n` replaces the tick length. `tickFrames` gives the frame of each tick. Frame rates 60.0988 (NTSC) and 50.007 (PAL) are the console's field rates, not from the disassembly.
- **Sample sets:** the organ songs (`Song*`) play with the in-game set (`GameSfxTable`, `GameSampleList`); `TitleSong`, `MenuSong` and `PlayoffSong` play with the menu set — the title screen swaps from the title set to the menu set (`SPCTitleToMenu`) before it starts `TitleSong`.

## Sound entries (48 bytes)

`decodeSound` names the fields whose use I could confirm in the disassembly, and keeps `raw`: pitch offset (+2, added to the pitch in `StartSoundVoice`), note offset (+4), gain (+$A), left/right volume (+$12/+$13), sample (+$14), ADSR1/ADSR2 (+$15/+$16), mono volume (+$17), vibrato rate/speed/depth/direction (+$1C/+$1E/+$20/+$2D), priority (+$2A), bend range (+$2F). `SeqCmd07` sends +$14/+$15/+$16 to the sound program as SRCN, ADSR1, ADSR2; when ADSR1 bit 7 is clear the game sends GAIN with command $0C. The driver numbers samples in upload order, so `sample` indexes the set's sample list.

## What was checked

- **Against the existing `tools/songwav.py`** (an independent Python implementation of the same rules, run once on the same ROM): 154 of 154 tracks match note for note — tick, duration, instrument, note, velocity — on their first pass; the 126 tracks without a loop mark match completely, including the second pass. The other 28 differ **only after the loop jump**, and the cause is in `songwav.py`, not here: its `mark = p - 2` points at the `$E2` status byte, so after the jump it reads the mark itself as a variable-length number and then takes the next record's delay byte for a status byte, producing notes that aren't in the song (for example code `$83`, duration `$35`). `StepTrack` sets `TrackLoop` to the pointer of the mark's own record. `walk()` follows `StepTrack`.
- Hand-worked expectations in the tests: the start of `SongBrassBonanza` from its bytes, variable-length numbers, every event kind, a loop, and tick timing for NTSC, PAL and a tempo change.
- **The SPC700 program runs on the step 1 core:** uploaded through the boot ROM, it clears sound RAM and sets up the DSP in 856,100 CPU cycles (about 0.84 s), reaches its command wait (`$04DA`), answers command $01 (reset) with $01 and returns to the wait. That exercises the CPU, boot ROM, ports, and DSP window with 1,097 bytes of real code.

## Not verified / open

- **Nothing here has been listened to against a console or emulator capture.** Playback runs in NHL9X Studio (`docs/NHL94S-PLAYBACK.md`); ear checks are still open.
- **Pitch offset.** `StartSoundVoice` adds the entry's word at +2 to the note's pitch. The organ entries have values around 1,375 and the first game sound 1,250. `songwav.py` leaves it out (pitch is `PitchTable[(note + noteOffset) & $7F]` alone). Which is right matters for tuning and for the GM map; step 3 should try both against the real driver.
- **Note bit 7.** Note codes go up to `$D8`; the pitch uses `code & $7F`. What bit 7 does is not known.
- **Drum track.** `StepTrack` treats track 9 specially: its note selects the sound (`note − $2F`) and the pitch is fixed (`$3F` + the entry's note offset). `songwav.py` doesn't do this; the parser doesn't interpret it either (it exposes the notes). Playback must.
- **Events not interpreted:** `$E3`, `$E5` (bend; the bend math is in `StepTrack`), `$EA`, vibrato fields, `SoundMono`, music ducking. The parser keeps their values.
- **Streamed samples** (`StreamSample*`) are in the pack but the streaming protocol (commands $0F/$10) is not modelled.
- `FRAME_RATE` values are the standard field rates; PAL tempo uses the disassembly's 8160.

## Next

Step 2b/3: drive the SPC700 program from these songs the way the main CPU does (the commands are documented in `SoundDriver.asm`: sample upload $03, voice setup $07, pitch $06/$0B, key on/off $05/$06, volumes $0E), render through the DSP core, and compare by ear. Then the '93 program, which sequences on the SPC700 and needs different handling.
