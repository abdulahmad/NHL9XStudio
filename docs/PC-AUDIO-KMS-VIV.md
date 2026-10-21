# PC audio: `.KMS` and `.VIV` (94PC / 95PC)

Retail install trees (`pc94/`, `pc95/`) are **not** bundled in this repo. Parsers and a minimal OPL player are tested on fixtures in `test/pc-audio-kms.js`.

## `.KMS` — Kris' Music System

- Distinctive Software format; external **`.vce`** instrument banks per output device (AdLib, MT-32, …).
- Documented partially on [Modding Wiki](https://www.shikadi.net/moddingwiki/Kris%27_Music_System_Format) and [VGMPF](https://vgmpf.com/Wiki/index.php?title=KMS).
- **Parser:** `lib/audio/kms.js` (`parse`) — file header, track table, HDR1 song-data block, common events (`$DC` instrument, `$DD` tempo, `$DE` volume, `$01–$CF` notes).
- **Playback (feasibility):** `lib/audio/kms-player.js` drives the MIT [`opl3`](https://www.npmjs.com/package/opl3) YMF262 core in OPL2 mode with a stand-in patch until `.vce` banks are loaded. Not compared to the DOS executable.

### Still missing on the VM

- Real `.kms` / `.cfg` / `.vce` files from a 94PC or 95PC install for hash pins and ear checks.
- Full event opcode table (wiki marks several events unknown).
- MT-32 / PC speaker paths (KMS supports them via other VCE sets).

## `.VIV` — announcer / menu speech

- EA archive; may embed **`BNKl`** sound banks, ASF music, or loose samples.
- **BNK** headers: `lib/audio/viv.js` (`findBnk`, `parseBnkHeader`) following [EA-MUS / MultimediaWiki](https://wiki.multimedia.cx/index.php/Electronic_Arts_Formats_(2)).
- Forum reports (`XBRUCE.VIV`): extracted clips are often **IFF `8SVX` bodies without the `FORM` header** (~5.5–6 kHz mono). `findIffSpeech` locates `8SVX` / `FORM` markers only; no full VIV unpack yet.

### Reference tools (out of tree)

- [EA-NHL-Tools](https://github.com/abdulahmad/EA-NHL-Tools): `VIV-To-WAV`, `DIG-To-WAV`, `IFF-To-WAV` (Windows-oriented).

## Tests

`node test/pc-audio-kms.js` (also run via `node test.js`): synthetic KMS round-trip + OPL peak; minimal BNK header inside a buffer.
