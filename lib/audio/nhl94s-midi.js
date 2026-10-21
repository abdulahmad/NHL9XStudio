/**
 * NHL '94 (SNES) songs <-> Standard MIDI files, and the song byte format itself.
 *
 *   buildSong(model)                 -> Uint8Array in the game's song format (header, track offsets, TRAK chunks)
 *   modelOf(parsedSong)              -> the model buildSong takes (from NhlNhl94sSoundData.parseSong)
 *   toSmf(data, gmMap, name, { native })  -> Uint8Array: a song as a MIDI file
 *   fromSmf(smfBytes, data, gmMap, { set, tempo, loop })  -> { bytes, model, report }
 *
 * Song format (what MusicStart / ReadTrackEvent read): 8 header bytes (bytes 0 and 2 = 1, byte 1 = tempo, byte 6 = track count),
 * word offsets of the tracks up to a zero word (room for 16 tracks, so the first chunk is at 42 + 6), then per track
 * a chunk [length, big endian][TRAK][records]; the length is the distance to the next track's first record. A record is [delay, variable length][event]; the first record's delay is
 * not waited. Events: a note is [code < $D9][velocity][duration, variable length]; $D9/$DA stop the song, $DB jumps back
 * to the last mark ($E2 n), $DC n picks sound entry n, $DD n sets the tick length, $DE n the track volume, $DF c v a
 * controller, $E5 lo hi a pitch bend (the MIDI wheel's two bytes), $E7 n text a name, $E3 and $EA n do nothing.
 *
 * Pitch: a note sounds at MIDI key (code + the sound entry's note offset) & $7F (the offsets are what put each sample
 * in tune), and the sound entry of the track's current $DC picks the instrument. Track 9 is the drum track: its notes are
 * sound entries ($2F + n), played at a fixed pitch.
 *
 * Time: one sequencer tick is  floor(10080 / tempo byte) / 64  video frames (NTSC). MIDI export uses 24 ticks per quarter
 * note, and the tempo that makes MIDI time equal game time. Import converts MIDI time to ticks with that tick length.
 *
 * Two MIDI flavours: GM (notes, programs from data/audio/nhl94s-gm-map.json, bends in semitones) for other programs, and
 * native (every non-note event rides in a marker "n94:<hex>"), which reads back to the same song.
 */
