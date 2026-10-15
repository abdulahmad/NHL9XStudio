/**
 * Extract SPA animation blobs from NHL 94 PC HOCKEY.EXE (gfxpak-era DOS).
 *
 * Layout matches updateanim / frames95pc.asm: nine little-endian words
 * (eight byte offsets into the script, then flags), then (frame, vblank)
 * pairs per direction; negative vblank ends a direction.
 *
 * Usage:
 *   node tools/extract-pc94-spa.js [path/to/HOCKEY.EXE]
 *
 * Writes a report to stdout; does not modify data/ unless --write is passed.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_EXE = path.join(__dirname, '..', 'EA-NHL-Tools', 'Sprite-Viewer', 'pc94', 'HOCKEY.EXE');
const MAX_FRAME = 875;
const MAX_STEPS_PER_DIR = 48;

function parseSpaBlock(buf, off) {
  if (off + 18 > buf.length) return null;
  const words = [];
  for (let i = 0; i < 600; i++) {
    const p = off + i * 2;
    if (p + 2 > buf.length) break;
    words.push(buf.readInt16LE(p));
  }
  if (words.length < 9) return null;
  const offs = words.slice(0, 8);
  const flags = words[8];
  if (flags < 0 || flags > 64) return null;
  const active = offs.filter((o) => o > 0);
  if (active.length < 4) return null;
  for (let i = 1; i < active.length; i++) {
    if (active[i] <= active[i - 1]) return null;
  }
  if (active[0] < 8 || active[0] > 200) return null;
  let endByte = 18;
  let steps = 0;
  let bad = 0;
  for (const byteOff of offs) {
    if (!byteOff) continue;
    if (byteOff >= words.length * 2) return null;
    let i = byteOff / 2;
    let n = 0;
    while (i + 1 < words.length) {
      const frame = words[i];
      const time = words[i + 1];
      if (frame < 0 || frame > MAX_FRAME || time === 0 || Math.abs(time) > 600) {
        bad++;
        break;
      }
      steps++;
      n++;
      endByte = Math.max(endByte, (i + 2) * 2);
      i += 2;
      if (time < 0) break;
      if (n > MAX_STEPS_PER_DIR) {
        bad++;
        break;
      }
    }
  }
  if (bad || steps < 8) return null;
  const byteLen = endByte;
  if (off + byteLen > buf.length) return null;
  return { off, flags, steps, byteLen, words: words.slice(0, byteLen / 2) };
}

function scanExe(buf) {
  const hits = [];
  for (let off = 0; off < buf.length - 20; off += 2) {
    const spa = parseSpaBlock(buf, off);
    if (spa) hits.push(spa);
  }
  const byOff = new Map();
  for (const h of hits) {
    const prev = byOff.get(h.off);
    if (!prev || h.steps > prev.steps) byOff.set(h.off, h);
  }
  return Array.from(byOff.values()).sort((a, b) => a.off - b.off);
}

function packClusters(blocks) {
  const clusters = [];
  let cur = [];
  for (const b of blocks) {
    if (!cur.length) {
      cur.push(b);
      continue;
    }
    const last = cur[cur.length - 1];
    const gap = b.off - (last.off + last.byteLen);
    if (gap >= 0 && gap <= 4) cur.push(b);
    else {
      if (cur.length >= 8) clusters.push(cur);
      cur = [b];
    }
  }
  if (cur.length >= 8) clusters.push(cur);
  return clusters.sort((a, b) => b.length - a.length);
}

function wordsToAsm(name, words) {
  const lines = [];
  lines.push(name + '\t= *-SPAList');
  const chunks = [];
  for (let i = 0; i < words.length; i++) {
    chunks.push(words[i]);
    if (chunks.length === 12) {
      lines.push('\tdc.w\t' + chunks.join(','));
      chunks.length = 0;
    }
  }
  if (chunks.length) lines.push('\tdc.w\t' + chunks.join(','));
  return lines.join('\n');
}

function main() {
  const write = process.argv.includes('--write');
  const exePath = process.argv.find((a) => a.endsWith('.EXE') || a.endsWith('.exe'))
    || (fs.existsSync(DEFAULT_EXE) ? DEFAULT_EXE : path.join('pc94', 'HOCKEY.EXE'));
  if (!fs.existsSync(exePath)) {
    console.error('HOCKEY.EXE not found:', exePath);
    process.exit(1);
  }
  const buf = fs.readFileSync(exePath);
  const blocks = scanExe(buf);
  const clusters = packClusters(blocks);
  console.log('file', exePath, 'size', buf.length);
  console.log('spa blocks', blocks.length, 'clusters', clusters.length);
  if (clusters[0]) {
    const c = clusters[0];
    console.log('largest cluster', c.length, 'at 0x' + c[0].off.toString(16), '– 0x' + (c[c.length - 1].off + c[c.length - 1].byteLen).toString(16));
    console.log('sample', c.slice(0, 5).map((b) => ({ off: '0x' + b.off.toString(16), steps: b.steps, flags: b.flags })));
  }
  if (!write || !clusters[0]) return;
  const genesisNames = fs.existsSync(path.join(__dirname, '..', 'data', 'frames94.asm'))
    ? require('../lib/parse-frames').parseFrames(
      fs.readFileSync(path.join(__dirname, '..', 'data', 'frames94.asm'), 'utf8')
    ).anims.map((a) => a.name)
    : [];
  const cluster = clusters[0];
  const out = [];
  out.push('; SPA scripts extracted from NHL 94 PC HOCKEY.EXE by tools/extract-pc94-spa.js');
  out.push('; Cluster at 0x' + cluster[0].off.toString(16) + ', ' + cluster.length + ' sequences.');
  out.push('');
  out.push('SPAList:');
  out.push('\tdc.w\t0');
  out.push('');
  cluster.forEach((b, i) => {
    const name = genesisNames[i] || ('SPAextra' + (i + 1));
    out.push(wordsToAsm(name, b.words));
    out.push('');
  });
  const dest = path.join(__dirname, '..', 'data', 'frames94pc.asm');
  const head = fs.readFileSync(dest, 'utf8').split(/^SPAList:/m)[0];
  fs.writeFileSync(dest, head + out.slice(3).join('\n'));
  console.log('Wrote', dest);
}

main();
