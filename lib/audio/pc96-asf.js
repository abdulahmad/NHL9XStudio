/**
 * NHL 96 PC .ASF music from EACSNDF.LIB (HOCKEY.EXE 4 Aug 1995).
 *
 * On-disk songs are 1SNh wrapping an EACS header at +8 (sub_C032E →
 * sub_BFFCE). EACS+0x0B is the voice slot 0..15, not a codec.
 * Compression is EACS+0x0A==2 (EA IMA ADPCM, sub_D57B4 mono /
 * sub_D585C stereo). Channels at +8, bytes/sample at +9, rate at +4
 * (little-endian). PCM starts at EACS+0x20 (file +0x28 from 1SNh).
 * 1SNh size includes the 8-byte id and the 0x20-byte EACS header
 * (sub_BFFCE: sample frames = ([1SNh+4]-0x28)/(ch*bps), then
 * dword_123BEC=4 for ADPCM). 1SNd size includes its 8-byte id;
 * predictor/index carry across 1SNd (no per-block reset). 1SNl loops.
 * Trailing padding past those sizes is not decoded — that was the click.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlPc96Asf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // dword_14FC80: 89 steps × 8 magnitudes; nibble bit 3 negates.
  // dword_1512C0: IMA index table × 64-byte stride (HOCKEY.EXE).
  var STEP_STRIDE = 64;
  var STEP_MAX = 0x1600;
  var INDEX_DELTA = [-64, -64, -64, -64, 128, 256, 384, 512];
  var STEPS = [
    0, 1, 3, 4, 7, 8, 10, 11, 1, 3, 5, 7, 9, 11, 13, 15, 1, 3, 5, 7, 10, 12, 14, 16,
    1, 3, 6, 8, 11, 13, 16, 18, 1, 3, 6, 8, 12, 14, 17, 19, 1, 4, 7, 10, 13, 16, 19, 22,
    1, 4, 7, 10, 14, 17, 20, 23, 1, 4, 8, 11, 15, 18, 22, 25, 2, 6, 10, 14, 18, 22, 26, 30,
    2, 6, 10, 14, 19, 23, 27, 31, 2, 6, 11, 15, 21, 25, 30, 34, 2, 7, 12, 17, 23, 28, 33, 38,
    2, 7, 13, 18, 25, 30, 36, 41, 3, 9, 15, 21, 28, 34, 40, 46, 3, 10, 17, 24, 31, 38, 45, 52,
    3, 10, 18, 25, 34, 41, 49, 56, 4, 12, 21, 29, 38, 46, 55, 63, 4, 13, 22, 31, 41, 50, 59, 68,
    5, 15, 25, 35, 46, 56, 66, 76, 5, 16, 27, 38, 50, 61, 72, 83, 6, 18, 31, 43, 56, 68, 81, 93,
    6, 19, 33, 46, 61, 74, 88, 101, 7, 22, 37, 52, 67, 82, 97, 112, 8, 24, 41, 57, 74, 90, 107, 123,
    9, 27, 45, 63, 82, 100, 118, 136, 10, 30, 50, 70, 90, 110, 130, 150, 11, 33, 55, 77, 99, 121, 143, 165,
    12, 36, 60, 84, 109, 133, 157, 181, 13, 39, 66, 92, 120, 146, 173, 199, 14, 43, 73, 102, 132, 161, 191, 220,
    16, 48, 81, 113, 146, 178, 211, 243, 17, 52, 88, 123, 160, 195, 231, 266, 19, 58, 97, 136, 176, 215, 254, 293,
    21, 64, 107, 150, 194, 237, 280, 323, 23, 70, 118, 165, 213, 260, 308, 355, 26, 78, 130, 182, 235, 287, 339, 391,
    28, 85, 143, 200, 258, 315, 373, 430, 31, 94, 157, 220, 284, 347, 410, 473, 34, 103, 173, 242, 313, 382, 452, 521,
    38, 114, 191, 267, 345, 421, 498, 574, 42, 126, 210, 294, 379, 463, 547, 631, 46, 138, 231, 323, 417, 509, 602, 694,
    51, 153, 255, 357, 459, 561, 663, 765, 56, 168, 280, 392, 505, 617, 729, 841, 61, 184, 308, 431, 555, 678, 802, 925,
    68, 204, 340, 476, 612, 748, 884, 1020, 74, 223, 373, 522, 672, 821, 971, 1120, 82, 246, 411, 575, 740, 904, 1069, 1233,
    90, 271, 452, 633, 814, 995, 1176, 1357, 99, 298, 497, 696, 895, 1094, 1293, 1492, 109, 328, 547, 766, 985, 1204, 1423, 1642,
    120, 360, 601, 841, 1083, 1323, 1564, 1804, 132, 397, 662, 927, 1192, 1457, 1722, 1987, 145, 436, 728, 1019, 1311, 1602, 1894, 2185,
    160, 480, 801, 1121, 1442, 1762, 2083, 2403, 176, 528, 881, 1233, 1587, 1939, 2292, 2644, 194, 582, 970, 1358, 1746, 2134, 2522, 2910,
    213, 639, 1066, 1492, 1920, 2346, 2773, 3199, 234, 703, 1173, 1642, 2112, 2581, 3051, 3520, 258, 774, 1291, 1807, 2324, 2840, 3357, 3873,
    284, 852, 1420, 1988, 2556, 3124, 3692, 4260, 312, 936, 1561, 2185, 2811, 3435, 4060, 4684, 343, 1030, 1717, 2404, 3092, 3779, 4466, 5153,
    378, 1134, 1890, 2646, 3402, 4158, 4914, 5670, 415, 1246, 2078, 2909, 3742, 4573, 5405, 6236, 457, 1372, 2287, 3202, 4117, 5032, 5947, 6862,
    503, 1509, 2516, 3522, 4529, 5535, 6542, 7548, 553, 1660, 2767, 3874, 4981, 6088, 7195, 8302, 608, 1825, 3043, 4260, 5479, 6696, 7914, 9131,
    669, 2008, 3348, 4687, 6027, 7366, 8706, 10045, 736, 2209, 3683, 5156, 6630, 8103, 9577, 11050, 810, 2431, 4052, 5673, 7294, 8915, 10536, 12157,
    891, 2674, 4457, 6240, 8023, 9806, 11589, 13372, 980, 2941, 4902, 6863, 8825, 10786, 12747, 14708, 1078, 3235, 5393, 7550, 9708, 11865, 14023, 16180,
    1186, 3559, 5932, 8305, 10679, 13052, 15425, 17798, 1305, 3915, 6526, 9136, 11747, 14357, 16968, 19578, 1435, 4306, 7178, 10049, 12922, 15793, 18665, 21536,
    1579, 4737, 7896, 11054, 14214, 17372, 20531, 23689, 1737, 5211, 8686, 12160, 15636, 19110, 22585, 26059, 1911, 5733, 9555, 13377, 17200, 21022, 24844, 28666,
    2102, 6306, 10511, 14715, 18920, 23124, 27329, 31533, 2312, 6937, 11562, 16187, 20812, 25437, 30062, 34687, 2543, 7630, 12718, 17805, 22893, 27980, 33068, 38155,
    2798, 8394, 13990, 19586, 25183, 30779, 36375, 41971, 3077, 9232, 15388, 21543, 27700, 33855, 40011, 46166, 3385, 10156, 16928, 23699, 30471, 37242, 44014, 50785,
    3724, 11172, 18621, 26069, 33518, 40966, 48415, 55863, 4095, 12286, 20478, 28669, 36862, 45053, 53245, 61436
  ];

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

  function concatChunks(parts) {
    var total = 0;
    var i;
    for (i = 0; i < parts.length; i++) total += parts[i].length;
    var out = new Uint8Array(total);
    var w = 0;
    for (i = 0; i < parts.length; i++) {
      out.set(parts[i], w);
      w += parts[i].length;
    }
    return out;
  }

  function snBlockEnd(idAt, size) {
    if (size >= 8) return idAt + size;
    return idAt + 8 + size;
  }

  function snPayload(u8, idAt) {
    if (idAt < 0 || idAt + 8 > u8.length) return null;
    var sz = u32(u8, idAt + 4);
    var body = sz >= 8 ? sz - 8 : sz;
    return pcmSlice(u8, idAt + 8, body);
  }

  function next1sn(u8, from) {
    if (from + 4 <= u8.length && ascii(u8, from, 3) === '1SN') return from;
    return -1;
  }

  /**
   * 1SNh payload (size-0x28) then each 1SNd (size-8). Stop at 1SNl.
   * Do not treat leftover file bytes or the 8-byte chunk ids as ADPCM.
   */
  function collectAsfPayload(u8, eacsOff) {
    var parts = [];
    var headerAt = eacsOff >= 8 && ascii(u8, eacsOff - 8, 4) === '1SNh' ? eacsOff - 8 : findId(u8, '1SNh');
    var dataAt = eacsOff + 0x20;
    var limit = u8.length;
    var p = eacsOff;
    var d0 = findId(u8, '1SNd', p);
    var l0 = findId(u8, '1SNl', p);
    if (d0 >= 0) limit = Math.min(limit, d0);
    if (l0 >= 0) limit = Math.min(limit, l0);
    var take = limit - dataAt;
    if (headerAt >= 0) {
      var hsz = u32(u8, headerAt + 4);
      if (hsz > 0x28 && hsz - 0x28 < take) take = hsz - 0x28;
    }
    if (take > 0) parts.push(pcmSlice(u8, dataAt, take));
    var pnd = d0;
    while (pnd >= 0 && pnd + 8 <= u8.length) {
      var id = ascii(u8, pnd, 4);
      if (id === '1SNl') break;
      if (id !== '1SNd') break;
      var sz = u32(u8, pnd + 4);
      parts.push(snPayload(u8, pnd));
      pnd = next1sn(u8, snBlockEnd(pnd, sz));
    }
    if (!parts.length) return null;
    if (parts.length === 1) return parts[0];
    return concatChunks(parts);
  }

  function collect1snd(u8, from) {
    var parts = [];
    var p = from || 0;
    while (p + 8 <= u8.length) {
      var d = findId(u8, '1SNd', p);
      if (d < 0) break;
      var sz = u32(u8, d + 4);
      parts.push(snPayload(u8, d));
      p = snBlockEnd(d, sz);
    }
    if (!parts.length) return null;
    if (parts.length === 1) return parts[0];
    return concatChunks(parts);
  }

  function clamp16(v) {
    if (v > 32767) return 32767;
    if (v < -32768) return -32768;
    return v;
  }

  function clampStep(off) {
    if (off > STEP_MAX) return STEP_MAX;
    if (off < 0) return 0;
    return off;
  }

  function nibbleDelta(stepOff, nibble) {
    var step = (stepOff / STEP_STRIDE) | 0;
    var mag = STEPS[step * 8 + (nibble & 7)] || 0;
    return (nibble & 8) ? -mag : mag;
  }

  function applyNibble(state, nibble) {
    state.pred = clamp16(state.pred + nibbleDelta(state.step, nibble));
    state.step = clampStep(state.step + INDEX_DELTA[nibble & 7]);
    return state.pred;
  }

  function writeS16(out, i, sample) {
    var v = sample < 0 ? sample + 65536 : sample;
    out[i] = v & 0xff;
    out[i + 1] = (v >> 8) & 0xff;
  }

  // sub_D57B4: one nibble per sample, high nibble first on even index.
  // Predictor/index start at 0 (sub_BFFCE zeros EACS+0x14) and are not
  // reset per 1SNd — the mixer keeps them on the voice.
  function decodeAdpcmMono(src, sampleCount) {
    var samples = src.length * 2;
    if (sampleCount != null && sampleCount >= 0 && sampleCount < samples) samples = sampleCount;
    var out = new Uint8Array(samples * 2);
    var state = { pred: 0, step: 0 };
    var si = 0;
    for (var i = 0; i < samples; i++) {
      var b = src[si] || 0;
      var nibble = (i & 1) ? (b & 0x0f) : (b >> 4);
      if (i & 1) si += 1;
      writeS16(out, i * 2, applyNibble(state, nibble));
    }
    return out;
  }

  // sub_D585C: high nibble left, low nibble right, one byte per stereo frame.
  function decodeAdpcmStereo(src, frameCount) {
    var frames = src.length;
    if (frameCount != null && frameCount >= 0 && frameCount < frames) frames = frameCount;
    var out = new Uint8Array(frames * 4);
    var left = { pred: 0, step: 0 };
    var right = { pred: 0, step: 0 };
    for (var i = 0; i < frames; i++) {
      var b = src[i];
      writeS16(out, i * 4, applyNibble(left, b >> 4));
      writeS16(out, i * 4 + 2, applyNibble(right, b & 0x0f));
    }
    return out;
  }

  function pickNibble(state, target) {
    var best = 0;
    var bestErr = 1e15;
    var n;
    for (n = 0; n < 16; n++) {
      var pred = clamp16(state.pred + nibbleDelta(state.step, n));
      var err = pred - target;
      if (err < 0) err = -err;
      if (err < bestErr) {
        bestErr = err;
        best = n;
      }
    }
    return best;
  }

  function encodeAdpcmMono(samples) {
    var n = samples.length;
    var out = new Uint8Array((n + 1) >> 1);
    var state = { pred: 0, step: 0 };
    var i;
    for (i = 0; i < n; i++) {
      var nib = pickNibble(state, samples[i]);
      applyNibble(state, nib);
      if (i & 1) out[i >> 1] |= nib & 0x0f;
      else out[i >> 1] = (nib & 0x0f) << 4;
    }
    return out;
  }

  function encodeAdpcmStereo(interleaved) {
    var frames = (interleaved.length / 2) | 0;
    var out = new Uint8Array(frames);
    var left = { pred: 0, step: 0 };
    var right = { pred: 0, step: 0 };
    var i;
    for (i = 0; i < frames; i++) {
      var ln = pickNibble(left, interleaved[i * 2]);
      var rn = pickNibble(right, interleaved[i * 2 + 1]);
      applyNibble(left, ln);
      applyNibble(right, rn);
      out[i] = ((ln & 0x0f) << 4) | (rn & 0x0f);
    }
    return out;
  }

  function decodedPcm(raw, compressed, channels, count) {
    if (compressed !== 2) {
      if (count == null || count < 0) return raw;
      var bytes = count * Math.max(1, channels);
      if (bytes < raw.length) return raw.subarray(0, bytes);
      return raw;
    }
    if (channels >= 2) return decodeAdpcmStereo(raw, count);
    return decodeAdpcmMono(raw, count);
  }

  // sub_BFFCE stores ([1SNh+4]-0x28)/(ch*bps), then sub_C0482 multiplies
  // by dword_123BEC (4 when EACS+0x0A==2, else 1).
  function adpcmUnits(byteCount, channels, bps, compressed) {
    var denom = Math.max(1, channels) * Math.max(1, bps);
    var frames = Math.floor(byteCount / denom);
    if (compressed === 2) return frames * 4;
    return frames;
  }

  /**
   * EACS block at eacsOff (HOCKEY.EXE sub_BFFCE). Data is the 1SNh payload
   * of length size-0x28, then each 1SNd of length size-8.
   */
  function parseEacs(u8, eacsOff, totalSize) {
    if (eacsOff < 0 || eacsOff + 16 > u8.length) return null;
    if (ascii(u8, eacsOff, 4) !== 'EACS') return null;
    var voice = u8[eacsOff + 0x0B];
    var compressed = u8[eacsOff + 0x0A];
    var channels = Math.max(1, u8[eacsOff + 8] || 1);
    var bps = Math.max(1, u8[eacsOff + 9] || 1);
    var rate = u32(u8, eacsOff + 4);
    if (rate < 1000 || rate > 96000) rate = 22050;
    var raw = collectAsfPayload(u8, eacsOff);
    if (!raw || !raw.length) {
      var dataAt = eacsOff + 0x20;
      var avail = totalSize != null ? totalSize - (eacsOff + 0x20) : u8.length - dataAt;
      if (eacsOff === 8) {
        var wrapped = u32(u8, 4);
        if (wrapped > 0x28) avail = Math.min(avail, wrapped - 0x28);
      }
      raw = pcmSlice(u8, dataAt, avail);
    }
    if (!raw.length) return null;
    var units = adpcmUnits(raw.length, channels, bps, compressed);
    var pcm = decodedPcm(raw, compressed, channels, units);
    if (!pcm.length) return null;
    var loop = findId(u8, '1SNl') >= 0;
    var playable = compressed === 0 || compressed === 2;
    return {
      kind: 'eacs',
      codec: voice,
      voice: voice,
      compressed: compressed,
      channels: channels,
      bytesPerSample: compressed === 2 ? 2 : bps,
      rate: rate,
      pcm: pcm,
      length: pcm.length,
      loop: loop,
      loopStart: 0,
      playable: playable
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
    var raw = collect1snd(u8, h + 4);
    if (!raw || !raw.length) {
      var d = findId(u8, '1SNd', h + 4);
      if (d < 0 || d + 8 > u8.length) return null;
      raw = pcmSlice(u8, d + 8, u32(u8, d + 4));
    }
    if (!raw.length) return null;
    var loop = findId(u8, '1SNl', h + 4) >= 0;
    return {
      kind: '1sn',
      codec: codec,
      voice: codec,
      compressed: 0,
      channels: channels,
      bytesPerSample: 1,
      rate: rate,
      pcm: raw,
      length: raw.length,
      loop: loop,
      loopStart: 0,
      playable: true
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

  function toPlaybackFloat32(parsed, vol) {
    if (!parsed || !parsed.pcm) return new Float32Array(0);
    var f = toFloat32(parsed.pcm, vol, parsed.bytesPerSample || 1);
    var ch = parsed.channels || 1;
    if (ch <= 1) return f;
    var n = Math.floor(f.length / ch);
    var mono = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var sum = 0;
      for (var c = 0; c < ch; c++) sum += f[i * ch + c];
      mono[i] = sum / ch;
    }
    return mono;
  }

  function writeEacs(pcm, rate, opts) {
    opts = opts || {};
    rate = rate || 22050;
    var channels = opts.channels || 1;
    var bps = opts.bytesPerSample || 1;
    var compressed = opts.compressed || 0;
    var voice = opts.voice || 0;
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
    out[16] = channels;
    out[17] = bps;
    out[18] = compressed;
    out[19] = voice;
    out.set(pcm, 0x28);
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
  function encodeEacsPcm8(samples, rate, opts) {
    var pcm = samples instanceof Uint8Array ? samples : new Uint8Array(samples);
    return writeEacs(pcm, rate, opts);
  }

  function encodeEacsAdpcm(samples, rate, opts) {
    opts = opts || {};
    var channels = opts.channels || 1;
    var packed = channels >= 2 ? encodeAdpcmStereo(samples) : encodeAdpcmMono(samples);
    return writeEacs(packed, rate, {
      channels: channels,
      bytesPerSample: opts.bytesPerSample || 2,
      compressed: 2,
      voice: opts.voice || 0
    });
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
    toPlaybackFloat32: toPlaybackFloat32,
    encodePcm8: encodePcm8,
    encodeEacsPcm8: encodeEacsPcm8,
    encodeEacsAdpcm: encodeEacsAdpcm,
    encodeAdpcmMono: encodeAdpcmMono,
    encodeAdpcmStereo: encodeAdpcmStereo,
    decodeAdpcmMono: decodeAdpcmMono,
    decodeAdpcmStereo: decodeAdpcmStereo
  };
});
