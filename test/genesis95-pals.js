/** NHL 95 Genesis team palettes are read from the retail ROM, not only the four bundled files. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const P = require('../lib/genesis95-pals');
const { paletteParts } = require('../lib/labels');
const { findRomIn, ROMS } = require('../lib/upstream-rom');

assert.strictEqual(P.TEAMS.length, 28);
assert.strictEqual(P.palettes(new Uint8Array(100)), null);
assert.strictEqual(P.palettes(new Uint8Array(P.ROM_SIZE)), null, 'a 2 MB file that is not a Genesis ROM');

const rom = new Uint8Array(P.ROM_SIZE);
rom[0x100] = 0x53; rom[0x101] = 0x45; rom[0x102] = 0x47; rom[0x103] = 0x41; // SEGA
const chi = P.TEAMS.find((t) => t[0] === 'chi');
for (let i = 0; i < 32; i++) rom[chi[1] + i] = 0x40 + i;
const pals = P.palettes(rom);
assert.strictEqual(pals.length, 56);
assert.deepStrictEqual([...pals.find((p) => p.name === 'chih.pal').bytes], [...rom.subarray(chi[1], chi[1] + 32)]);
assert.deepStrictEqual([...pals.find((p) => p.name === 'chiv.pal').bytes], [...rom.subarray(chi[1] + 32, chi[1] + 64)]);
assert.ok(pals.some((p) => p.name === 'flah.pal'), 'Florida is past Calgary');
assert.ok(pals.some((p) => p.name === 'wpgh.pal'));
assert.ok(pals.some((p) => p.name === 'aseh.pal') && pals.some((p) => p.name === 'aswh.pal'));
for (const p of pals) {
  const label = paletteParts(p.name, 'nhl95').label;
  assert.ok(label && !/^[a-z]{2,3} ·/.test(label), p.name + ' labels as a city, got ' + label);
}
const headed = new Uint8Array(P.ROM_SIZE + 512);
headed.set(rom, 512);
headed[0x300] = 0x53; headed[0x301] = 0x45; headed[0x302] = 0x47; headed[0x303] = 0x41;
assert.strictEqual(P.byName(headed, 'CHIh.pal')[0], 0x40);

const retail = findRomIn(['/tmp/disasm/NHL95Genesis', path.join(__dirname, '..', 'roms')], ROMS.nhl95);
if (retail) {
  const bytes = fs.readFileSync(retail);
  const live = P.palettes(bytes);
  assert.strictEqual(live.length, 56, retail);
  const bundled = path.join(__dirname, '..', 'data', 'pals', 'genesis95');
  const same = (name, file) => assert.ok(
    Buffer.from(P.byName(bytes, name)).equals(fs.readFileSync(path.join(bundled, file))),
    name + ' matches bundled ' + file
  );
  same('anah.pal', 'anah.pal');
  same('anav.pal', 'anav.pal');
  same('bosh.pal', 'Bruinsh.pal');
  same('bosv.pal', 'Bruinsv.pal');
  same('bufh.pal', 'sabresh.pal');
  same('bufv.pal', 'sabresv.pal');
  same('cgyh.pal', 'flamesh.pal');
  same('cgyv.pal', 'flamesv.pal');
  console.log('genesis95 pals checked against ' + retail);
} else {
  console.log('genesis95 pals: no retail ROM, offset table only');
}

console.log('genesis95 pals ok');
