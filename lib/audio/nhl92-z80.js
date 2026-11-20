/**
 * NHL 92 Genesis Z80 sound program (ROM blob → Z80 RAM).
 * See EA-NHL-Tools/NHL92FMTunes-To-MIDI/prompt.md (Sound_LoadZ80Program).
 */
(function (root, factory) {
  var z80 = typeof module === 'object' && module.exports
    ? require('./z80-cpu')
    : root.NhlZ80Cpu;
  var api = factory(z80);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92Z80Driver = api;
})(typeof self !== 'undefined' ? self : this, function (z80Cpu) {
  const Z80_RAM_SIZE = 0x2000;
  /** ROM file offset of Z80_Program_Code (0x598 bytes copied to Z80 RAM). */
  const NHL92_Z80_ROM_OFFSET = 0x116a6;
  const NHL92_Z80_BYTE_COUNT = 0x598;

  function asBytes(buf) {
    if (!buf) return null;
    if (buf instanceof Uint8Array) return buf;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buf)) {
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    return new Uint8Array(buf);
  }

  function extractProgram(rom) {
    const bytes = asBytes(rom);
    if (!bytes || bytes.length < NHL92_Z80_ROM_OFFSET + NHL92_Z80_BYTE_COUNT) return null;
    return bytes.subarray(NHL92_Z80_ROM_OFFSET, NHL92_Z80_ROM_OFFSET + NHL92_Z80_BYTE_COUNT);
  }

  function loadIntoRam(rom) {
    const blob = extractProgram(rom);
    if (!blob) return null;
    const ram = new Uint8Array(Z80_RAM_SIZE);
    ram.set(blob);
    const cpu = z80Cpu.create(ram, { pc: 0, sp: 0xff00 });
    return { cpu, blob, ram };
  }

  return {
    Z80_RAM_SIZE,
    NHL92_Z80_ROM_OFFSET,
    NHL92_Z80_BYTE_COUNT,
    extractProgram,
    loadIntoRam
  };
});
