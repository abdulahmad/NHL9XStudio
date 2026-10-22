# NHL 95 (Genesis) Sound test

The Sound test runs NHL95Genesis `sound95.asm`: command-based driver (`SoundCmd` / `SndDriver`), retail Z80 program at `$BD86`, and `SoundBanks` at `$D8EC`. Boot matches `Begin` in `main95.asm` (commands 0, 9, 6, 7, then `SoundOff`). Songs use `song()` / `sfx()` at `$678C2` / `$677AC`; each vblank sends `SoundCmd` 1 (`SndUpdate`).

| File | Role |
|------|------|
| `lib/audio/nhl95-68k-harness.js` | 68k harness (`driver:` for `nhl92-sound-chain.js`) |
| `data/fixtures/nhl95-sound-slice.bin` | ROM `$AF44–$7A000` (driver, bank, PCM, FM patches) |
| `data/audio/nhl95.json` | Catalog (SfxTable + names from `equals.inc`) |
| `test/nhl95-sound-chain.js` | Chain tests |

Retail ROM SHA-1: `09e87b076aa4cd6f057a1d65bb50fd889b509b44`. Refresh the slice with `node tools/extract-nhl9x-sound-fixture.js 95`.

## Songs: table and format (lib/audio/nhl95-seq.js)

An earlier note here said 95 has no song table. It has one: **the songs are bank items of type 3 in `SoundBanks` (`$D8EC`)**, found by `SndFindBankItem`. The bank is a word item count, then 4 bytes per item (type, id, size word), then the items back to back in that order, so an item's address is the bank + 2 + 4 × count + the sizes of the items before it. Bank 0 has 141 items: 43 patches (type 0), 24 samples (1), 72 songs (3) and 2 load lists (`$B`). Songs 0–3 are the menu songs (`StartSong`), `$32`–`$55` the team and arena songs (`sfxplay`), and the effects are songs too (`SfxTable` gives the song id of each effect). `ProcessOneMusicTrack` is a dead 94 leftover; the 95 sequencer is `SndUpdate` on the 68k.

Sequence format (`SndStartSeq`, `SndUpdate`): word N, N word loop markers (offsets from the data after the table), then delay, event, delay, event … The first delay is skipped. A delay is 1 byte, or 2 when bit 7 of the first is set (`(b & $7F) << 7 | next`). Events use MIDI status bytes with running status: `$9c` key, velocity, length (like a delay; the 68k keys the note off after that many ticks), `$Bc` controller, value (controller `$75` jumps to marker [value] at once), `$Cc` program (a patch id), `$Ec` one pitch-bend byte, `$FF` end; other statuses have no data. One tick per vblank at the retail tempo `$100`.

`lib/audio/nhl95-seq.js` reads the table (`items`, `songs`), parses and re-encodes every retail song byte for byte (`parse`, `encodeRaw`), converts to a model (notes, controllers, programs, bends; 16 channels; `fromRom`, `encode`) and builds a ROM copy that plays an edited song (`romWithSong`): bank 0 stays as it is except the type byte of the replaced item, and bank 1, after the image, holds the new song; `nhl95-68k-harness.js` sets it at boot (`opts.banks`). `test/nhl95-seq.js`: all 72 songs round-trip byte-exact, the model round-trips, and songs 0 and `$33` from the model, played from the copy, make the same YM2612 writes as retail; an edit changes them.

Playback in the chain was silent before PR #119 (the Z80 was reset after the boot and lost its patches). The patches come from load list 0 (menus) or 1 (in game), and the harness loads the one a sound needs.

## GM map and the sequencer model (lib/audio/nhl95-stream.js)

`data/audio/nhl95-gm-map.json` names the 43 bank patches (kind from byte 0: 0 FM, 2 PCM sample, 4 PSG; characters from the songs and `SfxTable` at `$67890` that use them), gives each a General MIDI target (low confidence, not auditioned) and holds the two load lists as the ROM has them, with a GM → patch table per list for MIDI import (only that list's patches). `lib/audio/nhl95-stream.js` is the sequencer model: 16 channels, every note carries its patch (program events are written where a channel's patch changes, reusing the retail ones), controllers kept as they are (95 uses 1, 18 and 116), the raw bend byte (64 = none, read as ±2 semitones for MIDI, an assumption), and `loadList` (0 menus, 1 in game) that says which patch set the song is for. `nhl9x-stream.js` hands game 95 to it (`fromStream`, `encode`, `romWithSong`, `toGm`, `fromGm(…, loadList)`, native MIDI with an `NHL95 v1` header). `romWithSong` returns `driverOpts` (`banks`, and `loadList: 0` for list 0) for the harness; the song is `$32` of the copy. `test/nhl95-stream.js`: the map matches the bank, every retail song survives the model, songs 0 and `$33` play like retail through it, native and GM MIDI round-trip, imported and edited songs play on both lists.

## Sequencer / MIDI UI

The Sound test lists **Sequencer · new NHL 95 song** and **MIDI import → NHL 95** for 95 (`sound-test-view.js`, `sound-tools-nx.js`). The sequencer has 16 channels, the Instrument list shows the patches of the song's **Patch set** (load list 0 menus / 1 in game; the import panel and the sequencer both choose it, a retail song brings its own), the roll covers notes 0–127 and the bend lane edits the raw byte. Play encodes the song into the ROM copy and runs it through `nhl95-68k-harness.js` with `driverOpts` (bank 1, and list 0 when chosen). Retail songs have Edit in sequencer and MIDI (GM / native) exports; Play as GM and the stream exports work for the editor's song. The FM instrument editor stays off for 95 (its patches are bank items, not the 93/94 table). `test/browser/nhl95-sequencer.js` covers the screen: import for list 0 and play, a retail song edited and played.

Open: the GM targets in `nhl95-gm-map.json` are not auditioned, and the bend range (±2 semitones) is assumed.

## Studio playback fixes (timers, DAC, PSG, names)

- **YM timers.** The 95 Z80 program polls YM status: bit0 (Timer A, reloaded with `$27`) paces DAC bytes to `$2A` in `$1586`, bit1 (Timer B) paces envelopes in `$16EC`. The harness used to return status 0, so samples were silent. `createYmTimers` in `lib/audio/nhl92-z80-harness.js` models TA = (1024-N) samples and TB = 16*(256-N) samples at 1008/15 T-states per sample. It is opt-in through `YM_TIMERS` in the 95 68k harness, so 92-94 are unchanged.
- **SN76489.** Attenuation is 2 dB per step. Noise is clocked at clock/512, /1024 or /2048, or by tone 2. White noise is a 16-bit LFSR with taps bit0^bit3, reset when the noise register is written. Tone frequency is clock/(32*N). `PSG_GAIN` is 0.2, so one PSG channel peaks at about 0.4 of one FM channel.
- **PSG mute.** Lane 6 in the roll mutes the PSG (`setChannelMute(6, on)`).
- **Names.** Songs `$00-$03` are the menu songs, matched to 94's names: SngTitle, unsure (no caller), SngEOP and SngScouting. Song labels `$32-$55` come from 95 `TeamSongs` and `RandomSongs` (they had been copied from the 94 table).
