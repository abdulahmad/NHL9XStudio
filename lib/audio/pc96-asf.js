/**
 * NHL 96 PC .ASF music from EACSNDF.LIB (HOCKEY.EXE 4 Aug 1995).
 *
 * On-disk songs are 1SNh wrapping an EACS header at +8 (sub_C032E →
 * sub_BFFCE). Codec at EACS+0x0B is 0..15; 0 is PCM. Channels at +8,
 * bytes/sample at +9, rate at +4 (little-endian). PCM starts at EACS+0x20
 * (file +0x28 from 1SNh). A 1SNd chunk, when present, is the data payload.
 * 1SNl marks a loop. Other codecs stay listed, not played.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlPc96Asf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function bytesOf(buffer) {
    if (!buffer) return new Uint8Array(0);
    if (buffer instanceof Uint8Array) return buffer;
    return new Uint8Array(buffer);
  }

  function ascii(u8, o, n) {
    var s = '';
    for (var i = 0; i < n && o + i < u8.length; i++) s += String.fromCharCode(u8[o + i]);
    return s;
  }

  function u32(u8, o) {
    return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;
  }

  function u16(u8, o) {
    return u8[o] | (u8[o + 1] << 8);
  }

  function findId(u8, id, from) {
    var a = id.charCodeAt(0), b = id.charCodeAt(1), c = id.charCodeAt(2), d = id.charCodeAt(3);
    for (var p = from || 0; p + 4 <= u8.length; p++) {
      if (u8[p] === a && u8[p + 1] === b && u8[p + 2] === c && u8[p + 3] === d) return p;
    }
    return -1;
  }

  function chunkSize(u8, idAt) {
    if (idAt < 0 || idAt + 8 > u8.length) return 0;
    return u32(u8, idAt + 4);
  }

  function isAsf(buffer) {
    var u8 = bytesOf(buffer);
    if (u8.length >= 12 && ascii(u8, 0, 4) === 'EACS') return true;
    if (u8.length >= 20 && ascii(u8, 8, 4) === 'EACS') return true;
    if (findId(u8, '1SNh') >= 0) return true;
    if (u8.length >= 12 && ascii(u8, 0, 4) === 'RIFF') return true;
    if (u8.length >= 12 && ascii(u8, 0, 4) === 'FORM') return true;
    return false;
  }

  function pcmSlice(u8, at, size) {
    if (at < 0 || at >= u8.length) return new Uint8Array(0);
    var n = size == null ? u8.length - at : size;
    if (at + n > u8.length) n = u8.length - at;
    if (n < 0) n = 0;
    return u8.subarray(at, at + n);
  }

  /**
   * EACS block at eacsOff (HOCKEY.EXE sub_BFFCE). Data is eacsOff+0x20, or
   * the following 1SNd chunk when that id is present.
   */
  function parseEacs(u8, eacsOff, totalSize) {
    if (eacsOff < 0 || eacsOff + 16 > u8.length) return null;
    if (ascii(u8, eacsOff, 4) !== 'EACS') return null;
    var codec = u8[eacsOff + 0x0B];
    if (codec > 127) codec -= 256;
    var channels = Math.max(1, u8[eacsOff + 8] || 1);
    var bps = Math.max(1, u8[eacsOff + 9] || 1);
    var rate = u32(u8, eacsOff + 4);
    if (rate < 1000 || rate > 96000) rate = 22050;
    var d = findId(u8, '1SNd', eacsOff);
    var pcm;
    if (d >= 0 && d + 8 <= u8.length) {
      pcm = pcmSlice(u8, d + 8, u32(u8, d + 4));
    } else {
      var dataAt = eacsOff + 0x20;
      var avail = totalSize != null ? totalSize - (eacsOff + 0x20) : u8.length - dataAt;
      if (eacsOff === 8 && totalSize == null) {
        var wrapped = u32(u8, 4);
        if (wrapped > 0x28) avail = wrapped - 0x28;
      }
      pcm = pcmSlice(u8, dataAt, avail);
    }
    if (!pcm.length) return null;
    var loop = findId(u8, '1SNl') >= 0;
    return {
      kind: 'eacs',
      codec: codec,
      channels: channels,
      bytesPerSample: bps,
      rate: rate,
      pcm: pcm,
      length: pcm.length,
      loop: loop,
      loopStart: 0,
      playable: codec === 0
    };
  }

  /**
   * Header after 1SNh + size that is NOT EACS: codec, channels, rate (u16),
   * sample count (u32). Used by the test encoder and any short 1SN payload.
   */
  function parse1snLegacy(u8, h) {
    if (h < 0 || h + 16 > u8.length) return null;
    if (ascii(u8, h + 8, 4) === 'EACS') return null;
    var payload = h + 8;
    var codec = u8[payload];
    var channels = Math.max(1, u8[payload + 1] || 1);
    var rate = u16(u8, payload + 2);
    if (rate < 1000 || rate > 96000) rate = 22050;
    var d = findId(u8, '1SNd', h + 4);
    if (d < 0 || d + 8 > u8.length) return null;
    var size = u32(u8, d + 4);
    var pcm = pcmSlice(u8, d + 8, size);
    if (!pcm.length) return null;
    var loop = findId(u8, '1SNl', h + 4) >= 0;
    return {
      kind: '1sn',
      codec: codec,
      channels: channels,
      rate: rate,
      pcm: pcm,
      length: pcm.length,
      loop: loop,
      loopStart: 0,
      playable: codec === 0
    };
  }

  function parse1sn(u8) {
    var h = findId(u8, '1SNh');
    if (h < 0) return null;
    var size = chunkSize(u8, h);
    if (ascii(u8, h + 8, 4) === 'EACS') {
      return parseEacs(u8, h + 8, size > 0 ? h + size : null);
    }
    return parse1snLegacy(u8, h);
  }

  function toFloat32(pcm, vol, bps) {
    var gain = vol == null ? 1 : vol;
    var width = bps || 1;
    if (width >= 2) {
      var n = Math.floor(pcm.length / 2);
      var out16 = new Float32Array(n);
      for (var j = 0; j < n; j++) {
        var v = pcm[j * 2] | (pcm[j * 2 + 1] << 8);
        if (v > 32767) v -= 65536;
        out16[j] = (v / 32768) * gain;
      }
      return out16;
    }
    var out = new Float32Array(pcm.length);
    for (var i = 0; i < pcm.length; i++) {
      var s = pcm[i];
      if (s > 127) s -= 256;
      out[i] = (s / 128) * gain;
    }
    return out;
  }

  function encodePcm8(samples, rate) {
    rate = rate || 22050;
    var pcm = samples instanceof Uint8Array ? samples : new Uint8Array(samples);
    var out = new Uint8Array(8 + 8 + 8 + pcm.length);
    out[0] = 0x31; out[1] = 0x53; out[2] = 0x4e; out[3] = 0x68; // 1SNh
    out[4] = 8; out[5] = 0; out[6] = 0; out[7] = 0;
    out[8] = 0;
    out[9] = 1;
    out[10] = rate & 0xff;
    out[11] = (rate >> 8) & 0xff;
    out[12] = pcm.length & 0xff;
    out[13] = (pcm.length >> 8) & 0xff;
    out[14] = (pcm.length >> 16) & 0xff;
    out[15] = (pcm.length >> 24) & 0xff;
    out[16] = 0x31; out[17] = 0x53; out[18] = 0x4e; out[19] = 0x64; // 1SNd
    out[20] = pcm.length & 0xff;
    out[21] = (pcm.length >> 8) & 0xff;
    out[22] = (pcm.length >> 16) & 0xff;
    out[23] = (pcm.length >> 24) & 0xff;
    out.set(pcm, 24);
    return out;
  }

  /** 1SNh + EACS + PCM, the layout sub_BFFCE reads. */
  function encodeEacsPcm8(samples, rate) {
    rate = rate || 22050;
    var pcm = samples instanceof Uint8Array ? samples : new Uint8Array(samples);
    var total = 0x28 + pcm.length;
    var out = new Uint8Array(total);
    out[0] = 0x31; out[1] = 0x53; out[2] = 0x4e; out[3] = 0x68; // 1SNh
    out[4] = total & 0xff;
    out[5] = (total >> 8) & 0xff;
    out[6] = (total >> 16) & 0xff;
    out[7] = (total >> 24) & 0xff;
    out[8] = 0x45; out[9] = 0x41; out[10] = 0x43; out[11] = 0x53; // EACS
    out[12] = rate & 0xff;
    out[13] = (rate >> 8) & 0xff;
    out[14] = (rate >> 16) & 0xff;
    out[15] = (rate >> 24) & 0xff;
    out[16] = 1;
    out[17] = 1;
    out[18] = 0;
    out[19] = 0;
    out.set(pcm, 0x28);
    return out;
  }

  function parse(buffer) {
    var u8 = bytesOf(buffer);
    if (u8.length >= 12 && ascii(u8, 0, 4) === 'RIFF') return { kind: 'riff', playable: false, rate: 0, pcm: new Uint8Array(0) };
    if (u8.length >= 12 && ascii(u8, 0, 4) === 'FORM') return { kind: 'form', playable: false, rate: 0, pcm: new Uint8Array(0) };
    if (ascii(u8, 0, 4) === 'EACS') return parseEacs(u8, 0, u8.length);
    if (ascii(u8, 8, 4) === 'EACS') return parseEacs(u8, 8, u32(u8, 4) || u8.length);
    return parse1sn(u8);
  }

  return {
    isAsf: isAsf,
    parse: parse,
    parse1sn: parse1sn,
    parseEacs: parseEacs,
    toFloat32: toFloat32,
    encodePcm8: encodePcm8,
    encodeEacsPcm8: encodeEacsPcm8
  };
});
