/**
 * NHL 95 (Genesis) retail sound chain (nhl95-68k-harness.js + bundled slice).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Chain = require('../lib/audio/nhl92-sound-chain');

const G = {
  label: 'NHL 95',
  driver: require('../lib/audio/nhl95-68k-harness'),
  slice: 'nhl95-sound-slice.bin',
  start: 0xaf44,
  size: 0x7a000,
  catalog: 'nhl95.json',
  sounds: 78,
  pcmSong: 0x35,
  pins: ['song 32', 'song 35', 'sfx 0', 'sfx b', 'sfx 1c']
};
const PIN_FILE = path.join(__dirname, '..', 'data', 'audio', 'nhl95-sound-chain.json');
const printPins = !!process.env.NHL95_PIN_PRINT;
const pinned = fs.existsSync(PIN_FILE) ? JSON.parse(fs.readFileSync(PIN_FILE, 'utf8')) : { ymLogHashes: {} };
const newPins = { note: 'SHA-1 prefix of YM2612 write log (300 frames). NHL95_PIN_PRINT=1 to regenerate.', ymLogHashes: {} };

const slice = fs.readFileSync(path.join(__dirname, '..', 'data', 'fixtures', G.slice));
assert.strictEqual(slice.length, G.size - G.start, 'slice size');
const rom = new Uint8Array(G.size);
rom.set(slice, G.start);

function run(kind, id, frames) {
  const chain = Chain.create({ rom, driver: G.driver, keepLogs: true });
  chain.step(null);
  chain.step([{ [kind]: id }]);
  for (let f = 2; f < frames; f++) chain.step(null);
  return chain;
}
const logHash = (chain) => crypto.createHash('sha1').update(Chain.ymLogText(chain)).digest('hex').slice(0, 16);

const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'audio', G.catalog), 'utf8'));
const sounds = cat.entries.filter((e) => e.soundId != null && e.playable);
assert.strictEqual(sounds.length, G.sounds);
let silent = 0;
for (const e of sounds) {
  const kind = e.soundId >= 0x32 ? 'song' : 'sfx';
  const chain = run(kind, e.soundId, 40);
  assert.deepStrictEqual(chain.unheldWrites, [], e.label + ': unheld Z80 writes');
  assert.ok(chain.z.ym.length > 0, e.label + ': no YM writes');
  if (!chain.z.ym.some((w) => w.reg === 0x28 || w.reg === 0x2a)) silent += 1;
}
assert.ok(silent < sounds.length / 2);
console.log('nhl95 sound chain: all ' + sounds.length + ' catalog sounds run (' + (sounds.length - silent) + ' audible in 40 frames) OK');

const got = {};
for (const k of G.pins) {
  const [kind, id] = k.split(' ');
  got[k] = logHash(run(kind, parseInt(id, 16), 300));
}
newPins.ymLogHashes = got;
if (printPins) {
  fs.writeFileSync(PIN_FILE, JSON.stringify(newPins, null, 2) + '\n');
  console.log('wrote ' + PIN_FILE);
} else if (pinned.ymLogHashes && Object.keys(pinned.ymLogHashes).length) {
  assert.deepStrictEqual(got, pinned.ymLogHashes, 'YM log pins changed; NHL95_PIN_PRINT=1 to refresh');
  console.log('nhl95 sound chain: YM log pins OK');
} else {
  fs.writeFileSync(PIN_FILE, JSON.stringify(newPins, null, 2) + '\n');
  console.log('nhl95 sound chain: wrote initial YM log pins');
}

// --- YM2612 timers, DAC and PSG (the 95 driver polls the timer flags; songs drive the PSG) -------------------------
{
  const Z80 = require('../lib/audio/nhl92-z80-harness');
  const tm = Z80.createYmTimers();
  tm.write(0, 0x24, 0xff); tm.write(0, 0x25, 0x03); // TA = $3FF: one sample
  tm.write(0, 0x27, 0x05); // load and enable A
  assert.strictEqual(tm.status(10), 0, 'Timer A not yet over');
  assert.strictEqual(tm.status(Z80.T_PER_YM_SAMPLE + 1), 1, 'Timer A flag after (1024 - TA) samples');
  tm.write(100, 0x27, 0x15); // reset the A flag, keep it running
  assert.strictEqual(tm.status(101), 0, 'flag cleared by $27 bit 4');
  tm.write(200, 0x26, 0xff); tm.write(200, 0x27, 0x0a); // Timer B: 16 samples
  assert.strictEqual(tm.status(200 + 16 * Z80.T_PER_YM_SAMPLE + 1) & 2, 2, 'Timer B flag');

  // DAC: before the timers, Z80 $1586 never saw Timer A and no sample byte reached $2A.
  const dacWrites = (kind, id) => run(kind, id, 300).z.ym.filter((w) => w.part === 0 && w.reg === 0x2a).length;
  const d35 = dacWrites('song', G.pcmSong);
  assert.ok(d35 > 1000, 'song $35 streams PCM to $2A (' + d35 + ')');
  assert.ok(dacWrites('sfx', 0x2c) > 1000, 'sfx $2C (song $11) streams PCM to $2A');

  // PSG: song 0 plays noise drums; the level sits under the FM and channel 6 mutes it.
  const psgApi = require('../lib/audio/sn76489');
  assert.ok(Math.abs(psgApi.volToGain(1) - Math.pow(10, -0.1)) < 1e-9, 'SN76489 attenuation is 2 dB a step');
  const silentChip = { write() {}, reset() {}, generateStereo: (n) => ({ left: new Float32Array(n), right: new Float32Array(n) }) };
  const psgRun = (mute) => {
    const chain = Chain.create({ rom, driver: G.driver, keepLogs: false, chip: silentChip, psg: psgApi.create() });
    if (mute) chain.setChannelMute(6, true);
    chain.step(null);
    chain.step([{ song: 0 }]);
    for (let f = 2; f < 300; f++) chain.step(null);
    return chain;
  };
  const loud = psgRun(false);
  assert.ok(loud.psgWrites > 100 && loud.psgPeak > 0, 'song 0 writes the PSG');
  assert.ok(loud.psgPeak < 6000, 'song 0 PSG peak ' + loud.psgPeak + ' stays well under one FM channel at full scale');
  const quiet = psgRun(true);
  assert.strictEqual(quiet.psgWrites, loud.psgWrites, 'muted PSG still takes its writes');
  assert.strictEqual(quiet.psgPeak, 0, 'muted PSG is out of the mix');
  console.log('nhl95 sound chain: YM timers, DAC streaming, PSG level and mute OK');
}

// Names: 95 menu songs and team-song labels come from the 95 source, not the 94 tables.
{
  const assert = require('assert');
  const N = require('../lib/audio/nhl93-names.js');
  assert.deepStrictEqual(N.SONGS95.map((s) => s[0]).filter((_, i) => i !== 1), ['SngTitle', 'SngEOP', 'SngScouting']);
  const cat = require('../data/audio/nhl95.json');
  const lab = (id) => cat.entries.find((e) => e.soundId === id && e.type === 'song').label;
  assert.strictEqual(lab(0x46), 'ChooseSong, TeamSongs (25 teams: all but CGY, PHI and SJ)');
  assert.strictEqual(lab(0x3A), 'ChooseSong, TeamSongs ANH');
  assert.strictEqual(lab(0x4F), 'ChooseSong, RandomSongs');
  console.log('nhl95 names: menu songs and TeamSongs labels OK');
}
