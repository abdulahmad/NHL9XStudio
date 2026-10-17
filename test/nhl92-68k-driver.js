/**
 * Step 6: the retail NHL '92 68k sound driver (ROM bytes) on the m68k-cpu.js
 * core, on its own. Checks determinism, that the driver writes only where it
 * should, that it walks the order lists and times notes the way the step-5
 * parser reads the data, and spot-checks against values written in sound.asm.
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const H = require('../lib/audio/nhl92-68k-harness');
const R = require('../lib/audio/nhl92-68k-run');
const A = require('../lib/audio/nhl92-68k-analysis');
const SD = require('../lib/audio/nhl92-sound-data');
const names = require('../lib/audio/nhl92-sfx-names');
const fixture = require('../lib/audio/nhl92-sound-fixture');

const ROM = fixture.resolveRom(null);
const PROGRAM = fixture.getEmbeddedZ80Program();
const DATA = SD.parse(ROM);
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'audio', 'nhl92-68k-driver.json'), 'utf8'));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hex = SD.hex;

// --- Boot: p_initialZ80, p_turnoff, p_music_vblank ------------------------------------------
{
  const h = H.create({ rom: ROM });
  const r = R.record(h.boot());
  // Sound_LoadZ80Program copies $597 bytes in order (dbf entered at the dbf); byte $0597
  // is never written. The boot's p_music_vblank then writes the buffer, flag and SFX bytes.
  const copy = r.z80.slice(0, 0x597);
  assert.deepStrictEqual(copy, Array.from(PROGRAM.subarray(0, 0x597)).map((v, i) => [i, v]), 'Z80 program copied byte for byte');
  assert.ok(r.z80.slice(0x597).every(([z]) => (z >= 0x273 && z < 0x2a4) || (z >= 0xbe && z < 0xc4)), 'then only buffer/flag/SFX bytes');
  assert.strictEqual(h.z80[0x597], 0);
  // sound.asm: p_initialZ80 (reset $100, busreq $100), Sound_LoadZ80Program (reset $100,
  // busreq $100 ... reset 0, busreq 0, reset $100), then p_music_vblank (busreq $100, busreq 0).
  assert.deepStrictEqual(r.io, [
    ['reset', 0x100], ['busreq', 0x100], ['reset', 0x100], ['busreq', 0x100], ['reset', 0], ['busreq', 0],
    ['reset', 0x100], ['busreq', 0x100], ['busreq', 0]
  ]);
  // p_turnoff -> Sound_PauseMusic -> configure_ym2612: the empty DAC sample $14882 (move.l #$53BA,d1; #$B; #0).
  assert.deepStrictEqual(r.sfx, { 0xbe: 0x82, 0xbf: 0xc8, 0xc0: 0x00, 0xc1: 0x0b, 0xc2: 0x02, 0xc3: 0x00 });
  assert.deepStrictEqual(r.unexpected, []);
  assert.deepStrictEqual(h.unexpectedReads, []);
}
console.log('nhl92 68k driver: boot loads the Z80 program and handshakes as sound.asm does OK');

// --- Canonical runs: determinism, writes, cross-checks ------------------------------------
const runs = { songs: [], sfx: [] };
for (const [id, frames] of R.PLAN.songs) {
  const run = R.runSong(ROM, id, frames);
  const log = R.logText(run, 'NHL 92 68k driver · song ' + id + ' ' + DATA.songs[id].name + ' · ' + frames + ' vblanks');
  runs.songs.push({ id, run, log });
}
for (const [id, frames] of R.PLAN.sfx) {
  const run = R.runSfx(ROM, id, frames);
  const log = R.logText(run, 'NHL 92 68k driver · SFX ' + names.name(id) + ' · ' + frames + ' vblanks');
  runs.sfx.push({ id, run, log });
}
{
  // Same input, same bytes: a second run of two songs and two SFX, and every log vs its pinned hash.
  for (const id of [1, 4]) {
    const frames = R.PLAN.songs.find(([s]) => s === id)[1];
    const again = R.logText(R.runSong(ROM, id, frames), 'NHL 92 68k driver · song ' + id + ' ' + DATA.songs[id].name + ' · ' + frames + ' vblanks');
    assert.strictEqual(again, runs.songs.find((s) => s.id === id).log, 'song ' + id + ' log identical on a second run');
  }
  for (const id of [0, 26]) {
    const again = R.logText(R.runSfx(ROM, id, 600), 'NHL 92 68k driver · SFX ' + names.name(id) + ' · 600 vblanks');
    assert.strictEqual(again, runs.sfx.find((s) => s.id === id).log, 'SFX ' + id + ' log identical on a second run');
  }
  runs.songs.forEach((s, i) => assert.strictEqual(sha256(s.log), MANIFEST.songs[i].sha256, 'song ' + s.id + ' log hash'));
  runs.sfx.forEach((s, i) => assert.strictEqual(sha256(s.log), MANIFEST.sfx[i].sha256, 'SFX ' + s.id + ' log hash'));
}
console.log('nhl92 68k driver: logs byte-identical across runs and match pinned hashes OK');

{
  // Writes: the driver touches only Z80 RAM (program/buffer/flag/SFX bytes), the Z80
  // bus and reset ports, the sound RAM and the stack; the game wrappers only the stack
  // and lastsfx. Every call returned (the harness throws otherwise).
  let z80Other = 0;
  for (const r of runs.songs.concat(runs.sfx)) {
    const all = [r.run.boot, r.run.start].concat(r.run.settle ? [r.run.settle] : [], r.run.frames);
    for (const rec of all) assert.deepStrictEqual(rec.unexpected, [], r.run.kind + ' ' + r.id + ': unexpected writes');
    for (const rec of r.run.frames) {
      for (const [z] of rec.z80) if (!((z >= 0x273 && z < 0x2a4) || (z >= 0xbe && z < 0xc4))) z80Other += 1;
    }
    assert.deepStrictEqual(r.run.harness.unexpectedReads, [], r.run.kind + ' ' + r.id + ': unexpected reads');
  }
  assert.strictEqual(z80Other, 0, 'per-vblank Z80 writes are only $0273-$02A3 and $00BE-$00C3');
}
console.log('nhl92 68k driver: writes only Z80 buffer/flag/SFX bytes, bus/reset, sound RAM and stack OK');

{
  // Songs vs the step-5 parser: pattern order per channel and every key event.
  for (const { id, run } of runs.songs) {
    const walk = A.compareWalk(run, DATA);
    for (const c of walk.channels) assert.ok(c.ok, 'song ' + id + ' ch' + c.channel + ' walk: ' + JSON.stringify(c.divergence));
    for (const seg of A.compareNotes(run, DATA)) {
      for (const c of seg.channels) {
        assert.ok(c.ok, 'song ' + id + ' segment ' + seg.song + ' ch' + c.channel + ' notes: ' + JSON.stringify(c.divergence));
      }
    }
  }
  // SngTitle: channels 1-5 have no end marker. They finish their last Title pattern on
  // vblank 8,449, read on into the SngTitle reprise lists and enter its first pattern in
  // that same vblank; channel 0 then reads $0001 $0002 (p_initune 2), and vblank 8,450
  // restarts every channel on song 2.
  const title = A.compareWalk(runs.songs[1].run, DATA);
  assert.strictEqual(title.switchFrame, 8450);
  assert.deepStrictEqual(title.starts, [{ frame: 0, song: 1 }, { frame: 8450, song: 2 }]);
  assert.strictEqual(title.channels[0].firstReadPastEnd, null);
  for (const ch of [1, 2, 3, 4, 5]) {
    const c = title.channels[ch];
    assert.ok(c.firstReadPastEnd && c.firstReadPastEnd.frame === 8449, 'Title ch' + ch + ' reads past its list on vblank 8,449');
    assert.ok(c.fallThroughEntries.length >= 1 && c.fallThroughEntries.every((e) => e.frame === 8449));
  }
  const segs = A.compareNotes(runs.songs[1].run, DATA);
  assert.deepStrictEqual(segs.map((s) => [s.song, s.from, s.to]), [[1, 0, 8450], [2, 8450, 9000]]);
  // Every other song loops ($0000) and never switches within its run.
  for (const { id, run } of runs.songs) if (id !== 1) assert.strictEqual(A.compareWalk(run, DATA).switchFrame, null);
}
console.log('nhl92 68k driver: all 5 songs walk the order lists and time every note as parsed; SngTitle -> reprise @8450 OK');

{
  // SFX vs the parser's decoding of each handler.
  for (const { id, run } of runs.sfx) {
    const c = A.checkSfx(run, DATA);
    assert.ok(c.ok, 'SFX ' + id + ': ' + JSON.stringify(c));
  }
  // Siren uses instrument 0 on channels 0/1; after p_initialZ80 clears the workspace
  // each channel's instrument byte is 0, so .effect_instrument skips the patch load.
  const siren = A.checkSfx(runs.sfx[0].run, DATA);
  assert.deepStrictEqual(siren.fm.map((f) => f.skippedLoad), [true, true]);
}
console.log('nhl92 68k driver: all 35 SFX IDs hand the Z80 what their handlers encode OK');

// --- Spot-checks against sound.asm ---------------------------------------------------------
{
  const po = runs.songs.find((s) => s.id === 4).run;
  // fmtune_pointer_table SngPO: dc.w $0507 (tempo 7). fmtune_song4_ch0: dc.w $11A3, $0002, $0003, $1A41, $0000.
  const walk = A.patternWalk(po);
  assert.deepStrictEqual(walk.channels[0].entries.slice(0, 6).map((e) => e.pattern), [
    0xf4c8 + 0x11a3, 0xf4c8 + 0x11a3, 0xf4c8 + 0x11a3, 0xf4c8 + 0x11a3, 0xf4c8 + 0x1a41, 0xf4c8 + 0x11a3
  ], '$0002 $0003 plays the previous pattern 3 more times; $0000 restarts');
  // Pattern $1066B starts $80 $01 (instrument 1), $A2 (2 x tempo 7 = 14 vblanks), $1F, $1F.
  const keys = A.observedKeys(po, 0, 0, 40);
  const g2 = [DATA.noteTables.freq[0x1f], DATA.noteTables.octave[0x1f]];
  assert.deepStrictEqual(keys.slice(0, 5), [
    { frame: 0, kind: 'off' },
    { frame: 1, kind: 'on', freq: g2 },
    { frame: 14, kind: 'off' },
    { frame: 15, kind: 'on', freq: g2 },
    { frame: 28, kind: 'off' }
  ]);
  assert.deepStrictEqual(po.frames[1].buffer.slice(0, 3), [0x00, 0x02, 0xc5], 'slot 0 loads Z80 patch $02C5 (instrument 1)');
}
{
  // Transpose: fmtune_song1_ch1 starts $116D -> $10635, the stub $88 $0C $84 (transpose +12).
  const title = runs.songs.find((s) => s.id === 1).run;
  const walk = A.patternWalk(title);
  assert.strictEqual(walk.channels[1].entries[0].pattern, 0x10635);
  const first = DATA.patternEntries.find((p) => p.start === walk.channels[1].entries[1].pattern);
  const note = first.events.find((e) => e.kind === 'note').note;
  const instr = first.events.find((e) => e.kind === 'instrument').patch;
  const n = note + 12 + DATA.patches[instr].noteOffset;
  const on = A.observedKeys(title, 1, 0, 100).find((k) => k.kind === 'on');
  assert.deepStrictEqual(on.freq, [DATA.noteTables.freq[n], DATA.noteTables.octave[n]], 'first note is transposed +12');
}
{
  // SFX handlers (sound.asm; labels are the table position = SFX ID). handle_sfx_sam_crowdgoal (25:
  // move.l #$793C,d1; #$13; #0) plays sample $F4C8+$793C = $16E04. handle_sfx_sam_booing (26: #$E2BE;
  // #$18; #0) plays $1D786.
  assert.deepStrictEqual(runs.sfx[25].run.frames[0].sfx, { 0xbe: 0x04, 0xbf: 0xee, 0xc0: 0, 0xc1: 0x13, 0xc2: 0x02, 0xc3: 0 });
  assert.deepStrictEqual(runs.sfx[26].run.frames[0].sfx, { 0xbe: 0x86, 0xbf: 0xd7, 0xc0: 0, 0xc1: 0x18, 0xc2: 0x03, 0xc3: 0 });
  assert.deepStrictEqual([DATA.sfx[25].label, DATA.sfx[26].label], ['sam_crowdgoal', 'sam_booing']);
  // ID 24 = handle_sfx_foghorn (SFXhorn): two FM streams.
  assert.deepStrictEqual(DATA.sfx[24].actions.map((a) => [a.channel, a.stream - 0xf4c8]), [[0, 0xb64], [1, 0xb8c]]);
  assert.strictEqual(DATA.sfx[24].label, 'foghorn');
  assert.deepStrictEqual(names.EQUATES[24], ['SFXhorn']);
  // ID 15 (handle_sfx_sam_hitboard1): DAC $53BE rate $13 priority 1, then handle_sfx_hitboard (FM ch2 $BDE).
  const p15 = runs.sfx[15].run.frames[0].sfx;
  assert.deepStrictEqual(p15, { 0xbe: 0x86, 0xbf: 0xc8, 0xc0: 0, 0xc1: 0x13, 0xc2: 0x02, 0xc3: 1 });
}
console.log('nhl92 68k driver: tempo, order-list commands, transpose and SFX handlers match sound.asm OK');

// --- Harness guards --------------------------------------------------------------------------
{
  // Runaway: a vblank that cannot finish within its instruction budget fails.
  const h = H.create({ rom: ROM, budget: 50 });
  assert.throws(() => h.boot(), (e) => e instanceof H.DriverError && /runaway/.test(e.message));
  // PC leaving the sound code fails: point SFX 0's table entry into the pattern data.
  const bad = new Uint8Array(ROM);
  bad.set([0x00, 0x00, 0x11, 0x56], 0xfa92); // $F4C8 + $1156 = $1061E (data)
  const h2 = H.create({ rom: bad });
  h2.boot();
  assert.throws(() => h2.sfx(0), (e) => e instanceof H.DriverError && /left the sound code/.test(e.message));
  // The game wrappers, re-assembled from middle.asm, exist in the retail ROM when it is present.
  const romPath = path.join(__dirname, '..', 'roms', 'nhl92.bin');
  if (fs.existsSync(romPath)) {
    const full = fs.readFileSync(romPath);
    for (const kind of ['sfx', 'song']) {
      const bytes = Buffer.from(H.wrapperBytes(kind));
      assert.ok(full.indexOf(bytes) >= 0, kind + ' wrapper bytes found in the retail ROM');
    }
  } else {
    console.log('nhl92 68k driver: SKIP wrapper-vs-retail check (no roms/nhl92.bin)');
  }
}
console.log('nhl92 68k driver: runaway and stray-PC guards fire OK');
