#!/usr/bin/env node
/**
 * Extract the NHL '94 (SNES) sound data needed for playback into data/audio/nhl94s-sound.json.
 *
 *   node tools/extract-nhl94s-sound.js <NHL94SNES checkout> [out.json]
 *   node tools/extract-nhl94s-sound.js <NHL94SNES checkout> --check     # compare the committed JSON with a fresh extract
 *
 * The NHL94SNES disassembly names every song, sample and table and says what each is; the ROM (lst/nhl94snes.sfc in
 * that checkout, SHA-1 checked) has the bytes. Labels and addresses come from docs/name_map.csv, byte counts from
 * the data files in src/data (db/dw/dd/incbin sizes), and every numeric db/dw in those files is compared with the
 * ROM bytes it was extracted from. Only these slices are kept (nothing else from the ROM):
 *   songs            the TitleSong/MenuSong/PlayoffSong and the 80 organ songs
 *   samples          the BRR samples (loop point, length, blocks), the in-game, title/menu, intro and streamed sets
 *   sfx tables       the 48-byte sound entries of the in-game, menu and intro sets, with the sample lists
 *   PitchTable, VolumeCurve, TeamSongs, DefaultSongs, StreamSfxSounds, team abbreviations
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROM_SHA1 = '10dcd21be9c5542e82b0b94473bf5ff569b36cf5';
const OUT = path.join(__dirname, '..', 'data', 'audio', 'nhl94s-sound.json');

const hex = (s) => parseInt(String(s).replace('$', ''), 16);

/** Bytes of a data file's items, in order, with numeric values (null for expressions); labels start a new block. */
function asmItems(text) {
  const items = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/;.*$/, '');
    const m = /^\s*(?:\.?\w+:)?\s*(db|dw|dd|incbin)\s+(.*)$/.exec(line);
    if (!m) continue;
    const kind = m[1];
    if (kind === 'incbin') {
      const r = /"[^"]*":(\d+)\.\.(\d+)/.exec(m[2]);
      if (!r) throw new Error('incbin without a range: ' + line);
      items.push({ kind, size: Number(r[2]) - Number(r[1]) });
      continue;
    }
    // split on commas outside quotes
    const parts = [];
    let cur = '';
    let q = false;
    for (const ch of m[2]) {
      if (ch === '"') q = !q;
      if (ch === ',' && !q) { parts.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    for (const p of parts) {
      if (p[0] === '"') {
        for (const ch of p.slice(1, -1)) items.push({ kind: 'db', size: 1, value: ch.charCodeAt(0) });
      } else {
        const n = kind === 'db' ? 1 : kind === 'dw' ? 2 : 4;
        items.push({ kind, size: n, value: /^\$[0-9A-Fa-f]+$/.test(p) ? hex(p) : null, expr: p });
      }
    }
  }
  return items;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const dir = args.filter((a) => !a.startsWith('--'))[0];
  const out = args.filter((a) => !a.startsWith('--'))[1] || OUT;
  if (!dir) { console.error('usage: extract-nhl94s-sound.js <NHL94SNES dir> [out.json | --check]'); process.exit(2); }
  const rom = fs.readFileSync(path.join(dir, 'lst', 'nhl94snes.sfc'));
  const sha = crypto.createHash('sha1').update(rom).digest('hex');
  if (sha !== ROM_SHA1) throw new Error('ROM SHA-1 ' + sha + ' is not the expected NHL \'94 SNES ' + ROM_SHA1);
  const csv = fs.readFileSync(path.join(dir, 'docs', 'name_map.csv'), 'utf8').split(/\r?\n/).slice(1).filter(Boolean);
  const addr = {};
  const file = {};
  for (const line of csv) {
    const f = line.match(/^(\$[0-9A-Fa-f]+),([^,]+),/);
    if (f) addr[f[2]] = hex(f[1]);
    const last = line.split(',').pop();
    if (f && last.startsWith('src/')) file[f[2]] = last;
  }
  const off = (a) => ((a >> 16) & 0x7f) * 0x8000 + (a & 0x7fff);
  const rd = (label, n) => { const o = off(addr[label]); return rom.subarray(o, o + n); };
  const sizeOf = (label) => {
    const text = fs.readFileSync(path.join(dir, file[label]), 'utf8');
    // the data of this label only: from its label line to the next top-level label
    const at = text.search(new RegExp('^' + label + ':', 'm'));
    if (at < 0) throw new Error('label ' + label + ' not found in ' + file[label]);
    const rest = text.slice(at).split(/\r?\n/);
    const lines = [rest[0]];
    for (const l of rest.slice(1)) { if (/^\w+:/.test(l)) break; lines.push(l); }
    return asmItems(lines.join('\n').replace(/^\w+:/, ''));
  };
  const verified = { songs: 0, samples: 0, tables: 0, bytes: 0 };
  /** The ROM bytes of a label, size from the data file, numeric items compared with the ROM. */
  const slice = (label, kind) => {
    const items = sizeOf(label);
    const size = items.reduce((n, i) => n + i.size, 0);
    const bytes = rd(label, size);
    let at = 0;
    for (const it of items) {
      if (it.value != null) {
        let v = 0;
        for (let k = 0; k < it.size; k++) v |= bytes[at + k] << (8 * k);
        if ((v >>> 0) !== it.value) throw new Error(label + ': ROM byte mismatch at +' + at + ' (' + v.toString(16) + ' vs ' + it.value.toString(16) + ')');
      }
      at += it.size;
    }
    verified[kind] += 1;
    verified.bytes += size;
    return Buffer.from(bytes);
  };
  const tableNames = (label, size) => {
    const b = rd(label, size);
    const names = [];
    const byAddr = {};
    for (const k of Object.keys(addr)) byAddr[addr[k]] = k;
    for (let i = 0; i < size; i += 4) {
      const a = b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
      names.push(b.readUInt32LE(i) === 0xffffffff ? null : byAddr[a]);
      if (names[names.length - 1] === undefined) throw new Error(label + ': pointer $' + a.toString(16) + ' has no name');
    }
    return names;
  };
  const wordList = (label, count) => { const b = rd(label, count * 2); return Array.from({ length: count }, (_, i) => b[2 * i] | (b[2 * i + 1] << 8)); };
  const tableBytes = (label) => sizeOf(label).reduce((n, i) => n + i.size, 0);

  const pack = {
    source: {
      game: "NHL '94 (Super Nintendo)",
      rom: { sha1: ROM_SHA1, size: rom.length },
      note: 'Extracted by tools/extract-nhl94s-sound.js from the NHL94SNES disassembly and its ROM. Only the data needed to play the songs.'
    }
  };
  pack.pitchTable = wordList('PitchTable', 128);
  pack.volumeCurve = Array.from(rd('VolumeCurve', 128));
  verified.tables += 2;

  const sets = {};
  const sfx = (label) => {
    const size = tableBytes(label);
    const b = rd(label, size);
    const first = b[0] | (b[1] << 8);
    const count = first / 2;
    const entries = [];
    for (let i = 0; i < count; i++) {
      const o = b[2 * i] | (b[2 * i + 1] << 8);
      entries.push(Array.from(b.subarray(o, o + 48)));
    }
    verified.tables += 1;
    return entries;
  };
  const list = (label) => { const names = tableNames(label, tableBytes(label)); verified.tables += 1; return names; };
  sets.game = { sampleList: list('GameSampleList'), sounds: sfx('GameSfxTable') };
  sets.title = { sampleList: list('TitleSampleList'), soundsFrom: 'menu' };
  sets.menu = { sampleList: list('MenuSampleList'), sounds: sfx('MenuSfxTable') };
  sets.intro = { sampleList: list('IntroSampleList'), sounds: sfx('IntroSfxTable') };
  pack.sets = sets;
  pack.streamSounds = wordList('StreamSfxSounds', 6);

  const fileNames = fs.readdirSync(path.join(dir, 'src', 'data', 'sound')).map((f) => f.replace(/\.asm$/, ''));
  const samples = {};
  for (const n of fileNames.filter((f) => /^(Sample|StreamSample)/.test(f))) {
    const raw = slice(n, 'samples');
    const loop = (raw[0] << 8) | raw[1];
    const len = (raw[2] << 8) | raw[3];
    if (len % 9 || loop % 9 || loop > len) throw new Error(n + ': bad sample header');
    samples[n] = { loop, length: len, brr: raw.subarray(4, 4 + len).toString('base64') };
    const trailer = Array.from(raw.subarray(4 + len));
    if (trailer.some((v) => v !== 0xff)) throw new Error(n + ': unexpected bytes after the BRR data');
  }
  pack.samples = samples;
  const songs = {};
  for (const n of fileNames.filter((f) => /Song$|^Song/.test(f))) songs[n] = slice(n, 'songs').toString('base64');
  pack.songs = songs;

  const teamBytes = tableBytes('TeamSongs');
  pack.teamSongs = tableNames('TeamSongs', teamBytes);
  pack.defaultSongs = tableNames('DefaultSongs', tableBytes('DefaultSongs'));
  verified.tables += 2;
  const names = fs.readFileSync(path.join(dir, 'src', 'data', 'text', 'TeamPlaceNames.asm'), 'utf8');
  pack.teams = [...names.split('\n').filter((l) => /^\s*dw\s+\./.test(l)).join(',').matchAll(/\.(\w+)/g)].map((m) => m[1]);
  if (pack.teamSongs.length !== pack.teams.length * 6) throw new Error('TeamSongs has ' + pack.teamSongs.length + ' entries for ' + pack.teams.length + ' teams');
  for (const s of [...pack.teamSongs, ...pack.defaultSongs]) if (s && !songs[s]) throw new Error('table song ' + s + ' not extracted');
  for (const set of Object.values(sets)) for (const s of set.sampleList) if (!samples[s]) throw new Error('listed sample ' + s + ' not extracted');

  const text = JSON.stringify(pack, null, 1) + '\n';
  if (check) {
    const same = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8') === text;
    console.log(same ? 'data/audio/nhl94s-sound.json is up to date' : 'data/audio/nhl94s-sound.json differs from a fresh extract');
    process.exit(same ? 0 : 1);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  console.log('wrote ' + path.relative(process.cwd(), out) + ': ' + Object.keys(songs).length + ' songs, ' + Object.keys(samples).length + ' samples, '
    + verified.tables + ' tables; ' + verified.bytes + ' bytes cross-checked against the data files (' + text.length + ' chars)');
}

main();
