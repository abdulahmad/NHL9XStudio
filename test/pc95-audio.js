'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Kms = require('../lib/audio/pc94-kms');
const Player = require('../lib/audio/pc94-player');
const Pack = require('../lib/pc94-pack');
const Viv = require('../lib/audio/viv');

function be24(n) { return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function be16(n) { return [(n >> 8) & 255, n & 255]; }
function be32(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

const tiny = Kms.encodeTiny({ tempo: 120, note: 0x3c, vel: 0x64, dur: 24 });
assert.ok(Kms.isKms(tiny.kms));
const parsed = Kms.parse(tiny.kms, tiny.cfg);
const pcm = Player.renderSong(parsed, { seconds: 0.4, loops: 1 });
let peak = 0;
for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
assert.ok(peak > 50, '95 KMS (EACSNDF) fixture renders (' + peak + ')');

const pcmClip = Uint8Array.from([0, 20, 40, 60, 40, 20, 0, 236]);
const raw = new Uint8Array(5 + pcmClip.length);
raw[0] = 0x72;
raw[1] = 0xfb;
raw.set(be24(pcmClip.length), 2);
raw.set(pcmClip, 5);
const packed = Pack.wrapBtree(raw);
assert.ok(Pack.isBtree(packed));

const name = Buffer.from('HI.BRU\0');
const dir = 6 + 6 + name.length;
const vivBuf = new Uint8Array(dir + packed.length);
vivBuf.set(be16(1), 2);
vivBuf.set(be24(dir), 6);
vivBuf.set(be24(packed.length), 9);
vivBuf.set(name, 12);
vivBuf.set(packed, dir);
assert.ok(!Viv.isViv(vivBuf));
const parsed95 = Viv.parseArchive95(vivBuf);
assert.strictEqual(parsed95.kind, 'pc95');
assert.strictEqual(parsed95.entries.length, 1);
assert.strictEqual(parsed95.entries[0].name, 'HI.BRU');
const clips = Viv.listClips(vivBuf);
assert.strictEqual(clips.length, 1);
assert.strictEqual(clips[0].kind, 'pc95');
assert.strictEqual(clips[0].pcm.length, pcmClip.length);
const decoded = Viv.deltaDecode(pcmClip);
assert.deepStrictEqual(Array.from(clips[0].pcm), Array.from(decoded));
assert.ok(Viv.toFloat32(clips[0].pcm).some((v) => v !== 0));

const body = Buffer.from('BODY');
const vhdr = Buffer.from('VHDR');
const form = Buffer.from('FORM');
const svx = Buffer.from('8SVX');
const iffPcm = Uint8Array.from([10, 20, 30, 40, 30, 20, 10, 0]);
const iff = new Uint8Array(12 + 8 + 20 + 8 + iffPcm.length);
let p = 0;
iff.set(form, p); p += 4;
iff.set(be32(iff.length - 8), p); p += 4;
iff.set(svx, p); p += 4;
iff.set(vhdr, p); p += 4;
iff.set(be32(20), p); p += 4;
p += 12;
iff.set(be16(11025), p); p += 2;
p += 6;
iff.set(body, p); p += 4;
iff.set(be32(iffPcm.length), p); p += 4;
iff.set(iffPcm, p);
const iffClip = Viv.decodeIff(iff);
assert.ok(iffClip);
assert.strictEqual(iffClip.rate, 11025);
assert.deepStrictEqual(Array.from(iffClip.pcm), Array.from(iffPcm));

function retail95Dir() {
  const root = path.join(__dirname, '..');
  const cands = [
    process.env.NHL_PC95_DIR,
    path.join(root, 'pc95'),
    path.join(root, 'EA-NHL-Tools', 'Sprite-Viewer', 'pc95')
  ].filter(Boolean);
  return cands.find((dir) => fs.existsSync(path.join(dir, 'ADTITLE.KMS')) || fs.existsSync(path.join(dir, 'XBRUCE2.VIV'))) || null;
}

const retail = retail95Dir();
if (retail) {
  const kmsPath = path.join(retail, 'ADTITLE.KMS');
  if (fs.existsSync(kmsPath)) {
    const kms = fs.readFileSync(kmsPath);
    const cfgPath = path.join(retail, 'ADTITLE.CFG');
    const cfg = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath) : null;
    assert.ok(Kms.isKms(kms), '95 ADTITLE.KMS is EACSNDF, not wiki Kris');
    const song = Kms.parse(kms, cfg);
    const live = Player.renderSong(song, { seconds: 2, loops: 1 });
    let livePeak = 0;
    for (let i = 0; i < live.length; i++) livePeak = Math.max(livePeak, Math.abs(live[i]));
    assert.ok(livePeak > 50, '95 ADTITLE.KMS renders (' + livePeak + ')');
  }
  const vivPath = ['XBRUCE2.VIV', 'XRBARR2.VIV'].map((n) => path.join(retail, n)).find((p) => fs.existsSync(p));
  if (vivPath) {
    const retailViv = Viv.listClips(fs.readFileSync(vivPath), { delta: true });
    assert.ok(retailViv.length >= 10, path.basename(vivPath) + ' clips');
    assert.ok(retailViv[0].pcm.length > 100);
    const peak = Viv.toFloat32(retailViv[0].pcm).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    assert.ok(peak > 0.01, 'retail 95 VIV clip is not silence');
  }
}

console.log('pc95-audio: ok');
