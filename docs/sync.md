# Syncing NHL9X Studio with upstream repos

This document is the **single runbook** for aligning [NHL9XStudio](https://github.com/abdulahmad/NHL9XStudio) with the latest **disassembly**, **EA-NHL-Tools**, and related research repos. Humans and agents should follow it when asked to **“sync per `docs/sync.md`”** (full or scoped — see §6).

**NHL9X Studio is the app of record.** Upstream repos are inputs; nothing in git here should be replaced by re-copying the old `EA-NHL-Tools/Sprite-Viewer/` tree (see `docs/MIGRATION.md`).

---

## 1. Upstream map

Clone or update these on your machine (paths below are **conventions** — set env vars if yours differ).

| Upstream | Typical local path | NHL9X Studio consumes |
|----------|-------------------|------------------------|
| **EA-NHL-Tools** | `$EA_NHL_TOOLS_ROOT` or sibling `../EA-NHL-Tools` | `ANIM-To-BMP`, `Asset-Extractor/extractAssets*.js`, `Docs/Sprites`, `Docs/SND`, `JIM-Tools`, `PAL-To-ACT`, golden BMP tests |
| **NHL92Genesis** | `/tmp/disasm/NHL92Genesis` or your disasm root | `src/frames.asm` → `data/frames.asm` |
| **NHLPA93Genesis** | `/tmp/disasm/NHLPA93Genesis` | `src/frames.asm` → `data/frames93.asm`; built `lst/nhlpa93.bin` for optional ROM tests |
| **NHL94Genesis** | `/tmp/disasm/NHL94Genesis` | `src/frames.asm` → `data/frames94.asm`; `src/sound94.asm`, `title94.asm`, `docs/HANDOFF.md` for audio/naming; `lst/nhl94.bin` |
| **NHL95Genesis** | `/tmp/disasm/NHL95Genesis` | `src/frames.asm` → `data/frames95.asm`; `lst/nhl95.bin` |
| **NHLPA93SNES** | `$SNES93` or `/tmp/snes/93` | `src/data/frames93s.asm`, `src/ram93snes.asm` → `tools/build-snes-frames.js`; team `*.snespal` → `data/pals/snes/` |
| **NHL94 SNES disasm** | `/tmp/snes/94` | Retail ROM `lst/nhl94snes.sfc` → `tools/build-snes-frames.js` (94 SPA names) |
| **NHL95PC** (optional) | install folder or `pc95/` locally | Not in git; used for manual QA and `test.js` live paths under `/tmp/nhl95all` |

**Environment variables** (agents: read these first):

| Variable | Purpose |
|----------|---------|
| `EA_NHL_TOOLS_ROOT` | Root of EA-NHL-Tools (overrides default `test/fixtures` / parent-dir guess in `test.js`) |
| `SNES93` | NHLPA93SNES clone root for `build-snes-frames.js` |
| `SNES94_ROM` | Path to NHL 94 SNES retail ROM for `build-snes-frames.js` |

Retail ROMs and PC installs **must not** be committed. Use `roms/`, `pc95/`, `pc94/` locally only.

---

## 2. What lives in NHL9X Studio (targets)

| Path | Source of truth | How it gets updated |
|------|-----------------|---------------------|
| `data/frames.asm` | NHL92Genesis | Copy from disasm `src/frames.asm` (or export); keep header comments |
| `data/frames93.asm` | NHLPA93Genesis | Same |
| `data/frames94.asm` | NHL94Genesis | Same |
| `data/frames95.asm` | NHL95Genesis | Same |
| `data/frames95pc.asm` | EA-NHL-Tools `Docs/Sprites/Readme.md` | Manual edit when DOS index changes |
| `data/frames94pc.asm` | 94 PC `HOCKEY.EXE` + Readme | `tools/extract-pc94-spa.js` / `tools/build-pc94-spa.js` when offsets known |
| `data/frames93snes.asm`, `data/frames94snes.asm` | SNES disasm + ROM | `node tools/build-snes-frames.js` |
| `data/frames94pc.asm` | 94 PC research | Interim subset from 95 PC until retail table extracted |
| `lib/genesis-images.js` | Retail ROM offsets from **Asset-Extractor** + disasm names | **Manual** sync: compare `extractAssets93.js` / `94` / `95.js` asset lists with `module.exports` slices; prefer **retail** offsets (see `test.js` `EXTRACT93_SLICES`, `EXTRACT95_RETAIL`) |
| `data/audio/*.json` | `lib/audio/genesis-constants.js` + optional ROM scan | `node tools/build-audio-catalog.js` and/or `--rom path --game id` |
| `data/pals/snes/*.snespal` | NHLPA93SNES (and 94 SNES where shared) | Copy palette files when disasm updates |
| `test/fixtures/ANIM-To-BMP/*` | EA-NHL-Tools | Copy small golden `.anim` + regenerate BMPs (CI does this in Pages workflow) |
| `public/games.json` | `lib/games.js` | **`node tools/build-manifest.js`** after any `lib/games.js` or catalog change |
| `lib/pc95.js`, codecs | EA-NHL-Tools + 95 PC RE | Port fixes deliberately; no blind overwrite |

After **any** catalog or `lib/games.js` change, run **`node tools/build-manifest.js`** and commit `public/games.json`.

---

## 3. Standard sync workflow (full)

### Step A — Update upstream checkouts

```bash
# Example; use your real paths
for repo in EA-NHL-Tools NHL92Genesis NHLPA93Genesis NHL94Genesis NHL95Genesis; do
  (cd "../$repo" && git pull)
done
(cd /tmp/snes/93 && git pull)
```

### Step B — Refresh vendored catalogs

**Genesis SPF/SPA (`data/frames*.asm`):**

```bash
STUDIO=/path/to/NHL9XStudio
cp "$DISASM/NHL92Genesis/src/frames.asm"     "$STUDIO/data/frames.asm"
cp "$DISASM/NHLPA93Genesis/src/frames.asm" "$STUDIO/data/frames93.asm"
cp "$DISASM/NHL94Genesis/src/frames.asm"     "$STUDIO/data/frames94.asm"
cp "$DISASM/NHL95Genesis/src/frames.asm"     "$STUDIO/data/frames95.asm"
```

Review diffs for new SPA/SPF names — update `lib/parse-frames.js` `SPF_INFO` / search aliases in `public/viewer.js` if user-facing groups or blurbs need to match.

**SNES frames:**

```bash
export SNES93=/tmp/snes/93
export SNES94_ROM=/tmp/snes/94/lst/nhl94snes.sfc
cd "$STUDIO" && node tools/build-snes-frames.js
```

**SNES palettes:**

```bash
rsync -a --delete "$SNES93/src/data/pals/" "$STUDIO/data/pals/snes/"   # adjust source path to match your clone
# Keep Rink.snespal and any 94-specific files per disasm layout
```

**Genesis Images tab (`lib/genesis-images.js`):**

1. Open the matching `EA-NHL-Tools/Asset-Extractor/extractAssets{93,94,95}.js` and disasm asset lists.
2. For each picture, set `start`/`end` to **retail ROM** bytes (extract script offsets are often start points; `test.js` documents **trim** rules for 93G).
3. Add/rename `id`/`label`/`group`/`kind`/`paletteAt` to match extract filenames.
4. Run optional ROM tests (place ROMs under `roms/` or `/tmp/disasm/.../lst/`).

**Audio (Genesis):**

1. Read `EA-NHL-Tools/Docs/SND/Readme.md` and NHL94Genesis `src/sound94.asm` / `title94.asm` when extending past 92G.
2. Update `lib/audio/genesis-constants.js` (offsets, SFX list, FMTune table).
3. `node tools/build-audio-catalog.js`
4. With a retail ROM: `node tools/build-audio-catalog.js --rom roms/nhl94.bin --game nhl94` to validate via `lib/audio/genesis-scan.js` (informational).

**95 PC / 94 PC sprite index:**

- When `Docs/Sprites/Readme.md` changes, update `data/frames95pc.asm` and regenerate 94 interim SPA if needed: `node tools/build-pc94-spa.js`.

**Test fixtures (optional but keeps CI honest):**

```bash
export EA_NHL_TOOLS_ROOT=/path/to/EA-NHL-Tools
rsync -a "$EA_NHL_TOOLS_ROOT/ANIM-To-BMP/"*.anim "$STUDIO/test/fixtures/ANIM-To-BMP/"
cd "$STUDIO/test/fixtures/ANIM-To-BMP"
for f in Sprites.anim Puck.anim Zam.anim Crowd.anim; do node animToBmp.js "$f"; done
```

### Step C — Regenerate manifest

```bash
cd "$STUDIO" && node tools/build-manifest.js
```

### Step D — Verify

```bash
cd "$STUDIO" && node test.js
```

Fix regressions in Studio (parser, viewer, or pinned expectations in `test.js`) — upstream may have fixed naming or ranges; **do not** weaken tests without noting why in the PR.

### Step E — Commit

- One logical commit or a small series (e.g. “Sync frames94.asm from NHL94Genesis”, “Refresh genesis-images nhlpa93 slices”).
- **Never** commit ROMs, `pc95/` retail trees, or `EA-NHL-Tools/` as a submodule unless the project explicitly adds one later.
- Open a PR to `main`; Pages deploy runs after merge.

---

## 4. Scoped sync (tell the agent which slice)

| Scope | Steps from §3 |
|-------|----------------|
| **genesis-frames** | B Genesis `frames*.asm` only + D–E |
| **genesis-images** | B `lib/genesis-images.js` + C–E |
| **genesis-audio** | B audio constants + `data/audio/` + C–E |
| **snes** | B SNES frames + pals + C–E |
| **pc95-index** | `frames95pc.asm` from Docs + C–E |
| **pc94** | `frames94pc.asm`, `extract-pc94-spa.js`, `lib/pc95.js` gfx bits + C–E |
| **fixtures** | B test fixtures + D–E |
| **full** | All of §3 |

Example user message:

> Sync NHL9X Studio per `docs/sync.md`, scope **genesis-images** and **genesis-audio**, using EA-NHL-Tools at `~/src/EA-NHL-Tools` and ROMs under `roms/`.

---

## 5. Agent checklist (copy-friendly)

When instructed to sync per this file:

1. Read `docs/AGENT-HANDOFF.md` and `docs/DESIGN.md` §1 (priority order) so you do not fight active GAP work.
2. Resolve upstream paths (`EA_NHL_TOOLS_ROOT`, `SNES93`, `SNES94_ROM`, disasm `lst/*.bin`).
3. Run the **scoped** steps in §3–4; produce a short summary of what changed upstream (commits or dates if visible).
4. Update Studio artifacts in the table in §2; run `node test.js` and `node tools/build-manifest.js`.
5. If new symbols or images appear, update viewer search aliases / `SPF_INFO` only when needed for UX.
6. Do **not** copy `Sprite-Viewer/` wholesale from EA-NHL-Tools.
7. PR to `main` with title like `Sync genesis frames from NHL94Genesis` and list upstream repos + revisions if known.

**Minimal prompt (full sync):**

```
Sync NHL9X Studio per docs/sync.md (full). EA-NHL-Tools at <path>. Disasm ROMs under /tmp/disasm and /tmp/snes as in sync.md. Run tests and build-manifest; open a PR. Do not commit ROMs or pc95 retail files.
```

---

## 6. Drift and conflicts

| Symptom | Likely cause | Action |
|---------|----------------|--------|
| `test.js` 93G slice failures | `genesis-images.js` vs `extractAssets93.js` trim | Reconcile using `EXTRACT93_SLICES` in `test.js`; prefer retail |
| 95G Crowd offset wrong | Dev ROM extract vs retail | Use retail offsets in `genesis-images.js` (`EXTRACT95_RETAIL`) |
| New SPA name parse errors | `frames*.asm` syntax | Extend `parse-frames.js` if assembler emits new directives |
| SNES 94 SPA count changed | Re-run `build-snes-frames.js`; may need new `SPAextra` naming rules in tool |
| Audio preview empty | Wrong FMTune table for title | Update `genesis-constants.js`; validate with `--rom` scan |
| `games.json` out of date | Forgot manifest | Always run `build-manifest.js` before push |

When upstream and Studio **intentionally** diverge (e.g. interim `frames94pc.asm`), document the reason in `data/*.asm` header comments and `docs/AGENT-HANDOFF.md` backlog — do not “fix” by reverting to 95 PC without a GAP-8 plan.

---

## 7. Related docs

| Doc | Use |
|-----|-----|
| `docs/AGENT-HANDOFF.md` | Current backlog, branch naming, PR habits |
| `docs/DESIGN.md` | GAP-* IDs, audio plan, 94 PC strategy |
| `docs/MIGRATION.md` | Why Studio is not a mirror of Sprite-Viewer |
| `lib/audio/README.md` | Audio catalog and preview |
| EA-NHL-Tools `Docs/Sprites/Readme.md` | DOS/Genesis frame numbering |
| EA-NHL-Tools `Docs/SND/Readme.md` | Hockey.snd digital anchors |
| NHL94Genesis `docs/HANDOFF.md` | Disasm naming for 94G songs/assets |

---

## 8. Document history

| Date | Change |
|------|--------|
| 2026-10-15 | Initial sync runbook for agents and maintainers |
