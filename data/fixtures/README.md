# NHL 92 sound fixtures (Z80 test)

These files are **not** a full Genesis ROM. They are a slice of the retail **NHL Hockey** (1991) cartridge sound region (driver, Z80 program, FM tables, SFX cmdstreams) used so the **Z80 test** game works on GitHub Pages without supplying a ROM.

| File | Purpose |
|------|---------|
| `nhl92-sound-slice.bin` | ROM bytes `0xF4C8`–`0x24214` (sound module) |
| `nhl92-z80-program.bin` | Z80 sound program (`0x116A6`, 1432 bytes) |
| `nhl92-sound-fixture.json` | Offsets and sizes (metadata) |

To refresh from your own cartridge dump:

```bash
# place dump at roms/nhl92.bin, then:
node tools/extract-nhl92-sound-fixture.js
```

For sprites, pictures, and the main **NHL 92** game mode you still need the full ROM (your own dump). Typical names: `nhl92.bin`, `NHL Hockey (USA, Europe).md`.
