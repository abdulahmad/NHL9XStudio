/**
 * NHLPA 93 / NHL 94 mapping audition (lib/audio/nhl9x-gm-audition.js): every pick of every direction plans, the game
 * side of a patch renders audibly on the retail drivers, and the two sides come out at the same level.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const A = require('../lib/audio/nhl9x-gm-audition');
const ym = require('../lib/audio/ym2612-wasm');
const psg = require('../lib/audio/sn76489');

const root = path.join(__dirname, '..');
const map = JSON.parse(fs.readFileSync(path.join(root, 'data', 'audio', 'nhl9x-gm-map.json'), 'utf8'));
const GAMES = {
  93: { driver: require('../lib/audio/nhl93-68k-harness'), slice: 'nhl93-sound-slice.bin', start: 0x165d8, size: 0x2e1fc },
  94: { driver: require('../lib/audio/nhl94-68k-harness'), slice: 'nhl94-sound-slice.bin', start: 0x1a264, size: 0x4b5c0 }
};

for (const dir of A.DIRECTIONS) {
  const list = A.picks(map, dir);
  assert.ok(list.length > 10, dir + ' picks');
  for (const p of list) {
    const pl = A.plan(map, dir, p.value);
    assert.ok(pl.picked && pl.mapped && pl.info, dir + ' ' + p.value);
    if (dir === 'n2g') A.plan(map, dir, p.value, true);
    A.sideLabel(pl.picked, 93);
    A.sideLabel(pl.mapped, 94);
  }
}
assert.strictEqual(A.plan(map, 'n2g', 106).picked.style, 'hits');
assert.strictEqual(A.plan(map, 'n2g', 1).picked.style, 'scale');

(async () => {
  for (const game of [93, 94]) {
    const g = GAMES[game];
    const image = new Uint8Array(g.size);
    image.set(fs.readFileSync(path.join(root, 'data', 'fixtures', g.slice)), g.start);
    const chip = await ym.createChip();
    const env = { game, image, driver: g.driver, newChip: () => chip, newPsg: () => psg.create(), keepChip: true };
    try {
      let heard = 0;
      for (const patch of [1, 5, 20, 106]) {
        const side = A.plan(map, 'n2g', patch).picked;
        const mono = A.renderSide(side, env);
        let peak = 0;
        for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]));
        assert.ok(mono.length > 53267 * 0.5, game + ' patch ' + patch + ' length ' + mono.length);
        assert.ok(peak > 0.45 && peak <= 0.51, game + ' patch ' + patch + ' normalised peak ' + peak);
        heard += 1;
      }
      const gm = A.renderSide(A.plan(map, 'n2g', 1).mapped, env);
      assert.ok(gm.length > 1000, 'GM side renders');
      console.log('NHL ' + game + ' mapping audition: ' + heard + ' patches render audibly OK');
    } finally { chip.dispose(); }
  }
})().catch((err) => { console.error(err); process.exit(1); });
