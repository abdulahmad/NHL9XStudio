/**
 * NHL '92 Z80 sound driver run alone on our Z80 core with a logging YM2612 stub.
 * Every expectation below is read off the retail driver bytes
 * (ROM $116A6, $598 bytes = data/fixtures/nhl92-z80-program.bin), never the listing.
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const harness = require('../lib/audio/nhl92-z80-harness');

const PROGRAM = fs.readFileSync(path.join(__dirname, '..', 'data', 'fixtures', 'nhl92-z80-program.bin'));
const FRAME = harness.FRAME_TSTATES;

// $00C5-$00DF: operator register order used by the patch loader, 0-terminated.
const PATCH_REGS = [
  0x30, 0x38, 0x34, 0x3c, 0x40, 0x48, 0x44, 0x4c, 0x50, 0x58, 0x54, 0x5c, 0x60,
  0x68, 0x64, 0x6c, 0x70, 0x78, 0x74, 0x7c, 0x80, 0x88, 0x84, 0x8c, 0xb0, 0xb4
];
const SLOT_CHANNELS = [0, 1, 2, 4, 5, 6];
const SLOT_BASE = 0x273;

const hex = (n) => '$' + n.toString(16).toUpperCase();
const fmt = (w) => w.part + ':' + hex(w.reg) + '=' + hex(w.value);
const regLog = (z) => z.ym.map(fmt);

function machine(rom) {
  return harness.create({ program: PROGRAM, rom });
}

function booted(rom) {
  const z = machine(rom);
  z.run(FRAME * 2);
  z.clearLogs();
  return z;
}

// --- Retail program and loader -------------------------------------------------

assert.strictEqual(PROGRAM.length, 0x598);
assert.strictEqual(
  crypto.createHash('sha1').update(PROGRAM).digest('hex'),
  '781163eeb04608ffc2cfd44213275f4cdebb3d4b',
  'Z80 program must be the retail bytes'
);
assert.deepStrictEqual(Array.from(PROGRAM.subarray(0xc5, 0xe0)), PATCH_REGS.concat([0]));
{
  // Sound_LoadZ80Program: dbf with d0=$597 entered at the dbf copies $597 bytes.
  const z = machine();
  assert.strictEqual(z.ram[0x596], PROGRAM[0x596]);
  assert.strictEqual(z.ram[0x597], 0, 'last program byte ($0597) is never loaded');
}

// --- Helpers -------------------------------------------------------------------

{
  // $0242: A -> $4000, 3x push/pop hl, C -> $4001.
  const z = machine();
  const t = z.call(0x242, { a: 0xb4, c: 0xc0 });
  assert.deepStrictEqual(regLog(z), ['0:$B4=$C0']);
  const ports = z.log.filter((e) => e.kind === 'ymPort');
  assert.deepStrictEqual(ports.map((e) => [e.port, e.value]), [[0, 0xb4], [1, 0xc0]]);
  assert.strictEqual(ports[1].t - ports[0].t, 80, 'address->data spacing: 13 + 3*(11+10) + 4');
  assert.strictEqual(t, 17 + 13 + 63 + 4 + 13 + 10, 'call + $0242 + ret');
  assert.strictEqual(z.ymReads, 0, 'the driver never polls YM status');
}
{
  // $0250: same on $4002/$4003 (part 2).
  const z = machine();
  z.call(0x250, { a: 0xa4, c: 0x22 });
  assert.deepStrictEqual(regLog(z), ['1:$A4=$22']);
  const ports = z.log.filter((e) => e.kind === 'ymPort');
  assert.deepStrictEqual(ports.map((e) => [e.port, e.value]), [[2, 0xa4], [3, 0x22]]);
  assert.strictEqual(ports[1].t - ports[0].t, 80);
}
for (const value of [0x00, 0x02, 0x05, 0xff]) {
  // $0569: bank comes from its own immediate at $056A (A is ignored): 8 shifts LSB first, then 0.
  const z = machine();
  z.ram[0x56a] = value;
  z.call(0x569, { a: 0x5a });
  const bits = z.log.filter((e) => e.kind === 'bank').map((e) => e.bit);
  const want = [];
  for (let i = 0; i < 8; i++) want.push((value >> i) & 1);
  want.push(0);
  assert.deepStrictEqual(bits, want, 'bank bits for ' + hex(value));
  assert.strictEqual(z.bank, value, 'bank register = $056A immediate (68k window base = value << 15)');
}

console.log('nhl92 z80 driver: loader + helpers OK');

// --- Snapshot / SFX builders (68k-side inputs, sound.asm p_music_vblank_fn) ---------

/** One 8-byte channel slot; omitted fields keep bit 7 set ("no change"). */
function slot(fields) {
  const f = fields || {};
  const s = [0xff, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0xff];
  if (f.patch != null) {
    s[0] = 0x00;
    s[1] = f.patch >> 8;
    s[2] = f.patch & 0xff;
  }
  if (f.key != null) s[3] = f.key;
  if (f.freq) {
    s[4] = 0x00;
    s[5] = f.freq[0];
    s[6] = f.freq[1];
  }
  if (f.tl != null) s[7] = f.tl;
  return s;
}

