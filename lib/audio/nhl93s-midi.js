/**
 * NHLPA Hockey '93 (SNES) songs <-> Standard MIDI files, and the song byte format the SPC700 program plays.
 *
 *   toSmf(data, gmMap, cue, { native })        -> Uint8Array: a song as a MIDI file
 *   fromSmf(smfBytes, data, gmMap, { set, tempo, loop }) -> { bytes, block, base, model, report }
 *   buildSong(model, base)                     -> Uint8Array in the program's song format, to load at `base`
 *   modelOfTimeline(timeline)                  -> the model buildSong takes, from NhlNhl93sSoundData.timeline
 *   saveBlock(result)                          -> Uint8Array: two upload blocks (the song, and the cue 7 pointer to it)
 *
 * Song format (docs/NHL93S-SOUND.md): an order list [set pointer][$00FF, order list address = loop forever | $0000 = end],
 * a set = 8 channel pointers (0 = unused), and per channel a byte stream: duration (< $80) with an optional quantize/velocity byte
 * 0qqqvvvv, notes $80-$C7 (MIDI = byte - $80 + 12), $C8 tie, $C9 rest, commands $E0-$FA with their parameters, $00 at the end.
 * A note sounds from its start until its duration or quantize fraction ends it, but never past 2 ticks before its
 * duration is over (the sequencer keys off early), and ties carry it on. The writer uses the longest quantize ($FF) and sets
 * the duration to the sounding length + 2, which is what makes a MIDI note length come back exactly.
 *
 * Time: one sequencer tick is 256 / (500 * tempo byte) seconds. MIDI export uses 48 ticks per quarter note and the tempo that
 * makes MIDI time equal game time, so a song's own tick is a MIDI tick.
 *
 * Two MIDI flavours: GM (notes, programs and drums from data/audio/nhl93s-gm-map.json) for other programs, and native
 * (every other command rides in a marker "n93:<hex>"), which reads back to a song that sounds the same: the same notes
 * start and end on the same ticks, with the same instruments, volumes and pans, and the same commands.
 *
 * Import puts the song at sound RAM $8000 (boot samples) or $E500 (in-game samples), aims song cue 7 at it, and the player
 * runs it like any other song. The free RAM there ends at $F700, where the program's (disabled) echo buffer starts.
 */
