/**
 * Instrument edits in the Genesis sequencers' exports.
 *
 * The YM2612 instrument editor (public/sound-patch-editor.js) keeps a song's edits as `patchEdits`: { patchId: 32 bytes }
 * (26 register bytes, the note offset at +26, the rest as the ROM has it). Playback writes them into the ROM copy;
 * these helpers carry the same bytes into the exports:
 *
 *   ids(edits)                       the edited patch ids, ascending (only entries with 32 bytes)
 *   marker(prefix, id, bytes)        MIDI marker text '<prefix> patch id=<id> bytes=<64 hex digits>'
 *   readMarkers(prefix, markers)     those markers back as a patchEdits object, or null when there are none
 *   asmLines(edits, label, where)    dc.b rows per edited patch; where(id) names its place in the ROM
 *   trailer(edits)                   'PTCH', count, then id + 32 bytes per patch; empty when nothing is edited
 *   readTrailer(bytes, from)         a trailer at byte `from` as { edits, end }, or null
 *   withEdits(bank, edits)           a copy of a bank (array of 32-byte patches) with the edits applied
 *
 * Nothing is added when nothing is edited, so a retail song's exports stay byte for byte what they were.
 *
 * UMD: Node and the browser.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlPatchEdits = api;
})(typeof self !== 'undefined' ? self : this, function () {
  var SIZE = 32;
  var MAGIC = [0x50, 0x54, 0x43, 0x48]; // 'PTCH'

  function ids(edits) {
    if (!edits) return [];
    return Object.keys(edits)
      .filter(function (k) { return /^\d+$/.test(k) && edits[k] && edits[k].length === SIZE; })
      .map(Number)
      .sort(function (a, b) { return a - b; });
  }

  var hex = function (bytes) { return Array.prototype.map.call(bytes, function (v) { return ((v & 255) < 16 ? '0' : '') + (v & 255).toString(16); }).join(''); };

  function marker(prefix, id, bytes) {
    return prefix + ' patch id=' + id + ' bytes=' + hex(bytes);
  }

  function readMarkers(prefix, markers) {
    var re = new RegExp('^' + prefix + ' patch id=(\\d+) bytes=([0-9a-fA-F]{' + SIZE * 2 + '})$');
    var out = null;
    (markers || []).forEach(function (m) {
      var x = re.exec(String(m.text).trim());
      if (!x) return;
      var bytes = [];
      for (var i = 0; i < SIZE; i++) bytes.push(parseInt(x[2].substr(i * 2, 2), 16));
      out = out || {};
      out[Number(x[1])] = bytes;
    });
    return out;
  }

  function asmLines(edits, label, where) {
    var list = ids(edits);
    if (!list.length) return [];
    var h = function (v) { return '$' + (v < 16 ? '0' : '') + v.toString(16).toUpperCase(); };
    var L = ['', '; Edited instruments (the sequencer\'s YM2612 editor). Each replaces the 32 bytes of that patch in the patch table:',
      '; register bytes 0-25 (DT/MUL, TL, RS/AR, AM/D1R, D2R, SL/RR x 4 operators, FB/ALG, pan/AMS/FMS), byte 26 the note offset.'];
    list.forEach(function (id) {
      var b = edits[id];
      L.push(label + '_patch' + id + ':\t; patch ' + id + (where ? ' (' + where(id) + ')' : ''));
      for (var i = 0; i < SIZE; i += 16) L.push('\tdc.b ' + Array.prototype.slice.call(b, i, i + 16).map(function (v) { return h(v & 255); }).join(', '));
    });
    return L;
  }

  function trailer(edits) {
    var list = ids(edits);
    if (!list.length) return new Uint8Array(0);
    var out = new Uint8Array(MAGIC.length + 1 + list.length * (1 + SIZE));
    out.set(MAGIC, 0);
    out[4] = list.length;
    list.forEach(function (id, i) {
      var at = 5 + i * (1 + SIZE);
      out[at] = id;
      for (var k = 0; k < SIZE; k++) out[at + 1 + k] = edits[id][k] & 255;
    });
    return out;
  }

  function readTrailer(bytes, from) {
    if (from + 5 > bytes.length) return null;
    for (var m = 0; m < MAGIC.length; m++) if (bytes[from + m] !== MAGIC[m]) return null;
    var n = bytes[from + 4];
    var end = from + 5 + n * (1 + SIZE);
    if (end > bytes.length) return null;
    var edits = {};
    for (var i = 0; i < n; i++) {
      var at = from + 5 + i * (1 + SIZE);
      edits[bytes[at]] = Array.prototype.slice.call(bytes, at + 1, at + 1 + SIZE);
    }
    return { edits: edits, end: end };
  }

  function withEdits(bank, edits) {
    var list = ids(edits);
    if (!list.length) return bank;
    var out = bank.slice();
    list.forEach(function (id) { if (id < out.length) out[id] = Uint8Array.from(edits[id]); });
    return out;
  }

  return { SIZE: SIZE, ids: ids, marker: marker, readMarkers: readMarkers, asmLines: asmLines, trailer: trailer, readTrailer: readTrailer, withEdits: withEdits };
});
