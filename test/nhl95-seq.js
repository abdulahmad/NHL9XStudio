/**
 * NHL 95 (Genesis) songs (lib/audio/nhl95-seq.js): the song table, byte-exact parse / encode of every retail
 * song, model round trip, and an edited song played on the retail driver from a ROM copy.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Seq = require('../lib/audio/nhl95-seq');
const Chain = require('../lib/audio/nhl92-sound-chain');
const driver = require('../lib/audio/nhl95-68k-harness');

const slice = fs.readFileSync(path.join(__dirname, '..', 'data', 'fixtures', 'nhl95-sound-slice.bin'));
const rom = new Uint8Array(0x7a000);
rom.set(slice, 0xaf44);

const songs = Seq.songs(rom);
assert.strictEqual(Seq.items(rom).length, 141, 'bank 0 items');
assert.strictEqual(songs.length, 72, 'bank 0 songs: ' + songs.length);
for (const id of [0, 1, 2, 3, 0x32, 0x55]) assert.ok(songs.some((s) => s.id === id), 'song $' + id.toString(16));

let loops = 0;
const sameModel = (a, b) => {
  const key = (m) => JSON.stringify([m.ticks, m.loopTick, m.notes, m.controllers, m.programs, m.bends].map((x) => (Array.isArray(x) ? x.map(({ o, ...rest }) => rest).sort((p, q) => p.t - q.t || p.ch - q.ch || (p.note || 0) - (q.note || 0) || (p.ctl || 0) - (q.ctl || 0)) : x)));
  return key(a) === key(b);
};
for (const s of songs) {
  const bytes = Seq.songBytes(rom, s.id);
  const r = Seq.parse(bytes);
  assert.ok(r.end === 'end' || r.end === 'loop', 'song $' + s.id.toString(16) + ' ends: ' + r.end);
  if (r.end === 'loop') loops++;
  assert.deepStrictEqual(Buffer.from(Seq.encodeRaw(r)), Buffer.from(bytes), 'song $' + s.id.toString(16) + ' bytes round trip');
  const m = Seq.fromBytes(bytes);
  const m2 = Seq.fromBytes(Seq.encode(m));
  assert.ok(sameModel(m, m2), 'song $' + s.id.toString(16) + ' model round trip');
}

// An encoded retail song played from bank 1 of a ROM copy makes the same YM2612 writes as the retail song (the
// order of port / value pairs: setting bank 1 is one more Z80 bus handoff, so the times move by about 2000 T-states).
const ymLog = (image, banks, id, frames) => {
  const h = crypto.createHash('sha1');
  let n = 0;
  const chain = Chain.create({ rom: image, driver, keepLogs: false, driverOpts: { banks }, onYmWrite: (t, port, value) => { h.update(port + ',' + value + ';'); n++; } });
  chain.step(null);
  chain.step([{ song: id }]);
  for (let f = 2; f < frames; f++) chain.step(null);
  assert.ok(n > 500, 'song $' + id.toString(16) + ' writes the YM2612: ' + n);
  return h.digest('hex');
};
for (const id of [0, 0x33]) {
  const retail = ymLog(rom, null, id, 400);
  const copy = Seq.romWithSong(rom, Seq.fromRom(rom, id), id);
  assert.strictEqual(ymLog(copy.rom, copy.banks, id, 400), retail, 'song $' + id.toString(16) + ' from the model, played from the ROM copy, writes the YM2612 like retail');
  // An edit is heard: transpose every note.
  const m = Seq.fromRom(rom, id);
  m.notes.forEach((n) => { n.note += 2; });
  const edited = Seq.romWithSong(rom, m, id);
  assert.notStrictEqual(ymLog(edited.rom, edited.banks, id, 400), retail, 'song $' + id.toString(16) + ' edit is heard');
}
console.log('nhl95 seq: ' + songs.length + ' songs (' + loops + ' loop) parse and encode byte-exact, model round trip, ROM copy plays like retail OK');
