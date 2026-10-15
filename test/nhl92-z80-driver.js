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
