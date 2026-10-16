/**
 * Tests for the NHL '94 SNES sound data (data/audio/nhl94s-sound.json) and lib/audio/nhl94s-sound-data.js.
 * Hand-worked expectations come from the bytes of SongBrassBonanza in the NHL94SNES disassembly and from the
 * sequencer rules that repo documents (ReadTrackEvent, StepTrack, MusicStart). No ROM is needed: the JSON is the
 * extract, and `node tools/extract-nhl94s-sound.js <NHL94SNES> --check` compares it with a fresh one.
 */
const assert = require('assert');
const L = require('../lib/audio/nhl94s-sound-data');
const dsp = require('../lib/audio/snes-dsp');
const pack = require('../data/audio/nhl94s-sound.json');

const d = L.load(pack);

// --- 1. the pack ---
{
  assert.strictEqual(pack.source.rom.sha1, '10dcd21be9c5542e82b0b94473bf5ff569b36cf5');
  assert.strictEqual(d.songNames.length, 56);
  assert.strictEqual(d.sampleNames.length, 45);
  assert.strictEqual(pack.teams.length, 28);
  assert.strictEqual(pack.teamSongs.length, 28 * 6);
  assert.strictEqual(pack.defaultSongs.length, 8);
  assert.deepStrictEqual(pack.streamSounds, [22, 23, 24, 25, 26, 27]);
  assert.strictEqual(pack.pitchTable.length, 128);
  assert.strictEqual(pack.pitchTable[12 * 7], 0x1000, 'note 84 is the sample rate');
  assert.strictEqual(pack.pitchTable[0], 0x20);
  assert.strictEqual(pack.volumeCurve.length, 128);
  assert.strictEqual(pack.volumeCurve[127], 0x3f);
  assert.strictEqual(d.sounds('game').length, 29);
  assert.strictEqual(d.sounds('menu').length, 56);
  assert.strictEqual(d.sounds('title').length, 56, 'the title set uses the menu sound entries');
  assert.strictEqual(d.sounds('intro').length, 1);
  assert.strictEqual(d.sampleList('game').length, 20);
  assert.strictEqual(d.sampleList('menu').length, 16);
  assert.strictEqual(d.sampleList('title').length, 15);
  for (const sound of d.sounds('game')) assert.strictEqual(sound.raw.length, 48);
}
console.log('nhl94s sound data: pack tables and counts OK');

// --- 2. samples ---
{
  for (const n of d.sampleNames) {
    const s = d.sample(n);
    assert.strictEqual(s.brr.length, s.length, n + ': BRR bytes match the length');
    assert.strictEqual(s.length % 9, 0);
    // the end flag is on the last block only, and the loop flag there matches the header's loop point
    for (let b = 0; b < s.blocks; b++) assert.strictEqual(s.brr[b * 9] & 1, b === s.blocks - 1 ? 1 : 0, n + ' end flag');
    assert.strictEqual((s.brr[s.length - 9] & 2) !== 0, s.loops, n + ' loop flag');
    const r = s.decode();
    assert.strictEqual(r.blocks, s.blocks);
    assert.strictEqual(r.samples.length, s.blocks * 16);
  }
  assert.strictEqual(d.sample('SampleBeep').loops, false);
  assert.strictEqual(d.sample('SampleOrgan').loops, true);
  assert.strictEqual(d.sample('SampleKick').length, 1350, 'SampleKick: header $0546 twice, 1350 bytes of BRR (150 blocks)');
  assert.strictEqual(d.sample('SampleKick').loops, false);
  // a sample plays through the DSP core
  const o = d.sample('SampleOrgan');
  const a = dsp.renderVoice({ brr: o.brr, loopBlock: o.loopBlock, pitch: 0x1000, gain: 0x7f, samples: 4000 });
  const b = dsp.renderVoice({ brr: o.brr, loopBlock: o.loopBlock, pitch: 0x1000, gain: 0x7f, samples: 4000 });
  assert.deepStrictEqual(Buffer.from(a.samples.buffer), Buffer.from(b.samples.buffer));
  assert.ok(a.samples.some((v) => Math.abs(v) > 1000), 'the organ sample is audible');
}
console.log('nhl94s sound data: 45 BRR samples decode, flags consistent, one plays through snes-dsp OK');

