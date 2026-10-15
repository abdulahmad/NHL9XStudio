# NHL9X Studio — audio

Genesis (AUD-0 / AUD-1):

- `genesis-constants.js` — ROM offsets (`Hockey.snd`, FMTune, SFX cmdstreams for NHL 92).
- `genesis.js` — cmdstream → preview note schedule (Web Audio sketch, not YM2612).
- `data/audio/<gameId>.json` — static catalogs (`node tools/build-audio-catalog.js`).

Browser: `lib/audio/genesis-constants.js` + `genesis.js` (global `NhlGenesisAudio`) run FM preview when a ROM is loaded in the viewer (Open file or API `roms/`).

API (optional local server):

- `GET /api/games/:id/audio` — catalog JSON.
- `GET /api/games/:id/audio/preview?entry=<id>` — note schedule (requires ROM in `roms/`).

`tools/build-audio-catalog.js [--rom path] [--game id]` — refresh `data/audio/*.json`; ROM scan helps validate offsets (`lib/audio/genesis-scan.js`).

SNES / PC: not implemented yet (`docs/DESIGN.md` §3).
