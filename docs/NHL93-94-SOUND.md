# NHLPA 93 and NHL 94 (Genesis) Sound test

The Sound test tab plays the retail sound code of NHLPA 93 and NHL 94 the same way it does for NHL 92: the game's
own 68k driver runs on `m68k-cpu.js`, writes into a shared Z80 RAM, the game's own Z80 program runs from that RAM
(`z80-cpu-core`), and its YM2612 / SN76489 writes drive the ymfm and SN76489 cores. The roll, the clock and the
volume are the NHL 92 ones. Nothing is captured from an emulator; every byte that runs is a ROM byte.

## Pieces

| File | What |
|------|------|
| `lib/audio/nhl9x-68k-harness.js` | The driver runner (`build(cfg)`): trampolines, the game's `sfx` / `song` wrappers (re-assembled from `video94.asm` / `middle93.asm`: `move.w d0,(lastsfx).w` then `jsr play_sfx_or_music_track`), pad ports idle, Z80 window, BUSREQ / RESET. |
| `lib/audio/nhl93-68k-harness.js`, `nhl94-68k-harness.js` | Each game's addresses. |
| `lib/audio/nhl92-sound-chain.js` | Unchanged chain; `create({ driver })` selects the game's harness (default: NHL 92). |
| `data/fixtures/nhl93-sound-slice.bin`, `nhl94-sound-slice.bin` | The sound segments (`$165D8–$2EFA2`, 100,810 bytes; `$1A264–$4B5C0`, 201,564 bytes): driver, Z80 program, FM patches, event streams, PCM. Not full ROMs. |
| `tools/extract-nhl9x-sound-fixture.js` | Refreshes the slices from your ROM (checked by SHA-1 and size). |
| `data/audio/nhlpa93.json`, `nhl94.json` | Names of the 56 / 123 sounds (SFX `$0–$2F`, songs `$30` up). |
| `test/nhl9x-sound-chain.js` | Tests (below). |

Addresses (retail): NHLPA 93 v1.1 `p_turnoff $165D8`, `play_sfx_or_music_track $16608`, `p_music_vblank $166D4`,
`p_initialZ80 $16D92` (the `jsr` in `Begin` at `$6478`), `lastsfx $FFFFBF28`. NHL 94 `p_turnoff $1A264`,
`play_sfx_or_music_track $1A294`, `p_music_vblank $1A50A`, `p_initialZ80 $1ACC2`, `lastsfx $FFFFC016`.

## What differs from NHL 92

- **The 68k waits for the Z80.** `UploadCommandBufferToZ80` only copies when Z80 RAM `$97` is 0 and `$96` is `$7D`;
  otherwise it releases the bus, loops 100 times (`z80_bus_release_delay`) and retries. NHL 92 never waits, so the
  chain's "68k takes no Z80 time" model loops forever when a PCM sample is playing (NHL 94 song `$78`). The harness
  now reports each bus release and the chain runs the Z80 for 480 T-states (the 100-iteration `dbf`, about 1,000 68k
  cycles) every time. NHL 92 never releases the bus mid-call, so its renders are unchanged (its pins still pass).
- **NHL 93 branches to a shared `rts` in game code** (`rtss = $110E0`, from `sound93_stub.asm`). The harness puts
  that one `rts` there.
- **The pad readers run from `p_music_vblank`.** The pad ports read "no button pressed"; the driver's reads are not
  recorded.
- **DAC.** The Z80 program writes `$2B = $80` once at boot and never clears it, so FM6 is always shown as DAC in the
  roll (the driver reserves channel 6 for PCM).

## General MIDI (Play as GM, export, labels)

`lib/audio/nhl9x-song.js` reads the driver's event streams straight from the bundled slices. A stream is 4-byte
events `[delay, status, a, b]` (delay in vblanks before the event; status bits 6-4 select key on/off `$1x`/`$0x`,
patch `$4x`, controller `$3x` (only 7, volume), pitch bend `$6x`; status 0 ends the stream or, with a non-negative
long at +2, loops). NHL 94's `SoundStreamTable` holds long ROM addresses (`$2C648`), NHLPA 93's 16-bit offsets from
the table (`$2870A`); the 32 FM patches sit 1,024 bytes before it. Both games' patch banks are byte-identical, so one
map, `data/audio/nhl9x-gm-map.json`, covers both (FM patches 0-31, PCM patches `$60`-`$6E`).

- **Play as GM / Export MIDI (GM):** every song and sound effect, notes taken from the stream (not from a run of the
  driver), program from the map, PCM patches mapped to drums or crowd voices, velocity = key-on volume x controller 7.
  Pitch bends and mid-note volume changes are not converted. The roll still shows the retail driver while it plays.
- **Song length and seeking:** a stream's length is known, so the song bar shows it and can be scrubbed; a looping
  stream repeats from its loop point after the first pass.
- **Lane labels:** a patch burst is matched to the bank (24 operator bytes + `$B0`) and labelled `P11 · Rock Organ`.
- **The map is a guess** from register values and how songs use each patch; nothing was auditioned. Each entry has a
  confidence. Edit by ear; `node test/nhl9x-song-gm.js` checks the file.

## Not done yet

- The sequencer and stream export for 93/94 (the sequencer is NHL 92 only).
- NHLPA 93 Rev A (`1992.OCT`, runs the track slots twice every 6th frame at 50 Hz) and Rev B are not bundled; the
  slice is the retail v1.1 ROM. PAL timing is not modelled.
- The Audio tab (old square-wave sketch) is hidden for these two games, like NHL 92.

## Checked

`test/nhl9x-sound-chain.js`, per game: every catalog sound runs 40 frames without the driver leaving the sound
code or running away and with no 68k write to Z80 RAM without the bus; at least half make a note or PCM within
0.7 s (51 of 56, 120 of 123); a PCM song streams more than 1,000 `$2A` writes (the bus-wait case); six sounds' YM2612
write logs (300 frames) match pins and repeat; songs and an SFX are audible through ymfm and do not clip. The pins
are self-consistency checks, not captures: nothing here was compared with real hardware or an emulator.
