# NHL9X Studio — agent handoff

**Last updated:** 2026-10-15 (PRs #1–#6 merged; feature branches deleted)  
**Repository:** [NHL9XStudio](https://github.com/abdulahmad/NHL9XStudio) (`main`) — app at repo root  
**Design / roadmap:** `docs/DESIGN.md`

---

## Where to work

Work only in **NHL9XStudio**. Push branches (`cursor/<name>-e6a9`), open PRs to `main`.

Do **not** commit `pc95` symlink or retail ROMs. Optional ROM paths for local tests are listed below.

Bundled regression fixtures live in `test/fixtures/` (ANIM/JIM/PAL). Full golden tests run without any external repo checkout.

---

## Implementation priority (graphics)

**92G → 93G → 94G → 95G → 93S → 94S → 95PC → 94PC**

Audio: `AUD-*` in DESIGN.md. Do not depend on MID94-Tools.

---

## On `main` (after PR #1)

- Full NHL9X Studio app, GitHub Pages workflow, static `public/games.json`
- Genesis auxiliary frame banks **92G–94G**; **93G** title/setup frame banks; **95G** Crowd/FaceOff + `openFrames` `record: '95'`
- GAP-2 extract slice checks; optional `nhlpa93.bin` tests
- SNES **94S** `SPAcelebrate` / `SPApump` named in `frames94snes.asm` (was SPAextra42/43)
- Self-contained `test/fixtures/` for CI
- SPA/SPF/image search aliases (celebrate vs bench-check); Pages deploy to `gh-pages` branch
- GAP-4 retail Crowd/FaceOff slice checks vs `genesis-images.js`; GAP-8 `nhl94pc` stub + QPP RefPack (`30 FB`) + `pc94/` server routes
- GitHub Pages: ROM drop overlay fix, `pixels` unlock after ingest, **Open file / Open folder** in header (PR #5+)

---

## Backlog

| ID | Scope | Notes |
|----|--------|------|
| **GAP-2** | 93G | JIM inventory polish optional |
| **GAP-3** | 94G | Done — SPA/SPF/image search aliases + celebrate vs bench-check blurbs |
| **GAP-4** | 95G | 27 `ArenaGfx*`; retail Crowd/FaceOff offsets locked in `test.js`; full extract audit vs `extractAssets95.js` dev ROM still optional |
| **GAP-5–6** | 93S / 94S | More Images-tab pictures (scouting, refs, framer on 94S) when LoROM offsets pinned |
| **GAP-7** | 95PC | DOS polish (goalie palette, catalog holes) |
| **GAP-8** | 94PC | Stub profile + QPP decode; legacy PPV gfxpak port + full `frames94pc.asm` from `HOCKEY.EXE` still open |
| **HOST-3** | OPFS | Not implemented |
| **HOST-5** | 95 ISO | Stub only |
| **AUD-*** | Audio | After graphics queue |

---

## Key paths

| Path | Purpose |
|------|---------|
| `lib/games.js` | Game profiles, banks |
| `lib/genesis-images.js` | Genesis ROM image slices |
| `lib/sheet.js` | Sheets + `openFrames` (94 vs 95) |
| `public/viewer.js` | UI |
| `test.js` | Regression tests |
| `tools/build-manifest.js` | Regenerate `public/games.json` |

### Optional ROMs (local)

```
/tmp/disasm/NHLPA93Genesis/lst/nhlpa93.bin
/tmp/disasm/NHL94Genesis/lst/nhl94.bin
/tmp/disasm/NHL95Genesis/lst/nhl95.bin
/tmp/snes/93/lst/nhlpa93snes.bin
/tmp/snes/94/lst/nhl94snes.sfc
```

### Commands

```bash
node test.js
node tools/build-manifest.js
node server.js    # http://localhost:8732
```

**Branch naming:** `cursor/<descriptive-name>-e6a9`

**Pages:** https://abdulahmad.github.io/NHL9XStudio/ — NHL 92 uses bundled `anim/*.anim`; other games need **Open file…** or ROM drop.

---

## Prompt for the next agent

```
Continue NHL9X Studio in NHL9XStudio (main). Read docs/AGENT-HANDOFF.md and docs/DESIGN.md.
Graphics priority: 92G → 93G → 94G → 95G → 93S → 94S → 95PC → 94PC.
After catalog changes: node test.js && node tools/build-manifest.js
Do not commit pc95, ROMs, or user game files.
```
