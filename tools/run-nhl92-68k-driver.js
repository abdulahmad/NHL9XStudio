#!/usr/bin/env node
/**
 * Run the retail NHL '92 68k sound driver on its own (step 6) for every song
 * and SFX ID in the canonical plan, write one per-vblank log per run plus a
 * cross-check summary, and optionally pin the log hashes.
 *
 *   node tools/run-nhl92-68k-driver.js [outDir]          # default out/nhl92-68k-driver
 *   node tools/run-nhl92-68k-driver.js [outDir] --update # also rewrite data/audio/nhl92-68k-driver.json
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const R = require('../lib/audio/nhl92-68k-run');
const A = require('../lib/audio/nhl92-68k-analysis');
const SD = require('../lib/audio/nhl92-sound-data');
const names = require('../lib/audio/nhl92-sfx-names');
const fixture = require('../lib/audio/nhl92-sound-fixture');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'data', 'audio', 'nhl92-68k-driver.json');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function main() {
  const args = process.argv.slice(2);
  const update = args.includes('--update');
  const outDir = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'out', 'nhl92-68k-driver'));
  fs.mkdirSync(outDir, { recursive: true });
  const rom = fixture.resolveRom(null);
  const data = SD.parse(rom);
  const manifest = { note: 'SHA-256 of tools/run-nhl92-68k-driver.js logs. Regenerate with --update only when the chain intentionally changes.', songs: [], sfx: [] };
  const summary = { songs: [], sfx: [] };
  for (const [id, frames] of R.PLAN.songs) {
    const run = R.runSong(rom, id, frames);
    const name = 'song-' + id;
    const log = R.logText(run, 'NHL 92 68k driver · song ' + id + ' ' + data.songs[id].name + ' · ' + frames + ' vblanks');
    fs.writeFileSync(path.join(outDir, name + '.log'), log);
    manifest.songs.push({ id, frames, file: name + '.log', sha256: sha256(log) });
    const walk = A.compareWalk(run, data);
    const notes = A.compareNotes(run, data);
    summary.songs.push({ id, name: data.songs[id].name, frames, switchFrame: walk.switchFrame, walk: walk.channels, notes });
    console.log(name, data.songs[id].name, 'walk', walk.channels.every((c) => c.ok) ? 'ok' : 'DIVERGES',
      'notes', notes.every((s) => s.channels.every((c) => c.ok)) ? 'ok' : 'DIVERGE', walk.switchFrame != null ? 'switch @' + walk.switchFrame : '');
  }
  for (const [id, frames] of R.PLAN.sfx) {
    const run = R.runSfx(rom, id, frames);
    const name = 'sfx-' + String(id).padStart(2, '0');
    const log = R.logText(run, 'NHL 92 68k driver · SFX ' + names.name(id) + ' · ' + frames + ' vblanks');
    fs.writeFileSync(path.join(outDir, name + '.log'), log);
    manifest.sfx.push({ id, frames, file: name + '.log', sha256: sha256(log) });
    const check = A.checkSfx(run, data);
    summary.sfx.push(Object.assign({ name: names.name(id), handlerLabel: data.sfx[id].label }, check));
    console.log(name, names.name(id), check.ok ? 'ok' : 'MISMATCH');
  }
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  if (update) {
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log('wrote', path.relative(ROOT, MANIFEST));
  }
  console.log('logs in', outDir);
}

main();
