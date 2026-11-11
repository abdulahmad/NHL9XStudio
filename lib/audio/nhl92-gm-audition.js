/**
 * Plans and renders one mapping audition: an NHL '92 sound next to a plain GM-style reference.
 *
 *   plan()        - what to play for a pick: the picked side and the mapped side, plus the text to show
 *   renderSide()  - one side as mono samples, peak-normalised so both sides play at the same level
 *   join()        - picked side, a pause, mapped side, as one buffer
 *
 * UMD: used by public/chip-lab.js in the browser and by test/nhl92-gm-map.js in Node. Read-only
 * over the drivers, patches and data.
 */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var api = factory(
    isNode ? require('./nhl92-gm-map') : root.Nhl92GmMap,
    isNode ? require('./gm-reference') : root.Nhl92GmReference,
    isNode ? require('./nhl92-z80-audio') : root.Nhl92Z80Audio
  );
  if (isNode) module.exports = api;
  else root.Nhl92GmAudition = api;
})(typeof self !== 'undefined' ? self : this, function (G, R, A) {
  var LEVEL = 0.5;
  // The pitch the songs play the drum patches at (A0, F#1); anything else is auditioned at C4.
  var RETAIL_HIT_MIDI = { 3: 21, 4: 30 };
  var DIRECTIONS = ['n2g', 'g2n', 'drum'];

  var firstSentence = function (s) { var i = s.indexOf('. '); return i < 0 ? s.replace(/\.$/, '') : s.slice(0, i); };

  /** Options for the pick menu: [{ value, label, group? }]. */
  function picks(map, dir) {
    if (dir === 'n2g') {
      return map.nhl92ToGm.patches.map(function (e) {
        return { value: e.patch, label: String(e.patch).padStart(2, '0') + ' · ' + firstSentence(e.character) };
      });
    }
    if (dir === 'g2n') {
      return G.PROGRAM_NAMES.map(function (name, p) {
        return { value: p, label: p + ' · ' + name, group: G.familyOf(p).name };
      });
    }
    return map.gmToNhl92.drums.map(function (d) { return { value: d.note, label: d.note + ' · ' + d.name }; });
  }

  function patchSide(target, style, midiOverride) {
    var midi = target.midi != null ? target.midi : midiOverride != null ? midiOverride : (style === 'hits' ? 60 : null);
    return { kind: 'patch', patch: target.patch, style: style, midi: midi };
  }

  function gmSide(target) {
    return target.kind === 'drum' ? { kind: 'drum', note: target.note } : { kind: 'program', program: target.program };
  }

  function nhlSide(target, style) {
    return target.kind === 'dac' ? { kind: 'dac', sfx: target.sfx } : patchSide(target, style);
  }

  /**
   * @param {object} map parsed nhl92-gm-map.json
   * @param {'n2g'|'g2n'|'drum'} dir patch -> GM, GM program -> NHL '92, or GM drum -> NHL '92
   * @param {number} pick patch 0-21, GM program 0-127 or GM drum note 35-81
   * @param {boolean} [runnerUp] audition the runner-up instead of the match
   */
  function plan(map, dir, pick, runnerUp) {
    if (DIRECTIONS.indexOf(dir) < 0) throw new RangeError('direction: ' + DIRECTIONS.join(', '));
    var entry;
    var picked;
    var mapped;
    var info;
    if (dir === 'n2g') {
      entry = map.nhl92ToGm.patches[pick];
      if (!entry) throw new RangeError('patch 0-21');
      var hits = entry.target.kind === 'drum';
      picked = patchSide({ patch: pick }, hits ? 'hits' : 'scale', hits ? (RETAIL_HIT_MIDI[pick] != null ? RETAIL_HIT_MIDI[pick] : 60) : null);
      mapped = gmSide(runnerUp ? entry.runnerUp : entry.target);
      info = { match: entry.target, runnerUp: entry.runnerUp, reason: entry.reason, confidence: entry.confidence, source: 'patch ' + pick, character: entry.character };
    } else if (dir === 'g2n') {
      var r = G.resolveProgram(map, pick);
      picked = { kind: 'program', program: pick };
      mapped = nhlSide(runnerUp ? r.runnerUp : r.target, 'scale');
      info = { match: r.target, runnerUp: r.runnerUp, reason: r.reason, confidence: r.confidence, source: r.source === 'override' ? 'override' : G.familyOf(pick).name.toLowerCase() + ' family default' };
    } else {
      entry = G.resolveDrum(map, pick);
      if (!entry) throw new RangeError('GM drum note 35-81');
      picked = { kind: 'drum', note: pick };
      mapped = nhlSide(runnerUp ? entry.runnerUp : entry.target, 'hits');
      info = { match: entry.target, runnerUp: entry.runnerUp, reason: entry.reason, fit: entry.fit, source: 'drum ' + pick };
    }
    return { dir: dir, pick: pick, runnerUp: !!runnerUp, picked: picked, mapped: mapped, info: info };
  }

  function sideLabel(side) {
    if (side.kind === 'patch') return "NHL '92 patch " + side.patch + (side.style === 'hits' ? ' hits at ' + (side.midi != null ? 'MIDI ' + side.midi : 'C4') : ' scale');
    if (side.kind === 'dac') return "NHL '92 DAC sample (SFX " + side.sfx + ')';
    if (side.kind === 'program') return 'GM reference: ' + G.programName(side.program) + ' (' + side.program + ')';
    return 'GM reference drum: ' + G.drumName(side.note) + ' (' + side.note + ')';
  }

  /** Frames the Z80 needs to play a DAC sample to its end, plus a tail (same maths as the step 4 renders). */
  function dacFrames(rom, entry) {
    var start = A.SOUND_BASE + entry.off + 1;
    var n = 0;
    while (rom[start + n] !== 0) n += 1;
    return Math.ceil((n * (161 + 17 * (entry.rate || 256))) / A.FRAME_TSTATES) + 30;
  }

  function dacEntry(rom, sfx) {
    var handler = G.sfxHandler(rom, sfx);
    var entry = A.DAC_SFX.find(function (e) { return e.rom === handler; });
    if (!entry) throw new Error('SFX ' + sfx + ' (handler $' + handler.toString(16) + ') does not start a DAC sample');
    return entry;
  }

  /** Stereo Int16 (the Z80/YM pipeline) to mono float with the chip's idle offset removed, peak-normalised. */
  function monoFromPcm(pcm) {
    var n = pcm.length / 2;
    var m = new Float32Array(n);
    var i;
    for (i = 0; i < n; i++) m[i] = (pcm[2 * i] + pcm[2 * i + 1]) / 2 / 32768;
    var idle = Array.prototype.slice.call(m.subarray(0, Math.min(2000, n))).sort(function (a, b) { return a - b; })[Math.floor(Math.min(2000, n) / 2)] || 0;
    for (i = 0; i < n; i++) m[i] -= idle;
    return R.normalize(m, LEVEL);
  }

  /**
   * @param {object} side from plan()
   * @param {{rom:Uint8Array, renderScript:function(object[]):(Int16Array|Promise<Int16Array>)}} env renderScript runs a
   *   Z80 vblank script through the driver and chips and returns stereo Int16 PCM at A.SAMPLE_RATE.
   * @returns {Promise<Float32Array>} mono at A.SAMPLE_RATE (= R.SAMPLE_RATE)
   */
  async function renderSide(side, env) {
    if (side.kind === 'program') return R.renderProgram(side.program, R.SCALE_MIDI);
    if (side.kind === 'drum') return R.renderDrum(side.note);
    if (side.kind === 'dac') {
      var entry = dacEntry(env.rom, side.sfx);
      return monoFromPcm(await env.renderScript(A.sfxScript(entry, { frames: dacFrames(env.rom, entry) })));
    }
    var script;
    if (side.style === 'hits') {
      var idx = Math.max(0, Math.min(95, side.midi - 12));
      script = A.patchScaleScript(env.rom, side.patch, { notes: [idx, idx, idx], hold: 12, gap: 24, tail: 30 });
    } else {
      script = A.patchScaleScript(env.rom, side.patch);
    }
    return monoFromPcm(await env.renderScript(script));
  }

  /** a, a pause, b as one mono buffer. */
  function join(a, b, pauseSeconds, rate) {
    var gap = Math.round((pauseSeconds == null ? 0.4 : pauseSeconds) * (rate || A.SAMPLE_RATE));
    var out = new Float32Array(a.length + gap + b.length);
    out.set(a, 0);
    out.set(b, a.length + gap);
    return out;
  }

  return {
    SAMPLE_RATE: A.SAMPLE_RATE,
    RETAIL_HIT_MIDI: RETAIL_HIT_MIDI,
    DIRECTIONS: DIRECTIONS,
    picks: picks,
    plan: plan,
    sideLabel: sideLabel,
    dacEntry: dacEntry,
    dacFrames: dacFrames,
    renderSide: renderSide,
    monoFromPcm: monoFromPcm,
    join: join
  };
});
