#!/usr/bin/env node
/**
 * Render NHL '92 end to end from the retail code: game call -> 68k driver ->
 * shared Z80 RAM -> Z80 driver -> YM2612 + SN76489 (lib/audio/nhl92-sound-chain.js).
 *   - one WAV per song (IDs 0-4) and per SFX (IDs 0-34), named by ID and name
 *   - a few songs with SFX on top
 * plus the YM register log for each, and a zip of the lot.
 *
 *   node tools/render-nhl92-sound-chain.js [outDir]          # default out/nhl92-sound-chain
 *   node tools/render-nhl92-sound-chain.js [outDir] --update # also rewrite the hash manifest
 *
 * Every song/SFX run's 68k log is checked against step 6's pins
 * (data/audio/nhl92-68k-driver.json). The manifest (data/audio/nhl92-sound-chain.json)
 * pins SHA-256 hashes of every WAV and YM log; test/nhl92-sound-chain.js re-renders a
 * subset and compares.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const chainApi = require('../lib/audio/nhl92-sound-chain');
const R = require('../lib/audio/nhl92-sound-chain-renders');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'data', 'audio', 'nhl92-sound-chain.json');
const STEP6 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'audio', 'nhl92-68k-driver.json'), 'utf8'));

const GROUP = { song: 'songs', sfx: 'sfx', 'sfx-music-off': 'sfxMusicOff', mix: 'mixes' };

async function main() {
  const args = process.argv.slice(2);
  const update = args.includes('--update');
  const outDir = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'out', 'nhl92-sound-chain'));
  for (const d of ['songs', 'sfx', 'mixes']) fs.mkdirSync(path.join(outDir, d), { recursive: true });
  const src = R.sources();
  const manifest = {
    note: 'SHA-256 of WAV/YM-log output from tools/render-nhl92-sound-chain.js. Regenerate with --update only when the chain intentionally changes.',
    sampleRate: chainApi.SAMPLE_RATE,
    frameTstates: chainApi.FRAME_TSTATES,
    songs: [],
    sfx: [],
    sfxMusicOff: [],
    mixes: []
  };
  const failures = [];
  const t0 = Date.now();
  for (const item of R.renders(src)) {
    const r = await R.render(item, src);
    const dir = item.kind === 'song' ? 'songs' : item.kind === 'mix' ? 'mixes' : 'sfx';
    fs.writeFileSync(path.join(outDir, dir, item.file + '.wav'), r.wav);
    fs.writeFileSync(path.join(outDir, dir, item.file + '.ymlog.txt'), r.log);
    const entry = {
      id: item.id,
      frames: item.plan.frames,
      file: dir + '/' + item.file + '.wav',
      ymWrites: r.chain.ymWrites,
      psgWrites: r.chain.psgWrites,
      peak: r.peak,
      wav: r.wavSha256,
      log: r.logSha256
    };
    if (item.kind === 'mix') {
      entry.song = item.plan.id;
      entry.sfxAt = item.plan.sfxAt;
      entry.note = item.note;
    } else if (item.kind === 'sfx-music-off') {
      // Not a step 6 run (song + p_turnoff prelude), so there is no step 6 68k pin to compare.
      entry.prelude = 'song 0 init, p_turnoff, then sfx';
    } else {
      const pin = (item.kind === 'song' ? STEP6.songs : STEP6.sfx).find((p) => p.id === item.id);
      entry.m68kMatchesStep6 = !!pin && pin.sha256 === r.m68kSha256;
      if (!entry.m68kMatchesStep6) failures.push(item.file + ': 68k log differs from step 6');
    }
    if (r.chain.psgWrites) failures.push(item.file + ': PSG written');
    manifest[GROUP[item.kind]].push(entry);
    console.log(item.file, 'ym', r.chain.ymWrites, 'peak', r.peak, r.wavSha256.slice(0, 12),
      entry.m68kMatchesStep6 === false ? '68k DIFFERS' : '');
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const zip = path.join(path.dirname(outDir), path.basename(outDir) + '.zip');
  if (fs.existsSync(zip)) fs.unlinkSync(zip);
  execFileSync('zip', ['-qr', zip, path.basename(outDir)], { cwd: path.dirname(outDir) });
  console.log('rendered in', ((Date.now() - t0) / 1000).toFixed(1), 's; WAVs in', outDir, '; zip', zip);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  if (update) {
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log('wrote', path.relative(ROOT, MANIFEST));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