(function (root, factory) {
  var api = factory(root.Nhl92Smf, root.NhlNhl93sSoundData);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlNhl93sMidi = api;
})(typeof self !== 'undefined' ? self : this, function (Smf, SoundData) {
  'use strict';
  if (typeof require === 'function' && typeof module === 'object') {
    Smf = Smf || require('./smf');
    SoundData = SoundData || require('./nhl93s-sound-data');
  }

  var PPQ = 48;
  var BASE = { boot: 0x8000, game: 0xe500 };
  var LIMIT = 0xf700;
  var CUE = 7; // the unused song cue a custom song takes over
  var CMD = SoundData.CMD;
  var VEL = SoundData.VELOCITY_TABLE;
  var DEFAULT_TEMPO = 60;
  var DEFAULT_PAN = 0x7f; // the retail value in every song
  var DEFAULT_VOLUME = 0xff; // the MIDI velocity carries the loudness (the export folds the song's volume into it)
  var DEFAULT_MASTER = 0xb4;
  var QUANT_MAX = 7; // 0xFF

  var hex = function (arr) { return arr.map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); };
  var bpmOfTempo = function (T) { return (T || 30) * 500 / 256 * 60 / PPQ; };
  var secondsPerTick = function (T) { return 256 / (500 * T); };

  // ---- the song format ----

  /**
   * model = { set, loop, tempo?, channels: [ { events: [ {tick, type:'command', code, params} | {tick, type:'note', key, length, velocity} ] } x 8 ], end? }
   * key = note index 0-71 (MIDI - 12) after the song's transposes; velocity = 0-15 (index into the velocity table).
   * Returns { bytes, base, size, channels } where bytes load at `base`.
   */
  function encodeChannel(events, end) {
    return serialize(tokenizeChannel(events, end)).concat([0]);
  }

  /**
   * A channel as tokens, each one a whole record that does not depend on the bytes before it:
   * { k:'c', b } a command, { k:'r', d } a rest, { k:'n', d, qv, b } a note, { k:'t', d } a tie, { k:'call', addr, count } a pattern call.
   */
  function tokenizeChannel(events, end) {
    var tokens = [];
    var t = 0;
    var q = events.map(function (e, i) { return { e: e, i: i }; })
      .sort(function (a, b) { return a.e.tick - b.e.tick || (a.e.type === 'command' ? 0 : 1) - (b.e.type === 'command' ? 0 : 1) || a.i - b.i; })
      .map(function (x) { return x.e; });
    // a duration is one byte, 1-127: longer spans become equal pieces
    var chunks = function (D) {
      var n = Math.ceil(D / 127);
      var base = Math.floor(D / n);
      var extra = D - base * n;
      var out = [];
      for (var i = 0; i < n; i++) out.push(base + (i < extra ? 1 : 0));
      return out;
    };
    var rest = function (D) {
      chunks(D).forEach(function (c) { tokens.push({ k: 'r', d: c }); });
      t += D;
    };
    var pushCmd = function (cm) {
      tokens.push({ k: 'c', b: [cm.code].concat(cm.params.map(function (p) { return p & 0xff; })) });
    };
    var i = 0;
    while (i < q.length) {
      var ev = q[i];
      if (ev.tick > t) rest(ev.tick - t);
      if (ev.type === 'command') { pushCmd(ev); i += 1; continue; }
      var next = null;
      for (var k = i + 1; k < q.length; k++) if (q[k].type === 'note') { next = q[k]; break; }
      var span = Math.max(1, (next ? next.tick : end) - ev.tick);
      var L = Math.max(1, ev.length);
      var D;
      if (span >= 3) { L = Math.min(L, span - 2); D = L + 2; } else { L = 1; D = span; }
      var noteEnd = ev.tick + D;
      var qv = (QUANT_MAX << 4) | (ev.velocity & 15);
      var code = 0x80 + ev.key;
      // commands inside the note, before its key-off, cut it into pieces joined by ties; those in the 2-tick tail wait for its end
      var splitters = [];
      var delayed = [];
      var j = i + 1;
      while (j < q.length && q[j].type === 'command' && q[j].tick < noteEnd) {
        if (q[j].tick <= ev.tick + L) splitters.push(q[j]);
        else delayed.push({ tick: noteEnd, type: 'command', code: q[j].code, params: q[j].params });
        j += 1;
      }
      var at = ev.tick;
      var first = true;
      var piece = function (len) {
        chunks(len).forEach(function (c) {
          if (first) { tokens.push({ k: 'n', d: c, qv: qv, b: code }); first = false; } else tokens.push({ k: 't', d: c });
        });
      };
      splitters.forEach(function (cm) {
        if (cm.tick > at) { piece(cm.tick - at); at = cm.tick; }
        pushCmd(cm);
      });
      piece(noteEnd - at);
      t = noteEnd;
      q.splice.apply(q, [i + 1, j - (i + 1)].concat(delayed));
      i += 1;
    }
    if (end > t) rest(end - t);
    return tokens;
  }

  /** Tokens to bytes. A duration byte (and the quantize / velocity byte after it) is written only when it changes; a pattern call forgets both. */
  function serialize(tokens) {
    var bytes = [];
    var curDur = -1;
    var curQV = -1;
    tokens.forEach(function (tk) {
      if (tk.k === 'c') { tk.b.forEach(function (b) { bytes.push(b); }); return; }
      if (tk.k === 'call') { bytes.push(CMD.CALL, tk.addr & 0xff, tk.addr >> 8, tk.count); curDur = -1; curQV = -1; return; }
      var qv = tk.k === 'n' ? tk.qv : null;
      if (tk.d !== curDur || (qv != null && qv !== curQV)) {
        bytes.push(tk.d);
        curDur = tk.d;
        if (qv != null && qv !== curQV) { bytes.push(qv); curQV = qv; }
      }
      bytes.push(tk.k === 'n' ? tk.b : tk.k === 't' ? 0xc8 : 0xc9);
    });
    return bytes;
  }

  var tokenBytes = function (tk) { return tk.k === 'c' ? tk.b.length : tk.k === 'call' ? 4 : tk.k === 'n' ? 3 : 2; };
  var tokenKey = function (tk) { return tk.k === 'c' ? 'c' + tk.b.join(',') : tk.k === 'n' ? 'n' + tk.d + ',' + tk.qv + ',' + tk.b : tk.k + tk.d; };

  /**
   * Shrink channels with the sequencer's pattern call ($EF addr16 count): repeated runs of records become one pattern
   * (ended by a 0 byte, at the end of the song data) that the channels call. Patterns hold no calls (the program keeps one
   * return address), consecutive calls of one pattern become one call with a count. Stops as soon as `fits(size)` says yes.
   * Returns { channels: token lists, patterns: token lists } with pattern addresses left to buildSong.
   */
  function compress(channels, fits) {
    var chans = channels.map(function (c) { return c ? c.slice() : null; });
    var patterns = [];
    var sizeOf = function () {
      var n = 0;
      chans.forEach(function (c) { if (c) n += serialize(c).length + 1; });
      patterns.forEach(function (p) { n += serialize(p).length + 1; });
      return n;
    };
    var guard = 0;
    while (!fits(sizeOf()) && guard++ < 400) {
      var best = null;
      for (var L = 48; L >= 2; L--) {
        var seen = {};
        chans.forEach(function (c, ci) {
          if (!c) return;
          for (var i = 0; i + L <= c.length; i++) {
            var bytes = 0;
            var keys = [];
            var ok = true;
            for (var j = 0; j < L; j++) { if (c[i + j].k === 'call') { ok = false; break; } keys.push(tokenKey(c[i + j])); bytes += tokenBytes(c[i + j]); }
            if (!ok) continue;
            var key = keys.join('|');
            var e = seen[key] = seen[key] || { bytes: bytes, at: [] };
            e.at.push([ci, i]);
          }
        });
        Object.keys(seen).forEach(function (key) {
          var e = seen[key];
          if (e.at.length < 2) return;
          // non-overlapping occurrences, per channel left to right
          var taken = [];
          var lastEnd = {};
          e.at.forEach(function (a) {
            if (lastEnd[a[0]] == null || a[1] >= lastEnd[a[0]]) { taken.push(a); lastEnd[a[0]] = a[1] + L; }
          });
          if (taken.length < 2) return;
          var gain = taken.length * e.bytes - (taken.length * 4 + e.bytes + 1);
          if (gain > 0 && (!best || gain > best.gain)) best = { gain: gain, L: L, at: taken };
        });
        if (best && L < 40 && best.gain > 3 * L) break;
      }
      if (!best) break;
      var first = best.at[0];
      var body = chans[first[0]].slice(first[1], first[1] + best.L);
      var id = patterns.length;
      patterns.push(body);
      var byChan = {};
      best.at.forEach(function (a) { (byChan[a[0]] = byChan[a[0]] || []).push(a[1]); });
      Object.keys(byChan).forEach(function (ci) {
        var starts = byChan[ci].sort(function (x, y) { return y - x; });
        starts.forEach(function (st) { chans[ci].splice(st, best.L, { k: 'call', pattern: id, count: 1 }); });
        // adjacent calls of one pattern share a call with a count
        var out = [];
        chans[ci].forEach(function (tk) {
          var prev = out[out.length - 1];
          if (tk.k === 'call' && prev && prev.k === 'call' && prev.pattern === tk.pattern && prev.count < 255) prev.count += tk.count;
          else out.push(tk.k === 'call' ? { k: 'call', pattern: tk.pattern, count: tk.count } : tk);
        });
        chans[ci] = out;
      });
    }
    return { channels: chans, patterns: patterns };
  }

  function buildSong(model, base, opts) {
    opts = opts || {};
    base = base == null ? BASE[model.set || 'boot'] : base;
    var end = model.end;
    if (end == null) {
      end = 1;
      model.channels.forEach(function (ch) {
        ch.events.forEach(function (e) { end = Math.max(end, e.tick + (e.type === 'note' ? Math.max(1, e.length) + 2 : 0)); });
      });
    }
    var orderLen = 6;
    var tokens = model.channels.map(function (ch) { return ch && ch.events && ch.events.length ? tokenizeChannel(ch.events, end) : null; });
    var patterns = [];
    var flatSize = orderLen + 16;
    tokens.forEach(function (tk) { if (tk) flatSize += serialize(tk).length + 1; });
    var packed = null;
    if (opts.capacity != null && flatSize > opts.capacity) {
      packed = compress(tokens, function (size) { return orderLen + 16 + size <= opts.capacity; });
      tokens = packed.channels;
      patterns = packed.patterns;
    }
    // layout: channel streams, then the patterns they call
    var at = base + orderLen + 16;
    var ptrs = tokens.map(function (tk) { var p = 0; if (tk) { p = at; at += serialize(tk).length + 1; } return p; });
    var patternAt = patterns.map(function (pt) { var p = at; at += serialize(pt).length + 1; return p; });
    tokens.forEach(function (tk) { if (tk) tk.forEach(function (x) { if (x.k === 'call') x.addr = patternAt[x.pattern]; }); });
    var streams = tokens.map(function (tk) { return tk ? serialize(tk).concat([0]) : null; });
    patterns.forEach(function (pt) { streams.push(serialize(pt).concat([0])); });
    var out = [];
    var w = function (v) { out.push(v & 0xff, (v >> 8) & 0xff); };
    w(base + orderLen); // order list: the set ...
    if (model.loop) { w(0x00ff); w(base); } else { w(0); }
    while (out.length < orderLen) out.push(0);
    ptrs.forEach(w);
    streams.forEach(function (s) { if (s) s.forEach(function (b) { out.push(b); }); });
    return { bytes: new Uint8Array(out), base: base, size: out.length, end: end, streams: streams, flatSize: flatSize, patterns: patterns.length };
  }

  /** The upload blocks that carry a built song into sound RAM: the song, then the pointer cue 7 reads. */
  function saveBlock(built) {
    var le = function (v) { return [v & 0xff, (v >> 8) & 0xff]; };
    var out = [].concat(le(built.bytes.length), le(built.base), Array.from(built.bytes), le(2), le(0x0e91 + 2 * CUE), le(built.base));
    return new Uint8Array(out);
  }

  // ---- reading a retail song into the model ----

  function modelOfTimeline(tl, set) {
    var chs = [];
    for (var c = 0; c < 8; c++) chs.push({ events: [], inst: 0 });
    tl.events.forEach(function (e) {
      var ch = chs[e.ch];
      if (e.type === 'command') {
        if (e.code === CMD.CALL) return;
        ch.events.push({ tick: e.tick, type: 'command', code: e.code, params: e.params.slice() });
      } else if (e.type === 'note' || e.type === 'percussion') {
        if (e.instrument !== ch.inst) {
          if (e.type === 'percussion' || true) {
            // an instrument set by a percussion note rather than $E0: say so
            var has = ch.events.some(function (x) { return x.tick === e.tick && x.type === 'command' && x.code === CMD.INSTRUMENT; });
            if (!has && e.type === 'percussion') ch.events.push({ tick: e.tick, type: 'command', code: CMD.INSTRUMENT, params: [e.instrument] });
          }
        }
        ch.inst = e.instrument;
        ch.events.push({ tick: e.tick, type: 'note', key: e.key, length: Math.max(1, e.length), velocity: VEL.indexOf(velOf(e)) });
      }
    });
    return { set: set, loop: tl.looped || tl.loopTick != null, channels: chs.map(function (c) { return { events: c.events }; }), end: tl.ticks };
  }
  function velOf(e) { return e.velocity; }

  // ---- export ----

  var SnesMap = typeof require === 'function' ? require('./snes-gm-map') : null;
  function entryOf(gmMap, set, inst) { return SnesMap ? SnesMap.entry(gmMap, set, inst) : ((gmMap.sets[set] || {})[String(inst)] || null); }

  function toSmf(data, gmMap, cue, opts) {
    opts = opts || {};
    var info = data.cueList.filter(function (c) { return c.cue === cue; })[0];
    var set = info.set;
    var tl = data.timeline(cue, { loops: 0 });
    var native = !!opts.native;
    var tempos = tl.tempoTrack.length ? tl.tempoTrack.map(function (x) { return { tick: x.tick, bpm: bpmOfTempo(x.tempo) }; }) : [{ tick: 0, bpm: bpmOfTempo(30) }];
    if (tempos[0].tick > 0) tempos.unshift({ tick: 0, bpm: tempos[0].bpm });
    var tracks = [];
    var drums = { name: 'drums', ch: 9, notes: [] };
    var globalMarkers = [];
    if (native) {
      globalMarkers.push({ tick: 0, text: 'n93:cue ' + cue });
      globalMarkers.push({ tick: 0, text: 'n93:set ' + set });
      globalMarkers.push({ tick: 0, text: 'n93:end ' + tl.ticks });
      if (tl.looped || tl.loopTick != null) globalMarkers.push({ tick: 0, text: 'n93:loop' });
    } else if (tl.looped || tl.loopTick != null) {
      globalMarkers.push({ tick: tl.loopTick || 0, text: 'loop start' });
      globalMarkers.push({ tick: tl.ticks, text: 'loop end' });
    }
    var midiChannels = [0, 1, 2, 3, 4, 5, 6, 7];
    var model = native ? modelOfTimeline(tl, set) : null;
    for (var c = 0; c < 8; c++) {
      var tr = { name: 'channel ' + c, ch: midiChannels[c], notes: [], markers: native ? [{ tick: 0, text: 'n93:track ' + c }] : [] };
      var any = false;
      if (native) {
        model.channels[c].events.forEach(function (e) {
          if (e.type === 'command') tr.markers.push({ tick: e.tick, text: 'n93:' + hex([e.code].concat(e.params)) });
        });
      }
      tl.events.forEach(function (e) {
        if (e.ch !== c || (e.type !== 'note' && e.type !== 'percussion')) return;
        any = true;
        var entry = entryOf(gmMap, set, e.instrument);
        var level = e.velocity / 252 * Math.min(255, e.volume) / 255;
        var note = { tick: e.tick, dur: Math.max(1, e.length), vel: Math.max(1, Math.min(127, Math.round(127 * level))) };
        if (native) {
          note.pitch = Math.max(0, Math.min(127, e.midi));
          note.vel = Math.max(1, e.velocity >> 1);
          tr.notes.push(note);
        } else if (entry && entry.drum != null) {
          note.pitch = entry.drum;
          drums.notes.push(note);
        } else {
          note.pitch = Math.max(0, Math.min(127, e.midi));
          note.program = entry && entry.program != null ? entry.program : 0;
          tr.notes.push(note);
        }
      });
      if (any || tr.markers.length > 1 || native) tracks.push(tr);
    }
    if (!native && drums.notes.length) tracks.push(drums);
    return Smf.write({ ppq: PPQ, tempos: tempos, name: info.name, markers: globalMarkers, tracks: tracks });
  }

  // ---- import ----

  function makeClock(parsed) {
    var tempos = parsed.tempos.slice().sort(function (a, b) { return a.tick - b.tick; });
    if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, bpm: 120 });
    var segs = [];
    var sec = 0;
    tempos.forEach(function (t, i) {
      segs.push({ tick: t.tick, sec: sec, spt: 60 / (t.bpm * parsed.ppq) });
      var next = tempos[i + 1];
      if (next) sec += (next.tick - t.tick) * (60 / (t.bpm * parsed.ppq));
    });
    return function (tick) {
      var s = segs[0];
      for (var i = 0; i < segs.length; i++) if (segs[i].tick <= tick) s = segs[i];
      return s.sec + (tick - s.tick) * s.spt;
    };
  }

  var nearestVelocity = function (v127) {
    var want = v127 * 2;
    var best = 0;
    for (var i = 1; i < 16; i++) if (Math.abs(VEL[i] - want) < Math.abs(VEL[best] - want)) best = i;
    return best;
  };

  function instrumentForProgram(gmMap, set, program) {
    return SnesMap.instrumentForProgram93(gmMap, set, program);
  }
  function drumFor(gmMap, set, note) {
    return SnesMap.drumFor93(gmMap, set, note);
  }

  function fromSmf(bytes, data, gmMap, opts) {
    opts = opts || {};
    var parsed = Smf.parse(bytes);
    var report = { warnings: parsed.warnings.slice(), tracks: 0, notes: 0, dropped: 0, maxVoices: 0, native: false, set: null, instruments: {}, folded: 0, stolen: 0 };
    var marks = parsed.markers.filter(function (m) { return /^n93:/.test(m.text); });
    var model = marks.length ? modelFromNative(parsed, marks, report) : modelFromGm(parsed, gmMap, opts, report);
    var built = buildSong(model, BASE[model.set], { capacity: LIMIT - BASE[model.set] });
    report.set = model.set;
    if (built.patterns) report.compressed = { patterns: built.patterns, from: built.flatSize, to: built.size };
    report.size = built.size;
    report.capacity = LIMIT - built.base;
    report.ticks = built.end;
    var T = tempoOf(model);
    report.seconds = T ? built.end * secondsPerTick(T) : 0;
    if (built.size > report.capacity) {
      report.warnings.push('the song needs ' + built.size + ' bytes and the free sound RAM at $' + built.base.toString(16).toUpperCase() + ' holds ' + report.capacity + ': it cannot be loaded');
      report.tooBig = true;
    }
    report.tracks = model.channels.filter(function (c) { return c.events.length; }).length;
    return { bytes: built.bytes, block: saveBlock(built), base: built.base, model: model, report: report, built: built };
  }

  function tempoOf(model) {
    var T = 0;
    model.channels.forEach(function (c) { c.events.forEach(function (e) { if (e.type === 'command' && e.code === CMD.TEMPO && !T) T = e.params[0]; }); });
    return T;
  }

  function modelFromNative(parsed, marks, report) {
    report.native = true;
    var scale = PPQ / parsed.ppq;
    var tk = function (t) { return Math.round(t * scale); };
    var setMark = marks.filter(function (m) { return /^n93:set /.test(m.text); })[0];
    var endMark = marks.filter(function (m) { return /^n93:end /.test(m.text); })[0];
    var model = { set: setMark ? setMark.text.slice(8) : 'boot', loop: marks.some(function (m) { return m.text === 'n93:loop'; }), channels: [], end: endMark ? Number(endMark.text.slice(8)) : null };
    for (var c = 0; c < 8; c++) model.channels.push({ events: [] });
    var chOf = {};
    marks.forEach(function (m) { var t = /^n93:track (\d)$/.exec(m.text); if (t) chOf[m.track] = Number(t[1]); });
    // replay the commands in time order to know the transposes in force at each note
    var items = [];
    marks.forEach(function (m) {
      var h = /^n93:([0-9a-f]+)$/.exec(m.text);
      if (!h || chOf[m.track] == null) return;
      var b = (h[1].match(/../g) || []).map(function (x) { return parseInt(x, 16); });
      items.push({ tick: tk(m.tick), ch: chOf[m.track], order: 0, cmd: { type: 'command', code: b[0], params: b.slice(1) } });
    });
    parsed.notes.forEach(function (n) {
      if (chOf[n.track] == null) { report.dropped += 1; return; }
      items.push({ tick: tk(n.tick), ch: chOf[n.track], order: 1, note: n });
    });
    items.sort(function (a, b) { return a.tick - b.tick || a.order - b.order; });
    var st = [];
    for (var i = 0; i < 8; i++) st.push({ tr: 0 });
    var global = 0;
    items.forEach(function (it) {
      var ch = model.channels[it.ch];
      if (it.cmd) {
        if (it.cmd.code === CMD.TRANSPOSE) global = (it.cmd.params[0] << 24) >> 24;
        if (it.cmd.code === CMD.CH_TRANSPOSE) st[it.ch].tr = (it.cmd.params[0] << 24) >> 24;
        ch.events.push({ tick: it.tick, type: 'command', code: it.cmd.code, params: it.cmd.params });
      } else {
        var n = it.note;
        var key = (n.pitch - 12 - global - st[it.ch].tr) & 0xff;
        if (key > 0x47) { report.folded += 1; key = ((key % 12) + 12 * Math.min(5, Math.max(0, Math.floor(key / 12) % 6))) & 0x7f; if (key > 0x47) key = 0x47; }
        var end = tk(n.tick + n.dur);
        ch.events.push({ tick: it.tick, type: 'note', key: key, length: Math.max(1, end - it.tick), velocity: nearestVelocity(n.vel) });
        report.notes += 1;
      }
    });
    if (model.end == null) { model.end = null; }
    return model;
  }

  function modelFromGm(parsed, gmMap, opts, report) {
    var set = opts.set || 'boot';
    var T = opts.tempo || DEFAULT_TEMPO;
    var spt = secondsPerTick(T);
    var clock = makeClock(parsed);
    var toTick = function (t) { return Math.round(clock(t) / spt); };
    // program in force per channel
    var progs = {};
    // A track that picked one of the game's own instruments (the song editor) carries "n93i:<channel>:<instrument hex>".
    var fixed = {};
    parsed.markers.forEach(function (m) { var x = /^n93i:(\d+):([0-9a-f]+)$/i.exec(m.text); if (x) fixed[Number(x[1])] = parseInt(x[2], 16); });
    parsed.programs.forEach(function (p) { (progs[p.ch] = progs[p.ch] || []).push(p); });
    Object.keys(progs).forEach(function (k) { progs[k].sort(function (a, b) { return a.tick - b.tick; }); });
    var programAt = function (ch, tick) {
      var list = progs[ch] || [];
      var cur = 0;
      for (var i = 0; i < list.length && list[i].tick <= tick; i++) cur = list[i].program;
      return cur;
    };
    var list = [];
    parsed.notes.forEach(function (n) {
      var start = toTick(n.tick);
      var len = Math.max(1, toTick(n.tick + n.dur) - start);
      if (n.ch === 9) {
        var d = drumFor(gmMap, set, n.pitch);
        if (!d) { report.dropped += 1; report.warnings.push('drum note ' + n.pitch + ' has no sound in the ' + set + ' set (dropped)'); return; }
        list.push({ start: start, len: len, vel: n.vel, inst: d.inst, key: d.key, drum: true });
      } else {
        var program = programAt(n.ch, n.tick);
        var inst = fixed[n.ch] != null ? fixed[n.ch] : instrumentForProgram(gmMap, set, program);
        var key = n.pitch - 12;
        while (key < 0) { key += 12; report.folded += 1; }
        while (key > 0x47) { key -= 12; report.folded += 1; }
        list.push({ start: start, len: len, vel: n.vel, inst: inst, key: key, program: program });
      }
    });
    list.sort(function (a, b) { return a.start - b.start || a.key - b.key; });
    var chans = [];
    for (var v = 0; v < 8; v++) chans.push({ events: [], free: 0, inst: -1, last: null });
    var maxLive = 0;
    list.forEach(function (n) {
      // a voice that is free, preferring one already on this instrument
      var pick = -1;
      for (var i = 0; i < 8; i++) {
        if (chans[i].free <= n.start) {
          if (pick < 0 || (chans[i].inst === n.inst && chans[pick].inst !== n.inst) || (chans[i].inst === chans[pick].inst && chans[i].free > chans[pick].free && chans[i].inst === n.inst)) pick = i;
        }
      }
      if (pick < 0) {
        // all eight sounding: the one that ends first is cut
        pick = 0;
        for (var j = 1; j < 8; j++) if (chans[j].free < chans[pick].free) pick = j;
        var prev = chans[pick].last;
        if (prev) prev.length = Math.max(1, n.start - prev.tick - 2);
        report.stolen += 1;
      }
      var ch = chans[pick];
      if (ch.inst !== n.inst) {
        ch.events.push({ tick: n.start, type: 'command', code: CMD.INSTRUMENT, params: [n.inst] });
        ch.inst = n.inst;
        var names = report.instruments[pick] = report.instruments[pick] || [];
        if (names.indexOf(n.inst) < 0) names.push(n.inst);
      }
      var ev = { tick: n.start, type: 'note', key: n.key, length: n.len, velocity: nearestVelocity(n.vel) };
      ch.events.push(ev);
      ch.last = ev;
      ch.free = n.start + n.len + 2;
      report.notes += 1;
    });
    var live = 0;
    var edges = [];
    list.forEach(function (n) { edges.push([n.start, 1], [n.start + n.len, -1]); });
    edges.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    edges.forEach(function (e) { live += e[1]; maxLive = Math.max(maxLive, live); });
    report.maxVoices = maxLive;
    if (maxLive > 8) report.warnings.push('up to ' + maxLive + ' notes sound at once; the sound unit has 8 voices, so the earliest are cut (' + report.stolen + ' cut)');
    if (report.folded) report.warnings.push(report.folded + ' notes were moved by octaves into the 6-octave range the sequencer has (C0-B5)');
    // set-up: tempo on voice 0, master volume, then per used voice volume and pan
    var used = [];
    chans.forEach(function (c, i) { if (c.events.length) used.push(i); });
    var first = used.length ? used[0] : 0;
    chans.forEach(function (c, i) {
      if (!c.events.length) return;
      var setup = [];
      if (i === first) {
        setup.push({ tick: 0, type: 'command', code: CMD.TEMPO, params: [T] });
        setup.push({ tick: 0, type: 'command', code: CMD.MASTER_VOLUME, params: [DEFAULT_MASTER] });
      }
      setup.push({ tick: 0, type: 'command', code: CMD.VOLUME, params: [DEFAULT_VOLUME] });
      setup.push({ tick: 0, type: 'command', code: CMD.PAN, params: [DEFAULT_PAN] });
      c.events = setup.concat(c.events);
    });
    var endTick = 1;
    list.forEach(function (n) { endTick = Math.max(endTick, n.start + n.len + 2); });
    return { set: set, loop: !!opts.loop, channels: chans.map(function (c) { return { events: c.events }; }), end: endTick };
  }

  return {
    PPQ: PPQ, BASE: BASE, LIMIT: LIMIT, CUE: CUE, buildSong: buildSong, saveBlock: saveBlock, modelOfTimeline: modelOfTimeline, toSmf: toSmf, fromSmf: fromSmf,
    bpmOfTempo: bpmOfTempo, secondsPerTick: secondsPerTick, nearestVelocity: nearestVelocity
  };
});
