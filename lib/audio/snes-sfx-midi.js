/**
 * Sound effects of the two SNES games as Standard MIDI files, read from the real thing: the effect is played through the
 * game's own SPC700 program and every S-DSP voice write is logged (key on / key off, pitch, volume, sample number). Each
 * DSP voice becomes a MIDI track, each key-on a note, pitch changes during the note become pitch bends.
 *
 *   exportEffect93(data, gmMap, cue)      cue $81-$A1 (NHLPA '93)       -> Uint8Array (.mid)
 *   exportEffect94(data, gmMap, set, n)   sound entry n of 'menu'/'game' (NHL '94)
 *   capture(spc, step, opts)              the voice log itself: [{ voice, srcn, t0, t1, volume, pitch0, pitches:[{t,pitch}] }]
 *
 * Pitch: DSP pitch $1000 plays the sample at its recorded rate. A probe note (MIDI 60) on the same instrument gives the DSP
 * pitch of C4, so MIDI = 60 + 12 log2(pitch / probe pitch). Instruments mapped to a GM drum become drum hits; the rest use the
 * map's program (or its "sfx" fallback for sounds that are not instruments). Tempo is 120 BPM at 480 ticks per quarter note.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlSnesSfxMidi = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var Smf, P93, P94, M93, M94, Cmd93;
  if (typeof require === 'function' && typeof module === 'object') {
    Smf = require('./smf');
    P93 = require('./nhl93s-player');
    P94 = require('./nhl94s-player');
    M93 = require('./nhl93s-midi');
    M94 = require('./nhl94s-midi');
    Cmd93 = require('./nhl93s-sound-data').CMD;
  } else {
    Smf = root.Nhl92Smf; P93 = root.NhlNhl93sPlayer; P94 = root.NhlNhl94sPlayer; M93 = root.NhlNhl93sMidi; M94 = root.NhlNhl94sMidi;
    Cmd93 = root.NhlNhl93sSoundData.CMD;
  }

  var CPU_HZ = 1024000;
  var TPS = 960; // MIDI ticks per second (120 BPM, 480 per quarter note)

  /**
   * Run `step` (one video frame) up to opts.maxFrames times, or until opts.done() after opts.minFrames, and log the voices.
   * A note ends at key off, at a new key on of its voice, or when its envelope reaches 0.
   */
  function capture(spc, step, opts) {
    opts = opts || {};
    var dsp = spc.dsp;
    var orig = dsp.write;
    var t0 = spc.cycles;
    var now = function () { return (spc.cycles - t0) / CPU_HZ; };
    var vs = [];
    for (var i = 0; i < 8; i++) vs.push({ srcn: 0, vl: 0, vr: 0, pl: 0, pitch: 0, cur: null, age: 0 });
    var out = [];
    var end = function (v, t) { if (v.cur) { v.cur.t1 = t; out.push(v.cur); v.cur = null; } };
    dsp.write = function (a, val) {
      orig.call(dsp, a, val);
      var v = val & 0xff;
      a &= 0x7f;
      if (a === 0x4c) {
        for (var k = 0; k < 8; k++) if (v & (1 << k)) {
          end(vs[k], now());
          vs[k].cur = { voice: k, srcn: vs[k].srcn, t0: now(), t1: null, volume: Math.max(Math.abs((vs[k].vl << 24) >> 24), Math.abs((vs[k].vr << 24) >> 24)), pitch0: vs[k].pitch || null, pitches: [], last: vs[k].pitch };
          vs[k].age = 0;
        }
      } else if (a === 0x5c) {
        for (var j = 0; j < 8; j++) if (v & (1 << j)) end(vs[j], now());
      } else if (a < 0x80 && (a & 0x0f) <= 7) {
        var q = vs[a >> 4];
        switch (a & 0x0f) {
          case 0: q.vl = v; break;
          case 1: q.vr = v; break;
          case 2: q.pl = v; break;
          case 3:
            q.pitch = ((v & 0x3f) << 8) | q.pl;
            if (q.cur) {
              if (q.cur.pitch0 == null) q.cur.pitch0 = q.pitch;
              else if (q.pitch !== q.cur.last) q.cur.pitches.push({ t: now(), pitch: q.pitch });
              q.cur.last = q.pitch;
            }
            break;
          case 4: q.srcn = v; break;
          default: break;
        }
      }
    };
    try {
      var max = opts.maxFrames || 600;
      for (var f = 0; f < max; f++) {
        step();
        var t = now();
        for (var n = 0; n < 8; n++) {
          var q2 = vs[n];
          if (q2.cur) {
            q2.age += 1;
            if (q2.age > 2 && dsp.read(n * 0x10 + 8) === 0) end(q2, t);
          }
        }
        if (opts.done && f >= (opts.minFrames || 4) && opts.done()) break;
      }
      var tEnd = now();
      for (var m = 0; m < 8; m++) end(vs[m], tEnd);
    } finally {
      dsp.write = orig;
    }
    // the program sets the pitch a moment after the key on: writes within 2 ms of it are the note's starting pitch
    out.forEach(function (n) {
      delete n.last;
      while (n.pitches.length && n.pitches[0].t - n.t0 < 0.002) n.pitch0 = n.pitches.shift().pitch;
    });
    return out.sort(function (a, b) { return a.t0 - b.t0 || a.voice - b.voice; });
  }

  var ticks = function (sec) { return Math.max(0, Math.round(sec * TPS)); };
  var hx = function (n) { return '$' + n.toString(16).toUpperCase(); };

  /** Voice log from capture() -> sound-roll keyOn commands (frame = video frame, pitch = DSP pitch register). */
  function notesToRollCommands(notes, frameRate, lagSec) {
    lagSec = lagSec || 0;
    return notes.map(function (n) {
      return {
        frame: Math.max(0, Math.round((n.t0 + lagSec) * frameRate)),
        name: 'keyOn',
        args: {
          voice: n.voice,
          sample: n.srcn,
          inst: n.srcn + 10,
          pitch: n.pitch0,
          frames: n.t1 != null ? Math.max(1, Math.round((n.t1 - n.t0) * frameRate)) : undefined
        }
      };
    });
  }

  /** Notes to an SMF: one track per DSP voice (GM channel 0..7, drums on channel 9), pitch bends for the pitch changes. */
  function toSmf(notes, resolve, name) {
    var tracks = [];
    var byKey = {};
    notes.forEach(function (n) {
      var r = resolve(n);
      if (!r) return;
      var key = r.drum != null ? 'd' : 'v' + n.voice;
      var tr = byKey[key];
      if (!tr) {
        var chan = r.drum != null ? 9 : Object.keys(byKey).filter(function (k) { return k[0] === 'v'; }).length;
        tr = byKey[key] = { ch: chan, name: r.drum != null ? 'drums' : 'voice ' + n.voice, notes: [], bends: [], program: r.program };
        tracks.push(tr);
      }
      var start = ticks(n.t0);
      var dur = Math.max(1, ticks(n.t1) - start);
      if (r.drum != null) {
        tr.notes.push({ tick: start, dur: Math.min(dur, 240), pitch: r.drum, vel: r.vel });
        return;
      }
      var midi = r.ref ? 60 + 12 * Math.log2(n.pitch0 / r.ref) : 60;
      var base = Math.max(0, Math.min(127, Math.round(midi)));
      tr.notes.push({ tick: start, dur: dur, pitch: base, vel: r.vel, program: r.program });
      if (r.ref && n.pitches.length) {
        tr.bends.push({ tick: start, semis: midi - base });
        n.pitches.forEach(function (p) {
          if (p.pitch > 0) tr.bends.push({ tick: ticks(p.t), semis: Math.max(-24, Math.min(24, 60 + 12 * Math.log2(p.pitch / r.ref) - base)) });
        });
        tr.bends.push({ tick: start + dur + 1, semis: 0 });
      } else if (r.ref && Math.abs(midi - base) > 0.05) tr.bends.push({ tick: start, semis: midi - base });
    });
    tracks.forEach(function (t) { if (!t.bends.length) delete t.bends; else t.bends.sort(function (a, b) { return a.tick - b.tick; }); });
    return Smf.write({ ppq: 480, tempos: [{ tick: 0, bpm: 120 }], name: name, tracks: tracks });
  }

  var vel = function (n) { return Math.max(1, Math.min(127, Math.round(n.volume))); };

  // --- NHLPA '93 -----------------------------------------------------------------------------------------------

  var refCache93 = new WeakMap();
  /** DSP pitch of MIDI 60 (note index 48) on an instrument, from a probe note in the real program. */
  function reference93(data, set, inst) {
    var cache = refCache93.get(data);
    if (!cache) { cache = {}; refCache93.set(data, cache); }
    var k = set + inst;
    if (cache[k] != null) return cache[k];
    var ch = [
      { tick: 0, type: 'command', code: Cmd93.TEMPO, params: [60] },
      { tick: 0, type: 'command', code: Cmd93.MASTER_VOLUME, params: [0xb4] },
      { tick: 0, type: 'command', code: Cmd93.VOLUME, params: [0xff] },
      { tick: 0, type: 'command', code: Cmd93.PAN, params: [0x7f] },
      { tick: 0, type: 'command', code: Cmd93.INSTRUMENT, params: [inst] },
      { tick: 0, type: 'note', key: 48, length: 40, velocity: 15 }
    ];
    var built = M93.buildSong({ set: set, loop: false, channels: [{ events: ch }, {}, {}, {}, {}, {}, {}, {}], end: 60 }, M93.BASE[set]);
    var p = P93.create({ data: data });
    p.playCustom(set, built.bytes, built.base);
    var got = capture(p.spc, function () { p.runFrame(); }, { maxFrames: 20, minFrames: 8, done: function () { return false; } });
    var note = got.filter(function (n) { return n.pitch0 != null; })[0];
    cache[k] = note ? note.pitch0 : null;
    return cache[k];
  }

  var instOfSrcn93 = function (set, srcn) { return set === 'game' ? srcn + 10 : srcn; };

  function exportEffect93(data, gmMap, cue) {
    var p = P93.create({ data: data });
    p.loadSet('game');
    var queued = false;
    var notes = capture(p.spc, function () {
      if (!queued) { p.effect(cue); queued = true; }
      p.runFrame();
    }, { maxFrames: 700, minFrames: 10, done: function () { return p.idle(); } });
    var rows = (gmMap && gmMap.sets && gmMap.sets.game) || {};
    var sfx = (gmMap && gmMap.sfx && gmMap.sfx.game) || {};
    var name = data.effectName(cue) || 'effect';
    return toSmf(notes, function (n) {
      var inst = instOfSrcn93('game', n.srcn);
      var row = rows[inst] || sfx[inst];
      var ref = reference93(data, 'game', inst);
      if (row && row.drum != null) return { drum: row.drum, vel: vel(n) };
      return { program: row ? row.program : 80, ref: ref, vel: vel(n) };
    }, 'NHLPA 93 SNES effect ' + hx(cue) + ' ' + name);
  }

  // --- NHL '94 -------------------------------------------------------------------------------------------------

  var refCache94 = new WeakMap();
  function reference94(data, set, n) {
    var cache = refCache94.get(data);
    if (!cache) { cache = {}; refCache94.set(data, cache); }
    var k = set + n;
    if (cache[k] != null) return cache[k];
    var snd = data.sound(set, n);
    var p = P94.create({ data: data });
    p.boot();
    p.loadSet(set);
    var bytes = M94.buildSong({ tempo: 168, tracks: [{ events: [
      { delay: 0, type: 'instrument', value: n },
      { delay: 0, type: 'controller', controller: 7, value: 127 },
      { delay: 0, type: 'note', code: (60 - snd.noteOffset) & 0x7f, velocity: 127, duration: 40 },
      { delay: 42, type: 'stop', code: 0xd9 }
    ] }] });
    p.startSongBytes(bytes);
    var got = capture(p.spc, function () { p.runFrame(); }, { maxFrames: 20, minFrames: 8, done: function () { return false; } });
    var note = got.filter(function (x) { return x.pitch0 != null; })[0];
    cache[k] = note ? note.pitch0 : null;
    return cache[k];
  }

  function exportEffect94(data, gmMap, set, n) {
    var p = P94.create({ data: data });
    p.boot();
    p.loadSet(set);
    var started = false;
    var notes = capture(p.spc, function () {
      if (!started) { p.playEntry(n); started = true; }
      p.runFrame();
    }, { maxFrames: 700, minFrames: 10, done: function () { return p.idle ? p.idle() : false; } });
    var row = (gmMap && gmMap.sets && gmMap.sets[set] && gmMap.sets[set][n]) || (gmMap && gmMap.sfx && gmMap.sfx[set] && gmMap.sfx[set][n]);
    var ref = row && row.drum != null ? null : reference94(data, set, n);
    return toSmf(notes, function (x) {
      if (row && row.drum != null) return { drum: row.drum, vel: vel(x) };
      return { program: row ? row.program : 80, ref: ref, vel: vel(x) };
    }, "NHL 94 SNES effect " + set + " " + n + " " + (data.soundSample(set, n) || ''));
  }

  return { capture: capture, notesToRollCommands: notesToRollCommands, toSmf: toSmf, exportEffect93: exportEffect93, exportEffect94: exportEffect94, reference93: reference93, reference94: reference94, TPS: TPS };
});
