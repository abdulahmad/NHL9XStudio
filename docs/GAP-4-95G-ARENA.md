# GAP-4 (NHL 95 Genesis): arena graphics audit

Retail ROM: `nhl95.bin` (SHA-1 `09e87b076aa4cd6f057a1d65bb50fd889b509b44`). Image catalog: `lib/genesis-images.js` (`game: 'nhl95'`).

## ArenaGfx (27 team / special rinks)

All 27 `ArenaGfx*.bin` entries are contiguous JIM blobs from `$1A0AAA` (`ArenaGfxANH`) through `$1A6C28` (`ArenaGfxASEASW`). Each uses the shared ice palette at ROM `$A20C4` (`IceRink.map.jim` `paletteAt` `662980`), same as other 95G screen art.

They are **not** taken from the dev `extractAssets95.js` crowd offset (`0x7216C`); retail Crowd/FaceOff slices are pinned separately in `test.js` (`EXTRACT95_RETAIL`).

## Verification

When `/tmp/disasm/NHL95Genesis/lst/nhl95.bin` (or `roms/nhl95.bin`) is present, `node test.js` decodes every arena JIM and checks non-trivial ink on frame 1. The catalog always checks count (27) and back-to-back offsets.

## Still open

- Bitwise compare of every `genesis-images.js` 95G image against a fresh `extractAssets95.js` run on a dev ROM (optional; retail pins are authoritative for the viewer).
