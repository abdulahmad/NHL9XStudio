# NHL '92 sequencer, MIDI import and General MIDI playback

Everything here sits on top of the retail sound data. No driver, patch or retail song is changed. The pieces:

| What | Where |
|---|---|
| Lane labels: the instrument each channel loaded last (`P17 · Rock Organ`) | Sound test → Songs (the Roll view) |
| **Play as GM**: a retail song through the NHL 92 → GM table and the plain reference synth | Sound test → Songs |
| **MIDI import → NHL 92**: opens a `.mid`, converts it to an NHL 92 song and opens it in the sequencer | Sound test → MIDI group (the sequencer has its own Import MIDI button too) |
| **Sequencer · new NHL 92 song**: edit, play on the retail drivers, export | Sound test → MIDI group |
| `lib/audio/smf.js` | Standard MIDI File reader and writer |
| `lib/audio/nhl92-song.js` | the song model, the cmdstream encoder, ROM copy, asm and binary export |
| `lib/audio/nhl92-song-gm.js` | NHL 92 ⇄ General MIDI conversions |
| `lib/audio/gm-reference.js` | the plain stand-in GM sounds (`renderEvents` mixes a whole song) |
| `public/sound-tools.js` | the import panel and the editor |
| `test/nhl92-sequencer.js` | tests (part of `node test.js`) |

The mapping tables are in [`docs/NHL92-GM-MAP.md`](NHL92-GM-MAP.md) and `data/audio/nhl92-gm-map.json`. Correcting a match there changes all of the conversions below.

## The song model

A song is a tempo plus six FM channels, each a single line of notes. Times are in **duration units**: the retail duration byte is `$A0 + units` and lasts `units × tempo` vblanks. The editor treats one unit as a 16th note, so four units make a quarter note:

| Tempo (frames per unit) | Quarter-note BPM |
|---|---|
| 6 | 150 |
| 7 | 128 |
| 8 | 112 |
| 12 | 75 |

(BPM = 60 × 59.92 / (4 × tempo); the game runs at 59.92 Hz.) Each note is `{ unit, len, index, patch }`: a start and length in units, the driver's note-table index (MIDI note − 12, indexes 0–95; the retail songs use 9–90) and one of the 22 patches.

