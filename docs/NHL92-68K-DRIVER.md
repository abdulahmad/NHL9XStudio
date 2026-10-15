# NHL '92 68k sound driver, run on its own (step 6)

The retail 68k sound driver runs from the ROM bytes on `lib/audio/m68k-cpu.js` (docs/M68K-CORE.md), with no game around it. The harness records everything the driver writes to the Z80 side each vblank. It isn't connected to the Z80 driver yet; that's step 7.

## Harness (`lib/audio/nhl92-68k-harness.js`)

| Area | Addresses | Notes |
|---|---|---|
| ROM | `$000000`–`$3FFFFF` | The bundled sound slice (`$F4C8`–`$24213`) at its ROM offsets |
| Stubs | `$000400`–`$0005FF` | The game's `sfx` and `song` wrappers, plus per-call trampolines |
| Z80 window | `$A00000`–`$A03FFF` | 8 KB Z80 RAM (mirrored) |
| Z80 bus / reset | `$A11100` / `$A11200` | Writes recorded; a bus request is granted at once (the driver never polls) |
| 68k RAM | `$E00000`–`$FFFFFF` | 64 KB (mirrored); stack from `$FFFFFDF0` (`ram.asm` `Stack`, just below the sound RAM) |

**How calls are made.** Every call is made the way the game makes it:

- **Boot:** `jsr p_initialZ80`, `p_turnoff`, `p_music_vblank`, as in `hockey.asm`.
- **Songs and SFX:** `move.w #n,-(a7)` then the `song` or `sfx` wrapper, as in `middle.asm`. Each wrapper saves all registers, reads its argument at `16*4(a7)`, calls `p_initune`/`p_initfx`, then removes the argument.
- **Each vblank:** `jsr p_music_vblank`, which is what `video.asm` `VBlank` calls after its own work.

