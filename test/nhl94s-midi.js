/**
 * Tests for lib/audio/nhl94s-midi.js: the song byte format, MIDI export (GM and native), MIDI import.
 * The 56 retail songs in data/audio/nhl94s-sound.json are the fixtures: every one must be written back byte for byte,
 * come back from a native MIDI file as the same song, and survive a GM export and import with its notes and timing.
 */
const assert = require('assert');
const Midi = require('../lib/audio/nhl94s-midi');
const Smf = require('../lib/audio/smf');
const SoundData = require('../lib/audio/nhl94s-sound-data');
const Player = require('../lib/audio/nhl94s-player');
const pack = require('../data/audio/nhl94s-sound.json');
const gm = require('../data/audio/nhl94s-gm-map.json');
const d = SoundData.load(pack);

const noteCount = (song) => song.tracks.reduce((n, t) => n + t.events.filter((e) => e.type === 'note').length, 0);

// --- 1. the song format: every retail song is rebuilt exactly ---
{
  for (const name of d.songNames) {
    const orig = d.songBytes(name);
    const song = d.song(name);
    const built = Midi.buildSong(Midi.modelOf(song, orig));
    assert.strictEqual(built.length, orig.length, name + ': same size');
    const a = Buffer.from(orig);
    const b = Buffer.from(built);
    // the last track's length field is the one the retail tool computed three different ways (never read by the game): not compared
    const last = song.tracks[song.tracks.length - 1].offset - 6;
    a[last] = a[last + 1] = b[last] = b[last + 1] = 0;
    assert.ok(a.equals(b), name + ': same bytes, every other chunk length included');
  }
  // a small song written by hand: one track, a name, an instrument, a note, a stop
  const bytes = Midi.buildSong({ tempo: 120, tracks: [{ events: [
    { delay: 0, type: 'name', text: 'x' }, { delay: 0, type: 'instrument', value: 11 },
    { delay: 4, type: 'note', code: 0xad, velocity: 100, duration: 200 }, { delay: 200, type: 'stop', code: 0xd9 }
  ] }] });
  assert.deepStrictEqual(Array.from(bytes.subarray(0, 8)), [1, 120, 1, 0, 0, 0, 1, 0]);
  assert.deepStrictEqual(Array.from(bytes.subarray(8, 12)), [48, 0, 0, 0], 'the first track starts at 48');
  const body = [0, 0xe7, 2, 0x78, 0, 0, 0xdc, 11, 4, 0xad, 100, 0x81, 0x48, 0x81, 0x48, 0xd9];
  assert.deepStrictEqual(Array.from(bytes.subarray(42)), [0, body.length + 8, 0x54, 0x52, 0x41, 0x4b].concat(body), 'chunk: length, TRAK, records');
  const back = SoundData.parseSong(bytes);
  assert.strictEqual(back.tracks[0].events[2].duration, 200);
  assert.strictEqual(back.tempo, 120);
}

// --- 2. native MIDI: every song comes back with the same events on the same ticks ---
{
  const perTick = (song) => song.tracks.map((t) => {
    let tick = 0;
    return t.events.map((e, i) => { if (i) tick += e.delay; return tick + ':' + JSON.stringify(Object.assign({}, e, { delay: 0, name: undefined })); }).sort().join('|');
  });
  for (const name of d.songNames) {
    const smf = Midi.toSmf(d, gm, name, { native: true });
    const r = Midi.fromSmf(smf, d, gm, {});
    assert.ok(r.report.native, name + ': read as native');
    const back = SoundData.parseSong(r.bytes);
    assert.strictEqual(back.tempo, d.song(name).tempo, name + ': tempo');
    assert.deepStrictEqual(perTick(back), perTick(d.song(name)), name + ': same events');
  }
}

// --- 3. GM export: notes, drums, programs ---
{
  const name = 'SongBrassBonanza';
  const p = Smf.parse(Midi.toSmf(d, gm, name, {}));
  assert.strictEqual(p.notes.length, noteCount(d.song(name)));
  assert.strictEqual(p.ppq, 24);
  // the first note: code $AD plus the organ's note offset 24 = key 69 (A4), drawbar organ
  const first = p.notes.filter((n) => n.ch === 0).sort((a, b) => a.tick - b.tick)[0];
  assert.strictEqual(first.pitch, 69);
  assert.ok(p.programs.some((x) => x.program === 16));
  // tempo: byte 120 -> tick length 84/64 frames -> 24 ticks a quarter note at about 114.5 bpm
  assert.ok(Math.abs(p.tempos[0].bpm - 114.5) < 0.5, 'bpm ' + p.tempos[0].bpm);
  // a menu song has a drum track on MIDI channel 10 with GM drum notes
  const m = Smf.parse(Midi.toSmf(d, gm, 'MenuSong', {}));
  const drums = m.notes.filter((n) => n.ch === 9);
  assert.ok(drums.length > 50);
  assert.ok(drums.every((n) => n.pitch >= 35 && n.pitch <= 59), 'GM percussion keys');
  assert.ok(drums.some((n) => n.pitch === 36) && drums.some((n) => n.pitch === 42), 'kick and closed hat');
}

