/**
 * Genesis driver ROM layout (NHL 92–95). Offsets are absolute ROM file bytes.
 * NHL 92 tables are pinned from NHL92FMTunes-To-MIDI / Docs/SND.
 * Later titles share the same driver family; fmtune/SFX offsets may differ — set
 * `playback: false` until verified against each retail ROM.
 */
const SOUND_BASE = 0xF4C8;

const NHL92_SFX = [
  { id: 'sfx_siren_ch0', label: 'Siren (channel 0)', start: 0xFF74, end: 0xFF90 },
  { id: 'sfx_siren_ch1', label: 'Siren (channel 1)', start: 0xFF90, end: 0xFFB8 },
  { id: 'sfx_shotfh', label: 'Shot (forehand)', start: 0xFFB8, end: 0xFFC8 },
  { id: 'sfx_stdef', label: 'Stick defend', start: 0xFFC8, end: 0xFFF0 },
  { id: 'sfx_horn', label: 'Horn', start: 0xFFF0, end: 0x1000E },
  { id: 'sfx_shotwiff', label: 'Shot whiff', start: 0x1000E, end: 0x1002C },
  { id: 'sfx_crowdcheer_ch0', label: 'Crowd cheer (ch 0)', start: 0x1002C, end: 0x10054 },
  { id: 'sfx_crowdcheer_ch1', label: 'Crowd cheer (ch 1)', start: 0x10054, end: 0x10088 },
  { id: 'sfx_puckwall2', label: 'Puck wall 2', start: 0x10088, end: 0x100A6 },
  { id: 'sfx_pass', label: 'Pass', start: 0x100A6, end: 0x100C4 },
  { id: 'sfx_id_27', label: 'SFX 27', start: 0x100C4, end: 0x100E2 },
  { id: 'sfx_id_28', label: 'SFX 28', start: 0x100E2, end: 0x10100 },
  { id: 'sfx_shotbh', label: 'Shot (backhand)', start: 0x10100, end: 0x1011E },
  { id: 'sfx_id_29', label: 'SFX 29', start: 0x1011E, end: 0x1013C },
  { id: 'sfx_id_30', label: 'SFX 30', start: 0x1013C, end: 0x1015A },
  { id: 'sfx_beep2', label: 'UI beep 2', start: 0x1015A, end: 0x1016A },
  { id: 'sfx_beep1', label: 'UI beep 1', start: 0x1016A, end: 0x1017A }
];

const FMTUNE_NAMES_92 = [
  'Title / menu A',
  'Title / menu B',
  'In-game A',
  'In-game B',
  'Organ / sting A',
  'Organ / sting B'
];

const GAMES = {
  nhl92: {
    soundBase: SOUND_BASE,
    hockeySndStart: 0xF4C8,
    hockeySndEnd: 0x24214,
    digitalAnchor: 0x149D0,
    fmtuneTable: 0x10294,
    fmtuneTracks: 6,
    fmtuneStride: 0x1A,
    fmtuneNames: FMTUNE_NAMES_92,
    sfx: NHL92_SFX,
    playback: true
  },
  nhlpa93: {
    soundBase: SOUND_BASE,
    hockeySndStart: 0xF4C8,
    hockeySndEnd: 0x24214,
    digitalAnchor: 0x1F420,
    fmtuneTable: null,
    fmtuneTracks: 0,
    sfx: [],
    playback: false,
    note: 'FMTune/SFX offsets not vendored yet; digital anchor from Docs/SND'
  },
  nhl94: {
    soundBase: SOUND_BASE,
    hockeySndStart: 0xF4C8,
    hockeySndEnd: 0x24214,
    digitalAnchor: 0x23330,
    fmtuneTable: null,
    fmtuneTracks: 0,
    sfx: [],
    playback: false,
    note: 'Song table ($30–$7A) lives in sound94.asm — catalog pending'
  },
  nhl95: {
    soundBase: SOUND_BASE,
    hockeySndStart: 0xF4C8,
    hockeySndEnd: 0x24214,
    digitalAnchor: 0x705F0,
    fmtuneTable: null,
    fmtuneTracks: 0,
    sfx: [],
    playback: false,
    note: 'Digital anchor from Docs/SND; driver tables TBD'
  }
};

module.exports = { SOUND_BASE, GAMES, NHL92_SFX, FMTUNE_NAMES_92 };
