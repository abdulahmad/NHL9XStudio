# NHL 95 (Genesis) Sound test

The Sound test runs NHL95Genesis `sound95.asm`: command-based driver (`SoundCmd` / `SndDriver`), retail Z80 program at `$BD86`, and `SoundBanks` at `$D8EC`. Boot matches `Begin` in `main95.asm` (commands 0, 9, 6, 7, then `SoundOff`). Songs use `song()` / `sfx()` at `$678C2` / `$677AC`; each vblank sends `SoundCmd` 1 (`SndUpdate`).

| File | Role |
|------|------|
| `lib/audio/nhl95-68k-harness.js` | 68k harness (`driver:` for `nhl92-sound-chain.js`) |
| `data/fixtures/nhl95-sound-slice.bin` | ROM `$AF44–$7A000` (driver, bank, PCM, FM patches) |
| `data/audio/nhl95.json` | Catalog (SfxTable + names from `equals.inc`) |
| `test/nhl95-sound-chain.js` | Chain tests |

Retail ROM SHA-1: `09e87b076aa4cd6f057a1d65bb50fd889b509b44`. Refresh the slice with `node tools/extract-nhl9x-sound-fixture.js 95`.

## Sequencer / MIDI (blocked)

NHLPA 93 and NHL 94 Genesis use **68k event streams** (`ProcessOneMusicTrack` in `sound93.asm` / `sound94.asm`): four-byte events, a long song table, and `lib/audio/nhl9x-stream.js` for edit, GM import/export, and `romWithSong`. The Sound test exposes **Sequencer** and **MIDI import** for those titles.

NHL 95 is different:

| Piece | 93G / 94G | 95G (`sound95.asm`) |
| --- | --- | --- |
| Arena / team music | Event streams in the sound slice (`nhl9x-song.js` table at `$2870A` / `$2C648`) | `fmtune_id_*_cmdstream` blobs; `song()` routes **$32–$55** through `sfxplay`, not the 93/94 table |
| Title / menu songs | Same stream driver | Songs **0–3** via `StartSong` → `SndStartSeq` (sound-bank type 3), not the 93/94 stream table |
| UI | `nhl9x-stream.js` + `sound-tools-nx.js` | Deliberately excluded (`game !== 'nhl95'` in `sound-test-view.js`) |

`ProcessOneMusicTrack` still exists in 95 (and adds command `$3x`), but the bundled slice has **no pinned long song table** like 94’s `$2C648`, and retail team songs are **cmdstreams** referenced from `SfxTable` / the sound bank. Wiring 93/94’s sequencer would not be retail-accurate without a new **95 stream table** (from `NHL95Genesis` segmap + slice layout) or a **cmdstream encoder** (closer to NHL 92’s `nhl92-song.js`).

**Next steps when unblocked:** locate or document the 95 song-pointer table (if any) for event streams; otherwise port cmdstream encode/decode for `$32–$55` and hook `nhl95-68k-harness.js` playback of edited ROM copies.
