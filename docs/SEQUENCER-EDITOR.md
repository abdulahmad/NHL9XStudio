# Sequencer editor (all five sound games)

The first entry in each sound game's Audio list is **Sequencer · new … song**. It is a piano-roll editor that plays
its song on the game's own sound code. Every retail song panel also has **Edit in sequencer**, which copies that song
into it (Undo there brings back your previous song). The song is kept in the browser (`localStorage`), one per game.

| Game | Editor | Song | Plays on | Pitch bends | Instrument editor |
|------|--------|------|----------|-------------|-------------------|
| NHL 92 | `public/sound-tools.js` | 6 FM channels, one note at a time each, 16th-note grid | retail 68k + Z80 drivers, song 4 of a ROM copy ([NHL92-SEQUENCER.md](NHL92-SEQUENCER.md)) | none: the driver has no bend | YM2612, the 22 FM patches |
| NHLPA 93, NHL 94 (Genesis) | `public/sound-tools-nx.js` | 8 channels of notes on a vblank grid | retail drivers, the last song-table entry of a slice copy ([NHL93-94-SOUND.md](NHL93-94-SOUND.md)) | yes | YM2612, FM patches 0-31 |
| NHLPA 93 (SNES) | `public/sound-tools-snes.js` | 8 tracks, a GM program per track, one optional drum track | the game's SPC700 program, through the MIDI import ([NHL93S-SOUND.md](NHL93S-SOUND.md)) | none: no pitch event the importer maps | no |
| NHL 94 (SNES) | `public/sound-tools-snes.js` | as NHLPA 93 SNES | the game's main-CPU sequencer and SPC700 program ([NHL94S-MIDI.md](NHL94S-MIDI.md)) | yes | no |

`public/sound-editor-extras.js` (`NhlEditorExtras`) adds the scrub bar, seconds ruler and playhead to all three
editors. `public/sound-patch-editor.js` (`NhlPatchEditor`) is the instrument editor of the two Genesis editors.

## What a click does: the Mode menu

