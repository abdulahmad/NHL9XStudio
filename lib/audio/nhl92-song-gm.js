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
    var bends = (parsed.bends || []).filter(function (b) { return b.ch !== DRUM_CH; }).map(function (b) { return { tick: b.tick, ch: b.ch, semis: b.semis }; });
    stats.bends = bends.length;
    if (bends.length) report.push(plural(bends.length, 'pitch-bend move', 'pitch-bend moves') + ' kept (NHL 93 / 94 use them; NHL 92 has no pitch bend).');
    return { song: { ppq: parsed.ppq, tempos: tempos, name: '', notes: notes, bends: bends }, report: report, stats: stats };
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
        notes: list,
        bends: (gm.bends || []).filter(function (b) { return b.ch === ch; })
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

  // --- Native MIDI: the song's own notes, instruments and effects in marker events -------------------
  //
  // General MIDI cannot say "FM patch 17" or "modulation 12 frames, +4". The native export writes the notes as an
  // ordinary MIDI file (a player hears the pitches and lengths) and carries the rest in MIDI marker events (FF 06) at
  // the note's tick, so reading the file back restores the song exactly. Marker text is `NHL c=<channel> key=value ...`.

  /** Marker text for `fields` ({key: value|true}) of channel `ch`. */
  function markerText(ch, fields) {
    var out = ['NHL', 'c=' + ch];
    Object.keys(fields).forEach(function (k) { out.push(fields[k] === true ? k : k + '=' + fields[k]); });
    return out.join(' ');
  }
  /** Inverse of markerText: { ch, fields } or null if the marker is not ours. */
  function parseMarker(text) {
    var parts = String(text).trim().split(/\s+/);
    if (parts[0] !== 'NHL') return null;
    var fields = {};
    var ch = 0;
    parts.slice(1).forEach(function (t) {
      var i = t.indexOf('=');
      var k = i < 0 ? t : t.slice(0, i);
      var v = i < 0 ? true : t.slice(i + 1);
      if (k === 'c') ch = Number(v); else fields[k] = v;
    });
    return { ch: ch, fields: fields };
  }

  /** The song's own notes as MIDI: one track per FM channel, nothing mapped; instruments and effects ride in markers. */
  function nhlToSmfSong(nhl, name) {
    var unit = NHL_PPQ / 4;
    var tracks = nhl.channels.map(function (list, ch) {
      var patches = {};
      list.forEach(function (n) { patches[n.patch] = true; });
      var markers = [];
      var patch = null;
      var env;
      list.slice().sort(function (a, b) { return a.unit - b.unit; }).forEach(function (n) {
        var f = {};
        if (n.patch !== patch) { f.p = n.patch; patch = n.patch; }
        var e = n.env ? n.env.id + ',' + n.env.speed : '-';
        if (e !== env) { f.e = e; env = e; }
        if (n.mod) f.m = n.mod.delay + ',' + n.mod.delta;
        if (n.legato) f.l = true;
        if (n.noKeyOff) f.k = true;
        if (Object.keys(f).length) markers.push({ tick: n.unit * unit, text: markerText(ch, f) });
      });
      return {
        name: 'FM' + (ch + 1) + ' (patch ' + Object.keys(patches).join(', ') + ')',
        ch: ch,
        markers: markers,
        notes: list.map(function (n) { return { tick: n.unit * unit, dur: n.len * unit, pitch: clamp(n.index + 12, 0, 127), vel: 100 }; })
      };
    }).filter(function (t) { return t.notes.length; });
    return {
      ppq: NHL_PPQ, tempos: [{ tick: 0, bpm: Song.bpmOfTempo(nhl.tempo) }], name: name || undefined, tracks: tracks,
      markers: [{ tick: 0, text: 'NHL92 v1 tempo=' + nhl.tempo + ' units=' + (nhl.units || 0) }]
    };
  }

  /**
   * Read a file written by nhlToSmfSong back into an NhlSong. Returns { song, report } or null when the file has no
   * NHL92 header marker (an ordinary MIDI file: use normalizeGm + gmToNhl).
   * @param {object} parsed Smf.parse() result
   */
  function nhlFromNativeSmf(parsed) {
    var head = (parsed.markers || []).filter(function (m) { return /^NHL92 v1\b/.test(m.text); })[0];
    if (!head) return null;
    var tempo = Number((/tempo=(\d+)/.exec(head.text) || [])[1]) || 6;
    var units = Number((/units=(\d+)/.exec(head.text) || [])[1]) || 0;
    var u = parsed.ppq / 4;
    var song = Song.emptySong(tempo);
    song.units = units;
    var report = [];
    var marks = {};
    (parsed.markers || []).forEach(function (m) {
      var k = parseMarker(m.text);
      if (k) (marks[k.ch] = marks[k.ch] || []).push({ tick: m.tick, fields: k.fields });
    });
    var dropped = 0;
    for (var ch = 0; ch < Song.CHANNELS; ch++) {
      var notes = parsed.notes.filter(function (n) { return n.ch === ch; }).sort(function (a, b) { return a.tick - b.tick; });
      var ms = (marks[ch] || []).sort(function (a, b) { return a.tick - b.tick; });
      var patch = 0;
      var env = null;
      var mi = 0;
      notes.forEach(function (n) {
        var one = {};
        while (mi < ms.length && ms[mi].tick <= n.tick) {
          var f = ms[mi].fields;
          if (f.p != null) patch = clamp(Number(f.p), 0, Song.PATCH_COUNT - 1);
          if (f.e != null) { var q = String(f.e).split(','); env = f.e === '-' || q.length < 2 ? null : { id: Number(q[0]), speed: Number(q[1]) }; }
          if (ms[mi].tick === n.tick) one = f;
          mi++;
        }
        var note = { unit: Math.round(n.tick / u), len: Math.max(1, Math.round(n.dur / u)), index: n.pitch - 12, patch: patch };
        if (note.index < 0 || note.index > Song.MAX_INDEX) { dropped++; return; }
        if (env) note.env = { id: env.id, speed: env.speed };
        if (one.m) { var mm = String(one.m).split(','); note.mod = { delay: Number(mm[0]), delta: Number(mm[1]) }; }
        if (one.l) note.legato = true;
        if (one.k) note.noKeyOff = true;
        song.channels[ch].push(note);
      });
    }
    if (dropped) report.push(plural(dropped, 'note', 'notes') + ' outside the driver\'s note range were dropped.');
    var count = song.channels.reduce(function (t, c) { return t + c.length; }, 0);
    report.unshift('Native NHL \'92 file: ' + plural(count, 'note', 'notes') + ', tempo ' + tempo + ' (' + Song.bpmOfTempo(tempo).toFixed(0) + ' BPM), instruments and effects restored from the file\'s markers.');
    return { song: song, report: report };
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

  /**
   * The FM notes a tracker saw (an SFX run, say) as a GM song, through the NHL 92 -> GM table. A pitch
   * sweep shows up as a run of segments; each becomes its own short note, so a sweep plays as a glide in
   * steps. DAC samples are not notes and are left out.
   * @param {object} tracker lib/audio/ym-note-tracker.js create() after the run
   * @param {{patches:Array, map:object, sampleAt:function, rate:number, endT:number}} o parser patches,
   *   the mapping, chain.sampleAt, the sample rate and the T-state the run ended at
   * @returns {{song: object, notes: number}} GM song (480 PPQ, 120 BPM: 960 ticks a second)
   */
  function gmFromTracker(tracker, o) {
    var byPatch = {};
    o.map.nhl92ToGm.patches.forEach(function (e) { byPatch[e.patch] = e; });
    var bursts = tracker.patches.filter(function (p) { return p.kind === 'patch'; });
    var TICKS = 960;
    var notes = [];
    var secs = function (t) { return o.sampleAt(t) / o.rate; };
    tracker.notes.forEach(function (n) {
      var burst = null;
      bursts.forEach(function (p) { if (p.ch === n.ch && p.t0 <= n.t0) burst = p; });
      var id = burst ? Song.identifyPatch(o.patches, burst.regs, n.ch) : -1;
      var target = id >= 0 ? byPatch[id].target : null;
      var end = n.t1 == null ? o.endT : n.t1;
      if (target && target.kind === 'drum') {
        notes.push({ tick: Math.round(secs(n.t0) * TICKS), dur: 60, ch: DRUM_CH, pitch: target.note, vel: 110, program: null });
        return;
      }
      n.segs.forEach(function (seg) {
        if (seg.midi == null) return;
        var s0 = secs(seg.t0);
        var s1 = secs(seg.t1 == null ? end : Math.min(seg.t1, end));
        if (!(s1 > s0)) return;
        notes.push({ tick: Math.round(s0 * TICKS), dur: Math.max(1, Math.round((s1 - s0) * TICKS)), ch: Math.min(n.ch, 8), pitch: clamp(seg.midi, 0, 127), vel: 100, program: target ? target.program : 0 });
      });
    });
    notes.sort(function (a, b) { return a.tick - b.tick || a.ch - b.ch; });
    return { song: { ppq: 480, tempos: [{ tick: 0, bpm: 120 }], name: '', notes: notes }, notes: notes.length };
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
    var bendsOf = {};
    (gm.bends || []).forEach(function (b) { (bendsOf[b.ch] = bendsOf[b.ch] || []).push(b); });
    Object.keys(bendsOf).forEach(function (c) { bendsOf[c].sort(function (a, b) { return a.tick - b.tick; }); });
    return gm.notes.map(function (n) {
      var t0 = toSecs(n.tick);
      var ev = { time: t0, dur: Math.max(0.03, toSecs(n.tick + n.dur) - t0), vel: n.vel / 127 };
      if (n.ch === DRUM_CH) ev.drum = n.pitch;
      else {
        ev.program = n.program == null ? 0 : n.program;
        ev.midi = n.pitch;
        var list = bendsOf[n.ch];
        if (list) {
          // The channel's pitch wheel over the note: the value in force at its start, then each move during it.
          var cur = 0;
          var curve = [];
          for (var i = 0; i < list.length && list[i].tick <= n.tick; i++) cur = list[i].semis;
          if (cur) curve.push({ time: 0, semis: cur });
          for (; i < list.length && list[i].tick < n.tick + n.dur; i++) curve.push({ time: toSecs(list[i].tick) - t0, semis: list[i].semis });
          if (curve.length) ev.bend = curve;
        }
      }
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
    nhlFromNativeSmf: nhlFromNativeSmf,
    markerText: markerText,
    parseMarker: parseMarker,
    gmFromTracker: gmFromTracker,
    gmToNhl: gmToNhl,
    gmEvents: gmEvents
  };
});
