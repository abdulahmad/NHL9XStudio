# NHL9X Studio — audio

Genesis (AUD-0 / AUD-1):

- `genesis-constants.js` — ROM offsets (`Hockey.snd`, FMTune, SFX cmdstreams for NHL 92).
- `genesis.js` — NHL 92 byte cmdstream + 93/94 event-stream preview schedules (Web Audio sketch, not YM2612).
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
