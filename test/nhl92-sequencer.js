/**
 * NHL '92 sequencer and MIDI tools (docs/NHL92-SEQUENCER.md): the MIDI reader/writer
 * (lib/audio/smf.js), the song model and cmdstream encoder (lib/audio/nhl92-song.js) and the
 * conversions to and from General MIDI (lib/audio/nhl92-song-gm.js).
 *
 * The strongest check runs the encoder's output on the retail drivers: every retail song is
 * decoded to the model, built back into cmdstreams, put into a copy of the sound ROM as song 4
 * and played by the same 68k + Z80 chain; the notes the YM2612 receives must be the retail
 * song's notes. Time is compared to one frame (the key-on write lands anywhere in a frame, and
 * the frame it is rounded to depends on how much the Z80 did before it).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Smf = require('../lib/audio/smf');
const Song = require('../lib/audio/nhl92-song');
const SongGm = require('../lib/audio/nhl92-song-gm');
const Ref = require('../lib/audio/gm-reference');
const G = require('../lib/audio/nhl92-gm-map');
const sd = require('../lib/audio/nhl92-sound-data');
const fixture = require('../lib/audio/nhl92-sound-fixture');
const Chain = require('../lib/audio/nhl92-sound-chain');
const Tracker = require('../lib/audio/ym-note-tracker');

const map = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'audio', 'nhl92-gm-map.json'), 'utf8'));
const rom = fixture.resolveRom(null);
const data = sd.parse(rom);
const F = Chain.FRAME_TSTATES;
const FRAMES = 400;

/** Play song `id` of `romBytes` for FRAMES vblanks and return, per FM channel, [frame, midi, patchId] of each note. */
function play(romBytes, id) {
  const tr = Tracker.create();
  const chain = Chain.create({
    rom: romBytes, keepLogs: false,
    onYmWrite: (t, port, v) => tr.writePort(t, port, v),
    onPsgWrite: (t, v) => tr.psgWrite(t, v),
    onYmReset: (t) => tr.reset(t)
  });
  const plan = Chain.songPlan(id, FRAMES);
  for (let f = 0; f < plan.frames; f++) chain.step(plan.calls[f] || null);
  const perChannel = [[], [], [], [], [], []];
  const bursts = tr.patches.filter((p) => p.kind === 'patch');
  for (const n of tr.notes) {
    const burst = bursts.filter((p) => p.ch === n.ch && p.t0 <= n.t0).pop();
    perChannel[n.ch].push([Math.round(n.t0 / F), n.segs[0].midi, burst ? Song.identifyPatch(data.patches, burst.regs, n.ch) : -1]);
  }
  return { notes: perChannel, bursts };
}

