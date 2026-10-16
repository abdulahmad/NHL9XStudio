/**
 * Tests for lib/audio/nhl93s-sound-data.js: the NHLPA Hockey '93 (SNES) sound pack and the reading of its songs.
 * The song reading is checked against the retail SPC700 program itself: the program runs on the SPC700 core and every
 * note it starts (tick, channel, note byte) must be a note in the timeline. No ROM is needed.
 */
const assert = require('assert');
const SoundData = require('../lib/audio/nhl93s-sound-data');
const Player = require('../lib/audio/nhl93s-player');
const pack = require('../data/audio/nhl93s-sound.json');
const d = SoundData.load(pack);

// --- 1. the pack ---
assert.strictEqual(pack.source.rom.sha1, '76a01492cfb656e9fce0094bca356c312adfea0e');
assert.deepStrictEqual(pack.boot.blocks.map((b) => b.addr), [0x400, 0x2b00, 0x2c00, 0x2c30]);
assert.deepStrictEqual(pack.game.blocks.map((b) => b.addr), [0x2c00, 0x2c50]);
assert.strictEqual(d.cueList.length, 9);
assert.deepStrictEqual(d.cueList.filter((c) => c.set === 'boot').map((c) => c.cue).sort(), [1, 2, 3, 9]);
assert.strictEqual(d.cueList.find((c) => c.cue === 3).name, 'Title screen');
assert.strictEqual(d.cueList.find((c) => c.cue === 4).name, 'Home goal');
assert.strictEqual(d.instruments.length, 29, 'the shared instrument table');

// --- 2. order lists: every song is one set, the looping ones jump back ---
for (const c of d.cueList) {
  const s = d.song(c.cue);
  assert.ok(s.entries.length >= 1, 'cue ' + c.cue + ' has an order list');
  const tl = d.timeline(c.cue, { loops: 0 });
  assert.ok(tl.ticks > 0 && tl.events.length > 0, 'cue ' + c.cue + ' has notes');
  assert.ok(d.secondsAt(tl.tempoTrack, tl.ticks) > 2, 'cue ' + c.cue + ' lasts a few seconds');
}

// --- 3. the timeline against the retail program: every key-on the SPC700 starts is a timeline note ---
// pc $0664 is the sequencer tick, pc $04E3 the note start (X = channel * 2, Y = the note byte).
function emulatedNotes(cue, seconds) {
  const info = d.cueList.find((c) => c.cue === cue);
  const p = Player.create({ data: d });
  p.loadSet(info.set);
  p.cue(cue);
  p.runFrame();
  p.runFrame();
  const cpu = p.spc.cpu;
  const notes = [];
  let ticks = 0;
  const end = p.spc.cycles + seconds * 1024000;
  while (p.spc.cycles < end) {
    const pc = cpu.pc;
    if (pc === 0x664) ticks += 1;
    else if (pc === 0x4e3 && cpu.y < 0xc8) notes.push({ tick: ticks, ch: cpu.x >> 1, code: cpu.y });
    p.spc.step();
  }
  return notes;
}
let checked = 0;
for (const c of d.cueList) {
  const emu = emulatedNotes(c.cue, 5);
  const tl = d.timeline(c.cue, { loops: 0 });
  const mine = tl.events.filter((e) => e.type === 'note' || e.type === 'percussion');
  assert.ok(emu.length > 10, 'cue ' + c.cue + ' started notes');
  const t0 = emu[0].tick;
  const n = Math.min(emu.length, mine.length);
  for (let i = 0; i < n; i++) {
    assert.strictEqual(emu[i].tick - t0, mine[i].tick, 'cue ' + c.cue + ' note ' + i + ' tick');
    assert.strictEqual(emu[i].ch, mine[i].ch, 'cue ' + c.cue + ' note ' + i + ' channel');
    if (mine[i].type === 'note') assert.strictEqual(emu[i].code, mine[i].code, 'cue ' + c.cue + ' note ' + i + ' note byte');
    checked += 1;
  }
}
assert.ok(checked > 300, 'compared ' + checked + ' key-ons');

// --- 4. pitch: the MIDI note is the sequencer's key plus 12 (the tuned single-cycle instruments put $B0 at middle C) ---
{
  assert.strictEqual(SoundData.MIDI_OFFSET, 12);
  for (const e of d.timeline(4, { loops: 0 }).events) if (e.type === 'note') assert.strictEqual(e.midi, e.key + 12);
}

// --- 5. sound effects ---
{
  assert.ok(d.effectIds.length >= 20, 'effects found: ' + d.effectIds.length);
  assert.ok(d.effectIds.includes(0x89) && d.effectIds.includes(0xa1));
  assert.ok(d.effectName(0x89));
  const fx = d.effect(0x89);
  assert.ok(fx && fx.steps.length > 0 && fx.voice != null, 'an effect program');
  assert.ok(fx.steps.some((x) => x.type === 'sweep'), 'effects are pitch-sweep programs');
}
console.log('nhl93s-sound-data: ok');
