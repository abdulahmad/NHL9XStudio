/**
 * Extract SPA animation blobs from NHL 94 PC HOCKEY.EXE.
 *
 * Layout is the PC updateanim table (same as 95 PC SPAtab, not Genesis):
 *   word 0: flags (bit 15 = loop; bits 0–14 = dir 0 word-offset into the payload)
 *   words 1–7: dir 1–7 word-offsets into the payload
 *   payload at +16: (frame, time) pairs, negative time ends a direction
 *
 * Frames in the EXE are 0-based. data/frames94pc.asm stores them 1-based so
 * they line up with Genesis and the viewer (same as frames95pc.asm).
 *
 * Usage:
 *   node tools/extract-pc94-spa.js [path/to/HOCKEY.EXE]
 *   node tools/extract-pc94-spa.js --write [path/to/HOCKEY.EXE]
 */
const fs = require('fs');
const path = require('path');
const { parseFrames } = require('../lib/parse-frames');

const ROOT = path.join(__dirname, '..');
const START = 0x358A4;
const MAX_FRAME = 875;
const DEFAULTS = [
  path.join(ROOT, 'EA-NHL-Tools', 'Sprite-Viewer', 'pc94', 'HOCKEY.EXE'),
  path.join(ROOT, 'pc94', 'HOCKEY.EXE'),
  '/tmp/nhl94pc-src/lst/HOCKEY.EXE',
  '/tmp/ea-nhl-tools/Sprite-Viewer/pc94/HOCKEY.EXE'
];

function u16(buf, off) {
  return buf[off] | (buf[off + 1] << 8);
}
function s16(buf, off) {
  const v = u16(buf, off);
  return v & 0x8000 ? v - 0x10000 : v;
}

function parsePcSpa(buf, off) {
  if (off + 16 > buf.length) return null;
  const flags = u16(buf, off);
  const loop = (flags & 0x8000) !== 0;
  const offs = [flags & 0x7fff];
  for (let d = 1; d < 8; d++) offs.push(u16(buf, off + d * 2));
  for (let d = 0; d < 8; d++) if (offs[d] > 4000) return null;
  const dirs = [];
  let endByte = 16;
  let steps = 0;
  for (let d = 0; d < 8; d++) {
    const at = off + offs[d] * 2 + 16;
    if (at + 4 > buf.length) return null;
    const seq = [];
    let p = at;
    let n = 0;
    while (p + 3 < buf.length && n < 64) {
      const frame = s16(buf, p);
      const time = s16(buf, p + 2);
      if (frame < 0 || frame > MAX_FRAME || time === 0) return null;
      seq.push({ frame, time });
      steps += 1;
      n += 1;
      endByte = Math.max(endByte, p + 4 - off);
      p += 4;
      if (time < 0) break;
    }
    if (!seq.length || seq[seq.length - 1].time >= 0) return null;
    dirs.push(seq);
  }
  return { off, flags, loop, offs, dirs, steps, endByte };
}

function walkSpas(buf, start) {
  const spas = [];
  let off = start;
  while (off + 18 < buf.length) {
    const spa = parsePcSpa(buf, off);
    if (!spa) break;
    spas.push(spa);
    off += spa.endByte;
    if (off & 1) off += 1;
  }
  return spas;
}

function firstKey(spa) {
  return spa.dirs.map((d) => d[0].frame + 1).join(',');
}

function d0Key(spa) {
  return String(spa.dirs[0][0].frame + 1);
}

function maxFrameOf(anim) {
  let max = 0;
  for (const dir of anim.directions) {
    for (const step of dir.steps) if (step.frame > max) max = step.frame;
  }
  return max;
}

function animFirstKey(anim) {
  return anim.directions.map((d) => (d.unused || !d.steps.length ? '' : d.steps[0].frame)).join(',');
}

