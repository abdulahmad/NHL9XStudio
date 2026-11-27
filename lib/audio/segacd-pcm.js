/**
 * NHL 94 Sega CD .PCM files (the ISO root: team names, All-Star lines, Ron Barr
 * speech). RF5C164 PCM: 8-bit sign-magnitude, bit 7 set = positive, low 7 bits
 * are the magnitude, 0xFF is the loop/end marker. Mono at about 16276 Hz.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlSegaCdPcm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var RATE = 16276;

  /** Signed 8-bit samples (as bytes) up to the 0xFF marker. */
  function decode(bytes) {
    var n = bytes.length;
    for (var i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0xff) { n = i; break; }
    }
    var out = new Uint8Array(n);
    for (var j = 0; j < n; j++) {
      var b = bytes[j];
      var mag = b & 0x7f;
      var v = (b & 0x80) ? mag : -mag;
      out[j] = v < 0 ? v + 256 : v;
    }
    return out;
  }

  return { RATE: RATE, decode: decode };
});
