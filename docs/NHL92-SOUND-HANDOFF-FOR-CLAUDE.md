# NHL '92 sound — handoff for Claude (2026-10-15)

This document is the single entry point for continuing the **8-step NHL '92 Genesis sound-test plan** after steps 1–7 (and the siren Sound-test fix) landed on `main`. Read the linked docs for depth; do not modify the retail disassembly repo ([NHL92Genesis](https://github.com/abdulahmad/NHL92Genesis)).

---

## Git context

| Item | Detail |
|------|--------|
| **Repo** | [NHL9XStudio](https://github.com/abdulahmad/NHL9XStudio), app at repo root |
| **Base branch** | `main` |
| **Branch naming** | `cursor/<descriptive-name>-e6a9` (Cloud Agent convention) |
| **Workflow** | Small commits, `node test.js` green, open PR to `main`, do not force-push `main` |
| **Do not commit** | Retail ROMs (`roms/`), `out/` WAVs, `public/games.json` unless manifest intentionally regenerated |

### Recent merges on `main` (sound stack)

| PR | Merge | What |
|----|-------|------|
| [#26](https://github.com/abdulahmad/NHL9XStudio/pull/26) | `8766f89` | Step 6: 68k sound driver harness + pinned logs |
| [#27](https://github.com/abdulahmad/NHL9XStudio/pull/27) | `97f2bf3` | Step 7: full chain (68k → shared Z80 RAM → Z80 → ymfm), renders, tests, Sound test tab |
| [#28](https://github.com/abdulahmad/NHL9XStudio/pull/28) | `885ad56` | Sound test siren: one `song(0)` init vblank before `sfx(0)` |

Many older `cursor/*-e6a9` branches exist on the remote; treat **`main` as source of truth** unless reviving a specific PR.

### Commands

```bash
node tools/build-manifest.js   # before test.js if manifest stale
node test.js                   # full suite (~60s; includes chain test ~40s)
node tools/render-nhl92-sound-chain.js --update   # ~160s; writes out/ + pins (only when chain intentionally changes)
node server.js                 # local viewer + chip lab (port 8732)
```

Optional local ROM: `roms/nhl92.bin` (524288-byte Genesis ROM). Enables wrapper-vs-retail and full-ROM sound-data checks; CI runs without it.

---

## 8-step plan — where we are

| Step | Status | Notes |
|------|--------|--------|
| 1 | Abandoned | MAME Z80/YM capture; step 7 forbids emulator capture |
| 2 | Done | YM2612 + SN76489 cores (chip lab) |
| 2b | Done | Sound data parser |
| 3 | Done | Z80 driver harness + tests |
| 4 | Done | Z80 → chips; chip lab NHL '92 patch/SFX section |
| 5 | Done | Sound data ownership / parser pins |
| 6 | Done | 68k driver alone; `docs/NHL92-68K-DRIVER.md` |
| 7 | Done | Full chain; `docs/NHL92-SOUND-CHAIN.md` |
| **8** | **Not started** | **Polished Sound test UI**; collapse viewer tabs (see below) |

**Retail accuracy rule:** Do not change drivers, patches, or sound data to “sound better.” Fixes belong in cores with their own test suites, or in documented harness/plan choices that match retail *when the game would actually be in that state*.

---

## Siren + SngEOP bleed (P0) — fixed

PR #28 played `song(0)` for one vblank and then `sfx(0)`, so SngEOP's first notes keyed on under the siren. The Sound test now plays boot → `song 0` (init vblank, no notes) → `p_turnoff` → `sfx 0` (`sfxPlanAfterMusicOff` in `lib/audio/nhl92-sound-chain.js`). The turnoff vblank only pauses (key-offs, empty DAC) and leaves `$41 = $FF`, so the siren loads its patches. The game calls `p_turnoff` at game setup and on pause. No RAM is written by hand. The render is `sfx-00-siren-SFXsiren-after-music-off.wav` (pinned); `sfx-00-siren-SFXsiren.wav` (bare boot, flat DC = silence) stays pinned too. Details: `docs/NHL92-SOUND-CHAIN.md` finding 1.

---

## Chip lab vs Z80 / full chain

### What exists today

| Surface | Path | What it runs |
|---------|------|----------------|
| **Chip lab** | `public/chip-lab.html` + `chip-lab.js` | YM/PSG presets; NHL '92 **Z80-only** path via `nhl92-z80-audio.js` (patches @ `$02A5`, DAC SFX). Renders full clip then plays WAV in browser. **No 68k driver.** |
| **Viewer Sound test** | `public/sound-test-view.js` | Full **step 7 chain** live (`nhl92-sound-chain.js` + WASM). |
| **Viewer Z80 tab** | Game id `z80test` in `games.json` | `lib/audio/z80-test-patterns.js` + `nhl92-z80-harness.js` patterns (boot, buffer decode, etc.). Separate mini-app mode in `viewer.js`. |
| **Node tests** | `test/nhl92-z80-driver.js`, `test/nhl92-sound-chain.js` | Harness + chain oracles, pinned hashes |

### “Can chip lab reflect Z80 tests?”

**Not today as one unified UI.** Reasonable options for step 8 / cleanup:

1. **Link or embed** — Chip lab “NHL '92 driver” section could add a third mode: “Full chain (Sound test)” linking to main viewer `#game=nhl92&mode=soundtest`, or iframe the same scripts (heavy).
2. **Reuse chain in chip lab** — Load the same script bundle as Sound test and run one-shot renders like now but through `Nhl92SoundChain` instead of `Nhl92Z80Audio` (closer to game, matches step 7).
3. **Expose z80-test-patterns in chip lab** — Port the **viewer Z80 tab** pattern list into chip lab for regression demos (still Z80-only, no 68k).
4. **Deprecate chip lab NHL section** — If Sound test becomes the only NHL audio UI, chip lab keeps only raw YM/PSG presets for chip debugging.

**Recommendation:** Treat **Sound test** as the product surface; keep chip lab for **raw chip presets** and optionally one “Run chain render (same as Sound test)” button that shares `nhl92-sound-chain.js`. Drop duplicate Z80-only NHL playback from chip lab once Sound test is polished.

---

## UI cleanup (step 8 scope)

**Goal:** For NHL 92, **only Sound test** for audio/sound UX. Remove **Audio** and **Sound data** tabs from the main viewer (or hide entirely for `nhl92`).

### Tabs to remove / merge

| Tab | Today | Action |
|-----|--------|--------|
| **Audio** | Genesis FM cmdstream **square-wave sketch** via `genesis.js` + `audio-engine.js` + `data/audio/nhl92.json` (and 93–95 catalogs) | Remove from NHL 92 UI; keep backend only if other titles still need AUD-1 preview |
| **Sound data** | Read-only parser browser (`public/sound-data-view.js`, `Nhl92SoundDataView`) | Remove tab; optional: fold “details” into Sound test meta panel or a collapsible doc link |
| **Sound test** | Live chain playback | **Keep** — make default when opening NHL 92 sound, polish UI (transport, levels, names, loading, mobile) |
| **Z80** | Only for `z80test` game profile | Keep for dev regression, not for normal NHL 92 users |

### Viewer code touchpoints

- `public/index.html` — mode buttons, script tags (many audio scripts).
- `public/viewer.js` — `SOUND_PANELS`, `hasSoundData`, `hasSoundTest`, `loadAudioCatalog`, mode loops, hash params `snd` / `sndtest` / `audio`.
- `public/viewer.css` — `.sound-data-view`, `.is-sounddata`.
- Default mode: user wants NHL 92 + SPA default for graphics; for **sound**, consider defaulting to `soundtest` when entering NHL 92 only if product owner agrees (currently SPA).

### Chip lab link

Header still has **Chip lab** → `chip-lab.html`. Decide: keep for developers only, or remove link from main app after Sound test is complete.

---

## Legacy / duplicate sound paths (cleanup candidates)

**Keep (core of step 7):**

- `lib/audio/nhl92-sound-chain.js`, `nhl92-68k-harness.js`, `nhl92-68k-run.js`, `nhl92-z80-harness.js`, `nhl92-sound-fixture.js`, `nhl92-sound-data.js`, `nhl92-sfx-names.js`, `ym2612-wasm.js`, `sn76489.js`, `m68k-cpu.js`
- `test/nhl92-*-driver.js`, `test/nhl92-sound-chain.js`, `test/m68k-cpu.js`
- `data/audio/nhl92-68k-driver.json`, `nhl92-sound-chain.json`, `nhl92-chip-tests.json`
- `tools/render-nhl92-sound-chain.js`, `tools/render-nhl92-chip-tests.js`, `tools/run-nhl92-68k-driver.js`
- `public/sound-test-view.js`

**Review before deleting (may still be referenced):**

| Artifact | Role | Risk if removed |
|----------|------|------------------|
| `public/sound-data-view.js` | Sound data tab UI | Safe after tab removed; parser stays in `lib/audio/nhl92-sound-data.js` |
| `public/audio-engine.js` | Audio tab playback | Needed until Audio tab removed |
| `lib/audio/genesis.js`, `genesis-events.js`, `genesis-92-sequence.js` | AUD-1 FM preview | Used by Audio tab + `test.js` catalog tests for 92/93/94 when ROM present |
| `lib/audio/nhl92-sound-system.js` | FM/SFX preview schedules | `test.js`, `z80-test-patterns.js` |
| `lib/audio/nhl92-z80-audio.js` | Z80 → chips (step 4) | Chip lab, `test/nhl92-z80-audio.js`, pins |
| `lib/audio/nhl92-z80.js` | Older Z80 wrapper? | Grep before remove |
| `data/audio/nhl92.json`, `nhlpa93.json`, etc. | Audio catalogs | Server `/api/games/:id/audio` |
| `lib/audio/nhl92-z80-golden.js` | MAME capture replay | Inert without `data/captures/` (step 1 abandoned) |

**Cleanup process:** Remove UI first; run `node test.js`; delete dead JS only when nothing imports it. Do not break chip lab until Sound test parity is agreed.

---

## Gaps still open (from step 7 + product)

Documented in `docs/NHL92-SOUND-CHAIN.md` § Not verified:

- Ear match vs retail game (no MAME/BlastEm capture allowed).
- 68k cycle timing within the frame; Z80 stall during 68k bus hold not modeled.
- YM2612 busy flag always idle in harness.
- ymfm vs real YM2612 (DAC, ladder, model 1/2).
- GitHub Pages Sound test not manually verified (local server was).
- ScriptProcessor underrun on slow clients.

Additional product gaps:

- ~~Siren init bleed~~ — fixed (above).
- **Sound test UX** (step 8): list grouping, play/stop state, volume, progress, “now playing”, error surfacing, drop ScriptProcessor for AudioWorklet if needed.
- ~~`sfx-00` WAV in zip nearly silent~~ — both renders are in the zip now, labelled.
- **93G–95G audio** still placeholders (AUD-1); out of scope unless user expands.

---

## Next steps (suggested order)

1. ~~**Fix siren without SngEOP**~~ — done (song 0 init → `p_turnoff` → siren).
2. **Step 8 UI** — Remove Audio + Sound data tabs for NHL 92; polish Sound test (layout, default selection, keyboard, status line); optionally default hash `#game=nhl92&mode=soundtest`.
3. **Chip lab decision** — Drop NHL Z80-only player or replace with “open Sound test” / one chain render; keep YM/PSG presets.
4. **Dead code pass** — After tab removal, prune unused viewer hooks and catalog loading for 92; keep genesis audio if other games still use Audio tab.
5. **Pages smoke** — Load Sound test on GitHub Pages; confirm WASM paths (`lib/audio/generated/`).
6. **Optional:** Merge Sound data **content** into Sound test details (song order lists as read-only) without separate tab.

---

## Doc map (read in this order)

| Doc | Content |
|-----|---------|
| `docs/NHL92-SOUND-CHAIN.md` | Frame model, renders, tests, findings |
| `docs/NHL92-68K-DRIVER.md` | Step 6 68k behavior, SFX table, SngTitle→reprise |
| `docs/NHL92-SOUND-DATA.md` | Parser, blocks, patterns |
| `docs/M68K-CORE.md` | 68k interpreter limits |
| `lib/audio/README.md` | Module index |
| `docs/AGENT-HANDOFF.md` | General NHL9X Studio handoff (graphics backlog; update AUD line when sound UI lands) |

Reference disassembly (read-only): `NHL92Genesis` — `src/sound/sound.asm`, `src/middle.asm` (`sfx`/`song`), `src/ram.asm` (SFX equates).

---

## Pinned artifacts

| File | Purpose |
|------|---------|
| `data/audio/nhl92-68k-driver.json` | Step 6 log SHA-256 |
| `data/audio/nhl92-sound-chain.json` | Subset of chain WAV/log SHA-256 |
| `data/audio/nhl92-chip-tests.json` | Chip lab / Z80-audio renders |
| `data/fixtures/nhl92-sound-slice.bin` | Bundled ROM slice @ `$F4C8` |

Local listening: generate `out/nhl92-sound-chain.zip` with render tool (git-ignored).
