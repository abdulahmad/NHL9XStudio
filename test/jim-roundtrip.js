const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  decodeJim, parseJim, encodeJim, unpackMapWord, packMapWord, unpackTile, packTile,
  compressBytecode, decompressBytecode, transformBlock, grabBlock, stampBlock, cloneJim,
  encodeCramWord, decodeCramWord, encodePaletteLine, packPortrait, unpackPortrait,
  matchTile, collapseDuplicateTiles, parsePaletteFile, applyDonorPalette, flippedTile, rasterize,
  paintMapNibble
} = require('../lib/jim');
const { classify } = require('../lib/open-asset');

function word(tile, h, v, pal, pri) {
  return packMapWord({ tile, hFlip: h, vFlip: v, pal, priority: pri });
}

{
  const bits = { tile: 0x7ff, hFlip: 1, vFlip: 1, pal: 3, priority: 1 };
  assert.strictEqual(packMapWord(bits), 0xffff);
  assert.deepStrictEqual(unpackMapWord(0xffff), bits);
  assert.strictEqual(packMapWord({ tile: 0, hFlip: 0, vFlip: 0, pal: 0, priority: 1 }), 0x8000);
  assert.deepStrictEqual(unpackMapWord(0xA800), { tile: 0, hFlip: 1, vFlip: 0, pal: 1, priority: 1 });
}

function rawJim({ tiles, pal, mapW, mapH, cells, palettes }) {
  const palOff = 10 + tiles * 32;
  const mapOff = palOff + 128;
  const out = Buffer.alloc(mapOff + 4 + mapW * mapH * 2);
  out.writeUInt32BE(palOff, 0);
  out.writeUInt32BE(mapOff, 4);
  out.writeUInt16BE(tiles, 8);
  if (pal) pal.copy(out, palOff);
  out.writeUInt16BE(mapW, mapOff);
  out.writeUInt16BE(mapH, mapOff + 2);
  for (let i = 0; i < cells.length; i++) out.writeUInt16BE(cells[i], mapOff + 4 + i * 2);
  return out;
}

{
  const pal = Buffer.alloc(128);
  pal.writeUInt16BE(0x0EEE, 2); // pal 0 color 1: white-ish
  const cells = [word(0, 1, 1, 2, 1)];
  const bytes = rawJim({ tiles: 1, mapW: 1, mapH: 1, cells, palettes: pal });
  bytes[10] = 0x10;
  pal.copy(bytes, 10 + 32);
  const parsed = parseJim(bytes);
  assert.strictEqual(parsed.tiles.length, 1);
  assert.deepStrictEqual(parsed.cells[0], { tile: 0, hFlip: 1, vFlip: 1, pal: 2, priority: 1 });
  const back = encodeJim(parsed, { packed: false });
  assert.deepStrictEqual(Buffer.from(back), bytes);
  const pic = decodeJim(bytes);
  // H+V flip samples the opposite corner of the tile (nibble 0), pal 2.
  assert.strictEqual(pic.renderFrame(1).pixels[0], 2 * 16);
}

{
  const buf = Buffer.alloc(16);
  buf.writeUInt32BE(0x000004c4, 0);
  assert.notStrictEqual(classify('anon.bin', buf).kind, 'jim');
  assert.strictEqual(classify('IceRink.map.jim', buf).kind, 'jim');
  assert.strictEqual(classify('title.jim', buf).kind, 'jim');
}

{
  const src = rawJim({
    tiles: 1, mapW: 2, mapH: 1,
    cells: [word(0, 1, 0, 0, 0), word(0, 0, 0, 1, 1)],
    palettes: Buffer.alloc(128)
  });
  src[10] = 0x10; // nibble at (0,0) = 1, so 90° is a different stamp
  const doc = parseJim(src);
  const before = doc.tiles.length;
  const block = grabBlock(doc, { x: 0, y: 0, w: 2, h: 1 });
  const flipped = transformBlock(doc, block, '180');
  assert.strictEqual(doc.tiles.length, before, '180 must not add tiles');
  assert.strictEqual(flipped.cells[0].hFlip, 1);
  assert.strictEqual(flipped.cells[0].vFlip, 1);
  assert.strictEqual(flipped.cells[0].priority, 1);
  assert.strictEqual(flipped.cells[1].hFlip, 0);
  assert.strictEqual(flipped.cells[1].vFlip, 1);
  const rotated = transformBlock(doc, block, '90');
  assert.ok(doc.tiles.length > before, '90 adds a tile');
  assert.strictEqual(rotated.w, 1);
  assert.strictEqual(rotated.h, 2);
  assert.strictEqual(rotated.cells[0].hFlip, 0);
  assert.strictEqual(rotated.cells[0].vFlip, 0);
  stampBlock(doc, rotated, 0, 0);
}

