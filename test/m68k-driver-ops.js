/**
 * The 68000 instructions the retail NHL '92 sound code uses, decoded from the
 * ROM bytes (bundled sound slice) by a linear sweep of its code ranges. Each
 * sweep must land exactly on its range end, which checks the length decoder.
 */
const m68k = require('../lib/audio/m68k-cpu');
const fixture = require('../lib/audio/nhl92-sound-fixture');

/** Code ranges [start, end) in the sound module (data tables excluded). */
const CODE_RANGES = [
  [0xf4c8, 0xfa92], // p_music_vblank .. p_initfx_fn (sfx_pointer_table follows)
  [0xfb1e, 0xff74], // Sound_Process_SFXChannels .. SFX handlers (FM SFX streams follow)
  [0x11624, 0x116a6] // Sound_ResetZ80, Sound_LoadZ80Program (Z80 program follows)
];

/** Extension words used by an effective address. */
function eaWords(mode, reg, size) {
  if (mode === 5 || mode === 6) return 1;
  if (mode === 7) {
    if (reg === 0 || reg === 2 || reg === 3) return 1;
    if (reg === 1) return 2;
    if (reg === 4) return size === 4 ? 2 : 1;
  }
  return 0;
}

/** Instruction length in words for opcode `op` (68000). */
function lengthWords(op) {
  const mode = (op >> 3) & 7;
  const reg = op & 7;
  const sz = (op >> 6) & 3;
  const sizeOf = (s) => [1, 2, 4][s];
  switch (op >> 12) {
    case 0x0: {
      if (op & 0x100) return 1 + ((mode === 1) ? 1 : eaWords(mode, reg, 1)); // dynamic bit / MOVEP
      if (((op >> 9) & 7) === 4) return 2 + eaWords(mode, reg, 1); // static bit
      if ((op & 0x3f) === 0x3c) return 2; // to CCR / SR
      return 1 + (sz === 2 ? 2 : 1) + eaWords(mode, reg, sizeOf(sz));
    }
    case 0x1: case 0x2: case 0x3: {
      const size = { 1: 1, 2: 4, 3: 2 }[op >> 12];
      return 1 + eaWords(mode, reg, size) + eaWords((op >> 6) & 7, (op >> 9) & 7, size);
    }
    case 0x4: {
      if ((op & 0xfb80) === 0x4880 && mode !== 0) return 2 + eaWords(mode, reg, 2); // MOVEM
      if (op === 0x4e72) return 2; // STOP
      if ((op & 0xfff8) === 0x4e50) return 2; // LINK
      if ((op & 0xfff0) === 0x4e40 || (op & 0xfff0) === 0x4e60 || (op & 0xfff8) === 0x4e58 || (op & 0xfff0) === 0x4e70) return 1;
      if ((op & 0xfff8) === 0x4840 || (op & 0xfff8) === 0x4880 || (op & 0xfff8) === 0x48c0) return 1; // SWAP, EXT
      const size = sz === 3 ? 2 : sizeOf(sz);
      return 1 + eaWords(mode, reg, (op & 0x1c0) === 0x1c0 ? 4 : size);
    }
    case 0x5:
      if (sz === 3 && mode === 1) return 2; // DBcc
      return 1 + eaWords(mode, reg, sz === 3 ? 1 : sizeOf(sz));
    case 0x6: return (op & 0xff) === 0 ? 2 : 1;
    case 0x7: return 1;
    case 0xe: return sz === 3 ? 1 + eaWords(mode, reg, 2) : 1;
    default: {
      const opmode = (op >> 6) & 7;
      if (opmode === 3 || opmode === 7) return 1 + eaWords(mode, reg, opmode === 7 && (op >> 12) !== 0x8 && (op >> 12) !== 0xc ? 4 : 2);
      if (opmode >= 4 && mode <= 1) return 1; // ABCD/SBCD/ADDX/SUBX/CMPM/EXG/EOR Dn,Dn
      return 1 + eaWords(mode, reg, [1, 2, 4][opmode & 3]);
    }
  }
}

/** Every instruction in the code ranges: [{ at, op, words, group }]. */
function sweep(rom) {
  const bytes = rom || fixture.resolveRom(null);
  const out = [];
  for (const [start, end] of CODE_RANGES) {
    let at = start;
    while (at < end) {
      const op = (bytes[at] << 8) | bytes[at + 1];
      const words = lengthWords(op);
      out.push({ at, op, words, group: m68k.groupName(op) });
      at += words * 2;
    }
    if (at !== end) throw new Error('sweep of ' + start.toString(16) + ' ran to ' + at.toString(16) + ', expected ' + end.toString(16));
  }
  return out;
}

/** Distinct SingleStepTests group names the sound code uses. */
function groups(rom) {
  return Array.from(new Set(sweep(rom).map((i) => i.group))).sort();
}

module.exports = { CODE_RANGES, lengthWords, sweep, groups };
