/**
 * NHL 95 Genesis team jersey colours. The bundled data/pals/genesis95 folder only has Anaheim, Boston,
 * Buffalo and Calgary (what ANIM95-To-BMP shipped). The other teams are in the retail ROM: each team block's
 * .pad is 16 home colours then 16 visitor colours, 32 bytes a side (NHL95Genesis src/teamdata95.asm,
 * tools/extractAssets95.js). Addresses are for the 2 MB retail ROM.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlGenesis95Pals = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ROM_SIZE = 0x200000;
  /** code, home-palette offset. Away is the next 32 bytes. ROM order is ASE, ASW, then ANH … WSH. */
  const TEAMS = [
    ['ase', 0x7EE],
    ['asw', 0xABE],
    ['ana', 0xD72],
    ['bos', 0x1036],
    ['buf', 0x1310],
    ['cgy', 0x15EC],
    ['chi', 0x18CA],
    ['det', 0x1BAA],
    ['edm', 0x1EA8],
    ['fla', 0x219A],
    ['hfd', 0x247A],
    ['la', 0x276E],
    ['dal', 0x2A30],
    ['mtl', 0x2D04],
    ['nj', 0x2FF4],
    ['nyi', 0x32E6],
    ['nyr', 0x35D2],
    ['otw', 0x38B4],
    ['phi', 0x3BAA],
    ['pit', 0x3E88],
    ['que', 0x4178],
    ['sj', 0x445E],
    ['stl', 0x4722],
    ['tb', 0x4A0A],
    ['tor', 0x4CC2],
    ['van', 0x4FB4],
    ['wpg', 0x529A],
    ['wsh', 0x5562]
  ];

  function bodyOf(bytes) {
    const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    if (d.length === ROM_SIZE + 512 && String.fromCharCode(d[0x300], d[0x301], d[0x302], d[0x303]) === 'SEGA') {
      return d.subarray(512);
    }
    return d;
  }

  /**
   * [{ name, bytes }] for every team, home then away, or null when this is not the retail 2 MB ROM.
   * bytes is a 32-byte copy (one Genesis palette line).
   */
  function palettes(bytes) {
    const rom = bodyOf(bytes);
    if (rom.length !== ROM_SIZE) return null;
    if (String.fromCharCode(rom[0x100], rom[0x101], rom[0x102], rom[0x103]) !== 'SEGA') return null;
    const out = [];
    for (const [code, home] of TEAMS) {
      if (home + 64 > rom.length) return null;
      out.push({ name: code + 'h.pal', bytes: rom.slice(home, home + 32) });
      out.push({ name: code + 'v.pal', bytes: rom.slice(home + 32, home + 64) });
    }
    return out;
  }

  function byName(bytes, name) {
    const want = String(name || '').toLowerCase();
    const all = palettes(bytes);
    if (!all) return null;
    const hit = all.find((p) => p.name === want);
    return hit ? hit.bytes : null;
  }

  return { palettes, byName, TEAMS, ROM_SIZE };
});
