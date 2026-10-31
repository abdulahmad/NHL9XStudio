// node test.js [-q|--quiet] [--all] [--base <ref>] [--core]
//   Change-aware by default: runs only the tests the files changed vs origin/main (plus uncommitted / untracked files)
//   can affect; see test/select.js for the map. A shared or unmapped file runs everything. --all runs everything.
//   -q hides the progress lines and prints one summary line, or the full log if anything fails.
//   --core skips the node sound suites (legacy). NHL_SKIP_BROWSER=1 skips the Playwright scripts.
const quiet = process.argv.includes('-q') || process.argv.includes('--quiet');
const quietLog = [];
if (quiet) {
  const keep = (...a) => quietLog.push(a.join(' '));
  console.log = keep;
  console.info = keep;
  process.on('exit', (code) => {
    if (code) process.stderr.write(quietLog.join('\n') + '\n');
    else process.stdout.write('all tests passed (' + quietLog.length + ' log lines hidden)\n');
  });
}
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { SUITES, BROWSER, changedFiles, selectTests } = require('./test/select');
const say = (s) => process.stdout.write(s + '\n'); // the selection is printed even with -q
const baseAt = process.argv.indexOf('--base');
const base = baseAt > 0 ? process.argv[baseAt + 1] : (process.env.NHL_TEST_BASE || 'origin/main');

let runAll = process.argv.includes('--all');
let selected = new Map();
if (!runAll) {
  const files = changedFiles(base);
  if (!files) { runAll = true; say('test.js: cannot diff against ' + base + '; running everything'); }
  else {
    const { all, tests } = selectTests(files);
    say('test.js: ' + files.length + ' changed file(s) vs ' + base + (files.length ? ': ' + files.slice(0, 12).join(', ') + (files.length > 12 ? ', ...' : '') : ''));
    if (all) { runAll = true; say('test.js: running everything because of ' + all); }
    else selected = tests;
  }
} else say('test.js: --all, running everything');
const want = (name) => runAll || selected.has(name);
if (!runAll) {
  if (!selected.size) say('test.js: nothing selected (use --all to run everything)');
  for (const [t, why] of selected) say('test.js: selected ' + t + ' <- ' + why.slice(0, 3).join(', ') + (why.length > 3 ? ' +' + (why.length - 3) : ''));
}

if (want('core')) require('./test/core');

// Sound and sequencer suites (the slow part). `node test.js --core` skips them.
if (!process.argv.includes('--core')) {
  for (const s of SUITES) if (want(s)) require('./test/' + s);
}

// Browser checks (Playwright): test/browser/load-errors.js opens every game in every mode at desktop and phone width
// and fails on page errors, console errors or error text; the others cover the Audio list, sound smoke, the SNES 93
// roll, the NHL 95 sequencer and revision switching. Skipped without Playwright; NHL_SKIP_BROWSER=1 skips them too.
// test/browser/editor-scrub.js runs on its own.
if (process.env.NHL_SKIP_BROWSER !== '1') {
  const { spawn } = require('child_process');
  for (const b of BROWSER) {
    if (!want('browser:' + b)) continue;
    const child = spawn(process.execPath, [path.join(__dirname, 'test', 'browser', b + '.js')], { stdio: quiet ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
    if (quiet) child.stdout.on('data', (d) => quietLog.push(String(d).trimEnd()));
    child.on('exit', (code) => {
      if (code !== 0) {
        console.error('test/browser/' + b + '.js failed');
        process.exitCode = 1;
      }
    });
  }
}

{
  // the About pop-up reads its version from the newest changelog entry, which must match package.json
  const log = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'changelog.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert.strictEqual(log.releases[0].version, pkg.version, 'changelog.json newest release must equal package.json version');
  const seen = new Set();
  log.releases.forEach((r) => {
    assert.ok(r.version && Array.isArray(r.changes) && r.changes.length, 'changelog entry ' + r.version);
    assert.ok(!seen.has(r.version), 'changelog version ' + r.version + ' is repeated');
    seen.add(r.version);
  });
  console.log('changelog ok (v' + pkg.version + ')');
}
