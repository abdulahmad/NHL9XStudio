# NHL9X Studio — implementation notes

This is the technical companion to the product requirements in [`docs/DESIGN.md`](DESIGN.md). Architecture, decode paths, GAP IDs, 94PC workstreams, audio engine notes, and hosting internals live here. Product language (what ships, who it is for, requirements) stays in DESIGN.md.

**Application name:** **NHL9X Studio**. **Canonical repository:** [github.com/abdulahmad/NHL9XStudio](https://github.com/abdulahmad/NHL9XStudio) (`main`). Upstream mirror: `EA-NHL-Tools/Sprite-Viewer/` (see `docs/MIGRATION.md`).

**Vision:** One editor for EA NHL hockey titles — graphics today, audio and team data tomorrow — with a **game profile** per title so new platforms are mostly data and decoders, not a forked UI.

This document has three parts:

1. **What NHL9X Studio does today** (accurate as of the multi-game shell on `main`).
2. **Implementation plan: NHL 94 PC graphics** (`94PC`) — planar PPV/QPP decode is in; remaining work is SPA extract and hotspot polish.
3. **Implementation plan: audio** for all eight retail profiles below.

Genesis `.map.jim` editor (next graphics product) is specified in [`docs/nhl9x-studio-requirements.md`](nhl9x-studio-requirements.md), not here.

**Version / About:** before merging user-visible work to `main`, bump `package.json` and prepend `public/changelog.json`. That is the About window. Agents must not skip it (see AGENTS.md).

Long-term product buckets (teams, schedules, ROM build, patches) remain as in the original outline at the end; they are not implemented in NHL9X Studio yet.

### Implementation priority (canonical)

Unless a task is **blocked** by a dependency (e.g. shared `lib/pc*.js` for DOS), schedule **graphics gaps**, **audio**, and **new game profiles** in this order:

| # | Shorthand | Game profile id | Role |
|---|-----------|-----------------|------|
| 1 | **92G** | `nhl92` | Genesis baseline; multi-bank Frame tab already exposed — use as pattern for later Genesis titles |
| 2 | **93G** | `nhlpa93` | Genesis sheet + image catalog hardening |
| 3 | **94G** | `nhl94` | Genesis sheet + auxiliary banks / celebrate discoverability (§1.8) |
| 4 | **95G** | `nhl95` | Genesis sheet + image catalog (e.g. arena gfx) |
| 5 | **93S** | `nhlpa93snes` | SNES sprites + pictures |
| 6 | **94S** | `nhl94snes` | SNES parity vs Genesis catalogs |
| 7 | **95PC** | `nhl95pc` | DOS graphics/audio already partially wired — close catalog and palette edge cases **before** 94PC |
| 8 | **94PC** | `nhl94pc` | Planar PPV/QPP + AdLib/SFX; SPA still interim (`frames94pc.asm`) |

---

## 1. Current capabilities

### 1.1 Runtime architecture

| Layer | Role |
|--------|------|
| `server.js` | Node HTTP server (default port **8732**). Serves `public/`, `lib/*.js`, `data/*.asm`, ROMs from `roms/`, PC assets from `pc95/`, palettes from sibling tool folders. |
| `public/viewer.js` | Single-page UI: catalog, stage, transport, filmstrip, compass, jersey palette, URL hash state. |
| `lib/games.js` | **Game profiles**: frames file, platform, banks, image catalog, ROM hints, sheet/SNES/PC options. |
| `lib/*` | Decoders: `parse-frames.js`, `anim.js`, `sheet.js`, `jim.js`, `sjim.js`, `snes.js`, `snespak.js`, `pc95.js`, `playback.js`, `labels.js`, `genesis-images.js` (generated lists). |
| `data/` | `frames*.asm` catalogs (SPF/SPA), including `frames95pc.asm` for 95 DOS. |
| `test.js` | Parser tests, PC95 tests, NHL 92 frame BMP cross-check when ROM present. |

There is **no database** and **no audio pipeline** in the viewer yet. All state is in-memory plus `#hash` in the browser.

### 1.2 Supported games (graphics)

| ID | Shorthand | Title | Platform | `kind` | ROM / assets |
|----|-----------|--------|----------|--------|----------------|
| `nhl92` | **92G** | NHL 92 | Genesis | `anim` | Optional `roms/nhl92.bin`; banks from `ANIM-To-BMP` or ROM slices |
| `nhlpa93` | **93G** | NHLPA 93 | Genesis | `sheet` | `roms/nhlpa93.bin`; Rev A date shifts offsets |
| `nhl94` | **94G** | NHL 94 | Genesis | `sheet` | `roms/nhl94.bin` |
| `nhl95` | **95G** | NHL 95 | Genesis | `sheet` | `roms/nhl95.bin` |
| `nhlpa93snes` | **93S** | NHLPA 93 | SNES | `snes93` | `roms/nhlpa93snes.sfc` |
| `nhl94snes` | **94S** | NHL 94 | SNES | `snes94` | `roms/nhl94snes.sfc` |
| `nhl95pc` | **95PC** | NHL 95 | DOS | `pc95` | `Sprite-Viewer/pc95/` (PPV, QFS, palette BINs); not in git |
| `nhl94pc` | **94PC** | NHL 94 | DOS | `pc94` | `pc94/` (PPV, QPP, palette BINs, KMS/CFG, PCFF); not in git |

*(Table follows **implementation priority** § above; not chronological release order.)*

**Not in viewer:** NHL 96 Genesis (extract script only), Sega CD branches.

### 1.3 UI modes (all games except PC use the same four tabs)

| Mode | Purpose |
|------|---------|
| **Frame** | Scrub 1-based frame index in the active **bank** (player sheet, ANIM bank, or PC PPV series). |
| **SPF** | Browse named frame **ranges** from `frames*.asm`; eight-across facings use the compass. |
| **SPA** | Play **animation sequences** per facing; respects `updateanim` timing (vblank hold, 4-vblank glitch, loop bit). |
| **Images** | Non–player-sheet pictures: screens, rink, fonts, logos, portraits, PC QFS/QPP stills, SNES tilemaps, etc. |

**Shared chrome:** game/bank selectors, pin (origin vs hotspot), scale, step slider + filmstrip (full sequence, lazy thumbnails on long lists), jersey palette (Genesis row 2, 94 SNES row 4, PC team ACT), transparency override on Images, Groups/File sort, keyboard transport.

**Playback model (`lib/playback.js`):** step = `{ frame, ticks, last? }`; SPA ticks map to vblanks; optional min-gap models retail `glitch`.

### 1.4 Graphics decode paths (by `kind`)

| `kind` | Frames source | Pixels |
|--------|----------------|--------|
| `anim` | `lib/anim.js` on `.ANIM` / ROM slice | Genesis 4bpp column tiles, 4 palettes |
| `sheet` | `lib/sheet.js` on ROM sprite sheet | Same tile model + hotlist from ROM |
| `snes93` / `snes94` | `lib/snes.js`, `snespak.js` | Planar 4bpp, mode-specific maps/screens/cards |
| `jim` | `lib/jim.js` | Genesis compressed maps (images tab) |
| `sjim` | `lib/sjim.js` | NHLPA 93 SNES packed screens (map + pal + planar tiles) |
| `snes94-screen` | `lib/sscr.js`, `snespak.js` | NHL 94 SNES tiles + map + pal (LZ / Huffman / RLE) |
| `pc95` | `lib/pc95.js` | RefPack QFS → SHPI → SPIT; PPV SHPI banks; team/rink palettes |

**Catalog data:** SPF/SPA from `data/frames*.asm` via `lib/parse-frames.js` (including ascending SPF range fix). Genesis image lists from `lib/genesis-images.js` (generated from disassembly extracts). SNES 94 frames partly generated (`tools/build-snes-frames.js`).

### 1.5 HTTP API (graphics)

| Endpoint | Use |
|----------|-----|
| `GET /api/games` | List games + banks, images, `pixels`/`rom` flags, hints. |
| `GET /api/games/:id/frames` | Raw `frames*.asm`. |
| `GET /api/games/:id/palettes` | Palette file names. |
| `GET /api/games/:id/palettes/:file` | Palette bytes. |
| `GET /api/games/:id/rom` | ROM (or bundled PC sprite bank). |
| `GET /api/games/:id/sprites?bank=` | PC95 only: merged PPV bundle. |
| `GET /api/games/:id/file?path=` | PC95 loose QFS/PPV file. |
| `GET /api/palettes` | NHL 92 palette list (legacy). |

Static: `/viewer.js`, `/lib/*.js`, `/data/*`.

### 1.6 Tests and dependencies

- `node test.js` — parsers, PC95 codec, catalog smoke tests.
- **Sibling repos / folders** (not npm packages): `ANIM-To-BMP`, `ANIM94-To-BMP`, `ANIM95-To-BMP`, Genesis/SNES disassemblies for ROM paths in dev.
- PC asset trees are **large**; `pc95/` and `pc94/` are typically gitignored or committed as a separate asset drop (`pc94/` committed on EA-NHL-Tools `main`).

### 1.7 Known graphics gaps

- **93S/94S:** Remaining unpinned screens (no single incbin for the full 93S scouting UI; player-card-only tiles without a dedicated map label in the SNES tree) are documented in `docs/TODO.md` (GAP-5/6).
- **94PC:** Profile `nhl94pc` decodes planar PPV/QPP (`lib/pc94-shape.js`, `lib/pc94-pack.js`). Remaining: retail `HOCKEY.EXE` SPA extract, hotspot/`frameIsDynamic` polish, VIV speech.
- **96G:** Out of scope for viewer game list.
- **Editing / export / build:** View-only today; no write path to ROM or extracted bins. Planned: Genesis `.map.jim` editor (`docs/nhl9x-studio-requirements.md`).

### 1.8 Goal celebrations, “bench” sprites, and missing banks (94G focus)

#### What the retail **NHL 94 Genesis** game actually does

| Moment | Assignment (`assign94.asm`) | SPA used | SPF frames (`frames94.asm`) |
|--------|---------------------------|----------|-----------------------------|
| Goal scored (on ice) | `assscore` | `SPAcelebrate`; scorer gets `SPApump` | `SPFcelebrate` **185–200**, `SPFpump` **201–216** |
| Skate to bench / line change | `assbench` | `SPAglide` / `SPAgready`, then `SPAwallleft` or `SPAwallright` at the door | Normal skate + **penalty-box door** (`SPFPen`), not a “sitting on bench” pose |
| Checked near center boards | (collision) | `SPAbenchcheckl` / `SPAbenchcheckr` | Reuses fall/board frames — **not** bench celebration |

There is **no** `SPFbench`, `SPFbetween`, or bench-cheer sequence on **94G** or **95G** like there is on **NHL 95 PC** (`SPFbench`, `SPFbetween`, `SPAcelebrate` on the DOS sheet in `frames95pc.asm`). If you remember players **celebrating while seated on the bench**, that behavior is from the **PC** titles (or a different platform), not the Genesis ROM.

**Crowd** reactions are a separate asset: `Crowd.anim` (ROM slice in `genesis-images.js`), not player SPF/SPA from `frames94.asm`.

#### What NHL9X Studio supports today for **94G**

| Asset | Where in the UI | Notes |
|-------|-----------------|-------|
| On-ice celebrate / pump | **SPA** tab → group **Celebrate** → `SPAcelebrate`, `SPApump` | Needs `nhl94.bin` loaded; frames **185–216** on the main player sheet |
| Stanley / cup poses | **SPA** → Celebrate → `SPAstanley`, etc. | Same sheet |
| “Bench” in the name | **SPA** → usually **Falls** or **Other** → `SPAbenchcheckl` / `SPAbenchcheckr` | Board check at center ice — easy to confuse with bench celebration |
| Penalty box door | **SPA** → `SPAwallleft` / `SPAwallright` | Uses `SPFPen` frames |
| `Crowd.anim`, `FaceOff.anim`, `Zam.anim` | **Images** tab → group **Sprites** | Decoded as multi-frame `kind: 'frames'`; **not** on Frame / SPF / SPA tabs |
| `StanleyCup.anim` | **Images** → **Sprites** | Easy to miss; not in `frames94.asm` |
| Extra ANIM bank on Frame tab | **Not exposed** | **92G** lists `Crowd.anim`, `Puck.anim`, `Zam.anim` as separate **banks**; **94G** only has `{ id: 'sprites', label: 'Sprites' }` |

So: **on-ice goal celebrations are supported** via SPA/SPF on the main sheet. **Bench-sit celebration is not in the Genesis data** and therefore cannot be browsed as a named animation on 94G. Auxiliary sprite banks are only partially surfaced (Images only).

#### Implementation plan — graphics coverage (priority order)

Work **92G → … → 94PC** (see **Implementation priority** above). PC DOS titles: finish **95PC** catalog/codec gaps before starting **94PC** (§2).

| Phase | Priority | Scope | Work |
|-------|----------|--------|------|
| **GAP-1** | **92G** | Reference quality | Treat as gold standard: bank list, Images catalog, palette/transparency rules; document anything still missing from `ANIM-To-BMP` / ROM slices. |
| **GAP-2** | **93G** | Banks + images | Frame tab lists `GameSetup.anim` / title frame banks; `genesis-images` offsets match `extractAssets93.js` with a 4-byte trim per end (`test.js`); optional `nhlpa93.bin` decode tests. |
| **GAP-3** | **94G** | Banks + discoverability | Multi-bank Frame tab like 92G (`Crowd.anim`, `FaceOff.anim`, `Zam.anim`, `StanleyCup.anim`); SPA blurbs (`SPAbenchcheck*` vs PC `SPFbench`); search aliases for celebrate vs bench. |
| **GAP-4** | **95G** | Banks + images | Crowd + FaceOff on Frame tab (retail `0x18B628`, `0x14A490`; not `segmap95` `0xA4B54`); no Genesis Zam; `openFrames` `record: '95'`. Remaining: arena gfx / full `genesis-images` audit vs `extractAssets95.js`. |
| **GAP-5** | **93S** | SNES catalog | Pictures catalog (15 images); crowd/zamboni/faceoff on main sprite sheet (`SPFcrowd` 659, etc.). Still open: dedicated crowd picture banks if ROM offsets are pinned. |
| **GAP-6** | **94S** | SNES parity | `SPAcelebrate` / `SPApump` named in `frames94snes.asm`; Images tab still missing several Genesis-parity screens (refs, scouting, framer, faceoff map) pending LoROM offsets. |
| **GAP-7** | **95PC** | DOS polish | Remaining QFS/PPV catalog holes, goalie palette edge cases, hotspot/dynamic rules — viewer already has core `pc95` path. |
| **GAP-8** | **94PC** | Planar PPV/QPP + AdLib/SFX | Remaining: retail SPA extract, hotspot polish. Bench/crowd `F000+` SPFs live here, not on Genesis. |

**Tests:** extend `test.js` with bank count smoke test per game profile; optional frame-count check for `Crowd.anim` slice when ROM present.

---

## 2. Implementation plan: NHL 94 PC graphics (`94PC`)

**Priority:** **8** of 8 — implement after **95PC** (7) is in good shape. Section kept here for technical detail, not queue position.

### 2.1 Goal

Parity with **95PC** in the viewer: Frame / SPF / SPA / Images, team jerseys, hotspots, dynamic vs game palette — using files in `Sprite-Viewer/pc94/` (PPV, QPP, `HOMEPALS.BIN`, `AWAYPALS.BIN`, `HOCKEY.EXE` for SPA table).

### 2.2 What differs from 95PC

| Topic | NHL 95 PC (`pc95.js`) | NHL 94 PC (`pc94-pack.js` / `pc94-shape.js`) |
|--------|------------------------|----------------------|
| Picture container | `.QFS` (RefPack `10 FB` → SHPI) | `.QPP` (Huffman **`30 FB`** or BTree **`46 FB`**, then the same planar bank as PPV — not RefPack, not SHPI) |
| Sprite banks | `.PPV` = SHPI in file | `.PPV` = Mode X planar PackBits bank (u32 size, u16 count, 4-char names, flags `0x0010`). Not gfxpak SPIT. |
| Frame count | 1134 (per `frames95pc.asm`) | **876** player sprites `000–875`, crowd `F000–F149` |
| SPA/SPF | `HOCKEY.EXE` @ `0x110471`, names @ `0x109030` | Interim SPA from a 95 PC subset (`frames94pc.asm`); retail `HOCKEY.EXE` extract still open |
| Palette files | Same HOMEPALS/AWAYPALS layout | Present in `pc94/`; same family as 95. 94 QPP donors differ (`PAL_DONOR_94`, e.g. PLAYOFFS → EMBPAL). |
| Audio | Parser-only wiki KMS | EXE-format `.KMS`/`.CFG` + PCFF TIM/DIG/PAT in the Audio tab (`lib/audio/pc94-*.js`) |

**In tree:** decode + catalog + Audio tab. Remaining: SPA extract, hotspot/`frameIsDynamic` polish, VIV speech, ear-match.

### 2.3 Technical workstreams

#### A. Decode layer (`lib/pc.js` or `pc94.js` + shared core)

1. **Generalize** `lib/pc95.js` → shared module:
   - SPIT decode, team palette (`buildTeamPalette`), hotspot table, `frameIsDynamic`, catalog grouping, image meta labels.
2. **94 PPV unpack** (blocker):
   - Port **gfxpak** unpack logic to JS **or** document 94’s pre-SHPI layout from `HOCKEY.EXE` / `pc94/HOCKEY.dcproject`.
   - Output: same shape as today’s `openBytes()` → `{ shapes, palette }`.
3. **94 QPP unpack**:
   - Extend RefPack detector for `30 FB` (and verify decompress matches retail `ARENA.QPP`, etc.).
4. **Tests:** golden files from a few `pc94` PPV/QPP slices; round-trip count of shapes vs gfxpak extract.

#### B. Game profile and data

1. Add `nhl94pc` to `lib/games.js`: `kind: 'pc94'`, `frames: 'frames94pc.asm'`, `PC_DIR` or shared `pc94/`.
2. Author **`data/frames94pc.asm`** from `pc94/HOCKEY.EXE` (SPF ranges, SPA table, C string names) — mirror `frames95pc.asm` process.
3. **94-specific** `frameIsDynamic` / hotspot table (876 frames, not 1134).
4. `server.js`: `PC94_DIR`, catalog cache, same routes as 95 with id `nhl94pc`.

#### C. Viewer UI

- Reuse PC path in `viewer.js` (`gameInfo.kind === 'pc94'` alongside `pc95`).
- README: `pc94/` layout, restart server, frame index 1-based.

#### D. Optional alignment

- Rename extracted bins in NHL94Genesis-style `extractAssets94.js` if 94 PC extractor is added to EA-NHL-Tools (not required for viewer-only).

### 2.4 Phasing and verification

| Phase | Deliverable | Verify |
|-------|-------------|--------|
| **PC94-1** | Inventory script: list PPV/QPP, ROM offsets from EXE | Done (retail trees) |
| **PC94-2** | PPV + QPP decode in JS + unit tests | Done (`test/pc94-shape.js`) |
| **PC94-3** | `frames94pc.asm` + `nhl94pc` profile + server | Done; SPA still interim |
| **PC94-4** | Jersey/hotspot/dynamic rules tuned vs DOS | Partial (hotX/hotY from the bank; GetHot polish open) |

---

## 3. Implementation plan: audio (all eight titles)

### 3.1 Scope

**In scope for “playback” in the viewer:**

| Asset class | Description |
|-------------|-------------|
| **SFX** | Short sounds triggered by game logic (skate scrape, whistle, crowd, UI beeps). |
| **Digital samples / waveforms** | PCM in Genesis `Hockey.snd`, SNES BRR-ish samples, PC digitized SFX. |
| **FM cmdstreams** | Genesis “song” streams (`$30–$7A`) and global title/EOG/scout (`$78–$7A`); event-driven FM driver in `sound94.asm` lineage. |
| **Patches / instruments** | YM2612 voices (Genesis Z80 driver), OPL/AdLib timbres (PC), SNES sample maps. |
| **Music (PC)** | `.KMS` + `.CFG` (MIDI-like), arena themes, title/summary/fan/adlib tracks. |
| **Speech** | PC `.VIV` announcer packs (`XBRUCE`, `XRBARR`, etc.); any Genesis/SNES speech if present in ROM. |

**Out of scope for v1 audio (later):**

- Full **FM patch editor**, SPC disassembly upload, **import** back to ROM, tracker edit, MT-32/GUS path parity with hardware.

**UI target:** New top-level mode **Audio** (or tab beside Images) per game: searchable catalog, waveform or piano-roll preview where applicable, **Play/Stop**, link to **trigger** (SFX id, SPA frame, menu name) when known from disassembly.

### 3.2 Asset matrix by game

| Shorthand | Digital / WAV | FM cmdstreams | SFX index | PC MIDI | Speech |
|-----------|----------------|---------------|-----------|---------|--------|
| **92G** | `Hockey.snd` @ ~`0x149D0` (`Docs/SND`) | Small set (93G naming docs ~8 global tunes); 92 FMTunes tools in sibling repos | Driver `sound*.asm` lineage | — | — |
| **93G** | ROM `Hockey.snd` region | `fmtune_*_cmdstream` (goal, period, title, EOG, scout, …) | Same driver family | — | — |
| **94G** | ROM | **75 songs** `$30–$7A`; `TeamSongs` / `RandomSongs` in `title94.asm` | `SFX_*` equates in 94G disasm | — | — |
| **95G** | ROM (later offset) | Extends 94-style tables | 95G `sound95` | — | — |
| **93S** | ROM samples (BRR / driver) | SPC or custom seq (TBD from NHLPA93SNES) | Event ids from disasm | — | — |
| **94S** | ROM | Same investigation as 93S | TBD | — | — |
| **94PC** | In EXE/overlays + samples in tree | N/A (DOS uses MIDI) | DOS SFX table in `HOCKEY.EXE` | **`*.KMS`/`*.CFG`** per team and screen | **`.VIV`** announcer |
| **95PC** | Same family as 94PC | N/A | EXE tables | Large KMS set (see `Check-Gamefiles/!CRC94`) | VIV packs |

**Repository tools to reuse (EA-NHL-Tools):**

| Tool / doc | Use |
|------------|-----|
| `MID94-Tools/` | **Experimental / unfinished** — cmdstream ↔ MIDI attempt; **not reliable** for production or viewer integration today (see repo README). Useful notes only until a JS player or fixed extractor exists. |
| `Docs/SND/Readme.md` | `Hockey.snd` magic / ROM offsets 92–95 |
| NHL94Genesis `sound94.asm`, `extractAssets94.js` | Song stream slices, `SoundStreamTable` |
| NHLPA93Genesis `extractAssets93` | Named `fmtune_*` pattern for 93 |
| `PPV-To-BMP` / gfxpak | Not audio; listed to avoid conflating with PPV **graphics** |
| PC `*.KMS` | AdLib-scored music; needs player (see below) |

### 3.3 Playback architecture (proposed)

```
┌─────────────────────────────────────────────────────────────┐
│  public/audio.js + Audio tab UI                              │
│  catalog list · transport · waveform canvas · MIDI roll      │
└───────────────────────────┬─────────────────────────────────┘
                            │ fetch /api/games/:id/audio/...
┌───────────────────────────▼─────────────────────────────────┐
│  server.js — audio routes, ROM slice, pc94/pc95 file read    │
└───────────────────────────┬─────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
  lib/audio/genesis.js  lib/audio/snes.js  lib/audio/pc.js
        │                   │                   │
        ▼                   ▼                   ▼
  Web Audio API     WASM / worklet        WASM or server
  (YM2612 emu)      (BRR decode)          (OPL/MIDI emu)
```

**Principle:** Decode and metadata in **Node** (`lib/audio/*`); **synthesis** in the **browser** where possible (Web Audio + WASM emulators), so the existing static-server model stays.

| Engine | Candidate | Assets |
|--------|-----------|--------|
| Genesis FM + DAC | **libym2612**-style WASM or `genesis-plus-gx` audio path | Cmdstreams + `Hockey.snd` PCM |
| Genesis cmdstream player | Port `ProcessOneMusicTrack` semantics to JS (event opcodes in `sound94.asm` comments) | `.bin` streams from extract |
| SNES | Decode BRR → PCM; optional **snes9x** SPC dump for music | ROM slices |
| PC AdLib | **OPL3** WASM or `libADLMIDI` / DosBox OPL capture | `.KMS` + `.CFG` |
| PC speech | Reverse `.VIV` or play pre-extracted WAV if tool exists | `pc94`/`pc95` trees |
| Waveform UI | `Canvas` + `AudioBuffer` from decoded PCM | All platforms |

**Catalog format (new):** `data/audio/<gameId>.json` generated by `tools/build-audio-catalog.js` from:

- Disassembly extract tables (Genesis songs, SFX ids).
- ROM scans (`Hockey.snd` segments).
- PC directory listings (KMS/VIV) with labels from filenames.

Each entry: `{ id, label, group, type, source, offset?, file?, duration?, triggers? }`.

### 3.4 Genesis cmdstream labeling (94G exemplar)

Before the viewer can show **“Boston — period start”** instead of **“song $30”**, NHL94Genesis should complete the **song labeling** pass (documented separately):

1. Inventory `TeamSongs` / `RandomSongs` → song id matrix.
2. Unique stream SHA → `fmtune_<team>_<slot>_cmdstream` + `Sng*` equates (`$30–$7A`).
3. Viewer catalog imports **`docs/music94_inventory.json`** (or generated from asm).

Viewer audio mode should display **both** runtime id (`$5A`) and **stable label** (`SngSharedOrganA` / `fmtune_bos_p0`).

### 3.5 UI sketch (Audio tab)

- **Sidebar groups:** SFX, Music (FM / MIDI), Samples, Speech, Patches (advanced).
- **Inspector:** Hex id, ROM offset or path, trigger xref (“`checks94` goal”, “`ChooseSong` index 2”), loop/footer for cmdstreams.
- **Main:** Play/stop, volume, optional **scope** (waveform) for PCM; **piano roll** or event list for cmdstreams/MIDI.
- **Cross-link:** From SPA frame detail, “SFX played here” → jump to Audio entry (future).

### 3.6 Phased delivery

Follow **implementation priority**: **92G → 93G → 94G → 95G → 93S → 94S → 95PC → 94PC**. Phases below are **workstreams**; within Genesis, complete each title’s music/SFX pass before moving down the list.

| Phase | Games (in order) | Deliverable |
|-------|------------------|-------------|
| **AUD-0** | — | `lib/audio/README.md`, catalog schema, `/api/games/:id/audio` listing endpoint |
| **AUD-1** | **92G → 95G** (one title at a time) | Per-title Genesis audio: `Hockey.snd` sample browser + cmdstream/SFX where documented (`sound*.asm`, `Docs/SND`). **94G** is the richest cmdstream set (`$30–$7A`) but lands **third** in the queue after 92G and 93G. Player is **new** `lib/audio/genesis.js` (not `MID94-Tools`). |
| **AUD-2** | **93S → 94S** | SNES sample decode + music once format confirmed |
| **AUD-3** | **94PC** | AdLib `.KMS`/`.CFG` + PCFF SFX via MIT OPL3 (`NhlSoundTestPc94`). 95 PC still uses the wiki KMS parser only |
| **AUD-4** | **95PC → 94PC** | VIV/speech extract + play |
| **AUD-5** | All eight | Patch viewer (FM/OPL regs), trigger xref from SPA/SPF, export WAV |

Dependencies: **94PC** audio and graphics share planned `lib/pc*.js`; building **95PC** audio/catalog first validates that module before **94PC** QPP/PPV differences.

### 3.7 Risks

| Risk | Mitigation |
|------|------------|
| FM cmdstream **timing** (per-channel factors) | Do not depend on MID94-Tools output; validate against retail in-emulator audio; use disasm + labeled song inventory |
| **WASM** build/size | Lazy-load emulators per platform |
| **VIV** unknown format | Ship KMS/SFX first; speech as extracted WAV fallback |
| **SNES music** not isolated | Start with **SFX/samples**; music after SPC/BRR map |
| Legal/distribution | Viewer plays user-supplied ROMs/files only; no assets in repo |

---

## 4. Product roadmap

These remain **future** NHL9X Studio goals, not current app features:

1. **Project & ROM handling** — open disassembly, detect version, write extracted assets, optional IPS/BPS.
2. **Graphics editing** — **next:** Genesis `.map.jim` import/edit/export ([`docs/nhl9x-studio-requirements.md`](nhl9x-studio-requirements.md)). Later: ANIM/SHPI. **Chip Lab** header link is to be hidden (page kept).
3. **Teams & data** — rosters, songs per team, schedules, `NumTeams` mods.
4. **Validation** — SRAM/ROM size, stock ROM MATCH, mod packs.

Suggested **overall** order after today’s NHL9X Studio shell:

1. ✅ Multi-game graphics shell (done).
2. **HOST-0 → HOST-2** (repo on NHL9XStudio, client `openBytes`, drag-and-drop) so **GitHub Pages** is viable.
3. **Graphics GAP-1–8** in **implementation priority** order: **92G, 93G, 94G, 95G, 93S, 94S, 95PC, 94PC** (GAP-1–3 largely done for 92G–94G banks).
4. **MAPS-0–5** — hide Chip Lab; JIM map editor ([`docs/nhl9x-studio-requirements.md`](nhl9x-studio-requirements.md)).
5. **HOST-3–5** (folder workspace in browser, Pages CI, ISO).
6. **Audio AUD-0–5** (same platform priority).
7. Team/roster editor, ANIM/SHPI edit/export, schedules/build.

### 4.1 Genesis `.map.jim` editor (next graphics product)

Full requirements, format truth vs JIM-Tools, architecture, and step × model table: **[`docs/nhl9x-studio-requirements.md`](nhl9x-studio-requirements.md)**.

Short version:

- Hide **Chip lab** in the header; keep `public/chip-lab.html`.
- New **Image Editor** (`jim.html`, header button): import PNG/BMP, lock palettes from `.act` / `.pal` / `.map.jim`, Import **Color mode** Genesis 3-bit (GEN) / 15–61 colors or SNES 5-bit (SNES) / 15–121 colors (or reverse), a lattice-only PNG path (Step A only) and a count-only PNG path (Step B, no lattice) with no palettes, Photoshop-like methods + dither, per-tile multi-palette seams (Pal moves tiles onto the selected palette and rebuilds that pal from all tiles on it, unused pals go black; Optimize seams groups matching tiles; Lock seams keeps that assignment when color options change; Lock on a pal does not rebuild a float), new palettes start at 0,0,0, Hex #RRGGBB snaps to 3-bit × 36,, place/rotate tiles, export raw or `DecompressBytecode`-packed `.map.jim` (Export with a float pending asks to Apply first; centre pane expands so Apply and import previews stay visible), encode portraits (`UnpackPicture` 3-byte rows), open/export NHLPA 93 SNES `.map.sjim` (8 BGR555 pals, 10-bit tile index), and open/export NHL 94 SNES screens (tiles + map + palettes as LZ/Huffman/RLE, downloaded as a ZIP). Edit map from the Images tab (including a JIM dropped on the viewer).
- Compression: implement from 93G `src/decompress93.asm` / 94G `src/decompress94.asm` / `lib/jim.js` `decompressBytecode`. Do **not** follow EA-NHL-Tools `JIM-Tools/Readme.md` “JZIP” opcodes.

---

## 5. Hosting, deployment, and how users supply files

NHL9X Studio should run in **two complementary setups**. Both use the same decoders; only **where bytes come from** changes.

### 5.1 Runtime modes

| Mode | Where it runs | How data arrives | Best for |
|------|----------------|------------------|----------|
| **Studio Local** | `node server.js` on your machine | Files on disk: `roms/`, `pc95/`, `pc94/`, optional `ANIM-To-BMP` drops | Daily modding, switching games, full catalogs |
| **Studio Web** | **GitHub Pages** (static) or any static host | **Drag-and-drop** or file/folder picker into the browser; bytes stay client-side | Shareable demo, quick look at one ROM or one asset, no install |

**GitHub Pages** is a target deployment for Studio Web: ship `public/`, bundled `lib/*.js`, and `data/*.asm` only. No ROMs or PC installs in git. Optional: separate “full local” docs for Node.

### 5.2 Drop-in vs workspace (same app, two habits)

**Workspace (local Node):** Lay out retail or extracted trees the way the server expects today. Use the **Game** menu to jump between profiles (`nhl94`, `nhl95pc`, …). ROMs and PC folders can coexist; the server resolves paths.

**Drop-in (local or Pages):** Open **one** input without configuring folders:

| Input | Examples | Expected handling |
|-------|-----------|-------------------|
| Genesis / SNES ROM | `nhl94.bin`, `.md`, `.gen`, `.sfc` | Detect size/CRC/header → game profile → full catalog (frames, images, banks) |
| Extracted graphic | `.anim`, `.jim`, crowd/faceoff `.anim` slice, `StanleyCup.anim` | Sniff header → `parseAnim` / `openFrames` / `decodeJim` → Frame or Images view |
| NHL 95 PC file | `.PPV`, `.QFS`, `HOMEPALS.BIN`, `HOCKEY.EXE` (for SPA table) | Route to `pc95.js`; multi-shape PPV/QFS as today |
| NHL 94 PC file | `.PPV`, `.QPP`, palette BINs, `.KMS` | `pc94-pack` / `pc94-shape` / `pc94-kms` via `pc95.js` `openBytes` |
| NHL 95 PC **ISO** | `.iso` / `.bin rip | **Future:** client-side ISO9660 (or pre-extracted folder); mount and read paths like local `pc95/` |
| Folder drop | Whole `pc95` or `pc94` install, or `NHL94/Graphics` extract | File System Access API or zip unpack → virtual catalog |

Principle: **never upload ROMs to the server** on Pages; on Local Node, still read user paths only (no cloud storage).

### 5.3 Technical workstreams (hosting)

| Phase | Deliverable |
|-------|-------------|
| **HOST-0** | ✅ App root in **NHL9XStudio**; EA-NHL-Tools `Sprite-Viewer/` synced |
| **HOST-1** | ✅ `lib/open-asset.js`, `lib/rom-detect.js`, `lib/rev-a.js`; PC via `openSpriteBundle` |
| **HOST-2** | ✅ Drag-and-drop overlay; client ROM + PC folder (`catalogFromPaths`); static `games.json` boot |
| **HOST-3** | Partial — folder drop for PC95; ROM session map; no persistent OPFS yet |
| **HOST-4** | ✅ `.github/workflows/pages.yml` (deploy on `main` after tests) |
| **HOST-5** | ISO shows guidance message; mount not implemented |

Local Node keeps `/api/games` for convenience; Studio Web implements the same `gameStatus` shape in a client module.

### 5.4 Repository split

| Repo | Keeps |
|------|--------|
| **NHL9XStudio** | App, `data/frames*.asm`, tests, design doc, Pages deploy |
| **EA-NHL-Tools** | `ANIM*-To-BMP`, `Asset-Extractor`, `Docs/`, `MID94-Tools`, mod tools; README link to NHL9X Studio |

---

## 6. References (in-repo)

| Path | Topic |
|------|--------|
| `docs/nhl9x-studio-requirements.md` | **Maps editor + Chip Lab hide** — requirements, JIM format truth, implementation steps |
| `docs/sync.md` | **Sync runbook** — disasm + EA-NHL-Tools → Studio catalogs |
| `Sprite-Viewer/README.md` | NHL9X Studio runbook (historical; see `docs/MIGRATION.md`) |
| `Docs/Sprites/Readme.md` | Frame numbering Genesis & DOS |
| `Docs/SND/Readme.md` | `Hockey.snd` offsets |
| `MID94-Tools/README.md` | 94G cmdstream experiment (unfinished) |
| `lib/pc95.js` | 95PC graphics codec |
| NHL94Genesis `src/sound94.asm`, `src/title94.asm` | Driver, `TeamSongs`, `SongPointerTable` |
| NHL94Genesis `docs/HANDOFF.md` | Naming rules for disassembly |

---

## 7. Document history

| Date | Change |
|------|--------|
| 2026-10 | Expanded from vision-only outline to **current state + 94PC + audio plans**. |
| 2026-10 | §1.8 94G celebrate/bench vs viewer gaps; **AUD-1** no longer assumes working `MID94-Tools`. |
| 2026-10 | Canonical **implementation priority**: 92G → 93G → 94G → 95G → 93S → 94S → 95PC → 94PC. |
| 2026-10 | Product rename to **NHL9X Studio**; Genesis auxiliary frame banks (92G–94G). |
| 2026-10 | §5 hosting: GitHub Pages, workspace vs drop-in, ISO/PC loose files; **NHL9XStudio** repo. |
| 2026-10-28 | §4.1 Genesis `.map.jim` editor + Chip Lab hide; see `docs/nhl9x-studio-requirements.md`. |
