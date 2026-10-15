/**
 * Step 5: NHL '92 sound data parsed from ROM bytes (lib/audio/nhl92-sound-data.js).
 * - every byte of every data block is owned by exactly one parsed item
 * - the only leftovers are the pinned, classified ranges below
 * - parsing is deterministic
 * - spot-checks against values written in the disassembly (src/sound/sound.asm)
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sd = require('../lib/audio/nhl92-sound-data');
const fixture = require('../lib/audio/nhl92-sound-fixture');

const ROM = fixture.resolveRom(null);
const data = sd.parse(ROM);
const hex = sd.hex;

// --- Coverage: each block byte owned exactly once ---------------------------------
for (const b of sd.BLOCKS) {
  const owners = new Array(b.end - b.start).fill(0);
  for (const it of data.items) {
    for (let a = Math.max(it.start, b.start); a < Math.min(it.end, b.end); a++) owners[a - b.start] += 1;
  }
  const missing = owners.findIndex((n) => n === 0);
  const doubled = owners.findIndex((n) => n > 1);
  assert.strictEqual(missing, -1, b.id + ': byte ' + (missing < 0 ? '' : hex(b.start + missing)) + ' has no owner');
  assert.strictEqual(doubled, -1, b.id + ': byte ' + (doubled < 0 ? '' : hex(b.start + doubled)) + ' owned twice');
}
for (const b of data.blocks) {
  assert.deepStrictEqual([b.gaps, b.overlaps], [[], []], b.id + ' coverage');
}
// Items never cross a block edge or fall outside every block.
for (const it of data.items) {
  assert.ok(sd.BLOCKS.some((b) => it.start >= b.start && it.end <= b.end), it.label + ' sits inside one block');
}
// Inside each item, the decoded records tile it exactly.
const tiles = (label, start, end, recs) => {
  let at = start;
  for (const r of recs) {
    assert.strictEqual(r.at, at, label + ': record at ' + hex(r.at) + ' expected ' + hex(at));
    at += r.len;
  }
  assert.strictEqual(at, end, label + ' ends at ' + hex(end));
};
for (const p of data.patternEntries) tiles('pattern ' + hex(p.start), p.start, p.end, p.events);
for (const l of data.orderLists) tiles('order list ' + hex(l.start), l.start, l.end, l.items);
for (const s of data.sfxStreams) tiles('SFX stream ' + hex(s.start), s.start, s.end, s.events);
for (const p of data.patternEntries) {
  const last = p.events[p.events.length - 1].kind;
  assert.ok(last === 'end' || last === 'stop', 'pattern ' + hex(p.start) + ' ends on $84/$85');
}
// Pinned leftovers: [start, endExclusive, block]. A new gap or a lost one fails here.
assert.deepStrictEqual(data.unreferenced.map((u) => [u.start, u.end, u.block]), [
  [0xff8f, 0xff90, 'sfxStreams'], [0xffb7, 0xffb8, 'sfxStreams'], [0xffc7, 0xffc8, 'sfxStreams'],
  [0xffef, 0xfff0, 'sfxStreams'], [0x1000d, 0x1000e, 'sfxStreams'], [0x1002b, 0x1002c, 'sfxStreams'],
  [0x10053, 0x10054, 'sfxStreams'], [0x10087, 0x10088, 'sfxStreams'], [0x100a5, 0x100a6, 'sfxStreams'],
  [0x100c3, 0x100c4, 'sfxStreams'], [0x100e1, 0x100e2, 'sfxStreams'], [0x100ff, 0x10100, 'sfxStreams'],
  [0x1011d, 0x1011e, 'sfxStreams'], [0x1013b, 0x1013c, 'sfxStreams'], [0x10159, 0x1015a, 'sfxStreams'],
  [0x10169, 0x1016a, 'sfxStreams'], [0x10179, 0x1017a, 'sfxStreams'],
  [0x10293, 0x10294, 'envelopes'],
  [0x10610, 0x1061e, 'orderLists'],
  [0x10626, 0x10635, 'patterns'], [0x10638, 0x10653, 'patterns'], [0x10659, 0x10662, 'patterns'],
  [0x113e1, 0x1140a, 'patterns'], [0x11623, 0x11624, 'patterns'],
  [0x14885, 0x14886, 'pcm'], [0x2420c, 0x24214, 'pcm']
]);
console.log('nhl92 sound data: every byte of ' + sd.BLOCKS.length + ' data blocks owned once (' +
  data.unreferenced.length + ' pinned unreferenced ranges) OK');

// --- Determinism ---------------------------------------------------------------------
{
  const before = Buffer.from(ROM).toString('hex');
  const a = sd.summary(sd.parse(ROM));
  const b = sd.summary(sd.parse(new Uint8Array(ROM)));
  assert.strictEqual(a, b, 'two parses give identical results');
  assert.strictEqual(Buffer.from(ROM).toString('hex'), before, 'parsing does not modify the ROM bytes');
  const digest = crypto.createHash('sha256').update(a).digest('hex');
  assert.strictEqual(digest, '42f81bee1f465e37e2ace8ccd356784401cd91b82be9079cf9496a40d11feae4', 'parse summary matches the pinned hash');
  const romPath = path.join(__dirname, '..', 'roms', 'nhl92.bin');
  if (fs.existsSync(romPath)) {
    assert.strictEqual(sd.summary(sd.parse(new Uint8Array(fs.readFileSync(romPath)))), a, 'full retail ROM parses like the fixture');
  }
}
console.log('nhl92 sound data: deterministic parse OK');

// --- Spot-checks against sound.asm ------------------------------------------------------
const bytes = (start, n) => Array.from(ROM.subarray(start, start + n));
{
  // fmtune_pointer_table: dc.w $0507 / $0506 / $0506 / $0506 / $0507, then six channel lists.
  assert.deepStrictEqual(data.songs.map((s) => [s.lastChannel, s.tempo]), [[5, 7], [5, 6], [5, 6], [5, 6], [5, 7]]);
  assert.deepStrictEqual(data.songs.map((s) => s.name), ['SngEOP', 'SngTitle', 'SngTitle reprise', 'SngEOG', 'SngPO']);
  // Labels' address comments: song0 ch0 0x10568, ch1 0x10580, ch2 0x105B6, ch3 0x1059C, ch4 0x105CA, ch5 0x105E0.
  assert.deepStrictEqual(data.songs[0].orderLists, [0x10568, 0x10580, 0x105b6, 0x1059c, 0x105ca, 0x105e0]);
  assert.deepStrictEqual(data.songs[3].orderLists, [0x10360, 0x10368, 0x1037c, 0x10372, 0x103aa, 0x103de]);
  assert.deepStrictEqual(data.songs[4].orderLists, [0x10316, 0x10320, 0x1032e, 0x1033c, 0x1034c, 0x1035c]);
  const list = (a) => data.orderLists.find((l) => l.start === a);
  // fmtune_song4_ch0: dc.w $11A3, $0002, $0003, $1A41, $0000
  assert.deepStrictEqual(list(0x10316).items.map((i) => [i.kind, i.pattern || i.count || 0]), [
    ['pattern', 0xf4c8 + 0x11a3], ['repeat', 3], ['pattern', 0xf4c8 + 0x1a41], ['restart', 0]
  ]);
  // fmtune_song1_ch0 ends $1591, $0001, $0002: last pattern then switch to song 2 (Title -> reprise).
  const title0 = list(0x1040e).items;
  assert.deepStrictEqual(title0.slice(-2).map((i) => [i.kind, i.pattern || i.song]), [['pattern', 0xf4c8 + 0x1591], ['song', 2]]);
  // fmtune_song1_ch1 ends $116D, $160A with no terminator; the next list (song2_ch1) follows.
  assert.strictEqual(list(0x1042e).fallsInto, 0x10446);
  assert.deepStrictEqual(data.orderLists.filter((l) => l.fallsInto).map((l) => l.start), [0x1042e, 0x1044e, 0x10472, 0x104a4, 0x104d2]);
  // fmtune_seq0 (0x1061E): dc.b $80, $00 -> instrument 0.
  const p0 = data.patternEntries.find((p) => p.start === 0x1061e);
  assert.deepStrictEqual([p0.events[0].kind, p0.events[0].patch], ['instrument', 0]);
  // fmtune_seq4 (0x1062C): $88 $03 $84 ... transpose stubs; the one at $10635 is used.
  const t = data.patternEntries.find((p) => p.start === 0x10635);
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['transpose', 'end']);
  assert.deepStrictEqual(bytes(0x1062c, 6), [0x88, 0x03, 0x84, 0x88, 0xfb, 0x84]);
}
{
  // note_frequency_table: dcb.b 4,2 / 5,3 / 3,4 / 4,$A ...; note_octave_table row 1.
  assert.deepStrictEqual(data.noteTables.freq.slice(0, 16), [2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 0xa, 0xa, 0xa, 0xa]);
  assert.deepStrictEqual(data.noteTables.freq.slice(-3), [0x3c, 0x3c, 0x3c]);
  assert.deepStrictEqual(data.noteTables.octave.slice(0, 10), [0x84, 0xaa, 0xd3, 0xfe, 0x2b, 0x5c, 0x8f, 0xc5, 0xfe, 0x3b]);
  // envelope0..3 (envelope3 runs 0 down to -38, then $84, then a stray $06).
  assert.deepStrictEqual(data.envelopes[0].values, [0, 1, 1, 0, -1, -2, -1, 0]);
  assert.deepStrictEqual(data.envelopes[1].values, [0, 1, 2, 2, 2, 1, -1, -2, -2, -2]);
  assert.deepStrictEqual(data.envelopes[2].values, [0, 0, 1, 1, 1, 0, 0, -1, -1, -1, 0, 0]);
  assert.deepStrictEqual(data.envelopes[3].values, Array.from({ length: 39 }, (_, i) => (i ? -i : 0)));
  assert.deepStrictEqual(data.unreferenced.find((u) => u.block === 'envelopes').bytes, [0x06]);
}
{
  // sfx_pointer_table order = handler labels in sound.asm; a few handler bodies.
  assert.strictEqual(data.sfxTable, 0xfa92);
  const by = (id) => data.sfx[id].actions.map((a) => (a.type === 'dac'
    ? ['dac', a.sample - 0xf4c8, a.rate, a.priority]
    : ['fm', a.channel, a.stream - 0xf4c8]));
  assert.deepStrictEqual(by(0), [['fm', 0, 0xaac], ['fm', 1, 0xac8]]);            // handle_sfx_siren
  assert.deepStrictEqual(by(1), [['fm', 3, 0xca2]]);                               // handle_sfx_beep1
  assert.deepStrictEqual(by(10), [['fm', 4, 0xb00]]);                              // handle_sfx_stdef
  assert.deepStrictEqual(by(15), [['dac', 0x53be, 0x13, 1], ['fm', 2, 0xbde]]);    // puckwall3 -> + handle_sfx_pass
  assert.deepStrictEqual(by(24), [['fm', 0, 0xb64], ['fm', 1, 0xb8c]]);            // handle_sfx_crowdcheer
  assert.deepStrictEqual(by(25), [['dac', 0x793c, 0x13, 0]]);                      // handle_sfx_crowdboo
  assert.deepStrictEqual(by(31), [['dac', 0x10820, 0x1b, 0]]);                     // handle_sfx_id_31
  assert.deepStrictEqual([32, 33, 34].map((i) => data.sfx[i].handler), [0xfefa, 0xfefa, 0xfefa], 'three duplicates of id_30');
  // configure_ym2612: move.l #$53BA,d1 / #$B / #0.
  assert.deepStrictEqual(data.stopHandler.actions.map((a) => [a.sample - 0xf4c8, a.rate, a.priority]), [[0x53ba, 0x0b, 0]]);
  // SFX stream address comments (0xFF74-0xFF90 ...): each stream + its after-stop byte.
  const listed = [0xff74, 0xff90, 0xffb8, 0xffc8, 0xfff0, 0x1000e, 0x1002c, 0x10054, 0x10088, 0x100a6,
    0x100c4, 0x100e2, 0x10100, 0x1011e, 0x1013c, 0x1015a, 0x1016a, 0x1017a];
  assert.deepStrictEqual(data.sfxStreams.map((s) => s.start), listed.slice(0, -1));
  data.sfxStreams.forEach((s, i) => assert.strictEqual(s.end + 1, listed[i + 1], 'stream ' + hex(s.start) + ' end'));
  // PCM extract table at the end of sound.asm: sample starts.
  assert.deepStrictEqual(data.samples.map((s) => s.start), [
    0x11c3e, 0x12a58, 0x13960, 0x14882, 0x14886, 0x15768, 0x168aa, 0x16e04, 0x1d786, 0x1fce8, 0x222aa
  ]);
  assert.ok(data.samples.every((s) => !s.loops), 'no NHL 92 sample loops');
}
{
  // Patches: 22 x 32 bytes at Z80 $02A5; +$1A is the note offset (move.b $1A(a5),$24(a0)).
  assert.strictEqual(data.patches.length, 22);
  assert.deepStrictEqual(data.patches.filter((p) => p.noteOffset).map((p) => [p.id, p.noteOffset]), [[4, -3]]);
  assert.ok(data.patches.every((p) => p.tail.every((b) => b === 0)));
  // Every instrument and envelope id a pattern uses exists; any note plus the
  // extreme transpose and patch offset stays inside the 96-entry note tables.
  // In the song-channel walk every note index lands inside the 96-entry note
  // tables, and no channel plays a note before its first instrument command.
  const all = data.patterns.flatMap((p) => p.events);
  for (const song of data.songs) {
    for (const c of song.channels) {
      assert.ok(c.noteIndexRange[0] >= 0 && c.noteIndexRange[1] < 96, song.name + ' ch' + c.channel + ' ' + c.noteIndexRange);
      assert.ok(!c.noteBeforeInstrument, song.name + ' ch' + c.channel + ' sets an instrument first');
    }
  }
  assert.deepStrictEqual(data.songs.map((s) => s.channels.map((c) => c.noteIndexRange)), [
    [[26, 45], [40, 52], [55, 81], [28, 45], [50, 90], [9, 18]],
    [[26, 47], [40, 57], [33, 86], [28, 55], [50, 81], [9, 18]],
    [[26, 47], [38, 45], [67, 86], [45, 52], [69, 81], [9, 18]],
    [[26, 47], [50, 57], [57, 86], [45, 52], [64, 86], [9, 18]],
    [[26, 47], [50, 57], [45, 52], [60, 86], [57, 81], [9, 18]]
  ]);
  assert.ok(!all.some((e) => e.kind === 'sfx'), 'NHL 92 music never triggers SFX ($8B unused)');
  for (const p of data.patterns) {
    for (const e of p.events) {
      if (e.kind === 'instrument') assert.ok(e.patch < 22, 'instrument ' + e.patch + ' at ' + hex(e.at));
      if (e.kind === 'envelope') assert.ok(e.envelope < 4, 'envelope ' + e.envelope + ' at ' + hex(e.at));
      if (e.kind === 'duration') assert.ok(!e.wraps, 'duration byte below $A0 at ' + hex(e.at));
    }
  }
}
console.log('nhl92 sound data: ' + data.songs.length + ' songs, ' + data.patternEntries.length + ' patterns, ' +
  data.sfx.length + ' SFX ids, ' + data.sfxStreams.length + ' FM SFX streams, ' + data.samples.length +
  ' DAC samples match sound.asm spot-checks OK');
