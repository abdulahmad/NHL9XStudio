/**
 * NHLPA Hockey '93 (SNES) sound data: the SPC700 sound program's songs, sound effects, instruments and samples,
 * read from the upload streams in data/audio/nhl93s-sound.json (tools/extract-nhl93s-sound.js).
 *
 * The sound program is Nintendo's N-SPC sequencer; the rules below were read from its code (loaded at $0400) and are
 * checked against the program itself in test/nhl93s-sound-data.js (every key-on of every song, in the SPC700 core,
 * against the walk made here). Addresses are sound-RAM addresses.
 *
 *   Cues: the main CPU writes one byte to port 0 (and a changing counter to port 1). $01-$09 start a song,
 *     $80-$FE a sound effect ($80-$88 the crowd noise, $89-$A5 effects), $F8 re-enters the boot ROM for a new upload.
 *   Song cue c: the word at $0E91 + 2c points to an order list of words: a pointer to a set (eight channel pointers,
 *     $0000 = unused), $0000 = end, or a repeat marker $00nn followed by a jump target (taken nn times; $00FF is
 *     "forever" in practice).
 *   A set plays until its first channel reaches the end of its stream; the next order entry starts on that tick.
 *   Channel stream: duration byte (< $80, optionally followed by a quantize/velocity byte 0qqqvvvv), notes $80-$C7
 *     ($80 = MIDI 12, plus the global ($E9) and channel ($EA) transposes), $C8 tie, $C9 rest, $CA-$DF percussion
 *     (instrument = code - $CA + the $FA base), $E0-$FA commands, $00 ends a pattern. $EF = call(address, count).
 *   Ticks: the tempo byte T ($E7) gives 500 * T / 256 sequencer ticks per second.
 *
 *   const d = NhlNhl93sSoundData.load(pack);
 *   d.cueList                     [{ cue, name, set, song }]
 *   d.song(cue)                   { cue, name, set, entries: [{ type: 'set', at, ptrs } | { type: 'jump', ... } | { type: 'end' }] }
 *   d.timeline(cue, opts)         the song's notes and controls with absolute ticks (docs/NHL93S-SOUND.md)
 *   d.instruments                 the 29 instrument entries; d.samples(set) the sample directory with decoded BRR
 *   d.effect(id)                  a decoded sound effect program
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlNhl93sSoundData = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE = 0x0400;
  var TICKS_PER_SECOND_PER_TEMPO = 500 / 256; // timer 0 at 500 Hz; the tempo byte is added to an 8-bit accumulator
  var GATE_TABLE = [0x32, 0x65, 0x7f, 0x98, 0xb2, 0xcb, 0xe5, 0xff]; // $0E7B: quantize
  var VELOCITY_TABLE = [0x19, 0x32, 0x4c, 0x65, 0x72, 0x7f, 0x8c, 0x98, 0xa5, 0xb2, 0xbf, 0xcb, 0xd8, 0xe5, 0xf2, 0xfc]; // $0E83
  var PARAMS = [1, 1, 2, 3, 0, 1, 2, 1, 2, 1, 1, 3, 0, 1, 2, 3, 1, 3, 3, 0, 1, 3, 0, 3, 3, 3, 1]; // $0802: E0..FA
  var CMD = {
    INSTRUMENT: 0xe0, PAN: 0xe1, PAN_FADE: 0xe2, VIBRATO: 0xe3, VIBRATO_OFF: 0xe4, MASTER_VOLUME: 0xe5, MASTER_FADE: 0xe6,
    TEMPO: 0xe7, TEMPO_FADE: 0xe8, TRANSPOSE: 0xe9, CH_TRANSPOSE: 0xea, TREMOLO: 0xeb, TREMOLO_OFF: 0xec, VOLUME: 0xed,
    VOLUME_FADE: 0xee, CALL: 0xef, VIBRATO_FADE: 0xf0, PITCH_TO: 0xf1, PITCH_FROM: 0xf2, PITCH_OFF: 0xf3, TUNING: 0xf4,
    ECHO: 0xf5, ECHO_OFF: 0xf6, ECHO_PARAMS: 0xf7, ECHO_FADE: 0xf8, SLIDE: 0xf9, PERCUSSION: 0xfa
  };
  var CMD_NAMES = {};
  Object.keys(CMD).forEach(function (k) { CMD_NAMES[CMD[k]] = k.toLowerCase().replace(/_/g, ' '); });
  var MIDI_OFFSET = 12; // note $80 is C0 (MIDI 12): the single-cycle instruments are tuned so that $B0 (index 48) is middle C (docs/NHL93S-SOUND.md)

  function b64(s) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function load(pack) {
    var boot = pack.boot.blocks.map(function (b) { return { addr: b.addr, bytes: b64(b.data) }; });
    var game = pack.game.blocks.map(function (b) { return { addr: b.addr, bytes: b64(b.data) }; });
    var images = {};
    var d = { pack: pack, boot: boot, game: game, BASE: BASE };

    /** The 64 KB sound RAM after the boot upload ('boot') or the boot and then the in-game upload ('game'). */
    d.image = function (set) {
      if (images[set]) return images[set];
      var ram = new Uint8Array(0x10000);
      boot.forEach(function (b) { ram.set(b.bytes, b.addr); });
      if (set === 'game') game.forEach(function (b) { ram.set(b.bytes, b.addr); });
      images[set] = ram;
      return ram;
    };
    var bootRam = d.image('boot'); // the program and the tables are the same in both
    var ram = bootRam;
    var word = function (a) { return ram[a] | (ram[a + 1] << 8); };

    /** Run fn with another sound RAM image in place of the boot one (a custom song patched in); always restores. */
    function withRam(image, fn) {
      var saved = ram;
      ram = image || bootRam;
      try { return fn(); } finally { ram = saved; }
    }

    /** A copy of a set's sound RAM with `bytes` at `base` and the order-list pointer of song cue `cue` aimed at `base`. */
    d.customImage = function (set, bytes, base, cue) {
      var img = new Uint8Array(d.image(set));
      img.set(bytes, base);
      var at = 0x0e91 + 2 * (cue || 7);
      img[at] = base & 0xff;
      img[at + 1] = base >> 8;
      return img;
    };

    d.pitchTable = []; // $05C9: one octave of DSP pitch values, C to C
    for (var i = 0; i < 13; i++) d.pitchTable.push(word(0x05c9 + 2 * i));
    d.instruments = [];
    for (var n = 0; n < 29; n++) {
      var o = 0x2b00 + 6 * n;
      d.instruments.push({ index: n, sample: ram[o], adsr1: ram[o + 1], adsr2: ram[o + 2], gain: ram[o + 3], pitch: (ram[o + 4] << 8) | ram[o + 5] });
    }

    /** Last byte after a BRR stream (first block with the end flag), or `limit` if none. */
    function brrEndAfter(img, start, limit) {
      var p = start;
      while (p + 9 <= limit) {
        if (img[p] & 1) return p + 9;
        p += 9;
      }
      return limit;
    }

    /** Bytes between directory entries that are not part of the previous sample's BRR end block. */
    d.unreferencedBrrGaps = function (set) {
      var list = d.samples(set);
      var img = d.image(set);
      var count = set === 'game' ? 19 : 9;
      var base = set === 'game' ? 0x2c50 : 0x2c30;
      var poolEnd = base + (set === 'game' ? game[1].bytes.length : boot[3].bytes.length);
      var gaps = [];
      for (var k = 0; k < list.length; k++) {
        var nextStart = k + 1 < list.length ? list[k + 1].start : poolEnd;
        var after = list[k].end;
        if (after < nextStart) gaps.push({ set: set, from: after, to: nextStart, bytes: nextStart - after });
      }
      gaps.forEach(function (g) {
        var p = g.from;
        var blocks = 0;
        var valid = true;
        while (p + 9 <= g.to) {
          blocks += 1;
          if (img[p] & 1) { p += 9; break; }
          p += 9;
        }
        g.brrBlocks = blocks;
        g.validBrr = valid && blocks > 0 && p <= g.to;
      });
      return gaps;
    };

    /** The sample directory and BRR data of a set (each sample ends at its BRR end flag, not the next directory entry). */
    d.samples = function (set) {
      var img = d.image(set);
      var count = set === 'game' ? 19 : 9;
      var base = set === 'game' ? 0x2c50 : 0x2c30;
      var poolEnd = base + (set === 'game' ? game[1].bytes.length : boot[3].bytes.length);
      var dir = [];
      for (var s = 0; s < count; s++) dir.push({ index: s, start: img[0x2c00 + 4 * s] | (img[0x2c01 + 4 * s] << 8), loop: img[0x2c02 + 4 * s] | (img[0x2c03 + 4 * s] << 8) });
      dir.forEach(function (e, k) {
        var nextDir = k + 1 < dir.length ? dir[k + 1].start : poolEnd;
        var end = brrEndAfter(img, e.start, poolEnd);
        if (end > nextDir) end = nextDir;
        e.end = end;
        e.length = end - e.start;
        e.loops = e.loop >= e.start && e.loop < end;
        e.brr = img.subarray(e.start, end);
      });
      return dir;
    };

    // ---- cues ----
    d.cueList = pack.cues.map(function (c) { return { cue: c.cue, name: c.name, set: c.set, song: c.song, note: c.note }; });
    var cueInfo = function (c) { return d.cueList.filter(function (x) { return x.cue === c; })[0]; };

    /** The order list of a song cue, decoded. */
    d.song = function (cue) {
      var info = cueInfo(cue) || { name: 'Song ' + cue, set: 'boot' };
      if (!cueInfo(cue) && cue !== 7) throw new Error('no song cue ' + cue);
      var at = word(0x0e91 + 2 * cue);
      var entries = [];
      var seen = {};
      var p = at;
      for (;;) {
        var w = word(p);
        var e = { at: p };
        p += 2;
        if (w === 0) { e.type = 'end'; entries.push(e); break; }
        if (w < 0x100) {
          e.type = 'jump';
          e.count = w;
          e.target = word(p);
          p += 2;
          entries.push(e);
          if (seen[e.at]) break;
          seen[e.at] = true;
          continue; // the walk decides whether the jump is taken
        }
        e.type = 'set';
        e.set = w;
        e.ptrs = [];
        for (var c = 0; c < 8; c++) e.ptrs.push(word(w + 2 * c));
        entries.push(e);
        if (entries.length > 64) break;
      }
      return { cue: cue, name: info.name, set: info.set, order: at, entries: entries };
    };

    /** Statically decode one channel stream from `ptr` up to its end byte or a call: [{ at, code, params }]. */
    d.stream = function (ptr, limit) {
      var out = [];
      var p = ptr;
      var max = limit || 4096;
      while (out.length < max) {
        var b = ram[p];
        var ev = { at: p, code: b, params: [] };
        p++;
        if (b === 0) { ev.type = 'end'; out.push(ev); break; }
        if (b < 0x80) {
          ev.type = 'duration';
          ev.duration = b;
          if (ram[p] < 0x80) { ev.quant = ram[p]; p++; }
        } else if (b < 0xc8) ev.type = 'note';
        else if (b === 0xc8) ev.type = 'tie';
        else if (b === 0xc9) ev.type = 'rest';
        else if (b < 0xe0) ev.type = 'percussion';
        else if (b <= 0xfa) {
          ev.type = 'command';
          ev.name = CMD_NAMES[b];
          for (var k = 0; k < PARAMS[b - 0xe0]; k++) ev.params.push(ram[p++]);
        } else { ev.type = 'invalid'; }
        ev.length = p - ev.at;
        out.push(ev);
        if (ev.type === 'invalid') break;
      }
      return out;
    };

    /**
     * Walk a song's order list, the way the program's sequencer does, into absolute ticks.
     *   opts.loops      how many times to take a repeat marker's jump (default 1; the marker's own count caps it)
     *   opts.maxTicks   stop after this many ticks (default 60000)
     * Returns { events, sets, ticks, loopTick } where events are
     *   { tick, ch, type: 'note'|'tie'|'rest'|'percussion', code, key, midi, instrument, duration, gate, velocity, volume, pan, length? }
     *   { tick, ch, type: 'command', code, name, params }
     * `length` (on notes) is the sounding length in ticks (ties added, gate applied); `sets` the start tick of each set.
     */
    d.timeline = function (cue, opts) {
      opts = opts || {};
      if (opts.ram) return withRam(opts.ram, function () { return d.timeline(cue, Object.assign({}, opts, { ram: null })); });
      var maxLoops = opts.loops == null ? 1 : opts.loops;
      var maxTicks = opts.maxTicks || 60000;
      var song = d.song(cue);
      var entries = song.entries;
      var events = [];
      var sets = [];
      var tick = 0;
      var persistent = [];
      for (var c = 0; c < 8; c++) persistent.push({ instrument: 0, volume: 0xff, pan: 0x0a, transpose: 0, tuning: 0, percBase: 0 });
      var global = { transpose: 0, tempo: 0, master: 0, tempoEvents: [] };
      var counter = 0; // $1e
      var idx = 0;
      var taken = {};
      var looped = false;
      var loopEntry = null;
      var guard = 0;
      while (idx < entries.length && tick < maxTicks && guard++ < 400) {
        var e = entries[idx];
        if (e.type === 'end') break;
        if (e.type === 'jump') {
          counter = (counter - 1) & 0xff;
          if (counter & 0x80) counter = e.count;
          var ti = entries.findIndex(function (x) { return x.at === e.target; });
          if (counter !== 0 && ti >= 0) {
            taken[e.at] = (taken[e.at] || 0) + 1;
            if (loopEntry == null) loopEntry = ti;
            if (e.count > 16 && taken[e.at] > maxLoops) { looped = true; break; }
            idx = ti;
          } else idx++;
          continue;
        }
        sets.push({ tick: tick, at: e.at, set: e.set, entry: idx });
        tick = walkSet(e.ptrs, tick, persistent, global, events, maxTicks).end;
        idx++;
      }
      var loopSet = loopEntry == null ? null : sets.filter(function (x) { return x.entry === loopEntry; })[0];
      return { cue: cue, events: events, sets: sets, ticks: tick, loopTick: loopSet ? loopSet.tick : null, looped: looped, song: song, tempo: global.tempo, tempoTrack: tempoTrack(global.tempoEvents, tick) };
    };


    /**
     * The tempo byte in force at every tick, as a list of changes [{ tick, tempo }]: sets take effect at once, a fade ($E8)
     * moves the byte in equal steps over its ticks (the program adds a 16-bit step each tick).
     */
    function tempoTrack(evs, total) {
      var sorted = evs.slice().sort(function (a, b) { return a.tick - b.tick || a.ch - b.ch; });
      var out = [];
      var cur = 0;
      var fade = null;
      var at = 0;
      var emit = function (tick, tempo) {
        var last = out[out.length - 1];
        if (last && last.tick === tick) last.tempo = tempo;
        else if (!last || last.tempo !== tempo) out.push({ tick: tick, tempo: tempo });
      };
      sorted.forEach(function (e) {
        // run an active fade up to this event
        if (fade) {
          var upTo = Math.min(e.tick, fade.end);
          for (var t = at + 1; t <= upTo; t++) emit(t, Math.round(fade.from + (fade.to - fade.from) * (t - fade.start) / fade.ticks));
          if (e.tick >= fade.end) fade = null;
        }
        if (e.kind === 'set') { cur = e.tempo; emit(e.tick, cur); fade = null; }
        else { fade = { start: e.tick, end: e.tick + (e.ticks || 256), ticks: e.ticks || 256, from: cur, to: e.tempo }; if (fade.ticks) cur = e.tempo; }
        at = e.tick;
      });
      if (fade) for (var t2 = at + 1; t2 <= Math.min(total, fade.end); t2++) emit(t2, Math.round(fade.from + (fade.to - fade.from) * (t2 - fade.start) / fade.ticks));
      return out;
    }

    /** Seconds from the start for a tick, given a tempoTrack. */
    d.secondsAt = function (track, tick) {
      var sec = 0;
      var t = 0;
      var tempo = 0;
      var i = 0;
      while (t < tick) {
        while (i < track.length && track[i].tick <= t) tempo = track[i++].tempo;
        var next = i < track.length ? Math.min(track[i].tick, tick) : tick;
        if (tempo) sec += (next - t) * 256 / (500 * tempo);
        t = next;
      }
      return sec;
    };

    function walkSet(ptrs, t0, persistent, global, events, maxTicks) {
      var chs = ptrs.map(function (p, i) {
        return p ? { ch: i, pc: p, wait: 1, dur: 0, gate: 0, q: 0, v: 0, vel: 0xfc, callCount: 0, callStart: 0, callRet: 0, st: persistent[i], ending: 0, pending: null } : null;
      });
      var t = 0;
      var cutoff = null;
      for (; t < maxTicks; t++) {
        for (var i = 0; i < 8; i++) {
          var c = chs[i];
          if (!c) continue;
          c.wait = (c.wait - 1) & 0xff;
          if (c.wait !== 0) {
            stepGate(c);
            continue;
          }
          for (;;) {
            var b = ram[c.pc++];
            if (b === 0) {
              if (c.callCount === 0) { cutoff = i; break; }
              c.pc = c.callStart;
              c.callCount = (c.callCount - 1) & 0xff;
              if (c.callCount === 0) c.pc = c.callRet;
              continue;
            }
            if (b < 0x80) {
              c.dur = b;
              if (ram[c.pc] < 0x80) {
                var q = ram[c.pc++];
                c.q = GATE_TABLE[(q >> 4) & 7];
                c.vel = VELOCITY_TABLE[q & 15];
                c.quant = q;
              }
              continue;
            }
            if (b >= 0xe0) {
              if (b > 0xfa) { cutoff = i; break; }
              var np = PARAMS[b - 0xe0];
              var params = [];
              for (var k = 0; k < np; k++) params.push(ram[c.pc++]);
              command(c, b, params, t0 + t, events, global);
              continue;
            }
            note(c, b, t0 + t, events, global);
            break;
          }
          if (cutoff != null) break;
        }
        if (cutoff != null) break;
      }
      // notes that started on the cutoff tick in earlier channels are replaced at once: drop them
      var end = t0 + t;
      for (var j = events.length - 1; j >= 0 && events[j].tick >= end; j--) {
        if (events[j].type !== 'command' && events[j].tick === end) events.splice(j, 1);
      }
      // close notes still sounding at the end of the set
      chs.forEach(function (c2) {
        if (c2 && c2.open) { closeOpen(c2, end, true); }
      });
      return { end: end };
    }

    function note(c, b, tick, events, global) {
      var st = c.st;
      var type = b === 0xc8 ? 'tie' : b === 0xc9 ? 'rest' : b >= 0xca ? 'percussion' : 'note';
      var ev = { tick: tick, ch: c.ch, type: type, code: b, duration: c.dur, quant: c.quant == null ? null : c.quant, volume: st.volume, pan: st.pan };
      if (b >= 0xca) { st.instrument = b - 0xca + st.percBase; ev.percussion = b - 0xca; }
      if (type === 'note' || type === 'percussion') {
        var key = (type === 'percussion' ? 0xa4 : b) & 0x7f;
        key = (key + global.transpose + st.transpose) & 0xff;
        ev.key = key;
        ev.midi = key + MIDI_OFFSET;
        ev.instrument = st.instrument;
        ev.velocity = c.vel;
      }
      var g = (c.dur * c.q) >> 8;
      if (g === 0) g = 1;
      ev.gate = g;
      c.wait = c.dur;
      c.gate = g;
      c.gateTicks = g;
      if (type === 'tie' && c.open) {
        c.open.length += c.dur;
        c.open.ties = (c.open.ties || 0) + 1;
        c.open.sustain = c.dur;
        c.open.lastGate = g;
        c.open.lastDur = c.dur;
        c.open.lastTick = tick;
        ev.of = c.open;
      } else {
        if (c.open) closeOpen(c, tick, false);
        if (type === 'note' || type === 'percussion') {
          ev.length = 0;
          ev.lastTick = tick;
          ev.lastGate = g;
          ev.lastDur = c.dur;
          ev.length = c.dur;
          c.open = ev;
        } else c.open = null;
      }
      events.push(ev);
    }

    // The sounding length of a note: until the key-off the sequencer gives it (stepGate), ties extending it.
    function closeOpen(c, tick, setEnd) {
      var ev = c.open;
      if (!ev) return;
      var last = ev.lastDur;
      var off = last >= 3 ? Math.min(ev.lastGate, last - 2) : Math.min(ev.lastGate, last);
      if (off < 1) off = 1;
      // length: all but the last segment in full, then the key-off point of the last one
      ev.length = (ev.lastTick - ev.tick) + off;
      if (setEnd && tick - ev.tick < ev.length) ev.length = tick - ev.tick;
      c.open = null;
    }

    function stepGate(c) {
      // keep the model simple: lengths are computed when the note closes
    }

    function command(c, b, p, tick, events, global) {
      var st = c.st;
      var ev = { tick: tick, ch: c.ch, type: 'command', code: b, name: CMD_NAMES[b], params: p };
      switch (b) {
        case CMD.INSTRUMENT: st.instrument = p[0]; break;
        case CMD.PAN: st.pan = p[0]; break;
        case CMD.VOLUME: st.volume = p[0]; break;
        case CMD.CH_TRANSPOSE: st.transpose = (p[0] << 24) >> 24; break;
        case CMD.TRANSPOSE: global.transpose = (p[0] << 24) >> 24; break;
        case CMD.TEMPO: global.tempo = p[0]; global.tempoEvents.push({ tick: tick, ch: c.ch, kind: 'set', tempo: p[0] }); break;
        case CMD.TEMPO_FADE: global.tempoEvents.push({ tick: tick, ch: c.ch, kind: 'fade', ticks: p[0], tempo: p[1] }); break;
        case CMD.TUNING: st.tuning = p[0]; break;
        case CMD.PERCUSSION: st.percBase = p[0]; break;
        case CMD.CALL:
          c.callRet = c.pc;
          c.callStart = p[0] | (p[1] << 8);
          c.callCount = p[2];
          c.pc = c.callStart;
          if (c.callCount === 0) { /* a count of 0 is 256 passes in the program: DEC wraps */ c.callCount = 0; }
          break;
        default: break;
      }
      events.push(ev);
    }


    /**
     * A sound effect ($80-$A1) decoded from its program (cue handler at $0D58): a list of steps
     *   { type: 'instrument', instrument, volume }  start a note on the instrument ($80)
     *   { type: 'repeat', count }                    repeat the next sweep this many more times ($81)
     *   { type: 'sweep', ticks, pitch, delta }       hold the DSP pitch word, adding delta each tick (62.5 per second) ($82)
     *   { type: 'end' } ($83) | { type: 'loop' } ($84, back to the start: the crowd noise)
     * `voice` is the DSP voice the effect plays on (the table at $2900; a negative entry picks a free one).
     */
    d.effect = function (id) {
      var n = id & 0x7f;
      if (n < 1 || n > 0x21) return null;
      var p = word(0x28bb + 2 * n);
      var voiceByte = ram[0x28ff + n];
      var steps = [];
      for (var guard = 0; guard < 40; guard++) {
        var b = ram[p];
        if (b === 0x80) { steps.push({ type: 'instrument', instrument: ram[p + 1], volume: ram[p + 2] }); p += 3; }
        else if (b === 0x81) { steps.push({ type: 'repeat', count: ram[p + 1] }); p += 2; }
        else if (b === 0x82) { steps.push({ type: 'sweep', ticks: ram[p + 1], pitch: ram[p + 2] | (ram[p + 3] << 8), delta: (ram[p + 4] | (ram[p + 5] << 8)) << 16 >> 16 }); p += 6; }
        else if (b === 0x83) { steps.push({ type: 'end' }); break; }
        else if (b === 0x84) { steps.push({ type: 'loop' }); break; }
        else break;
      }
      return { id: id, address: word(0x28bb + 2 * n), voice: voiceByte & 0x80 ? null : voiceByte >> 1, steps: steps, loops: steps.some(function (s) { return s.type === 'loop'; }) };
    };
    /** Names the game's source gives the effect numbers (extract-nhl93s-sound.js). */
    d.effectName = function (id) {
      if (id >= 0x81 && id <= 0x87) return 'crowd' + (id - 0x80);
      if (id === 0x88) return 'crowdoff';
      var f = (pack.sfx || []).filter(function (x) { return x.id === id; })[0];
      return f ? f.names.map(function (x) { return x.name; }).join(' / ') : null;
    };
    d.effectIds = [];
    for (var eid = 0x81; eid <= 0xa1; eid++) d.effectIds.push(eid);

    return d;
  }

  return {
    load: load, BASE: BASE, CMD: CMD, CMD_NAMES: CMD_NAMES, PARAMS: PARAMS, GATE_TABLE: GATE_TABLE, VELOCITY_TABLE: VELOCITY_TABLE,
    TICKS_PER_SECOND_PER_TEMPO: TICKS_PER_SECOND_PER_TEMPO, MIDI_OFFSET: MIDI_OFFSET
  };
});
