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
const pastEof = Uint8Array.from(vivBuf);
pastEof[6] = 0xff; pastEof[7] = 0xff; pastEof[8] = 0xff;
assert.strictEqual(Viv.parseArchive95(pastEof).entries.length, 0, '95 VIV drops offsets past EOF');

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
assert.strictEqual(iffClip.kind, 'form');
assert.strictEqual(iffClip.rate, 11025);
assert.deepStrictEqual(Array.from(iffClip.pcm), Array.from(iffPcm));

function le16(n) { return [n & 255, (n >> 8) & 255]; }
function le32(n) { return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]; }
const riffPcm = Uint8Array.from([10, 20, 30, 40, 30, 20, 10, 0]);
const riff = new Uint8Array(0x2c + riffPcm.length);
riff.set(Buffer.from('RIFF'), 0);
riff.set(le32(riff.length - 8), 4);
riff.set(Buffer.from('WAVE'), 8);
riff.set(Buffer.from('fmt '), 12);
riff.set(le32(16), 16);
riff.set(le16(1), 20);
riff.set(le16(1), 22);
riff.set(le32(11025), 0x18);
riff.set(le32(11025), 0x1c);
riff.set(le16(1), 0x20);
riff.set(le16(8), 0x22);
riff.set(Buffer.from('data'), 0x24);
riff.set(le32(riffPcm.length), 0x28);
riff.set(riffPcm, 0x2c);
const riffClip = Viv.decodeIff(riff);
assert.ok(riffClip);
assert.strictEqual(riffClip.kind, 'riff');
assert.strictEqual(riffClip.rate, 11025);
assert.strictEqual(riffClip.depth, 8, '8-bit WAVE stays 8-bit after XOR 80h');
assert.strictEqual(riffClip.pcm.length, riffPcm.length);
assert.strictEqual(riffClip.pcm[0], riffPcm[0] ^ 0x80);
assert.strictEqual(iffClip.depth, 8, 'FORM 8SVX is signed 8-bit');

const tone = new Int16Array(8);
for (let i = 0; i < 8; i++) tone[i] = (i - 4) * 4000;
const riff16 = new Uint8Array(0x2c + tone.length * 2);
riff16.set(Buffer.from('RIFF'), 0);
riff16.set(le32(riff16.length - 8), 4);
riff16.set(Buffer.from('WAVE'), 8);
riff16.set(Buffer.from('fmt '), 12);
riff16.set(le32(16), 16);
riff16.set(le16(1), 20);
riff16.set(le16(1), 22);
riff16.set(le32(22050), 0x18);
riff16.set(le32(44100), 0x1c);
riff16.set(le16(2), 0x20);
riff16.set(le16(16), 0x22);
riff16.set(Buffer.from('data'), 0x24);
riff16.set(le32(tone.length * 2), 0x28);
for (let i = 0; i < tone.length; i++) {
  riff16[0x2c + i * 2] = tone[i] & 255;
  riff16[0x2c + i * 2 + 1] = (tone[i] >> 8) & 255;
}
const r16 = Viv.decodeIff(riff16);
assert.ok(r16 && r16.depth === 16, '16-bit WAVE');
assert.strictEqual(r16.rate, 22050);
assert.strictEqual(r16.pcm.length, tone.length);
const xLo = (tone[0] & 255) ^ 0x80;
const xHi = ((tone[0] >> 8) & 255) ^ 0x80;
const xorWord = xLo | (xHi << 8);
assert.strictEqual(r16.pcm[0], xorWord > 32767 ? xorWord - 65536 : xorWord);
const f16 = Viv.toFloat32(r16.pcm);
assert.ok(Math.abs(f16[0] - r16.pcm[0] / 32768) < 1e-6);

const fibSrc = Uint8Array.from([40, 0x98, 0x87]);
const fib = Viv.fibDelta(fibSrc);
assert.ok(fib.length === 5, 'fib-delta expands ~2×');
const iffFib = new Uint8Array(12 + 8 + 20 + 8 + fibSrc.length);
let q = 0;
iffFib.set(form, q); q += 4;
iffFib.set(be32(iffFib.length - 8), q); q += 4;
iffFib.set(svx, q); q += 4;
iffFib.set(vhdr, q); q += 4;
iffFib.set(be32(20), q); q += 4;
q += 12;
iffFib.set(be16(8363), q); q += 2;
iffFib[q] = 1; iffFib[q + 1] = 1; q += 6;
iffFib.set(body, q); q += 4;
iffFib.set(be32(fibSrc.length), q); q += 4;
iffFib.set(fibSrc, q);
const fibClip = Viv.decodeIff(iffFib);
assert.ok(fibClip);
assert.strictEqual(fibClip.rate, 8363);
assert.deepStrictEqual(Array.from(fibClip.pcm), Array.from(fib));

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
