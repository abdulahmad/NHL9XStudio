/**
 * The NHL Hockey '94 Genesis ROM's team colours, for the fight colour editor (public/fight.js). The same reader as
 * NHL95PC port/rom94.c, which the NHL 95 PC port uses when it draws NHLPA 93's fights (port/fight/hooks.c make_lut_for):
 *   - The retail ROM only (header checksum 0x5512, and the same sum from $200). A changed ROM's addresses can't be trusted.
 *   - TeamList at $30E (teamdata94.asm): 28 big-endian pointers. A record's word at +2 is Palettedata (16 home colours,
 *     then 16 visitor colours, Genesis CRAM). The word at +4 is the name: the city (a word length, the letters, even),
 *     then the abbreviation the same way.
 *   - 95 PC spells three teams differently: ana is ANH, ott is OTW, min and dal are DAL. Every 95 PC team is in 94,
 *     including Anaheim and Florida.
 * Colours here are Genesis CRAM expanded the way rom94.c does it (channel × 36), not the 93 reader's × 255 / 7.
 * A 512-byte copier header is dropped, as lib/rom93.js does.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlRom94 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ROM_SIZE = 0x100000;
  const CHECKSUM = 0x5512;
  const SPRITES = 0x5DE7A;
  const ICERINK = 0x5605A;
  const TEAMLIST = 0x30E;
  const NTEAMS = 28;
  /** 95 PC's letters that 94 spells another way (port/rom94.c rom94_team_colours) */
  const ALIAS = { ana: 'ANH', ott: 'OTW', min: 'DAL', dal: 'DAL' };

  const be16 = (d, o) => (d[o] << 8) | d[o + 1];
  const be32 = (d, o) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;

  /** The letters 94 uses for a 95 PC team code (uppercase). */
  function letters(abbrev) {
    const raw = String(abbrev || '').toLowerCase();
    return (Object.prototype.hasOwnProperty.call(ALIAS, raw) ? ALIAS[raw] : raw).toUpperCase();
  }

  /** 0000 BBB0 GGG0 RRR0, each channel × 36 (rom94.c cram, not the 93 scale). */
  function cram(w) {
    const ch = (shift) => ((w >> shift) & 7) * 36;
    return [ch(1), ch(5), ch(9)];
  }

  /** A copier header (512 bytes) is dropped. Returns { data, sprites, icerink, teamlist } or throws. */
  function open(bytes) {
    let d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (d.length === ROM_SIZE + 512) d = d.subarray(512);
    if (d.length !== ROM_SIZE) throw new Error('Not an NHL Hockey 94 Genesis ROM (1 MB)');
    const name = String.fromCharCode(...d.subarray(0x150, 0x15E)).toUpperCase();
    if (name !== "NHL HOCKEY '94") throw new Error('Not an NHL Hockey 94 Genesis ROM (header name)');
    let sum = 0;
    for (let i = 0x200; i < d.length; i += 2) sum = (sum + be16(d, i)) & 0xFFFF;
    if (be16(d, 0x18E) !== CHECKSUM || sum !== CHECKSUM) throw new Error('An NHL 94 ROM, but not a known retail one (changed ROMs are not read)');
    if (SPRITES + be32(d, SPRITES + 4) + 4 > ROM_SIZE) throw new Error('NHL 94 ROM: no sprite sheet at the expected place');
    return { data: d, sprites: SPRITES, icerink: ICERINK, teamlist: TEAMLIST };
  }

  /**
   * 16 [r, g, b] for this 95 PC team code, home or visitor, or null when the ROM has no such abbreviation.
   * home true: the first 16 colours; false: the visitor 16.
   */
  function teamColours(rom, abbrev, home) {
    if (!rom || !rom.data || abbrev == null || abbrev === '') return null;
    const want = letters(abbrev);
    const d = rom.data;
    for (let t = 0; t < NTEAMS; t++) {
      const rec = be32(d, rom.teamlist + 4 * t);
      if (rec + 8 > d.length) continue;
      let name = rec + be16(d, rec + 4);
      if (name + 2 > d.length) continue;
      let len = be16(d, name);
      name += len;
      if (name + 2 > d.length) continue;
      len = be16(d, name);
      if (len < 3 || name + len > d.length) continue;
      let n = 0;
      while (n < len - 2 && d[name + 2 + n] !== 0) n++;
      if (n !== want.length) continue;
      let ok = true;
      for (let i = 0; i < n; i++) if (d[name + 2 + i] !== want.charCodeAt(i)) ok = false;
      if (!ok) continue;
      const pal = rec + be16(d, rec + 2) + (home ? 0 : 32);
      if (pal + 32 > d.length) return null;
      const out = [];
      for (let i = 0; i < 16; i++) out.push(cram(be16(d, pal + 2 * i)));
      return out;
    }
    return null;
  }

  return { open, teamColours, letters, ROM_SIZE, CHECKSUM, NTEAMS, ALIAS };
});
