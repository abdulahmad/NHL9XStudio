/** Build static games.json for GitHub Pages / offline boot. */
const fs = require('fs');
const path = require('path');
const { GAMES, sheetGameBanks } = require('./games');
const { APP_NAME } = require('./studio');

// Team palette files bundled under data/pals/<dir> (the static site has no sibling ANIM-To-BMP checkouts to read them from).
// NHL 92, NHLPA 93 and NHL 94 Genesis share one set (the ANIM94-To-BMP palettes are the NHL 92 ones).
const PALETTE_DIRS = { '92': 'genesis', '94': 'genesis', '95': 'genesis95', snes: 'snes' };

function bundledPaletteFiles(game) {
  const name = PALETTE_DIRS[game.palettes];
  if (!name) return { dir: null, files: undefined };
  const dir = path.join(__dirname, '..', 'data', 'pals', name);
  if (!fs.existsSync(dir)) return { dir: name, files: [] };
  return { dir: name, files: fs.readdirSync(dir).filter((file) => /\.(pal|snespal)$/i.test(file)).sort() };
}

function staticGameStatus(game) {
  const palettes = game.kind === 'pc95' || game.kind === 'pc94' ? { dir: null, files: undefined } : bundledPaletteFiles(game);
  const images = game.images || [];
  let banks = game.banks;
  if (game.kind === 'sheet') banks = sheetGameBanks(images);
  if (game.kind === 'pc95' || game.kind === 'pc94') {
    banks = [{ id: 'sprites', label: 'Players' }, { id: 'rink', label: 'Rink and crowd' }];
  }
  // NHL 92 ships bundled .anim on Pages; other games unlock after a ROM drop in the browser.
  const pixels = game.id === 'nhl92';
  return {
    app: APP_NAME,
    id: game.id,
    title: game.title,
    source: game.source,
    platform: game.platform,
    kind: game.kind,
    paletteKind: game.paletteKind,
    jerseyRow: game.jerseyRow || 2,
    paletteLabel: game.paletteLabel || null,
    tagline: game.tagline || null,
    hint: game.hint || null,
    frames: game.frames,
    banks,
    images: (game.kind === 'pc95' || game.kind === 'pc94') ? [] : images,
    pixels,
    rom: false,
    sheet: game.sheet || null,
    snes: game.snes || null,
    romHint: game.kind === 'pc95' ? 'Drop PC95 folder or files' : (game.kind === 'pc94' ? 'Drop PC94 folder or files' : 'Drop ROM or use roms/'),
    paletteDir: palettes.dir,
    paletteFiles: palettes.files
  };
}

function buildManifest() {
  return GAMES.map(staticGameStatus);
}

module.exports = { buildManifest, staticGameStatus, PALETTE_DIRS };