{
  const doc = parseJim(rawJim({
    tiles: 1, mapW: 1, mapH: 1, cells: [0], palettes: Buffer.alloc(128)
  }));
  doc.tiles[0][0] = 3;
  const flipped = flippedTile(doc.tiles[0], true, false);
  const hit = matchTile(doc.tiles, flipped);
  assert.deepStrictEqual(hit, { tile: 0, hFlip: 1, vFlip: 0 });
  const miss = matchTile(doc.tiles, Uint8Array.from({ length: 64 }, (_, i) => i ? 0 : 7));
  assert.strictEqual(miss, null);
}

{
  const doc = parseJim(rawJim({
    tiles: 1, mapW: 1, mapH: 1, cells: [0], palettes: Buffer.alloc(128)
  }));
  const donor = Buffer.alloc(128);
  donor.writeUInt16BE(0x0EEE, 2);
  applyDonorPalette(doc, donor);
  const pic = rasterize(doc);
  assert.ok(pic.colors[1][0] > 200 && pic.colors[1][1] > 200 && pic.colors[1][2] > 200);
}

{
  const fixture = path.join(__dirname, 'fixtures', 'JIM-Tools', 'ronbarr.map.jzip');
  const file = fs.readFileSync(fixture);
  const parsed = parseJim(file);
  assert.strictEqual(parsed.packedOnDisk, true);
  assert.strictEqual(parsed.tiles.length, 61);
  const raw = encodeJim(parsed, { packed: false });
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  assert.strictEqual(view.getUint16(8) & 0x8000, 0);
  const again = parseJim(raw);
  assert.deepStrictEqual(again.cells, parsed.cells);
  assert.deepStrictEqual(Array.from(again.tiles[0]), Array.from(parsed.tiles[0]));
  const a = decodeJim(file).renderFrame(1);
  const b = decodeJim(raw).renderFrame(1);
  assert.deepStrictEqual(Array.from(a.pixels), Array.from(b.pixels));
  const packed = encodeJim(parsed, { packed: true });
  const packedView = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  assert.ok(packedView.getUint16(8) & 0x8000);
  const unpacked = decompressBytecode(packed, 10, 61 * 32);
  const origTiles = decompressBytecode(file, 10, 61 * 32);
  assert.deepStrictEqual(Array.from(unpacked), Array.from(origTiles));
}

{
  const doc = parseJim(rawJim({
    tiles: 1, mapW: 1, mapH: 1, cells: [0], palettes: Buffer.alloc(128)
  }));
  const packed = encodeJim(cloneJim(doc), { packed: true });
  const raw = packTilesForTest(doc);
  assert.deepStrictEqual(Array.from(decompressBytecode(packed, 10, 32)), Array.from(raw));
}

function packTilesForTest(doc) {
  const out = new Uint8Array(doc.tiles.length * 32);
  const { packTile } = require('../lib/jim');
  doc.tiles.forEach((t, i) => out.set(packTile(t), i * 32));
  return out;
}

assert.strictEqual(typeof compressBytecode, 'function');

