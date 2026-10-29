const assert = require('assert');
const {
  parseSjim, encodeSjim, unpackSnesMapWord, packSnesMapWord,
  unpackSnesTile, packSnesTile, isSjimName
} = require('../lib/sjim');
const { compressBytecode, decompressBytecode, rasterize, cloneJim } = require('../lib/jim');
const { classify } = require('../lib/open-asset');

{
  const bits = { tile: 0x3ff, pal: 7, priority: 1, hFlip: 1, vFlip: 1 };
  assert.strictEqual(packSnesMapWord(bits), 0xffff);
  assert.deepStrictEqual(unpackSnesMapWord(0xffff), bits);
  assert.strictEqual(unpackSnesMapWord(0x4000).hFlip, 1);
  assert.strictEqual(unpackSnesMapWord(0x8000).vFlip, 1);
  assert.strictEqual(unpackSnesMapWord(0x2000).priority, 1);
  assert.strictEqual(unpackSnesMapWord(0x1c00).pal, 7);
}

{
  const nibbles = new Uint8Array(64);
  nibbles[0] = 0xa;
  nibbles[1] = 0xb;
  nibbles[63] = 0xc;
  const packed = packSnesTile(nibbles);
  assert.strictEqual(packed.length, 32);
  const back = unpackSnesTile(packed, 0);
  assert.deepStrictEqual(Array.from(back), Array.from(nibbles));
}

{
  const mapW = 2;
  const mapH = 1;
  const palBytes = 256;
  const tiles = [packSnesTile(Uint8Array.from({ length: 64 }, (_, i) => (i === 0 ? 3 : 0)))];
  const unpacked = new Uint8Array(mapW * mapH * 2 + palBytes + 32);
  const view = new DataView(unpacked.buffer);
  view.setUint16(0, packSnesMapWord({ tile: 0, pal: 2, priority: 1, hFlip: 1, vFlip: 0 }), true);
  view.setUint16(2, packSnesMapWord({ tile: 0, pal: 0, priority: 0, hFlip: 0, vFlip: 1 }), true);
  view.setUint16(mapW * mapH * 2 + 2, 0x7fff, true); // pal 0 color 1 white-ish
  unpacked.set(tiles[0], mapW * mapH * 2 + palBytes);
  const packed = compressBytecode(unpacked);
  const doc = parseSjim(packed, null, {
    name: 'test.map.sjim',
    layout: { mapW: mapW, mapH: mapH, mapSize: 4, pal: 4, tiles: 4 + palBytes, palBytes: palBytes }
  });
  assert.strictEqual(doc.platform, 'snes');
  assert.strictEqual(doc.variant, 'sjim');
  assert.strictEqual(doc.tiles.length, 1);
  assert.strictEqual(doc.cells[0].hFlip, 1);
  assert.strictEqual(doc.cells[0].pal, 2);
  assert.strictEqual(doc.cells[0].priority, 1);
  assert.strictEqual(doc.cells[1].vFlip, 1);
  assert.strictEqual(doc.tiles[0][0], 3);
  doc.dirty = true;
  const out = encodeSjim(doc, { force: true });
  const again = parseSjim(out, null, { name: 'test.map.sjim', layout: doc.sjim });
  assert.deepStrictEqual(again.cells, doc.cells);
  assert.deepStrictEqual(Array.from(again.tiles[0]), Array.from(doc.tiles[0]));
  const unpackedOut = decompressBytecode(out, 0);
  assert.deepStrictEqual(Array.from(unpackedOut.subarray(0, 4)), Array.from(unpacked.subarray(0, 4)));

  doc.cells[0].pal = 5;
  doc.cells[0].hFlip = 0;
  doc.cells[0].vFlip = 0;
  doc.tiles[0][0] = 3;
  const drawn = rasterize(doc);
  assert.strictEqual(drawn.pixels[0], 5 * 16 + 3);
  assert.strictEqual(drawn.colors.length, 128);
  const cloned = cloneJim(doc);
  assert.strictEqual(cloned.platform, 'snes');
  assert.strictEqual(cloned.palettes[0][1].r5, doc.palettes[0][1].r5);
}

{
  const mapW = 8, mapH = 8, palBytes = 256;
  const unpacked = new Uint8Array(mapW * mapH * 2 + palBytes + 32);
  const view = new DataView(unpacked.buffer);
  view.setUint16(0, packSnesMapWord({ tile: 0, pal: 5, priority: 1, hFlip: 0, vFlip: 0 }), true);
  unpacked.set(packSnesTile(Uint8Array.from({ length: 64 }, (_, i) => (i === 0 ? 3 : 0))), mapW * mapH * 2 + palBytes);
  const doc = parseSjim(compressBytecode(unpacked), null, { name: 'probe.map.sjim' });
  assert.strictEqual(doc.mapW, 8);
  assert.strictEqual(doc.mapH, 8);
  assert.strictEqual(doc.tiles.length, 1);
  assert.strictEqual(doc.sjim.palBytes, 256);
  assert.strictEqual(doc.cells[0].pal, 5);
}

assert.ok(isSjimName('Title1.map.sjim'));
assert.ok(!isSjimName('Title1.map.jim'));
assert.strictEqual(classify('Title1.map.sjim', Buffer.alloc(4)).kind, 'sjim');

console.log('sjim: ok');
