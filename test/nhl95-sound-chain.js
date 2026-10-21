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
