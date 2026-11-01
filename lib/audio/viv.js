/**
 * EA .VIV archives (NHL 94/95 PC announcer speech).
 *
 * NHL 94 PC: C0 FB named directory (name\\0 + u24be offset + u24be size). Each
 * lump is BTree 47 FB wrapping a 72 FB raw-PCM header (signed 8-bit).
 * NHL 95 PC: gfxpak / SHPI-style packs; clips are often 8SVX bodies. BNK
 * headers follow Valery Anisimovsky GameAudioPlayer Specs/EA-MUS.txt.
 */
(function (root, factory) {
  var pack = null;
  var pc95 = null;
  if (typeof require === 'function') {
    try { pack = require('../pc94-pack'); } catch (err) { pack = null; }
    try { pc95 = require('../pc95'); } catch (err) { pc95 = null; }
  }
  var api = factory(
    pack || (typeof NhlPc94Pack !== 'undefined' ? NhlPc94Pack : null),
    pc95 || (typeof Nhl95Pc !== 'undefined' ? Nhl95Pc : null)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlViv = api;
})(typeof self !== 'undefined' ? self : this, function (Pack, Pc95) {
  'use strict';

  var RATE = 11025;

  function bytesOf(bytes) {
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }

  function be24(u8, o) {
    return (u8[o] << 16) | (u8[o + 1] << 8) | u8[o + 2];
  }

  function findAscii(bytes, tag) {
    var u8 = bytesOf(bytes);
    var t = [];
    for (var i = 0; i < tag.length; i++) t.push(tag.charCodeAt(i));
    for (var p = 0; p + t.length <= u8.length; p++) {
      var ok = true;
      for (var k = 0; k < t.length; k++) if (u8[p + k] !== t[k]) { ok = false; break; }
      if (ok) return p;
    }
    return -1;
  }

  /** @returns {{offset:number, version:number, count:number}|null} */
  function parseBnkHeader(bytes, offset) {
    var u8 = bytesOf(bytes);
    var o = offset || 0;
    if (o + 12 > u8.length) return null;
    if (String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]) !== 'BNKl') return null;
    var dv = new DataView(u8.buffer, u8.byteOffset + o, u8.byteLength - o);
    return { offset: o, version: dv.getUint16(4, true), count: dv.getUint16(6, true) };
  }

  function findBnk(bytes) {
    var at = findAscii(bytes, 'BNKl');
    return at < 0 ? null : parseBnkHeader(bytes, at);
  }

  /**
   * Heuristic: speech extracted from XBRUCE.VIV is often 8SVX body without the FORM header.
   * If `8SVX` appears at `offset`, return that offset; else if the buffer looks like a PT chunk, return null.
   */
  function findIffSpeech(bytes) {
    var at = findAscii(bytes, '8SVX');
    if (at >= 0) return at;
    at = findAscii(bytes, 'FORM');
    if (at >= 0) return at;
    return -1;
  }

  function isViv(bytes) {
    var u8 = bytesOf(bytes);
    return u8.length >= 12 && u8[0] === 0xc0 && u8[1] === 0xfb;
  }

  function readName(u8, o) {
    var s = '';
    while (o < u8.length && u8[o] >= 32 && u8[o] < 127 && s.length < 24) {
      s += String.fromCharCode(u8[o]);
      o += 1;
    }
    if (!s || u8[o] !== 0) return null;
    return { name: s, next: o + 1 };
  }

  function pushEntry(entries, u8, name, off, size) {
    if (!size || off >= u8.length || size > u8.length) return;
    var end = off + size > u8.length ? u8.length : off + size;
    entries.push({
      name: name,
      offset: off,
      size: size,
      data: u8.subarray(off, end)
    });
  }

  /** Parse a 94 PC C0 FB directory. Payloads are left packed. */
  function parseArchive94(bytes) {
    var u8 = bytesOf(bytes);
    if (!isViv(u8)) return { entries: [], kind: '' };
    var entries = [];
    var o = 12;
    while (o + 8 < u8.length) {
      var nm = readName(u8, o);
      if (!nm) break;
      o = nm.next;
      if (o + 6 > u8.length) break;
      var off = be24(u8, o);
      var size = be24(u8, o + 3);
      o += 6;
      pushEntry(entries, u8, nm.name, off, size);
    }
    return { entries: entries, kind: 'pc94' };
  }

  /**
   * NHL 95 PC OpenSpeechBank layout: three big-endian words (type, count, extra),
   * then per clip u24be offset, u24be size, name\\0. Clips that start with 'G'
   * (0x47 FB BTree) are packed; others are raw.
   */
  function parseArchive95(bytes) {
    var u8 = bytesOf(bytes);
    if (u8.length < 12 || isViv(u8)) return { entries: [], kind: '' };
    var count = (u8[2] << 8) | u8[3];
    if (count < 1 || count > 400) return { entries: [], kind: '' };
    var entries = [];
    var o = 6;
    for (var i = 0; i < count; i++) {
      if (o + 7 > u8.length) break;
      var off = be24(u8, o);
      var size = be24(u8, o + 3);
      o += 6;
      var nm = readName(u8, o);
      if (!nm) break;
      o = nm.next;
      pushEntry(entries, u8, nm.name, off, size);
    }
    return { entries: entries, kind: entries.length ? 'pc95' : '' };
  }

  function parseArchive(bytes) {
    var u8 = bytesOf(bytes);
    if (isViv(u8)) return parseArchive94(u8);
    return parseArchive95(u8);
  }

  function unpackRawPcm(bytes) {
    var u8 = bytesOf(bytes);
    if (u8.length >= 5 && u8[0] === 0x72 && u8[1] === 0xfb) {
      var size = be24(u8, 2);
      var start = 5;
      var n = size > 0 && start + size <= u8.length ? size : u8.length - start;
      return u8.subarray(start, start + n);
    }
    return u8;
  }

  function unpackClip(bytes) {
    var u8 = bytesOf(bytes);
    var inner = u8;
    if (Pack && Pack.isPacked && Pack.isPacked(u8)) {
      try { inner = Pack.unpack(u8).data; } catch (err) { inner = u8; }
    } else if (Pc95 && Pc95.isRefPack && Pc95.isRefPack(u8)) {
      try { inner = Pc95.decompressRefPack(u8) || u8; } catch (err) { inner = u8; }
    }
    return unpackRawPcm(inner);
  }

  /** Signed 8-bit DPCM as ReadSpeechSample: running sum, wrapping a char. */
  function deltaDecode(pcm) {
    var src = bytesOf(pcm);
    var out = new Uint8Array(src.length);
    var acc = 0;
    for (var i = 0; i < src.length; i++) {
      var d = src[i] > 127 ? src[i] - 256 : src[i];
      acc = (acc + d) << 24 >> 24;
      out[i] = acc & 255;
    }
    return out;
  }

  function be32(u8, o) {
    return ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0;
  }

  /** IFF 8SVX (FORM wrapper or a bare 8SVX/BODY). */
  function decodeIff(bytes) {
    var u8 = bytesOf(bytes);
    var vhdr = findAscii(u8, 'VHDR');
    var body = findAscii(u8, 'BODY');
    var svx = findAscii(u8, '8SVX');
    var rate = RATE;
    if (vhdr >= 0 && vhdr + 22 <= u8.length) {
      var hz = (u8[vhdr + 20] << 8) | u8[vhdr + 21];
      if (hz >= 4000 && hz <= 48000) rate = hz;
    }
    var pcm = null;
    if (body >= 0 && body + 8 <= u8.length) {
      var n = be32(u8, body + 4);
      if (n > 0x7fffffff) n = u8.length - (body + 8);
      pcm = u8.subarray(body + 8, Math.min(u8.length, body + 8 + n));
    } else if (svx >= 0) {
      pcm = u8.subarray(svx + 4);
    }
    if (!pcm || !pcm.length) return null;
    return { pcm: pcm, rate: rate, length: pcm.length };
  }

  function labelOf(name) {
    var stem = String(name || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    stem = stem.replace(/[_]+/g, ' ').replace(/^\d+/, '');
    if (!stem) return name;
    return stem.charAt(0).toUpperCase() + stem.slice(1).toLowerCase();
  }

  function toFloat32(pcm) {
    var src = bytesOf(pcm);
    var out = new Float32Array(src.length);
    for (var i = 0; i < src.length; i++) {
      var s = src[i] > 127 ? src[i] - 256 : src[i];
      out[i] = s / 128;
    }
    return out;
  }

  function listClips(bytes, opts) {
    var parsed = parseArchive(bytes);
    var delta = !!(opts && opts.delta) || parsed.kind === 'pc95';
    var out = [];
    for (var i = 0; i < parsed.entries.length; i++) {
      var e = parsed.entries[i];
      var pcm = unpackClip(e.data);
      if (!pcm.length) continue;
      if (delta) pcm = deltaDecode(pcm);
      out.push({
        name: e.name,
        label: labelOf(e.name),
        pcm: pcm,
        rate: RATE,
        length: pcm.length,
        kind: parsed.kind
      });
    }
    return out;
  }

  return {
    RATE: RATE,
    findAscii: findAscii,
    parseBnkHeader: parseBnkHeader,
    findBnk: findBnk,
    findIffSpeech: findIffSpeech,
    decodeIff: decodeIff,
    isViv: isViv,
    parseArchive: parseArchive,
    parseArchive94: parseArchive94,
    parseArchive95: parseArchive95,
    unpackClip: unpackClip,
    deltaDecode: deltaDecode,
    listClips: listClips,
    toFloat32: toFloat32,
    labelOf: labelOf
  };
});
