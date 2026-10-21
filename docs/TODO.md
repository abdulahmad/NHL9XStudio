# NHL9X Studio — TODO (for review)

This list was compiled on 2026-10-20 from the docs and PR bodies on `main` (`7bc33cd`). Items that are already done on `main` are left out. Each item cites where it comes from.

## Music / sound

### Genesis
- [x] **NHL 95 (95G) sound chain:** `nhl95-68k-harness.js`, bundled slice `$AF44–$7A000`, Sound test playback (songs/SFX; no 93/94-style sequencer yet). (`lib/audio/README.md`)
- [x] **93G / 94G sequencer:** per-note key-on volume and MIDI CC 7 / stream `$3x` 7 in `lib/audio/nhl9x-stream.js` (native MIDI markers `v=`). (`docs/NHL93-94-SOUND.md`)
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
- **94S MIDI:** [x] GM import maps CC7 → `$DE` volume and CC10 → `$DF` pan (`$0B`/`$0C`). [x] Basic sound-entry editor (BRR preview, ADSR/GAIN) in the 94 sequencer (`sound-snes-inst-editor.js`). [x] One GM program (drawbar organ) maps to left/right game organ entries via `pan` in `nhl94s-gm-map.json` and MIDI CC10 on import/export.
- **94S playback:** [x] `MusicDuck`, volume fade, `recsfx*`, `PuckSfx` / `CollisionSfx` in `lib/audio/nhl94s-player.js` and the 94 Sound test gameplay buttons (`docs/NHL94S-PLAYBACK.md`).
- **94S / 93S accuracy by ear:** no capture from a console or emulator has been compared. (`docs/NHL94S-PLAYBACK.md`, "Not checked"; `docs/NHL94S-SOUND-DATA.md:39`)
- **93S:** GM map accuracy by ear, PAL timing, and the tempo-fade model, which is checked only by length. (`docs/NHL93S-SOUND.md`, "Not covered")
- **SNES DSP core, untested against hardware** (`docs/SNES-SOUND-CORE.md`):
  - the boot ROM bytes;
  - the power-on phase of the rate counter;
  - GAIN, end-block and filter edge cases.
  
  [x] Two-way SNES instrument ↔ GM mapping in `lib/audio/snes-gm-map.js` (93S/94S JSON maps, MIDI import, Sound test labels). (`docs/SNES-SOUND-CORE.md`)
- See also the 93 SNES section below.

### PC and long-term
- **PC audio:** [x] `.KMS` parser + MIT `opl3` feasibility player; `.VIV` BNK/IFF sniffers (`docs/PC-AUDIO-KMS-VIV.md`, `test/pc-audio-kms.js`). Retail `.kms`/`.viv` files not on the VM — ear match and VIV unpack still open.
- Longer-term goals: a full FM patch editor, SPC disassembly upload, importing back to ROM, tracker editing, and MT-32/GUS parity. (`docs/DESIGN.md` §3)
- `MID94-Tools` (cmdstream ↔ MIDI) is "experimental / unfinished, not reliable". (`docs/DESIGN.md`)

