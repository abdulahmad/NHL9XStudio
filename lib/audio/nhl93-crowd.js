/**
 * NHLPA 93 Genesis crowd noise, generated (not extracted): the game has no crowd cmdstream or DAC sample. The 68k writes the
 * PSG (SN76489, Asound = $C00011) directly (NHLPA93Genesis src/video93.asm):
 *
 *   KillCrowd (945-951): $E7 noise control: white noise (bit 2), shift rate 3 = tone 2's period
 *                        $DF tone 2 attenuation $F (tone 2 is silent; it only clocks the noise)
 *                        $C8 $01 tone 2 period = ($01 << 4) | 8 = $18
 *                        $FF noise attenuation $F (off)
 *   updatesound (918-943), every game loop: target = Crowdlevel*8 + $400, capped at $EFF; asv (word) steps toward it by at
 *                        most $28; then $C8 $01 (tone 2 period again) and $F0 | ((asv high byte & $F) ^ $F), noise attenuation.
 *
 * In play the target's high byte runs $04..$0E, so the noise attenuation is $B..$1: 11 levels (crowd1 = Crowdlevel 0, the
 * quiet floor, .. crowd11 = Crowdlevel >= 320). The 16-bit Genesis LFSR (taps 0 and 3) shifts at clock / (32 * $18), ~4661 Hz.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Nhl93Crowd = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const CLOCK = 3579545;
  const NOISE_CTRL = 0xe7;
  const TONE2_PERIOD = (0x01 << 4) | (0xc8 & 0x0f); // $18
  const SHIFT_HZ = CLOCK / (32 * TONE2_PERIOD);

  /** asv high byte (target $0400..$0EFF) -> attenuation nibble written as $F0|att, exactly as updatesound does. */
  const attOf = (asvHi) => ((asvHi & 0xff) ^ 0x0f) & 0x0f;
  const LEVELS = [];
  for (let hi = 0x04; hi <= 0x0e; hi++) {
    const n = hi - 3;
    const lo = Math.max(0, (hi * 0x100 - 0x400) >> 3);
    LEVELS.push({ n, name: 'crowd' + n, asvHi: hi, att: attOf(hi), write: 0xf0 | attOf(hi), crowdlevel: n === 11 ? [lo, null] : [lo, ((hi + 1) * 0x100 - 0x400 >> 3) - 1] });
  }
  const OFF = { n: 0, name: 'crowdoff', att: 0x0f, write: 0xff };

  /** SN76489 attenuation: 2 dB per step, $F silent. */
  const gain = (att) => (att >= 15 ? 0 : Math.pow(10, -2 * att / 20));

  /** Render `seconds` of the noise at attenuation `att` as mono Float32 at `rate` Hz. */
  function render(att, seconds, rate) {
    const sr = rate || 44100;
    const out = new Float32Array(Math.round((seconds || 4) * sr));
    const g = gain(att) * 0.5;
    if (!g) return out;
    let lfsr = 0x8000;
    let phase = 0;
    const inc = SHIFT_HZ / sr;
    for (let i = 0; i < out.length; i++) {
      phase += inc;
      while (phase >= 1) {
        phase -= 1;
        lfsr = (lfsr >> 1) | ((((lfsr) ^ (lfsr >> 3)) & 1) << 15);
      }
      out[i] = (lfsr & 1 ? 1 : -1) * g;
    }
    return out;
  }

  return { CLOCK, NOISE_CTRL, TONE2_PERIOD, SHIFT_HZ, LEVELS, OFF, attOf, gain, render };
});