// --- 3. every song parses cleanly ---
{
  for (const n of d.songNames) {
    const s = d.song(n);
    assert.strictEqual(s.tracks.length, s.trackCount, n + ': track count in the header');
    assert.ok(s.tempo > 0);
    for (const t of s.tracks) {
      const last = t.events[t.events.length - 1];
      assert.ok(last && (last.type === 'stop' || last.type === 'loop'), n + ' track ' + t.index + ' ends');
      assert.ok(t.events.every((e) => e.type !== 'unknown'), n + ': no unknown events');
      assert.ok(t.name, n + ' track ' + t.index + ' has a name');
    }
  }
  assert.strictEqual(d.song('TitleSong').tracks[9].name, 'drums');
  assert.strictEqual(d.song('TitleSong').tracks.length, 13);
}
console.log('nhl94s sound data: all 56 songs parse (track counts, ends, event codes) OK');

// --- 4. SongBrassBonanza, from its bytes ---
{
  // header 01 78 01 00 00 00 02 00: tempo $78 (120), 2 tracks; the left track starts
  //   00 E7 05 "left" 00 | 00 DC 0B | 01 AD 6E 0C | 13 AD 6E 0D | 13 AD 6E 0C
  const s = d.song('SongBrassBonanza');
  assert.strictEqual(s.tempo, 0x78);
  assert.strictEqual(s.trackCount, 2);
  assert.deepStrictEqual(s.tracks.map((t) => t.name), ['left', 'right']);
  const w = L.walk(s.tracks[0]);
  assert.deepStrictEqual(w.events.slice(0, 5).map((e) => e.tick), [0, 0, 1, 20, 39]);
  const [name, inst, n1, n2, n3] = w.events.map((e) => e.event);
  assert.strictEqual(name.type, 'name');
  assert.strictEqual(inst.type, 'instrument');
  assert.strictEqual(inst.sound, 0x0b);
  assert.deepStrictEqual([n1.code, n1.velocity, n1.duration], [0xad, 0x6e, 0x0c]);
  assert.strictEqual(n1.key, 0x2d, 'pitch uses the note & $7F');
  assert.deepStrictEqual([n2.code, n2.velocity, n2.duration], [0xad, 0x6e, 0x0d]);
  assert.deepStrictEqual([n3.code, n3.velocity, n3.duration], [0xad, 0x6e, 0x0c]);
  // the organ: sound $B of the game set (left; $C is the right one) is SampleOrgan, sample 10 of the list, with ADSR (bit 7 of ADSR1 set)
  assert.strictEqual(d.soundSample(d.songSet('SongBrassBonanza'), 0x0b), 'SampleOrgan');
  const organ = d.sound('game', 0x0b);
  assert.strictEqual(organ.adsr, true);
  assert.deepStrictEqual([organ.adsr1, organ.adsr2, organ.volL, organ.volR, organ.sample], [0xff, 0xe0, 88, 48, 10]);
}
console.log('nhl94s sound data: SongBrassBonanza matches its bytes OK');

// --- 5. event parsing, loops, timing ---
{
  // multi-byte variable-length numbers: delay $81 $00 = 128, note duration $82 $01 = 257
  const ev = L.parseTrack(Uint8Array.from([0x00, 0xdc, 0x05, 0x81, 0x00, 0x30, 0x40, 0x82, 0x01, 0x00, 0xd9]), 0);
  assert.deepStrictEqual(ev.map((e) => e.type), ['instrument', 'note', 'stop']);
  assert.strictEqual(ev[1].delay, 128);
  assert.strictEqual(ev[1].duration, 257);
  // every event kind with its operand count: name (length + bytes), controller (2), bend (2), tempo, volume, mark, E3
  const all = L.parseTrack(Uint8Array.from([
    0x00, 0xe7, 0x03, 0x61, 0x62, 0x00, 0x00, 0xdf, 0x07, 0x50, 0x00, 0xe5, 0x40, 0x00, 0x00, 0xdd, 0x54,
    0x00, 0xde, 0x70, 0x00, 0xe2, 0x01, 0x00, 0xe3, 0x00, 0xea, 0x09, 0x00, 0xd9]), 0);
  assert.deepStrictEqual(all.map((e) => e.type), ['name', 'controller', 'bend', 'tempo', 'volume', 'mark', 'e3', 'ea', 'stop']);
  assert.strictEqual(all[0].text, 'ab');
  assert.deepStrictEqual([all[1].controller, all[1].value], [7, 0x50]);
  assert.strictEqual(all[3].value, 0x54);
  // loop: the body from the mark plays again; the delay before the mark is not waited the second time, the loop's is
  const tr = { events: L.parseTrack(Uint8Array.from([0x00, 0xdc, 0x05, 0x00, 0xe2, 0x00, 0x00, 0x30, 0x40, 0x04, 0x04, 0xdb]), 0) };
  const w = L.walk(tr, { repeat: 2 });
  assert.deepStrictEqual(w.events.map((e) => e.tick), [0, 0, 0, 4, 4, 8]);
  assert.strictEqual(w.endTick, 8);
  assert.strictEqual(L.walk(tr, { repeat: 1 }).events.length, 4);
}
{
  // tempo 120 NTSC: tick length (10080 / 120) & $FF = 84; the counter gains 64 a frame -> ticks on frames 1, 2, 3, 5
  assert.deepStrictEqual(L.tickFrames({ tempo: 120 }, 5), [1, 2, 3, 5, 6, 7]);
  // PAL uses 8160 / 120 = 68 -> ticks on frames 1, 2, 3, 4 ... (64 per frame against 68: 0.94 ticks a frame)
  assert.deepStrictEqual(L.tickFrames({ tempo: 120 }, 3, { region: 'pal' }), [1, 2, 3, 4]);
  // a $DD event after tick 1 changes the tick length (here to 64: one tick every frame)
  assert.deepStrictEqual(L.tickFrames({ tempo: 120 }, 4, { tempoChanges: [{ tick: 1, value: 64 }] }), [1, 2, 3, 4, 5]);
}
console.log('nhl94s sound data: events, variable-length numbers, loops and tick timing OK');

