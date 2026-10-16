/**
 * YM2612 write -> note tracker (lib/audio/ym-note-tracker.js) and the chain's read-only
 * write taps. Checks:
 *   - block + F-number -> note against the 96-entry note tables the NHL '92 driver uses;
 *   - the tracker's mechanics on synthetic writes (latching, key codes, settle window,
 *     patch bursts, DAC, PSG, reset, trim);
 *   - key-on/off spans per channel from pinned renders' YM logs (song 4's first 300
 *     vblanks, mix 0 where the whistle takes ch4, SFX 13's DAC) against $28 / $2A / $2B
 *     writes counted independently from the pinned log text;
 *   - after music off, only the siren's two channels ever show notes;
 *   - the taps change nothing the chain renders (the pinned WAV hash is unchanged with them
 *     attached) and see exactly the writes the chain counts.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const T = require('../lib/audio/ym-note-tracker');
const C = require('../lib/audio/nhl92-sound-chain');
const R = require('../lib/audio/nhl92-sound-chain-renders');
const SD = require('../lib/audio/nhl92-sound-data');
const ymWasm = require('../lib/audio/ym2612-wasm');
const psgApi = require('../lib/audio/sn76489');
const wav = require('../lib/audio/wav');

const SRC = R.sources();
const ROM = SRC.rom;
const FRAME = C.FRAME_TSTATES;
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'audio', 'nhl92-sound-chain.json'), 'utf8'));
const ITEMS = R.renders(SRC);
const item = (kind, id) => ITEMS.find((r) => r.kind === kind && r.id === id);

// --- Block + F-number -> note, against the driver's tables ------------------------------

{
  const hi = SRC.data.noteTables.freq; // slot +5 -> $A4: block << 3 | F-number bits 8-10
  const lo = SRC.data.noteTables.octave; // slot +6 -> $A0: F-number bits 0-7
  assert.strictEqual(hi.length, 96);
  assert.strictEqual(lo.length, 96);
  let worst = 0;
  for (let n = 0; n < 96; n++) {
    const block = (hi[n] >> 3) & 7;
    const fnum = ((hi[n] & 7) << 8) | lo[n];
    const p = T.fnumToPitch(block, fnum);
    assert.strictEqual(p.note, n, 'table note ' + n + ' reads back as note ' + p.note);
    assert.strictEqual(p.name, SD.noteName(n), 'note ' + n + ' name');
    worst = Math.max(worst, Math.abs(p.cents));
    // The same two bytes through the register path, as the driver writes them (key on first, then $A4, $A0).
    for (let ch = 0; ch < 6; ch++) {
      const tr = T.create();
      const part = ch < 3 ? 0 : 1;
      tr.write(0, 0, 0x28, 0xf0 | T.KEY_CODES[ch]);
      tr.write(40, part, 0xa4 + (ch % 3), hi[n]);
      tr.write(80, part, 0xa0 + (ch % 3), lo[n]);
      const seg = tr.notes[0].segs[0];
      assert.strictEqual(tr.notes[0].ch, ch);
      assert.strictEqual(seg.name, SD.noteName(n), 'ch' + ch + ' note ' + n);
      assert.strictEqual(tr.notes[0].segs.length, 1, 'the F-number after key-on settles the first segment');
    }
  }
  assert.ok(worst < 2, 'the tables are within 2 cents of equal temperament (worst ' + worst.toFixed(2) + ')');
  const c4 = T.fnumToPitch(4, 0x284);
  assert.strictEqual(c4.name, 'C4');
  assert.ok(Math.abs(c4.hz - 261.63) < 0.5, 'C4 = ' + c4.hz.toFixed(2) + ' Hz');
  assert.strictEqual(T.fnumToPitch(3, 0x284 * 2 > 0x7ff ? 0x142 : 0x284 * 2).name, 'C4', 'block 3 with double the F-number is the same pitch');
  assert.strictEqual(T.fnumToPitch(4, 0), null);
  assert.strictEqual(T.midiName(21), 'A0');
  console.log('ym note tracker: all 96 driver notes read back from their block/F-number (worst ' + worst.toFixed(1) + ' cents), on all six channels OK');
}

// --- Mechanics on synthetic writes ------------------------------------------------------

const freq = (tr, t, ch, block, fnum) => {
  const part = ch < 3 ? 0 : 1;
  tr.write(t, part, 0xa4 + (ch % 3), (block << 3) | (fnum >> 8));
  tr.write(t + 20, part, 0xa0 + (ch % 3), fnum & 0xff);
};

{
  // $A4 alone commits nothing; $A0 commits both.
  const tr = T.create();
  freq(tr, 0, 0, 4, 0x284);
  tr.write(100, 0, 0xa4, (5 << 3) | 2);
  tr.write(110, 0, 0x28, 0xf0);
  assert.strictEqual(tr.notes[0].segs[0].name, 'C4', 'a latched high byte alone changes nothing');
  tr.write(120, 0, 0xa0, 0x84);
  assert.strictEqual(tr.notes[0].segs[0].name, 'C5', 'inside the settle window, so the first segment is replaced');
  assert.strictEqual(tr.notes[0].segs[0].block, 5);
  assert.strictEqual(tr.notes[0].segs.length, 1);
  assert.strictEqual(tr.notes[0].segs[0].name, T.fnumToPitch(5, 0x284).name);

  // Key codes: 0,1,2,4,5,6 are YM ch1-6; 3 and 7 don't exist.
  const k = T.create();
  T.KEY_CODES.forEach((code, ch) => k.write(ch * 10, 0, 0x28, 0xf0 | code));
  assert.deepStrictEqual(k.notes.map((n) => n.ch), [0, 1, 2, 3, 4, 5]);
  k.write(100, 0, 0x28, 0xf3);
  k.write(101, 0, 0x28, 0xf7);
  assert.strictEqual(k.stats.invalidKey, 2);
  assert.strictEqual(k.notes.length, 6);
  // Key-on while on doesn't retrigger; key-off while off is ignored; mask 0 ends the note.
  k.write(200, 0, 0x28, 0xf0);
  k.write(210, 0, 0x28, 0x10);
  assert.strictEqual(k.stats.redundantOn[0], 2);
  assert.strictEqual(k.notes.length, 6);
  k.write(220, 0, 0x28, 0x00);
  k.write(230, 0, 0x28, 0x00);
  assert.strictEqual(k.notes[0].t1, 220);
  assert.strictEqual(k.stats.redundantOff[0], 1);
  assert.ok(k.channels[0].keyed === false && k.channels[1].keyed === true);

  // Settle window: a later F-number is a new segment; the same note doesn't split.
  const s = T.create();
  freq(s, 0, 2, 3, 0x200);
  s.write(1000, 0, 0x28, 0xf2);
  assert.strictEqual(s.notes[0].segs[0].inherited, true, 'no F-number yet: inherited pitch');
  freq(s, 1000 + T.SETTLE_T + 1, 2, 3, 0x202);
  assert.strictEqual(s.notes[0].segs.length, 1, 'same semitone after the settle window: still one segment');
  freq(s, 6000, 2, 3, 0x300);
  assert.strictEqual(s.notes[0].segs.length, 2);
  assert.strictEqual(s.notes[0].segs[0].t1, 6000 + 20);
  s.write(7000, 0, 0x28, 0x02);
  assert.strictEqual(s.notes[0].segs[1].t1, 7000);
  assert.strictEqual(s.channels[2].pitch, null);

  // Patch bursts: 26 different registers is a patch, one TL write is a level change; the signature
  // doesn't depend on the channel; a repeated register or a long gap starts a new burst.
  const PATCH = [0x30, 0x38, 0x34, 0x3c, 0x40, 0x48, 0x44, 0x4c, 0x50, 0x58, 0x54, 0x5c, 0x60, 0x68, 0x64, 0x6c,
    0x70, 0x78, 0x74, 0x7c, 0x80, 0x88, 0x84, 0x8c, 0xb0, 0xb4];
  const load = (tr, t, ch, tweak) => PATCH.forEach((reg, i) =>
    tr.write(t + i * 60, ch < 3 ? 0 : 1, reg + (ch % 3), (reg * 7 + 3 + (tweak && reg === 0x4c ? 1 : 0)) & 0xff));
  const p = T.create();
  load(p, 0, 0);
  load(p, 100000, 1);
  load(p, 200000, 4, true);
  p.write(300000, 0, 0x4c, 0x20);
  p.write(300100, 0, 0x4c, 0x21);
  assert.deepStrictEqual(p.patches.map((x) => x.kind), ['patch', 'patch', 'patch', 'level', 'level']);
  assert.strictEqual(p.patches[0].regs.size, 26);
  assert.strictEqual(p.patches[0].sig, p.patches[1].sig, 'same patch bytes on another channel: same signature');
  assert.notStrictEqual(p.patches[0].sig, p.patches[2].sig);
  assert.strictEqual(p.patches[0].algorithm, (0xb0 * 7 + 3) & 7);
  assert.deepStrictEqual(p.patches.map((x) => x.ch), [0, 1, 4, 0, 0]);
  const g = T.create();
  load(g, 0, 0);
  load(g, 26 * 60 + T.PATCH_GAP_T + 10, 0);
  assert.strictEqual(g.patches.length, 2, 'a gap longer than PATCH_GAP_T starts a new burst');

  // DAC on/off, samples counted inside the span.
  const d = T.create();
  d.write(10, 0, 0x2b, 0x80);
  assert.strictEqual(d.channels[5].dac, true);
  for (let i = 0; i < 5; i++) d.write(20 + i, 0, 0x2a, 0x80 + i);
  d.write(50, 0, 0x2b, 0x00);
  d.write(60, 0, 0x2a, 0x80);
  assert.deepStrictEqual(d.dacSpans, [{ t0: 10, t1: 50, writes: 5 }]);
  assert.strictEqual(d.stats.dacWrites, 6);
  d.write(70, 0, 0x2b, 0x80);
  d.finish(99);
  assert.strictEqual(d.dacSpans[1].t1, 99);
  assert.strictEqual(d.channels[5].dac, false);

  // PSG writes are recorded, not interpreted.
  const q = T.create();
  q.psgWrite(5, 0x9f);
  assert.deepStrictEqual(q.psg, [{ t: 5, value: 0x9f }]);

  // Reset: notes end, the registers read back as power-on (no F-number until one is written).
  const r = T.create();
  freq(r, 0, 1, 4, 0x284);
  r.write(100, 0, 0x28, 0xf1);
  r.write(200, 0, 0x2b, 0x80);
  r.reset(500);
  assert.strictEqual(r.notes[0].t1, 500);
  assert.strictEqual(r.dacSpans[0].t1, 500);
  r.write(600, 0, 0x28, 0xf1);
  assert.strictEqual(r.notes[1].segs[0].midi, null);
  assert.strictEqual(r.stats.resets, 1);

  // trim drops only closed things older than the cut.
  const tm = T.create();
  tm.write(0, 0, 0x28, 0xf0);
  tm.write(10, 0, 0x28, 0x00);
  tm.write(20, 0, 0x28, 0xf1);
  tm.write(30, 0, 0x28, 0x01);
  tm.write(40, 0, 0x28, 0xf2);
  tm.trim(25);
  assert.deepStrictEqual(tm.notes.map((n) => n.ch), [1, 2]);
  tm.trim(1e9);
  assert.deepStrictEqual(tm.notes.map((n) => n.ch), [2], 'an open note is never trimmed');

  // Raw port writes (what the chain tap gives) and decoded writes make the same tracker; junk never throws.
  let seed = 12345;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
  const a = T.create();
  const b = T.create();
  const lat = [0, 0];
  for (let i = 0; i < 6000; i++) {
    const t = i * 37;
    const part = rnd(2);
    const reg = [0x28, 0x28, 0x2a, 0x2b, 0xa0, 0xa4, 0xa1, 0xa5, 0xa2, 0xa6, 0xa3, 0xa8, 0xb0, 0xb4, 0x30 + rnd(0x70), 0x27, rnd(256)][rnd(17)];
    const v = reg === 0x28 ? (rnd(2) ? 0xf0 : 0) | rnd(8) : rnd(256);
    b.writePort(t, part * 2, reg);
    b.writePort(t, part * 2 + 1, v);
    lat[part] = reg;
    a.write(t, part, reg, v);
  }
  a.finish(6000 * 37);
  b.finish(6000 * 37);
  const shape = (tr) => JSON.stringify({ n: tr.notes, s: tr.stats, d: tr.dacSpans, p: tr.patches.map((x) => [x.ch, x.t0, x.t1, x.regs.size, x.kind]) });
  assert.strictEqual(shape(a), shape(b));
  assert.ok(a.notes.length > 40, 'random writes should start notes, got ' + a.notes.length + ' ' + JSON.stringify(a.stats));
  console.log('ym note tracker: latching, key codes, settle window, patch bursts, DAC, PSG, reset, trim, port vs decoded writes OK');
}

// --- Independent counts from the pinned log text -----------------------------------------

const CH_OF_CODE = [0, 1, 2, null, 3, 4, 5, null];
/** $28 / $2A / $2B counted straight from "t part:reg=value" lines, without the tracker's decoder. */
function independent(lines, endT) {
  const keys = Array.from({ length: 6 }, () => ({ writes: 0, spans: [], open: null }));
  const dac = { spans: [], open: null, w2a: 0 };
  for (const line of lines) {
    const m = /^(\d+) 0:([0-9a-f]{2})=([0-9a-f]{2})$/.exec(line);
    if (!m) continue;
    const t = Number(m[1]);
    const reg = parseInt(m[2], 16);
    const v = parseInt(m[3], 16);
    if (reg === 0x28) {
      const ch = CH_OF_CODE[v & 7];
      if (ch === null) continue;
      const k = keys[ch];
      k.writes += 1;
      if (v & 0xf0) {
        if (!k.open) { k.open = { t0: t, t1: null }; k.spans.push(k.open); }
      } else if (k.open) { k.open.t1 = t; k.open = null; }
    } else if (reg === 0x2a) {
      dac.w2a += 1;
      if (dac.open) dac.open.writes += 1;
    } else if (reg === 0x2b) {
      if (v & 0x80) { if (!dac.open) { dac.open = { t0: t, t1: null, writes: 0 }; dac.spans.push(dac.open); } }
      else if (dac.open) { dac.open.t1 = t; dac.open = null; }
    }
  }
  for (const k of keys) for (const s of k.spans) if (s.t1 === null) s.t1 = endT;
  for (const s of dac.spans) if (s.t1 === null) s.t1 = endT;
  return { keys, dac };
}

