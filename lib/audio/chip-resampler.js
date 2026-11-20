/**
 * Streaming linear resampler: pulls stereo PCM at the chip's native rate and
 * returns blocks at the output device rate.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlChipResampler = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function create(srcRate, dstRate, pull) {
    const step = srcRate / dstRate;
    let pos = 0;
    let lastL = 0;
    let lastR = 0;

    function process(frames) {
      const left = new Float32Array(frames);
      const right = new Float32Array(frames);
      const endPos = pos + frames * step;
      const need = Math.floor(endPos) + 1;
      const fresh = pull(need);
      const srcL = (k) => (k === 0 ? lastL : fresh.left[k - 1] || 0);
      const srcR = (k) => (k === 0 ? lastR : fresh.right[k - 1] || 0);
      for (let i = 0; i < frames; i++) {
        const p = pos + i * step;
        const k = Math.floor(p);
        const f = p - k;
        left[i] = srcL(k) * (1 - f) + srcL(k + 1) * f;
        right[i] = srcR(k) * (1 - f) + srcR(k + 1) * f;
      }
      const consumed = Math.floor(endPos);
      lastL = srcL(consumed);
      lastR = srcR(consumed);
      pos = endPos - consumed;
      return { left, right };
    }

    function reset() {
      pos = 0;
      lastL = lastR = 0;
    }

    return { process, reset, step };
  }

  return { create };
});
