/**
 * Change-aware test selection for `node test.js`. Maps the files changed against a base (origin/main by default, plus
 * uncommitted and untracked files) to the test groups they can affect, with an explicit rule list. A file no rule
 * claims, or a shared/core file, selects everything.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
// Node suites under test/ that test.js runs (each one runs when required).
const SUITES = [
  'chip-audio', 'nhl92-z80-driver', 'nhl92-z80-audio', 'nhl92-sound-data', 'nhl93-names', 'roll-snes-progressive',
  'nhl93-crowd', 'm68k-cpu', 'spc700-cpu', 'snes-dsp', 'snes-spc', 'nhl94s-sound-data', 'nhl94s-player', 'nhl94s-midi',
  'nhl93s-sound-data', 'nhl93s-samples', 'nhl93s-sample-match', 'nhl93s-player', 'nhl93s-midi', 'pc-audio-kms', 'pc94-audio', 'pc94-shape', 'snes-gm-map',
  'snes-gm-analysis', 'snes-sfx-midi', 'nhl92-68k-driver', 'nhl92-sound-chain', 'nhl9x-sound-chain', 'nhl95-sound-chain',
  'nhl95-seq', 'nhl95-stream', 'nhl9x-song-gm', 'nhl9x-stream', 'nhl9x-gm-audition', 'ym-note-tracker', 'nhl92-gm-map',
  'nhl92-sequencer', 'fingerprint-site', 'editor-extras', 'patch-edits-export', 'pc-jersey', 'pc-rink', 'pc-palette', 'pc-crests',
  'jim-roundtrip', 'genesis-quantize', 'jim-compress', 'sjim', 'sscr'
];
// Playwright scripts under test/browser/ that test.js runs.
const BROWSER = ['load-errors', 'audio-list', 'sound-smoke', 'snes93-roll', 'nhl95-sequencer', 'rev-switch', 'revision-picker', 'jed', 'jed-ice', 'jed-server', 'jim'];
const NON_SOUND = ['fingerprint-site', 'pc-jersey', 'pc-rink', 'pc-palette', 'pc-crests', 'jim-roundtrip', 'genesis-quantize', 'jim-compress', 'sjim', 'sscr', 'pc94-shape'];
const SOUND = SUITES.filter((s) => !NON_SOUND.includes(s));
const M68K = ['m68k-cpu', 'nhl92-68k-driver', 'nhl92-sound-chain', 'nhl9x-sound-chain', 'nhl95-sound-chain', 'nhl92-sequencer'];
const Z80 = ['chip-audio', 'nhl92-z80-driver', 'nhl92-z80-audio', 'nhl92-sound-chain', 'nhl92-68k-driver'];
const SPC = ['spc700-cpu', 'snes-dsp', 'snes-spc', 'nhl93s-player', 'nhl93s-sample-match', 'nhl93s-midi', 'nhl94s-player', 'nhl94s-midi', 'roll-snes-progressive'];
const SOUND_BROWSER = ['audio-list', 'sound-smoke', 'snes93-roll', 'nhl95-sequencer'];

const ALL = 'ALL';
// First matching rule wins. tests: names from SUITES, 'core' (test/core.js), 'browser:<name>' or ALL.
const RULES = [
  // Shared / core files: anything could break.
  { re: /^(test\.js|test\/select\.js|package(-lock)?\.json|server\.js|lib\/(games|studio|manifest|rom-detect|open-asset|http-cache|zip-store)\.js|public\/games\.json)$/, tests: ALL, why: 'shared file' },
  // Nothing runs for docs and repo metadata.
  { re: /(^|\/)[^/]+\.md$|^docs\/|^LICENSE|^\.gitignore$|^\.github\//, tests: [], why: 'docs / repo metadata' },
  // Tests themselves.
  { re: /^test\/core\.js$/, tests: ['core'], why: 'core checks' },
  { re: /^test\/browser\/harness\.js$/, tests: BROWSER.map((b) => 'browser:' + b), why: 'browser harness' },
  { re: /^test\/browser\/([\w-]+)\.js$/, tests: (m) => BROWSER.includes(m[1]) ? ['browser:' + m[1]] : [], why: 'browser test' },
  { re: /^test\/(m68k-driver-ops|m68k-singlestep)\.js$/, tests: ['m68k-cpu'], why: '68000 test helper' },
  { re: /^test\/(spc700-driver-ops|spc700-singlestep)\.js$/, tests: ['spc700-cpu'], why: 'SPC700 test helper' },
  { re: /^test\/([\w-]+)\.js$/, tests: (m) => SUITES.includes(m[1]) ? [m[1]] : ALL, why: 'test file' },
  { re: /^test\/fixtures\/pc-jersey\//, tests: ['pc-jersey', 'browser:jed'], why: 'jersey palette fixtures' },
  { re: /^test\/fixtures\/ANIM-To-BMP\//, tests: ['core', 'browser:load-errors'], why: 'image fixtures' },
  // CPU cores.
  { re: /^lib\/audio\/(m68k-cpu|nhl9[2-5x]-68k-[\w-]+)\.js$/, tests: M68K, why: '68000 core / drivers' },
  // The Z80 harness clock is shared by every Genesis chain (92-95), so its long-run test and all chain suites run.
  { re: /^lib\/audio\/nhl92-z80-harness\.js$/, tests: [...Z80, 'nhl9x-sound-chain', 'nhl95-sound-chain'], why: 'Z80 harness (all Genesis chains)' },
  { re: /^lib\/audio\/(z80[\w-]*|nhl92-z80[\w-]*)\.js$/, tests: Z80, why: 'Z80 core / driver' },
  { re: /^lib\/audio\/(spc700-cpu|snes-dsp|snes-spc)\.js$/, tests: SPC, why: 'SPC700 / S-DSP' },
  { re: /^tools\/fingerprint-site\.js$/, tests: ['fingerprint-site'], why: 'fingerprint tool' },
  { re: /^tools\/build-manifest\.js$/, tests: ['core'], why: 'manifest tool' },
  { re: /^tools\/(extract|build)-pc94-spa\.js$/, tests: ['core'], why: '94 PC SPA catalog' },
  { re: /^lib\/audio\/viv\.js$/, tests: ['core', 'pc94-audio', 'pc-audio-kms'], why: 'PC VIV speech' },
  // Everything else in sound: all sound suites, the core checks (they read the audio catalogue) and the sound pages.
  { re: /^(lib\/audio\/|data\/audio\/|tools\/(build|extract|render|run|scan|vendor)-)/, tests: ['core', ...SOUND, ...SOUND_BROWSER.map((b) => 'browser:' + b)], why: 'sound code / data' },
  // Jersey palette editor (NHL 94 / 95 PC HOMEPALS / AWAYPALS): its format module and page.
  { re: /^lib\/pc-jersey\.js$/, tests: ['pc-jersey', 'pc-rink', 'browser:jed', 'browser:jed-ice'], why: 'jersey palette format' },
  { re: /^(lib|test)\/pc-palette\.js$/, tests: ['pc-palette', 'browser:jed-ice'], why: 'team palette allocation for imports' },
  { re: /^(lib|test)\/pc-crests\.js$/, tests: ['pc-crests', 'browser:jed'], why: 'scoreboard crests (CRESTS4.PPV, PCX)' },
  { re: /^lib\/pc-rink\.js$/, tests: ['pc-rink', 'browser:jed-ice'], why: 'centre ice .TIL / .MAP format' },
  { re: /^test\/pc-rink\.js$/, tests: ['pc-rink'], why: 'centre ice tests' },
  { re: /^public\/jed\.(js|css|html)$/, tests: ['browser:jed', 'browser:jed-ice', 'browser:jed-server'], why: 'jersey editor page' },
  { re: /^public\/ice\.js$/, tests: ['browser:jed-ice'], why: 'centre ice tab' },
  { re: /^lib\/pc94-[\w-]+\.js$/, tests: ['core', 'pc94-shape'], why: 'NHL 94 PC pack / planar bank' },
  { re: /^test\/pc95-sprite-pipeline\.js$/, tests: ['pc-jersey'], why: 'NHL 95 PC sprite pipeline check' },
  { re: /^public\/jed-pals\//, tests: ['pc-jersey', 'browser:jed'], why: 'jersey editor base palettes' },
  { re: /^lib\/jim\.js$/, tests: ['core', 'jim-roundtrip', 'jim-compress', 'sjim'], why: 'JIM parse / encode' },
  { re: /^lib\/jim-compress\.js$/, tests: ['jim-compress', 'jim-roundtrip', 'sjim'], why: 'JIM tile compressor' },
  { re: /^lib\/sjim\.js$/, tests: ['sjim', 'jim-roundtrip', 'sscr'], why: 'SNES .map.sjim parse / encode' },
  { re: /^lib\/snespak\.js$/, tests: ['sscr', 'core'], why: 'SNES 93/94 graphics packers' },
  { re: /^lib\/sscr\.js$/, tests: ['sscr', 'jim-roundtrip', 'browser:jim'], why: 'NHL 94 SNES screens' },
  { re: /^lib\/genesis-quantize\.js$/, tests: ['genesis-quantize'], why: 'Genesis palette quantize' },
  { re: /^public\/jim\.(js|css|html)$/, tests: ['browser:jim', 'browser:load-errors'], why: 'Maps editor page' },
  // Image / parser libraries and data: the core checks only.
  { re: /^lib\/[\w-]+\.js$|^data\//, tests: ['core'], why: 'parser / image code or data' },
  // Sound pages in the viewer.
  { re: /^public\/sound-test-snes93\.js$/, tests: ['nhl93s-samples', ...[...SOUND_BROWSER, 'load-errors'].map((b) => 'browser:' + b)], why: '93S Audio list' },
  { re: /^public\/(sound-roll-snes|sound-roll|sound-test-view)\.js$/, tests: ['roll-snes-progressive', ...[...SOUND_BROWSER, 'load-errors'].map((b) => 'browser:' + b)], why: 'sound rolls (click-to-mute wiring)' },
  { re: /^public\/sound-editor-extras\.js$/, tests: ['editor-extras', 'browser:audio-list', 'browser:nhl95-sequencer'], why: 'editor extras' },
  { re: /^public\/(audio-engine|chip-lab|sound-[\w-]+)\.(js|css|html)$/, tests: [...SOUND_BROWSER, 'load-errors'].map((b) => 'browser:' + b), why: 'sound UI' },
  { re: /^public\//, tests: BROWSER.map((b) => 'browser:' + b), why: 'viewer' },
];

function git(cmd) {
  return execSync('git ' + cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n').filter(Boolean);
}

/** Files changed vs base (merge-base) plus uncommitted and untracked ones, or null when git cannot tell. */
function changedFiles(base) {
  try {
    const mb = git('merge-base HEAD ' + base)[0];
    const files = new Set([...git('diff --name-only ' + mb), ...git('ls-files --others --exclude-standard')]);
    return [...files].sort();
  } catch (err) { return null; }
}

function selectTests(files) {
  const tests = new Map(); // name -> [reasons]
  let all = null;
  const add = (t, why) => { if (!tests.has(t)) tests.set(t, []); tests.get(t).push(why); };
  for (const f of files) {
    const rule = RULES.find((r) => r.re.test(f));
    if (!rule) { all = all || f + ' (no rule)'; continue; }
    const t = typeof rule.tests === 'function' ? rule.tests(f.match(rule.re)) : rule.tests;
    if (t === ALL) { all = all || f + ' (' + rule.why + ')'; continue; }
    for (const x of t) add(x, f);
  }
  return { all, tests };
}

module.exports = { SUITES, BROWSER, RULES, changedFiles, selectTests };
