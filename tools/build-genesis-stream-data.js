/**
 * Build lib/audio/data/*-streams.json from disasm sound*.asm + extractAssets*.js
 *
 * DISASM93=/tmp/NHLPA93Genesis DISASM94=/tmp/NHL94Genesis node tools/build-genesis-stream-data.js
 */
const fs = require('fs');
const path = require('path');
const { loadMerged } = require('../lib/audio/parse-sound-asm');

const OUT = path.join(__dirname, '..', 'lib', 'audio', 'data');

const jobs = [
  {
    gameId: 'nhlpa93',
    root: process.env.DISASM93 || '/tmp/NHLPA93Genesis',
    asm: 'src/sound93.asm',
    extract: 'tools/extractAssets93.js'
  },
  {
    gameId: 'nhl94',
    root: process.env.DISASM94 || '/tmp/NHL94Genesis',
    asm: 'src/sound94.asm',
    extract: 'tools/extractAssets94.js'
  }
];

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const job of jobs) {
    const asmPath = path.join(job.root, job.asm);
    const extractPath = path.join(job.root, job.extract);
    if (!fs.existsSync(asmPath) || !fs.existsSync(extractPath)) {
      console.warn('Skip', job.gameId, '(missing', asmPath, 'or', extractPath, ')');
      continue;
    }
    const merged = loadMerged(job.gameId, asmPath, extractPath);
    const file = path.join(OUT, job.gameId + '-streams.json');
    fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
    console.log('Wrote', file, merged.streams.length, 'streams');
  }
}

main();
