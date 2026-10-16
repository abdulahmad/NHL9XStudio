/**
 * Tests for lib/audio/snes-gm-analysis.js and the two SNES GM maps built on it: a fresh '93 analysis equals the committed
 * file, a sample of '94 entries do too, and every map row is complete (program or drum in range, confidence, runner-up,
 * and a measured entry behind it).
 */
const assert = require('assert');
const A = require('../lib/audio/snes-gm-analysis');
const d93 = require('../lib/audio/nhl93s-sound-data').load(require('../data/audio/nhl93s-sound.json'));
const d94 = require('../lib/audio/nhl94s-sound-data').load(require('../data/audio/nhl94s-sound.json'));
const a93 = require('../data/audio/nhl93s-instrument-analysis.json');
const a94 = require('../data/audio/nhl94s-sound-analysis.json');
const m93 = require('../data/audio/nhl93s-gm-map.json');
const m94 = require('../data/audio/nhl94s-gm-map.json');
const same = (x, y) => assert.deepStrictEqual(JSON.parse(JSON.stringify(x)), JSON.parse(JSON.stringify(y)));

// fresh '93 measurements equal the committed ones (the run is deterministic)
same(A.analyse93(d93).sets, a93.sets);
assert.strictEqual(Object.keys(a93.sets.boot).length + Object.keys(a93.sets.game).length, 29);
assert.strictEqual(Object.keys(a94.sets.menu).length, 56);
assert.strictEqual(Object.keys(a94.sets.game).length, 29);

// every probe made a sound except the '94 stream-effect placeholders
for (const set of Object.keys(a93.sets)) for (const [id, e] of Object.entries(a93.sets[set])) assert.ok(!e.measure.silent, "'93 " + set + ' ' + id + ' is audible');
for (const set of Object.keys(a94.sets)) for (const [id, e] of Object.entries(a94.sets[set])) if (e.sample) assert.ok(!e.measure.silent, "'94 " + set + ' ' + id + ' is audible');

// a few '94 entries re-measured
{
  const fresh = A.analyse94(d94);
  for (const [set, id] of [['menu', 1], ['menu', 4], ['menu', 31], ['game', 11], ['game', 21]]) same(fresh.sets[set][id], a94.sets[set][id]);
}

// measured facts the maps rely on
assert.strictEqual(a93.sets.boot[1].usage.melodic.distinctKeys, 1, "'93 kick sits on one fixed key");
assert.strictEqual(a93.sets.boot[4].measure.shape, 'sustained');
assert.strictEqual(a94.sets.menu[4].measure.shape, 'swell');

// map rows
function rows(map, analysis, label) {
  for (const set of Object.keys(map.sets)) {
    const rowsOf = map.sets[set];
    assert.ok(Object.keys(rowsOf).length > 0);
    for (const [id, r] of Object.entries(rowsOf)) {
      const where = label + ' ' + set + ' ' + id;
      assert.ok(analysis.sets[set][id], where + ' has a measurement');
      assert.ok((r.program != null) !== (r.drum != null), where + ' is a program or a drum, not both');
      if (r.program != null) assert.ok(r.program >= 0 && r.program <= 127, where + ' program');
      if (r.drum != null) assert.ok(r.drum >= 35 && r.drum <= 81, where + ' drum note');
      assert.ok(['high', 'medium', 'low'].includes(r.confidence), where + ' confidence');
      assert.ok(r.why && /Measured:/.test(r.why), where + ' reason carries the measurements');
      if (r.runnerUp) assert.ok(r.runnerUp.why, where + ' runner-up has a reason');
    }
  }
}
rows(m93, a93, "'93");
rows(m94, a94, "'94");
console.log('snes-gm-analysis: ok');
