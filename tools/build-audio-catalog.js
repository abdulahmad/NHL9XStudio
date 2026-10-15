/**
 * Write data/audio/<gameId>.json catalogs for Genesis titles.
 * Usage: node tools/build-audio-catalog.js [--rom <path>] [--game <id>]
 */
const fs = require('fs');
const path = require('path');
const { genesis, genesisGameIds } = require('../lib/audio');
const { scanGenesisAudio } = require('../lib/audio/genesis-scan');
const { GAMES } = require('../lib/audio/genesis-constants');

const OUT = path.join(__dirname, '..', 'data', 'audio');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { rom: null, game: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rom' && args[i + 1]) opts.rom = path.resolve(args[++i]);
    else if (args[i] === '--game' && args[i + 1]) opts.game = args[++i];
  }
  return opts;
}

function main() {
  const opts = parseArgs();
  let scanNote = null;
  if (opts.rom && fs.existsSync(opts.rom)) {
    const buf = fs.readFileSync(opts.rom);
    const gameId = opts.game || 'nhl92';
    const hints = GAMES[gameId] || {};
    const scan = scanGenesisAudio(buf, hints);
    scanNote = { gameId, scan };
    console.log('ROM scan', gameId, JSON.stringify(scan));
    if (scan.digitalAnchor != null && hints.digitalAnchor === scan.digitalAnchor) {
      console.log('Digital anchor matches pinned constant 0x' + scan.digitalAnchor.toString(16));
    }
    if (scan.fmtune && hints.fmtuneTable === scan.fmtune.fmtuneTable) {
      console.log('FMTune table matches pinned offset 0x' + scan.fmtune.fmtuneTable.toString(16));
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  const ids = opts.game ? [opts.game] : genesisGameIds();
  for (const id of ids) {
    const catalog = genesis.buildCatalog(id);
    if (!catalog) continue;
    const file = path.join(OUT, id + '.json');
    fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n');
    console.log('Wrote', file, '(' + catalog.entries.length + ' entries)');
  }
  if (scanNote) console.log('(Scan is informational; update genesis-constants.js manually when pinning new titles.)');
}

main();