// --- 6. the sound tables and team songs ---
{
  assert.strictEqual(d.soundSample('game', 0), 'SamplePassShot');
  assert.strictEqual(d.soundSample('game', 1), 'SamplePassShot');
  assert.strictEqual(d.soundSample('menu', 0), 'SampleKick');
  assert.strictEqual(d.soundSample('menu', 1), 'SampleKick');
  assert.strictEqual(d.soundSample('intro', 0), 'SampleEASportsVoice');
  assert.deepStrictEqual(d.teamSongs('ANH'), [null, null, null, null, null, null]);
  assert.deepStrictEqual(d.teamSongs('BOS'), ['SongHereWeGo', 'SongChargeEFlat', 'SongGoTeamGoEFlat', null, 'SongDefense', 'SongHereWeGo']);
  assert.deepStrictEqual(pack.defaultSongs.slice(0, 2), ['SongSabreDance', 'SongBrassBonanza']);
  assert.strictEqual(d.songSet('SongZorba'), 'game');
  assert.strictEqual(d.songSet('TitleSong'), 'menu');
  // every sound entry of the sets that songs use points at a sample in its list
  for (const set of ['game', 'menu']) {
    d.sounds(set).forEach((s, i) => {
      if (s.sample >= d.sampleList(set).length) return; // streamed slot / unused entries
      assert.ok(pack.samples[d.sampleList(set)[s.sample]], set + ' sound ' + i);
    });
  }
  // every note of every song names an instrument sound that exists in the set it plays with
  for (const n of d.songNames) {
    const set = d.songSet(n);
    const count = d.sounds(set).length;
    for (const t of d.song(n).tracks) for (const e of t.events) if (e.type === 'instrument') assert.ok(e.sound < count, n + ': sound ' + e.sound);
  }
}
console.log('nhl94s sound data: sound entries, sample lists, team songs and instrument references OK');

// --- 7. the SPC700 program runs on the step 1 core ---
{
  const snes = require('../lib/audio/snes-spc');
  const u = snes.create();
  const code = new Uint8Array(Buffer.from(pack.driver.code, 'base64'));
  assert.strictEqual(code.length, pack.driver.length);
  assert.strictEqual(pack.driver.load, 0x0400);
  u.iplUpload([{ addr: pack.driver.load, bytes: code }], pack.driver.load);
  // the driver clears sound RAM above itself and sets up the DSP, then waits in its main loop with port 0 = 0
  let guard = 0;
  while (u.portRead(0) !== 0 && guard++ < 3000000) u.step();
  assert.strictEqual(u.portRead(0), 0, 'driver reached its main loop');
  assert.strictEqual(u.cpu.pc, 0x04da);
  assert.ok(u.cycles > 800000 && u.cycles < 900000, 'RAM clear + DSP setup take about 0.85 s of sound-CPU time: ' + u.cycles);
  assert.strictEqual(u.dsp.read(0x6d), 0x01, 'ESA set by the driver');
  // command $01 (reset): the driver answers $01 on port 0 and waits for the main CPU to clear it, then is back in its main loop
  u.portWrite(0, 0x01);
  guard = 0;
  while (u.portRead(0) === 0 && guard++ < 500000) u.step();
  assert.strictEqual(u.portRead(0), 0x01);
  u.portWrite(0, 0x00);
  guard = 0;
  while (u.portRead(0) !== 0 && guard++ < 500000) u.step();
  guard = 0;
  while (u.cpu.pc !== 0x04dc && guard++ < 1000) u.step();
  assert.strictEqual(u.cpu.pc, 0x04dc, 'back at the command wait');
}
console.log('nhl94s sound data: the extracted SPC700 program boots and answers the reset command on snes-spc OK');
