/**
 * NHL 95 PC scoreboard crests: CRESTS4.PPV, an SHPI bank of 28 SPIT shapes (tag = team code, 'ANA ' ... 'WSH '),
 * type 0xFB (RLE: n < 128 = run of n of the next byte, n >= 128 = 256 - n literal bytes, 0 = end), 32 x 24
 * (ASE 32 x 25). DrawHudPanel draws them through the team remap: pixels are sprite colours (197..250 used, 67 =
 * white border shown as game colour 103, 255 transparent). JED 3.01 imports / exports one crest as a 32 x 24 PCX.
 * parse(bytes) -> { bytes, entries: [{ tag, head (16 bytes), width, height, pixels }] }; write(bank) -> bytes
 * (the original bytes when nothing changed).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlPcCrests = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const s16 = (b, o) => { const v = b[o] | (b[o + 1] << 8); return v > 32767 ? v - 65536 : v; };
  function unrle(b, o, count) {
    const px = new Uint8Array(count); let n = 0;
    while (n < count && o < b.length) {
      const d = b[o++]; if (d === 0) break;
      if (d >= 128) { for (let i = 0; i < 256 - d && n < count; i++) px[n++] = b[o++]; } else { const v = b[o++]; for (let i = 0; i < d && n < count; i++) px[n++] = v; }
    }
    return px;
  }
  function rle(px) {
    const o = []; let i = 0; const n = px.length;
    while (i < n) {
      let r = 1; while (i + r < n && px[i + r] === px[i] && r < 127) r++;
      if (r >= 3) { o.push(r, px[i]); i += r; continue; }
      const s = i; let L = 0;
      while (i < n && L < 128) { let r2 = 1; while (i + r2 < n && px[i + r2] === px[i] && r2 < 3) r2++; if (r2 >= 3) break; i++; L++; }
      o.push(256 - L); for (let k = s; k < s + L; k++) o.push(px[k]);
    }
    o.push(0); return Uint8Array.from(o);
  }
  function parse(bytes) {
    if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'SHPI') throw new Error('Not an SHPI shape bank (CRESTS4.PPV)');
    const n = u32(bytes, 8); const entries = [];
    for (let k = 0; k < n; k++) {
      const tag = String.fromCharCode(...bytes.subarray(16 + k * 8, 20 + k * 8)); const off = u32(bytes, 20 + k * 8);
      const head = Uint8Array.from(bytes.subarray(off, off + 16)); const width = s16(head, 4), height = s16(head, 6);
      const pixels = head[0] === 0x7B ? Uint8Array.from(bytes.subarray(off + 16, off + 16 + width * height)) : unrle(bytes, off + 16, width * height);
      entries.push({ tag, head, width, height, pixels, orig: Uint8Array.from(pixels) });
    }
    return { bytes: Uint8Array.from(bytes), id: String.fromCharCode(...bytes.subarray(12, 16)), entries };
  }
  const changed = (e) => e.pixels.length !== e.orig.length || e.pixels.some((v, i) => v !== e.orig[i]);
  function edited(bank) { return bank.entries.some(changed); }
  function write(bank) {
    if (!edited(bank)) return Uint8Array.from(bank.bytes);
    const blobs = bank.entries.map((e) => { const h = Uint8Array.from(e.head); h[0] = 0xFB; const size = 16 + e.width * e.height; h[1] = size & 255; h[2] = (size >> 8) & 255; h[3] = size >> 16; const d = rle(e.pixels); const b = new Uint8Array(16 + d.length); b.set(h); b.set(d, 16); return b; });
    let off = 16 + bank.entries.length * 8; const total = off + blobs.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(total); out.set([0x53, 0x48, 0x50, 0x49]);
    const put = (o, v) => { out[o] = v & 255; out[o + 1] = (v >> 8) & 255; out[o + 2] = (v >> 16) & 255; out[o + 3] = (v >>> 24) & 255; };
    put(4, total); put(8, bank.entries.length); out.set(bank.bytes.subarray(12, 16), 12);
    bank.entries.forEach((e, k) => { for (let i = 0; i < 4; i++) out[16 + k * 8 + i] = e.tag.charCodeAt(i); put(20 + k * 8, off); out.set(blobs[k], off); off += blobs[k].length; });
    return out;
  }
  function find(bank, code) { const t = String(code).toUpperCase(); return bank.entries.find((e) => e.tag.trim().toUpperCase() === t) || null; }
  /** One crest in game format: its SPIT blob (16-byte header + RLE), as stored in CRESTS4.PPV. */
  function exportSpit(e) { const h = Uint8Array.from(e.head); h[0] = 0xFB; const size = 16 + e.width * e.height; h[1] = size & 255; h[2] = (size >> 8) & 255; h[3] = size >> 16; const d = rle(e.pixels); const b = new Uint8Array(16 + d.length); b.set(h); b.set(d, 16); return b; }
  function importSpit(b) {
    const width = s16(b, 4), height = s16(b, 6); if (width <= 0 || height <= 0 || width > 64 || height > 64) throw new Error('Not a crest SPIT shape');
    return { head: Uint8Array.from(b.subarray(0, 16)), width, height, pixels: b[0] === 0x7B ? Uint8Array.from(b.subarray(16, 16 + width * height)) : unrle(b, 16, width * height) };
  }
  // ---- PCX (ZSoft 3.0, 8-bit, 256-colour palette at the end), as JED 3.01 reads / writes crests ----
  function readPcx(b) {
    if (b[0] !== 10 || b[2] !== 1 || b[3] !== 8 || b[65] !== 1) throw new Error('Only 8-bit, 1-plane PCX files are supported');
    const w = (b[8] | (b[9] << 8)) - (b[4] | (b[5] << 8)) + 1, h = (b[10] | (b[11] << 8)) - (b[6] | (b[7] << 8)) + 1, bpl = b[66] | (b[67] << 8);
    const idx = new Uint8Array(w * h); let o = 128;
    for (let y = 0; y < h; y++) { let x = 0; while (x < bpl) { let c = b[o++], n = 1; if ((c & 0xC0) === 0xC0) { n = c & 0x3F; c = b[o++]; } for (let i = 0; i < n; i++, x++) if (x < w) idx[y * w + x] = c; } }
    const p = b.length - 768; if (b[p - 1] !== 12) throw new Error('PCX has no 256-colour palette');
    const rgba = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) rgba.set([b[p + idx[i] * 3], b[p + idx[i] * 3 + 1], b[p + idx[i] * 3 + 2], 255], i * 4);
    return { w, h, rgba, idx, palette: b.subarray(p, p + 768) };
  }
  function writePcx(idx, w, h, pal8) {
    const bpl = w + (w & 1); const body = [];
    for (let y = 0; y < h; y++) { let x = 0; while (x < bpl) { const c = x < w ? idx[y * w + x] : 0; let n = 1; while (x + n < bpl && n < 63 && (x + n < w ? idx[y * w + x + n] : 0) === c) n++; if (n > 1 || (c & 0xC0) === 0xC0) body.push(0xC0 | n, c); else body.push(c); x += n; } }
    const out = new Uint8Array(128 + body.length + 769); out[0] = 10; out[1] = 5; out[2] = 1; out[3] = 8;
    out[8] = (w - 1) & 255; out[9] = (w - 1) >> 8; out[10] = (h - 1) & 255; out[11] = (h - 1) >> 8; out[12] = 72; out[14] = 72; out[65] = 1; out[66] = bpl & 255; out[67] = bpl >> 8; out[68] = 1;
    out.set(body, 128); out[128 + body.length] = 12; out.set(pal8.subarray ? pal8.subarray(0, 768) : pal8, 129 + body.length); return out;
  }
  return { parse, write, edited, find, rle, unrle, exportSpit, importSpit, readPcx, writePcx };
}));
