/**
 * NHLPA 93 / NHL 94 songs as an editable model, the event-stream encoder, MIDI import and the ROM copy the
 * sequencer plays on the retail drivers. Event format: lib/audio/nhl9x-song.js.
 *
 * Model (times in vblanks, 59.92 per second; the grid is only the editor's):
 *   { game: 93|94, name, ticks, loopTick: null|number, unit,
 *     notes: [{ t, dur, ch, note, vel, patch }],      ch 0-7 (the driver keeps eight channels per song)
 *     bends: [{ t, ch, value }],                       value -8192..8191 (the driver adds $2000 to the stream word)
 *     patchEdits: { id: [32 bytes] } (optional) }     FM patches edited in the sequencer (lib/audio/patch-edits.js);
 *                                                     the exports carry them, and a retail song has none
 *
 * Nothing here changes a driver, a patch or the sound data: a song goes into a COPY of the sound slice, appended
 * after the last retail byte, and one song-table entry of the copy points at it.
 * UMD: Node and the browser.
 */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var api = factory(isNode ? require('./nhl9x-song') : root.Nhl9xSong, isNode ? require('./nhl92-song-gm') : root.Nhl92SongGm, isNode ? require('./patch-edits') : root.NhlPatchEdits);
  if (isNode) module.exports = api;
  else root.Nhl9xStream = api;
})(typeof self !== 'undefined' ? self : this, function (Song, SongGm, Edits) {
  'use strict';

  var CHANNELS = 8;
  var MAX_FM_VOICES = 5; // the driver has five FM voices for notes and one PCM channel
  var NOTE_LO = 12; // the frequency table has octaves 0-7: notes 0-95; below 12 is a sub-audio rumble
  var NOTE_HI = 95;
  var CUSTOM_SONG = { 93: 0x37, 94: 0x7a }; // the song-table entry of the ROM copy that points at the sequencer's song
  var ROM_SIZE = { 93: 0x2e1fc, 94: 0x4b5c0 };
  var MAX_OFFSET93 = 0x7fff; // NHL 93's table holds signed 16-bit offsets from the table (the stream itself can run on)

  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : many); };

  function emptySong(game) {
    return { game: game, name: 'my-song', ticks: 16 * 8 * 4, loopTick: null, unit: 8, notes: [], bends: [] };
  }

  // --- Retail stream -> model -------------------------------------------------------------------------

  /** Sound `id` of the loaded game as a model (volume controller folded into the velocity, as in toGm). */
  function fromStream(game, slice, id, map) {
    void map;
    var r = Song.parse(game, slice, Song.streamAddr(game, slice, id));
    var st = {};
    var open = {};
    var notes = [];
    var bends = [];
    r.events.forEach(function (e) {
      var c = st[e.ch] || (st[e.ch] = { patch: 0, vol: 0x7f });
      var key = e.ch + ':' + e.note;
      if (e.kind === 'patch') c.patch = e.patch;
      else if (e.kind === 'ctl') { if (e.ctl === 7) c.vol = e.val; }
      else if (e.kind === 'bend') bends.push({ t: e.t, ch: e.ch, value: clamp(e.bend, -8192, 8191) });
      else if (e.kind === 'off') {
        if (open[key]) { open[key].dur = Math.max(1, e.t - open[key].t); delete open[key]; }
      } else if (e.kind === 'on') {
        if (open[key]) { open[key].dur = Math.max(1, e.t - open[key].t); delete open[key]; }
        var n = { t: e.t, dur: 0, ch: e.ch, note: e.note, vel: clamp(Math.round((e.vel * c.vol) / 127), 1, 127), patch: c.patch };
        notes.push(n);
        open[key] = n;
      }
    });
    Object.keys(open).forEach(function (k) { open[k].dur = Math.max(1, r.ticks - open[k].t); });
    return { game: game, name: 'song-' + id.toString(16), ticks: Math.max(r.ticks, 1), loopTick: r.end === 'loop' ? r.loopTick : null, unit: 8, notes: notes, bends: bends };
  }

  // --- Model -> stream ---------------------------------------------------------------------------------

  /**
   * The song's event stream. `base` is the ROM address the first byte will have (the loop jump is absolute).
   * Offs sort before ons at the same vblank so a repeated note retriggers; a patch is selected only when the channel's
   * patch changes. Delays over 255 vblanks are carried by ignored filler events.
   * @returns {{bytes:Uint8Array, events:number, loopOffset:number|null}}
   */
  function encode(song, base) {
    var ev = [];
    var cur = {};
    var seq = 0;
    var ordered = song.notes.slice().sort(function (a, b) { return a.t - b.t || a.ch - b.ch || a.note - b.note; });
    ordered.forEach(function (n) {
      var t = Math.max(0, Math.round(n.t));
      var ch = n.ch & 7;
      // A note's patch select is written right before its own key on, so notes of one channel that start together
      // with different patches (the drum channel) each play their own.
      if (cur[ch] !== n.patch) { ev.push({ t: t, o: 2, q: seq++, s: 0xc0 | ch, a: n.patch & 0x7f, b: 0 }); cur[ch] = n.patch; }
      ev.push({ t: t, o: 2, q: seq++, s: 0x90 | ch, a: clamp(n.note, 0, 127), b: clamp(Math.round(n.vel), 1, 127) });
      ev.push({ t: t + Math.max(1, Math.round(n.dur)), o: 0, q: seq++, s: 0x80 | ch, a: clamp(n.note, 0, 127), b: 0 });
    });
    (song.bends || []).forEach(function (b) {
      var w = clamp(Math.round(b.value), -8192, 8191) + 0x2000;
      ev.push({ t: Math.max(0, Math.round(b.t)), o: 1, q: seq++, s: 0xe0 | (b.ch & 7), a: (w >> 8) & 0xff, b: w & 0xff });
    });
    ev.sort(function (x, y) { return x.t - y.t || x.o - y.o || x.q - y.q; });
    var end = Math.max(Math.round(song.ticks), ev.length ? ev[ev.length - 1].t : 0);
    var loopAt = song.loopTick == null ? null : Math.round(song.loopTick);
    var out = [];
    var last = 0;
    var loopOffset = null;
    ev.forEach(function (e) {
      var d = e.t - last;
      while (d > 255) { out.push(255, 0xa0, 0, 0); d -= 255; }
      if (loopOffset == null && loopAt != null && e.t >= loopAt) loopOffset = out.length;
      out.push(d, e.s, e.a, e.b);
      last = e.t;
    });
    var d2 = end - last;
    while (d2 > 255) { out.push(255, 0xa0, 0, 0); d2 -= 255; }
    if (loopOffset != null) {
      var addr = (base >>> 0) + loopOffset;
      out.push(d2, 0, (addr >>> 24) & 0xff, (addr >>> 16) & 0xff, (addr >>> 8) & 0xff, addr & 0xff, 0, 0);
    } else out.push(d2, 0, 0xff, 0xff);
    return { bytes: Uint8Array.from(out), events: ev.length, loopOffset: loopOffset };
  }

  /** The ROM copy: the sound image with the song appended and the custom song-table entry pointing at it. */
  function romWithSong(game, rom, song) {
    var g = Song.GAMES[game];
    var at = ROM_SIZE[game];
    var enc = encode(song, at);
    var copy = new Uint8Array(Math.max(rom.length, at) + enc.bytes.length + 8);
    copy.set(rom);
    copy.set(enc.bytes, at);
    var entry = g.table + (game === 93 ? 2 : 4) * CUSTOM_SONG[game];
    if (game === 93) {
      var off = at - g.table;
      if (off > MAX_OFFSET93) throw new Error('NHLPA 93 song table offset out of range');
      copy[entry] = (off >> 8) & 0xff;
      copy[entry + 1] = off & 0xff;
    } else {
      copy[entry] = (at >>> 24) & 0xff;
      copy[entry + 1] = (at >>> 16) & 0xff;
      copy[entry + 2] = (at >>> 8) & 0xff;
      copy[entry + 3] = at & 0xff;
    }
    return { rom: copy, id: CUSTOM_SONG[game], bytes: enc.bytes, address: at, events: enc.events };
  }

  /** The stream as assembler source (dc.b rows with a comment per event) and as raw bytes. */
  function toAsm(song, name) {
    var enc = encode(song, 0);
    var lines = ['; NHL ' + song.game + ' event stream: ' + (name || song.name) + ' (' + enc.events + ' events, ' + (song.ticks / Song.VBLANK_HZ).toFixed(1) + ' s)',
      '; each event: delay in vblanks before it, status, a, b. Status $9c key on (a note, b volume), $8c key off, $cc patch a, $ec pitch bend (a:b - $2000), 0 end/loop.'];
    if (enc.loopOffset != null) lines.push('; the final 8 bytes loop back to the event at byte ' + enc.loopOffset + ' (the long is an absolute ROM address: relocate it).');
    lines.push((name || 'song_cmdstream').replace(/[^A-Za-z0-9_]/g, '_'));
    var b = enc.bytes;
    var hex = function (v) { return '$' + (v < 16 ? '0' : '') + v.toString(16).toUpperCase(); };
    var body = b.length - (enc.loopOffset != null ? 8 : 4);
    for (var i = 0; i < body; i += 4) {
      var st = b[i + 1];
      var kind = (st >> 4) & 7;
      var what = kind === 1 ? 'key on ch' + (st & 15) + ' note ' + b[i + 2] + ' vol ' + b[i + 3]
        : kind === 0 ? 'key off ch' + (st & 15) + ' note ' + b[i + 2]
          : kind === 4 ? 'patch ch' + (st & 15) + ' = ' + b[i + 2]
            : kind === 6 ? 'bend ch' + (st & 15) + ' ' + (((b[i + 2] << 8) | b[i + 3]) - 0x2000)
              : 'filler';
      lines.push('\tdc.b\t' + [b[i], b[i + 1], b[i + 2], b[i + 3]].map(hex).join(',') + '\t; ' + what);
    }
    if (enc.loopOffset != null) lines.push('\tdc.b\t' + Array.prototype.slice.call(b, body).map(hex).join(',') + '\t; end: loop');
    else lines.push('\tdc.b\t' + Array.prototype.slice.call(b, body).map(hex).join(',') + '\t; end');
    var table = Song.GAMES[song.game].table - 1024;
    Edits.asmLines(song.patchEdits, (name || 'song').replace(/[^A-Za-z0-9_]/g, '_'), function (id) {
      return 'ROM $' + (table + 32 * id).toString(16).toUpperCase();
    }).forEach(function (l) { lines.push(l); });
    return lines.join('\n') + '\n';
  }

  /** The stream's bytes (as encode(song, 0)), then a 'PTCH' block with the edited patches when there are any. */
  function toBinary(song) {
    var bytes = encode(song, 0).bytes;
    var tail = Edits.trailer(song.patchEdits);
    if (!tail.length) return bytes;
    var out = new Uint8Array(bytes.length + tail.length);
    out.set(bytes, 0);
    out.set(tail, bytes.length);
    return out;
  }

  // --- Model -> GM ---------------------------------------------------------------------------------------

  /** The model through the same stream -> GM conversion the retail songs use (so editing and listening agree). */
  function toGm(song, map, bank) {
    var enc = encode(song, Song.GAMES[song.game].start);
    // Edited patches stand in for the bank's (the bend range, byte $1E, comes from the patch).
    return Song.gmFromParsed(Edits.withEdits(bank, song.patchEdits), Song.parse(song.game, enc.bytes, Song.GAMES[song.game].start), map);
  }

  // --- GM -> model (MIDI import) -------------------------------------------------------------------------

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

  /** The patch a GM program is played with: a patch the map sends to that program, else the family's patch. */
  function patchForProgram(map, program) {
    var m = map.gmToNhl;
    if (m.programOverrides[String(program)] != null) return m.programOverrides[String(program)];
    var hit = map.patches.find(function (e) { return e.patch < 22 && e.target.kind === 'program' && e.target.program === program; });
    if (hit) return hit.patch;
    return m.families[program >> 3];
  }

  function drumFor(map, note) {
    var m = map.gmToNhl;
    var d = m.drums.find(function (x) { return x.notes.indexOf(note) >= 0; });
    return d || m.defaultDrum;
  }

  var scaleOfBank = function (bank, patch) { return patch >= 0x60 ? 12 : bank[patch] ? bank[patch][30] : 0; };

  /**
   * A (normalized) General MIDI song as a model. Programs become patches (patchForProgram), drums go to one channel
   * as FM or PCM hits, channels beyond eight are merged, chords are thinned to the driver's five FM voices, notes are
   * moved into octaves 1-7 and pitch bends are rescaled to the patch's range.
   * @returns {{song:object, report:string[]}}
   */
  function fromGm(gm, map, game, bank) {
    var report = [];
    var secs = secondsFn(gm);
    var toVbl = function (tick) { return Math.round(secs(tick) * Song.VBLANK_HZ); };
    // Channels: melodic MIDI channels by use, then the drum channel last.
    var use = {};
    gm.notes.forEach(function (n) { if (n.ch !== 9) use[n.ch] = (use[n.ch] || 0) + 1; });
    var melodic = Object.keys(use).map(Number).sort(function (a, b) { return use[b] - use[a]; });
    var hasDrums = gm.notes.some(function (n) { return n.ch === 9; });
    var slots = CHANNELS - (hasDrums ? 1 : 0);
    var chOf = {};
    melodic.forEach(function (c, i) { chOf[c] = i < slots ? i : i % slots; });
    if (melodic.length > slots) report.push(plural(melodic.length - slots, 'MIDI channel', 'MIDI channels') + ' merged into others (the driver keeps eight channels per song).');
    var drumCh = Math.min(slots, CHANNELS - 1);
    var notes = [];
    var clampedOct = 0;
    var drums = 0;
    gm.notes.slice().sort(function (a, b) { return a.tick - b.tick; }).forEach(function (n) {
      var t = toVbl(n.tick);
      var dur = Math.max(1, toVbl(n.tick + n.dur) - t);
      if (n.ch === 9) {
        var d = drumFor(map, n.pitch);
        notes.push({ t: t, dur: d.patch >= 0x60 ? 6 : 12, ch: drumCh, note: d.note, vel: n.vel, patch: d.patch, drum: true });
        drums++;
        return;
      }
      var pitch = n.pitch;
      while (pitch < NOTE_LO) { pitch += 12; clampedOct++; }
      while (pitch > NOTE_HI) { pitch -= 12; clampedOct++; }
      notes.push({ t: t, dur: dur, ch: chOf[n.ch], note: pitch, vel: n.vel, patch: patchForProgram(map, n.program == null ? 0 : n.program), src: n.ch });
    });
    if (clampedOct) report.push(plural(clampedOct, 'note', 'notes') + ' moved by whole octaves into the driver\'s range (notes 12-95).');
    // Same channel + same note must not overlap (the driver's key is channel + note).
    var byKey = {};
    notes.forEach(function (n) { (byKey[n.ch + ':' + n.note] = byKey[n.ch + ':' + n.note] || []).push(n); });
    var trimmed = 0;
    Object.keys(byKey).forEach(function (k) {
      var list = byKey[k].sort(function (a, b) { return a.t - b.t; });
      for (var i = 0; i + 1 < list.length; i++) {
        if (list[i].t + list[i].dur > list[i + 1].t) { list[i].dur = Math.max(1, list[i + 1].t - list[i].t); trimmed++; }
      }
    });
    if (trimmed) report.push(plural(trimmed, 'overlapping repeat of a note', 'overlapping repeats of a note') + ' cut short.');
    // Thin to five FM voices at a time: a note that would be the sixth is dropped (PCM hits have their own channel).
    var kept = [];
    var active = [];
    var dropped = 0;
    notes.sort(function (a, b) { return a.t - b.t || (b.vel - a.vel); });
    notes.forEach(function (n) {
      active = active.filter(function (a) { return a.t + a.dur > n.t; });
      if (n.patch >= 0x60) { kept.push(n); return; }
      if (active.length >= MAX_FM_VOICES) { dropped++; return; }
      active.push(n);
      kept.push(n);
    });
    if (dropped) report.push(plural(dropped, 'note', 'notes') + ' dropped to stay within five FM voices at a time (the driver steals the oldest voice otherwise).');
    // Bends: rescale from semitones to the stream's word using the channel's patch at that moment.
    var bends = [];
    var clampedBend = 0;
    var perCh = {};
    kept.forEach(function (n) { if (!n.drum) (perCh[n.ch] = perCh[n.ch] || []).push(n); });
    Object.keys(perCh).forEach(function (c) { perCh[c].sort(function (a, b) { return a.t - b.t; }); });
    var patchAt = function (c, t) {
      var l = perCh[c];
      if (!l) return null;
      var p = l[0].patch;
      for (var i = 0; i < l.length && l[i].t <= t; i++) p = l[i].patch;
      return p;
    };
    (gm.bends || []).forEach(function (b) {
      if (chOf[b.ch] == null) return;
      var c = chOf[b.ch];
      var t = toVbl(b.tick);
      var p = patchAt(c, t);
      if (p == null) return;
      var sc = scaleOfBank(bank, p);
      if (!sc) return;
      var v = Math.round((b.semis / sc) * 8192);
      if (v > 8191 || v < -8192) { clampedBend++; v = clamp(v, -8192, 8191); }
      var last = bends.length && bends.filter(function (x) { return x.ch === c; }).pop();
      if (last && last.t === t) last.value = v; else if (!last || last.value !== v) bends.push({ t: t, ch: c, value: v });
    });
    if (bends.length) report.push(plural(bends.length, 'pitch-bend move', 'pitch-bend moves') + ' kept, scaled to each patch\'s range (+-patch byte $1E semitones).');
    if (clampedBend) report.push(plural(clampedBend, 'bend', 'bends') + ' beyond the patch\'s range were clamped.');
    if (drums) report.push(plural(drums, 'drum hit', 'drum hits') + ' played by the FM thumps, noise burst and the PCM big-hit sample.');
    var ticks = kept.reduce(function (m, n) { return Math.max(m, n.t + n.dur); }, 0);
    var unit = 8;
    var song = { game: game, name: gm.name || 'import', ticks: Math.max(unit * 16, Math.ceil(ticks / (unit * 16)) * unit * 16), loopTick: null, unit: unit, notes: kept.map(function (n) { return { t: n.t, dur: n.dur, ch: n.ch, note: n.note, vel: n.vel, patch: n.patch }; }), bends: bends };
    report.unshift(plural(song.notes.length, 'note', 'notes') + ' on ' + plural(new Set(song.notes.map(function (n) { return n.ch; })).size, 'channel', 'channels') + ', ' + (song.ticks / Song.VBLANK_HZ).toFixed(1) + ' s.');
    return { song: song, report: report };
  }

  // --- Native MIDI: the song's own notes, patches and bends in marker events ---------------------------------
  // One MIDI tick is one vblank (60 ticks per quarter at 59.92 BPM), so times are exact. A track per channel; the
  // note's patch, and every pitch bend (raw value), ride in marker events `NHL c=<ch> p=<patch> | b=<value>`
  // (the same text format as lib/audio/nhl92-song-gm.js). A player hears the notes; reading the file back restores the song.

  var NATIVE_PPQ = 60;

  /** @returns smf.js song */
  function toSmfNative(song) {
    var tracks = [];
    for (var ch = 0; ch < CHANNELS; ch++) {
      var notes = song.notes.filter(function (n) { return n.ch === ch; }).sort(function (a, b) { return a.t - b.t || a.note - b.note; });
      var bends = song.bends.filter(function (b) { return b.ch === ch; });
      if (!notes.length && !bends.length) continue;
      var markers = [];
      var patch = null;
      notes.forEach(function (n) { if (n.patch !== patch) { markers.push({ tick: n.t, text: SongGm.markerText(ch, { p: n.patch }) }); patch = n.patch; } });
      bends.forEach(function (b) { markers.push({ tick: b.t, text: SongGm.markerText(ch, { b: Math.round(b.value) }) }); });
      var used = {};
      notes.forEach(function (n) { used[n.patch] = true; });
      tracks.push({
        name: 'CH' + (ch + 1) + ' (patch ' + Object.keys(used).join(', ') + ')', ch: ch, markers: markers,
        notes: notes.map(function (n) { return { tick: n.t, dur: n.dur, pitch: clamp(n.note, 0, 127), vel: clamp(n.vel, 1, 127) }; })
      });
    }
    return {
      ppq: NATIVE_PPQ, tempos: [{ tick: 0, bpm: Song.VBLANK_HZ }], name: song.name || undefined, tracks: tracks,
      markers: [{ tick: 0, text: 'NHL9X v1 game=' + song.game + ' ticks=' + song.ticks + ' loop=' + (song.loopTick == null ? '-' : song.loopTick) + ' unit=' + song.unit }]
        .concat(Edits.ids(song.patchEdits).map(function (id) { return { tick: 0, text: Edits.marker('NHL9X', id, song.patchEdits[id]) }; }))
    };
  }

  /** A file written by toSmfNative as a model, or null if it has no NHL9X header (an ordinary MIDI file). */
  function fromSmfNative(parsed) {
    var head = (parsed.markers || []).filter(function (m) { return /^NHL9X v1\b/.test(m.text); })[0];
    if (!head) return null;
    var num = function (k) { var m = new RegExp(k + '=(-?\\d+)').exec(head.text); return m ? Number(m[1]) : null; };
    var game = num('game') === 93 ? 93 : 94;
    var song = emptySong(game);
    song.ticks = Math.max(1, num('ticks') || 1);
    song.loopTick = num('loop');
    song.unit = num('unit') || 8;
    song.name = '';
    var k = NATIVE_PPQ / parsed.ppq; // ticks in the file -> vblanks (1 for our own files)
    var marks = {};
    (parsed.markers || []).forEach(function (m) {
      var x = SongGm.parseMarker(m.text);
      if (x) (marks[x.ch] = marks[x.ch] || []).push({ tick: m.tick, fields: x.fields });
    });
    var report = [];
    var dropped = 0;
    for (var ch = 0; ch < CHANNELS; ch++) {
      var ms = (marks[ch] || []).sort(function (a, b) { return a.tick - b.tick; });
      var notes = parsed.notes.filter(function (n) { return n.ch === ch; }).sort(function (a, b) { return a.tick - b.tick; });
      var patch = 0;
      var mi = 0;
      notes.forEach(function (n) {
        while (mi < ms.length && ms[mi].tick <= n.tick) {
          if (ms[mi].fields.p != null) patch = Number(ms[mi].fields.p);
          mi++;
        }
        if (n.pitch > 127) { dropped++; return; }
        song.notes.push({ t: Math.round(n.tick * k), dur: Math.max(1, Math.round(n.dur * k)), ch: ch, note: n.pitch, vel: clamp(n.vel == null ? 100 : n.vel, 1, 127), patch: patch });
      });
      ms.forEach(function (m) { if (m.fields.b != null) song.bends.push({ t: Math.round(m.tick * k), ch: ch, value: clamp(Number(m.fields.b), -8192, 8191) }); });
    }
    song.notes.sort(function (a, b) { return a.t - b.t || a.ch - b.ch || a.note - b.note; });
    song.bends.sort(function (a, b) { return a.t - b.t; });
    var edits = Edits.readMarkers('NHL9X', parsed.markers);
    if (edits) {
      song.patchEdits = edits;
      report.push('Edited instruments restored: ' + Edits.ids(edits).map(function (id) { return 'FM ' + id; }).join(', ') + '.');
    }
    report.push('Native NHL ' + game + ' file: ' + plural(song.notes.length, 'note', 'notes') + ', ' + plural(song.bends.length, 'pitch bend', 'pitch bends') + '; patches restored from the file\'s markers.');
    if (dropped) report.push(plural(dropped, 'note', 'notes') + ' dropped.');
    return { song: song, report: report };
  }

  return {
    CHANNELS: CHANNELS, MAX_FM_VOICES: MAX_FM_VOICES, NOTE_LO: NOTE_LO, NOTE_HI: NOTE_HI, CUSTOM_SONG: CUSTOM_SONG,
    emptySong: emptySong, fromStream: fromStream, encode: encode, romWithSong: romWithSong,
    toAsm: toAsm, toBinary: toBinary, toGm: toGm, fromGm: fromGm, toSmfNative: toSmfNative, fromSmfNative: fromSmfNative, patchForProgram: patchForProgram, drumFor: drumFor
  };
});
