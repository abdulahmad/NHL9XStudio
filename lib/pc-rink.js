/**
 * NHL 94 PC / NHL 95 PC centre ice: <TEAM>.TIL (tiles) + <TEAM>.MAP (tile map).
 *
 *   .TIL  NHL 95 PC: 64 bytes per 8x8 tile, linear row-by-row (BlitTileMap src++). NHL 94 PC: the same
 *         64 bytes per tile, but the file is four concatenated Mode X planes (VgaStorePlanes /
 *         hockey94demo sub_2447D): plane p is 16 bytes × N tiles, then plane p+1. Each 16-byte
 *         block is 8 rows of 2 bytes; pixel (x,y) is plane[x%4][tile*16 + y*2 + (x>>2)].
 *         Reading those bytes as linear 8×8 makes the ice a scanline dither and the crowd noise.
 *         VgaStamp8 (seg000) is the VGA blit of an already-planar 8×8: 8 rows of 2 bytes, pitch 96.
 *         Bit 0x800 is a true left-right reverse (read plane p, write plane 3-p, and swap the two
 *         bytes — 7-px on the linear tile, not a 4-pixel group swap). Bit 0x1000 walks the rows
 *         backward (7-py). 0x1800 is 180 degrees.
 *   .MAP  u16 width (tiles), u16 height (tiles), u16 unused (16 in 95, 528 in 94), then width*height u16 entries row
 *         by row. NHL 95 PC: entry & 0x3FF = tile (so at most 1024 tiles), 0x2000 = mirror left-right,
 *         0x4000 = flip upside down; the other bits are ignored. NHL 94 PC uses 0x800 / 0x1000 from VgaStamp8.
 *   Rink  RINK.QFS (95) is a 384x592 picture = 48 x 74 tiles. NHL 94 PC has no QFS; RINK.TIL + RINK.MAP is that
 *         overhead picture (Images tab) and the scrolling gameplay ice: sparkly fill, faceoff circles, crowd.
 *         TRINKND.QPP is the transparent rink-end glass overlay (LoadTransparentRinkEndOverlay), not the ice.
 *         LoadRink draws the tiled rink, then BlitTileMap stamps the team map at
 *         the arena's (x, y) tile, and when x2 > 0 a second time at (x2, y2) with flags 0x6000: rotated 180 degrees,
 *         growing up and left from (x2, y2). Pixel 255 is skipped (transparent). The game does not clip; this module does.
 *   Placement  HOCKEY.EXE arena table (95: file offset 0x10E4EC, 12 bytes per team: name, x, y, x2, y2). Arena = home
 *         team; the All-Stars play in arena 12 (NY Rangers). The editor keeps placement as JSON, never patches the EXE.
 *
 * Palette live on the rink (LoadTeamPalette): 0..127 rink palette (RINKPAL !pal), 128..191 the HOME team's 64
 * HOMEPALS colours, 192..250 the AWAY team's AWAYPALS colours, 251..255 rink palette again (fixed).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlPcRink = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const W = 48, H = 74, TILE = 8, PX_W = W * TILE, PX_H = H * TILE, MAX_TILES = 1024, CLEAR = 255;
  const HFLIP = 0x2000, VFLIP = 0x4000, INDEX = 0x3FF;
  /** Editor model cells: tile index in the low 13 bits (the model may hold more than 1024 tiles before export). */
  const CELL = 0x1FFF;
  const ARENAS = ['BOS', 'BUF', 'CGY', 'CHI', 'DET', 'EDM', 'HFD', 'LA', 'MIN', 'MTL', 'NJ', 'NYI', 'NYR', 'OTT', 'PHI',
    'PIT', 'QUE', 'STL', 'SJ', 'TB', 'TOR', 'VAN', 'WSH', 'WPG', 'ANH', 'FLO'];
  /** Retail arena placement (x, y, x2, y2 in tiles; x2 <= 0 = no second logo). */
  const PLACEMENT = {
    95: { BOS: [21, 38, -1, -1], BUF: [22, 36, -1, -1], CGY: [22, 37, -1, -1], CHI: [22, 37, -1, -1], DET: [21, 37, -1, -1],
      EDM: [22, 44, 25, 35], HFD: [22, 37, -1, -1], LA: [32, 45, 15, 34], MIN: [21, 37, -1, -1], MTL: [22, 37, -1, -1],
      NJ: [30, 45, 17, 34], NYI: [22, 38, -1, -1], NYR: [22, 36, -1, -1], OTT: [21, 38, -1, -1], PHI: [22, 37, -1, -1],
      PIT: [13, 31, 34, 48], QUE: [22, 36, -1, -1], STL: [21, 36, -1, -1], SJ: [21, 38, -1, -1], TB: [22, 38, -1, -1],
      TOR: [22, 38, -1, -1], VAN: [21, 36, -1, -1], WSH: [22, 37, -1, -1], WPG: [21, 38, -1, -1], ANH: [21, 37, -1, -1],
      FLO: [21, 37, -1, -1] }
  };
  PLACEMENT[94] = Object.assign({}, PLACEMENT[95], { MIN: [22, 36, -1, -1], NYR: [22, 38, -1, -1], SJ: [19, 36, -1, -1], VAN: [21, 37, -1, -1] });
  delete PLACEMENT[94].ANH; delete PLACEMENT[94].FLO;

  /** Palette sources on the rink, per index. usable: may go in centre-ice art. */
  const RANGES = [
    { first: 0, last: 127, source: 'rink', label: 'Rink palette (fixed)', usable: true },
    { first: 128, last: 191, source: 'home', label: 'Home team colours (change with the home team)', usable: true, varies: true },
    { first: 192, last: 250, source: 'away', label: 'Away team colours (change every game — not allowed)', usable: false, varies: true },
    { first: 251, last: 254, source: 'fixed', label: 'Rink palette 251–254 (fixed)', usable: true },
    { first: 255, last: 255, source: 'clear', label: 'Transparent (the blitter skips 255)', usable: true }
  ];
  function rangeOf(i) { return RANGES.find((r) => i >= r.first && i <= r.last); }
  function usable(i) { const r = rangeOf(i); return Boolean(r && r.usable); }

  /** 256 x [r,g,b] 8-bit as on the rink. rinkAct: 768-byte 8-bit ACT (rinkpal); home/away: 64 x [r,g,b] 6-bit. */
  function gamePalette(rinkAct, home, away) {
    const out = [];
    for (let i = 0; i < 256; i++) out.push([rinkAct[i * 3], rinkAct[i * 3 + 1], rinkAct[i * 3 + 2]]);
    const to8 = (v) => Math.min(255, v * 4);
    if (home) for (let i = 0; i < 64; i++) out[128 + i] = home[i].map(to8);
    if (away) for (let i = 0; i < 59; i++) out[192 + i] = away[i].map(to8);
    return out;
  }

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function parseMap(bytes) {
    if (!bytes || bytes.length < 6) throw new Error('.MAP is too short');
    const w = u16(bytes, 0), h = u16(bytes, 2), flag = u16(bytes, 4);
    if (!w || !h || 6 + w * h * 2 > bytes.length) throw new Error('.MAP header ' + w + 'x' + h + ' does not fit ' + bytes.length + ' bytes');
    const cells = new Uint16Array(w * h);
    for (let i = 0; i < cells.length; i++) cells[i] = u16(bytes, 6 + i * 2);
    return { w, h, flag, cells, tail: bytes.length > 6 + w * h * 2 ? Uint8Array.from(bytes.subarray(6 + w * h * 2)) : null };
  }
  function writeMap(m) {
    const extra = m.tail ? m.tail.length : 0;
    const out = new Uint8Array(6 + m.cells.length * 2 + extra);
    const put = (o, v) => { out[o] = v & 255; out[o + 1] = (v >> 8) & 255; };
    put(0, m.w); put(2, m.h); put(4, m.flag == null ? 16 : m.flag);
    m.cells.forEach((c, i) => put(6 + i * 2, c));
    if (extra) out.set(m.tail, 6 + m.cells.length * 2);
    return out;
  }
  /** Mode X 8×8: four 16-byte planes packed in one 64-byte tile → linear pixels. */
  function unswizzle94(tile) {
    const src = tile;
    const out = new Uint8Array(64);
    for (let p = 0; p < 4; p++) {
      const plane = p * 16;
      for (let y = 0; y < 8; y++) for (let i = 0; i < 2; i++) out[y * 8 + i * 4 + p] = src[plane + y * 2 + i];
    }
    return out;
  }
  function swizzle94(tile) {
    const src = tile;
    const out = new Uint8Array(64);
    for (let p = 0; p < 4; p++) {
      const plane = p * 16;
      for (let y = 0; y < 8; y++) for (let i = 0; i < 2; i++) out[plane + y * 2 + i] = src[y * 8 + i * 4 + p];
    }
    return out;
  }
  /** NHL 94 PC .TIL: four concatenated planes (VgaStorePlanes), 16 bytes per tile per plane. */
  function parseTil94(bytes) {
    const planeSize = bytes.length / 4;
    const n = planeSize / 16;
    const tiles = [];
    for (let i = 0; i < n; i++) {
      const out = new Uint8Array(64);
      for (let p = 0; p < 4; p++) {
        const src = p * planeSize + i * 16;
        for (let y = 0; y < 8; y++) for (let q = 0; q < 2; q++) out[y * 8 + q * 4 + p] = bytes[src + y * 2 + q];
      }
      tiles.push(out);
    }
    return tiles;
  }
  function writeTil94(tiles) {
    const n = tiles.length;
    const planeSize = n * 16;
    const out = new Uint8Array(n * 64);
    for (let i = 0; i < n; i++) {
      const src = tiles[i];
      for (let p = 0; p < 4; p++) {
        const dest = p * planeSize + i * 16;
        for (let y = 0; y < 8; y++) for (let q = 0; q < 2; q++) out[dest + y * 2 + q] = src[y * 8 + q * 4 + p];
      }
    }
    return out;
  }
  function parseTil(bytes, game) {
    if (bytes.length % 64) throw new Error('.TIL size ' + bytes.length + ' is not a multiple of 64 (the game refuses it)');
    if (game === 94) return parseTil94(bytes);
    const tiles = [];
    for (let o = 0; o < bytes.length; o += 64) {
      tiles.push(Uint8Array.from(bytes.subarray(o, o + 64)));
    }
    return tiles;
  }
  function writeTil(tiles, game) {
    if (game === 94) return writeTil94(tiles);
    const out = new Uint8Array(tiles.length * 64);
    tiles.forEach((t, i) => out.set(t, i * 64));
    return out;
  }

  /** BlitTileMap: stamp map (w, h, cells) of tiles into a 384x592 index buffer at tile (x, y); flags 0x6000 = the
   *  rotated second copy. Clipped to the rink (the game is not). game: 95 (0x2000/0x4000) or 94 (0x800/0x1000). */
  function blit(target, map, tiles, x, y, flags, game) {
    const hBit = game === 94 ? 0x800 : HFLIP, vBit = game === 94 ? 0x1000 : VFLIP, mask = game === 94 ? 0x7FF : INDEX;
    const rot = Boolean(flags);
    for (let row = 0; row < map.h; row++) {
      for (let col = 0; col < map.w; col++) {
        const e = map.cells[row * map.w + col];
        const tile = tiles[e & mask]; if (!tile) continue;
        const v = Boolean(e & vBit) !== rot, hf = Boolean(e & hBit) !== rot;
        const tx = rot ? x - col : x + col, ty = rot ? y - row : y + row;
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
        for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
          const p = tile[py * 8 + px]; if (p === CLEAR) continue;
          const dx = hf ? 7 - px : px, dy = v ? 7 - py : py;
          target[(ty * 8 + dy) * PX_W + tx * 8 + dx] = p;
        }
      }
    }
    return target;
  }
  /** Rink with the centre ice: copy of rink pixels (384x592) + map at place [x, y, x2, y2] as LoadRink does. */
  function composite(rink, map, tiles, place, game) {
    const out = Uint8Array.from(rink || new Uint8Array(PX_W * PX_H).fill(CLEAR));
    if (!map) return out;
    blit(out, map, tiles, place[0], place[1], 0, game);
    if (place[2] > 0) blit(out, map, tiles, place[2], place[3], 0x6000, game);
    return out;
  }
  /** Full rink picture for the Images tab: blit RINK.TIL / RINK.MAP at (0, 0). NHL 94 PC has no RINK.QFS.
   *  94 disk tiles are file-level Mode X planes; blit uses VgaStamp8 0x800/0x1000 vs 95 0x2000/0x4000. */
  function fullPicture(tilBytes, mapBytes, game) {
    const g = game || 94;
    const map = parseMap(mapBytes);
    const tiles = parseTil(tilBytes, g);
    return { width: PX_W, height: PX_H, pixels: composite(null, map, tiles, [0, 0, -1, -1], g) };
  }
  /** The map alone as pixels (w*8 x h*8, 255 = transparent). */
  function renderMap(map, tiles, game) {
    const out = { width: map.w * 8, height: map.h * 8, pixels: new Uint8Array(map.w * 8 * map.h * 8).fill(CLEAR) };
    const tmp = new Uint8Array(PX_W * PX_H).fill(CLEAR);
    const m = { w: Math.min(map.w, W), h: Math.min(map.h, H), cells: map.cells.filter((c, i) => i % map.w < W && Math.floor(i / map.w) < H) };
    blit(tmp, m, tiles, 0, 0, 0, game);
    for (let y = 0; y < m.h * 8; y++) out.pixels.set(tmp.subarray(y * PX_W, y * PX_W + m.w * 8), y * out.width);
    return out;
  }

  // ---- editor model: a 48 x 74 grid of entries (or -1) plus a tile list ----------------------------------------------
  function modelFrom(map, tiles, place) {
    const cells = new Int32Array(W * H).fill(-1);
    for (let row = 0; row < map.h; row++) for (let col = 0; col < map.w; col++) {
      const x = place[0] + col, y = place[1] + row;
      if (x >= 0 && y >= 0 && x < W && y < H) { const e = map.cells[row * map.w + col]; cells[y * W + x] = (e & INDEX) | (e & (HFLIP | VFLIP)); }
    }
    return { cells, tiles: tiles.map((t) => Uint8Array.from(t)), place: place.slice(), flag: map.flag == null ? 16 : map.flag };
  }
  function cloneModel(m) { return { cells: Int32Array.from(m.cells), tiles: m.tiles.map((t) => Uint8Array.from(t)), place: m.place.slice(), flag: m.flag }; }
  function bounds(m) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    m.cells.forEach((c, i) => { if (c < 0) return; const x = i % W, y = (i - x) / W; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  const key = (t) => Array.prototype.join.call(t, ',');
  function flipped(t, h, v) { const o = new Uint8Array(64); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) o[y * 8 + x] = t[(v ? 7 - y : y) * 8 + (h ? 7 - x : x)]; return o; }
  /** Export: bounding box of placed cells -> .MAP (+ a transparent tile for gaps), unused tiles dropped, tiles
   *  deduplicated (also mirrored / flipped copies). Throws past 1024 tiles. Returns { map, tiles, place }. */
  function build(m) {
    const b = bounds(m);
    if (!b) throw new Error('No tiles are placed on the rink');
    const out = []; const seen = new Map();
    const add = (t) => {
      for (const [h, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const k = key(h || v ? flipped(t, h, v) : t); if (seen.has(k)) return seen.get(k) | (h ? HFLIP : 0) | (v ? VFLIP : 0);
      }
      seen.set(key(t), out.length); out.push(Uint8Array.from(t)); return out.length - 1;
    };
    const cells = new Uint16Array(b.w * b.h);
    for (let row = 0; row < b.h; row++) for (let col = 0; col < b.w; col++) {
      const e = m.cells[(b.y + row) * W + b.x + col];
      let t = e < 0 ? new Uint8Array(64).fill(CLEAR) : m.tiles[e & CELL];
      if (e >= 0 && (e & (HFLIP | VFLIP))) t = flipped(t, Boolean(e & HFLIP), Boolean(e & VFLIP));
      cells[row * b.w + col] = add(t);
    }
    if (out.length > MAX_TILES) throw new Error(out.length + ' different tiles; NHL 95 PC takes at most ' + MAX_TILES + ' (tile index is 10 bits)');
    return { map: { w: b.w, h: b.h, flag: m.flag, cells }, tiles: out, place: [b.x, b.y, m.place[2], m.place[3]] };
  }
  /** Same, but keep the original .MAP / .TIL bytes when nothing changed (byte-identical round trip). */
  function exportFiles(m, original, game) {
    if (original) {
      const again = modelFrom(original.map, original.tiles, original.place);
      if (sameModel(again, m)) return { map: writeMap(original.map), til: writeTil(original.tiles, game), place: m.place.slice() };
    }
    const r = build(m);
    return { map: writeMap(r.map), til: writeTil(r.tiles, game), place: r.place, tiles: r.tiles.length };
  }
  function sameModel(a, b) {
    if (a.place.join() !== b.place.join() || a.tiles.length !== b.tiles.length) return false;
    for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) return false;
    return a.tiles.every((t, i) => key(t) === key(b.tiles[i]));
  }

  /** Nearest allowed palette index for each pixel (alpha < 128 -> 255 transparent). allowed: array of indices. */
  function quantize(rgba, palette, allowed) {
    const n = rgba.length / 4; const out = new Uint8Array(n); const cache = new Map();
    const list = allowed.filter((i) => i !== CLEAR);
    for (let p = 0; p < n; p++) {
      const r = rgba[p * 4], g = rgba[p * 4 + 1], b = rgba[p * 4 + 2], a = rgba[p * 4 + 3];
      if (a < 128) { out[p] = CLEAR; continue; }
      const k = (r << 16) | (g << 8) | b;
      let best = cache.get(k);
      if (best === undefined) {
        let d0 = Infinity;
        for (const i of list) {
          const c = palette[i]; const dr = r - c[0], dg = g - c[1], db = b - c[2];
          const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
          if (d < d0) { d0 = d; best = i; }
        }
        cache.set(k, best);
      }
      out[p] = best;
    }
    return out;
  }
  /** Put an indexed picture (w x h, 255 = transparent) on the model at pixel (px, py), snapped to tiles; cells it
   *  fully leaves transparent are left alone. Tiles are deduplicated; throws past 1024. Returns the new model. */
  /** Which 8x8 cells of an image (w x h at tile tx, ty) become tiles. keep(col, row) -> bool. */
  function cellsDiffering(indexed, w, h, tx, ty, rink) {
    return (col, row) => {
      for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
        const sx = col * 8 + px, sy = row * 8 + py; if (sx >= w || sy >= h) continue;
        const v = indexed[sy * w + sx]; if (v === CLEAR) continue;
        const rx = (tx + col) * 8 + px, ry = (ty + row) * 8 + py;
        if (rx >= PX_W || ry >= PX_H || !rink || rink[ry * PX_W + rx] !== v) return true;
      }
      return false;
    };
  }
  /** Mask image (same size, RGBA): a cell becomes a tile when any of its mask pixels is light and opaque. */
  function cellsFromMask(rgba, w, h) {
    return (col, row) => {
      for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
        const sx = col * 8 + px, sy = row * 8 + py; if (sx >= w || sy >= h) continue;
        const o = (sy * w + sx) * 4; if (rgba[o + 3] >= 128 && rgba[o] + rgba[o + 1] + rgba[o + 2] > 384) return true;
      }
      return false;
    };
  }
  function placeImage(m, indexed, w, h, tx, ty, keep) {
    const next = cloneModel(m);
    const index = new Map(next.tiles.map((t, i) => [key(t), i]));
    for (let row = 0; row < Math.ceil(h / 8); row++) for (let col = 0; col < Math.ceil(w / 8); col++) {
      const x = tx + col, y = ty + row; if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if (keep && !keep(col, row)) continue;
      const t = new Uint8Array(64).fill(CLEAR); let any = false;
      for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
        const sx = col * 8 + px, sy = row * 8 + py; if (sx >= w || sy >= h) continue;
        const v = indexed[sy * w + sx]; t[py * 8 + px] = v; if (v !== CLEAR) any = true;
      }
      if (!any) continue;
      const k = key(t); let i = index.get(k);
      if (i === undefined) { i = next.tiles.length; next.tiles.push(t); index.set(k, i); }
      next.cells[y * W + x] = i;
    }
    const used = new Set(); next.cells.forEach((c) => { if (c >= 0) used.add(c & CELL); });
    if (used.size > MAX_TILES) {
      const err = new Error('That needs ' + used.size + ' different tiles (exact duplicates removed); NHL 95 PC takes at most ' + MAX_TILES +
        ' (10-bit tile index). Use a mask or "differs from the rink" so only logo / ad cells become tiles, or simplify the art.');
      err.tiles = used.size; throw err;
    }
    return next;
  }
  // ---- blocks: rectangles of cells, moved / copied / mirrored without touching shared tile pixels ---------------
  // BlitTileMap honours the per-cell bits (0x2000 mirror left-right, 0x4000 flip top-bottom), so mirror, flip and
  // 180 are done with those bits plus reordering. 90 / 270 cannot be expressed with bits: they add rotated tiles.
  function clipRect(r) { const x = Math.max(0, r.x), y = Math.max(0, r.y); return { x, y, w: Math.max(0, Math.min(W, r.x + r.w) - x), h: Math.max(0, Math.min(H, r.y + r.h) - y) }; }
  function grab(m, r) {
    const cells = new Int32Array(r.w * r.h).fill(-1);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const X = r.x + x, Y = r.y + y; if (X >= 0 && Y >= 0 && X < W && Y < H) cells[y * r.w + x] = m.cells[Y * W + X]; }
    return { w: r.w, h: r.h, cells };
  }
  function clearRect(m, r) { for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const X = r.x + x, Y = r.y + y; if (X >= 0 && Y >= 0 && X < W && Y < H) m.cells[Y * W + X] = -1; } }
  /** Write a block's non-empty cells at (x, y); cells off the rink are dropped. Returns how many were written. */
  function stamp(m, b, x, y) {
    let n = 0;
    for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) {
      const e = b.cells[j * b.w + i], X = x + i, Y = y + j; if (e < 0 || X < 0 || Y < 0 || X >= W || Y >= H) continue;
      m.cells[Y * W + X] = e; n++;
    }
    return n;
  }
  function rot90(t, cw) { const o = new Uint8Array(64); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) o[cw ? x * 8 + (7 - y) : (7 - x) * 8 + y] = t[y * 8 + x]; return o; }
  /** Transform a block: 'h' mirror, 'v' flip, '180' (cell bits + reordering), '90' / '270' clockwise (new tiles
   *  appended to m.tiles, reused when the same rotated tile already exists). Returns the new block. */
  function transform(m, b, op) {
    const out = (w, h) => ({ w, h, cells: new Int32Array(w * h).fill(-1) });
    if (op === 'h' || op === 'v' || op === '180') {
      const o = out(b.w, b.h), fh = op !== 'v', fv = op !== 'h';
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
        const e = b.cells[y * b.w + x]; if (e < 0) continue;
        o.cells[(fv ? b.h - 1 - y : y) * b.w + (fh ? b.w - 1 - x : x)] = e ^ (fh ? HFLIP : 0) ^ (fv ? VFLIP : 0);
      }
      return o;
    }
    const cw = op === '90'; if (!cw && op !== '270') throw new Error('Unknown transform ' + op);
    const o = out(b.h, b.w); const index = new Map(m.tiles.map((t, i) => [key(t), i]));
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const e = b.cells[y * b.w + x]; if (e < 0) continue;
      const t = rot90(flipped(m.tiles[e & CELL], Boolean(e & HFLIP), Boolean(e & VFLIP)), cw);
      const k = key(t); let i = index.get(k); if (i === undefined) { i = m.tiles.length; m.tiles.push(t); index.set(k, i); }
      const nx = cw ? b.h - 1 - y : y, ny = cw ? x : b.w - 1 - x;
      o.cells[ny * o.w + nx] = i;
    }
    return o;
  }
  /** Drop tiles no cell uses, renumbering the cells (flip bits kept). Returns { model, removed, map: old -> new }. */
  function removeUnused(m) {
    const used = new Set(); m.cells.forEach((e) => { if (e >= 0) used.add(e & CELL); });
    const remap = new Int32Array(m.tiles.length).fill(-1); const tiles = [];
    m.tiles.forEach((t, i) => { if (used.has(i)) { remap[i] = tiles.length; tiles.push(Uint8Array.from(t)); } });
    const next = cloneModel(m); next.tiles = tiles;
    next.cells = Int32Array.from(m.cells, (e) => (e < 0 ? -1 : remap[e & CELL] | (e & (HFLIP | VFLIP))));
    return { model: next, removed: m.tiles.length - tiles.length };
  }
  /** Delete tile t from the set: cells that use it become empty (count returned), later tiles shift down one. */
  function deleteTile(m, t) {
    const next = cloneModel(m); let cleared = 0;
    next.tiles.splice(t, 1);
    next.cells = Int32Array.from(m.cells, (e) => {
      if (e < 0) return -1; const i = e & CELL; if (i === t) { cleared++; return -1; }
      return (i > t ? i - 1 : i) | (e & (HFLIP | VFLIP));
    });
    return { model: next, cleared };
  }
  function usersOf(m, t) { let n = 0; m.cells.forEach((e) => { if (e >= 0 && (e & CELL) === t) n++; }); return n; }

  /** Tiles the model actually uses (after dedupe on export this is what counts against 1024). */
  function tileCount(m) { try { return build(m).tiles.length; } catch (e) { return m.tiles.length; } }

  return { W, H, TILE, PX_W, PX_H, MAX_TILES, CLEAR, HFLIP, VFLIP, INDEX, CELL, ARENAS, PLACEMENT, RANGES, rangeOf, usable,
    gamePalette, parseMap, writeMap, parseTil, writeTil, unswizzle94, swizzle94, blit, composite, fullPicture, renderMap, modelFrom, cloneModel, bounds,
    build, exportFiles, cellsDiffering, cellsFromMask, sameModel, quantize, placeImage, tileCount, flipped, clipRect, grab, clearRect, stamp, transform, rot90, removeUnused, deleteTile, usersOf };
}));
