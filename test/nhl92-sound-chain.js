/**
 * Step 7: the connected NHL '92 sound chain (lib/audio/nhl92-sound-chain.js). The
 * retail 68k driver writes into the same Z80 RAM the retail Z80 driver runs from,
 * and the Z80's YM2612/PSG writes drive the chip cores. Checks the shared RAM and
 * bus handshake, that the 68k side still matches step 6, that every YM write is
 * what the Z80 driver makes of that vblank's 48-byte buffer, DAC SFX, a silent
 * PSG, the SngTitle -> reprise switch, and pinned WAV/log hashes.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../lib/audio/nhl92-sound-chain');
const Z80 = require('../lib/audio/nhl92-z80-harness');
const Run = require('../lib/audio/nhl92-68k-run');
const R = require('../lib/audio/nhl92-sound-chain-renders');
const wav = require('../lib/audio/wav');
const fixture = require('../lib/audio/nhl92-sound-fixture');

const SRC = R.sources();
const ROM = SRC.rom;
const PROGRAM = fixture.getEmbeddedZ80Program();
const FRAME = C.FRAME_TSTATES;
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'audio', 'nhl92-sound-chain.json'), 'utf8'));
const STEP6 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'audio', 'nhl92-68k-driver.json'), 'utf8'));

const PATCH_REGS = [
  0x30, 0x38, 0x34, 0x3c, 0x40, 0x48, 0x44, 0x4c, 0x50, 0x58, 0x54, 0x5c, 0x60,
  0x68, 0x64, 0x6c, 0x70, 0x78, 0x74, 0x7c, 0x80, 0x88, 0x84, 0x8c, 0xb0, 0xb4
];
const SLOT_CHANNELS = [0, 1, 2, 4, 5, 6];
const hex = (n) => '$' + n.toString(16).toUpperCase();
const fmt = (w) => w.part + ':' + hex(w.reg) + '=' + hex(w.value);
const isDac = (w) => w.part === 0 && (w.reg === 0x2a || w.reg === 0x2b);

/** What the Z80 driver writes for one 8-byte slot (step 3's decode, test/nhl92-z80-driver.js). */
function expectedSlot(c, s) {
  const part = c >> 2;
  const ch = c & 3;
  const out = [];
  const w = (p, reg, value) => out.push(fmt({ part: p, reg, value }));
  if (!(s[0] & 0x80)) {
    const at = (s[1] << 8) | s[2];
    PATCH_REGS.forEach((reg, j) => w(part, reg + ch, PROGRAM[at + j]));
  }
  if (!(s[3] & 0x80)) {
    w(0, 0x28, c);
    if (s[3] & 1) w(0, 0x28, c + 0xf0);
  }
  if (!(s[4] & 0x80)) {
    w(part, 0xa4 + ch, s[5]);
    w(part, 0xa0 + ch, s[6]);
  }
  if (!(s[7] & 0x80)) w(part, 0x4c + ch, s[7]);
  return out;
}
const expectedFrame = (buf) => SLOT_CHANNELS.flatMap((c, i) => expectedSlot(c, buf.slice(i * 8, i * 8 + 8)));

/** Each frame's YM writes: from the frame's start to the next (the Z80 stops on an instruction boundary). */
function framesOf(chain) {
  const r = chain.records;
  return r.map((e, f) => chain.z.ym.slice(e.ymStart, f + 1 < r.length ? r[f + 1].ymStart : chain.z.ym.length));
}
function runFrames(plan) {
  const chain = C.runPlan(plan, { rom: ROM });
  return { chain, frames: framesOf(chain) };
}

/**
 * Every frame's non-DAC YM writes are exactly what the Z80 driver makes of the 48-byte
 * buffer the 68k handed over that vblank. With update flag 1 the Z80 must write
 * nothing; an SFX request clears the flag without a new buffer (step 3), and the Z80
 * then reprocesses the slots it already consumed.
 */