// Every name-table bit round-trips, including priority on its own.
for (let bit = 0; bit < 16; bit++) {
  const bits = 1 << bit;
  assert.strictEqual(packMapWord(unpackMapWord(bits)), bits, 'bit ' + bit);
}
assert.strictEqual(unpackMapWord(0x8000).priority, 1);
assert.strictEqual(unpackMapWord(0x8000).tile, 0);
assert.strictEqual(encodeCramWord({ r3: 1, g3: 2, b3: 3 }), (3 << 9) | (2 << 5) | (1 << 1));
assert.deepStrictEqual(decodeCramWord(encodeCramWord({ r3: 7, g3: 0, b3: 1 })), { r3: 7, g3: 0, b3: 1 });
const line = encodePaletteLine(Array.from({ length: 16 }, (_, i) => ({ r3: i & 7, g3: 1, b3: 2 })));
assert.strictEqual(line.length, 32);
assert.strictEqual(line.readUInt16BE ? line.readUInt16BE(0) : (line[0] << 8) | line[1], (2 << 9) | (1 << 5));

// Priority-only cells, no palette, logo (palOff === mapOff), and a zero header.
{
  const pal = Buffer.alloc(128);
  pal.writeUInt16BE((3 << 9) | (2 << 5) | (1 << 1), 0);
  const bytes = rawJim({
    tiles: 1, mapW: 2, mapH: 1,
    cells: [word(0, 0, 0, 0, 0), word(0, 0, 0, 0, 1)],
    palettes: pal
  });
  pal.copy(bytes, 10 + 32);
  bytes[10] = 0x10;
  const doc = parseJim(bytes);
  assert.deepStrictEqual(doc.cells.map((c) => c.priority), [0, 1]);
  assert.deepStrictEqual(Buffer.from(encodeJim(doc)), bytes);
  const px = decodeJim(bytes).renderFrame(1).pixels;
  assert.strictEqual(px[0], 1);
  assert.strictEqual(px[8], 1);
}

{
  const mapOff = 42;
  const nopal = Buffer.alloc(mapOff + 6);
  nopal.writeUInt32BE(0xffffffff, 0);
  nopal.writeUInt32BE(mapOff, 4);
  nopal.writeUInt16BE(1, 8);
  nopal[10] = 0x20;
  nopal.writeUInt16BE(1, mapOff);
  nopal.writeUInt16BE(1, mapOff + 2);
  nopal.writeUInt16BE(0x8000, mapOff + 4);
  const doc = parseJim(nopal);
  assert.strictEqual(doc.variant, 'nopal');
  assert.strictEqual(doc.cells[0].priority, 1);
  assert.deepStrictEqual(Buffer.from(encodeJim(doc)), nopal);
}

{
  const body = Buffer.alloc(32 + 6);
  body[0] = 0x30;
  body.writeUInt16BE(1, 32);
  body.writeUInt16BE(1, 34);
  body.writeUInt16BE(0x0800, 36);
  const logo = Buffer.alloc(10 + body.length);
  logo.writeUInt32BE(42, 0);
  logo.writeUInt32BE(42, 4);
  logo.writeUInt16BE(1, 8);
  body.copy(logo, 10);
  const doc = parseJim(logo);
  assert.strictEqual(doc.variant, 'logo');
  assert.strictEqual(doc.cells[0].hFlip, 1);
  const back = encodeJim(doc);
  assert.strictEqual(new DataView(back.buffer, back.byteOffset, back.byteLength).getUint32(0), 42);
  assert.strictEqual(new DataView(back.buffer, back.byteOffset, back.byteLength).getUint32(4), 42);
  assert.deepStrictEqual(Buffer.from(back), logo);
}

{
  const tiles = Buffer.alloc(24 * 32);
  tiles[0] = 0x10;
  const sheet = Buffer.alloc(10 + tiles.length);
  sheet.writeUInt16BE(24, 8);
  tiles.copy(sheet, 10);
  const doc = parseJim(sheet);
  assert.strictEqual(doc.variant, 'sheet');
  assert.strictEqual(doc.mapW, 8);
  assert.strictEqual(decodeJim(sheet).renderFrame(1).pixels[0], 1);
  assert.deepStrictEqual(Buffer.from(encodeJim(doc)), sheet);
  const shared = cloneJim(doc);
  shared.variant = 'shared';
  assert.deepStrictEqual(Buffer.from(encodeJim(shared)), sheet);
}

