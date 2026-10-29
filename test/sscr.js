const assert = require('assert');
const { pack94, unpack94, isPacked94, formatName } = require('../lib/snespak');
const { packSnesMapWord, packSnesTile } = require('../lib/sjim');
const { parseScreen94, encodeScreen94, encodeScreen94Zip, parseScreen94Zip, linearToPlanar, planarToLinear } = require('../lib/sscr');
const { classify } = require('../lib/open-asset');

function roundtrip(bytes, format, opts) {
  const packed = pack94(bytes, format, opts);
  assert.ok(isPacked94(packed), format + ' header');
  assert.strictEqual(formatName(packed[0] | (packed[1] << 8)), format);
  const back = unpack94(packed, 0);
  assert.deepStrictEqual(Buffer.from(back), Buffer.from(bytes), format + ' bytes');
  return packed;
}

const samples = [
  Buffer.alloc(0),
  Buffer.from([0]),
  Buffer.from([1, 2, 3, 4, 5, 6, 7]),
  Buffer.from([7, 7, 7, 7, 7, 7, 7, 7, 7, 7]),
  Buffer.from('the quick brown fox jumps over the lazy dog the quick brown fox'),
  Buffer.concat([Buffer.alloc(64, 0x11), Buffer.alloc(32, 0x22), Buffer.from([1, 2, 3])])
];
const rnd = Buffer.alloc(512);
for (let i = 0; i < rnd.length; i++) rnd[i] = (i * 37 + 11) & 255;
samples.push(rnd);

for (const sample of samples) {
  for (const format of ['rle', 'lz', 'huffman', 'pairs']) {
    roundtrip(sample, format);
  }
}

const words = Buffer.alloc(6 + 8 * 8 * 2);
words.writeUInt16LE(8, 0);
words.writeUInt16LE(8, 2);
words.writeUInt16LE(0x0308, 4);
words.writeUInt16LE(packSnesMapWord({ tile: 0, pal: 5, priority: 1, hFlip: 0, vFlip: 1 }), 6);
roundtrip(words, 'rle', { unit: 2 });

const tile = packSnesTile(Uint8Array.from({ length: 64 }, (_, i) => (i === 0 ? 3 : i === 1 ? 7 : 0)));
const tiles = Buffer.concat([Buffer.from(tile), Buffer.alloc(32)]);
roundtrip(tiles, 'huffman');

const linear = Buffer.alloc(32, 0);
linear[0] = 0x31;
const planar = linearToPlanar(linear);
const backLin = planarToLinear(planar);
assert.strictEqual(backLin[0], 0x31);

const pal = Buffer.alloc(256);
pal.writeUInt16LE(0x7fff, 2);
const doc = parseScreen94({
  tiles: tiles,
  map: words,
  pal: pal,
  fileNames: ['ProbeTiles.chr.huf', 'ProbeMap.map.rle']
}, { name: 'probe' });
assert.strictEqual(doc.variant, 'snes94');
assert.strictEqual(doc.platform, 'snes');
assert.strictEqual(doc.mapW, 8);
assert.strictEqual(doc.mapH, 8);
assert.strictEqual(doc.cells[0].pal, 5);
assert.strictEqual(doc.cells[0].priority, 1);
assert.strictEqual(doc.cells[0].vFlip, 1);
assert.strictEqual(doc.tiles[0][0], 3);
assert.strictEqual(doc.palettes[0][1].r5, 31);

doc.dirty = true;
const encoded = encodeScreen94(doc, { packed: true });
const byName = (re) => encoded.files.find((f) => re.test(f.name));
assert.ok(byName(/screen\.json/));
assert.match(byName(/ProbeTiles/).name, /ProbeTiles/);
assert.match(byName(/ProbeMap/).name, /ProbeMap/);
const again = parseScreen94({
  tiles: byName(/ProbeTiles/).data,
  map: byName(/ProbeMap/).data,
  pal: byName(/\.pal$/).data,
  fileNames: encoded.files.map((f) => f.name)
});
assert.strictEqual(again.cells[0].pal, 5);
assert.strictEqual(again.cells[0].priority, 1);
assert.strictEqual(again.tiles[0][0], 3);

const zipped = encodeScreen94Zip(doc, { packed: true });
const fromZip = parseScreen94Zip(zipped);
assert.strictEqual(fromZip.cells[0].vFlip, 1);
assert.strictEqual(fromZip.tiles[0][1], 7);
assert.ok(isPacked94(byName(/ProbeTiles/).data));
assert.strictEqual(classify('probe.snes94.zip', zipped).kind, 'snes94');
assert.strictEqual(classify('SetupBackTiles.chr.huf', byName(/ProbeTiles/).data).kind, 'snes94');

const rawOut = encodeScreen94(doc, { packed: false });
const rawByName = (re) => rawOut.files.find((f) => re.test(f.name));
assert.ok(!isPacked94(rawByName(/ProbeTiles/).data));
assert.ok(!isPacked94(rawByName(/ProbeMap/).data));

const linearTiles = Buffer.alloc(64);
linearTiles[0] = 0x31;
const linearMap = Buffer.alloc(6 + 8 * 8 * 2);
linearMap.writeUInt16LE(8, 0);
linearMap.writeUInt16LE(8, 2);
linearMap.writeUInt16LE(0x0308, 4);
const linearDoc = parseScreen94({
  tiles: linearTiles,
  map: linearMap,
  pal: pal,
  fileNames: ['EALogoTiles.lz', 'EALogoMap.map.huf']
}, { linear: true, name: 'easports.snes94.zip' });
assert.strictEqual(linearDoc.sscr.linear, true);
assert.strictEqual(linearDoc.tiles[0][0], 12);
assert.strictEqual(linearDoc.tiles[0][1], 4);
const linearZip = encodeScreen94Zip(linearDoc, { packed: true });
const linearBack = parseScreen94Zip(linearZip);
assert.strictEqual(linearBack.sscr.linear, true);
assert.strictEqual(linearBack.tiles[0][0], 12);
assert.strictEqual(linearBack.tiles[0][1], 4);

console.log('sscr: ok');