Effects, all optional on a note and all kept from retail songs (the driver's rules, from `sound.asm`):

| Field | Command | Meaning |
|---|---|---|
| `mod: {delay, delta}` | `$81 delay delta` | for `delay` frames add `delta` to the note's F-number each frame. Affects **one note**: the driver clears it when the next track data is parsed |
| `env: {id, speed}` | `$86 id speed` / `$87` | pitch envelope 0-3 and its speed. **Channel state**: it stays until changed, so every note that follows carries it. No `env` means envelope off |
| `legato` | `$83` | this note does not key on again or restart its envelope (one note) |
| `noKeyOff` | `$89` | no key-off on this note's last tick (one note) |

The encoder writes the commands in front of the note they belong to, restates the envelope state at the start of a pattern (only in channels that use an envelope), and reports bad values (delay 1-255, delta -128..127, envelope 0-3) instead of writing them. The transpose command (`$88`) is folded into the note index, and the SFX trigger (`$8B`, not used by retail songs) is not modelled. A rebuilt retail song writes the same F-number and key registers as the retail song (tested on songs 0, 1 and 3 over 500 frames, modulation and envelopes included). One known difference: a modulation set before a rest keeps sliding the released note's pitch in the retail song; that is inaudible and is not modelled.

## Retail song → model (`fromParsed`)

The same walk the patch analysis uses: each channel's order list with repeats expanded, one pass, stopping at the restart. Each channel loops on its own at the end of its list, so a shorter channel is tiled to the length of the longest one. Instrument changes, transposes and durations are applied as the driver does (`index = note + patch note offset + transpose`).

## Model → cmdstream (`build`)

Per channel the notes become a flat run of notes and rests that covers the whole song, cut into patterns of at least 16 units. A pattern is written like the retail ones:

```
$80 id        instrument (only before a note whose patch differs from the pattern's current one)
$A0+n         duration, n units (1-95), only when it changes
note / $60    note byte (index − the patch's note offset), or a rest
$84           end of pattern
```

Every pattern restates the instrument and duration it needs, so patterns do not depend on the pattern before them and identical bars are the same bytes. Identical patterns are stored once; the order list is the pattern pointers followed by `$0000` (restart). A channel with no notes is one rest pattern, so all six lists loop together.

Limits, reported as messages instead of being hidden:

- A channel plays one note at a time. Overlaps are cut at the next note's start.
- The longest duration is 95 units; a longer note keeps 95 and the rest is silence.
- Note indexes outside 0–95 (and note bytes the driver can't express) become rests.
- Pattern pointers in order lists are 16-bit BASE-relative words below `$8000`, so patterns must sit in the first 32 KB after `$F4C8`. The retail pattern block (`$1061E`–`$11623`, 4,102 bytes) is the room available without overwriting anything else; the longest retail song uses about 1,960 bytes. A song that does not fit is refused for playback and flagged in the editor.

## Playing on the retail drivers

`romWithSong(rom, built)` makes an in-memory copy of the bundled sound ROM and writes the built song into it as **song 4 (SngPO)**: patterns over the retail pattern block, order lists after the sound module (`$25000`, the song table holds 32-bit pointers), and song 4's 26-byte table entry. The other retail songs' patterns are overwritten in the copy, so the copy plays the custom song only. The Z80 program, patches, note tables and samples are untouched; a test compares every other byte of the copy with the original.

The Sound test then plays song 4 of that copy with the same chain as the retail songs (68k driver → Z80 RAM → Z80 driver → YM2612 + SN76489), so the editor's Play is the real driver, with the live roll and its lane labels below the editor.

## Exports

| Export | Contents |
|---|---|
| MIDI (GM) | the song through the NHL 92 → GM table: each FM channel is a MIDI channel with the mapped program; patches the table sends to a drum become channel-10 hits. 96 PPQ, tempo from the song's tempo, a GM System On message |
| MIDI (native) | the song's own notes, one track per FM channel, no GM mapping. The patch of every note and all effects are in MIDI marker events (`NHL c=2 p=7 e=1,-128 m=8,5 l k`), so **importing the file into the sequencer restores the song exactly** (instruments, modulation, envelopes, legato, no-key-off). Other MIDI players hear the notes and ignore the markers |
| cmdstream (.asm) | `dc.b` / `dc.w` / `dc.l` source in the disassembly's style: the 26-byte fmtune entry, six order lists with BASE-relative words and `$0000` restart, and the patterns, each with a comment listing its events |
| cmdstream (.bin) | the same bytes as one binary: the 26-byte header, order lists, patterns; pointers are relative to the start of the file |

## MIDI import → NHL 92

A file written by **Export MIDI (native)** is recognised by its `NHL92 v1` marker and loaded as is (no GM mapping, nothing lost). Any other file goes through the conversion below.

Choosing a file in the import panel (or the sequencer's own Import MIDI button) converts it to an NHL 92 song and puts it in the sequencer, ready to edit; Undo brings back the previous song. Along the way `smf.js` reads format 0 and 1 files with PPQ timing (SMPTE timing is refused). `normalizeGm` produces the General MIDI song:

- each note gets the program in force on its channel at its start (default 0); channel 10 is the drum kit;
- drum notes outside 35–81 move to the nearest kit note, zero-length notes get one tick, exact duplicate notes are removed;
- the tempo map is kept; controllers, bank select and sysex are ignored; pitch bends are read (they are used by NHL 93 / 94, not NHL 92) and counted in the report.

The import panel can also play the cleaned-up General MIDI song with the plain reference synth and save it as a General MIDI file.

## GM → NHL 92 (`gmToNhl`, the conversion every import goes through)

1. **Grid.** One unit is a 16th note (a 32nd note if most onsets are off the 16th grid and the tempo allows it). The tempo is the nearest whole number of frames per unit, so the BPM changes slightly; the report gives both. Only the first tempo is used.
2. **Mapping.** Each note goes through the GM → NHL 92 table: melodic notes by program (override, else family default), drum notes by the drum table. Drum notes that the table maps to a patch at a fixed pitch (the kick at MIDI 21, the snare at 30) take that pitch. Targets that are DAC samples can't be played by a song and are skipped.
3. **Lines.** Notes are grouped by (MIDI channel, program), with the kick, the snare and the other percussion each their own group. Each group is made one-note-at-a-time: at each onset the highest note stays (the lowest for bass programs 32–39) and a note ends where the next begins.
4. **Six channels.** Lines are ranked kick, snare, bass, then melodies and other percussion by how many notes they carry. The first six are kept; the report names every line that was dropped.
5. **Range.** Melodic notes move by whole octaves into note indexes 9–90.

The result is a first draft to edit, not a transcription: a piano arrangement with chords loses most of its notes.

## Editing instruments and effects

Every note carries its own instrument, so a channel can change instrument as often as the song wants (the retail songs do). In the sequencer: **shift-click** notes to select them (the note's instrument and effects load into the toolbar); changing the **Instrument** menu re-instruments the selection; **Apply to selected** writes the toolbar's modulation, envelope, legato and no-key-off fields to it; *Select channel*, *Select this instrument*, *Select none* and *Delete selected* help with bigger changes. New notes get the instrument and effects currently in the toolbar. Notes with effects show a tag (`7~EL` = instrument 7, modulation, envelope, legato; `K` = no key-off), the selection is outlined, and the line under the toolbar lists the instruments the channel uses.

## Lane labels

The Roll view names each lane's instrument from the YM2612 writes, not from the song data. `identifyPatch` compares the 24 operator registers and `$B0` of each patch load with the 22 retail patches (`$B4` is skipped: the driver ORs the pan bits in). The label is the patch number and the GM sound the mapping gives it. Every patch load in the five retail songs and in all the tests is one of the 22.

Labels are held per lane: the tracker keeps only the last 8 s of writes, so the view remembers the latest patch load seen at or before the playhead until a newer one replaces it. A seek keeps this correct because the held loads are updated before the old history is dropped.

## Playback position, seeking and Play as GM

- **Visualizer during Play as GM.** Retail songs run the retail drivers silently (a chain with no chip, so about 3 ms a frame) next to the GM audio and feed the same tracker; chain time is the audio clock plus 2 frames (the driver's first note sounds 2 frames after unit 0; checked on songs 0, 2 and 4). SFX run their whole plan once, the tracker is converted to GM notes (`gmFromTracker`) and the same finished tracker is drawn. The sequencer's Play as GM shows the retail drivers playing the same song.
- **SFX as GM.** Only the FM notes the YM2612 was asked for are converted. A patch that the mapping calls a drum becomes one GM drum hit; DAC samples have no notes and are left out, so a DAC-only SFX has the button disabled.
- **Progress bar.** An SFX bar is its 600 vblanks; a song bar is one pass (`units × tempo` frames, checked equal to the repeat period of songs 0, 2 and 4) and the clock shows the pass number. Click or drag the bar, or use ← →, to seek while playing.
- **Seeking the live chain.** The 68k and Z80 drivers only run forward, so a forward seek fast-forwards the running chain with `chain.setMute(true)`: no samples are generated but every register write still reaches the chips, in 25 ms slices. A backward seek starts a new run and fast-forwards. At about 3 ms a frame a seek 60 s into a song takes about 12 s ("Seeking… N%"). GM playback seeks immediately.
- **Export** is on every song panel (MIDI GM, MIDI FM tracks, cmdstream `.asm` and `.bin`, rebuilt from the decoded song, not the retail bytes) and on FM SFX panels (MIDI GM). "Edit in sequencer" copies a song into the editor.

## What was checked

`test/nhl92-sequencer.js`:

- MIDI files: write is deterministic, read-back keeps notes, tempos and programs; a hand-made format 0 file with running status and a velocity-0 note-off; garbage and SMPTE are refused.
- **All five retail songs** are decoded, rebuilt into cmdstreams, put into the ROM copy as song 4 and played for 400 vblanks. Every FM channel has the same number of notes, the same pitches and the same instruments as the retail song, with each note within one frame of the retail frame, and every note sits on its `unit × tempo` grid. The one-frame tolerance is there because a key-on write can land anywhere in a frame and the frame it rounds to depends on how much the Z80 did first.
- A hand-made song: notes, instruments, 12-frame spacing and the loop point on the drivers; the exact bytes of one pattern; patch 4's note offset; silent channels stay silent.
- Problems are reported (out-of-range notes, over-long notes), an over-long song is refused, and the asm and binary exports are well formed.
- GM conversions of every retail song keep every note, stay within six channels and the drum kit, and give identical results on repeat; chords, the six-line limit, kick/snare priority, tempo and the normalisation rules have their own cases.
- The reference synth mixes a song deterministically.

The pages (Play as GM, lane labels, import, the editor, every export button) were driven in headless Chromium: they load, the lanes name the right patches, the editor plays an imported file on the retail drivers and its exports download. The pages have no automated test in the repo.

## Not verified

Nobody has listened to any of this. The GM side is the plain reference synth, not a sound set, and the conversions are only as good as the mapping. The cmdstream export has been tested by playing it on the retail drivers in a ROM copy, not by assembling it into the disassembly's ROM; the `.asm` uses `BASE`-relative labels in the disassembly's style and has not been through its assembler. Browser audio output (the actual sound from the speakers) was not checked.
