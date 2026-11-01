# PC audio: `.KMS` and `.VIV` (94PC / 95PC)

Retail install trees (`pc94/`, `pc95/`) are **not** bundled in this repo. Layouts here come from the NHL 95 PC / NHL 94 PC executables (`nhl95pc`, `NHL94PC` `docs/MUSIC_FORMAT.md` / `docs/SFX_FORMAT.md`, worked out from `HOCKEY.EXE` and `YM30.BGP`). Not from the old EA-NHL-Tools IFF-To-WAV / wiki Kris notes.

The wiki Kris parser is tested in `test/pc-audio-kms.js` and is **not** what 94/95 PC play. NHL 94/95 PC songs, SFX, VIV, and IFF are tested in `test/pc94-audio.js` and `test/pc95-audio.js`.

## NHL 94 / 95 PC EACSNDF songs (`.KMS` + `.CFG`)

This is **not** the wiki Kris' Music System container in `lib/audio/kms.js`. Both games load the same EACSNDF library (NHL95PC `sub_8F27A` / `sub_990CB` / `sub_99925`).

- **KMS:** version byte 1, tempo at +1, track count at +6, little-endian u16 offsets at +8. First payload is at `0x30`. The TRAK wrapper is unused by the sequencer. Tempo rate is `32000 / tempo` (`sub_8F347`); the interrupt accumulator steps `0x80` (`sub_990CB`).
- **CFG:** 8-byte header, then 16-byte records at +8 (mask u16, volume +6, pan +7, program +0x0C). Channel is the lowest set bit of the mask (`word_D4F68`).
- **Events (`1630:0A90` / `sub_99925`):** VLQ delta, command. Notes `81`–`D8` consume a velocity byte and a duration VLQ; `00`–`80` are duration only (running velocity from `E4`). Retail songs use only `81`–`D8`. `0xD9`/`0xDA`/`0xDB`/`0xE3` have no payload; `0xDF` is two bytes (CC number, value); `0xE5` is u16; `0xE6` is a byte plus u32 LE then a jump to that address + 4; `0xE7`/`0xE8` are length-prefixed. Song-handle transpose at `+0x13` is 0.
- **MIDI send (`1844:022E`):** adds **24** to every note-on and note-off. A KMS byte `9B` is note `1Bh+24` = 51. Without that offset the organ tunes are two octaves low and sound like envelope clicks.
- **Parser:** `lib/audio/pc94-kms.js`
- **SFX:** `lib/audio/pc94-sfx.js` — PCFF `.TIM` / `.DIG` / `.PAT` (`asc_C3FA8` / `asc_C3FB8`). Digital samples are signed 8-bit PCM; the Sound Blaster DAC XOR-flips with `0x80`. PAT records are 20 bytes at `0x102 + 20*(i+1)`. FM timbre type `04`: carrier then modulator, then C0h.
- **Playback:** `lib/audio/pc94-player.js` sequences those events into the MIT `opl3` core (browser copy: `lib/audio/opl3-chip.js`). OPL2 `fnum`/`block` come from the YM30 12-entry table (`fnum = FNUM12[note%12]`, `block = note/12`). Operator registers use offsets `0,1,2,8,9,10,16,17,18` (not operator numbers 6,7,8). Waveform select is enabled (`reg 0x01 = 0x20`). PAT rec[7] is the signed transpose the driver adds at note-on. Channel 9 program is `note+5Ch` (drum programs `80h`–`BFh`). CC7 is volume, CC10 is pan. The Audio tab is `public/sound-test-pc94.js`.
- **Not a YM30.BGP unicorn capture** — envelopes after timbre `+0x0F` are unknown, so this is not an ear match yet.
- MT-32 `.KMS` files (`MT*.KMS`) still take the AdLib path and will not sound like Roland.

## `.KMS` — Kris' Music System (wiki / synthetic tests only)