// --- MIDI file reader / writer ------------------------------------------------------------------
{
  const notes = [];
  for (let i = 0; i < 8; i++) notes.push({ tick: i * 240, dur: 200, pitch: 60 + i, vel: 90, program: i < 4 ? 0 : 5 });
  const bass = [{ tick: 0, dur: 960, pitch: 36, vel: 100, program: 33 }, { tick: 960, dur: 960, pitch: 43, vel: 100, program: 33 }];
  const drums = [{ tick: 0, dur: 60, pitch: 36, vel: 100 }, { tick: 480, dur: 60, pitch: 38, vel: 100 }];
  const bytes = Smf.write({ ppq: 480, tempos: [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 90 }], name: 'test', tracks: [{ name: 'Lead', ch: 0, notes }, { name: 'Bass', ch: 1, notes: bass }, { name: 'Drums', ch: 9, notes: drums }] });
  assert.deepStrictEqual(Array.from(bytes), Array.from(Smf.write({ ppq: 480, tempos: [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 90 }], name: 'test', tracks: [{ name: 'Lead', ch: 0, notes }, { name: 'Bass', ch: 1, notes: bass }, { name: 'Drums', ch: 9, notes: drums }] })), 'the writer is deterministic');
  const p = Smf.parse(bytes);
  assert.strictEqual(p.ppq, 480);
  assert.strictEqual(p.notes.length, 12);
  assert.deepStrictEqual(p.warnings, [], 'GM System On is not reported');
  assert.deepStrictEqual(p.tempos.map((t) => [t.tick, Math.round(t.bpm)]), [[0, 120], [960, 90]]);
  assert.deepStrictEqual(p.programs.map((x) => [x.ch, x.tick, x.program]), [[0, 0, 0], [0, 960, 5], [1, 0, 33]]);
  const lead = p.notes.filter((n) => n.ch === 0);
  assert.deepStrictEqual(lead.map((n) => [n.tick, n.dur, n.pitch]), notes.map((n) => [n.tick, n.dur, n.pitch]));
  assert.strictEqual(p.notes.filter((n) => n.ch === 9).length, 2);
  assert.deepStrictEqual(p.trackNames.slice(1), ['Lead', 'Bass', 'Drums']);

  // A hand-made format 0 file with running status, a velocity-0 note-off and an unterminated note.
  const f0 = Uint8Array.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
    0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 24,
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // 120 BPM
    0x00, 0xc0, 0x13, // program 19 on channel 1
    0x00, 0x90, 60, 100, // note on
    0x60, 60, 0, // running status, velocity 0 = note off
    0x00, 62, 100, // note on, never turned off
    0x00, 0xff, 0x2f, 0x00
  ]);
  const q = Smf.parse(f0);
  assert.strictEqual(q.format, 0);
  assert.deepStrictEqual(q.notes.map((n) => [n.tick, n.dur, n.pitch, n.ch]), [[0, 96, 60, 0], [96, 1, 62, 0]]);
  assert.strictEqual(q.programs[0].program, 19);
  assert.strictEqual(Math.round(q.tempos[0].bpm), 120);
  assert.throws(() => Smf.parse(Uint8Array.from([1, 2, 3, 4])), /Not a MIDI file/);
  assert.throws(() => Smf.parse(Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1, 0xe7, 0x28])), /SMPTE/);
  console.log('nhl92 sequencer: MIDI files write deterministically and read back (format 0 and 1, running status, tempo, programs) OK');
}

// --- The retail songs survive decode -> cmdstream -> retail drivers ------------------------------
let patchBursts = 0;
{
  for (let id = 0; id < 5; id++) {
    const model = Song.fromParsed(data, id);
    const built = Song.build(model);
    assert.deepStrictEqual(built.problems, [], 'song ' + id + ' builds cleanly');
    const rom2 = Song.romWithSong(rom, built);
    // The retail data outside the replaced pattern block is untouched.
    for (let a = 0; a < rom.length; a++) {
      if (a >= Song.PATTERN_START && a < Song.PATTERN_END) continue;
      if (a >= Song.SONG_TABLE + 4 * Song.SONG_STRIDE && a < Song.SONG_TABLE + 5 * Song.SONG_STRIDE) continue;
      if (rom[a] !== rom2[a]) assert.fail('romWithSong changed byte $' + a.toString(16));
    }
    const retail = play(rom, id);
    const rebuilt = play(rom2, Song.CUSTOM_SONG);
    let compared = 0;
    for (let c = 0; c < 6; c++) {
      const a = retail.notes[c];
      const b = rebuilt.notes[c];
      assert.strictEqual(b.length, a.length, 'song ' + id + ' FM' + (c + 1) + ': same number of notes');
      a.forEach((n, i) => {
        assert.strictEqual(b[i][1], n[1], 'song ' + id + ' FM' + (c + 1) + ' note ' + i + ' pitch');
        assert.strictEqual(b[i][2], n[2], 'song ' + id + ' FM' + (c + 1) + ' note ' + i + ' instrument');
        assert.ok(Math.abs(b[i][0] - n[0]) <= 1, 'song ' + id + ' FM' + (c + 1) + ' note ' + i + ' frame ' + n[0] + ' vs ' + b[i][0]);
        compared += 1;
      });
    }
    patchBursts += rebuilt.bursts.length;
    for (const p of rebuilt.bursts) assert.ok(Song.identifyPatch(data.patches, p.regs, p.ch) >= 0, 'every patch load is a retail patch');
    // And the model itself is what plays: the Nth note of a channel sits at its unit * tempo (+ a constant start offset).
    model.channels.forEach((notes, c) => {
      const seen = rebuilt.notes[c];
      for (let i = 0; i < seen.length; i++) {
        assert.ok(Math.abs(seen[i][0] - notes[i].unit * model.tempo - (seen[0][0] - notes[0].unit * model.tempo)) <= 1, 'song ' + id + ' FM' + (c + 1) + ' note ' + i + ' is on the grid');
        assert.strictEqual(seen[i][1], notes[i].index + 12);
      }
    });
    assert.ok(compared > 50, 'song ' + id + ' compared ' + compared + ' notes');
  }
  assert.ok(patchBursts > 20);
  console.log('nhl92 sequencer: all 5 retail songs, decoded and re-encoded, play the same notes and instruments on the retail drivers (first ' + FRAMES + ' vblanks, ±1 frame) OK');
}

