/**
 * Genesis driver ROM layout (NHL 92–95). Offsets are absolute ROM file bytes.
 * NHL 92 tables are pinned from NHL92FMTunes-To-MIDI / Docs/SND.
 * Later titles share the same driver family; fmtune/SFX offsets may differ — set
 * `playback: false` until verified against each retail ROM.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlGenesisAudioConstants = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SOUND_BASE = 0xF4C8;

  const NHL92_NOTE_FREQ = 0x1017A;
  const NHL92_NOTE_OCTAVE = 0x101DA;
  const NHL92_INSTRUMENT_TABLE = 0x116A6;

  /** FM SFX command streams, named as the NHL92Genesis extract files (sfx_<label>_cmdstream.bin) and SOUNDTAB.DOC. */
  const NHL92_SFX = [
    { id: 'sfx_siren_ch0', label: 'siren — FM siren (channel 0)', start: 0xFF74, end: 0xFF90 },
    { id: 'sfx_siren_ch1', label: 'siren — FM siren (channel 1)', start: 0xFF90, end: 0xFFB8 },
    { id: 'sfx_puck_faceoff', label: 'puck_faceoff — FM puck hits ice on face off', start: 0xFFB8, end: 0xFFC8 },
    { id: 'sfx_whistle', label: 'whistle — FM whistle', start: 0xFFC8, end: 0xFFF0 },
    { id: 'sfx_hitpuck', label: 'hitpuck — FM hit puck', start: 0xFFF0, end: 0x1000E },
    { id: 'sfx_bounce_goal', label: 'bounce_goal — FM puck bounce off goal post', start: 0x1000E, end: 0x1002C },
    { id: 'sfx_foghorn_ch0', label: 'foghorn — FM fog horn end of period (channel 0)', start: 0x1002C, end: 0x10054 },
    { id: 'sfx_foghorn_ch1', label: 'foghorn — FM fog horn end of period (channel 1)', start: 0x10054, end: 0x10088 },
    { id: 'sfx_whiff', label: 'whiff — FM whiff (miss puck on slap shot)', start: 0x10088, end: 0x100A6 },
    { id: 'sfx_hitboard', label: 'hitboard — FM hit board loud', start: 0x100A6, end: 0x100C4 },
    { id: 'sfx_hitboardvolm', label: 'hitboardvolm — hit board1 medium volume', start: 0x100C4, end: 0x100E2 },
    { id: 'sfx_hitboardvols', label: 'hitboardvols — hit board1 softer volume', start: 0x100E2, end: 0x10100 },
    { id: 'sfx_hitboard2', label: 'hitboard2 — FM hit board lower pitch loud', start: 0x10100, end: 0x1011E },
    { id: 'sfx_hitboard2volm', label: 'hitboard2volm — hit board2 medium volume', start: 0x1011E, end: 0x1013C },
    { id: 'sfx_hitboard2vols', label: 'hitboard2vols — hit board2 softer volume', start: 0x1013C, end: 0x1015A },
    { id: 'sfx_skating2', label: 'skating2 — FM skate and stop short', start: 0x1015A, end: 0x1016A },
    { id: 'sfx_skating1', label: 'skating1 — FM skate and stop short', start: 0x1016A, end: 0x1017A }
  ];

  const FMTUNE_NAMES_92 = [
    'SngEOP',
    'SngTitle',
    'SngReprise',
    'SngEOG',
    'SngPO',
    'In-game organ'
  ];

  const DIGITAL_SAMPLE_MAGIC = [0x88, 0x88, 0x81, 0x78, 0x76, 0x78, 0x7B];

  const GAMES = {
    nhl92: {
      soundBase: SOUND_BASE,
      hockeySndStart: 0xF4C8,
      hockeySndEnd: 0x24214,
      digitalAnchor: 0x149D0,
      noteFreqTable: NHL92_NOTE_FREQ,
      noteOctaveTable: NHL92_NOTE_OCTAVE,
      instrumentTable: NHL92_INSTRUMENT_TABLE,
      fmtuneTable: 0x10294,
      fmtuneTracks: 6,
      fmtuneStride: 0x1A,
      fmtuneNames: FMTUNE_NAMES_92,
      sfx: NHL92_SFX,
      playback: true
    },
    nhlpa93: {
      soundBase: SOUND_BASE,
      hockeySndStart: 0x16E52,
      hockeySndEnd: 0x2CEC8,
      digitalAnchor: 0x1F420,
      noteFreqTable: null,
      noteOctaveTable: null,
      fmtuneTable: null,
      fmtuneTracks: 0,
      sfx: [],
      streamDriver: 'event-93',
      playback: true,
      note: 'Streams from NHLPA93Genesis sound93.asm + extractAssets93-1.1.js'
    },
    nhl94: {
      soundBase: SOUND_BASE,
      hockeySndStart: 0x1AD90,
      hockeySndEnd: 0x4B5C0,
      digitalAnchor: 0x23330,
      noteFreqTable: null,
      noteOctaveTable: null,
      fmtuneTable: null,
      fmtuneTracks: 0,
      sfx: [],
      streamDriver: 'event-94',
      playback: true,
      note: 'SFX $0–$2F + team songs $30–$77 + shared $78–$7A (sound94.asm)'
    },
    nhl95: {
      soundBase: SOUND_BASE,
      hockeySndStart: 0xF4C8,
      hockeySndEnd: 0x24214,
      digitalAnchor: 0x705F0,
      noteFreqTable: null,
      noteOctaveTable: null,
      fmtuneTable: null,
      fmtuneTracks: 0,
      sfx: [],
      playback: false,
      note: 'Digital anchor from Docs/SND; driver tables TBD'
    }
  };

  return {
    SOUND_BASE,
    GAMES,
    NHL92_SFX,
    FMTUNE_NAMES_92,
    DIGITAL_SAMPLE_MAGIC,
    NHL92_NOTE_FREQ,
    NHL92_NOTE_OCTAVE,
    NHL92_INSTRUMENT_TABLE
  };
});
