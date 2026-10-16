/**
 * Standard MIDI File reader and writer (formats 0 and 1, PPQ timing).
 *
 *   parse(bytes)   -> { format, ppq, tempos, notes, programs, trackNames, warnings, endTick }
 *   write(song)    -> Uint8Array (format 1)
 *
 * Parsed notes are flat and paired: { tick, dur, ch, pitch, vel, track }. Parsed programs are
 * { tick, ch, program, track }. Tempos are { tick, bpm } (quarter-note BPM). Running status,
 * velocity-0 note-offs, sysex and unknown meta events are handled. SMPTE timing is refused.
 *
 * song for write(): { ppq, tempos:[{tick,bpm}], name?, tracks:[ { name, ch, notes:[
 *   { tick, dur, pitch, vel, program? } ] } ] }. A program change is written whenever a
 * melodic track's note program differs from the one in force. Channel 10 (index 9) is drums.
 *
 * UMD: Node and the browser.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92Smf = api;
})(typeof self !== 'undefined' ? self : this, function () {
  var u8 = function (b, i) { return b[i]; };
  var u16 = function (b, i) { return (b[i] << 8) | b[i + 1]; };
  var u32 = function (b, i) { return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; };
  var tag = function (b, i) { return String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]); };

  function readVlq(b, at, end) {
    var v = 0;
    for (var n = 0; n < 4; n++) {
      if (at >= end) throw new Error('MIDI: truncated variable-length number');
      var c = b[at++];
      v = (v << 7) | (c & 0x7f);
      if (!(c & 0x80)) return { value: v >>> 0, at: at };
    }
    throw new Error('MIDI: variable-length number longer than 4 bytes');
  }

  /** @param {Uint8Array|ArrayBuffer} input */
  function parse(input) {
    var b = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (b.length < 14 || tag(b, 0) !== 'MThd') throw new Error('Not a MIDI file (no MThd header)');
    var hlen = u32(b, 4);
    var format = u16(b, 8);
    var ntrks = u16(b, 10);
    var division = u16(b, 12);
    if (division & 0x8000) throw new Error('SMPTE time division is not supported');
    if (format > 1) throw new Error('MIDI format ' + format + ' (sequences of songs) is not supported');
    var ppq = division;
    if (!ppq) throw new Error('MIDI: zero ticks per quarter note');
    var warnings = [];
    var notes = [];
    var programs = [];
    var tempos = [];
    var trackNames = [];
    var endTick = 0;
    var at = 8 + hlen;
    var counts = { sysex: 0, bend: 0, controllers: 0, aftertouch: 0, bank: 0, unknownMeta: 0 };
    for (var t = 0; t < ntrks; t++) {
      if (at + 8 > b.length || tag(b, at) !== 'MTrk') { warnings.push('track ' + t + ' is missing or damaged; the rest of the file was ignored'); break; }
      var len = u32(b, at + 4);
      var end = Math.min(b.length, at + 8 + len);
      if (at + 8 + len > b.length) warnings.push('track ' + t + ' is cut short');
      var p = at + 8;
      var tick = 0;
      var status = 0;
      var open = new Map(); // ch*128+pitch -> [notes]
      var name = '';
      while (p < end) {
        var d = readVlq(b, p, end);
        tick += d.value;
        p = d.at;
        var s = b[p];
        if (s & 0x80) { status = s; p++; }
        else if (!status) throw new Error('MIDI: data byte without a status');
        if (status === 0xff) {
          var type = b[p++];
          var l = readVlq(b, p, end);
          p = l.at;
          var data = b.subarray(p, p + l.value);
          p += l.value;
          if (type === 0x2f) { endTick = Math.max(endTick, tick); break; }
          if (type === 0x51 && data.length === 3) {
            var us = (data[0] << 16) | (data[1] << 8) | data[2];
            if (us > 0) tempos.push({ tick: tick, bpm: 60000000 / us });
          } else if (type === 0x03 && !name) name = String.fromCharCode.apply(null, Array.from(data)).replace(/[^\x20-\x7e]/g, '');
          else if (type !== 0x58 && type !== 0x59 && type !== 0x01 && type !== 0x02 && type !== 0x04 && type !== 0x05 && type !== 0x06 && type !== 0x07 && type !== 0x20 && type !== 0x21 && type !== 0x54) counts.unknownMeta += 1;
          continue;
        }
        if (status === 0xf0 || status === 0xf7) {
          var sl = readVlq(b, p, end);
          var body = Array.from(b.subarray(sl.at, sl.at + sl.value)).join(',');
          p = sl.at + sl.value;
          if (body !== '126,127,9,1,247') counts.sysex += 1; // GM System On is what we mean to read
          continue;
        }
        var kind = status & 0xf0;
        var ch = status & 0x0f;
        if (kind === 0xc0 || kind === 0xd0) {
          var v1 = b[p++];
          if (kind === 0xc0) programs.push({ tick: tick, ch: ch, program: v1, track: t });
          else counts.aftertouch += 1;
          continue;
        }
        var a1 = b[p++];
        var a2 = b[p++];
        if (kind === 0x90 && a2 > 0) {
          var n = { tick: tick, dur: 0, ch: ch, pitch: a1, vel: a2, track: t, _open: true };
          notes.push(n);
          var key = ch * 128 + a1;
          if (!open.has(key)) open.set(key, []);
          open.get(key).push(n);
        } else if (kind === 0x80 || kind === 0x90) {
          var q = open.get(ch * 128 + a1);
          if (q && q.length) {
            var on = q.shift();
            on.dur = tick - on.tick;
            on._open = false;
          }
        } else if (kind === 0xe0) counts.bend += 1;
        else if (kind === 0xb0) {
          if (a1 === 0 || a1 === 32) counts.bank += 1;
          else counts.controllers += 1;
        } else if (kind === 0xa0) counts.aftertouch += 1;
      }
      endTick = Math.max(endTick, tick);
      notes.forEach(function (n) {
        if (n.track === t && n._open) { n.dur = Math.max(1, tick - n.tick); n._open = false; }
      });
      trackNames[t] = name;
      at = at + 8 + len;
    }
    notes.forEach(function (n) { delete n._open; });
    notes.sort(function (x, y) { return x.tick - y.tick || x.pitch - y.pitch; });
    tempos.sort(function (x, y) { return x.tick - y.tick; });
    if (!notes.length) warnings.push('the file has no notes');
    if (counts.sysex) warnings.push(counts.sysex + ' sysex messages ignored');
    if (counts.bend) warnings.push(counts.bend + ' pitch-bend events ignored');
    if (counts.controllers) warnings.push(counts.controllers + ' controller events ignored (volume, pan, modulation, sustain…)');
    if (counts.bank) warnings.push(counts.bank + ' bank-select events ignored (General MIDI has one bank)');
    return { format: format, ppq: ppq, tempos: tempos, notes: notes, programs: programs, trackNames: trackNames, warnings: warnings, endTick: endTick };
  }

  // --- Writer ---------------------------------------------------------------------------

  function vlq(n) {
    var out = [n & 0x7f];
    n = Math.floor(n / 128);
    while (n > 0) { out.unshift((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
    return out;
  }
  var be16 = function (n) { return [(n >> 8) & 0xff, n & 0xff]; };
  var be32 = function (n) { return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]; };
  var text = function (s) { return Array.from(s).map(function (c) { var k = c.charCodeAt(0); return k >= 0x20 && k < 0x7f ? k : 0x3f; }); };

  function chunk(id, bytes) {
    return text(id).concat(be32(bytes.length), bytes);
  }

  /** Events [{tick, order, bytes}] to a track body with delta times and an end-of-track. */
  function trackBody(events) {
    events.sort(function (a, b) { return a.tick - b.tick || a.order - b.order; });
    var out = [];
    var last = 0;
    events.forEach(function (e) {
      out = out.concat(vlq(e.tick - last), e.bytes);
      last = e.tick;
    });
    return out.concat(vlq(0), [0xff, 0x2f, 0x00]);
  }

  /** @param {{ppq:number, tempos?:Array, name?:string, tracks:Array}} song */
  function write(song) {
    var ppq = song.ppq || 480;
    var tempoEvents = [];
    var tempos = song.tempos && song.tempos.length ? song.tempos : [{ tick: 0, bpm: 120 }];
    tempos.forEach(function (t) {
      var us = Math.max(1, Math.round(60000000 / t.bpm));
      tempoEvents.push({ tick: Math.round(t.tick), order: 1, bytes: [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff] });
    });
    var meta = [];
    if (song.name) meta.push({ tick: 0, order: 0, bytes: [0xff, 0x03].concat(vlq(song.name.length), text(song.name)) });
    // General MIDI System On, so players reset to the GM sound set.
    meta.push({ tick: 0, order: 0, bytes: [0xf0, 0x05, 0x7e, 0x7f, 0x09, 0x01, 0xf7] });
    meta.push({ tick: 0, order: 2, bytes: [0xff, 0x58, 0x04, 4, 2, 24, 8] });
    var chunks = [chunk('MTrk', trackBody(meta.concat(tempoEvents)))];
    song.tracks.forEach(function (tr) {
      var ev = [];
      var ch = tr.ch & 0x0f;
      var drum = ch === 9;
      if (tr.name) ev.push({ tick: 0, order: 0, bytes: [0xff, 0x03].concat(vlq(tr.name.length), text(tr.name)) });
      var program = null;
      tr.notes.slice().sort(function (a, b) { return a.tick - b.tick; }).forEach(function (n) {
        var tick = Math.round(n.tick);
        var dur = Math.max(1, Math.round(n.dur));
        if (!drum && n.program != null && n.program !== program) {
          program = n.program;
          ev.push({ tick: tick, order: 2, bytes: [0xc0 | ch, program & 0x7f] });
        }
        var vel = Math.max(1, Math.min(127, Math.round(n.vel == null ? 100 : n.vel)));
        ev.push({ tick: tick, order: 4, bytes: [0x90 | ch, n.pitch & 0x7f, vel] });
        ev.push({ tick: tick + dur, order: 3, bytes: [0x80 | ch, n.pitch & 0x7f, 0] });
      });
      chunks.push(chunk('MTrk', trackBody(ev)));
    });
    var header = chunk('MThd', be16(1).concat(be16(chunks.length), be16(ppq)));
    var all = header;
    chunks.forEach(function (c) { all = all.concat(c); });
    return new Uint8Array(all);
  }

  return { parse: parse, write: write };
});