function channels(slots) {
  const out = [];
  for (let i = 0; i < 6; i++) out.push(...slot(slots && slots[i]));
  return out;
}

/** sfx bytes in 68k order ($FFE6..$FFEB -> $BF,$BE,$C0,$C1,$C2,$C3). */
function sfx(addr, rate, bank, priority) {
  return [addr >> 8, addr & 0xff, 0x00, rate, bank, priority];
}

function frame(z, input) {
  if (input) z.vblank(input);
  z.run(FRAME);
}

const IDLE = { flag: 1, channels: channels(), pending: 0 };
const dacWrites = (z) => z.ym.filter((w) => w.part === 0 && w.reg === 0x2a);
const spacings = (ws) => ws.slice(1).map((w, i) => w.t - ws[i].t);

// --- DAC / PSG paths -------------------------------------------------------------

{
  // Static: no $7Fxx operand (PSG/VDP) and no reference to the iy DAC writer at $025E
  // anywhere in the code ranges ($0000-$00C4, $00E0-$0272, $0569-$0596).
  const code = [];
  for (const [a, b] of [[0x000, 0x0c5], [0x0e0, 0x273], [0x569, 0x597]]) {
    for (let i = a; i < b; i++) code.push(i);
  }
  assert.deepStrictEqual(code.filter((i) => PROGRAM[i] === 0x7f), [], 'no PSG/VDP address in driver code');
  assert.deepStrictEqual(
    code.filter((i) => PROGRAM[i] === 0x5e && PROGRAM[i + 1] === 0x02), [],
    '$025E (iy-indexed DAC writer) is unreachable'
  );
}

const SAMPLE_ROM = (() => {
  const rom = new Uint8Array(0x40000);
  rom.set([0x80, 0x90, 0x70, 0x60, 0x50, 0x00, 0x00], 0x12345);
  rom.set([0x81, 0x82, 0x00, 0x01], 0x14000);
  rom[0x17ffe] = 0x11;
  rom[0x17fff] = 0x22;
  rom.set([0x33, 0x00, 0x00], 0x18000);
  return rom;
})();

