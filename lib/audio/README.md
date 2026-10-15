# NHL9X Studio — audio

Genesis (AUD-0 / AUD-1):

- `genesis-constants.js` — ROM offsets (`Hockey.snd`, FMTune, SFX cmdstreams for NHL 92).
- `genesis-92-sequence.js` — NHL 92 68k cmdstream → note schedule (loop table, transpose, instruments).
- `preview-render.js` — Node/browser PCM preview (RMS-testable without Web Audio).
- `m68k-cpu.js` — 68000 interpreter (no dependencies, no cycle timing) for running the retail 68k sound driver. Validated against SingleStepTests 680x0 (`node test/m68k-singlestep.js`, downloads the suite); see `docs/M68K-CORE.md` and `docs/M68K-SINGLESTEP-REPORT.md`.
- `nhl92-68k-harness.js` — step 6: the retail 68k sound driver (ROM bytes) on `m68k-cpu.js`, with a Z80 window, bus/reset ports and the game's `song`/`sfx` wrappers (re-assembled from middle.asm). `nhl92-68k-run.js` makes per-vblank logs, `nhl92-68k-analysis.js` cross-checks them against `nhl92-sound-data.js`, `tools/run-nhl92-68k-driver.js` writes them (hashes pinned in `data/audio/nhl92-68k-driver.json`). See `docs/NHL92-68K-DRIVER.md`.
- `nhl92-sfx-names.js` — SFX names by ID (EA sound list + ram.asm equates), with the disassembly's shifted labels/comments for reference.
- `z80-cpu-core.js` — vendored `@dcorp80/z80cpu` (regenerate: `node tools/vendor-z80cpu.js`).
- `ym2612.js` — YM2612 register bus (Z80 / harness).
- `ym2612-wasm.js` + `generated/ym2612_wasm.*` — ymfm YM2612 PCM (BSD-3-Clause, see `licenses-ymfm.txt`).
- `sn76489.js` — SN76489 PSG latch/data + sample generator.
- `chip-lab-presets.js` — demo register sequences for `public/chip-lab.html`.
- `z80-machine.js` — Genesis 8K RAM + YM2612 bus + I/O stubs.
- `nhl92-z80-harness.js` — full Genesis Z80 bus (RAM mirror, YM 4000–5FFF, bank 6000, PSG 7F11, 68k window) that logs every YM register write with its T-state (optional `onYmWrite` / `onPsgWrite` hooks forward the writes to real chips without changing the log); `vblank()` applies the 68k `p_music_vblank_fn` write order. Driven by `test/nhl92-z80-driver.js`.
- `nhl92-z80-audio.js` — step 4: the same harness with every YM2612 write forwarded at its T-state to the real ymfm core (and PSG writes to `sn76489.js`), PCM at 53267 Hz (write at T-state `t` lands before sample `floor(t*15/1008)`). Also the 68k vblank input builders, the game's note tables, the 22 patches at Z80 `$02A5` and the DAC SFX list read from the retail handler bytes. UMD, used by Node and `public/chip-lab.js`.
- `nhl92-chip-renders.js` + `tools/render-nhl92-chip-tests.js` — one WAV per patch scale (`patch-00.wav`…`patch-21.wav`) and per DAC SFX, with YM logs, to `out/nhl92-chip-tests/`; `--update` rewrites the pinned hashes in `data/audio/nhl92-chip-tests.json`. Checked by `test/nhl92-z80-audio.js`.
- `wav.js` — deterministic 16-bit PCM WAV writer.
- ymfm `reset()` does not rewind every internal counter, so a reused chip drifts from a fresh one; restore `chip.saveState()` taken at creation (`loadState`) for reproducible renders, or use `ym2612-wasm.createChip()`.
- `nhl92-z80-golden.js` — replay recorded vblank inputs (`data/captures/nhl92/*.json`) and compare to a retail YM log or VGM.
- `nhl92-z80.js` — extract/load `Z80_Program_Code` (`0x116A6`, `0x598` bytes).
- `nhl92-sound-system.js` — NHL 92 68k↔Z80 vblank hooks + FM/SFX preview schedules.
- `z80-test-patterns.js` — built-in harness tests (viewer **Z80 test** game).
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

SNES / PC: not implemented yet (`docs/DESIGN.md` §3).
