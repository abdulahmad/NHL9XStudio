'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Kms = require('../lib/audio/pc94-kms');
const Sfx = require('../lib/audio/pc94-sfx');
const Player = require('../lib/audio/pc94-player');
const Pack = require('../lib/pc94-pack');
const Viv = require('../lib/audio/viv');

const tiny = Kms.encodeTiny({ tempo: 120, note: 0x3c, vel: 0x64, dur: 24 });
assert.ok(Kms.isKms(tiny.kms));
const parsed = Kms.parse(tiny.kms, tiny.cfg);
assert.strictEqual(parsed.ntracks, 1);
assert.strictEqual(parsed.tempo, 120);
assert.ok(parsed.tracks[0].events.some((e) => (e.cmd & 0x7f) === 0x3c && e.cmd >= 0x80));
assert.ok(parsed.tracks[0].events.some((e) => e.cmd === 0xd9));

assert.strictEqual(Player.NOTE_OFFSET, 24, 'HOCKEY.EXE 1844:022E adds 18h');
const a4 = Player.midiToFnum(69);
assert.strictEqual(a4.block, 5, 'YM30 block = note/12 (MIDI 69 → 5)');
assert.strictEqual(a4.fnum, 0x90, 'YM30 fnum table[69%12]');
const pcm = Player.renderSong(parsed, { seconds: 0.4, loops: 1 });
let peak = 0;
for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
assert.ok(peak > 50, '94 KMS fixture renders non-silent OPL output (' + peak + ')');
assert.ok(pcm.events && pcm.events.length > 0, 'renderSong traces MIDI events for the visualizer');
assert.ok(pcm.events.some((e) => (e.msg[0] & 0xf0) === 0x90 && e.msg[1] === 0x3c + 24),
  'MIDI send adds 24 (file note 0x3C → 0x54)');
const velOnly = Kms.decodeEvent(Uint8Array.from([0x00, 0x30, 24]), 0);
assert.strictEqual(velOnly.cmd, 0x30);
assert.strictEqual(velOnly.a1, 0, '00–80 notes do not consume a velocity byte');
assert.strictEqual(velOnly.a2, 24);
const withVel = Kms.decodeEvent(Uint8Array.from([0x00, 0xbc, 0x64, 24]), 0);
assert.strictEqual(withVel.cmd, 0xbc);
assert.strictEqual(withVel.a1, 0x64);
assert.strictEqual(withVel.a2, 24);
const ui = fs.readFileSync(path.join(__dirname, '../public/sound-test-pc94.js'), 'utf8');
assert.ok(ui.includes('st-viz-canvas') && ui.includes('drawRoll'), 'Audio tab draws the AdLib piano roll');

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

