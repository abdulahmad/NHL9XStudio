# NHL9X Studio — audio

Genesis (AUD-0 / AUD-1):

- `genesis-constants.js` — ROM offsets (`Hockey.snd`, FMTune, SFX cmdstreams for NHL 92).
- `genesis.js` — cmdstream → preview note schedule (Web Audio sketch, not YM2612).
- `data/audio/<gameId>.json` — static catalogs (`node tools/build-audio-catalog.js`).

API (local server):

- `GET /api/games/:id/audio` — catalog JSON.
- `GET /api/games/:id/audio/preview?entry=<id>` — note schedule (requires ROM in `roms/`).

SNES / PC: not implemented yet (`docs/DESIGN.md` §3).