function checkBuffers(name, chain, frames) {
  const counts = { buffer: 0, skipped: 0, sfxOnly: 0 };
  chain.records.forEach((e, f) => {
    const v = e.vblank;
    const slots = e.handoff.slice(0, 48);
    const fm = frames[f].filter((w) => !isDac(w)).map(fmt);
    if (v.buffer) assert.deepStrictEqual(slots, v.buffer, name + ' frame ' + f + ': the Z80 finds the 68k buffer');
    assert.strictEqual(e.handoff[48], v.flag, name + ' frame ' + f + ': update flag');
    if (v.flag === 1) {
      assert.deepStrictEqual([v.buffer, fm], [null, []], name + ' frame ' + f + ': flag 1, no update');
      counts.skipped += 1;
      return;
    }
    if (v.buffer) counts.buffer += 1;
    else {
      assert.ok(v.sfx, name + ' frame ' + f + ': flag 0 without a buffer only for an SFX request');
      counts.sfxOnly += 1;
    }
    assert.deepStrictEqual(fm, expectedFrame(slots), name + ' frame ' + f);
  });
  return counts;
}

/** Each DAC request streams its ROM bytes from (BF:BE)+1 in bank C2 to the 0 terminator. */
function checkDac(name, chain) {
  const reqs = [];
  for (const e of chain.records) for (const r of e.calls.concat([e.vblank])) if (r.sfx) reqs.push({ frame: e.frame, s: r.sfx });
  const dac = chain.z.ym.filter(isDac);
  return reqs.map((q, i) => {
    const s = q.s;
    const start = ((s[0xc2] << 15) | (((s[0xbf] << 8) | s[0xbe]) & 0x7fff)) + 1;
    const bytes = [];
    for (let a = start; ROM[a] !== 0; a++) if ((a & 0x7fff) !== 0x7fff) bytes.push(ROM[a]);
    const lo = q.frame * FRAME;
    const hi = i + 1 < reqs.length ? reqs[i + 1].frame * FRAME : Infinity;
    const got = dac.filter((w) => w.t >= lo && w.t < hi).map(fmt);
    const want = ['0:$2B=$80'].concat(bytes.map((b) => '0:$2A=' + hex(b)), ['0:$2B=$0']);
    if (got.length === want.length || hi === Infinity) {
      assert.deepStrictEqual(got, want, name + ': DAC request at frame ' + q.frame + ' plays to the terminator');
    } else {
      assert.deepStrictEqual(got, want.slice(0, got.length), name + ': DAC request at frame ' + q.frame + ' (cut by the next request)');
    }
    return { frame: q.frame, start, bytes: bytes.length };
  });
}

/** The game calls (song/sfx wrappers -> p_initune/p_initfx) never touch the Z80 side. */
function checkCalls(name, chain) {
  for (const e of chain.records) {
    for (const c of e.calls) {
      assert.deepStrictEqual([c.z80.length, c.io.length, c.unexpected.length], [0, 0, 0], name + ' ' + c.label + ' at frame ' + e.frame);
    }
  }
}

/** After boot, every vblank's handshake is busreq $100 then $0, leaving the Z80 running. */
function checkHandshake(name, chain) {
  assert.deepStrictEqual(chain.unheldWrites, [], name + ': the 68k writes Z80 RAM only while it holds the bus');
  const later = chain.ioEvents.filter((e) => e.frame > 0);
  assert.strictEqual(later.length, 2 * (chain.frame - 1), name + ': one bus hold per vblank');
  later.forEach((e, i) => assert.deepStrictEqual([e.kind, e.value], ['busreq', i % 2 ? 0 : 0x100]));
  assert.strictEqual(chain.busHeld || chain.resetHeld, false);
}

