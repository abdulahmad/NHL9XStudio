#!/usr/bin/env node
/**
 * Which SPC700 opcodes do the NHL '93 and NHL '94 SNES sound drivers use? Reads the two sound programs from the
 * NHLPA93SNES / NHL94SNES disassembly repos (read-only; nothing from them is copied here) and prints the opcode
 * lists that test/spc700-driver-ops.js records.
 *
 *   node tools/scan-spc700-driver-ops.js <NHLPA93SNES dir> <NHL94SNES dir>
 *
 * Both programs are loaded at sound RAM $0400. For each one:
 *   reached = opcodes of code reachable from $0400 by following branches, jumps, calls and the words of a
 *             `jmp [!a+X]` table (up to 40 entries, the first word is skipped: it overlaps the table's offset base);
 *   swept   = opcodes of a linear decode over the whole block, data included, so a superset that also covers code
 *             reached only through computed jumps the trace cannot follow.
 */
const fs = require('fs');
const path = require('path');
const spc = require('../lib/audio/spc700-cpu');

function opLength(op) {
  const sp = spc.NAMES[op].split(' ');
  if (sp.length < 2) return 1;
  let n = 1;
  for (const part of sp.slice(1).join(' ').split(',')) {
    if (/!a|m\.b/.test(part)) n += 2;
    else if (/^(d|\[d|#i|r$|u$)/.test(part)) n += 1;
  }
  return n;
}

function load94(dir) {
  const rom = fs.readFileSync(path.join(dir, 'lst', 'nhl94snes.sfc'));
  const key = Buffer.from([0x00, 0x04, 0x20, 0xcd, 0xff]); // upload header (base $0400) + clrp, mov x,#$FF
  const i = rom.indexOf(key);
  if (i < 2) throw new Error('NHL94 sound driver block not found');
  const n = rom[i - 2] | (rom[i - 1] << 8);
  return rom.subarray(i + 2, i + 2 + n);
}

function trace(mem, base) {
  const top = base + mem.length;
  const seen = new Map();
  const todo = [base];
  const get = (a) => (a - base < mem.length ? mem[a - base] : 0);
  while (todo.length) {
    let pc = todo.pop();
    while (pc >= base && pc < top && !seen.has(pc)) {
      const op = mem[pc - base];
      const k = opLength(op);
      seen.set(pc, op);
      const arg = (j) => get(pc + j);
      const abs = arg(1) | (arg(2) << 8);
      if (/\br$/.test(spc.NAMES[op]) || /,r$/.test(spc.NAMES[op])) {
        const r = (arg(k - 1) ^ 0x80) - 0x80;
        todo.push(pc + k + r);
      }
      if (op === 0x3f || op === 0x5f) todo.push(abs);
      if (op === 0x4f) todo.push(0xff00 | arg(1));
      if (op === 0x1f) {
        for (let p = abs + 2; p < abs + 80 && p + 1 < top; p += 2) {
          const t = get(p) | (get(p + 1) << 8);
          if (t < base || t >= top) break;
          todo.push(t);
        }
      }
      if ([0x6f, 0x7f, 0x5f, 0x2f, 0x1f, 0xef, 0xff].includes(op)) break;
      pc += k;
    }
  }
  return new Set(seen.values());
}

function sweep(mem) {
  const ops = new Set();
  for (let p = 0; p < mem.length;) { ops.add(mem[p]); p += opLength(mem[p]); }
  return ops;
}

const hex = (s) => [...s].sort((a, b) => a - b).map((o) => ('0' + o.toString(16)).slice(-2));
const [d93, d94] = process.argv.slice(2);
if (!d93 || !d94) { console.error('usage: scan-spc700-driver-ops.js <NHLPA93SNES dir> <NHL94SNES dir>'); process.exit(2); }
const m93 = fs.readFileSync(path.join(d93, 'Extracted', 'Sound', 'driver.spc700'));
const m94 = load94(d94);
const out = {};
for (const [name, mem] of [['nhl93', m93], ['nhl94', m94]]) {
  out[name] = { bytes: mem.length, reached: hex(trace(mem, 0x400)), swept: hex(sweep(mem)) };
}
console.log(JSON.stringify(out, null, 1));
