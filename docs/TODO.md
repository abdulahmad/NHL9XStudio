# NHL9X Studio — TODO (for review)

This list was compiled on 2026-10-20 from the docs and PR bodies on `main` (`7bc33cd`). Items that are already done on `main` are left out. Each item cites where it comes from.

## Music / sound

### Genesis
- **NHL 95 (95G) has no real sound chain.** Only the old AUD-1 square-wave "Audio" sketch exists; there is no YM2612/Z80 path like 92/93/94. (`docs/AGENT-HANDOFF.md`: AUD-1 and the priority section; `public/viewer.js` `hasAudioTab`)
- **93G / 94G sequencer:** per-note volume changes and the volume controller (`$3x` 7) are not handled. (`docs/NHL93-94-SOUND.md`, "Not done yet")
- **93G revisions:** NHLPA 93 Rev A (`1992.OCT`, which runs the track slots twice every 6th frame at 50 Hz) and Rev B are not bundled for sound, and PAL timing is not modelled. (`docs/NHL93-94-SOUND.md`)
- **93G / 94G GM map:** the matches come from measurements; nobody has checked them by ear. (`docs/NHL93-94-SOUND.md`)
- **NHL 92 gaps that are still open** (`docs/NHL92-SOUND-HANDOFF-FOR-CLAUDE.md`, "Gaps still open"; `docs/NHL92-SOUND-CHAIN.md`, "Not verified"):
  - An ear match against the retail game. No MAME/BlastEm capture is allowed.
  - 68k timing within the frame: the copy's offset after vblank isn't measured, the bus hold (about 560–630 T-states) comes from textbook timings, and the Z80 stall isn't modelled.
  - Whether a real YM2612 accepts writes 62 Z80 T-states apart. The driver never reads the busy flag.
  - ymfm compared with a real chip: the WASM build is prebuilt, its chip class and options are unchecked, and idle output is +504.
  - ScriptProcessor underruns on slow clients.
  - **The Sound test on the deployed GitHub Pages site has never been checked by hand.** PR #70's automated load-error test does not count as that check.
- **NHL 92 optional next steps:**
  - Listen against the game with `out/nhl92-sound-chain.zip`.
  - Add cycle counts to `m68k-cpu.js`.
  - Move from ScriptProcessor to AudioWorklet.
  
  (`docs/NHL92-SOUND-HANDOFF-FOR-CLAUDE.md`, "Next steps")