{
  const portrait = Buffer.alloc(10 + 36 * 24);
  portrait.writeUInt16BE(36, 8);
  const doc = parseJim(portrait);
  assert.strictEqual(doc.variant, 'portrait');
  assert.strictEqual(doc.readOnly, false);
  assert.strictEqual(decodeJim(portrait).renderFrame(1).width, 48);
  assert.deepStrictEqual(Buffer.from(encodeJim(doc)), portrait);
  doc.tiles[0][0] = 9;
  doc.dirty = true;
  const packed = encodeJim(doc);
  const again = parseJim(packed);
  assert.strictEqual(again.variant, 'portrait');
  assert.strictEqual(again.tiles[0][0], 9);
  const rows = packPortrait(doc.tiles);
  const backTiles = unpackPortrait(rows, 0, doc.tiles.length);
  assert.strictEqual((backTiles[0] >> 4) & 15, 9);
  doc.tiles[0][1] = 0;
  const clamped = packPortrait(doc.tiles);
  const clampedBack = unpackPortrait(clamped, 0, doc.tiles.length);
  assert.strictEqual(clampedBack[0] & 15, 5);
}

{
  const nibbles = unpackTile(Uint8Array.from([0xab, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xcd]));
  assert.strictEqual(nibbles[0], 0xa);
  assert.strictEqual(nibbles[1], 0xb);
  assert.strictEqual(nibbles[63], 0xd);
  assert.strictEqual(packTile(nibbles)[0], 0xab);
  assert.strictEqual(packTile(nibbles)[31], 0xcd);
}

{
  const prefix = Uint8Array.from([0x00, 0x00, 0x04, 0xc4]);
  assert.notStrictEqual(classify('', prefix).kind, 'jim');
  assert.notStrictEqual(classify('ronbarr.map.jzip', prefix).kind, 'jim');
  assert.strictEqual(classify('RonBarr.map.jim', prefix).kind, 'jim');
  assert.strictEqual(classify('Title1.map.sjim', prefix).kind, 'sjim');
  assert.notStrictEqual(classify('Title1.map.sjim', prefix).kind, 'jim');
  const packed94 = Uint8Array.from([0x7a, 0xfb, 0, 0, 1, 1, 1, 0xff, 0, 0]);
  assert.strictEqual(classify('SetupBackTiles.chr.huf', packed94).kind, 'snes94');
  assert.notStrictEqual(classify('x.bin', Uint8Array.from([0x4a, 0x49, 0, 0])).kind, 'jim');
}

{
  const doc = parseJim(rawJim({ tiles: 1, mapW: 1, mapH: 1, cells: [word(0, 1, 0, 1, 1)], palettes: Buffer.alloc(128) }));
  doc.tiles[0][0] = 4;
  const before = doc.tiles.length;
  const spun = transformBlock(doc, { x: 0, y: 0, w: 1, h: 1 }, '180');
  assert.strictEqual(doc.tiles.length, before);
  assert.strictEqual(spun.cells[0].hFlip, 0);
  assert.strictEqual(spun.cells[0].vFlip, 1);
  assert.strictEqual(spun.cells[0].pal, 1);
  assert.strictEqual(spun.cells[0].priority, 1);
  const turned = transformBlock(doc, { w: 1, h: 1, cells: [{ tile: 0, hFlip: 1, vFlip: 0, pal: 2, priority: 1 }] }, '90');
  assert.strictEqual(doc.tiles.length, before + 1);
  assert.strictEqual(turned.cells[0].hFlip, 0);
  assert.strictEqual(turned.cells[0].vFlip, 0);
  assert.strictEqual(turned.cells[0].pal, 2);
  assert.strictEqual(turned.cells[0].priority, 1);
  assert.ok(doc.dirty);
}

