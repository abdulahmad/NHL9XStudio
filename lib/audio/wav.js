/**
 * Minimal 16-bit PCM WAV writer. Output is a pure function of its input, so the
 * same samples always give the same bytes (no timestamps or metadata chunks).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlWav = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function asciiInto(out, at, s) {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  }

  /**
   * @param {Int16Array} samples interleaved PCM (L,R,L,R… for stereo)
   * @param {number} sampleRate integer frames per second
   * @param {number} [channels=2]
   * @param {{loop?: {start:number, end:number}}} [opts] loop points in frames (smpl chunk)
   * @returns {Uint8Array}
   */
  function encode16(samples, sampleRate, channels, opts) {
    const ch = channels || 2;
    const frames = samples.length / ch;
    const dataBytes = samples.length * 2;
    const loop = opts && opts.loop;
    const smplBytes = loop ? 68 : 0;
    const out = new Uint8Array(44 + smplBytes + dataBytes);
    const dv = new DataView(out.buffer);
    asciiInto(out, 0, 'RIFF');
    dv.setUint32(4, 36 + smplBytes + dataBytes, true);
    asciiInto(out, 8, 'WAVE');
    asciiInto(out, 12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, ch, true);
    dv.setUint32(24, sampleRate, true);
    dv.setUint32(28, sampleRate * ch * 2, true);
    dv.setUint16(32, ch * 2, true);
    dv.setUint16(34, 16, true);
    let o = 36;
    if (loop) {
      asciiInto(out, o, 'smpl');
      dv.setUint32(o + 4, 60, true);
      dv.setUint32(o + 8, 0, true);
      dv.setUint32(o + 12, 0, true);
      dv.setUint32(o + 16, Math.round(1e9 / sampleRate), true);
      dv.setUint32(o + 20, 60, true);
      dv.setUint32(o + 24, 0, true);
      dv.setUint32(o + 28, 0, true);
      dv.setUint32(o + 32, 0, true);
      dv.setUint32(o + 36, 1, true);
      dv.setUint32(o + 40, 0, true);
      dv.setUint32(o + 44, 0, true);
      dv.setUint32(o + 48, 0, true);
      const start = Math.max(0, Math.min(frames - 1, loop.start | 0));
      let end = loop.end | 0;
      if (end <= start) end = frames;
      end = Math.min(frames, Math.max(start + 1, end));
      dv.setUint32(o + 52, start, true);
      dv.setUint32(o + 56, end - 1, true);
      dv.setUint32(o + 60, 0, true);
      dv.setUint32(o + 64, 0, true);
      o += 68;
    }
    asciiInto(out, o, 'data');
    dv.setUint32(o + 4, dataBytes, true);
    for (let i = 0; i < samples.length; i++) dv.setInt16(o + 8 + i * 2, samples[i], true);
    return out;
  }

  function ieee80(hz) {
    const out = new Uint8Array(10);
    if (!hz) return out;
    const sign = hz < 0 ? 0x8000 : 0;
    hz = Math.abs(hz);
    let exp = Math.floor(Math.log(hz) / Math.LN2);
    const mant = hz / Math.pow(2, exp);
    exp += 16383;
    const word = sign | (exp & 0x7fff);
    out[0] = word >> 8;
    out[1] = word & 255;
    let frac = mant;
    for (let i = 0; i < 8; i++) {
      frac *= 256;
      const b = Math.floor(frac);
      out[2 + i] = b & 255;
      frac -= b;
    }
    return out;
  }

  /** 16-bit big-endian AIFF (one channel unless `channels` is set). */
  function encodeAiff16(samples, sampleRate, channels) {
    const ch = channels || 2;
    const frames = samples.length / ch;
    const dataBytes = samples.length * 2;
    const comm = 18;
    const ssnd = 8 + dataBytes;
    const form = 4 + 8 + comm + 8 + ssnd;
    const out = new Uint8Array(8 + form);
    const dv = new DataView(out.buffer);
    asciiInto(out, 0, 'FORM');
    dv.setUint32(4, form);
    asciiInto(out, 8, 'AIFF');
    asciiInto(out, 12, 'COMM');
    dv.setUint32(16, comm);
    dv.setUint16(20, ch);
    dv.setUint32(22, frames);
    dv.setUint16(26, 16);
    out.set(ieee80(sampleRate), 28);
    asciiInto(out, 38, 'SSND');
    dv.setUint32(42, ssnd);
    dv.setUint32(46, 0);
    dv.setUint32(50, 0);
    for (let i = 0; i < samples.length; i++) dv.setInt16(54 + i * 2, samples[i]);
    return out;
  }

  /** Inverse of encode16 for tests: { sampleRate, channels, samples, loop? }. */
  function decode16(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let o = 12;
    let channels = 1;
    let sampleRate = 0;
    let samples = new Int16Array(0);
    let loop = null;
    while (o + 8 <= u8.length) {
      const tag = String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
      const size = dv.getUint32(o + 4, true);
      const body = o + 8;
      if (tag === 'fmt ') {
        channels = dv.getUint16(body + 2, true);
        sampleRate = dv.getUint32(body + 4, true);
      } else if (tag === 'data') {
        samples = new Int16Array(size / 2);
        for (let i = 0; i < samples.length; i++) samples[i] = dv.getInt16(body + i * 2, true);
      } else if (tag === 'smpl' && size >= 60) {
        const nLoop = dv.getUint32(body + 28, true);
        if (nLoop) loop = { start: dv.getUint32(body + 44, true), end: dv.getUint32(body + 48, true) + 1 };
      }
      o = body + size + (size & 1);
    }
    return { sampleRate, channels, samples, loop };
  }

  return { encode16, encodeAiff16, decode16 };
});
