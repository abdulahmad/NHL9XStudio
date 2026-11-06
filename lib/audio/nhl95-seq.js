/**
 * NHL 95 (Genesis) songs: the song table, the sequence format, an encoder and the ROM copy that plays an
 * edited song on the retail driver (sound95.asm in NHL95Genesis).
 *
 * Song table: the songs are bank items of type 3 in SoundBanks ($D8EC): a word item count, then 4 bytes per
 * item (type, id, size word), then the items back to back in that order (SndFindBankItem). Songs 0-3 are the
 * title / menu songs (StartSong), $32-$55 the team and arena songs (sfxplay); the sound effects are songs too
 * (SfxTable gives the song id of each effect).
 *
 * Sequence (SndStartSeq / SndUpdate): a word N, N word loop markers (offsets from the data after the table),
 * then delay, event, delay, event ... The first delay is skipped. A delay is 1 byte, or 2 when bit 7 of the
 * first is set ((b & $7F) << 7 | next). An event starts with a status byte (bit 7 set) or reuses the last one
 * (running status). Status $9c: key, velocity, length (1 or 2 bytes like a delay; the driver keys the note off
 * after length ticks). $Bc: controller, value (controller $75 jumps to marker [value] and runs on at once).
 * $Cc: program. $Ec: pitch bend byte. $FF: end. Other statuses have no data. Ticks are vblanks at the retail
 * tempo $100.
 *
 * Model (like nhl9x-stream.js, times in vblanks): { game: 95, name, ticks, loopTick: null|number,
 *   notes: [{ t, dur, ch, note, vel }], controllers: [{ t, ch, ctl, val }], programs: [{ t, ch, program }],
 *   bends: [{ t, ch, value }] }   ch 0-15, bend value is the raw byte; o (optional) = place in the retail stream.
 * Nothing here changes the driver or the retail data: romWithSong works on a copy.
 * UMD: Node and the browser.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl95Seq = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SOUND_BANKS = 0xd8ec;
  var TYPE_SONG = 3;
  var HIDDEN_TYPE = 0xfe; // the retail item a ROM copy replaces gets a type no lookup asks for
  var MAX_VAR = 0x3fff;

  /** Bank items of the bank at `bank` in the ROM image `rom` (indexed by ROM address). */
  function items(rom, bank) {
    bank = bank == null ? SOUND_BANKS : bank;
    var n = (rom[bank] << 8) | rom[bank + 1];
    var at = bank + 2 + 4 * n;
    var out = [];
    for (var i = 0; i < n; i++) {
      var d = bank + 2 + 4 * i;
      var it = { type: rom[d], id: rom[d + 1], size: (rom[d + 2] << 8) | rom[d + 3], addr: at, desc: d };
      out.push(it);
      at += it.size;
    }
    return out;
  }

  function songs(rom, bank) {
    return items(rom, bank).filter(function (i) { return i.type === TYPE_SONG; });
  }

  function songBytes(rom, id, bank) {
    var s = songs(rom, bank).filter(function (i) { return i.id === id; })[0];
    if (!s) throw new Error('NHL 95: no song $' + id.toString(16));
    return rom.slice(s.addr, s.addr + s.size);
  }

  /** Sequence bytes -> markers and events (every byte kept, so encodeRaw gives the same bytes back). */
  function parse(d) {
    var n = (d[0] << 8) | d[1];
    var base = 2 + 2 * n;
    var markers = [];
    for (var i = 0; i < n; i++) markers.push((d[2 + 2 * i] << 8) | d[3 + 2 * i]);
    var p = base;
    var vl = function () {
      var s = p;
      var b = d[p++];
      if (b & 0x80) b = ((b & 0x7f) << 7) | d[p++];
      return { v: b, n: p - s };
    };
    var events = [];
    var first = vl();
    var t = 0;
    var st = 0;
    var lead = first;
    var loopTick = null;
    var end = 'end';
    var at = {}; // byte offset of each delay -> tick (for the loop markers)
    at[base] = 0;
    for (;;) {
      if (p >= d.length) { end = 'overrun'; break; }
      var e = { t: t, delay: lead.v, delayBytes: lead.n, pos: p };
      if (d[p] & 0x80) { st = d[p++]; e.running = false; } else e.running = true;
      e.status = st;
      var hi = st & 0xf0;
      e.ch = st & 15;
      if (st === 0xff) { e.kind = 'end'; events.push(e); break; }
      if (hi === 0x90) {
        e.kind = 'note'; e.note = d[p]; e.vel = d[p + 1]; p += 2;
        var l = vl(); e.len = l.v; e.lenBytes = l.n;
      } else if (hi === 0xb0) {
        e.kind = d[p] === 0x75 ? 'loop' : 'ctl'; e.ctl = d[p]; e.val = d[p + 1]; p += 2;
      } else if (hi === 0xc0) { e.kind = 'program'; e.program = d[p++]; }
      else if (hi === 0xe0) { e.kind = 'bend'; e.value = d[p++]; }
      else e.kind = 'nop';
      events.push(e);
      if (e.kind === 'loop') {
        loopTick = { marker: e.val, from: t };
        end = 'loop';
        var dp = p;
        lead = vl();
        at[dp] = t;
        e.after = lead; // bytes after a loop event are never reached, but they are kept
        // A loop jumps at once and the delay at the marker is skipped: stop the timeline here.
        events.push({ kind: 'tail', bytes: Array.prototype.slice.call(d, p) });
        p = d.length;
        break;
      }
      var dpos = p;
      lead = vl();
      t += lead.v;
      at[dpos] = t;
    }
    var loopAt = null;
    if (loopTick) {
      var off = base + markers[loopTick.marker];
      loopAt = at[off] != null ? at[off] : null;
    }
    var ticks = 0;
    events.forEach(function (e) {
      if (e.t != null) ticks = Math.max(ticks, e.t + (e.kind === 'note' ? e.len : 0));
      if (e.kind === 'loop' || e.kind === 'end') ticks = Math.max(ticks, e.t);
    });
    return { markers: markers, first: first, events: events, end: end, loopTick: loopAt, loopFrom: loopTick ? loopTick.from : null, ticks: ticks, size: d.length };
  }

  function pushVar(out, v, n) {
    if (v > MAX_VAR) throw new RangeError('NHL 95: value over $3FFF: ' + v);
    if (n === 2 || v > 0x7f) out.push(0x80 | (v >> 7), v & 0x7f);
    else out.push(v);
  }

  /** parse() -> the same bytes. */
  function encodeRaw(r) {
    var out = [(r.markers.length >> 8) & 0xff, r.markers.length & 0xff];
    r.markers.forEach(function (m) { out.push((m >> 8) & 0xff, m & 0xff); });
    pushVar(out, r.first.v, r.first.n);
    for (var i = 0; i < r.events.length; i++) {
      var e = r.events[i];
      if (e.kind === 'tail') { out.push.apply(out, e.bytes); break; }
      if (i > 0) pushVar(out, e.delay, e.delayBytes);
      if (!e.running) out.push(e.status);
      if (e.kind === 'note') { out.push(e.note, e.vel); pushVar(out, e.len, e.lenBytes); }
      else if (e.kind === 'ctl' || e.kind === 'loop') out.push(e.ctl, e.val);
      else if (e.kind === 'program') out.push(e.program);
      else if (e.kind === 'bend') out.push(e.value);
      if (e.kind === 'loop') { pushVar(out, e.after.v, e.after.n); }
    }
    return Uint8Array.from(out);
  }

  /** Sequence bytes -> model. */
  function fromBytes(d, name) {
    var r = parse(d);
    var m = { game: 95, name: name || 'song', ticks: Math.max(1, r.end === 'loop' ? r.loopFrom : r.ticks), loopTick: r.loopTick, notes: [], controllers: [], programs: [], bends: [] };
    // o = the event's place in the stream: encode keeps the retail order of events within a tick.
    r.events.forEach(function (e, o) {
      if (e.kind === 'note') m.notes.push({ t: e.t, dur: e.len, ch: e.ch, note: e.note, vel: e.vel, o: o });
      else if (e.kind === 'ctl') m.controllers.push({ t: e.t, ch: e.ch, ctl: e.ctl, val: e.val, o: o });
      else if (e.kind === 'program') m.programs.push({ t: e.t, ch: e.ch, program: e.program, o: o });
      else if (e.kind === 'bend') m.bends.push({ t: e.t, ch: e.ch, value: e.value, o: o });
    });
    return m;
  }

  function fromRom(rom, id, bank) {
    return fromBytes(songBytes(rom, id, bank), 'song-' + id.toString(16));
  }

  /**
   * Model -> sequence bytes. Within a tick the driver runs events in stream order: events read from a retail
   * song keep their order (o), new ones put programs, controllers and bends before the notes. A loop song gets
   * marker 0 at loopTick (a no-data $A0 event there, because the delay at a marker is skipped) and a
   * controller $75 at the end.
   */
  function encode(m) {
    var ev = [];
    var order = { program: 0, ctl: 1, bend: 2, note: 3 };
    (m.programs || []).forEach(function (e) { ev.push({ t: e.t, o: e.o, k: 'program', st: 0xc0 | e.ch, data: [e.program & 0x7f] }); });
    (m.controllers || []).forEach(function (e) { if (e.ctl !== 0x75) ev.push({ t: e.t, o: e.o, k: 'ctl', st: 0xb0 | e.ch, data: [e.ctl & 0x7f, e.val & 0x7f] }); });
    (m.bends || []).forEach(function (e) { ev.push({ t: e.t, o: e.o, k: 'bend', st: 0xe0 | e.ch, data: [e.value & 0x7f] }); });
    (m.notes || []).forEach(function (e) {
      var len = Math.max(1, Math.min(MAX_VAR, Math.round(e.dur)));
      ev.push({ t: e.t, o: e.o, k: 'note', st: 0x90 | e.ch, data: [e.note & 0x7f, Math.max(1, e.vel) & 0x7f], len: len });
    });
    ev.forEach(function (e, i) { e.i = i; e.t = Math.max(0, Math.round(e.t)); });
    var loop = m.loopTick != null && m.loopTick < m.ticks;
    if (loop) ev.push({ t: m.loopTick, k: 'mark', st: 0xa0, data: [], i: -1 });
    var rank = function (a, b) { return a.o != null && b.o != null ? a.o - b.o : order[a.k] - order[b.k] || a.i - b.i; };
    ev.sort(function (a, b) { return a.t - b.t || (a.k === 'mark' ? -1 : b.k === 'mark' ? 1 : rank(a, b)); });
    var end = Math.max(m.ticks || 0, ev.length ? ev[ev.length - 1].t : 0);
    var body = [];
    var markerOff = 0;
    var t = 0;
    var st = -1;
    var gap = function (to) {
      var d = to - t;
      while (d > MAX_VAR) { pushVar(body, MAX_VAR); body.push(0xa0); st = 0xa0; d -= MAX_VAR; }
      pushVar(body, d);
      t = to;
    };
    // Returns the offset of the delay right before the next event (a loop marker points at it).
    var first = true;
    var delayTo = function (to) {
      if (first) {
        first = false;
        if (to === 0) { pushVar(body, 0); return 0; }
        pushVar(body, 0); // the first delay is skipped: start with a no-data event at tick 0
        body.push(0xa0);
        st = 0xa0;
      }
      var pos = body.length;
      gap(to);
      return pos;
    };
    ev.forEach(function (e) {
      var pos = delayTo(e.t);
      if (e.k === 'mark') { markerOff = pos; body.push(0xa0); st = 0xa0; return; }
      if (e.st !== st) { body.push(e.st); st = e.st; }
      body.push.apply(body, e.data);
      if (e.k === 'note') pushVar(body, e.len);
    });
    delayTo(end);
    if (loop) { body.push(0xb0, 0x75, 0x00); pushVar(body, 0); }
    body.push(0xff);
    var head = loop ? [0, 1, (markerOff >> 8) & 0xff, markerOff & 0xff] : [0, 0];
    return Uint8Array.from(head.concat(body));
  }

  /**
   * A copy of the ROM image where song `id` is `bytes` (or the encoded model). The copy keeps bank 0 as it is
   * except the type byte of the retail item (so SndFindBankItem skips it) and adds bank 1 after the image:
   * one item, the new song. Play it on nhl95-68k-harness.js with { banks: [{ n: 1, addr: bank }] }.
   */
  function romWithSong(rom, songOrBytes, id) {
    var bytes = songOrBytes instanceof Uint8Array ? songOrBytes : encode(songOrBytes);
    if (bytes.length > 0xffff) throw new RangeError('NHL 95: song over 64 KB');
    id = id == null ? 0x32 : id;
    var bank = (rom.length + 0xff) & ~0xff;
    var copy = new Uint8Array(bank + 6 + bytes.length);
    copy.set(rom);
    songs(rom).forEach(function (s) { if (s.id === id) copy[s.desc] = HIDDEN_TYPE; });
    copy.set([0, 1, TYPE_SONG, id, (bytes.length >> 8) & 0xff, bytes.length & 0xff], bank);
    copy.set(bytes, bank + 6);
    return { rom: copy, id: id, bank: bank, bytes: bytes, banks: [{ n: 1, addr: bank }] };
  }

  return { SOUND_BANKS: SOUND_BANKS, items: items, songs: songs, songBytes: songBytes, parse: parse, encodeRaw: encodeRaw, fromBytes: fromBytes, fromRom: fromRom, encode: encode, romWithSong: romWithSong };
});
