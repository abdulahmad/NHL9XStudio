/**
 * Mapping audition for NHLPA 93 / NHL 94 (Genesis): one of the game's instruments next to a plain GM-style reference,
 * the same idea as nhl92-gm-audition.js. The game side is the retail 68k + Z80 drivers playing a small song (a C major
 * scale, or three hits for drum-like patches) that goes into a COPY of the sound slice (nhl9x-stream.js romWithSong).
 *
 *   patchSong()   - the song model that plays one patch
 *   picks()       - the options of the pick menu for a direction
 *   plan()        - what to play for a pick: the picked side and the mapped side, plus the text to show
 *   renderSide()  - one side as mono samples, peak-normalised so both sides play at the same level
 *
 * The map is data/audio/nhl9x-gm-map.json (shared by both games). UMD: public/chip-lab.js, public/sound-test-view.js
 * and test/nhl9x-gm-audition.js.
 */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var api = factory(
    isNode ? require('./nhl9x-stream') : root.Nhl9xStream,
    isNode ? require('./nhl92-gm-map') : root.Nhl92GmMap,
    isNode ? require('./gm-reference') : root.Nhl92GmReference,
    isNode ? require('./nhl92-sound-chain') : root.Nhl92SoundChain
  );
  if (isNode) module.exports = api;
  else root.Nhl9xGmAudition = api;
})(typeof self !== 'undefined' ? self : this, function (Stream, G, R, Chain) {
  var LEVEL = 0.5;
  var DIRECTIONS = ['n2g', 'g2n', 'drum'];
  var HOLD = 18; // vblanks a note is held
  var GAP = 22; // vblanks between note starts
  var LEAD = 4; // vblanks before the first note
  var TAIL = 30; // vblanks after the last note ends
  var PCM_FIRST = 0x60;

  var firstSentence = function (s) { var i = s.indexOf('. '); return i < 0 ? s.replace(/\.$/, '') : s.slice(0, i); };
  var hex = function (n) { return n.toString(16).toUpperCase(); };

  /** Display name of a game patch: FM patches by number, PCM samples by their stream id. */
  function patchLabel(patch) {
    return patch >= PCM_FIRST ? 'PCM patch $' + hex(patch) : 'FM patch ' + patch;
  }

  /**
   * The song that plays patch `patch`: a scale (notes = MIDI numbers of the stream) or hits on one note.
   * @param {93|94} game
   * @param {number} patch FM patch 0-31 or PCM patch $60-$6E
   * @param {number[]} notes MIDI notes, one after another
   */
  function patchSong(game, patch, notes) {
    var song = Stream.emptySong(game);
    song.name = 'audition';
    notes.forEach(function (note, i) {
      song.notes.push({ t: LEAD + i * GAP, dur: HOLD, ch: 0, note: note, vel: 110, patch: patch });
    });
    song.ticks = LEAD + notes.length * GAP + TAIL;
    song.loopTick = null;
    return song;
  }

  /** Options for the pick menu: [{ value, label, group? }]. */
  function picks(map, dir) {
    if (dir === 'n2g') {
      return map.patches.map(function (e) {
        return { value: e.patch, label: (e.patch >= PCM_FIRST ? '$' + hex(e.patch) : String(e.patch).padStart(2, '0')) + ' · ' + firstSentence(e.character), group: e.patch >= PCM_FIRST ? 'PCM samples' : 'FM patches' };
      });
    }
    if (dir === 'g2n') {
      return G.PROGRAM_NAMES.map(function (name, p) {
        return { value: p, label: p + ' · ' + name, group: G.familyOf(p).name };
      });
    }
    var out = [];
    for (var n = 35; n <= 81; n++) out.push({ value: n, label: n + ' · ' + G.drumName(n) });
    return out;
  }

  var gmSide = function (target) {
    return target.kind === 'drum' ? { kind: 'drum', note: target.note } : { kind: 'program', program: target.program };
  };

  /** The note an auditioned patch is played at: drum-like patches at the note the songs use, melodic ones as a scale. */
  function nhlSide(map, patch, midi) {
    var e = map.patches.find(function (x) { return x.patch === patch; });
    var hits = !!e && e.target.kind === 'drum';
    var probed = e && e.measured && e.measured.noteProbed;
    if (hits) return { kind: 'patch', patch: patch, style: 'hits', midi: midi != null ? midi : (probed != null ? probed : 60) };
    return { kind: 'patch', patch: patch, style: 'scale', midi: null };
  }

  /**
   * @param {object} map parsed nhl9x-gm-map.json
   * @param {'n2g'|'g2n'|'drum'} dir game patch -> GM, GM program -> game patch, or GM drum -> game patch
   * @param {number} pick game patch, GM program 0-127 or GM drum note 35-81
   * @param {boolean} [runnerUp] audition the runner-up instead of the match (patch -> GM only)
   */
  function plan(map, dir, pick, runnerUp) {
    if (DIRECTIONS.indexOf(dir) < 0) throw new RangeError('direction: ' + DIRECTIONS.join(', '));
    var picked;
    var mapped;
    var info;
    if (dir === 'n2g') {
      var entry = map.patches.find(function (e) { return e.patch === pick; });
      if (!entry) throw new RangeError('no such patch ' + pick);
      picked = nhlSide(map, pick);
      mapped = gmSide(runnerUp && entry.runnerUp ? entry.runnerUp : entry.target);
      info = { match: entry.target, runnerUp: entry.runnerUp, reason: entry.reason, confidence: entry.confidence, source: patchLabel(pick), character: entry.character };
    } else if (dir === 'g2n') {
      var patch = Stream.patchForProgram(map, pick);
      var override = map.gmToNhl.programOverrides[String(pick)] != null;
      picked = { kind: 'program', program: pick };
      mapped = nhlSide(map, patch);
      info = { match: { kind: 'patch', patch: patch }, reason: override ? 'A fixed choice for this program.' : 'The patch the map sends to this program, else the ' + G.familyOf(pick).name.toLowerCase() + ' family patch.', source: override ? 'override' : 'patch map / family' };
    } else {
      var d = Stream.drumFor(map, pick);
      picked = { kind: 'drum', note: pick };
      mapped = { kind: 'patch', patch: d.patch, style: 'hits', midi: d.note };
      info = { match: { kind: 'patch', patch: d.patch, midi: d.note }, reason: d.name || '', source: 'drum ' + pick };
    }
    return { dir: dir, pick: pick, runnerUp: !!runnerUp, picked: picked, mapped: mapped, info: info };
  }

  function sideLabel(side, game) {
    var g = game === 94 ? 'NHL 94' : 'NHLPA 93';
    if (side.kind === 'patch') return g + ' ' + patchLabel(side.patch) + (side.style === 'hits' ? ' hits at MIDI ' + side.midi : ' scale');
    if (side.kind === 'program') return 'GM reference: ' + G.programName(side.program) + ' (' + side.program + ')';
    return 'GM reference drum: ' + G.drumName(side.note) + ' (' + side.note + ')';
  }

  /** Stereo Int16 to mono float with the chip's idle offset removed, peak-normalised. */
  function monoFromPcm(pcm) {
    var n = pcm.length / 2;
    var m = new Float32Array(n);
    var i;
    for (i = 0; i < n; i++) m[i] = (pcm[2 * i] + pcm[2 * i + 1]) / 2 / 32768;
    var idle = Array.prototype.slice.call(m.subarray(0, Math.min(2000, n))).sort(function (a, b) { return a - b; })[Math.floor(Math.min(2000, n) / 2)] || 0;
    for (i = 0; i < n; i++) m[i] -= idle;
    return R.normalize(m, LEVEL);
  }

  /** The notes a patch side plays. */
  function notesOf(side) {
    return side.style === 'hits' ? [side.midi, side.midi, side.midi] : R.SCALE_MIDI;
  }

  /**
   * Run `song` on the retail drivers over a copy of `env.image` and return the stereo Int16 PCM.
   * @param {{game:93|94, image:Uint8Array, driver:object, newChip:function():object, newPsg:function():object, keepChip?:boolean}} env
   *   keepChip leaves the chip from newChip alive (the caller reuses it)
   *   image is the sound slice placed at its ROM offset (data/fixtures/nhl9*-sound-slice.bin)
   */
  function runSong(env, song) {
    var copy = Stream.romWithSong(env.game, env.image, song);
    var chip = env.newChip();
    try {
      var chain = Chain.create({ rom: copy.rom, chip: chip, psg: env.newPsg(), driver: env.driver, keepLogs: false });
      var frames = 2 + song.ticks;
      var chunks = [];
      var total = 0;
      for (var f = 0; f < frames; f++) {
        chain.step(f === 1 ? [{ song: copy.id }] : null);
        var pcm = chain.take();
        chunks.push(pcm);
        total += pcm.length;
      }
      var out = new Int16Array(total);
      var at = 0;
      chunks.forEach(function (c) { out.set(c, at); at += c.length; });
      return out;
    } finally {
      if (chip && chip.dispose && !env.keepChip) chip.dispose();
    }
  }

  /**
   * @param {object} side from plan()
   * @param {object} env see runSong
   * @returns {Float32Array} mono at R.SAMPLE_RATE
   */
  function renderSide(side, env) {
    if (side.kind === 'program') return R.renderProgram(side.program, R.SCALE_MIDI);
    if (side.kind === 'drum') return R.renderDrum(side.note);
    return monoFromPcm(runSong(env, patchSong(env.game, side.patch, notesOf(side))));
  }

  /** a, a pause, b as one mono buffer. */
  function join(a, b, pauseSeconds, rate) {
    var gap = Math.round((pauseSeconds == null ? 0.4 : pauseSeconds) * (rate || R.SAMPLE_RATE));
    var out = new Float32Array(a.length + gap + b.length);
    out.set(a, 0);
    out.set(b, a.length + gap);
    return out;
  }

  return {
    SAMPLE_RATE: R.SAMPLE_RATE,
    DIRECTIONS: DIRECTIONS,
    PCM_FIRST: PCM_FIRST,
    patchLabel: patchLabel,
    patchSong: patchSong,
    notesOf: notesOf,
    picks: picks,
    plan: plan,
    sideLabel: sideLabel,
    runSong: runSong,
    renderSide: renderSide,
    monoFromPcm: monoFromPcm,
    join: join
  };
});
