'use strict';
const assert = require('assert');
const Kms = require('../lib/audio/kms');
const Player = require('../lib/audio/kms-player');
const Viv = require('../lib/audio/viv');

function buildTinyKms() {
  const parts = [];
  const push = (arr) => { parts.push(Uint8Array.from(arr)); };
  const hdrTrack = () => {
    const body = [];
    body.push(0, 0x00); // delay, song data
    body.push(1); // numInst
    body.push(0x54, 0x45, 0x53, 0x54); // TEST
    body.push(1); // numActive
    body.push(0x74, 0x30, 0x73, 0x30, 0x00); // t0s0\0
    const len = 4 + body.length;
    const out = new Uint8Array(len);
    new DataView(out.buffer).setUint32(0, len, true);
    out.set(body, 4);
    return out;
  };
  const melTrack = () => {
    const body = [0, 0xe2, 0xff, 0, 0xdc, 0, 0, 0x3c, 0, 48, 24, 0xe3];
    const len = 4 + body.length;
    const out = new Uint8Array(len);
    new DataView(out.buffer).setUint32(0, len, true);
    out.set(body, 4);
    return out;
  };
  const h = hdrTrack();
  const m = melTrack();
  const numTracks = 2;
  const headLen = 20 + numTracks * 8;
  const file = new Uint8Array(headLen + h.length + m.length);
  const dv = new DataView(file.buffer);
  dv.setUint32(0, file.length, true);
  dv.setUint16(4, 1, true);
  file.set([0x54, 0x49, 0x4e, 0x59, 0, 0, 0, 0], 6); // title TINY
  dv.setUint32(14, file.length - 14, true);
  dv.setUint16(18, numTracks, true);
  file.set([0x48, 0x44, 0x52, 0x31], 20);
  file.set([0x74, 0x30, 0x73, 0x30], 24);
  dv.setUint32(28, 0, true);
  dv.setUint32(32, h.length, true);
  file.set(h, headLen);
  file.set(m, headLen + h.length);
  return file;
}

const parsed = Kms.parse(buildTinyKms());
assert.strictEqual(parsed.numTracks, 2);
assert.ok(parsed.hdr && parsed.hdr.instruments[0] === 'TEST');
assert.ok(parsed.tracks.some((t) => t.id === 't0s0' && t.events.some((e) => e.kind === 'note')));

const pcm = Player.render(parsed, { seconds: 0.4 });
let peak = 0;
for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
assert.ok(peak > 50, 'KMS fixture renders non-silent OPL output (' + peak + ')');

const bnk = new Uint8Array(32);
bnk.set([0x42, 0x4e, 0x4b, 0x6c, 0x02, 0x00, 0x01, 0x00, 0x10, 0, 0, 0, 0, 0, 0, 0]);
const viv = Viv.findBnk(bnk);
assert.ok(viv && viv.count === 1);

console.log('pc-audio-kms: ok');
