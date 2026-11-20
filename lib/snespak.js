/**
 * Unpack the two SNES graphics compressors used by the EA NHL ports.
 *
 * NHLPA 93 streams are the control-byte format of DecompressGraphics ($86FA3E).
 * NHL 94 streams start with a format word and an unpacked size, and Decompress
 * ($80C373) picks LZ, Huffman, RLE or byte-pair codes. Both ports follow the
 * Python unpackers in those disassemblies.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Nhl92SnesPak = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function lorom(addr) {
    return ((addr >> 16) & 0x7f) * 0x8000 + (addr & 0x7fff);
  }

  function unpack93(data, start) {
    const src = data instanceof Uint8Array ? data : new Uint8Array(data);
    let p = start || 0;
    const out = [];
    function nx() {
      if (p >= src.length) throw new Error('packed stream ended early');
      return src[p++];
    }
    for (;;) {
      const c = nx();
      if ((c & 0xe0) === 0x00) {
        const n = (c & 0x1f) + 1;
        for (let i = 0; i < n; i++) out.push(nx());
        continue;
      }
      if ((c & 0xf0) === 0x20) {
        const n = (c & 0x0f) + 1;
        for (let i = 0; i < n; i++) out.push(0);
        continue;
      }
      if ((c & 0xf0) === 0x30) {
        const v = nx();
        const n = (c & 0x0f) + 3;
        for (let i = 0; i < n; i++) out.push(v);
        continue;
      }
      let dist;
      let n;
      let up;
      if ((c & 0xc0) === 0x40) {
        dist = ((c >> 3) & 7) + 1;
        n = (c & 7) + 2;
        up = true;
      } else if ((c & 0xf0) === 0x80) {
        n = (c & 0x0f) + 3;
        dist = nx();
        up = true;
      } else if ((c & 0xf0) === 0x90) {
        const x = nx();
        dist = (x & 0x7f) + 1;
        n = (((c << 1) | (x >> 7)) & 0x1f) + 3;
        up = true;
      } else if ((c & 0xf0) === 0xa0) {
        const x = nx();
        dist = (x & 0x3f) + 1;
        n = (((c << 2) | (x >> 6)) & 0x3f) + 3;
        up = true;
      } else if ((c & 0xf0) === 0xb0) {
        const x = nx();
        dist = (x & 0x1f) + 1;
        n = (((c << 3) | (x >> 5)) & 0x7f) + 3;
        up = true;
      } else if ((c & 0xe0) === 0xc0) {
        dist = ((c >> 2) & 7) + 1;
        n = (c & 3) + 2;
        up = false;
      } else if ((c & 0xf0) === 0xe0) {
        n = (c & 0x0f) + 3;
        dist = nx();
        up = false;
        if (dist === 0) return new Uint8Array(out);
      } else {
        const x = nx();
        dist = (x & 0x7f) + 1;
        n = (((c << 1) | (x >> 7)) & 0x1f) + 3;
        up = false;
      }
      let srcAt = out.length - dist;
      for (let i = 0; i < n; i++) {
        if (srcAt < 0 || srcAt >= out.length) throw new Error('packed back-reference is out of range');
        out.push(out[srcAt]);
        srcAt += up ? 1 : -1;
      }
    }
  }

  const FORMATS = { 0xfb10: 'lz', 0xfb46: 'pairs', 0xfb30: 'huffman', 0xfb7a: 'rle' };

  function header94(src, p) {
    return {
      format: src[p] | (src[p + 1] << 8),
      size: (src[p + 2] << 16) | (src[p + 3] << 8) | src[p + 4]
    };
  }

  function unpackLz(src, p, size) {
    let i = p + 5;
    const out = [];
    while (out.length <= size) {
      const b0 = src[i];
      let n;
      let ln;
      let off;
      if (b0 < 0x80) {
        const b1 = src[i + 1];
        i += 2;
        n = b0 & 3;
        for (let k = 0; k < n; k++) out.push(src[i++]);
        ln = ((b0 & 0x1c) >> 2) + 3;
        off = ((b0 & 0x60) << 3) + b1 + 1;
      } else if (b0 < 0xc0) {
        const b1 = src[i + 1];
        const b2 = src[i + 2];
        i += 3;
        n = b1 >> 6;
        for (let k = 0; k < n; k++) out.push(src[i++]);
        ln = (b0 & 0x3f) + 4;
        off = ((b1 & 0x3f) << 8) + b2 + 1;
      } else if (b0 < 0xe0) {
        const b1 = src[i + 1];
        const b2 = src[i + 2];
        const b3 = src[i + 3];
        i += 4;
        n = b0 & 3;
        for (let k = 0; k < n; k++) out.push(src[i++]);
        ln = ((b0 & 0x0c) << 6) + b3 + 5;
        off = ((b0 & 0x10) << 12) + (b1 << 8) + b2 + 1;
      } else if (b0 < 0xfc) {
        n = ((b0 & 0x1f) + 1) * 4;
        i += 1;
        for (let k = 0; k < n; k++) out.push(src[i++]);
        continue;
      } else {
        n = b0 & 3;
        i += 1;
        for (let k = 0; k < n; k++) out.push(src[i++]);
        return new Uint8Array(out);
      }
      if (off > out.length || out.length + ln > size) throw new Error('not LZ data');
      for (let k = 0; k < ln; k++) out.push(out[out.length - off]);
    }
    throw new Error('not LZ data');
  }

  function unpackPairs(src, p, size) {
    const esc = src[p + 5];
    const npairs = src[p + 6];
    const kind = new Int16Array(256);
    const first = new Uint8Array(256);
    const second = new Uint8Array(256);
    kind[esc] = 1;
    let i = p + 7;
    for (let n = 0; n < npairs; n++) {
      const c = src[i];
      first[c] = src[i + 1];
      second[c] = src[i + 2];
      kind[c] -= 1;
      i += 3;
    }
    const out = [];
    function expand(c, depth) {
      if (depth > 256 || out.length > size) throw new Error('pair codes loop');
      for (const x of [first[c], second[c]]) {
        if (kind[x]) expand(x, depth + 1);
        else out.push(x);
      }
    }
    while (out.length <= size) {
      const c = src[i++];
      if (kind[c] === 0) out.push(c);
      else if (kind[c] > 0) {
        const lit = src[i++];
        if (lit === 0) return new Uint8Array(out);
        out.push(lit);
      } else expand(c, 0);
    }
    throw new Error('not pair data');
  }

  function unpackRle(src, p, size) {
    const unit = src[p + 5] === 1 && src[p + 6] === 1 ? 1 : 2;
    let i = p + 7;
    const out = [];
    while (out.length <= size) {
      const c = src[i++];
      if (c === 0) return new Uint8Array(out);
      if (c & 0x80) {
        const n = (c ^ 0xff) + 1;
        for (let k = 0; k < n * unit; k++) out.push(src[i++]);
      } else {
        const item = src.subarray(i, i + unit);
        i += unit;
        for (let r = 0; r < c + 1; r++) for (let k = 0; k < unit; k++) out.push(item[k]);
      }
    }
    throw new Error('not RLE data');
  }

  function Bits(src, i) {
    this.src = src;
    this.i = i;
    this.acc = 0;
    this.n = 0;
  }
  Bits.prototype.peek = function (k) {
    while (this.n < k) {
      if (this.i >= this.src.length) throw new Error('Huffman data runs past the end');
      this.acc = (this.acc << 8) | this.src[this.i];
      this.i += 1;
      this.n += 8;
    }
    return (this.acc >>> (this.n - k)) & ((1 << k) - 1);
  };
  Bits.prototype.get = function (k) {
    const v = this.peek(k);
    this.n -= k;
    this.acc &= (1 << this.n) - 1;
    return v;
  };
  Bits.prototype.num = function () {
    let z = 0;
    if (!this.get(1)) {
      z = 1;
      while (!this.get(1)) {
        z += 1;
        if (z > 16) throw new Error('not Huffman data');
      }
    }
    return this.get(z + 2) + (1 << (z + 2)) - 4;
  };

  function unpackHuffman(src, p, size) {
    const clue = src[p + 5];
    const bits = new Bits(src, p + 6);
    const counts = [];
    let code = 0;
    let total = 0;
    for (;;) {
      code <<= 1;
      const c = bits.num();
      counts.push(c);
      total += c;
      code += c;
      if ((c && (code << (16 - counts.length)) >= 0x10000) || counts.length > 16) break;
    }
    const used = new Array(256).fill(false);
    const symbols = [];
    let x = -1;
    for (let n = 0; n < total; n++) {
      let k = (bits.num() + 1) & 0xff;
      if (k === 0) k = 256;
      while (k) {
        x = (x + 1) & 0xff;
        if (!used[x]) k -= 1;
      }
      used[x] = true;
      symbols.push(x);
    }
    const table = new Map();
    code = 0;
    let s = 0;
    for (let ln = 1; ln <= counts.length; ln++) {
      for (let n = 0; n < counts[ln - 1]; n++) {
        table.set(ln + ':' + code, symbols[s]);
        code += 1;
        s += 1;
      }
      code <<= 1;
    }
    const out = [];
    let last = 0;
    while (out.length <= size) {
      let ln = 0;
      let v = 0;
      while (!table.has(ln + ':' + v)) {
        v = (v << 1) | bits.get(1);
        ln += 1;
        if (ln > counts.length) throw new Error('Huffman code not in the table');
      }
      const sym = table.get(ln + ':' + v);
      if (sym !== clue) {
        out.push(sym);
        last = sym;
        continue;
      }
      const n = bits.num();
      if (n) {
        for (let k = 0; k < n; k++) out.push(last);
      } else if (bits.get(1)) {
        return new Uint8Array(out);
      } else {
        last = bits.get(8);
        out.push(last);
      }
    }
    throw new Error('Huffman output runs past the size');
  }

  const UNPACK94 = {
    0xfb10: unpackLz,
    0xfb46: unpackPairs,
    0xfb30: unpackHuffman,
    0xfb7a: unpackRle
  };

  function unpack94(data, start) {
    const src = data instanceof Uint8Array ? data : new Uint8Array(data);
    const p = start || 0;
    const head = header94(src, p);
    const fn = UNPACK94[head.format];
    if (!fn) throw new Error('unknown packed format $' + head.format.toString(16));
    const out = fn(src, p, head.size);
    if (out.length !== head.size) {
      throw new Error(FORMATS[head.format] + ' unpacked ' + out.length + ' bytes, header says ' + head.size);
    }
    return out;
  }

  function isPacked94(data, start) {
    const src = data instanceof Uint8Array ? data : new Uint8Array(data);
    const p = start || 0;
    if (src.length < p + 5) return false;
    return !!FORMATS[src[p] | (src[p + 1] << 8)];
  }

  function formatName(word) {
    return FORMATS[word] || null;
  }

  function packedHeader(format, size) {
    const out = new Uint8Array(5);
    out[0] = format & 255;
    out[1] = format >> 8;
    out[2] = (size >> 16) & 255;
    out[3] = (size >> 8) & 255;
    out[4] = size & 255;
    return out;
  }

  function concatPacked(header, rest) {
    const out = new Uint8Array(header.length + rest.length);
    out.set(header, 0);
    out.set(rest, header.length);
    return out;
  }

  function asBytes(data) {
    return data instanceof Uint8Array ? data : new Uint8Array(data || []);
  }

  function packRle(data, unit) {
    const src = asBytes(data);
    const u = unit === 1 ? 1 : 2;
    const body = [];
    body.push(u === 1 ? 1 : 2, u === 1 ? 1 : 0);
    let i = 0;
    while (i + u <= src.length) {
      const item = src.subarray(i, i + u);
      let run = 1;
      while (i + (run + 1) * u <= src.length) {
        let same = true;
        for (let k = 0; k < u; k++) {
          if (src[i + run * u + k] !== item[k]) { same = false; break; }
        }
        if (!same) break;
        run += 1;
        if (run >= 128) break;
      }
      if (run >= 2) {
        body.push(run - 1);
        for (let k = 0; k < u; k++) body.push(item[k]);
        i += run * u;
        continue;
      }
      const litAt = i;
      let items = 0;
      while (litAt + (items + 1) * u <= src.length && items < 128) {
        let nextRun = 1;
        while (nextRun < 2 && litAt + (items + nextRun + 1) * u <= src.length) {
          let same = true;
          for (let k = 0; k < u; k++) {
            if (src[litAt + (items + nextRun) * u + k] !== src[litAt + items * u + k]) { same = false; break; }
          }
          if (!same) break;
          nextRun += 1;
        }
        if (nextRun >= 2 && items) break;
        items += 1;
      }
      const n = items;
      body.push((0x100 - n) & 0xff);
      for (let k = 0; k < n * u; k++) body.push(src[litAt + k]);
      i = litAt + n * u;
    }
    if (i < src.length) {
      // Odd trailing byte when unit is 2: dump as unit-1 literals instead.
      return packRle(src, 1);
    }
    body.push(0);
    return concatPacked(packedHeader(0xfb7a, src.length), Uint8Array.from(body));
  }

  function matchLen(src, p, off, cap) {
    let n = 0;
    const max = Math.min(cap, src.length - p);
    while (n < max && src[p + n] === src[p - off + n]) n += 1;
    return n;
  }

  function findLzMatch(src, p) {
    let bestLn = 0;
    let bestOff = 0;
    const remain = src.length - p;
    const maxOff = Math.min(p, 0x1ffff);
    for (let off = 1; off <= maxOff; off++) {
      const cap = Math.min(1028, remain);
      const ln = matchLen(src, p, off, cap);
      const ok = (off <= 0x400 && ln >= 3) || (off <= 0x4000 && ln >= 4) || ln >= 5;
      if (ok && ln > bestLn) {
        bestLn = ln;
        bestOff = off;
      }
    }
    return bestLn ? { ln: bestLn, off: bestOff } : null;
  }

  function packLz(data) {
    const src = asBytes(data);
    const size = src.length;
    const body = [];
    function flushLitRuns(from, n) {
      let i = 0;
      while (n - i >= 4) {
        const chunk = Math.min(112, (n - i) & ~3);
        body.push(0xe0 + (chunk / 4 - 1));
        for (let k = 0; k < chunk; k++) body.push(src[from + i + k]);
        i += chunk;
      }
      return n - i;
    }
    function emitCopy(litAt, lits, ln, off) {
      const n = lits;
      if (off <= 0x400 && ln >= 3 && ln <= 10) {
        body.push((n & 3) | (((ln - 3) & 7) << 2) | (((off - 1) >> 3) & 0x60), (off - 1) & 255);
      } else if (off <= 0x4000 && ln >= 4 && ln <= 67) {
        body.push(0x80 | ((ln - 4) & 0x3f), ((n & 3) << 6) | (((off - 1) >> 8) & 0x3f), (off - 1) & 255);
      } else {
        const dist = off - 1;
        body.push(
          0xc0 | (n & 3) | (((ln - 5) >> 6) & 0x0c) | ((dist >> 12) & 0x10),
          (dist >> 8) & 255,
          dist & 255,
          (ln - 5) & 255
        );
      }
      for (let k = 0; k < n; k++) body.push(src[litAt + k]);
    }
    let p = 0;
    let litAt = 0;
    while (p < size) {
      const m = findLzMatch(src, p);
      if (m && p + m.ln <= size) {
        let pending = p - litAt;
        const left = flushLitRuns(litAt, pending);
        litAt = p - left;
        pending = left;
        if (pending > 3) {
          // Should not happen: flushLitRuns leaves at most 3.
          throw new Error('LZ pending literals');
        }
        emitCopy(litAt, pending, m.ln, m.off);
        p += m.ln;
        litAt = p;
        continue;
      }
      p += 1;
    }
    const left = flushLitRuns(litAt, size - litAt);
    const restAt = size - left;
    body.push(0xfc | (left & 3));
    for (let k = 0; k < left; k++) body.push(src[restAt + k]);
    return concatPacked(packedHeader(0xfb10, size), Uint8Array.from(body));
  }

  function BitWriter() {
    this.bytes = [];
    this.acc = 0;
    this.n = 0;
  }
  BitWriter.prototype.put = function (v, k) {
    for (let i = k - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((v >> i) & 1);
      this.n += 1;
      if (this.n === 8) {
        this.bytes.push(this.acc & 255);
        this.acc = 0;
        this.n = 0;
      }
    }
  };
  BitWriter.prototype.num = function (value) {
    let n = value >>> 0;
    let z = 0;
    while (n >= (1 << (z + 3)) - 4) {
      z += 1;
      if (z > 16) throw new Error('Huffman num too large');
    }
    for (let i = 0; i < z; i++) this.put(0, 1);
    this.put(1, 1);
    this.put(n - ((1 << (z + 2)) - 4), z + 2);
  };
  BitWriter.prototype.finish = function () {
    if (this.n) this.bytes.push((this.acc << (8 - this.n)) & 255);
    return Uint8Array.from(this.bytes);
  };

  function huffmanLengths(freq) {
    const nodes = [];
    for (let s = 0; s < 256; s++) {
      if (freq[s]) nodes.push({ s: s, f: freq[s], l: null, r: null });
    }
    if (!nodes.length) return new Uint8Array(256);
    if (nodes.length === 1) {
      const len = new Uint8Array(256);
      len[nodes[0].s] = 1;
      const dummy = nodes[0].s === 0 ? 1 : 0;
      len[dummy] = 1;
      return len;
    }
    while (nodes.length > 1) {
      nodes.sort((a, b) => a.f - b.f);
      const a = nodes.shift();
      const b = nodes.shift();
      nodes.push({ s: -1, f: a.f + b.f, l: a, r: b });
    }
    const len = new Uint8Array(256);
    (function walk(node, d) {
      if (node.s >= 0) {
        len[node.s] = Math.max(1, d);
        return;
      }
      walk(node.l, d + 1);
      walk(node.r, d + 1);
    })(nodes[0], 0);
    for (let s = 0; s < 256; s++) if (len[s] > 16) len[s] = 16;
    return len;
  }

  function packHuffman(data) {
    const src = asBytes(data);
    const freq = new Uint32Array(256);
    for (let i = 0; i < src.length; i++) freq[src[i]] += 1;
    let clue = 0;
    for (let s = 0; s < 256; s++) {
      if (!freq[s]) { clue = s; break; }
      clue = s;
    }
    freq[clue] += 1;
    const len = huffmanLengths(freq);
    if (!len[clue]) len[clue] = 1;
    const counts = [];
    const grouped = [];
    let maxLen = 0;
    for (let s = 0; s < 256; s++) if (len[s]) maxLen = Math.max(maxLen, len[s]);
    for (let ln = 1; ln <= Math.max(1, maxLen); ln++) {
      const here = [];
      for (let s = 0; s < 256; s++) if (len[s] === ln) here.push(s);
      counts[ln - 1] = here.length;
      grouped.push(here);
    }
    const bits = new BitWriter();
    let code = 0;
    let emitted = 0;
    for (let i = 0; i < counts.length; i++) {
      code <<= 1;
      bits.num(counts[i]);
      code += counts[i];
      emitted = i + 1;
      if ((counts[i] && (code << (16 - (i + 1))) >= 0x10000) || i + 1 > 16) break;
    }
    let x = -1;
    const used = new Uint8Array(256);
    for (let g = 0; g < emitted; g++) {
      for (let n = 0; n < grouped[g].length; n++) {
        const want = grouped[g][n];
        let k = 0;
        do {
          x = (x + 1) & 255;
          if (!used[x]) k += 1;
        } while (x !== want);
        used[want] = 1;
        bits.num((k - 1) & 255);
      }
    }
    const table = {};
    code = 0;
    for (let ln = 1; ln <= grouped.length; ln++) {
      for (let n = 0; n < grouped[ln - 1].length; n++) {
        table[grouped[ln - 1][n]] = { ln: ln, code: code };
        code += 1;
      }
      code <<= 1;
    }
    function putSym(s) {
      const e = table[s];
      if (!e) throw new Error('Huffman symbol $' + s.toString(16) + ' has no code');
      bits.put(e.code, e.ln);
    }
    let last = 0;
    let i = 0;
    while (i < src.length) {
      const b = src[i];
      if (i && b === last) {
        let n = 0;
        while (i + n < src.length && src[i + n] === last && n < 0x10000) n += 1;
        putSym(clue);
        bits.num(n);
        i += n;
        continue;
      }
      if (b === clue || !table[b]) {
        putSym(clue);
        bits.num(0);
        bits.put(0, 1);
        bits.put(b, 8);
        last = b;
        i += 1;
        continue;
      }
      putSym(b);
      last = b;
      i += 1;
    }
    putSym(clue);
    bits.num(0);
    bits.put(1, 1);
    return concatPacked(packedHeader(0xfb30, src.length), concatPacked(Uint8Array.of(clue), bits.finish()));
  }

  function packPairs(data) {
    const src = asBytes(data);
    const used = new Uint8Array(256);
    for (let i = 0; i < src.length; i++) used[src[i]] = 1;
    let esc = 0;
    for (let s = 255; s >= 1; s--) {
      if (!used[s]) { esc = s; break; }
      esc = s;
    }
    const body = [esc, 0];
    for (let i = 0; i < src.length; i++) {
      const b = src[i];
      if (b === esc) {
        body.push(esc, b);
      } else {
        body.push(b);
      }
    }
    body.push(esc, 0);
    return concatPacked(packedHeader(0xfb46, src.length), Uint8Array.from(body));
  }

  const PACK94 = {
    lz: packLz,
    huffman: packHuffman,
    rle: packRle,
    pairs: packPairs
  };
  const FORMAT_WORD = { lz: 0xfb10, huffman: 0xfb30, rle: 0xfb7a, pairs: 0xfb46 };
  const WORD_FORMAT = { 0xfb10: 'lz', 0xfb30: 'huffman', 0xfb7a: 'rle', 0xfb46: 'pairs' };

  function pack94(data, format, options) {
    const src = asBytes(data);
    let name = format;
    if (typeof format === 'number') name = WORD_FORMAT[format];
    if (format === 'raw' || format === 0) return src;
    if (!name || !PACK94[name]) name = 'rle';
    const packed = name === 'rle'
      ? packRle(src, (options && options.unit) || (src.length % 2 === 0 ? 2 : 1))
      : PACK94[name](src);
    const back = unpack94(packed, 0);
    if (back.length !== src.length) throw new Error(name + ' packed size mismatch');
    for (let i = 0; i < src.length; i++) {
      if (back[i] !== src[i]) throw new Error(name + ' packed bytes did not round-trip at ' + i);
    }
    return packed;
  }

  return {
    lorom, unpack93, unpack94, pack94, isPacked94, formatName, FORMATS, FORMAT_WORD,
    packRle, packLz, packHuffman, packPairs
  };
});
