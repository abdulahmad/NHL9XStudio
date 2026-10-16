# NHL '92 sound chain (step 7)

Step 7 connects the step 6 68k driver to the step 3/4 Z80 driver and the YM2612, so songs and SFX play end to end from the retail code:

```
game call (song n / sfx n)  ->  68k driver (ROM bytes, m68k-cpu.js)
  -> one shared 8 KB Z80 RAM  ->  Z80 driver (the program the 68k copied in)
  -> YM2612 (ymfm WASM) + SN76489  ->  53,267 Hz stereo PCM
```

Code: `lib/audio/nhl92-sound-chain.js` (UMD, Node and browser). Renders: `lib/audio/nhl92-sound-chain-renders.js` and `tools/render-nhl92-sound-chain.js`. Tests: `test/nhl92-sound-chain.js`, run by `node test.js`. Viewer: the NHL 92 **Sound test** tab (`public/sound-test-view.js`).

No CPU or chip core was changed. The drivers, patches and sound data are the retail bytes.

## One Z80 RAM

The 68k harness takes `z80Ram` and the Z80 harness takes `ram`, and the chain passes both the same `Uint8Array`. Every 68k write to `$A00000`–`$A01FFF` lands where the Z80 runs, including the boot program copy. Straight after the 68k boot, Z80 RAM is the embedded program byte for byte up to `$0596`, apart from the bytes that vblank wrote: the buffer at `$0273`–`$02A2`, the flag at `$02A3` and the SFX bytes at `$00BE`–`$00C3`. Byte `$0597` is never copied (the retail copy is `$597` bytes).

**Handshake.** The chain applies each 68k call's writes in order. `$A11100` and `$A11200` are word writes with bit 8 as the line: BUSREQ 1 requests the bus, and RESET 0 asserts reset. Any Z80 RAM write made while the 68k doesn't hold BUSREQ is recorded in `unheldWrites`; in every run that list stays empty. If a frame ends with BUSREQ held or RESET asserted, the Z80's clock advances with the CPU stopped (`stall`). The retail driver never ends a call that way: every vblank is BUSREQ `$100` then `$0`.

**Reset.** A RESET assertion resets the Z80 and the YM2612; on the Genesis the YM2612's /IC follows the Z80 reset line. The boot asserts reset once, before anything has reached the chip, so this doesn't change any output.

## Frame model and timing

| | |
|---|---|
| Frame | 59,736 Z80 T-states: 262 lines × 3,420 master clocks ÷ 15, so 59.92 Hz |
| YM2612 sample | master ÷ 1,008, so 53,267 Hz; a write at T-state `t` lands before sample `floor(t × 15 / 1008)` |
| Samples per frame | 888.93. Sample positions are absolute, so they don't drift. |

**Why 59,736 and not 59,659.** 59,659 is 3,579,545 ÷ 60, i.e. exactly 60 Hz. The Genesis NTSC vblank runs at 59.92 Hz (262 lines of 3,420 master clocks), and the Z80 runs at master ÷ 15, so a vblank-to-vblank frame is 59,736 T-states. The step 3/4 harness already uses that value (`FRAME_TSTATES`). With 59,659, tempo and DAC pitch would still be right, but each frame would be 77 T-states short of a real vblank interval.

**Where the 68k runs in the frame.** At the start of frame *f* (T-state *f* × 59,736) the 68k side runs atomically, in game order:

1. any game calls queued for that frame (`song n`, `sfx n`); then
2. `p_music_vblank`. Frame 0 is the boot instead: `p_initialZ80`, `p_turnoff`, `p_music_vblank`.

The Z80 then runs to the next frame start. It stops on an instruction boundary, so a frame can overrun by up to one instruction, and the next frame starts that much later.

Why T-state 0:

