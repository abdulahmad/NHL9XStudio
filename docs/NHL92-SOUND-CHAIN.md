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

`node tools/render-nhl92-sound-chain.js [--update]` (about 160 s) writes `out/nhl92-sound-chain/{songs,sfx,mixes}/*.wav`, a `.ymlog.txt` per WAV and `manifest.json`, and zips them to `out/nhl92-sound-chain.zip`. `out/` is git-ignored.

- **Songs 0–4** at step 6's lengths: 3,600 vblanks, and 9,000 for SngTitle so the switch to the reprise is heard. Named like `song-1-SngTitle.wav`.
- **SFX 0–34** at 600 vblanks each, named by ID and `nhl92-sfx-names.js`, e.g. `sfx-13-slap-shot-SFXshotfh.wav`. Each run is boot, one vblank, then `sfx n`, the same sequence as step 6's runs.
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

1. **The siren played straight after boot is nearly silent.** Step 6 found that it skips its patch load, because the cleared instrument byte `$41` equals the siren's instrument 0. So the Z80 never writes patch registers for ch0/ch1, and the YM2612 keeps its reset state (attack rate 0). The WAV peaks at 504 of 32,767. Played over a song (mix 1), the siren loads patches on both channels, because `Sound_InitMusicTrack` set `$41` to `$FF`. In the game the siren comes after music has played. `sfx-00-siren-SFXsiren.wav` is the retail-accurate "first thing after boot" case; worth checking by ear.
2. **SFX don't give a song its instrument back.** `.effect_stop` only clears key-on and marks the channel inactive, and a music channel loads a patch only at its own `$80` command. In mix 0, SngEOP's ch4 notes from vb 196 on play with the whistle's patch `$0465`, and nothing restores the song's patch on that channel before vb 360 (the test checks up to there). After the foghorn, SngEOP gets ch0/ch1 back at its own instrument change at vb 449.
3. **Music updates stretch DAC samples.** The DAC period is 161 + 17 × rate T-states (348 at rate `$0B`, 484 at `$13`), except when the Z80 handles a buffer mid-sample.
   - Under SngEOG, the crowd cheer's 27,006 bytes play at 484 T-states, apart from 186 gaps of 2,406, 15 of 3,648 and 7 of 11,444 (up to 3.2 ms, at patch loads).
   - On its own, "player hits boards" has 30 gaps of 2,003 T-states, from its FM part on ch2.
   - This is the retail Z80 driver's single loop. On hardware, the 68k's bus holds would add short stalls too; they aren't modelled.
4. **The retail ROM pins down step 6's wrapper reconstruction.** `roms/nhl92.bin` holds both middle.asm wrappers, at `$8D94` (`sfx`) and `$8DB8` (`song`). `bmi .none` is a word branch, and `lastsfx` is `($D53C).w`. The harness now uses those bytes, and with the ROM present the step 6 test checks both wrappers byte for byte. The pinned logs didn't change.
5. **SFX 32–34 render identically to SFX 30** (same handler, same WAV hash), as step 6 found.

## Sound test tab

NHL 92 has a **Sound test** tab next to Sound data. Pick song 0–4 or SFX 0–34, then press Play or Stop.

- **Rendering:** each ScriptProcessor block (4,096 samples) steps `Nhl92SoundChain` as many frames as it needs (`keepLogs: false`), on a fresh ymfm chip instance and SN76489. The 53,267 Hz output is linearly resampled (`chip-resampler.js`) to the audio device rate.
- **Lengths:** songs run until Stop; SFX run for 600 vblanks.
- **Leaving:** picking another item or leaving the tab stops playback.
- **Default view:** still NHL 92 with the SPA tab.

Checked in headless Chrome against `node server.js`:

- Song 4 plays at real time (300 frames in 5.0 s), with RMS 0.079 and peak 0.38. Stop gives exact silence, and SFX 13 plays from the list (7,236 YM writes, as in the offline render). The PSG gets 0 writes, there are no page errors, and the result was the same over five runs.
- The browser chain's PCM, before resampling, is byte-identical to Node's for SFX 13 (600 vblanks) and song 4 (600 vblanks).

## Not verified

- **How it sounds against the game.** That's for your ear, with `out/nhl92-sound-chain.zip`. No retail or emulator capture was used.
- **68k timing within the frame:** how long after vblank the copy happens, and how long the bus hold stalls the Z80 (see the frame model).
- **The YM2612 busy flag.** The Z80 harness reads it as never busy, as in steps 3–4.
- **The ymfm core vs a real YM2612:** ladder effect, DAC levels, and the model 1 vs model 2 output stages.
- **The PSG mix level.** The driver never writes the PSG, so it stays silent.
- **GitHub Pages.** The Sound test was checked only on `node server.js`. The Pages workflow copies `public/` and `lib/` the same way it does for the Chip lab, but the deployed site wasn't loaded.
- **Slow machines.** Node renders the chain at about 4× real time on this VM, and headless Chrome kept up with real time; its headroom wasn't measured. On a much slower machine the ScriptProcessor would underrun, which is audible as glitches, not wrong notes.
