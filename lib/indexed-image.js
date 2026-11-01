/**
 * 8-bit indexed PNG (PLTE + optional tRNS) and BMP writers. Frame export
 * keeps game color indices instead of flattening to truecolor.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlIndexedImage = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  var crcTable = null;

  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function adler32(bytes) {
    var a = 1;
    var b = 0;
    for (var i = 0; i < bytes.length; i++) {
      a += bytes[i];
      if (a >= 65521) a -= 65521;
      b += a;
      if (b >= 65521) b -= 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  function u8of(src) {
    if (src instanceof Uint8Array) return src;
    return new Uint8Array(src);
  }

  function concat(parts) {
    var n = 0;
    for (var i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n);
    var at = 0;
    for (var j = 0; j < parts.length; j++) { out.set(parts[j], at); at += parts[j].length; }
    return out;
  }

  function be32(n) {
    return Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  }

  function le16(n) {
    return Uint8Array.of(n & 255, (n >>> 8) & 255);
  }

  function le32(n) {
    return Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
  }

  function rgbList(palette) {
    var out = [];
    if (!palette) return out;
    if (palette instanceof Uint8Array) {
      var n = Math.floor(palette.length / 3);
      for (var i = 0; i < n && i < 256; i++) out.push([palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]]);
      return out;
    }
    var len = Math.min(256, palette.length || 0);
    for (var j = 0; j < len; j++) {
      var c = palette[j] || [0, 0, 0];
      out.push([c[0] & 255, c[1] & 255, c[2] & 255]);
    }
    return out;
  }

  /** Store-only zlib (CMF/FLG 78 01) so the browser needs no deflate library. */
  function zlibStore(data) {
    var src = u8of(data);
    var parts = [Uint8Array.of(0x78, 0x01)];
    var offset = 0;
    if (!src.length) {
      parts.push(Uint8Array.of(1, 0, 0, 255, 255));
    } else {
      while (offset < src.length) {
        var n = Math.min(65535, src.length - offset);
        var last = offset + n >= src.length ? 1 : 0;
        var nlen = (~n) & 0xffff;
        parts.push(Uint8Array.of(last, n & 255, n >>> 8, nlen & 255, nlen >>> 8));
        parts.push(src.subarray(offset, offset + n));
        offset += n;
      }
    }
    var sum = adler32(src);
    parts.push(be32(sum));
    return concat(parts);
  }

  function pngChunk(type, data) {
    var body = new Uint8Array(4 + data.length);
    body[0] = type.charCodeAt(0);
    body[1] = type.charCodeAt(1);
    body[2] = type.charCodeAt(2);
    body[3] = type.charCodeAt(3);
    body.set(data, 4);
    return concat([be32(data.length), body, be32(crc32(body))]);
  }

  function scanlines(width, height, pixels) {
    var src = u8of(pixels);
    var row = width;
    var out = new Uint8Array((row + 1) * height);
    for (var y = 0; y < height; y++) {
      out[y * (row + 1)] = 0;
      out.set(src.subarray(y * row, y * row + row), y * (row + 1) + 1);
    }
    return out;
  }

  function alphaBytes(palette, opts) {
    opts = opts || {};
    var n = palette.length;
    if (!n) return null;
    var alpha = new Uint8Array(n);
    for (var i = 0; i < n; i++) alpha[i] = 255;
    var any = false;
    if (opts.alpha) {
      var a = u8of(opts.alpha);
      for (var j = 0; j < n && j < a.length; j++) {
        alpha[j] = a[j];
        if (a[j] !== 255) any = true;
      }
    }
    var holes = opts.transparent;
    if (holes == null && opts.skip != null) holes = opts.skip;
    if (holes != null) {
      var list = typeof holes === 'number' ? [holes] : holes;
      for (var k = 0; k < list.length; k++) {
        var idx = list[k] | 0;
        if (idx >= 0 && idx < n) { alpha[idx] = 0; any = true; }
      }
    }
    if (!any) return null;
    var last = n;
    while (last > 0 && alpha[last - 1] === 255) last--;
    return last ? alpha.subarray(0, last) : null;
  }

  /**
   * Color-type 3 PNG. palette is [r,g,b][] or packed RGB bytes.
   * opts.transparent: index or array of fully transparent indices.
   * opts.alpha: per-index alpha (0–255), length ≤ palette.
   */
  function encodePng8(width, height, pixels, palette, opts) {
    width = width | 0;
    height = height | 0;
    if (width < 1 || height < 1) throw new Error('PNG size must be at least 1×1');
    var colors = rgbList(palette);
    if (!colors.length) throw new Error('PNG needs a palette');
    var src = u8of(pixels);
    if (src.length < width * height) throw new Error('PNG pixels shorter than width×height');
    var plte = new Uint8Array(colors.length * 3);
    for (var i = 0; i < colors.length; i++) plte.set(colors[i], i * 3);
    var ihdr = new Uint8Array(13);
    ihdr.set(be32(width), 0);
    ihdr.set(be32(height), 4);
    ihdr[8] = 8;
    ihdr[9] = 3;
    var chunks = [
      Uint8Array.from(PNG_SIG),
      pngChunk('IHDR', ihdr),
      pngChunk('PLTE', plte)
    ];
    var trns = alphaBytes(colors, opts);
    if (trns) chunks.push(pngChunk('tRNS', trns));
    chunks.push(pngChunk('IDAT', zlibStore(scanlines(width, height, src))));
    chunks.push(pngChunk('IEND', new Uint8Array(0)));
    return concat(chunks);
  }

  /** Windows BMP, 8-bit indexed, top-down, 256 BGRA palette entries. */
  function encodeBmp8(width, height, pixels, palette, opts) {
    width = width | 0;
    height = height | 0;
    if (width < 1 || height < 1) throw new Error('BMP size must be at least 1×1');
    var colors = rgbList(palette);
    var src = u8of(pixels);
    if (src.length < width * height) throw new Error('BMP pixels shorter than width×height');
    var rowStride = (width + 3) & ~3;
    var pixelBytes = rowStride * height;
    var palBytes = 256 * 4;
    var header = 14 + 40;
    var offBits = header + palBytes;
    var fileSize = offBits + pixelBytes;
    var out = new Uint8Array(fileSize);
    out[0] = 0x42; out[1] = 0x4d;
    out.set(le32(fileSize), 2);
    out.set(le32(offBits), 10);
    out.set(le32(40), 14);
    out.set(le32(width), 18);
    out.set(le32((-height) >>> 0), 22);
    out.set(le16(1), 26);
    out.set(le16(8), 28);
    out.set(le32(pixelBytes), 34);
    out.set(le32(256), 46);
    var holes = {};
    var trans = (opts && (opts.transparent != null ? opts.transparent : opts.skip));
    if (trans != null) {
      var list = typeof trans === 'number' ? [trans] : trans;
      for (var t = 0; t < list.length; t++) holes[list[t] | 0] = true;
    }
    for (var i = 0; i < 256; i++) {
      var rgb = colors[i] || [0, 0, 0];
      var o = header + i * 4;
      out[o] = rgb[2];
      out[o + 1] = rgb[1];
      out[o + 2] = rgb[0];
      out[o + 3] = 0;
      if (holes[i] && !colors[i]) {
        /* unused hole index stays black */
      }
    }
    var row = new Uint8Array(rowStride);
    for (var y = 0; y < height; y++) {
      row.fill(0);
      row.set(src.subarray(y * width, y * width + width));
      out.set(row, offBits + y * rowStride);
    }
    return out;
  }

  return { encodePng8: encodePng8, encodeBmp8: encodeBmp8, zlibStore: zlibStore, crc32: crc32 };
});
