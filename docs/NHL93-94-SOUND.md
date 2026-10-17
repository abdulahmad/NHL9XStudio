# NHLPA 93 and NHL 94 (Genesis) Sound test

The Sound test tab plays the retail sound code of NHLPA 93 and NHL 94 the same way it does for NHL 92: the game's
own 68k driver runs on `m68k-cpu.js`, writes into a shared Z80 RAM, the game's own Z80 program runs from that RAM
(`z80-cpu-core`), and its YM2612 / SN76489 writes drive the ymfm and SN76489 cores. The roll, the clock and the
volume are the NHL 92 ones. Nothing is captured from an emulator; every byte that runs is a ROM byte.

## Pieces

| File | What |
|------|------|
| `lib/audio/nhl9x-68k-harness.js` | The driver runner (`build(cfg)`): trampolines, the game's `sfx` / `song` wrappers (re-assembled from `video94.asm` / `middle93.asm`: `move.w d0,(lastsfx).w` then `jsr play_sfx_or_music_track`), pad ports idle, Z80 window, BUSREQ / RESET. |
| `lib/audio/nhl93-68k-harness.js`, `nhl94-68k-harness.js` | Each game's addresses. |
| `lib/audio/nhl92-sound-chain.js` | Unchanged chain; `create({ driver })` selects the game's harness (default: NHL 92). |
| `data/fixtures/nhl93-sound-slice.bin`, `nhl94-sound-slice.bin` | The sound segments (`$165D8–$2E1FB`, 97,316 bytes; `$1A264–$4B5C0`, 201,564 bytes): driver, Z80 program, FM patches, event streams, PCM. Not full ROMs. |
| `tools/extract-nhl9x-sound-fixture.js` | Refreshes the slices from your ROM (checked by SHA-1 and size). |
| `data/audio/nhlpa93.json`, `nhl94.json` | Names of the 56 / 123 sounds (SFX `$0–$2F`, songs `$30` up). |
| `test/nhl9x-sound-chain.js` | Tests (below). |

Addresses (retail): NHLPA 93 v1.1 `p_turnoff $165D8`, `play_sfx_or_music_track $16608`, `p_music_vblank $166D4`,
`p_initialZ80 $16D92` (the `jsr` in `Begin` at `$6478`), `lastsfx $FFFFBF28`. NHL 94 `p_turnoff $1A264`,
`play_sfx_or_music_track $1A294`, `p_music_vblank $1A50A`, `p_initialZ80 $1ACC2`, `lastsfx $FFFFC016`.

## What differs from NHL 92

- **The 68k waits for the Z80.** `UploadCommandBufferToZ80` only copies when Z80 RAM `$97` is 0 and `$96` is `$7D`;
  otherwise it releases the bus, loops 100 times (`z80_bus_release_delay`) and retries. NHL 92 never waits, so the
  chain's "68k takes no Z80 time" model loops forever when a PCM sample is playing (NHL 94 song `$78`). The harness
  now reports each bus release and the chain runs the Z80 for 480 T-states (the 100-iteration `dbf`, about 1,000 68k
  cycles) every time. NHL 92 never releases the bus mid-call, so its renders are unchanged (its pins still pass).
- **NHL 93 branches to a shared `rts` in game code** (`rtss = $110E0`, from `sound93_stub.asm`). The harness puts
  that one `rts` there.
- **The pad readers run from `p_music_vblank`.** The pad ports read "no button pressed"; the driver's reads are not
  recorded.
- **DAC.** The Z80 program writes `$2B = $80` once at boot and never clears it, so FM6 is always shown as DAC in the
  roll (the driver reserves channel 6 for PCM).

## General MIDI (Play as GM, export, labels)

`lib/audio/nhl9x-song.js` reads the driver's event streams straight from the bundled slices. A stream is 4-byte
events `[delay, status, a, b]` (delay in vblanks before the event; status bits 6-4 select key on/off `$1x`/`$0x`,
patch `$4x`, controller `$3x` (only 7, volume), pitch bend `$6x`; status 0 ends the stream or, with a non-negative
long at +2, loops). NHL 94's `SoundStreamTable` holds long ROM addresses (`$2C648`), NHLPA 93's 16-bit offsets from
the table (`$2870A`); the 32 FM patches sit 1,024 bytes before it. Both games' patch banks are byte-identical, so one
map, `data/audio/nhl9x-gm-map.json`, covers both (FM patches 0-31, PCM patches `$60`-`$6E`).

