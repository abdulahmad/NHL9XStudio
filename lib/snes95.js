/**
 * NHL '95 (SNES): the unpacker, the uniform palettes and the player frames.
 *
 * Names are the NHL95SNES source's (src/frames95s.asm, src/data/gfx). The ROM is a headerless 1 MB HiROM; banks $C0-$CF
 * map straight to the file (file offset = (bank - $C0) * $10000 + the low word).
 *
 * Unpacker ($C581E1 in the game, tools/unpack95.py in NHL95SNES): a packed set is a word with the unpacked size, a word with
 * the format (0, 2, 4, 6 or 8), then the stream. Formats 0, 2 and 4 read a command byte: below $80, that many plus one
 * literal bytes follow; $80 and up is a copy of earlier output, and a copy length of 0 ends the stream. Format 0 copies
 * (command & $7F) + 1 bytes from the absolute output offset in the next word. Formats 2 and 4 copy
 * ((command & $7F) >> 2 or >> 3) + 1 bytes from (the low 2 or 3 command bits : the next byte) back. Formats 6 and 8 read a
 * flag byte for each 8 items. Flag clear: a count byte, then that many literal bytes (count 0 ends the stream). Flag set:
 * two bytes, a copy of (first byte >> 3 or >> 4) + 3 bytes from (low 3 or 4 bits : second byte) back.
 *
 * Player frames: FrameTileSource (a word per frame, $C60000) and FrameBankLayout (a word per frame, $C60848: the bank of the
 * frame's raw 4bpp tiles in the low byte and its layout number in the high byte) say where the tiles are and how they are
 * drawn. LayoutSizes ($CFF27C, a word per layout number) gives the tile bytes: twice the low byte for each of two rows of
 * 16 x 16 pieces' tiles (the second row 16 tiles after the first in VRAM), then the high byte for the 8 x 8 pieces. The
 * layout record (LayoutPointers $CFF3A2, entry number - 1) is a handler byte (0, 2, 4 or 6: one to four 16 x 16 pieces, 8: none)
 * with an x / y byte pair for each piece, then the same for the 8 x 8 pieces. FrameOffsetX / FrameOffsetY ($C61090 / $C618D8,
 * signed words) add to every piece's x / y. Layout 145 (the flipping puck, SPFpuck+1 to +10) is one 8 x 8 piece drawn by code at the frame's offsets; layouts 143 and 144 (the second net, SPFgoal+1) are drawn by code too and are not read here.
 *
 * Map sets (pictures; DecompressLZSS, MapSetToWRAM): three chunks one after another, each a word with its length (the bytes
 * after it). Map chunk: width and height in tiles (bytes), a flags byte ($8C: packed, a map of words), then the packed stream.
 * Tiles chunk: a word tile count, four flag bytes ($80 packed, bits per pixel twice: 4 or 2), then the packed stream. Colour
 * chunk: a palette count byte, a word of colours a palette, a word with the total, then the BGR555 colours. A packed stream is
 * a word with the unpacked size, then LZSS with a 4 KB ring (position $FEE to start, zero filled): a flag byte for each 8
 * items (1 = a literal byte), a copy is two bytes: the ring position (low 8 bits, then the high nibble of the second byte
 * shifted left 4) and a length of (low nibble + 3). Map entries are the SNES's (tile, palette row, flips); a picture's
 * palette rows start where the game loads them, so the lowest row a map uses is the first palette.
 *
 * parse95 returns the shape lib/snes.js parse94 does, so the stage draws it. The players' jersey is sprite palette 2 (the
 * game allocates a sprite palette per team at run time), so the pieces use row 2 and a jersey palette replaces that row.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl95Snes = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const FRAMES = 1060;
  const FRAME_TILE_SOURCE = 0xC60000;
  const FRAME_BANK_LAYOUT = 0xC60848;
  const FRAME_OFFSET_X = 0xC61090;
  const FRAME_OFFSET_Y = 0xC618D8;
  const LAYOUT_SIZES = 0xCFF27C;
  const LAYOUT_POINTERS = 0xCFF3A2;
  const TEAM_PALETTES = 0xC00000;
  const AWAY_UNIFORM = 0xC03F02;     // away (dark) palette of team 0; the home one follows 32 bytes later; 64 bytes a team
  const TEAMS = [
    'ANH', 'BOS', 'BUF', 'CGY', 'CHI', 'DAL', 'DET', 'EDM', 'FLA', 'HFD', 'LA', 'MTL',
    'NJ', 'NYI', 'NYR', 'OTW', 'PHI', 'PIT', 'QUE', 'SJ', 'STL', 'TB', 'TOR', 'VAN',
    'WSH', 'WPG', 'ASE', 'ASW'
  ];

  function toBytes(romBytes) {
    let rom = romBytes instanceof Uint8Array ? romBytes : new Uint8Array(romBytes || 0);
    if (rom.length % 1024 === 512) rom = rom.subarray(512);
    return rom;
  }

  // The file offset of a $C0-$CF address.
  function offsetOf(addr) {
    return ((addr >> 16) & 0x3F) * 0x10000 + (addr & 0xFFFF);
  }

  function u16(rom, o) {
    return rom[o] | (rom[o + 1] << 8);
  }

  function snesRgb(v) {
    return [(v & 31) * 255 / 31 | 0, ((v >> 5) & 31) * 255 / 31 | 0, ((v >> 10) & 31) * 255 / 31 | 0];
  }

  // Unpack the set at file offset o: { format, size, data, end } (end is the offset after the last stream byte).
  function unpack(rom, o) {
    const size = u16(rom, o);
    const format = u16(rom, o + 2);
    const out = [];
    if (format === 0 || format === 2 || format === 4) {
      let p = o + 3;                                   // the game's pointer sits one byte before each command
      for (;;) {
        if (p + 2 >= rom.length) throw new Error('NHL 95 SNES unpacker: ran past the end of the data');
        const cmd = rom[p + 1];
        if (cmd < 0x80) {
          const n = cmd + 1;
          for (let i = 0; i < n; i++) out.push(rom[p + 2 + i]);
          p += 1 + n;
          continue;
        }
        let n;
        let src;
        if (format === 0) {
          n = cmd & 0x7F;
          if (n === 0) return { format, size, data: Uint8Array.from(out), end: p + 2 };
          src = u16(rom, p + 2);
          p += 3;
        } else {
          const sh = format === 2 ? 2 : 3;
          n = (cmd & 0x7F) >> sh;
          if (n === 0) return { format, size, data: Uint8Array.from(out), end: p + 2 };
          src = out.length - (((cmd & ((1 << sh) - 1)) << 8) | rom[p + 2]);
          p += 2;
        }
        for (let k = 0; k <= n; k++) out.push(out[src + k]);
      }
    }
    if (format === 6 || format === 8) {
      const sh = format === 6 ? 3 : 4;
      let p = o + 3;
      for (;;) {
        p += 1;
        if (p + 2 >= rom.length) throw new Error('NHL 95 SNES unpacker: ran past the end of the data');
        const flags = rom[p];
        for (let bit = 0; bit < 8; bit++) {
          if ((flags >> bit) & 1) {
            const b = rom[p + 1];
            const n = b >> sh;
            const src = out.length - (((b & ((1 << sh) - 1)) << 8) | rom[p + 2]);
            p += 2;
            for (let k = 0; k < n + 3; k++) out.push(out[src + k]);
          } else {
            const n = rom[p + 1];
            if (n === 0) return { format, size, data: Uint8Array.from(out), end: p + 2 };
            for (let i = 0; i < n; i++) out.push(rom[p + 2 + i]);
            p += 1 + n;
          }
        }
      }
    }
    throw new Error('NHL 95 SNES unpacker: unknown format ' + format);
  }

  function unpackAt(romBytes, addr) {
    return unpack(toBytes(romBytes), offsetOf(addr));
  }

  function decodeBgr555(rom, o, count) {
    const colors = [];
    for (let i = 0; i < count; i++) colors.push(snesRgb(u16(rom, o + i * 2)));
    return colors;
  }

  // TeamPalettes (a packed set at $C00000): 28 rows of 16 colours in team order, two shade ramps in the team colours and a gold.
  function teamPalettes(romBytes) {
    const rom = toBytes(romBytes);
    if (rom.length < 0x10000) return null;
    const set = unpack(rom, offsetOf(TEAM_PALETTES));
    const rows = [];
    for (let t = 0; t < TEAMS.length; t++) rows.push({ team: TEAMS[t], colors: decodeBgr555(set.data, t * 32, 16) });
    return rows;
  }

  // The jerseys: AwayUniformPalettes and HomeUniformPalettes interleave, 64 bytes a team.
  function uniformPalettes(romBytes) {
    const rom = toBytes(romBytes);
    const at = offsetOf(AWAY_UNIFORM);
    if (at + TEAMS.length * 64 > rom.length) return null;
    const out = [];
    for (let side = 0; side < 2; side++) {
      const tag = side === 0 ? 'v' : 'h';
      for (let t = 0; t < TEAMS.length; t++) {
        out.push({ name: TEAMS[t] + tag + '.snespal', colors: decodeBgr555(rom, at + t * 64 + (side === 0 ? 0 : 32), 16) });
      }
    }
    return out;
  }

  function tilePixel(tiles, t, x, y) {
    const b = t * 32;
    if (b < 0 || b + 32 > tiles.length) return 0;
    const bit = 7 - (x & 7);
    const p0 = tiles[b + 2 * y];
    const p1 = tiles[b + 2 * y + 1];
    const p2 = tiles[b + 16 + 2 * y];
    const p3 = tiles[b + 16 + 2 * y + 1];
    return ((p0 >> bit) & 1) | (((p1 >> bit) & 1) << 1) | (((p2 >> bit) & 1) << 2) | (((p3 >> bit) & 1) << 3);
  }

  function s16(v) {
    return v & 0x8000 ? v - 0x10000 : v;
  }

  // The frame's tiles laid out as the game queues them into VRAM (row 1 at tile 0, row 2 at tile 16, the 8 x 8 tiles
  // at tile 32) and its pieces. Null when the frame is empty or drawn by code.
  function readFrame(rom, frame) {
    if (frame < 0 || frame >= FRAMES) return null;
    const bl = u16(rom, offsetOf(FRAME_BANK_LAYOUT) + frame * 2);
    const bank = bl & 0xFF;
    const layout = bl >> 8;
    if (!bank || !layout || (layout > 142 && layout !== 145)) return null;
    const src = offsetOf((bank << 16) | u16(rom, offsetOf(FRAME_TILE_SOURCE) + frame * 2));
    const size = u16(rom, offsetOf(LAYOUT_SIZES) + layout * 2);
    const row = (size & 0xFF) * 2;
    const small = size >> 8;
    const vram = new Uint8Array(0x2000);
    for (let i = 0; i < row; i++) {
      vram[i] = rom[src + i];
      vram[512 + i] = rom[src + row + i];
    }
    for (let i = 0; i < small; i++) vram[1024 + i] = rom[src + 2 * row + i];
    const dx = s16(u16(rom, offsetOf(FRAME_OFFSET_X) + frame * 2));
    const dy = s16(u16(rom, offsetOf(FRAME_OFFSET_Y) + frame * 2));
    const pieces = [];
    if (layout === 145) {                              // PuckFrameLayout: one 8 x 8 piece, raised by the puck's height
      pieces.push({ x: dx, y: dy, tile: 32, pal: 2, size: 8, hFlip: 0, vFlip: 0 });
      return { vram, pieces, dx, dy, layout };
    }
    const rec = offsetOf(0xCF0000 | u16(rom, offsetOf(LAYOUT_POINTERS) + (layout - 1) * 2));
    let p = rec;
    const bigCode = rom[p++];
    if (bigCode > 6) return { vram, pieces, dx, dy, layout };
    const bigs = bigCode / 2 + 1;
    for (let k = 0; k < bigs; k++, p += 2) {
      pieces.push({ x: dx + rom[p], y: dy + rom[p + 1], tile: 2 * k, pal: 2, size: 16, hFlip: 0, vFlip: 0 });
    }
    const smallCode = rom[p++];
    if (smallCode <= 6) {
      const smalls = smallCode / 2 + 1;
      for (let k = 0; k < smalls; k++, p += 2) {
        pieces.push({ x: dx + rom[p], y: dy + rom[p + 1], tile: 32 + k, pal: 2, size: 8, hFlip: 0, vFlip: 0 });
      }
    }
    return { vram, pieces, dx, dy, layout };
  }

  function blit(pieces, tiles) {
    let minX = 0;
    let minY = 0;
    let maxX = 1;
    let maxY = 1;
    for (const piece of pieces) {
      minX = Math.min(minX, piece.x);
      minY = Math.min(minY, piece.y);
      maxX = Math.max(maxX, piece.x + piece.size);
      maxY = Math.max(maxY, piece.y + piece.size);
    }
    const width = maxX - minX;
    const height = maxY - minY;
    const pixels = new Uint8Array(width * height);
    for (let n = pieces.length - 1; n >= 0; n--) {
      const piece = pieces[n];
      for (let y = 0; y < piece.size; y++) {
        for (let x = 0; x < piece.size; x++) {
          const color = tilePixel(tiles, piece.tile + (y >> 3) * 16 + (x >> 3), x & 7, y & 7);
          if (!color) continue;
          pixels[(piece.y - minY + y) * width + piece.x - minX + x] = color + piece.pal * 16;
        }
      }
    }
    return { width, height, minX, minY, pixels };
  }

  function grey(n) {
    const colors = [];
    for (let i = 0; i < n; i++) {
      const c = (i % 16) * 17;
      colors.push([c, c, c]);
    }
    return colors;
  }

  // The same shape lib/snes.js parse94 returns: renderFrame(frame) gives the picture and sprite rows of a frame number
  // (the game's own: SPFskate + n), or null when the game draws nothing for it.
  function parse95(romBytes) {
    const rom = toBytes(romBytes);
    const cache = new Map();
    function renderFrame(frame) {
      if (cache.has(frame)) return cache.get(frame);
      const f = readFrame(rom, frame);
      let record = null;
      if (f && f.pieces.length) {
        const art = blit(f.pieces, f.vram);
        record = {
          frame,
          index: frame,
          width: art.width,
          height: art.height,
          canvasWidth: art.width,
          canvasHeight: art.height,
          minX: art.minX,
          minY: art.minY,
          hotspotX: 0,
          hotspotY: 0,
          hotspotPxX: -art.minX,
          hotspotPxY: -art.minY,
          numSprites: f.pieces.length,
          sprites: f.pieces.map((piece) => ({
            xpos: piece.x,
            ypos: piece.y,
            dimensions: { width: piece.size / 8, height: piece.size / 8 },
            tileIndex: piece.tile,
            hFlip: 0,
            vFlip: 0,
            paletteIndex: piece.pal
          })),
          pixels: art.pixels
        };
      }
      cache.set(frame, record);
      return record;
    }
    return { numFrames: FRAMES - 1, combined: grey(128), renderFrame };
  }

  // LZSS (DecompressLZSS): the set at file offset o is a word with the unpacked size, then the stream. { data, end }.
  function lzss(rom, o) {
    const n = u16(rom, o);
    const out = new Uint8Array(n);
    const ring = new Uint8Array(4096);
    let p = o + 2;
    let k = 0;
    let r = 0xFEE;
    let flags = 0;
    while (k < n) {
      if (p >= rom.length) throw new Error('NHL 95 SNES LZSS: ran past the end of the data');
      flags >>= 1;
      if (!(flags & 0x100)) flags = rom[p++] | 0xFF00;
      if (flags & 1) {
        const b = rom[p++];
        out[k++] = b;
        ring[r] = b;
        r = (r + 1) & 0xFFF;
      } else {
        const b1 = rom[p++];
        const b2 = rom[p++];
        let src = b1 | ((b2 & 0xF0) << 4);
        for (let i = 0, len = (b2 & 0x0F) + 3; i < len && k < n; i++) {
          const b = ring[src];
          src = (src + 1) & 0xFFF;
          out[k++] = b;
          ring[r] = b;
          r = (r + 1) & 0xFFF;
        }
      }
    }
    return { data: out, end: p };
  }

  // A map set's three chunks, decoded: { width, height, map, tiles, bpp, colors, perPalette }.
  function readMapSet(romBytes, addr) {
    const rom = toBytes(romBytes);
    const m = offsetOf(addr);
    const width = rom[m + 2];
    const height = rom[m + 3];
    const map = lzss(rom, m + 5).data;
    const t = m + 2 + u16(rom, m);
    const bpp = rom[t + 5];
    const tiles = lzss(rom, t + 8).data;
    const c = t + 2 + u16(rom, t);
    const perPalette = u16(rom, c + 3);
    const total = u16(rom, c + 5);
    return { width, height, map, tiles, bpp, perPalette, colors: decodeBgr555(rom, c + 7, total) };
  }

  function renderMapSet(romBytes, addr) {
    const set = readMapSet(romBytes, addr);
    const w = set.width * 8;
    const h = set.height * 8;
    const pixels = new Uint8Array(w * h);
    const bytes = set.bpp === 2 ? 16 : 32;
    const tileCount = set.tiles.length / bytes;
    let minRow = 7;
    for (let i = 0; i < set.width * set.height; i++) minRow = Math.min(minRow, (set.map[i * 2 + 1] >> 2) & 7);
    const rows = Math.max(1, Math.floor(set.colors.length / set.perPalette));
    const colors = [];
    for (let i = 0; i < 128; i++) colors.push([255, 0, 255]);
    for (let r = 0; r < Math.min(rows, 8); r++) {
      for (let c = 0; c < set.perPalette && c < 16; c++) colors[r * 16 + c] = set.colors[r * set.perPalette + c];
    }
    for (let ty = 0; ty < set.height; ty++) {
      for (let tx = 0; tx < set.width; tx++) {
        const o = (ty * set.width + tx) * 2;
        const e = set.map[o] | (set.map[o + 1] << 8);
        const tile = e & 0x3FF;
        const row = Math.min(Math.max(((e >> 10) & 7) - minRow, 0), 7);
        if (tile >= tileCount) continue;
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const sx = e & 0x4000 ? 7 - x : x;
            const sy = e & 0x8000 ? 7 - y : y;
            const bit = 7 - sx;
            const b = tile * bytes;
            let color = ((set.tiles[b + 2 * sy] >> bit) & 1) | (((set.tiles[b + 2 * sy + 1] >> bit) & 1) << 1);
            if (set.bpp !== 2) color |= (((set.tiles[b + 16 + 2 * sy] >> bit) & 1) << 2) | (((set.tiles[b + 17 + 2 * sy] >> bit) & 1) << 3);
            pixels[(ty * 8 + y) * w + tx * 8 + x] = row * 16 + color;
          }
        }
      }
    }
    const frame = {
      frame: 1, index: 0, picture: true, opaque: true, rowTransparent: true, width: w, height: h, canvasWidth: w, canvasHeight: h,
      minX: 0, minY: 0, hotspotX: 0, hotspotY: 0, hotspotPxX: Math.floor(w / 2), hotspotPxY: Math.floor(h / 2),
      numSprites: 0, sprites: [], pixels, colors
    };
    return { numFrames: 1, picture: true, opaque: true, rowTransparent: true, combined: colors, renderFrame: () => frame };
  }

  // A picture frame in the shape renderMapSet returns (colour 0 of every row is transparent).
  function pictureFrame(w, h, pixels, colors, n) {
    return {
      frame: n, index: n - 1, picture: true, opaque: false, rowTransparent: true, width: w, height: h, canvasWidth: w, canvasHeight: h,
      minX: 0, minY: 0, hotspotX: 0, hotspotY: 0, hotspotPxX: Math.floor(w / 2), hotspotPxY: Math.floor(h / 2),
      numSprites: 0, sprites: [], pixels, colors
    };
  }

  function pictureSet(frames, colors) {
    return { numFrames: frames.length, picture: true, opaque: false, rowTransparent: true, combined: colors, renderFrame: (n) => frames[n - 1] || null };
  }

  // 128 colours: the given rows from the first, the rest magenta.
  function paletteRows(rows) {
    const colors = [];
    for (let i = 0; i < 128; i++) colors.push([255, 0, 255]);
    rows.forEach((row, r) => row.forEach((c, i) => { if (r < 8 && i < 16) colors[r * 16 + i] = c; }));
    return colors;
  }

  const SPRITE_RECORDS = 0xC087A0;
  const SPRITE_PIECES = 0xC19660;
  const SPRITE_PALETTES = 0xC10000;

  // Format 0 without the size / format header (UnpackStream0): { data, end }.
  function unpackBare(rom, o) {
    const out = [];
    let p = o;
    for (;;) {
      const cmd = rom[p++];
      if (cmd < 0x80) {
        for (let i = 0; i <= cmd; i++) out.push(rom[p++]);
        continue;
      }
      const n = cmd & 0x7F;
      if (!n) return { data: Uint8Array.from(out), end: p };
      const src = u16(rom, p);
      p += 2;
      for (let k = 0; k <= n; k++) out.push(out[src + k]);
    }
  }

  // The sprite objects (docs/sprite_objects.md in NHL95SNES): the record list at $C087A0 (team logos first, by team, then
  // Sprite28, PadNumbers, Skater, RedDot, EASports, ...). A record: frame list start / end words, palette number (+18), frames.
  // A frame: the 8 x 8 and 16 x 16 counts, an offset into the piece table ($C19660: x, y words, an x / y byte pair for each
  // 8 x 8 piece then each 16 x 16 piece), flags (bit 0 packed, bit 1 the large part packed) and the tile data's long address:
  // 8 x 8 tiles, then the 16 x 16 pieces' top halves, then their bottom halves.
  function spriteObjectFrames(romBytes, index) {
    const rom = toBytes(romBytes);
    const list = offsetOf(SPRITE_RECORDS);
    const rec = offsetOf(0xC00000 | u16(rom, list + index * 2));
    const palNo = u16(rom, rec + 18);
    const colors = decodeBgr555(rom, offsetOf(SPRITE_PALETTES) + palNo * 32, 16);
    const frames = [];
    for (let a = u16(rom, rec); a < u16(rom, rec + 2); a += 2) {
      const f = offsetOf(0xC00000 | u16(rom, offsetOf(0xC00000 | a)));
      const n8 = rom[f];
      const n16 = rom[f + 1];
      const flags = rom[f + 4];
      let at = offsetOf((rom[f + 7] << 16) | u16(rom, f + 5));
      const want = n8 * 32 + n16 * 128;
      let data;
      if (flags & 1 || (!n8 && flags & 2)) {
        const first = unpackBare(rom, at);
        data = first.data;
        if (data.length < want) {                       // the small part alone: the large part follows, raw or packed
          at = first.end;
          const rest = flags & 2 ? unpackBare(rom, at).data : rom.subarray(at, at + want - data.length);
          const joined = new Uint8Array(want);
          joined.set(data, 0);
          joined.set(rest.subarray(0, want - data.length), data.length);
          data = joined;
        }
      } else {
        data = rom.subarray(at, at + want);
      }
      const tiles = new Uint8Array(512 * 32);
      tiles.set(data.subarray(0, n8 * 32), 128 * 32);
      const tops = n8 * 32;
      const bottoms = tops + n16 * 64;
      const pieces = [];
      let p = offsetOf(SPRITE_PIECES) + u16(rom, f + 2);
      const ox = s16(u16(rom, p));
      const oy = s16(u16(rom, p + 2));
      p += 4;
      for (let k = 0; k < n8; k++, p += 2) pieces.push({ x: ox + rom[p], y: oy + rom[p + 1], tile: 128 + k, pal: 0, size: 8 });
      for (let k = 0; k < n16; k++, p += 2) {
        const t = (k >> 3) * 32 + (k & 7) * 2;
        tiles.set(data.subarray(tops + k * 64, tops + k * 64 + 64), t * 32);
        tiles.set(data.subarray(bottoms + k * 64, bottoms + k * 64 + 64), (t + 16) * 32);
        pieces.push({ x: ox + rom[p], y: oy + rom[p + 1], tile: t, pal: 0, size: 16 });
      }
      frames.push({ pieces, tiles });
    }
    return { frames, colors, palNo };
  }

  function renderSpriteObject(romBytes, index) {
    const set = spriteObjectFrames(romBytes, index);
    const colors = paletteRows([set.colors]);
    const out = set.frames.map((f, n) => {
      const art = f.pieces.length ? blit(f.pieces, f.tiles) : { width: 1, height: 1, pixels: new Uint8Array(1) };
      return pictureFrame(art.width, art.height, art.pixels, colors, n + 1);
    });
    return pictureSet(out, colors);
  }

  // A sheet of 4bpp tiles (the unpacked set at addr when packed, else the raw bytes), `columns` tiles across.
  function renderTileSheet(romBytes, image) {
    const rom = toBytes(romBytes);
    const tiles = image.packed ? unpackAt(rom, image.addr).data : rom.subarray(offsetOf(image.addr), offsetOf(image.addr) + image.bytes);
    const count = Math.floor(tiles.length / 32);
    const columns = image.columns || 16;
    const rows = Math.ceil(count / columns);
    const w = columns * 8;
    const h = rows * 8;
    const pixels = new Uint8Array(w * h);
    for (let t = 0; t < count; t++) {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) pixels[((Math.floor(t / columns)) * 8 + y) * w + (t % columns) * 8 + x] = tilePixel(tiles, t, x, y);
      }
    }
    const colors = paletteRows([image.palette ? decodeBgr555(rom, offsetOf(image.palette), 16) : grey(16)]);
    return pictureSet([pictureFrame(w, h, pixels, colors, 1)], colors);
  }

  // The centre ice logos (CenterIceTiles: 28 teams, 6 x 4 tiles each, unpacked) with CenterIcePalettes, one frame a team.
  function renderCenterIce(romBytes, image) {
    const rom = toBytes(romBytes);
    const tiles = unpackAt(rom, image.addr).data;
    const frames = [];
    const colors = paletteRows([grey(16)]);
    for (let team = 0; team < TEAMS.length; team++) {
      const gw = image.gridW || 6;
      const gh = image.gridH || 4;
      const pal = image.palette
        ? decodeBgr555(rom, offsetOf(image.palette) + team * 32, 16)
        : [[0, 0, 0], [255, 220, 0], [200, 160, 0], [120, 90, 0], [255, 255, 255], [160, 160, 160], [80, 80, 80], [255, 0, 0], [0, 0, 255], [0, 255, 0], [255, 128, 0], [0, 255, 255], [255, 0, 255], [128, 0, 255], [64, 64, 64], [32, 32, 32]];
      const w = gw * 8;
      const h = gh * 8;
      const pixels = new Uint8Array(w * h);
      for (let ty = 0; ty < gh; ty++) {
        for (let tx = 0; tx < gw; tx++) {
          const t = team * gw * gh + ty * gw + tx;
          for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) pixels[(ty * 8 + y) * w + tx * 8 + x] = tilePixel(tiles, t, x, y);
        }
      }
      frames.push(pictureFrame(w, h, pixels, paletteRows([pal]), team + 1));
    }
    return { numFrames: frames.length, picture: true, opaque: false, rowTransparent: true, combined: colors, renderFrame: (n) => frames[n - 1] || null };
  }

  // The player photos of one team: PhotoPalettes (6 x 16 colours) then the packed photos (6 of 48 x 48, linear 4bpp,
  // the left pixel in the high nibble).
  function renderPhotos(romBytes, image) {
    const rom = toBytes(romBytes);
    const data = unpackAt(rom, image.photos).data;
    const frames = [];
    for (let n = 0; n < 6; n++) {
      const pal = paletteRows([decodeBgr555(rom, offsetOf(image.palettes) + n * 32, 16)]);
      const pixels = new Uint8Array(48 * 48);
      for (let i = 0; i < 48 * 48; i++) {
        const b = data[n * 1152 + (i >> 1)];
        pixels[i] = i & 1 ? b & 15 : b >> 4;
      }
      frames.push(pictureFrame(48, 48, pixels, pal, n + 1));
    }
    return pictureSet(frames, frames[0].colors);
  }

  // A font of 2bpp glyphs (BoldFontGlyphs 16 x 8, ItalicFontGlyphs / ThinFontGlyphs 16 x 16), `columns` glyphs across.
  function renderGlyphs(romBytes, image) {
    const rom = toBytes(romBytes);
    const at = offsetOf(image.addr);
    const tw = image.gw / 8;
    const per = tw * (image.gh / 8);
    const count = Math.floor(image.bytes / (per * 16));
    const columns = image.columns || 16;
    const cw = image.gw + 2;
    const ch = image.gh + 2;
    const w = columns * cw;
    const h = Math.ceil(count / columns) * ch;
    const pixels = new Uint8Array(w * h);
    for (let g = 0; g < count; g++) {
      for (let y = 0; y < image.gh; y++) {
        for (let x = 0; x < image.gw; x++) {
          const t = g * per + (y >> 3) * tw + (x >> 3);
          const o = at + t * 16 + 2 * (y & 7);
          const bit = 7 - (x & 7);
          pixels[((Math.floor(g / columns)) * ch + y) * w + (g % columns) * cw + x] = ((rom[o] >> bit) & 1) | (((rom[o + 1] >> bit) & 1) << 1);
        }
      }
    }
    const colors = paletteRows([[[0, 0, 0], [255, 255, 255], [160, 160, 160], [90, 90, 90], ...grey(16).slice(4)]]);
    return pictureSet([pictureFrame(w, h, pixels, colors, 1)], colors);
  }

  // A run of the player frames as a picture list (the game's SPF numbers), in the game's own jersey palette.
  function renderFrames(romBytes, image) {
    const sprites = parse95(romBytes);
    const colors = paletteRows([grey(16), grey(16), image.palette ? decodeBgr555(toBytes(romBytes), offsetOf(image.palette), 16) : grey(16)]);
    const frames = [];
    for (let f = image.first; f <= image.last; f++) {
      const r = sprites.renderFrame(f);
      if (r) frames.push(Object.assign(pictureFrame(r.width, r.height, r.pixels, colors, frames.length + 1), { hotspotPxX: r.hotspotPxX, hotspotPxY: r.hotspotPxY }));
    }
    return pictureSet(frames, colors);
  }

  return { FRAMES, TEAMS, offsetOf, unpack, unpackAt, lzss, readMapSet, renderMapSet, renderSpriteObject, renderTileSheet, renderCenterIce, renderPhotos, renderGlyphs, renderFrames, teamPalettes, uniformPalettes, readFrame, parse95 };
});
