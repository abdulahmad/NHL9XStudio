const assert = require('assert');
const Q = require('../lib/genesis-quantize');

function image(width, height, pixel) {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = pixel(x, y);
      const at = (y * width + x) * 4;
      out.set(value.length === 4 ? value : value.concat(255), at);
    }
  }
  return out;
}

function key(color) {
  return (color.r3 << 6) | (color.g3 << 3) | color.b3;
}

function outputPixel(result, width, x, y) {
  return Array.from(result.rgbaOut.slice(
    (y * width + x) * 4, (y * width + x) * 4 + 4));
}

// Alpha below the threshold is a hole: local index zero and alpha zero.
{
  const source = Uint8Array.from([
    255, 20, 30, 127,
    Q.expandChannel(3), Q.expandChannel(4), Q.expandChannel(5), 200
  ]);
  const result = Q.quantize(source, 2, 1);
  assert.strictEqual(result.indexed[0], 0);
  assert.strictEqual(result.tiles[0].nibbles[0], 0);
  assert.deepStrictEqual(outputPixel(result, 2, 0, 0), [0, 0, 0, 0]);
  assert.strictEqual(result.rgbaOut[7], 200, 'opaque source alpha is preserved');
}

// A locked line comes from its corresponding 16-color ACT band, is snapped
// with expandChannel's true inverse, and cannot be rewritten by assignment.
{
  const act = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    act[i * 3] = (i * 19 + 1) & 255;
    act[i * 3 + 1] = (i * 37 + 2) & 255;
    act[i * 3 + 2] = (i * 61 + 3) & 255;
  }
  const source = image(8, 8, (x, y) =>
    [(x * 31) & 255, (y * 43) & 255, ((x + y) * 29) & 255, 255]);
  const result = Q.quantize(source, 8, 8, {
    pals: [1],
    act,
    lockedLines: [true, false, false, false]
  });
  for (let i = 0; i < 16; i++) {
    assert.deepStrictEqual(result.palettes[0][i], {
      r3: Q.encodeChannel(act[i * 3]),
      g3: Q.encodeChannel(act[i * 3 + 1]),
      b3: Q.encodeChannel(act[i * 3 + 2])
    });
  }
  assert(result.warnings.some((warning) => /Locked ACT line 0/.test(warning)));
}

// Every emitted palette channel is native 3-bit data.
{
  const source = image(19, 11, (x, y) =>
    [(x * 29 + y * 3) & 255, (y * 41 + x * 7) & 255,
      (x * 13 + y * 53) & 255, 255]);
  const result = Q.quantize(source, 19, 11, { pals: [0, 1, 2] });
  for (const line of result.palettes) {
    for (const color of line) {
      assert(Number.isInteger(color.r3) && color.r3 >= 0 && color.r3 <= 7);
      assert(Number.isInteger(color.g3) && color.g3 >= 0 && color.g3 <= 7);
      assert(Number.isInteger(color.b3) && color.b3 >= 0 && color.b3 <= 7);
    }
  }
}

// Uniform/no-dither preserves a color already on the Genesis lattice exactly.
{
  const exact = [Q.expandChannel(2), Q.expandChannel(6), Q.expandChannel(4), 255];
  const source = image(8, 8, () => exact);
  const result = Q.quantize(source, 8, 8, {
    stepA: { method: 'uniform', dither: 'none' },
    stepB: { method: 'uniform', dither: 'none' }
  });
  assert.deepStrictEqual(outputPixel(result, 8, 3, 4), exact);
}

// Zero-strength Floyd-Steinberg is exactly equivalent to no dithering.
{
  const source = image(16, 8, (x, y) =>
    [x * 16, y * 31, (x * 17 + y * 9) & 255, 255]);
  const none = Q.quantize(source, 16, 8, {
    pals: [0, 1],
    stepA: { method: 'uniform', dither: 'none' },
    stepB: { method: 'adaptive', dither: 'none' }
  });
  const zero = Q.quantize(source, 16, 8, {
    pals: [0, 1],
    stepA: { method: 'uniform', dither: 'diffusion', strength: 0 },
    stepB: { method: 'adaptive', dither: 'diffusion', strength: 0 }
  });
  assert.deepStrictEqual(zero, none);
}

// Noise uses a coordinate hash and seed, never Math.random.
{
  const source = image(17, 9, (x, y) =>
    [(x * 37 + y) & 255, (y * 53 + x * 2) & 255, (x * y * 11) & 255, 255]);
  const options = {
    pals: [0, 1],
    seed: 1994,
    stepA: { method: 'uniform', dither: 'noise', strength: 70 },
    stepB: { method: 'weighted-kmeans', dither: 'noise', strength: 35 }
  };
  assert.deepStrictEqual(
    Q.quantize(source, 17, 9, options),
    Q.quantize(source, 17, 9, options)
  );
}

