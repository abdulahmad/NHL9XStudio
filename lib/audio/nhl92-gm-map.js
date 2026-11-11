/**
 * NHL '92 <-> General MIDI instrument mapping: constants, lookups and validation.
 *
 * The mapping itself is data/audio/nhl92-gm-map.json (hand-edited, with reasons and
 * runners-up). This module holds the fixed GM facts (program names, families, drum notes),
 * resolves a program or drum note through the family default / override rule, and checks
 * the file. UMD: Node, tests and the chip lab page.
 *
 * Mapping layer only: nothing here changes the drivers, the patches or the sound data.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92GmMap = api;
})(typeof self !== 'undefined' ? self : this, function () {
  var PATCH_COUNT = 22;
  var SOUND_BASE = 0xf4c8; // p_music_vblank
  var SFX_TABLE = 0xfa92; // sfx_pointer_table, 35 BASE-relative longs
  var SFX_COUNT = 35;

  var PROGRAM_NAMES = [
    'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano', 'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
    'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
    'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
    'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)', 'Electric Guitar (clean)', 'Electric Guitar (muted)', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
    'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass', 'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
    'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
    'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
    'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
    'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
    'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
    'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)', 'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)',
    'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)', 'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
    'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)', 'FX 5 (brightness)', 'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
    'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
    'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
    'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot'
  ];

  var FAMILIES = [
    { id: 'piano', name: 'Piano' },
    { id: 'chromatic-percussion', name: 'Chromatic percussion' },
    { id: 'organ', name: 'Organ' },
    { id: 'guitar', name: 'Guitar' },
    { id: 'bass', name: 'Bass' },
    { id: 'strings', name: 'Strings' },
    { id: 'ensemble', name: 'Ensemble' },
    { id: 'brass', name: 'Brass' },
    { id: 'reed', name: 'Reed' },
    { id: 'pipe', name: 'Pipe' },
    { id: 'synth-lead', name: 'Synth lead' },
    { id: 'synth-pad', name: 'Synth pad' },
    { id: 'synth-effects', name: 'Synth effects' },
    { id: 'ethnic', name: 'Ethnic' },
    { id: 'percussive', name: 'Percussive' },
    { id: 'sound-effects', name: 'Sound effects' }
  ].map(function (f, i) { return { id: f.id, name: f.name, first: i * 8, last: i * 8 + 7 }; });

  var DRUM_FIRST = 35;
  var DRUM_LAST = 81;
  var DRUM_NAMES = [
    'Acoustic Bass Drum', 'Bass Drum 1', 'Side Stick', 'Acoustic Snare', 'Hand Clap', 'Electric Snare', 'Low Floor Tom', 'Closed Hi-Hat',
    'High Floor Tom', 'Pedal Hi-Hat', 'Low Tom', 'Open Hi-Hat', 'Low-Mid Tom', 'Hi-Mid Tom', 'Crash Cymbal 1', 'High Tom',
    'Ride Cymbal 1', 'Chinese Cymbal', 'Ride Bell', 'Tambourine', 'Splash Cymbal', 'Cowbell', 'Crash Cymbal 2', 'Vibraslap',
    'Ride Cymbal 2', 'Hi Bongo', 'Low Bongo', 'Mute Hi Conga', 'Open Hi Conga', 'Low Conga', 'High Timbale', 'Low Timbale',
    'High Agogo', 'Low Agogo', 'Cabasa', 'Maracas', 'Short Whistle', 'Long Whistle', 'Short Guiro', 'Long Guiro',
    'Claves', 'Hi Wood Block', 'Low Wood Block', 'Mute Cuica', 'Open Cuica', 'Mute Triangle', 'Open Triangle'
  ];

  var CONFIDENCE = ['high', 'medium', 'low'];
  var FIT = ['good', 'rough', 'none'];

  function familyOf(program) {
    return FAMILIES[Math.floor(program / 8)];
  }

  function programName(program) {
    return PROGRAM_NAMES[program];
  }

  function drumName(note) {
    return DRUM_NAMES[note - DRUM_FIRST];
  }

  /** The game's sfx_pointer_table entry for an SFX ID: the handler's ROM address. */
  function sfxHandler(rom, id) {
    var at = SFX_TABLE + id * 4;
    return SOUND_BASE + (((rom[at] << 24) | (rom[at + 1] << 16) | (rom[at + 2] << 8) | rom[at + 3]) >>> 0);
  }

  /** Short text for a target object (either direction). */
  function describeTarget(t) {
    if (!t) return 'none';
    if (t.kind === 'program') return 'GM ' + t.program + ' ' + programName(t.program);
    if (t.kind === 'drum') return 'GM drum ' + t.note + ' ' + drumName(t.note) + ' (channel 10)';
    if (t.kind === 'patch') return 'NHL 92 patch ' + t.patch + (t.midi != null ? ' at MIDI ' + t.midi : '');
    if (t.kind === 'dac') return 'NHL 92 DAC sample, SFX ' + t.sfx + (t.label ? ' (' + t.label + ')' : '');
    return String(t.kind);
  }

  function sameTarget(a, b) {
    return !!a && !!b && a.kind === b.kind && a.program === b.program && a.note === b.note && a.patch === b.patch && a.sfx === b.sfx && a.midi === b.midi;
  }

  /** NHL 92 patch -> GM entry. */
  function nhl92ToGm(map, patch) {
    return map.nhl92ToGm.patches[patch];
  }

  /** GM program -> NHL 92 entry: the program's override if it has one, else its family default. */
  function resolveProgram(map, program) {
    var fam = familyOf(program);
    var override = map.gmToNhl92.overrides.find(function (o) { return o.program === program; });
    var family = map.gmToNhl92.families.find(function (f) { return f.family === fam.id; });
    var src = override || family;
    return {
      program: program,
      name: programName(program),
      family: fam.id,
      source: override ? 'override' : 'family',
      target: src.target,
      runnerUp: src.runnerUp,
      confidence: src.confidence,
      reason: src.reason
    };
  }

  /** GM drum note (35-81) -> NHL 92 entry. */
  function resolveDrum(map, note) {
    return map.gmToNhl92.drums.find(function (d) { return d.note === note; });
  }

  // --- Validation ----------------------------------------------------------------------

  /**
   * @param {object} map parsed data/audio/nhl92-gm-map.json
   * @param {object} [opts]
   * @param {number[]} [opts.dacSfxIds] SFX IDs that start a DAC sample (from the parser); when
   *   given, `dac` targets must use one of them.
   * @returns {string[]} problems (empty when the file is sound)
   */
  function validate(map, opts) {
    var o = opts || {};
    var problems = [];
    var bad = function (msg) { problems.push(msg); };
    var isInt = function (v, lo, hi) { return Number.isInteger(v) && v >= lo && v <= hi; };
    var isText = function (v) { return typeof v === 'string' && v.trim().length > 0; };

    function checkTarget(where, t, kinds) {
      if (!t || typeof t !== 'object') { bad(where + ': target missing'); return; }
      if (kinds.indexOf(t.kind) < 0) { bad(where + ': target kind "' + t.kind + '" not one of ' + kinds.join('/')); return; }
      if (t.kind === 'program') {
        if (!isInt(t.program, 0, 127)) bad(where + ': GM program ' + t.program + ' is not 0-127');
        else if (t.name !== programName(t.program)) bad(where + ': GM program ' + t.program + ' is "' + programName(t.program) + '", file says "' + t.name + '"');
      } else if (t.kind === 'drum') {
        if (!isInt(t.note, DRUM_FIRST, DRUM_LAST)) bad(where + ': GM drum note ' + t.note + ' is not ' + DRUM_FIRST + '-' + DRUM_LAST);
        else if (t.name !== drumName(t.note)) bad(where + ': GM drum ' + t.note + ' is "' + drumName(t.note) + '", file says "' + t.name + '"');
      } else if (t.kind === 'patch') {
        if (!isInt(t.patch, 0, PATCH_COUNT - 1)) bad(where + ': NHL 92 patch ' + t.patch + ' is not 0-' + (PATCH_COUNT - 1));
        if (t.midi != null && !isInt(t.midi, 12, 107)) bad(where + ': pitch MIDI ' + t.midi + ' is outside the note table (12-107)');
      } else if (t.kind === 'dac') {
        if (!isInt(t.sfx, 0, SFX_COUNT - 1)) bad(where + ': SFX ' + t.sfx + ' is not 0-' + (SFX_COUNT - 1));
        else if (o.dacSfxIds && o.dacSfxIds.indexOf(t.sfx) < 0) bad(where + ': SFX ' + t.sfx + ' does not start a DAC sample');
      }
    }

    function checkEntry(where, e, kinds, rating) {
      if (!e || typeof e !== 'object') { bad(where + ': entry missing'); return; }
      checkTarget(where, e.target, kinds);
      if (!isText(e.reason)) bad(where + ': reason missing');
      if (e.runnerUp == null) bad(where + ': runnerUp missing');
      else {
        checkTarget(where + ' runner-up', e.runnerUp, kinds);
        if (sameTarget(e.target, e.runnerUp)) bad(where + ': runner-up is the same as the match');
      }
      if (rating === 'confidence' && CONFIDENCE.indexOf(e.confidence) < 0) bad(where + ': confidence "' + e.confidence + '" not one of ' + CONFIDENCE.join('/'));
      if (rating === 'fit' && FIT.indexOf(e.fit) < 0) bad(where + ': fit "' + e.fit + '" not one of ' + FIT.join('/'));
    }

    if (!map || typeof map !== 'object') return ['file is not an object'];
    var n2g = map.nhl92ToGm && map.nhl92ToGm.patches;
    var g2n = map.gmToNhl92;
    if (!Array.isArray(n2g)) bad('nhl92ToGm.patches missing');
    if (!g2n || !Array.isArray(g2n.families) || !Array.isArray(g2n.overrides) || !Array.isArray(g2n.drums)) bad('gmToNhl92 families/overrides/drums missing');
    if (problems.length) return problems;

    // NHL 92 -> GM: patches 0..21 once each, in order.
    if (n2g.length !== PATCH_COUNT) bad('nhl92ToGm.patches has ' + n2g.length + ' entries, expected ' + PATCH_COUNT);
    n2g.forEach(function (e, i) {
      var where = 'patch ' + i;
      if (e.patch !== i) bad(where + ': entry says patch ' + e.patch + ' (entries must be in order 0-21)');
      if (!isText(e.character)) bad(where + ': character missing');
      checkEntry(where, e, ['program', 'drum'], 'confidence');
    });

    // GM -> NHL 92 families: the 16 families, in order, each with a default.
    if (g2n.families.length !== FAMILIES.length) bad('families: ' + g2n.families.length + ' entries, expected ' + FAMILIES.length);
    FAMILIES.forEach(function (f, i) {
      var e = g2n.families[i];
      if (!e) return;
      if (e.family !== f.id) bad('family ' + (i + 1) + ': id "' + e.family + '", expected "' + f.id + '"');
      checkEntry('family ' + f.id, e, ['patch', 'dac'], 'confidence');
    });

    // Overrides: sparse, one per program, never a copy of the family default.
    var seen = {};
    g2n.overrides.forEach(function (e) {
      var where = 'override ' + e.program;
      if (!isInt(e.program, 0, 127)) { bad(where + ': program is not 0-127'); return; }
      if (e.name !== programName(e.program)) bad(where + ': name "' + e.name + '", expected "' + programName(e.program) + '"');
      if (seen[e.program]) bad(where + ': listed twice');
      seen[e.program] = true;
      checkEntry(where, e, ['patch', 'dac'], 'confidence');
      var fam = g2n.families.find(function (f) { return f.family === familyOf(e.program).id; });
      if (fam && sameTarget(fam.target, e.target)) bad(where + ': same target as its family default (remove the override)');
    });

    // Drum kit: notes 35-81 once each, in order.
    if (g2n.drums.length !== DRUM_LAST - DRUM_FIRST + 1) bad('drums: ' + g2n.drums.length + ' entries, expected ' + (DRUM_LAST - DRUM_FIRST + 1));
    g2n.drums.forEach(function (e, i) {
      var where = 'drum ' + (DRUM_FIRST + i);
      if (e.note !== DRUM_FIRST + i) bad(where + ': entry says note ' + e.note + ' (entries must be in order 35-81)');
      else if (e.name !== drumName(e.note)) bad(where + ': name "' + e.name + '", expected "' + drumName(e.note) + '"');
      checkEntry(where, e, ['patch', 'dac'], 'fit');
    });
    return problems;
  }

  return {
    PATCH_COUNT: PATCH_COUNT,
    SOUND_BASE: SOUND_BASE,
    SFX_TABLE: SFX_TABLE,
    SFX_COUNT: SFX_COUNT,
    PROGRAM_NAMES: PROGRAM_NAMES,
    FAMILIES: FAMILIES,
    DRUM_FIRST: DRUM_FIRST,
    DRUM_LAST: DRUM_LAST,
    DRUM_NAMES: DRUM_NAMES,
    CONFIDENCE: CONFIDENCE,
    FIT: FIT,
    familyOf: familyOf,
    programName: programName,
    drumName: drumName,
    sfxHandler: sfxHandler,
    describeTarget: describeTarget,
    sameTarget: sameTarget,
    nhl92ToGm: nhl92ToGm,
    resolveProgram: resolveProgram,
    resolveDrum: resolveDrum,
    validate: validate
  };
});
