# PC audio: `.KMS` and `.VIV` (94PC / 95PC)

Retail install trees (`pc94/`, `pc95/`) are **not** bundled in this repo. The wiki Kris parser is tested in `test/pc-audio-kms.js`. NHL 94 PC’s EXE-format songs and digital SFX are tested in `test/pc94-audio.js`.

## NHL 94 PC EXE songs (`.KMS` + `.CFG`)

This is **not** the wiki Kris' Music System container in `lib/audio/kms.js`. NHL 94 PC writes a short header (version, tempo, track count, offsets at `0x28`) and a matching 264-byte `.CFG`. Layout: NHL94PC `docs/MUSIC_FORMAT.md` (PR #52) / `HOCKEY.EXE` `1630:0A90`.

- **Parser:** `lib/audio/pc94-kms.js`
- **SFX:** `lib/audio/pc94-sfx.js` — PCFF `.TIM` / `.DIG` / `.PAT`. Digital samples are signed 8-bit PCM; the Sound Blaster DAC XOR-flips with `0x80`.
- **Playback:** `lib/audio/pc94-player.js` sequences those events into the MIT `opl3` core (browser copy: `lib/audio/opl3-chip.js`). The Audio tab is `public/sound-test-pc94.js`.
- **Not a YM30.BGP unicorn capture** — envelopes after timbre `+0x0F` are unknown, so this is not an ear match yet.
- MT-32 `.KMS` files (`MT*.KMS`) still take the AdLib path and will not sound like Roland.

## `.KMS` — Kris' Music System (wiki / 95 PC experiments)

- Distinctive Software format; external **`.vce`** instrument banks per output device (AdLib, MT-32, …).
- Documented partially on [Modding Wiki](https://www.shikadi.net/moddingwiki/Kris%27_Music_System_Format) and [VGMPF](https://vgmpf.com/Wiki/index.php?title=KMS).
- **Parser:** `lib/audio/kms.js` (`parse`) — file header, track table, HDR1 song-data block, common events (`$DC` instrument, `$DD` tempo, `$DE` volume, `$01–$CF` notes).
- **Playback (feasibility):** `lib/audio/kms-player.js` drives the MIT [`opl3`](https://www.npmjs.com/package/opl3) YMF262 core in OPL2 mode with a stand-in patch until `.vce` banks are loaded. Not compared to the DOS executable.

### Still missing on the VM

- Real `.kms` / `.cfg` / `.vce` files from a 94PC or 95PC install for hash pins and ear checks.
- Full event opcode table (wiki marks several events unknown).
- MT-32 / PC speaker paths (KMS supports them via other VCE sets).

## `.VIV` — announcer / menu speech

### NHL 94 PC (`XBRUCE2.VIV`, `XRBARR2.VIV`)

C0 FB named directory (`name\\0` + u24be offset + u24be size from byte 12). Each lump is BTree **47 FB** wrapping a **72 FB** raw-PCM header (signed 8-bit, 3-byte BE size at +2, PCM at +5). Played at 11025 Hz in the Audio tab (`NhlSoundTestPc94` Speech group).

- **Parser / playback:** `lib/audio/viv.js` (`isViv`, `parseArchive`, `unpackClip`, `listClips`, `toFloat32`)
- Tests: synthetic C0 FB + BTree + 72 FB clip in `test/pc94-audio.js`; retail files when `pc94/` (or `NHL_PC94_DIR`) is present

### NHL 95 PC (`XBRUCE2.VIV`, optional `.IFF`)

OpenSpeechBank layout in `HOCKEY.EXE`: three big-endian words (type, count, extra), then per clip u24be offset, u24be size, `name\\0`. Packed clips start with **47 FB** (`'G'`) or RefPack **10 FB**; after unpack a **72 FB** header remains. `ReadSpeechSample` then delta-decodes the PCM (`lib/audio/viv.js` `deltaDecode`). Loose `.IFF` files are 8SVX (`decodeIff`). The Audio tab is the same `NhlSoundTestPc94` module with `setGame('nhl95pc')`.

Songs and SFX are the EACSNDF `.KMS`/`.CFG` + `PCFF%03d.TIM/.PAT/.DIG` path, not wiki Kris.

### Older sniffers

- EA archive; may embed **`BNKl`** sound banks, ASF music, or loose samples.
- **BNK** headers: `lib/audio/viv.js` (`findBnk`, `parseBnkHeader`) following [EA-MUS / MultimediaWiki](https://wiki.multimedia.cx/index.php/Electronic_Arts_Formats_(2)).
- `findIffSpeech` still locates `8SVX` / `FORM` markers for leftover buffers.

### Reference tools (out of tree)

- [EA-NHL-Tools](https://github.com/abdulahmad/EA-NHL-Tools): `VIV-To-WAV`, `DIG-To-WAV`, `IFF-To-WAV` (Windows-oriented).

## Tests

`node test/pc-audio-kms.js` (also run via `node test.js`): synthetic KMS round-trip + OPL peak; minimal BNK header inside a buffer. `node test/pc94-audio.js` covers EXE-format KMS, PCFF SFX, and 94 PC VIV. `node test/pc95-audio.js` covers 95 OpenSpeechBank VIV, IFF 8SVX, and EACSNDF KMS.
