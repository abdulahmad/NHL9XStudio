/**
 * Register / latch sequences for chip-lab.html demos.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlChipLabPresets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const YM_CLOCK = 7670454;

  function hzToFnum(hz, block) {
    const b = block != null ? block : 4;
    const f = Math.round((hz * (1 << (21 - b)) * 144 * 32) / YM_CLOCK);
    return { fnum: f & 0x7ff, block: b & 7 };
  }

  function ymWritesForTone(hz) {
    const { fnum, block } = hzToFnum(hz, 4);
    const a4 = ((block & 7) << 3) | ((fnum >> 8) & 7);
    const a5 = fnum & 0xff;
    return [
      { port: 0, value: 0x30 }, { port: 1, value: 0x71 },
      { port: 0, value: 0x34 }, { port: 1, value: 0x01 },
      { port: 0, value: 0x50 }, { port: 1, value: 0x00 },
      { port: 0, value: 0x54 }, { port: 1, value: 0x00 },
      { port: 0, value: 0x60 }, { port: 1, value: 0x0f },
      { port: 0, value: 0x64 }, { port: 1, value: 0x0f },
      { port: 0, value: 0x70 }, { port: 1, value: 0x00 },
      { port: 0, value: 0x74 }, { port: 1, value: 0x00 },
      { port: 0, value: 0xa4 }, { port: 1, value: a4 },
      { port: 0, value: 0xa5 }, { port: 1, value: a5 },
      { port: 0, value: 0x28 }, { port: 1, value: 0xf0 }
    ];
  }

  function applyYmPreset(ym, id) {
    const hz = id === 'low' ? 110 : id === 'mid' ? 329.63 : 440;
    const list = ymWritesForTone(hz);
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
    hzToFnum,
    ymWritesForTone,
    applyYmPreset,
    psgTonePreset,
    psgNoisePreset
  };
});
