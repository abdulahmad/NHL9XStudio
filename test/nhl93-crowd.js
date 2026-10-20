// NHLPA 93 Genesis crowd noise: the levels updatesound (video93.asm:918-943) can reach, and the noise render.
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
