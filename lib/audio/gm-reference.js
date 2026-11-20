/**
 * Basic General-MIDI-style reference sounds, for auditioning the NHL '92 <-> GM mapping.
 *
 * This is NOT a soundfont. Each GM program is a plain synth recipe (a set of partials, an
 * envelope, a little vibrato) chosen so that the instrument *family* is recognisable; each
 * drum note is a few sine sweeps and filtered-noise bursts. It exists so a mapping can be
 * heard side by side with the NHL '92 patch it points to.
 *
 * Offline and deterministic: the same call returns the same samples (noise comes from a
 * seeded generator, never Math.random). UMD: Node (tests) and the chip lab page.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92GmReference = api;
})(typeof self !== 'undefined' ? self : this, function () {
  var SAMPLE_RATE = 53267; // the step 4 pipeline's rate, so both sides share one clock
  var TWO_PI = Math.PI * 2;

  // --- Partial sets: [ratio to the fundamental, amplitude] ------------------------------
  function series(count, step, amp) {
    var out = [];
    for (var n = 1; n <= count; n += step) out.push([n, amp(n)]);
    return out;
  }
  var P = {
    sine: [[1, 1]],
    triangle: series(9, 2, function (n) { return 1 / (n * n); }),
    square: series(15, 2, function (n) { return 1 / n; }),
    saw: series(16, 1, function (n) { return 1 / n; }),
    mellowSaw: series(8, 1, function (n) { return 1 / (n * n * 0.6 + 0.4); }),
    organ: [[1, 1], [2, 0.8], [3, 0.55], [4, 0.5], [6, 0.3], [8, 0.2]],
    reed: [[1, 1], [2, 0.6], [3, 0.5], [4, 0.3], [5, 0.25], [6, 0.15]],
    piano: [[1, 1], [2, 0.55], [3, 0.35], [4, 0.25], [5, 0.15], [6, 0.1], [7, 0.07]],
    pluck: series(8, 1, function (n) { return 1 / (n * 0.8); }),
    bell: [[1, 1], [2.76, 0.6], [5.4, 0.4], [8.93, 0.25]],
    mallet: [[1, 1], [3.9, 0.4], [9.2, 0.1]],
    vowel: [[1, 1], [2, 0.3], [3, 0.6], [4, 0.2], [5, 0.5], [6, 0.15]],
    clarinet: series(11, 2, function (n) { return 1 / n; })
  };

  // --- Programs: one base recipe per family, then small per-program tweaks --------------
  // attack/release in seconds; tau = decay time constant (null = no decay); sustain = level the
  // decay settles to; bright = extra decay of high partials; vib = [cents, Hz, delay s].
  var FAMILY = [
    { partials: P.piano, attack: 0.004, tau: 0.7, sustain: 0, release: 0.15, bright: 2.5 }, // piano
    { partials: P.bell, attack: 0.002, tau: 0.8, sustain: 0, release: 0.2, bright: 1 }, // chromatic percussion
    { partials: P.organ, attack: 0.01, tau: null, sustain: 1, release: 0.05 }, // organ
    { partials: P.pluck, attack: 0.002, tau: 0.5, sustain: 0, release: 0.12, bright: 3 }, // guitar
    { partials: P.mellowSaw, attack: 0.005, tau: 0.6, sustain: 0.55, release: 0.1, bright: 1.5 }, // bass
    { partials: P.saw, attack: 0.09, tau: null, sustain: 1, release: 0.15, vib: [14, 5.5, 0.15], detune: 7 }, // strings
    { partials: P.mellowSaw, attack: 0.18, tau: null, sustain: 1, release: 0.3, vib: [8, 5, 0.2], detune: 9 }, // ensemble
    { partials: P.saw, attack: 0.05, tau: null, sustain: 1, release: 0.1, vib: [6, 5.5, 0.3] }, // brass
    { partials: P.reed, attack: 0.03, tau: null, sustain: 1, release: 0.08, vib: [10, 5.5, 0.2] }, // reed
    { partials: [[1, 1], [2, 0.12], [3, 0.05]], attack: 0.04, tau: null, sustain: 1, release: 0.08, vib: [8, 5, 0.25] }, // pipe
    { partials: P.saw, attack: 0.006, tau: null, sustain: 1, release: 0.08, vib: [18, 5.5, 0.1] }, // synth lead
    { partials: P.triangle, attack: 0.35, tau: null, sustain: 1, release: 0.5, detune: 8 }, // synth pad
    { partials: P.mellowSaw, attack: 0.25, tau: null, sustain: 1, release: 0.5, vib: [10, 4, 0.2] }, // synth effects
    { partials: P.pluck, attack: 0.002, tau: 0.45, sustain: 0, release: 0.1, bright: 2 }, // ethnic
    { partials: P.mallet, attack: 0.002, tau: 0.4, sustain: 0, release: 0.1, bright: 1 }, // percussive
    { partials: P.sine, attack: 0.01, tau: null, sustain: 1, release: 0.1, noise: 0.4 } // sound effects (mostly noise-driven below)
  ];
  var PROGRAM_TWEAKS = {
    4: { partials: [[1, 1], [2, 0.12], [7, 0.1]], tau: 0.9, bright: 1.5 }, 5: { partials: [[1, 1], [2, 0.3], [5, 0.15]], tau: 0.7, bright: 2 },
    6: { partials: P.pluck, tau: 0.25, bright: 4 }, 7: { partials: P.square, tau: 0.2, bright: 4 },
    8: { partials: P.bell, tau: 0.6 }, 9: { partials: P.bell, tau: 0.9, bright: 0.5 }, 10: { partials: P.bell, tau: 0.7 },
    11: { partials: [[1, 1], [4, 0.2]], tau: 1.2, vib: [0, 0, 0], trem: [0.3, 5] }, 12: { partials: P.mallet, tau: 0.3 }, 13: { partials: P.mallet, tau: 0.2, bright: 3 },
    14: { partials: P.bell, tau: 1.6, bright: 0.4 }, 15: { partials: P.pluck, tau: 0.5 },
    19: { partials: [[1, 1], [2, 0.9], [3, 0.7], [4, 0.6], [5, 0.4], [6, 0.35], [8, 0.2]], attack: 0.03 },
    20: { partials: P.reed }, 21: { partials: P.reed, vib: [0, 0, 0], trem: [0.15, 6] }, 22: { partials: P.reed, attack: 0.05 }, 23: { partials: P.reed, vib: [0, 0, 0], trem: [0.15, 6] },
    24: { tau: 0.7, bright: 2.5 }, 28: { tau: 0.12, bright: 4 }, 29: { partials: P.saw, tau: 1.5, sustain: 0.6, drive: 2.5 }, 30: { partials: P.saw, tau: 1.5, sustain: 0.7, drive: 5 },
    31: { partials: [[1, 0.3], [4, 1], [6, 0.4]], tau: 0.8 },
    32: { partials: P.pluck, tau: 0.45, sustain: 0.1 }, 35: { partials: P.triangle, tau: 1.2, sustain: 0.6 },
    36: { partials: P.pluck, tau: 0.2, bright: 5, sustain: 0.1 }, 37: { partials: P.pluck, tau: 0.18, bright: 5, sustain: 0.1 },
    38: { partials: P.saw, tau: 0.5, sustain: 0.5 }, 39: { partials: P.square, tau: 0.4, sustain: 0.5 },
    44: { trem: [0.5, 12] }, 45: { partials: P.pluck, attack: 0.002, tau: 0.15, sustain: 0, vib: [0, 0, 0], detune: 0 }, 46: { partials: P.pluck, tau: 0.7, bright: 2 },
    47: { drumPitch: true },
    52: { partials: P.vowel, attack: 0.1 }, 53: { partials: P.vowel, attack: 0.12 }, 54: { partials: P.vowel, attack: 0.04 },
    55: { partials: P.saw, attack: 0.003, tau: 0.25, sustain: 0, release: 0.1, vib: [0, 0, 0] },
    59: { partials: P.clarinet, attack: 0.03 }, 60: { partials: P.mellowSaw, attack: 0.08 }, 61: { attack: 0.07 }, 62: { partials: P.square, attack: 0.02 }, 63: { attack: 0.12, partials: P.saw },
    71: { partials: P.clarinet }, 68: { partials: [[1, 0.6], [2, 1], [3, 0.8], [4, 0.5], [5, 0.3]] },
    72: { partials: [[1, 1], [2, 0.2]] }, 76: { noise: 0.5 }, 78: { partials: P.sine, vib: [10, 6, 0.1] }, 79: { partials: [[1, 1], [2, 0.08]] },
    80: { partials: P.square }, 81: { partials: P.saw }, 82: { partials: [[1, 1], [2, 0.25], [3, 0.1]], noise: 0.15 }, 83: { partials: P.square, attack: 0.002, noise: 0.35 },
    84: { partials: P.saw, drive: 4 }, 85: { partials: P.vowel, attack: 0.05 }, 86: { partials: [[1, 1], [1.5, 0.9], [2, 0.5], [3, 0.4]] },
    93: { partials: P.bell, attack: 0.3, tau: null, sustain: 1 }, 98: { partials: P.bell, attack: 0.002, tau: 1.2, sustain: 0 },
    104: { partials: P.saw, tau: 0.9, bright: 2 }, 108: { partials: P.mallet, tau: 0.6, bright: 1 }, 109: { partials: P.reed, attack: 0.05, vib: [0, 0, 0] }, 111: { partials: P.reed, attack: 0.04 },
    112: { partials: [[1, 1], [2.9, 0.5], [6.5, 0.3]], tau: 1.2 }, 113: { partials: [[1, 1], [1.5, 0.7], [2.5, 0.2]], tau: 0.3 }, 114: { partials: P.bell, tau: 0.5, bright: 1 },
    115: { partials: [[1, 1], [2.4, 0.15]], tau: 0.05 }, 116: { drumPitch: true }, 117: { drumPitch: true }, 118: { drumPitch: true }, 119: { cymbalSwell: true }
  };
  var SFX = { 120: 'fret', 121: 'breath', 122: 'seashore', 123: 'tweet', 124: 'ring', 125: 'heli', 126: 'applause', 127: 'gunshot' };

  function recipe(program) {
    var base = FAMILY[Math.floor(program / 8)];
    var r = {};
    Object.keys(base).forEach(function (k) { r[k] = base[k]; });
    var tweak = PROGRAM_TWEAKS[program];
    if (tweak) Object.keys(tweak).forEach(function (k) { r[k] = tweak[k]; });
    if (SFX[program]) r.sfx = SFX[program];
    r.program = program;
    return r;
  }

  // --- Small helpers ----------------------------------------------------------------------
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2147483648 - 1; // -1..1
    };
  }
  var hz = function (midi) { return 440 * Math.pow(2, (midi - 69) / 12); };

  function normalize(buf, peak) {
    var max = 0;
    var i;
    for (i = 0; i < buf.length; i++) if (Math.abs(buf[i]) > max) max = Math.abs(buf[i]);
    if (max > 0) {
      var g = (peak || 0.5) / max;
      for (i = 0; i < buf.length; i++) buf[i] *= g;
    }
    return buf;
  }

  // One-pole filters over a sample array (in place).
  function lowpass(x, cutoff, rate) {
    var a = 1 - Math.exp(-TWO_PI * cutoff / rate);
    var y = 0;
    for (var i = 0; i < x.length; i++) { y += a * (x[i] - y); x[i] = y; }
  }
  function highpass(x, cutoff, rate) {
    var a = 1 - Math.exp(-TWO_PI * cutoff / rate);
    var y = 0;
    for (var i = 0; i < x.length; i++) { y += a * (x[i] - y); x[i] -= y; }
  }

  // --- Pitched programs -------------------------------------------------------------------
  function noiseOnly(kind, durSamples, rate, seed) {
    var rnd = rng(seed);
    var x = new Float32Array(durSamples);
    var i;
    var t;
    var d = durSamples / rate;
    for (i = 0; i < durSamples; i++) x[i] = rnd();
    if (kind === 'breath') { lowpass(x, 3500, rate); highpass(x, 400, rate); for (i = 0; i < x.length; i++) { t = i / rate; x[i] *= Math.min(1, t / 0.08) * Math.exp(-Math.max(0, t - d * 0.5) / 0.1); } }
    else if (kind === 'seashore') { lowpass(x, 2000, rate); for (i = 0; i < x.length; i++) { t = i / rate; x[i] *= 0.5 - 0.5 * Math.cos(TWO_PI * t / Math.max(d, 0.5) * 1.0); } }
    else if (kind === 'fret') { highpass(x, 1500, rate); for (i = 0; i < x.length; i++) x[i] *= Math.exp(-(i / rate) / 0.03); }
    else if (kind === 'heli') { lowpass(x, 600, rate); for (i = 0; i < x.length; i++) x[i] *= 0.6 + 0.4 * Math.sin(TWO_PI * 11 * i / rate); }
    else if (kind === 'applause') { highpass(x, 800, rate); lowpass(x, 6000, rate); var g = rng(seed + 7); for (i = 0; i < x.length; i++) { x[i] *= 0.45 + 0.55 * Math.abs(g()) * Math.abs(Math.sin(TWO_PI * 31 * i / rate)); } }
    else if (kind === 'gunshot') { lowpass(x, 5000, rate); for (i = 0; i < x.length; i++) x[i] *= Math.exp(-(i / rate) / 0.09); }
    return x;
  }

  function sfxProgram(r, midi, hold, tail, rate, seed) {
    var n = Math.round((hold + tail) * rate);
    var kind = r.sfx;
    var x;
    var i;
    var t;
    if (kind === 'tweet') { x = new Float32Array(n); var ph = 0; for (i = 0; i < n; i++) { t = i / rate; var f = 2400 + 1400 * Math.sin(TWO_PI * 9 * t) * Math.exp(-t / 0.25); ph += TWO_PI * f / rate; x[i] = Math.sin(ph) * Math.exp(-t / 0.35); } return x; }
    if (kind === 'ring') { x = new Float32Array(n); for (i = 0; i < n; i++) { t = i / rate; var on = (t % 0.25) < 0.12 ? 1 : 0; x[i] = on * 0.5 * (Math.sin(TWO_PI * 1400 * t) + Math.sin(TWO_PI * 1800 * t)); } return x; }
    return noiseOnly(kind, n, rate, seed);
  }

  /** One pitched note into `out` at `start` (samples). Notes sum, so overlapping releases are fine. */
  function addNote(r, midi, hold, tail, rate, out, start, seed) {
    var f0 = hz(midi);
    var n = Math.round((hold + tail) * rate);
    var attack = r.attack || 0.005;
    var tau = r.tau;
    var sustain = r.sustain == null ? 1 : r.sustain;
    var rel = r.release || 0.1;
    var vib = r.vib || [0, 0, 0];
    var trem = r.trem || null;
    var bright = r.bright || 0;
    var partials = r.partials;
    var detune = r.detune || 0;
    var voices = detune ? 2 : 1;
    var phase = [0, 0.37];
    var rnd = rng(seed);
    var envAt = function (t) {
      if (t < attack) return t / attack;
      return tau ? sustain + (1 - sustain) * Math.exp(-(t - attack) / tau) : 1;
    };
    var offLevel = envAt(hold);
    for (var i = 0; i < n; i++) {
      var t = i / rate;
      var env = t <= hold ? envAt(t) : offLevel * Math.exp(-(t - hold) / (rel * 0.5));
      if (env < 1e-5 && t > hold) break;
      var cents = vib[0] && t > vib[2] ? vib[0] * Math.sin(TWO_PI * vib[1] * (t - vib[2])) : 0;
      var y = 0;
      for (var v = 0; v < voices; v++) {
        var f = f0 * Math.pow(2, ((v ? detune : 0) + cents) / 1200);
        phase[v] += TWO_PI * f / rate;
        for (var k = 0; k < partials.length; k++) {
          var ratio = partials[k][0];
          if (f * ratio > rate * 0.45) continue;
          var a = partials[k][1];
          if (bright) a *= Math.exp(-bright * (ratio - 1) * t * 0.6);
          y += a * Math.sin(phase[v] * ratio);
        }
      }
      y /= voices;
      if (r.noise && t < 0.05) y += r.noise * rnd() * (1 - t / 0.05) * 0.8;
      if (trem) y *= 1 - trem[0] + trem[0] * 0.5 * (1 + Math.sin(TWO_PI * trem[1] * t));
      if (r.drive) y = Math.tanh(r.drive * y * 0.6) / Math.tanh(r.drive * 0.6);
      out[start + i] += y * env * 0.3;
    }
  }

  function pitchedDrumProgram(r, midi, hold, tail, rate, out, start, seed) {
    // Timpani / taiko / tom / synth drum: a sine that falls onto the pitch.
    var f1 = hz(midi);
    var f0 = f1 * 1.6;
    var n = Math.round((hold + tail) * rate);
    var ph = 0;
    var rnd = rng(seed);
    for (var i = 0; i < n; i++) {
      var t = i / rate;
      var f = f1 + (f0 - f1) * Math.exp(-t / 0.05);
      ph += TWO_PI * f / rate;
      out[start + i] += (Math.sin(ph) * Math.exp(-t / 0.28) + 0.25 * rnd() * Math.exp(-t / 0.01)) * 0.5;
    }
  }

  function cymbalSwell(hold, tail, rate, out, start, seed) {
    var n = Math.round((hold + tail) * rate);
    var rnd = rng(seed);
    var x = new Float32Array(n);
    var i;
    for (i = 0; i < n; i++) x[i] = rnd();
    highpass(x, 4000, rate);
    for (i = 0; i < n; i++) {
      var t = i / rate;
      out[start + i] += x[i] * Math.min(1, t / hold) * (t < hold ? 1 : Math.exp(-(t - hold) / 0.03)) * 0.4;
    }
  }

  /**
   * Render a GM program playing `midiNotes` one after another.
   * @param {number} program 0-127
   * @param {number[]} midiNotes
   * @param {{hold?:number, gap?:number, tail?:number, rate?:number}} [opts] seconds; defaults match the
   *   chip lab's NHL '92 patch scale (10 frames held, 2 frames apart).
   * @returns {Float32Array} mono, peak-normalised to 0.5
   */
  function renderProgram(program, midiNotes, opts) {
    if (!(program >= 0 && program <= 127)) throw new RangeError('GM program 0-127');
    var o = opts || {};
    var rate = o.rate || SAMPLE_RATE;
    var hold = o.hold || 10 / 60;
    var gap = o.gap == null ? 2 / 60 : o.gap;
    var tail = o.tail || 0.5;
    var r = recipe(program);
    var step = Math.round((hold + gap) * rate);
    var total = step * (midiNotes.length - 1) + Math.round((hold + tail) * rate) + 1;
    var out = new Float32Array(total);
    midiNotes.forEach(function (m, i) {
      var start = i * step;
      if (r.sfx) {
        var s = sfxProgram(r, m, hold, tail, rate, program * 31 + i);
        for (var k = 0; k < s.length && start + k < total; k++) out[start + k] += s[k] * 0.4;
      } else if (r.drumPitch) pitchedDrumProgram(r, m, hold, tail, rate, out, start, program * 31 + i);
      else if (r.cymbalSwell) cymbalSwell(hold, tail, rate, out, start, program * 31 + i);
      else addNote(r, m, hold, tail, rate, out, start, program * 31 + i);
    });
    return normalize(out, 0.5);
  }

  // --- Drum kit (channel 10, notes 35-81) ---------------------------------------------------
  // Components: { sine: [f0, f1], tau, amp, delay } or { noise: true, hp, lp, tau, amp, am, delay, len }.
  var S = function (f0, f1, tau, amp, delay) { return { sine: [f0, f1], tau: tau, amp: amp == null ? 1 : amp, delay: delay || 0 }; };
  var N = function (hp, lp, tau, amp, extra) { var c = { noise: true, hp: hp, lp: lp, tau: tau, amp: amp == null ? 1 : amp, delay: 0 }; if (extra) Object.keys(extra).forEach(function (k) { c[k] = extra[k]; }); return c; };
  var METAL = function (freqs, tau, amp) { return freqs.map(function (f, i) { return S(f, f, tau, (amp || 1) / (1 + i * 0.4)); }); };
  var tom = function (f) { return [S(f * 1.5, f, 0.28), N(1500, 0, 0.01, 0.2)]; };
  var DRUMS = {
    35: [S(110, 45, 0.16, 1), N(2000, 0, 0.006, 0.25)],
    36: [S(150, 50, 0.12, 1), N(2500, 0, 0.005, 0.3)],
    37: [S(420, 400, 0.02, 0.7), N(1500, 0, 0.012, 0.5)],
    38: [S(220, 170, 0.09, 0.6), N(900, 0, 0.14, 0.9)],
    39: [N(900, 6000, 0.012, 0.8), N(900, 6000, 0.012, 0.8, { delay: 0.011 }), N(900, 6000, 0.14, 0.9, { delay: 0.022 })],
    40: [S(260, 200, 0.07, 0.6), N(1500, 0, 0.1, 1)],
    41: tom(87), 43: tom(98), 45: tom(110), 47: tom(123), 48: tom(131), 50: tom(147),
    42: [N(7000, 0, 0.025, 1)], 44: [N(7000, 0, 0.04, 0.9)], 46: [N(6500, 0, 0.3, 1)],
    49: [N(5000, 0, 0.9, 1)].concat(METAL([380, 560], 0.4, 0.1)), 57: [N(5500, 0, 0.7, 1)].concat(METAL([430, 610], 0.3, 0.1)),
    52: [N(4500, 0, 1.0, 1)], 55: [N(6000, 0, 0.35, 1)],
    51: [N(6500, 0, 0.5, 0.4)].concat(METAL([520, 790, 1180], 0.5, 0.5)), 59: [N(7000, 0, 0.45, 0.4)].concat(METAL([560, 830, 1250], 0.45, 0.5)),
    53: METAL([760, 1140, 1650, 2400], 0.45, 1),
    54: [N(6500, 0, 0.07, 1, { am: 40 })], 56: [S(560, 560, 0.15, 1), S(845, 845, 0.15, 0.8)],
    58: [N(1200, 4000, 0.45, 1, { am: 75 })],
    60: [S(520, 430, 0.07, 1), N(2000, 0, 0.006, 0.2)], 61: [S(380, 310, 0.09, 1), N(2000, 0, 0.006, 0.2)],
    62: [S(330, 300, 0.05, 1), N(2000, 0, 0.004, 0.2)], 63: [S(300, 270, 0.14, 1), N(2000, 0, 0.005, 0.2)], 64: [S(220, 190, 0.2, 1), N(2000, 0, 0.005, 0.2)],
    65: [S(800, 800, 0.14, 0.8), S(1630, 1630, 0.1, 0.5), N(3000, 0, 0.012, 0.3)], 66: [S(560, 560, 0.18, 0.8), S(1130, 1130, 0.12, 0.5), N(3000, 0, 0.012, 0.3)],
    67: [S(900, 900, 0.2, 1), S(1350, 1350, 0.15, 0.7)], 68: [S(620, 620, 0.24, 1), S(930, 930, 0.18, 0.7)],
    69: [N(5000, 0, 0.05, 1, { am: 30 })], 70: [N(4500, 0, 0.035, 1)],
    71: [S(2700, 2900, 0.1, 1, 0)], 72: [S(2700, 2700, 0.5, 1)],
    73: [N(2500, 7000, 0.12, 1, { am: 45 })], 74: [N(2500, 7000, 0.4, 1, { am: 45 })],
    75: [S(2500, 2500, 0.03, 1)], 76: [S(1800, 1700, 0.045, 1), N(2000, 0, 0.004, 0.3)], 77: [S(1100, 1000, 0.055, 1), N(2000, 0, 0.004, 0.3)],
    78: [S(300, 520, 0.12, 1)], 79: [S(300, 700, 0.3, 1)],
    80: METAL([3100, 4200, 6200], 0.12, 1), 81: METAL([3100, 4200, 6200], 0.8, 1)
  };

  function drumRecipe(note) {
    var d = DRUMS[note];
    if (!d) throw new RangeError('GM drum note 35-81');
    return d;
  }

  function drumHit(note, rate, seed) {
    var comps = drumRecipe(note);
    var len = Math.round(1.6 * rate);
    var out = new Float32Array(len);
    comps.forEach(function (c, ci) {
      var delay = Math.round((c.delay || 0) * rate);
      var tau = c.tau;
      var n = Math.min(len - delay, Math.round(Math.min(tau * 7, 1.5) * rate));
      var x = new Float32Array(n);
      var i;
      var t;
      if (c.noise) {
        var rnd = rng(seed + ci * 101);
        for (i = 0; i < n; i++) x[i] = rnd();
        if (c.hp) highpass(x, c.hp, rate);
        if (c.lp) lowpass(x, c.lp, rate);
        for (i = 0; i < n; i++) {
          t = i / rate;
          x[i] *= Math.exp(-t / tau) * (c.am ? 0.5 + 0.5 * Math.sin(TWO_PI * c.am * t) : 1);
        }
      } else {
        var ph = 0;
        for (i = 0; i < n; i++) {
          t = i / rate;
          var f = c.sine[1] + (c.sine[0] - c.sine[1]) * Math.exp(-t / (Math.min(tau, 0.06)));
          ph += TWO_PI * f / rate;
          x[i] = Math.sin(ph) * Math.exp(-t / tau);
        }
      }
      for (i = 0; i < n; i++) out[delay + i] += x[i] * c.amp;
    });
    return out;
  }

  /**
   * Render a GM drum note as `hits` strikes `spacing` seconds apart.
   * @returns {Float32Array} mono, peak-normalised to 0.5
   */
  function renderDrum(note, opts) {
    var o = opts || {};
    var rate = o.rate || SAMPLE_RATE;
    var hits = o.hits || 3;
    var spacing = o.spacing || 0.45;
    var one = drumHit(note, rate, note * 7 + 3);
    var step = Math.round(spacing * rate);
    var out = new Float32Array(step * (hits - 1) + one.length);
    for (var h = 0; h < hits; h++) for (var i = 0; i < one.length; i++) out[h * step + i] += one[i];
    return normalize(out, 0.5);
  }

  /**
   * Mix a whole song: many notes at their own times, overlapping.
   * @param {Array<{time:number, dur:number, vel?:number, program?:number, midi?:number, drum?:number}>} events
   *   seconds; `drum` (35-81) for the kit, else `program` (0-127) and `midi`
   * @param {{rate?:number, tail?:number, maxHold?:number}} [opts]
   * @returns {Float32Array} mono, peak-normalised to 0.5
   */
  function renderEvents(events, opts) {
    var o = opts || {};
    var rate = o.rate || SAMPLE_RATE;
    var tail = o.tail || 0.35;
    var maxHold = o.maxHold || 4;
    var end = 0;
    events.forEach(function (e) { end = Math.max(end, e.time + Math.min(e.dur, maxHold)); });
    var total = Math.round((end + tail + 1.7) * rate);
    var out = new Float32Array(total);
    var notes = {};
    var hits = {};
    events.forEach(function (e, i) {
      var start = Math.round(e.time * rate);
      var gain = 0.35 + 0.65 * (e.vel == null ? 0.8 : e.vel);
      var one;
      if (e.drum != null) {
        one = hits[e.drum] || (hits[e.drum] = drumHit(e.drum, rate, e.drum * 7 + 3));
      } else {
        var hold = Math.max(0.05, Math.min(maxHold, Math.round(e.dur * 20) / 20));
        var key = e.program + ':' + e.midi + ':' + hold;
        one = notes[key];
        if (!one) {
          var r = recipe(e.program);
          var seed = e.program * 31 + e.midi;
          var n = Math.round((hold + tail) * rate) + 1;
          if (r.sfx) one = sfxProgram(r, e.midi, hold, tail, rate, seed);
          else {
            one = new Float32Array(n);
            if (r.drumPitch) pitchedDrumProgram(r, e.midi, hold, tail, rate, one, 0, seed);
            else if (r.cymbalSwell) cymbalSwell(hold, tail, rate, one, 0, seed);
            else addNote(r, e.midi, hold, tail, rate, one, 0, seed);
          }
          notes[key] = one;
        }
      }
      var scale = (e.drum != null ? 0.5 : r_sfx(e.program) ? 0.4 : 1) * gain;
      var lim = Math.min(one.length, total - start);
      if (e.bend && e.bend.length && e.drum == null) {
        // Pitch wheel: play the cached note back at a changing rate (the note's own tail follows the last bend).
        var pos = 0;
        var bi = 0;
        var semis = 0;
        for (var k2 = 0; k2 < lim; k2++) {
          var tt = k2 / rate;
          while (bi < e.bend.length && e.bend[bi].time <= tt) semis = e.bend[bi++].semis;
          var i0 = Math.floor(pos);
          if (i0 + 1 >= one.length) break;
          var fr = pos - i0;
          out[start + k2] += (one[i0] * (1 - fr) + one[i0 + 1] * fr) * scale;
          pos += Math.pow(2, semis / 12);
        }
        return;
      }
      for (var k = 0; k < lim; k++) out[start + k] += one[k] * scale;
      void i;
    });
    return normalize(out, 0.5);
  }
  function r_sfx(program) { return recipe(program).sfx ? true : false; }

  var SCALE_MIDI = [60, 62, 64, 65, 67, 69, 71, 72]; // the chip lab's patch scale, as MIDI notes

  return {
    SAMPLE_RATE: SAMPLE_RATE,
    SCALE_MIDI: SCALE_MIDI,
    recipe: recipe,
    drumRecipe: drumRecipe,
    renderProgram: renderProgram,
    renderDrum: renderDrum,
    renderEvents: renderEvents,
    normalize: normalize
  };
});
