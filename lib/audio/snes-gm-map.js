/**
 * NHLPA '93 / NHL '94 (SNES) instruments and sound entries <-> General MIDI.
 *
 * The maps live in data/audio/nhl93s-gm-map.json and nhl94s-gm-map.json. This module is the shared lookup layer
 * (SNES -> GM labels for the UI, GM program/drum -> SNES id for MIDI import) and validation. Measurements are in
 * snes-gm-analysis.js; nothing here changes drivers or sound data.
 */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var api = factory(isNode ? require('./nhl92-gm-map') : root.Nhl92GmMap);
  if (isNode) module.exports = api;
  else root.NhlSnesGmMap = api;
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  var DRUM_FIRST = G.DRUM_FIRST;
  var DRUM_LAST = G.DRUM_LAST;

  /** GM program family key for NHLPA '93 family defaults (object per set). */
  function familyKey93(program) {
    if (program < 24) return 'keys';
    if (program < 32) return 'guitar';
    if (program < 40) return 'bass';
    if (program < 80) return 'lead';
    if (program < 96) return 'pad';
    if (program < 104) return 'fx';
    if (program < 120) return 'other';
    return 'fx';
  }

  /** One row of a set (instrument / sound entry). */
  function entry(map, set, id) {
    var s = map && map.sets && map.sets[set];
    if (!s) return null;
    return s[String(id)] || s[id] || null;
  }

  /** SNES row as a GM target { kind:'program'|'drum', program?, note?, key?, text }. */
  function toGmTarget(row) {
    if (!row) return null;
    if (row.drum != null) {
      return { kind: 'drum', note: row.drum, key: row.key, text: 'GM drum ' + row.drum + ' (' + G.drumName(row.drum) + ')' };
    }
    if (row.program != null) {
      return { kind: 'program', program: row.program, text: 'GM program ' + row.program + ' (' + G.programName(row.program) + ')' };
    }
    return null;
  }

  /** UI text for a mapped instrument / sound entry. */
  function describeEntry(map, set, id) {
    var row = entry(map, set, id);
    if (!row) return null;
    var tgt = toGmTarget(row);
    var runner = row.runnerUp ? (row.runnerUp.drum != null
      ? 'GM drum ' + row.runnerUp.drum + ' (' + G.drumName(row.runnerUp.drum) + ')'
      : 'GM program ' + row.runnerUp.program + ' (' + G.programName(row.runnerUp.program) + ')') : '';
    return { text: tgt ? tgt.text : '', why: row.why, confidence: row.confidence, runnerUp: runner };
  }

  /** Every set id whose row maps to this GM program (SNES -> GM reverse lookup). */
  function idsForProgram(map, set, program) {
    var s = (map.sets && map.sets[set]) || {};
    return Object.keys(s).filter(function (k) { return s[k].program === program; }).map(Number).sort(function (a, b) { return a - b; });
  }

  /** NHLPA '93: GM melodic program -> instrument id in `set`. */
  function instrumentForProgram93(map, set, program) {
    var exact = idsForProgram(map, set, program);
    if (exact.length) return exact[0];
    var fam = (map.families && map.families[set]) || {};
    var f = familyKey93(program);
    return fam[f] != null ? fam[f] : fam.other;
  }

  /** NHL '94: GM melodic program -> sound entry id (`preferred` wins when several match; `pan` picks the closest variant). */
  function instrumentForProgram94(map, set, program, pan) {
    var ranges = map.families && map.families[set];
    var want = program;
    if (Array.isArray(ranges)) {
      var hit = ranges.find(function (f) { return program >= f[0] && program <= f[1]; });
      if (hit) want = hit[2];
    }
    var s = (map.sets && map.sets[set]) || {};
    var keys = Object.keys(s).filter(function (k) { return s[k].program === want; });
    if (!keys.length) return null;
    if (keys.length === 1) return Number(keys[0]);
    var panWant = pan == null ? 64 : pan;
    var best = keys[0];
    var bestD = 1e9;
    keys.forEach(function (k) {
      var row = s[k];
      var p = row.pan != null ? row.pan : (row.preferred ? 64 : 48);
      var d = Math.abs(p - panWant);
      if (d < bestD || (d === bestD && row.preferred)) { bestD = d; best = k; }
    });
    return Number(best);
  }

  /** GM program -> SNES id; pass game 93 or 94. */
  function instrumentForProgram(map, set, program, game) {
    return game === 94 ? instrumentForProgram94(map, set, program) : instrumentForProgram93(map, set, program);
  }

  /** NHLPA '93: GM drum note -> { inst, key }. */
  function drumFor93(map, set, note) {
    var d = map.drums && map.drums[set] && map.drums[set][String(note)];
    return d || null;
  }

  /** NHL '94: GM drum note -> sound entry id. */
  function drumFor94(map, set, note) {
    var m = map.drums && map.drums[set];
    if (!m) return null;
    var v = m[String(note)];
    return v == null ? null : v;
  }

  function drumFor(map, set, note, game) {
    return game === 94 ? drumFor94(map, set, note) : drumFor93(map, set, note);
  }

  /** @returns {string[]} problems */
  function validate(map, opts) {
    var o = opts || {};
    var problems = [];
    var bad = function (msg) { problems.push(msg); };
    if (!map || typeof map !== 'object') return ['file is not an object'];
    if (!map.sets || typeof map.sets !== 'object') bad('sets missing');
    Object.keys(map.sets || {}).forEach(function (set) {
      var rows = map.sets[set];
      Object.keys(rows).forEach(function (id) {
        var r = rows[id];
        var where = set + ' ' + id;
        if ((r.program != null) === (r.drum != null)) bad(where + ': row must be program or drum');
        if (r.program != null && (!Number.isInteger(r.program) || r.program < 0 || r.program > 127)) bad(where + ': program out of range');
        if (r.drum != null && (!Number.isInteger(r.drum) || r.drum < DRUM_FIRST || r.drum > DRUM_LAST)) bad(where + ': drum out of range');
        if (typeof r.why !== 'string' || !r.why.trim()) bad(where + ': why missing');
        if (o.requireMeasured && !/Measured:/.test(r.why)) bad(where + ': why should cite measurements');
        if (r.confidence && ['high', 'medium', 'low'].indexOf(r.confidence) < 0) bad(where + ': confidence');
      });
    });
    return problems;
  }

  return {
    DRUM_FIRST: DRUM_FIRST,
    DRUM_LAST: DRUM_LAST,
    familyKey93: familyKey93,
    entry: entry,
    toGmTarget: toGmTarget,
    describeEntry: describeEntry,
    idsForProgram: idsForProgram,
    instrumentForProgram: instrumentForProgram,
    instrumentForProgram93: instrumentForProgram93,
    instrumentForProgram94: instrumentForProgram94,
    drumFor: drumFor,
    drumFor93: drumFor93,
    drumFor94: drumFor94,
    validate: validate,
    programName: G.programName,
    drumName: G.drumName
  };
});
