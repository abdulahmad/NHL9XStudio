// Frame numbering: Genesis / Sega CD / SNES sprite frames count from 1, PC sprite frames from 0 (lib/frame-number.js).
const assert = require('assert');
const F = require('../lib/frame-number');
const { GAMES } = require('../lib/games');

for (const g of GAMES) {
  const pc = g.platform === 'pc';
  assert.strictEqual(F.zeroBased(g), pc, g.id + ' zero-based');
  assert.strictEqual(F.base(g), pc ? 0 : 1, g.id + ' base');
  assert.strictEqual(F.shown(g, 1), pc ? 0 : 1, g.id + ': the first picture');
  assert.strictEqual(F.shown(g, 370), pc ? 369 : 370, g.id + ': stored 370');
  for (const n of [1, 2, 193, 900]) assert.strictEqual(F.internal(g, F.shown(g, n)), n, g.id + ' round trip ' + n);
}
for (const s of ['pc', 'pc94', 'pc95', 'pc96', 'pc97', 'nhl95pc']) assert.ok(F.zeroBased(s), s);
for (const s of ['genesis', 'snes', 'anim', 'sheet', 'snes93', 'snes95', 'nhl94', 'nhl94cd', '', null, undefined]) assert.ok(!F.zeroBased(s), String(s));
// Abdul's pairing: 94 Genesis frame 193 is the same pose as 95 PC frame 192.
assert.strictEqual(F.shown('genesis', 193), 193);
assert.strictEqual(F.shown('pc', F.internal('pc', 192)), 192);
console.log('frame-number: Genesis/SNES 1-based, PC 0-based for ' + GAMES.length + ' games');
