/**
 * Fast checks for lib/audio/spc700-cpu.js that run in `node test.js` without the SingleStepTests download
 * (full validation: node test/spc700-singlestep.js). Machine code is hand-encoded; expected values and cycle
 * counts are worked out by hand from the SPC700 instruction set.
 */
const assert = require('assert');
const spc = require('../lib/audio/spc700-cpu');
const driverOps = require('./spc700-driver-ops');

const PSW = { N: 0x80, V: 0x40, P: 0x20, H: 0x08, Z: 0x02, C: 0x01 };

function machine(bytes, at) {
  const mem = new Uint8Array(0x10000);
  const origin = at == null ? 0x200 : at;
  mem.set(bytes, origin);
  const cpu = spc.create({ read: (a) => mem[a], write: (a, v) => { mem[a] = v; } });
  cpu.load({ a: 0, x: 0, y: 0, sp: 0xef, pc: origin, psw: 0 });
  return { cpu, mem };
}
const run = (m, n) => { let c = 0; for (let i = 0; i < n; i++) c += m.cpu.step(); return c; };

{
  // mov a,#$80 ; adc a,#$80 -> $00 with carry out, zero, and signed overflow (-128 + -128)
  const m = machine([0xe8, 0x80, 0x88, 0x80]);
  const cyc = run(m, 2);
  assert.strictEqual(m.cpu.a, 0x00);
  assert.strictEqual(m.cpu.psw, PSW.C | PSW.Z | PSW.V);
  assert.strictEqual(cyc, 4);
}
{
  // setc ; mov a,#$10 ; sbc a,#$01 -> $0F, carry stays set (no borrow), half-carry clear (low nibble borrowed)
  const m = machine([0x80, 0xe8, 0x10, 0xa8, 0x01]);
  run(m, 3);
  assert.strictEqual(m.cpu.a, 0x0f);
  assert.strictEqual(m.cpu.psw, PSW.C);
}
{
  // mov y,#$12 ; mov a,#$34 ; mul ya -> $12 * $34 = $03A8: Y = $03, A = $A8, 9 cycles for the mul
  const m = machine([0x8d, 0x12, 0xe8, 0x34, 0xcf]);
  const cyc = run(m, 3);
  assert.strictEqual(m.cpu.y, 0x03);
  assert.strictEqual(m.cpu.a, 0xa8);
  assert.strictEqual(cyc, 2 + 2 + 9);
}
{
  // ya = 100, x = 7: div ya,x -> a = 14, y = 2 (100 = 14 * 7 + 2), V and H clear, 12 cycles
  const m = machine([0x9e]);
  m.cpu.a = 100; m.cpu.y = 0; m.cpu.x = 7;
  assert.strictEqual(run(m, 1), 12);
  assert.strictEqual(m.cpu.a, 14);
  assert.strictEqual(m.cpu.y, 2);
  assert.strictEqual(m.cpu.psw & (PSW.V | PSW.H), 0);
}
{
  // call !$0210 (8 cycles) pushes the return address $0203 high byte first; ret (5 cycles) pops it
  const m = machine([0x3f, 0x10, 0x02, 0x00]);
  m.mem[0x210] = 0x6f;
  assert.strictEqual(run(m, 1), 8);
  assert.strictEqual(m.cpu.pc, 0x210);
  assert.strictEqual(m.cpu.sp, 0xed);
  assert.strictEqual(m.mem[0x1ef], 0x02);
  assert.strictEqual(m.mem[0x1ee], 0x03);
  assert.strictEqual(run(m, 1), 5);
  assert.strictEqual(m.cpu.pc, 0x203);
  assert.strictEqual(m.cpu.sp, 0xef);
}
{
  // mov x,#1 ; bne +2 taken (2 + 2 cycles extra) ; then bne not taken after mov x,#0 costs only 2
  const m = machine([0xcd, 0x01, 0xd0, 0x02, 0x00, 0x00, 0xcd, 0x00, 0xd0, 0x7f]);
  assert.strictEqual(run(m, 1), 2);
  assert.strictEqual(run(m, 1), 4);
  assert.strictEqual(m.cpu.pc, 0x206);
  run(m, 1);
  assert.strictEqual(run(m, 1), 2);
  assert.strictEqual(m.cpu.pc, 0x20a);
}
{
  // dbnz y,-2 with y = 2: first pass decrements to 1 and branches (6 cycles), second reaches 0 and falls through (4)
  const m = machine([0xfe, 0xfe]);
  m.cpu.y = 2;
  assert.strictEqual(run(m, 1), 6);
  assert.strictEqual(m.cpu.pc, 0x200);
  assert.strictEqual(run(m, 1), 4);
  assert.strictEqual(m.cpu.y, 0);
  assert.strictEqual(m.cpu.pc, 0x202);
}
{
  // setp ; mov a,#$55 ; mov $10,a (direct page is $0100 now) ; clrp ; mov $11,a (direct page $0000)
  const m = machine([0x40, 0xe8, 0x55, 0xc4, 0x10, 0x20, 0xc4, 0x11]);
  run(m, 5);
  assert.strictEqual(m.mem[0x110], 0x55);
  assert.strictEqual(m.mem[0x011], 0x55);
  assert.strictEqual(m.mem[0x010], 0x00);
}
{
  // mov1 c,$0100.3 (address word = $0100 | 3 << 13 = $6100) ; not1 $0100.3 flips the bit back off
  const m = machine([0xaa, 0x00, 0x61, 0xea, 0x00, 0x61]);
  m.mem[0x100] = 0x08;
  run(m, 1);
  assert.strictEqual(m.cpu.psw & PSW.C, PSW.C);
  run(m, 1);
  assert.strictEqual(m.mem[0x100], 0x00);
}
{
  // incw $20 carries into the high byte ; incw $FF wraps inside the direct page ($FF low, $00 high)
  const m = machine([0x3a, 0x20, 0x3a, 0xff]);
  m.mem[0x20] = 0xff; m.mem[0x21] = 0x00; m.mem[0xff] = 0xff; m.mem[0x00] = 0x00;
  run(m, 2);
  assert.strictEqual(m.mem[0x20], 0x00);
  assert.strictEqual(m.mem[0x21], 0x01);
  assert.strictEqual(m.mem[0xff], 0x00);
  assert.strictEqual(m.mem[0x00], 0x01);
}
{
  // addw ya,$30 with ya = $7FFF and [$30] = 1 -> $8000: negative, signed overflow, half-carry out of bit 11
  const m = machine([0x7a, 0x30]);
  m.cpu.a = 0xff; m.cpu.y = 0x7f; m.mem[0x30] = 0x01; m.mem[0x31] = 0x00;
  run(m, 1);
  assert.strictEqual(m.cpu.a, 0x00);
  assert.strictEqual(m.cpu.y, 0x80);
  assert.strictEqual(m.cpu.psw, PSW.N | PSW.V | PSW.H);
}
{
  // tcall 1 jumps through the vector at $FFDC ($FFDE - 2 * n)
  const m = machine([0x11]);
  m.mem[0xffdc] = 0x34; m.mem[0xffdd] = 0x12;
  assert.strictEqual(run(m, 1), 8);
  assert.strictEqual(m.cpu.pc, 0x1234);
}
{
  // mov a,#9 ; adc a,#8 -> $11 with half-carry ; daa -> $17 (BCD 9 + 8)
  const m = machine([0xe8, 0x09, 0x88, 0x08, 0xdf]);
  run(m, 3);
  assert.strictEqual(m.cpu.a, 0x17);
}
{
  // xcn swaps nibbles ; push/pop psw round trip ; mov (x)+,a stores and steps x
  const m = machine([0xe8, 0x1a, 0x9f, 0x0d, 0x8e, 0xcd, 0x40, 0xaf]);
  run(m, 2);
  assert.strictEqual(m.cpu.a, 0xa1);
  run(m, 3);
  assert.strictEqual(m.cpu.sp, 0xef);
  run(m, 1);
  assert.strictEqual(m.mem[0x40], 0xa1);
  assert.strictEqual(m.cpu.x, 0x41);
}
console.log('spc700 cpu: hand-encoded instruction, flag and cycle checks OK');

{
  // Tables are complete and the names group sensibly.
  assert.strictEqual(spc.CYCLES.length, 256);
  assert.strictEqual(spc.NAMES.filter(Boolean).length, 256);
  assert.strictEqual(spc.groupName(0xe8), 'MOV');
  assert.strictEqual(spc.groupName(0x88), 'ADC');
  assert.strictEqual(spc.groupName(0x13), 'BBC');
  // The 93S/94S sound programs: the opcodes they run are recorded and all decode to real instructions.
  const reached = driverOps.opcodes();
  const swept = driverOps.opcodes(true);
  assert.strictEqual(reached.length, 119);
  assert.strictEqual(swept.length, 226);
  assert.ok(reached.every((op) => swept.includes(op)), 'reachable code is part of the linear sweep');
  assert.ok(reached.every((op) => spc.NAMES[op]));
}
console.log('spc700 cpu: instruction tables and the 93S/94S driver opcode lists OK');