- `p_music_vblank` only runs from the VBlank interrupt, so a vblank-to-vblank frame puts it at the start by definition.
- What the model drops is the 68k time spent before and during the copy: the game's own VBlank work, then the bus hold while 48 + 7 bytes go over. The 68k core has no cycle timing (`docs/M68K-CORE.md`), so that offset can't be computed.
- That offset delays the Z80's view of the new buffer by a short, nearly constant amount each frame. The Z80 acts on the buffer only when its main loop sees `$02A3` ≠ 1, so the offset shifts that frame's YM writes later and can't reorder them.
- The Z80 also doesn't stall during the bus hold in this model. On hardware, a DAC sample playing at that moment is delayed by the hold.
- The game calls (`song` → `p_initune`, `sfx` → `p_initfx`) write only 68k RAM and the stack; the tests check that they never touch Z80 RAM or the bus. So where they fall within the frame doesn't matter, as long as it's before the next `p_music_vblank`. The chain places them just before it.

## What's rendered

`node tools/render-nhl92-sound-chain.js [--update]` (about 4 minutes) writes `out/nhl92-sound-chain/{songs,sfx,mixes}/*.wav`, a `.ymlog.txt` per WAV and `manifest.json`, and zips them to `out/nhl92-sound-chain.zip`. `out/` is git-ignored.

- **Songs 0–4** at step 6's lengths: 3,600 vblanks, and 9,000 for SngTitle so the switch to the reprise is heard. Named like `song-1-SngTitle.wav`.
- **SFX 0–34** at 600 vblanks each, named by ID and `nhl92-sfx-names.js`, e.g. `sfx-13-slap-shot-SFXshotfh.wav`. Each run is boot, one vblank, then `sfx n`, the same sequence as step 6's runs.
- **SFX 0 after music off** (`sfx-00-siren-SFXsiren-after-music-off.wav`, 603 vblanks): boot, `song 0` (its init vblank), `p_turnoff`, then `sfx 0`. This is the siren as the Sound test plays it; see finding 1.
- **Four mixes** of a song with SFX on top (900 vblanks). "ch n" below is the driver channel, which is YM2612 channel n + 1 (key-on codes 0, 1, 2, 4, 5, 6).

| Mix | Song | SFX on top |
|---|---|---|
| 0 | SngEOP | whistle (ch4) at vb 120, foghorn (ch0 + ch1) at vb 360 |
| 1 | SngPO | siren (ch0 + ch1) at vb 180 |
| 2 | SngEOG | slap shot (DAC) at vb 60, crowd cheer (DAC) at vb 240, player hits boards (DAC + ch2) at vb 480 |
| 3 | SngTitle | hit puck, hit board, hit puck, hit board, puck faceoff, post: every 30 vblanks from vb 120 (ch1/ch2) |

The tool checks every song and SFX run's 68k log against step 6's pinned hash (`data/audio/nhl92-68k-driver.json`); all 40 match. It also fails if the PSG is ever written; it never is. `--update` pins each WAV's and YM log's SHA-256 in `data/audio/nhl92-sound-chain.json`.

## What the tests check (`test/nhl92-sound-chain.js`, about 40 s)

- **Shared RAM and bus.** Both harnesses use one RAM. The program copy is byte for byte. The boot's handshake order is as in sound.asm, and every later vblank is one bus hold. There are no Z80 RAM writes without the bus. A stalled Z80 executes nothing.
- **68k unchanged from step 6.** Song 4 and SFX 13 give the same step 6 log text connected as standalone. The rendered subset's 68k logs match the step 6 pins.
- **Siren after music off.** The render matches its pins. After the `p_turnoff` vblank every channel's `$41` is `$FF`. The three prelude vblanks write only key-offs and the empty-DAC `$2B` pair. Key-ons appear only on codes 0/1 and only from the siren's vblank on, and both siren channels get their patch. The bare-boot siren is a flat line (range 0); this one swings −4,264…4,999.
- **Pinned output.** SFX 0, 13, 15 and 24 and mixes 0 and 1 are re-rendered, and their WAV and YM-log hashes match the manifest. A second render of SFX 24 is byte-identical. WAV length is exactly `sampleAt(frames × 59,736)` at 53,267 Hz, and the PSG has 0 writes and a peak of 0.
- **Buffer oracle.** In every frame, the non-DAC YM writes are exactly what step 3's slot decode makes of the bytes the Z80 finds at `$0273`–`$02A3` after that vblank: patch, key off/on, frequency, TL, in slot order. This covers every key-on and frequency.
  - With update flag 1, the 68k sends no buffer and the Z80 writes nothing.
  - An SFX request with no music update clears the flag without a buffer (step 3). The Z80 then reprocesses slots it has already consumed, which writes nothing.
  - Checked on the six renders, mix 2 and 8,471 frames of SngTitle.
