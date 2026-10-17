#!/usr/bin/env node
/**
 * Extract the NHLPA 93 or NHL 94 Genesis sound segment (68k driver, Z80 program, FM patches, event
 * streams, PCM samples) for the bundled Sound test fixture.
 *
 *   node tools/extract-nhl9x-sound-fixture.js [93|94]     (default: both, whichever ROMs are found)
 *
 * Source: your own retail ROM (roms/nhlpa93.bin / roms/nhl94.bin, or NHL93_ROM / NHL94_ROM). The ROM is
 * checked by SHA-1 and size. Only the sound segment is written; not a full game ROM.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const GAMES = {
  93: {
    name: 'NHLPA 93 (Genesis, retail v1.1)', sha1: '8efc1cacb079ea223966dda065c16c49e584cac2', size: 0x80000,
    start: 0x165d8, end: 0x2e1fc, // sound93 (NHLPA93Genesis); graphics93 starts at $2E1FC
    env: 'NHL93_ROM', files: ['roms/nhlpa93.bin', 'roms/nhlpa93retail.bin', '../ea-nhl-disassembly-project/NHL93-Genesis/nhlpa93retail.bin'],
    out: 'nhl93-sound'
  },
  94: {
    name: 'NHL 94 (Genesis, retail)', sha1: '7b1489ab501258133bf03e5f0892b77d04312580', size: 0x100000,
    start: 0x1a264, end: 0x4b5c0, // sound94 (NHL94Genesis tools/segments.json); graphics94 starts at $4B5C0
    env: 'NHL94_ROM', files: ['roms/nhl94.bin', '../abdulahmad/nhl94genesis/lst/nhl94.bin', '../ea-nhl-disassembly-project/NHL94-Genesis/nhl94.bin'],
    out: 'nhl94-sound'
  }
};

const want = process.argv[2] ? [process.argv[2]] : Object.keys(GAMES);
let failed = false;
for (const key of want) {
  const g = GAMES[key];
  if (!g) { console.error('unknown game ' + key + ' (93 or 94)'); process.exit(1); }
  const candidates = [process.env[g.env]].concat(g.files.map((f) => path.join(root, f))).filter(Boolean);
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) {
    console.error('NHL ' + key + ': need ' + g.files[0] + ' (or ' + g.env + '=path) to refresh the sound fixture.');
    failed = true;
    continue;
  }
  const rom = fs.readFileSync(file);
  const sha1 = crypto.createHash('sha1').update(rom).digest('hex');
  if (rom.length !== g.size || sha1 !== g.sha1) {
    console.error('NHL ' + key + ': ' + file + ' is not the retail ROM (size ' + rom.length + ', SHA-1 ' + sha1 + '); expected ' + g.size + ' / ' + g.sha1);
    failed = true;
    continue;
  }
  const outDir = path.join(root, 'data', 'fixtures');
  fs.mkdirSync(outDir, { recursive: true });
  const slice = rom.subarray(g.start, g.end);
  fs.writeFileSync(path.join(outDir, g.out + '-slice.bin'), slice);
  fs.writeFileSync(path.join(outDir, g.out.replace('-sound', '') + '-sound-fixture.json'), JSON.stringify({
    source: g.name + ' sound segment',
    romSha1: g.sha1,
    soundSlice: { romOffset: g.start, length: slice.length },
    syntheticRomSize: g.end,
    note: 'Bundled for the Sound test only. Not a full game ROM.'
  }, null, 2) + '\n');
  console.log('NHL ' + key + ': wrote ' + g.out + '-slice.bin (' + slice.length + ' bytes, ROM $' + g.start.toString(16) + '-$' + g.end.toString(16) + ')');
}
process.exit(failed ? 1 : 0);
