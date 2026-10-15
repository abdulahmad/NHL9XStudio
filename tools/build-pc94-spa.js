/**
 * Build SPA section for data/frames94pc.asm from NHL 95 PC scripts that fit
 * the 876-frame player sheet. NHL 94 PC HOCKEY.EXE uses different packed bytes
 * for some sequences; this is an interim catalog so the SPA tab is usable until
 * tools/extract-pc94-spa.js can emit retail-accurate tables.
 *
 * Usage: node tools/build-pc94-spa.js
 */
const fs = require('fs');
const path = require('path');
const { parseFrames } = require('../lib/parse-frames');

const ROOT = path.join(__dirname, '..');
const PC94 = path.join(ROOT, 'data', 'frames94pc.asm');
const PC95 = path.join(ROOT, 'data', 'frames95pc.asm');
const MAX_FRAME = 875;
const DROP = new Set([
  'SPAcelebrate', 'SPAcrosscheck', 'SPAboards', 'SPAgoalie95', 'SPAshotblock',
  'SPAref95', 'SPAbenchcheckl', 'SPAbenchcheckr',
  'SPAboardfront', 'SPAboardback', 'SPAboardleft', 'SPAboardright'
]);

function animWords(anim) {
  const byOff = new Map();
  let maxWord = 9;
  for (const dir of anim.directions) {
    if (dir.unused) continue;
    const chunk = [];
    for (const step of dir.steps) chunk.push(step.frame, step.rawTime);
    byOff.set(dir.offset / 2, chunk);
    maxWord = Math.max(maxWord, dir.offset / 2 + chunk.length);
  }
  const header = new Array(9).fill(0);
  for (const dir of anim.directions) {
    if (!dir.unused) header[dir.id] = dir.offset;
  }
  header[8] = anim.flags;
  const words = new Array(maxWord).fill(0);
  for (let i = 0; i < 9; i++) words[i] = header[i];
  for (const [off, chunk] of byOff.entries()) {
    for (let i = 0; i < chunk.length; i++) words[off + i] = chunk[i];
  }
  return words;
}

function wordsToAsm(name, words) {
  const lines = [name + '\t= *-SPAList'];
  for (let i = 0; i < words.length; i += 12) {
    const slice = words.slice(i, i + 12);
    lines.push('\tdc.w\t' + slice.join(','));
  }
  return lines.join('\n');
}

function maxFrame(anim) {
  let max = 0;
  for (const dir of anim.directions) {
    for (const step of dir.steps) if (step.frame > max) max = step.frame;
  }
  return max;
}

function main() {
  const spf = fs.readFileSync(PC94, 'utf8').split(/^SPAList:/im)[0].trimEnd();
  const pc95 = parseFrames(fs.readFileSync(PC95, 'utf8'));
  const picked = pc95.anims.filter((anim) => {
    if (DROP.has(anim.name)) return false;
    return maxFrame(anim) <= MAX_FRAME;
  });
  const out = [
    spf,
    '',
    '; SPA scripts: interim subset from frames95pc.asm (frames 0–875 only).',
    '; Retail NHL 94 PC HOCKEY.EXE packs differ; replace via tools/extract-pc94-spa.js.',
    '',
    'SPAList:',
    '\tdc.w\t0',
    ''
  ];
  for (const anim of picked) {
    out.push(wordsToAsm(anim.name, animWords(anim)));
    out.push('');
  }
  fs.writeFileSync(PC94, out.join('\n') + '\n');
  console.log('Wrote', PC94, 'with', picked.length, 'SPA entries');
}

main();
