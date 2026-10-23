/**
 * Minimal 16-bit PCM WAV writer. Output is a pure function of its input, so the
 * same samples always give the same bytes (no timestamps or metadata chunks).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlWav = api;
})(typeof self !== 'undefined' ? self : this, function () {
  /**
   * @param {Int16Array} samples interleaved PCM (L,R,L,R… for stereo)
   * @param {number} sampleRate integer frames per second
   * @param {number} [channels=2]
   * @returns {Uint8Array}
   */
  function encode16(samples, sampleRate, channels) {
    const ch = channels || 2;
    const dataBytes = samples.length * 2;
    const out = new Uint8Array(44 + dataBytes);
    const dv = new DataView(out.buffer);
    const ascii = (at, s) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };
    ascii(0, 'RIFF');
    dv.setUint32(4, 36 + dataBytes, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, ch, true);
    dv.setUint32(24, sampleRate, true);
    dv.setUint32(28, sampleRate * ch * 2, true);
    dv.setUint16(32, ch * 2, true);
    dv.setUint16(34, 16, true);
    ascii(36, 'data');
    dv.setUint32(40, dataBytes, true);
    for (let i = 0; i < samples.length; i++) dv.setInt16(44 + i * 2, samples[i], true);
    return out;
  }

  /** Inverse of encode16 for tests: { sampleRate, channels, samples }. */
  function decode16(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const channels = dv.getUint16(22, true);
    const sampleRate = dv.getUint32(24, true);
    const dataBytes = dv.getUint32(40, true);
    const samples = new Int16Array(dataBytes / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = dv.getInt16(44 + i * 2, true);
    return { sampleRate, channels, samples };
  }

  return { encode16, decode16 };
});
