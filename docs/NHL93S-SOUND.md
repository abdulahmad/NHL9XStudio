# NHLPA Hockey '93 (SNES) sound

How the Sound test tab plays NHLPA '93 for the Super Nintendo, and how its songs convert to and from MIDI.

## Architecture

'93 has no sequencer on the main CPU (unlike '94). The game uploads a sound program to the SPC700 and then only writes one-byte cues to port 0, with a counter on port 1. The program is a Nintendo N-SPC style sequencer with the songs and effects inside it.

The extractor (`tools/extract-nhl93s-sound.js`) stores the two upload streams byte for byte in `data/audio/nhl93s-sound.json`:

| Stream | Blocks | Started at |
| --- | --- | --- |
| boot | driver `$0400` (9959 B), instruments `$2B00` (174 B), sample directory `$2C00`, boot samples `$2C30` | `$0400` |
| game | sample directory `$2C00` (76 B), game samples `$2C50` (47124 B) | `$0800` |

It checks the ROM SHA-1, the stream addresses, that the blocks equal `data/spc/driver.spc700`, `bootsamples.brr`, `gamesamples.brr` and the `db` lines of the instrument table, and takes cue numbers and effect names from the disassembly. `--check` compares the committed JSON with a fresh extract.

`lib/audio/nhl93s-player.js` does what the main CPU does: the uploads (`$F8` on port 0 asks for the next one), the cue queue (one cue every other video frame) and the frame clock, and runs the program on `lib/audio/snes-spc.js`.

## Cues (port 0)

| Cue | Meaning |
| --- | --- |
| `$00` | stop music |
| `$01`-`$09` | songs (boot set: 1 Playoff screen, 2 unused, 3 Title screen, 9 unused; game set: 4 Home goal, 5 Period start, 6 Third period, 7 unused, 8 Mid-period) |
| `$80`-`$87` | crowd noise level (loops) |
| `$88` | crowd off |
| `$89`-`$A1` | sound effects (pitch-sweep programs, voice from a table) |
| `$F8` | re-upload request |

## Song data

Cue c's order-list pointer is the word at `$0E91 + 2c`. An order list is a list of words: a pointer to eight channel pointers (one set), `$0000` to end, or `$00nn` plus a target for a repeat or jump. Channel streams are durations (with an optional quantise / velocity byte), notes `$80`-`$C7`, tie `$C8`, rest `$C9`, percussion `$CA`-`$DF` and commands `$E0`-`$FA` (instrument, pan, vibrato, volume, tempo, transpose, call, pitch envelope, echo ...). `lib/audio/nhl93s-sound-data.js` reads all of it into a tick timeline. Tick rate is 500 × T / 256 per second for tempo byte T. MIDI note = note byte + transposes + 12.

Verified against the retail program on the SPC700 core: every key-on (tick, channel, note byte) and every key-off of the nine songs matches the timeline (`test/nhl93s-sound-data.js`).

## MIDI

`lib/audio/nhl93s-midi.js`, mapping in `data/audio/nhl93s-gm-map.json`, built from measured probe notes (see [SNES-GM-MAP.md](SNES-GM-MAP.md); not auditioned, adjust by ear).

- **Export (GM)**: one track per channel, notes with GM programs / drum notes from the map, tempo map.
- **Export (native)**: real notes plus `n93:` markers carrying every command, so import gives the same song back.
- **Export song (.bin)**: the flattened song as two upload blocks (song bytes + the cue 7 pointer).
- **Import**: a GM or native file becomes a song for the boot set (at `$8000`, 30464 B free) or the game set (at `$E500`, 4608 B free). Notes are allocated to the 8 voices (the earliest note is cut with a warning), octaves are folded into the 6-octave range. The song replaces cue 7 (unused in the game) and is played by the real program. A song larger than the free RAM is squeezed with the sequencer's pattern call (`$EF addr16 count`): repeated runs of records become patterns shared by all channels (greedy, longest gain first, only as far as needed; no nested calls, the program keeps one return address), and the report says how much it saved. Only if that still does not fit is it reported and not loaded.

## Not covered

- Accuracy by ear of the GM map; PAL timing; the tempo-fade model is checked only by length.
- Effects are not exported to MIDI.
