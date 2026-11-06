/**
 * Play parsed KMS notation through the MIT `opl3` YMF262 emulator (OPL2 mode, one melodic channel).
 * Retail .vce instrument banks are not bundled; a fixed piano-like patch is used until PC install files are available.
 */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var api = factory(isNode ? require('opl3') : null, isNode ? require('./kms') : root.NhlKms);
  if (isNode) module.exports = api;
  else root.NhlKmsPlayer = api;
})(typeof self !== 'undefined' ? self : this, function (OplPkg, Kms) {
  'use strict';

  var RATE = 49716;
  var OPL3 = OplPkg && OplPkg.OPL3;

  function midiToFnum(midi) {
    var freq = 440 * Math.pow(2, (midi - 69) / 12);
    var fnum = Math.round(freq * Math.pow(2, 20 - 4) / 49716);
    if (fnum < 0) fnum = 0;
    if (fnum > 0x3ff) fnum = 0x3ff;
    var block = 0;
    while (fnum > 0x3ff) { block++; fnum >>= 1; }
    return { fnum: fnum & 0x3ff, block: block & 7 };
  }

  function loadDefaultVoice(chip, ch) {
    var c = ch & 7;
    var base = 0;
    var w = function (reg, val) { chip.write(base, reg, val); };
    w(0xbd, 0x00);
    w(0x08, 0x00);
    var op = function (off, vals) { vals.forEach(function (v, i) { w(off + i, v); }); };
    op(0x20 + c, [0x01, 0x01, 0x3e, 0x01]);
    op(0x40 + c, [0x00, 0x00, 0x00, 0x00]);
    op(0x60 + c, [0xf0, 0xf0, 0xf0, 0xf0]);
    op(0x80 + c, [0xff, 0xff, 0xff, 0xff]);
    op(0xe0 + c, [0x00, 0x00, 0x00, 0x00]);
    w(0xc0 + c, 0x30);
  }

  var blockLo = {};

  function keyOn(chip, ch, midi, vel) {
    var c = ch & 7;
    var f = midiToFnum(midi);
    var hi = (f.block << 2) | (f.fnum >> 8);
    blockLo[c] = hi;
    chip.write(0, 0xa0 + c, f.fnum & 0xff);
    var level = Math.max(0, Math.min(127, vel));
    chip.write(0, 0x43 + c, (0x3f - (level >> 2)) & 0x3f);
    chip.write(0, 0xb0 + c, hi | 0x20);
  }

  function keyOff(chip, ch) {
    var c = ch & 7;
    chip.write(0, 0xb0 + c, (blockLo[c] || 0) & ~0x20);
  }

  /**
   * @param {object} parsed result of Kms.parse
   * @param {{seconds?:number}} opts
   * @returns {Int16Array} interleaved stereo at 49716 Hz
   */
  function render(parsed, opts) {
    if (!OPL3) throw new Error('opl3 is only available in Node');
    var seconds = (opts && opts.seconds) || 1.5;
    var chip = new OPL3();
    loadDefaultVoice(chip, 0);
    var tempo = 120;
    var tick = 0;
    var notes = [];
    parsed.tracks.forEach(function (tr) {
      if (tr.id === 'HDR1') return;
      var t = 0;
      tr.events.forEach(function (e) {
        t += e.delay || 0;
        if (e.kind === 'tempo') tempo = Math.max(20, e.tempo || tempo);
        if (e.kind === 'note') {
          var midi = (e.code & 0x7f) + 35;
          var dur = Math.max(1, e.b || 24);
          notes.push({ tick: t, midi: midi, dur: dur });
        }
      });
    });
    notes.sort(function (a, b) { return a.tick - b.tick; });
    var tps = tempo;
    var samples = Math.ceil(seconds * RATE);
    var out = new Int16Array(samples * 2);
    var ni = 0;
    var onUntil = -1;
    for (var s = 0; s < samples; s++) {
      var sec = s / RATE;
      var gameTick = Math.floor(sec * tps);
      while (ni < notes.length && notes[ni].tick <= gameTick) {
        keyOn(chip, 0, notes[ni].midi, 100);
        onUntil = gameTick + notes[ni].dur;
        ni++;
      }
      if (onUntil >= 0 && gameTick >= onUntil) { keyOff(chip, 0); onUntil = -1; }
      chip.read(out, s * 2);
    }
    keyOff(chip, 0);
    return out;
  }

  return { RATE: RATE, render: render, midiToFnum: midiToFnum };
});
