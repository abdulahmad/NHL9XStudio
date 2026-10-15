/**
 * Fast checks for lib/audio/m68k-cpu.js that run in `node test.js` without the
 * SingleStepTests download (full validation: node test/m68k-singlestep.js).
 * Machine code below is hand-encoded; expected values are worked out by hand
 * from the 68000 Programmer's Reference Manual.
 */
const assert = require('assert');
const m68k = require('../lib/audio/m68k-cpu');
const driverOps = require('./m68k-driver-ops');

function machine(words, at) {
  const mem = new Uint8Array(0x10000);
  const origin = at == null ? 0x1000 : at;
  words.forEach((w, i) => { mem[origin + i * 2] = w >> 8; mem[origin + i * 2 + 1] = w & 0xff; });
  const bus = {
    read8: (a) => mem[a & 0xffff],
    read16: (a) => (mem[a & 0xffff] << 8) | mem[(a + 1) & 0xffff],
    write8: (a, v) => { mem[a & 0xffff] = v; },
    write16: (a, v) => { mem[a & 0xffff] = v >> 8; mem[(a + 1) & 0xffff] = v & 0xff; }
  };
  const cpu = m68k.create(bus);
  cpu.load({ d: [0, 0, 0, 0, 0, 0, 0, 0], a: [0, 0, 0, 0, 0, 0, 0], usp: 0, ssp: 0x8000, sr: 0x2700, pc: origin });
  return { cpu, mem, bus };
}
const run = (m, n) => { for (let i = 0; i < n; i++) m.cpu.step(); };
const long = (mem, a) => ((mem[a] << 24) | (mem[a + 1] << 16) | (mem[a + 2] << 8) | mem[a + 3]) >>> 0;
const word = (mem, a) => (mem[a] << 8) | mem[a + 1];

