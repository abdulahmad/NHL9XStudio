#!/usr/bin/env node
/**
 * Validate lib/audio/m68k-cpu.js against the SingleStepTests 680x0 suite
 * (github.com/SingleStepTests/680x0, 68000/v1: ~8,000 tests per operation).
 *
 * The suite is downloaded on first run into out/singlesteptests-680x0 (ignored
 * by git; nothing from it is committed). Point SINGLESTEP_68000_DIR at an
 * existing checkout's 68000/v1 folder to skip the download.
 *
 *   node test/m68k-singlestep.js                 # every file, full report
 *   node test/m68k-singlestep.js MOVE.w Bcc      # only these files
 *   node test/m68k-singlestep.js --limit 500     # first N tests per file
 *   node test/m68k-singlestep.js --report out/m68k-singlestep.md
 *   node test/m68k-singlestep.js --show 3 MOVE.w # print the first 3 failures
 *
 * A test passes when D0-D7, A0-A6, USP, SSP, SR, PC and every RAM byte listed
 * in the final state match, and no other byte was written. Prefetch contents
 * and cycle counts are not compared (the core has no prefetch/cycle model).
 * Tests whose bus trace reads vector 3 (an address error) are counted apart.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const m68k = require('../lib/audio/m68k-cpu');
const driverOps = require('./m68k-driver-ops');

const ROOT = path.join(__dirname, '..');
const REPO = 'https://github.com/SingleStepTests/680x0';

function suiteDir() {
  if (process.env.SINGLESTEP_68000_DIR) return process.env.SINGLESTEP_68000_DIR;
  const clone = path.join(ROOT, 'out', 'singlesteptests-680x0');
  const dir = path.join(clone, '68000', 'v1');
  if (fs.existsSync(path.join(dir, 'NOP.json.gz'))) return dir;
  console.log('Downloading ' + REPO + ' (68000/v1, ~200 MB) into ' + path.relative(ROOT, clone) + ' …');
  fs.mkdirSync(path.dirname(clone), { recursive: true });
  const env = Object.assign({}, process.env, { GIT_LFS_SKIP_SMUDGE: '1' });
  execFileSync('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', REPO, clone], { stdio: 'inherit', env });
  execFileSync('git', ['-C', clone, 'sparse-checkout', 'set', '68000/v1'], { stdio: 'inherit', env });
  return dir;
}

const REGS = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'usp', 'ssp', 'sr', 'pc'];

function runTest(t) {
  const mem = new Map();
  for (const [a, v] of t.initial.ram) mem.set(a, v);
  const written = new Set();
  const pc0 = t.initial.pc;
  const [pf0, pf1] = t.initial.prefetch;
  const rd8 = (a) => (mem.has(a) ? mem.get(a) : 0);
  const bus = {
    read8: rd8,
    read16: (a) => (rd8(a) << 8) | rd8((a + 1) & 0xffffff),
    write8: (a, v) => { mem.set(a, v & 0xff); written.add(a); },
    write16: (a, v) => {
      mem.set(a, (v >> 8) & 0xff); written.add(a);
      const b = (a + 1) & 0xffffff;
      mem.set(b, v & 0xff); written.add(b);
    },
    fetch16: (a) => (a === pc0 ? pf0 : a === ((pc0 + 2) & 0xffffff) ? pf1 : bus.read16(a))
  };
  const cpu = m68k.create(bus);
  const s = t.initial;
  cpu.load({ d: [s.d0, s.d1, s.d2, s.d3, s.d4, s.d5, s.d6, s.d7], a: [s.a0, s.a1, s.a2, s.a3, s.a4, s.a5, s.a6], usp: s.usp, ssp: s.ssp, sr: s.sr, pc: s.pc });
  cpu.step();
  const got = {
    d0: cpu.D[0], d1: cpu.D[1], d2: cpu.D[2], d3: cpu.D[3], d4: cpu.D[4], d5: cpu.D[5], d6: cpu.D[6], d7: cpu.D[7],
    a0: cpu.A[0], a1: cpu.A[1], a2: cpu.A[2], a3: cpu.A[3], a4: cpu.A[4], a5: cpu.A[5], a6: cpu.A[6],
    usp: cpu.usp, ssp: cpu.ssp, sr: cpu.sr, pc: cpu.pc
  };
  const diffs = [];
  for (const r of REGS) {
    const want = t.final[r] >>> 0;
    const have = (r === 'pc' ? got[r] & 0xffffff : got[r]) >>> 0;
    if ((r === 'pc' ? want & 0xffffff : want) !== have) diffs.push(r + ' ' + have.toString(16) + ' want ' + want.toString(16));
  }
  const listed = new Set();
  for (const [a, v] of t.final.ram) {
    listed.add(a);
    if (rd8(a) !== v) diffs.push('ram ' + a.toString(16) + '=' + rd8(a).toString(16) + ' want ' + v.toString(16));
  }
  for (const a of written) if (!listed.has(a)) diffs.push('stray write ' + a.toString(16));
  return diffs;
}

const isAddressError = (t) => t.transactions.some((x) => x[0] === 'r' && (x[3] === 12 || x[3] === 14));

function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const limit = Number(opt('--limit')) || 0;
  const reportPath = opt('--report');
  const show = Number(opt('--show')) || 0;
  const dir = suiteDir();
  let files = fs.readdirSync(dir).filter((f) => f.endsWith('.json.gz')).map((f) => f.replace('.json.gz', '')).sort();
  if (args.length) files = files.filter((f) => args.includes(f));
  const rows = [];
  const failures = [];
  const totals = { all: 0, pass: 0, ae: 0, aePass: 0 };
  for (const f of files) {
    let tests = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f + '.json.gz'))));
    if (limit) tests = tests.slice(0, limit);
    const row = { file: f, all: 0, pass: 0, ae: 0, aePass: 0 };
    let shown = 0;
    for (const t of tests) {
      let diffs;
      try { diffs = runTest(t); } catch (err) { diffs = ['threw ' + err.message]; }
      const ae = isAddressError(t);
      row.all += 1;
      if (ae) row.ae += 1;
      if (!diffs.length) { row.pass += 1; if (ae) row.aePass += 1; }
      else if (failures.length < 50) failures.push({ file: f, name: t.name, diffs });
      if (diffs.length && shown < show) { shown += 1; console.log('FAIL ' + f + ' :: ' + t.name + (ae ? ' [address error]' : '') + '\n   ' + diffs.slice(0, 8).join('\n   ')); }
    }
    for (const k of Object.keys(totals)) totals[k] += row[k];
    rows.push(row);
  }
  // Exact 100% only when nothing failed; otherwise enough digits to show it.
  const pct = (p, n) => (!n ? '—' : p === n ? '100%' : (Math.floor(10000 * 100 * p / n) / 10000).toFixed(4) + '%');
  const used = new Set(driverOps.groups());
  const lines = [];
  lines.push('# m68k-cpu.js vs SingleStepTests 680x0 (68000/v1)');
  lines.push('');
  lines.push('A test passes when D0–D7, A0–A6, USP, SSP, SR, PC and every listed RAM byte match and nothing else was written. ' +
    '"Address error" tests are the ones whose bus trace reads vector 3. Prefetch and cycle counts are not compared.');
  lines.push('');
  lines.push('**Total: ' + totals.pass + ' / ' + totals.all + ' (' + pct(totals.pass, totals.all) + ')** · without address-error tests: ' +
    (totals.pass - totals.aePass) + ' / ' + (totals.all - totals.ae) + ' (' + pct(totals.pass - totals.aePass, totals.all - totals.ae) + ')' +
    ' · address-error tests: ' + totals.aePass + ' / ' + totals.ae + ' (' + pct(totals.aePass, totals.ae) + ')');
  lines.push('');
  lines.push('| Group | Used by NHL 92 sound code | Pass | All | Without address errors | Address-error tests |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of rows) {
    lines.push('| ' + r.file + ' | ' + (used.has(r.file) ? 'yes' : '') + ' | ' + pct(r.pass, r.all) + ' | ' + r.pass + '/' + r.all + ' | ' +
      pct(r.pass - r.aePass, r.all - r.ae) + ' (' + (r.pass - r.aePass) + '/' + (r.all - r.ae) + ') | ' +
      (r.ae ? pct(r.aePass, r.ae) + ' (' + r.aePass + '/' + r.ae + ')' : '—') + ' |');
  }
  if (failures.length) {
    lines.push('', '## Failing tests' + (failures.length === 50 ? ' (first 50)' : ''), '');
    for (const x of failures) lines.push('- `' + x.file + '` ' + x.name + ': ' + x.diffs.slice(0, 4).join('; '));
  }
  const missing = [...used].filter((g) => !rows.some((r) => r.file === g));
  if (missing.length && !args.length) lines.push('', 'Groups the sound code uses with no SingleStepTests file: ' + missing.join(', '));
  const text = lines.join('\n') + '\n';
  if (reportPath) fs.writeFileSync(path.resolve(reportPath), text);
  console.log(text);
}

main();
