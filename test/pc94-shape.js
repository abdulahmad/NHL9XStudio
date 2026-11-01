'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Pack = require('../lib/pc94-pack');
const Shape = require('../lib/pc94-shape');
const pc95 = require('../lib/pc95');
const openAsset = require('../lib/open-asset');

const pixels = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
const pal = new Uint8Array(768);
for (let i = 0; i < 256; i++) {
  pal[i * 3] = i & 63;
  pal[i * 3 + 1] = (i * 2) & 63;
  pal[i * 3 + 2] = (i * 3) & 63;
}
const bank = Shape.encodeBank([
  { name: '0000', width: 4, height: 2, hotX: 3, hotY: -5, pixels: pixels },
  { name: '!pal', palette: pal }
]);
assert.ok(Shape.isBank(bank), 'synthetic 94 bank is planar');
assert.ok(!pc95.isGfxPakPack(bank) || Shape.isBank(bank));

const opened = Shape.openBank(bank);
assert.strictEqual(opened.shapes.length, 1);
assert.strictEqual(opened.shapes[0].width, 4);
assert.strictEqual(opened.shapes[0].height, 2);
assert.strictEqual(opened.shapes[0].hotX, 3);
assert.strictEqual(opened.shapes[0].hotY, -5);
assert.deepStrictEqual(Array.from(opened.shapes[0].pixels), Array.from(pixels));
assert.ok(opened.palette);
assert.deepStrictEqual(opened.palette[1], [
  Math.min(255, Math.round(1 * 255 / 63)),
  Math.min(255, Math.round(2 * 255 / 63)),
  Math.min(255, Math.round(3 * 255 / 63))
]);

const packed = Pack.wrapBtree(bank);
assert.ok(Pack.isBtree(packed));
assert.ok(Pack.isPacked(packed));
assert.ok(!pc95.isRefPack(packed));
const unpacked = Pack.unpack(packed);
assert.strictEqual(unpacked.method, 'btree');
assert.deepStrictEqual(Array.from(unpacked.data), Array.from(bank));

const viaPc = pc95.openBytes(packed);
assert.ok(viaPc);
assert.strictEqual(viaPc.shapes.length, 1);
assert.deepStrictEqual(Array.from(viaPc.shapes[0].pixels), Array.from(pixels));
assert.ok(viaPc.palette);

const classified = openAsset.classify('TEST.QPP', packed);
assert.strictEqual(classified.kind, 'pc');
assert.strictEqual(openAsset.pcGameIdOf(classified), 'nhl94pc');
const decoded = openAsset.decodeLoose(classified, { pc95: pc95 });
assert.ok(decoded);
assert.strictEqual(decoded.gameId, 'nhl94pc');
assert.strictEqual(decoded.parsed.numFrames, 876);
assert.deepStrictEqual(Array.from(decoded.parsed.renderFrame(1).pixels), Array.from(pixels));

const qfs = openAsset.classify('ARENA.QFS', packed);
assert.strictEqual(openAsset.pcGameIdOf(qfs), 'nhl95pc');

const dropped = pc95.catalogFromPaths(['ARENA.QPP', 'RINK.TIL', 'RINK.MAP', 'RINKPAL.QPP'], (rel) => {
  if (rel === 'ARENA.QPP') return packed;
  if (/\.TIL$/i.test(rel)) return new Uint8Array(64);
  if (/\.MAP$/i.test(rel)) {
    const out = new Uint8Array(6 + 48 * 74 * 2);
    out[0] = 48; out[2] = 74;
    return out;
  }
  return packed;
});
const droppedRink = dropped.images.find((image) => image.label === 'Ice rink');
assert.ok(droppedRink && droppedRink.kind === 'pc-rink');
assert.strictEqual(droppedRink.rinkGame, 94);