{
  // moveq #5,d0 ; moveq #-1,d1 ; add.w d0,d1 -> d1 = $FFFF0004, X and C set (carry out of bit 15)
  const m = machine([0x7005, 0x72ff, 0xd240]);
  run(m, 3);
  assert.strictEqual(m.cpu.D[1], 0xffff0004);
  assert.strictEqual(m.cpu.sr & 0x1f, 0x11);
}
{
  // moveq #3,d2 ; loop: addq.w #1,d3 ; dbf d2,loop  -> body runs 4 times, d2.w ends at $FFFF
  const m = machine([0x7403, 0x5243, 0x51ca, 0xfffc]);
  run(m, 1 + 4 * 2);
  assert.strictEqual(m.cpu.D[3] & 0xffff, 4);
  assert.strictEqual(m.cpu.D[2] & 0xffff, 0xffff);
  assert.strictEqual(m.cpu.pc, 0x1008);
}
{
  // mulu.w d4,d5 with d4 = $1234, d5 = $FFFF5678 -> $1234 * $5678 = $06260060
  const m = machine([0xcac4]);
  m.cpu.D[4] = 0x1234;
  m.cpu.D[5] = 0xffff5678;
  run(m, 1);
  assert.strictEqual(m.cpu.D[5], 0x06260060);
}
{
  // movem.l d0-d7/a0-a6,-(sp) ; moveq #0,d0 ; movem.l (sp)+,d0-d7/a0-a6 restores every register and SP
  const m = machine([0x48e7, 0xfffe, 0x7000, 0x4cdf, 0x7fff]);
  for (let i = 0; i < 8; i++) m.cpu.D[i] = 0x11111111 * (i + 1) >>> 0;
  for (let i = 0; i < 7; i++) m.cpu.A[i] = 0x2000 + i * 0x10;
  run(m, 1);
  assert.strictEqual(m.cpu.A[7], 0x8000 - 15 * 4);
  assert.strictEqual(long(m.mem, m.cpu.A[7]), 0x11111111, 'D0 stored lowest');
  run(m, 2);
  assert.strictEqual(m.cpu.D[0], 0x11111111);
  assert.strictEqual(m.cpu.A[6], 0x2060);
  assert.strictEqual(m.cpu.A[7], 0x8000);
}
{
  // bsr.s +4 ; (skipped) ; target: rts -> back after the bsr; return address pushed
  const m = machine([0x6102, 0x4e71, 0x4e75]);
  run(m, 1);
  assert.strictEqual(m.cpu.pc, 0x1004);
  assert.strictEqual(long(m.mem, 0x7ffc), 0x1002);
  run(m, 1);
  assert.strictEqual(m.cpu.pc, 0x1002);
  assert.strictEqual(m.cpu.A[7], 0x8000);
}
{
  // bset #3,(a0) ; btst #3,(a0) ; bclr #3,(a0) on a byte: Z reflects the bit before each change
  const m = machine([0x08d0, 0x0003, 0x0810, 0x0003, 0x0890, 0x0003]);
  m.cpu.A[0] = 0x3000;
  run(m, 1);
  assert.strictEqual(m.mem[0x3000], 0x08);
  assert.ok(m.cpu.sr & 0x04, 'bit was clear');
  run(m, 2);
  assert.strictEqual(m.mem[0x3000], 0x00);
  assert.ok(!(m.cpu.sr & 0x04), 'bit was set');
}
{
  // lsl.l #4,d6 ; st d7 ; sf d7 ; ext.w d0 ; ext.l d0
  const m = machine([0xe98e, 0x50c7, 0x51c7, 0x4880, 0x48c0]);
  m.cpu.D[6] = 0x81234567;
  m.cpu.D[0] = 0x123456f0;
  run(m, 2);
  assert.strictEqual(m.cpu.D[6], 0x12345670);
  assert.strictEqual(m.cpu.sr & 0x1f, 0, 'last bit out is bit 28 of $81234567 (0): C = X = 0, N = Z = 0');
  assert.strictEqual(m.cpu.D[7] & 0xff, 0xff);
  run(m, 1);
  assert.strictEqual(m.cpu.D[7] & 0xff, 0x00);
  run(m, 2);
  assert.strictEqual(m.cpu.D[0], 0xfffffff0);
}
{
  // trap #2: vector 34, stacks SR then the next PC, enters supervisor with T clear
  const m = machine([0x4e42]);
  m.mem.set([0x00, 0x00, 0x40, 0x00], 34 * 4);
  m.cpu.sr = 0x0005;
  m.cpu.usp = 0x6000;
  m.cpu.ssp = 0x8000;
  run(m, 1);
  assert.strictEqual(m.cpu.pc, 0x4000);
  assert.strictEqual(m.cpu.sr, 0x2005);
  assert.strictEqual(m.cpu.ssp, 0x8000 - 6);
  assert.strictEqual(word(m.mem, 0x7ffa), 0x0005);
  assert.strictEqual(long(m.mem, 0x7ffc), 0x1002);
  assert.strictEqual(m.cpu.usp, 0x6000);
}
{
  // move.w (a0),d0 from an odd address: 14-byte group-0 frame (status, address, IR, SR, PC)
  const m = machine([0x3010]);
  m.mem.set([0x00, 0x00, 0x50, 0x00], 3 * 4);
  m.cpu.A[0] = 0x3001;
  run(m, 1);
  const sp = m.cpu.ssp;
  assert.strictEqual(sp, 0x8000 - 14);
  assert.strictEqual(m.cpu.pc, 0x5000);
  assert.strictEqual(word(m.mem, sp), (0x3010 & 0xffe0) | 0x10 | 5, 'read, data, supervisor data FC');
  assert.strictEqual(long(m.mem, sp + 2), 0x3001);
  assert.strictEqual(word(m.mem, sp + 6), 0x3010);
  assert.strictEqual(word(m.mem, sp + 8), 0x2700);
  assert.strictEqual(long(m.mem, sp + 10), 0x1000, 'no extension words consumed: instruction address');
}
console.log('m68k cpu: hand-encoded instruction and exception checks OK');

{
  // The NHL '92 sound code, swept from ROM bytes: every opcode decodes to a known group.
  const ops = driverOps.sweep();
  assert.strictEqual(ops.length, 680);
  assert.ok(ops.every((o) => o.group), 'every sound-code opcode is a 68000 instruction');
  assert.deepStrictEqual(driverOps.groups(), [
    'ADD.b', 'ADD.l', 'ADD.w', 'ADDA.l', 'ADDA.w', 'AND.b', 'AND.w', 'BCLR', 'BSET', 'BSR', 'BTST', 'Bcc',
    'CLR.b', 'CLR.l', 'CLR.w', 'CMP.b', 'CMP.l', 'CMP.w', 'DBcc', 'EXT.l', 'EXT.w', 'JMP', 'LEA', 'LSL.l',
    'LSL.w', 'LSR.b', 'LSR.l', 'LSR.w', 'MOVE.b', 'MOVE.l', 'MOVE.q', 'MOVE.w', 'MOVEA.l', 'MOVEA.w',
    'MOVEM.l', 'MULS', 'MULU', 'OR.b', 'OR.l', 'OR.w', 'RTS', 'SUB.b', 'SUB.w', 'Scc', 'TST.b', 'TST.w'
  ]);
}
console.log('m68k cpu: NHL 92 sound code sweeps to 680 instructions in 46 groups OK');
