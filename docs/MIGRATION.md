# NHL9XStudio layout

This repository is the **standalone host** for **NHL9X Studio**. The app lives at the **repository root** (`server.js`, `lib/`, `public/`, `data/`, `test.js`).

## Sync from EA-NHL-Tools

Graphics work lands first in [EA-NHL-Tools](https://github.com/abdulahmad/EA-NHL-Tools) under `Sprite-Viewer/`. To refresh this repo:

```bash
# From a clone of both repos sharing a parent directory:
rsync -a --delete \
  --exclude pc95 --exclude roms --exclude pc94 \
  EA-NHL-Tools/Sprite-Viewer/ NHL9XStudio/
cp EA-NHL-Tools/docs/AGENT-HANDOFF.md NHL9XStudio/docs/
```

Then run:

```bash
node test.js
node tools/build-manifest.js
```

Set `EA_NHL_TOOLS_ROOT` to your EA-NHL-Tools checkout when running tests from NHL9XStudio only (see `test.js`).

## What stays in EA-NHL-Tools

Mod tools (`ANIM*-To-BMP`, `Asset-Extractor`, `MID94-Tools`, …) and optional PC asset trees. GitHub Pages deploy runs from **this** repo.