function retail94Dir() {
  const root = path.join(__dirname, '..');
  const cands = [
    process.env.NHL_PC94_DIR,
    path.join(root, 'pc94'),
    path.join(root, 'EA-NHL-Tools', 'Sprite-Viewer', 'pc94'),
    '/tmp/nhl94pc-src/lst/game'
  ].filter(Boolean);
  return cands.find((dir) => fs.existsSync(path.join(dir, '000_049.PPV'))) || null;
}

const retail = retail94Dir();
if (retail) {
  const ppv = pc95.openBytes(fs.readFileSync(path.join(retail, '000_049.PPV')));
  assert.ok(ppv && ppv.shapes.length === 50, '000_049.PPV has 50 planar frames');
  assert.strictEqual(ppv.shapes[0].width, 16);
  assert.strictEqual(ppv.shapes[0].height, 32);
  const arena = pc95.openBytes(fs.readFileSync(path.join(retail, 'ARENA.QPP')));
  assert.ok(arena && arena.shapes.length >= 1, 'ARENA.QPP unpacks');
  assert.ok(arena.palette, 'ARENA.QPP carries !pal');
  const cflag = pc95.openBytes(fs.readFileSync(path.join(retail, 'CFLAG.QPP')));
  assert.ok(cflag && cflag.shapes.length >= 1, 'CFLAG.QPP (46 FB) unpacks');
  const listed = pc95.catalogDirectory(retail);
  assert.ok(listed.spriteFiles.some((rel) => /000_049\.PPV$/i.test(rel)));
  assert.ok(listed.rinkFiles.some((rel) => /F000_049\.PPV$/i.test(rel)));
  assert.ok(listed.images.length >= 20, 'QPP pictures catalogued');
  assert.ok(listed.audio.songs.length >= 10, 'KMS songs catalogued');
  assert.ok(listed.audio.dig, 'PCFF DIG catalogued');
  const playoffs = listed.images.find((image) => /PLAYOFFS/i.test(image.id));
  assert.ok(playoffs && /EMBPAL/i.test(playoffs.palette || ''), '94 PLAYOFFS borrows EMBPAL');
  const rink = listed.images.find((image) => image.label === 'Ice rink');
  assert.ok(rink, '94 PC Ice rink from RINK.TIL / RINK.MAP');
  assert.strictEqual(rink.kind, 'pc-rink');
  assert.strictEqual(rink.rinkGame, 94);
  assert.ok(/RINKPAL/i.test(rink.palette || ''), 'Ice rink uses RINKPAL');
  assert.ok(rink.files.some((rel) => /\.TIL$/i.test(rel)) && rink.files.some((rel) => /\.MAP$/i.test(rel)));
  const til = fs.readFileSync(path.join(retail, rink.files.find((rel) => /\.TIL$/i.test(rel))));
  const map = fs.readFileSync(path.join(retail, rink.files.find((rel) => /\.MAP$/i.test(rel))));
  const pal = fs.readFileSync(path.join(retail, rink.palette));
  const pic = pc95.openRinkImage(til, map, pal, 94);
  assert.strictEqual(pic.numFrames, 1);
  const frame = pic.renderFrame(1);
  assert.strictEqual(frame.width, 384);
  assert.strictEqual(frame.height, 592);
  let ink = 0;
  for (let i = 0; i < frame.pixels.length; i++) if (frame.pixels[i] !== 255) ink++;
  assert.ok(ink > 100000, 'full rink is not empty (' + ink + ' pixels)');
  assert.ok(pc95.installReady(listed), '94 PC install is marked loaded');
  const Crests = require('../lib/pc-crests');
  const crests = pc95.openBytes(fs.readFileSync(path.join(retail, 'CRESTS4.QPP')));
  const bank = Crests.fromShapes(crests);
  assert.ok(bank.entries.length >= 24, '94 CRESTS4.QPP shapes');
  assert.ok(Crests.find(bank, 'BOS'));
}

console.log('pc94-shape: ok');
