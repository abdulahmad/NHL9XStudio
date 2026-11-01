/**
 * YM2612 register bus (Genesis 0x4000–0x4003) + channel helpers for Z80 harness.
 * PCM synthesis: lib/audio/ym2612-wasm.js (chip lab) or future runtime hook.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlYm2612 = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const YM_CLOCK = 7670454;
  // Register 0x28 low bits select the channel: 0-2 bank 0, 4-6 bank 1.
  const KEY_CHANNEL = [0, 1, 2, -1, 3, 4, 5, -1];

  function create(opts) {
    const sampleRate = (opts && opts.sampleRate) || 44100;
    const regs = new Uint8Array(512);
    const keyOn = [false, false, false, false, false, false];
    const writes = [];
    let latch0 = 0;
    let latch1 = 0;

    function mirrorWrite(addr, value) {
      const a = addr & 0x1ff;
      if (a < regs.length) regs[a] = value & 0xff;
      if (a === 0x28) {
        const ch = KEY_CHANNEL[value & 0x07];
        if (ch >= 0) keyOn[ch] = (value & 0xf0) !== 0;
      }
      writes.push({ addr: a, value: value & 0xff, t: writes.length });
      if (writes.length > 8000) writes.shift();
    }

    function writePort(port, value) {
      const p = port & 3;
      const v = value & 0xff;
      if (p === 0) {
        latch0 = v;
        return;
      }
      if (p === 2) {
        latch1 = v;
        return;
      }
      const addr = p === 1 ? latch0 : (latch1 | 0x100);
      mirrorWrite(addr, v);
    }

    function writeBus(addr, value) {
      const a = addr & 0xffff;
      if (a === 0x4000 || a === 0x4001) writePort(a & 1, value);
      else if (a === 0x4002 || a === 0x4003) writePort(2 + (a & 1), value);
    }

    function channelFrequency(ch) {
      const bank = ch >= 3 ? 0x100 : 0;
      const slot = ch % 3;
      const hi = regs[bank + 0xa4 + slot];
      const lo = regs[bank + 0xa0 + slot];
      const fnum = ((hi & 7) << 8) | lo;
      const block = (hi >> 3) & 7;
      if (!fnum) return 0;
      return (YM_CLOCK / 144) * fnum / (1 << (21 - block));
    }

    function channelOn(ch) {
      return keyOn[ch];
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

    function generateStereo() {
      return { left: new Float32Array(0), right: new Float32Array(0) };
    }

    function reset() {
      regs.fill(0);
      keyOn.fill(false);
      writes.length = 0;
      latch0 = latch1 = 0;
    }

    return {
      regs,
      writes,
      writePort,
      writeBus,
      channelFrequency,
      activeChannels,
      toNoteSchedule,
      generateStereo,
      reset,
      YM_CLOCK,
      sampleRate
    };
  }

  return { create, YM_CLOCK };
});
