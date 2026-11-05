#!/usr/bin/env node
/**
 * Extract SPA animation blobs from NHL 96 PC HOCKEY.EXE.
 *
 * 94/95 PC used a flags-word + eight direction offsets (`updateanim`).
 * 96 PC does not. Player/goalie/fight/cup sequences live in dseg04
 * `unk_117A9C` (sub_4B38C frame pick, sub_4A047 ticker):
 *
 *   word 0: flags
 *     bit 0  = loop (puck / extra objects, sub_493D4)
 *     bit 1  = no facing (always direction 0)
 *     bit 2  = two facings (0 or 1) instead of eight
 *     bit 4  = loop (skaters, sub_4A047)
 *   word 1: pair count
 *   then count × (frame, time) words. Negative time ends the sequence.
 *   Facing 0–7 is added to the stored frame (unless bit 1/2).
 *
 * Frames in the EXE are 0-based indices into the concatenated SHPI
 * pictures of GAMEART total.ref, then fight.ref (cup.ref reuses the
 * fight slot). Studio stores them 1-based so they line up with Genesis.
 *
 * Usage:
 *   node tools/extract-pc96-spa.js [path/to/HOCKEY.EXE]
 *   node tools/extract-pc96-spa.js --write [path/to/HOCKEY.EXE]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SHA1 = '426fb8c0c80088c6a2c56a9dac50509cb9c24540';
const VIRT_TABLE = 0x117A9C;
const VIRT_OBJ4 = 0x110000;
const MAX_FRAME = 0xED9;
const DEFAULTS = [
  path.join(ROOT, '..', 'NHL96PC', 'lst', 'HOCKEY.EXE'),
  path.join(ROOT, '..', 'nhl96pc', 'lst', 'HOCKEY.EXE'),
  '/agent/repos/NHL96PC/lst/HOCKEY.EXE',
  path.join(ROOT, 'pc96', 'HOCKEY.EXE')
];

function u16(buf, off) {
  return buf[off] | (buf[off + 1] << 8);
}
function s16(buf, off) {
  const v = u16(buf, off);
  return v & 0x8000 ? v - 0x10000 : v;
}

function findTable(buf) {
  const marker = Buffer.from('\x01\x01\x01\x00PATH\x00rb\x00HGwt');
  const at = buf.indexOf(marker);
  if (at < 0) throw new Error('NHL 96 PC data object (PATH/HGwt) not found');
  return at + (VIRT_TABLE - VIRT_OBJ4);
}

function parseRecord(buf, table, spa) {
  const off = table + spa * 2;
  if (off + 8 > buf.length) return null;
  const flags = u16(buf, off);
  const count = u16(buf, off + 2);
  if (count < 1 || count > 32) return null;
  if (flags > 0x3F) return null;
  const pairs = [];
  for (let i = 0; i < count; i++) {
    const p = off + 4 + i * 4;
    if (p + 4 > buf.length) return null;
    const frame = s16(buf, p);
    const time = s16(buf, p + 2);
    if (frame < 0 || frame > MAX_FRAME) return null;
    if (time === 0) return null;
    pairs.push({ frame, time });
  }
  if (pairs[pairs.length - 1].time >= 0) return null;
  return {
    spa,
    off: table + spa * 2,
    flags,
    count,
    pairs,
    size: 2 + count * 2,
    loop: (flags & 0x11) !== 0,
    noDir: (flags & 2) !== 0,
    twoDir: (flags & 4) !== 0
  };
}

function extractRecords(buf, table) {
  const cands = [];
  for (let spa = 0; spa < 0xC00; spa++) {
    const rec = parseRecord(buf, table, spa);
    if (rec) cands.push(rec);
  }
  const taken = [];
  const used = new Set();
  for (const rec of cands) {
    let ok = true;
    for (let i = 0; i < rec.size; i++) {
      if (used.has(rec.spa + i)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    taken.push(rec);
    for (let i = 0; i < rec.size; i++) used.add(rec.spa + i);
  }
  return taken;
}

function dirAdd(rec, d) {
  if (rec.noDir) return 0;
  if (rec.twoDir) return d < 4 ? 0 : 1;
  return d;
}

function dirsOf(rec) {
  const dirs = [];
  for (let d = 0; d < 8; d++) {
    const add = dirAdd(rec, d);
    dirs.push(rec.pairs.map((p) => ({ frame: p.frame + add, time: p.time })));
  }
  return dirs;
}

function toGenesisWords(rec) {
  const flags = rec.loop ? 1 : 0;
  const payload = [];
  const dirOff = [];
  const seen = new Map();
  const dirs = dirsOf(rec);
  for (let d = 0; d < 8; d++) {
    const key = dirs[d].map((s) => s.frame + ':' + s.time).join(',');
    if (seen.has(key)) {
      dirOff[d] = seen.get(key);
      continue;
    }
    const off = 18 + payload.length * 2;
    seen.set(key, off);
    dirOff[d] = off;
    for (const s of dirs[d]) payload.push(s.frame + 1, s.time);
  }
  return dirOff.concat([flags], payload);
}

function blurbOf(rec) {
  const stride = rec.count >= 2 ? rec.pairs[1].frame - rec.pairs[0].frame : 0;
  const bits = [];
  if (rec.loop) bits.push('loops');
  if (rec.noDir) bits.push('no facing');
  if (rec.twoDir) bits.push('two facings');
  let kind = rec.count + ' step';
  if (rec.count === 1) kind = 'held pose';
  else if (rec.count === 8 && stride === 8) kind = '8-facing cycle';
  else if (stride === 8) kind = 'facing-stride cycle';
  const extra = bits.length ? ', ' + bits.join(', ') : '';
  return kind + extra + ', EXE spa 0x' + rec.spa.toString(16);
}

function nameSpas(recs) {
  return recs.map((rec) => Object.assign({
    name: 'SPA' + rec.spa.toString(16).toUpperCase().padStart(4, '0'),
    blurb: blurbOf(rec)
  }, rec));
}

function wordsToAsm(name, words, comment) {
  const lines = [name + '\t=\t*-SPAlist' + (comment ? '\t; ' + comment : '')];
  for (let i = 0; i < words.length; i += 12) {
    lines.push('\tdc.w\t' + words.slice(i, i + 12).join(','));
  }
  return lines.join('\n');
}

function spfBlocks(maxFrame) {
  return [{
    name: 'SPFskaters',
    start: 1,
    comment: 'concatenated GAMEART.VIV total.ref then fight.ref (0-based 0–' + maxFrame + ')'
  }];
}

function findExe(argv) {
  const arg = argv.find((a) => /\.exe$/i.test(a) && !a.startsWith('-'));
  if (arg) return arg;
  return DEFAULTS.find((p) => fs.existsSync(p)) || null;
}

function main() {
  const write = process.argv.includes('--write');
  const exePath = findExe(process.argv);
  if (!exePath) {
    console.error('HOCKEY.EXE not found');
    process.exit(1);
  }
  const buf = fs.readFileSync(exePath);
  const table = findTable(buf);
  const recs = nameSpas(extractRecords(buf, table));
  let maxFrame = 0;
  for (const rec of recs) {
    for (let d = 0; d < 8; d++) {
      const add = dirAdd(rec, d);
      for (const p of rec.pairs) maxFrame = Math.max(maxFrame, p.frame + add);
    }
  }
  const spfs = recs.length ? spfBlocks(maxFrame) : [];
  console.log('file', exePath, 'size', buf.length);
  console.log('SPA table file 0x' + table.toString(16), 'virt 0x' + VIRT_TABLE.toString(16), 'count', recs.length);
  if (recs.length) {
    console.log('first', recs[0].name, 'spa', recs[0].spa, 'd0', recs[0].pairs[0].frame + 1, 'loop', recs[0].loop);
    console.log('max 0-based frame', maxFrame, 'SPFlimit', maxFrame + 2);
  }
  if (!write) return;
  if (!recs.length) {
    console.error('no SPA scripts found');
    process.exit(1);
  }
  const dest = path.join(ROOT, 'data', 'frames96pc.asm');
  const out = [
    '; NHL 96 PC sprite ranges and SPA scripts.',
    '; The retail HOCKEY.EXE (NHL96PC SHA-1 ' + SHA1 + ')',
    '; has no 94/95-style updateanim table. Sequences are unk_117A9C',
    '; (file offset 0x' + table.toString(16) + ', virt 0x' + VIRT_TABLE.toString(16) + '):',
    '; flags, pair count, then (frame, time) pairs. Facing 0–7 is added to the',
    '; stored frame (bit 1 = no facing, bit 2 = two facings). Bit 0 / bit 4 loop.',
    '; Frames are 0-based indices into GAMEART.VIV total.ref then fight.ref',
    '; (cup.ref reloads the fight slot). Symbols here are one higher, matching Genesis.',
    '; Extracted by tools/extract-pc96-spa.js (' + recs.length + ' sequences).',
    ''
  ];
  for (const spf of spfs) {
    out.push(spf.name + '\t=\t' + spf.start + '\t; ' + spf.comment);
  }
  out.push('SPFlimit\t=\t' + (maxFrame + 2));
  out.push('');
  out.push('SPAlist');
  out.push('\tdc.w\t0');
  out.push('');
  for (const rec of recs) {
    out.push(wordsToAsm(rec.name, toGenesisWords(rec), rec.blurb + ', flags 0x' + rec.flags.toString(16)));
    out.push('');
  }
  fs.writeFileSync(dest, out.join('\n') + '\n');
  console.log('Wrote', dest);
}

main();
