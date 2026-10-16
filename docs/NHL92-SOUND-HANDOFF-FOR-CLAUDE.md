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
| 8 | Done | Sound test is NHL 92's only audio tab, polished; Sound data tab removed; chip lab unchanged (see below) |

**Retail accuracy rule:** Do not change drivers, patches, or sound data to “sound better.” Fixes belong in cores with their own test suites, or in documented harness/plan choices that match retail *when the game would actually be in that state*.

---

## Siren + SngEOP bleed (P0) — fixed

PR #28 played `song(0)` for one vblank and then `sfx(0)`, so SngEOP's first notes keyed on under the siren. The Sound test now plays boot → `song 0` (init vblank, no notes) → `p_turnoff` → `sfx 0` (`sfxPlanAfterMusicOff` in `lib/audio/nhl92-sound-chain.js`). The turnoff vblank only pauses (key-offs, empty DAC) and leaves `$41 = $FF`, so the siren loads its patches. The game calls `p_turnoff` at game setup and on pause. No RAM is written by hand. The render is `sfx-00-siren-SFXsiren-after-music-off.wav` (pinned); `sfx-00-siren-SFXsiren.wav` (bare boot, flat DC = silence) stays pinned too. Details: `docs/NHL92-SOUND-CHAIN.md` finding 1.

---

## Step 8 — what landed (UI + cleanup)

| Surface | Now |
|---------|-----|
| **Sound test** (`public/sound-test-view.js`) | NHL 92's only audio tab. Play/Stop toggle, Space/Enter/double-click, ▶ marker in the list, progress + clock, volume (output gain only), song/SFX details from the parser. Hides the sprite-only controls. |
| **Sound test sequencer** | Channels view under the clock: FM1–FM6 + PSG piano roll and an Events list, derived from the Z80's YM writes (`lib/audio/ym-note-tracker.js`, `public/sound-roll.js`), placed at the audible position. Read-only `onYmWrite` / `onPsgWrite` / `onYmReset` taps on `Nhl92SoundChain.create`; no pinned hash changed. Tests: `test/ym-note-tracker.js`. See `docs/NHL92-SOUND-CHAIN.md`. |
| **Sound data** tab | Removed, along with `public/sound-data-view.js`. The parser (`lib/audio/nhl92-sound-data.js`) stays and feeds the Sound test details. |
| **Audio** tab (AUD-1 sketch) | Hidden for NHL 92 (`hasAudioTab`). Kept for NHLPA 93–95 and the Z80 test profile. Old NHL 92 `mode=audio` / `mode=sounddata` links open the Sound test. |
| **Z80** tab | Unchanged (Z80 test profile only). |
| **Chip lab** | Unchanged: YM/PSG presets, NHL '92 patch scales and DAC SFX through the Z80 driver alone. (Step 8 briefly dropped the DAC SFX player; restored at the user's request.) |
| Default view | NHL 92 + SPA, unchanged. |

**Cleanup kept deliberately** (all still have users): `audio-engine.js`, `genesis*.js` (NHLPA 93–95 Audio tab, `test.js` catalog tests, `/api/games/:id/audio`), `nhl92-sound-system.js`, `z80-machine.js`, `nhl92-z80.js`, `z80-test-patterns.js` (Z80 test profile), `nhl92-z80-audio.js` + chip-test pins (chip lab, `test/nhl92-z80-audio.js`), `nhl92-z80-golden.js` (`test/nhl92-z80-driver.js`), `data/audio/nhl92.json` (server API and tests).

---

## Gaps still open

Written up with numbers in `docs/NHL92-SOUND-CHAIN.md` § Not verified:

- Ear match against the retail game (no MAME/BlastEm capture allowed).
- 68k timing within the frame: the copy's offset after vblank isn't measured; the bus hold is about 560–630 Z80 T-states from textbook 68000 timings; the Z80 stall isn't modelled.
- YM busy flag: the driver never reads it; the open question is hardware write acceptance at 62-T-state spacing.
- ymfm vs a real YM2612: prebuilt WASM, chip class and options unchecked; idle output +504.
- Deployed GitHub Pages: a static `_site` built like the workflow passed under a subpath; the live site wasn't loaded.
- ScriptProcessor underrun on slow clients.
- **93G–95G audio** is still a placeholder (AUD-1); out of scope unless the user expands it.

---

## Next steps (suggested order)

1. Review/merge PR #30 (siren) and the step 8 UI PR.
2. Load the Sound test on the deployed Pages site after merge (the workflow deploys `main`).
3. Listen against the game: `out/nhl92-sound-chain.zip` (re-render with `node tools/render-nhl92-sound-chain.js`, about 4 minutes).
4. Optional: cycle counts in `m68k-cpu.js` (SingleStepTests carries them) would let the frame model place the copy and the bus hold; AudioWorklet instead of ScriptProcessor.

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
