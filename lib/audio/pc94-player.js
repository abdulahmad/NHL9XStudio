/**
 * NHL 94/95 PC AdLib sequencer + OPL2 render, and digital SFX as PCM.
 * Sequencer matches NHL95PC sub_990CB / sub_99925 (EACSNDF). Tempo rate is
 * 32000 / tempo; the interrupt accumulator steps 0x80. MIDI send adds 24 to
 * every note (NHL94PC HOCKEY.EXE 1844:022E); without that the organ tunes are
 * two octaves low and sound like envelope clicks. Song-handle transpose at
 * EDCFC+0x13 is 0. FM timbres come from PCFF00n.TIM through PCFF004.PAT.
 * PAT rec[7] is the signed transpose the YM30 driver adds at note-on. OPL
 * fnum/block come from the driver's 12-entry table (block = note/12).
 * Operator registers use the OPL2 offsets 0,1,2,8,9,10,16,17,18. Not a
 * YM30.BGP unicorn run — envelopes after timbre +0x0F are still unknown.
 */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var Chip = null;
  if (isNode) {
    try { Chip = require('opl3').OPL3; } catch (err) { Chip = require('./opl3-chip'); }
  } else {
    Chip = root.NhlOpl3Chip;
  }
  var api = factory(Chip, isNode ? require('./pc94-kms') : root.NhlPc94Kms, isNode ? require('./pc94-sfx') : root.NhlPc94Sfx);
  if (isNode) module.exports = api;
  else root.NhlPc94Player = api;
})(typeof self !== 'undefined' ? self : this, function (OPL3, Kms, Sfx) {
  var RATE = 49716;
  var TIMER_HZ = 100;
  /** NHL94PC HOCKEY.EXE 1844:022E adds 18h to every note-on/off sent to the driver. */
  var NOTE_OFFSET = 24;
  /** OPL2 operator register offsets (not operator numbers). Channel 3+ skip the unused 6,7 / 14,15 slots. */
  var MOD_OP = [0, 1, 2, 8, 9, 10, 16, 17, 18];
  var CAR_OP = [3, 4, 5, 11, 12, 13, 19, 20, 21];
  /** YM30 / sub_A6B32: fnum = table[note % 12], block = note / 12. First 12 words of word_D67F4. */
  var FNUM12 = [0x56, 0x5b, 0x60, 0x66, 0x6c, 0x72, 0x79, 0x80, 0x88, 0x90, 0x99, 0xa2];

  function midiToFnum(midi) {
    midi = midi & 0xff;
    var block = (midi / 12) | 0;
    var fnum = FNUM12[midi % 12];
    if (block > 7) {
      fnum = Math.min(0x3ff, fnum << (block - 7));
      block = 7;
    }
    return { fnum: fnum & 0x3ff, block: block & 7 };
  }

  function writeOp(chip, op, regs) {
    chip.write(0, 0x20 + op, regs.amvib || 0);
    chip.write(0, 0x40 + op, regs.ksl || 0);
    chip.write(0, 0x60 + op, regs.ad || 0);
    chip.write(0, 0x80 + op, regs.sr || 0);
    chip.write(0, 0xe0 + op, regs.wav || 0);
  }

  function defaultVoice() {
    return {
      type: 4,
      car: { amvib: 0x01, ksl: 0x00, ad: 0xf0, sr: 0x77, wav: 0 },
      mod: { amvib: 0x01, ksl: 0x00, ad: 0xf0, sr: 0x77, wav: 0 },
      fbConn: 0x30
    };
  }

  function applyTimbre(chip, ch, fm) {
    var voice = fm || defaultVoice();
    writeOp(chip, MOD_OP[ch], voice.mod);
    writeOp(chip, CAR_OP[ch], voice.car);
    chip.write(0, 0xc0 + ch, voice.fbConn == null ? 0x30 : voice.fbConn);
  }

  function keyOn(chip, ch, midi, vel, blockLo) {
    var f = midiToFnum(midi);
    var hi = (f.block << 2) | (f.fnum >> 8);
    blockLo[ch] = hi;
    chip.write(0, 0xa0 + ch, f.fnum & 0xff);
    var level = Math.max(0, Math.min(127, vel == null ? 100 : vel));
    chip.write(0, 0x40 + CAR_OP[ch], (chip.registers ? (chip.registers[0x40 + CAR_OP[ch]] & 0xc0) : 0) | ((0x3f - (level >> 2)) & 0x3f));
    chip.write(0, 0xb0 + ch, hi | 0x20);
  }

  function keyOff(chip, ch, blockLo) {
    chip.write(0, 0xb0 + ch, (blockLo[ch] || 0) & ~0x20);
  }

  function loadInstruments(patBuf, timMap) {
    var byProg = {};
    if (!patBuf || !timMap) return byProg;
    var pat = Sfx.loadPat(patBuf);
    for (var prog = 0; prog < 256; prog++) {
      var ri = pat.map[prog];
      if (!ri || !pat.recs[ri]) continue;
      var rec = pat.recs[ri];
      var bank = rec[0];
      var n = rec[1];
      var tim = timMap[bank] && timMap[bank][n];
      byProg[prog] = {
        bank: bank,
        timbre: n,
        transpose: Sfx.s8(rec[7]),
        fm: tim ? Sfx.parseFmTimbre(tim) : null
      };
    }
    return byProg;
  }

  function Sequencer(song, send, opts) {
    this.song = song;
    this.send = send;
    this.vol = (opts && opts.volume) != null ? opts.volume : 0x7f;
    this.pan = (opts && opts.pan) != null ? opts.pan : 0x3f;
    this.transpose = (opts && opts.transpose) || 0;
    this.loops = (opts && opts.loops) || 1;
    this.loopCount = 0;
    this.notes = [];
    this.tracks = [];
    var rate = (32000 / Math.max(1, song.tempo)) | 0;
    for (var i = 0; i < song.tracks.length; i++) {
      var tc = song.tracks[i];
      var t = {
        idx: i, pos: song.offsets[i], start: song.offsets[i],
        delta: 0, acc: 0, rate: rate, chan: tc.chan, vel: 0,
        loopdepth: 0, calldepth: 0, loops: [], calls: [], prog: tc.program, looped: 0, cfg: tc
      };
      this.tracks.push(t);
      this.midi([0xc0 | (t.chan & 15), tc.program & 255]);
      this.controller(t, 1, 0);
      this.controller(t, 7, tc.vol);
      this.controller(t, 10, tc.pan);
      this.midi([0xe0 | (t.chan & 15), 0, 0x40]);
    }
  }
  Sequencer.prototype.midi = function (msg) { this.send(msg); };
  Sequencer.prototype.controller = function (t, num, val) {
    if (num === 7) val = Math.min((val * this.vol / 0x7f) | 0, 0x7f);
    this.midi([0xb0 | (t.chan & 15), num, val & 0x7f]);
  };
  Sequencer.prototype.done = function () {
    for (var i = 0; i < this.tracks.length; i++) if (this.tracks[i].pos != null) return false;
    return true;
  };
  Sequencer.prototype.interrupt = function () {
    for (var i = 0; i < this.tracks.length; i++) {
      var t = this.tracks[i];
      if (t.pos == null) continue;
      t.acc += 0x80;
      while (t.acc >= t.rate && t.pos != null) {
        this.tick(t);
        t.acc -= t.rate;
      }
    }
  };
  Sequencer.prototype.tick = function (t) {
    for (var i = this.notes.length - 1; i >= 0; i--) {
      var n = this.notes[i];
      if (n.t !== t) continue;
      n.left -= 1;
      if (n.left <= 0) {
        this.midi([0x80 | n.chan, n.note, 0]);
        this.notes.splice(i, 1);
      }
    }
    if (t.delta) { t.delta -= 1; return; }
    var d = this.song.kms;
    while (true) {
      var e = Kms.decodeEvent(d, t.pos);
      t.pos += e.len;
      this.execute(t, e);
      if (t.pos == null) return;
      t.delta = Kms.decodeEvent(d, t.pos).delta;
      if (t.delta) { t.delta -= 1; return; }
    }
  };
  Sequencer.prototype.execute = function (t, e) {
    var c = e.cmd;
    if (c < 0xd9) {
      var vel = c > 0x80 ? e.a1 : t.vel;
      var note = c & 0x7f;
      if (t.chan !== 9) note = (note + this.transpose) & 0xff;
      if (this.notes.length >= 32) return;
      var played = (note + NOTE_OFFSET) & 0x7f;
      this.notes.push({ t: t, chan: t.chan & 15, note: played, left: e.a2 || 1 });
      this.midi([0x90 | (t.chan & 15), played, vel]);
    } else if (c === 0xd9 || c === 0xda) {
      if (t.calldepth) { t.pos = t.calls.pop(); t.calldepth -= 1; }
      else t.pos = null;
    } else if (c === 0xdb) {
      t.looped += 1;
      if (t.idx === 0) this.loopCount += 1;
      if (this.loopCount >= this.loops && t.looped >= this.loops) { t.pos = null; return; }
      t.loopdepth = 0; t.calldepth = 0; t.loops = []; t.calls = [];
      t.pos = t.start;
    } else if (c === 0xdc) {
      t.prog = e.a1;
      this.midi([0xc0 | (t.chan & 15), e.a1]);
    } else if (c === 0xdd) {
      var rate = (32000 / Math.max(1, e.a1)) | 0;
      for (var i = 0; i < this.tracks.length; i++) this.tracks[i].rate = rate;
    } else if (c === 0xdf) {
      this.controller(t, e.a1, e.a2);
    } else if (c === 0xe2) {
      t.loops.push({ pos: t.pos, n: (e.a1 - 1) & 0xff }); t.loopdepth += 1;
    } else if (c === 0xe3) {
      if (t.loopdepth) {
        var top = t.loops[t.loops.length - 1];
        t.pos = top.pos;
        var n = top.n;
        top.n = (top.n - 1) & 0xff;
        if (n === 0) { t.loops.pop(); t.loopdepth -= 1; }
      }
    } else if (c === 0xe4) {
      t.vel = e.a1;
    } else if (c === 0xe5) {
      this.midi([0xe0 | (t.chan & 15), 0, (e.a2 >> 8) & 0x7f]);
    } else if (c === 0xe6) {
      t.calls.push(t.pos); t.calldepth += 1; t.pos = e.a2 + 4;
    }
  };
  Sequencer.prototype.allOff = function () {
    for (var i = 0; i < this.notes.length; i++) this.midi([0x80 | this.notes[i].chan, this.notes[i].note, 0]);
    this.notes = [];
  };

  function OplMidi(chip, instruments, muted) {
    this.chip = chip;
    this.instruments = instruments || {};
    this.muted = muted || null;
    this.blockLo = {};
    this.chProg = {};
    this.voices = {};
    chip.write(0, 0x01, 0x20);
    chip.write(0, 0xbd, 0);
    chip.write(0, 0x08, 0);
    for (var ch = 0; ch < 9; ch++) applyTimbre(chip, ch, defaultVoice());
  }
  OplMidi.prototype.voiceOf = function (midiCh) {
    if (midiCh === 9) return 8;
    return midiCh % 9;
  };
  OplMidi.prototype.send = function (msg) {
    var st = msg[0];
    var cmd = st & 0xf0;
    var ch = st & 0x0f;
    var voice = this.voiceOf(ch);
    if (this.muted && this.muted[voice]) return;
    if (cmd === 0xc0) {
      this.chProg[ch] = msg[1];
      var inst = this.instruments[msg[1]];
      applyTimbre(this.chip, voice, inst && inst.fm);
    } else if (cmd === 0x90 && msg[2]) {
      var midi = msg[1];
      /* YM30: channel 9 program is note+5Ch (drum programs 80h–BFh). */
      var prog = ch === 9 ? (midi + 0x5c) & 0xff : (this.chProg[ch] || 0);
      var instOn = this.instruments[prog];
      if (ch === 9 && instOn && instOn.fm) applyTimbre(this.chip, voice, instOn.fm);
      if (instOn) midi = Math.max(0, Math.min(127, midi + (instOn.transpose || 0)));
      keyOn(this.chip, voice, midi, msg[2], this.blockLo);
      this.voices[voice] = midi;
    } else if (cmd === 0x80 || (cmd === 0x90 && !msg[2])) {
      keyOff(this.chip, voice, this.blockLo);
    }
  };

  /** Sequence without the OPL chip; returns the song length in seconds (capped). */
  function songSeconds(parsed, opts) {
    var maxSec = (opts && opts.maxSeconds) || 180;
    var loops = (opts && opts.loops) || 1;
    var seq = new Sequencer(parsed, function () {}, { loops: loops });
    var n = 0;
    var maxTicks = Math.ceil(maxSec * TIMER_HZ);
    while (n < maxTicks && (!seq.done() || n < 8)) {
      seq.interrupt();
      n += 1;
      if (seq.done() && n > 8) break;
    }
    return n / TIMER_HZ;
  }

  function renderSong(parsed, opts) {
    if (!OPL3) throw new Error('OPL3 chip is not available');
    var seconds = (opts && opts.seconds) || 4;
    var loops = (opts && opts.loops) || 1;
    var chip = new OPL3();
    var inst = loadInstruments(opts && opts.pat, opts && opts.timbres);
    var midi = new OplMidi(chip, inst, opts && opts.muted);
    var events = [];
    var n = 0;
    var seq = new Sequencer(parsed, function (m) {
      events.push({ tick: n, msg: [m[0], m[1] || 0, m[2] || 0] });
      midi.send(m);
    }, { loops: loops, volume: (opts && opts.volume) || 0x7f });
    var samples = Math.ceil(seconds * RATE);
    var out = new Int16Array(samples * 2);
    var sPerTick = RATE / TIMER_HZ;
    var maxTicks = Math.ceil(seconds * TIMER_HZ);
    while (n < maxTicks && (!seq.done() || n < 8)) {
      var start = Math.floor(n * sPerTick);
      var end = Math.min(samples, Math.floor((n + 1) * sPerTick));
      seq.interrupt();
      if (end > start) chip.read(out.subarray(start * 2, end * 2), 0);
      n += 1;
      if (seq.done() && n > 8) break;
    }
    seq.allOff();
    var pcm = out.subarray(0, Math.max(2, Math.floor(n * sPerTick) * 2));
    pcm.events = events;
    pcm.ticks = n;
    pcm.rate = RATE;
    return pcm;
  }

  function renderSfx(sample, opts) {
    var seconds = (opts && opts.seconds) || 0;
    var f32 = Sfx.toFloat32(sample.pcm, sample.loop ? {
      loopStart: sample.loopStart,
      loopEnd: sample.loopEnd,
      rate: sample.rate,
      seconds: seconds || 2
    } : null);
    var stereo = new Int16Array(f32.length * 2);
    for (var i = 0; i < f32.length; i++) {
      var v = Math.max(-1, Math.min(1, f32[i]));
      var s = (v * 32767) | 0;
      stereo[i * 2] = s;
      stereo[i * 2 + 1] = s;
    }
    return { pcm: stereo, rate: sample.rate || 11025, float: f32 };
  }

  return {
    RATE: RATE,
    TIMER_HZ: TIMER_HZ,
    NOTE_OFFSET: NOTE_OFFSET,
    FNUM12: FNUM12,
    Sequencer: Sequencer,
    songSeconds: songSeconds,
    renderSong: renderSong,
    renderSfx: renderSfx,
    loadInstruments: loadInstruments,
    midiToFnum: midiToFnum
  };
});
