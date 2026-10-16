# NHL '94 (SNES) songs and MIDI

`lib/audio/nhl94s-midi.js` writes and reads the game's song format and converts songs to and from Standard MIDI files (via `lib/audio/smf.js`). In the site it is behind the Sound test of NHL 94 (SNES): **Export MIDI (GM)**, **Export MIDI (native)** and **Export song (.bin)** on every song, and a **MIDI import → NHL 94 (SNES)** entry at the top of the list.

## Song format

| Part | Bytes |
| --- | --- |
| Header | 8 bytes: `01, tempo, 01, 00, 00, 00, track count, 00`; then word offsets of the tracks up to a zero word (room for 16); the first chunk header is at 42 |
| Chunk | `[length, big endian]` `TRAK` then the records. The length is the distance to the next track's first record (the last one is not used by the game) |
| Record | `[delay, variable length][event]`; the first record's delay is not waited |
| Note | `[code < $D9][velocity][duration, variable length]` |
| Others | `$D9`/`$DA` stop the song, `$DB` loop (to the last `$E2 n` mark), `$DC n` sound entry, `$DD n` tick length, `$DE n` track volume, `$DF c v` controller, `$E5 lo hi` pitch bend (the MIDI wheel's two bytes), `$E7 n text` name, `$E3` and `$EA n` do nothing |

Every retail track ends with a stop or a loop, and the retail tool leaves padding after it that the player never reads; `modelOf(song, bytes)` keeps it, so all 56 songs are written back byte for byte (tested). Track 9 is the drum track.

## Time and pitch

- A sequencer tick is `floor(10080 / tempo byte) / 64` video frames (NTSC). MIDI export uses 24 ticks per quarter note and the tempo that makes MIDI time equal game time (tempo byte 120 is about 114.5 bpm).
- A note sounds at MIDI key `(code + the sound entry's note offset) & $7F`; the offsets are what put each sample in tune. The sound entry comes from the track's last `$DC`.
- Velocity: the byte indexes `VolumeCurve`; MIDI velocity is the curve value times two (and the nearest curve index on import).

## Export

- **GM**: notes, a program per track from `data/audio/nhl94s-gm-map.json` (organ songs: drawbar organ), channel 10 for the drum track with GM percussion keys, tempo changes (`$DD`), pitch bends in semitones (bend range from the sound entry), and loop start/end markers. For other programs.
- **Native**: one MIDI track per game track, notes at the game's own key numbers, and every other event in a marker `n94:<hex bytes>`. Importing it gives the same song: same events on the same ticks (tested on all 56). Notes that start on the same tick come back in key order, which does not change how they sound.

## Import

`fromSmf(bytes, data, gmMap, { set, tempo, loop })`:

- A native file is read back exactly.
- Any other file (format 0 or 1): channel 10 is the drum track (track 9), other channels fill tracks 0-8 and 10-15. Each program change picks a sound entry through the map's `families` (GM programs to the few programs the game has) and the preferred entry for it; each note becomes `code = key - noteOffset`; drum keys go through `drums`; times go through the tempo map to ticks (default tempo byte 160, about one tick a frame). Every track ends with a stop at the song's end tick (or a mark and a loop jump with `loop`).
- Report: tracks, notes, instruments used, length, and warnings: notes dropped (no sound for that drum key or program in the chosen set), more than 8 notes at once (the sound unit has 8 voices; the oldest are cut), more than 15 melodic channels.
- `set` is `menu` (band sounds: kick, snare, hats, toms, brass, guitars, bass, orchestra hit, timpani, organ) or `game` (the arena organ and the clap).

## The map

`data/audio/nhl94s-gm-map.json` is built from measured probe notes, the sample names and how the retail songs use each sound entry, with a reason, confidence and runner-up for each (see [SNES-GM-MAP.md](SNES-GM-MAP.md)). Change it to change both export and import. It does not touch the game's data.

## Not done

Volume controller and pan from the MIDI file (`$DE` / `$DF` are written only by native import), several sound entries per GM program with panning, and editing songs in a sequencer view.
