/**
 * NHL 94 Sega CD movie files (.SEG on the disc: HOCKEY.SEG is the intro, the rest are goal, hit and Stanley Cup clips).
 *
 * A .SEG is a FILM container: 'FILM' + header length, an 'FDSC' block, then 'STAB' with a count of 16-byte records
 * (offset, length, time, duration). The video part of a record is an 'SM' image (STARTER.BIN LoadSmImage):
 *   $00  'SM'      $02 flags (low 2 bits = palette lines - 1)   $04 decoded size   $08 width in tiles   $0A height in tiles
 *   $0C  palette lines (32 bytes each, Genesis CRAM), then, when more than one line, 2 bits per tile naming the line
 *   then two long-prefixed tables (256 longs "A", 256 words "B"), a 2-bit-per-tile opcode stream, and the tile data.
 * Opcodes per 8x8 4bpp tile: 00 keep what the last frame left in that tile, 01 raw 32 bytes, 10 four pairs of A indexes,
 * 11 four groups of four B indexes. The player never clears word RAM, so a frame only holds what changed: decode them
 * in order and carry the tiles forward.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlSegaCdFilm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function u32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  function u16(b, o) { return (b[o] << 8) | b[o + 1]; }

  /** The video chunks of a FILM file: every 'SM' header whose size field matches its tile dimensions. */
  function smOffsets(bytes) {
    const out = [];
    for (let p = 0; p + 12 < bytes.length; p++) {
      if (bytes[p] !== 0x53 || bytes[p + 1] !== 0x4d) continue;
      const w = u16(bytes, p + 8);
      const h = u16(bytes, p + 10);
      if (!w || !h || w > 64 || h > 64) continue;
      const lines = (u16(bytes, p + 2) & 3) + 1;
      const n = w * h;
      const map = lines > 1 ? ((((2 * n + 0x1f) & 0xffff) >> 5) * 4) : 0;
      if (u32(bytes, p + 4) === 12 + 32 * lines + map + n * 32) out.push(p);
    }
    return out;
  }

  /** Decode one 'SM' chunk. prev is the tile bytes the last frame left behind (or null). */
  function decodeSm(c, start, prev) {
    const flags = u16(c, start + 2) & 3;
    const w = u16(c, start + 8);
    const h = u16(c, start + 10);
    const n = w * h;
    const d6 = (((2 * n + 0x1f) & 0xffff) >> 5) * 4;
    let pos = start + 12;
    const pals = c.subarray(pos, pos + 32 * (flags + 1));
    pos += 32 * (flags + 1);
    let lineMap = null;
    if (flags) { lineMap = c.subarray(pos, pos + d6); pos += d6; }
    const l1 = u32(c, pos); pos += 4;
    const a2 = pos; pos += l1;
    const l2 = u32(c, pos); pos += 4;
    const a3 = pos; pos += l2;
    let a4 = pos;
    pos += d6;
    let a1 = pos;
    const A = new Uint32Array(256);
    for (let i = 0; i < 256; i++) A[i] = u32(c, a2 + 4 * i);
    const B = new Uint16Array(256);
    for (let i = 0; i < 256; i++) B[i] = u16(c, a3 + 2 * i);
    const out = new Uint8Array(n * 32);
    let o = 0;
    let d1 = 0;
    let d2 = 0;
    let d3 = 1;
    let d5 = 0;
    const bit = () => { const v = (d5 >>> 31) & 1; d5 = (d5 << 1) >>> 0; return v; };
    const w32 = (v) => { out[o++] = v >>> 24; out[o++] = (v >>> 16) & 255; out[o++] = (v >>> 8) & 255; out[o++] = v & 255; };
    for (let t = 0; t < n; t++) {
      d3--;
      if (d3 === 0) { d5 = u32(c, a4); a4 += 4; d3 = 16; }
      if (!bit()) {
        if (!bit()) {
          if (prev) out.set(prev.subarray(o, o + 32), o);
          o += 32;
        } else {
          out.set(c.subarray(a1, a1 + 32), o); a1 += 32; o += 32;
        }
      } else if (!bit()) {
        for (let k = 0; k < 4; k++) {
          const x = A[c[a1++]];
          const y = A[c[a1++]];
          out[o++] = x >>> 24; out[o++] = (x >>> 16) & 255; out[o++] = y >>> 24; out[o++] = (y >>> 16) & 255;
          out[o++] = (x >>> 8) & 255; out[o++] = x & 255; out[o++] = (y >>> 8) & 255; out[o++] = y & 255;
        }
      } else {
        for (let k = 0; k < 4; k++) {
          let v = B[c[a1++]];
          d1 = ((d1 & 0xffff0000) | v) >>> 0; d2 = ((d2 & 0xffffff00) | (d1 & 255)) >>> 0; d1 = (d1 << 8) >>> 0; d2 = (d2 << 8) >>> 0;
          v = B[c[a1++]];
          d1 = ((d1 & 0xffff0000) | v) >>> 0; d2 = ((d2 & 0xffffff00) | (d1 & 255)) >>> 0; d1 = (d1 << 8) >>> 0; d2 = (d2 << 8) >>> 0;
          v = B[c[a1++]];
          d1 = ((d1 & 0xffff0000) | v) >>> 0; d2 = ((d2 & 0xffffff00) | (d1 & 255)) >>> 0; d2 = (d2 << 8) >>> 0;
          v = B[c[a1++]];
          d2 = ((d2 & 0xffffff00) | (v & 255)) >>> 0; d1 = ((d1 & 0xffffff00) | (v >>> 8)) >>> 0;
          w32(d1); w32(d2);
        }
      }
    }
    return { w, h, flags, pals, lineMap, tiles: out };
  }

  /** The last picture of a movie file, as the VDP would have left it. */
  function lastFrame(bytes) {
    let prev = null;
    let frame = null;
    for (const p of smOffsets(bytes)) {
      frame = decodeSm(bytes, p, prev);
      prev = frame.tiles;
    }
    return frame;
  }

  /** An uncompressed .map.jim (palette offset, map offset, tile count, tiles, 4 CRAM lines, map) for a decoded frame. */
  function toJim(frame) {
    const n = frame.w * frame.h;
    const palOff = 10 + n * 32;
    const mapOff = palOff + 128;
    const out = new Uint8Array(mapOff + 4 + n * 2);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, palOff);
    dv.setUint32(4, mapOff);
    dv.setUint16(8, n);
    out.set(frame.tiles, 10);
    out.set(frame.pals.subarray(0, 128), palOff);
    dv.setUint16(mapOff, frame.w);
    dv.setUint16(mapOff + 2, frame.h);
    for (let t = 0; t < n; t++) {
      let line = 0;
      if (frame.lineMap) line = (u32(frame.lineMap, (t >> 4) * 4) >>> (30 - 2 * (t & 15))) & 3;
      dv.setUint16(mapOff + 4 + t * 2, (line << 13) | t);
    }
    return out;
  }

  /** Size of toJim for the 32 by 28 tile intro pictures (fixed, so a game profile can point at it). */
  const TITLE_JIM_SIZE = 10 + 896 * 32 + 128 + 4 + 896 * 2;

  /** The NHL HOCKEY '94 title picture: the last frame of HOCKEY.SEG, as a .map.jim. Null when it cannot be read. */
  function titleJim(segBytes) {
    if (!segBytes) return null;
    const frame = lastFrame(segBytes);
    return frame && frame.w === 32 && frame.h === 28 ? toJim(frame) : null;
  }

  /**
   * A stored picture (u16 $0808, u16 tile count, tiles, 128 B CRAM, u16 width, u16 height, name table) as a .map.jim.
   * The jim is the stored picture with a 10 byte header, so it is 6 bytes longer. Null when the bytes do not fit that shape.
   */
  function blobJim(bytes, at, len) {
    if (!bytes || at + len > bytes.length) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset + at, len);
    if (dv.getUint16(0) !== 0x0808) return null;
    const n = dv.getUint16(2);
    const palOff = 10 + n * 32;
    const mapOff = palOff + 128;
    if (mapOff + 4 > len + 6) return null;
    return build(bytes.subarray(at, at + len), len, n, palOff, mapOff);
  }
  function build(src, len, n, palOff, mapOff) {
    const out = new Uint8Array(len + 6);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, palOff);
    dv.setUint32(4, mapOff);
    dv.setUint16(8, n);
    out.set(src.subarray(4), 10);
    const w = dv.getUint16(mapOff), h = dv.getUint16(mapOff + 2);
    return mapOff + 4 + w * h * 2 === out.length ? out : null;
  }

  /** Size of blobJim for a stored picture of the given length. */
  const blobJimSize = (len) => len + 6;

  return { smOffsets, decodeSm, lastFrame, toJim, titleJim, blobJim, blobJimSize, TITLE_JIM_SIZE };
});
