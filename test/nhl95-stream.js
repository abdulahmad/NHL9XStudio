/**
 * NHL 95 sequencer model (lib/audio/nhl95-stream.js, through nhl9x-stream.js): the GM map covers the 43 bank
 * patches, retail songs survive the editor model and play like retail from the ROM copy, MIDI export / import
 * round-trips (native and General MIDI), and edited or imported songs play on the retail driver per load list.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Seq = require('../lib/audio/nhl95-seq');
const Stream = require('../lib/audio/nhl9x-stream');
const N95 = require('../lib/audio/nhl95-stream');
const Smf = require('../lib/audio/smf');
const SongGm = require('../lib/audio/nhl92-song-gm');
const Chain = require('../lib/audio/nhl92-sound-chain');
const driver = require('../lib/audio/nhl95-68k-harness');

const slice = fs.readFileSync(path.join(__dirname, '..', 'data', 'fixtures', 'nhl95-sound-slice.bin'));
const rom = new Uint8Array(0x7a000);
rom.set(slice, 0xaf44);
const map = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'audio', 'nhl95-gm-map.json'), 'utf8'));

// 1. The map: one entry per type-0 bank item, named, with a GM target; load lists as in the ROM.
const bankPatches = Seq.items(rom).filter((i) => i.type === 0).map((i) => i.id);
assert.strictEqual(bankPatches.length, 43);
assert.deepStrictEqual(map.patches.map((p) => p.patch), bankPatches, 'map patches = bank patches');
for (const p of map.patches) {
  assert.ok(p.name && p.character && p.target && /^(program|drum)$/.test(p.target.kind) && p.target.name, 'patch ' + p.patch + ' entry');
  assert.ok(['fm', 'pcm', 'psg'].includes(p.kind));
}
const lists = Seq.items(rom).filter((i) => i.type === 0x0b).map((i) => { const o = []; for (let a = i.addr; rom[a] !== 0xff; a += 2) o.push(rom[a + 1]); return o; });
assert.deepStrictEqual(map.loadLists.map((l) => l.patches), lists, 'load lists');
for (const L of [0, 1]) {
  const g = map.gmToNhl.lists[L];
  const ok = (p) => lists[L].includes(p);
  g.families.forEach((p) => assert.ok(ok(p), 'list ' + L + ' family patch ' + p));
  Object.values(g.programOverrides).forEach((p) => assert.ok(ok(p), 'list ' + L + ' override ' + p));
  g.drums.concat([g.defaultDrum]).forEach((d) => assert.ok(ok(d.patch), 'list ' + L + ' drum ' + d.patch));
  for (let prog = 0; prog < 128; prog++) assert.ok(ok(N95.patchForProgram(map, L, prog)), 'list ' + L + ' program ' + prog);
}

const ymLog = (image, opts, id, frames) => {
  const h = crypto.createHash('sha1');
  let n = 0;
  // Timer reloads ($24-$27) and DAC bytes ($2A) follow Z80 timing (the YM timers run in T-states), which shifts by a
  // few cycles when the song sits elsewhere in the ROM copy; the music is the rest of the log.
  let reg = -1;
  const chain = Chain.create({ rom: image, driver, keepLogs: false, driverOpts: opts, onYmWrite: (t, port, value) => {
    if (port === 0) { reg = value; return; }
    if (port === 1 && ((reg >= 0x24 && reg <= 0x27) || reg === 0x2a)) return;
    h.update(port + ',' + (port === 1 || port === 3 ? reg + '=' : '') + value + ';'); n++;
  } });
  chain.step(null);
  chain.step([{ song: id }]);
  for (let f = 2; f < frames; f++) chain.step(null);
  return { hash: h.digest('hex'), n };
};

// 2. Retail songs through the editor model: same sequence model, and played from the copy like retail.
const strip = (m) => JSON.stringify([m.ticks, m.loopTick].concat([m.notes, m.controllers, m.bends].map((l) => l.map(({ o, patch, ...r }) => r).sort((a, b) => a.t - b.t || a.ch - b.ch || (a.note || 0) - (b.note || 0) || (a.ctl || 0) - (b.ctl || 0)))));
for (const s of Seq.songs(rom)) {
  const ed = Stream.fromStream(95, rom, s.id);
  assert.strictEqual(ed.loadList, s.id <= 3 ? 0 : 1);
  const back = Seq.fromBytes(Stream.encode(ed).bytes);
  assert.strictEqual(strip(back), strip(Seq.fromRom(rom, s.id)), 'song $' + s.id.toString(16) + ' editor model round trip');
  assert.deepStrictEqual(N95.fromSeq(back, ed.loadList).notes.map((n) => n.t + ':' + n.ch + ':' + n.patch).sort(), ed.notes.map((n) => n.t + ':' + n.ch + ':' + n.patch).sort(), 'song $' + s.id.toString(16) + ' patches');
}
for (const id of [0, 0x33]) {
  const retail = ymLog(rom, null, id, 400);
  const ed = Stream.fromStream(95, rom, id);
  const copy = Stream.romWithSong(95, rom, ed);
  assert.strictEqual(copy.id, Stream.CUSTOM_SONG[95]);
  assert.strictEqual(ymLog(copy.rom, copy.driverOpts, copy.id, 400).hash, retail.hash, 'song $' + id.toString(16) + ' via the editor model plays like retail');
}

// 3. Native MIDI round trip: notes, patches, controllers, bends, loop and load list come back.
const smfRound = (smf) => Smf.parse(Smf.write(smf));
for (const id of [0, 3, 0x33, 0x16]) {
  const ed = Stream.fromStream(95, rom, id);
  const back = Stream.fromSmfNative(smfRound(Stream.toSmfNative(ed))).song;
  const key = (m) => JSON.stringify([m.game, m.ticks, m.loopTick, m.loadList, m.notes.map(({ o, ...r }) => r).sort((a, b) => a.t - b.t || a.ch - b.ch || a.note - b.note),
    m.controllers.map(({ o, ...r }) => r).sort((a, b) => a.t - b.t || a.ch - b.ch), m.bends.map(({ o, ...r }) => r).sort((a, b) => a.t - b.t || a.ch - b.ch)]);
  assert.strictEqual(key(back), key(ed), 'song $' + id.toString(16) + ' native MIDI round trip');
  assert.deepStrictEqual(Seq.fromBytes(Stream.encode(back).bytes).notes.length, ed.notes.length);
}
assert.strictEqual(require('../lib/audio/nhl9x-stream').fromSmfNative(smfRound(Stream.toSmfNative(Stream.emptySong(94)))).song.game, 94, '93/94 native files still read as theirs');

// 4. General MIDI export -> import: every note comes back at its time and pitch (drums as the list's drums).
for (const id of [0, 0x33]) {
  const ed = Stream.fromStream(95, rom, id);
  const gm = Stream.toGm(ed, map).song;
  const norm = SongGm.normalizeGm(smfRound(SongGm.toSmfSong(gm))).song;
  const imp = Stream.fromGm(norm, map, 95, null, ed.loadList).song;
  assert.strictEqual(imp.loadList, ed.loadList);
  assert.strictEqual(imp.notes.length, ed.notes.length, 'song $' + id.toString(16) + ' GM round trip note count');
  const melodic = (m) => m.notes.filter((n) => map.patches.find((p) => p.patch === n.patch).target.kind === 'program').map((n) => n.t + ':' + n.note).sort().join(' ');
  assert.strictEqual(melodic(imp), melodic(ed), 'song $' + id.toString(16) + ' GM round trip melodic notes');
  imp.notes.forEach((n) => assert.ok(lists[ed.loadList].includes(n.patch), 'imported patch in list'));
  assert.strictEqual(imp.bends.length > 0, ed.bends.length > 0);
}

// 5. Edited and imported songs play on the retail driver, for both load lists, and an edit is heard.
const tune = { ppq: 480, tempos: [{ tick: 0, bpm: 120 }], name: 't', controllers: [], bends: [{ tick: 480, ch: 0, semis: 1 }, { tick: 960, ch: 0, semis: 0 }],
  notes: [60, 64, 67, 72].map((p, i) => ({ tick: i * 480, dur: 400, ch: 0, pitch: p, vel: 100, program: 0 }))
    .concat([0, 1, 2, 3].map((i) => ({ tick: i * 480, dur: 400, ch: 1, pitch: 36, vel: 100, program: 33 })))
    .concat([0, 1, 2, 3].map((i) => ({ tick: i * 480, dur: 60, ch: 9, pitch: i % 2 ? 38 : 36, vel: 100, program: null }))) };
const silent = ymLog(Stream.romWithSong(95, rom, Stream.emptySong(95, 1)).rom, Stream.romWithSong(95, rom, Stream.emptySong(95, 1)).driverOpts, 0x32, 200);
for (const L of [0, 1]) {
  const song = Stream.fromGm(tune, map, 95, null, L).song;
  const a = Stream.romWithSong(95, rom, song);
  const played = ymLog(a.rom, a.driverOpts, a.id, 200);
  assert.ok(played.n > silent.n + 40, 'list ' + L + ' import plays: ' + played.n + ' vs ' + silent.n);
  song.notes.forEach((n) => { if (n.ch === 0) n.note += 3; });
  const b = Stream.romWithSong(95, rom, song);
  assert.notStrictEqual(ymLog(b.rom, b.driverOpts, b.id, 200).hash, played.hash, 'list ' + L + ' edit is heard');
}
const retail33 = Stream.fromStream(95, rom, 0x33);
retail33.notes.filter((n) => n.ch === 0).slice(0, 8).forEach((n) => { n.patch = 12; });
const c = Stream.romWithSong(95, rom, retail33);
assert.notStrictEqual(ymLog(c.rom, c.driverOpts, c.id, 400).hash, ymLog(rom, null, 0x33, 400).hash, 'a patch change is heard');
assert.ok(/dc\.b/.test(Stream.toAsm(retail33, 'x')) && Stream.toBinary(retail33).length > 10);
console.log('nhl95 stream: GM map (43 patches, 2 load lists), editor model, native + GM MIDI round trips, edited playback OK');
