# NHL9X Studio — product requirements

**Product:** NHL9X Studio  
**Repo:** [github.com/abdulahmad/NHL9XStudio](https://github.com/abdulahmad/NHL9XStudio)  
**Live:** [abdulahmad.github.io/NHL9XStudio](https://abdulahmad.github.io/NHL9XStudio/)

This is the product document. It describes what the studio is, who it is for, and what it must do. Byte layouts, codecs, GAP IDs, and engine notes live in [`docs/IMPLEMENTATION.md`](IMPLEMENTATION.md). The Image Editor’s original maps-editor spec is [`docs/nhl9x-studio-requirements.md`](nhl9x-studio-requirements.md). Agent rules are [`AGENTS.md`](../AGENTS.md) and [`docs/AGENT-HANDOFF.md`](AGENT-HANDOFF.md).

**Versioning:** every user-visible merge to `main` bumps `package.json` and prepends `public/changelog.json`. That is the About window. Returning visitors see it again when the version changes.

---

## 1. What this product is

NHL9X Studio is a **modding studio for EA’s 16-bit and DOS NHL games**. One app, one chrome, a **game profile** per title. People open a ROM or a PC install on their machine, browse what the game actually draws and plays, and edit the assets they are allowed to export. Nothing is uploaded. Nothing is written back into a ROM.

**Today** the studio is a graphics browser plus three editors (images, jerseys/ice, sound) and hidden Chip Lab. **Next** it fills remaining picture catalogs, then audio parity across titles, then NHL 94 PC. **Later** it grows into teams, schedules, and ROM build — those are not in the product yet.

### 1.1 Who it is for

| Audience | What they need |
|----------|----------------|
| **Modders** of 92–95 Genesis, 93–94 SNES, and 95 PC | See retail frames, palettes, screens, and songs; export and re-import graphics they can drop into a disassembly or a PC folder |
| **Researchers / disassembly contributors** | The same pixels and names the game uses, labeled from `frames.asm` and image catalogs |
| **Curious fans** | A browser they can open on GitHub Pages, drop a ROM, and look around without installing Node |

It is **not** a general sprite editor, a Photoshop replacement, or an emulator.

### 1.2 Principles

1. **Retail truth over convenience.** Names, palettes, timing, and file layouts follow the games and the disassembly repos, not a third-party tool’s guess.
2. **One studio, many games.** A new title is a profile plus decoders, not a fork of the UI.
3. **User files stay local.** Studio Local reads folders on disk. Studio Web keeps dropped bytes in the browser.
4. **Export is a download.** The studio never patches a ROM. People copy files into their own tree.
5. **About tells you what changed.** If people will see a change, the version and changelog ship on the same merge.
6. **Credit the people who got us here.** Derivative work must name abdulahmad and the credits in the README.

### 1.3 How people run it

| Mode | Where | How files arrive |
|------|--------|------------------|
| **Studio Local** | `node server.js` (default port 8732) | `roms/`, `pc95/`, `pc94/`, optional ANIM drops |
| **Studio Web** | GitHub Pages or any static host | Drag-and-drop or Open file / Open folder; bytes stay in the tab |

Both modes show the same catalog, viewer, and editors. Pages never receives a ROM on a server.

---

## 2. Games in the product

Implementation order (do earlier rows before later ones unless a task is blocked):

| Priority | Shorthand | Title | Platform | In the studio today |
|----------|-----------|-------|----------|---------------------|
| 1 | **92G** | NHL 92 | Genesis | Frames, images, Sound test, Chip Lab (hidden link) |
| 2 | **93G** | NHLPA 93 | Genesis | Frames, images, Sound test |
| 3 | **94G** | NHL 94 | Genesis | Frames, images, Sound test |
| 4 | **95G** | NHL 95 | Genesis | Frames, images, Sound test |
| 5 | **93S** | NHLPA 93 | SNES | Frames, pictures, Sound test |
| 6 | **94S** | NHL 94 | SNES | Frames, pictures, Sound test |
| 7 | **95PC** | NHL 95 | DOS | Frames, images, jersey & ice editor; audio parser exists, ear-match still open |
| 8 | **94PC** | NHL 94 | DOS | Planned after 95PC is in good shape |

**Not in the game list:** NHL 96 Genesis, Sega CD, later EA NHL. Extract scripts or folders may exist; they are not a studio profile.

Each profile must expose, as the data exists:

- Player **frames** (sheet, ANIM bank, or PC PPV) with the retail palette rules for that platform
- Named **SPF** ranges and **SPA** sequences from that game’s `frames*.asm`
- An **Images** catalog of screens, rinks, fonts, logos, portraits, and extra sprite banks
- **Audio** the Sound test can list and play (songs, SFX, samples, instruments) once that title’s chain is wired

If a title is missing a bank or a picture that exists in the ROM, that is a catalog gap, not a new product. Track those in [`docs/TODO.md`](TODO.md) and IMPLEMENTATION.md.

---

## 3. Product surfaces

Every page shares the NHL9X Studio header (product name, game where it applies, About). Editors that leave the main viewer use a **← NHL9X Studio | page title** heading on one line in the top left (the arrow is the back link), not a “Close” button.

### 3.1 Sprite viewer (`index.html`)

The home of the product. One window, four modes, shared chrome.

**Must have**

- Switch game without a reload; remember the last game, mode, and frame in the URL hash
- **Frame:** scrub the active bank (player sheet, ANIM bank, or PC PPV series), 1-based indexes
- **SPF:** browse named frame ranges; eight-facing sets use the compass
- **SPA:** play animation sequences per facing with retail timing (vblank hold, 4-vblank glitch, loop bit)
- **Images:** stills and tilemaps that are not the player sheet, grouped and searchable
- Pin (origin vs hotspot), scale, step slider, filmstrip, jersey palette, Groups/File sort
- Transparency on Images: default **off** for JIM/SJIM pictures so ice and title screens look solid; the person can still punch VDP holes
- Open a ROM, a loose graphic, a PC file, or a PC install folder; drag-and-drop the same
- **Edit image** on a JIM / SJIM / 94S screen opens the Image Editor with that asset
- **Jerseys** opens the jersey & ice editor
- About on first visit after a version bump, and from the header any time

**Must not**

- Show Chip Lab in the header (the page stays at `chip-lab.html` for direct URLs and tests)
- Write into the ROM
- Require a server when running from Pages

### 3.2 Image Editor (`jim.html`)

A Photoshop-like editor for **tilemaps the games already store as maps of 8×8 tiles**: Genesis `.map.jim` (raw or packed), player portraits, NHLPA 93 SNES `.map.sjim`, and NHL 94 SNES screens (downloaded as a ZIP of chr/map/pal). Spec history: [`docs/nhl9x-studio-requirements.md`](nhl9x-studio-requirements.md).

**Must have — files**

- Open any of those formats; status says what kind of file it is
- Export through a **modal** that lists native, Genesis `.map.jim`, SNES `.map.sjim`, NHL 94 SNES `.zip` (with the files that will be in the archive listed next to `.zip`), map PNG, and tiles PNG. Adobe ACT is **not** on this list — **Export .ACT** on the left opens a dialog: one palette line, or all lines combined
- If the open picture **cannot** become the chosen format, **Export is disabled** and the reason sits next to Export/Cancel. Do not pop an error for that case, and do not download a broken file
- Picking SNES `.map.sjim` or NHL 94 SNES `.zip` from a Genesis map is an **explicit conversion** when tiles ≤ 1024 (3-bit→5-bit, pals padded to 8, map words 10-bit). 94S zip is tiles + map + pal as separate files (Huffman/RLE/LZ), not a JIM and not a 93S sjim stream. Silent conversion is still forbidden. SNES→Genesis `.map.jim` stays blocked (lossy: 8 pals / 5-bit)
- **Packed** is enabled only when the chosen format has both packed and unpacked (Genesis `.map.jim` and NHL 94 SNES zip). `.map.sjim` is always packed
- Download uses the opened file name; nothing is written into a ROM
- Pal 0 color 0 is opaque on pictures by default; Transparency is a preview of VDP holes

**Must have — tools**

- Tools, first row, in this order: **Pan, Select, Pick, Place tile, Paint, Erase**, then **Undo, Redo**, then **Grid / Trans / Seams** as labeled icons that highlight when on, with a vertical separator after Redo. **Select is the default** when the editor opens
- Tools, Undo/Redo, and map-view options sit in **separate toolbar groups** so they wrap as units
- Zoom 1–32× sits next to **270°** on the block bar, with a vertical separator. Large maps keep a 4096-pixel bitmap cap and CSS-scale the rest so the slider zoom is what you see
- Every tool, edit action, and tile action has an **icon with a short label underneath** (the editor is new; labels teach the icons)
- The map cursor matches the active tool (pencil, stamp, eraser, marquee, eyedropper, hand)
- The zoomed tile preview on the right **does not paint**. Clicks do nothing unless **Pick** is on, then they sample that pixel’s color
- Undo / redo
- Select a rectangle of cells; copy, cut, paste, clear, mirror, flip, 90/180/270
- **Paste** and **import into the current image** land as a **floating layer** with a dotted outline. Apply commits it; Cancel drops it. The person can drag it first.
- Erase cell (and clear) writes a **blank tile filled with palette color 0**, not “tile 0” if tile 0 is a real graphic
- New tile, delete tile, remove unused tiles, **remove duplicate tiles** (including tiles that only match after H-flip and/or V-flip; cells keep the flip bits)
- Resize the map; edit a cell’s tile index, palette, H-flip, V-flip, priority. The inspector keeps **tile index beside palette**, **H-flip beside V-flip**, the map **Word** on the Cell heading, and View directly under Priority. Resize and Kind stay compact (same height as the map W/H fields)
- Grid, zoom, seams, highlight cells that use this tile, highlight unused tiles
- **← NHL9X Studio | Image Editor** on one line in the top left returns to the viewer (or the page that opened the editor), with a leave confirm if dirty

**Must have — import**

Three import modes, named in the UI as:

| Mode | Label | What Apply does |
|------|--------|-----------------|
| `replace` | Import New Image & Overwrite Tiles (Resize Map) | Map becomes the picture’s size; tiles are replaced; duplicates (incl. H/V) are removed automatically |
| `place` | Import into current Image & Add Tiles | Floating layer on the current map; new unique tiles are added; duplicates (incl. H/V) are removed automatically |
| `add` | Import Tiles (keep existing image & tiles) | Appends unique tiles to the set. The map picture is not overlaid and does not change |

- PNG / BMP / GIF / JPEG, two-step quantization, Use/Lock palette lines
- Import palettes from Adobe `.act`, Genesis `.pal` (32 or 128-byte CRAM), SNES `.snespal` (team 32-byte or rink BGR555), JASC/RIFF `.pal`, or another JIM/SJIM. A dialog maps **each palette in the file** onto an editor pal (or Skip)
- Change color options while the float is pending; Apply is what commits
- Only-empty-cells skip map words that already have a tile

**Must not (v1)**

- Remap-nibble, printa XOR, and dobitmap mask preview (hidden; not a person-facing need)
- ANIM / SHPI sprite editing
- Writing the result into a ROM
- Silently converting a Genesis map into a SNES file or the reverse

### 3.3 Jersey & centre ice (`jed.html`)

Edit **NHL 94 PC and NHL 95 PC** team colours and centre-ice marks.

**Must have**

- Open a game folder or the palette bins (+ PPV sheets and rink pal for preview)
- Switch 94 PC / 95 PC when both are present
- Paint jersey zones, import/export crests, export HOMEPALS / AWAYPALS / edited ice
- Export all as a zip of everything touched
- The same **← NHL9X Studio | page title** one-line heading as the Image Editor

### 3.4 Sound test and sequencers

**Must have**

- Per-game Sound test: songs, SFX, samples, instruments, with the names the game uses
- Play/stop in the browser; no MID94-Tools dependency
- Sequencer editors for the five sound games ([`docs/SEQUENCER-EDITOR.md`](SEQUENCER-EDITOR.md))
- Chip Lab remains a direct-URL YM2612 / PSG sandbox; not linked from the header

**Not yet a requirement to ship:** a full FM patch editor, import back to ROM, tracker editing, MT-32/GUS hardware parity, PC speech unpack that matches retail by ear.

### 3.5 About

On load, if `localStorage['nhl9x-about-seen']` is not the newest `changelog.json` version, show What’s new. Dismissing it stores that version. The header About button always reopens it.

---

## 4. File types people open and export

Speak of these in the UI with the names below. Do not invent extra extensions (no `.jzip` as a game format).

| People say | Meaning |
|------------|---------|
| Genesis `.map.jim` | Uncompressed tiles, or packed when bit 15 of the tile-count word is set (`DecompressBytecode`, 93G/94G) |
| Portrait | `UnpackPicture` 3-byte rows (player faces) |
| `.map.sjim` | NHLPA 93 SNES packed screen (map + palettes + tiles in one stream) |
| NHL 94 SNES screen ZIP | Tiles + map + palettes as LZ / Huffman / RLE, one download |
| `.act` | Photoshop palette; optional 772-byte trailer |
| Genesis `.pal` | ANIM-To-BMP CRAM, 32 bytes (one line) or 128 bytes (four lines) |
| SNES `.snespal` | Team line (32 bytes) or rink CGRAM (256 bytes, eight BGR555 lines) |
| PC `HOMEPALS.BIN` / `AWAYPALS.BIN` | Team jersey palettes |
| ROM / `.sfc` / PC folder | Opens the matching game profile in the viewer |

If an export would be illegal for that picture (SNES→Genesis is lossy; SNES indexes above 1024 tiles), **tell the person and stop**. Do not write a file they cannot use. Explicit format picks that fit (Genesis→sjim or Genesis→94S zip at ≤1024 tiles) are conversions, not errors.

---

## 5. Quality bar

- `node test.js` stays green on the PR. Playwright browser tests cover the Image Editor, jerseys, and the viewer load path when Playwright is installed.
- A packed `.map.jim` must decompress back to the same tiles or the export is refused.
- Priority, H-flip, V-flip, and palette bits survive a round trip.
- Title screens and ice do not show “holes” unless Transparency is on.
- Agents do not merge user-visible work without a version bump and changelog line.

---

## 6. Out of scope (not in the product yet)

These remain future studio goals, not current requirements:

- Project files, IPS/BPS, writing extracted assets back into a ROM
- ANIM / SHPI sprite editing
- Team rosters, songs-per-team editors, schedules, `NumTeams` mods
- SRAM/ROM size validation and stock-ROM MATCH as a studio feature
- Persistent OPFS workspace; mounting a 95 PC ISO in the browser
- NHL 96, Sega CD, and later NHL titles as profiles

---

## 7. Roadmap (product order)

1. Keep the multi-game graphics shell correct (catalog gaps in priority order 92G → … → 95PC, then 94PC).
2. Image Editor: the requirements in §3.2; hide Chip Lab in chrome.
3. Studio Web completeness (folder drop, Pages). ISO mount is later.
4. Audio playback across the same game order.
5. Teams / rosters / build — after graphics and audio are trustworthy.

Suggested overall order after today’s shell: graphics gaps → maps editor (in progress / shipping) → hosting leftovers → audio → data editors.

---

## 8. Related documents

| Doc | Role |
|-----|------|
| [`docs/IMPLEMENTATION.md`](IMPLEMENTATION.md) | Architecture, decode paths, GAP/AUD/HOST IDs, 94PC and audio engine plans |
| [`docs/nhl9x-studio-requirements.md`](nhl9x-studio-requirements.md) | Image Editor format truth and original maps milestones |
| [`docs/AGENT-HANDOFF.md`](AGENT-HANDOFF.md) | What is on `main`, where to work, test notes |
| [`docs/TODO.md`](TODO.md) | Open catalog and audio gaps |
| [`docs/SEQUENCER-EDITOR.md`](SEQUENCER-EDITOR.md) | Sequencer editors |
| [`docs/sync.md`](sync.md) | Aligning catalogs with disassembly / EA-NHL-Tools |
| [`AGENTS.md`](../AGENTS.md) | Credit rule; version bump before merge |

---

## 9. Document history

| Date | Change |
|------|--------|
| 2026-10-29 | Image Editor zoom 1–32× (large maps CSS-scale past the 4096-pixel bitmap cap). |
| 2026-10-29 | Genesis / sjim → NHL 94 SNES zip is an explicit conversion when tiles ≤ 1024 (chr+map+pal, not a different picture). |
| 2026-10-29 | Image Editor: Pan→Erase then Undo/Redo then Grid/Trans/Seams icons; zoom next to 270°; compact Resize/Kind; export greys out with a reason (Genesis→sjim is an explicit conversion); zip file list; packed only when both packings exist; ACT is a left-pane dialog; **← NHL9X Studio \| page title** on one line. |
| 2026-10-29 | Rewrote as a product-requirements document. Technical sections moved to IMPLEMENTATION.md. Image Editor: labeled tool icons, tool cursors, back arrow, export modal, floating paste/import, H/V-aware dedupe, erase-to-blank-tile. |
| 2026-10 | Earlier versions mixed product vision with implementation (see git history of this file and IMPLEMENTATION.md). |
