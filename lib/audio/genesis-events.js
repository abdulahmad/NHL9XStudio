/**
 * NHL 93+ FM event stream preview (4-byte events). Sketch only — not Z80/YM accurate.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlGenesisEvents = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TICK_HZ = 60;
  const VBLANK_MULT = 1 / 4;

  function parseEventStream(buf, start, end, options) {
    let pos = start;
    let time = 0;
    const events = [];
    let guard = 8000;
    const noteDuration = (options && options.noteDuration) || 0.15;

    while (guard-- > 0 && pos + 4 <= end && pos < buf.length) {
      const delay = buf[pos];
      const status = buf[pos + 1];
      const b2 = buf[pos + 2];
      const b3 = buf[pos + 3];
      time += (delay * VBLANK_MULT) / TICK_HZ;
      if (status === 0) {
        if (b3 === 0 && b2 === 0) break;
        break;
      }
      const cmd = (status >> 4) & 0x07;
      if (cmd === 1 && b3 > 0) {
        const midi = Math.max(0, Math.min(127, b2));
        events.push({ time, midi, duration: noteDuration });
      }
      pos += 4;
    }
    const duration = events.reduce((m, e) => Math.max(m, e.time + e.duration), 0.3);
    return { events, duration };
  }

  return { parseEventStream };
});
