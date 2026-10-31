/**
 * EA .VIV archives (NHL 94/95 PC announcer speech). Containers may hold BNK lumps, raw IFF-ish speech, or other resources.
 * BNK layout: Valery Anisimovsky GameAudioPlayer Specs/EA-MUS.txt (via MultimediaWiki).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlViv = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function findAscii(bytes, tag) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var t = [];
    for (var i = 0; i < tag.length; i++) t.push(tag.charCodeAt(i));
    for (var p = 0; p + t.length <= u8.length; p++) {
      var ok = true;
      for (var k = 0; k < t.length; k++) if (u8[p + k] !== t[k]) { ok = false; break; }
      if (ok) return p;
    }
    return -1;
  }

  /** @returns {{offset:number, version:number, count:number}|null} */
  function parseBnkHeader(bytes, offset) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var o = offset || 0;
    if (o + 12 > u8.length) return null;
    if (String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]) !== 'BNKl') return null;
    var dv = new DataView(u8.buffer, u8.byteOffset + o, u8.byteLength - o);
    return { offset: o, version: dv.getUint16(4, true), count: dv.getUint16(6, true) };
  }

  /** Find the first BNK lump inside a VIV (or any buffer). */
  function findBnk(bytes) {
    var at = findAscii(bytes, 'BNKl');
    return at < 0 ? null : parseBnkHeader(bytes, at);
  }

  /**
   * Heuristic: speech extracted from XBRUCE.VIV is often 8SVX body without the FORM header.
   * If `8SVX` appears at `offset`, return that offset; else if the buffer looks like a PT chunk, return null.
   */
  function findIffSpeech(bytes) {
    var at = findAscii(bytes, '8SVX');
    if (at >= 0) return at;
    at = findAscii(bytes, 'FORM');
    if (at >= 0) return at;
    return -1;
  }

  return { findAscii: findAscii, parseBnkHeader: parseBnkHeader, findBnk: findBnk, findIffSpeech: findIffSpeech };
});
