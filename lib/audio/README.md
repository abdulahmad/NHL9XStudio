# NHL9X Studio — audio

Genesis (AUD-0 / AUD-1):

- `genesis-constants.js` — ROM offsets (`Hockey.snd`, FMTune, SFX cmdstreams for NHL 92).
- `genesis-92-sequence.js` — NHL 92 68k cmdstream → note schedule (loop table, transpose, instruments).
- `preview-render.js` — Node/browser PCM preview (RMS-testable without Web Audio).
- `m68k-cpu.js` — 68000 interpreter (no dependencies, no cycle timing) for running the retail 68k sound driver. Validated against SingleStepTests 680x0 (`node test/m68k-singlestep.js`, downloads the suite); see `docs/M68K-CORE.md` and `docs/M68K-SINGLESTEP-REPORT.md`.
- `nhl92-68k-harness.js` — step 6: the retail 68k sound driver (ROM bytes) on `m68k-cpu.js`, with a Z80 window, bus/reset ports and the game's `song`/`sfx` wrappers (re-assembled from middle.asm). `nhl92-68k-run.js` makes per-vblank logs, `nhl92-68k-analysis.js` cross-checks them against `nhl92-sound-data.js`, `tools/run-nhl92-68k-driver.js` writes them (hashes pinned in `data/audio/nhl92-68k-driver.json`). See `docs/NHL92-68K-DRIVER.md`.
- `nhl92-sound-chain.js` — step 7: the step 6 68k driver and the step 3/4 Z80 driver on one shared Z80 RAM, frame by frame (59,736 T-states, 68k update at T-state 0), with YM2612/PSG writes fed to the chip cores at their sample times. `nhl92-sound-chain-renders.js` + `tools/render-nhl92-sound-chain.js` render every song, SFX and four mixes to `out/nhl92-sound-chain/` (+ zip; hashes in `data/audio/nhl92-sound-chain.json`); `public/sound-test-view.js` plays it live in the viewer's Sound test tab (NHL 92's only audio tab). See `docs/NHL92-SOUND-CHAIN.md`.
- `nhl9x-68k-harness.js`, `nhl93-68k-harness.js`, `nhl94-68k-harness.js` — the NHLPA 93 / NHL 94 68k sound drivers on the same core, run by `nhl92-sound-chain.js` with `driver:` (the chain gives the Z80 time while the 68k waits for it). Sound test for both games; see `docs/NHL93-94-SOUND.md`, tests in `test/nhl9x-sound-chain.js`.
- `ym-note-tracker.js` — YM2612 writes → notes (UMD, no game knowledge): `$28` key on/off spans per channel (codes 0,1,2,4,5,6 = YM ch1-6), `$A4`/`$A0` block + F-number → note name (checked against the driver's 96-entry note tables), patch bursts (`$30-$9F`, `$B0-$B6`), DAC (`$2A`/`$2B`) and PSG writes. Fed by the chain's read-only taps (`onYmWrite`, `onPsgWrite`, `onYmReset` options of `nhl92-sound-chain.js`) or by a decoded YM log (`trackLog`). Used by the Sound test sequencer (`public/sound-roll.js`); tests in `test/ym-note-tracker.js`.
- `nhl92-gm-map.js` + `data/audio/nhl92-gm-map.json` — NHL 92 patch ↔ General MIDI mapping layer (UMD): names, lookup (`nhl92ToGm`, `resolveProgram`, `resolveDrum`) and `validate()`. The JSON is hand-editable; it changes no driver, patch or sound data. See `docs/NHL92-GM-MAP.md`; tests in `test/nhl92-gm-map.js`.
- `nhl92-gm-analysis.js`, `nhl92-patch-analysis.js` + `tools/build-nhl92-patch-analysis.js` — decode the 22 patches, walk song/SFX usage from the parser and measure a probe note per patch through the step 4 render path; output is `data/audio/nhl92-patch-analysis.json` (generated; `--check` compares).
- `nhl92-gm-map-doc.js` + `tools/build-nhl92-gm-map-doc.js` — regenerate the tables in `docs/NHL92-GM-MAP.md` from the two JSON files (`--check` fails if stale).
- `gm-reference.js` — plain, deterministic GM-style stand-in sounds (128 programs, drums 35-81) for auditioning the mapping; not a real GM sound set. `nhl92-gm-audition.js` plans and renders one audition (picked side, mapped side, level-matched) for the Chip lab's Mapping audition card.
- `smf.js` — Standard MIDI File reader/writer (UMD, formats 0 and 1, PPQ). `nhl92-song.js` — the NHL 92 song model (6 FM channels, notes in duration units), cmdstream encoder (`build`), a ROM copy that plays the built song as song 4 (`romWithSong`), asm/binary export and `identifyPatch`. `nhl92-song-gm.js` — NHL 92 ⇄ General MIDI conversions using `data/audio/nhl92-gm-map.json`. Used by the Sound test's Play as GM, MIDI import and sequencer (`public/sound-tools.js`); see `docs/NHL92-SEQUENCER.md`, tests in `test/nhl92-sequencer.js`.
- `nhl92-sfx-names.js` — SFX and song labels and descriptions by ID, as in EA's SOUNDTAB.DOC and the equates in NHL92Genesis `sound.asm` (handlers, command streams and PCM files use the same labels), plus the game's own ram.asm equates.
- `nhl93-names.js` — NHLPA 93 effect, song and PCM sample names lined up with NHL 92: the 93 labels and `ram93.asm` equates, the 92 sound each shares an equate with, and the 92 sample file each 93 sample is an excerpt of (checked byte for byte by `test/nhl93-names.js`).
- `nhl92-pcm.js` — the 10 raw DAC sample files of NHL 92 (the PCM files NHL92Genesis extracts).
- `z80-cpu-core.js` — vendored `@dcorp80/z80cpu` (regenerate: `node tools/vendor-z80cpu.js`).
- `ym2612.js` — YM2612 register bus (Z80 / harness).
- `ym2612-wasm.js` + `generated/ym2612_wasm.*` — ymfm YM2612 PCM (BSD-3-Clause, see `licenses-ymfm.txt`).
- `sn76489.js` — SN76489 PSG latch/data + sample generator.
- `chip-lab-presets.js` — demo register sequences for `public/chip-lab.html`.
- `z80-machine.js` — Genesis 8K RAM + YM2612 bus + I/O stubs.
- `nhl92-z80-harness.js` — full Genesis Z80 bus (RAM mirror, YM 4000–5FFF, bank 6000, PSG 7F11, 68k window) that logs every YM register write with its T-state (optional `onYmWrite` / `onPsgWrite` hooks forward the writes to real chips without changing the log); `vblank()` applies the 68k `p_music_vblank_fn` write order. Driven by `test/nhl92-z80-driver.js`.
- `nhl92-z80-audio.js` — step 4: the same harness with every YM2612 write forwarded at its T-state to the real ymfm core (and PSG writes to `sn76489.js`), PCM at 53267 Hz (write at T-state `t` lands before sample `floor(t*15/1008)`). Also the 68k vblank input builders, the game's note tables, the 22 patches at Z80 `$02A5` and the DAC SFX list read from the retail handler bytes. UMD, used by Node and `public/chip-lab.js`.
- `nhl92-chip-renders.js` + `tools/render-nhl92-chip-tests.js` — one WAV per patch scale (`patch-00.wav`…`patch-21.wav`) and per DAC SFX, with YM logs, to `out/nhl92-chip-tests/`; `--update` rewrites the pinned hashes in `data/audio/nhl92-chip-tests.json`. Checked by `test/nhl92-z80-audio.js`.
- `wav.js` — deterministic 16-bit PCM WAV writer (optional `smpl` loop) and 16-bit AIFF.
- `kms.js`, `kms-player.js` — wiki Kris `.KMS` parser + MIT `opl3` feasibility player (synthetic tests only; 94/95 PC do not use this container).
- `viv.js` — 94 PC C0 FB VIV (suffix labels), 95 PC OpenSpeechBank (`ReadSpeechSample` DPCM for 47 FB, `loc_A91DA` D7414 for `.NUM`/`.COR`), IFF FORM 8SVX (`sub_8F98F` D7414 + VHDR oneShot/repeat loop) / RIFF XOR `80h`; see `docs/PC-AUDIO-KMS-VIV.md`, `test/pc94-audio.js`, `test/pc95-audio.js`.
- `pc94-kms.js`, `pc94-sfx.js`, `pc94-player.js` — NHL 94/95 PC EACSNDF songs (`sub_8F27A` / `sub_99925`) and PCFF SFX; Audio tab `public/sound-test-pc94.js`.
- ymfm `reset()` does not rewind every internal counter, so a reused chip drifts from a fresh one; restore `chip.saveState()` taken at creation (`loadState`) for reproducible renders, or use `ym2612-wasm.createChip()`.
- `nhl92-z80-golden.js` — replay recorded vblank inputs (`data/captures/nhl92/*.json`) and compare to a retail YM log or VGM.
- `nhl92-z80.js` — extract/load `Z80_Program_Code` (`0x116A6`, `0x598` bytes).
- `nhl92-sound-system.js` — NHL 92 68k↔Z80 vblank hooks + FM/SFX preview schedules (`test.js`; the Z80 test profile that also used it was removed in #66).
- `nhl92-sound-fixture.js` + `data/fixtures/nhl92-sound-slice.bin` — bundled sound region (not a full ROM).
- `z80-cpu.js` — legacy minimal CPU (superseded by `z80-cpu-core.js`).
- `genesis.js` — builds preview schedules; 93/94 use `genesis-events.js`.
- `genesis-events.js` — 4-byte event parser for NHL 93+ (`NhlGenesisEvents` in browser).
- `parse-sound-asm.js` + `data/*-streams.json` — stream tables from disasm `sound*.asm` + `extractAssets*.js`.
- `data/audio/<gameId>.json` — static catalogs (`node tools/build-audio-catalog.js`).

Regenerate 93/94 stream packs: `DISASM93=/path/NHLPA93Genesis DISASM94=/path/NHL94Genesis node tools/build-genesis-stream-data.js`, then `node tools/build-audio-catalog.js`.

Browser: `genesis-constants.js` + `genesis-events.js` + `genesis.js` (`NhlGenesisAudio`) when a ROM is loaded in the viewer (Open file or API `roms/`).

API (optional local server):

- `GET /api/games/:id/audio` — catalog JSON.
- `GET /api/games/:id/audio/preview?entry=<id>` — note schedule (requires ROM in `roms/`).

`tools/build-audio-catalog.js [--rom path] [--game id]` — refresh `data/audio/*.json`; ROM scan helps validate offsets (`lib/audio/genesis-scan.js`).

SNES: NHLPA 93 and NHL 94 SNES sound packs, SPC700 players, GM maps, MIDI import/export, and the Sound test UI (`lib/audio/nhl93s-*.js`, `nhl94s-*.js`, `snes-dsp.js`, `snes-sfx-midi.js`; see `docs/NHL93S-SOUND.md`, `docs/NHL94S-PLAYBACK.md`). NHL 94/95 PC Audio tab: EACSNDF `.KMS`/`.CFG`, PCFF SFX, VIV speech, and (95) IFF desk music (`docs/PC-AUDIO-KMS-VIV.md`).
