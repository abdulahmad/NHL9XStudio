/**
 * Draw an NHL .map.jim: big-endian header, row-major 4bpp tiles, four
 * Genesis palettes, map words. NHL 92 stores the tiles raw. NHLPA 93 and
 * NHL 94 set bit 15 of the tile count and pack the tiles with the game's
 * bytecode decompressor. Player portraits pack each row of eight pixels
 * into three bytes.
 *
 * parseJim / encodeJim keep every name-table bit (tile, H/V flip, palette,
 * priority). The VDP has no rotate field; transformBlock bakes 90/270 into
 * new tiles and uses both flip bits for 180.
 */
(function (root, factory) {
  const anim = typeof module === 'object' && module.exports ? require('./anim') : root.Nhl92Anim;
  let compressMod = null;
  if (typeof module === 'object' && module.exports) {
    try { compressMod = require('./jim-compress'); } catch (err) { compressMod = null; }
  } else {
    compressMod = root.Nhl92JimCompress || null;
  }
  const api = factory(anim, compressMod);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92Jim = api;
})(typeof self !== 'undefined' ? self : this, function (anim, compressMod) {
  const MAX_TILES_EDIT = 2048;
  const MAX_MAP = 1024;

  // Map pixels are color + palette * 16. Palette 0 is an opaque picture
  // (color 0 is a real entry, usually the fill). Palettes 1, 2, and 3 use
  // color 0 as the transparent hole, the same way a Genesis tile does when
  // it is not on the backdrop row.
  function picturePixelHidden(index, clearIndex) {
    if (clearIndex != null && index === clearIndex) return true;
    const row = index >> 4;
    return (index & 15) === 0 && row !== 0;
  }

  function pictureAnim(width, height, pixels, colors) {
    const frame = {
      frame: 1,
      index: 0,
      picture: true,
      opaque: false,
      rowTransparent: true,
      width,
      height,
      canvasWidth: width,
      canvasHeight: height,
      minX: 0,
      minY: 0,
      hotspotX: 0,
      hotspotY: 0,
      hotspotPxX: Math.floor(width / 2),
      hotspotPxY: Math.floor(height / 2),
      numSprites: 0,
      sprites: [],
      pixels
    };
    return {
      numFrames: 1,
      picture: true,
      opaque: false,
      rowTransparent: true,
      combined: colors,
      renderFrame: function () { return frame; }
    };
  }

  // DecompressBytecode in NHL94 video94.asm. A 256-byte ring is flushed to
  // the output every time the write index wraps, and opcode E with a zero
  // distance is the end code.
  function decompressBytecode(bytes, offset, expected) {
    const ring = new Uint8Array(256);
    const out = [];
    let pos = offset;
    let index = 0;

    function need(n) {
      if (pos + n > bytes.length) throw new Error('Compressed picture ran out of data');
    }

    function writeByte(value) {
      ring[index] = value & 255;
      index = (index + 1) & 255;
      if (index === 0) flush(256);
    }

    function flush(count) {
      for (let i = 0; i < count; i++) out.push(ring[i]);
    }

    function copyForward(count, distance) {
      let src = (index - distance) & 255;
      for (let i = 0; i < count; i++) {
        writeByte(ring[src]);
        src = (src + 1) & 255;
      }
    }

    function copyReverse(count, distance) {
      let src = (index - distance) & 255;
      for (let i = 0; i < count; i++) {
        writeByte(ring[src]);
        src = (src - 1) & 255;
      }
    }

    while (pos < bytes.length) {
      need(1);
      const command = bytes[pos++];
      const high = command >> 4;
      const low = command & 0x0f;
      if (high <= 1) {
        const count = (command & 0x1f) + 1;
        need(count);
        for (let i = 0; i < count; i++) writeByte(bytes[pos++]);
      } else if (high === 2) {
        for (let i = 0; i < low + 1; i++) writeByte(0);
      } else if (high === 3) {
        need(1);
        const fill = bytes[pos++];
        for (let i = 0; i < low + 3; i++) writeByte(fill);
      } else if (high >= 4 && high <= 7) {
        copyForward((command & 7) + 2, ((command >> 3) & 7) + 1);
      } else if (high === 8) {
        need(1);
        copyForward(low + 3, bytes[pos++]);
      } else if (high === 9 || high === 0xF) {
        need(1);
        const next = bytes[pos++];
        const mixed = ((command << 1) | (next >> 7)) & 0x1f;
        const count = mixed + 3;
        const distance = (next & 0x7f) + 1;
        if (high === 9) copyForward(count, distance);
        else copyReverse(count, distance);
      } else if (high === 0xA || high === 0xB) {
        need(1);
        const next = bytes[pos++];
        const packed = (command << 8) | next;
        const count = high === 0xA
          ? ((packed >> 6) & 0x3f) + 3
          : ((packed >> 5) & 0x7f) + 3;
        const distance = high === 0xA ? (next & 0x3f) + 1 : (next & 0x1f) + 1;
        copyForward(count, distance);
      } else if (high === 0xC || high === 0xD) {
        copyReverse((command & 3) + 2, ((command >> 2) & 7) + 1);
      } else {
        need(1);
        const distance = bytes[pos++];
        if (distance === 0) {
          if (index !== 0) flush(index);
          break;
        }
        copyReverse(low + 3, distance);
      }
      if (expected && out.length > expected + 256) break;
    }

    if (expected && out.length < expected) {
      throw new Error('Compressed picture produced ' + out.length + ' of ' + expected + ' bytes');
    }
    return Uint8Array.from(expected ? out.slice(0, expected) : out);
  }

  function compressBytecode(bytes) {
    if (compressMod && typeof compressMod.compressBytecode === 'function') {
      return compressMod.compressBytecode(bytes);
    }
    throw new Error('compressBytecode not implemented');
  }

  // UnpackPicture: each row of eight pixels is three bytes. Every pixel is
  // a 3-bit value plus 5, so the portrait colors sit in the middle of the palette.
  function unpackPortrait(bytes, offset, tiles) {
    const rows = tiles * 8;
    const need = rows * 3;
    if (offset + need > bytes.length) throw new Error('Portrait ran out of data');
    const tilesOut = new Uint8Array(tiles * 32);
    let src = offset;
    let dst = 0;
    for (let row = 0; row < rows; row++) {
      const bits = (bytes[src] << 16) | (bytes[src + 1] << 8) | (bytes[src + 2]);
      src += 3;
      for (let pair = 0; pair < 4; pair++) {
        const left = ((bits >> (21 - pair * 6)) & 7) + 5;
        const right = ((bits >> (18 - pair * 6)) & 7) + 5;
        tilesOut[dst++] = (left << 4) | right;
      }
    }
    return tilesOut;
  }

  function rawTiles(bytes, tiles) {
    const end = 10 + tiles * 32;
    if (end > bytes.length) throw new Error('JIM tile data runs past the file');
    return bytes.subarray(10, end);
  }

  function tileBytesFor(bytes, palOff, mapOff, tileWord, noPalette) {
    const packed = (tileWord & 0x8000) !== 0;
    const tiles = tileWord & 0x7fff;
    if (!tiles || tiles > 4096) throw new Error('JIM tile count is not usable');
    if (packed) return { tiles, tileBytes: decompressBytecode(bytes, 10, tiles * 32) };
    // A shared 6×6 card (both header longs are 0) and a card whose palette
    // sits right after the 3-byte rows are portraits. Arena graphics use the
    // same zero header with ordinary 32-byte tiles and no map.
    if (!noPalette && palOff === 10 + tiles * 24) {
      return { tiles, tileBytes: unpackPortrait(bytes, 10, tiles) };
    }
    if (!noPalette && palOff === 0 && mapOff === 0 && (tiles === 36 || tiles === 0x24)) {
      return { tiles, tileBytes: unpackPortrait(bytes, 10, tiles) };
    }
    if (noPalette || palOff === 0 || palOff === 10 + tiles * 32 || palOff === mapOff) {
      return { tiles, tileBytes: rawTiles(bytes, tiles) };
    }
    throw new Error('This picture is not a JIM');
  }

  function fallbackColors() {
    const colors = [];
    for (let i = 0; i < 64; i++) {
      const ramp = i === 0 ? 0 : 32 + ((i * 37) % 224);
      colors.push([ramp, (i * 53) % 256, (i * 17) % 256]);
    }
    return colors;
  }

  function asBytes(buffer) {
    return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  }

  function unpackMapWord(word) {
    word = word & 0xffff;
    return {
      tile: word & 0x7ff,
      hFlip: (word >>> 11) & 1,
      vFlip: (word >>> 12) & 1,
      pal: (word >>> 13) & 3,
      priority: (word >>> 15) & 1
    };
  }

  function packMapWord(cell) {
    const tile = (cell && cell.tile ? cell.tile : 0) & 0x7ff;
    if (cell && cell.tile > 2047) throw new Error('Tile index ' + cell.tile + ' does not fit in 11 bits');
    return tile
      | (((cell && cell.hFlip) ? 1 : 0) << 11)
      | (((cell && cell.vFlip) ? 1 : 0) << 12)
      | ((((cell && cell.pal) ? cell.pal : 0) & 3) << 13)
      | (((cell && cell.priority) ? 1 : 0) << 15);
  }

  function unpackTile(bytes, offset) {
    offset = offset || 0;
    const nibbles = new Uint8Array(64);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const byte = bytes[offset + y * 4 + (x >> 1)];
        nibbles[y * 8 + x] = (x & 1) ? byte & 0x0f : byte >>> 4;
      }
    }
    return nibbles;
  }

  function packTile(nibbles) {
    const out = new Uint8Array(32);
    for (let y = 0; y < 8; y++) {
      for (let pair = 0; pair < 4; pair++) {
        const left = nibbles[y * 8 + pair * 2] & 15;
        const right = nibbles[y * 8 + pair * 2 + 1] & 15;
        out[y * 4 + pair] = (left << 4) | right;
      }
    }
    return out;
  }

  function packTiles(tiles) {
    const out = new Uint8Array(tiles.length * 32);
    for (let i = 0; i < tiles.length; i++) out.set(packTile(tiles[i]), i * 32);
    return out;
  }

  function encodeChannel(value) {
    value = Math.max(0, Math.min(255, Number(value) || 0));
    let best = 0;
    let bestErr = Infinity;
    for (let c = 0; c < 8; c++) {
      const err = Math.abs(value - anim.expandChannel(c));
      if (err < bestErr) {
        best = c;
        bestErr = err;
      }
    }
    return best;
  }

  function cramFromWord(word) {
    return {
      r3: (word >> 1) & 7,
      g3: (word >> 5) & 7,
      b3: (word >> 9) & 7,
      locked: false
    };
  }

  function cramToWord(c) {
    return ((c.b3 & 7) << 9) | ((c.g3 & 7) << 5) | ((c.r3 & 7) << 1);
  }

  function encodeCramWord(color) {
    return cramToWord(color);
  }

  function decodeCramWord(word) {
    const color = cramFromWord(word);
    return { r3: color.r3, g3: color.g3, b3: color.b3 };
  }

  function encodePaletteLine(line) {
    const out = new Uint8Array(32);
    const view = new DataView(out.buffer);
    for (let i = 0; i < 16; i++) view.setUint16(i * 2, cramToWord(line[i]));
    return out;
  }

  function emptyLine() {
    return Array.from({ length: 16 }, () => ({ r3: 0, g3: 0, b3: 0, locked: false }));
  }

  function palettesFromCram(bytes, offset) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const palettes = [];
    for (let p = 0; p < 4; p++) {
      const line = [];
      for (let i = 0; i < 16; i++) line.push(cramFromWord(view.getUint16(offset + p * 32 + i * 2)));
      palettes.push(line);
    }
    return palettes;
  }

  function palettesFromRgb(colors) {
    const palettes = [];
    for (let p = 0; p < 4; p++) {
      const line = [];
      for (let i = 0; i < 16; i++) {
        const rgb = colors[p * 16 + i] || [0, 0, 0];
        line.push({
          r3: encodeChannel(rgb[0]),
          g3: encodeChannel(rgb[1]),
          b3: encodeChannel(rgb[2]),
          locked: false
        });
      }
      palettes.push(line);
    }
    return palettes;
  }

  function cloneCell(c) {
    if (!c) return { tile: 0, hFlip: 0, vFlip: 0, pal: 0, priority: 0 };
    return {
      tile: c.tile | 0,
      hFlip: c.hFlip ? 1 : 0,
      vFlip: c.vFlip ? 1 : 0,
      pal: c.pal | 0,
      priority: c.priority ? 1 : 0
    };
  }

  function cloneJim(doc) {
    return {
      name: doc.name,
      variant: doc.variant,
      packedOnDisk: doc.packedOnDisk,
      tiles: doc.tiles.map((t) => Uint8Array.from(t)),
      mapW: doc.mapW,
      mapH: doc.mapH,
      cells: doc.cells.map(cloneCell),
      palettes: doc.palettes.map((line) => line.map((c) => ({
        r3: c.r3, g3: c.g3, b3: c.b3, locked: !!c.locked
      }))),
      donor: doc.donor ? Uint8Array.from(doc.donor) : null,
      remap: doc.remap ? doc.remap.slice() : null,
      dirty: !!doc.dirty,
      readOnly: !!doc.readOnly,
      usedPals: new Set(doc.usedPals || []),
      wantPacked: !!doc.wantPacked,
      embedPalettes: doc.embedPalettes !== false,
      originalBytes: doc.originalBytes ? Uint8Array.from(doc.originalBytes) : null,
      colors: doc.colors ? doc.colors.map((c) => c.slice()) : null
    };
  }

  function emptyJim(opts) {
    opts = opts || {};
    const mapW = opts.mapW || 8;
    const mapH = opts.mapH || 8;
    const cells = [];
    for (let i = 0; i < mapW * mapH; i++) {
      cells.push({ tile: 0, hFlip: 0, vFlip: 0, pal: 0, priority: 0 });
    }
    return {
      name: opts.name || 'untitled.map.jim',
      variant: 'map',
      packedOnDisk: false,
      tiles: [new Uint8Array(64)],
      mapW,
      mapH,
      cells,
      palettes: [emptyLine(), emptyLine(), emptyLine(), emptyLine()],
      donor: null,
      remap: null,
      dirty: false,
      readOnly: false,
      usedPals: new Set([0]),
      wantPacked: false,
      embedPalettes: true,
      originalBytes: null,
      colors: null
    };
  }

  function resolveColors(bytes, view, palOff, mapOff, noPalette, shared, tiles, donorPalette, opts) {
    const colors = [];
    const donor = donorPalette ? asBytes(donorPalette) : null;
    const face = shared && (tiles === 36 || tiles === 0x24);
    const portrait = face || (!noPalette && palOff === 10 + tiles * 24);
    let faceBytes = null;
    if (portrait && shared && donor && donor.length >= 64) faceBytes = donor.subarray(32, 64);
    else if (portrait && !shared && palOff + 64 <= bytes.length) faceBytes = bytes.subarray(palOff + 32, palOff + 64);
    const logo = !portrait && !noPalette && palOff !== 0 && palOff === mapOff;
    if (opts.forceDonor && donor && donor.length >= 128) {
      for (let p = 0; p < 4; p++) colors.push.apply(colors, anim.decodePaletteFile(donor.subarray(p * 32, (p + 1) * 32)));
    } else if (faceBytes || (logo && donor && donor.length >= 32)) {
      const row = faceBytes || donor.subarray(0, 32);
      const facePal = anim.decodePaletteFile(row);
      for (let p = 0; p < 4; p++) {
        for (const color of facePal) colors.push(color.slice());
      }
    } else if (donor && donor.length >= 128) {
      for (let p = 0; p < 4; p++) colors.push.apply(colors, anim.decodePaletteFile(donor.subarray(p * 32, (p + 1) * 32)));
    } else if (!shared && !noPalette && palOff !== mapOff && palOff + 128 <= bytes.length) {
      for (let p = 0; p < 4; p++) colors.push.apply(colors, anim.decodePaletteFile(bytes.subarray(palOff + p * 32, palOff + (p + 1) * 32)));
    } else {
      colors.push.apply(colors, fallbackColors());
    }
    return { colors, donor, portrait, logo };
  }

  function parseJim(buffer, donorPalette, options) {
    const bytes = asBytes(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 12) throw new Error('JIM is too small');
    const opts = options || {};
    const noPalette = view.getUint32(0) === 0xffffffff;
    const palOff = noPalette ? 0 : view.getUint32(0);
    const mapOff = view.getUint32(4);
    const tileWord = view.getUint16(8);
    const packedOnDisk = (tileWord & 0x8000) !== 0;
    const shared = !noPalette && palOff === 0 && mapOff === 0;
    const decoded = tileBytesFor(bytes, palOff, mapOff, tileWord, noPalette);
    const tiles = decoded.tiles;
    const tileBytes = decoded.tileBytes;
    const face = shared && (tiles === 36 || tiles === 0x24);
    const resolved = resolveColors(bytes, view, palOff, mapOff, noPalette, shared, tiles, donorPalette, opts);
    let mapW;
    let mapH;
    if (face) {
      mapW = 6;
      mapH = Math.ceil(tiles / mapW);
    } else if (shared) {
      mapW = Math.min(8, tiles);
      mapH = Math.ceil(tiles / mapW);
    } else {
      if (mapOff + 4 > bytes.length) throw new Error('JIM offsets run past the file');
      mapW = view.getUint16(mapOff);
      mapH = view.getUint16(mapOff + 2);
    }
    if (!mapW || !mapH || mapW > MAX_MAP || mapH > MAX_MAP) throw new Error('JIM map is ' + mapW + ' by ' + mapH);
    if (!shared && mapOff + 4 + mapW * mapH * 2 > bytes.length) throw new Error('JIM map runs past the file');
    const cells = [];
    for (let ty = 0; ty < mapH; ty++) {
      for (let tx = 0; tx < mapW; tx++) {
        const entry = shared ? (ty * mapW + tx) : view.getUint16(mapOff + 4 + (ty * mapW + tx) * 2);
        cells.push(unpackMapWord(shared ? (ty * mapW + tx) : entry));
      }
    }
    const tileList = [];
    for (let i = 0; i < tiles; i++) tileList.push(unpackTile(tileBytes, i * 32));
    let palettes;
    let embedPalettes = false;
    if (!shared && !noPalette && palOff !== mapOff && palOff + 128 <= bytes.length) {
      palettes = palettesFromCram(bytes, palOff);
      embedPalettes = true;
    } else {
      palettes = palettesFromRgb(resolved.colors);
    }
    let variant = 'map';
    if (resolved.portrait) variant = 'portrait';
    else if (resolved.logo) variant = 'logo';
    else if (noPalette) variant = 'nopal';
    else if (shared) variant = 'sheet';
    const usedPals = new Set();
    for (let i = 0; i < cells.length; i++) usedPals.add(cells[i].pal);
    return {
      name: opts.name || '',
      variant,
      packedOnDisk,
      wantPacked: packedOnDisk,
      tiles: tileList,
      mapW,
      mapH,
      cells,
      palettes,
      usedPals,
      donor: resolved.donor,
      remap: opts.remap ? opts.remap.slice() : null,
      dirty: false,
      readOnly: variant === 'portrait',
      embedPalettes,
      originalBytes: variant === 'portrait' ? Uint8Array.from(bytes) : null,
      colors: resolved.colors.map((c) => c.slice())
    };
  }

  function rasterize(doc, options) {
    const opts = options || {};
    const mapW = doc.mapW;
    const mapH = doc.mapH;
    const width = mapW * 8;
    const height = mapH * 8;
    const pixels = new Uint8Array(width * height);
    const tiles = doc.tiles;
    const remap = opts.remap || doc.remap;
    const printa = opts.printa != null ? (opts.printa & 0xf800) : 0;
    for (let ty = 0; ty < mapH; ty++) {
      for (let tx = 0; tx < mapW; tx++) {
        let cell = doc.cells[ty * mapW + tx] || { tile: 0, hFlip: 0, vFlip: 0, pal: 0, priority: 0 };
        if (printa) cell = unpackMapWord(packMapWord(cell) ^ printa);
        const tile = cell.tile;
        if (tile >= tiles.length) continue;
        const nibbles = tiles[tile];
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const sx = cell.hFlip ? 7 - x : x;
            const sy = cell.vFlip ? 7 - y : y;
            pixels[(ty * 8 + y) * width + tx * 8 + x] = (nibbles[sy * 8 + sx] & 15) + (cell.pal & 3) * 16;
          }
        }
      }
    }
    if (remap) {
      for (let i = 0; i < pixels.length; i++) {
        const row = pixels[i] & ~15;
        const color = pixels[i] & 15;
        if (color < remap.length) pixels[i] = row + remap[color];
      }
    }
    // Picture colors follow the loader (donor, portrait line, forceDonor, fallback).
    // Palette lines are what encode writes; they are not always what the screen shows.
    let colors = doc.colors;
    if (!colors && doc.palettes && doc.palettes.length) {
      colors = [];
      for (let p = 0; p < 4; p++) {
        for (let i = 0; i < 16; i++) {
          const c = doc.palettes[p][i];
          colors.push([anim.expandChannel(c.r3), anim.expandChannel(c.g3), anim.expandChannel(c.b3)]);
        }
      }
    }
    return { width, height, pixels, colors };
  }

  function decodeJim(buffer, donorPalette, options) {
    const doc = parseJim(buffer, donorPalette, options);
    const drawn = rasterize(doc, options);
    return pictureAnim(drawn.width, drawn.height, drawn.pixels, drawn.colors);
  }

  function encodeJim(doc, options) {
    options = options || {};
    if (doc.variant === 'portrait' || doc.readOnly) {
      if (doc.originalBytes) return Uint8Array.from(doc.originalBytes);
      throw new Error('Portrait JIM is read-only');
    }
    const packed = !!options.packed;
    const tiles = doc.tiles || [];
    if (!tiles.length) throw new Error('A JIM needs at least one tile');
    if (tiles.length === MAX_TILES_EDIT) console.warn('JIM tile count is 2048, the Genesis name-table limit');
    if (tiles.length > MAX_TILES_EDIT) {
      throw new Error('This map has ' + tiles.length + ' tiles; the VDP index is 11 bits (2048)');
    }
    const variant = doc.variant || 'map';
    const embed = options.embedPalettes != null ? options.embedPalettes : doc.embedPalettes !== false;
    const writeMap = variant !== 'sheet' && variant !== 'shared';
    if (writeMap) {
      for (let i = 0; i < doc.cells.length; i++) {
        const t = doc.cells[i] && doc.cells[i].tile;
        if (t > 2047) throw new Error('Tile index ' + t + ' does not fit in 11 bits');
        if (t >= tiles.length) throw new Error('Map cell uses tile ' + t + ' but the set has ' + tiles.length);
      }
    }
    const tileBytes = packTiles(tiles);
    const tileData = packed ? compressBytecode(tileBytes) : tileBytes;
    let palOff;
    let mapOff;
    let palBytes = null;
    // Sheet and the shared zero header have no palette and no map. Check them
    // before the "no embedded palette" branch, which reuses the logo layout.
    if (variant === 'sheet' || variant === 'shared') {
      palOff = 0;
      mapOff = 0;
    } else if (variant === 'nopal' || (options.embedPalettes === false && variant !== 'logo')) {
      palOff = 0xffffffff;
      mapOff = 10 + tileData.length;
    } else if (variant === 'logo' || (variant !== 'map' && !embed && variant !== 'nopal')) {
      palOff = 10 + tileData.length;
      mapOff = palOff;
    } else {
      palOff = 10 + tileData.length;
      mapOff = palOff + 128;
      palBytes = new Uint8Array(128);
      const palView = new DataView(palBytes.buffer);
      for (let p = 0; p < 4; p++) {
        for (let i = 0; i < 16; i++) palView.setUint16(p * 32 + i * 2, cramToWord(doc.palettes[p][i]));
      }
    }
    const mapBytes = writeMap ? new Uint8Array(4 + doc.mapW * doc.mapH * 2) : null;
    if (mapBytes) {
      const mapView = new DataView(mapBytes.buffer);
      mapView.setUint16(0, doc.mapW);
      mapView.setUint16(2, doc.mapH);
      for (let i = 0; i < doc.cells.length; i++) mapView.setUint16(4 + i * 2, packMapWord(doc.cells[i]));
    }
    const out = new Uint8Array(10 + tileData.length + (palBytes ? palBytes.length : 0) + (mapBytes ? mapBytes.length : 0));
    const view = new DataView(out.buffer);
    view.setUint32(0, palOff >>> 0);
    view.setUint32(4, mapOff >>> 0);
    view.setUint16(8, tiles.length | (packed ? 0x8000 : 0));
    out.set(tileData, 10);
    let at = 10 + tileData.length;
    if (palBytes) {
      out.set(palBytes, at);
      at += palBytes.length;
    }
    if (mapBytes) out.set(mapBytes, at);
    return out;
  }

  function tileKey(t) {
    return Array.from(t).join(',');
  }

  function flippedTile(t, h, v) {
    const o = new Uint8Array(64);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) o[y * 8 + x] = t[(v ? 7 - y : y) * 8 + (h ? 7 - x : x)];
    }
    return o;
  }

  function matchTile(tiles, nibbles) {
    const want = tileKey(nibbles);
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (tileKey(t) === want) return { tile: i, hFlip: 0, vFlip: 0 };
      if (tileKey(flippedTile(t, true, false)) === want) return { tile: i, hFlip: 1, vFlip: 0 };
      if (tileKey(flippedTile(t, false, true)) === want) return { tile: i, hFlip: 0, vFlip: 1 };
      if (tileKey(flippedTile(t, true, true)) === want) return { tile: i, hFlip: 1, vFlip: 1 };
    }
    return null;
  }

  function applyDonorPalette(doc, donor) {
    donor = asBytes(donor);
    if (donor.length < 32) throw new Error('Donor CRAM needs 32 or 128 bytes');
    if (donor.length >= 128) {
      doc.palettes = palettesFromCram(donor, 0);
    } else {
      const view = new DataView(donor.buffer, donor.byteOffset, donor.byteLength);
      const line = [];
      for (let i = 0; i < 16; i++) line.push(cramFromWord(view.getUint16(i * 2)));
      doc.palettes = [0, 1, 2, 3].map(() => line.map((c) => ({
        r3: c.r3, g3: c.g3, b3: c.b3, locked: false
      })));
    }
    doc.donor = donor;
    doc.colors = [];
    for (let p = 0; p < 4; p++) {
      for (let i = 0; i < 16; i++) {
        const c = doc.palettes[p][i];
        doc.colors.push([anim.expandChannel(c.r3), anim.expandChannel(c.g3), anim.expandChannel(c.b3)]);
      }
    }
    return doc;
  }

  function rot90tile(t, cw) {
    const o = new Uint8Array(64);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) o[cw ? x * 8 + (7 - y) : (7 - x) * 8 + y] = t[y * 8 + x];
    }
    return o;
  }

  function grabBlock(doc, r) {
    const cells = [];
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const cx = r.x + x;
        const cy = r.y + y;
        if (cx < 0 || cy < 0 || cx >= doc.mapW || cy >= doc.mapH) cells.push(null);
        else cells.push(cloneCell(doc.cells[cy * doc.mapW + cx]));
      }
    }
    return { w: r.w, h: r.h, cells };
  }

  function clearRect(doc, r) {
    const blank = { tile: 0, hFlip: 0, vFlip: 0, pal: 0, priority: 0 };
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const cx = r.x + x;
        const cy = r.y + y;
        if (cx >= 0 && cy >= 0 && cx < doc.mapW && cy < doc.mapH) doc.cells[cy * doc.mapW + cx] = cloneCell(blank);
      }
    }
  }

  function stampBlock(doc, b, x, y) {
    for (let j = 0; j < b.h; j++) {
      for (let i = 0; i < b.w; i++) {
        const c = b.cells[j * b.w + i];
        const X = x + i;
        const Y = y + j;
        if (!c || X < 0 || Y < 0 || X >= doc.mapW || Y >= doc.mapH) continue;
        doc.cells[Y * doc.mapW + X] = cloneCell(c);
      }
    }
  }

  function transformBlock(doc, b, op) {
    if (b && !b.cells) b = grabBlock(doc, { x: b.x || 0, y: b.y || 0, w: b.w, h: b.h });
    if (op === 'h' || op === 'v' || op === '180') {
      const fh = op !== 'v';
      const fv = op !== 'h';
      const o = { w: b.w, h: b.h, cells: new Array(b.w * b.h).fill(null) };
      for (let y = 0; y < b.h; y++) {
        for (let x = 0; x < b.w; x++) {
          const e = b.cells[y * b.w + x];
          if (!e) continue;
          const c = cloneCell(e);
          if (fh) c.hFlip ^= 1;
          if (fv) c.vFlip ^= 1;
          o.cells[(fv ? b.h - 1 - y : y) * b.w + (fh ? b.w - 1 - x : x)] = c;
        }
      }
      return o;
    }
    const cw = op === '90';
    if (!cw && op !== '270') throw new Error('Unknown transform ' + op);
    const o = { w: b.h, h: b.w, cells: new Array(b.h * b.w).fill(null) };
    const index = new Map(doc.tiles.map((t, i) => [tileKey(t), i]));
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const e = b.cells[y * b.w + x];
        if (!e) continue;
        const t = rot90tile(flippedTile(doc.tiles[e.tile], e.hFlip, e.vFlip), cw);
        const k = tileKey(t);
        let i = index.get(k);
        if (i === undefined) {
          if (doc.tiles.length >= MAX_TILES_EDIT) throw new Error('Rotating would pass 2048 tiles');
          i = doc.tiles.length;
          doc.tiles.push(t);
          doc.dirty = true;
          index.set(k, i);
        }
        const nx = cw ? b.h - 1 - y : y;
        const ny = cw ? x : b.w - 1 - x;
        o.cells[ny * o.w + nx] = {
          tile: i, hFlip: 0, vFlip: 0, pal: e.pal, priority: e.priority
        };
      }
    }
    return o;
  }

  return {
    decodeJim,
    parseJim,
    encodeJim,
    rasterize,
    pictureAnim,
    picturePixelHidden,
    decompressBytecode,
    compressBytecode,
    unpackPortrait,
    unpackMapWord,
    packMapWord,
    unpackTile,
    packTile,
    cloneJim,
    emptyJim,
    grabBlock,
    stampBlock,
    clearRect,
    transformBlock,
    flippedTile,
    matchTile,
    applyDonorPalette,
    MAX_TILES_EDIT,
    encodeChannel,
    encodeCramWord,
    decodeCramWord,
    encodePaletteLine
  };
});
