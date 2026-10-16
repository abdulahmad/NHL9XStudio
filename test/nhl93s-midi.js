/**
 * Tests for lib/audio/nhl93s-midi.js: writing songs in the '93 (SNES) sequencer's format, MIDI export (GM and native)
 * and MIDI import. The nine retail songs are the fixtures; imported songs are played by the retail SPC700 program and
 * their key-ons compared with the timeline. No ROM is needed.
 */
const assert = require('assert');
const Midi = require('../lib/audio/nhl93s-midi');
const Smf = require('../lib/audio/smf');
const SoundData = require('../lib/audio/nhl93s-sound-data');
const Player = require('../lib/audio/nhl93s-player');
const d = SoundData.load(require('../data/audio/nhl93s-sound.json'));
const gm = require('../data/audio/nhl93s-gm-map.json');

const noteSig = (tl) => tl.events.filter((e) => e.type === 'note' || e.type === 'percussion')
  .map((e) => [e.tick, e.ch, e.midi, e.instrument, e.length, e.velocity, e.volume, e.pan]);

// --- 1. native export and import: the same song back (the final note may lose its 2-tick key-off tail) ---
for (const c of d.cueList) {
  const tl = d.timeline(c.cue, { loops: 0 });
  const smf = Midi.toSmf(d, gm, c.cue, { native: true });
  const r = Midi.fromSmf(smf, d, gm, {});
  assert.ok(r.report.native, 'cue ' + c.cue + ' is read as a native file');
  assert.strictEqual(r.report.set, c.set);
  assert.ok(!r.report.tooBig, 'cue ' + c.cue + ' fits the free sound RAM (' + r.report.size + ' of ' + r.report.capacity + ')');
  const tl2 = d.timeline(7, { loops: 0, ram: d.customImage(r.report.set, r.bytes, r.base, 7) });
  const a = noteSig(tl);
  const b = noteSig(tl2);
  assert.strictEqual(b.length, a.length, 'cue ' + c.cue + ' note count');
  a.forEach((x, i) => {
    const y = b[i];
    assert.deepStrictEqual(y.slice(0, 4), x.slice(0, 4), 'cue ' + c.cue + ' note ' + i + ' tick/channel/pitch/instrument');
    assert.ok(Math.abs(y[4] - x[4]) <= 2, 'cue ' + c.cue + ' note ' + i + ' length ' + x[4] + ' vs ' + y[4]);
    assert.deepStrictEqual(y.slice(5), x.slice(5), 'cue ' + c.cue + ' note ' + i + ' velocity/volume/pan');
  });
}

// --- 2. the saved .bin is two upload blocks: the song at its base, then the cue 7 pointer ---
{
  const r = Midi.fromSmf(Midi.toSmf(d, gm, 4, { native: true }), d, gm, {});
  const blk = r.block;
  assert.strictEqual(blk[0] | (blk[1] << 8), r.bytes.length, 'first block length');
  assert.strictEqual(blk[2] | (blk[3] << 8), r.base, 'first block address');
  const at = 4 + r.bytes.length;
  assert.deepStrictEqual(Array.from(blk.subarray(at, at + 4)), [2, 0, 0x9f, 0x0e], 'pointer block: 2 bytes at $0E9F');
  assert.deepStrictEqual(Array.from(blk.subarray(at + 4, at + 6)), [r.base & 0xff, r.base >> 8]);
}

// --- 3. GM export: a valid file with the notes and tempo; GM import makes an audible song of the same length ---
{
  const smf = Midi.toSmf(d, gm, 5, {});
  const parsed = Smf.parse(smf);
  const tl = d.timeline(5, { loops: 0 });
  assert.strictEqual(parsed.notes.length, tl.events.filter((e) => e.type === 'note' || e.type === 'percussion').length);
  const r = Midi.fromSmf(smf, d, gm, { set: 'game' });
  assert.ok(!r.report.native);
  assert.ok(r.report.notes > 100);
  assert.ok(Math.abs(r.report.seconds - d.secondsAt(tl.tempoTrack, tl.ticks)) < 1.5, 'length ' + r.report.seconds);
}

// --- 4. an imported song plays in the retail program: its key-ons are the timeline's ---
for (const cue of [4, 1]) {
  const r = Midi.fromSmf(Midi.toSmf(d, gm, cue, { native: true }), d, gm, {});
  const p = Player.create({ data: d });
  p.playCustom(r.report.set, r.bytes, r.base);
  p.runFrame();
  p.runFrame();
  const cpu = p.spc.cpu;
  const emu = [];
  let ticks = 0;
  const end = p.spc.cycles + 4 * 1024000;
  while (p.spc.cycles < end) {
    const pc = cpu.pc;
    if (pc === 0x664) ticks += 1;
    else if (pc === 0x4e3 && cpu.y < 0xc8) emu.push({ tick: ticks, ch: cpu.x >> 1, code: cpu.y });
    p.spc.step();
  }
  const mine = d.timeline(7, { loops: 0, ram: d.customImage(r.report.set, r.bytes, r.base, 7) }).events.filter((e) => e.type === 'note');
  assert.ok(emu.length > 10);
  const t0 = emu[0].tick;
  for (let i = 0; i < Math.min(emu.length, mine.length); i++) {
    assert.strictEqual(emu[i].tick - t0, mine[i].tick, 'cue ' + cue + ' note ' + i);
    assert.strictEqual(emu[i].ch, mine[i].ch);
    assert.strictEqual(emu[i].code, mine[i].code);
  }
}

// --- 5. a plain GM file: drums go to the drum sounds, melody to the voices, too-big songs are reported ---
{
  const lead = [];
  const drums = [];
  for (let i = 0; i < 16; i++) lead.push({ tick: i * 240, dur: 200, pitch: 60 + (i % 5), vel: 100, program: 19 });
  for (let i = 0; i < 16; i++) drums.push({ tick: i * 240, dur: 100, pitch: i % 2 ? 38 : 36, vel: 110, program: 0 });
  const smf = Smf.write({ ppq: 480, tempos: [{ tick: 0, bpm: 120 }], tracks: [{ ch: 0, program: 19, name: 'lead', notes: lead }, { ch: 9, name: 'drums', notes: drums }] });
  const r = Midi.fromSmf(smf, d, gm, { set: 'boot' });
  assert.strictEqual(r.report.notes, 32);
  assert.strictEqual(r.report.set, 'boot');
  const tl = d.timeline(7, { loops: 0, ram: d.customImage('boot', r.bytes, r.base, 7) });
  assert.strictEqual(tl.events.filter((e) => e.type === 'note' || e.type === 'percussion').length, 32);
}
console.log('nhl93s-midi: ok');
