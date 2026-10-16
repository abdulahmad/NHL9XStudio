# NHL '92 (Genesis) sound data format

This is a reference for the data the 68k sound driver reads: songs, order lists, patterns, envelopes, note tables, instrument patches, SFX and DAC samples. Each rule below was worked out from what the driver code in [`sound.asm`](https://github.com/abdulahmad/NHL92Genesis/blob/main/src/sound/sound.asm) does with the bytes, not from the disassembly's comments. Names come from the disassembly labels. The parser is `lib/audio/nhl92-sound-data.js` and its tests are in `test/nhl92-sound-data.js`.

All addresses are absolute ROM offsets in the retail cartridge. The sound module is PC-relative to `p_music_vblank` at **`$F4C8`** (written as BASE below). Pointers stored in the data are BASE-relative unless stated otherwise.

## Block map

The parser assigns every byte of each block to exactly one item (a table, list, pattern, stream, sample and so on), or to an explicitly classified leftover. The tests check this.

| Block | ROM range | Contents |
|---|---|---|
| `sfx_pointer_table` | `$FA92`–`$FB1D` | 35 longs, BASE-relative handler addresses |
| FM SFX streams | `$FF74`–`$10179` | 17 command streams |
| `note_frequency_table` | `$1017A`–`$101D9` | 96 bytes: block and F-number high bits (`$A4+ch`) |
| `note_octave_table` | `$101DA`–`$10239` | 96 bytes: F-number low byte (`$A0+ch`) |
| `envelope_table` + envelopes | `$1023A`–`$10293` | 4 longs (BASE-relative), then 4 envelopes |
| `fmtune_pointer_table` | `$10294`–`$10315` | 5 songs × 26 bytes |
| Order lists | `$10316`–`$1061D` | 30 lists of 16-bit words |
| Patterns | `$1061E`–`$11623` | 74 pattern entry points in 70 byte streams |
| Instrument patches | `$1194B`–`$11C0A` | 22 × 32 bytes at Z80 `$02A5` inside the Z80 program (`$116A6`) |
| DAC PCM | `$11C3E`–`$24213` | 11 samples, unsigned 8-bit |

The disassembly's `fmtune_seqN` labels are fixed 48-byte chunks of the pattern block, not pattern boundaries. Patterns start wherever the order lists point.

## Songs: `fmtune_pointer_table` (`$10294`)

`Sound_InitMusicTrack` multiplies the song ID by `$1A` and reads one 26-byte entry:

| Offset | Size | Meaning |
|---|---|---|
| +0 | byte | Last channel index (5 = six channels). Copied to workspace+4 and used as the `dbf` count of the channel loop. |
| +1 | byte | Tempo. Copied to workspace+2; every duration byte is multiplied by it. |
| +2 | 6 × long | BASE-relative address of each channel's order list (channels 0–5) |

There are 5 entries. The table ends at `$10315`, and the next byte is the start of song 4's channel 0 order list.

| ID | Name | Entry | Tempo | Order lists ch0–ch5 |
|---|---|---|---|---|
| 0 | endofperiod | `$10294` | 7 | `$10568`, `$10580`, `$105B6`, `$1059C`, `$105CA`, `$105E0` |
| 1 | splash | `$102AE` | 6 | `$1040E`, `$1042E`, `$10472`, `$1044E`, `$104A4`, `$104D2` |
| 2 | unused | `$102C8` | 6 | `$10426`, `$10446`, `$10498`, `$10468`, `$104C6`, `$10538` |
| 3 | endofgame | `$102E2` | 6 | `$10360`, `$10368`, `$1037C`, `$10372`, `$103AA`, `$103DE` |
| 4 | playofftree | `$102FC` | 7 | `$10316`, `$10320`, `$1032E`, `$1033C`, `$1034C`, `$1035C` |

The audio catalog in `lib/audio/genesis-constants.js` lists a sixth NHL 92 song, "In-game organ", and sets `fmtuneTracks: 6`. Entry 5 would start at `$10316`, which is order-list data, so ROM `$10294` holds no sixth song. This step doesn't change the catalog.

## Order lists

Each channel's list is a sequence of big-endian words. At song start the driver loads word 0 as the first pattern without checking it (`movea.w (a0),a0`). After that, each time a pattern ends with `$84`, the driver reads the next word:

| Word | Bytes | Meaning |
|---|---|---|
| `$0000` | 2 | Restart: go back to word 0 of this list. |
| `$0001 n` | 4 | Switch to song `n` (`p_initune`). |
| `$0002 n` | 4 | Repeat the previous pattern. With count `n` it plays `n + 1` times in total, then the list continues after the 4 bytes. |
| anything else | 2 | Next pattern, BASE-relative. `movea.w` sign-extends, so the word must be below `$8000`; the parser checks this. |

Five splash lists (ch1–ch5, at `$1042E`, `$1044E`, `$10472`, `$104A4` and `$104D2`) have no `0` or `1` terminator. If the driver read past their last pattern, it would continue into the unused-song list stored right after. splash ch0 ends with `$0001 $0002`, switching to song 2. The parser reports where each unterminated list would run into the next (`fallsInto`). Whether the other channels ever reach that point is a timing question for step 6.

## Patterns

`Sound_ProcessMusicChannels` reads bytes until it reaches a note or a rest, which ends the channel's work for that tick. The byte's value decides what it is:

| Byte | Args | Meaning |
|---|---|---|
| `$00`–`$7F` (≠ `$60`) | 0 | Note. The driver looks up note + patch note offset + transpose in the two note tables. The note lasts the current duration. It keys on unless the previous byte was `$83`. |
| `$60` | 0 | Rest: key-off, then wait for the current duration. |
| `$80 id` | 1 | Instrument: Z80 patch at `$02A5 + id × 32`. The channel note offset is set from patch byte `+$1A`. |
| `$81 d v` | 2 | Modulation: for `d` frames, add the signed value `v` to the F-number each frame. |
| `$83` | 0 | Legato: the next note doesn't key on again or restart its envelope. |
| `$84` | 0 | End of pattern: read the next order-list word. |
| `$85` | 0 | Stop: calls `p_turnoff` and ends this frame's music processing. |
| `$86 e s` | 2 | Pitch envelope `e` (0–3), speed `s` (signed). `s > 0`: each envelope value × `s`. `s < 0`: the note's age ÷ 2 is the multiplier. |
| `$87` | 0 | Envelope off. |
| `$88 t` | 1 | Transpose: signed semitones. It persists until the next `$88`, and song start resets it to 0. |
| `$89` | 0 | The next note gets no key-off on its last tick. |
| `$8A x` | 1 | Reads one byte and does nothing with it. |
| `$8B id` | 1 | Trigger SFX `id` (`p_initfx`). |
| `$82`, `$8C`–`$FF` | 0 | Duration = `((byte − $A0) & $FF) × tempo` frames. Bytes below `$A0` wrap around. |

`$83` and `$89` set flags that are cleared (`clr.w (a0)`) each time new pattern data is parsed, so they apply only to the next note. Durations are counted in vblanks (60 Hz on NTSC).

The retail patterns use these kinds of events: 1,472 notes, 356 rests, 856 durations (units 1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32 and 64), 101 instrument changes (IDs 0–21), 326 modulation commands, 21 envelope commands (envelopes 0 and 1, speed −128), 6 transposes and 70 pattern ends. No pattern uses `$83`, `$85`, `$87`, `$89`, `$8A`, `$8B` or a duration byte below `$A0`.

Two pattern blocks have several entry points into one byte stream: `$10868`/`$1089D`/`$108B7` and `$10995`/`$109CA`/`$109E0`. The six 3-byte patterns at `$10635`, `$10653`, `$10656`, `$10662`, `$10665` and `$10668` are transpose stubs (`$88 t $84`, setting +12, 0, +24, +36, +31 and +19). Order lists use them to set the transpose before a melody pattern; they are the only `$88` uses.

### Note index

The driver adds the channel note offset (patch byte `+$1A`) and the transpose to each note, then uses the result as a byte index into both note tables:

- `note_frequency_table[i]` goes to Z80 slot +5, the `$A4+ch` register: block in bits 3–5, F-number high bits in bits 0–2.
- `note_octave_table[i]` goes to Z80 slot +6, the `$A0+ch` register: F-number low byte.

Index 0 is C in block 0 (F-number `$284`), and the index rises one semitone per step. `Sound_InitMusicTrack` clears the transpose but not the note offset.

The parser walks each song channel statically: list order, with repeats, fall-through and one restart pass. In that walk every channel sets an instrument before its first note, and every note index stays between 9 and 90.

## Envelopes (`$1023A`)

The envelope table is 4 BASE-relative longs, pointing to `$1024A`, `$10253`, `$1025E` and `$1026B`. Each envelope is a list of signed bytes. At the `$84` marker, playback loops back to the envelope's first byte.

| ID | Values |
|---|---|
| 0 | 0, 1, 1, 0, −1, −2, −1, 0 |
| 1 | 0, 1, 2, 2, 2, 1, −1, −2, −2, −2 |
| 2 | 0, 0, 1, 1, 1, 0, 0, −1, −1, −1, 0, 0 |
| 3 | 0, −1, −2 … −38 (then `$84` and a stray `$06` at `$10293` that is never read) |

## Instrument patches (Z80 `$02A5`, ROM `$1194B`)

There are 22 records of 32 bytes each:

- **Bytes 0–25:** YM2612 register values. The Z80 loads them in its own order (Z80 `$00C5`). Byte 24 is `$B0` (feedback and algorithm) and byte 25 is `$B4` (pan, AMS and FMS).
- **Byte 26:** note offset added to every note. Only patch 4 is non-zero (−3).
- **Bytes 27–31:** never read by the 68k driver. All are 0.

The data never selects an instrument ID above 21.

## SFX

### `sfx_pointer_table` (`$FA92`)

`p_initfx` indexes this table by `SFX id × 4`, adds BASE and jumps to the result, so each entry is the address of handler code. The parser decodes the handlers' immediate values instead of trusting the labels. Each handler is a short run of `move.l #off,d1`, `move.b #rate,d2`, `move.b #pri,d3` and `moveq #ch,d7`, then a `bsr`:

- `bsr Sound_WriteYM2612` (`$FCDC`) is a DAC sample request. The 6 bytes it leaves at `$FFFFFFE6` are listed under "DAC samples" below.
- `bsr Sound_InitSFXChannel` (`$FA16`) starts an FM SFX stream at BASE + `off` on output slot `ch` (0–5, which map to YM2612 channels 1–3 and 4–6).
- `bsr` to another handler runs that handler's actions too: puckwall3, puckpost and puckice each play a DAC sample and then call `handle_sfx_pass`.

| ID | Handler label | Handler | Action(s) |
|---|---|---|---|
| 0 | siren | `$FF5A` | FM ch0 `$FF74` + FM ch1 `$FF90` |
| 1 | beep1 | `$FF3E` | FM ch3 `$1016A` |
| 2 | beep2 | `$FF4C` | FM ch3 `$1015A` |
| 3 | id_3 | `$FD32` | DAC `$222AA`, rate `$08`, pri 1 |
| 4 | whistle | `$FD56` | DAC `$222AA`, rate `$0B`, pri 1 |
| 5 | horn | `$FEA6` | FM ch1 `$FFF0` |
| 6 | pass | `$FEB4` | FM ch2 `$100A6` |
| 7 | shotbh | `$FEC2` | FM ch2 `$10100` |
| 8 | shotfh | `$FE8A` | FM ch1 `$FFB8` |
| 9 | shotwiff | `$FE98` | FM ch2 `$1000E` |
| 10 | stdef | `$FF30` | FM ch4 `$FFC8` |
| 11 | puckget | `$FDD6` | DAC `$13960`, rate `$0C`, pri 2 |
| 12 | puckbody | `$FDEA` | DAC `$12A58`, rate `$0C`, pri 2 |
| 13 | puckwall1 | `$FDFE` | DAC `$11C3E`, rate `$0B`, pri 2 |
| 14 | puckwall2 | `$FF08` | FM ch1 `$10088` |
| 15 | puckwall3 | `$FD1C` | DAC `$14886`, rate `$13`, pri 1 + FM ch2 `$100A6` |
| 16 | puckpost | `$FD6A` | DAC `$14886`, rate `$18`, pri 1 + FM ch2 `$100A6` |
| 17 | puckice | `$FD82` | DAC `$14886`, rate `$10`, pri 1 + FM ch2 `$100A6` |
| 18 | playerwall | `$FD9A` | DAC `$15768`, rate `$10`, pri 1 |
| 19 | check | `$FDAE` | DAC `$15768`, rate `$13`, pri 1 |
| 20 | check2 | `$FDC2` | DAC `$15768`, rate `$18`, pri 1 |
| 21 | hithigh | `$FE12` | DAC `$168AA`, rate `$15`, pri 2 |
| 22 | hitlow | `$FE3A` | DAC `$168AA`, rate `$19`, pri 2 |
| 23 | id_23 | `$FE26` | DAC `$168AA`, rate `$1F`, pri 2 |
| 24 | crowdcheer | `$FF16` | FM ch0 `$1002C` + FM ch1 `$10054` |
| 25 | crowdboo | `$FE4E` | DAC `$16E04`, rate `$13`, pri 0 |
| 26 | oooh | `$FE62` | DAC `$1D786`, rate `$18`, pri 0 |
| 27 | id_27 | `$FED0` | FM ch2 `$100C4` |
| 28 | id_28 | `$FEEC` | FM ch2 `$100E2` |
| 29 | id_29 | `$FEDE` | FM ch2 `$1011E` |
| 30 | id_30 | `$FEFA` | FM ch2 `$1013C` |
| 31 | id_31 | `$FE76` | DAC `$1FCE8`, rate `$1B`, pri 0 |
| 32–34 | (id_30) | `$FEFA` | same handler as 30 |

`configure_ym2612` (`$FD44`) isn't in the table. `Sound_StopMusic` (`$F5C4`) and `Sound_PauseMusic` call it, and it requests DAC `$14882` at rate `$0B`, priority 0. That sample is empty, so the request cuts any playing DAC SFX.

The "Handler label" column above is the disassembly's handler label, not the sound's name. Those labels, and the table's comments, are shifted against the IDs. Step 6 names each SFX by ID from the EA sound list and the `src/ram.asm` equates, and lists every mismatch: see [`docs/NHL92-68K-DRIVER.md`](NHL92-68K-DRIVER.md#sfx-labels-in-soundasm-are-shifted-against-the-ids).

### FM SFX streams (`$FF74`–`$10179`)

`Sound_Process_SFXChannels` reads these opcodes; any other byte is skipped:

| Byte | Args | Meaning |
|---|---|---|
| `$80 id` | 1 | Instrument (loaded only if it differs from the current one), then key-on. |
| `$81 n` | 1 | The next sweep plays `n` extra times (restarting from its start frequency each time). |
| `$82 n` | 1 | Like `$81`, but each replay also sets Z80 slot +0 so the patch reloads. |
| `$83 n f s` | 1 + 4 + 4 | Sweep: start frequency `f` (long), signed step `s` (long) added each frame for `n` frames. `f` above `$7FF` is halved into higher blocks. |
| `$84` | 0 | Stop: key-off and free the channel. |
| `$85` | 0 | Loop to the start of the stream. |

The retail streams contain 26 instrument commands, 36 `$81` repeat counts, 36 sweeps and 17 stops, and never `$82` or `$85`. Every stream is followed by one byte the driver never reads, because the `$84` before it stops processing; the tests pin these bytes.

### DAC samples

`Sound_WriteYM2612` leaves 6 bytes at `$FFFFFFE6`:

- **`$FFE6`–`$FFE7`:** the sample address as a Z80 bank-window address (`| $8000`).
- **`$FFE8`:** 0.
- **`$FFE9`:** rate. Each byte lasts 161 + 17 × rate Z80 T-states.
- **`$FFEA`:** bank (address >> 15).
- **`$FFEB`:** priority.

The Z80 driver skips the byte at the sample address and plays bytes from address + 1 up to a 0 terminator. The byte after the terminator is 1 to loop; any other value ends playback. None of the NHL 92 samples loop. When a sample crosses into a new 32 KB bank, the Z80 skips the byte at window `$FFFF`; crowdboo and id_31 cross such a boundary.

The samples sit back to back:

| Start | Played bytes | Used by |
|---|---|---|
| `$11C3E` | 3,607 | puckwall1 |
| `$12A58` | 3,845 | puckbody |
| `$13960` | 3,871 | puckget |
| `$14882` | 0 | `configure_ym2612` (stop) |
| `$14886` | 3,807 | puckwall3, puckpost, puckice |
| `$15768` | 4,415 | playerwall, check, check2 |
| `$168AA` | 1,367 | hithigh, hitlow, id_23 |
| `$16E04` | 27,007 | crowdboo |
| `$1D786` | 9,567 | oooh |
| `$1FCE8` | 9,663 | id_31 |
| `$222AA` | 8,031 | id_3, whistle |

## Bytes nothing reads

The tests pin these ranges exactly, so any new or missing leftover fails a test:

- **17 single bytes after each FM SFX stream's `$84`.** Most are 0; four are not.
- **`$10293`:** one byte after envelope 3's `$84`.
- **`$10610`–`$1061D`:** 14 bytes after the last order list. They look like small patterns (`C0 60 84`, `80 00 B0 60 84`, `80 00 C0 60 60 84`), but no list points to them.
- **`$10626`–`$10634`, `$10638`–`$10652` and `$10659`–`$10661`:** unused transpose stubs.
- **`$113E1`–`$11409`:** a 41-byte melodic pattern no order list uses.
- **`$11623`:** one byte before the code at `$11624`.
- **`$14885`:** one byte between the stop sample and `$14886`.
- **`$2420C`–`$24213`:** 8 bytes after the last sample, at the end of the sound module.

## Not covered here (step 6)

This reference covers the format only. How the driver turns the data into timing is left for step 6. That includes the duration counter and the key-off on the last tick, modulation and envelope arithmetic, and SFX channels pre-empting music slots. It also includes when one channel's song switch takes effect relative to the others.