// --- A song made from scratch --------------------------------------------------------------------
{
  const s = Song.emptySong(6);
  s.channels[0] = [0, 2, 4, 5, 7, 9, 11, 12].map((d, i) => ({ unit: i * 2, len: 2, index: 48 + d, patch: 6 }));
  s.channels[1] = [{ unit: 0, len: 8, index: 36, patch: 1 }, { unit: 8, len: 8, index: 43, patch: 1 }];
  s.channels[4] = [0, 4, 8, 12].map((u) => ({ unit: u, len: 1, index: 9, patch: 3 })); // low kick hits
  s.units = 32;
  const built = Song.build(s);
  assert.deepStrictEqual(built.problems, []);
  const got = play(Song.romWithSong(rom, built), Song.CUSTOM_SONG);
  // 32 units of tempo 6 = 192 frames; the song then loops, so look at the first pass (the first 8 / 2 / 4 notes).
  const frames = (c) => got.notes[c].map((n) => n[0] - got.notes[c][0][0]);
  assert.deepStrictEqual(got.notes[0].slice(0, 8).map((n) => n[1]), s.channels[0].map((n) => n.index + 12));
  assert.deepStrictEqual(got.notes[0].slice(0, 8).map((n) => n[2]), new Array(8).fill(6));
  assert.deepStrictEqual(frames(0).slice(0, 8).map((f, i) => Math.abs(f - i * 12) <= 1), new Array(8).fill(true), 'FM1 eighth notes are 12 frames apart');
  assert.ok(frames(0)[8] >= 191 && frames(0)[8] <= 193, 'the song loops after 192 frames');
  assert.deepStrictEqual(got.notes[1].slice(0, 2).map((n) => n[1]), [48, 55]);
  assert.ok(got.notes[1].every((n) => n[2] === 1));
  assert.ok(got.notes[4].length >= 4 && got.notes[4].every((n) => n[2] === 3));
  assert.deepStrictEqual(got.notes[4].slice(0, 4).map((n) => n[1]), [21, 21, 21, 21]);
  assert.deepStrictEqual(got.notes[2], [], 'an unused channel stays silent');
  // Bytes: instrument, duration and notes are as documented in docs/NHL92-SOUND-DATA.md.
  assert.deepStrictEqual(built.channels[0].patterns[0], [0x80, 6, 0xa2, 48, 50, 52, 53, 55, 57, 59, 60, 0x84]);
  assert.deepStrictEqual(built.channels[0].order, [0, 1], 'one bar of notes, then one bar of rest');
  assert.strictEqual(built.channels[2].patterns.length, 1, 'a silent channel is one rest pattern');
  // Patch 4 plays 3 below the note byte (its note offset is -3), so the byte is written 3 higher.
  const snare = Song.build(Object.assign(Song.emptySong(6), { channels: [[{ unit: 0, len: 1, index: 18, patch: 4 }], [], [], [], [], []], units: 16 }));
  assert.deepStrictEqual(snare.channels[0].patterns[0].slice(0, 4), [0x80, 4, 0xa1, 21]);
  assert.deepStrictEqual(Song.NOTE_OFFSETS, data.patches.map((p) => p.noteOffset), 'note offsets match the retail patches');
  console.log('nhl92 sequencer: a hand-made 3-channel song plays its notes, instruments and timing on the retail drivers OK');

  // Problems are reported, not hidden.
  const bad = Song.build({ tempo: 6, units: 16, channels: [[{ unit: 0, len: 4, index: 120, patch: 1 }, { unit: 4, len: 120, index: 40, patch: 1 }], [], [], [], [], []] });
  assert.ok(bad.problems.some((p) => /outside the driver/.test(p)) && bad.problems.some((p) => /longest duration/.test(p)));
  assert.throws(() => Song.build(Song.emptySong(6)), /empty/);
  const huge = Song.emptySong(6);
  for (let c = 0; c < 6; c++) for (let i = 0; i < 500; i++) huge.channels[c].push({ unit: i, len: 1, index: 20 + ((i * 7 + c * 13) % 60), patch: (i + c) % 22 });
  huge.units = 500;
  assert.throws(() => Song.romWithSong(rom, Song.build(huge, { barUnits: 4 })), /retail pattern block/);
  // Exports.
  const asm = Song.toAsm(built, 'my song');
  assert.ok(/fmtune_my_song:/.test(asm) && /my_song_ch5_orderlist:/.test(asm) && /dc\.w \$0000\t; restart/.test(asm));
  assert.strictEqual(asm, Song.toAsm(built, 'my song'));
  const bin = Song.toBinary(built);
  assert.strictEqual(bin[0], 5);
  assert.strictEqual(bin[1], 6);
  for (let ch = 0; ch < 6; ch++) {
    const list = (bin[2 + ch * 4 + 2] << 8) | bin[2 + ch * 4 + 3];
    const first = (bin[list] << 8) | bin[list + 1];
    let end = first;
    while (bin[end] !== 0x84) end++;
    assert.ok(end > first && first >= 26);
  }
  console.log('nhl92 sequencer: build problems are reported, an over-long song is refused, asm and binary exports are well formed OK');
}

