'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Kms = require('../lib/audio/pc94-kms');
const Sfx = require('../lib/audio/pc94-sfx');
const Player = require('../lib/audio/pc94-player');

const tiny = Kms.encodeTiny({ tempo: 120, note: 0x3c, vel: 0x64, dur: 24 });
assert.ok(Kms.isKms(tiny.kms));
const parsed = Kms.parse(tiny.kms, tiny.cfg);
assert.strictEqual(parsed.ntracks, 1);
assert.strictEqual(parsed.tempo, 120);
assert.ok(parsed.tracks[0].events.some((e) => (e.cmd & 0x7f) === 0x3c && e.cmd >= 0x80));
assert.ok(parsed.tracks[0].events.some((e) => e.cmd === 0xd9));

const pcm = Player.renderSong(parsed, { seconds: 0.4, loops: 1 });
let peak = 0;
for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
assert.ok(peak > 50, '94 KMS fixture renders non-silent OPL output (' + peak + ')');

function u16(n) { return [n & 255, (n >> 8) & 255]; }
function u32(n) { return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]; }

const sample = Uint8Array.from([0, 40, 80, 120, 80, 40, 0, 216]);
const timbre = new Uint8Array(32);
timbre[0] = 0x06;
timbre.set([0x11, 0x22, 0x33, 0x44], 2);
timbre[0x12] = 0x11;
timbre[0x13] = 0x2b; // 11025
timbre.set(u32(sample.length), 0x14);

function table(ids, blobs) {
  const count = ids.length;
  const base = 6 + 8 * count;
  let pos = 0;
  const offs = [];
  for (const blob of blobs) {
    offs.push(pos);
    pos += blob.length;
  }
  const out = new Uint8Array(base + pos);
  out.set(u32(out.length), 0);
  out.set(u16(count), 4);
  for (let i = 0; i < count; i++) {
    out.set(ids[i], 6 + 4 * i);
    out.set(u32(offs[i]), 6 + 4 * count + 4 * i);
  }
  let w = base;
  for (const blob of blobs) {
    out.set(blob, w);
    w += blob.length;
  }
  return out;
}

const tim = table([Uint8Array.from([0x80, 0, 0, 7])], [timbre]);
const dig = table([Uint8Array.from([0x11, 0x22, 0x33, 0x44])], [sample]);
const listed = Sfx.listDigital(tim, dig, null);
assert.strictEqual(listed.length, 1);
assert.strictEqual(listed[0].timbre, 7);
assert.strictEqual(listed[0].rate, 11025);
assert.strictEqual(listed[0].length, sample.length);
const f32 = Sfx.toFloat32(listed[0].pcm);
assert.ok(f32.some((v) => v !== 0));
const rendered = Player.renderSfx(listed[0], {});
assert.strictEqual(rendered.rate, 11025);
assert.ok(rendered.float.length === sample.length);

function retail94Dir() {
  const root = path.join(__dirname, '..');
  const cands = [
    process.env.NHL_PC94_DIR,
    path.join(root, 'pc94'),
    path.join(root, 'EA-NHL-Tools', 'Sprite-Viewer', 'pc94'),
    '/tmp/nhl94pc-src/lst/game'
  ].filter(Boolean);
  return cands.find((dir) => fs.existsSync(path.join(dir, 'ADTITLE.KMS'))) || null;
}

const retail = retail94Dir();
if (retail) {
  const kms = fs.readFileSync(path.join(retail, 'ADTITLE.KMS'));
  const cfg = fs.readFileSync(path.join(retail, 'ADTITLE.CFG'));
  assert.ok(Kms.isKms(kms));
  const song = Kms.parse(kms, cfg);
  assert.ok(song.ntracks >= 1 && song.ntracks <= 16);
  const live = Player.renderSong(song, { seconds: 2, loops: 1 });
  let livePeak = 0;
  for (let i = 0; i < live.length; i++) livePeak = Math.max(livePeak, Math.abs(live[i]));
  assert.ok(livePeak > 50, 'ADTITLE.KMS renders (' + livePeak + ')');
  const timBuf = fs.readFileSync(path.join(retail, 'PCFF001.TIM'));
  const digBuf = fs.readFileSync(path.join(retail, 'PCFF001.DIG'));
  const samples = Sfx.listDigital(timBuf, digBuf, null);
  assert.ok(samples.length >= 1, 'PCFF001 digital timbres');
  assert.ok(samples[0].pcm.length > 0);
}

console.log('pc94-audio: ok');
