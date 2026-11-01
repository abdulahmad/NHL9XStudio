/**
 * NHL 94 PC PPV / unpacked QPP shape banks.
 *
 * Not the NHL 95 PC format (SHPI + SPIT). Each 94 shape is four VGA Mode X
 * planes, PackBits-packed, as documented in EA-NHL-Tools PPV94-To-BMP (PR #154)
 * and NHL94PC docs/PPV_FORMAT.md (PR #51).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlPc94Shape = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TRANSPARENT = 0xff;

  function bytesOf(buffer) {
    if (buffer instanceof Uint8Array) return buffer;
    return new Uint8Array(buffer);
  }
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function s16(b, o) { const v = u16(b, o); return v & 0x8000 ? v - 0x10000 : v; }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  function unpackPlane(b, pos, expect) {
    const out = new Uint8Array(expect);
    let n = 0;
    for (;;) {
      if (pos >= b.length) throw new Error('PPV94: plane runs past end of data');
      const c = b[pos++];
      if (c === 0) break;
      if (c < 0x80) {
        const v = b[pos++];
        for (let i = 0; i < c; i++) {
          if (n < expect) out[n] = v;
          n += 1;
        }
      } else {
        const len = 256 - c;
        for (let i = 0; i < len; i++) {
          if (n < expect) out[n] = b[pos + i];
          n += 1;
        }
        pos += len;
      }
    }
    if (n !== expect) throw new Error('PPV94: plane unpacked to ' + n + ' bytes, expected ' + expect);
    return { data: out, pos };
  }

  function packPlane(bytes) {
    const out = [];
    let i = 0;
    while (i < bytes.length) {
      const n = Math.min(127, bytes.length - i);
      out.push((256 - n) & 255);
      for (let j = 0; j < n; j++) out.push(bytes[i++]);
    }
    out.push(0);
    return out;
  }

  function tagAt(b, o) {
    return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  }

  /**
   * A 94 bank: u32 unpackedSize, u16 count, count × 4-char names, count × u32
   * offsets from 6+8*count, then 16-byte headers with flags 0x0010.
   */
  function isBank(buffer) {
    const b = bytesOf(buffer);
    if (!b || b.length < 22) return false;
    if (b[1] === 0xfb) return false;
    const magic = tagAt(b, 0);
    if (magic === 'SHPP' || magic === 'SHPS' || magic === 'SHPI' || magic === 'SHPM') return false;
    const count = u16(b, 4);
    if (count < 1 || count > 2000) return false;
    const tableEnd = 6 + 8 * count;
    if (tableEnd + 16 > b.length) return false;
    const firstOff = tableEnd + u32(b, 6 + 4 * count);
    if (firstOff < tableEnd || firstOff + 16 > b.length) return false;
    const flags = u16(b, firstOff + 14);
    if (flags !== 0x0010) return false;
    const quads = s16(b, firstOff);
    const height = s16(b, firstOff + 2);
    if (quads < 0 || height < 0 || quads > 512 || height > 2048) return false;
    return true;
  }

  function parseBank(buffer) {
    const b = bytesOf(buffer);
    if (b.length < 6) throw new Error('PPV94: file too short');
    if (b[0] === 0x30 && b[1] === 0xfb) throw new Error('PPV94: EA Huffman packed (30 FB); unpack it first');
    const unpackedSize = u32(b, 0);
    const count = u16(b, 4);
    const tableEnd = 6 + 8 * count;
    if (count === 0 || tableEnd > b.length) throw new Error('PPV94: bad entry count');
    const entries = [];
    for (let i = 0; i < count; i++) {
      const name = tagAt(b, 6 + 4 * i);
      const offset = u32(b, 6 + 4 * count + 4 * i);
      entries.push({ index: i, name, offset: tableEnd + offset });
    }
    let expanded = tableEnd;
    for (const e of entries) {
      const o = e.offset;
      if (o + 16 > b.length) throw new Error('PPV94: entry ' + e.name + ' past end');
      e.quads = s16(b, o);
      e.height = s16(b, o + 2);
      e.width = e.quads * 4;
      e.hotX = s16(b, o + 4);
      e.hotY = s16(b, o + 6);
      e.srcX = s16(b, o + 8);
      e.srcY = s16(b, o + 10);
      e.extra = s16(b, o + 12);
      e.flags = u16(b, o + 14);
      if (e.name.charAt(0) === '!') {
        e.kind = 'palette';
        e.palette = b.subarray(o + 16, o + 16 + 768);
        expanded += 16 + 768;
        continue;
      }
      e.kind = 'shape';
      const planeSize = e.quads * e.height;
      let pos = o + 16;
      e.planes = [];
      for (let p = 0; p < 4; p++) {
        const r = unpackPlane(b, pos, planeSize);
        e.planes.push(r.data);
        pos = r.pos;
      }
      e.packedEnd = pos;
      expanded += 16 + 4 * planeSize;
    }
    return { unpackedSize, expandedSize: expanded, entries };
  }

  function toLinear(e) {
    const w = e.width;
    const h = e.height;
    const q = e.quads;
    const out = new Uint8Array(w * h);
    for (let p = 0; p < 4; p++) {
      const plane = e.planes[p];
      for (let y = 0; y < h; y++) {
        for (let i = 0; i < q; i++) out[y * w + i * 4 + p] = plane[y * q + i];
      }
    }
    return out;
  }

  function vgaToRgb(pal) {
    const src = pal instanceof Uint8Array ? pal : new Uint8Array(pal);
    const out = [];
    for (let i = 0; i < 256; i++) {
      const r = src[i * 3] || 0;
      const g = src[i * 3 + 1] || 0;
      const b = src[i * 3 + 2] || 0;
      out.push([
        Math.min(255, Math.round((r & 63) * 255 / 63)),
        Math.min(255, Math.round((g & 63) * 255 / 63)),
        Math.min(255, Math.round((b & 63) * 255 / 63))
      ]);
    }
    return out;
  }

  function openBank(buffer) {
    const bank = parseBank(buffer);
    const shapes = [];
    let palette = null;
    for (const e of bank.entries) {
      if (e.kind === 'palette') {
        if (e.name === '!pal' || !palette) palette = vgaToRgb(e.palette);
        continue;
      }
      shapes.push({
        width: e.width,
        height: e.height,
        xOffset: e.hotX,
        yOffset: e.hotY,
        xPos: e.srcX,
        yPos: e.srcY,
        hotX: e.hotX,
        hotY: e.hotY,
        pixels: toLinear(e),
        tag: e.name.replace(/ +$/, ''),
        transparent: TRANSPARENT
      });
    }
    return { shapes, palette, bank };
  }

  /** Build a tiny unpacked 94 bank (tests / fixtures). */
  function encodeBank(entries) {
    const count = entries.length;
    const tableEnd = 6 + 8 * count;
    const blobs = [];
    const offsets = [];
    let pos = 0;
    for (const e of entries) {
      offsets.push(pos);
      if (e.palette) {
        const pal = e.palette instanceof Uint8Array ? e.palette : new Uint8Array(e.palette);
        const head = new Uint8Array(16 + 768);
        head[0] = 192; // quads = 192 (width 768)
        head[2] = 1; // height
        head[14] = 0x10;
        head.set(pal.subarray(0, 768), 16);
        blobs.push(head);
        pos += head.length;
        continue;
      }
      const w = e.width;
      const h = e.height;
      const quads = w / 4;
      const planes = [new Uint8Array(quads * h), new Uint8Array(quads * h), new Uint8Array(quads * h), new Uint8Array(quads * h)];
      const px = e.pixels;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) planes[x & 3][y * quads + (x >> 2)] = px[y * w + x];
      }
      const packed = [];
      for (let p = 0; p < 4; p++) packed.push.apply(packed, packPlane(planes[p]));
      const head = new Uint8Array(16 + packed.length);
      head[0] = quads & 255;
      head[1] = (quads >> 8) & 255;
      head[2] = h & 255;
      head[3] = (h >> 8) & 255;
      const hx = e.hotX || 0;
      const hy = e.hotY || 0;
      head[4] = hx & 255;
      head[5] = (hx >> 8) & 255;
      head[6] = hy & 255;
      head[7] = (hy >> 8) & 255;
      head[14] = 0x10;
      head.set(packed, 16);
      blobs.push(head);
      pos += head.length;
    }
    const out = new Uint8Array(tableEnd + pos);
    const view = new DataView(out.buffer);
    view.setUint32(0, tableEnd + pos, true);
    view.setUint16(4, count, true);
    for (let i = 0; i < count; i++) {
      const name = (entries[i].name || '0000').padEnd(4, ' ').slice(0, 4);
      for (let k = 0; k < 4; k++) out[6 + i * 4 + k] = name.charCodeAt(k);
      view.setUint32(6 + 4 * count + i * 4, offsets[i], true);
    }
    let w = tableEnd;
    for (const blob of blobs) {
      out.set(blob, w);
      w += blob.length;
    }
    return out;
  }

  return {
    TRANSPARENT,
    isBank,
    parseBank,
    unpackPlane,
    toLinear,
    vgaToRgb,
    openBank,
    encodeBank
  };
});
