#!/usr/bin/env node
/**
 * Regenerate data/audio/nhl92-patch-analysis.json (decoded patches, song/SFX usage, measured
 * probe notes), or check that the stored file is current.
 *
 *   node tools/build-nhl92-patch-analysis.js           # rewrite the file
 *   node tools/build-nhl92-patch-analysis.js --check   # exit 1 if it is out of date
 */
const fs = require('fs');
const path = require('path');
const analysis = require('../lib/audio/nhl92-patch-analysis');

const FILE = path.join(__dirname, '..', 'data', 'audio', 'nhl92-patch-analysis.json');

async function main() {
  const check = process.argv.includes('--check');
  const fresh = await analysis.build();
  if (check) {
    const stored = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const problems = analysis.compare(stored, fresh);
    if (problems.length) {
      console.error(problems.join('\n'));
      process.exit(1);
    }
    console.log('nhl92-patch-analysis.json is current');
    return;
  }
  fs.writeFileSync(FILE, analysis.stringify(fresh));
  console.log('wrote', path.relative(process.cwd(), FILE));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
