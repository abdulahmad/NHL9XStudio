#!/usr/bin/env node
/**
 * Extract NHL 92 Genesis sound bytes for the bundled Z80 test fixture.
 * Source: your own NHL Hockey (Genesis) ROM (e.g. roms/nhl92.bin).
 * Does not commit the full ROM — only the sound driver region + tables.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { NHL92_Z80_ROM_OFFSET, NHL92_Z80_BYTE_COUNT } = require('../lib/audio/nhl92-z80');

const SOUND_START = 0xf4c8;
const SOUND_END = 0x24214;
const ROM_SIZE = 0x25000;

const sources = [
  path.join(root, 'roms', 'nhl92.bin'),
  path.join(root, 'EA-NHL-Tools', 'NHL92FMTunes-To-MIDI', 'nhl92retail.bin')
];

function findRom() {
  for (const file of sources) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

const romFile = findRom();
if (!romFile) {
  console.error('Need roms/nhl92.bin (or EA-NHL-Tools NHL92FMTunes-To-MIDI/nhl92retail.bin) to refresh fixtures.');
  process.exit(1);
}

const rom = fs.readFileSync(romFile);
const outDir = path.join(root, 'data', 'fixtures');
fs.mkdirSync(outDir, { recursive: true });

const slice = rom.subarray(SOUND_START, SOUND_END);
fs.writeFileSync(path.join(outDir, 'nhl92-sound-slice.bin'), slice);

const z80 = rom.subarray(NHL92_Z80_ROM_OFFSET, NHL92_Z80_ROM_OFFSET + NHL92_Z80_BYTE_COUNT);
fs.writeFileSync(path.join(outDir, 'nhl92-z80-program.bin'), z80);

const meta = {
  source: 'NHL Hockey (Genesis) retail sound region',
  soundSlice: { romOffset: SOUND_START, length: slice.length },
  z80Program: { romOffset: NHL92_Z80_ROM_OFFSET, length: z80.length },
  syntheticRomSize: ROM_SIZE,
  note: 'Bundled for Z80 test mode only. Not a full game ROM.'
};
fs.writeFileSync(path.join(outDir, 'nhl92-sound-fixture.json'), JSON.stringify(meta, null, 2) + '\n');

console.log('Wrote', slice.length, 'byte sound slice and', z80.length, 'byte Z80 program to', outDir);