{
  const a = new Uint8Array(64);
  a[0] = 3;
  const mirror = flippedTile(a, true, false);
  const unique = new Uint8Array(64);
  unique[1] = 7;
  const r = collapseDuplicateTiles([a, mirror, unique], [
    { tile: 0, hFlip: 0, vFlip: 0, pal: 1, priority: 1 },
    { tile: 1, hFlip: 0, vFlip: 0, pal: 2, priority: 0 },
    { tile: 2, hFlip: 1, vFlip: 0, pal: 0, priority: 0 }
  ]);
  assert.strictEqual(r.removed, 1);
  assert.strictEqual(r.tiles.length, 2);
  assert.strictEqual(r.cells[0].tile, 0);
  assert.strictEqual(r.cells[0].hFlip, 0);
  assert.strictEqual(r.cells[0].priority, 1);
  assert.strictEqual(r.cells[1].tile, 0);
  assert.strictEqual(r.cells[1].hFlip, 1);
  assert.strictEqual(r.cells[1].pal, 2);
  assert.strictEqual(r.cells[2].tile, 1);
  assert.strictEqual(r.cells[2].hFlip, 1);
}

{
  const fill = new Uint8Array(64);
  fill.fill(2);
  const doc = {
    tiles: [Uint8Array.from(fill)],
    cells: [
      { tile: 0, hFlip: 0, vFlip: 0, pal: 1, priority: 0 },
      { tile: 0, hFlip: 0, vFlip: 0, pal: 1, priority: 0 }
    ],
    dirtyTiles: false,
    dirtyMap: false
  };
  const hit = paintMapNibble(doc, 0, 3, 4, 7, { pal: 1 });
  assert.strictEqual(hit.copied, true);
  assert.strictEqual(doc.cells[0].tile, 1);
  assert.strictEqual(doc.cells[0].hFlip, 0);
  assert.strictEqual(doc.cells[1].tile, 0);
  assert.strictEqual(doc.tiles[0][4 * 8 + 3], 2);
  assert.strictEqual(doc.tiles[1][4 * 8 + 3], 7);
  assert.strictEqual(doc.tiles.length, 2);
}

{
  const t = new Uint8Array(64);
  t[0] = 1;
  t[7] = 4;
  const doc = {
    tiles: [Uint8Array.from(t)],
    cells: [
      { tile: 0, hFlip: 0, vFlip: 0, pal: 0, priority: 0 },
      { tile: 0, hFlip: 1, vFlip: 0, pal: 0, priority: 0 }
    ],
    dirtyTiles: false,
    dirtyMap: false
  };
  const hit = paintMapNibble(doc, 1, 0, 0, 9);
  assert.strictEqual(hit.copied, true);
  assert.strictEqual(doc.cells[1].tile, 1);
  assert.strictEqual(doc.cells[1].hFlip, 0);
  assert.strictEqual(doc.cells[1].vFlip, 0);
  assert.strictEqual(doc.tiles[1][0], 9);
  assert.strictEqual(doc.tiles[0][0], 1);
  assert.strictEqual(doc.tiles[0][7], 4);
}

{
  const t = new Uint8Array(64);
  t[5] = 3;
  const doc = {
    tiles: [Uint8Array.from(t)],
    cells: [{ tile: 0, hFlip: 0, vFlip: 0, pal: 2, priority: 0 }],
    dirtyTiles: false,
    dirtyMap: false
  };
  const hit = paintMapNibble(doc, 0, 5, 0, 6);
  assert.strictEqual(hit.copied, false);
  assert.strictEqual(doc.cells[0].tile, 0);
  assert.strictEqual(doc.tiles.length, 1);
  assert.strictEqual(doc.tiles[0][5], 6);
}

{
  const shared = new Uint8Array(64);
  shared[0] = 3;
  const doc = {
    tiles: [shared, shared],
    cells: [
      { tile: 0, hFlip: 0, vFlip: 0, pal: 0, priority: 0 },
      { tile: 1, hFlip: 0, vFlip: 0, pal: 1, priority: 0 }
    ],
    dirtyTiles: false,
    dirtyMap: false
  };
  const hit = paintMapNibble(doc, 0, 0, 0, 8);
  assert.strictEqual(hit.copied, true);
  assert.strictEqual(doc.cells[0].tile, 2);
  assert.strictEqual(doc.tiles[2][0], 8);
  assert.strictEqual(doc.tiles[1][0], 3);
  assert.strictEqual(shared[0], 3);
}

