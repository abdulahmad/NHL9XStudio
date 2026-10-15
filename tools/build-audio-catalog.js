/**
 * Write data/audio/<gameId>.json catalogs for Genesis titles.
 * Usage: node tools/build-audio-catalog.js
 */
const fs = require('fs');
const path = require('path');
const { genesis, genesisGameIds } = require('../lib/audio');

const OUT = path.join(__dirname, '..', 'data', 'audio');

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const id of genesisGameIds()) {
    const catalog = genesis.buildCatalog(id);
    if (!catalog) continue;
    const file = path.join(OUT, id + '.json');
    fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n');
    console.log('Wrote', file, '(' + catalog.entries.length + ' entries)');
  }
}

main();
