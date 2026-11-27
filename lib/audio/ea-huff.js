/**
 * EA "Huffman" packed data (headers 30 FB, 32 FB, 34 FB), as RefPackUnpack at
 * 126B80 in NHL 97 PC runs it. The stream is read MSB first.
 *
 * Header: 2-byte type, optional 3-byte packed size (type byte bit 0), 3-byte
 * unpacked size. Then one escape byte, a table of code-length counts, the
 * symbol list, and the codes. The counts and symbol steps use one Elias-style
 * number: z zero bits, a one bit, then z + 2 bits give g = (1 << (z + 2)) +
 * those bits. A length count is g - 4. A symbol is the (g - 3)th unused byte
 * value after the previous symbol (wrapping, starting at 0). The code is
 * canonical. The escape symbol is followed by a number g: g > 4 repeats the
 * previous byte g - 4 times, g = 4 reads a bit: 0 is a literal byte (8 bits),
 * 1 ends the stream. Type 32 FB then runs a running sum over the bytes and
 * 34 FB a running sum of that.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlEaHuff = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isHuff(b) {
    return !!b && b.length >= 8 && b[1] === 0xFB && (b[0] & 0xFE) === 0x30 || !!b && b.length >= 8 && b[1] === 0xFB && (b[0] & 0xFE) === 0x32 || !!b && b.length >= 8 && b[1] === 0xFB && (b[0] & 0xFE) === 0x34;
  }

  function unpack(b) {
    if (!isHuff(b)) return null;
    const type = (b[0] << 8) | b[1];
    const base = type & 0xFEFF;
    let bitPos = (2 + ((b[0] & 1) ? 3 : 0)) * 8;
    const total = b.length * 8;
    function bit() {
      if (bitPos >= total) throw new Error('eof');
      const v = (b[bitPos >> 3] >> (7 - (bitPos & 7))) & 1;
      bitPos++;
      return v;
    }
    function bits(n) {
      let v = 0;
      for (let i = 0; i < n; i++) v = v * 2 + bit();
      return v;
    }
    function gamma() {
      let z = 0;
      while (bit() === 0) { z++; if (z > 24) throw new Error('gamma'); }
      return Math.pow(2, z + 2) + bits(z + 2);
    }
    try {
      const size = bits(24);
      if (size <= 0 || size > 64 * 1024 * 1024) return null;
      const esc = bits(8);
      const count = [0];
      let end = 0, all = 0;
      const first = [0], idxBase = [0];
      for (let len = 1; ; len++) {
        const prev2 = end * 2;
        const g = gamma();
        const n = g - 4;
        first[len] = prev2;
        idxBase[len] = all;
        count[len] = n;
        end = prev2 + n;
        all += n;
        if (n !== 0 && end === Math.pow(2, len)) { break; }
        if (len > 24) return null;
      }
      const maxLen = count.length - 1;
      const used = new Uint8Array(256);
      const syms = [];
      let al = 255;
      for (let i = 0; i < all; i++) {
        let m = gamma() - 3;
        while (m > 0) { al = (al + 1) & 255; if (!used[al]) m--; }
        used[al] = 1;
        syms.push(al);
      }
      const out = new Uint8Array(size);
      let w = 0;
      while (w < size) {
        let code = 0, len = 0, sym = -1;
        while (len < maxLen) {
          code = code * 2 + bit();
          len++;
          const d = code - first[len];
          if (count[len] && d >= 0 && d < count[len]) { sym = syms[idxBase[len] + d]; break; }
        }
        if (sym < 0) return null;
        if (sym !== esc) { out[w++] = sym; continue; }
        const g = gamma();
        if (g > 4) {
          const run = g - 4;
          const v = w ? out[w - 1] : 0;
          for (let i = 0; i < run && w < size; i++) out[w++] = v;
        } else if (g === 4) {
          if (bit()) break;
          out[w++] = bits(8);
        } else return null;
      }
      if (base === 0x32FB) {
        let s = 0;
        for (let i = 0; i < size; i++) { s = (s + out[i]) & 255; out[i] = s; }
      } else if (base === 0x34FB) {
        let s = 0, t = 0;
        for (let i = 0; i < size; i++) { s = (s + out[i]) & 255; t = (t + s) & 255; out[i] = t; }
      }
      return out;
    } catch (err) {
      return null;
    }
  }

  return { isHuff: isHuff, unpack: unpack };
});