{
  const fill = new Uint8Array(64);
  const doc = {
    tiles: [fill, Uint8Array.from(fill)],
    cells: [
      { tile: 0, hFlip: 0, vFlip: 0, pal: 0, priority: 0 },
      { tile: 0, hFlip: 0, vFlip: 0, pal: 0, priority: 0 }
    ]
  };
  const hit = paintMapNibble(doc, 0, 1, 1, 4, { tileCap: 2 });
  assert.ok(hit.error);
  assert.strictEqual(hit.copied, false);
  assert.strictEqual(doc.cells[0].tile, 0);
  assert.strictEqual(doc.tiles[0][9], 0);
  assert.strictEqual(doc.tiles.length, 2);
}

{
  const fill = new Uint8Array(64);
  fill.fill(2);
  const doc = {
    tiles: [Uint8Array.from(fill)],
    cells: [
      { tile: 0, hFlip: 0, vFlip: 0, pal: 2, priority: 0 },
      { tile: 0, hFlip: 1, vFlip: 0, pal: 0, priority: 0 }
    ]
  };
  const hit = paintMapNibble(doc, 0, 3, 4, 7, { pal: 0 });
  assert.strictEqual(hit.copied, true);
  assert.strictEqual(doc.cells[0].pal, 2, 'paint does not retarget the cell palette');
  assert.strictEqual(doc.cells[0].hFlip, 0);
  assert.strictEqual(doc.cells[1].tile, 0);
  assert.strictEqual(doc.cells[1].pal, 0);
  assert.strictEqual(doc.cells[1].hFlip, 1);
  assert.strictEqual(doc.tiles[0][4 * 8 + 3], 2);
  assert.strictEqual(doc.tiles[1][4 * 8 + 3], 7);
}

{
  const genesisPal = fs.readFileSync(path.join(__dirname, '..', 'data', 'pals', 'genesis', 'Bruinsh.pal'));
  const g = parsePaletteFile(genesisPal, 'Bruinsh.pal');
  assert.strictEqual(g.format, 'cram');
  assert.strictEqual(g.lines.length, 1);
  assert.strictEqual(g.lines[0][0].r3, 4);
  assert.strictEqual(g.lines[0][0].g3, 7);
  assert.strictEqual(g.lines[0][0].b3, 7);

  const teamSnes = fs.readFileSync(path.join(__dirname, '..', 'data', 'pals', 'snes', 'BOSh.snespal'));
  const t = parsePaletteFile(teamSnes, 'BOSh.snespal');
  assert.strictEqual(t.format, 'snes-team');
  assert.strictEqual(t.lines.length, 1);
  assert.ok(t.lines[0][0].r5 > 0 && t.lines[0][0].g5 > 20);

  const rink = fs.readFileSync(path.join(__dirname, '..', 'data', 'pals', 'snes', 'Rink.snespal'));
  const rnk = parsePaletteFile(rink, 'Rink.snespal');
  assert.strictEqual(rnk.format, 'snes-bgr555');
  assert.strictEqual(rnk.lines.length, 8);

  const act = Buffer.alloc(768);
  for (let i = 0; i < 16; i++) { act[i * 3] = 240; act[i * 3 + 1] = 32; act[i * 3 + 2] = 32; }
  for (let i = 16; i < 32; i++) { act[i * 3] = 32; act[i * 3 + 1] = 32; act[i * 3 + 2] = 240; }
  const a = parsePaletteFile(act, 'two.act');
  assert.strictEqual(a.format, 'act');
  assert.strictEqual(a.lines.length, 2, 'trailing empty ACT lines are dropped');
  assert.ok(a.lines[0][0].r3 >= 6);
  assert.ok(a.lines[1][0].b3 >= 6);

  const jasc = Buffer.from('JASC-PAL\n0100\n16\n255 0 0\n0 255 0\n0 0 255\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n0 0 0\n');
  const j = parsePaletteFile(jasc, 'paint.pal');
  assert.strictEqual(j.format, 'jasc');
  assert.strictEqual(j.lines.length, 1);
  assert.ok(j.lines[0][0].r3 >= 6);
}

console.log('jim-roundtrip: ok');
