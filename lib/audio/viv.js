/**
 * EA .VIV archives and IFF desk samples (NHL 94/95 PC announcer / music).
 *
 * NHL 94 PC: C0 FB directory (be16 at +2, be16 count at +4, then count ×
 * u24be offset, u24be size, name\\0 from byte 6 — the same slot order as 95
 * OpenSpeechBank). Each lump is BTree 47 FB wrapping a 72 FB raw-PCM header
 * (signed 8-bit). Names keep their suffixes (.BRU Bruce, .BAR Barr, .CTY city, …).
 *
 * NHL 95 PC OpenSpeechBank: three big-endian words, then per clip u24be
 * offset, u24be size, name\\0. Packed clips start with 'G' (47 FB).
 * ReadSpeechSample unpacks via sub_98028 then delta-decodes, dropping a
 * 5-byte header.
 *
 * Loose .IFF: NHL 94 PC has none. NHL95PC sub_8F98F loads FORM 8SVX (VHDR
 * rate, BODY; Fibonacci-delta when sCompression is 1; signed 8-bit PCM).
 * VHDR samplesPerSec on AFAN.IFF / AWARDS.IFF is ~22050; 8-bit at that rate
 * is ~3.6 s (2× fast, scratchy). Play at half that rate (~11025), the same
 * length as ADAFAN.KMS (~7.3 s). RIFF WAVE: XOR 0x80, then 8-bit unless
 * fmt bits is 16. Desk play is sub_8FB8E.
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

  var EXT_KIND = {
    BRU: 'Bruce', BAR: 'Barr', CTY: 'city', RNK: 'rank',
    MSC: 'misc', OFF: 'official', HOM: 'home', AWA: 'away', INT: 'intro'
  };

  var TEAM = {
    BOS: 'Boston', BUF: 'Buffalo', CAL: 'Calgary', CGY: 'Calgary', CHI: 'Chicago',
    DET: 'Detroit', ED: 'Edmonton', EDM: 'Edmonton', HART: 'Hartford', HFD: 'Hartford',
    LA: 'Los Angeles', LI: 'Long Island', NYI: 'Long Island', MON: 'Montreal', MTL: 'Montreal',
    NJER: 'New Jersey', NJ: 'New Jersey', NY: 'New York', NYR: 'New York', OTT: 'Ottawa',
    PHIL: 'Philadelphia', PHI: 'Philadelphia', PITTS: 'Pittsburgh', PIT: 'Pittsburgh',
    QU: 'Quebec', QUE: 'Quebec', SHK: 'San Jose', SJ: 'San Jose', SL: 'St. Louis', STL: 'St. Louis',
    TB: 'Tampa Bay', TOR: 'Toronto', VAN: 'Vancouver', WASH: 'Washington', WSH: 'Washington',
    WINN: 'Winnipeg', WPG: 'Winnipeg', ANA: 'Anaheim', FLA: 'Florida', MIN: 'Minnesota', DAL: 'Dallas',
    ASE: 'All-Star East', ASW: 'All-Star West', ASC: 'All-Star East', ASWST: 'All-Star West'
  };

  function bytesOf(bytes) {
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }

  function be24(u8, o) {
    return (u8[o] << 16) | (u8[o + 1] << 8) | u8[o + 2];
  }

  function be16(u8, o) {
    return (u8[o] << 8) | u8[o + 1];
  }

  function be32(u8, o) {
    return ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0;
  }

  function le32(u8, o) {
    return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;
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

  function findIffSpeech(bytes) {
    var at = findAscii(bytes, '8SVX');
    if (at >= 0) return at;
    at = findAscii(bytes, 'FORM');
    if (at >= 0) return at;
    at = findAscii(bytes, 'RIFF');
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

  function pushEntry(entries, u8, name, off, size, dirEnd) {
    if (!size || off >= u8.length || size > u8.length) return;
    if (off < dirEnd) return;
    var end = off + size > u8.length ? u8.length : off + size;
    if (end <= off) return;
    entries.push({
      name: name,
      offset: off,
      size: size,
      data: u8.subarray(off, end)
    });
  }

  /**
   * Parse a 94 PC C0 FB directory: be16 at +2, be16 count at +4, then
   * count × (u24be offset, u24be size, name\\0) from byte 6.
   */
  function parseArchive94(bytes) {
    var u8 = bytesOf(bytes);
    if (!isViv(u8)) return { entries: [], kind: '' };
    var count = be16(u8, 4);
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
      pushEntry(entries, u8, nm.name, off, size, o);
    }
    return { entries: entries, kind: entries.length ? 'pc94' : '' };
  }

  /**
   * NHL 95 PC OpenSpeechBank: three BE words (w1, count, w3), then per clip
   * u24be offset, u24be size, name\\0.
   */
  function parseArchive95(bytes) {
    var u8 = bytesOf(bytes);
    if (u8.length < 12 || isViv(u8)) return { entries: [], kind: '' };
    var count = be16(u8, 2);
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
      pushEntry(entries, u8, nm.name, off, size, o);
    }
    return { entries: entries, kind: entries.length ? 'pc95' : '' };
  }

  function parseArchive(bytes) {
    var u8 = bytesOf(bytes);
    if (isViv(u8)) return parseArchive94(u8);
    return parseArchive95(u8);
  }

  /** Inner 72 FB raw PCM (BE24 size at +2, samples at +5). */
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

  /** sub_98028: 47/46 FB BTree, 10 FB RefPack, else the bytes as-is. */
  function unpackSpeech(bytes) {
    var u8 = bytesOf(bytes);
    if (Pack && Pack.isPacked && Pack.isPacked(u8)) {
      try { return Pack.unpack(u8).data; } catch (err) { return u8; }
    }
    if (Pc95 && Pc95.isRefPack && Pc95.isRefPack(u8)) {
      try { return Pc95.decompressRefPack(u8) || u8; } catch (err) { return u8; }
    }
    return u8;
  }

  function unpackClip(bytes) {
    return unpackRawPcm(unpackSpeech(bytes));
  }

  /** IFF 8SVX Fibonacci-delta (sCompression 1). First BODY byte is the seed. */
  var FIB_DELTA = [-34, -21, -13, -8, -5, -3, -2, -1, 0, 1, 2, 3, 5, 8, 13, 21];
  function fibDelta(pcm) {
    var src = bytesOf(pcm);
    if (src.length < 1) return src;
    var out = new Uint8Array(1 + (src.length - 1) * 2);
    var val = src[0] > 127 ? src[0] - 256 : src[0];
    var n = 0;
    out[n++] = val & 255;
    for (var i = 1; i < src.length; i++) {
      var b = src[i];
      val += FIB_DELTA[b >> 4];
      if (val > 127) val = 127;
      if (val < -128) val = -128;
      out[n++] = val & 255;
      val += FIB_DELTA[b & 15];
      if (val > 127) val = 127;
      if (val < -128) val = -128;
      out[n++] = val & 255;
    }
    return n === out.length ? out : out.subarray(0, n);
  }

  function pcm16le(bytes) {
    var src = bytesOf(bytes);
    var n = src.length >> 1;
    var out = new Int16Array(n);
    for (var i = 0; i < n; i++) {
      var v = src[i * 2] | (src[i * 2 + 1] << 8);
      out[i] = v > 32767 ? v - 65536 : v;
    }
    return out;
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

  /**
   * ReadSpeechSample: unpack, then each output byte is the running sum of the
   * bytes 5 further on (the 5-byte 72 FB header is dropped).
   */
  function readSpeechSample(bytes) {
    var unpacked = unpackSpeech(bytes);
    if (unpacked.length <= 5) return new Uint8Array(0);
    return deltaDecode(unpacked.subarray(5));
  }

  function xorBytes(pcm, mask) {
    var src = bytesOf(pcm);
    if (!mask) return src;
    var out = new Uint8Array(src.length);
    for (var i = 0; i < src.length; i++) out[i] = src[i] ^ mask;
    return out;
  }

  /**
   * NHL95PC sub_8F98F: FORM 8SVX (VHDR samplesPerSec, BODY, no XOR) or RIFF
   * WAVE (rate at +0x18, payload from +0x2C XOR 0x80). FORM PCM is signed
   * 8-bit. VHDR rates ≥ 16 kHz are stored 2× (22500 in the header, files
   * play at 11250 — same check as AFAN.IFF ≥ 7 s / ADAFAN.KMS). 16-bit BODY
   * at the header rate is ~3.6 s and scratchy. RIFF keeps 8-bit unless the
   * fmt bits field is 16. Fibonacci-delta uses sCompression.
   */
  function decodeIff(bytes) {
    var raw = bytesOf(bytes);
    if (Pack && Pack.isPacked && Pack.isPacked(raw)) {
      try { raw = Pack.unpack(raw).data; } catch (err) { /* keep packed bytes */ }
    }
    if (Pc95 && Pc95.isRefPack && Pc95.isRefPack(raw)) {
      try { raw = Pc95.decompressRefPack(raw) || raw; } catch (err) { /* keep */ }
    }
    var u8 = bytesOf(raw);
    if (u8.length < 12) return null;
    var magic = le32(u8, 0);
    if (magic === 0x46464952) {
      var wavRate = le32(u8, 0x18);
      var start = 0x2c;
      var pcmLen = le32(u8, 0x28);
      var n = pcmLen > 0 && start + pcmLen <= u8.length ? pcmLen : u8.length - start;
      if (n <= 0) return null;
      var rate = wavRate >= 4000 && wavRate <= 48000 ? wavRate : RATE;
      var bits = u8.length > 0x23 ? (u8[0x22] | (u8[0x23] << 8)) : 8;
      var slice = xorBytes(u8.subarray(start, start + n), 0x80);
      if (bits === 16) {
        var s16 = pcm16le(slice);
        return { pcm: s16, rate: rate, length: s16.length, kind: 'riff', depth: 16 };
      }
      return { pcm: slice, rate: rate, length: slice.length, kind: 'riff', depth: 8 };
    }
    if (magic !== 0x4d524f46 && findAscii(u8, 'FORM') !== 0 && findAscii(u8, '8SVX') < 0) {
      return null;
    }
    var vhdr = findAscii(u8, 'VHDR');
    var body = findAscii(u8, 'BODY');
    var rate = RATE;
    var compress = 0;
    if (vhdr >= 0 && vhdr + 24 <= u8.length) {
      var hz = be16(u8, vhdr + 20);
      if (hz >= 4000 && hz <= 48000) rate = hz;
      /* Header 22050/22500 is 2× the play rate; 8-bit at the header rate
       * makes AFAN.IFF ~3.6 s. Half of that is ~7.3 s, same as ADAFAN.KMS. */
      if (rate >= 16000) rate = (rate / 2) | 0;
      compress = u8[vhdr + 23] || 0;
    }
    var pcm = null;
    if (body >= 0 && body + 8 <= u8.length) {
      var nBody = be32(u8, body + 4);
      if (nBody > 0x7fffffff) nBody = u8.length - (body + 8);
      pcm = u8.subarray(body + 8, Math.min(u8.length, body + 8 + nBody));
    } else if (vhdr >= 0) {
      var from = vhdr + 4 + 0x24;
      if (from < u8.length) pcm = u8.subarray(from);
    } else {
      var svx = findAscii(u8, '8SVX');
      if (svx >= 0) pcm = u8.subarray(svx + 4);
    }
    if (!pcm || !pcm.length) return null;
    if (compress === 1) pcm = fibDelta(pcm);
    return { pcm: pcm, rate: rate, length: pcm.length, kind: 'form', depth: 8 };
  }

  function fileNameOf(name) {
    return String(name || '').split(/[\\/]/).pop();
  }

  function labelOf(name) {
    var base = fileNameOf(name);
    if (!base) return name;
    var dot = base.lastIndexOf('.');
    var stem = dot > 0 ? base.slice(0, dot) : base;
    var ext = dot > 0 ? base.slice(dot + 1).toUpperCase() : '';
    var role = EXT_KIND[ext];
    var head = stem;
    var team = TEAM[stem.toUpperCase()];
    if (team && (ext === 'CTY' || ext === 'RNK' || ext === 'HOM' || ext === 'AWA')) head = team;
    if (role) return head + ' (' + role + ')';
    return base;
  }

  function toFloat32(pcm) {
    if (pcm instanceof Int16Array) {
      var f16 = new Float32Array(pcm.length);
      for (var j = 0; j < pcm.length; j++) f16[j] = pcm[j] / 32768;
      return f16;
    }
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
      var pcm = delta ? readSpeechSample(e.data) : unpackClip(e.data);
      if (!pcm.length) continue;
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
    fibDelta: fibDelta,
    isViv: isViv,
    parseArchive: parseArchive,
    parseArchive94: parseArchive94,
    parseArchive95: parseArchive95,
    unpackClip: unpackClip,
    unpackSpeech: unpackSpeech,
    readSpeechSample: readSpeechSample,
    deltaDecode: deltaDecode,
    listClips: listClips,
    toFloat32: toFloat32,
    labelOf: labelOf
  };
});