## Graphics / images
- GAP-2 (93G): JIM inventory polish (optional). (`docs/AGENT-HANDOFF.md`, Backlog)
- GAP-4 (95G): [x] 27 `ArenaGfx*` in `genesis-images.js`, contiguous retail slices, decode test when ROM present (`docs/GAP-4-95G-ARENA.md`). Full dev `extractAssets95.js` bitwise audit still optional.
- GAP-5/6 (93S/94S): [x] 94S framer, energy bar, playoff arrows, and crowd sprite strip (658–720) pinned from NHL94SNES. Scouting backdrop is the existing EA Sports backdrop (`MenuBackMap`); dedicated scouting/JIM parity and 93S-only screens (NHLPA logo, playoff on 93S) unchanged. (`docs/AGENT-HANDOFF.md`; `docs/DESIGN.md:111`)
- GAP-7 (95PC): DOS polish: goalie palette edge cases, QFS/PPV catalog holes, hotspot and dynamic rules. (`docs/DESIGN.md`)
- GAP-8 (94PC): extract the retail `HOCKEY.EXE` SPA pack to replace the interim data; tune 94PC hotspots and `frameIsDynamic`. (`docs/AGENT-HANDOFF.md`; PR #9)
- Open visual issues (`docs/AGENT-HANDOFF.md`, Status 2026-10-20):
  - The 93S framer art is a two-shade ring, while 93G's is a four-shade bevel. Unresolved.
  - The 93G/93S Stanley Cup palette was reported wrong but has not been reproduced. We need to know what colour is expected.
  - [x] 94S crowd frames on the Images tab (sprite frames 658–720).

## Host / product
- HOST-3: OPFS storage is not implemented. HOST-5: the 95 ISO shows a guidance message; mounting is not implemented. (`docs/AGENT-HANDOFF.md`; `docs/DESIGN.md:411`)
- Teams, schedules, ROM build and patches are not implemented. (`docs/DESIGN.md:13`)

## Stale docs
- [x] `lib/audio/README.md` — SNES section added.
- [x] `docs/NHL94S-SOUND-DATA.md` — playback vs listening.
- [x] `docs/NHL92-SOUND-HANDOFF-FOR-CLAUDE.md` — 93G/94G chain.
- [x] `docs/AGENT-HANDOFF.md` — 95G catalog-only note.

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
- [x] Add the cross-game fact to the `$8D`/`$8E` notes in `public/sound-test-snes93.js` (`SFX_NOTES`).

### "$90 sounds like check2"
**Investigation:**
- `$90` has two equates, `SFXpuckbody` and `SFXcheck` ("+0/1: check (93 $1C-$1F)"). `newcheck.asm` plays `SFXcheck + random(0/1)`, so a body check is `$90` or `$91` at random.
- `$90` plays game sample `$02` at pitch 832.
- 93G has four check ids, `$1C`–`$1F`, but only two recordings:
  - `sfx_check_pcm` (from 92 `skating34`), used by `$1C` and `$1E`;
  - `sfx_check2_pcm` (from 92 `hitboard`), used by `$1D` and `$1F`.
- The waveform match against both 93G files is weak (≤0.22), so this test can't settle which recording `$90` is (low confidence). The SNES label "check" means "check sound 1 of 2"; it is not a claim that it equals 93G `check1`.

**What needs to be done:** [x] Compared rendered game sample `$02` (effect `$90`) against 93G `sfx_check_pcm` / `sfx_check2_pcm` (`test/nhl93s-sample-match.js`): best match is check1 / skating34 (~0.92 correlation, high confidence). Note is in `SFX_NOTES[0x90]`.

### "$91 sounds like check3 cut off"
**Investigation:**
- `$91` (`SFXcheck2`) plays game sample `$03`. Its best (weak, 0.22) match is 93G `sfx_check_pcm`, the recording 93G uses for `$1C`/`$1E`, i.e. "check1"/"check3". That fits what you heard (low–medium confidence).
- "Cut off" is plausible from two causes:
  1. Sample `$03` is 4,432 samples long, about 0.68 s at the 6.5 kHz it plays at. 93G's `sfx_check_pcm` is 8,018 bytes, so the SNES copy looks like a shortened version (guess).
  2. The effect keys off at about 0.59 s, before the sample ends (measured in the player). This is how the retail driver behaves, not a playback bug in NHL9X Studio (medium confidence).

**What needs to be done:**
- [x] Note in `$91` (`SFX_NOTES[0x91]`: shortened 93G check recording; retail key-off ~0.59 s).
- [x] Playback unchanged (retail timing).

### "why are instruments there twice"
**Investigation:** In 93S the Instruments list and the Samples list are almost the same thing:
- The instrument table (`bootsound.asm`, 29 entries) maps instruments `$00`–`$08` one to one onto boot samples `$00`–`$08`, and instruments `$0A`–`$1C` one to one onto game samples `$00`–`$12`.
- Instrument `$09` points at sample `$9A`, which doesn't exist. It is an unused or garbage entry.
- A Samples row plays "the first instrument that uses it" (`partInstrument` in `public/sound-test-snes93.js`). So each sound shows up twice, once under Samples and once under Instruments, and both rows play the same probe note (high confidence that this is the duplication you saw).

**What needs to be done:** [x] Merged into the Instruments list only (BRR size on each row); instrument `$09` marked invalid.

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
- [x] Each sample now ends at its BRR end flag (`lib/audio/nhl93s-sound-data.js`). On the retail ROM, every directory entry runs exactly to the next start (`d.unreferenced` is empty). Mid-ROM offsets that decode as one-block BRR (e.g. `$455D`) are inside a continuous sample stream, not separate assets.

### "visualizer is missing"
**Investigation:**
- The SNES voice roll (`public/sound-roll-snes.js`) is mounted for 93S just as for 94S, but it only draws `session.commands`.
- For 93S, `startSession` in `public/sound-test-snes93.js` fills `commands` from the static song timeline, and only for **songs and custom/probe songs**. **Effects** (`player.effect`) get `commands = []`, so the roll stays empty for every SFX (high confidence).
- 94S works because its main-CPU sequencer port logs every command. In 93S the sequencer runs inside the SPC700, so nothing is logged.
- Songs should draw (guess: unverified in a browser).

**What needs to be done:**
- [x] Effects: `notesToRollCommands` + capture in `startSession` (`public/sound-test-snes93.js`). Songs still use the timeline.
- [x] Browser: `test/browser/snes93-roll.js`.

## 95 PC (user, Oct 20 2026)

- [ ] Frames are indexed wrong on PC: they should start at 0, not 1.
- [ ] Palette is incorrect: look at what the user's 95PC sprite-extract scripts do, and merge that with rinkpal.
- [ ] SPF needs to be re-evaluated. Many correct ones should be identifiable by frame-matching against 93 and 94.
