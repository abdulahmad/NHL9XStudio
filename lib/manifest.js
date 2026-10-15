/** Build static games.json for GitHub Pages / offline boot. */
const fs = require('fs');
const path = require('path');
const { GAMES, sheetGameBanks } = require('./games');
const { APP_NAME } = require('./studio');

function snesPaletteFiles() {
  const dir = path.join(__dirname, '..', 'data', 'pals', 'snes');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /\.snespal$/i.test(name)).sort();
}

function staticGameStatus(game) {
  const images = game.images || [];
  let banks = game.banks;
  if (game.kind === 'sheet') banks = sheetGameBanks(images);
  if (game.kind === 'pc95' || game.kind === 'pc94') {
    banks = [{ id: 'sprites', label: 'Players' }, { id: 'rink', label: 'Rink and crowd' }];
  }
  // GitHub Pages has no server ROM; client drop sets pixels on the live game entry.
  const pixels = false;
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
    paletteFiles: game.paletteKind === 'snes' ? snesPaletteFiles() : undefined
  };
}

function buildManifest() {
  return GAMES.map(staticGameStatus);
}

module.exports = { buildManifest, staticGameStatus };
