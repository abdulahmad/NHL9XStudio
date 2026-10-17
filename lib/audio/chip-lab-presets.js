/**
 * Register / latch sequences for chip-lab.html demos.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlChipLabPresets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const YM_CLOCK = 7670454;
  const OPERATOR_OFFSETS = [0x00, 0x04, 0x08, 0x0c];

  // F = fnum * (clock / 144) / 2^(21 - block); fnum is 11 bits.
  function hzToFnum(hz) {
    for (let block = 0; block < 8; block++) {
      const fnum = Math.round((hz * 144 * (1 << (21 - block))) / YM_CLOCK);
      if (fnum <= 0x7ff) return { fnum, block };
    }
    return { fnum: 0x7ff, block: 7 };
  }

  function fnumToHz(fnum, block) {
    return (fnum * (YM_CLOCK / 144)) / (1 << (21 - block));
  }

  // Channel 1, algorithm 7: operator 4 alone is audible (pure sine), others muted.
  function ymWritesForTone(hz) {
    const { fnum, block } = hzToFnum(hz);
    const writes = [];
    const reg = (addr, value) => {
      writes.push({ port: 0, value: addr }, { port: 1, value });
    };
    reg(0x22, 0x00);
    reg(0x27, 0x00);
    reg(0x2b, 0x00);
    reg(0x28, 0x00);
    OPERATOR_OFFSETS.forEach((off, i) => {
      const carrier = i === 3;
      reg(0x30 + off, 0x01);
      reg(0x40 + off, carrier ? 0x00 : 0x7f);
      reg(0x50 + off, 0x1f);
      reg(0x60 + off, 0x00);
      reg(0x70 + off, 0x00);
      reg(0x80 + off, 0x0f);
      reg(0x90 + off, 0x00);
    });
    reg(0xb0, 0x07);
    reg(0xb4, 0xc0);
    reg(0xa4, ((block & 7) << 3) | ((fnum >> 8) & 7));
    reg(0xa0, fnum & 0xff);
    reg(0x28, 0xf0);
    return writes;
  }

  const YM_PRESET_HZ = { '440': 440, mid: 329.63, low: 110 };

  function applyYmPreset(ym, id) {
    const list = ymWritesForTone(YM_PRESET_HZ[id] || 440);
    for (const step of list) ym.writePort(step.port, step.value);
    return list.length;
  }

  function psgTonePreset(psg, hz) {
    const clock = psg.clock || 3579545;
    const period = Math.max(1, Math.min(0x3ff, Math.round(clock / (32 * hz) - 1)));
    psg.write(0x80 | (period & 0x0f));
    psg.write((period >> 4) & 0x3f);
    psg.write(0x90);
  }

  function psgNoisePreset(psg) {
    psg.write(0xe0);
    psg.write(0x80 | 0x03);
    psg.write(0xf0);
  }

  return {
    YM_CLOCK,
    YM_PRESET_HZ,
    hzToFnum,
    fnumToHz,
    ymWritesForTone,
    applyYmPreset,
    psgTonePreset,
    psgNoisePreset
  };
});