- **Play as GM / Export MIDI (GM):** every song and sound effect, notes taken from the stream (not from a run of the
  driver), program from the map, PCM patches mapped to drums or crowd voices, velocity = key-on volume x controller 7.
  Pitch bends and mid-note volume changes are not converted. The roll still shows the retail driver while it plays.
- **Song length and seeking:** a stream's length is known, so the song bar shows it and can be scrubbed; a looping
  stream repeats from its loop point after the first pass.
- **Lane labels:** a patch burst is matched to the bank (24 operator bytes + `$B0`) and labelled `P11 · Rock Organ`.
- **How the map was chosen:** `node tools/build-nhl9x-patch-analysis.js` renders one note of each of the 32 FM patches
  through the retail drivers and ymfm (sound $0 of a copy of the NHL 94 slice replaced by a patch select, key on at the
  pitch the songs use, key off after 40 vblanks) and measures envelope, brightness and noisiness like the NHL 92
  analysis; results in `data/audio/nhl9x-patch-analysis.json`. The picks follow those numbers and the patch's role in the
  songs; nothing was auditioned, so every entry carries a confidence and the file is meant to be edited by ear.
  `node test/nhl9x-song-gm.js` checks it.

## Sequencer, MIDI import and pitch bends

The editor's controls are shared by all five games. [SEQUENCER-EDITOR.md](SEQUENCER-EDITOR.md) covers them: the
**Mode** menu (draw notes, select / move, pitch bends), box select, dragging, arrow-key nudge, Delete, hover
tooltips, cursors, Pause, the scrolling playhead, the seconds ruler, the scrub bar and the speaker-synced clock.
What is specific to NHLPA 93 / NHL 94:

- **Sequencer · new NHL 93/94 song** and **MIDI import → NHL 93/94** are the first two entries of the Sound test list
  (`public/sound-tools-nx.js`, model and encoder in `lib/audio/nhl9x-stream.js`). A song is up to eight channels
  (the driver keeps eight per song) of notes on a grid of vblanks, each note with a patch (32 FM patches or the PCM
  drum samples) and a velocity. Click to add or remove a note, pick the channel, instrument, length and velocity, set
  the grid, the length in bars and a loop bar. **Start from…** copies a retail song; every retail song panel also has
  **Edit in sequencer**.
- **Play** encodes the song, appends it to a COPY of the sound slice and points one song-table entry (the last song:
  `$37` / `$7A`) at it, then runs the retail 68k + Z80 drivers on the copy. Every retail byte is untouched (a test
  compares them). NHLPA 93's table holds signed 16-bit offsets, which is fine because only the start offset has to fit.
- **Export:** MIDI (GM), and the event stream as `.asm` (a comment per event) or `.bin`. A loop is an absolute ROM
  address in the stream; relocate it if you place the stream somewhere else.
