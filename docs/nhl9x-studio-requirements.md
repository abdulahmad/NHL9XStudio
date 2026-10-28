# NHL9X Studio — requirements and implementation plan

**In-repo copy:** [docs/nhl9x-studio-requirements.md](https://github.com/abdulahmad/nhl9xstudio/blob/main/docs/nhl9x-studio-requirements.md) in [NHL9XStudio](https://github.com/abdulahmad/NHL9XStudio). Keep both files the same.

**Related:** `docs/DESIGN.md` (product shell), `lib/jim.js` (decode-only today), `public/ice.js` + `jed.html` (PC ice/jersey UX to reuse), EA-NHL-Tools `JIM-Tools/` (do **not** treat as format truth).

This plan is for a **Genesis `.map.jim` import / edit / export tool** inside NHL9X Studio, plus **hiding Chip Lab** in the product chrome. It is not a rewrite of the viewer, the PC ice editor, or ANIM/SHPI editing.

---

## 1. Decisions (read first)

| Decision | Choice |
|----------|--------|
| Chip Lab | **Hide** the header link now. Keep `public/chip-lab.html` and tests. Direct URL still works. Re-show later. |
| Canonical compressed JIM | Same `.map.jim` container as uncompressed. Packed iff **bit 15 of the tile-count word at `0x08`** is set. **Do not** invent `.jzip` as a game format. |
| Compression source of truth | **93G** `src/decompress93.asm` `DecompressBytecode` and **94G** `src/decompress94.asm` (same opcode table). Studio already ports this in `lib/jim.js` `decompressBytecode`. There is **no compressor** in 93/94 source — write a new encoder that this decompressor accepts. |
| Do not copy | EA-NHL-Tools `JIM-Tools/Readme.md` “JZIP” opcode table. It is incomplete and disagrees with the game (see §4). |
| Color 0 | Index 0 of a palette is **transparent** on import when the source has alpha. Palette **0** may also be an opaque backdrop fill (Studio already treats pal 0 color 0 as drawn; pals 1–3 color 0 as a hole — `lib/jim.js` `picturePixelHidden`). |
| Unique colors | **15–61** depending on how many palettes are open and whether pal 0 color 0 is opaque. See §3.4. |
| ACT lock | One `.act`: colors **1–16 → pal 0**, **17–32 → pal 1**, **33–48 → pal 2**, **49–64 → pal 3** (1-based Photoshop numbering = ACT indices 0–15, 16–31, …). Lock per palette independently. |
| UI home | New **Maps** page next to **Jerseys** (`jed.html` / `ice.js` pattern), plus **Edit map** from the Images tab for `kind: 'jim'`. |
| v1 non-goals | Portrait 3-byte packing, ANIM sprites, SNES `.map.sjim`, PC TIL/MAP, writing back into a ROM. |

---

## 2. Product requirements

### 2.1 Chip Lab (now)

- [ ] Remove the **Chip lab** button from `public/index.html` header (`<a href="chip-lab.html">`).
- [ ] Keep `public/chip-lab.html`, `chip-lab.js`, `chip-lab.css`, `lib/audio/chip-lab-*.js`, and `test/chip-audio.js`. Do not delete.
- [ ] `server.js` may keep serving those paths.
- [ ] Optional later: a small “dev tools” disclosure or `?chip=1` to show the link. Not required for v1 hide.
- [ ] Update copy that tells people to open Chip Lab from the header (`docs/NHL92-SOUND-HANDOFF-FOR-CLAUDE.md` “local viewer + chip lab”). Sound test and sequencer stay.

### 2.2 Map editor — user-required features

Must all appear in the shipped tool.

| # | Requirement | Notes |
|---|-------------|--------|
| U1 | Import / edit / export `.map.jim` | Open a loose file, a catalog Images-tab picture, or a ROM slice. Export a new `.map.jim`. |
| U2 | Choose how many palettes | User picks which of **0, 1, 2, 3** to use, and how many (1–4). Unused palettes stay empty / unused in the map. |
| U3 | Lock palettes from one `.act` | Import Adobe Color Table. Colors 1–16 lock pal 0, 17–32 pal 1, etc. **Lock pal 0 and leave pal 1 open** (and any other mix). Locked palettes are not rewritten by quantization. |
| U4 | Seamless multi-palette tiles | If more than one palette is in use, adjacent tiles on different palettes must not show a hard color break. Assignment is per **8×8 tile**, not JIM-Tools’ 4/9 rectangles. |
| U5 | Export uncompressed **or** compressed | Uncompressed = 92G / `DoDMApro` path. Compressed = 93G/94G `DecompressBytecode` (also 95G). User picks per export. Default: uncompressed for 92G-shaped files, compressed for 93/94/95. |
| U6 | See the tile map | Grid of map cells, selected tile highlighted, zoom, optional 8×8 grid overlay. |
| U7 | Place tiles and rotate them | Paint / place / erase like `ice.js`. H-flip and V-flip are map bits. 90°/270° **create new tiles** (VDP has no rotate bit — same as PC ice). 180° = both flip bits. |
| U8 | Batch import | Several images in one session. Each batch (or layer) can target a palette or “any open palette”. |
| U9 | Transparency | Source alpha &lt; threshold → palette index **0**. Checkerboard for holes. Pal 0 color 0 is still stored (backdrop). |
| U10 | Two-step color conversion | (A) reduce to **3-bit** Genesis RGB (512 CRAM colors). (B) reduce to **15–61** unique colors by palette config. **Optional reverse order** (reduce count first, then snap to 3-bit). |
| U11 | Per-step method + dither | At **each** of A and B the user picks: color method and dither. See §2.3. |
| U12 | Think ahead | Features below that the codebases already imply. |

### 2.3 Color methods and dither (at each step)

**Color reduction (Photoshop-like, plus ones that earn their keep):**

| Method | What it optimizes | Use |
|--------|-------------------|-----|
| **Perceptual** | Weighted luma (G &gt; R &gt; B); keep gradients | Photos, ice, crowd |
| **Selective** | Protect ice whites, skin, primary jersey hues | Logos, portraits later, team art |
| **Adaptive** | Actual image histogram (median-cut / popularity) | Default for screens |
| **Uniform** | Snap only to the 3-bit lattice, no clustering | Step A with dither, or debug |
| **Weighted k-means** | Same distance as `lib/pc-palette.js` (`2R²+4G²+3B²`) | Reuse proven Studio code; 6-bit PC vs 3-bit Genesis |

**Dither:**

| Mode | Detail |
|------|--------|
| **None** | Nearest color |
| **Diffusion** | Floyd–Steinberg (or similar). **Strength %** (0–100), like Photoshop. |
| **Pattern** | Ordered Bayer 8×8 (JIM-Tools already does this in `bmp3bitConverter.js`) |
| **Noise** | Threshold noise; keep it deterministic (seeded), not `Math.random` |

Defaults: Adaptive + None for step B; Uniform + None for step A. Remember last choice per session.

### 2.4 Grounded extras (from the games and Studio, not guesses)

#### Genesis VDP / tiles / palettes

- Tiles are **8×8**, **4bpp**, **32 bytes**, **row-major** (VDP stamp format). This is **not** the sprite path: `.anim` frames are **column-major** (`lib/anim.js`). Do not mix packers.
- Name-table word (93G `docs/file-formats.md` Map section; same bits in JIM-Tools map table, which *is* correct):

  | Bits | Field |
  |------|--------|
  | 10–0 | Tile index (0–2047) |
  | 11 | H-flip |
  | 12 | V-flip |
  | 14–13 | Palette 0–3 |
  | 15 | Priority (low/high) |

- **2048 unique tiles** is the hardware cap (11-bit index). `lib/jim.js` currently allows decode up to 4096 — the editor must **warn at 2048** and refuse export above that.
- CRAM: 4 lines × 16 colors. Word format **`0000 BBB0 GGG0 RRR0`** (`lib/anim.js` `decodeCram` / 93G palettes section). 3 bits per channel, 512 legal colors. Encode with the inverse of `expandChannel` (round to 0–7, pack).
- **Palettes vs CRAM:** the `.map.jim` stores up to **128 bytes** (4 lines) at the palette offset. In game, `dobitmap` (`src/middle93.asm`) copies **selected lines** into the fade buffer using a **bitmask** in `d5` (bit 0 = line 0, …). A picture may legally use only palettes 0–1 even though 128 bytes are stored. The editor shows which lines the **map actually references** and which lines `dobitmap` would load.
- **15 unique + index 0:** each tile may use at most 16 indices from **one** line. Index 0 is the transparent / backdrop slot. Usable ink colors:

  | Palettes in use | Pal 0 color 0 opaque? | Unique ink colors |
  |-----------------|----------------------|-------------------|
  | 1 | no (all holes) | **15** |
  | 1 | yes | 16 |
  | 2 | pal0 yes, pal1 hole | 16+15 = 31 |
  | 3 | | 16+15+15 = 46 |
  | 4 | | 16+15+15+15 = **61** |
  | 4 | all holes | 15×4 = 60 |

  That is the user’s **15–61** range. Show the live count.

- **Dedup:** identical 8×8 pixel tiles (and H/V-flipped copies) collapse to one tile + flip bits, as `ice.js` / `lib/pc-rink.js` already do for PC. Copy-on-write when painting a shared tile.
- **Priority:** expose per cell (bit 15). Default 0. `dobitmap` **XORs** `printa` (`$F800` attribute bits) onto every map word, so in-game priority/palette can flip relative to the file. Show a “preview with `printa`” toggle; do not bake `printa` into export unless the user asks.
- **Collision:** **not** in the JIM. Ice physics live in `hockey93.asm` (radii, walls, nets), not per-tile flags. Do not add a fake collision layer. 94G `Rinktilelist` / `RevRinkTilelist` are still JIM-shaped maps, not collision.
- **Plane size:** `Title1` is 32×28; `Arrows` 12×23; `Framer` 3×3 (93G file-formats). `IceRinkMap` is a **scrolling** plane (`updatescroll` in `video93.asm` walks map rows). Editor must allow maps larger than 40×28 and scroll the canvas. Warn if width/height is 0 or &gt; 1024 (current `decodeJim` cap).
- **Remap:** some pictures (`Framer.map.jim` in `lib/games.js`) apply a **color remap table** at load (`DecompressGraphicsWithRemap`). Viewer option, not baked into tiles on export unless the user is editing the post-remap look and confirms.

#### JIM variants the editor must recognize

| Variant | How Studio detects it (`lib/jim.js`) | v1 editor |
|---------|--------------------------------------|-----------|
| Normal map + 4 palettes | pal offset and map offset both nonzero and distinct; tiles raw or packed | **Full edit** |
| Packed tiles | tile word bit 15 set | Decode with `decompressBytecode`; encode with new compressor |
| No palette (`$FFFFFFFF` at +0) | donor CRAM (ice palette) | Edit pixels; export with `$FFFFFFFF` or embed palettes |
| Shared / zero header | palOff = mapOff = 0 | Often portraits or arena sheets |
| Portrait 3-byte rows | palOff = 10 + tiles×24, or 6×6 shared 36 tiles | **Read-only** + message. `UnpackPicture` in 94G `title94.asm`: 3 bits/pixel **+ 5** |
| Logo, palOff === mapOff | team CRAM from ROM (`TeamLogoPalettes`) | Edit map/tiles; palette from donor / lock-ACT |
| Arena gfx sheet | no map, sequential tiles | Optional tile-sheet mode (95G `ArenaGfx*`) — **v1.1** |

File names: keep **`.map.jim`** even when packed. 94/95 extractors also use `.bin` for JIM-shaped blobs (`EASportsMap.bin`, `Card*.bin`). Open those if `decodeJim` accepts them; export using the **opened name**.

#### Map editing UX (parity with PC ice, Genesis-specific where needed)

Reuse `public/ice.js` / `jed.html` habits:

- [ ] Tools: **Paint pixel**, **Place tile**, **Erase cell**, **Select**, **Pick color**, **Pan**.
- [ ] Tile strip: used tiles, New / Delete / Remove unused / Mirror / Flip.
- [ ] Cell inspector: tile index, pal 0–3, H/V flip, priority.
- [ ] **Undo / Redo** (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y), ≥100 steps, like ice and JED.
- [ ] Copy / cut / paste / clear selection.
- [ ] Zoom 1–16×, nearest-neighbor, grid toggle.
- [ ] Floating import (drag to place, Apply / Cancel) — same as ice image import.
- [ ] Status line: tile count / 2048, colors used / budget, packed vs raw, warnings.

Preview:

- [ ] Full composed bitmap (current `decodeJim` pixels).
- [ ] Transparency on/off (Images tab already has this).
- [ ] Optional jersey/team donor palette for pictures that use ice/team CRAM.
- [ ] **Seam overlay:** highlight tile borders where left/right or up/down palettes differ.

Validation before export:

- [ ] Every map tile index &lt; tile count.
- [ ] Every tile uses only indices 0–15 of **its** palette (never raw 0–63 in the 4bpp nibble).
- [ ] Locked ACT colors unchanged.
- [ ] Packed stream decompresses to `tiles × 32` bytes with Studio’s `decompressBytecode`.
- [ ] Uncompressed export is byte-identical on a no-op round-trip of a raw 92G JIM (tiles + pal + map). Packed export need **not** match EA’s compressed bytes — only the decompressed tiles.

Round-trip:

- [ ] Open retail `IceRink.map.jim` / `Title1.map.jim` / `RonBarr.map.jim` (fixture `test/fixtures/JIM-Tools/ronbarr.map.jzip` is a **packed** JIM, tile word `0x803D` = 61 tiles) → export uncompressed → decode → pixels and map words match.
- [ ] Export compressed → `decompressBytecode` → same tile bytes.
- [ ] Re-import the exported file with no edits → no dirty flag.

### 2.5 Batch import UX

- [ ] Add files (PNG / BMP / GIF / JPEG, plus `.act`).
- [ ] Per file: target palettes (subset of the document’s open pals), lock-from-ACT or not, crop to 8-pixel multiple (pad with transparent).
- [ ] Order in the list is paint order (later files overwrite cells unless “only empty cells”).
- [ ] One **Apply all** after a combined preview.

### 2.6 Nice-to-have (v1.1, still worth designing for)

- Eyedropper that shows CRAM word + RGB8 + palette line.
- Export PNG of the composed map and of the tile sheet.
- Export / import `.act` of the four lines (768-byte and 772-byte trailer, as JED already does).
- Palette editor (3-bit sliders) for **unlocked** lines; locked lines are read-only.
- “Show unused tiles” and “show cells using this tile”.
- Compare view: original vs quantized vs dithered.
- Note field for `printa` / VRAM start char (not stored in JIM; useful when pasting into a disassembly).

### 2.7 Explicitly later / out of scope

| Item | Why |
|------|-----|
| Writing the JIM into a ROM / rebuilding 93G/94G | Needs size budget; 93G packed sizes are baked into extract slices. Export a file; the user `incbin`s it. |
| ANIM / sprite editor | Different tile order and frame table. DESIGN.md “repack ANIM” stays later. |
| SNES `.map.sjim` | Same bytecode, different wrapping (`nhlpa93snes/docs/file-formats.md`). |
| PC centre-ice TIL/MAP | Already `ice.js`. Do not merge formats. |
| Portrait `UnpackPicture` encode | Different 3-bit packing (`title94.asm`). |
| Chip Lab feature work | Hidden, not improved. |
| Collision / walkable overlay | Not in the JIM. |

---

## 3. How to implement

### 3.1 Architecture

```
public/index.html          hide Chip Lab link; add Maps button
public/jim.html            Map editor shell (jed.html layout: chrome + canvas + side panels)
public/jim.js              UI: tools, undo, import wizard, preview
lib/jim.js                 TODAY: decodeJim, decompressBytecode, unpackPortrait
                           ADD:  parseJim, encodeJim, compressBytecode, tile/map helpers
lib/genesis-quantize.js    NEW: 3-bit snap, reduction methods, dither, ACT lock, seam-aware pal assign
lib/open-asset.js          already classifies .jim / .map.jim
lib/games.js               Images catalog; “Edit map” uses existing jim slices
public/viewer.js           Images tab: Edit map → jim.html#game=&image=
test/jim-roundtrip.js      NEW: codec + compressor vs 93/94 fixtures / ROM slices
```

Reuse, do not fork:

| Existing | Reuse for |
|----------|-----------|
| `lib/jim.js` `decompressBytecode` | Golden decompressor for the new encoder |
| `lib/anim.js` `decodeCram` / `expandChannel` | CRAM ↔ RGB8 |
| `public/ice.js` tools, undo, float import, flip/rotate | UX |
| `lib/pc-palette.js` k-means + slot lock idea | Quantize, but 3-bit / 4×16 not 6-bit / 64 |
| `public/jed.js` ACT 768/772 read/write | ACT I/O |
| `lib/open-asset.js` | Drop a `.map.jim` onto Studio |
| 93G `src/decompress93.asm` | Opcode comments when writing `compressBytecode` |
| 94G `src/decompress94.asm` | Confirm identical table (it is) |
| `test/fixtures/JIM-Tools/ronbarr.map.jzip` | Packed golden (61 tiles) |

Do **not** import `JIM-Tools/decompressJim.js`, `uncompress-jzip.js`, or `genesis-color-reduce.js` as the engine. Port algorithms only after they match §4.

### 3.2 Data model (in-memory)

```text
JimDoc {
  name,               // IceRink.map.jim
  variant,            // 'map' | 'nopal' | 'shared' | 'portrait' | 'sheet'
  packedOnDisk,       // bit 15 was set when opened
  tiles: Uint8Array[], // each 64 nibbles 0–15, row-major 8×8 (editor space)
  mapW, mapH,
  cells: { tile, hFlip, vFlip, pal, priority }[],
  palettes: [16][4] of { r3,g3,b3, locked: bool },  // 4 lines
  usedPals: Set<0-3>,
  donor: Uint8Array | null,   // 128-byte CRAM when file has no palettes
  remap: number[] | null,     // viewer remap, not stored
  dirty, undo[], redo[]
}
```

Editor tiles are **unflipped, single-palette nibbles**. Flip bits live on the cell. When encoding, pack 4bpp row-major 32-byte stamps (high nibble = left pixel, as `decodeJim` already assumes).

### 3.3 Color pipeline

User-visible order toggle:

1. **Default (JIM-Tools order):** snap to 3-bit lattice → then cluster into 15–61 ink colors with palette assignment.
2. **Reverse:** cluster in 8-bit (or working space) down to the budget → then snap each chosen color to 3-bit (may collapse two inks; warn and merge).

Per step: method + dither from §2.3. Preview A, preview B, then commit to the floating import.

**ACT lock:** for each locked palette *p*, ACT entries `16p .. 16p+15` (0-based) become that line’s 16 CRAM colors (snap to 3-bit if needed, warn if they were not already Genesis colors). Index 0 of that line stays the transparent slot unless pal 0 is marked opaque. Quantizer **must not** rewrite locked lines; it may only **match** image pixels to them.

JIM-Tools `--forcepalN=file.act` reads **the first 16 colors of a separate ACT per slot**. Studio follows the **user’s one-ACT layout**, not that CLI.

**Seam blending (U4) — required algorithm, not 4/9 boxes:**

1. After step A, every pixel is a 3-bit RGB (or transparent).
2. For each 8×8 tile, collect its ink colors (ignore index-0 / alpha).
3. Assign each tile a palette in `{open pals}` that can hold its colors, preferring:
   - reuse a palette that already contains those CRAM colors;
   - keep the same palette as the 4-neighbors (smoothness cost);
   - if it does not fit, steal unused slots on that palette, else try another palette, else split/merge (k-means on the tile).
4. If two neighbor tiles use different palettes, copy **border colors** into both lines while slots remain so the shared edge is the same RGB.
5. Fail visibly if a tile needs &gt;15 inks after merge (offer dither / more palettes / Selective).

JIM-Tools `genesis-color-reduce.js` splits the bitmap into **4 or 9 rectangles**. That is too coarse for a rink or title screen and is why seams look bad. Do not ship that as the only assigner. A “quadrant” mode can exist as a debug preset.

### 3.4 Compression — implement from the game, not from JIM-Tools

**Decoder (already in Studio):** `lib/jim.js` `decompressBytecode`, comments cite NHL94 `video94.asm`. 93G and 94G tables match.

**Encoder (new):** `compressBytecode(tileBytes) → stream` such that `decompressBytecode(stream, 0, tileBytes.length)` equals `tileBytes`. Ring of **256 bytes**. End code: opcode **`$Ex` with following distance byte 0** (`Opcode_CopyBackwardReverseMedium` in `decompress93.asm`).

Opcode table to emit (93G `docs/file-formats.md` + `DecompressOpcodeTable`):

| Opcode | Meaning |
|--------|---------|
| `$00–$1F` | copy next (n & `$1F`)+1 literal bytes |
| `$2x` | write (x+1) zeros |
| `$3x` | write next byte (x+3) times |
| `$40–$7F` | copy (bits 0–2)+2 bytes from (bits 3–5)+1 back |
| `$8x` | copy x+3 from distance in next byte |
| `$9x` | 5-bit count + 7-bit distance (next byte) |
| `$Ax` / `$Bx` | longer forward copies |
| `$C0–$DF` | reverse copy, short |
| `$Ex` | reverse copy medium; **distance 0 = end** |
| `$Fx` | reverse copy long |

Strategy: greedy LZ77 over the 256-byte window, pick the shortest encoding among the legal opcodes, fall back to literals. **Correctness over ratio.** Ratio can improve later if tests stay green.

**Do not implement** the JIM-Tools “JZIP” commands (`0x4` “pattern repeat”, signed `0x9` at “5% confidence”, etc.). Those are a reverse-engineering draft that does not match `DecompressBytecode`.

Packed file layout (game / Studio — **not** the JIM-Tools `.map.jzip` table):

```
+0  long  palette offset (or $FFFFFFFF)
+4  long  map offset
+8  word  tile count | $8000
+A  bytes packed tile stream
then palettes (128 bytes if present)
then map: width.w, height.w, width*height words
```

Proof that JIM-Tools header text is wrong: fixture `ronbarr.map.jzip` starts `00 00 04 C4 00 00 05 44 80 3D …` — palette at `$4C4`, map at `$544`, tile word **`$803D`** (packed, 61 tiles). JIM-Tools Readme says byte `$08` is “palette size” and `$09` is tile count. `$80` is only the high byte of the packed count.

92G: tiles are raw (bit 15 clear). `DecompressGraphics` is **new in 93** (`decompress93.asm` header). Exporting compressed JIMs for 92G would not load in that game.

### 3.5 UI surfaces

1. **Header:** Maps button (show). Chip Lab button (hide).
2. **`jim.html`:** left = file / palettes / ACT / import queue; center = map canvas; right = tile strip + cell inspector + export (raw / packed).
3. **Images tab:** for `kind === 'jim'`, an **Edit map** control that opens `jim.html` with the same bytes the viewer decoded (including donor palette).
4. **Drop overlay:** already accepts JIM (`index.html`). Decode into the editor when Maps is open; otherwise keep today’s Images view.

Match JED/ice visual language (`jed.css`), not Chip Lab.

### 3.6 Where to read 93G / 94G

| Topic | File |
|-------|------|
| Container + map word + packed opcode list | `nhlpa93genesis/docs/file-formats.md` |
| Decompressor (commented) | `nhlpa93genesis/src/decompress93.asm` |
| Same decompressor | `nhl94genesis/src/decompress94.asm` |
| `dobitmap` pal bitmask + map XOR `printa` | `nhlpa93genesis/src/middle93.asm` `dobitmap` |
| Tile load / remap | `DecompressGraphics*` in those files |
| Portrait packing | `nhl94genesis/src/title94.asm` `UnpackPicture` |
| Incbin names | `nhlpa93genesis/src/graphics93.asm`, `nhl94genesis/src/graphics94.asm` |
| Extracted file list | `tools/extractAssets93.js`, `extractAssets94.js` |
| Studio decode | `nhl9xstudio/lib/jim.js` |
| Studio catalog | `lib/genesis-images.js`, `lib/games.js` |

---

## 4. JIM-Tools: what is broken (do not repeat)

Source: [EA-NHL-Tools/JIM-Tools](https://github.com/abdulahmad/EA-NHL-Tools/tree/main/JIM-Tools). Useful as a **workflow sketch** (3-bit → reduce → tiles → JIM) and for dither names. Not as a spec.

| Claim in JIM-Tools | Actual 93/94 / Studio |
|--------------------|------------------------|
| Packed files are a different `.map.jzip` format | Same `.map.jim`; bit 15 of the **word** at `+8` |
| `+8` palette size, `+9` tile count | `+8` is `uint16` tile count; `$80xx` means packed |
| Extra `FF FF FF FF` end marker after the map | End of **tile stream** is `$Ex` + distance `0` |
| Opcode table with “5%–50% confidence”, missing `$2x` zeros, invented “pattern repeat” | Full table in `DecompressOpcodeTable`; Studio `decompressBytecode` already implements it |
| `uncompress-jim.test.js` in Readme | File on disk is `uncompress-jzip.test.js` |
| `exJim-to-jim.js` writes **uncompressed** only | 93G/94G retail pictures are packed |
| Color reduce = 4 or 9 **rectangles** | Need per-tile assignment + seam copy |
| `--forcepalN` = first 16 colors of **that** ACT | User: **one** ACT, 16-color bands, independent locks |
| 3-bit scale “252/7” | Studio uses `expandChannel`: `(c<<5)\|(c<<2)\|(c>>1)` (0→0, 7→255). Match **encode** to that decode |

`lib/jim.js` already decompresses `ronbarr.map.jzip` in `test/core.js`. Keep that test; add encode tests beside it.

Known Studio nits to fix while touching this code:

- `lib/open-asset.js` sniffs ASCII `JI` at offset 0. Real JIMs start with a palette **offset**, not `"JI"`. Classification should use `.jim` / `.map.jim` and/or `decodeJim` try/catch, not magic `JI`.
- JIM-Tools Readme palette length “`+80`” hex vs 128 decimal: the file is **128 bytes** (4×32).

---

## 5. Implementation steps and models

Use only: `claude-opus-5-5-high`, `claude-sonnet-5-5-high`, `gpt-5.6-sol-high`, `grok-4.7-high`, `cursor-grok-4.6-high`, `composer-2.5`.

**Default implementer: `grok-4.7-high`.** Pick another only when the step is clearly a better fit.

| Step | Deliverable | Model | Why |
|------|-------------|-------|-----|
| **0** | Hide Chip Lab link; Maps button stub; docs pointers | `composer-2.5` | Mechanical HTML/docs. No design judgment. |
| **1** | `parseJim` / `encodeJim` uncompressed; structured `JimDoc`; no-op round-trip on 92G raw JIMs | `grok-4.7-high` | Code-heavy against existing `decodeJim`. |
| **2** | `compressBytecode` + tests vs `decompressBytecode` and retail packed slices | `claude-opus-5-5-high` | Encoder must match a real opcode VM. JIM-Tools already failed this by guessing. Opus for correctness-critical format work. |
| **3** | Golden tests: 93G/94G ROM slices + `ronbarr.map.jzip` | `grok-4.7-high` | Test-heavy, fixtures exist. |
| **4** | `genesis-quantize.js`: 3-bit, methods, dither %, reverse order, ACT lock | `gpt-5.6-sol-high` | Quantization / dither math. Do not paste JIM-Tools’ 106k JS. |
| **5** | Per-tile palette assign + seam copy (U4) | `claude-opus-5-5-high` | Hardest product requirement; needs a real cost model, not quadrants. |
| **6** | `jim.html` editor chrome: grid, tiles, flips, rotate, undo, inspect | `grok-4.7-high` | Clone `ice.js` patterns onto Genesis cells. |
| **7** | Import wizard (batch, palettes, ACT, two-step preview) | `grok-4.7-high` | UI + pipeline glue. |
| **8** | Visual pass: seams, dither, transparency checkerboard | `claude-sonnet-5-5-high` | UI/visual judgment after the engine works. Not Opus (cost) and not Composer (too shallow). |
| **9** | Images-tab **Edit map**, drop-to-editor, export raw/packed | `grok-4.7-high` | Studio wiring. |
| **10** | Playwright smoke + `test/jim-roundtrip.js` in `test/select.js` | `grok-4.7-high` | Matches existing test style. |

`cursor-grok-4.6-high`: use only if 4.7 is unavailable for a follow-up on the same files. Not first choice.

### Step notes

**0 — Chip Lab / chrome**  
Hide the header link. Add **Maps** → `jim.html` (can be an empty shell). Do not break `test/chip-audio.js`. Update NHL 92 sound handoff “viewer + chip lab” wording.

**1 — Uncompressed codec**  
Split `decodeJim` into parse (header, tiles, pals, map words) + rasterize (what the Images tab needs). `encodeJim({ packed:false })` writes the 12-byte header, raw tiles, 128-byte CRAM, map. Preserve `$FFFFFFFF` / shared-header variants when opened that way.

**2 — Compressor**  
Implement from `decompress93.asm` handlers only. Property test: random 32×N tile buffers, compress → decompress. Then retail: take decompressed tiles of `IceRink` / `Title1` / Ron Barr, recompress, decompress, compare. Measure size vs retail (info only).

**3 — Goldens**  
When `nhlpa93.bin` / `nhl94.bin` are present, reuse `lib/genesis-images.js` slices. Always run the bundled Ron Barr packed file.

**4 — Quantize**  
API: `quantize(rgba, { order, stepA, stepB, pals, lockedLines, opaquePal0 })`. Deterministic. Unit-test: transparent pixels → 0; locked ACT colors survive; 3-bit output only uses 0–7 per channel.

**5 — Seams**  
Input: quantized RGB tiles + open pals + locked lines. Output: pal index per tile + filled CRAM lines. Overlay for the UI. Test with a 2-palette gradient that crosses a tile boundary.

**6–7 — Editor**  
Keyboard: same as ice where it does not clash. Rotate 90/270 adds tiles; status says so. Batch import uses the float preview.

**8 — Visual**  
Check Title1, IceRink, a logo, and a locked-pal-0 / open-pal-1 import. Look at seams at 4× and 8×.

**9 — Integration**  
`viewer.js` Images details: **Edit map**. Pass bytes via Blob URL / `sessionStorage` (no ROM upload). Pages build: include `jim.html`.

**10 — Tests**  
`test/select.js` rule for `lib/jim.js` / `lib/genesis-quantize.js` / `public/jim.js`. Browser: open Maps, load fixture, undo, export.

---

## 6. Suggested ship order (milestones)

1. **M0** — Chip Lab hidden; Maps stub; this doc in repo.  
2. **M1** — Open/save uncompressed JIM; edit tiles/map/flips; undo. No import from PNG yet.  
3. **M2** — Packed export/import matching `DecompressBytecode`.  
4. **M3** — PNG/BMP import: 3-bit, reduce, dither, ACT lock, one image.  
5. **M4** — Multi-palette seams + batch import.  
6. **M5** — Images-tab integration, goldens on 93/94 rinks/titles, polish.

Each milestone is a PR titled `DOCS:` (M0) or `TOOLS:` / feature (`MAPS:` is fine if you want a prefix; DESIGN.md does not require it). Do not merge unless asked.

---

## 7. File-level checklist (when building)

- [ ] `public/index.html` — Chip Lab link gone; Maps link added  
- [ ] `public/jim.html` + `public/jim.js` + CSS (share `jed.css` if it fits)  
- [ ] `lib/jim.js` — parse/encode/compress; keep `decodeJim` working for the viewer  
- [ ] `lib/genesis-quantize.js` — new  
- [ ] `lib/open-asset.js` — drop classification without `JI` magic  
- [ ] `public/viewer.js` — Edit map  
- [ ] `server.js` — serve `jim.html` / `jim.js`  
- [ ] `test/jim-roundtrip.js` + `test/select.js`  
- [ ] `docs/DESIGN.md` roadmap line (graphics editing)  
- [ ] `docs/TODO.md` / `docs/AGENT-HANDOFF.md` backlog  

Credits for any extracted encoder comments: 93G/94G authors as in those READMEs; Studio credits unchanged.

---

## 8. Document history

| Date | Change |
|------|--------|
| 2026-10-28 | First requirements + implementation plan (Chip Lab hide, `.map.jim` editor). |