// Sixteen gradient colors cannot all fit in one 15-ink line, so the two tiles
// use two palettes. Seam copying puts both edge CRAM colors in both lines,
// keeping each edge pixel at its exact snapped RGB across the palette switch.
{
  const source = image(16, 8, (x) => {
    const r3 = x & 7;
    const g3 = (x >> 1) & 7;
    const b3 = x < 8 ? 1 : 6;
    return [Q.expandChannel(r3), Q.expandChannel(g3), Q.expandChannel(b3), 255];
  });
  const result = Q.quantize(source, 16, 8, {
    pals: [0, 1],
    stepA: { method: 'uniform', dither: 'none' },
    stepB: { method: 'adaptive', dither: 'none' }
  });
  assert.deepStrictEqual(result.tiles.map((tile) => tile.pal), [0, 1]);
  const left = {
    r3: Q.encodeChannel(source[7 * 4]),
    g3: Q.encodeChannel(source[7 * 4 + 1]),
    b3: Q.encodeChannel(source[7 * 4 + 2])
  };
  const right = {
    r3: Q.encodeChannel(source[8 * 4]),
    g3: Q.encodeChannel(source[8 * 4 + 1]),
    b3: Q.encodeChannel(source[8 * 4 + 2])
  };
  for (const line of result.palettes.slice(0, 2)) {
    const keys = new Set(line.map(key));
    assert(keys.has(key(left)), 'line contains left border color');
    assert(keys.has(key(right)), 'line contains right border color');
  }
  assert.deepStrictEqual(outputPixel(result, 16, 7, 0),
    [Q.expandChannel(left.r3), Q.expandChannel(left.g3), Q.expandChannel(left.b3), 255]);
  assert.deepStrictEqual(outputPixel(result, 16, 8, 0),
    [Q.expandChannel(right.r3), Q.expandChannel(right.g3), Q.expandChannel(right.b3), 255]);
}

// Reverse order reports an 8-bit color collapse after the lattice snap.
{
  const source = image(8, 8, (x) =>
    x < 4 ? [17, 17, 17, 255] : [18, 18, 18, 255]);
  const result = Q.quantize(source, 8, 8, { order: 'countFirst' });
  assert(result.warnings.some((warning) => /collapsed/.test(warning)));
}

// ACT parser accepts both legal lengths and maps all 256 RGB triples.
{
  assert.strictEqual(Q.parseAct(new Uint8Array(768)).length, 256);
  assert.strictEqual(Q.parseAct(new Uint8Array(772)).length, 256);
  assert.throws(() => Q.parseAct(new Uint8Array(769)), /768 or 772/);
}

{
  const palettes = [Array.from({ length: 16 }, (_, i) => ({ r3: i & 7, g3: 1, b3: 2 }))];
  const act = Q.writeAct(palettes);
  assert.strictEqual(act.length, 768);
  assert.strictEqual(act[3], Q.expandChannel(1));
  const trailer = Q.writeAct(palettes, { trailer: true, count: 16 });
  assert.strictEqual(trailer.length, 772);
  assert.strictEqual(trailer[769], 16);
  const snes = [Array.from({ length: 16 }, () => ({ r3: 7, g3: 0, b3: 0, r5: 31, g5: 0, b5: 0 }))];
  const snesAct = Q.writeAct(snes);
  assert.strictEqual(snesAct[0], 255);
  assert.strictEqual(snesAct[1], 0);
}

{
  const source = image(8, 8, () => [255, 0, 0, 255]);
  const genesis = Q.quantize(source, 8, 8);
  assert.strictEqual(genesis.palettes.length, 4);
  assert.ok(genesis.palettes[0][0].r5 == null);
}

{
  const source = image(8, 8, () => [255, 0, 0, 255]);
  const result = Q.quantize(source, 8, 8, {
    pals: [5, 6], palCount: 8, bits: 5, opaquePal0: true
  });
  assert.strictEqual(result.palettes.length, 8);
  assert.ok(result.usedPals.every((p) => p === 5 || p === 6));
  assert.ok(result.usedPals.indexOf(5) >= 0 || result.usedPals.indexOf(6) >= 0);
  const line = result.palettes[result.usedPals[0]];
  const ink = line[1];
  assert.strictEqual(ink.r5, 31);
  assert.strictEqual(ink.g5, 0);
  assert.strictEqual(ink.b5, 0);
  assert.strictEqual(line[0].r5, 0);
}

{
  const act = new Uint8Array(768);
  act[5 * 16 * 3] = 255;
  const source = image(8, 8, () => [0, 255, 0, 255]);
  const locked = [false, false, false, false, false, true, false, false];
  const result = Q.quantize(source, 8, 8, {
    pals: [6], palCount: 8, bits: 5, act, lockedLines: locked, opaquePal0: true
  });
  assert.strictEqual(result.palettes[5][0].r5, 31);
  assert.strictEqual(result.palettes[5][0].g5, 0);
  assert.ok(result.usedPals.indexOf(6) >= 0);
  assert.notStrictEqual(result.palettes[6][0].r5, 31);
}

