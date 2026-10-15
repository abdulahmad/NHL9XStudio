const fs = require('fs');
const path = require('path');
const genesis = require('./genesis');
const { GAMES } = require('./genesis-constants');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'audio');

function catalogPath(gameId) {
  return path.join(DATA_DIR, gameId + '.json');
}

function loadCatalog(gameId) {
  const file = catalogPath(gameId);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return genesis.buildCatalog(gameId);
}

function genesisGameIds() {
  return Object.keys(GAMES);
}

function previewFromRom(gameId, entryId, romBuffer) {
  const catalog = loadCatalog(gameId);
  const entry = catalog.entries.find((e) => e.id === entryId);
  const meta = genesis.gameMeta(gameId);
  if (!entry || !meta) return null;
  const schedule = genesis.previewEntry(romBuffer, entry, meta);
  if (!schedule) return null;
  return { entry, schedule };
}

module.exports = {
  loadCatalog,
  catalogPath,
  genesisGameIds,
  previewFromRom,
  genesis
};
