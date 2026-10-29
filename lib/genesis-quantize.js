/**
 * Deterministic RGB quantization and per-tile palette assignment for Genesis
 * JIM maps and SNES SJIM maps. Default is 4 CRAM lines at 3 bits; SNES passes
 * palCount 8 and bits 5 (BGR555).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlGenesisQuantize = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LEVELS = Object.freeze(Array.from({ length: 8 }, (_, c) =>
    (c << 5) | (c << 2) | (c >> 1)));
  const LEVELS5 = Object.freeze(Array.from({ length: 32 }, (_, c) =>
    ((c * 255) / 31) | 0));
  const BAYER8 = Object.freeze([
    0, 48, 12, 60, 3, 51, 15, 63,
    32, 16, 44, 28, 35, 19, 47, 31,
    8, 56, 4, 52, 11, 59, 7, 55,
    40, 24, 36, 20, 43, 27, 39, 23,
    2, 50, 14, 62, 1, 49, 13, 61,
    34, 18, 46, 30, 33, 17, 45, 29,
    10, 58, 6, 54, 9, 57, 5, 53,
    42, 26, 38, 22, 41, 25, 37, 21
  ]);
  const METHODS = new Set([
    'perceptual', 'selective', 'adaptive', 'uniform', 'weighted-kmeans'
  ]);
  const DITHERS = new Set(['none', 'diffusion', 'pattern', 'noise']);

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function expandChannel(c) {
    c = clamp(c | 0, 0, 7);
    return (c << 5) | (c << 2) | (c >> 1);
  }

  // This is deliberately the inverse of expandChannel, not round(v * 7 / 252).
  function encodeChannel(value) {
    value = clamp(Number(value) || 0, 0, 255);
    let best = 0;
    let bestError = Infinity;
    for (let c = 0; c < 8; c++) {
      const error = Math.abs(value - LEVELS[c]);
      if (error < bestError) {
        best = c;
        bestError = error;
      }
    }
    return best;
  }

  function expand5(c) {
    c = clamp(c | 0, 0, 31);
    return ((c * 255) / 31) | 0;
  }

  function encode5(value) {
    value = clamp(Number(value) || 0, 0, 255);
    let best = 0;
    let bestError = Infinity;
    for (let c = 0; c < 32; c++) {
      const error = Math.abs(value - LEVELS5[c]);
      if (error < bestError) {
        best = c;
        bestError = error;
      }
    }
    return best;
  }

  function makeLattice(bits) {
    bits = bits === 5 ? 5 : 3;
    const max = bits === 5 ? 31 : 7;
    function expand(c) { return bits === 5 ? expand5(c) : expandChannel(c); }
    function encode(v) { return bits === 5 ? encode5(v) : encodeChannel(v); }
    function color(r, g, b) {
      r = clamp(r | 0, 0, max);
      g = clamp(g | 0, 0, max);
      b = clamp(b | 0, 0, max);
      if (bits === 5) {
        return { r5: r, g5: g, b5: b, r3: r >> 2, g3: g >> 2, b3: b >> 2 };
      }
      return { r3: r, g3: g, b3: b };
    }
    function fromRgb(rgb) {
      return color(encode(rgb[0]), encode(rgb[1]), encode(rgb[2]));
    }
    function toRgb(c) {
      if (bits === 5) {
        const r = c.r5 != null ? c.r5 : ((((c.r3 || 0) & 7) << 2) | (((c.r3 || 0) & 7) >> 1));
        const g = c.g5 != null ? c.g5 : ((((c.g3 || 0) & 7) << 2) | (((c.g3 || 0) & 7) >> 1));
        const b = c.b5 != null ? c.b5 : ((((c.b3 || 0) & 7) << 2) | (((c.b3 || 0) & 7) >> 1));
        return [expand5(r), expand5(g), expand5(b)];
      }
      return [expandChannel(c.r3), expandChannel(c.g3), expandChannel(c.b3)];
    }
    function key(c) {
      if (bits === 5) {
        const r = c.r5 != null ? c.r5 & 31 : ((((c.r3 || 0) & 7) << 2) | (((c.r3 || 0) & 7) >> 1));
        const g = c.g5 != null ? c.g5 & 31 : ((((c.g3 || 0) & 7) << 2) | (((c.g3 || 0) & 7) >> 1));
        const b = c.b5 != null ? c.b5 & 31 : ((((c.b3 || 0) & 7) << 2) | (((c.b3 || 0) & 7) >> 1));
        return (r << 10) | (g << 5) | b;
      }
      return ((c.r3 || 0) << 6) | ((c.g3 || 0) << 3) | (c.b3 || 0);
    }
    function fromKey(k) {
      if (bits === 5) return color((k >> 10) & 31, (k >> 5) & 31, k & 31);
      return color((k >> 6) & 7, (k >> 3) & 7, k & 7);
    }
    return { bits, max, expand, encode, fromRgb, toRgb, key, fromKey, color };
  }

  function color3(r3, g3, b3) {
    return {
      r3: clamp(r3 | 0, 0, 7),
      g3: clamp(g3 | 0, 0, 7),
      b3: clamp(b3 | 0, 0, 7)
    };
  }

  function fromRgb(rgb) {
    return color3(encodeChannel(rgb[0]), encodeChannel(rgb[1]), encodeChannel(rgb[2]));
  }

  function toRgb(c) {
    return [expandChannel(c.r3), expandChannel(c.g3), expandChannel(c.b3)];
  }

  function key3(c) {
    return (c.r3 << 6) | (c.g3 << 3) | c.b3;
  }

  function fromKey3(key) {
    return color3((key >> 6) & 7, (key >> 3) & 7, key & 7);
  }

  function parseAct(value) {
    const bytes = value instanceof Uint8Array
      ? value
      : (ArrayBuffer.isView(value)
          ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
          : new Uint8Array(value || 0));
    if (bytes.length !== 768 && bytes.length !== 772) {
      throw new Error('ACT must contain 768 or 772 bytes');
    }
    return Array.from({ length: 256 }, (_, i) => {
      const r = bytes[i * 3];
      const g = bytes[i * 3 + 1];
      const b = bytes[i * 3 + 2];
      return {
        r3: encodeChannel(r), g3: encodeChannel(g), b3: encodeChannel(b),
        r5: encode5(r), g5: encode5(g), b5: encode5(b)
      };
    });
  }

  function normalizeStep(step, defaults) {
    step = step || {};
    const method = String(step.method || defaults.method).toLowerCase();
    const dither = String(step.dither || defaults.dither).toLowerCase();
    if (!METHODS.has(method)) throw new Error('Unknown color method: ' + method);
    if (!DITHERS.has(dither)) throw new Error('Unknown dither mode: ' + dither);
    return {
      method,
      dither,
      strength: clamp(step.strength == null ? 100 : Number(step.strength), 0, 100)
    };
  }

  function normalizeOptions(options) {
    const input = options || {};
    const palCount = input.palCount == null ? 4 : (input.palCount | 0);
    if (palCount < 1 || palCount > 8) throw new Error('palCount must be 1–8');
    const bits = input.bits === 5 ? 5 : 3;
    const L = makeLattice(bits);
    const pals = [...new Set((input.pals == null ? [0] : Array.from(input.pals))
      .map(Number))]
      .filter((p) => Number.isInteger(p) && p >= 0 && p < palCount)
      .sort((a, b) => a - b);
    const order = input.order || 'bitFirst';
    if (order !== 'bitFirst' && order !== 'countFirst') {
      throw new Error("order must be 'bitFirst' or 'countFirst'");
    }
    const lockedLines = Array.from({ length: palCount }, () => false);
    if (input.lockedLines != null) {
      if (!Array.isArray(input.lockedLines) && !ArrayBuffer.isView(input.lockedLines)) {
        throw new TypeError('lockedLines must be a boolean array');
      }
      for (let p = 0; p < palCount; p++) lockedLines[p] = !!input.lockedLines[p];
    }
    // `pals` are writable lines. Locked ACT lines are also available for
    // matching, even though they are intentionally not in that open subset.
    const availablePals = [...new Set(pals.concat(
      lockedLines.map((locked, pal) => locked ? pal : -1).filter((pal) => pal >= 0)
    ))].sort((a, b) => a - b);
    if (!availablePals.length) {
      throw new Error('At least one open or locked palette line is required');
    }
    if (lockedLines.some(Boolean) && !input.act) {
      throw new Error('An ACT is required when a palette line is locked');
    }
    return {
      order,
      stepA: normalizeStep(input.stepA, { method: 'uniform', dither: 'none' }),
      stepB: normalizeStep(input.stepB, { method: 'adaptive', dither: 'none' }),
      pals,
      availablePals,
      lockedLines,
      palCount,
      bits,
      L,
      act: input.act || null,
      opaquePal0: !!input.opaquePal0,
      alphaThreshold: clamp(
        input.alphaThreshold == null ? 128 : Number(input.alphaThreshold), 0, 255
      ),
      seed: (input.seed == null ? 0x4e484c39 : Number(input.seed)) >>> 0
    };
  }

  function distance(a, b, method) {
    const r = a[0] - b[0];
    const g = a[1] - b[1];
    const blue = a[2] - b[2];
    if (method === 'perceptual') return 3 * r * r + 6 * g * g + blue * blue;
    return 2 * r * r + 4 * g * g + 3 * blue * blue;
  }

  function selectiveWeight(rgb) {
    const r = rgb[0], g = rgb[1], b = rgb[2];
    if (r >= 205 && g >= 205 && b >= 205) return 3;
    if (r >= 95 && r >= g && g >= 45 && g >= b &&
        r - b >= 35 && r - g <= 105) return 2;
    const high = Math.max(r, g, b);
    const low = Math.min(r, g, b);
    return high >= 145 && high - low >= 90 ? 2 : 1;
  }

  function histogram(rgb, opaque) {
    const colors = new Map();
    for (let i = 0; i < opaque.length; i++) {
      if (!opaque[i]) continue;
      const at = i * 3;
      const key = (rgb[at] << 16) | (rgb[at + 1] << 8) | rgb[at + 2];
      let item = colors.get(key);
      if (!item) {
        item = { rgb: [rgb[at], rgb[at + 1], rgb[at + 2]], count: 0, first: i };
        colors.set(key, item);
      }
      item.count++;
    }
    return [...colors.values()].sort((a, b) =>
      b.count - a.count || a.first - b.first);
  }

  function mean(items) {
    let r = 0, g = 0, b = 0, total = 0;
    for (const item of items) {
      r += item.rgb[0] * item.count;
      g += item.rgb[1] * item.count;
      b += item.rgb[2] * item.count;
      total += item.count;
    }
    return total
      ? [Math.round(r / total), Math.round(g / total), Math.round(b / total)]
      : [0, 0, 0];
  }

  function rangeOf(items, channel) {
    let low = 255, high = 0;
    for (const item of items) {
      low = Math.min(low, item.rgb[channel]);
      high = Math.max(high, item.rgb[channel]);
    }
    return high - low;
  }

  function medianCut(items, count) {
    const boxes = [items.slice()];
    while (boxes.length < count) {
      let pick = -1, score = -1, channel = 0;
      for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].length < 2) continue;
        const weight = boxes[i].reduce((sum, item) => sum + item.count, 0);
        for (let c = 0; c < 3; c++) {
          const next = rangeOf(boxes[i], c) * weight;
          if (next > score) {
            pick = i;
            score = next;
            channel = c;
          }
        }
      }
      if (pick < 0) break;
      const box = boxes[pick].slice().sort((a, b) =>
        a.rgb[channel] - b.rgb[channel] || a.first - b.first);
      const total = box.reduce((sum, item) => sum + item.count, 0);
      let accumulated = 0, split = 1;
      while (split < box.length) {
        accumulated += box[split - 1].count;
        if (accumulated >= total / 2) break;
        split++;
      }
      boxes.splice(pick, 1, box.slice(0, split), box.slice(split));
    }
    return boxes.map(mean);
  }

  function kmeans(items, count, method) {
    const weighted = items.map((item) => ({
      rgb: item.rgb,
      count: item.count * (method === 'selective' ? selectiveWeight(item.rgb) : 1),
      first: item.first
    }));
    const centers = [weighted[0].rgb.slice()];
    while (centers.length < count) {
      let winner = null, winnerScore = -1;
      for (const item of weighted) {
        const error = Math.min(...centers.map((c) =>
          distance(item.rgb, c, method)));
        const score = error * item.count;
        if (score > winnerScore) {
          winner = item;
          winnerScore = score;
        }
      }
      if (!winner || winnerScore <= 0) break;
      centers.push(winner.rgb.slice());
    }
    for (let iteration = 0; iteration < 16; iteration++) {
      const sums = centers.map(() => [0, 0, 0, 0]);
      for (const item of weighted) {
        let pick = 0, best = Infinity;
        for (let i = 0; i < centers.length; i++) {
          const error = distance(item.rgb, centers[i], method);
          if (error < best) {
            best = error;
            pick = i;
          }
        }
        for (let c = 0; c < 3; c++) sums[pick][c] += item.rgb[c] * item.count;
        sums[pick][3] += item.count;
      }
      let changed = false;
      for (let i = 0; i < centers.length; i++) {
        if (!sums[i][3]) continue;
        const next = sums[i].slice(0, 3).map((v) =>
          Math.round(v / sums[i][3]));
        changed = changed || next.some((v, c) => v !== centers[i][c]);
        centers[i] = next;
      }
      if (!changed) break;
    }
    return centers;
  }

  function uniformCenters(items, count, method) {
    const centers = [items[0].rgb.slice()];
    while (centers.length < count) {
      let winner = null, winnerError = -1;
      for (const item of items) {
        const error = Math.min(...centers.map((c) =>
          distance(item.rgb, c, method)));
        if (error > winnerError) {
          winner = item.rgb;
          winnerError = error;
        }
      }
      if (!winner || winnerError <= 0) break;
      centers.push(winner.slice());
    }
    return centers;
  }

  function representatives(items, count, method) {
    if (items.length <= count) return items.map((item) => item.rgb.slice());
    if (method === 'adaptive') return medianCut(items, count);
    if (method === 'uniform') return uniformCenters(items, count, method);
    return kmeans(items, count, method);
  }

  function noiseAt(x, y, seed) {
    let n = (seed ^ Math.imul(x + 1, 0x9e3779b1) ^
      Math.imul(y + 1, 0x85ebca6b)) >>> 0;
    n ^= n >>> 16;
    n = Math.imul(n, 0x7feb352d);
    n ^= n >>> 15;
    n = Math.imul(n, 0x846ca68b);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }

  function perturb(step, x, y, seed) {
    const scale = step.strength / 100;
    if (step.dither === 'pattern') {
      return (((BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64) - 0.5) *
        40 * scale;
    }
    if (step.dither === 'noise') return (noiseAt(x, y, seed) - 0.5) * 40 * scale;
    return 0;
  }

  function nearest(rgb, palette, method) {
    let pick = palette[0], best = Infinity;
    for (const candidate of palette) {
      const error = distance(rgb, candidate, method);
      if (error < best) {
        pick = candidate;
        best = error;
      }
    }
    return pick;
  }

  function mapToPalette(rgb, opaque, width, height, palette, step, seed) {
    if (!palette.length) return rgb.slice();
    const output = new Uint8Array(rgb.length);
    const errors = step.dither === 'diffusion' && step.strength > 0
      ? new Float64Array(rgb.length) : null;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = y * width + x;
        if (!opaque[pixel]) continue;
        const at = pixel * 3;
        const offset = perturb(step, x, y, seed);
        const sample = [0, 1, 2].map((c) =>
          clamp(rgb[at + c] + offset + (errors ? errors[at + c] : 0), 0, 255));
        const chosen = nearest(sample, palette, step.method);
        output.set(chosen, at);
        if (!errors) continue;
        const strength = step.strength / 100;
        const spread = (nx, ny, weight) => {
          if (nx < 0 || nx >= width || ny >= height) return;
          const nextPixel = ny * width + nx;
          if (!opaque[nextPixel]) return;
          const next = nextPixel * 3;
          for (let c = 0; c < 3; c++) {
            errors[next + c] += (sample[c] - chosen[c]) * strength * weight;
          }
        };
        spread(x + 1, y, 7 / 16);
        spread(x - 1, y + 1, 3 / 16);
        spread(x, y + 1, 5 / 16);
        spread(x + 1, y + 1, 1 / 16);
      }
    }
    return output;
  }

  function snapLattice(rgb, opaque, width, height, step, seed, L) {
    L = L || makeLattice(3);
    const output = new Uint8Array(rgb.length);
    const errors = step.dither === 'diffusion' && step.strength > 0
      ? new Float64Array(rgb.length) : null;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = y * width + x;
        if (!opaque[pixel]) continue;
        const at = pixel * 3;
        const offset = perturb(step, x, y, seed);
        for (let c = 0; c < 3; c++) {
          const sample = clamp(
            rgb[at + c] + offset + (errors ? errors[at + c] : 0), 0, 255);
          const chosen = L.expand(L.encode(sample));
          output[at + c] = chosen;
          if (!errors) continue;
          const error = (sample - chosen) * step.strength / 100;
          const spread = (nx, ny, weight) => {
            if (nx < 0 || nx >= width || ny >= height) return;
            const nextPixel = ny * width + nx;
            if (opaque[nextPixel]) {
              errors[nextPixel * 3 + c] += error * weight;
            }
          };
          spread(x + 1, y, 7 / 16);
          spread(x - 1, y + 1, 3 / 16);
          spread(x, y + 1, 5 / 16);
          spread(x + 1, y + 1, 1 / 16);
        }
      }
    }
    return output;
  }

  function uniqueLattice(palette, L, items, count) {
    const seen = new Set();
    const out = [];
    function addRgb(rgb) {
      const snapped = L.toRgb(L.fromRgb(rgb));
      const key = L.key(L.fromRgb(snapped));
      if (seen.has(key)) return;
      seen.add(key);
      out.push(snapped);
    }
    palette.forEach(addRgb);
    if (out.length < Math.min(count, items.length)) {
      for (const item of items) {
        addRgb(item.rgb);
        if (out.length >= count) break;
      }
    }
    return out;
  }

  function reduceCount(rgb, opaque, width, height, count, step, seed, L) {
    const items = histogram(rgb, opaque);
    if (items.length <= count) return rgb.slice();
    let palette = representatives(items, count, step.method);
    if (L) palette = uniqueLattice(palette, L, items, count);
    return mapToPalette(rgb, opaque, width, height, palette, step, seed);
  }

  function toRgba(rgb, opaque, source) {
    const out = new Uint8Array(source.length);
    for (let i = 0; i < opaque.length; i++) {
      const at = i * 4;
      if (!opaque[i]) {
        out[at + 3] = source[at + 3];
        continue;
      }
      out[at] = rgb[i * 3];
      out[at + 1] = rgb[i * 3 + 1];
      out[at + 2] = rgb[i * 3 + 2];
      out[at + 3] = source[at + 3];
    }
    return out;
  }

  function reduceBits(rgba, width, height, opts) {
    if (!(rgba instanceof Uint8Array)) throw new TypeError('rgba must be a Uint8Array');
    if (!Number.isInteger(width) || width <= 0 ||
        !Number.isInteger(height) || height <= 0) {
      throw new Error('width and height must be positive integers');
    }
    if (rgba.length !== width * height * 4) {
      throw new Error('rgba length must equal width * height * 4');
    }
    const bits = opts && opts.bits === 5 ? 5 : 3;
    const L = makeLattice(bits);
    const step = normalizeStep(opts && (opts.stepA || opts.step), {
      method: 'uniform', dither: 'none'
    });
    const alphaThreshold = clamp(
      opts && opts.alphaThreshold != null ? Number(opts.alphaThreshold) : 128, 0, 255);
    const seed = ((opts && opts.seed != null ? Number(opts.seed) : 0x4e484c39) >>> 0);
    const opaque = new Uint8Array(width * height);
    const source = new Uint8Array(width * height * 3);
    for (let pixel = 0; pixel < width * height; pixel++) {
      const at = pixel * 4;
      if (rgba[at + 3] < alphaThreshold) continue;
      opaque[pixel] = 1;
      source.set(rgba.subarray(at, at + 3), pixel * 3);
    }
    const rgb = snapLattice(source, opaque, width, height, step, seed, L);
    return { rgbaOut: toRgba(rgb, opaque, rgba), bits, warnings: [] };
  }

  function paletteCapacity(pal, opaquePal0) {
    return pal === 0 && opaquePal0 ? 16 : 15;
  }

  function firstInkSlot(pal, opaquePal0) {
    return pal === 0 && opaquePal0 ? 0 : 1;
  }

  function lineKeySet(line, pal, opaquePal0, L) {
    L = L || makeLattice(3);
    const keys = new Set();
    for (let i = firstInkSlot(pal, opaquePal0); i < 16; i++) {
      if (line[i]) keys.add(L.key(line[i]));
    }
    return keys;
  }

  function freeSlots(line, pal, opaquePal0) {
    let count = 0;
    for (let i = firstInkSlot(pal, opaquePal0); i < 16; i++) {
      if (!line[i]) count++;
    }
    return count;
  }

  function addToLine(line, pal, opaquePal0, color, L) {
    L = L || makeLattice(3);
    const key = L.key(color);
    for (let i = firstInkSlot(pal, opaquePal0); i < 16; i++) {
      if (line[i] && L.key(line[i]) === key) return i;
    }
    for (let i = firstInkSlot(pal, opaquePal0); i < 16; i++) {
      if (!line[i]) {
        line[i] = color;
        return i;
      }
    }
    return -1;
  }

  function tileHistogram(rgb, opaque, width, height, tileX, tileY, L) {
    L = L || makeLattice(3);
    const counts = new Map();
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const px = tileX * 8 + x, py = tileY * 8 + y;
        if (px >= width || py >= height) continue;
        const pixel = py * width + px;
        if (!opaque[pixel]) continue;
        const at = pixel * 3;
        const key = L.key(L.fromRgb([rgb[at], rgb[at + 1], rgb[at + 2]]));
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return counts;
  }

  function lineError(counts, line, pal, opaquePal0, method, L) {
    L = L || makeLattice(3);
    const colors = line.slice(firstInkSlot(pal, opaquePal0)).filter(Boolean);
    if (!colors.length) return Infinity;
    let total = 0;
    for (const [key, count] of counts) {
      const rgb = L.toRgb(L.fromKey(key));
      let best = Infinity;
      for (const candidate of colors) {
        best = Math.min(best, distance(rgb, L.toRgb(candidate), method));
      }
      total += best * count;
    }
    return total;
  }

  function assignTiles(rgb, opaque, width, height, options, warnings) {
    const tileWidth = Math.ceil(width / 8);
    const tileHeight = Math.ceil(height / 8);
    const act = options.act ? parseAct(options.act) : null;
    const L = options.L || makeLattice(options.bits);
    const n = options.palCount || 4;
    const lines = Array.from({ length: n }, () => Array(16).fill(null));
    for (let pal = 0; pal < n; pal++) {
      if (options.lockedLines[pal]) {
        lines[pal] = act.slice(pal * 16, pal * 16 + 16).map((c) =>
          L.bits === 5 ? L.color(c.r5, c.g5, c.b5) : color3(c.r3, c.g3, c.b3));
      } else if (firstInkSlot(pal, options.opaquePal0) === 1) {
        lines[pal][0] = L.color(0, 0, 0);
      }
    }
    const assignment = new Uint8Array(tileWidth * tileHeight);
    for (let ty = 0; ty < tileHeight; ty++) {
      for (let tx = 0; tx < tileWidth; tx++) {
        const tileIndex = ty * tileWidth + tx;
        const counts = tileHistogram(rgb, opaque, width, height, tx, ty, L);
        const largest = Math.max(...options.availablePals.map((pal) =>
          paletteCapacity(pal, options.opaquePal0)));
        if (counts.size > largest) {
          warnings.push('Tile ' + tx + ',' + ty + ' needs ' + counts.size +
            ' ink colors; at most ' + largest +
            ' fit in one palette (try dithering or more reduction)');
        }
        let winner = null;
        for (const pal of options.availablePals) {
          const existing = lineKeySet(lines[pal], pal, options.opaquePal0, L);
          const missing = [...counts.keys()].filter((key) => !existing.has(key));
          const exact = missing.length === 0 ||
            (!options.lockedLines[pal] &&
              missing.length <= freeSlots(lines[pal], pal, options.opaquePal0));
          const overlap = [...counts].reduce((sum, entry) =>
            sum + (existing.has(entry[0]) ? entry[1] : 0), 0);
          const neighbors =
            (tx > 0 && assignment[tileIndex - 1] === pal ? 1 : 0) +
            (ty > 0 && assignment[tileIndex - tileWidth] === pal ? 1 : 0);
          const error = exact ? 0 : lineError(
            counts, lines[pal], pal, options.opaquePal0, options.stepB.method, L);
          const candidate = { pal, missing, exact, overlap, neighbors, error };
          if (!winner ||
              Number(candidate.exact) > Number(winner.exact) ||
              (candidate.exact === winner.exact &&
                candidate.overlap > winner.overlap) ||
              (candidate.exact === winner.exact &&
                candidate.overlap === winner.overlap &&
                candidate.neighbors > winner.neighbors) ||
              (candidate.exact === winner.exact &&
                candidate.overlap === winner.overlap &&
                candidate.neighbors === winner.neighbors &&
                candidate.error < winner.error) ||
              (candidate.exact === winner.exact &&
                candidate.overlap === winner.overlap &&
                candidate.neighbors === winner.neighbors &&
                candidate.error === winner.error &&
                candidate.pal < winner.pal)) {
            winner = candidate;
          }
        }
        assignment[tileIndex] = winner.pal;
        if (!options.lockedLines[winner.pal]) {
          winner.missing.sort((a, b) =>
            (counts.get(b) || 0) - (counts.get(a) || 0) || a - b);
          for (const key of winner.missing) {
            if (addToLine(
              lines[winner.pal], winner.pal, options.opaquePal0, L.fromKey(key), L
            ) < 0) break;
          }
        }
      }
    }
    return { lines, assignment, tileWidth, tileHeight };
  }

  function borderKeys(rgb, opaque, width, height, ax, ay, bx, by, L) {
    L = L || makeLattice(3);
    const keys = new Set();
    const add = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const pixel = y * width + x;
      if (!opaque[pixel]) return;
      const at = pixel * 3;
      keys.add(L.key(L.fromRgb([rgb[at], rgb[at + 1], rgb[at + 2]])));
    };
    if (ay === by) {
      const edge = Math.max(ax, bx) * 8;
      for (let y = ay * 8; y < ay * 8 + 8; y++) {
        add(edge - 1, y);
        add(edge, y);
      }
    } else {
      const edge = Math.max(ay, by) * 8;
      for (let x = ax * 8; x < ax * 8 + 8; x++) {
        add(x, edge - 1);
        add(x, edge);
      }
    }
    return keys;
  }

  function copySeams(rgb, opaque, width, height, state, options, warnings) {
    let missed = 0;
    const copyPair = (ax, ay, bx, by) => {
      const a = state.assignment[ay * state.tileWidth + ax];
      const b = state.assignment[by * state.tileWidth + bx];
      if (a === b) return;
      const L = options.L || makeLattice(options.bits);
      for (const key of borderKeys(rgb, opaque, width, height, ax, ay, bx, by, L)) {
        for (const pal of [a, b]) {
          if (lineKeySet(state.lines[pal], pal, options.opaquePal0, L).has(key)) {
            continue;
          }
          if (options.lockedLines[pal] || addToLine(
            state.lines[pal], pal, options.opaquePal0, L.fromKey(key), L
          ) < 0) missed++;
        }
      }
    };
    for (let y = 0; y < state.tileHeight; y++) {
      for (let x = 0; x < state.tileWidth; x++) {
        if (x + 1 < state.tileWidth) copyPair(x, y, x + 1, y);
        if (y + 1 < state.tileHeight) copyPair(x, y, x, y + 1);
      }
    }
    if (missed) {
      warnings.push(missed +
        ' border color copies did not fit in locked or full palette lines');
    }
  }

  function nearestLineIndex(rgb, line, pal, opaquePal0, method, L) {
    L = L || makeLattice(3);
    let pick = firstInkSlot(pal, opaquePal0), best = Infinity;
    for (let i = firstInkSlot(pal, opaquePal0); i < 16; i++) {
      if (!line[i]) continue;
      const error = distance(rgb, L.toRgb(line[i]), method);
      if (error < best) {
        pick = i;
        best = error;
      }
    }
    return pick;
  }

  function quantize(rgba, width, height, opts) {
    if (!(rgba instanceof Uint8Array)) throw new TypeError('rgba must be a Uint8Array');
    if (!Number.isInteger(width) || width <= 0 ||
        !Number.isInteger(height) || height <= 0) {
      throw new Error('width and height must be positive integers');
    }
    if (rgba.length !== width * height * 4) {
      throw new Error('rgba length must equal width * height * 4');
    }
    const options = normalizeOptions(opts);
    const warnings = [];
    const opaque = new Uint8Array(width * height);
    const source = new Uint8Array(width * height * 3);
    for (let pixel = 0; pixel < width * height; pixel++) {
      const at = pixel * 4;
      if (rgba[at + 3] < options.alphaThreshold) continue;
      opaque[pixel] = 1;
      source.set(rgba.subarray(at, at + 3), pixel * 3);
    }
    const budget = options.availablePals.reduce((sum, pal) =>
      sum + paletteCapacity(pal, options.opaquePal0), 0);
    let rgb;
    let stepARgb;
    const L = options.L;
    const bitName = options.bits === 5 ? '5-bit (SNES)' : '3-bit (GEN)';
    if (options.order === 'bitFirst') {
      stepARgb = snapLattice(
        source, opaque, width, height, options.stepA, options.seed, L);
      rgb = reduceCount(
        stepARgb, opaque, width, height, budget, options.stepB,
        options.seed ^ 0x9e3779b9, L);
    } else {
      stepARgb = reduceCount(
        source, opaque, width, height, budget, options.stepB,
        options.seed ^ 0x9e3779b9);
      const before = histogram(stepARgb, opaque).length;
      rgb = snapLattice(
        stepARgb, opaque, width, height, options.stepA, options.seed, L);
      const after = histogram(rgb, opaque).length;
      if (after < before) {
        warnings.push('countFirst colors collapsed when snapped to ' + bitName +
          ' (' + before + ' to ' + after + ')');
      }
    }
    if (options.act && options.lockedLines.some(Boolean)) {
      const actBytes = options.act instanceof Uint8Array
        ? options.act
        : new Uint8Array(
          options.act.buffer, options.act.byteOffset, options.act.byteLength);
      for (let pal = 0; pal < options.palCount; pal++) {
        if (!options.lockedLines[pal]) continue;
        let snapped = false;
        for (let i = pal * 16 * 3; i < (pal + 1) * 16 * 3; i++) {
          if (L.expand(L.encode(actBytes[i])) !== actBytes[i]) {
            snapped = true;
            break;
          }
        }
        if (snapped) {
          warnings.push('Locked ACT line ' + pal +
            ' was snapped to ' + bitName +
            ' colors');
        }
      }
    }
    const state = assignTiles(rgb, opaque, width, height, options, warnings);
    copySeams(rgb, opaque, width, height, state, options, warnings);
    const indexed = new Uint8Array(width * height);
    const rgbaOut = new Uint8Array(rgba.length);
    const tiles = [];
    const usedPals = new Set();
    const inks = new Set();
    for (let ty = 0; ty < state.tileHeight; ty++) {
      for (let tx = 0; tx < state.tileWidth; tx++) {
        const tileAt = ty * state.tileWidth + tx;
        const pal = state.assignment[tileAt];
        const nibbles = new Uint8Array(64);
        usedPals.add(pal);
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const px = tx * 8 + x, py = ty * 8 + y;
            if (px >= width || py >= height) continue;
            const pixel = py * width + px;
            if (!opaque[pixel]) {
              rgbaOut[pixel * 4 + 3] = 0;
              continue;
            }
            const rgbAt = pixel * 3;
            const index = nearestLineIndex(
              [rgb[rgbAt], rgb[rgbAt + 1], rgb[rgbAt + 2]],
              state.lines[pal], pal, options.opaquePal0, options.stepB.method, L);
            const output = L.toRgb(state.lines[pal][index]);
            indexed[pixel] = index;
            nibbles[y * 8 + x] = index;
            rgbaOut.set(output, pixel * 4);
            rgbaOut[pixel * 4 + 3] = rgba[pixel * 4 + 3];
            inks.add(L.key(state.lines[pal][index]));
          }
        }
        tiles.push({ x: tx, y: ty, pal, nibbles });
      }
    }
    for (let pal = 0; pal < options.palCount; pal++) {
      for (let i = 0; i < 16; i++) {
        if (!state.lines[pal][i]) state.lines[pal][i] = L.color(0, 0, 0);
      }
    }
    return {
      rgbaOut,
      stepA: toRgba(stepARgb, opaque, rgba),
      stepB: rgbaOut,
      indexed,
      tiles,
      palettes: state.lines,
      usedPals: [...usedPals].sort((a, b) => a - b),
      inkCount: inks.size,
      warnings: [...new Set(warnings)]
    };
  }

  function writeAct(palettes, options) {
    options = options || {};
    const out = new Uint8Array(options.trailer ? 772 : 768);
    const lines = palettes || [];
    for (let i = 0; i < 256; i++) {
      const line = lines[(i / 16) | 0];
      const c = line && line[i & 15];
      const at = i * 3;
      if (c) {
        if (c.r5 != null) {
          out[at] = ((c.r5 & 31) * 255 / 31) | 0;
          out[at + 1] = ((c.g5 & 31) * 255 / 31) | 0;
          out[at + 2] = ((c.b5 & 31) * 255 / 31) | 0;
        } else {
          out[at] = expandChannel(c.r3);
          out[at + 1] = expandChannel(c.g3);
          out[at + 2] = expandChannel(c.b3);
        }
      }
    }
    if (out.length === 772) {
      const count = options.count != null ? options.count : Math.min(256, lines.length * 16);
      out[768] = (count >> 8) & 255;
      out[769] = count & 255;
      out[770] = 0;
      out[771] = options.transparent != null ? options.transparent & 255 : 0;
    }
    return out;
  }

  return {
    quantize,
    reduceBits,
    parseAct,
    writeAct,
    expandChannel,
    encodeChannel,
    expand5,
    encode5
  };
}));
