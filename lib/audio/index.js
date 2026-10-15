const fs = require('fs');
const path = require('path');
const genesis = require('./genesis');
const { GAMES } = require('./genesis-constants');
const z80Patterns = require('./z80-test-patterns');
const soundSystem = require('./nhl92-sound-system');
const soundFixture = require('./nhl92-sound-fixture');

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
  const meta = genesis.previewMetaFromGame(genesis.gameMeta(gameId));
  if (!entry || !meta) return null;
  const schedule = genesis.previewEntry(romBuffer, entry, meta);
  if (!schedule) return null;
  return { entry, schedule };
}

function z80PreviewFromRom(romBuffer, patternId) {
  const rom = soundFixture.resolveRom(romBuffer);
  return z80Patterns.run(patternId, rom);
}

module.exports = {
  loadCatalog,
  catalogPath,
  genesisGameIds,
  previewFromRom,
  z80PreviewFromRom,
  z80Patterns,
  soundSystem,
  soundFixture,
  genesis
};