- **DAC.** Each DAC request writes `$2B=$80`, then every ROM byte from (`$BF:$BE`)+1 in bank `$C2` to the 0 terminator (skipping window `$FFFF`), then `$2B=$00`. If a new request arrives first, the writes so far must be a prefix of that sequence. This covers the empty boot/song-start sample `$14882`, slap shot `$11C3E`, crowd cheer `$16E04` and player hits boards `$14886`.
- **SFX take channels and hand them back.** Against a song-only run, each SFX changes its channels' slot commands over one contiguous span of vblanks:
  - whistle: vb 120–136 on ch4;
  - foghorn: vb 360–451 on ch0 and 360–453 on ch1;
  - siren over SngPO: vb 180–542 and 180–544.
- **SngTitle → reprise.** See the next section for what's asserted.
- **Game calls** never write Z80 RAM, the bus ports or anywhere unexpected.

## SngTitle → reprise in the YM writes

- **vb 8,449:** channels 1–5 fall through into the reprise. The YM gets key-offs on codes 1, 2, 4, 5 and 6 (YM channels 2–6) and key-ons on codes 2, 5 and 6 (YM channels 3, 5 and 6). These are the same key writes as a fresh song 2's first notes, minus channel 0.
- **vb 8,450:** all six channels are keyed off and the empty DAC sample plays (`$2B=$80`, `$2B=$00`).
- **After that,** every frame's register writes equal a fresh song 2 run's. Within each frame the timing is offset by a constant −59 or +208 T-states (267 apart). That's which pass of the Z80's wait loop first sees the update flag, about 75 µs.

## Findings

1. **The siren played straight after boot is nearly silent.** Step 6 found that it skips its patch load, because the cleared instrument byte `$41` equals the siren's instrument 0. So the Z80 never writes patch registers for ch0/ch1, and the YM2612 keeps its reset state (attack rate 0). The WAV peaks at 504 of 32,767. Played over a song (mix 1), the siren loads patches on both channels, because `Sound_InitMusicTrack` set `$41` to `$FF`. In the game the siren comes after music has played. `sfx-00-siren-SFXsiren.wav` is the retail-accurate "first thing after boot" case and stays pinned; its WAV is a constant 504 (ymfm's idle DC level), i.e. silence.

   **Hearing the siren without the song.** One vblank of `song 0` sets `$41` to `$FF` but parses no notes: `Sound_UpdateMusicState` runs `Sound_InitMusicTrack` on the init frame and processes channels only from the next one. PR #28 then called `sfx 0` on that next frame, so SngEOP's first notes keyed on codes 2, 4, 5 and 6 alongside the siren. The fix puts `p_turnoff` on the second frame instead. `p_turnoff` only sets `g_AudioStopFlag`, so that vblank runs `Sound_PauseMusic`: music off, SFX reset, empty DAC sample, key-offs. It doesn't touch `$41`. The game itself calls `p_turnoff` at game setup (penalty.asm, before `SetupIce`) and on pause (hockey.asm), so "music initialised, then turned off, then an SFX" is a state retail reaches. Measured: in the prelude the YM gets only key-offs and `$2B=$80/$00`; the siren then loads both patches (`$30`/`$31` on part 0) and keys on codes 0/1 only. Peak 4,999.
