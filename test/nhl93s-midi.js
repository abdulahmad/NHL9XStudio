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
// --- 6. pattern compression: a song too big for its RAM is squeezed with pattern calls and plays the same ---
{
  const lastTail = (a) => a.slice(0, -1); // the final note may lose its 2-tick key-off tail (see 1)
  for (const [cue, share] of [[4, 0.65], [8, 0.9], [1, 0.6]]) {
    const info = d.cueList.find((c) => c.cue === cue);
    const model = Midi.fromSmf(Midi.toSmf(d, gm, cue, { native: true }), d, gm, {}).model;
    const flat = Midi.buildSong(model, Midi.BASE[info.set]);
    const cap = Math.floor(flat.size * share);
    const packed = Midi.buildSong(model, Midi.BASE[info.set], { capacity: cap });
    assert.ok(packed.patterns > 0 && packed.size <= cap, 'cue ' + cue + ': ' + flat.size + ' -> ' + packed.size + ' (limit ' + cap + ')');
    const a = noteSig(d.timeline(7, { loops: 0, ram: d.customImage(info.set, flat.bytes, flat.base, 7) }));
    const b = noteSig(d.timeline(7, { loops: 0, ram: d.customImage(info.set, packed.bytes, packed.base, 7) }));
    assert.deepStrictEqual(b, a, 'cue ' + cue + ' plays the same compressed');
  }
  // and in the retail program: every key-on of a compressed song is where the timeline puts it
  const info = d.cueList.find((c) => c.cue === 5);
  const model = Midi.fromSmf(Midi.toSmf(d, gm, 5, { native: true }), d, gm, {}).model;
  const packed = Midi.buildSong(model, Midi.BASE.game, { capacity: 300 });
  assert.ok(packed.patterns > 0);
  const p = Player.create({ data: d });
  p.playCustom('game', packed.bytes, packed.base);
  p.runFrame();
  p.runFrame();
  const cpu = p.spc.cpu;
  const emu = [];
  let ticks = 0;
  const end = p.spc.cycles + 5 * 1024000;
  while (p.spc.cycles < end) {
    const pc = cpu.pc;
    if (pc === 0x664) ticks += 1;
    else if (pc === 0x4e3 && cpu.y < 0xc8) emu.push({ tick: ticks, ch: cpu.x >> 1, code: cpu.y });
    p.spc.step();
  }
  const mine = d.timeline(7, { loops: 0, ram: d.customImage('game', packed.bytes, packed.base, 7) }).events.filter((e) => e.type === 'note');
  const t0 = emu[0].tick;
  assert.ok(emu.length > 20 && mine.length > 20);
  mine.slice(0, emu.length).forEach((e, i) => {
    assert.strictEqual(emu[i].tick - t0, e.tick, 'compressed note ' + i);
    assert.strictEqual(emu[i].ch, e.ch);
    assert.strictEqual(emu[i].code, e.code);
  });
  // a long repetitive GM file for the game set (4.6 KB free) fits once compressed, and says so
  const lead = [];
  for (let bar = 0; bar < 400; bar++) for (let i = 0; i < 8; i++) lead.push({ tick: (bar * 8 + i) * 120, dur: 100, pitch: 55 + ((i * 3) % 7), vel: 100 });
  const big = Smf.write({ ppq: 480, tempos: [{ tick: 0, bpm: 120 }], tracks: [{ ch: 0, program: 80, name: 'lead', notes: lead }] });
  const r = Midi.fromSmf(big, d, gm, { set: 'game' });
  assert.ok(r.report.compressed && r.report.compressed.from > r.report.capacity, 'it needed compressing: ' + JSON.stringify(r.report.compressed));
  assert.ok(!r.report.tooBig && r.bytes.length <= r.report.capacity);
}
// The song editor's game instruments: an "n93i:<channel>:<hex>" marker picks the instrument instead of the GM map.
{
  const tune = (markers) => Smf.write({ ppq: 480, tempos: [{ tick: 0, bpm: 120 }], name: 'gi', markers, tracks: [
    { name: 't1', ch: 0, notes: [60, 64, 67].map((p, i) => ({ tick: i * 480, dur: 400, pitch: p, vel: 100, program: 0 })) }] });
  const inst = (r) => r.model.channels.flatMap((c) => c.events).filter((e) => e.type === 'command' && e.code === 0xe0).map((e) => e.params[0]);
  const viaGm = inst(Midi.fromSmf(tune([]), d, gm, { set: 'game' }));
  const fixed = Midi.fromSmf(tune([{ tick: 0, text: 'n93i:0:c' }]), d, gm, { set: 'game' });
  assert.deepStrictEqual(inst(fixed), [0x0c], 'game instrument $0C chosen directly (GM map gave ' + viaGm + ')');
  assert.notDeepStrictEqual(viaGm, [0x0c]);
}
console.log('nhl93s-midi: ok');
