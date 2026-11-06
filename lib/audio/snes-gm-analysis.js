/**
 * Measurements behind the SNES instrument <-> General MIDI maps (data/audio/nhl93s-gm-map.json, nhl94s-gm-map.json).
 *
 * For every instrument (NHLPA '93) or sound entry (NHL '94) of each sample set this plays one probe note through the
 * game's own SPC700 program, held 656 ms and released, at the median pitch the songs use it at (C4 if no song does),
 * and measures the render with the same measurements the Genesis maps use (lib/audio/nhl92-gm-analysis.js measureNote):
 * envelope shape, attack, levels, release, brightness, noisiness, periodicity. It also counts how the retail songs use
 * each one: notes, pitch range, which songs, whether it sits on the drum track at one fixed key.
 *
 * These are signal measurements, not listening.
 *
 *   analyse93(data) / analyse94(data)  ->  { sets: { <set>: { <id>: { usage, probe, measure } } } }
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlSnesGmAnalysis = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var Analysis, P93, M93, P94, M94, Cmd93;
  if (typeof require === 'function' && typeof module === 'object') {
    Analysis = require('./nhl92-gm-analysis');
    P93 = require('./nhl93s-player');
    M93 = require('./nhl93s-midi');
    Cmd93 = require('./nhl93s-sound-data').CMD;
    P94 = require('./nhl94s-player');
    M94 = require('./nhl94s-midi');
  }

  var RATE = 32000;
  var HOLD_MS = 656;
  var hz = function (midi) { return 440 * Math.pow(2, (midi - 69) / 12); };
  var median = function (list) {
    var s = list.slice().sort(function (a, b) { return a - b; });
    return s.length ? s[s.length >> 1] : null;
  };
  var uniq = function (list) { return list.filter(function (v, i) { return list.indexOf(v) === i; }); };

  function summarise(keys) {
    if (!keys.length) return null;
    var count = {};
    keys.forEach(function (k) { count[k] = (count[k] || 0) + 1; });
    var top = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; })[0];
    return { notes: keys.length, min: Math.min.apply(null, keys), max: Math.max.apply(null, keys), median: median(keys), distinctKeys: Object.keys(count).length, topKey: Number(top), topShare: Math.round(count[top] / keys.length * 100) / 100 };
  }

  // --- NHLPA '93 ---------------------------------------------------------------------------------------------

  function usage93(data) {
    var use = { boot: {}, game: {} };
    data.cueList.forEach(function (c) {
      var tl = data.timeline(c.cue, { loops: 0 });
      tl.events.forEach(function (e) {
        if (e.type !== 'note' && e.type !== 'percussion') return;
        var u = use[c.set][e.instrument] = use[c.set][e.instrument] || { keys: [], drumKeys: [], songs: [] };
        (e.type === 'percussion' ? u.drumKeys : u.keys).push(e.midi);
        if (u.songs.indexOf(c.cue) < 0) u.songs.push(c.cue);
      });
    });
    return use;
  }

  function render93(data, set, inst, midi, drum) {
    var key = midi - 12;
    var length = Math.round(HOLD_MS / 1000 * 500 * 60 / 256); // tempo byte 60: 117 ticks a second
    var ch = [
      { tick: 0, type: 'command', code: Cmd93.TEMPO, params: [60] },
      { tick: 0, type: 'command', code: Cmd93.MASTER_VOLUME, params: [0xb4] },
      { tick: 0, type: 'command', code: Cmd93.VOLUME, params: [0xff] },
      { tick: 0, type: 'command', code: Cmd93.PAN, params: [0x7f] },
      { tick: 0, type: 'command', code: Cmd93.INSTRUMENT, params: [inst] },
      { tick: 0, type: 'note', key: Math.max(0, Math.min(0x47, key)), length: length, velocity: 15 }
    ];
    var built = M93.buildSong({ set: set, loop: false, channels: [{ events: ch }, {}, {}, {}, {}, {}, {}, {}], end: length + 2 + 60 }, M93.BASE[set]);
    var p = P93.create({ data: data });
    p.playCustom(set, built.bytes, built.base);
    p.record();
    p.runFrames(150);
    return p.stopRecording();
  }

  function analyse93(data) {
    var use = usage93(data);
    var out = { sets: { boot: {}, game: {} } };
    var ids = { boot: [], game: [] };
    for (var i = 0; i < data.instruments.length; i++) ids[i <= 9 ? 'boot' : 'game'].push(i);
    ['boot', 'game'].forEach(function (set) {
      ids[set].forEach(function (inst) {
        var u = use[set][inst];
        var melodic = u ? summarise(u.keys) : null;
        var drums = u ? summarise(u.drumKeys) : null;
        var midi = melodic ? melodic.median : drums ? drums.topKey : 60;
        var pcm = render93(data, set, inst, midi);
        var m = Analysis.measureNote(pcm, RATE, hz(midi), HOLD_MS);
        out.sets[set][inst] = { usage: u ? { songs: u.songs.slice().sort(function (a, b) { return a - b; }), melodic: melodic, drum: drums } : null, probeMidi: midi, measure: m };
      });
    });
    return out;
  }

  // --- NHL '94 -----------------------------------------------------------------------------------------------

  function usage94(data) {
    var use = { menu: {}, game: {} };
    data.songNames.forEach(function (name) {
      var set = data.songSet(name) === 'game' ? 'game' : 'menu';
      var song = data.song(name);
      song.tracks.forEach(function (t) {
        var cur = null;
        t.events.forEach(function (e) {
          if (e.type === 'instrument') cur = e.value;
          else if (e.type === 'note') {
            var drumTrack = t.index === 9;
            var id = drumTrack ? e.code - 0x2f : cur;
            if (id == null) return;
            var u = use[set][id] = use[set][id] || { keys: [], drumHits: 0, songs: [] };
            if (drumTrack) u.drumHits += 1;
            else u.keys.push((e.code + (data.sound(set, id) ? data.sound(set, id).noteOffset : 0)) & 0x7f);
            if (u.songs.indexOf(name) < 0) u.songs.push(name);
          }
        });
      });
    });
    return use;
  }

  function render94(data, set, n, key, drum) {
    var p = P94.create({ data: data });
    p.boot();
    p.loadSet(set);
    p.record();
    if (drum) {
      p.playSound(n);
      p.runFrames(150);
    } else {
      var snd = data.sound(set, n);
      var code = (key - snd.noteOffset) & 0x7f;
      var ticks = 42;
      var bytes = M94.buildSong({ tempo: 168, tracks: [{ events: [
        { delay: 0, type: 'instrument', value: n },
        { delay: 0, type: 'controller', controller: 7, value: 127 },
        { delay: 0, type: 'note', code: code, velocity: 127, duration: ticks },
        { delay: ticks + 2, type: 'stop', code: 0xd9 }
      ] }] });
      p.startSongBytes(bytes);
      p.runFrames(150);
    }
    return p.stopRecording();
  }

  function analyse94(data) {
    var use = usage94(data);
    var out = { sets: { menu: {}, game: {} } };
    ['menu', 'game'].forEach(function (set) {
      var count = data.sounds(set).length;
      for (var n = 0; n < count; n++) {
        var u = use[set][n];
        var melodic = u ? summarise(u.keys) : null;
        var drumOnly = !!(u && u.drumHits && !u.keys.length);
        var key = melodic ? melodic.median : 60;
        var m;
        try {
          m = Analysis.measureNote(render94(data, set, n, key, drumOnly), RATE, hz(key), drumOnly ? 100 : HOLD_MS);
        } catch (err) {
          m = { error: String(err && err.message || err) };
        }
        out.sets[set][n] = { sample: data.soundSample(set, n) || null, usage: u ? { songs: u.songs, melodic: melodic, drumHits: u.drumHits } : null, probeKey: key, probe: drumOnly ? 'drum entry as the game plays it' : 'melodic note', measure: m };
      }
    });
    return out;
  }

  return { analyse93: analyse93, analyse94: analyse94, HOLD_MS: HOLD_MS, uniq: uniq };
});
