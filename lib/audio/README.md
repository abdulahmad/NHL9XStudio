# NHL9X Studio — audio

Genesis (AUD-0 / AUD-1):

- `genesis-constants.js` — ROM offsets (`Hockey.snd`, FMTune, SFX cmdstreams for NHL 92).
- `genesis-92-sequence.js` — NHL 92 68k cmdstream → note schedule (loop table, transpose, instruments).
- `preview-render.js` — Node/browser PCM preview (RMS-testable without Web Audio).
- `z80-cpu-core.js` — vendored `@dcorp80/z80cpu` (regenerate: `node tools/vendor-z80cpu.js`).
- `z80-machine.js` — Genesis 8K RAM + YM2612 bus + I/O stubs.
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
