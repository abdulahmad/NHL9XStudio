/**
 * NHL '92 patch analysis for the General MIDI mapping (docs/NHL92-GM-MAP.md).
 *
 * Two read-only views over what `nhl92-sound-data.js` already parses:
 *   - decodePatch(): the 26 patch register bytes as YM2612 parameters
 *   - patchUsage():  where each patch is played in the 5 songs (channel, note range, length)
 *
 * Nothing here touches the drivers, the patches or the data. UMD: Node and browser.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92GmAnalysis = api;
})(typeof self !== 'undefined' ? self : this, function () {
  /**
   * The Z80 writes the 26 bytes to YM registers $30,$38,$34,$3C,$40,$48,$44,$4C,...,$B0,$B4
   * (table at Z80 $00C5). Within each group of four the order is therefore op1, op2, op3, op4
   * (the chip's own slot order is op1, op3, op2, op4). Groups: DT/MUL, TL, RS/AR, AM/D1R, D2R,
   * SL/RR, then $B0 (feedback, algorithm) and $B4 (pan, AMS, FMS).
   */
  var CARRIERS = { 0: [3], 1: [3], 2: [3], 3: [3], 4: [1, 3], 5: [1, 2, 3], 6: [1, 2, 3], 7: [0, 1, 2, 3] };

  /** Detune register value (0-7) to signed steps: 0-3 are 0..+3, 4-7 are 0..-3. */
  function detuneSteps(dt) {
    return dt < 4 ? dt : -(dt - 4);
  }

  function decodePatch(patch) {
    var r = patch.registers;
    var algorithm = r[24] & 7;
    var carriers = CARRIERS[algorithm];
    var ops = [];
    for (var i = 0; i < 4; i++) {
      var dt = (r[i] >> 4) & 7;
      var mul = r[i] & 15;
      ops.push({
        op: i + 1,
        carrier: carriers.indexOf(i) >= 0,
        detune: detuneSteps(dt),
        multiple: mul === 0 ? 0.5 : mul,
        totalLevel: r[4 + i] & 127,
        rateScaling: (r[8 + i] >> 6) & 3,
        attackRate: r[8 + i] & 31,
        amplitudeModulation: (r[12 + i] >> 7) & 1,
        decay1Rate: r[12 + i] & 31,
        decay2Rate: r[16 + i] & 31,
        sustainLevel: (r[20 + i] >> 4) & 15,
        releaseRate: r[20 + i] & 15
      });
    }
    return {
      id: patch.id,
      algorithm: algorithm,
      feedback: (r[24] >> 3) & 7,
      pan: ['off', 'right', 'left', 'both'][(r[25] >> 6) & 3],
      ams: (r[25] >> 4) & 3,
      fms: r[25] & 7,
      noteOffset: patch.noteOffset,
      operators: ops
    };
  }

  /** Note-table index (note + patch offset + transpose) to MIDI note number: index 48 is C4 = 60. */
  function midiOfIndex(index) {
    return index + 12;
  }

  function median(sorted) {
    var n = sorted.length;
    if (!n) return null;
    return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  }

  /**
   * Walk each channel's order list once: patterns in order, `repeat` items replaying the previous
   * pattern, stopping at the first restart or song switch (a list with none ends where it ends;
   * the one-vblank SngTitle fall-through is not followed). For each note record the patch in
   * effect and the MIDI pitch, and the frames it lasts (duration units x song tempo).
   * Returns per patch: songs/channels it plays on, MIDI range, note counts, frames, modulation.
   */
  function patchUsage(data) {
    var patchAt = new Map();
    data.patternEntries.forEach(function (p) { patchAt.set(p.start, p); });
    var out = data.patches.map(function (p) { return { id: p.id, notes: 0, frames: 0, channels: {}, songs: {} }; });
    var warnings = [];
    data.songs.forEach(function (song) {
      song.orderLists.forEach(function (listStart, ch) {
        var list = data.orderLists.find(function (l) { return l.start === listStart; });
        var state = { patch: null, transpose: 0, duration: null, modulation: null, envelope: null };
        var prev = null;
        var played = [];
        var halted = false;
        list.items.forEach(function (it) {
          if (halted) return;
          if (it.kind === 'restart' || it.kind === 'song') { halted = true; return; }
          if (it.kind === 'pattern') { played.push(it.pattern); prev = it.pattern; }
          if (it.kind === 'repeat') for (var k = 0; k < it.count; k++) played.push(prev);
        });
        played.forEach(function (pat) {
          patchAt.get(pat).events.forEach(function (e) {
            if (e.kind === 'instrument') { state.patch = e.patch; state.modulation = null; state.envelope = null; }
            else if (e.kind === 'transpose') state.transpose = e.semitones;
            else if (e.kind === 'duration') state.duration = e.units * song.tempo;
            else if (e.kind === 'modulation') state.modulation = { delay: e.delay, delta: e.delta };
            else if (e.kind === 'envelope') state.envelope = { envelope: e.envelope, speed: e.speed };
            else if (e.kind === 'envelopeOff') state.envelope = null;
            else if (e.kind === 'note') {
              if (state.patch == null || state.duration == null) { warnings.push('song ' + song.id + ' ch' + ch + ': note before ' + (state.patch == null ? 'instrument' : 'duration')); return; }
              var index = (e.note + data.patches[state.patch].noteOffset + state.transpose) & 0xff;
              var u = out[state.patch];
              var key = song.id + ':' + ch;
              var c = u.channels[key] || (u.channels[key] = { song: song.id, songName: song.name, channel: ch, notes: 0, frames: 0, midi: [], modulated: 0, enveloped: 0 });
              c.notes += 1;
              c.frames += state.duration;
              c.midi.push(midiOfIndex(index));
              if (state.modulation) c.modulated += 1;
              if (state.envelope) c.enveloped += 1;
              u.notes += 1;
              u.frames += state.duration;
              u.songs[song.id] = true;
            }
          });
        });
      });
    });
    return {
      warnings: warnings,
      patches: out.map(function (u) {
        var channels = Object.keys(u.channels).map(function (k) {
          var c = u.channels[k];
          var sorted = c.midi.slice().sort(function (a, b) { return a - b; });
          return {
            song: c.song,
            songName: c.songName,
            channel: c.channel,
            notes: c.notes,
            frames: c.frames,
            midiMin: sorted[0],
            midiMax: sorted[sorted.length - 1],
            midiMedian: median(sorted),
            distinctPitches: new Set(sorted).size,
            meanNoteFrames: Math.round((c.frames / c.notes) * 10) / 10,
            modulatedNotes: c.modulated,
            pitchEnvelopeNotes: c.enveloped
          };
        });
        var all = [];
        Object.keys(u.channels).forEach(function (k) { all = all.concat(u.channels[k].midi); });
        all.sort(function (a, b) { return a - b; });
        return {
          id: u.id,
          notes: u.notes,
          frames: u.frames,
          songs: Object.keys(u.songs).map(Number),
          midiMin: all.length ? all[0] : null,
          midiMax: all.length ? all[all.length - 1] : null,
          midiMedian: median(all),
          distinctPitches: new Set(all).size,
          channels: channels
        };
      })
    };
  }

  /**
   * Which SFX play each patch: every FM SFX stream's `$80 id` instrument command, by SFX ID
   * (names come from nhl92-sfx-names.js, not from the shifted handler labels).
   */
  function sfxUsage(data) {
    var byStream = new Map();
    data.sfxStreams.forEach(function (s) { byStream.set(s.start, s); });
    var out = data.patches.map(function () { return []; });
    data.sfx.forEach(function (s) {
      s.actions.forEach(function (a) {
        if (a.type !== 'fm') return;
        var seen = {};
        byStream.get(a.stream).events.forEach(function (e) {
          if (e.kind === 'instrument' && !seen[e.patch]) {
            seen[e.patch] = true;
            if (out[e.patch].indexOf(s.id) < 0) out[e.patch].push(s.id);
          }
        });
      });
    });
    out.forEach(function (ids) { ids.sort(function (a, b) { return a - b; }); });
    return out;
  }

  // --- Measuring a rendered note ------------------------------------------------------
  // Plain signal measurements of one patch note (stereo Int16 PCM from the step 4 pipeline).
  // They describe the render; they are not a judgement of how it sounds. Values are rounded
  // coarsely so another JS engine's last-bit differences cannot change them.

  function fft(re, im) {
    var n = re.length;
    for (var i = 1, j = 0; i < n; i++) {
      var b = n >> 1;
      for (; j & b; b >>= 1) j ^= b;
      j ^= b;
      if (i < j) { var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len;
      var wr = Math.cos(ang);
      var wi = Math.sin(ang);
      for (var s = 0; s < n; s += len) {
        var cr = 1;
        var ci = 0;
        for (var k = 0; k < len / 2; k++) {
          var a = s + k;
          var c = s + k + len / 2;
          var tr = re[c] * cr - im[c] * ci;
          var ti = re[c] * ci + im[c] * cr;
          re[c] = re[a] - tr;
          im[c] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
          var nr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = nr;
        }
      }
    }
  }

  function round(v, step) {
    return Math.round(v / step) * step;
  }

  /**
   * @param {Int16Array} pcm interleaved stereo, from the start of the render
   * @param {number} sampleRate
   * @param {number} nominalHz note-table pitch of the probe note
   * @param {number} holdMs how long the note was held before key-off (from key-on)
   */
  function measureNote(pcm, sampleRate, nominalHz, holdMs) {
    var n = pcm.length / 2;
    var m = new Float64Array(n);
    var i;
    for (i = 0; i < n; i++) m[i] = (pcm[2 * i] + pcm[2 * i + 1]) / 2 / 32768;
    var idle = Array.prototype.slice.call(m.subarray(0, 2000)).sort(function (a, b) { return a - b; })[1000];
    for (i = 0; i < n; i++) m[i] -= idle;

    var W = Math.round(sampleRate * 0.005);
    var nw = Math.floor(n / W);
    var env = [];
    var max = 0;
    for (var w = 0; w < nw; w++) {
      var sum = 0;
      for (i = 0; i < W; i++) sum += m[w * W + i] * m[w * W + i];
      env.push(Math.sqrt(sum / W));
      if (env[w] > max) max = env[w];
    }
    var on = max < 1e-4 ? -1 : env.findIndex(function (v) { return v > max * 0.05; });
    if (on < 0) return { silent: true };
    var db = function (v) { return 20 * Math.log10(Math.max(v, 1e-9) / max); };
    var dbAt = function (ms) { var k = on + Math.round(ms / 5); return k < nw ? db(env[k]) : -99; };
    var peak = on;
    for (var k = on; k < nw; k++) if (env[k] > env[peak]) peak = k;
    var t90 = on;
    while (t90 < nw && env[t90] < max * 0.9) t90++;
    var koff = on + Math.round(holdMs / 5);
    var ref = env[Math.min(koff - 2, nw - 1)];
    var rel = koff;
    while (rel < nw && env[rel] > ref * 0.1) rel++;

    function spectrum(startMs) {
      var N = 4096;
      var st = on * W + Math.round(sampleRate * startMs / 1000);
      if (st + N > n) return null;
      var re = new Float64Array(N);
      var im = new Float64Array(N);
      for (var q = 0; q < N; q++) re[q] = m[st + q] * (0.5 - 0.5 * Math.cos(2 * Math.PI * q / N));
      fft(re, im);
      var k0 = Math.max(1, Math.round(40 * N / sampleRate));
      var k1 = Math.min(N / 2 - 1, Math.round(16000 * N / sampleRate));
      var sw = 0;
      var sp = 0;
      var lg = 0;
      var ar = 0;
      for (var b = k0; b < k1; b++) {
        var p = re[b] * re[b] + im[b] * im[b];
        sw += p * b * sampleRate / N;
        sp += p;
        lg += Math.log(p + 1e-18);
        ar += p;
      }
      var L = 2048;
      var lo = Math.floor(sampleRate / 4000);
      var hi = Math.floor(sampleRate / 25);
      var x = m.subarray(st, st + L + hi + 1);
      var e0 = 0;
      for (q = 0; q < L; q++) e0 += x[q] * x[q];
      var best = 0;
      for (var lag = lo; lag <= hi; lag++) {
        var c2 = 0;
        var e1 = 0;
        for (q = 0; q < L; q++) { c2 += x[q] * x[q + lag]; e1 += x[q + lag] * x[q + lag]; }
        var r = c2 / Math.sqrt(e0 * e1 + 1e-18);
        if (r > best) best = r;
      }
      return {
        centroidHz: sp > 0 ? sw / sp : 0,
        flatness: Math.exp(lg / (k1 - k0)) / (ar / (k1 - k0)),
        periodicity: best
      };
    }
    var early = spectrum(30);
    var late = spectrum(Math.max(150, holdMs * 0.5));
    var levelKeyOff = dbAt(holdMs - 10);
    var attackMs = (t90 - on) * 5;
    var shape;
    if (attackMs >= 150) shape = 'swell';
    else if (levelKeyOff > -6) shape = 'sustained';
    else if (levelKeyOff > -20 && dbAt(400) > -12) shape = 'slow decay';
    else shape = 'plucked';
    return {
      attackMs: round(attackMs, 5),
      peakMs: round((peak - on) * 5, 5),
      level100msDb: Math.round(dbAt(100)),
      level400msDb: Math.max(-60, Math.round(dbAt(400))),
      levelAtKeyOffDb: Math.max(-60, Math.round(levelKeyOff)),
      releaseMs: round((rel - koff) * 5, 5),
      shape: shape,
      centroidHz: early ? round(early.centroidHz, 50) : null,
      brightness: early ? Math.round(early.centroidHz / nominalHz * 10) / 10 : null,
      centroidLateHz: late ? round(late.centroidHz, 50) : null,
      flatness: early ? Math.round(early.flatness * 100) / 100 : null,
      periodicity: early ? Math.round(early.periodicity * 100) / 100 : null
    };
  }

  return {
    CARRIERS: CARRIERS,
    decodePatch: decodePatch,
    patchUsage: patchUsage,
    sfxUsage: sfxUsage,
    measureNote: measureNote,
    midiOfIndex: midiOfIndex,
    detuneSteps: detuneSteps
  };
});
