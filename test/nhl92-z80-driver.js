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