2. **SFX don't give a song its instrument back.** `.effect_stop` only clears key-on and marks the channel inactive, and a music channel loads a patch only at its own `$80` command. In mix 0, SngEOP's ch4 notes from vb 196 on play with the whistle's patch `$0465`, and nothing restores the song's patch on that channel before vb 360 (the test checks up to there). After the foghorn, SngEOP gets ch0/ch1 back at its own instrument change at vb 449.
3. **Music updates stretch DAC samples.** The DAC period is 161 + 17 × rate T-states (348 at rate `$0B`, 484 at `$13`), except when the Z80 handles a buffer mid-sample.
   - Under SngEOG, the crowd cheer's 27,006 bytes play at 484 T-states, apart from 186 gaps of 2,406, 15 of 3,648 and 7 of 11,444 (up to 3.2 ms, at patch loads).
   - On its own, "player hits boards" has 30 gaps of 2,003 T-states, from its FM part on ch2.
   - This is the retail Z80 driver's single loop. On hardware, the 68k's bus holds would add short stalls too; they aren't modelled.
4. **The retail ROM pins down step 6's wrapper reconstruction.** `roms/nhl92.bin` holds both middle.asm wrappers, at `$8D94` (`sfx`) and `$8DB8` (`song`). `bmi .none` is a word branch, and `lastsfx` is `($D53C).w`. The harness now uses those bytes, and with the ROM present the step 6 test checks both wrappers byte for byte. The pinned logs didn't change.
5. **SFX 32–34 render identically to SFX 30** (same handler, same WAV hash), as step 6 found.

## Sound test tab

For NHL 92, the **Sound test** is the only audio tab. The Sound data tab and its view were removed; the parser still feeds the Details pane. The Audio tab, AUD-1's square-wave sketch, is hidden for NHL 92 and stays for NHLPA 93–95 and the Z80 test profile. Old `#mode=sounddata` and `#mode=audio` links for NHL 92 open the Sound test. The default view is still NHL 92 with the SPA tab.

