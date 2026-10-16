#!/usr/bin/env node
/**
 * Validate lib/audio/spc700-cpu.js against the SingleStepTests SPC700 suite
 * (github.com/SingleStepTests/spc700, v1: 1,000 tests per opcode, 256 opcodes).
 *
 * The suite is downloaded on first run into out/singlesteptests-spc700 (ignored by git; nothing from it is
 * committed). Point SINGLESTEP_SPC700_DIR at an existing checkout's v1 folder to skip the download.
 * It is not part of `node test.js`.
 *
 *   node test/spc700-singlestep.js                 # every opcode, report per instruction group
 *   node test/spc700-singlestep.js MOV ADC         # only these groups (mnemonics) or hex opcodes (e8)
 *   node test/spc700-singlestep.js --limit 200     # first N tests per opcode
 *   node test/spc700-singlestep.js --report out/spc700-singlestep.md
 *   node test/spc700-singlestep.js --show 3 MOV    # print the first 3 failures per opcode
 *
 * A test passes when A, X, Y, SP, PC, PSW and every RAM byte in the final state match, no other byte was
 * written, and the instruction's total cycle count equals the length of the suite's bus trace. The order of the
 * individual bus accesses (dummy reads) is not compared. The suite's RAM is flat, so the test bus has no I/O
 * registers or boot ROM. Exit status is 1 if any test failed or any driver-used opcode is below 100%.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const spc = require('../lib/audio/spc700-cpu');
const driverOps = require('./spc700-driver-ops');

const ROOT = path.join(__dirname, '..');
const REPO = 'https://github.com/SingleStepTests/spc700';

function suiteDir() {
  if (process.env.SINGLESTEP_SPC700_DIR) return process.env.SINGLESTEP_SPC700_DIR;
  const clone = path.join(ROOT, 'out', 'singlesteptests-spc700');
  const dir = path.join(clone, 'v1');
  if (fs.existsSync(path.join(dir, '00.json'))) return dir;
  console.log('Downloading ' + REPO + ' (v1, 256 files) into ' + path.relative(ROOT, clone) + ' …');
  fs.mkdirSync(path.dirname(clone), { recursive: true });
  const env = Object.assign({}, process.env, { GIT_LFS_SKIP_SMUDGE: '1' });
  execFileSync('git', ['clone', '--depth', '1', REPO, clone], { stdio: 'inherit', env });
  return dir;
}

const REGS = ['a', 'x', 'y', 'sp', 'pc', 'psw'];

function runTest(t) {
  const mem = new Uint8Array(0x10000);
  for (const [a, v] of t.initial.ram) mem[a] = v;
  const written = new Set();
  const bus = {
    read: (a) => mem[a],
    write: (a, v) => { mem[a] = v & 0xff; written.add(a); }
  };
  const cpu = spc.create(bus);
  cpu.load(t.initial);
  const cycles = cpu.step();
  const diffs = [];
  for (const r of REGS) {
    if (cpu[r] !== t.final[r]) diffs.push(r + ' ' + cpu[r].toString(16) + ' want ' + t.final[r].toString(16));
  }
  const listed = new Set();
  for (const [a, v] of t.final.ram) {
    listed.add(a);
    if (mem[a] !== v) diffs.push('ram ' + a.toString(16) + '=' + mem[a].toString(16) + ' want ' + v.toString(16));
  }
  for (const a of written) if (!listed.has(a)) diffs.push('stray write ' + a.toString(16));
  if (cycles !== t.cycles.length) diffs.push('cycles ' + cycles + ' want ' + t.cycles.length);
  return diffs;
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const limit = Number(opt('--limit')) || 0;
  const reportPath = opt('--report');
  const show = Number(opt('--show')) || 0;
  const dir = suiteDir();
  let ops = [];
  for (let op = 0; op < 256; op++) ops.push(op);
  if (args.length) {
    ops = ops.filter((op) => args.includes(spc.groupName(op)) || args.includes(('0' + op.toString(16)).slice(-2)));
  }
  const rows = [];
  const groups = new Map();
  const failures = [];
  const total = { all: 0, pass: 0 };
  for (const op of ops) {
    const hex = ('0' + op.toString(16)).slice(-2);
    let tests = JSON.parse(fs.readFileSync(path.join(dir, hex + '.json'), 'utf8'));
    if (limit) tests = tests.slice(0, limit);
    const row = { op, hex, name: spc.NAMES[op], all: 0, pass: 0 };
    let shown = 0;
    for (const t of tests) {
      let diffs;
      try { diffs = runTest(t); } catch (err) { diffs = ['threw ' + err.message]; }
      row.all += 1;
      if (!diffs.length) row.pass += 1;
      else {
        if (failures.length < 50) failures.push({ hex, name: row.name, test: t.name, diffs });
        if (shown < show) { shown += 1; console.log('FAIL ' + hex + ' ' + row.name + ' :: ' + t.name + '\n   ' + diffs.slice(0, 8).join('\n   ')); }
      }
    }
    total.all += row.all; total.pass += row.pass;
    rows.push(row);
    const g = spc.groupName(op);
    const gr = groups.get(g) || { name: g, all: 0, pass: 0, ops: 0 };
    gr.all += row.all; gr.pass += row.pass; gr.ops += 1;
    groups.set(g, gr);
  }
  const pct = (p, n) => (!n ? '—' : p === n ? '100%' : (Math.floor(10000 * 100 * p / n) / 10000).toFixed(4) + '%');
  const used = new Set(driverOps.opcodes());
  const lines = [];
  lines.push('# spc700-cpu.js vs SingleStepTests SPC700 (v1)');
  lines.push('');
  lines.push('A test passes when A, X, Y, SP, PC, PSW and every listed RAM byte match, nothing else was written, and the cycle count equals the length of the suite\'s bus trace. ' +
    'The order of bus accesses is not compared.');
  lines.push('');
  lines.push('**Total: ' + total.pass + ' / ' + total.all + ' (' + pct(total.pass, total.all) + ')**');
  lines.push('');
  lines.push('## Per instruction group');
  lines.push('');
  lines.push('| Group | Opcodes | Pass | Tests |');
  lines.push('|---|---|---|---|');
  for (const g of [...groups.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    lines.push('| ' + g.name + ' | ' + g.ops + ' | ' + pct(g.pass, g.all) + ' | ' + g.pass + '/' + g.all + ' |');
  }
  lines.push('');
  lines.push('## Per opcode');
  lines.push('');
  lines.push('| Opcode | Instruction | Used by the 93S/94S sound drivers | Pass | Tests |');
  lines.push('|---|---|---|---|---|');
  for (const r of rows) {
    lines.push('| $' + r.hex + ' | ' + r.name + ' | ' + (used.has(r.op) ? 'yes' : '') + ' | ' + pct(r.pass, r.all) + ' | ' + r.pass + '/' + r.all + ' |');
  }
  const driverBad = rows.filter((r) => used.has(r.op) && r.pass !== r.all);
  if (failures.length) {
    lines.push('', '## Failing tests' + (failures.length === 50 ? ' (first 50)' : ''), '');
    for (const x of failures) lines.push('- `' + x.hex + '` ' + x.name + ' ' + x.test + ': ' + x.diffs.slice(0, 4).join('; '));
  }
  const text = lines.join('\n') + '\n';
  if (reportPath) fs.writeFileSync(path.resolve(reportPath), text);
  console.log(text);
  if (driverBad.length) console.log('DRIVER-USED OPCODES BELOW 100%: ' + driverBad.map((r) => r.hex + ' ' + r.name).join(', '));
  if (total.pass !== total.all) process.exitCode = 1;
}

main();
