#!/usr/bin/env node
/**
 * Refresh the generated tables in docs/NHL92-GM-MAP.md from the mapping and analysis JSON.
 *
 *   node tools/build-nhl92-gm-map-doc.js           # rewrite the tables
 *   node tools/build-nhl92-gm-map-doc.js --check   # exit 1 if the doc is out of date
 */
const fs = require('fs');
const path = require('path');
const doc = require('../lib/audio/nhl92-gm-map-doc');

const ROOT = path.join(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'NHL92-GM-MAP.md');
const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'audio', 'nhl92-gm-map.json'), 'utf8'));
const analysis = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'audio', 'nhl92-patch-analysis.json'), 'utf8'));

const current = fs.readFileSync(DOC, 'utf8');
const next = doc.apply(current, doc.sections(map, analysis));
if (process.argv.includes('--check')) {
  if (next !== current) {
    console.error('docs/NHL92-GM-MAP.md is out of date: run node tools/build-nhl92-gm-map-doc.js');
    process.exit(1);
  }
  console.log('docs/NHL92-GM-MAP.md is current');
} else {
  fs.writeFileSync(DOC, next);
  console.log('wrote', path.relative(process.cwd(), DOC));
}
