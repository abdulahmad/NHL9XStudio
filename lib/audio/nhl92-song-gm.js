/**
 * NHL '92 songs <-> General MIDI, using data/audio/nhl92-gm-map.json.
 *
 *   normalizeGm(parsedSmf)       a parsed MIDI file as a clean General MIDI song + a report of what changed
 *   toSmfSong(gm)                a GM song as lib/audio/smf.js write() input
 *   nhlToGm(nhlSong, map)        a retail-style song through the NHL 92 -> GM table (patches -> programs / drum notes)
 *   gmToNhl(gm, map, opts)       a GM song through the GM -> NHL 92 table, cut down to six one-note-at-a-time
 *                                FM channels on a 16th-note grid
 *   nhlToSmfSong(nhlSong)        the song's own notes and patches as MIDI (programs by the mapping not applied:
 *                                one track per FM channel, the patch number in the track name)
 *
 * A GM song is { ppq, tempos:[{tick,bpm}], name, notes:[{tick, dur, ch, pitch, vel, program}] } where
 * ch 9 (MIDI channel 10) is the drum kit, notes 35-81. Everything is deterministic.
 * The mapping is a mapping layer: it never touches drivers, patches or sound data.
 *
 * UMD: Node and the browser.
 */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var api = factory(isNode ? require('./nhl92-song') : root.Nhl92Song, isNode ? require('./nhl92-gm-map') : root.Nhl92GmMap);
  if (isNode) module.exports = api;
  else root.Nhl92SongGm = api;
})(typeof self !== 'undefined' ? self : this, function (Song, G) {
  var GM_PPQ = 480;
  var NHL_PPQ = 96; // 24 ticks per duration unit, 4 units per quarter note
  var DRUM_CH = 9;
  var NOTE_LO = 9; // lowest / highest note index the retail songs use (docs/NHL92-SOUND-DATA.md)
  var NOTE_HI = 90;
  var HIT_TICKS = 12; // length of a drum hit written to MIDI, in NHL_PPQ ticks (half a unit)

  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : many); };
  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };

  // --- A parsed MIDI file -> a General MIDI song -------------------------------------------

  /**
   * @param {object} parsed lib/audio/smf.js parse() result
   * @returns {{song: object, report: string[], stats: object}}
   */
  function normalizeGm(parsed) {
    var report = [];
    var stats = { notes: 0, dropped: 0, drumRemapped: 0, shortened: 0, channels: 0, programs: 0 };
    var changes = {};
    parsed.programs.forEach(function (p) { (changes[p.ch] = changes[p.ch] || []).push(p); });
    Object.keys(changes).forEach(function (k) { changes[k].sort(function (a, b) { return a.tick - b.tick; }); });
    var programAt = function (ch, tick) {
      var list = changes[ch];
      var program = 0;
      if (!list) return program;
      for (var i = 0; i < list.length && list[i].tick <= tick; i++) program = list[i].program;
      return program;
    };
    var seen = {};
    var notes = [];
    parsed.notes.forEach(function (n) {
      var key = n.ch + ':' + n.pitch + ':' + n.tick;
      if (seen[key]) { stats.dropped += 1; return; }
      seen[key] = true;
      var pitch = clamp(n.pitch, 0, 127);
      if (n.ch === DRUM_CH) {
        var drum = clamp(pitch, G.DRUM_FIRST, G.DRUM_LAST);
        if (drum !== pitch) stats.drumRemapped += 1;
        pitch = drum;
      }
      var dur = n.dur;
      if (!(dur >= 1)) { dur = 1; stats.shortened += 1; }
      notes.push({ tick: n.tick, dur: dur, ch: n.ch, pitch: pitch, vel: clamp(n.vel, 1, 127), program: n.ch === DRUM_CH ? null : programAt(n.ch, n.tick) });
    });
    stats.notes = notes.length;
    var chans = {};
    var programs = {};
    notes.forEach(function (n) {
      chans[n.ch] = true;
      if (n.program != null) programs[n.program] = (programs[n.program] || 0) + 1;
    });
    stats.channels = Object.keys(chans).length;
    stats.programs = Object.keys(programs).length;
    var tempos = parsed.tempos.length ? parsed.tempos.slice() : [{ tick: 0, bpm: 120 }];
    if (tempos[0].tick > 0) tempos.unshift({ tick: 0, bpm: tempos[0].bpm });
    report.push(plural(notes.length, 'note', 'notes') + ' on ' + plural(stats.channels, 'channel', 'channels') + ', ' + plural(stats.programs, 'program', 'programs') + (parsed.format === 0 ? ', format 0 file split by channel' : '') + '.');
    if (stats.dropped) report.push(plural(stats.dropped, 'duplicate note was', 'duplicate notes were') + ' removed.');
    if (stats.drumRemapped) report.push(plural(stats.drumRemapped, 'drum note', 'drum notes') + ' outside the GM kit (35-81) moved to the nearest drum.');
    if (stats.shortened) report.push(plural(stats.shortened, 'zero-length note', 'zero-length notes') + ' given one tick.');
    if (tempos.length > 1) report.push(tempos.length + ' tempo changes kept.');
    parsed.warnings.forEach(function (w) { report.push(w.charAt(0).toUpperCase() + w.slice(1) + '.'); });
    var names = Object.keys(programs).map(Number).sort(function (a, b) { return programs[b] - programs[a]; }).slice(0, 6).map(function (p) { return p + ' ' + G.programName(p); });
    if (names.length) report.push('Programs: ' + names.join(', ') + '.');
    return { song: { ppq: parsed.ppq, tempos: tempos, name: '', notes: notes }, report: report, stats: stats };
  }

  /** A GM song as smf.js write() input: one track per MIDI channel, programs written where they change. */
  function toSmfSong(gm) {
    var byCh = {};
    gm.notes.forEach(function (n) { (byCh[n.ch] = byCh[n.ch] || []).push(n); });
    var tracks = Object.keys(byCh).map(Number).sort(function (a, b) { return a - b; }).map(function (ch) {
      var list = byCh[ch];
      var first = list.find(function (n) { return n.program != null; });
      return {
        name: ch === DRUM_CH ? 'Drums' : first ? G.programName(first.program) : 'Channel ' + (ch + 1),
        ch: ch,
        notes: list
      };
    });
    return { ppq: gm.ppq, tempos: gm.tempos, name: gm.name || undefined, tracks: tracks };
  }

  // --- NHL 92 -> GM ------------------------------------------------------------------------------

  /**
   * Every FM channel becomes a MIDI channel (0-5); notes of patches that the table sends to a
   * drum become channel-10 hits at that GM drum note.
   */
  function nhlToGm(nhl, map) {
    var report = [];
    var byPatch = {};
    map.nhl92ToGm.patches.forEach(function (e) { byPatch[e.patch] = e; });
    var notes = [];
    var drumNotes = 0;
    var used = {};
    nhl.channels.forEach(function (list, ch) {
      list.forEach(function (n) {
        var t = byPatch[n.patch].target;
        var tick = n.unit * (NHL_PPQ / 4);
        if (t.kind === 'drum') {
          drumNotes += 1;
          used['drum ' + t.note] = true;
          notes.push({ tick: tick, dur: HIT_TICKS, ch: DRUM_CH, pitch: t.note, vel: n.patch >= 19 ? 70 : 110, program: null });
        } else {
          used[t.program] = true;
          notes.push({ tick: tick, dur: n.len * (NHL_PPQ / 4), ch: ch, pitch: clamp(n.index + 12, 0, 127), vel: 100, program: t.program });
        }
      });
    });
    notes.sort(function (a, b) { return a.tick - b.tick || a.ch - b.ch || a.pitch - b.pitch; });
    report.push(plural(notes.length, 'note', 'notes') + ', ' + plural(drumNotes, 'of them a drum hit', 'of them drum hits') + ', tempo ' + Song.bpmOfTempo(nhl.tempo).toFixed(0) + ' BPM (' + nhl.tempo + ' frames per unit).');
    return { song: { ppq: NHL_PPQ, tempos: [{ tick: 0, bpm: Song.bpmOfTempo(nhl.tempo) }], name: '', notes: notes }, report: report };
  }

  /** The song's own notes as MIDI: one track per FM channel, nothing mapped. */
  function nhlToSmfSong(nhl, name) {
    var tracks = nhl.channels.map(function (list, ch) {
      var patches = {};
      list.forEach(function (n) { patches[n.patch] = true; });
      return {
        name: 'FM' + (ch + 1) + ' (patch ' + Object.keys(patches).join(', ') + ')',
        ch: ch,
        notes: list.map(function (n) { return { tick: n.unit * (NHL_PPQ / 4), dur: n.len * (NHL_PPQ / 4), pitch: clamp(n.index + 12, 0, 127), vel: 100 }; })
      };
    }).filter(function (t) { return t.notes.length; });
    return { ppq: NHL_PPQ, tempos: [{ tick: 0, bpm: Song.bpmOfTempo(nhl.tempo) }], name: name || undefined, tracks: tracks };
  }

  // --- GM -> NHL 92 ------------------------------------------------------------------------------

  var isBassProgram = function (p) { return p >= 32 && p <= 39; };

  /** One-note-at-a-time line from notes that may overlap: per onset keep the highest (lowest for bass), cut at the next onset. */
  function monophonic(notes, lowest) {
    var byUnit = new Map();
    notes.forEach(function (n) {
      var cur = byUnit.get(n.unit);
      if (!cur || (lowest ? n.index < cur.index : n.index > cur.index) || (n.index === cur.index && n.len > cur.len)) byUnit.set(n.unit, n);
    });
    var units = Array.from(byUnit.keys()).sort(function (a, b) { return a - b; });
    var out = [];
    units.forEach(function (u, i) {
      var n = byUnit.get(u);
      var next = i + 1 < units.length ? units[i + 1] : Infinity;
      out.push({ unit: n.unit, len: Math.max(1, Math.min(n.len, next - n.unit)), index: n.index, patch: n.patch });
    });
    return { line: out, cut: notes.length - out.length };
  }

  /** How many onsets sit within 15% of a unit of the grid when `upq` units make a quarter note. */
  function gridFit(gm, upq) {
    var unit = gm.ppq / upq;
    var good = 0;
    gm.notes.forEach(function (n) { if (Math.abs(n.tick / unit - Math.round(n.tick / unit)) <= 0.15) good += 1; });
    return gm.notes.length ? good / gm.notes.length : 1;
  }

  /**
   * @param {object} gm a GM song (normalizeGm().song)
   * @param {object} map nhl92-gm-map.json
   * @param {{maxUnits?:number, unitsPerQuarter?:number}} [opts]
   * @returns {{song: object, report: string[], stats: object}}
   */
  function gmToNhl(gm, map, opts) {
    var o = opts || {};
    var report = [];
    var stats = { notes: 0, kept: 0, dropped: 0, polyphonyCut: 0, folded: 0, dac: 0, offGrid: 0, lines: 0, linesDropped: 0, truncated: 0 };
    var firstBpm = gm.tempos.length ? gm.tempos[0].bpm : 120;
    var upq = o.unitsPerQuarter;
    if (!upq) {
      upq = 4;
      if (gridFit(gm, 4) < 0.8 && Song.tempoOfBpm(firstBpm * 2) >= 2 && gridFit(gm, 8) > gridFit(gm, 4) + 0.1) upq = 8;
    }
    var tempo = clamp(Math.round((60 * Song.FRAME_HZ) / (upq * firstBpm)), 1, 32);
    var unitTicks = gm.ppq / upq;
    var actualBpm = (60 * Song.FRAME_HZ) / (upq * tempo);
    if (gm.tempos.length > 1) report.push('The file has ' + gm.tempos.length + ' tempos; a song has one tempo, so the first (' + firstBpm.toFixed(0) + ' BPM) is used.');
    if (Math.abs(actualBpm - firstBpm) > 1) report.push('Tempo ' + firstBpm.toFixed(1) + ' BPM becomes ' + tempo + ' frames per ' + (upq === 4 ? '16th' : '32nd') + ' note = ' + actualBpm.toFixed(1) + ' BPM (the driver counts whole frames).');
    if (upq === 8) report.push('Most onsets are off the 16th-note grid, so the song uses a 32nd-note grid.');

    // Notes -> mapped lines. A line is a group of notes that will share an FM channel.
    var groups = new Map();
    var resolveCache = {};
    var drumCache = {};
    var maxUnits = o.maxUnits || 2000;
    gm.notes.forEach(function (n) {
      stats.notes += 1;
      var unit = Math.round(n.tick / unitTicks);
      var len = Math.max(1, Math.round(n.dur / unitTicks));
      if (unit >= maxUnits) { stats.truncated += 1; return; }
      if (Math.abs(n.tick / unitTicks - unit) > 0.15) stats.offGrid += 1;
      var key;
      var role;
      var patch;
      var index;
      var name;
      if (n.ch === DRUM_CH) {
        var d = drumCache[n.pitch] || (drumCache[n.pitch] = G.resolveDrum(map, n.pitch));
        var t = d.target;
        if (t.kind !== 'patch') { stats.dac += 1; return; }
        patch = t.patch;
        index = (t.midi != null ? t.midi : 60) - 12;
        key = 'drum:' + (patch === 3 ? 'kick' : patch === 4 ? 'snare' : 'perc');
        role = patch === 3 ? 'kick' : patch === 4 ? 'snare' : 'perc';
        name = role === 'kick' ? 'Kick' : role === 'snare' ? 'Snare' : 'Percussion';
        len = 1;
      } else {
        var r = resolveCache[n.program] || (resolveCache[n.program] = G.resolveProgram(map, n.program));
        if (r.target.kind !== 'patch') { stats.dac += 1; return; }
        patch = r.target.patch;
        index = n.pitch - 12;
        role = isBassProgram(n.program) ? 'bass' : 'melody';
        key = 'ch' + n.ch + ':p' + n.program;
        name = (n.ch + 1) + ' ' + G.programName(n.program);
        if (r.target.midi != null) index = r.target.midi - 12;
      }
      var g = groups.get(key);
      if (!g) { g = { key: key, role: role, name: name, notes: [] }; groups.set(key, g); }
      if (role !== 'kick' && role !== 'snare' && role !== 'perc') {
        var folded = index;
        while (folded < NOTE_LO) folded += 12;
        while (folded > NOTE_HI) folded -= 12;
        if (folded !== index) stats.folded += 1;
        index = folded;
      }
      g.notes.push({ unit: unit, len: len, index: index, patch: patch });
    });

    // One note at a time per line; a line is worth keeping in proportion to what it carries.
    var lines = [];
    groups.forEach(function (g) {
      var m = monophonic(g.notes, g.role === 'bass');
      stats.polyphonyCut += m.cut;
      var rank = { kick: 5000, snare: 4000, bass: 3000, melody: 2000, perc: 1000 }[g.role];
      lines.push({ role: g.role, name: g.name, line: m.line, score: rank + m.line.length });
    });
    lines.sort(function (a, b) { return b.score - a.score; });
    var chosen = lines.slice(0, 6);
    lines.slice(6).forEach(function (l) {
      stats.linesDropped += 1;
      report.push('Dropped "' + l.name + '" (' + plural(l.line.length, 'note', 'notes') + '): a song has six FM channels.');
    });
    stats.lines = chosen.length;
    // Melodies first, then bass, then drums, so the drums end up on the last channels.
    var order = { melody: 0, bass: 1, perc: 2, snare: 3, kick: 4 };
    chosen.sort(function (a, b) { return order[a.role] - order[b.role] || b.line.length - a.line.length; });
    var song = Song.emptySong(tempo);
    chosen.forEach(function (l, i) {
      song.channels[i] = l.line;
      stats.kept += l.line.length;
    });
    var units = 0;
    song.channels.forEach(function (ch) { ch.forEach(function (n) { units = Math.max(units, n.unit + n.len); }); });
    song.units = units;
    stats.dropped = stats.notes - stats.kept - stats.dac - stats.truncated;
    report.push('Channels: ' + chosen.map(function (l, i) { return 'FM' + (i + 1) + ' ' + l.name + ' (' + l.line.length + ')'; }).join(', ') + '.');
    if (stats.polyphonyCut) report.push(plural(stats.polyphonyCut, 'note', 'notes') + ' dropped from chords and overlaps (each channel plays one note at a time).');
    if (stats.folded) report.push(plural(stats.folded, 'note', 'notes') + ' moved by whole octaves into the driver\'s range (note indexes 9-90).');
    if (stats.dac) report.push(plural(stats.dac, 'note', 'notes') + ' skipped: the table sends them to a DAC sample, which songs here cannot play.');
    if (stats.truncated) report.push(plural(stats.truncated, 'note', 'notes') + ' after unit ' + maxUnits + ' skipped.');
    if (stats.offGrid) report.push(plural(stats.offGrid, 'note', 'notes') + ' snapped to the ' + (upq === 4 ? '16th' : '32nd') + '-note grid.');
    return { song: song, report: report, stats: stats };
  }

  /** The playable events of a GM song in seconds, for the reference synth: [{time, dur, program|drum, midi, vel}]. */
  function gmEvents(gm) {
    var tempos = gm.tempos.slice().sort(function (a, b) { return a.tick - b.tick; });
    // Piecewise-constant tempo: seconds at the start of each segment.
    var segs = [];
    var secs = 0;
    for (var i = 0; i < tempos.length; i++) {
      segs.push({ tick: tempos[i].tick, secs: secs, bpm: tempos[i].bpm });
      if (i + 1 < tempos.length) secs += ((tempos[i + 1].tick - tempos[i].tick) / gm.ppq) * (60 / tempos[i].bpm);
    }
    var toSecs = function (tick) {
      var s = segs[0];
      for (var k = 0; k < segs.length && segs[k].tick <= tick; k++) s = segs[k];
      return s.secs + ((tick - s.tick) / gm.ppq) * (60 / s.bpm);
    };
    return gm.notes.map(function (n) {
      var t0 = toSecs(n.tick);
      var ev = { time: t0, dur: Math.max(0.03, toSecs(n.tick + n.dur) - t0), vel: n.vel / 127 };
      if (n.ch === DRUM_CH) ev.drum = n.pitch;
      else { ev.program = n.program == null ? 0 : n.program; ev.midi = n.pitch; }
      return ev;
    }).sort(function (a, b) { return a.time - b.time; });
  }

  return {
    GM_PPQ: GM_PPQ,
    NHL_PPQ: NHL_PPQ,
    DRUM_CH: DRUM_CH,
    normalizeGm: normalizeGm,
    toSmfSong: toSmfSong,
    nhlToGm: nhlToGm,
    nhlToSmfSong: nhlToSmfSong,
    gmToNhl: gmToNhl,
    gmEvents: gmEvents
  };
});
