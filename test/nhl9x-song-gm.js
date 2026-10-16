/**
 * NHLPA 93 / NHL 94 streams: the parser finds the same stream the retail 68k driver loads for every sound, the
 * patch banks are the 32 identical FM patches, the GM map covers every patch the streams select, and the GM
 * conversion of each song is sane. Mapping only: nothing here changes a driver, a patch or sound data.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Song = require('../lib/audio/nhl9x-song');
const Smf = require('../lib/audio/smf');
const SongGm = require('../lib/audio/nhl92-song-gm');
const GM = require('../lib/audio/nhl92-gm-map');

const FIX = path.join(__dirname, '..', 'data', 'fixtures');
const map = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'audio', 'nhl9x-gm-map.json'), 'utf8'));
const GAMES = {
  93: { driver: require('../lib/audio/nhl93-68k-harness'), size: 0x2efa2 },
  94: { driver: require('../lib/audio/nhl94-68k-harness'), size: 0x4b5c0 }
};
const slices = {};
for (const g of [93, 94]) slices[g] = fs.readFileSync(path.join(FIX, 'nhl' + g + '-sound-slice.bin'));

// 1. The two games share one patch bank.
{
  const a = Song.patches(93, slices[93]);
  const b = Song.patches(94, slices[94]);
  assert.strictEqual(a.length, 32);
  a.forEach((p, i) => assert.strictEqual(Buffer.compare(Buffer.from(p), Buffer.from(b[i])), 0, 'patch ' + i + ' differs between 93 and 94'));
}

// 2. The parsed start of every stream is where the driver's track slot points after the retail sfx / song call.
for (const g of [93, 94]) {
  const rom = new Uint8Array(GAMES[g].size);
  rom.set(slices[g], Song.GAMES[g].start);
  for (let id = 0; id < Song.GAMES[g].count; id++) {
    const d = GAMES[g].driver.create({ rom, z80Ram: new Uint8Array(0x2000), onBusRelease() {} });
    d.boot();
    if (id >= 0x30) d.song(id); else d.sfx(id);
    const want = Song.streamAddr(g, slices[g], id);
    let found = false;
    for (let a = 0xffffc000; a < 0xffffe000 && !found; a += 2) found = d.peek32(a) === want;
    assert.ok(found, 'NHL ' + g + ' sound $' + id.toString(16) + ': driver slot does not point at $' + want.toString(16));
  }
}

// 3. Every patch a stream selects is in the map; the map is well formed.
{
  const seen = new Set();
  map.patches.forEach((e) => {
    assert.ok(!seen.has(e.patch), 'duplicate map entry for patch ' + e.patch);
    seen.add(e.patch);
    assert.ok(e.reason && e.confidence && e.character, 'patch ' + e.patch + ' needs character, reason and confidence');
    if (e.target.kind === 'program') {
      assert.strictEqual(e.target.name, GM.programName(e.target.program), 'patch ' + e.patch + ' program name');
    } else {
      assert.strictEqual(e.target.kind, 'drum');
      assert.strictEqual(e.target.name, GM.drumName(e.target.note), 'patch ' + e.patch + ' drum name');
    }
  });
  for (const g of [93, 94]) {
    for (let id = 0; id < Song.GAMES[g].count; id++) {
      const r = Song.toGm(g, slices[g], id, map);
      assert.deepStrictEqual(r.unmapped, [], 'NHL ' + g + ' sound $' + id.toString(16) + ' uses unmapped patches ' + r.unmapped);
    }
  }
}

// 4. Parsing and GM conversion.
for (const g of [93, 94]) {
  let withNotes = 0;
  for (let id = 0; id < Song.GAMES[g].count; id++) {
    const r = Song.parse(g, slices[g], Song.streamAddr(g, slices[g], id));
    assert.notStrictEqual(r.end, 'bad', 'NHL ' + g + ' $' + id.toString(16) + ' ran off the slice');
    const gm = Song.toGm(g, slices[g], id, map);
    gm.song.notes.forEach((n) => {
      assert.ok(n.pitch >= 0 && n.pitch <= 127 && n.vel >= 1 && n.vel <= 127 && n.dur >= 1 && n.tick >= 0, 'note out of range');
      assert.ok(n.ch >= 0 && n.ch <= 15);
    });
    if (gm.notes) withNotes++;
    if (id >= 0x30) {
      assert.ok(gm.seconds > 1, 'song $' + id.toString(16) + ' has a length');
      // Through the SMF writer and back: same notes.
      const bytes = Smf.write(SongGm.toSmfSong(gm.song));
      const back = Smf.parse(bytes);
      assert.strictEqual(back.notes.length, gm.notes, 'NHL ' + g + ' $' + id.toString(16) + ' SMF round trip');
    }
  }
  assert.ok(withNotes > Song.GAMES[g].count * 0.8, 'NHL ' + g + ': most sounds should have notes');
}

// 5. Pinned facts (self-consistency of the parser, from the ROM bytes).
{
  const a = Song.parse(94, slices[94], Song.streamAddr(94, slices[94], 0));
  assert.strictEqual(a.end, 'end');
  assert.strictEqual(a.ticks, 356);
  const s = Song.parse(94, slices[94], Song.streamAddr(94, slices[94], 0x7a));
  assert.strictEqual(s.end, 'loop');
  assert.strictEqual(s.loopTick, 60);
  const t = Song.parse(93, slices[93], Song.streamAddr(93, slices[93], 0x37));
  assert.strictEqual(t.end, 'loop');
}

// 6. identify() finds a patch from the register burst the Z80 writes for it.
{
  const bank = Song.patches(94, slices[94]);
  for (let i = 0; i < 32; i++) {
    const regs = new Map();
    for (let k = 0; k < 24; k++) regs.set(0x30 + (k >> 2) * 0x10 + (k & 3) * 4 + 1, bank[i][k]);
    regs.set(0xb1, bank[i][28]);
    const got = Song.identify(bank, regs, 1);
    assert.strictEqual(Buffer.compare(Buffer.from(bank[got]), Buffer.from(bank[i])), 0, 'identify patch ' + i);
  }
  assert.strictEqual(Song.identify(bank, new Map(), 0), -1);
}

// 7. The stored patch measurements cover all 32 FM patches (regenerate: node tools/build-nhl9x-patch-analysis.js).
{
  const an = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'audio', 'nhl9x-patch-analysis.json'), 'utf8'));
  assert.strictEqual(an.patches.length, 32);
  an.patches.forEach((p, i) => { assert.strictEqual(p.id, i); assert.ok(p.measured && p.measured.shape, 'patch ' + i + ' measured'); });
}

console.log('nhl9x-song-gm: ok');

// The NHL 93 title song's stream is a 17-event intro that jumps into the loop body: it is 49 s, not 1.5 s.
{
  const fs2 = require('fs');
  const S = require('../lib/audio/nhl9x-song');
  const sl = fs2.readFileSync(require('path').join(__dirname, '..', 'data', 'fixtures', 'nhl93-sound-slice.bin'));
  const p = S.parse(93, sl, S.streamAddr(93, sl, 0x35));
  assert.ok(p.ticks > 2500 && p.ticks < 3500, 'NHL 93 $35 runs through its loop body (' + p.ticks + ' vblanks)');
  assert.strictEqual(p.end, 'loop');
  assert.strictEqual(p.loopTick, 89, 'and loops back into the body, not to the start');
  assert.ok(p.events.length > 1000);
  console.log('nhl9x-song-gm: NHL 93 title song follows its intro-to-body jump OK');
}
