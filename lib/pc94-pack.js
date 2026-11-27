/**
 * NHL 94 PC EA packers from HOCKEY.EXE seg004: Huffman (30/31/32 FB) and
 * BTree (46/47 FB). Ported from EA-NHL-Tools QPP94-To-PNG (PR #153).
 * NHL 95 QFS uses RefPack 10 FB instead — that stays in pc95.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlPc94Pack = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function bytesOf(buffer) {
    if (buffer instanceof Uint8Array) return buffer;
    return new Uint8Array(buffer);
  }

  function isHuffman(bytes) {
    return bytes && bytes.length >= 5 && bytes[1] === 0xfb && bytes[0] >= 0x30 && bytes[0] <= 0x32;
  }

  function isBtree(bytes) {
    return bytes && bytes.length >= 5 && bytes[1] === 0xfb && (bytes[0] === 0x46 || bytes[0] === 0x47);
  }

  function isPacked(bytes) {
    return isHuffman(bytes) || isBtree(bytes);
  }

  function BitReader(data, pos) {
    this.d = data;
    this.p = pos;
    this.buf = 0;
    this.cnt = 0;
  }
  BitReader.prototype.get = function (n) {
    if (n > 16) {
      const hi = this.get(n - 16);
      return hi * 0x10000 + this.get(16);
    }
    const v = n ? this.buf >>> (32 - n) : 0;
    this.buf = n === 32 ? 0 : (this.buf << n) >>> 0;
    this.cnt -= n;
    while (this.cnt < 16) {
      const b = this.p < this.d.length ? this.d[this.p] : 0;
      this.p += 1;
      this.buf = (this.buf | (b << (24 - this.cnt))) >>> 0;
      this.cnt += 8;
    }
    return v;
  };
  BitReader.prototype.peek16 = function () {
    return this.buf >>> 16;
  };
  BitReader.prototype.vnum = function () {
    let v = 2;
    let n = 1;
    do {
      v *= 2;
      n += 1;
    } while (this.get(1) === 0);
    return this.get(n) + v - 4;
  };

  function unhuff(src) {
    const d = bytesOf(src);
    const type = (d[0] << 8) | d[1];
    let p = 2;
    if (type === 0x31fb) p += 3;
    const br = new BitReader(d, p);
    br.get(0);
    const size = br.get(24);
    const clue = br.get(8);
    if (size <= 0 || size > 32 * 1024 * 1024) throw new Error('pc94 huffman: bad size');
    const base = [];
    const lim = [];
    let num = 0;
    let len = 1;
    let code = 0;
    for (;;) {
      code = (code << 1) & 0xffff;
      base[len] = code - num;
      const n = br.vnum();
      num += n;
      code += n;
      const limit = n ? (code << (16 - len)) & 0xffff : 0;
      lim[len] = limit;
      len += 1;
      if (n !== 0 && limit === 0) break;
      if (len > 32) throw new Error('pc94 huffman: code table overflow');
    }
    const maxlen = len - 1;
    const used = new Uint8Array(256);
    const sym = [];
    let cur = -1;
    for (let i = 0; i < num; i++) {
      let skip = br.vnum() + 1;
      while (skip) {
        cur = (cur + 1) & 0xff;
        if (!used[cur]) skip -= 1;
      }
      used[cur] = 1;
      sym.push(cur);
    }
    const out = new Uint8Array(size);
    let o = 0;
    const put = (b) => {
      if (o < size) out[o] = b;
      o += 1;
    };
    for (;;) {
      const pk = br.peek16();
      let l = 1;
      while (l < maxlen && lim[l] <= pk) l += 1;
      const s = sym[(br.get(l) - base[l]) & 0xffff];
      if (s !== clue) {
        put(s);
        continue;
      }
      const n = br.vnum();
      if (n) {
        const prev = out[o - 1];
        for (let i = 0; i < n; i++) put(prev);
        continue;
      }
      if (br.get(1) === 0) {
        put(br.get(8));
        continue;
      }
      break;
    }
    if (type === 0x32fb) {
      let acc = 0;
      for (let i = 0; i < size; i++) {
        acc = (acc + out[i]) & 0xff;
        out[i] = acc;
      }
    }
    return out;
  }

  function unbtree(src) {
    const d = bytesOf(src);
    let p = 2;
    if (d[0] & 1) p += 3;
    const size = (d[p] << 16) | (d[p + 1] << 8) | d[p + 2];
    p += 3;
    const clue = d[p];
    const nodes = d[p + 1];
    p += 2;
    if (size <= 0 || size > 32 * 1024 * 1024) throw new Error('pc94 btree: bad size');
    const isNode = new Uint8Array(256);
    const left = new Uint8Array(256);
    const right = new Uint8Array(256);
    for (let i = 0; i < nodes; i++) {
      const b = d[p];
      isNode[b] = 1;
      left[b] = d[p + 1];
      right[b] = d[p + 2];
      p += 3;
    }
    const out = new Uint8Array(size);
    let o = 0;
    const stack = [];
    while (o < size && p < d.length) {
      const c = d[p++];
      if (c === clue) {
        out[o++] = d[p++];
        continue;
      }
      stack.push(c);
      while (stack.length && o < size) {
        const b = stack.pop();
        if (isNode[b]) {
          stack.push(right[b]);
          stack.push(left[b]);
        } else {
          out[o++] = b;
        }
      }
    }
    return out;
  }

  function unpack(src) {
    const d = bytesOf(src);
    if (isHuffman(d)) return { method: 'huffman', data: unhuff(d) };
    if (isBtree(d)) return { method: 'btree', data: unbtree(d) };
    return { method: 'none', data: d };
  }

  /** Wrap unpacked bytes as 46 FB with a clue that does not appear in `data`. */
  function wrapBtree(src) {
    const data = bytesOf(src);
    let clue = 0xfd;
    const used = new Uint8Array(256);
    for (let i = 0; i < data.length; i++) used[data[i]] = 1;
    while (used[clue] && clue > 0) clue -= 1;
    const out = new Uint8Array(7 + data.length);
    out[0] = 0x46;
    out[1] = 0xfb;
    out[2] = (data.length >> 16) & 255;
    out[3] = (data.length >> 8) & 255;
    out[4] = data.length & 255;
    out[5] = clue;
    out[6] = 0;
    out.set(data, 7);
    return out;
  }

  return { isHuffman, isBtree, isPacked, unhuff, unbtree, unpack, wrapBtree };
});
