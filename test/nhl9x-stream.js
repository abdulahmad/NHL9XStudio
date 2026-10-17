/**
 * NHL 93/94 sequencer model: retail stream -> model -> stream reproduces the notes, bends and loops; the pitch bend
 * reaches the MIDI file and the reference synth; a MIDI file imports into a song the retail drivers play; the ROM
 * copy leaves every retail byte alone. Nothing here changes a driver, a patch or sound data.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Song = require('../lib/audio/nhl9x-song');
const Stream = require('../lib/audio/nhl9x-stream');
const Smf = require('../lib/audio/smf');
const SongGm = require('../lib/audio/nhl92-song-gm');
const Ref = require('../lib/audio/gm-reference');
const Chain = require('../lib/audio/nhl92-sound-chain');

const FIX = path.join(__dirname, '..', 'data', 'fixtures');
const map = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'audio', 'nhl9x-gm-map.json'), 'utf8'));
const DRIVER = { 93: require('../lib/audio/nhl93-68k-harness'), 94: require('../lib/audio/nhl94-68k-harness') };
const slices = {};
const roms = {};
for (const g of [93, 94]) {
  slices[g] = fs.readFileSync(path.join(FIX, 'nhl' + g + '-sound-slice.bin'));
  roms[g] = new Uint8Array(g === 93 ? 0x2e1fc : 0x4b5c0);
  roms[g].set(slices[g], Song.GAMES[g].start);
}
const key = (n) => [n.t, n.dur, n.ch, n.note, n.vel, n.patch].join(',');

// 1. Retail stream -> model -> stream -> parse: same notes, same bends.
for (const g of [93, 94]) {
  const ids = g === 93 ? [0x30, 0x35, 0x37, 0, 7] : [0x30, 0x5a, 0x78, 0x7a, 0, 0x1f];
  for (const id of ids) {
    const m = Stream.fromStream(g, slices[g], id);
    const enc = Stream.encode(m, Song.GAMES[g].start);
    const back = Song.parse(g, enc.bytes, Song.GAMES[g].start);
    const ons = back.events.filter((e) => e.kind === 'on').length;
    assert.strictEqual(ons, m.notes.length, 'NHL ' + g + ' $' + id.toString(16) + ' note count');
    assert.strictEqual(back.events.filter((e) => e.kind === 'bend').length, m.bends.length, 'bend count');
    assert.strictEqual(back.ticks, Math.max(m.ticks, ...m.notes.map((n) => n.t + n.dur)), 'length');
    if (m.loopTick != null) assert.strictEqual(back.end, 'loop');
  }
}

// 2. A model survives encode -> parse -> model exactly (notes and bends).
{
  const song = Stream.emptySong(94);
  song.notes = [
    { t: 0, dur: 20, ch: 0, note: 60, vel: 100, patch: 11 },
    { t: 0, dur: 20, ch: 1, note: 48, vel: 90, patch: 13 },
    { t: 24, dur: 300, ch: 0, note: 64, vel: 80, patch: 11 },
    { t: 40, dur: 6, ch: 7, note: 70, vel: 110, patch: 106 },
    { t: 40, dur: 12, ch: 7, note: 38, vel: 110, patch: 17 }
  ];
  song.bends = [{ t: 30, ch: 0, value: 4096 }, { t: 60, ch: 0, value: 0 }];
  song.ticks = 400;
  song.loopTick = 24;
  const enc = Stream.encode(song, 0x4b5c0);
  const p = Song.parse(94, (() => { const b = new Uint8Array(0x4b5c0 - Song.GAMES[94].start + enc.bytes.length); b.set(enc.bytes, 0x4b5c0 - Song.GAMES[94].start); return b; })(), 0x4b5c0);
  assert.strictEqual(p.end, 'loop');
  assert.strictEqual(p.loopTick, 24, 'loop target time');
  assert.strictEqual(p.ticks, 400);
  const ons = p.events.filter((e) => e.kind === 'on');
  assert.deepStrictEqual(ons.map((e) => [e.t, e.ch, e.note, e.vel]), [[0, 0, 60, 100], [0, 1, 48, 90], [24, 0, 64, 80], [40, 7, 38, 110], [40, 7, 70, 110]]);
  const patches = p.events.filter((e) => e.kind === 'patch').map((e) => [e.t, e.ch, e.patch]);
  assert.deepStrictEqual(patches, [[0, 0, 11], [0, 1, 13], [40, 7, 17], [40, 7, 106]]);
  assert.deepStrictEqual(p.events.filter((e) => e.kind === 'bend').map((e) => [e.t, e.bend]), [[30, 4096], [60, 0]]);
  // Each patch select sits right before its own key on.
  const order = p.events.filter((e) => e.ch === 7).map((e) => e.kind + (e.patch != null ? e.patch : e.note));
  assert.deepStrictEqual(order.slice(0, 4), ['patch17', 'on38', 'patch106', 'on70']);
  assert.ok(Stream.toAsm(song, 'test').includes('loop'));
}

// 3. Bends reach MIDI and the reference synth.
{
  const sl = slices[94];
  const gm = Song.toGm(94, sl, 0x7a, map);
  let found = null;
  for (let id = 0x30; id <= 0x7a && !found; id++) {
    const g = Song.toGm(94, sl, id, map);
    if (g.song.bends.length) found = g;
  }
  const bendSong = found || gm;
  assert.ok(bendSong.song.bends.length, 'a retail song with bends exists');
  const smf = Smf.write(SongGm.toSmfSong(bendSong.song));
  const parsed = Smf.parse(smf);
  assert.ok(parsed.bends.length >= bendSong.song.bends.length - 1, 'bends survive the MIDI file');
  const ev = SongGm.gmEvents(bendSong.song);
  assert.ok(ev.some((e) => e.bend && e.bend.length), 'bend curves on events');
  const bent = ev.filter((e) => e.bend).slice(0, 2);
  const buf = Ref.renderEvents(bent);
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  assert.ok(peak > 0.05, 'bent notes are audible');
}

// 4. MIDI import: a GM song becomes a model the drivers play; the retail data is untouched.
for (const g of [93, 94]) {
  const bank = Song.patches(g, slices[g]);
  const src = Song.toGm(g, slices[g], g === 93 ? 0x37 : 0x7a, map);
  const bytes = Smf.write(SongGm.toSmfSong(src.song));
  const norm = SongGm.normalizeGm(Smf.parse(bytes));
  const imp = Stream.fromGm(norm.song, map, g, bank);
  assert.ok(imp.song.notes.length > 50, 'imported notes');
  imp.song.notes.forEach((n) => {
    assert.ok(n.ch >= 0 && n.ch < 8 && n.note >= 12 && n.note <= 95 && n.vel >= 1 && n.dur >= 1, 'note in range');
  });
  const fm = imp.song.notes.filter((n) => n.patch < 0x60);
  // Never more than five FM voices at once.
  fm.forEach((n) => {
    const at = fm.filter((m) => m.t <= n.t && m.t + m.dur > n.t).length;
    assert.ok(at <= 5, 'five FM voices at most, got ' + at);
  });
  const copy = Stream.romWithSong(g, roms[g], imp.song);
  for (let i = 0; i < roms[g].length; i++) {
    const tableLo = Song.GAMES[g].table + (g === 93 ? 2 : 4) * Stream.CUSTOM_SONG[g];
    if (i >= tableLo && i < tableLo + 4) continue; // the one song-table entry that now points at the song
    if (copy.rom[i] !== roms[g][i]) assert.fail('retail byte $' + i.toString(16) + ' changed');
  }
  assert.strictEqual(Song.streamAddr(g, copy.rom.subarray(Song.GAMES[g].start), Stream.CUSTOM_SONG[g]), copy.address);
  // The retail 68k + Z80 drivers play it: notes appear, nothing runs away.
  const chain = Chain.create({ rom: copy.rom, driver: DRIVER[g], keepLogs: true });
  chain.step(null);
  chain.step([{ song: copy.id }]);
  for (let f = 2; f < 240; f++) chain.step(null);
  assert.ok(chain.ymWrites > 500, 'NHL ' + g + ' imported song makes YM2612 writes (' + chain.ymWrites + ')');
}

// 5. A model the drivers play: the notes heard are the notes written.
{
  const g = 94;
  const song = Stream.emptySong(g);
  song.notes = [{ t: 4, dur: 30, ch: 0, note: 69, vel: 110, patch: 11 }];
  song.ticks = 64;
  const copy = Stream.romWithSong(g, roms[g], song);
  const T = require('../lib/audio/ym-note-tracker');
  const tr = T.create();
  const chain = Chain.create({ rom: copy.rom, driver: DRIVER[g], keepLogs: false, onYmWrite: (t, p, v) => tr.writePort(t, p, v), onPsgWrite: (t, v) => tr.psgWrite(t, v), onYmReset: (t) => tr.reset(t) });
  chain.step(null);
  chain.step([{ song: copy.id }]);
  for (let f = 2; f < 90; f++) chain.step(null);
  const notes = tr.notes.filter((n) => n.segs.some((s) => s.midi != null));
  assert.strictEqual(notes.length, 1, 'one note keyed');
  const midi = notes[0].segs.find((s) => s.midi != null).midi;
  assert.ok(Math.abs(midi - 69) <= 1, 'A4 plays as about A4, got ' + midi);
  const burst = tr.patches.find((p) => p.kind === 'patch');
  assert.strictEqual(Song.identify(Song.patches(g, slices[g]), burst.regs, burst.ch), 11);
}

// 6b. Instrument edits (public/sound-patch-editor.js): the 32 patch bytes at table - 1024 + 32 * id in the ROM copy are what
// the driver loads into the chip, so an edited total level / envelope shows up in the register burst.
for (const g of [93, 94]) {
  const song = Stream.emptySong(g);
  song.notes = [{ t: 4, dur: 30, ch: 0, note: 69, vel: 110, patch: 11 }];
  song.ticks = 64;
  const T = require('../lib/audio/ym-note-tracker');
  const burstOf = (rom) => {
    const tr = T.create();
    const chain = Chain.create({ rom, driver: DRIVER[g], keepLogs: false, onYmWrite: (t, p, v) => tr.writePort(t, p, v), onPsgWrite: (t, v) => tr.psgWrite(t, v), onYmReset: (t) => tr.reset(t) });
    chain.step(null);
    chain.step([{ song: copy.id }]);
    for (let f = 2; f < 60; f++) chain.step(null);
    return tr.patches.find((p) => p.kind === 'patch');
  };
  var copy = Stream.romWithSong(g, roms[g], song);
  const at = Song.GAMES[g].table - 1024 + 11 * 32;
  const before = burstOf(copy.rom);
  const edited = Uint8Array.from(copy.rom);
  edited[at + 7] = 101; // operator 4 total level (register $4C)
  edited[at + 20] = 0x3c; // operator 1 sustain level / release rate (register $80)
  const after = burstOf(edited);
  assert.strictEqual(after.regs.get(0x4c), 101, 'NHL ' + g + ': the edited total level reaches the chip');
  assert.strictEqual(after.regs.get(0x80), 0x3c, 'NHL ' + g + ': the edited sustain / release reaches the chip');
  assert.strictEqual(after.regs.get(0x50), before.regs.get(0x50), 'NHL ' + g + ': an unedited register is unchanged');
  assert.strictEqual(before.regs.get(0x4c), slices[g][at - Song.GAMES[g].start + 7], 'NHL ' + g + ': byte 7 of the patch is register $4C');
}
console.log('nhl9x stream: instrument edits written into the ROM copy are what the 93 and 94 drivers load OK');

// 7. DAC (PCM) drums: the roll sees real sample hits, and the kick / snare roles follow the songs' own use.
{
  const Tracker = require('../lib/audio/ym-note-tracker');
  const ym = require('../lib/audio/ym2612-wasm');
  const analysis = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'audio', 'nhl9x-dac-analysis.json'), 'utf8'));
  assert.strictEqual(analysis.samples.length, 13, 'every PCM patch is analysed');
  assert.ok(analysis.kickSnarePairs.some((p) => p.game === 94 && p.sound === '$7A' && Math.abs(p.medianPhase - 0.5) < 0.1), 'in NHL 94 $7A the PCM hit sits between two kicks');
  const byPatch = (n) => map.patches.find((e) => e.patch === n);
  assert.strictEqual(byPatch(20).target.name, 'Bass Drum 1', 'patch 20 is the kick');
  assert.strictEqual(byPatch(106).target.name, 'Acoustic Snare', 'the hithigh sample is the snare');
  assert.strictEqual(map.gmToNhl.drums.find((d) => d.notes.includes(36)).patch, 20, 'importing a kick uses patch 20');
  assert.strictEqual(map.gmToNhl.drums.find((d) => d.notes.includes(38)).note, 76, 'importing a snare plays the sample at the retail pitch');
  (async () => {
    const chip = await ym.createChip();
    const tr = Tracker.create();
    const chain = Chain.create({ rom: roms[94], driver: DRIVER[94], chip, keepLogs: false, onYmWrite: (t, p, v) => tr.writePort(t, p, v), onPsgWrite: (t, v) => tr.psgWrite(t, v), onYmReset: (t) => tr.reset(t) });
    chain.step(null);
    chain.step([{ song: 0x78 }]);
    for (let f = 2; f < 400; f++) chain.step(null);
    chip.dispose();
    assert.ok(tr.dacHits.length >= 8, 'PCM hits are tracked as runs of non-centre $2A writes (' + tr.dacHits.length + ')');
    const ref = byPatch(106).sig;
    const full = tr.dacHits.filter((h) => h.sig.length === 10 && h.sig.every((v, i) => v === ref[i]));
    assert.ok(full.length >= 4, 'full-volume hits carry the $6A fingerprint (' + full.length + ')');
    assert.ok(tr.dacHits.every((h) => h.t1 >= h.t0 && h.writes > 0));
    console.log('nhl9x-stream: DAC hits are tracked and fingerprinted; patch 20 = kick, $6A = snare, import uses both OK');
  })().catch((e) => { console.error(e); process.exit(1); });
}

// 6. Per-channel mute (the roll's lane click): the taps still see every write, the chip makes no sound.
(async () => {
  const ym = require('../lib/audio/ym2612-wasm');
  const run = async (mute) => {
    const chip = await ym.createChip();
    try {
      let taps = 0;
      const chain = Chain.create({ rom: roms[94], driver: DRIVER[94], chip, keepLogs: false, onYmWrite() { taps++; } });
      for (let c = 0; c < 6; c++) if (mute[c]) chain.setChannelMute(c, true);
      chain.step(null);
      chain.step([{ song: 0x30 }]);
      for (let f = 2; f < 200; f++) chain.step(null);
      const pcm = chain.take();
      let peak = 0;
      for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
      return { taps, peak };
    } finally { chip.dispose(); }
  };
  const open = await run([]);
  const all = await run([true, true, true, true, true, true]);
  const one = await run([true, false, false, false, false, false]);
  assert.strictEqual(all.taps, open.taps, 'taps see every write');
  assert.ok(open.peak > 3000, 'unmuted song is audible');
  assert.ok(all.peak < open.peak / 8, 'all FM channels muted is much quieter (' + all.peak + ' vs ' + open.peak + ')');
  assert.ok(one.peak > 0, 'muting one channel keeps the others');
  console.log('nhl9x-stream: ok');
})().catch((e) => { console.error(e); process.exit(1); });

console.log('nhl9x-stream: ok');

// --- Native MIDI: every retail song of both games survives export and import -----------------------
{
  const Smf = require('../lib/audio/smf');
  const key = (s) => JSON.stringify([s.ticks, s.loopTick, s.notes.map((x) => [x.t, x.dur, x.ch, x.note, x.vel, x.patch].join()).sort(), s.bends.map((x) => [x.t, x.ch, x.value].join()).sort()]);
  let songs = 0;
  let mixed = 0;
  for (const g of [93, 94]) {
    for (let id = 0; id < Song.GAMES[g].count; id++) {
      const a = Stream.fromStream(g, slices[g], id);
      if (!a.notes.length) continue;
      const b = Stream.fromSmfNative(Smf.parse(Smf.write(Stream.toSmfNative(a))));
      assert.ok(b, 'native header');
      assert.strictEqual(b.song.game, g);
      assert.strictEqual(key(b.song), key(a), g + ' $' + id.toString(16) + ' survives the native MIDI round trip');
      songs++;
      const per = {};
      a.notes.forEach((n) => { (per[n.ch] = per[n.ch] || new Set()).add(n.patch); });
      if (Object.keys(per).some((c) => per[c].size > 1)) mixed++;
    }
  }
  assert.ok(songs > 150 && mixed >= 1, 'songs ' + songs + ', with several instruments on one channel ' + mixed);
  assert.strictEqual(Stream.fromSmfNative(Smf.parse(Smf.write(SongGm.toSmfSong(Stream.toGm(Stream.emptySong(94), map, Song.patches(94, slices[94])).song)))), null, 'a GM file has no native header');
  console.log('nhl9x-stream: native MIDI round trip of ' + songs + ' retail songs OK (' + mixed + ' with several instruments on one channel)');
}
