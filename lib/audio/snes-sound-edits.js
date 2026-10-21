/**
 * NHL 94 (SNES) sound-entry edits for the sequencer (48-byte SoundTable rows).
 * Markers: n94:sound set=<set> id=<n> bytes=<96 hex digits>
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlSnesSoundEdits = api;
})(typeof self !== 'undefined' ? self : this, function () {
  var SIZE = 48;
  var hex = function (bytes) { return Array.prototype.map.call(bytes, function (v) { return ((v & 255) < 16 ? '0' : '') + (v & 255).toString(16); }).join(''); };

  function ids(edits) {
    if (!edits) return [];
    return Object.keys(edits).filter(function (k) { return /^\d+$/.test(k) && edits[k] && edits[k].length === SIZE; }).map(Number).sort(function (a, b) { return a - b; });
  }

  function marker(set, id, bytes) {
    return 'n94:sound set=' + set + ' id=' + id + ' bytes=' + hex(bytes);
  }

  function readMarkers(markers) {
    var re = /^n94:sound set=(\w+) id=(\d+) bytes=([0-9a-fA-F]{96})$/;
    var out = null;
    (markers || []).forEach(function (m) {
      var x = re.exec(String(m.text).trim());
      if (!x) return;
      var bytes = [];
      for (var i = 0; i < SIZE; i++) bytes.push(parseInt(x[3].substr(i * 2, 2), 16));
      out = out || { set: x[1], entries: {} };
      out.entries[Number(x[2])] = bytes;
    });
    return out;
  }

  function applyTable(sounds, edits) {
    if (!edits) return sounds;
    return sounds.map(function (s, i) {
      var raw = edits[i];
      if (!raw || raw.length !== SIZE) return s;
      var copy = Object.assign({}, s);
      copy.raw = raw.slice();
      copy.adsr1 = raw[0x15];
      copy.adsr2 = raw[0x16];
      copy.gain = raw[0x0a];
      copy.sample = raw[0x14];
      copy.adsr = (raw[0x15] & 0x80) !== 0;
      return copy;
    });
  }

  return { SIZE: SIZE, ids: ids, marker: marker, readMarkers: readMarkers, applyTable: applyTable };
});
