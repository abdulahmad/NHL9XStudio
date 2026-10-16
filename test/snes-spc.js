/**
 * Unit tests for lib/audio/snes-spc.js: the boot ROM and upload protocol, the CPU ports, the timers, the $F0-$FF
 * window and the DSP clock. Programs are hand-encoded SPC700 code.
 */
const assert = require('assert');
const snes = require('../lib/audio/snes-spc');

const R = require('../lib/audio/snes-dsp').REG;

{
  // Boot ROM: 64 bytes, reset vector $FFC0, announces $BBAA on the ports
  assert.strictEqual(snes.IPL.length, 64);
  const u = snes.create();
  assert.strictEqual(u.cpu.pc, 0xffc0);
  assert.strictEqual(u.bus.read(0xffc0), 0xcd);
  assert.strictEqual(u.bus.read(0xfffe), 0xc0);
  u.runCycles(5000);
  assert.strictEqual(u.portRead(0), 0xaa);
  assert.strictEqual(u.portRead(1), 0xbb);
}
{
  // Upload through the boot ROM: two blocks, then start. The program writes $42 to $0300 and loops; the second block
  // ($0300: 1, 2, 3) is overwritten at its first byte only.
  const u = snes.create();
  u.iplUpload([
    { addr: 0x200, bytes: [0xe8, 0x42, 0xc5, 0x00, 0x03, 0x2f, 0xfe] }, // mov a,#$42 ; mov !$0300,a ; bra -2
    { addr: 0x300, bytes: [1, 2, 3] }
  ], 0x200);
  u.runCycles(1000);
  assert.strictEqual(u.ram[0x201], 0x42);
  assert.strictEqual(u.ram[0x300], 0x42);
  assert.strictEqual(u.ram[0x301], 2);
  assert.strictEqual(u.ram[0x302], 3);
  assert.strictEqual(u.cpu.pc, 0x205);
  // a program that has started leaves the boot ROM visible until it hides it
  assert.strictEqual(u.bus.read(0xffc0), 0xcd);
}
{
  // Ports: the main CPU writes $F4-$F7 from its side, the SPC700 reads them and answers on its own latches
  const u = snes.create();
  u.load(0x200, [0xe4, 0xf4, 0x60, 0x88, 0x01, 0xc4, 0xf5, 0x2f, 0xf7]); // mov a,$f4 ; clrc ; adc a,#1 ; mov $f5,a ; bra -9
  u.start(0x200);
  u.portWrite(0, 0x20);
  u.runCycles(100);
  assert.strictEqual(u.portRead(1), 0x21);
  assert.strictEqual(u.portRead(0), 0, 'the SPC700 writes its own latch, not the one the CPU wrote');
  u.portWrite(0, 0x30);
  u.runCycles(100);
  assert.strictEqual(u.portRead(1), 0x31);
  // CONTROL bit 4 clears ports 0 and 1 (the CPU-to-SPC side)
  u.load(0x300, [0x8f, 0x10, 0xf1, 0x2f, 0xfe]); // mov $f1,#$10 ; bra -2
  u.cpu.pc = 0x300;
  u.runCycles(50);
  assert.strictEqual(u.bus.read(0xf4), 0);
}
{
  // $F2/$F3 are the DSP window: the SPC700 writes main volume and reads it back
  const u = snes.create();
  u.load(0x200, [0x8f, 0x0c, 0xf2, 0x8f, 0x55, 0xf3, 0xe4, 0xf3, 0xc4, 0x10, 0x2f, 0xfe]);
  u.start(0x200);
  u.runCycles(100);
  assert.strictEqual(u.dsp.read(R.MVOLL), 0x55);
  assert.strictEqual(u.ram[0x10], 0x55);
  assert.strictEqual(u.bus.read(0xf2), 0x0c);
}
{
  // Timer 0: target 2, enabled: stage 3 counts once per 2 * 128 CPU cycles and is cleared when read
  const u = snes.create();
  u.load(0x200, [0x8f, 0x02, 0xfa, 0x8f, 0x01, 0xf1, 0x2f, 0xfe]); // mov $fa,#2 ; mov $f1,#1 ; bra -2
  u.start(0x200);
  u.runCycles(1290);
  assert.strictEqual(u.bus.read(0xfd), 5, 'about 10 ticks of 128 cycles, 2 per count');
  assert.strictEqual(u.bus.read(0xfd), 0, 'reading clears it');
  // target 0 means 256
  const v = snes.create();
  v.load(0x200, [0x8f, 0x01, 0xf1, 0x2f, 0xfe]);
  v.start(0x200);
  v.runCycles(128 * 256 * 3 + 100);
  assert.strictEqual(v.bus.read(0xfd), 3);
  // Timer 2 runs 8 times faster (every 16 cycles): target 4 -> a count per 64 cycles
  const w = snes.create();
  w.load(0x200, [0x8f, 0x04, 0xfc, 0x8f, 0x04, 0xf1, 0x2f, 0xfe]);
  w.start(0x200);
  w.runCycles(64 * 7 + 20);
  assert.strictEqual(w.bus.read(0xff), 7);
}
{
  // The DSP is clocked from the CPU: one output sample per 32 cycles, deterministic, and render() returns them
  const u = snes.create();
  u.load(0x200, [0x2f, 0xfe]);
  u.start(0x200);
  const out = u.render(500);
  assert.strictEqual(out.length, 1000);
  assert.ok(u.cycles >= 500 * 32 && u.cycles < 500 * 32 + 10);
  assert.strictEqual(u.dsp.counter, 0x7800 - 500, 'DSP rate counter advanced once per sample');
}
console.log('snes spc: boot ROM, upload protocol, ports, DSP window, timers and the sample clock OK');

{
  // End to end: an SPC700 program sets up one voice through $F2/$F3 and plays a BRR sample; the host gets audio out
  const u = snes.create();
  const brr = new Uint8Array(18);
  brr[0] = 0xc0; brr.fill(0x44, 1, 9);
  brr[9] = 0xc3; brr.fill(0x44, 10, 18);
  const writes = [
    [R.DIR, 0x02], [R.FLG, 0x20], [R.MVOLL, 0x7f], [R.MVOLR, 0x7f], [0x00, 0x60], [0x01, 0x60], [0x02, 0x00], [0x03, 0x10],
    [0x04, 0x00], [0x05, 0x00], [0x07, 0x7f], [R.KON, 0x01]
  ];
  const code = [];
  writes.forEach(([r, v]) => code.push(0x8f, r, 0xf2, 0x8f, v, 0xf3)); // mov $f2,#reg ; mov $f3,#value
  code.push(0x2f, 0xfe);
  u.load(0x1000, brr);
  u.ram[0x200] = 0x00; u.ram[0x201] = 0x10; u.ram[0x202] = 0x00; u.ram[0x203] = 0x10;
  u.load(0x400, code);
  u.start(0x400);
  const out = u.render(600);
  assert.ok(out.slice(0, 16).every((v) => v === 0), 'silent while the voice starts: ' + Array.from(out.slice(0, 40)).join());
  assert.ok(out[2 * 500] > 3000, 'sound from the program-driven voice: ' + out[2 * 500]);
  const s = u.dsp.voiceState(0);
  assert.strictEqual(s.pitch, 0x1000);
  assert.strictEqual(s.envMode, 'attack');
}
console.log('snes spc: an SPC700 program drives the DSP end to end OK');
