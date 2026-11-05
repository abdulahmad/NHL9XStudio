#!/usr/bin/env node
/**
 * List NHL 96 PC asset names from the retail HOCKEY.EXE.
 *
 * Source of truth is the NHL96PC disassembly copy of the EXE
 * (SHA-1 426fb8c0c80088c6a2c56a9dac50509cb9c24540), not EA-NHL-Tools.
 *
 * Usage:
 *   node tools/extract-pc96-files.js [path/to/HOCKEY.EXE]
 *   node tools/extract-pc96-files.js --write [path/to/HOCKEY.EXE]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SHA1 = '426fb8c0c80088c6a2c56a9dac50509cb9c24540';
const DEFAULTS = [
  path.join(ROOT, '..', 'NHL96PC', 'lst', 'HOCKEY.EXE'),
  path.join(ROOT, '..', 'nhl96pc', 'lst', 'HOCKEY.EXE'),
  '/agent/repos/NHL96PC/lst/HOCKEY.EXE',
  path.join(ROOT, 'pc96', 'HOCKEY.EXE')
];

function findExe(argv) {
  const arg = argv.find((a) => /\.exe$/i.test(a) && !a.startsWith('-'));
  if (arg) return arg;
  return DEFAULTS.find((p) => fs.existsSync(p)) || null;
}

function stringsOf(buf) {
  const out = [];
  let cur = '';
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b >= 32 && b < 127) {
      if (!cur) start = i;
      cur += String.fromCharCode(b);
    } else {
      if (cur.length >= 4) out.push({ off: start, text: cur });
      cur = '';
    }
  }
  if (cur.length >= 4) out.push({ off: start, text: cur });
  return out;
}

function uniqUpper(list) {
  const seen = new Set();
  const out = [];
  for (const name of list) {
    const key = name.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out.sort();
}

function collect(buf) {
  const re = /^[A-Za-z0-9_!*?-][A-Za-z0-9_!*?-]*\.(FSH|QFS|VIV|ASF|BNK|QDA|QVS|VSH)$/i;
  const by = { fsh: [], qfs: [], viv: [], asf: [], bnk: [], other: [] };
  for (const { text } of stringsOf(buf)) {
    if (text === '****.FSH' || text === '.FSH' || text === '.viv') continue;
    if (!re.test(text)) continue;
    const ext = text.split('.').pop().toLowerCase();
    const bucket = by[ext] || by.other;
    bucket.push(text);
  }
  return {
    fsh: uniqUpper(by.fsh),
    qfs: uniqUpper(by.qfs),
    viv: uniqUpper(by.viv),
    asf: uniqUpper(by.asf),
    bnk: uniqUpper(by.bnk),
    other: uniqUpper(by.other)
  };
}

function main() {
  const write = process.argv.includes('--write');
  const exePath = findExe(process.argv);
  if (!exePath) {
    console.error('HOCKEY.EXE not found');
    process.exit(1);
  }
  const buf = fs.readFileSync(exePath);
  const sha1 = crypto.createHash('sha1').update(buf).digest('hex');
  const files = collect(buf);
  const catalog = {
    gameId: 'nhl96pc',
    source: 'NHL96PC',
    exeSha1: sha1,
    playback: false,
    notes: 'File names from the retail HOCKEY.EXE. Pictures are SHPI .FSH (locateshape); player sprites are GAMEART .REF; music is EA 1SN .ASF; art packs are .VIV. SPA is unk_117A9C, not the 94/95 updateanim table. No .KMS path.',
    pictures: files.fsh,
    qfs: files.qfs,
    viv: files.viv,
    songs: files.asf,
    banks: files.bnk,
    other: files.other
  };
  console.log('file', exePath, 'size', buf.length, 'sha1', sha1);
  if (sha1 !== SHA1) console.warn('SHA-1 differs from NHL96PC README', SHA1);
  console.log('FSH', files.fsh.length, 'ASF', files.asf.length, 'BNK', files.bnk.length, 'VIV', files.viv.length, 'QFS', files.qfs.length);
  if (!write) return;
  const dest = path.join(ROOT, 'data', 'pc96-files.json');
  fs.writeFileSync(dest, JSON.stringify(catalog, null, 2) + '\n');
  console.log('Wrote', dest);
}

main();
