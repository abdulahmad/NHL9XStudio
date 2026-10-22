// NHLPA 93 Genesis crowd noise: the levels updatesound (video93.asm:921-946) can reach, and the noise render.
const assert = require('assert');
const C = require('../lib/audio/nhl93-crowd');
assert.strictEqual(C.TONE2_PERIOD, 0x18);
assert.strictEqual(C.NOISE_CTRL & 0x07, 0x07); // white noise, rate from tone 2
assert.strictEqual(C.LEVELS.length, 11);
assert.deepStrictEqual(C.LEVELS.map((l) => l.write), [0xfb, 0xfa, 0xf9, 0xf8, 0xf7, 0xf6, 0xf5, 0xf4, 0xf3, 0xf2, 0xf1]);
// every target Crowdlevel*8+$400 (capped $EFF) maps to one of the 11 attenuations
const seen = new Set();
for (let cl = 0; cl < 0x1000 / 8 - 0x80; cl++) seen.add(C.attOf(Math.min(cl * 8 + 0x400, 0xeff) >> 8));
assert.strictEqual(seen.size, 11);
assert.strictEqual(C.OFF.write, 0xff);
assert.ok(C.render(C.OFF.att, 0.1).every((v) => v === 0));
const a = C.render(1, 0.5), b = C.render(11, 0.5);
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
assert.ok(rms(a) > rms(b) * 7 && rms(a) < rms(b) * 11, 'crowd11 is 20 dB louder than crowd1');
assert.ok(a.some((v) => v > 0) && a.some((v) => v < 0));

// NHL 92 / 94 / 95 Genesis run the same updatesound / KillCrowd, so the sound test lists the same crowd levels for them.
// Per game: the view names a source for it, the cited routine (when the disassembly sits next to the repo) writes the same
// PSG bytes, and its loudest level renders non-silent noise.
const fs = require('fs');
const path = require('path');
const view = fs.readFileSync(path.join(__dirname, '../public/sound-test-view.js'), 'utf8');
const psgBytes = (lines) => lines.filter((l) => /asound/i.test(l)).map((l) => (/#\$([0-9a-f]+)|#(\d+)/i.exec(l) || []).slice(1).find(Boolean)).map((v) => v == null ? 'asv' : (/^\d+$/.test(v) && v.length < 2 ? Number(v) : parseInt(v, 16)));
const routines = {};
for (const g of ['nhl92', 'nhlpa93', 'nhl94', 'nhl95']) {
  const m = new RegExp(g + ": \\['([^ ]+) (\\S+?):(\\d+)-(\\d+)', '[^ ]+ \\S+?:(\\d+)-(\\d+)'\\]").exec(view);
  assert.ok(m, g + ': crowd source listed in sound-test-view.js');
  const file = path.join(__dirname, '../..', m[1], m[2]);
  if (fs.existsSync(file)) {
    const src = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    routines[g] = [psgBytes(src.slice(m[3] - 1, m[4])), psgBytes(src.slice(m[5] - 1, m[6]))];
  }
  const loud = C.render(C.LEVELS[10].att, 0.25);
  assert.ok(rms(loud) > 0.1, g + ': crowd11 is non-silent');
}
if (routines.nhlpa93) for (const g in routines) assert.deepStrictEqual(routines[g], routines.nhlpa93, g + ': same PSG writes as NHLPA 93');
