/**
 * Instrument edits in the Genesis sequencers' exports (lib/audio/patch-edits.js).
 *
 * 1. Retail songs export byte for byte as before: the hashes below were taken from every retail song's exports
 *    (NHL 92: the 5 songs; NHLPA 93 / NHL 94: every sound with notes) with the code before edits reached the exports.
 * 2. An edited song carries its patches: native MIDI round-trips them, the .asm lists them, the .bin ends in a
 *    'PTCH' block after the unchanged song bytes, and the GM conversion follows them (NHL 92: an edited note offset
 *    moves the notes; NHLPA 93 / NHL 94: the patch's bend range).
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Smf = require('../lib/audio/smf');
const SongGm = require('../lib/audio/nhl92-song-gm');
const S92 = require('../lib/audio/nhl92-song');
const Data = require('../lib/audio/nhl92-sound-data');
const fixture = require('../lib/audio/nhl92-sound-fixture');
const Song = require('../lib/audio/nhl9x-song');
const Stream = require('../lib/audio/nhl9x-stream');
const Edits = require('../lib/audio/patch-edits');

const ROOT = path.join(__dirname, '..');
const sha = (parts) => {
  const h = crypto.createHash('sha1');
  parts.forEach((p) => h.update(Buffer.from(p)));
  return h.digest('hex');
};
const map92 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'audio', 'nhl92-gm-map.json'), 'utf8'));
const map9x = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'audio', 'nhl9x-gm-map.json'), 'utf8'));
const data92 = Data.parse(fixture.resolveRom(null));

const PINNED = {
  nhl92: { asm: '4f1f148fe8acabe88d6f87e8d1ae2486eb2d60e9', bin: 'd6d76d8b49b2caa332642ed6057294ff431dc069', native: '760dae24acf2383111e7a7cfdd2855c95bc80b09', gm: '8f8c2346d7a1e5a719847627a80b8b46534e16a5' },
  nhl93: { songs: 54, asm: '0f5c85dc7dd91167a46e636aca59f3338080a81b', bin: '591849d9eb60d22c0ff8187ea55e5fca1e5a4b29', native: '0291a4a824f4167836bbc2a77bb242896658912c', gm: '04d56a2e8f8e977ccd6a6390d74d6d32b7ffb9df' },
  nhl94: { songs: 121, asm: 'd01a609dae058fb712bb8748ccc77732b2dc5c30', bin: 'e2950999e54811fccf957d3dce2f52cba213fcc8', native: '9ce9f499904768e945366f77800642fe01e5bad5', gm: '90bb7ea1d19f289ad774d2c592270eef5a3845b1' }
};

// --- 1. Retail exports are unchanged (with no edits, and with an empty patchEdits) -----------------------------
for (const edits of [undefined, {}]) {
  const asm = [], bin = [], nat = [], gm = [];
  for (let n = 0; n < 5; n++) {
    const s = S92.fromParsed(data92, n);
    if (edits) s.patchEdits = edits;
    const b = S92.build(s);
    asm.push(S92.toAsm(b, 'song' + n, s.patchEdits));
    bin.push(S92.toBinary(b, s.patchEdits));
    nat.push(Smf.write(SongGm.nhlToSmfSong(s, 'song' + n)));
    gm.push(Smf.write(SongGm.toSmfSong(SongGm.nhlToGm(s, map92).song)));
  }
  assert.deepStrictEqual({ asm: sha(asm), bin: sha(bin), native: sha(nat), gm: sha(gm) }, PINNED.nhl92, 'NHL 92 retail exports unchanged');
}
const slices = {};
const banks = {};
for (const g of [93, 94]) {
  slices[g] = fs.readFileSync(path.join(ROOT, 'data', 'fixtures', 'nhl' + g + '-sound-slice.bin'));
  banks[g] = Song.patches(g, slices[g]);
  for (const edits of [undefined, {}]) {
    const asm = [], bin = [], nat = [], gm = [];
    for (let id = 0; id < Song.GAMES[g].count; id++) {
      let s;
      try { s = Stream.fromStream(g, slices[g], id); } catch (err) { continue; }
      if (!s || !s.notes.length) continue;
      if (edits) s.patchEdits = edits;
      asm.push(Stream.toAsm(s, 'song' + id));
      bin.push(Stream.toBinary(s));
      nat.push(Smf.write(Stream.toSmfNative(s)));
      gm.push(Smf.write(SongGm.toSmfSong(Stream.toGm(s, map9x, banks[g]).song)));
    }
    assert.deepStrictEqual({ songs: asm.length, asm: sha(asm), bin: sha(bin), native: sha(nat), gm: sha(gm) }, PINNED['nhl' + g], 'NHL ' + g + ' retail exports unchanged');
  }
}
console.log('patch-edits export: retail exports byte-identical (NHL 92 x5, NHLPA 93 x54, NHL 94 x121) OK');

// --- 2a. NHL 92: an edited song ---------------------------------------------------------------------------------
{
  const song = S92.fromParsed(data92, 1);
  const p6 = Array.from(fixture.resolveRom(null).subarray(data92.patches[6].rom, data92.patches[6].rom + 32));
  const p1 = Array.from(fixture.resolveRom(null).subarray(data92.patches[1].rom, data92.patches[1].rom + 32));
  p6[7] = 99; // operator 4 total level
  p6[26] = 5; // note offset +5 (retail 0)
  p1[20] = 0x5a;
  song.patchEdits = { 6: p6, 1: p1 };
  const built = S92.build(song);

  // Native MIDI: the edits come back exactly, and the notes are unchanged.
  const back = SongGm.nhlFromNativeSmf(Smf.parse(Smf.write(SongGm.nhlToSmfSong(song, 'edited'))));
  assert.deepStrictEqual(back.song.patchEdits, { 1: p1, 6: p6 }, 'NHL 92 native MIDI keeps the edited patches');
  assert.deepStrictEqual(back.song.channels, SongGm.nhlFromNativeSmf(Smf.parse(Smf.write(SongGm.nhlToSmfSong(Object.assign({}, song, { patchEdits: undefined }), 'plain')))).song.channels, 'and the same notes');
  assert.ok(back.report.some((l) => /Edited instruments restored: patch 1, patch 6/.test(l)));

  // .asm: the song as before, then one dc.b block per edited patch.
  const plain = S92.toAsm(built, 'edited');
  const asm = S92.toAsm(built, 'edited', song.patchEdits);
  assert.ok(asm.startsWith(plain.slice(0, -1)), 'NHL 92 asm: the song part is unchanged');
  assert.ok(/edited_patch1:\t; patch 1/.test(asm) && /edited_patch6:\t; patch 6/.test(asm));
  assert.ok(asm.includes('\tdc.b ' + p6.slice(0, 16).map((v) => '$' + v.toString(16).toUpperCase().padStart(2, '0')).join(', ')));

  // .bin: the song bytes as before, then 'PTCH' + the patches.
  const binPlain = S92.toBinary(built);
  const bin = S92.toBinary(built, song.patchEdits);
  assert.deepStrictEqual(Array.from(bin.subarray(0, binPlain.length)), Array.from(binPlain), 'NHL 92 bin: the song part is unchanged');
  const tail = Edits.readTrailer(bin, binPlain.length);
  assert.deepStrictEqual(tail.edits, { 1: p1, 6: p6 });
  assert.strictEqual(tail.end, bin.length);

  // GM: notes of patch 6 move up by the edited offset; others stay.
  const before = SongGm.nhlToGm(Object.assign({}, song, { patchEdits: undefined }), map92).song.notes;
  const after = SongGm.nhlToGm(song, map92).song.notes;
  assert.strictEqual(before.length, after.length);
  const progOf6 = map92.nhl92ToGm.patches.find((e) => e.patch === 6).target;
  assert.strictEqual(progOf6.kind, 'program', 'patch 6 is a melodic patch');
  // Sorted by tick, channel, pitch: one note per channel at a time, so the two lists pair up note for note.
  const on6 = song.channels.reduce((t, list) => t + list.filter((n) => n.patch === 6).length, 0);
  let moved = 0;
  before.forEach((b, i) => {
    const d = after[i].pitch - b.pitch;
    assert.ok(after[i].tick === b.tick && after[i].ch === b.ch && (d === 0 || d === 5), 'note ' + i + ' moved by ' + d);
    if (d === 5) moved += 1;
  });
  assert.strictEqual(moved, on6, 'every note on patch 6 moved up 5 (' + moved + ')');
  assert.ok(moved > 0, 'song 1 has notes on patch 6 (' + moved + ')');
  console.log('patch-edits export: NHL 92 native MIDI, asm, bin and GM carry the edited instruments OK');
}

// --- 2b. NHLPA 93 / NHL 94: an edited song -------------------------------------------------------------------
for (const g of [93, 94]) {
  const id = g === 93 ? 0x37 : 0x7a;
  const song = Stream.fromStream(g, slices[g], id);
  const used = Array.from(new Set(song.notes.map((n) => n.patch).filter((p) => p < 32))).sort((a, b) => a - b);
  const pid = used[0];
  const edited = Array.from(banks[g][pid]);
  edited[7] = 101;
  edited[30] = 9; // bend range in semitones (byte $1E)
  song.patchEdits = { [pid]: edited };
  const back = Stream.fromSmfNative(Smf.parse(Smf.write(Stream.toSmfNative(song))));
  assert.deepStrictEqual(back.song.patchEdits, { [pid]: edited }, 'NHL ' + g + ' native MIDI keeps the edited patch');
  const asm = Stream.toAsm(song, 'edited');
  const where = Song.GAMES[g].table - 1024 + 32 * pid;
  assert.ok(asm.startsWith(Stream.toAsm(Object.assign({}, song, { patchEdits: undefined }), 'edited').slice(0, -1)), 'NHL ' + g + ' asm: the stream part is unchanged');
  assert.ok(asm.includes('edited_patch' + pid + ':\t; patch ' + pid + ' (ROM $' + where.toString(16).toUpperCase() + ')'));
  const plain = Stream.encode(song, 0).bytes;
  const bin = Stream.toBinary(song);
  assert.deepStrictEqual(Array.from(bin.subarray(0, plain.length)), Array.from(plain), 'NHL ' + g + ' bin: the stream part is unchanged');
  assert.deepStrictEqual(Edits.readTrailer(bin, plain.length).edits, { [pid]: edited });
  // GM: the conversion reads the edited patch (its bend range), so a song with bends on that patch changes; a bank
  // copy with the same edit gives the same result.
  const a = Stream.toGm(song, map9x, banks[g]);
  const b = Stream.toGm(Object.assign({}, song, { patchEdits: undefined }), map9x, Edits.withEdits(banks[g], song.patchEdits));
  assert.deepStrictEqual(a.song, b.song, 'NHL ' + g + ' GM uses the edited bank');
  assert.strictEqual(banks[g][pid][7] !== 101 || banks[g][pid][30] !== 9, true, 'the retail bank is not touched');
}
{
  // Bends follow the edited range: a note on patch 11 bent to the top, range 2 -> 9 semitones.
  const s = Stream.emptySong(94);
  s.notes = [{ t: 0, dur: 30, ch: 0, note: 60, vel: 100, patch: 11 }];
  s.bends = [{ t: 10, ch: 0, value: 8191 }];
  s.ticks = 64;
  const top = (song) => Math.max(...Stream.toGm(song, map9x, banks[94]).song.bends.map((b) => Math.abs(b.semis)));
  const retail = top(s);
  const p = Array.from(banks[94][11]);
  p[30] = 9;
  s.patchEdits = { 11: p };
  assert.ok(Math.abs(top(s) - 9) < 0.05 && Math.abs(retail - banks[94][11][30]) < 0.05, 'bend range ' + retail + ' -> ' + top(s));
}
console.log('patch-edits export: NHLPA 93 / NHL 94 native MIDI, asm, bin and GM carry the edited instruments OK');

// --- 3. Why the GM conversions differ: on the drivers, an edited note offset (patch byte 26) moves NHL 92's notes,
// and NHLPA 93 / NHL 94's drivers ignore it (so their editor does not offer it).
{
  const Chain = require('../lib/audio/nhl92-sound-chain');
  const Tracker = require('../lib/audio/ym-note-tracker');
  const DRIVER = { 93: require('../lib/audio/nhl93-68k-harness'), 94: require('../lib/audio/nhl94-68k-harness') };
  const heard = (rom, songId, driver) => {
    const tr = Tracker.create();
    const chain = Chain.create({ rom, driver, keepLogs: false, onYmWrite: (t, p, v) => tr.writePort(t, p, v), onPsgWrite: (t, v) => tr.psgWrite(t, v), onYmReset: (t) => tr.reset(t) });
    chain.step(null);
    chain.step([{ song: songId }]);
    for (let f = 2; f < 60; f++) chain.step(null);
    return tr.notes.filter((n) => n.segs.some((x) => x.midi != null)).map((n) => n.segs.find((x) => x.midi != null).midi);
  };
  const rom = fixture.resolveRom(null);
  const s = S92.emptySong(6);
  s.channels[0] = [{ unit: 0, len: 4, index: 57, patch: 6 }];
  s.units = 16;
  const copy = S92.romWithSong(rom, S92.build(s));
  const edited = Uint8Array.from(copy);
  edited[data92.patches[6].rom + 26] = 5;
  const a = heard(copy, S92.CUSTOM_SONG);
  const b = heard(edited, S92.CUSTOM_SONG);
  assert.ok(a.length === 1 && b.length === 1 && b[0] - a[0] === 5, 'NHL 92: offset +5 plays 5 higher (' + a + ' -> ' + b + ')');
  for (const g of [93, 94]) {
    const r = new Uint8Array(Song.GAMES[g].start + slices[g].length);
    r.set(slices[g], Song.GAMES[g].start);
    const t = Stream.emptySong(g);
    t.notes = [{ t: 4, dur: 30, ch: 0, note: 69, vel: 110, patch: 11 }];
    t.ticks = 64;
    const c = Stream.romWithSong(g, r, t);
    const e = Uint8Array.from(c.rom);
    e[Song.GAMES[g].table - 1024 + 11 * 32 + 26] = 12;
    assert.deepStrictEqual(heard(e, c.id, DRIVER[g]), heard(c.rom, c.id, DRIVER[g]), 'NHL ' + g + ': byte 26 does not move the note');
  }
  console.log('patch-edits export: NHL 92 plays an edited note offset, NHLPA 93 / NHL 94 ignore byte 26 OK');
}
