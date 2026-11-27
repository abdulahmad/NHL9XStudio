/**
 * Texas Instruments SN76489 PSG (Sega Master System / Genesis via VDP).
 * Latch/data protocol per SMS Power + square / LFSR noise sample generation.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlSn76489 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_CLOCK = 3579545;

  function volToGain(vol) {
    const v = vol & 0x0f;
    if (v >= 0x0f) return 0;
    return Math.pow(10, -v * 2 / 20); // 2 dB per attenuation step (SN76489 datasheet)
  }

  function create(opts) {
    const clock = (opts && opts.clock) || DEFAULT_CLOCK;
    const tone = [0, 0, 0];
    const volume = [0x0f, 0x0f, 0x0f, 0x0f];
    let noiseCtrl = 0x00;
    let latchedTone = 0;
    const writes = [];

    let phase0 = 0;
    let phase1 = 0;
    let phase2 = 0;
    let noisePhase = 0;
    let noiseLfsr = 0x8000;
    let noiseBit = 1;

    function write(byte) {
      const b = byte & 0xff;
      writes.push(b);
      if (writes.length > 4096) writes.shift();
      if (b & 0x80) {
        const code = (b >> 4) & 0x0f;
        if (code === 8 || code === 10 || code === 12) {
          const ch = (code - 8) >> 1;
          latchedTone = ch;
          tone[ch] = (tone[ch] & 0x3f0) | (b & 0x0f);
        } else if (code === 9 || code === 11 || code === 13) {
          const ch = (code - 9) >> 1;
          volume[ch] = b & 0x0f;
        } else if (code === 14) {
          noiseCtrl = b & 0x0f;
          noiseLfsr = 0x8000; // a write to the noise register resets the shift register
          noisePhase = 0;
        } else if (code === 15) {
          volume[3] = b & 0x0f;
        }
      } else {
        tone[latchedTone] = (tone[latchedTone] & 0x00f) | ((b & 0x3f) << 4);
      }
    }

    // Square wave of clock / (32 * N); period 0 counts as 1 (Sega PSG).
    function toneStep(period) {
      const p = (period & 0x3ff) || 1;
      return clock / (32 * p);
    }

    // The shift register clocks at clock / 512, / 1024, / 2048 (N = $10, $20, $40), or once per tone 2 period (rate 3).
    function noiseStep() {
      const mode = noiseCtrl & 0x03;
      if (mode === 3) return toneStep(tone[2]);
      return clock / (512 << mode);
    }

    // 16-bit shift register, output bit 0: white noise feeds back bit 0 XOR bit 3 (Sega), periodic noise bit 0.
    function nextNoiseBit() {
      const out = noiseLfsr & 1;
      const fb = noiseCtrl & 0x04 ? ((noiseLfsr ^ (noiseLfsr >> 3)) & 1) : out;
      noiseLfsr = (noiseLfsr >> 1) | (fb << 15);
      return out;
    }

    function generateSamples(count, sampleRate) {
      const sr = sampleRate || 44100;
      const out = new Float32Array(count);
      const inc0 = toneStep(tone[0]) / sr;
      const inc1 = toneStep(tone[1]) / sr;
      const inc2 = toneStep(tone[2]) / sr;
      const incN = noiseStep() / sr;
      const g0 = volToGain(volume[0]);
      const g1 = volToGain(volume[1]);
      const g2 = volToGain(volume[2]);
      const g3 = volToGain(volume[3]);

      for (let i = 0; i < count; i++) {
        let mix = 0;
        if (g0) {
          phase0 += inc0;
          if (phase0 >= 1) phase0 -= 1;
          mix += (phase0 < 0.5 ? 1 : -1) * g0;
        }
        if (g1) {
          phase1 += inc1;
          if (phase1 >= 1) phase1 -= 1;
          mix += (phase1 < 0.5 ? 1 : -1) * g1;
        }
        if (g2) {
          phase2 += inc2;
          if (phase2 >= 1) phase2 -= 1;
          mix += (phase2 < 0.5 ? 1 : -1) * g2;
        }
        if (g3) {
          noisePhase += incN;
          while (noisePhase >= 1) {
            noisePhase -= 1;
            noiseBit = nextNoiseBit() ? 1 : -1;
          }
          mix += noiseBit * g3;
        }
        out[i] = Math.max(-1, Math.min(1, mix * 0.35));
      }
      return out;
    }

    function reset() {
      tone[0] = tone[1] = tone[2] = 0;
      volume[0] = volume[1] = volume[2] = volume[3] = 0x0f;
      noiseCtrl = 0;
      latchedTone = 0;
      writes.length = 0;
      phase0 = phase1 = phase2 = noisePhase = 0;
      noiseLfsr = 0x8000;
      noiseBit = 1;
    }

    function snapshot() {
      return {
        tone: tone.slice(),
        volume: volume.slice(),
        noiseCtrl,
        writes: writes.length
      };
    }

    return {
      clock,
      write,
      reset,
      generateSamples,
      snapshot,
      writes,
      tone,
      volume
    };
  }

  return { create, DEFAULT_CLOCK, volToGain };
});