### SNES
- **94S MIDI:**
  - Volume and pan controllers in imported MIDI files. `$DE`/`$DF` are written only by native import.
  - Several sound entries per GM program, with panning.
  - An instrument (BRR sample / ADSR) editor.
  
  (`docs/NHL94S-MIDI.md`, "Not done"; PR #52)
- **94S playback, not ported:**
  - `MusicDuck` and the volume fade.
  - Replay recording (`recsfx*`).
  - The game's effect routing (`PuckSfx`, `CollisionSfx`: which effect plays for which event, and its random pitch).
  
  (`docs/NHL94S-PLAYBACK.md`, "What is not ported"; PRs #49, #51)
- **94S / 93S accuracy by ear:** no capture from a console or emulator has been compared. (`docs/NHL94S-PLAYBACK.md`, "Not checked"; `docs/NHL94S-SOUND-DATA.md:39`)
- **93S:** GM map accuracy by ear, PAL timing, and the tempo-fade model, which is checked only by length. (`docs/NHL93S-SOUND.md`, "Not covered")
- **SNES DSP core, untested against hardware** (`docs/SNES-SOUND-CORE.md`):
  - the boot ROM bytes;
  - the power-on phase of the rate counter;
  - GAIN, end-block and filter edge cases.
  
  The two-way SNES instrument ↔ GM mapping is planned, and its hooks exist.
- See also the 93 SNES section below.

### PC and long-term
- No PC audio yet: 94PC/95PC `.KMS` (AdLib) music and `.VIV` announcer speech. (`docs/DESIGN.md` §3.2; `lib/audio/README.md`)
- Longer-term goals: a full FM patch editor, SPC disassembly upload, importing back to ROM, tracker editing, and MT-32/GUS parity. (`docs/DESIGN.md` §3)
- `MID94-Tools` (cmdstream ↔ MIDI) is "experimental / unfinished, not reliable". (`docs/DESIGN.md`)

## Graphics / images
- GAP-2 (93G): JIM inventory polish (optional). (`docs/AGENT-HANDOFF.md`, Backlog)
- GAP-4 (95G): 27 `ArenaGfx*`, and a full extraction audit against `extractAssets95.js` (optional). (`docs/AGENT-HANDOFF.md`; `docs/DESIGN.md`)
- GAP-5/6 (93S/94S): more Images-tab pictures (scouting, refs, the 94S framer) once the LoROM offsets are pinned. Several Genesis-parity pictures for 94S are still missing. (`docs/AGENT-HANDOFF.md`; `docs/DESIGN.md:111`)
- GAP-7 (95PC): DOS polish: goalie palette edge cases, QFS/PPV catalog holes, hotspot and dynamic rules. (`docs/DESIGN.md`)
- GAP-8 (94PC): extract the retail `HOCKEY.EXE` SPA pack to replace the interim data; tune 94PC hotspots and `frameIsDynamic`. (`docs/AGENT-HANDOFF.md`; PR #9)
- Open visual issues (`docs/AGENT-HANDOFF.md`, Status 2026-10-20):
  - The 93S framer art is a two-shade ring, while 93G's is a four-shade bevel. Unresolved.
  - The 93G/93S Stanley Cup palette was reported wrong but has not been reproduced. We need to know what colour is expected.
  - 94S has no crowd frames.

## Host / product
- HOST-3: OPFS storage is not implemented. HOST-5: the 95 ISO shows a guidance message; mounting is not implemented. (`docs/AGENT-HANDOFF.md`; `docs/DESIGN.md:411`)
- Teams, schedules, ROM build and patches are not implemented. (`docs/DESIGN.md:13`)

## Stale docs
- [x] `lib/audio/README.md` — SNES section updated (2026-10-21).
- [x] `docs/NHL94S-SOUND-DATA.md` — playback vs ear-check wording (2026-10-21).
- [x] `docs/NHL92-SOUND-HANDOFF-FOR-CLAUDE.md` — 95G placeholder only (2026-10-21).
- [x] `docs/AGENT-HANDOFF.md` — 93G/94G sound chain (2026-10-21).

---

## 93 SNES (user-reported, Oct 20 2026)

How this was investigated (read-only):
- `data/audio/nhl93s-sound.json`, `lib/audio/nhl93s-*.js`, `public/sound-test-snes93.js`, `public/sound-test-view.js`, `public/sound-roll-snes.js`.
- NHLPA93SNES at `961fc06`: `src/ram93s.asm`, `src/routines/logic/puck/doshot.asm`, `src/routines/sound/newcheck.asm`, `src/data/sound/*.asm`.
- NHLPA93Genesis: `src/ram93.asm`, `src/logic93.asm`.
- Each effect was played through the SPC700 player while the DSP key-ons were logged (`lib/audio/snes-sfx-midi.js` `capture`).
- The decoded BRR samples were cross-correlated with the 93G PCM files in `data/fixtures/nhl93-sound-slice.bin`, using the 93G file offsets in `lib/audio/nhl93-names.js`.

How the effects are named: every 93S SFX name comes from the `SFX*` equates in NHLPA93SNES `src/ram93s.asm`. `tools/extract-nhl93s-sound.js` copies them into `data/audio/nhl93s-sound.json`, and NHL9X Studio adds no names of its own.

### "are we sure $8D is shotfh and not bh? because it sounds like 93G bh, and same as bd sounds like fh"
(There is no effect `$BD`; the ids run `$80`–`$A1`. This item is read as `$8E`.)

**Investigation:**
- **What the code does (high confidence).** NHLPA93SNES `doshot.asm` sends `SFXshotfh` (`$8D`) for every shot, then switches to `SFXshotbh` (`$8E`) when `SPA == SPAshotb`. `SPAshotb` is the backhand animation (`frames93s.asm`, "backhand shot (93G $94E)"). 93G `logic93.asm` follows the same logic: `$18` by default, `$14` for `SPAshotb`. So the names match what the game does: `$8D` plays on forehand shots and `$8E` on backhands.
- **What the sound is (high confidence).** `$8D` plays game sample `$06` (instrument `$10`), and `$8E` plays sample `$07` (instrument `$11`).
  - The decoded sample `$06` matches the 93G **`sfx_shotbh_pcm`** recording almost exactly: correlation 1.00 at a rate ratio of 1.00 over the 500 samples of the 93G file.
  - Sample `$07` best matches 93G **`sfx_shotfh_pcm`** (correlation 0.39 at a ratio of 1.00; a partial match).
  - `$8F` (`shothard`) plays sample `$09`, then sample `$07`.
- **Conclusion.** You heard it right: the SNES game uses the 93G *backhand* recording for forehand shots and the *forehand* (slap) recording for backhands. The label is correct for the SNES game logic; the recordings are swapped relative to 93G. Whether the SNES developers did this on purpose can't be known (guess: it was a mistake in the port).

**What needs to be done:**
- [x] Keep the names, because they follow the SNES code.
- [x] Add the cross-game fact to the `$8D`/`$8E` notes in `public/sound-test-snes93.js` (`SFX_EXTRA`).
- [ ] Optionally pin the sample match in a test.

### "$90 sounds like check2"
**Investigation:**
- `$90` has two equates, `SFXpuckbody` and `SFXcheck` ("+0/1: check (93 $1C-$1F)"). `newcheck.asm` plays `SFXcheck + random(0/1)`, so a body check is `$90` or `$91` at random.
- `$90` plays game sample `$02` at pitch 832.
- 93G has four check ids, `$1C`–`$1F`, but only two recordings:
  - `sfx_check_pcm` (from 92 `skating34`), used by `$1C` and `$1E`;
  - `sfx_check2_pcm` (from 92 `hitboard`), used by `$1D` and `$1F`.
- The waveform match against both 93G files is weak (≤0.22), so this test can't settle which recording `$90` is (low confidence). The SNES label "check" means "check sound 1 of 2"; it is not a claim that it equals 93G `check1`.

**What needs to be done:** [x] Spectral envelope comparison in `test/nhl93s-pcm-check.js` (slight lean to 93G `check2` / `sfx_check2_pcm`, low confidence); note on `$90` in Sound test UI. Ear check still open.

### "$91 sounds like check3 cut off"
**Investigation:**
- `$91` (`SFXcheck2`) plays game sample `$03`. Its best (weak, 0.22) match is 93G `sfx_check_pcm`, the recording 93G uses for `$1C`/`$1E`, i.e. "check1"/"check3". That fits what you heard (low–medium confidence).
- "Cut off" is plausible from two causes:
  1. Sample `$03` is 4,432 samples long, about 0.68 s at the 6.5 kHz it plays at. 93G's `sfx_check_pcm` is 8,018 bytes, so the SNES copy looks like a shortened version (guess).
  2. The effect keys off at about 0.59 s, before the sample ends (measured in the player). This is how the retail driver behaves, not a playback bug in NHL9X Studio (medium confidence).

**What needs to be done:**
- [x] Note on `$91` in Sound test UI (93G check recording, shortened; retail key-off ~0.59 s).
- [x] Leave playback alone unless a real capture shows that the key-off timing is wrong.
- [ ] Optionally show the sample length against the note length in the details panel.

### "why are instruments there twice"
**Investigation:** In 93S the Instruments list and the Samples list are almost the same thing:
- The instrument table (`bootsound.asm`, 29 entries) maps instruments `$00`–`$08` one to one onto boot samples `$00`–`$08`, and instruments `$0A`–`$1C` one to one onto game samples `$00`–`$12`.
- Instrument `$09` points at sample `$9A`, which doesn't exist. It is an unused or garbage entry.
- A Samples row plays "the first instrument that uses it" (`partInstrument` in `public/sound-test-snes93.js`). So each sound shows up twice, once under Samples and once under Instruments, and both rows play the same probe note (high confidence that this is the duplication you saw).

**What needs to be done:** [x] Merged Samples into Instruments (`public/sound-test-snes93.js`); instrument `$09` marked invalid (sample `$9A` out of range).

### "why cant instruments be in list"
**Investigation:** Read as "why can't I pick the game's instruments from the instrument list in the song editor or MIDI import" (a guess at what you meant). The SNES song editor (`public/sound-tools-snes.js`) offers only the 128 General MIDI programs per track. The game's GM table (`data/audio/nhl93s-gm-map.json`) then picks a game instrument. You can't choose instrument `$0A`–`$1C` directly. If "list" means the main Sound test list instead, instruments are there, but in a collapsed group (`categories.js` `COLLAPSED`).

**What needs to be done:**
- In the SNES editor's instrument menu, add the game's own instruments next to the GM programs (93S `$00`–`$1C`, 94S sound entries).
- Write them natively: the `$E0` INSTRUMENT command for 93S and the native import path for 94S. Write them into the MIDI export as a native track/program marker.
- If the request was about the collapsed group, consider expanding it by default for the SNES games.

### "why aren't all samples there"
**Investigation:**
- The list shows every entry in both sample directories: 9 boot and 19 game (`d.samples` in `lib/audio/nhl93s-sound-data.js` uses counts 9 and 19, the same as `bootsound.asm` and `gamesound.asm`).
- There are unreferenced gaps between directory entries, which may hold BRR data (guess; nothing was decoded there):
  - boot `$2796`–`$27BA`, `$455D`–`$456F` and `$4968`–`$49A7`;
  - game `$ADD9`–`$AE9F`, `$AF1D`–`$AF80` and `$AFDA`–`$B034`.
- `d.samples` stretches each sample to the next directory start, so any such data is silently attached to the sample before it.
- Compared with 93G, SNES has fewer distinct recordings. For example, the 4 shot and 4 check variants collapse into 1–2 samples. So some 93G sounds don't exist in 93S at all.

**What needs to be done:**
- [ ] Find out what is missing: compare the list with the 93G PCM list and say which 93G recordings have no SNES equivalent.
- [x] Sample ends use the BRR end flag (`lib/audio/nhl93s-sound-data.js`); gap decode documented in `test/nhl93s-gaps.js` (pinned regions are tiny BRR fragments only).

### "visualizer is missing"
**Investigation:**
- The SNES voice roll (`public/sound-roll-snes.js`) is mounted for 93S just as for 94S, but it only draws `session.commands`.
- For 93S, `startSession` in `public/sound-test-snes93.js` fills `commands` from the static song timeline, and only for **songs and custom/probe songs**. **Effects** (`player.effect`) get `commands = []`, so the roll stays empty for every SFX (high confidence).
- 94S works because its main-CPU sequencer port logs every command. In 93S the sequencer runs inside the SPC700, so nothing is logged.
- Songs should draw (guess: unverified in a browser).

**What needs to be done:**
- [x] Live DSP voice log for 93S effects in `public/sound-test-snes93.js` (`attachVoiceLog`); songs still use the static timeline.
- [x] `test/nhl93s-voice-roll.js` covers effect + song note counts; browser check still open.
