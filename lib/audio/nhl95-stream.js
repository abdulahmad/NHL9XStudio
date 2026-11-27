/**
 * NHL 95 (Genesis) songs for the Sound test's sequencer and MIDI tools: the editor model, MIDI import / export and
 * the ROM copy the sequencer plays on the retail driver. The sequence format, the encoder and the ROM copy are
 * lib/audio/nhl95-seq.js; the GM table is data/audio/nhl95-gm-map.json. nhl9x-stream.js hands game 95 here.
 *
 * Editor model (times in vblanks, one sequencer tick each at the retail tempo):
 *   { game: 95, name, ticks, loopTick: null|number, unit, loadList: 0|1,
 *     notes: [{ t, dur, ch, note, vel, patch }],   ch 0-15; patch = the program in effect (a SoundBanks patch id)
 *     controllers: [{ t, ch, ctl, val }],          the song's controllers as they are (95 uses 1, 18 and 116)
 *     bends: [{ t, ch, value }],                   the raw bend byte 0-127, 64 = none
 *     programs: [...] (optional)                   retail program events, reused where they still fit }
 * loadList: the patch set the driver has uploaded when the song plays: 0 the menus (songs 0-3), 1 the game.
 * UMD: Node and the browser.
 */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var api = factory(isNode ? require('./nhl95-seq') : root.Nhl95Seq);
  if (isNode) module.exports = api;
  else root.Nhl95Stream = api;
})(typeof self !== 'undefined' ? self : this, function (Seq) {
  'use strict';

  var CHANNELS = 16;
  var NOTE_LO = 0;
  var NOTE_HI = 127;
  var BEND_CENTER = 64;
  var BEND_SEMIS = 2; // the byte is read as a MIDI bend MSB: +-2 semitones at the ends (an assumption, not measured)
  var CUSTOM_SONG = 0x32; // song() takes 0-3 and $32-$55; the ROM copy hides the retail $32 and adds the new one
  var VBLANK_HZ = 59.92;
  var NATIVE_PPQ = 60;
  var DRUM_CH = 9;

  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : many); };
  var strip = function (o) { var c = {}; Object.keys(o).forEach(function (k) { if (k !== 'o') c[k] = o[k]; }); return c; };

  function emptySong(loadList) {
    return { game: 95, name: 'my-song', ticks: 16 * 8 * 4, loopTick: null, unit: 8, loadList: loadList === 0 ? 0 : 1, notes: [], controllers: [], bends: [] };
  }

  /** Which load list a retail song plays with (as the harness and the game pick it). */
  var listOfSong = function (id) { return id >= 0 && id <= 3 ? 0 : 1; };

  /** The patches of load list `list` (from the map). */
  function listPatches(map, list) {
    var l = map && map.loadLists && map.loadLists.filter(function (x) { return x.list === list; })[0];
    return l ? l.patches.slice() : [];
  }

  /** nhl95-seq model -> editor model: each note carries the program in effect on its channel. */
  function fromSeq(m, loadList) {
    var progs = (m.programs || []).slice().sort(function (a, b) { return a.t - b.t || (a.o || 0) - (b.o || 0); });
    var notes = m.notes.map(function (n) {
      var p = null;
      for (var i = 0; i < progs.length; i++) {
        var q = progs[i];
        if (q.ch !== n.ch) continue;
        if (q.t < n.t || (q.t === n.t && (q.o == null || n.o == null || q.o < n.o))) p = q.program;
      }
      if (p == null) { var first = progs.filter(function (q) { return q.ch === n.ch; })[0]; p = first ? first.program : 0; }
      var c = { t: n.t, dur: n.dur, ch: n.ch, note: n.note, vel: n.vel, patch: p };
      if (n.o != null) c.o = n.o;
      return c;
    });
    return { game: 95, name: m.name, ticks: m.ticks, loopTick: m.loopTick, unit: 8, loadList: loadList == null ? 1 : loadList, notes: notes,
      controllers: m.controllers.slice(), bends: m.bends.slice(), programs: progs };
  }

  function fromStream(rom, id) {
    return fromSeq(Seq.fromRom(rom, id), listOfSong(id));
  }

  /**
   * Editor model -> nhl95-seq model. A program event goes before a note wherever the channel's patch changes; a
   * retail program event with that patch between the previous note and this one is reused (it keeps its place).
   */
  function toSeq(song) {
    var programs = [];
    var retail = (song.programs || []).slice();
    var used = {};
    for (var ch = 0; ch < CHANNELS; ch++) {
      var list = song.notes.filter(function (n) { return n.ch === ch; }).sort(function (a, b) { return a.t - b.t || (a.o || 0) - (b.o || 0); });
      var cur = null;
      var prevT = -1;
      list.forEach(function (n) {
        if (n.patch !== cur) {
          var hit = -1;
          for (var i = 0; i < retail.length; i++) {
            var q = retail[i];
            if (used[i] || q.ch !== ch || q.program !== n.patch || q.t > n.t || q.t < prevT) continue;
            if (q.t === n.t && q.o != null && n.o != null && q.o > n.o) continue;
            hit = i;
          }
          if (hit >= 0) { used[hit] = true; programs.push(retail[hit]); }
          else programs.push({ t: n.t, ch: ch, program: n.patch });
          cur = n.patch;
        }
        prevT = n.t;
      });
    }
    // Retail program events no note needs are kept too (a channel's patch can be set before its notes start).
    retail.forEach(function (q, i) { if (!used[i] && !programs.some(function (p) { return p.ch === q.ch && p.t === q.t; })) programs.push(q); });
    return { game: 95, name: song.name, ticks: song.ticks, loopTick: song.loopTick, notes: song.notes, controllers: song.controllers || [], programs: programs, bends: song.bends || [] };
  }

  function encode(song) { return Seq.encode(toSeq(song)); }

  /** { rom, banks, id, bytes, loadList }: the ROM copy with the song as song CUSTOM_SONG (play with { banks, loadList }). */
  function romWithSong(rom, song) {
    var r = Seq.romWithSong(rom, toSeq(song), CUSTOM_SONG);
    r.loadList = song.loadList === 0 ? 0 : 1;
    // Song $32 gets list 1 from the harness the way the game does (boot with list 0, then the in-game list); list 0 is pinned.
    r.driverOpts = r.loadList === 0 ? { banks: r.banks, loadList: 0 } : { banks: r.banks };
    return r;
  }

  function toBinary(song) { return encode(song); }

  var hex = function (v) { return '$' + v.toString(16).toUpperCase().padStart(2, '0'); };
  /** The encoded song as dc.b lines, one per event, with a comment. */
  function toAsm(song, name) {
    var bytes = encode(song);
    var r = Seq.parse(bytes);
    var lines = ['; ' + (name || song.name || 'song') + ': NHL 95 sequence (sound95.asm SndStartSeq / SndUpdate), load list ' + (song.loadList === 0 ? 0 : 1), (name || 'song') + ':'];
    var n = 2 + 2 * r.markers.length;
    lines.push('\tdc.b ' + Array.prototype.slice.call(bytes, 0, n).map(hex).join(',') + '\t; ' + plural(r.markers.length, 'loop marker', 'loop markers'));
    var at = n;
    r.events.forEach(function (e, i) {
      var end = i + 1 < r.events.length && r.events[i + 1].pos != null ? r.events[i + 1].pos : bytes.length;
      if (e.kind === 'tail') return;
      var start = at;
      var what = e.kind === 'note' ? 'ch' + e.ch + ' note ' + e.note + ' vel ' + e.vel + ' len ' + e.len : e.kind === 'ctl' ? 'ch' + e.ch + ' controller ' + e.ctl + ' = ' + e.val
        : e.kind === 'loop' ? 'loop to marker ' + e.val : e.kind === 'program' ? 'ch' + e.ch + ' patch ' + e.program : e.kind === 'bend' ? 'ch' + e.ch + ' bend ' + e.value : e.kind;
      var stop = Math.max(start, Math.min(bytes.length, end));
      if (e.kind === 'end' || e.kind === 'loop') stop = bytes.length;
      lines.push('\tdc.b ' + Array.prototype.slice.call(bytes, start, stop).map(hex).join(',') + '\t; t=' + e.t + ' ' + what);
      at = stop;
    });
    return lines.join('\n') + '\n';
  }

  // --- GM export --------------------------------------------------------------------------------------

  var byPatch = function (map) { var o = {}; ((map && map.patches) || []).forEach(function (e) { o[e.patch] = e; }); return o; };
  var drumNoteOf = function (map, list, patch, note) {
    var l = map.gmToNhl.lists[String(list)];
    var d = l && l.drums.filter(function (x) { return x.patch === patch && x.note === note; })[0];
    return d ? d.notes[0] : null;
  };

  /** The model as a General MIDI song (normalizeGm shape): patches -> programs or drum notes by the map. */
  function toGm(song, map) {
    var P = byPatch(map);
    var used = {};
    song.notes.forEach(function (n) { used[n.ch] = true; });
    var free = [];
    for (var c = 0; c < 16; c++) if (c !== DRUM_CH && !used[c]) free.push(c);
    var mel9 = used[DRUM_CH] ? (free.length ? free[0] : 15) : DRUM_CH;
    var midiCh = function (ch) { return ch === DRUM_CH ? mel9 : ch; };
    var notes = [];
    song.notes.forEach(function (n) {
      var e = P[n.patch];
      var t = e ? e.target : null;
      if (t && t.kind === 'drum') {
        var dn = drumNoteOf(map, song.loadList, n.patch, n.note);
        notes.push({ tick: n.t, dur: Math.max(1, n.dur), ch: DRUM_CH, pitch: dn != null ? dn : t.note, vel: clamp(n.vel, 1, 127), program: null });
      } else notes.push({ tick: n.t, dur: Math.max(1, n.dur), ch: midiCh(n.ch), pitch: clamp(n.note, 0, 127), vel: clamp(n.vel, 1, 127), program: t && t.kind === 'program' ? t.program : 0 });
    });
    notes.sort(function (a, b) { return a.tick - b.tick || a.ch - b.ch || a.pitch - b.pitch; });
    var bends = (song.bends || []).filter(function (b) { return b.ch !== DRUM_CH || mel9 !== DRUM_CH; })
      .map(function (b) { return { tick: b.t, ch: midiCh(b.ch), semis: ((b.value - BEND_CENTER) / BEND_CENTER) * BEND_SEMIS }; });
    return { song: { ppq: NATIVE_PPQ, tempos: [{ tick: 0, bpm: VBLANK_HZ }], name: song.name || '', notes: notes, bends: bends, controllers: [] } };
  }

  // --- GM import --------------------------------------------------------------------------------------

  function secondsFn(gm) {
    var tempos = (gm.tempos && gm.tempos.length ? gm.tempos : [{ tick: 0, bpm: 120 }]).slice().sort(function (a, b) { return a.tick - b.tick; });
    var segs = [];
    var secs = 0;
    for (var i = 0; i < tempos.length; i++) {
      segs.push({ tick: tempos[i].tick, secs: secs, bpm: tempos[i].bpm });
      if (i + 1 < tempos.length) secs += ((tempos[i + 1].tick - tempos[i].tick) / gm.ppq) * (60 / tempos[i].bpm);
    }
    return function (tick) {
      var s = segs[0];
      for (var k = 0; k < segs.length && segs[k].tick <= tick; k++) s = segs[k];
      return s.secs + ((tick - s.tick) / gm.ppq) * (60 / s.bpm);
    };
  }

  function patchForProgram(map, list, program) {
    var l = map.gmToNhl.lists[String(list)];
    if (l.programOverrides[String(program)] != null) return l.programOverrides[String(program)];
    var inList = listPatches(map, list);
    var hit = map.patches.filter(function (e) { return inList.indexOf(e.patch) >= 0 && e.target.kind === 'program' && e.target.program === program; })[0];
    return hit ? hit.patch : l.families[program >> 3];
  }
  function drumFor(map, list, note) {
    var l = map.gmToNhl.lists[String(list)];
    return l.drums.filter(function (x) { return x.notes.indexOf(note) >= 0; })[0] || l.defaultDrum;
  }

  /**
   * A (normalized) General MIDI song as a model for load list `list` (0 menus, 1 in game; default 0). MIDI channels
   * keep their numbers (16 channels), drums go to channel 9 as the list's drum patches, programs become the list's
   * patches, bends become the raw byte (+-2 semitones).
   */
  function fromGm(gm, map, list) {
    list = list === 1 ? 1 : 0;
    var report = [];
    var secs = secondsFn(gm);
    var toVbl = function (tick) { return Math.round(secs(tick) * VBLANK_HZ); };
    var notes = [];
    var drums = 0;
    var progs = {};
    gm.notes.slice().sort(function (a, b) { return a.tick - b.tick; }).forEach(function (n) {
      var t = toVbl(n.tick);
      var dur = Math.max(1, toVbl(n.tick + n.dur) - t);
      if (n.ch === DRUM_CH) {
        var d = drumFor(map, list, n.pitch);
        notes.push({ t: t, dur: Math.min(dur, 12), ch: DRUM_CH, note: d.note, vel: clamp(n.vel, 1, 127), patch: d.patch });
        drums++;
        return;
      }
      var p = patchForProgram(map, list, n.program == null ? 0 : n.program);
      progs[p] = true;
      notes.push({ t: t, dur: dur, ch: n.ch, note: clamp(n.pitch, NOTE_LO, NOTE_HI), vel: clamp(n.vel, 1, 127), patch: p });
    });
    var byKey = {};
    var trimmed = 0;
    notes.forEach(function (n) { (byKey[n.ch + ':' + n.note] = byKey[n.ch + ':' + n.note] || []).push(n); });
    Object.keys(byKey).forEach(function (k) {
      var l = byKey[k];
      for (var i = 0; i + 1 < l.length; i++) if (l[i].t + l[i].dur > l[i + 1].t) { l[i].dur = Math.max(1, l[i + 1].t - l[i].t); trimmed++; }
    });
    if (trimmed) report.push(plural(trimmed, 'overlapping repeat of a note', 'overlapping repeats of a note') + ' cut short.');
    var bends = [];
    var clamped = 0;
    (gm.bends || []).forEach(function (b) {
      if (b.ch === DRUM_CH) return;
      var v = Math.round(BEND_CENTER + (b.semis / BEND_SEMIS) * BEND_CENTER);
      if (v < 0 || v > 127) { clamped++; v = clamp(v, 0, 127); }
      var t = toVbl(b.tick);
      var last = bends.filter(function (x) { return x.ch === b.ch; }).pop();
      if (last && last.t === t) last.value = v; else if (!last || last.value !== v) bends.push({ t: t, ch: b.ch, value: v });
    });
    var ticks = notes.reduce(function (m, n) { return Math.max(m, n.t + n.dur); }, 0);
    var song = emptySong(list);
    song.name = gm.name || 'import';
    song.ticks = Math.max(128, Math.ceil(ticks / 128) * 128);
    song.notes = notes.sort(function (a, b) { return a.t - b.t || a.ch - b.ch || a.note - b.note; });
    song.bends = bends;
    report.push('Load list ' + list + ' (' + (list ? 'in game' : 'menus') + '): patches ' + Object.keys(progs).join(', ') + (drums ? '; ' + plural(drums, 'drum hit', 'drum hits') + ' on channel 10' : '') + '.');
    if (bends.length) report.push(plural(bends.length, 'pitch-bend move', 'pitch-bend moves') + ' kept as the bend byte (+-' + BEND_SEMIS + ' semitones).');
    if (clamped) report.push(plural(clamped, 'bend', 'bends') + ' beyond +-' + BEND_SEMIS + ' semitones clamped.');
    if ((gm.controllers || []).length) report.push(plural(gm.controllers.length, 'volume controller move', 'volume controller moves') + ' not kept (NHL 95 songs use other controllers).');
    return { song: song, report: report };
  }

  // --- Native MIDI ------------------------------------------------------------------------------------
  // One MIDI tick per vblank. A track per channel; patch changes, controllers and raw bends ride in markers
  // `NHL c=<ch> p=<patch> | k=<ctl> v=<val> | b=<byte>`; the header marker is `NHL95 v1 ticks= loop= unit= list=`.

  var mark = function (ch, f) { return 'NHL c=' + ch + ' ' + Object.keys(f).map(function (k) { return k + '=' + f[k]; }).join(' '); };
  var unmark = function (text) {
    var parts = String(text).trim().split(/\s+/);
    if (parts[0] !== 'NHL') return null;
    var o = { ch: 0, f: {} };
    parts.slice(1).forEach(function (p) { var i = p.indexOf('='); if (i < 0) return; var k = p.slice(0, i); var v = Number(p.slice(i + 1)); if (k === 'c') o.ch = v; else o.f[k] = v; });
    return o;
  };

  function toSmfNative(song) {
    var tracks = [];
    for (var ch = 0; ch < CHANNELS; ch++) {
      var notes = song.notes.filter(function (n) { return n.ch === ch; }).sort(function (a, b) { return a.t - b.t || a.note - b.note; });
      var ctls = (song.controllers || []).filter(function (c) { return c.ch === ch; });
      var bends = (song.bends || []).filter(function (b) { return b.ch === ch; });
      if (!notes.length && !ctls.length && !bends.length) continue;
      var markers = [];
      var patch = null;
      notes.forEach(function (n) { if (n.patch !== patch) { markers.push({ tick: n.t, text: mark(ch, { p: n.patch }) }); patch = n.patch; } });
      ctls.forEach(function (c) { markers.push({ tick: c.t, text: mark(ch, { k: c.ctl, v: c.val }) }); });
      bends.forEach(function (b) { markers.push({ tick: b.t, text: mark(ch, { b: b.value }) }); });
      var pats = {};
      notes.forEach(function (n) { pats[n.patch] = true; });
      tracks.push({ name: 'CH' + (ch + 1) + ' (patch ' + Object.keys(pats).join(', ') + ')', ch: ch, markers: markers,
        notes: notes.map(function (n) { return { tick: n.t, dur: n.dur, pitch: clamp(n.note, 0, 127), vel: clamp(n.vel, 1, 127) }; }) });
    }
    return { ppq: NATIVE_PPQ, tempos: [{ tick: 0, bpm: VBLANK_HZ }], name: song.name || undefined, tracks: tracks,
      markers: [{ tick: 0, text: 'NHL95 v1 ticks=' + song.ticks + ' loop=' + (song.loopTick == null ? '-' : song.loopTick) + ' unit=' + (song.unit || 8) + ' list=' + (song.loadList === 0 ? 0 : 1) }] };
  }

  /** A file written by toSmfNative as a model, or null (an ordinary MIDI file, or another game's). */
  function fromSmfNative(parsed) {
    var head = (parsed.markers || []).filter(function (m) { return /^NHL95 v1\b/.test(m.text); })[0];
    if (!head) return null;
    var num = function (k) { var m = new RegExp(k + '=(-?\\d+)').exec(head.text); return m ? Number(m[1]) : null; };
    var song = emptySong(num('list'));
    song.ticks = Math.max(1, num('ticks') || 1);
    song.loopTick = num('loop');
    song.unit = num('unit') || 8;
    song.name = '';
    var k = NATIVE_PPQ / parsed.ppq;
    var T = function (t) { return Math.round(t * k); };
    var marks = {};
    (parsed.markers || []).forEach(function (m) { var x = unmark(m.text); if (x) (marks[x.ch] = marks[x.ch] || []).push({ tick: m.tick, f: x.f }); });
    for (var ch = 0; ch < CHANNELS; ch++) {
      var ms = (marks[ch] || []).sort(function (a, b) { return a.tick - b.tick; });
      var notes = parsed.notes.filter(function (n) { return n.ch === ch; }).sort(function (a, b) { return a.tick - b.tick; });
      var patch = 0;
      var mi = 0;
      notes.forEach(function (n) {
        while (mi < ms.length && ms[mi].tick <= n.tick) { if (ms[mi].f.p != null) patch = ms[mi].f.p; mi++; }
        song.notes.push({ t: T(n.tick), dur: Math.max(1, T(n.dur)), ch: ch, note: n.pitch, vel: clamp(n.vel == null ? 100 : n.vel, 1, 127), patch: patch });
      });
      ms.forEach(function (m) {
        if (m.f.k != null) song.controllers.push({ t: T(m.tick), ch: ch, ctl: m.f.k, val: clamp(m.f.v, 0, 127) });
        if (m.f.b != null) song.bends.push({ t: T(m.tick), ch: ch, value: clamp(m.f.b, 0, 127) });
      });
    }
    song.notes.sort(function (a, b) { return a.t - b.t || a.ch - b.ch || a.note - b.note; });
    song.controllers.sort(function (a, b) { return a.t - b.t || a.ch - b.ch; });
    song.bends.sort(function (a, b) { return a.t - b.t || a.ch - b.ch; });
    return { song: song, report: ['Native NHL 95 file (load list ' + song.loadList + '): ' + plural(song.notes.length, 'note', 'notes') + ', ' + plural(song.controllers.length, 'controller', 'controllers') + ', ' + plural(song.bends.length, 'pitch bend', 'pitch bends') + '; patches restored from the file\'s markers.'] };
  }

  return {
    CHANNELS: CHANNELS, NOTE_LO: NOTE_LO, NOTE_HI: NOTE_HI, BEND_CENTER: BEND_CENTER, BEND_SEMIS: BEND_SEMIS, CUSTOM_SONG: CUSTOM_SONG,
    emptySong: emptySong, listOfSong: listOfSong, listPatches: listPatches, fromSeq: fromSeq, fromStream: fromStream, toSeq: toSeq, encode: encode,
    romWithSong: romWithSong, toBinary: toBinary, toAsm: toAsm, toGm: toGm, fromGm: fromGm, toSmfNative: toSmfNative, fromSmfNative: fromSmfNative,
    patchForProgram: patchForProgram, drumFor: drumFor
  };
});
