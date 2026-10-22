/**
 * NHL 94 PC / NHL 95 PC jersey palettes (HOMEPALS.BIN, AWAYPALS.BIN), the files JED 3.01 edits.
 *
 * File: one 448-byte record per team, nothing else (no header). NHL 95 PC has 28 records (12,544 bytes: 26 teams
 * then the West and East All-Stars). NHL 94 PC has 26 (11,648 bytes: 24 teams, no Anaheim or Florida, then the
 * All-Stars). That size is how JED tells the games apart, and how detect() does.
 *
 * Record (offsets inside the 448 bytes):
 *   0..191    64 colours, R G B, 6-bit VGA DAC values (0..63). The game loads them at palette 128..191; the
 *             8-bit value is v * 4 (EA-NHL-Tools PAL-To-ACT binToAct, TEAM_PALETTE_REF_OFFSET 384 = colour 128).
 *   192..319  sprite pixel -> game palette index for sprite indices 0..127 (mostly identity; 8 -> 16 blade side,
 *             82 and 88 -> 99 shadow).
 *   320..447  sprite pixel -> game palette index for sprite indices 128..255 (the "color mapping" binToAct reads):
 *             128..143 skin / eyes / stick (into the rink palette), 144..191 the 48 jersey zones (forearm .. helmet,
 *             EA-NHL-Tools jerseyDef colorZoneMapping), 192..255 four rows of 16: 5 crest pixels, 6 ice logo, 5 unused.
 *             A zone that points at 128..191 is a jersey colour; JED's "painting" changes these bytes.
 *
 * Single palette .bin = one 448-byte record (JED F3/F4 copy/paste). ACT = 256 x RGB (768 bytes, optional 4-byte
 * trailer) in sprite-colour space: entry i is what raw sprite pixel i renders as (binToAct createPal, see toAct).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlPcJersey = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RECORD = 448;
  const COLORS = 64;
  const COLOR_BYTES = 192;
  const MAP_LOW = 192;
  const MAP_HIGH = 320;
  const ACT_BASE = 128;

  const T = (code, name) => ({ code, name });
  const NHL94 = [
    T('bos', 'Boston Bruins'), T('buf', 'Buffalo Sabres'), T('cgy', 'Calgary Flames'), T('chi', 'Chicago Blackhawks'),
    T('det', 'Detroit Red Wings'), T('edm', 'Edmonton Oilers'), T('hfd', 'Hartford Whalers'), T('la', 'Los Angeles Kings'),
    T('min', 'Dallas Stars'), T('mtl', 'Montreal Canadiens'), T('nj', 'New Jersey Devils'), T('nyi', 'New York Islanders'),
    T('nyr', 'New York Rangers'), T('ott', 'Ottawa Senators'), T('phi', 'Philadelphia Flyers'), T('pit', 'Pittsburgh Penguins'),
    T('que', 'Quebec Nordiques'), T('stl', 'St. Louis Blues'), T('sj', 'San Jose Sharks'), T('tb', 'Tampa Bay Lightning'),
    T('tor', 'Toronto Maple Leafs'), T('van', 'Vancouver Canucks'), T('wsh', 'Washington Capitals'), T('wpg', 'Winnipeg Jets')
  ];
  const STARS = [T('asw', 'West All-Stars'), T('ase', 'East All-Stars')];
  const TEAMS = {
    '94': NHL94.concat(STARS),
    '95': NHL94.concat([T('ana', 'Anaheim Mighty Ducks'), T('fla', 'Florida Panthers')], STARS)
  };
  // Sprite indices 144..191 (EA-NHL-Tools PAL-To-ACT jerseyDef colorZoneMapping), 48 zones.
  const ZONES = [
    'forearm dark', 'forearm medium', 'forearm light',
    'arm stripe 3 light', 'arm stripe 3 medium', 'arm stripe 3 dark',
    'arm stripe 2 dark', 'arm stripe 2 medium', 'arm stripe 2 light',
    'arm stripe 1 light', 'arm stripe 1 medium', 'arm stripe 1 dark',
    'upper arm light', 'upper arm medium', 'upper arm dark',
    'yoke corner', 'shoulder patch', 'yoke 3', 'yoke 1', 'yoke 2',
    'goalie mask', 'jersey light', 'jersey medium', 'jersey dark',
    'waist 1 odd', 'waist 1 even', 'waist 1 hidden',
    'waist 2 light', 'waist 2 medium', 'waist 2 dark',
    'waist 3 light', 'waist 3 medium', 'waist 3 dark',
    'pants dark', 'pants stripe 2', 'pants stripe 1', 'pants medium',
    'socks light', 'socks medium', 'socks dark',
    'socks stripe 1 light', 'socks stripe 1 medium', 'socks stripe 1 dark',
    'socks stripe 2 light', 'socks stripe 2 medium', 'socks stripe 2 dark',
    'helmet medium', 'helmet dark'
  ].map((name, i) => ({ sprite: 144 + i, name }));
  const CREST = [];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 5; col++) CREST.push({ sprite: 192 + row * 16 + col, name: 'crest r' + (row + 1) + 'c' + (col + 1) });

  // Centre-ice logo colours: columns 5..10 of the same four rows (sprite 197..202, 213..218, 229..234, 245..250).
  const ICE = [];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 6; col++) ICE.push({ sprite: 197 + row * 16 + col, name: 'ice logo r' + (row + 1) + 'c' + (col + 1) });

  function bytesOf(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data && data.buffer) return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength);
    return new Uint8Array(data || 0);
  }

  /** '94', '95' or null from a HOMEPALS/AWAYPALS byte length. */
  function detect(data) {
    const n = bytesOf(data).length;
    if (n === RECORD * 28) return '95';
    if (n === RECORD * 26) return '94';
    return null;
  }

  /** Open a HOMEPALS/AWAYPALS file. Keeps a private copy; edits never touch the caller's bytes. */
  function openFile(data, side) {
    const bytes = bytesOf(data);
    const game = detect(bytes);
    if (!game) throw new Error('Not a HOMEPALS/AWAYPALS file: ' + bytes.length + ' bytes (NHL 94 PC is ' + RECORD * 26 + ', NHL 95 PC is ' + RECORD * 28 + ')');
    return { game, side: side || null, teams: TEAMS[game], bytes: new Uint8Array(bytes) };
  }

  function teamCount(file) { return file.bytes.length / RECORD; }

  function checkTeam(file, team) {
    if (!(team >= 0 && team < teamCount(file))) throw new Error('No team ' + team);
  }

  /** The 448-byte record of one team (a copy). */
  function getRecord(file, team) {
    checkTeam(file, team);
    return file.bytes.slice(team * RECORD, (team + 1) * RECORD);
  }

  /** Replace a team's record with a single-palette .bin: 448 bytes, or 192 bytes (colours only). */
  function setRecord(file, team, data) {
    checkTeam(file, team);
    const bytes = bytesOf(data);
    if (bytes.length !== RECORD && bytes.length !== COLOR_BYTES) {
      throw new Error('A single palette .bin is ' + RECORD + ' bytes (or ' + COLOR_BYTES + ' for colours only); this one is ' + bytes.length);
    }
    for (let i = 0; i < COLOR_BYTES; i++) if (bytes[i] > 63) throw new Error('Colour byte ' + i + ' is ' + bytes[i] + '; VGA colours are 0..63');
    file.bytes.set(bytes, team * RECORD);
  }

  /** The 64 colours of a team, [[r, g, b], ...] in 6-bit units. */
  function getColors(file, team) {
    checkTeam(file, team);
    const at = team * RECORD;
    const out = [];
    for (let i = 0; i < COLORS; i++) out.push([file.bytes[at + i * 3], file.bytes[at + i * 3 + 1], file.bytes[at + i * 3 + 2]]);
    return out;
  }

  function clamp6(v) { return Math.max(0, Math.min(63, Math.round(Number(v) || 0))); }

  /** Set colour 0..63 (team palette index; game palette 128 + i) to 6-bit r, g, b. */
  function setColor(file, team, index, rgb) {
    checkTeam(file, team);
    if (!(index >= 0 && index < COLORS)) throw new Error('No colour ' + index);
    const at = team * RECORD + index * 3;
    for (let c = 0; c < 3; c++) file.bytes[at + c] = clamp6(rgb[c]);
  }

  /** 6-bit VGA -> 8-bit, the way the tools do it (v * 4). */
  function to8(v) { return v * 4; }
  /** 8-bit -> 6-bit VGA (nearest, clamped). */
  function to6(v) { return clamp6(v / 4); }

  /** The 256-entry sprite index -> game palette index map of a team. */
  function getMap(file, team) {
    checkTeam(file, team);
    const at = team * RECORD;
    const map = new Uint8Array(256);
    map.set(file.bytes.subarray(at + MAP_LOW, at + MAP_LOW + 128), 0);
    map.set(file.bytes.subarray(at + MAP_HIGH, at + RECORD), 128);
    return map;
  }

  /** Point sprite index `sprite` (128..255) at game palette index `target` (JED painting). */
  function setMap(file, team, sprite, target) {
    checkTeam(file, team);
    if (!(sprite >= 0 && sprite < 256)) throw new Error('No sprite index ' + sprite);
    if (!(target >= 0 && target < 256)) throw new Error('No palette index ' + target);
    const at = team * RECORD + (sprite < 128 ? MAP_LOW + sprite : MAP_HIGH + sprite - 128);
    file.bytes[at] = target;
  }

  /** Team colours that at least one jersey zone or crest pixel points at (indices 0..63). */
  function usedColors(file, team) {
    const map = getMap(file, team);
    const used = new Set();
    for (let s = 128; s < 256; s++) if (map[s] >= ACT_BASE && map[s] < ACT_BASE + COLORS) used.add(map[s] - ACT_BASE);
    return [...used].sort((a, b) => a - b);
  }

  // ---- sprite-space ACT (EA-NHL-Tools PAL-To-ACT binToAct "createPal", what PPV-To-BMP / SPIT-To-BMP apply) ----
  // Raw PC sprite pixels are sprite-colour indices. binToAct builds, per team:
  //   gamePal  = rinkpalShadowfixed 0..127 + team colours 128..191 (* 4, 192..250 black) + rink 251..255
  //   sprite i = gamePal[map[i]]  (map = record bytes 320..447 at i = 128..255; 0..127 map to 0)
  //   createPal = createjerseyShadowfixed 0..143, sprite 144..250, createjerseyShadowfixed 251..255
  // so entry i of the ACT is the RGB sprite pixel i shows in the extracted BMPs and the Studio preview.
  const SPRITE_FIRST = 144, SPRITE_END = 251;
  function rgbList(p) {
    if (!p) return null;
    if (p.length >= 768 && typeof p[0] === 'number') { const o = []; for (let i = 0; i < 256; i++) o.push([p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]); return o; }
    return p;
  }
  /** base = { rink: rinkpalShadowfixed, jersey: createjerseyShadowfixed, rinkPlain?: rinkpal } (768-byte ACTs or 256 [r,g,b]). */
  function gamePalette(file, team, base) {
    const rink = rgbList(base && base.rink); if (!rink) throw new Error('No rink palette (rinkpalShadowfixed.act)');
    const colors = getColors(file, team);
    const out = [];
    for (let k = 0; k < 256; k++) {
      if (k < ACT_BASE || k >= SPRITE_END) out.push((rink[k] || [0, 0, 0]).slice());
      else if (k < ACT_BASE + COLORS) out.push(colors[k - ACT_BASE].map(to8));
      else out.push([0, 0, 0]);
    }
    return out;
  }
  function spritePalette(file, team, base) {
    const jersey = rgbList(base && base.jersey); if (!jersey) throw new Error('No jersey palette (createjerseyShadowfixed.act)');
    const game = gamePalette(file, team, base);
    const map = getMap(file, team);
    const out = [];
    for (let i = 0; i < 256; i++) {
      if (i < SPRITE_FIRST || i >= SPRITE_END) out.push((jersey[i] || [0, 0, 0]).slice());
      else out.push(game[map[i]].slice());
    }
    // Static frames (referee, puck, nets) use the plain rinkpal game palette, as the Studio does.
    out.game = base.rinkPlain ? gamePalette(file, team, { rink: base.rinkPlain }) : game;
    return out;
  }
  /** Which sprite indices (144..250) show each team colour: slot -> [sprite index, ...]. */
  function slotSources(file, team) {
    const map = getMap(file, team);
    const src = []; for (let s = 0; s < COLORS; s++) src.push([]);
    for (let i = SPRITE_FIRST; i < SPRITE_END; i++) if (map[i] >= ACT_BASE && map[i] < ACT_BASE + COLORS) src[map[i] - ACT_BASE].push(i);
    return src;
  }

  /** Sprite-space ACT (768, or 772 with the count-256 / no-transparency trailer). */
  function toAct(file, team, base, trailer) {
    const pal = spritePalette(file, team, base);
    const out = new Uint8Array(trailer ? 772 : 768);
    for (let i = 0; i < 256; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = pal[i][c];
    if (trailer) { out[768] = 1; out[769] = 0; out[770] = 0xff; out[771] = 0xff; }
    return out;
  }

  /** Inverse of toAct. Each team colour takes the ACT entry of the lowest sprite index (144..250) that maps to it
   *  (/ 4, rounded); other entries are ignored. Returns { set, unmapped, conflicts: [{ slot, used, sources: [{ index, rgb }] }] }
   *  where a conflict is a slot whose sprite indices disagree in the ACT (after 6-bit rounding). Map untouched. */
  function fromAct(file, team, data) {
    const bytes = bytesOf(data);
    if (bytes.length !== 768 && bytes.length !== 772) throw new Error('An ACT is 768 bytes (772 with the trailer); this one is ' + bytes.length);
    if (bytes.length === 772) {
      const count = (bytes[768] << 8) | bytes[769];
      if (count && count !== 256 && count < SPRITE_END) throw new Error('ACT has ' + count + ' colours; jersey colours use sprite indices 144..250');
    }
    const six = (i) => [to6(bytes[i * 3]), to6(bytes[i * 3 + 1]), to6(bytes[i * 3 + 2])];
    const report = { set: [], unmapped: [], conflicts: [] };
    slotSources(file, team).forEach((idx, slot) => {
      if (!idx.length) { report.unmapped.push(slot); return; }
      const used = six(idx[0]);
      setColor(file, team, slot, used);
      report.set.push(slot);
      const sources = idx.map((index) => ({ index, rgb: six(index) }));
      if (sources.some((x) => x.rgb.join() !== used.join())) report.conflicts.push({ slot, used: idx[0], sources });
    });
    return report;
  }

  /** The whole file, as bytes (identical to the input until something is edited). */
  function exportFile(file) { return new Uint8Array(file.bytes); }

  return { RECORD, COLORS, COLOR_BYTES, ACT_BASE, TEAMS, ZONES, CREST, ICE, detect, openFile, teamCount, getRecord, setRecord, getColors, setColor, to8, to6, getMap, setMap, usedColors, toAct, fromAct, exportFile, gamePalette, spritePalette, slotSources, SPRITE_FIRST, SPRITE_END };
}));
