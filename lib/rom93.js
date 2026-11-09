/**
 * The NHLPA Hockey 93 Genesis ROM's fight pieces, for the fight colour editor (public/fight.js). The same reader as
 * NHL95PC port/fight/rom93.c, which the NHL 95 PC port uses to draw 93's fights:
 *   - Sprites.anim: $FFFFFFFF, a long offset to the frame offset table, then 4 bpp 8x8 tiles from +$A. The table has a
 *     word per frame (the offset of the frame's first 8-byte entry); Rev 0 and A start it with a 0 for frame 0, Rev B
 *     leaves frame 0 out. An entry: x, y, tile, then attribute bits 15-11 (priority, palette line, vflip, hflip) and the
 *     size code (bits 3-2 width - 1, bits 1-0 height - 1, in tiles; tiles run down each column first).
 *   - IceRink.map.jim: a long offset to 32 colours, palette lines 0 and 1.
 *   - A team record (TeamList): a word at +2 with the offset of its 32 home and 32 visitor colours.
 * Colours are Genesis CRAM words, 0000 BBB0 GGG0 RRR0.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlRom93 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ROM_SIZE = 0x80000;
  const KNOWN = [
    { rev: '0', checksum: 0x2799, sprites: 0x3A378, icerink: 0x33864, teamlist: 0x314 },
    { rev: 'A', checksum: 0xFA57, sprites: 0x3A3A6, icerink: 0x33892, teamlist: 0x314 },
    { rev: 'B', checksum: 0x86DB, sprites: 0x3A502, icerink: 0x33A88, teamlist: 0x30E }
  ];
  /** frames93.asm: the gloves, the fight (17), the bloody fight injury (6), the check injury (12) */
  const FRAMES = { gloves: 353, fight: 354, fightInjury: 371, injury: 633 };
  const FIGHT_FRAMES = [];
  for (let n = 353; n < 377; n++) FIGHT_FRAMES.push(n);
  for (let n = 633; n < 645; n++) FIGHT_FRAMES.push(n);
  const TEAMS = ['BOS', 'BUF', 'CGY', 'CHI', 'DET', 'EDM', 'HFD', 'NYI', 'LA', 'MIN', 'MTL', 'NJ', 'NYR',
    'OTT', 'PHI', 'PIT', 'QUE', 'SJ', 'STL', 'TB', 'TOR', 'VAN', 'WSH', 'WPG', 'ASE', 'ASW'];
  /** 93 draws the eye with grey 13 (a team colour); a 13 between two skin pixels becomes EYE (line 0 colour 15) */
  const EYE = 15;

  const be16 = (d, o) => (d[o] << 8) | d[o + 1];
  const be32 = (d, o) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;

  /** A copier header (512 bytes) is dropped. Returns { data, rev, sprites, icerink, teamlist } or throws. */
  function open(bytes) {
    let d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (d.length === ROM_SIZE + 512) d = d.subarray(512);
    if (d.length !== ROM_SIZE) throw new Error('Not an NHLPA Hockey 93 Genesis ROM (512 KB)');
    const name = String.fromCharCode(...d.subarray(0x150, 0x160)).toUpperCase();
    if (name !== "NHLPA HOCKEY '93") throw new Error('Not an NHLPA Hockey 93 Genesis ROM (header name)');
    let sum = 0;
    for (let i = 0x200; i < d.length; i += 2) sum = (sum + be16(d, i)) & 0xFFFF;
    const k = KNOWN.find((x) => x.checksum === be16(d, 0x18E));
    if (!k || sum !== k.checksum) throw new Error('An NHLPA 93 ROM, but not a known retail one (changed ROMs are not read)');
    if (be32(d, k.sprites) !== 0xFFFFFFFF) throw new Error('NHLPA 93 ROM: no sprite sheet at the expected place');
    return Object.assign({ data: d }, k);
  }

  function table(r) {
    const off = be32(r.data, r.sprites + 4), t = r.sprites + off;
    const lead = be16(r.data, t) === 0;
    return { t, lead, size: lead ? be16(r.data, t + 2) : be16(r.data, t) };
  }
  function frameCount(r) { const tb = table(r); return (tb.size >> 1) - (tb.lead ? 1 : 0); }

  /** Frame n (1 up): { x0, y0, width, height, pixels } with pixels 0 clear, else line * 16 + colour; or null */
  function decode(r, n) {
    const d = r.data, tb = table(r);
    if (n < 1 || n >= frameCount(r)) return null;
    const a = be16(d, tb.t + 2 * (n - (tb.lead ? 0 : 1))), b = be16(d, tb.t + 2 * (n + 1 - (tb.lead ? 0 : 1)));
    if (b <= a || (b - a) % 8) return null;
    const ents = [];
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    for (let e = b; e > a; e -= 8) {
      const p = tb.t + e - 8;
      const x = (be16(d, p) << 16) >> 16, y = (be16(d, p + 2) << 16) >> 16, tile = be16(d, p + 4), at = be16(d, p + 6);
      const w = ((at >> 2) & 3) + 1, h = (at & 3) + 1;
      ents.push({ x, y, tile, w, h, line: (at >> 13) & 3, hf: at & 0x800, vf: at & 0x1000 });
      minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x + w * 8); maxy = Math.max(maxy, y + h * 8);
    }
    const W = maxx - minx, H = maxy - miny, pix = new Uint8Array(W * H), tiles = r.sprites + 0xA;
    for (const s of ents) {
      for (let cx = 0; cx < s.w; cx++) for (let cy = 0; cy < s.h; cy++) {
        const tp = tiles + (s.tile + cx * s.h + cy) * 32;
        for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) {
          let c = d[tp + yy * 4 + (xx >> 1)]; c = xx & 1 ? c & 15 : c >> 4;
          if (!c) continue;
          let dx = cx * 8 + xx, dy = cy * 8 + yy;
          if (s.hf) dx = s.w * 8 - 1 - dx;
          if (s.vf) dy = s.h * 8 - 1 - dy;
          pix[(s.y + dy - miny) * W + (s.x + dx - minx)] = s.line * 16 + c;
        }
      }
    }
    return { x0: minx, y0: miny, width: W, height: H, pixels: pix };
  }

  const isSkin = (v) => v >= 32 && ((v & 15) === 6 || (v & 15) === 7);
  /** NHL 95 PC's eye: a 13 between two skin pixels becomes EYE (as the port does) */
  function markEyes(f) {
    if (!f) return f;
    for (let y = 0; y < f.height; y++) for (let x = 1; x + 1 < f.width; x++) {
      const i = y * f.width + x, v = f.pixels[i];
      if (v >= 32 && (v & 15) === 13 && isSkin(f.pixels[i - 1]) && isSkin(f.pixels[i + 1])) f.pixels[i] = EYE;
    }
    return f;
  }

  function cram(w) { const c = (v) => Math.floor(v * 255 / 7); return [c((w >> 1) & 7), c((w >> 5) & 7), c((w >> 9) & 7)]; }
  /** 64 [r, g, b]: lines 0 and 1 the rink's, 2 and 3 team t's home (home true) or visitor colours */
  function palette(r, team, home) {
    const d = r.data, out = [];
    for (let i = 0; i < 64; i++) out.push([0, 0, 0]);
    const at = r.icerink + be32(d, r.icerink);
    for (let i = 0; i < 32; i++) out[i] = cram(be16(d, at + 2 * i));
    const rec = be32(d, r.teamlist + 4 * (team >= 0 && team < TEAMS.length ? team : 0));
    const ta = rec + be16(d, rec + 2) + (home ? 0 : 32);
    for (let i = 0; i < 16; i++) out[32 + i] = out[48 + i] = cram(be16(d, ta + 2 * i));
    return out;
  }

  /** port/fight/rom93.c f93_pc95_colours: 95 PC's own colours for the parts every skater shares (the port's default) */
  function pc95Colours(pal) {
    const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
    pal[EYE] = hex(0x60381C);
    for (let line = 2; line < 4; line++) {
      pal[line * 16 + 1] = hex(0x004080); pal[line * 16 + 6] = hex(0xC8845C); pal[line * 16 + 7] = hex(0xA46C48);
      pal[line * 16 + 14] = hex(0xA06060); pal[line * 16 + 15] = hex(0x40A0E0);
    }
    return pal;
  }
  /** Is 93 colour v a team colour (the port matches those to 95 PC's team colours, sprite 144-191 only)? */
  function isTeamColour(v) { const c = v & 15; return v >= 32 && c !== 1 && c !== 6 && c !== 7 && c !== 14 && c !== 15; }

  /** The 93 team (TEAMS index) for a 95 PC team code, or -1 (Anaheim and Florida were not in 93) */
  function teamFor(code) { return TEAMS.indexOf(String(code || '').toUpperCase()); }

  /** The port's own choice (port/fight/hooks.c make_lut): the nearest 95 PC sprite colour (0-191) to each 93 colour.
   *  pal93: 64 [r,g,b] (after pc95Colours); pc: 256 [r,g,b], the sprite palette. teamOnly: 93 team colours only look
   *  at 95 PC's team colours (144-191), for a team 93 did not have. Returns 64 sprite indexes. */
  function autoMap(pal93, pc, teamOnly) {
    const out = new Array(64).fill(0);
    const dist = (a, b) => { const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]; return dr * dr * 3 + dg * dg * 4 + db * db * 2; };
    for (let v = 1; v < 64; v++) {
      const team = teamOnly && isTeamColour(v), lo = team ? 0x90 : 0;
      let best = lo, bd = Infinity;
      for (let s = lo; s < 0xC0; s++) { const dd = dist(pc[s] || [0, 0, 0], pal93[v]); if (dd < bd) { bd = dd; best = s; } }
      out[v] = best;
    }
    return out;
  }

  /** FIGHTPAL.TXT, read by the NHL 95 PC port from its game folder: a "[code side]" section per jersey (95 PC team
   *  code, home or away), each with "v = s" lines: 93 colour v (line x 16 + colour, 1-47; line 3 follows line 2) shown
   *  with 95 PC sprite colour s (0-254, through that team's colours). Lines before any section are for every jersey.
   *  jerseys: [{ code, side, map: 64 entries (null: none) }]. */
  function writeText(jerseys, used) {
    const lines = ['; NHL 95 PC fight colours (NHL9X Studio): a palette per jersey, NHLPA 93 colour = NHL 95 PC sprite colour',
      '; 93 colour: palette line x 16 + colour (lines 0 and 1 the rink, 2 the team); 15 is the eye.',
      '; A jersey with no section here uses its 93 jersey\'s colours, matched to the nearest 95 PC ones.'];
    for (const j of jerseys) {
      lines.push('', '[' + j.code.toLowerCase() + ' ' + j.side + ']');
      for (let v = 1; v < 48; v++) if (j.map[v] != null && (!used || used.has(v))) lines.push(v + ' = ' + j.map[v]);
    }
    return lines.join('\r\n') + '\r\n';
  }
  /** -> { all: 64 entries, jerseys: { 'code side': 64 entries } } */
  function readText(text) {
    const blank = () => new Array(64).fill(null);
    const out = { all: blank(), jerseys: {} };
    let cur = out.all;
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.replace(/[;#].*$/, '').trim(); if (!line) continue;
      const sec = /^\[\s*([a-z]+)\s+(home|away)\s*\]$/i.exec(line);
      if (sec) { const k = sec[1].toLowerCase() + ' ' + sec[2].toLowerCase(); cur = out.jerseys[k] = out.jerseys[k] || blank(); continue; }
      const m = /^(\d+)\s*=\s*(\d+)$/.exec(line);
      if (!m) throw new Error('FIGHTPAL.TXT: not "colour = colour" or "[team home|away]": ' + raw);
      const v = Number(m[1]), s = Number(m[2]);
      if (v < 1 || v > 47 || s > 254) throw new Error('FIGHTPAL.TXT: out of range: ' + raw);
      cur[v] = s;
    }
    return out;
  }

  return { open, frameCount, decode, markEyes, palette, pc95Colours, isTeamColour, teamFor, autoMap, writeText, readText, FRAMES, FIGHT_FRAMES, TEAMS, EYE };
});
