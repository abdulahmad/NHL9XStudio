// NHLPA 93 sound names line up with NHL 92: every shared equate is a 92 equate, and each 93 sample that names a 92 sample
// is an excerpt of it (the 93 bytes are found in the 92 file, checked against the bundled sound slices).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const N93 = require('../lib/audio/nhl93-names');
const N92 = require('../lib/audio/nhl92-sfx-names');
const PCM92 = require('../lib/audio/nhl92-pcm');
const Fixture = require('../lib/audio/nhl92-sound-fixture');

assert.strictEqual(N93.SFX.length, 0x30);
assert.strictEqual(N93.SONGS.length, 8);
for (let id = 0; id < N93.SFX.length; id++) {
  const shared = N93.SFX[id][2];
  if (shared) assert.ok(N93.id92(shared) >= 0, 'sound $' + id.toString(16) + ': ' + shared + ' is a 92 equate');
  assert.strictEqual(N93.sfxName(id), N93.SFX[id][0]);
}
assert.strictEqual(N93.sfxName(0), 'siren');
assert.strictEqual(N93.sfxName(0x10), 'pass1');
assert.ok(N93.sfxDescribe(0x10).startsWith('ram93 SFXpass · 92 '), N93.sfxDescribe(0x10));
assert.strictEqual(N93.sfxDescribe(0), '92 siren (0) · FM siren');
assert.ok(N93.sfxDescribe(0x1c).endsWith('sample from 92 skating34'), N93.sfxDescribe(0x1c));
assert.strictEqual(N93.songName(0x35), 'title');
assert.strictEqual(N93.songName(0x37), 'scouting');
assert.ok(N93.songDescribe(0x37).startsWith('ram93 SngScout · '), N93.songDescribe(0x37));
assert.strictEqual(N93.songDescribe(0x36), 'End of period song; 93 also plays it at the end of the game, on the playoff screen and when the highlights start (92 SngEOP, SngEOG, SngPO)');
for (const s of N93.PCM) {
  for (const id of s.uses) assert.ok(id < 0x30, s.name + ' used by an effect');
  assert.ok(!s.from92 || PCM92.SAMPLES.some((p) => p.name === s.from92), s.name + ': ' + s.from92 + ' is a 92 sample');
}

const slice93 = new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'data', 'fixtures', 'nhl93-sound-slice.bin')));
const rom93 = new Uint8Array(0x30000);
rom93.set(slice93.subarray(0, 0x30000 - 0x165d8), 0x165d8);
const rom92 = Fixture.resolveRom();
const has = (hay, needle) => Buffer.from(hay).indexOf(Buffer.from(needle)) >= 0;
for (const s of N93.PCM) {
  if (!s.from92) continue;
  const d = rom93.subarray(s.start, s.end);
  const ref = PCM92.SAMPLES.find((p) => p.name === s.from92);
  const hay = rom92.subarray(ref.start, ref.end);
  let hit = 0;
  let tried = 0;
  for (let at = 0; at + 48 < d.length; at += Math.max(48, Math.floor(d.length / 20))) {
    const w = d.subarray(at, at + 48);
    if (new Set(w).size < 6) continue;
    tried += 1;
    if (has(hay, w)) hit += 1;
  }
  assert.ok(tried > 0 && hit / tried >= 0.85, s.name + ' is an excerpt of ' + s.from92 + ' (' + hit + '/' + tried + ' windows)');
}
console.log('nhl93 names: ' + N93.SFX.length + ' effects, ' + N93.SONGS.length + ' songs and ' + N93.PCM.length + ' samples line up with NHL 92 OK');