- **Import:** a GM file goes through the GM → NHL 93/94 table (`gmToNhl` in `nhl9x-gm-map.json`: an exact program match
  from the patch map, else the family's patch; drums become the FM thump, the noise burst or the PCM big-hit sample).
  Channels beyond eight are merged, chords are thinned to the driver's five FM voices, notes are moved by octaves into
  12-95, repeated notes of one key are cut, and the report lists what changed.
- **Pitch bends** are read from MIDI (with the channel's RPN 0 range), written to MIDI (RPN 0 is set to fit), played
  by the reference synth, kept when a retail song is copied, and exported in the stream. The driver bends by
  +-(patch byte `$1E`) semitones over the 14-bit range (PCM patches: 12), so import rescales a bend in semitones to
  the patch in force and clamps what does not fit. In the editor, set **Click: pitch bends** to edit them: the
  channel's bends are drawn as a stepped line across the roll, a click adds a bend whose height is the click's height
  (middle = no bend, top/bottom = the full range) and a click near an existing bend removes it.
- **Instrument editor.** The YM2612 editor (operators, envelopes, algorithm, feedback, pan, AMS/FMS) edits FM patches
  0-31. The edits are written into the slice copy at `table - 1024 + 32 * id` before `host.playEditor`. There is no
  note-offset field: these drivers do not read byte 26. The PCM patches (`$60` and up, 96+) are DAC samples and
  cannot be edited.
- **Edits in the exports.** Native MIDI carries each edited patch in a marker (`NHL9X patch id=11 bytes=…`), restored
  on import. The `.asm` appends a `dc.b` block per patch with its ROM address. The `.bin` appends a `PTCH` block after
  the stream. GM uses the edited bank (bend range). Unedited songs export exactly as before. See
  [SEQUENCER-EDITOR.md](SEQUENCER-EDITOR.md#ym2612-instrument-editor-genesis-only).
- **Seeking** the editor song (scrub bar, ruler) runs the 68k + Z80 drivers ahead silently; see
  [SEQUENCER-EDITOR.md](SEQUENCER-EDITOR.md#playhead-seconds-ruler-and-scrub-bar). The playhead and scrub bar fold
  the run time onto the song's loop point after the first pass.
- **Loop timing:** when a stream loops, its target event fires the moment the end event is reached (its own delay is
  not waited again); `parse()` reports the target event's time as `loopTick`.

## DAC drums and the PCM samples

`tools/build-nhl9x-dac-analysis.js` writes `data/audio/nhl9x-dac-analysis.json`: each of the 13 PCM patches (`$60`-`$6E`) is played through the retail drivers and the `$2A` writes are the waveform, so rate (30.6 kHz here), length, peak, spectrum split and a **fingerprint** (the first 10 values) are measured, not guessed. The same samples are in both games. `$67` and `$6A` are one sample, the "hithigh" body hit.

What the songs do with them: the menu and title songs (NHL 94 `$78`, `$79`, `$7A`, NHL 93 `$35`-`$37`) use **one** PCM sample, `$6A` played at note 76 (note 82 in 93 `$37`), as their snare, and the fixed-pitch FM patch 20 (note 21) as their kick. The PCM hit falls exactly between two kicks (`kickSnarePairs`: median phase 0.5 in NHL 94 `$7A` and NHL 93 `$37`), and in `$78` a run of `$6A` hits with velocity 88, 99, 111, 121, 127 is a snare roll. The long DAC bar the roll used to draw was only `$2B` bit 7 (DAC switched on), which these drivers set for the whole song. A sample's length depends on the note: it is gated by the note's duration, and a higher note plays it faster (1,366 bytes last 0.28 s at note 60 and 0.11 s at note 76).

- **Roll.** The FM6 lane now draws every real PCM hit as a solid block (brightness = peak) over a faint hatch that only says the DAC is on, labelled with the sample (`$6A · Acoustic Snare`) matched by fingerprint, up to the volume scale (`ym-note-tracker` `dacHits`). The Events view lists `PCM hit` lines.
- **GM map.** Patch 20 is now **Bass Drum 1** (was Low Floor Tom); patch 17 (pitched thump) is the Low Floor Tom; `$6A`/103 stay Acoustic Snare. Importing a MIDI kick uses patch 20 at note 21, toms use patch 17, snares and claps use `$6A` at note 76 (the retail pitch, was 70).
- **Instruments and selection.** Every note carries its own instrument, so a channel can switch instruments as often as
  a song wants (13 retail 93/94 songs do, e.g. the intermission song `$79` / `$36`; the encoder writes a patch event
  wherever a channel's instrument changes, checked on every retail song). **Shift-click** notes to select them, change
  the Instrument menu to re-instrument the selection; *Select channel*, *Select this instrument*, *Select none*,
  *Delete selected* and *Set velocity of selected* are next to it, and a line under the toolbar lists the
  instruments each channel uses. In **Click: select / move** you can box-select, drag the selection, nudge it with the
  arrow keys (Shift + ↑ ↓ for an octave) and delete it with Delete.
- **Native MIDI.** *Export MIDI (native)* writes one MIDI tick per vblank, one track per channel, and puts each note's
  patch and every raw bend value into marker events (`NHL c=1 p=17`, `NHL c=1 b=-512`, header `NHL9X v1 game=94 ...`).
  The sequencer's import (and the MIDI import tool) recognises the header and restores the song exactly: tested on
  all 175 retail 93/94 songs. Other players hear the notes and ignore the markers.

## Not done yet

- Per-note volume changes and the volume controller (`$3x` 7) in the sequencer. No retail 93/94 stream uses a controller, and notes already carry their own velocity.
- NHLPA 93 Rev A (`1992.OCT`, runs the track slots twice every 6th frame at 50 Hz) and Rev B are not bundled; the
  slice is the retail v1.1 ROM. PAL timing is not modelled.
- The Audio tab (old square-wave sketch) is hidden for these two games, like NHL 92.

## Checked

`test/nhl9x-sound-chain.js`, per game: every catalog sound runs 40 frames without the driver leaving the sound
code or running away and with no 68k write to Z80 RAM without the bus; at least half make a note or PCM within
0.7 s (51 of 56, 120 of 123); a PCM song streams more than 1,000 `$2A` writes (the bus-wait case); six sounds' YM2612
write logs (300 frames) match pins and repeat; songs and an SFX are audible through ymfm and do not clip. The pins
are self-consistency checks, not captures: nothing here was compared with real hardware or an emulator.