{
  // Boot leaves the DAC idle ($02A4 = $FF): no DAC traffic, no PSG, nothing outside RAM/YM.
  const z = booted(SAMPLE_ROM);
  assert.strictEqual(z.ram[0x2a4], 0xff);
  for (let i = 0; i < 3; i++) frame(z, IDLE);
  assert.deepStrictEqual(regLog(z), []);
  assert.strictEqual(z.bankReads.length, 0);
}
{
  // Trigger: first byte is read from (BF:BE)+1 in bank C2; DAC enabled, bytes streamed
  // to $2A until a 0 byte; next byte != 1 ends it: DAC off, $02A4 = $FF, $C4 = $FF.
  const z = booted(SAMPLE_ROM);
  frame(z, { flag: 1, channels: channels(), pending: 1, sfx: sfx(0xa344, 0x10, 0x02, 0x05) });
  assert.deepStrictEqual(regLog(z), [
    '0:$2B=$80', '0:$2A=$80', '0:$2A=$90', '0:$2A=$70', '0:$2A=$60', '0:$2A=$50', '0:$2B=$0'
  ]);
  assert.strictEqual(z.bankReads[0].addr68k, 0x12345);
  assert.deepStrictEqual(spacings(dacWrites(z)), [433, 433, 433, 433], 'period 161 + 17*rate');
  assert.strictEqual(z.ram[0x2a4], 0xff);
  assert.strictEqual(z.ram[0xc4], 0xff);
  assert.strictEqual(z.ram[0xc0], 0xff);
  assert.strictEqual(z.log.filter((e) => e.kind === 'psg' || e.kind === 'vdp').length, 0);
}
for (const rate of [0x01, 0x19, 0x40, 0x00]) {
  // Rate byte becomes the djnz count at $007A; 0 means 256 passes.
  const z = booted(SAMPLE_ROM);
  frame(z, { flag: 1, channels: channels(), pending: 1, sfx: sfx(0xa344, rate, 0x02, 0x05) });
  const n = rate || 256;
  for (const d of spacings(dacWrites(z))) assert.strictEqual(d, 161 + 17 * n, 'rate ' + hex(rate));
  assert.strictEqual(z.ram[0x7a], rate);
}
{
  // Crossing $FFFF: bank+1 via $056A, HL=$8000, and the byte at $FFFF is skipped.
  const z = booted(SAMPLE_ROM);
  frame(z, { flag: 1, channels: channels(), pending: 1, sfx: sfx(0xfffd, 0x40, 0x02, 0x05) });
  assert.deepStrictEqual(regLog(z), ['0:$2B=$80', '0:$2A=$11', '0:$2A=$33', '0:$2B=$0']);
  assert.deepStrictEqual(spacings(dacWrites(z)), [161 + 17 * 0x40 + 262]);
  assert.strictEqual(z.bank, 3);
  assert.strictEqual(z.ram[0x56a], 3);
}
{
  // 0 then 1 loops: back to $009B (DAC on again, bank reloaded from $00A8, same start).
  const z = booted(SAMPLE_ROM);
  frame(z, { flag: 1, channels: channels(), pending: 1, sfx: sfx(0xbfff, 0x08, 0x02, 0x05) });
  const log = regLog(z);
  const loop = ['0:$2B=$80', '0:$2A=$81', '0:$2A=$82'];
  assert.deepStrictEqual(log.slice(0, 9), loop.concat(loop, loop));
  assert.strictEqual(z.ram[0x2a4], 0x01, 'still playing');
  assert.ok(!log.includes('0:$2B=$0'), 'looping sample never disables the DAC');
}
{
  // Music updates still run while the DAC plays: key-on lands between samples.
  const z = booted(SAMPLE_ROM);
  frame(z, { flag: 1, channels: channels(), pending: 1, sfx: sfx(0xbfff, 0x40, 0x02, 0x05) });
  z.clearLogs();
  frame(z, { flag: 0, channels: channels([{ key: 0x01 }]), pending: 0 });
  const log = regLog(z);
  const k = log.indexOf('0:$28=$0');
  assert.ok(k > 0 && log[k + 1] === '0:$28=$F0', 'key-on processed during playback');
  assert.ok(log.slice(k + 2).includes('0:$2A=$81'), 'DAC continues after the update');
}

console.log('nhl92 z80 driver: DAC used for SFX, PSG never written OK');

// --- Snapshot decode -------------------------------------------------------------

/**
 * Per slot ($0155), in this order: +0 bit7 clear -> 26-byte patch from Z80 address
 * (+1:+2) in $00C5 register order; +3 bit7 clear -> $28=c, then $28=c+$F0 if bit0;
 * +4 bit7 clear -> $A4+ch=(+5), $A0+ch=(+6); +7 bit7 clear -> $4C+ch=(+7).
 * Channels 4-6 use part 2 with ch=c&3, but $28 always goes through part 1.
 */
