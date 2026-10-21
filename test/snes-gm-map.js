'use strict';
const assert = require('assert');
const M = require('../lib/audio/snes-gm-map');
const m93 = require('../data/audio/nhl93s-gm-map.json');
const m94 = require('../data/audio/nhl94s-gm-map.json');

assert.strictEqual(M.validate(m93, { requireMeasured: true }).length, 0);
assert.strictEqual(M.validate(m94, { requireMeasured: true }).length, 0);

assert.strictEqual(M.instrumentForProgram93(m93, 'boot', 33), 0);
assert.strictEqual(M.instrumentForProgram93(m93, 'boot', 99), M.instrumentForProgram93(m93, 'boot', 80));
assert.deepStrictEqual(M.drumFor93(m93, 'boot', 36), { inst: 1, key: 19 });

assert.strictEqual(M.instrumentForProgram94(m94, 'menu', 33), 2);
assert.ok(M.idsForProgram(m94, 'menu', 17).includes(M.instrumentForProgram94(m94, 'menu', 17)));
assert.strictEqual(M.drumFor94(m94, 'menu', 36), 1);

const d = M.describeEntry(m93, 'boot', 0);
assert.ok(d && d.text.includes('GM program 33'));
assert.ok(M.idsForProgram(m93, 'boot', 33).includes(0));

console.log('snes-gm-map: ok');