function checkAgainstText(name, tr, lines, endT) {
  const ind = independent(lines, endT);
  for (let ch = 0; ch < 6; ch++) {
    const mine = tr.notes.filter((n) => n.ch === ch).map((n) => ({ t0: n.t0, t1: n.t1 }));
    assert.deepStrictEqual(mine, ind.keys[ch].spans, name + ' ch' + ch + ': key-on/off spans');
    assert.strictEqual(tr.stats.keyWrites[ch], ind.keys[ch].writes, name + ' ch' + ch + ': $28 writes');
    assert.strictEqual(tr.stats.keyOns[ch], ind.keys[ch].spans.length);
  }
  assert.deepStrictEqual(tr.dacSpans.map((d) => ({ t0: d.t0, t1: d.t1, writes: d.writes })), ind.dac.spans, name + ' DAC spans');
  assert.strictEqual(tr.stats.dacWrites, ind.dac.w2a, name + ' $2A writes');
  return ind;
}

const sha = R.sha256;
const pinOf = (list, id) => list.find((e) => e.id === id);
function pinnedLog(it, pin) {
  const chain = C.runPlan(it.plan, { rom: ROM });
  const text = R.logText(it, chain);
  assert.strictEqual(sha(text), pin.log, it.file + ': the YM log is the pinned one');
  return { chain, lines: text.split('\n').slice(2) };
}
const notesOf = (tr, ch) => tr.notes.filter((n) => n.ch === ch);