function expectedSlot(c, s, mem) {
  const part = c >> 2;
  const ch = c & 3;
  const out = [];
  const w = (p, reg, value) => out.push(fmt({ part: p, reg, value }));
  if (!(s[0] & 0x80)) {
    const at = (s[1] << 8) | s[2];
    PATCH_REGS.forEach((reg, j) => w(part, reg + ch, mem[at + j]));
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

function expectedFrame(buf, mem) {
  const out = [];
  SLOT_CHANNELS.forEach((c, i) => out.push(...expectedSlot(c, buf.slice(i * 8, i * 8 + 8), mem)));
  return out;
}

const PATCHES = [];
for (let at = 0x2a5; at + 0x20 <= 0x569; at += 0x20) PATCHES.push(at);
assert.strictEqual(PATCHES.length, 22);

{
  // All six slots, every field, different retail patches.
  const z = booted();
  const buf = channels(SLOT_CHANNELS.map((c, i) => ({
    patch: PATCHES[i * 3],
    key: 0x01,
    freq: [0x22 + i, 0x69 + i],
    tl: 0x10 + i
  })));
  frame(z, { flag: 0, channels: buf, pending: 0 });
  assert.deepStrictEqual(regLog(z), expectedFrame(buf, PROGRAM));
  assert.strictEqual(z.ym.length, 6 * (26 + 2 + 2 + 1));
  for (let i = 0; i < 6; i++) {
    const s = Array.from(z.ram.subarray(SLOT_BASE + i * 8, SLOT_BASE + i * 8 + 8));
    assert.deepStrictEqual([s[0], s[3], s[4], s[7]], [0xff, 0xff, 0xff, 0xff], 'flags consumed');
    assert.deepStrictEqual([s[1], s[2], s[5], s[6]], [buf[i * 8 + 1], buf[i * 8 + 2], buf[i * 8 + 5], buf[i * 8 + 6]]);
  }
  frame(z, IDLE);
  assert.strictEqual(z.ym.length, 6 * 31, 'nothing re-sent without a new update');
}
for (const c of [0, 6]) {
  // Every retail patch through a part-1 and a part-2 channel.
  for (const at of PATCHES) {
    const z = booted();
    const slots = [];
    slots[SLOT_CHANNELS.indexOf(c)] = { patch: at };
    const buf = channels(slots);
    frame(z, { flag: 0, channels: buf, pending: 0 });
    assert.deepStrictEqual(regLog(z), expectedFrame(buf, PROGRAM), 'patch ' + hex(at) + ' ch ' + c);
  }
}
for (const [field, value] of [['key', 0x00], ['key', 0x7e], ['key', 0x7f], ['key', 0x80], ['tl', 0x7f], ['tl', 0x80]]) {
  // Only bit 7 gates a field; key bit 0 picks off-only vs off+on.
  const z = booted();
  const buf = channels([{}, {}, {}, {}, { [field]: value }]);
  frame(z, { flag: 0, channels: buf, pending: 0 });
  assert.deepStrictEqual(regLog(z), expectedFrame(buf, PROGRAM), field + '=' + hex(value));
}
{
  // Within a slot the key write precedes the frequency write (retail order).
  const z = booted();
  frame(z, { flag: 0, channels: channels([{ key: 0x01, freq: [0x1a, 0x8c] }]), pending: 0 });
  assert.deepStrictEqual(regLog(z), ['0:$28=$0', '0:$28=$F0', '0:$A4=$1A', '0:$A0=$8C']);
}
{
  // The patch pointer is any Z80 address: the loader reads Z80 RAM, not the 68k.
  const z = booted();
  for (let j = 0; j < 26; j++) z.busWrite(0x1000 + j, 0x40 + j);
  const buf = channels([{}, {}, {}, { patch: 0x1000 }]);
  frame(z, { flag: 0, channels: buf, pending: 0 });
  assert.deepStrictEqual(regLog(z), PATCH_REGS.map((reg, j) => fmt({ part: 1, reg, value: 0x40 + j })));
}

console.log('nhl92 z80 driver: snapshot decode OK');

// --- Main loop, update flag, SFX params ------------------------------------------

{
  // Reset: jp $0038 -> di; ld sp,$1FFF; im 0. Interrupts stay disabled (vblank INT ignored).
  const z = machine();
  z.runUntilPc(0x38, 100);
  z.runUntilPc(0x3e, 100);
  assert.strictEqual(z.cpu.regs.sp, 0x1fff);
  assert.ok(!z.cpu.ctl.iff1, 'DI at boot, never re-enabled');
  // First pass sees the retail $02A3 = 0, runs an update over the shipped slots
  // (all flags set), writes nothing and leaves $02A3 = 1.
  z.run(FRAME * 2);
  assert.deepStrictEqual(z.log, []);
  assert.deepStrictEqual([z.ram[0x2a3], z.ram[0x2a4], z.ram[0xc0], z.ram[0xc4]], [1, 0xff, 0xff, 0xff]);
  assert.ok(!z.cpu.ctl.iff1);
}
{
  // Idle pass $003E->$003E: 80 + 17*n T-states, n = djnz count at $007A (retail $19).
  const z = booted();
  const a = z.runUntilPc(0x3e);
  const b = z.runUntilPc(0x3e);
  assert.strictEqual(b - a, 80 + 17 * 0x19);
}
{
  // $02A3 == 1 means "no update"; any other value runs one update and is set back to 1.
  const z = booted();
  const buf = channels([{ key: 0x01 }]);
  for (let i = 0; i < 48; i++) z.busWrite(SLOT_BASE + i, buf[i]);
  z.busWrite(0x2a3, 1);
  z.run(FRAME);
  assert.deepStrictEqual(regLog(z), []);
  for (const flag of [0x00, 0x02, 0x80, 0xff]) {
    z.clearLogs();
    for (let i = 0; i < 48; i++) z.busWrite(SLOT_BASE + i, buf[i]);
    z.busWrite(0x2a3, flag);
    z.run(FRAME);
    assert.deepStrictEqual(regLog(z), ['0:$28=$0', '0:$28=$F0'], 'flag ' + hex(flag));
    assert.strictEqual(z.ram[0x2a3], 1);
  }
}
{
  // vblank with the 68k flag at 1 and nothing pending: buffer not copied, flag stays 1.
  const z = booted();
  const before = Array.from(z.ram.subarray(SLOT_BASE, SLOT_BASE + 48));
  frame(z, { flag: 1, channels: channels([{ key: 1 }]), pending: 0 });
  assert.deepStrictEqual(Array.from(z.ram.subarray(SLOT_BASE, SLOT_BASE + 48)), before);
  assert.deepStrictEqual(regLog(z), []);
  // Pending SFX: $FFE6..$FFEB land at $BF,$BE,$C0,$C1,$C2,$C3 and the flag byte becomes 0.
  z.vblank({ flag: 1, channels: channels(), pending: 1, sfx: [0x11, 0x22, 0x33, 0x44, 0x55, 0x66] });
  assert.deepStrictEqual(Array.from(z.ram.subarray(0xbe, 0xc4)), [0x22, 0x11, 0x33, 0x44, 0x55, 0x66]);
  assert.strictEqual(z.ram[0x2a3], 0);
  assert.deepStrictEqual(Array.from(z.ram.subarray(SLOT_BASE, SLOT_BASE + 48)), before, 'still not copied');
}
{
  // SFX params are only read inside an update: $C0 = 0 alone does nothing.
  const z = booted(SAMPLE_ROM);
  z.busWrite(0xc0, 0x00);
  z.run(FRAME);
  assert.deepStrictEqual(regLog(z), []);
  assert.strictEqual(z.ram[0xc0], 0x00);
  // $C0 != 0 in an update: ignored and left as-is.
  z.vblank({ flag: 0, channels: channels(), pending: 0 });
  z.busWrite(0xc0, 0x07);
  z.run(FRAME);
  assert.deepStrictEqual(regLog(z), []);
  assert.strictEqual(z.ram[0xc0], 0x07);
}
{
  // Accept: $C4 <- $C3, $02A4 <- 0, $C0 <- $FF, and the self-modified immediates
  // $00A8 <- $C2 (bank), $00B2 <- $BE, $00B0 <- $BF (HL), $007A <- $C1 (rate).
  // The DAC start follows the six music slots of the same update.
  const z = booted(SAMPLE_ROM);
  frame(z, { flag: 0, channels: channels([{ key: 1 }]), pending: 1, sfx: sfx(0xbfff, 0x30, 0x02, 0x05) });
  assert.deepStrictEqual(
    [z.ram[0xc4], z.ram[0xc0], z.ram[0xa8], z.ram[0xb2], z.ram[0xb0], z.ram[0x7a]],
    [0x05, 0xff, 0x02, 0xff, 0xbf, 0x30]
  );
  assert.deepStrictEqual(regLog(z).slice(0, 4), ['0:$28=$0', '0:$28=$F0', '0:$2B=$80', '0:$2A=$81']);

  // Lower priority (higher number) while playing: rejected, $C0 <- $FF, nothing else changes.
  z.clearLogs();
  frame(z, { flag: 1, channels: channels(), pending: 1, sfx: sfx(0xa344, 0x10, 0x07, 0x06) });
  assert.deepStrictEqual(
    [z.ram[0xc4], z.ram[0xc0], z.ram[0xa8], z.ram[0xb2], z.ram[0xb0], z.ram[0x7a]],
    [0x05, 0xff, 0x02, 0xff, 0xbf, 0x30]
  );
  assert.ok(!regLog(z).includes('0:$2A=$80'), 'old sample keeps playing');

}
for (const pri of [0x05, 0x03]) {
  // Equal or higher priority (lower number) interrupts the playing loop; once the
  // one-shot ends, $C4 is released to $FF.
  const z = booted(SAMPLE_ROM);
  frame(z, { flag: 1, channels: channels(), pending: 1, sfx: sfx(0xbfff, 0x30, 0x02, 0x05) });
  z.clearLogs();
  z.vblank({ flag: 1, channels: channels(), pending: 1, sfx: sfx(0xa344, 0x10, 0x02, pri) });
  z.runUntilPc(0x12e);
  assert.strictEqual(z.ram[0xc4], pri, 'priority ' + pri + ' accepted');
  z.run(FRAME);
  const log = regLog(z);
  assert.deepStrictEqual(log.slice(log.indexOf('0:$2A=$80') - 1), [
    '0:$2B=$80', '0:$2A=$80', '0:$2A=$90', '0:$2A=$70', '0:$2A=$60', '0:$2A=$50', '0:$2B=$0'
  ]);
  assert.strictEqual(z.ram[0xc4], 0xff);
}
{
  // The rate immediate at $007A persists after the SFX: the idle loop runs at the new speed.
  const z = booted(SAMPLE_ROM);
  frame(z, { flag: 1, channels: channels(), pending: 1, sfx: sfx(0xa344, 0x40, 0x02, 0x05) });
  assert.strictEqual(z.ram[0x2a4], 0xff);
  const a = z.runUntilPc(0x3e);
  const b = z.runUntilPc(0x3e);
  assert.strictEqual(b - a, 80 + 17 * 0x40);
}

console.log('nhl92 z80 driver: main loop, update flag, SFX params OK');

// --- Golden: recorded snapshots in -> retail YM register log out -------------------

const golden = require('../lib/audio/nhl92-z80-golden');
{
  const vgm = new Uint8Array(0x40 + 32);
  const dv = new DataView(vgm.buffer);
  dv.setUint32(0, 0x206d6756, true);
  dv.setUint32(8, 0x150, true);
  dv.setUint32(0x34, 0x0c, true);
  vgm.set([
    0x67, 0x66, 0x00, 0x02, 0x00, 0x00, 0x00, 0x7f, 0x81,
    0x52, 0x28, 0xf0, 0x62, 0x53, 0xa4, 0x22, 0x50, 0x9f,
    0xe0, 0x01, 0x00, 0x00, 0x00, 0x83, 0x61, 0x10, 0x00, 0x66
  ], 0x40);
  const got = golden.ymLogFromVgm(vgm);
  assert.deepStrictEqual(got.ym.map((w) => [w.sample, w.part, w.reg, w.value]), [
    [0, 0, 0x28, 0xf0], [735, 1, 0xa4, 0x22], [735, 0, 0x2a, 0x81]
  ]);
  assert.deepStrictEqual(got.psg, [{ sample: 735, value: 0x9f }]);
  assert.deepStrictEqual(golden.compare([[0, 1, 2]], [[0, 1, 2]]), { ok: true, count: 1 });
  assert.strictEqual(golden.compare([[0, 1, 2]], [[0, 1, 3]]).index, 0);
  assert.strictEqual(golden.compare([[0, 1, 2]], [[0, 1, 2], [0, 1, 2]]).index, 1);

  // Replay plumbing only (synthetic inputs, not a retail comparison).
  const toHex = (a) => Buffer.from(a).toString('hex');
  const out = golden.replay({
    frames: [
      { flag: 1, channels: toHex(channels()), pending: 0 },
      { flag: 0, channels: toHex(channels([{}, {}, {}, {}, { key: 0x01 }])), pending: 0 }
    ]
  }, { program: PROGRAM });
  assert.deepStrictEqual(out.ym, [[0, 0x28, 0x05], [0, 0x28, 0xf5]]);
  assert.deepStrictEqual(out.frameStarts, [0, 0]);
  assert.deepStrictEqual(out.other, []);
}
{
  const dir = path.join(__dirname, '..', 'data', 'captures', 'nhl92');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  const romPath = path.join(__dirname, '..', 'roms', 'nhl92.bin');
  if (!files.length) {
    console.log('nhl92 z80 driver: SKIP golden replay — no retail captures in data/captures/nhl92 (step 1)');
  }
  for (const file of files) {
    const capture = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const rom = fs.existsSync(romPath) ? fs.readFileSync(romPath) : null;
    const usesDac = capture.frames.some((f) => f.pending);
    if (usesDac && !rom) {
      console.log('nhl92 z80 driver: SKIP golden ' + file + ' — SFX samples need roms/nhl92.bin');
      continue;
    }
    const expected = capture.vgm
      ? golden.ymLogFromVgm(fs.readFileSync(path.join(dir, capture.vgm))).ym.map((w) => [w.part, w.reg, w.value])
      : capture.ym;
    const out = golden.replay(capture, { program: PROGRAM, rom });
    const result = golden.compare(out.ym, expected);
    assert.ok(result.ok, 'golden ' + file + ': ' + JSON.stringify(result));
    assert.deepStrictEqual(out.other, [], 'golden ' + file + ': only YM/bank traffic');
    console.log('nhl92 z80 driver: golden ' + file + ' matches ' + result.count + ' retail YM writes');
  }
}

// Long playback: the T-state clock must not wrap. tstates() was `edges >> 1`, which goes negative once the edge count
// passes 2^31 (~17,975 frames, ~5 min: NHL 92 SngTitle pass 3 at 0:17.5). The chain then asked run() for ~2^31 T-states
// and the Z80 never got back in step with the frames, so the music froze on one note. Fast-forward with stall().
{
  const FRAME_T = 59736;
  const z = harness.create({ program: PROGRAM });
  z.reset();
  z.run(FRAME_T);
  z.stall(18100 * FRAME_T - z.tstates()); // past frame 17975, without emulating five minutes
  for (let f = 18100; f < 18110; f++) {
    const before = z.tstates();
    assert.ok(before >= f * FRAME_T, 'tstates stays positive and monotonic past 2^31 edges: ' + before);
    z.run((f + 1) * FRAME_T - before);
    const after = z.tstates();
    assert.ok(after >= (f + 1) * FRAME_T && after - (f + 1) * FRAME_T < 64, 'frame ' + f + ' ran one frame: ' + (after - before));
  }
  console.log('nhl92 z80 driver: T-state clock keeps counting past 2^31 edges (frame 18100+)');
}