- **Click: draw notes.** Click an empty cell to add a note on the selected channel or track, using the toolbar's
  instrument, length and velocity (and NHL 92's effects). Click a note of that channel to remove it. Shift-click a note
  to select it without changing modes.
- **Click: select / move.** Click a note to select it, shift-click to add it to or remove it from the selection, or drag
  a box over empty space (shift keeps what was already selected). Drag a selected note to move the whole selection in
  time and pitch. The selected notes are outlined. On NHL 92 a channel plays one note at a time, so a moved note cuts
  the note it runs into and drops one it covers.
- **Click: pitch bends** (NHLPA 93 and NHL 94 Genesis, NHL 94 SNES). The channel's bends are drawn as a stepped line
  across the roll. A click adds a bend whose value is the click's height: the middle is no bend and the top or bottom
  is the full range. A click near an existing bend removes it. **Clear bends** removes them all. The range is ±(patch
  byte `$1E`) semitones on Genesis (12 for PCM patches) and ±2 semitones on NHL 94 SNES. NHL 92 and NHLPA 93 SNES have
  no bend mode.

Keys in select mode, with the roll focused (click it first):

| Key | Does |
|-----|------|
| ← → | move the selection one grid unit earlier or later |
| ↑ ↓ | move it a semitone; with Shift, an octave |
| Delete, Backspace | delete the selection (same as **Delete selected**) |
| Esc | clear the selection |
| Ctrl/Cmd + A | select the whole channel or track |

Moves and deletes go through Undo (50 steps). The toolbar also has *Select channel / track*, *Select this instrument*
(Genesis), *Select none*, *Delete selected* and *Set velocity of selected*. On NHL 92 and NHLPA 93 / NHL 94 Genesis,
changing the Instrument menu re-instruments the selection.

**Hover.** Hovering a note shows a tooltip with its pitch and MIDI number, channel, instrument (with the GM sound the
game's map gives it), start (bar, beat and seconds), length and velocity. Per game it also shows:

- NHL 92: modulation, pitch envelope, legato and key-off.
- NHLPA 93 / NHL 94 Genesis: whether the note starts bent and how many bend changes it has.
- NHL 94 SNES: the bend range during the note in semitones.
- SNES drum tracks: the drum key instead of a program.

The line above the roll shows the channel, note, bar, beat and unit under the pointer. That line always takes up its
height, so text appearing never moves the canvas under the pointer.

**Pointer cursors.** In draw mode the pointer is a crosshair over empty cells and a hand over a note (a click removes
it). In select mode it is the arrow over empty space (drag a box), a hand over a note and the move cursor over a
selected note. In bend mode it is a crosshair.

## Transport

- **▶ Play / ■ Stop** plays the song on the game's sound code.
  - Genesis: the song is built into a copy of the ROM or slice, with instrument edits written in, then
    `host.playEditor(rom, startSec)`.
  - SNES: the notes are written as a Standard MIDI file (`Nhl92Smf.write`) and converted by the game's MIDI import
    (`NhlNhl93sMidi` / `NhlNhl94sMidi.fromSmf`), then played with `host.playSnesEditor(imp, startSec)`.
  - Play starts at the cue (below), or at 0:00.
- **⏸ Pause / ▶ Resume** suspends the AudioContext (`ctx.suspend()`). The emulators stop with it, and the clock is
  pinned at `pausedAt`, the speaker time when Pause was pressed. Resume carries on from the same sample. Seeking works
  while paused and stays paused.
- **▶ Play as GM** (NHL 92 and NHLPA 93 / NHL 94 Genesis) plays the song through the game → GM table and the plain
  reference synth. The roll still follows the retail drivers playing the same song, silently.
- The song plays on the live roll below the editor. Clicking an FM lane there mutes that channel.

## Playhead, seconds ruler and scrub bar

- **Scrolling playhead.** While the song plays, an amber line in the roll follows the audible position. The roll
  scrolls to keep it in view, jumping when it passes 85% of the width and putting it back at 15%. It does not scroll
  while paused, so you can look around. The line is a CSS-positioned element, so following it costs no canvas redraw.
  Past the end of a pass it folds back onto the loop: NHL 92 repeats from the start, NHLPA 93 / NHL 94 Genesis from the
  song's loop point, and SNES songs from the start when **loop** is ticked.
- **Seconds ruler.** Above the roll, scrolled with it. Ticks are spaced at 56 px or more (0.5 s up to 5 min), and an
  amber marker shows where the song is now.
- **Scrub bar.** Above the ruler, one pass of the song, with the time as `0:12.3 / 0:59.7`.
  - Click or drag the bar (mouse or touch; the bar's padding gives a finger-sized target), or click or drag on the
    ruler, to seek.
  - When the bar has focus, ← → step 5% (at least 0.5 s), and Home and End go to the ends.
  - **Playing or paused:** the song jumps there and the playhead and ruler follow. After the first pass of a looping
    song, a seek stays in the pass being heard when the loop repeats that spot.
  - **Stopped:** the spot becomes the **cue**, where the next Play starts. It shows as a hollow marker on the ruler and
    a dimmed playhead, and the roll scrolls to it. A seek while playing does not move the cue.
  - **Cost of a seek.** The retail drivers and sound programs only run forward. A forward seek runs the emulator ahead
    silently: register writes still reach the chips, so the sound is right when it resumes. It runs in 25 ms slices so
    the page stays responsive, and the time reads `seeking N%` meanwhile. A backward seek starts a new run and runs it
    ahead. The Genesis chain runs about 6× real time on a desktop, so a seek 60 s in takes about 10 s; it is slower on
    a phone. The SNES sound unit is quicker. The song pages' progress bars use the same code (`seekLive`, `seekSnes` in
    `public/sound-test-view.js`).
  - The maths is in `NhlEditorExtras.foldRun` (run time → position in a pass) and `NhlEditorExtras.seekRunTime`
    (position → run time to seek to), tested by `test/editor-extras.js`.

## The speaker-synced clock

The emulators run on the main thread. A timer tops up about 0.3 s of sound ahead (the prefetch in
`public/sound-test-view.js`), and a ScriptProcessor copies it to the speakers. A counter of blocks or queued samples
only moves once per audio block (tens of ms) and does not include the device latency. So the rolls, the playhead and
the scrub bar read the clock from what is actually at the speaker:

- **`audibleContextTime()`** is the context time of the sample at the speaker now: `getOutputTimestamp()` advanced by
  `performance.now()` since it was taken. It falls back to `currentTime − outputLatency`, and is pinned to `pausedAt`
  while paused.
- **Genesis (`audibleSource`)** stamps every audio block with its `playbackTime` and its position in the chip's output
  stream. The offset between the two, averaged over the recent contiguous blocks (a jump over 30 ms means a glitch and
  older blocks are dropped), maps `audibleContextTime()` to a chip sample. `host.editorSeconds()` is that sample in
  seconds, minus the driver's 2-frame lead, so the playhead sits on a note when it sounds.
- **SNES (`snesSeconds`)** fits the same block stamps to the session's heard seconds, never runs more than 0.25 s ahead
  of what has been delivered and never steps backwards. Right after a seek, before any block has played (for example
  while paused), it holds the seek target.

## YM2612 instrument editor (Genesis only)

**Instrument editor (YM2612 operators, envelopes)** under the NHL 92 and NHLPA 93 / NHL 94 Genesis toolbars edits the
patch the Instrument menu has selected.

- **The bytes.** A patch is the 32 bytes the retail driver loads: 26 register bytes (DT/MUL, TL, RS/AR, AM/D1R, D2R,
  SL/RR for four operators, then feedback/algorithm and pan/AMS/FMS), a note offset at +26, and bytes the driver keeps.
  - The panel writes the algorithm as an operator chain (`(1 → 2) + (3 → 4)`) and labels carriers (heard) and
    modulators.
  - It gives each operator's multiple, detune, level, rate scaling and envelope (attack, first decay, sustain level,
    second decay, release) with a drawn envelope, plus feedback, pan and the LFO sensitivities.
- **Where the patch lives.** On NHLPA 93 / NHL 94 the 32 FM patches sit 1,024 bytes before the song table
  (`Nhl9xSong.GAMES[g].table - 1024 + 32 * id`). On NHL 92 a patch is at `host.data.patches[id].rom`.
- **Saving and playing edits.** Edits are saved with the song (`patchEdits`, id → 32 bytes). Play writes them into the
  ROM copy before `host.playEditor`, so the retail drivers load the edited instrument.
  - **▶ Audition** plays two notes of the patch.
  - **Reset to retail** drops the edit.
  - **Copy hex** copies the 32 bytes.
  - An edited patch is marked `*` in the menu.
- **PCM patches (96 and up)** on NHLPA 93 / NHL 94 are DAC samples, not FM, so they are not editable. The SNES games
  have no instrument editor yet: their instruments are BRR samples with ADSR.
- **Exports.** The edits apply to live playback (Play and Audition). The exports write the retail patches; see the
  game docs for any change to that.

## SNES song editor (`public/sound-tools-snes.js`)

- **The song.** It is plain notes on eight tracks (voices) at 48 ticks per quarter, with a 16th-note grid.
  - Each track has a GM program (**Instrument**). One track can be the **drums** track, whose notes are GM drum keys
    and play the game's drum sounds.
  - The toolbar also sets tempo (BPM), bars, the **Sound set** and **loop**:
    - NHLPA 93: boot samples (organ, drums, strings) or game samples (fanfare, whistle, crowd).
    - NHL 94: menu / band sounds or game sounds.
- **Play.** The song becomes a Standard MIDI file and goes through the same GM import as the MIDI import tool.
  `data/audio/nhl93s-gm-map.json` or `nhl94s-gm-map.json` picks the game sound for each program, and the result plays
  on the game's sound unit, so it sounds as the game would play that MIDI file. The import's warnings are listed under
  the roll.
  - NHLPA 93 songs replace cue 7, and a song too big for the free sound RAM is refused with the importer's message.
  - NHL 94 songs run on the main-CPU sequencer port.
- **Open MIDI** loads any GM file. **Edit in sequencer** on a retail song starts from that song's GM export, so its
  volume, pan and vibrato commands become plain notes. To keep every command, use **Export MIDI (native)** on the
  song panel instead.
- **Export MIDI (GM)** writes the notes. **Export song (.bin)** writes the game's song bytes: for NHL 94 the song
  data, for NHLPA 93 the block the importer loads.
- The NHLPA 93 / NHL 94 roll below the editor is the SNES voice roll (`public/sound-roll-snes.js`), with its own
  seconds ruler.

## Tests

- `test/editor-extras.js` (in `node test.js`): pass folding and seek targets.
- `test/browser/editor-scrub.js` (Playwright, run on its own; about 3 minutes): for every game at 1280 px with a
  mouse and 390 px with touch, it copies a retail song into the editor and checks:
  - the cue while stopped, and Play from the cue
  - backward and forward seeks while playing
  - both directions while paused, staying paused, then Resume
  - a ruler seek landing the playhead where it was clicked
  - Stop, and no page or console errors
- `test/browser/load-errors.js` (run by `node test.js` when Playwright is installed): every game in every mode at both
  widths, with no page errors, console errors or error text.

## History

The Z80 test profile is gone (#66). It was a pseudo-game in the Game menu with its own Z80 tab, pattern list,
`lib/audio/z80-test-patterns.js` and `/api/z80/*` routes. The Z80 driver, machine and fixture remain for the NHL 92
sound chain, the Chip lab and the tests. A leftover call to its `syncModeTabs()` broke every game load (#67), which is
why `test/browser/load-errors.js` exists.