**The wrappers.** The wrappers are game code, and the bundled slice holds only the sound module. So they're re-assembled instruction for instruction from `middle.asm` (`H.wrapperBytes`). The `sfx` wrapper stores the ID to the game variable `lastsfx`, whose address is RS-counted in the disassembly. The retail ROM's wrappers (at $8D94 and $8DB8) fix the remaining encodings: `bmi .none` is a word branch, and `lastsfx` is `($D53C).w`, i.e. $FFFFD53C; only the game reads it. When `roms/nhl92.bin` is present, the test checks that both re-assembled wrappers appear byte for byte in the retail ROM. (Step 6 first used `bmi.s` and a scratch `lastsfx`; the switch didn't change any pinned log, since the logs name the write `lastsfx` rather than print its address.)

**Guards.** Every call must return to its trampoline within an instruction budget (default 2,000,000). The PC must stay inside the sound code or the stubs, the stack must balance and the CPU must stay in supervisor mode. Otherwise the call throws `DriverError`.

**What's recorded.** The harness records every write, with the PC of the instruction that made it, and every read of sound *data*: song table, order lists, patterns, SFX tables, streams and samples. Each data read is tagged with A0, the channel record the driver is working on. These reads exist only for the cross-checks; the driver never sees them.

## Logs (`lib/audio/nhl92-68k-run.js`, `tools/run-nhl92-68k-driver.js`)

`node tools/run-nhl92-68k-driver.js` runs the canonical plan:

- each song for 3,600 vblanks, except SngTitle, which runs for 9,000;
- each SFX ID 0–34 for 600 vblanks, after boot and one settling vblank.

It writes one log per run to `out/nhl92-68k-driver/` (git-ignored), plus `summary.json` with the cross-check results. `--update` re-pins the logs' SHA-256 hashes in `data/audio/nhl92-68k-driver.json`. The whole plan takes about 6 s.

Each log line is one call: boot, the song or SFX trigger, then one line per vblank. A line shows:

- the instruction count;
- the Z80 bus/reset writes in order;
- the total number of Z80 writes (when large);
- the SFX bytes written at `$00BE`–`$00C3`;
- the 48-byte buffer written at `$0273`–`$02A2`;
- the update flag written at `$02A3`;
- any write outside the expected set, marked `UNEXPECTED` (there are none).

**Expected writes.** The driver may write to Z80 RAM (the program at boot; afterwards only the buffer, flag and SFX bytes), the Z80 bus and reset ports, the sound RAM (`$FFFFFDFC`–`$FFFFFFFF`) and the stack. The game wrappers may write only to the stack and `lastsfx`.

## Cross-checks against the step 5 parser (`lib/audio/nhl92-68k-analysis.js`)

The parser is an independent reading of the same bytes. For every song, over the whole run:

- **Pattern order:** every pattern each channel enters, in order, matches its order list, including repeats (`$0002 n` plays the previous pattern n more times), restarts (`$0000`) and the song switch (`$0001 n`).
- **Key events:** every key-on and key-off frame matches an oracle built only from parsed data. In that oracle:
  - vblank 0 runs `Sound_InitMusicTrack`, whose `Sound_ResetChannelVolumes` keys every channel off;
  - parsing starts at vblank 1;
  - a note keys on and lasts duration units × tempo vblanks, keying off on its last tick;
  - a rest keys off at once and again on its last tick.
- **Key-on frequency:** every key-on frequency (slot +5/+6) is the note-table entry for note + patch note offset + transpose.

For every SFX ID:

- **DAC requests:** they appear on the next vblank at `$00BE`–`$00C3` exactly as the handler's immediates encode them (`$BF` = address high, `$BE` = address low, `$C0` = 0, `$C1` = rate, `$C2` = bank, `$C3` = priority).
- **FM streams:** each loads its first patch into its slot, and the driver reads exactly the stream's bytes and nothing outside it.

All five songs and all 35 SFX IDs match.

## Findings

### SngTitle runs into Title Reprise for one vblank, then switches

SngTitle's channels 1–5 have no end marker (step 5). Over time:

- **Vblank 7,681:** channels 1–5 start their last Title pattern.
- **Vblank 8,449:** all six channels finish their last patterns. The driver processes channels 5 down to 0, so channels 5..1 reach their `$84` first. Each reads past its list into the SngTitle reprise list stored after it and enters the reprise's first pattern. Channels 2–4 first play a transpose stub, then a pattern.
- **Same vblank 8,449:** channel 0 reads `$0001 $0002` and calls `p_initune(2)`.
- **Vblank 8,450:** the init flag pauses all channels (keys off, DAC stop request) and restarts all six on song 2. From then on song 2 loops forever (its lists end with `$0000`).

So the fall-through is real, but it lasts one vblank (~16.7 ms): the first key-on of the reprise on channels 1–5 goes out one vblank before the pause and restart.

### SFX labels in `sound.asm` are shifted against the IDs

The IDs are what the game passes to `sfx`. Names come from the EA sound list and the `src/ram.asm` equates. The handler labels and table comments in `sound.asm` (`sfx_pointer_table`, line 570) are shown for reference; nothing in the disassembly has been renamed.

| ID | EA sound list | `ram.asm` equate | Handler label (`sound.asm`) | Table comment | What the driver does | Label |
|---|---|---|---|---|---|---|
| 0 | siren | SFXsiren | handle_sfx_siren | SFXsiren = 0 | FM ch0 `$FF74` + FM ch1 `$FF90` | agrees |
| 1 | skating | SFXbeep1 | handle_sfx_beep1 | SFXbeep1 = 1 | FM ch3 `$1016A` | agrees with the equate |
| 2 | skating | SFXbeep2 | handle_sfx_beep2 | SFXbeep2 = 2 | FM ch3 `$1015A` | agrees with the equate |
| 3 | skating | SFXcheck2 | handle_sfx_id_3 | SFXcheck2 = 3 | DAC `$222AA` rate `$08` pri 1 | generic |
| 4 | skating | — | handle_sfx_whistle | (Unused) | DAC `$222AA` rate `$0B` pri 1 | names another sound |
| 5 | hit puck | SFXstdef, SFXpuckbody | handle_sfx_horn | SFXstdef, SFXpuckbody = 5 | FM ch1 `$FFF0` | names another sound |
| 6 | hit board | — | handle_sfx_pass | (Unused) | FM ch2 `$100A6` | names another sound |
| 7 | hit board | SFXpuckwall1 | handle_sfx_shotbh | SFXpuckwall1 = 7 | FM ch2 `$10100` | names another sound |
| 8 | puck faceoff | SFXpuckget, SFXpuckice | handle_sfx_shotfh | SFXpuckget, SFXpuckice = 8 | FM ch1 `$FFB8` | names another sound |
| 9 | post | SFXpuckpost | handle_sfx_shotwiff | SFXpuckpost = 9 | FM ch2 `$1000E` | names another sound |
| 10 | whistle | SFXwhistle | handle_sfx_stdef | SFXwhistle = 10 | FM ch4 `$FFC8` | names another sound |
| 11 | pass sample | SFXpass | handle_sfx_puckget | SFXpass = 11 | DAC `$13960` rate `$0C` pri 2 | names another sound |
| 12 | pass sample | SFXshotbh | handle_sfx_puckbody | SFXshotbh = 12 | DAC `$12A58` rate `$0C` pri 2 | names another sound |
| 13 | slap shot | SFXshotfh | handle_sfx_puckwall1 | SFXshotfh = 13 | DAC `$11C3E` rate `$0B` pri 2 | names another sound |
| 14 | whiff | SFXshotwiff | handle_sfx_puckwall2 | SFXshotwiff = 14 | FM ch1 `$10088` | names another sound |
| 15 | player hits boards | SFXplayerwall | handle_sfx_puckwall3 | SFXplayerwall = 15 | DAC `$14886` rate `$13` pri 1 + FM ch2 `$100A6` | names another sound |
| 16 | player hits boards | — | handle_sfx_puckpost | (Unused) | DAC `$14886` rate `$18` pri 1 + FM ch2 `$100A6` | names another sound |
| 17 | player hits boards | — | handle_sfx_puckice | (Unused) | DAC `$14886` rate `$10` pri 1 + FM ch2 `$100A6` | names another sound |
| 18 | check | SFXcheck | handle_sfx_playerwall | (Unused) | DAC `$15768` rate `$10` pri 1 | names another sound |
| 19 | check | — | handle_sfx_check | SFXcheck = 18 | DAC `$15768` rate `$13` pri 1 | agrees with the EA list; comment off by one |
| 20 | check | — | handle_sfx_check2 | (Unused) | DAC `$15768` rate `$18` pri 1 | agrees with the EA list |
| 21 | punch | SFXhithigh | handle_sfx_hithigh | SFXhithigh = 21 | DAC `$168AA` rate `$15` pri 2 | agrees |
| 22 | punch | — | handle_sfx_hitlow | SFXhitlow = 23 | DAC `$168AA` rate `$19` pri 2 | punch family; comment off by one |
| 23 | punch | SFXhitlow | handle_sfx_id_23 | SFXhorn = 24 | DAC `$168AA` rate `$1F` pri 2 | generic; comment off by one |
| 24 | foghorn | SFXhorn | handle_sfx_crowdcheer | SFXcrowdcheer = 25 | FM ch0 `$1002C` + FM ch1 `$10054` | names another sound |
| 25 | crowd cheer | SFXcrowdcheer | handle_sfx_crowdboo | SFXcrowdboo = 26 | DAC `$16E04` rate `$13` pri 0 | names another sound |
| 26 | boo | SFXcrowdboo | handle_sfx_oooh | (Unused) | DAC `$1D786` rate `$18` pri 0 | names another sound |
| 27 | hitboard (quieter) | — | handle_sfx_id_27 | (Unused) | FM ch2 `$100C4` | generic |
| 28 | hitboard (quieter) | — | handle_sfx_id_28 | SFXpuckwall2 = 29 | FM ch2 `$100E2` | generic; comment off by one |
| 29 | hitboard (quieter) | SFXpuckwall2 | handle_sfx_id_29 | SFXpuckwall3 = 30 | FM ch2 `$1011E` | generic; comment off by one |
| 30 | hitboard (quieter) | SFXpuckwall3 | handle_sfx_id_30 | SFXoooh = 31 | FM ch2 `$1013C` | generic; comment off by one |
| 31 | SFXoooh | SFXoooh | handle_sfx_id_31 | (Unused) | DAC `$1FCE8` rate `$1B` pri 0 | generic |
| 32–34 | — (not in the list) | — | handle_sfx_id_30 | (Duplicate) | FM ch2 `$1013C` (same as 30) | duplicate of 30 |

**Labels.** In summary: from ID 4 to 18, and at 24–26, the handler labels name a different sound than the ID plays.

**Table comments.** They agree with the IDs up to position 15. After that they drift: position 19 says `SFXcheck = 18` (one low), position 21 agrees (`SFXhithigh = 21`), and from position 22 to 30 the comment at position *n* names ID *n* + 1 (`SFXhitlow = 23` at 22, through `SFXoooh = 31` at 30).

**Equates vs the EA list.** The `ram.asm` equates and the EA list also disagree in places. IDs 1–2 are `SFXbeep1`/`SFXbeep2` in `ram.asm` but "skating" in the EA list, and ID 3 is `SFXcheck2`. The game itself plays `SFXbeep2` (ID 2) for the 60-second clock warning (`video.asm` `VBlank`). Your ear is the judge here; the IDs and what they play are certain.

### Other behaviour worth knowing

- **Siren skips its patch load when it's the first thing played after boot.** `p_initialZ80` clears the sound workspace, so every channel's current-instrument byte (`$41`) is 0. Siren's streams start with `$80 $00` (instrument 0), and `.effect_instrument` skips the load when the IDs match. So siren plays with whatever patch the Z80 channel already has. After a song has started, `Sound_InitMusicTrack` sets `$41 = $FF`, which forces the load.
- **Boot and every song start send the empty DAC sample.** `p_turnoff` (boot) and a song start both go through `Sound_PauseMusic` → `configure_ym2612`, which requests sample `$14882` (rate `$0B`, priority 0). That stops any DAC SFX.
- **Bus handshake.** The driver requests the Z80 bus and writes at once, without polling for the grant. Boot follows `sound.asm` exactly: reset `$100`, bus `$100` (`p_initialZ80`); reset `$100`, bus `$100`, copy `$597` bytes, reset 0, bus 0, reset `$100` (`Sound_LoadZ80Program`); then bus `$100`, bus 0 for the boot vblank.
- **The 68000 core needed no changes.** All 680 sound-code instructions ran as validated in step 2b.

## Tests (`test/nhl92-68k-driver.js`, part of `node test.js`)

- **Boot:** the program copy is byte for byte, the handshake order matches `sound.asm`, and the empty DAC request goes out.
- **Determinism:** second runs of songs 1 and 4 and SFX 0 and 26 give byte-identical logs, and all 40 logs match their pinned hashes.
- **Write set:** no unexpected writes or reads in any run, and the per-vblank Z80 writes are only `$0273`–`$02A3` and `$00BE`–`$00C3`.
- **Cross-checks:** all songs' pattern order and key events match the parser, the SngTitle fall-through and switch timeline is checked, and all 35 SFX match their handlers.
- **Spot-checks against `sound.asm`:**
  - SngPO tempo 7 (`dc.w $0507`): the first note keys on at vblank 1, keys off at 14, and the next keys on at 15.
  - `fmtune_song4_ch0` `$11A3, $0002, $0003, $1A41, $0000`: the first pattern plays 4 times, then `$10F09`, then a restart.
  - SngTitle ch1's first entry is the `+12` transpose stub, and its first key-on is transposed.
  - The handlers at positions 15, 25 and 26 encode as listed above, and ID 24 runs the crowdcheer-labelled handler.
- **Guards:** a runaway call and a PC outside the sound code both throw.

## Not verified here

- How any of this sounds: that's step 7, when these logs drive the Z80 driver and the YM2612.
- The wrappers' bytes are checked against the retail ROM only when `roms/nhl92.bin` is present (CI has no ROM).
- The game's own sound calls: when it plays which song or SFX, `SFXskatestop = -1`, and so on. Each SFX is run on its own after boot.