function nameSpas(spas) {
  const pc95 = parseFrames(fs.readFileSync(path.join(ROOT, 'data', 'frames95pc.asm'), 'utf8'));
  const gen94 = parseFrames(fs.readFileSync(path.join(ROOT, 'data', 'frames94.asm'), 'utf8'));
  const pool = [];
  const seen = new Set();
  for (const anim of [...pc95.anims, ...gen94.anims]) {
    if (maxFrameOf(anim) > MAX_FRAME + 1) continue;
    const k = anim.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    pool.push(anim);
  }
  const byFirst = new Map();
  const byD0 = new Map();
  for (const anim of pool) {
    const fk = animFirstKey(anim);
    if (fk && !byFirst.has(fk)) byFirst.set(fk, anim.name);
    const d0 = anim.directions[0] && anim.directions[0].steps[0] && anim.directions[0].steps[0].frame;
    if (d0 && !byD0.has(String(d0))) byD0.set(String(d0), anim.name);
  }
  const used = new Set();
  const leftovers = pool.map((a) => a.name);
  return spas.map((spa, i) => {
    const exact = byFirst.get(firstKey(spa));
    const d0 = byD0.get(d0Key(spa));
    let name = null;
    if (exact && !used.has(exact.toLowerCase())) name = exact;
    else if (d0 && !used.has(d0.toLowerCase())) name = d0;
    else {
      while (leftovers.length) {
        const n = leftovers.shift();
        if (!used.has(n.toLowerCase())) {
          name = n;
          break;
        }
      }
    }
    if (!name) name = 'SPAextra' + (i + 1);
    used.add(name.toLowerCase());
    return Object.assign({ name }, spa);
  });
}

function toGenesisWords(spa) {
  const flags = spa.loop ? 1 : 0;
  const payload = [];
  const dirOff = [];
  const seen = new Map();
  for (let d = 0; d < 8; d++) {
    const key = spa.dirs[d].map((s) => s.frame + ':' + s.time).join(',');
    if (seen.has(key)) {
      dirOff[d] = seen.get(key);
      continue;
    }
    const off = 18 + payload.length * 2;
    seen.set(key, off);
    dirOff[d] = off;
    for (const s of spa.dirs[d]) {
      payload.push(s.frame + 1, s.time);
    }
  }
  return dirOff.concat([flags], payload);
}

function wordsToAsm(name, words) {
  const lines = [name + '\t= *-SPAList'];
  for (let i = 0; i < words.length; i += 12) {
    lines.push('\tdc.w\t' + words.slice(i, i + 12).join(','));
  }
  return lines.join('\n');
}

function findExe(argv) {
  const arg = argv.find((a) => a.endsWith('.EXE') || a.endsWith('.exe'));
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
  const spas = nameSpas(walkSpas(buf, START));
  console.log('file', exePath, 'size', buf.length);
  console.log('SPA start 0x' + START.toString(16), 'count', spas.length);
  if (spas.length) {
    const last = spas[spas.length - 1];
    console.log('range 0x' + spas[0].off.toString(16), '– 0x' + (last.off + last.endByte).toString(16));
    console.log('first', spas[0].name, 'd0', spas[0].dirs[0][0].frame + 1, 'loop', spas[0].loop);
  }
  if (!write) return;
  if (!spas.length) {
    console.error('no SPA scripts found');
    process.exit(1);
  }
  const dest = path.join(ROOT, 'data', 'frames94pc.asm');
  const head = fs.readFileSync(dest, 'utf8').split(/^SPAList:/m)[0]
    .replace(/; SPA names and HOCKEY\.EXE offsets are not vendored yet \(GAP-8\)\.\n/, '')
    .replace(/; SPA scripts:[\s\S]*$/m, '')
    .trimEnd();
  const out = [
    head,
    '',
    '; SPA scripts extracted from NHL 94 PC HOCKEY.EXE by tools/extract-pc94-spa.js',
    '; PC updateanim table at file offset 0x' + START.toString(16) + ' (' + spas.length + ' sequences).',
    '; Stored frame numbers are 0-based in the EXE; symbols here are one higher, matching Genesis.',
    '',
    'SPAList:',
    '\tdc.w\t0',
    ''
  ];
  for (const spa of spas) {
    out.push(wordsToAsm(spa.name, toGenesisWords(spa)));
    out.push('');
  }
  fs.writeFileSync(dest, out.join('\n') + '\n');
  console.log('Wrote', dest);
}

main();
