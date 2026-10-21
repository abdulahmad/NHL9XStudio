# NHL 95 (Genesis) Sound test

The Sound test runs NHL95Genesis `sound95.asm`: command-based driver (`SoundCmd` / `SndDriver`), retail Z80 program at `$BD86`, and `SoundBanks` at `$D8EC`. Boot matches `Begin` in `main95.asm` (commands 0, 9, 6, 7, then `SoundOff`). Songs use `song()` / `sfx()` at `$678C2` / `$677AC`; each vblank sends `SoundCmd` 1 (`SndUpdate`).

| File | Role |
|------|------|
| `lib/audio/nhl95-68k-harness.js` | 68k harness (`driver:` for `nhl92-sound-chain.js`) |
| `data/fixtures/nhl95-sound-slice.bin` | ROM `$AF44–$7A000` (driver, bank, PCM, FM patches) |
| `data/audio/nhl95.json` | Catalog (SfxTable + names from `equals.inc`) |
| `test/nhl95-sound-chain.js` | Chain tests |

Retail ROM SHA-1: `09e87b076aa4cd6f057a1d65bb50fd889b509b44`. Refresh the slice with `node tools/extract-nhl9x-sound-fixture.js 95`.

Not done: MIDI sequencer / GM import (93/94 use `nhl9x-stream.js` on the older event-stream driver).