function be24(n) { return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const pcmClip = Uint8Array.from([0, 20, 40, 60, 40, 20, 0, 236]);
const raw = new Uint8Array(5 + pcmClip.length);
raw[0] = 0x72;
raw[1] = 0xfb;
raw.set(be24(pcmClip.length), 2);
raw.set(pcmClip, 5);
const packed = Pack.wrapBtree(raw);
const name = Buffer.from('HI.BRU\0');
const payloadOff = 12 + name.length + 6;
const vivBuf = new Uint8Array(payloadOff + packed.length);
vivBuf[0] = 0xc0;
vivBuf[1] = 0xfb;
vivBuf.set(name, 12);
vivBuf.set(be24(payloadOff), 12 + name.length);
vivBuf.set(be24(packed.length), 12 + name.length + 3);
vivBuf.set(packed, payloadOff);
assert.ok(Viv.isViv(vivBuf));
const clips = Viv.listClips(vivBuf);
assert.strictEqual(clips.length, 1);
assert.strictEqual(clips[0].name, 'HI.BRU');
assert.strictEqual(clips[0].label, 'HI (Bruce)');
assert.strictEqual(clips[0].pcm.length, pcmClip.length);
assert.deepStrictEqual(Array.from(clips[0].pcm), Array.from(pcmClip));
const speech = Viv.toFloat32(clips[0].pcm);
assert.ok(speech.some((v) => v !== 0));
assert.strictEqual(Viv.labelOf('TWELVE.BRU'), 'TWELVE (Bruce)');
assert.strictEqual(Viv.labelOf('EASPORTS.BAR'), 'EASPORTS (Barr)');
assert.strictEqual(Viv.labelOf('BOS.CTY'), 'Boston (city)');
assert.strictEqual(Viv.labelOf('BUF.RNK'), 'Buffalo (rank)');
assert.strictEqual(Viv.labelOf('THE3RD.BAR'), 'THE3RD (Barr)');
assert.strictEqual(Viv.labelOf('DAL.CTY'), 'Dallas (city)');
assert.strictEqual(Viv.labelOf('BOS.HOM'), 'Boston (home)');
assert.strictEqual(Viv.labelOf('BUF.AWA'), 'Buffalo (away)');
assert.strictEqual(Viv.labelOf('GOODNITE.INT'), 'GOODNITE (intro)');
assert.strictEqual(Viv.labelOf('ASC.CTY'), 'All-Star East (city)');
const tinyCfg = Kms.parseCfg(tiny.cfg, 1);
assert.strictEqual(tinyCfg.tracks[0].chan, 1);
assert.strictEqual(tinyCfg.tracks[0].program, 1);
assert.strictEqual(tinyCfg.tracks[0].vol, 100);
assert.strictEqual(tinyCfg.tracks[0].pan, 64);

const retail = retail94Dir();
if (retail) {
  const kms = fs.readFileSync(path.join(retail, 'ADTITLE.KMS'));
  const cfg = fs.readFileSync(path.join(retail, 'ADTITLE.CFG'));
  assert.ok(Kms.isKms(kms));
  const song = Kms.parse(kms, cfg);
  assert.ok(song.ntracks >= 1 && song.ntracks <= 16);
  assert.strictEqual(song.tracks[0].chan, 1);
  assert.strictEqual(song.tracks[0].program, 0x5f);
  assert.strictEqual(song.tracks[0].vol, 100);
  assert.strictEqual(song.tracks[0].pan, 64);
  const live = Player.renderSong(song, { seconds: 2, loops: 1 });
  let livePeak = 0;
  for (let i = 0; i < live.length; i++) livePeak = Math.max(livePeak, Math.abs(live[i]));
  assert.ok(livePeak > 50, 'ADTITLE.KMS renders (' + livePeak + ')');
  const timBuf = fs.readFileSync(path.join(retail, 'PCFF001.TIM'));
  const digBuf = fs.readFileSync(path.join(retail, 'PCFF001.DIG'));
  const samples = Sfx.listDigital(timBuf, digBuf, null);
  assert.ok(samples.length >= 1, 'PCFF001 digital timbres');
  assert.ok(samples[0].pcm.length > 0);
  const notes = song.tracks[0].events.filter((e) => e.cmd < 0xd9);
  assert.ok(notes.some((e) => (e.cmd & 0x7f) === 0x30), 'ADTITLE file notes are MIDI values');
  assert.ok(live.events.some((e) => (e.msg[0] & 0xf0) === 0x90 && e.msg[1] === 0x30 + 24),
    'ADTITLE MIDI send adds 24 (0x30 → 0x48)');
  function checkViv(file, lastName, labels) {
    const p = path.join(retail, file);
    if (!fs.existsSync(p)) return;
    const retailViv = Viv.listClips(fs.readFileSync(p));
    assert.ok(retailViv.length >= 80, file + ' clips (' + retailViv.length + ')');
    assert.ok(retailViv[0].pcm.length > 100);
    const peak = Viv.toFloat32(retailViv[0].pcm).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    assert.ok(peak > 0.01, file + ' clip is not silence');
    assert.ok(retailViv.every((c) => c.pcm.length < 200000), file + ' no over-read');
    assert.ok(!retailViv.some((c) => c.name === 'PIT.CTY' && c.pcm.length > 100000), 'no garbage PIT.CTY');
    assert.ok(!retailViv.some((c) => c.name === 'EDM.RNK' && c.pcm.length > 100000), 'no garbage EDM.RNK');
    assert.strictEqual(retailViv[retailViv.length - 1].name, lastName);
    for (const lab of labels) assert.ok(retailViv.some((c) => c.label === lab), file + ' has ' + lab);
  }
  checkViv('XBRUCE2.VIV', 'QUE.CTY', ['TWELVE (Bruce)', 'Boston (city)', 'Dallas (city)']);
  checkViv('XRBARR2.VIV', 'DET.RNK', ['EASPORTS (Barr)', 'THE3RD (Barr)', 'Boston (home)']);
}

console.log('pc94-audio: ok');