(async () => {
  // --- Shared Z80 RAM and the bus handshake ---------------------------------------------
  {
    const chain = C.create({ rom: ROM });
    assert.strictEqual(chain.m68k.z80, chain.z80Ram, 'the 68k harness writes the chain RAM');
    assert.strictEqual(chain.z.ram, chain.z80Ram, 'the Z80 runs from the chain RAM');
    assert.ok(chain.resetHeld, 'power-on: Z80 in reset');
    chain.m68k.boot();
    // Straight after the 68k boot, before the Z80 runs: the program byte for byte, except
    // the vblank's buffer/flag and SFX bytes; $0597 is never copied.
    for (let a = 0; a < Z80.RAM_SIZE; a++) {
      if ((a >= 0x273 && a < 0x2a4) || (a >= 0xbe && a < 0xc4)) continue;
      assert.strictEqual(chain.z80Ram[a], a < Z80.RETAIL_LOAD_LENGTH ? PROGRAM[a] : 0, 'Z80 RAM ' + hex(a));
    }
  }
  {
    const chain = C.create({ rom: ROM });
    chain.step();
    assert.deepStrictEqual(chain.ioEvents.map((e) => [e.kind, e.value]), [
      ['reset', 0x100], ['busreq', 0x100], ['reset', 0x100], ['busreq', 0x100], ['reset', 0], ['busreq', 0],
      ['reset', 0x100], ['busreq', 0x100], ['busreq', 0]
    ]);
    assert.deepStrictEqual(chain.unheldWrites, []);
    assert.ok(!chain.busHeld && !chain.resetHeld, 'boot leaves the Z80 running');
    assert.ok(chain.z.tstates() >= FRAME && chain.z.tstates() < FRAME + 30, 'the Z80 ran to the end of frame 0');
  }
  {
    // A stalled Z80 lets time pass without executing anything.
    const z = Z80.create({ program: PROGRAM, rom: ROM });
    z.run(5000);
    const pc = z.cpu.regs.pc;
    const t = z.tstates();
    const logged = z.log.length;
    z.stall(FRAME);
    assert.deepStrictEqual([z.cpu.regs.pc, z.tstates(), z.log.length], [pc, t + FRAME, logged]);
  }
  console.log('nhl92 sound chain: one Z80 RAM for both CPUs, program copied byte for byte, Z80 stopped while the 68k holds the bus OK');

  // --- The 68k side is still step 6's -------------------------------------------------------
  {
    const plan = C.songPlan(4, 600);
    const chain = C.runPlan(plan, { rom: ROM });
    const title = 'song 4 · 600 vblanks';
    assert.strictEqual(Run.logText(C.stepSixRun(plan, chain), title), Run.logText(Run.runSong(ROM, 4, 600), title));
    const sfx = C.sfxPlan(13, 600);
    const chain2 = C.runPlan(sfx, { rom: ROM });
    assert.strictEqual(Run.logText(C.stepSixRun(sfx, chain2), 'x'), Run.logText(Run.runSfx(ROM, 13, 600), 'x'));
  }
  for (const group of ['songs', 'sfx']) {
    MANIFEST[group].forEach((e) => {
      const pin = STEP6[group].find((p) => p.id === e.id);
      assert.ok(e.m68kMatchesStep6 && pin.frames === e.frames - (group === 'songs' ? 1 : 2), group + ' ' + e.id + ': rendered from step 6\'s pinned 68k run');
    });
  }
  console.log('nhl92 sound chain: connected 68k output matches the standalone step-6 driver OK');

  // --- Renders: pinned hashes, determinism, buffer oracle, DAC, PSG -------------------------
  const items = R.renders(SRC);
  const pick = (kind, id) => items.find((i) => i.kind === kind && i.id === id);
  const pinOf = (item) => MANIFEST[item.kind === 'mix' ? 'mixes' : item.kind === 'song' ? 'songs' : 'sfx'].find((e) => e.id === item.id);
  const subset = [pick('sfx', 0), pick('sfx', 13), pick('sfx', 15), pick('sfx', 24), pick('mix', 0), pick('mix', 1)];
  const done = {};
  for (const item of subset) {
    const r = await R.render(item, SRC);
    const pin = pinOf(item);
    assert.strictEqual(r.logSha256, pin.log, item.file + ': YM log hash');
    assert.strictEqual(r.wavSha256, pin.wav, item.file + ': WAV hash');
    if (r.m68kSha256) assert.strictEqual(r.m68kSha256, STEP6.sfx.find((p) => p.id === item.id).sha256, item.file + ': 68k log hash (step 6 pin)');
    assert.strictEqual(r.pcm.length / 2, C.sampleAt(item.plan.frames * FRAME), item.file + ': 53,267 Hz for every frame');
    const back = wav.decode16(r.wav);
    assert.deepStrictEqual([back.sampleRate, back.channels, back.samples.length], [C.SAMPLE_RATE, 2, r.pcm.length]);
    assert.deepStrictEqual([r.chain.psgWrites, r.chain.psgPeak], [0, 0], item.file + ': PSG never written and silent');
    const frames = framesOf(r.chain);
    checkBuffers(item.file, r.chain, frames);
    checkDac(item.file, r.chain);
    checkCalls(item.file, r.chain);
    checkHandshake(item.file, r.chain);
    done[item.file] = { r, frames };
  }
  {
    const again = await R.render(pick('sfx', 24), SRC);
    const first = done[pick('sfx', 24).file].r;
    assert.ok(Buffer.from(again.wav).equals(Buffer.from(first.wav)) && again.log === first.log, 'two runs, identical bytes');
  }
  console.log('nhl92 sound chain: ' + subset.length + ' renders match pinned WAV/log hashes, byte-identical across runs, PSG silent OK');

  {
    // Retail findings the renders show. Siren straight after boot never loads a patch
    // (step 6: instrument 0 == the cleared $41), so channels 0/1 keep the reset YM2612
    // state and it is near silent; on top of a song it loads both patches.
    const alone = done[pick('sfx', 0).file];
    assert.ok(!alone.r.chain.z.ym.some((w) => w.reg >= 0x30 && w.reg < 0xa0), 'siren after boot: no patch writes');
    const mix = done[pick('mix', 1).file];
    const sirenFrame = 1 + 180;
    const loads = (reg) => mix.frames[sirenFrame].filter((w) => w.part === 0 && w.reg === reg).length;
    assert.deepStrictEqual([loads(0x30), loads(0x31)], [1, 1], 'siren over SngPO loads patches on YM ch1 and ch2');
    // SFX take driver channels from the song and hand them back: the slot commands the Z80
    // gets differ from a song-only run on one contiguous span of vblanks per SFX.
    const slotCmds = (chain, slot) => chain.records.slice(1).map((e) => JSON.stringify(expectedSlot(SLOT_CHANNELS[slot], e.handoff.slice(slot * 8, slot * 8 + 8))));
    const span = (mix, solo, slot) => {
      const a = slotCmds(mix, slot);
      const b = slotCmds(solo, slot);
      const vbs = a.map((x, vb) => (x !== b[vb] ? vb : -1)).filter((vb) => vb >= 0);
      assert.strictEqual(vbs.length, vbs[vbs.length - 1] - vbs[0] + 1, 'one contiguous takeover on slot ' + slot);
      return [vbs[0], vbs[vbs.length - 1]];
    };
    const m0 = done[pick('mix', 0).file];
    const solo0 = C.runPlan(C.songPlan(0, 900), { rom: ROM });
    // SngEOP: whistle (driver ch4 = YM ch5) vb 120-136; foghorn (ch0/ch1 = YM ch1/ch2) from vb 360.
    assert.deepStrictEqual(span(m0.r.chain, solo0, 4), [120, 136]);
    assert.deepStrictEqual(span(m0.r.chain, solo0, 0), [360, 451]);
    assert.deepStrictEqual(span(m0.r.chain, solo0, 1), [360, 453]);
    // Retail never restores the song's patch: .effect_stop only clears key-on, and a music
    // channel loads a patch only at its own $80 command. After the whistle, SngEOP's
    // ch4 notes (vb 196 on) play on the whistle's patch $0465 until vb 359 at least.
    const ch5Patch = (ws) => ws.some((w) => w.part === 1 && w.reg >= 0x30 && w.reg < 0xa0 && (w.reg & 3) === 1);
    assert.ok(ch5Patch(m0.frames[1 + 120]), 'whistle loads its patch on YM ch5');
    assert.ok(m0.frames.slice(1 + 121, 1 + 360).every((ws) => !ch5Patch(ws)), 'no YM ch5 patch reload after the whistle');
    assert.ok(m0.frames.slice(1 + 196, 1 + 360).some((ws) => ws.some((w) => w.reg === 0x28 && w.value === 0xf5)), 'SngEOP keys YM ch5 on again');
    const m1 = done[pick('mix', 1).file];
    const solo4 = C.runPlan(C.songPlan(4, 900), { rom: ROM });
    assert.deepStrictEqual([span(m1.r.chain, solo4, 0), span(m1.r.chain, solo4, 1)], [[180, 542], [180, 544]], 'siren over SngPO');
  }
  {
    // DAC SFX on top of a song, registers only.
    const m = R.MIXES[2];
    const { chain, frames } = runFrames(C.mixPlan(m.song, m.vblanks, m.sfx));
    checkBuffers('mix 2', chain, frames);
    const reqs = checkDac('mix 2', chain);
    assert.deepStrictEqual(reqs.filter((q) => q.bytes).map((q) => [q.frame, q.start]), [[61, 0x11c3f], [241, 0x16e05], [481, 0x14887]]);
    checkCalls('mix 2', chain);
    assert.strictEqual(chain.psgWrites, 0);
  }
  console.log('nhl92 sound chain: every YM write matches its vblank buffer; DAC SFX play their ROM bytes to the terminator; SFX take channels and hand them back OK');

  // --- SngTitle -> SngTitle reprise ------------------------------------------------------
  {
    const title = runFrames(C.songPlan(1, 8470));
    const reprise = runFrames(C.songPlan(2, 20));
    checkBuffers('SngTitle', title.chain, title.frames);
    checkHandshake('SngTitle', title.chain);
    assert.strictEqual(title.chain.psgWrites, 0);
    const keys = (ws) => ws.filter((w) => w.reg === 0x28).map(fmt);
    const vb = (n) => title.frames[1 + n];
    // vb 8449: channels 1-5 fall through into the reprise's first notes (FM 1,2,4,5,6),
    // the same key writes as the reprise's own first notes without channel 0.
    const reprise1 = keys(reprise.frames[2]).filter((k) => k !== '0:$28=$0' && k !== '0:$28=$F0');
    assert.deepStrictEqual(keys(vb(8449)), reprise1);
    assert.deepStrictEqual(keys(vb(8449)), ['0:$28=$1', '0:$28=$2', '0:$28=$F2', '0:$28=$4', '0:$28=$5', '0:$28=$F5', '0:$28=$6', '0:$28=$F6']);
    // vb 8450: p_initune(2) pauses everything (all six keyed off, the empty DAC sample) ...
    assert.deepStrictEqual(vb(8450).map(fmt), ['0:$28=$0', '0:$28=$1', '0:$28=$2', '0:$28=$4', '0:$28=$5', '0:$28=$6', '0:$2B=$80', '0:$2B=$0']);
    // ... and from there the YM sees exactly a fresh song 2. Within each frame the writes
    // sit at one fixed offset from the fresh run's; the offset is -59 or +208 T-states
    // (267 apart: which pass of the Z80's wait loop first sees the update flag).
    const offsets = new Set();
    for (let k = 0; k < 20; k++) {
      const a = title.frames[1 + 8450 + k];
      const b = reprise.frames[1 + k];
      assert.deepStrictEqual(a.map(fmt), b.map(fmt), 'reprise vb ' + k);
      const d = new Set(a.map((w, i) => (w.t - (1 + 8450 + k) * FRAME) - (b[i].t - (1 + k) * FRAME)));
      assert.strictEqual(d.size, 1, 'reprise vb ' + k + ': one offset for the whole frame');
      offsets.add([...d][0]);
    }
    assert.deepStrictEqual([...offsets].sort((x, y) => x - y), [-59, 208]);
  }
  console.log('nhl92 sound chain: SngTitle falls through for vblank 8,449, then restarts as the reprise at 8,450 OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