// --- 4. GM import: a hand-made file ---
{
  // 120 bpm, 480 per quarter: a brass note (program 61) of one quarter at key 60, then another at tick 480; a kick on channel 10
  const smf = Smf.write({ ppq: 480, tempos: [{ tick: 0, bpm: 120 }], tracks: [
    { name: 'lead', ch: 0, notes: [{ tick: 0, dur: 480, pitch: 60, vel: 100, program: 61 }, { tick: 480, dur: 480, pitch: 62, vel: 100, program: 61 }] },
    { name: 'drums', ch: 9, notes: [{ tick: 0, dur: 100, pitch: 36, vel: 120 }, { tick: 240, dur: 100, pitch: 99, vel: 120 }] }
  ] });
  const r = Midi.fromSmf(smf, d, gm, { set: 'menu' });
  const song = SoundData.parseSong(r.bytes);
  assert.strictEqual(song.tempo, 160);
  assert.strictEqual(song.trackCount, 10, 'drums on track 9: nine tracks come before it');
  const lead = song.tracks[0].events.filter((e) => e.type === 'note' || e.type === 'instrument');
  assert.strictEqual(lead[0].type, 'instrument');
  assert.strictEqual(lead[0].sound, 20, 'brass program -> the preferred brass entry');
  // tick length at tempo byte 160: floor(10080 / 160) = 63 -> 63/64 frame = 16.38 ms: 0.5 s = 30.5 ticks
  assert.ok(lead[1].duration === 31 || lead[1].duration === 30);
  assert.strictEqual(lead[1].code, 0x80 | ((60 - d.sound('menu', 20).noteOffset) & 0x7f), 'code = key - the entry\'s note offset');
  assert.strictEqual(lead[2].delay + lead[1].delay + 0 >= 29, true);
  assert.strictEqual(r.report.notes, 3, 'the unmapped drum key 99 is dropped');
  assert.ok(r.report.warnings.some((w) => /drum note 99/.test(w)));
  const drum = song.tracks[9].events.filter((e) => e.type === 'note');
  assert.strictEqual(drum[0].code, 0x2f + 1, 'kick = sound entry 1');
  assert.strictEqual(song.tracks[0].events.slice(-1)[0].type, 'stop');
  // play it: the first record's delay is dropped by the player, so every track must open with a name for the notes to keep their time
  {
    const pl = Player.create({ data: d });
    pl.boot();
    pl.loadSet('menu');
    pl.logCommands(true);
    pl.startSongBytes(r.bytes);
    pl.record();
    pl.runFrames(75);
    const keys = pl.commands.filter((c) => c.name === 'keyOn');
    assert.strictEqual(keys.length, 3, 'two brass notes and the kick sound');
    const lead2 = keys.filter((k) => k.args.sample !== 0 && k.frame > 5);
    assert.ok(lead2.length === 1 && Math.abs(lead2[0].frame - 30.5) <= 2, 'the second brass note starts at 0.5 s (frame ~30): ' + JSON.stringify(keys.map((k) => k.frame)));
    let peak = 0;
    const pcm = pl.stopRecording();
    for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    assert.ok(peak > 3000, 'audible: ' + peak);
  }
  // loop: a mark at the start, a loop jump at the end
  const looped = SoundData.parseSong(Midi.fromSmf(smf, d, gm, { set: 'menu', loop: true }).bytes);
  assert.strictEqual(looped.tracks[0].events[0].type, 'mark');
  assert.strictEqual(looped.tracks[0].events.slice(-1)[0].type, 'loop');
  // more than eight notes at once is reported
  const chord = Smf.write({ ppq: 480, tempos: [{ tick: 0, bpm: 120 }], tracks: [{ name: 'c', ch: 0, notes: Array.from({ length: 10 }, (_, i) => ({ tick: 0, dur: 480, pitch: 50 + i, vel: 100, program: 61 })) }] });
  assert.ok(Midi.fromSmf(chord, d, gm, {}).report.warnings.some((w) => /10 notes sound at once/.test(w)));
}

// --- 5. GM round trip on retail songs: same notes, same frames, and the sound unit plays the result ---
{
  for (const [name, set] of [['SongBrassBonanza', 'game'], ['MenuSong', 'menu'], ['TitleSong', 'menu']]) {
    const r = Midi.fromSmf(Midi.toSmf(d, gm, name, {}), d, gm, { set });
    const back = SoundData.parseSong(r.bytes);
    assert.strictEqual(noteCount(back), noteCount(d.song(name)), name + ': notes');
    assert.strictEqual(back.tracks.length, d.song(name).tracks.length, name + ': tracks');
  }
  const name = 'SongBirthday';
  const r = Midi.fromSmf(Midi.toSmf(d, gm, name, {}), d, gm, { set: 'game' });
  const run = (start) => {
    const p = Player.create({ data: d });
    p.boot();
    p.loadSet('game');
    p.logCommands(true);
    start(p);
    p.runFrames(600);
    return p.commands.filter((c) => c.name === 'keyOn').map((c) => c.frame);
  };
  const a = run((p) => p.startSong(name));
  const b = run((p) => p.startSongBytes(r.bytes));
  assert.strictEqual(a.length, b.length);
  a.forEach((f, i) => assert.ok(Math.abs(f - b[i]) <= 1, 'key-on ' + i + ' within a frame: ' + f + ' vs ' + b[i]));
}

console.log('nhl94s midi: song format, native and GM MIDI round trips OK');