- Distinctive Software format; external **`.vce`** instrument banks per output device (AdLib, MT-32, …).
- Documented partially on [Modding Wiki](https://www.shikadi.net/moddingwiki/Kris%27_Music_System_Format) and [VGMPF](https://vgmpf.com/Wiki/index.php?title=KMS).
- **Parser:** `lib/audio/kms.js` (`parse`) — file header, track table, HDR1 song-data block, common events (`$DC` instrument, `$DD` tempo, `$DE` volume, `$01–$CF` notes).
- **Playback (feasibility):** `lib/audio/kms-player.js` drives the MIT [`opl3`](https://www.npmjs.com/package/opl3) YMF262 core in OPL2 mode with a stand-in patch until `.vce` banks are loaded. Not compared to the DOS executable. **NHL 94/95 PC do not use this container.**

### Still missing on the VM

- A retail NHL 95 PC install for hash pins of OpenSpeechBank VIV / IFF desk files.
- MT-32 / PC speaker paths (EACSNDF supports them via other banks).

## `.VIV` — announcer / menu speech

### NHL 94 PC (`XBRUCE2.VIV`, `XRBARR2.VIV`)

C0 FB directory: unknown be16 at +2, be16 count at +4, then count × (`u24be` offset, `u24be` size, `name\\0`) from byte 6 — the same slot order as 95 OpenSpeechBank. Reading name-first from byte 12 paired TWELVE with TWENTY's payload. Each lump is BTree **47 FB** wrapping a **72 FB** raw-PCM header (signed 8-bit, 3-byte BE size at +2, PCM at +5). Played at 11025 Hz in the Audio tab (`NhlSoundTestPc94` Speech group). Retail `XBRUCE2.VIV` ends on `PIT.CTY`; `XRBARR2.VIV` ends on `EDM.RNK`.

Labels keep the file stem and suffix role: `.BRU` Bruce, `.BAR` Barr, `.CTY` city, `.RNK` rank, `.MSC` misc, `.OFF` official, `.HOM` home, `.AWA` away, `.INT` intro. Team codes expand only for CTY/RNK/HOM/AWA (`BOS.CTY` → `Boston (city)`). Do not title-case or strip digits (`THE3RD.BAR` → `THE3RD (Barr)`, `TWELVE.BRU` → `TWELVE (Bruce)`).

- **Parser / playback:** `lib/audio/viv.js` (`isViv`, `parseArchive94`, `unpackClip`, `listClips`, `labelOf`, `toFloat32`)
- Tests: synthetic C0 FB + BTree + 72 FB clip in `test/pc94-audio.js`; retail files when `pc94/` (or `NHL_PC94_DIR`) is present

### NHL 95 PC (`XBRUCE2.VIV`, optional `.IFF`)

`OpenSpeechBank`: three big-endian words (type, count, extra), then per clip u24be offset, u24be size, `name\\0`. Packed clips start with **47 FB** (`'G'`) or RefPack **10 FB**. `ReadSpeechSample` unpacks via `sub_98028` then delta-decodes, dropping a 5-byte header (`lib/audio/viv.js` `readSpeechSample`). The Audio tab is the same `NhlSoundTestPc94` module with `setGame('nhl95pc')`.

Loose `.IFF` files are desk music, not speech. **NHL 94 PC has no IFF music files.** NHL95PC `sub_8F98F` loads FORM 8SVX or RIFF WAVE:

- **FORM** `0x4D524F46` 8SVX: `VHDR` samplesPerSec is a big-endian u16 at tag+20; PCM is the `BODY` chunk (no XOR), signed 8-bit. `sCompression == 1` is Fibonacci-delta. A BODY twice the VHDR sample count is still 8-bit — treating it as 16-bit made `AFAN.IFF` / `AWARDS.IFF` twice as fast and scratchy versus `ADAFAN.KMS`.
- **RIFF** `0x46464952` WAVE: sample rate at +0x18, payload from +0x2C, size at +0x28. XOR `0x80`, then 8-bit unless the fmt bits field is 16. Do not use EA-NHL-Tools IFF-To-WAV (rate/2, BODY+4).

Songs and SFX are the EACSNDF `.KMS`/`.CFG` + `PCFF%03d.TIM/.PAT/.DIG` path, not wiki Kris.

### Older sniffers

- EA archive; may embed **`BNKl`** sound banks, ASF music, or loose samples.
- **BNK** headers: `lib/audio/viv.js` (`findBnk`, `parseBnkHeader`) following [EA-MUS / MultimediaWiki](https://wiki.multimedia.cx/index.php/Electronic_Arts_Formats_(2)).
- `findIffSpeech` still locates `8SVX` / `FORM` / `RIFF` markers for leftover buffers.

## Tests

`node test/pc-audio-kms.js` (also run via `node test.js`): synthetic wiki-Kris KMS round-trip + OPL peak; minimal BNK header inside a buffer. `node test/pc94-audio.js` covers EXE-format KMS, PCFF SFX, and 94 PC VIV (labels + no over-read). `node test/pc95-audio.js` covers 95 OpenSpeechBank VIV, IFF FORM 8SVX, IFF RIFF XOR `80h`, and EACSNDF KMS.
