/**
 * NHL 96 PC .ASF music: EA 1SNh / 1SNd / 1SNl chunks (HOCKEY.EXE compares
 * those four-byte ids). PCM codec 0 is signed 8-bit. Other codecs stay listed
 * until a retail file is dropped and named.
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

  function isAsf(buffer) {
    var u8 = bytesOf(buffer);
    if (u8.length >= 12 && ascii(u8, 0, 4) === 'RIFF') return true;
    if (u8.length >= 12 && ascii(u8, 0, 4) === 'FORM') return true;
    return findId(u8, '1SNh') >= 0;
  }

  /**
   * Header after 1SNh + size: codec, channels, rate (u16), sample count (u32).
   * Codec 0 = signed 8-bit PCM. 1SNl marks a loop start in the data chunk.
   */
  function parse1sn(u8) {
    var h = findId(u8, '1SNh');
    if (h < 0 || h + 16 > u8.length) return null;
    var payload = h + 8;
    var codec = u8[payload];
    var channels = Math.max(1, u8[payload + 1] || 1);
    var rate = u16(u8, payload + 2);
    if (rate < 1000 || rate > 96000) rate = 22050;
    var d = findId(u8, '1SNd', h + 4);
    if (d < 0 || d + 8 > u8.length) return null;
    var size = u32(u8, d + 4);
    var dataAt = d + 8;
    if (dataAt + size > u8.length) size = u8.length - dataAt;
    if (size <= 0) return null;
    var pcm = u8.subarray(dataAt, dataAt + size);
    var loop = findId(u8, '1SNl', h + 4);
    var loopStart = 0;
    if (loop >= 0 && loop < d) loopStart = 0;
    return {
      kind: '1sn',
      codec: codec,
      channels: channels,
      rate: rate,
      pcm: pcm,
      length: pcm.length,
      loop: loop >= 0,
      loopStart: loopStart,
      playable: codec === 0
    };
  }

  function toFloat32(pcm, vol) {
    var gain = vol == null ? 1 : vol;
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

  function parse(buffer) {
    var u8 = bytesOf(buffer);
    if (u8.length >= 12 && ascii(u8, 0, 4) === 'RIFF') return { kind: 'riff', playable: false, rate: 0, pcm: new Uint8Array(0) };
    if (u8.length >= 12 && ascii(u8, 0, 4) === 'FORM') return { kind: 'form', playable: false, rate: 0, pcm: new Uint8Array(0) };
    return parse1sn(u8);
  }

  return { isAsf: isAsf, parse: parse, parse1sn: parse1sn, toFloat32: toFloat32, encodePcm8: encodePcm8 };
});
