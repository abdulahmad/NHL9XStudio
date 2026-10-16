/**
 * SNES S-DSP: eight BRR voices, mixed at 32 kHz.
 *
 * Written for NHL9X Studio so the SNES NHL '93 / '94 sound programs can drive it from their own register writes.
 * Pure integer arithmetic, no clocks or randomness: the same register writes and RAM give byte-identical output.
 *
 * Model (one call of step() = one 32 kHz output sample, all eight voices in order):
 *   - BRR decoding (4 filters, shift 0-12 and the shift 13-15 quirk, end/loop flags, loop point from the directory),
 *   - 4-point gaussian interpolation, pitch (14 bit, $1000 = 32 kHz) with pitch modulation (PMON),
 *   - ADSR and GAIN envelopes driven by the DSP's global rate counter, release at -8 per sample,
 *   - the noise generator (NON, FLG rate) and the 5-sample key-on delay,
 *   - main volume, echo (buffer in audio RAM, 8-tap FIR, feedback), echo write disable, mute and soft reset.
 * Not modelled: the 32-step internal pipeline of the real chip (each voice is computed in one go, so register
 * writes land between samples rather than between pipeline steps), KON/KOFF being polled only every other sample,
 * the one-sample ENDX/OUTX/ENVX latency, and the unused registers' power-on state. See docs/SNES-SOUND-CORE.md.
 *
 * create(ram) takes the 64 KB audio RAM (Uint8Array) the sample directory, BRR data and echo buffer live in. Hooks for
 * tools: voiceState(i), playSample(i, opts), render(n), and the module level renderVoice() / renderVoiceToWav().
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlSnesDsp = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SAMPLE_RATE = 32000;

  // 512-entry gaussian interpolation table. Values as listed in the public S-DSP documentation (jwdonal's
  // APU/DSP document); checked here for the properties real hardware has: monotonic, 512 entries, and the four
  // taps used for each of the 256 phases sum to 2047-2049 (see test/snes-dsp.js). Not compared against a chip.
  var GAUSS = new Int16Array([
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2,
    2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5,
    6, 6, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10,
    11, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 16, 16, 17, 17,
    18, 19, 19, 20, 20, 21, 21, 22, 23, 23, 24, 24, 25, 26, 27, 27,
    28, 29, 29, 30, 31, 32, 32, 33, 34, 35, 36, 36, 37, 38, 39, 40,
    41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56,
    58, 59, 60, 61, 62, 64, 65, 66, 67, 69, 70, 71, 73, 74, 76, 77,
    78, 80, 81, 83, 84, 86, 87, 89, 90, 92, 94, 95, 97, 99, 100, 102,
    104, 106, 107, 109, 111, 113, 115, 117, 118, 120, 122, 124, 126, 128, 130, 132,
    134, 137, 139, 141, 143, 145, 147, 150, 152, 154, 156, 159, 161, 163, 166, 168,
    171, 173, 175, 178, 180, 183, 186, 188, 191, 193, 196, 199, 201, 204, 207, 210,
    212, 215, 218, 221, 224, 227, 230, 233, 236, 239, 242, 245, 248, 251, 254, 257,
    260, 263, 267, 270, 273, 276, 280, 283, 286, 290, 293, 297, 300, 304, 307, 311,
    314, 318, 321, 325, 328, 332, 336, 339, 343, 347, 351, 354, 358, 362, 366, 370,
    374, 378, 381, 385, 389, 393, 397, 401, 405, 410, 414, 418, 422, 426, 430, 434,
    439, 443, 447, 451, 456, 460, 464, 469, 473, 477, 482, 486, 491, 495, 499, 504,
    508, 513, 517, 522, 527, 531, 536, 540, 545, 550, 554, 559, 563, 568, 573, 577,
    582, 587, 592, 596, 601, 606, 611, 615, 620, 625, 630, 635, 640, 644, 649, 654,
    659, 664, 669, 674, 678, 683, 688, 693, 698, 703, 708, 713, 718, 723, 728, 732,
    737, 742, 747, 752, 757, 762, 767, 772, 777, 782, 787, 792, 797, 802, 806, 811,
    816, 821, 826, 831, 836, 841, 846, 851, 855, 860, 865, 870, 875, 880, 884, 889,
    894, 899, 904, 908, 913, 918, 923, 927, 932, 937, 941, 946, 951, 955, 960, 965,
    969, 974, 978, 983, 988, 992, 997, 1001, 1005, 1010, 1014, 1019, 1023, 1027, 1032, 1036,
    1040, 1045, 1049, 1053, 1057, 1061, 1066, 1070, 1074, 1078, 1082, 1086, 1090, 1094, 1098, 1102,
    1106, 1109, 1113, 1117, 1121, 1125, 1128, 1132, 1136, 1139, 1143, 1146, 1150, 1153, 1157, 1160,
    1164, 1167, 1170, 1174, 1177, 1180, 1183, 1186, 1190, 1193, 1196, 1199, 1202, 1205, 1207, 1210,
    1213, 1216, 1219, 1221, 1224, 1227, 1229, 1232, 1234, 1237, 1239, 1241, 1244, 1246, 1248, 1251,
    1253, 1255, 1257, 1259, 1261, 1263, 1265, 1267, 1269, 1270, 1272, 1274, 1275, 1277, 1279, 1280,
    1282, 1283, 1284, 1286, 1287, 1288, 1290, 1291, 1292, 1293, 1294, 1295, 1296, 1297, 1297, 1298,
    1299, 1300, 1300, 1301, 1302, 1302, 1303, 1303, 1303, 1304, 1304, 1304, 1304, 1304, 1305, 1305
  ]);

  // Rate counter: events happen when (counter + offset) % period === 0. Rate 0 never fires.
  var RATE_PERIOD = [0, 2048, 1536, 1280, 1024, 768, 640, 512, 384, 320, 256, 192, 160, 128, 96, 80, 64, 48, 40, 32, 24, 20, 16, 12, 10, 8, 6, 5, 4, 3, 2, 1];
  var RATE_OFFSET = (function () {
    var o = [1];
    for (var r = 1; r < 32; r++) o.push([0, 1040, 536][(r - 1) % 3]);
    return o;
  })();
  var COUNTER_START = 0x7800;

  var ATTACK = 0, DECAY = 1, SUSTAIN = 2, RELEASE = 3;
  var MODE_NAMES = ['attack', 'decay', 'sustain', 'release'];

  var clamp16 = function (v) { return v > 32767 ? 32767 : v < -32768 ? -32768 : v; };
  var s8 = function (v) { return (v << 24) >> 24; };

  /**
   * Decode one BRR block (9 bytes at ram[addr]) to 16 samples. prev = [p1, p2] holds the two previous (doubled,
   * 16-bit) samples and is updated. Returns the header byte. Used by the voices and by tools that decode a sample
   * outside the DSP (decodeBrr below).
   */
  function decodeBlock(ram, addr, prev, out, outAt) {
    var hdr = ram[addr & 0xffff];
    var shift = hdr >> 4;
    var filter = hdr & 0x0c;
    var p1 = prev[0];
    var p2 = prev[1];
    for (var k = 0; k < 16; k++) {
      var byte = ram[(addr + 1 + (k >> 1)) & 0xffff];
      var n = (k & 1) ? byte & 15 : byte >> 4;
      if (n >= 8) n -= 16;
      var s = shift <= 12 ? (n << shift) >> 1 : (n < 0 ? -2048 : 0);
      var q2 = p2 >> 1;
      if (filter >= 8) {
        s += p1;
        s -= q2;
        if (filter === 8) {
          s += q2 >> 4;
          s += (p1 * -3) >> 6;
        } else {
          s += (p1 * -13) >> 7;
          s += (q2 * 3) >> 4;
        }
      } else if (filter) {
        s += p1 >> 1;
        s += (-p1) >> 5;
      }
      s = clamp16(s);
      s = ((s * 2) << 16) >> 16;
      out[outAt + k] = s;
      p2 = p1;
      p1 = s;
    }
    prev[0] = p1;
    prev[1] = p2;
    return hdr;
  }

  /**
   * Decode a whole BRR sample (blocks of 9 bytes) to Int16 samples (the DSP's doubled 16-bit values), following
   * the blocks to the first one with the end flag. Does not loop. Returns { samples, blocks, loopFlag, endFlag }.
   */
  function decodeBrr(bytes, offset) {
    var ram = bytes;
    var at = offset || 0;
    var prev = [0, 0];
    var out = [];
    var blk = new Int16Array(16);
    var blocks = 0;
    var hdr = 0;
    while (at + 9 <= ram.length) {
      hdr = decodeBlock(ram, at, prev, blk, 0);
      for (var i = 0; i < 16; i++) out.push(blk[i]);
      blocks += 1;
      at += 9;
      if (hdr & 1) break;
    }
    return { samples: Int16Array.from(out), blocks: blocks, endFlag: (hdr & 1) !== 0, loopFlag: (hdr & 2) !== 0 };
  }

  function create(ram) {
    if (!ram || ram.length < 0x10000) throw new Error('snes-dsp: pass the 64 KB audio RAM');
    var reg = new Uint8Array(128);
    reg[0x6c] = 0xe0;
    var counter = 0;
    var noise = 0x4000;
    var konPending = 0;
    var histL = new Int16Array(8);
    var histR = new Int16Array(8);
    var echoOff = 0;
    var echoLen = 0;
    var voices = [];
    for (var i = 0; i < 8; i++) {
      voices.push({
        konDelay: 0, mode: RELEASE, env: 0, hidden: 0, output: 0,
        brrAddr: 0, ring: new Int16Array(32), decoded: 0, n0: 0, frac: 0, prev: [0, 0],
        silenceAt: Infinity, srcn: 0, blockHdr: 0
      });
    }
    var left = 0;
    var right = 0;

    function ram16(a) { return ram[a & 0xffff] | (ram[(a + 1) & 0xffff] << 8); }
    function dirEntry(srcn, which) { return ram16(((reg[0x5d] << 8) + srcn * 4 + which * 2) & 0xffff); }

    // True when the global rate counter fires for this rate on this sample.
    function poll(rate) {
      return rate !== 0 && (counter + RATE_OFFSET[rate]) % RATE_PERIOD[rate] === 0;
    }

    function startVoice(v, idx) {
      v.srcn = reg[idx * 16 + 4];
      v.brrAddr = dirEntry(v.srcn, 0);
      v.ring.fill(0);
      v.decoded = 0;
      v.n0 = 0;
      v.frac = 0;
      v.prev[0] = 0;
      v.prev[1] = 0;
      v.silenceAt = Infinity;
      v.env = 0;
      v.hidden = 0;
      v.mode = ATTACK;
      v.output = 0;
      reg[0x7c] &= ~(1 << idx);
    }

    function decodeNext(v, idx) {
      var base = v.decoded & 31;
      var blk = new Int16Array(16);
      var hdr = decodeBlock(ram, v.brrAddr, v.prev, blk, 0);
      for (var k = 0; k < 16; k++) v.ring[(base + k) & 31] = blk[k];
      if ((hdr & 3) === 1 && v.silenceAt === Infinity) v.silenceAt = v.decoded;
      v.decoded += 16;
      if (hdr & 1) {
        reg[0x7c] |= 1 << idx;
        if (hdr & 2) v.brrAddr = dirEntry(v.srcn, 1);
        else v.brrAddr = (v.brrAddr + 9) & 0xffff;
      } else v.brrAddr = (v.brrAddr + 9) & 0xffff;
      v.blockHdr = hdr;
    }

    function tap(v, idx, n) {
      if (n < 0) return 0;
      while (n >= v.decoded) decodeNext(v, idx);
      return v.ring[n & 31];
    }

    function runEnvelope(v) {
      var env = v.env;
      var rate;
      if (v.mode === RELEASE) {
        env -= 8;
        v.env = env < 0 ? 0 : env;
        return;
      }
      var base = v.index * 16;
      var adsr1 = reg[base + 5];
      var adsr2 = reg[base + 6];
      if (adsr1 & 0x80) {
        if (v.mode === ATTACK) {
          rate = (adsr1 & 15) * 2 + 1;
          env += rate < 31 ? 0x20 : 0x400;
        } else {
          env -= ((env - 1) >> 8) + 1;
          rate = v.mode === DECAY ? ((adsr1 >> 4) & 7) * 2 + 16 : adsr2 & 31;
        }
      } else {
        var gain = reg[base + 7];
        var gm = gain >> 5;
        if (gm < 4) {
          env = gain * 16;
          rate = 31;
        } else {
          rate = gain & 31;
          if (gm === 4) env -= 0x20;
          else if (gm === 5) env -= ((env - 1) >> 8) + 1;
          else {
            env += 0x20;
            if (gm === 7 && v.hidden >= 0x600) env += 8 - 0x20;
          }
        }
      }
      if ((env >> 8) === (adsr2 >> 5) && v.mode === DECAY) v.mode = SUSTAIN;
      v.hidden = env;
      if (env > 0x7ff || env < 0) {
        env = env < 0 ? 0 : 0x7ff;
        if (v.mode === ATTACK) v.mode = DECAY;
      }
      if (poll(rate)) v.env = env;
    }

    function step() {
      counter = counter === 0 ? COUNTER_START - 1 : counter - 1;
      var flg = reg[0x6c];
      if (poll(flg & 31)) noise = (noise >> 1) | (((noise << 14) ^ (noise << 13)) & 0x4000);
      var kon = konPending;
      konPending = 0;
      var koff = reg[0x5c];
      var pmon = reg[0x2d];
      var non = reg[0x3d];
      var eon = reg[0x4d];
      var sumL = 0;
      var sumR = 0;
      var echoL = 0;
      var echoR = 0;
      var prevOut = 0;
      for (var i = 0; i < 8; i++) {
        var v = voices[i];
        var bit = 1 << i;
        var base = i * 16;
        v.index = i;
        if (kon & bit) v.konDelay = 5;
        var out = 0;
        if (v.konDelay > 0) {
          if (v.konDelay === 5) startVoice(v, i);
          v.konDelay -= 1;
        } else {
          var pitch = ((reg[base + 3] & 0x3f) << 8) | reg[base + 2];
          if ((pmon & bit) && i > 0) pitch += ((prevOut >> 5) * pitch) >> 10;
          if (pitch < 0) pitch = 0;
          else if (pitch > 0x3fff) pitch = 0x3fff;
          var smp;
          if (non & bit) smp = ((noise * 2) << 16) >> 16;
          else {
            var p = v.frac >> 4;
            var s0 = tap(v, i, v.n0 - 1);
            var s1 = tap(v, i, v.n0);
            var s2 = tap(v, i, v.n0 + 1);
            var s3 = tap(v, i, v.n0 + 2);
            smp = (GAUSS[255 - p] * s0) >> 11;
            smp += (GAUSS[511 - p] * s1) >> 11;
            smp += (GAUSS[256 + p] * s2) >> 11;
            smp = (smp << 16) >> 16;
            smp += (GAUSS[p] * s3) >> 11;
            smp = clamp16(smp) & ~1;
          }
          out = ((smp * v.env) >> 11) & ~1;
          if ((flg & 0x80) || v.n0 >= v.silenceAt) {
            v.mode = RELEASE;
            v.env = 0;
          }
          if (koff & bit) v.mode = RELEASE;
          runEnvelope(v);
          v.frac += pitch;
          v.n0 += v.frac >> 12;
          v.frac &= 0xfff;
        }
        v.output = out;
        prevOut = out;
        reg[base + 8] = v.env >> 4;
        reg[base + 9] = (out >> 8) & 0xff;
        sumL = clamp16(sumL + ((out * s8(reg[base])) >> 7));
        sumR = clamp16(sumR + ((out * s8(reg[base + 1])) >> 7));
        if (eon & bit) {
          echoL = clamp16(echoL + ((out * s8(reg[base])) >> 7));
          echoR = clamp16(echoR + ((out * s8(reg[base + 1])) >> 7));
        }
      }

      // Echo: read the sample written one buffer length ago, FIR it, feed back, write the new input.
      var ea = ((reg[0x6d] << 8) + echoOff) & 0xffff;
      for (var k = 0; k < 7; k++) { histL[k] = histL[k + 1]; histR[k] = histR[k + 1]; }
      histL[7] = (((ram[ea] | (ram[(ea + 1) & 0xffff] << 8)) << 16) >> 16) >> 1;
      histR[7] = (((ram[(ea + 2) & 0xffff] | (ram[(ea + 3) & 0xffff] << 8)) << 16) >> 16) >> 1;
      var firL = 0;
      var firR = 0;
      for (k = 0; k < 7; k++) {
        var c = s8(reg[k * 16 + 0x0f]);
        firL = ((firL + ((histL[k] * c) >> 6)) << 16) >> 16;
        firR = ((firR + ((histR[k] * c) >> 6)) << 16) >> 16;
      }
      var c7 = s8(reg[0x7f]);
      firL = clamp16(firL + ((histL[7] * c7) >> 6)) & ~1;
      firR = clamp16(firR + ((histR[7] * c7) >> 6)) & ~1;
      if (!(flg & 0x20)) {
        var wl = clamp16(echoL + ((firL * s8(reg[0x0d])) >> 7)) & ~1;
        var wr = clamp16(echoR + ((firR * s8(reg[0x0d])) >> 7)) & ~1;
        ram[ea] = wl & 0xff; ram[(ea + 1) & 0xffff] = (wl >> 8) & 0xff;
        ram[(ea + 2) & 0xffff] = wr & 0xff; ram[(ea + 3) & 0xffff] = (wr >> 8) & 0xff;
      }
      if (echoOff === 0) echoLen = (reg[0x7d] & 15) * 0x800;
      echoOff += 4;
      if (echoOff >= echoLen) echoOff = 0;

      if (flg & 0x40) { left = 0; right = 0; return; }
      left = clamp16(((sumL * s8(reg[0x0c])) >> 7) + ((firL * s8(reg[0x2c])) >> 7));
      right = clamp16(((sumR * s8(reg[0x1c])) >> 7) + ((firR * s8(reg[0x3c])) >> 7));
    }

    function write(addr, value) {
      addr &= 0xff;
      if (addr >= 0x80) return;
      value &= 0xff;
      if (addr === 0x7c) { reg[0x7c] = 0; return; }
      reg[addr] = value;
      if (addr === 0x4c) konPending |= value;
    }
    function read(addr) { return reg[addr & 0x7f]; }

    /** Next n stereo samples as interleaved Int16Array (L, R, ...). */
    function render(n) {
      var out = new Int16Array(n * 2);
      for (var j = 0; j < n; j++) { step(); out[j * 2] = left; out[j * 2 + 1] = right; }
      return out;
    }

    /** Per-voice view for tools: what it plays and where it is in the envelope. */
    function voiceState(idx) {
      var v = voices[idx];
      var base = idx * 16;
      var srcn = reg[base + 4];
      return {
        voice: idx,
        srcn: srcn,
        sampleStart: dirEntry(srcn, 0),
        sampleLoop: dirEntry(srcn, 1),
        brrAddr: v.brrAddr,
        samplePos: v.n0,
        pitch: ((reg[base + 3] & 0x3f) << 8) | reg[base + 2],
        pitchCounter: v.frac,
        adsr1: reg[base + 5],
        adsr2: reg[base + 6],
        gain: reg[base + 7],
        envelope: v.env,
        envMode: MODE_NAMES[v.mode],
        envx: reg[base + 8],
        outx: s8(reg[base + 9]),
        output: v.output,
        volL: s8(reg[base]),
        volR: s8(reg[base + 1]),
        keyOnDelay: v.konDelay,
        playing: v.konDelay > 0 || v.env > 0 || v.mode !== RELEASE,
        ended: (reg[0x7c] & (1 << idx)) !== 0
      };
    }

    /**
     * Play a sample on a voice: writes the voice registers and keys it on. opts: srcn, pitch (14 bit, $1000 = 32 kHz
     * playback of the stored samples), adsr1/adsr2 or gain (ADSR is used when adsr1 has bit 7 set), volL/volR (signed
     * 8-bit, default 127).
     */
    function playSample(idx, opts) {
      var base = idx * 16;
      write(base + 0, opts.volL == null ? 127 : opts.volL);
      write(base + 1, opts.volR == null ? 127 : opts.volR);
      write(base + 2, opts.pitch & 0xff);
      write(base + 3, (opts.pitch >> 8) & 0x3f);
      write(base + 4, opts.srcn);
      write(base + 5, opts.adsr1 == null ? 0 : opts.adsr1);
      write(base + 6, opts.adsr2 == null ? 0 : opts.adsr2);
      write(base + 7, opts.gain == null ? 0x7f : opts.gain);
      write(0x5c, reg[0x5c] & ~(1 << idx));
      write(0x4c, 1 << idx);
    }

    function keyOff(idx) { write(0x5c, reg[0x5c] | (1 << idx)); }

    return {
      step: step, render: render, read: read, write: write,
      voiceState: voiceState, playSample: playSample, keyOff: keyOff,
      get left() { return left; },
      get right() { return right; },
      get noise() { return noise; },
      get counter() { return counter; },
      get echoOffset() { return echoOff; },
      ram: ram
    };
  }

  /** DSP register helpers shared with the sound unit and tests. */
  var REG = {
    VOLL: 0x00, VOLR: 0x01, PITCHL: 0x02, PITCHH: 0x03, SRCN: 0x04, ADSR1: 0x05, ADSR2: 0x06, GAIN: 0x07,
    ENVX: 0x08, OUTX: 0x09, MVOLL: 0x0c, MVOLR: 0x1c, EVOLL: 0x2c, EVOLR: 0x3c, KON: 0x4c, KOFF: 0x5c, FLG: 0x6c,
    ENDX: 0x7c, EFB: 0x0d, PMON: 0x2d, NON: 0x3d, EON: 0x4d, DIR: 0x5d, ESA: 0x6d, EDL: 0x7d, FIR0: 0x0f
  };

  /** Pitch register value for a playback-rate ratio (1.0 = the stored samples at 32 kHz). */
  function pitchFromRatio(ratio) { return Math.max(0, Math.min(0x3fff, Math.round(ratio * 0x1000))); }
  /** Playback rate in Hz of a pitch register value. */
  function hzFromPitch(pitch) { return (pitch * SAMPLE_RATE) / 0x1000; }
  /** Pitch register value moved by a number of semitones (fractions allowed). */
  function pitchShift(pitch, semitones) { return Math.max(0, Math.min(0x3fff, Math.round(pitch * Math.pow(2, semitones / 12)))); }

  /**
   * Render one voice on a fresh DSP: put the BRR data in a private RAM, key it on and run. opts: brr (Uint8Array of
   * 9-byte blocks), loopBlock (block the loop jumps to when the last block has the loop flag, default 0), pitch,
   * adsr1/adsr2 or gain, volL/volR, samples (how many 32 kHz output samples), keyOffAt (output sample to key off at),
   * echo: { ... } not supported here. Returns { samples: Int16Array (L,R interleaved), rate: 32000, state: [voiceState
   * after each block of 256 samples] } and is deterministic.
   */
  function renderVoice(opts) {
    var ram = new Uint8Array(0x10000);
    var dsp = create(ram);
    var start = 0x1000;
    ram.set(opts.brr, start);
    ram[0x0200] = start & 0xff; ram[0x0201] = start >> 8;
    var loop = start + (opts.loopBlock || 0) * 9;
    ram[0x0202] = loop & 0xff; ram[0x0203] = loop >> 8;
    dsp.write(REG.DIR, 0x02);
    dsp.write(REG.FLG, 0x20);
    dsp.write(REG.MVOLL, 0x7f);
    dsp.write(REG.MVOLR, 0x7f);
    dsp.playSample(0, {
      srcn: 0, pitch: opts.pitch == null ? 0x1000 : opts.pitch, adsr1: opts.adsr1, adsr2: opts.adsr2,
      gain: opts.gain, volL: opts.volL, volR: opts.volR
    });
    var n = opts.samples || SAMPLE_RATE;
    var out = new Int16Array(n * 2);
    for (var j = 0; j < n; j++) {
      if (opts.keyOffAt != null && j === opts.keyOffAt) dsp.keyOff(0);
      dsp.step();
      out[j * 2] = dsp.left;
      out[j * 2 + 1] = dsp.right;
    }
    return { samples: out, rate: SAMPLE_RATE, final: dsp.voiceState(0) };
  }

  /** renderVoice() as a 32 kHz stereo 16-bit WAV file (Uint8Array). Needs lib/audio/wav.js. */
  function renderVoiceToWav(opts) {
    var wav = typeof require === 'function' ? require('./wav') : (typeof self !== 'undefined' ? self.NhlWav : null);
    var r = renderVoice(opts);
    return wav.encode16(r.samples, r.rate, 2);
  }

  return {
    create: create, decodeBlock: decodeBlock, decodeBrr: decodeBrr, renderVoice: renderVoice, renderVoiceToWav: renderVoiceToWav,
    pitchFromRatio: pitchFromRatio, hzFromPitch: hzFromPitch, pitchShift: pitchShift,
    REG: REG, GAUSS: GAUSS, RATE_PERIOD: RATE_PERIOD, RATE_OFFSET: RATE_OFFSET, SAMPLE_RATE: SAMPLE_RATE,
    ATTACK: ATTACK, DECAY: DECAY, SUSTAIN: SUSTAIN, RELEASE: RELEASE
  };
});