{
  const source = image(16, 16, (x, y) => {
    const i = y * 16 + x;
    return [
      Q.expandChannel(i & 7),
      Q.expandChannel((i >> 3) & 7),
      Q.expandChannel((i * 3) & 7),
      255
    ];
  });
  const result = Q.quantize(source, 16, 16, {
    order: 'bitFirst',
    pals: [0],
    opaquePal0: true,
    stepA: { method: 'uniform', dither: 'none', strength: 0 },
    stepB: { method: 'adaptive', dither: 'none', strength: 0 }
  });
  assert.ok(result.inkCount >= 12, 'bitFirst kept inks, got ' + result.inkCount);
  assert.strictEqual(result.stepA.length, source.length);
  assert.strictEqual(result.stepB.length, source.length);
}

function uniqueRgb(rgba) {
  const keys = new Set();
  for (let i = 0; i < rgba.length; i += 4) {
    keys.add(rgba[i] + ',' + rgba[i + 1] + ',' + rgba[i + 2]);
  }
  return keys.size;
}

{
  assert.strictEqual(typeof Q.reduceBits, 'function');
  const exact3 = [Q.expandChannel(3), Q.expandChannel(5), Q.expandChannel(1), 255];
  const src3 = image(4, 4, () => exact3);
  const g = Q.reduceBits(src3, 4, 4, {
    bits: 3,
    stepA: { method: 'uniform', dither: 'none' }
  });
  assert.strictEqual(g.bits, 3);
  assert.deepStrictEqual(outputPixel(g, 4, 1, 1), exact3);

  const exact5 = [Q.expand5(10), Q.expand5(20), Q.expand5(5), 255];
  const src5 = image(4, 4, () => exact5);
  const s = Q.reduceBits(src5, 4, 4, {
    bits: 5,
    stepA: { method: 'uniform', dither: 'none' }
  });
  assert.strictEqual(s.bits, 5);
  assert.deepStrictEqual(outputPixel(s, 4, 1, 1), exact5);
  const crushed = Q.reduceBits(src5, 4, 4, {
    bits: 3,
    stepA: { method: 'uniform', dither: 'none' }
  });
  assert.notDeepStrictEqual(outputPixel(s, 4, 0, 0).slice(0, 3),
    outputPixel(crushed, 4, 0, 0).slice(0, 3),
    '5-bit (SNES) must not crush to the 3-bit (GEN) lattice');
}

{
  const source = image(8, 8, (x, y) => [x * 32, y * 31, 128, 255]);
  const g = Q.reduceBits(source, 8, 8, {
    bits: 3,
    stepA: { method: 'uniform', dither: 'none' }
  });
  const s = Q.reduceBits(source, 8, 8, {
    bits: 5,
    stepA: { method: 'uniform', dither: 'none' }
  });
  assert.ok(uniqueRgb(s.rgbaOut) > uniqueRgb(g.rgbaOut),
    '5-bit lattice keeps more colors than 3-bit');
}

{
  const source = Uint8Array.from([
    255, 20, 30, 40,
    Q.expand5(8), Q.expand5(16), Q.expand5(24), 200
  ]);
  const result = Q.reduceBits(source, 2, 1, {
    bits: 5,
    alphaThreshold: 128,
    stepA: { method: 'uniform', dither: 'none' }
  });
  assert.strictEqual(result.rgbaOut[3], 40, 'transparent alpha is preserved');
  assert.strictEqual(result.rgbaOut[7], 200);
}

{
  assert.strictEqual(typeof Q.reduceCountOnly, 'function');
  const off = [40, 90, 200, 255];
  const kept = Q.reduceCountOnly(image(4, 4, () => off), 4, 4, {
    count: 16,
    stepB: { method: 'adaptive', dither: 'none' }
  });
  assert.strictEqual(kept.count, 16);
  assert.deepStrictEqual(outputPixel(kept, 4, 1, 1), off,
    'count-only keeps 8-bit color when already under the cap');

  const source = image(8, 8, (x, y) => {
    const i = (x + y * 8) % 32;
    return [(i * 7) & 255, 40 + (i * 3), 200 - i, 255];
  });
  const reduced = Q.reduceCountOnly(source, 8, 8, {
    count: 4,
    stepB: { method: 'adaptive', dither: 'none' }
  });
  assert.strictEqual(reduced.count, 4);
  assert.ok(uniqueRgb(reduced.rgbaOut) <= 4,
    'count-only caps unique opaque colors, got ' + uniqueRgb(reduced.rgbaOut));

  const holes = Uint8Array.from([
    40, 90, 200, 40,
    10, 20, 30, 200
  ]);
  const alpha = Q.reduceCountOnly(holes, 2, 1, {
    count: 8,
    alphaThreshold: 128,
    stepB: { method: 'adaptive', dither: 'none' }
  });
  assert.strictEqual(alpha.rgbaOut[3], 40, 'count-only preserves transparent alpha');
  assert.strictEqual(alpha.rgbaOut[7], 200);
}

console.log('genesis-quantize: ok');