(function (root, factory) {
  var api = factory(root.Nhl92Smf, root.NhlNhl94sSoundData);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlNhl94sMidi = api;
})(typeof self !== 'undefined' ? self : this, function (Smf, SoundData) {
  'use strict';
  if (typeof require === 'function' && typeof module === 'object') {
    Smf = Smf || require('./smf');
    SoundData = SoundData || require('./nhl94s-sound-data');
  }

  var PPQ = 24;
  var HEADER_BYTES = 42; // 8 + room for 16 track offsets and the zero word
  var s8 = function (v) { return (v << 24) >> 24; };

  function varLen(n) {
    var out = [n & 0x7f];
    n = Math.floor(n / 128);
    while (n > 0) { out.unshift((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
    return out;
  }

  // ---- the song format ----

  function eventBytes(ev) {
    switch (ev.type) {
      case 'note': return [ev.code, ev.velocity].concat(varLen(ev.duration));
      case 'stop': return [ev.code];
      case 'loop': return [0xdb];
      case 'e3': return [0xe3];
      case 'instrument': return [0xdc, ev.value];
      case 'tempo': return [0xdd, ev.value];
      case 'volume': return [0xde, ev.value];
      case 'controller': return [0xdf, ev.controller, ev.value];
      case 'mark': return [0xe2, ev.value];
      case 'ea': return [0xea, ev.value];
      case 'bend': return [0xe5, ev.value, ev.extra];
      case 'name': {
        var chars = Array.from(ev.text).map(function (c) { return c.charCodeAt(0) & 0x7f; }).concat([0]);
        return [0xe7, chars.length].concat(chars);
      }
      default: throw new Error('cannot write event ' + ev.type);
    }
  }

  /** model: { tempo, tracks: [{ events: [{ delay, type, ... }] }] } (the shape of NhlNhl94sSoundData.parseSong). */
  function buildSong(model) {
    var tracks = model.tracks;
    if (tracks.length > 16) throw new Error('a song has at most 16 tracks');
    var body = tracks.map(function (t) {
      var out = [];
      t.events.forEach(function (ev) { out = out.concat(varLen(ev.delay || 0), eventBytes(ev)); });
      return out.concat(t.tail || []);
    });
    var out = new Array(HEADER_BYTES).fill(0);
    out[0] = 1; out[1] = model.tempo & 0xff; out[2] = 1; out[6] = tracks.length;
    var at = HEADER_BYTES + 6;
    var chunks = [];
    body.forEach(function (b, i) {
      out[8 + 2 * i] = at & 0xff; out[9 + 2 * i] = at >> 8;
      // the length field counts up to the next track's first record (the 6-byte chunk header in between); the last track's is 8 over
      var len = b.length + (i + 1 < body.length ? 6 : 8);
      chunks.push([(len >> 8) & 0xff, len & 0xff, 0x54, 0x52, 0x41, 0x4b].concat(b));
      at += b.length + 6;
    });
    // each chunk's header sits in front of its offset
    var bytes = out.slice(0, HEADER_BYTES);
    chunks.forEach(function (c) { bytes = bytes.concat(c); });
    return Uint8Array.from(bytes);
  }

  /**
   * The model of a parsed song. With the song's bytes, each track also keeps the bytes after its last event (the retail
   * songs end a track with padding the player never reads), so buildSong gives the same bytes back.
   */
  function modelOf(song, bytes) {
    return {
      tempo: song.tempo,
      tracks: song.tracks.map(function (t, i) {
        var m = { index: t.index, name: t.name, events: t.events.map(function (e) { return Object.assign({}, e); }) };
        if (bytes) {
          var end = i + 1 < song.tracks.length ? song.tracks[i + 1].offset - 6 : bytes.length;
          var body = [];
          m.events.forEach(function (ev) { body = body.concat(varLen(ev.delay || 0), eventBytes(ev)); });
          m.tail = Array.from(bytes.subarray(t.offset + body.length, end));
        }
        return m;
      })
    };
  }

  // ---- timing ----
  var tickLength = function (T) { return (T / 64) / SoundData.FRAME_RATE.ntsc; }; // seconds
  var tickOfTempoByte = function (tempoByte) { return Math.floor(SoundData.TEMPO_NUMERATOR.ntsc / tempoByte) & 0xff; };
  var bpmOf = function (T) { return 60 / (PPQ * tickLength(T)); };

  // ---- sound entry <-> GM ----
  function entryOf(gmMap, set, n) { return (gmMap.sets[set] || {})[String(n)] || null; }

  function nearestCurveIndex(curve, wanted) { // the velocity byte whose curve value*2 is closest to a MIDI velocity
    var best = 0;
    var bestD = 1e9;
    for (var i = 0; i < curve.length; i++) {
      var d = Math.abs(Math.min(127, curve[i] * 2) - wanted);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** The sound entry MIDI import uses for a GM program in a set: the preferred entry of the program's family. */
  function soundForProgram(gmMap, set, program) {
    var fam = (gmMap.families[set] || []).find(function (f) { return program >= f[0] && program <= f[1]; });
    var want = fam ? fam[2] : program;
    var entries = gmMap.sets[set] || {};
    var keys = Object.keys(entries);
    var exact = keys.filter(function (k) { return entries[k].program === want; });
    var pick = exact.find(function (k) { return entries[k].preferred; }) || exact[0];
    return pick == null ? null : Number(pick);
  }
  function soundForDrum(gmMap, set, note) {
    var m = (gmMap.drums || {})[set] || {};
    return m[String(note)] == null ? null : m[String(note)];
  }

  // ---- export ----

  /** Notes and the other events of every track with absolute ticks, plus what each track's instrument is at each note. */
  function playTrack(data, set, track, repeat) {
    var sounds = data.sounds(set);
    var w = SoundData.walk(track, { repeat: repeat || 1 });
    var inst = null;
    var out = { events: [], endTick: w.endTick };
    w.events.forEach(function (e) {
      var ev = e.event;
      if (ev.type === 'instrument') inst = sounds[ev.sound] ? { n: ev.sound, snd: sounds[ev.sound] } : null;
      out.events.push({ tick: e.tick, ev: ev, inst: inst });
    });
    return out;
  }

  var hex = function (arr) { return arr.map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); };

  /** A song as a MIDI file. native: every track's own events as markers (reads back exactly); otherwise General MIDI. */
  function toSmf(data, gmMap, songName, opts) {
    opts = opts || {};
    var song = data.song(songName);
    var set = data.songSet(songName) === 'game' ? 'game' : 'menu';
    var sounds = data.sounds(set);
    var curve = data.volumeCurve;
    var T = tickOfTempoByte(song.tempo);
    var tempos = [{ tick: 0, bpm: bpmOf(T) }];
    var tracks = [];
    var markers = [];
    var globalMarkers = opts.native ? [{ tick: 0, text: 'n94:tempo ' + song.tempo }] : [];
    song.tracks.forEach(function (tr) {
      var pt = playTrack(data, set, tr, 1);
      var tOut = { name: tr.name || ('track ' + tr.index), ch: tr.index & 15, notes: [], bends: [], markers: opts.native ? [{ tick: 0, text: 'n94:track ' + tr.index }] : [] };
      var drum = tr.index === 9;
      pt.events.forEach(function (x) {
        var ev = x.ev;
        if (ev.type === 'note') {
          var snd = x.inst && x.inst.snd;
          var off = snd ? snd.noteOffset : 0;
          var entry = drum ? entryOf(gmMap, set, ev.code - 0x2f) : (x.inst ? entryOf(gmMap, set, x.inst.n) : null);
          var note = { tick: x.tick, dur: Math.max(1, ev.duration), vel: Math.max(1, Math.min(127, (curve[ev.velocity] || 0) * 2)) };
          if (opts.native) {
            note.pitch = ev.code & 0x7f;
            note.vel = Math.max(1, Math.min(127, ev.velocity));
            if (ev.code < 0x80) tOut.markers.push({ tick: x.tick, text: 'n94:lo ' + note.pitch });
            if (ev.duration === 0) tOut.markers.push({ tick: x.tick, text: 'n94:d0 ' + note.pitch });
          } else if (drum) {
            note.pitch = entry && entry.drum != null ? entry.drum : 38;
          } else {
            note.pitch = (ev.code + off) & 0x7f;
            note.program = entry && entry.program != null ? entry.program : entry && entry.drum != null ? 0 : 0;
          }
          tOut.notes.push(note);
        } else if (opts.native) {
          tOut.markers.push({ tick: x.tick, text: 'n94:' + hex(eventBytes(ev)) });
        } else if (ev.type === 'tempo') {
          tempos.push({ tick: x.tick, bpm: bpmOf(ev.value) });
        } else if (ev.type === 'bend' && !drum && x.inst) {
          var lo = ev.value;
          var hi = ev.extra;
          var bend = s8(((((hi << 8) | ((lo << 1) & 0xff)) - 0x4000) * 2 >> 8) & 0xff);
          var range = x.inst.snd.bendRange || 2;
          tOut.bends.push({ tick: x.tick, semis: (bend / 128) * range });
        } else if (ev.type === 'loop' || ev.type === 'mark') {
          if (!markers.some(function (m) { return m.tick === x.tick && m.text === ev.type; })) markers.push({ tick: x.tick, text: ev.type === 'loop' ? 'loop end' : 'loop start' });
        }
      });
      tracks.push(tOut);
    });
    if (opts.native) globalMarkers.push({ tick: 0, text: 'n94:set ' + set });
    return Smf.write({ ppq: PPQ, tempos: tempos, name: songName, markers: globalMarkers.concat(opts.native ? [] : markers), tracks: tracks });
  }

  // ---- import ----

  /** Convert absolute seconds to ticks with piecewise-constant tempo (microsecond tempos from a parsed file). */
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

  /**
   * A MIDI file as a song. Files written by toSmf(native) come back as they were; any other file goes through the GM map:
   * channel 10 is the drum track (track 9), the other channels fill tracks 0-8 and 10-15 in order.
   * opts: { set: 'menu' | 'game' (default menu), tempo: the song's tempo byte (default 160, about one tick a frame), loop: true }.
   */
  function fromSmf(bytes, data, gmMap, opts) {
    opts = opts || {};
    var parsed = Smf.parse(bytes);
    var report = { warnings: parsed.warnings.slice(), tracks: 0, notes: 0, dropped: 0, maxVoices: 0, native: false, set: null, instruments: {} };
    var nativeMarks = parsed.markers.filter(function (m) { return /^n94:/.test(m.text); });
    if (nativeMarks.length) return fromNative(parsed, nativeMarks, data, report);

    var set = opts.set || 'menu';
    report.set = set;
    var tempoByte = opts.tempo || 160;
    var T = tickOfTempoByte(tempoByte);
    var tl = tickLength(T);
    var clock = makeClock(parsed);
    var toTick = function (t) { return Math.round(clock(t) / tl); };
    var curve = data.volumeCurve;
    var sounds = data.sounds(set);

    var channels = [];
    parsed.notes.forEach(function (n) { if (channels.indexOf(n.ch) < 0) channels.push(n.ch); });
    channels.sort(function (a, b) { return a - b; });
    var slots = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
    var trackOfChannel = {};
    channels.forEach(function (ch) {
      if (ch === 9) { trackOfChannel[ch] = 9; return; }
      var slot = slots.shift();
      if (slot == null) { report.warnings.push('more than 15 melodic channels: channel ' + (ch + 1) + ' dropped'); return; }
      trackOfChannel[ch] = slot;
    });

    var perTrack = {};
    var endTick = 0;
    parsed.notes.forEach(function (n) {
      var ti = trackOfChannel[n.ch];
      if (ti == null) { report.dropped += 1; return; }
      var start = toTick(n.tick);
      var dur = Math.max(1, toTick(n.tick + n.dur) - start);
      var rec = perTrack[ti] || (perTrack[ti] = { notes: [], bends: [], ctrls: [], progs: [], ch: n.ch });
      if (ti === 9) {
        var sound = soundForDrum(gmMap, set, n.pitch);
        if (sound == null) { report.dropped += 1; report.warnings.push('drum note ' + n.pitch + ' has no sound in the ' + set + ' set (dropped)'); return; }
        rec.notes.push({ tick: start, dur: dur, vel: n.vel, drum: sound });
      } else {
        rec.notes.push({ tick: start, dur: dur, vel: n.vel, pitch: n.pitch });
      }
      endTick = Math.max(endTick, start + dur);
    });
    parsed.programs.forEach(function (p) { var ti = trackOfChannel[p.ch]; if (ti != null && ti !== 9 && perTrack[ti]) perTrack[ti].progs.push({ tick: toTick(p.tick), program: p.program }); });
    parsed.bends.forEach(function (b) { var ti = trackOfChannel[b.ch]; if (ti != null && ti !== 9 && perTrack[ti]) perTrack[ti].bends.push({ tick: toTick(b.tick), semis: b.semis }); });
    (parsed.controllers || []).forEach(function (c) {
      var ti = trackOfChannel[c.ch];
      if (ti == null || ti === 9 || !perTrack[ti]) return;
      var tick = toTick(c.tick);
      if (c.controller === 7) perTrack[ti].ctrls.push({ tick: tick, order: 1, ev: { type: 'volume', value: nearestCurveIndex(curve, c.value) } });
      else if (c.controller === 10) {
        var pan = c.value;
        var L = Math.round((127 - pan) * 127 / 127);
        var R = Math.round(pan * 127 / 127);
        perTrack[ti].ctrls.push({ tick: tick, order: 1, ev: { type: 'controller', controller: 0x0b, value: L } });
        perTrack[ti].ctrls.push({ tick: tick, order: 1, ev: { type: 'controller', controller: 0x0c, value: R } });
      }
    });

    var indices = Object.keys(perTrack).map(Number).sort(function (a, b) { return a - b; });
    var model = { tempo: tempoByte, tracks: [] };
    var allNotes = [];
    // track slots must be dense in the file but the game addresses them by position: keep position = track index (empty ones get a stop-only track)
    var top = indices.length ? indices[indices.length - 1] : -1;
    for (var ti = 0; ti <= top; ti++) {
      var rec = perTrack[ti];
      var events = [];
      var cursor = 0;
      var push = function (tick, ev) { ev.delay = Math.max(0, tick - cursor); cursor = Math.max(cursor, tick); events.push(ev); };
      if (!rec) push(0, { type: 'name', text: '-' }); // an empty track still needs a first record before its stop
      if (rec) {
        var items = [];
        var program = null;
        var soundNow = null;
        rec.notes.sort(function (a, b) { return a.tick - b.tick; });
        var progs = rec.progs.slice().sort(function (a, b) { return a.tick - b.tick; });
        var bends = rec.bends.slice().sort(function (a, b) { return a.tick - b.tick; });
        var ctrls = (rec.ctrls || []).slice().sort(function (a, b) { return a.tick - b.tick || a.order - b.order; });
        var pi = 0;
        var bi = 0;
        var ci = 0;
        var curProgram = progs.length && progs[0].tick <= 0 ? progs[0].program : 0;
        // every track opens with a name: the player drops the delay of a track's first record, so a first note would play at once
        items.push({ tick: 0, order: 0, ev: { type: 'name', text: ti === 9 ? 'drums' : 'ch' + (rec.ch + 1) } });
        rec.notes.forEach(function (n) {
          while (pi < progs.length && progs[pi].tick <= n.tick) { curProgram = progs[pi].program; pi += 1; }
          while (ci < ctrls.length && ctrls[ci].tick <= n.tick) { items.push(ctrls[ci]); ci += 1; }
          while (bi < bends.length && bends[bi].tick <= n.tick) {
            if (ti !== 9 && soundNow != null) {
              var range = sounds[soundNow].bendRange;
              if (range) {
                var v = Math.max(0, Math.min(16383, Math.round(8192 + (bends[bi].semis / range) * 8192)));
                items.push({ tick: bends[bi].tick, order: 2, ev: { type: 'bend', value: v & 0x7f, extra: v >> 7 } });
              }
            }
            bi += 1;
          }
          var code;
          if (ti === 9) {
            code = 0x2f + n.drum;
          } else {
            var snd = soundForProgram(gmMap, set, curProgram);
            if (snd == null) { report.dropped += 1; report.warnings.push('no sound for GM program ' + curProgram + ' in the ' + set + ' set (note dropped)'); return; }
            if (snd !== soundNow) {
              soundNow = snd;
              items.push({ tick: n.tick, order: 1, ev: { type: 'instrument', value: snd, sound: snd } });
              report.instruments[ti] = report.instruments[ti] || [];
              if (report.instruments[ti].indexOf(snd) < 0) report.instruments[ti].push(snd);
            }
            var v7 = (n.pitch - sounds[snd].noteOffset) & 0x7f;
            code = v7 < 0x59 ? 0x80 | v7 : v7;
          }
          items.push({ tick: n.tick, order: 3, ev: { type: 'note', code: code, velocity: nearestCurveIndex(curve, n.vel), duration: n.dur } });
          report.notes += 1;
          allNotes.push({ start: n.tick, end: n.tick + n.dur });
        });
        items.sort(function (a, b) { return a.tick - b.tick || a.order - b.order; });
        items.forEach(function (it) { push(it.tick, it.ev); });
      }
      model.tracks.push({ index: ti, events: events, cursor: cursor });
    }
    // every track ends together: a mark at the start and a loop jump, or a stop, at the end tick
    var finish = endTick + 1;
    model.tracks.forEach(function (t) {
      if (opts.loop) {
        t.events.unshift({ delay: 0, type: 'mark', code: 0xe2, value: 0 });
        var cur = t.events.reduce(function (s, e) { return s + e.delay; }, 0);
        t.events.push({ delay: Math.max(0, finish - cur), type: 'loop', code: 0xdb });
      } else {
        var cur2 = t.events.reduce(function (s, e) { return s + e.delay; }, 0);
        t.events.push({ delay: Math.max(0, finish - cur2), type: 'stop', code: 0xd9 });
      }
      delete t.cursor;
    });
    // voices: the sound unit has 8; more at once means the game steals the oldest
    var edges = [];
    allNotes.forEach(function (n) { edges.push([n.start, 1], [n.end, -1]); });
    edges.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var live = 0;
    edges.forEach(function (e) { live += e[1]; report.maxVoices = Math.max(report.maxVoices, live); });
    if (report.maxVoices > 8) report.warnings.push('up to ' + report.maxVoices + ' notes sound at once; the sound unit has 8 voices, so the oldest are cut');
    report.tracks = model.tracks.length;
    report.ticks = finish;
    report.seconds = finish * tl;
    return { bytes: buildSong(model), model: model, report: report };
  }

  function fromNative(parsed, marks, data, report) {
    report.native = true;
    var tempoMark = marks.find(function (m) { return /^n94:tempo /.test(m.text); });
    var setMark = marks.find(function (m) { return /^n94:set /.test(m.text); });
    report.set = setMark ? setMark.text.slice(8) : 'menu';
    var model = { tempo: tempoMark ? Number(tempoMark.text.slice(10)) : 120, tracks: [] };
    // each native track starts with "n94:track N": the song's track number of that MIDI track
    var indexOf = {};
    marks.forEach(function (m) { var t = /^n94:track (\d+)$/.exec(m.text); if (t) indexOf[m.track] = Number(t[1]); });
    var items = {};
    var add = function (ti, tick, order, ev) { (items[ti] = items[ti] || []).push({ tick: tick, order: order, ev: ev }); };
    Object.keys(indexOf).forEach(function (ft) { items[indexOf[ft]] = items[indexOf[ft]] || []; });
    var flags = {}; // "lo" (note code below $80) and "d0" (zero duration), counted per track, tick and key
    marks.forEach(function (m) {
      var f = /^n94:(lo|d0) (\d+)$/.exec(m.text);
      if (f && indexOf[m.track] != null) { var k = f[1] + ':' + indexOf[m.track] + ':' + m.tick + ':' + f[2]; flags[k] = (flags[k] || 0) + 1; }
    });
    var take = function (kind, ti, tick, pitch) { var k = kind + ':' + ti + ':' + tick + ':' + pitch; if (flags[k] > 0) { flags[k] -= 1; return true; } return false; };
    marks.forEach(function (m) {
      if (!/^n94:[0-9a-f]+$/.test(m.text) || indexOf[m.track] == null) return;
      var b = (m.text.slice(4).match(/../g) || []).map(function (h) { return parseInt(h, 16); });
      add(indexOf[m.track], m.tick, 1, eventOfBytes(b));
    });
    parsed.notes.forEach(function (n) {
      var ti = indexOf[n.track] != null ? indexOf[n.track] : n.ch;
      var low = take('lo', ti, n.tick, n.pitch);
      var zero = take('d0', ti, n.tick, n.pitch);
      add(ti, n.tick, 2, { type: 'note', code: low ? n.pitch & 0x7f : 0x80 | (n.pitch & 0x7f), velocity: n.vel, duration: zero ? 0 : n.dur });
      report.notes += 1;
    });
    Object.keys(items).map(Number).sort(function (a, b) { return a - b; }).forEach(function (ti) {
      var evs = items[ti].sort(function (a, b) { return a.tick - b.tick || a.order - b.order; });
      var cursor = 0;
      model.tracks.push({ index: ti, events: evs.map(function (it) { var e = Object.assign({ delay: Math.max(0, it.tick - cursor) }, it.ev); cursor = Math.max(cursor, it.tick); return e; }) });
    });
    report.tracks = model.tracks.length;
    return { bytes: buildSong(model), model: model, report: report };
  }

  function eventOfBytes(b) {
    var c = b[0];
    if (c === 0xd9 || c === 0xda) return { type: 'stop', code: c };
    if (c === 0xdb) return { type: 'loop', code: c };
    if (c === 0xe3) return { type: 'e3', code: c };
    if (c === 0xdc) return { type: 'instrument', code: c, value: b[1], sound: b[1] === 0x6a ? 0x14 : b[1] };
    if (c === 0xdd) return { type: 'tempo', code: c, value: b[1] };
    if (c === 0xde) return { type: 'volume', code: c, value: b[1] };
    if (c === 0xdf) return { type: 'controller', code: c, controller: b[1], value: b[2] };
    if (c === 0xe2) return { type: 'mark', code: c, value: b[1] };
    if (c === 0xea) return { type: 'ea', code: c, value: b[1] };
    if (c === 0xe5) return { type: 'bend', code: c, value: b[1], extra: b[2] };
    if (c === 0xe7) return { type: 'name', code: c, text: String.fromCharCode.apply(null, b.slice(2).filter(function (x) { return x; })) };
    throw new Error('unknown event ' + c.toString(16));
  }

  return { buildSong: buildSong, modelOf: modelOf, toSmf: toSmf, fromSmf: fromSmf, eventBytes: eventBytes, soundForProgram: soundForProgram, soundForDrum: soundForDrum, PPQ: PPQ, tickOfTempoByte: tickOfTempoByte, tickLength: tickLength };
});
