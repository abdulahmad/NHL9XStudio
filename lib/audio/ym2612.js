/**
 * YM2612 register capture + rough FM preview (Genesis Z80 driver target).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlYm2612 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const YM_CLOCK = 7670454;

  function create() {
    const regs = new Uint8Array(512);
    const writes = [];

    function writePort(port, value) {
      const p = port & 3;
      const v = value & 0xff;
      if (p === 0) {
        regs[0] = v;
        return;
      }
      if (p === 2) {
        regs[256] = v;
        return;
      }
      const latch = regs[p === 1 ? 0 : 256];
      const addr = latch + (p === 1 ? 0 : 256);
      if (addr < regs.length) regs[addr] = v;
      writes.push({ addr, value: v, t: writes.length });
      if (writes.length > 8000) writes.shift();
    }

    function writeBus(addr, value) {
      const a = addr & 0xffff;
      if (a === 0x4000 || a === 0x4001) writePort(a & 1, value);
      else if (a === 0x4002 || a === 0x4003) writePort(2 + (a & 1), value);
    }

    function channelFrequency(ch) {
      const base = 0xa4 + ch * 4;
      const hi = regs[base];
      const lo = regs[base + 1];
      const fnum = ((hi & 7) << 8) | lo;
      const block = (hi >> 3) & 7;
      if (!fnum) return 0;
      return (YM_CLOCK / 144 / 32) * fnum / (1 << (21 - block));
    }

    function channelOn(ch) {
      const slot = 0x28;
      const v = regs[slot];
      return (v & (1 << ch)) !== 0;
    }

    function activeChannels() {
      const out = [];
      for (let ch = 0; ch < 6; ch++) {
        const hz = channelFrequency(ch);
        if (hz > 20 && channelOn(ch)) {
          out.push({
            channel: ch,
            hz,
            midi: Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(hz / 440))))
          });
        }
      }
      return out;
    }

    function toNoteSchedule(durationSec) {
      const channels = activeChannels();
      const events = channels.map((c) => ({
        time: 0,
        duration: durationSec,
        midi: c.midi,
        channel: c.channel
      }));
      return { events, duration: durationSec };
    }

    function reset() {
      regs.fill(0);
      writes.length = 0;
    }

    return {
      regs,
      writes,
      writePort,
      writeBus,
      channelFrequency,
      activeChannels,
      toNoteSchedule,
      reset
    };
  }

  return { create, YM_CLOCK };
});