(async () => {
  // Song 4, first 300 vblanks (frames 1-300; frame 0 is the boot).
  {
    const { chain, lines } = pinnedLog(item('song', 4), pinOf(MANIFEST.songs, 4));
    const cut = chain.records[301].ymStart;
    const endT = 301 * FRAME;
    const tr = T.trackLog(chain.z.ym.slice(0, cut), undefined, endT);
    const ind = checkAgainstText('song 4 [0,300] vblanks', tr, lines.slice(0, cut), endT);
    const total = ind.keys.reduce((s, k) => s + k.spans.length, 0);
    assert.ok(total > 60, 'song 4 plays notes in its first 300 vblanks (' + total + ')');
    assert.strictEqual(tr.notes.length, total);
    assert.ok(tr.notes.every((n) => n.segs[0].midi != null && !n.segs[0].inherited), 'every note got its F-number inside the settle window');
    assert.ok(tr.notes.every((n) => n.segs.every((s) => s.name && /^[A-G]#?\d$/.test(s.name))));
    assert.strictEqual(tr.stats.invalidKey, 0);
    assert.strictEqual(tr.stats.psgWrites, 0);
    console.log('ym note tracker: song 4, first 300 vblanks: ' + total + ' notes, spans and $28 counts match the pinned log per channel OK');
  }

  // Mix 0: SngEOP with the whistle (driver ch4 = YM ch5, key-on code 5) at vb 120 and the foghorn (ch0 + ch1) at vb 360.
  {
    const { chain, lines } = pinnedLog(item('mix', 0), pinOf(MANIFEST.mixes, 0));
    const tr = T.trackLog(chain.z.ym, undefined, chain.records.length * FRAME);
    checkAgainstText('mix 0', tr, lines, chain.records.length * FRAME);
    const alone = T.trackLog(C.runPlan(C.sfxPlan(10, 40), { rom: ROM }).z.ym);
    assert.strictEqual(alone.notes.length, 1);
    assert.strictEqual(alone.notes[0].ch, 4, 'the whistle plays on YM ch5');
    const whistle = alone.notes[0].segs.map((s) => s.name);
    const during = notesOf(tr, 4).filter((n) => n.t0 >= 120 * FRAME && n.t0 < 123 * FRAME);
    assert.strictEqual(during.length, 1, 'the whistle keys on in its own vblank');
    assert.deepStrictEqual(during[0].segs.map((s) => s.name), whistle, 'the mix shows the whistle\'s own pitch run on ch5');
    const horn = [0, 1].map((ch) => notesOf(tr, ch).filter((n) => n.t0 >= 360 * FRAME && n.t0 < 363 * FRAME).length);
    assert.deepStrictEqual(horn, [1, 1], 'the foghorn keys on FM1 and FM2 at vb 360');
    console.log('ym note tracker: mix 0: whistle on FM5 (' + whistle.join('>') + ') at vb 120, foghorn on FM1+FM2 at vb 360, counts match the pinned log OK');
  }

  // SFX 13: slap shot, a DAC sample.
  {
    const { chain, lines } = pinnedLog(item('sfx', 13), pinOf(MANIFEST.sfx, 13));
    const endT = chain.records.length * FRAME;
    const tr = T.trackLog(chain.z.ym, undefined, endT);
    const ind = checkAgainstText('sfx 13', tr, lines, endT);
    const big = tr.dacSpans.filter((d) => d.writes > 0);
    assert.strictEqual(big.length, 1);
    assert.ok(big[0].writes > 1000, 'the slap shot streams its sample through $2A (' + big[0].writes + ' writes)');
    assert.strictEqual(tr.notes.length, 0, 'a DAC-only SFX has no FM notes');
    assert.ok(ind.dac.w2a === tr.stats.dacWrites);
    console.log('ym note tracker: SFX 13: one DAC span with ' + big[0].writes + ' samples, no FM notes, matches the pinned log OK');
  }

  // Siren after music off: only the siren's channels (FM1, FM2) ever show notes.
  {
    const it = item('sfx-music-off', 0);
    const { chain, lines } = pinnedLog(it, pinOf(MANIFEST.sfxMusicOff, 0));
    const endT = chain.records.length * FRAME;
    const tr = T.trackLog(chain.z.ym, undefined, endT);
    checkAgainstText('siren after music off', tr, lines, endT);
    assert.ok(tr.stats.keyOns[0] >= 1 && tr.stats.keyOns[1] >= 1);
    for (let ch = 2; ch < 6; ch++) {
      assert.strictEqual(tr.stats.keyOns[ch], 0, 'FM' + (ch + 1) + ' never keys on');
      assert.strictEqual(tr.stats.redundantOff[ch], tr.stats.keyWrites[ch], 'FM' + (ch + 1) + ' only sees key-offs');
    }
    assert.ok(tr.notes.every((n) => n.ch <= 1));
    assert.ok(tr.notes[0].t0 >= 3 * FRAME, 'no note before the siren\'s own vblank (frame 3): ' + tr.notes[0].t0 / FRAME);
    assert.ok(tr.dacSpans.every((d) => d.writes === 0), 'the DAC only ever plays the empty sample');
    assert.strictEqual(tr.stats.psgWrites, 0);
    assert.ok(tr.patches.filter((p) => p.kind === 'patch').map((p) => p.ch).sort().join() === '0,1', 'both siren channels load a patch');
    console.log('ym note tracker: siren after music off: notes only on FM1/FM2, first at frame ' + (tr.notes[0].t0 / FRAME).toFixed(2) + ', no DAC samples, no PSG OK');

    // The chain's taps: they see exactly the writes the chain counts, feed the tracker the same way
    // the log does, and change nothing the chain renders (the pinned WAV hash holds with them attached).
    const pin = pinOf(MANIFEST.sfxMusicOff, 0);
    const live = T.create();
    const psgTap = [];
    let ymTaps = 0;
    let resets = 0;
    const chip = await ymWasm.createChip();
    try {
      const withTap = C.runPlan(it.plan, {
        rom: ROM, chip, psg: psgApi.create(),
        onYmWrite(t, port, value) { ymTaps += 1; live.writePort(t, port, value); },
        onPsgWrite(t, value) { psgTap.push([t, value]); },
        onYmReset(t) { resets += 1; live.reset(t); }
      });
      const bytes = wav.encode16(withTap.take(), C.SAMPLE_RATE, 2);
      assert.strictEqual(sha(bytes), pin.wav, 'the pinned WAV hash is unchanged with the taps attached');
      assert.strictEqual(sha(R.logText(it, withTap)), pin.log, 'and so is the YM log');
      assert.strictEqual(ymTaps, pin.ymWrites, 'the tap sees every YM port write');
      assert.strictEqual(withTap.ymWrites, ymTaps);
      assert.strictEqual(psgTap.length, 0);
      assert.strictEqual(resets, 1, 'the boot asserts RESET once, before anything reached the chip');
    } finally {
      chip.dispose();
    }
    live.finish(endT);
    assert.deepStrictEqual(live.notes, tr.notes, 'the live tap path and the log path give the same notes');
    assert.deepStrictEqual(live.dacSpans, tr.dacSpans);
    console.log('ym note tracker: chain taps are read-only (pinned siren WAV and log hashes unchanged), see all ' + ymTaps + ' writes, same notes as the log OK');
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
