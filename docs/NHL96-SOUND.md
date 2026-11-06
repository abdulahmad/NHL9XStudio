# NHL 96 (Genesis) Sound test

The Sound test runs NHL96Genesis `sound96.asm`: the same command-based driver as NHL 95 (`SoundCmd` / `SndDriver`), at 96 addresses. `Nhl96M68kHarness` is `lib/audio/nhl95-68k-harness.js` `.nhl96`. Boot matches 95 `Begin` (commands 0, 9, 6, 7, then `SoundOff`). Songs use `song()` / `sfx()`; each vblank sends `SoundCmd` 1 (`SndUpdate`).

The slice **must** start at `$24486` (`SndDriver`), not at `Z80Program` `$25500`. A slice that starts at `$25500` leaves the 68k at `$24496` and every catalog sound is silent.

| File | Role |
|------|------|
| `lib/audio/nhl95-68k-harness.js` `.nhl96` | 68k harness (`driver:` for `nhl92-sound-chain.js`) |
| `data/fixtures/nhl96-sound-slice.bin` | ROM `$24486–$88A18` (SndDriver through TitleScreenImg) |
| `data/audio/nhl96.json` | Catalog (SfxTable + StartSong 0–3 + TeamSongs `$32–$55`) |
| `test/nhl96-sound-chain.js` | Chain tests |

Retail ROM SHA-1: `7204633fbb9966ac637e7966d02ba15c5acdee6b`. Refresh the slice with `node tools/extract-nhl9x-sound-fixture.js 96`.

Songs 0–3 are the menu songs (`StartSong`), same names as 95 (`N93.SONGS95`: title / unused / team-select / season menu). `$32`–`$55` are the team and arena songs (`TeamSongs`). Effects are `$00–$2F` (`SfxTable`).

There is no GM map and no sequencer / MIDI import for 96. The Sound test lists Songs, SFX, Samples and Crowd noise only.

YM timers, DAC streaming to `$2A`, and the shared Z80/PSG path are the same as 95 (`docs/NHL95-SOUND.md`). 96 menu songs write the PSG but do not raise a measurable peak in 300 frames; the chain test pins YM logs and DAC counts, not a PSG peak.