- **Using it:** pick song 0–4 or SFX 0–34 in the list. Play/Stop is one button; Space or Enter also toggles it, and double-clicking an item plays it. ↑ ↓ move through the list. The playing item is marked ▶ in the list.
- **Display:** a progress bar and clock show elapsed / total for SFX; songs show elapsed time and loop. The status line shows frame, YM writes and PSG writes. Details lists channels, tempo and order-list lengths for a song, or channels/DAC and the handler address for an SFX. The sprite-only controls (bank, pin, scale, list order, sprite help) are hidden.
- **Sequencer (Channels):** below the clock, seven lanes: FM1–FM6 (key-on codes 0, 1, 2, 4, 5, 6) and PSG. **Roll** draws the last 6 s as a piano roll, newest at the right edge; each lane scales to its own pitches, bars carry the note name, a triangle marks a patch load (a burst of 8 or more different `$30-$9F`/`$B0-$B6` registers on that channel; a lone TL write is a small tick), FM6 shows a hatched **DAC** band while `$2B` bit 7 is set, and the left gutter shows the note sounding now (`DAC` for FM6 during a sample). The PSG lane says "never written by the driver" and would tick per write if it were. **Events** is the same data as a newest-first text list (key on/off, patch, DAC on/off). All of it comes from the YM2612 writes the Z80 makes (`onYmWrite` tap → `lib/audio/ym-note-tracker.js`), not from the parsed song data, so it also works for other games' drivers. The note is the first F-number written within 2,000 T-states of a key-on (the driver keys on about 430 T-states *before* it writes the F-number). The roll is placed at the audible position: each audio block's `playbackTime` and stream position give a line from context time to chip sample, and `AudioContext.getOutputTimestamp()` picks the point on it, so queued samples, the 4,096-sample block and the device latency are all accounted for (the status line's elapsed time still uses the older queue-based `heard()`). It draws on `requestAnimationFrame` and keeps 8 s of events.
- **Volume:** a GainNode after the chain, remembered per browser. It scales the output only; the rendered samples are unchanged.
- **Rendering:** each ScriptProcessor block (4,096 samples) steps `Nhl92SoundChain` as many frames as it needs (`keepLogs: false`), on a fresh ymfm chip instance and SN76489. The 53,267 Hz output is linearly resampled (`chip-resampler.js`) to the audio device rate.
- **Lengths:** songs run until Stop; SFX run for 600 vblanks. **Siren (SFX 0)** runs boot, `song 0` (one init vblank, no notes), `p_turnoff`, then the siren (`sfxPlanAfterMusicOff`), the same as `sfx-00-siren-SFXsiren-after-music-off.wav`. Before this, PR #28's plan (song 0, then the siren on the next vblank) let SngEOP's first notes play under it. Other SFX keep step 6's boot, idle vblank, SFX.
- **Leaving:** picking another item or leaving the tab stops playback.

**Chip lab.** Unchanged: YM/PSG presets, plus the NHL '92 patch scales and DAC SFX played through the Z80 driver alone (no 68k driver).

Checked in headless Chromium against `node server.js`, with YM writes hooked in the page:

- Song 4 plays at real time (350 frames in about 5.9 s) and Stop gives silence. SFX 13 plays from the list with 7,236 YM writes, as in the offline render. The browser chain's PCM, before resampling, is byte-identical to Node's for SFX 13 and song 4 (600 vblanks each; checked for PR #27).
- Siren: key-ons only on codes 0/1, and the first is on the siren's own vblank (frame 3). Peak 4,999, 0 PSG writes.
- Space, Enter, double-click, ↑ ↓, the ▶ marker, and the progress/clock all work. SFX 24 reaches "Finished" at 0:10.0 / 0:10.0. Volume survives a reload. Switching to SPA stops playback.
- Tabs: NHL 92 shows Frame/SPF/SPA/Images/Sound test; NHLPA 93 shows Audio; the Z80 test profile shows Audio/Z80; the SNES games show no audio tab. Switching from NHLPA 93's Audio to NHL 92 lands on the Sound test.
- At 390 px wide there's no horizontal scroll.
- There are no page errors. The only failed requests are the expected no-ROM probes (`/api/games/nhl92/rom`, `/anim/Sprites.anim`), plus the Z80 test profile's `frames` request, which 404s on `main` too.
- **Static hosting (stands in for GitHub Pages):** `_site` was assembled exactly as `.github/workflows/pages.yml` does and served by a plain static server under `/NHL9XStudio/`. All of the above passed the same way there. The WASM loads with `application/wasm`, and the viewer falls back from `/api/games` (404) to `games.json`.

Sequencer checks (headless Chromium, `node server.js`, Playwright):

- **Right channels.** Song 1 shows notes on all six FM lanes; the siren (SFX 0) only on FM1/FM2; the slap shot (SFX 13) only FM6 as DAC, no FM notes; PSG 0 writes in all three. Polled ~10×/s for 30 s (song 1) and 10 s (SFX), the page's per-lane readout (note name, key state, DAC) equals a Node reference tracker fed from the same plan's YM log at the same audible position: 0 mismatches in about 4,600 lane checks across the desktop and 390 px runs.
- **Keeps time.** Over 30 s of song 1 the audible-position estimate advanced at 1.0002× wall time with 0.44 ms rms (1.8 ms max) residual; the first second has a start-up transient of up to ~40–100 ms while the first blocks arrive. Block bookkeeping was also checked offline against the real resampler with a ramp as input: within 1 source sample (0.019 ms) over 3,000 blocks at 44.1/48/96 kHz, no drift.
- **Real time.** 59.7 chain frames/s over 30 s; rAF 16.7 ms (p95 16.8 ms). Against `main`, the mean audio callback (4,096 samples, 92.9 ms budget at 44.1 kHz) rose from 28.7 to 31.2 ms (song 3), 14.1 to 15.6 ms (SFX 25, the heaviest YM write load) and 28.0 to 29.3 ms (song 4); the worst callback was 54 ms.
- **Layout.** No horizontal scroll at 390 px or 1,280 px; the roll and the event list fit the panel.
- Element screenshots taken mid-run stall the page and perturb the clock numbers; the figures above are from runs without them.

## Not verified

- **The sequencer against your ear.** Position accuracy was measured against the browser's clocks, not by listening. The device latency comes from `getOutputTimestamp()` as the browser reports it; headless Chromium's null output can't confirm it matches a real speaker. The note a lane shows is the nearest equal-tempered semitone of the written F-number (the driver's 96 table entries are within 1.3 cents); pitch bends are drawn as steps between semitones, not as cents.
- **YM2612 features the tracker only counts.** LFO (`$22`), channel 3 special mode (`$27`, `$A8-$AE`) and SSG-EG aren't interpreted; the NHL '92 driver doesn't use them. FM6's key-on during a DAC sample is hidden under the DAC band, as the chip's output is the DAC then.
- **How it sounds against the game.** That's for your ear, with `out/nhl92-sound-chain.zip`. No retail or emulator capture was used.
- **The deployed GitHub Pages site.** It isn't reachable from the build VM. A static copy built the way the workflow builds it passed (above), so what's left is GitHub's hosting itself: the MIME type for `.wasm` and caching.
- **68k timing within the frame.** The model runs the 68k vblank work at T-state 0 and doesn't stall the Z80 during the bus hold. What the code shows:
  - `p_music_vblank` is the last call in the game's vblank handlers (`vb1`/`vb2` in video.asm). On `vb1` it comes after the DMA and game-clock work, which can itself call `sfx`.
  - Inside it, `Sound_UpdateMusicState` runs before the bus request. So the copy lands at a variable, unmeasured offset after vblank starts. `m68k-cpu.js` doesn't count cycles.
  - From the 68000 manual's timings, the bus hold itself (bus request to release: the 48-byte `move.b (a1)+,(a0)+`/`dbf` copy, the SFX bytes and the flag) is about 1,200 68k cycles (about 1,350 when an SFX request is copied too), or about 560–630 Z80 T-states (~1% of a frame). That excludes any wait states for 68k accesses to Z80 RAM, which aren't known here.
  - The driver doesn't wait for BUSACK after requesting the bus.
  - What changes on hardware: each frame's Z80 response, and so its YM writes, starts later by that variable offset, and a DAC sample playing during the hold is stretched by the hold once per frame. Notes, registers and their order don't change. The tests show the Z80 only acts once it sees the flag.
- **The YM2612 busy flag.** The retail Z80 driver never reads YM status (`test/nhl92-z80-driver.js` asserts 0 reads), so the flag can't change what the driver does; the harness would report not busy anyway.
  - The open question is whether a real chip takes every write at the driver's pace. In the chain logs the next port write follows a data write by at least 62 Z80 T-states (17 µs).
  - Gaps under 90 T-states account for 8,850 of 25,225 data writes in SngPO (3,600 vblanks), 2,332 of 41,254 in mix 2, 728 of 1,533 for the siren after music off, and none for the slap shot (DAC only, minimum 287).
  - The YM2612's busy time after a data write isn't established here. If it is longer than 62 T-states and the chip drops writes while busy, some of these writes would be lost on hardware. ymfm applies every write.
- **The ymfm core vs a real YM2612.** The core is a prebuilt WASM build of ymfm (`lib/audio/generated/`, exports `ym2612_*`). Its build options and chip class weren't checked.
  - All-silent output is a constant +504 rather than 0. That fits a discrete-DAC ("ladder effect") model, but it hasn't been confirmed against ymfm's source.
  - DAC level relative to FM, model 1 vs model 2 output stages, and the Mega Drive's analog filtering aren't modelled or compared. The PSG mix level is untested because the driver never writes the PSG.
- **The bare-boot siren WAV.** `sfx-00-siren-SFXsiren.wav` stays pinned as step 6's run (boot, idle vblank, siren). It's a flat line at ymfm's idle level 504: silence, not quiet sound, because no patch loads. The audible siren is `sfx-00-siren-SFXsiren-after-music-off.wav`. Both are in the zip, named so they can't be confused.
- **Slow machines.** Node renders the chain at about 4× real time on this VM, and headless Chromium kept up with real time; its headroom wasn't measured. On a much slower machine the ScriptProcessor would underrun, which is audible as glitches, not wrong notes.
