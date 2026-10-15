#!/usr/bin/env node
/**
 * Render the NHL '92 chip tests through the retail Z80 driver + real YM2612:
 *   - one WAV per retail patch at Z80 $02A5 (22), a C-major scale on channel 1
 *   - one WAV per DAC SFX the 68k can request
 * plus the YM register log for each.
 *
 *   node tools/render-nhl92-chip-tests.js [outDir]          # default out/nhl92-chip-tests
 *   node tools/render-nhl92-chip-tests.js [outDir] --update # also rewrite the hash manifest
 *
 * The manifest (data/audio/nhl92-chip-tests.json) pins SHA-256 hashes of every
 * WAV and log; test/nhl92-z80-audio.js re-renders and compares against it.
 */
const fs = require('fs');
const path = require('path');
const audio = require('../lib/audio/nhl92-z80-audio');
const renders = require('../lib/audio/nhl92-chip-renders');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'data', 'audio', 'nhl92-chip-tests.json');

async function main() {
  const args = process.argv.slice(2);
  const update = args.includes('--update');
  const outDir = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'out', 'nhl92-chip-tests'));
  fs.mkdirSync(path.join(outDir, 'patches'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'sfx'), { recursive: true });
  const src = renders.sources();
  const manifest = {
    note: 'SHA-256 of WAV/log output from tools/render-nhl92-chip-tests.js. Regenerate with --update only when the chain intentionally changes.',
    sampleRate: audio.SAMPLE_RATE,
    patches: [],
    sfx: []
  };

  for (let i = 0; i < audio.PATCH_COUNT; i++) {
    const r = await renders.renderPatch(i, src);
    const name = renders.patchName(i);
    fs.writeFileSync(path.join(outDir, 'patches', name + '.wav'), r.wav);
    fs.writeFileSync(path.join(outDir, 'patches', name + '.ymlog.txt'), r.log);
    manifest.patches.push({ index: i, z80: '$' + audio.patchAddress(i).toString(16).toUpperCase(), file: name + '.wav', wav: r.wavSha256, log: r.logSha256 });
    console.log(name, '$' + audio.patchAddress(i).toString(16).toUpperCase(), r.wavSha256.slice(0, 12));
  }
  for (const entry of audio.DAC_SFX) {
    const r = await renders.renderSfx(entry, src);
    const name = renders.sfxName(entry);
    fs.writeFileSync(path.join(outDir, 'sfx', name + '.wav'), r.wav);
    fs.writeFileSync(path.join(outDir, 'sfx', name + '.ymlog.txt'), r.log);
    manifest.sfx.push({ rom: '$' + entry.rom.toString(16).toUpperCase(), name: entry.name, file: name + '.wav', wav: r.wavSha256, log: r.logSha256 });
    console.log(name, r.wavSha256.slice(0, 12));
  }
  if (update) {
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log('wrote', path.relative(ROOT, MANIFEST));
  }
  console.log('WAVs in', outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
