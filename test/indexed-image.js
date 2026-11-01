'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { encodePng8, encodeBmp8, zlibStore } = require('../lib/indexed-image');
const { parseAnim, renderFrame } = require('../lib/anim');
const { picturePixelHidden } = require('../lib/jim');

function parseChunks(buf) {
  assert.deepStrictEqual(Array.from(buf.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    chunks.push({ type, data });
    i += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

function parsePng8(buf) {
  const chunks = parseChunks(Buffer.from(buf));
  const types = chunks.map((c) => c.type);
  assert.ok(types.includes('IHDR') && types.includes('PLTE') && types.includes('IDAT'));
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  assert.strictEqual(ihdr[8], 8, '8-bit');
  assert.strictEqual(ihdr[9], 3, 'indexed color type 3');
  const plte = chunks.find((c) => c.type === 'PLTE').data;
  assert.strictEqual(plte.length % 3, 0);
  const palette = [];
  for (let i = 0; i < plte.length; i += 3) palette.push([plte[i], plte[i + 1], plte[i + 2]]);
  const trnsChunk = chunks.find((c) => c.type === 'tRNS');
  const trns = trnsChunk ? Array.from(trnsChunk.data) : null;
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = zlib.inflateSync(idat);
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    assert.strictEqual(raw[y * (width + 1)], 0, 'filter 0');
    raw.copy(pixels, y * width, y * (width + 1) + 1, y * (width + 1) + 1 + width);
  }
  return { width, height, palette, trns, pixels };
}

function parseBmp8(buf) {
  const b = Buffer.from(buf);
  assert.strictEqual(b.toString('ascii', 0, 2), 'BM');
  const off = b.readUInt32LE(10);
  const width = b.readInt32LE(18);
  const height = b.readInt32LE(22);
  assert.ok(height < 0, 'top-down BMP');
  assert.strictEqual(b.readUInt16LE(28), 8);
  const h = -height;
  const stride = (width + 3) & ~3;
  const pixels = new Uint8Array(width * h);
  const palette = [];
  for (let i = 0; i < 256; i++) {
    const o = 54 + i * 4;
    palette.push([b[o + 2], b[o + 1], b[o]]);
  }
  for (let y = 0; y < h; y++) {
    b.copy(pixels, y * width, off + y * stride, off + y * stride + width);
  }
  return { width, height: h, palette, pixels };
}

{
  const pal = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [0, 0, 0]];
  const pix = Uint8Array.from([0, 1, 2, 0]);
  const png = encodePng8(2, 2, pix, pal, { transparent: 0 });
  const got = parsePng8(png);
  assert.strictEqual(got.width, 2);
  assert.strictEqual(got.height, 2);
  assert.deepStrictEqual(got.palette, pal);
  assert.deepStrictEqual(Array.from(got.pixels), [0, 1, 2, 0]);
  assert.strictEqual(got.trns[0], 0, 'index 0 is transparent');
  const bmp = parseBmp8(encodeBmp8(2, 2, pix, pal, { transparent: 0 }));
  assert.deepStrictEqual(Array.from(bmp.pixels), [0, 1, 2, 0]);
  assert.deepStrictEqual(bmp.palette.slice(0, 4), pal);
}

{
  const pal = [[10, 20, 30], [40, 50, 60]];
  const pix = new Uint8Array(3 * 1).fill(1);
  pix[0] = 0;
  const png = encodePng8(3, 1, pix, pal);
  const got = parsePng8(png);
  assert.strictEqual(got.trns, null, 'opaque PNG has no tRNS');
  assert.deepStrictEqual(Array.from(got.pixels), [0, 1, 1]);
}

{
  const packed = Uint8Array.from([1, 2, 3, 4, 5, 6]);
  const png = encodePng8(2, 1, Uint8Array.from([0, 1]), packed, { alpha: Uint8Array.from([255, 0]) });
  const got = parsePng8(png);
  assert.deepStrictEqual(got.palette, [[1, 2, 3], [4, 5, 6]]);
  assert.deepStrictEqual(got.trns, [255, 0]);
}

{
  const src = Uint8Array.from([1, 2, 3, 4, 5]);
  assert.deepStrictEqual(zlib.inflateSync(zlibStore(src)), Buffer.from(src));
  assert.deepStrictEqual(zlib.inflateSync(zlibStore(new Uint8Array(0))), Buffer.alloc(0));
}

{
  const root = path.join(__dirname, '..');
  const animPath = path.join(root, 'test/fixtures/ANIM-To-BMP/Sprites.anim');
  const anim = parseAnim(fs.readFileSync(animPath));
  const frame = renderFrame(anim, 1);
  const png = encodePng8(frame.width, frame.height, frame.pixels, anim.combined, { transparent: 0 });
  const got = parsePng8(png);
  assert.strictEqual(got.width, frame.width);
  assert.strictEqual(got.height, frame.height);
  assert.deepStrictEqual(Array.from(got.pixels), Array.from(frame.pixels));
  assert.deepStrictEqual(got.palette, anim.combined);
  assert.strictEqual(got.trns[0], 0);
  for (let i = 0; i < got.pixels.length; i++) {
    const idx = got.pixels[i];
    if (idx === 0) continue;
    assert.deepStrictEqual(got.palette[idx], anim.combined[idx]);
  }
  const bmp = parseBmp8(encodeBmp8(frame.width, frame.height, frame.pixels, anim.combined));
  assert.deepStrictEqual(Array.from(bmp.pixels), Array.from(frame.pixels));
}

{
  const holes = [];
  for (let i = 0; i < 64; i++) if (picturePixelHidden(i)) holes.push(i);
  assert.deepStrictEqual(holes, [16, 32, 48]);
  const pal = [];
  for (let i = 0; i < 64; i++) pal.push([i, 0, 64 - i]);
  const pix = Uint8Array.from([1, 16, 17, 32]);
  const png = encodePng8(2, 2, pix, pal, { transparent: holes });
  const got = parsePng8(png);
  assert.strictEqual(got.trns[16], 0);
  assert.strictEqual(got.trns[32], 0);
  assert.strictEqual(got.trns[0], 255);
}

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert.ok(html.includes('lib/indexed-image.js'), 'index.html loads indexed-image.js');
assert.ok(html.includes('palette is stored'), 'Export frame mentions the embedded palette');
const jed = fs.readFileSync(path.join(__dirname, '../public/jed.html'), 'utf8');
assert.ok(jed.includes('lib/indexed-image.js'), 'jed.html loads indexed-image.js');
const viewer = fs.readFileSync(path.join(__dirname, '../public/viewer.js'), 'utf8');
assert.ok(viewer.includes('indexedPng') && viewer.includes('NhlIndexedImage'), 'viewer exports indexed PNG');
assert.ok(!/canvasPng/.test(viewer), 'viewer no longer flattens export through canvas.toBlob');
const ice = fs.readFileSync(path.join(__dirname, '../public/ice.js'), 'utf8');
assert.ok(ice.includes('NhlIndexedImage.encodePng8'), 'ice logo/rink PNG keeps indices');
const crest = fs.readFileSync(path.join(__dirname, '../public/jed.js'), 'utf8');
assert.ok(crest.includes('NhlIndexedImage.encodePng8'), 'crest PNG keeps indices');

console.log('indexed-image: ok');