// --- General MIDI conversions ---------------------------------------------------------------------
{
  for (let id = 0; id < 5; id++) {
    const model = Song.fromParsed(data, id);
    const out = SongGm.nhlToGm(model, map);
    const total = model.channels.reduce((n, c) => n + c.length, 0);
    assert.strictEqual(out.song.notes.length, total, 'song ' + id + ': every note converts');
    out.song.notes.forEach((n) => {
      if (n.ch === 9) assert.ok(n.pitch >= G.DRUM_FIRST && n.pitch <= G.DRUM_LAST, 'a drum hit is in the GM kit');
      else assert.ok(n.program >= 0 && n.program <= 127);
    });
    // GM file out and back in keeps every note.
    const again = Smf.parse(Smf.write(SongGm.toSmfSong(out.song)));
    assert.strictEqual(again.notes.length, total);
    const norm = SongGm.normalizeGm(again);
    assert.strictEqual(norm.song.notes.length, total);
    const ev = SongGm.gmEvents(norm.song);
    assert.strictEqual(ev.length, total);
    assert.ok(ev.every((e, i) => i === 0 || e.time >= ev[i - 1].time));
    const nhl = SongGm.gmToNhl(norm.song, map);
    assert.ok(nhl.stats.lines <= 6);
    const built = Song.build(nhl.song);
    assert.deepStrictEqual(built.problems, [], 'song ' + id + ' GM round trip builds cleanly');
    nhl.song.channels.forEach((list) => list.forEach((n) => {
      if (n.patch !== 3 && n.patch !== 4) assert.ok(n.index >= 9 && n.index <= 90, 'melodic notes are folded into the driver range');
    }));
  }
  // Deterministic.
  const a = SongGm.gmToNhl(SongGm.normalizeGm(Smf.parse(Smf.write(SongGm.toSmfSong(SongGm.nhlToGm(Song.fromParsed(data, 1), map).song)))).song, map);
  const b = SongGm.gmToNhl(SongGm.normalizeGm(Smf.parse(Smf.write(SongGm.toSmfSong(SongGm.nhlToGm(Song.fromParsed(data, 1), map).song)))).song, map);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  // The six-channel limit and the report.
  const wide = { ppq: 480, tempos: [{ tick: 0, bpm: 120 }], notes: [] };
  for (let ch = 0; ch < 8; ch++) for (let i = 0; i < 4; i++) wide.notes.push({ tick: i * 480, dur: 400, ch: ch === 8 ? 9 : ch, pitch: 50 + ch, vel: 90, program: ch * 8 });
  wide.notes.push({ tick: 0, dur: 100, ch: 9, pitch: 36, vel: 100, program: null }, { tick: 480, dur: 100, ch: 9, pitch: 38, vel: 100, program: null });
  const wr = SongGm.gmToNhl(wide, map);
  assert.strictEqual(wr.stats.lines, 6);
  assert.ok(wr.report.some((l) => /Dropped/.test(l)));
  assert.ok(wr.song.channels.some((c) => c.some((n) => n.patch === 3)) && wr.song.channels.some((c) => c.some((n) => n.patch === 4)), 'kick and snare outrank melody lines');
  // A chord keeps one note per onset (highest; the bass line keeps the lowest).
  const chord = { ppq: 480, tempos: [{ tick: 0, bpm: 120 }], notes: [60, 64, 67].map((p) => ({ tick: 0, dur: 480, ch: 0, pitch: p, vel: 90, program: 0 })).concat([40, 47].map((p) => ({ tick: 0, dur: 480, ch: 1, pitch: p, vel: 90, program: 33 }))) };
  const cr = SongGm.gmToNhl(chord, map);
  assert.deepStrictEqual(cr.song.channels.filter((c) => c.length).map((c) => c[0].index + 12).sort((x, y) => x - y), [40, 67]);
  // Tempo: 120 BPM at 4 units per quarter is tempo 7 (the driver counts whole frames).
  assert.strictEqual(cr.song.tempo, 7);
  // Normalisation: out-of-kit drum notes move, programs come from the program changes, zero-length notes get a tick.
  const norm = SongGm.normalizeGm({ format: 1, ppq: 96, tempos: [], warnings: [], notes: [
    { tick: 0, dur: 10, ch: 9, pitch: 27, vel: 100, track: 1 }, { tick: 0, dur: 10, ch: 9, pitch: 90, vel: 100, track: 1 },
    { tick: 0, dur: 0, ch: 2, pitch: 60, vel: 0, track: 1 }, { tick: 200, dur: 10, ch: 2, pitch: 60, vel: 100, track: 1 }, { tick: 200, dur: 10, ch: 2, pitch: 60, vel: 100, track: 1 }
  ], programs: [{ tick: 0, ch: 2, program: 24, track: 1 }, { tick: 100, ch: 2, program: 73, track: 1 }] });
  assert.deepStrictEqual(norm.song.notes.map((n) => [n.ch, n.pitch, n.program]), [[9, 35, null], [9, 81, null], [2, 60, 24], [2, 60, 73]]);
  assert.strictEqual(norm.song.tempos[0].bpm, 120);
  assert.strictEqual(norm.stats.dropped, 1);
  console.log('nhl92 sequencer: GM conversions keep every note, respect six channels and the drum kit, fold the range and repeat exactly OK');
}

// --- The reference synth plays whole songs ---------------------------------------------------------
{
  const gm = SongGm.nhlToGm(Song.fromParsed(data, 4), map).song;
  const ev = SongGm.gmEvents(gm).filter((e) => e.time < 6);
  const a = Ref.renderEvents(ev);
  const b = Ref.renderEvents(ev);
  assert.deepStrictEqual(a, b);
  let peak = 0;
  for (const v of a) { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)); }
  assert.ok(Math.abs(peak - 0.5) < 1e-6 && a.length > 6 * Ref.SAMPLE_RATE);
  console.log('nhl92 sequencer: the reference synth mixes a song deterministically and audibly OK');
}
