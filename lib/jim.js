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

  // Map pixels are color + palette * 16. Palette 0 color 0 is a real ink
  // (usually the fill / VDP backdrop). Palettes 1+ still store color 0 in
  // CRAM — on Title1 that slot is the same ice as pal 0 color 0 — but the
  // VDP treats it as a hole onto the backdrop. picturePixelHidden flags
  // those holes so Transparency can punch them; screens default opaque so
  // the studio stage is not seen through ice.
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
      opaque: true,
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
      opaque: true,
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

  // Inverse of UnpackPicture. Each nibble is a 3-bit value plus 5 (indexes
  // 5–12). Values outside that range clamp so the 3-byte row still round-trips
  // through the game's unpacker.
  function packPortrait(tiles) {
    const list = tiles || [];
    const rows = list.length * 8;
    const out = new Uint8Array(rows * 3);
    let dst = 0;
    for (let t = 0; t < list.length; t++) {
      const nibbles = list[t];
      for (let y = 0; y < 8; y++) {
        let bits = 0;
        for (let x = 0; x < 8; x++) {
          let n = nibbles[y * 8 + x] & 15;
          if (n < 5) n = 5;
          if (n > 12) n = 12;
          bits |= ((n - 5) & 7) << (21 - x * 3);
        }
        out[dst] = (bits >>> 16) & 255;
        out[dst + 1] = (bits >>> 8) & 255;
        out[dst + 2] = bits & 255;
        dst += 3;
      }
    }
    return out;
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
      palettes: doc.palettes.map((line) => line.map((c) => {
        const color = { r3: c.r3, g3: c.g3, b3: c.b3, locked: !!c.locked };
        if (c.r5 != null) { color.r5 = c.r5 & 31; color.g5 = c.g5 & 31; color.b5 = c.b5 & 31; }
        return color;
      })),
      donor: doc.donor ? Uint8Array.from(doc.donor) : null,
      remap: doc.remap ? doc.remap.slice() : null,
      dirty: !!doc.dirty,
      readOnly: !!doc.readOnly,
      palOff: doc.palOff,
      mapOff: doc.mapOff,
      platform: doc.platform || 'genesis',
      sjim: doc.sjim ? Object.assign({}, doc.sjim) : null,
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
      readOnly: false,
      palOff: noPalette ? 0xffffffff : palOff,
      mapOff,
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
    const palMask = doc.platform === 'snes' ? 7 : 3;
    for (let ty = 0; ty < mapH; ty++) {
      for (let tx = 0; tx < mapW; tx++) {
        let cell = doc.cells[ty * mapW + tx] || { tile: 0, hFlip: 0, vFlip: 0, pal: 0, priority: 0 };
        // printa XOR is a Genesis name-table trick. SNES map words use different bits.
        if (printa && doc.platform !== 'snes') cell = unpackMapWord(packMapWord(cell) ^ printa);
        const tile = cell.tile;
        if (tile >= tiles.length) continue;
        const nibbles = tiles[tile];
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const sx = cell.hFlip ? 7 - x : x;
            const sy = cell.vFlip ? 7 - y : y;
            pixels[(ty * 8 + y) * width + tx * 8 + x] = (nibbles[sy * 8 + sx] & 15) + (cell.pal & palMask) * 16;
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
      const lines = doc.palettes.length;
      for (let p = 0; p < lines; p++) {
        for (let i = 0; i < 16; i++) {
          const c = doc.palettes[p] && doc.palettes[p][i];
          if (c && c.r5 != null) {
            colors.push([
              ((c.r5 & 31) * 255 / 31) | 0,
              ((c.g5 & 31) * 255 / 31) | 0,
              ((c.b5 & 31) * 255 / 31) | 0
            ]);
          } else {
            colors.push([
              anim.expandChannel(c ? c.r3 : 0),
              anim.expandChannel(c ? c.g3 : 0),
              anim.expandChannel(c ? c.b3 : 0)
            ]);
          }
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

  function encodePortrait(doc) {
    if (!doc.dirty && doc.originalBytes && doc.originalBytes.length) {
      return Uint8Array.from(doc.originalBytes);
    }
    const tiles = doc.tiles || [];
    if (!tiles.length) throw new Error('A portrait needs at least one tile');
    const packedRows = packPortrait(tiles);
    const shared = (doc.palOff === 0 && doc.mapOff === 0)
      || ((doc.palOff == null || doc.palOff === 0) && (doc.mapOff == null || doc.mapOff === 0)
        && tiles.length === 36);
    let palBytes = null;
    let palOff = 0;
    const embed = doc.embedPalettes === true && !shared;
    if (embed) {
      palOff = 10 + packedRows.length;
      const palLen = doc.originalBytes && doc.originalBytes.length > palOff
        ? Math.min(128, doc.originalBytes.length - palOff)
        : 128;
      palBytes = new Uint8Array(palLen);
      const view = new DataView(palBytes.buffer);
      const lines = Math.min(4, palLen >> 5);
      for (let p = 0; p < lines; p++) {
        for (let i = 0; i < 16; i++) {
          const c = doc.palettes[p] && doc.palettes[p][i];
          if (c) view.setUint16(p * 32 + i * 2, cramToWord(c));
        }
      }
    }
    const out = new Uint8Array(10 + packedRows.length + (palBytes ? palBytes.length : 0));
    const view = new DataView(out.buffer);
    view.setUint32(0, palOff >>> 0);
    view.setUint32(4, 0);
    view.setUint16(8, tiles.length & 0x7fff);
    out.set(packedRows, 10);
    if (palBytes) out.set(palBytes, 10 + packedRows.length);
    return out;
  }

  function encodeJim(doc, options) {
    options = options || {};
    if (doc.variant === 'portrait') return encodePortrait(doc);
    if (doc.readOnly) {
      if (doc.originalBytes) return Uint8Array.from(doc.originalBytes);
      throw new Error('This picture is read-only');
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

  // Keep the first copy of each 8×8. Later tiles that match it under H-flip,
  // V-flip, or both are dropped and those cells XOR the matching flip bits.
  function collapseDuplicateTiles(tiles, cells) {
    const keep = [];
    const remap = [];
    for (let i = 0; i < tiles.length; i++) {
      const src = tiles[i] instanceof Uint8Array ? tiles[i] : Uint8Array.from(tiles[i] || []);
      const hit = matchTile(keep, src);
      if (hit) remap[i] = hit;
      else {
        remap[i] = { tile: keep.length, hFlip: 0, vFlip: 0 };
        keep.push(Uint8Array.from(src));
      }
    }
    if (!keep.length) keep.push(new Uint8Array(64));
    const nextCells = (cells || []).map((c) => {
      if (!c) return c;
      const m = remap[c.tile];
      if (!m) {
        return { tile: 0, hFlip: 0, vFlip: 0, pal: c.pal || 0, priority: c.priority || 0 };
      }
      return {
        tile: m.tile,
        hFlip: (c.hFlip ? 1 : 0) ^ (m.hFlip ? 1 : 0),
        vFlip: (c.vFlip ? 1 : 0) ^ (m.vFlip ? 1 : 0),
        pal: c.pal || 0,
        priority: c.priority || 0
      };
    });
    return { tiles: keep, cells: nextCells, removed: Math.max(0, tiles.length - keep.length) };
  }

  function cellUsesTile(cells, tile) {
    const id = tile | 0;
    let n = 0;
    for (let i = 0; i < (cells || []).length; i++) {
      const c = cells[i];
      if (c && (c.tile | 0) === id) n++;
    }
    return n;
  }

  function tileBufferShared(tiles, index) {
    const src = tiles[index];
    if (!src) return false;
    for (let i = 0; i < tiles.length; i++) {
      if (i !== index && tiles[i] === src) return true;
    }
    return false;
  }

  // Paint one nibble onto a map cell. If that 8×8 is used anywhere else
  // (same index, or the same Uint8Array under another index), copy it first
  // so only this cell changes. The copy is stored as the pixels on screen
  // (H/V flip baked, flip bits cleared).
  function paintMapNibble(doc, cellIndex, px, py, nib, opts) {
    opts = opts || {};
    const cells = doc.cells;
    const tiles = doc.tiles;
    const cell = cells[cellIndex];
    if (!cell || !tiles[cell.tile | 0]) {
      return { cell: cell, copied: false, error: 'No tile' };
    }
    nib = nib & 15;
    let sx = px & 7;
    let sy = py & 7;
    if (cell.hFlip) sx = 7 - sx;
    if (cell.vFlip) sy = 7 - sy;
    const src = tiles[cell.tile | 0];
    const sameNib = (src[sy * 8 + sx] & 15) === nib;
    const pal = opts.pal;
    const samePal = pal == null || (cell.pal | 0) === (pal | 0);
    if (sameNib && samePal) return { cell: cloneCell(cell), copied: false };

    const next = cloneCell(cell);
    if (pal != null) next.pal = pal | 0;
    let copied = false;
    if (!sameNib) {
      const shared = cellUsesTile(cells, next.tile) > 1 || tileBufferShared(tiles, next.tile);
      if (shared) {
        const cap = opts.tileCap || MAX_TILES_EDIT;
        if (tiles.length >= cap) {
          return {
            cell: cloneCell(cell),
            copied: false,
            error: 'That paint needs a new tile; the name table already has ' + cap + '.'
          };
        }
        tiles.push(flippedTile(src, next.hFlip, next.vFlip));
        next.tile = tiles.length - 1;
        next.hFlip = 0;
        next.vFlip = 0;
        sx = px & 7;
        sy = py & 7;
        copied = true;
        doc.dirtyTiles = true;
        doc.dirtyMap = true;
      }
      tiles[next.tile][sy * 8 + sx] = nib;
      doc.dirtyTiles = true;
    }
    cells[cellIndex] = next;
    if (!samePal) doc.dirtyMap = true;
    return { cell: next, copied: copied };
  }

  function encode5(value) {
    value = Math.max(0, Math.min(255, Number(value) || 0));
    let best = 0;
    let err = 1e9;
    for (let c = 0; c < 32; c++) {
      const d = Math.abs(value - (((c & 31) * 255 / 31) | 0));
      if (d < err) { err = d; best = c; }
    }
    return best;
  }
  function colorFromRgb(r, g, b) {
    const r3 = encodeChannel(r);
    const g3 = encodeChannel(g);
    const b3 = encodeChannel(b);
    return {
      r3: r3, g3: g3, b3: b3,
      r5: encode5(r), g5: encode5(g), b5: encode5(b)
    };
  }
  function with5(c) {
    if (!c) return { r3: 0, g3: 0, b3: 0, r5: 0, g5: 0, b5: 0 };
    if (c.r5 != null) return c;
    const r3 = c.r3 & 7, g3 = c.g3 & 7, b3 = c.b3 & 7;
    return {
      r3: r3, g3: g3, b3: b3,
      r5: (r3 << 2) | (r3 >> 1),
      g5: (g3 << 2) | (g3 >> 1),
      b5: (b3 << 2) | (b3 >> 1)
    };
  }
  function lineIsBlank(line) {
    return !(line || []).some((c) => c && (c.r3 || c.g3 || c.b3 || c.r5 || c.g5 || c.b5));
  }
  function trimBlankLines(lines) {
    const out = (lines || []).slice();
    while (out.length > 1 && lineIsBlank(out[out.length - 1])) out.pop();
    return out.length ? out : [emptyLine().map(with5)];
  }
  function chunkRgb(colors) {
    const n = Math.max(1, Math.ceil(colors.length / 16));
    const lines = [];
    for (let p = 0; p < n; p++) {
      const line = [];
      for (let i = 0; i < 16; i++) {
        const c = colors[p * 16 + i] || [0, 0, 0];
        line.push(colorFromRgb(c[0], c[1], c[2]));
      }
      lines.push(line);
    }
    return trimBlankLines(lines);
  }
  function looksLikeCram(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = Math.min(32, bytes.length >> 1);
    if (!n) return false;
    let even = 0;
    for (let i = 0; i < n; i++) {
      if ((view.getUint16(i * 2) & 1) === 0) even++;
    }
    return even * 10 >= n * 9;
  }
  function cramLines(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = Math.max(1, Math.min(16, bytes.length >> 5));
    const lines = [];
    for (let p = 0; p < n; p++) {
      const line = [];
      for (let i = 0; i < 16; i++) {
        const at = p * 32 + i * 2;
        const w = at + 1 < bytes.length ? view.getUint16(at) : 0;
        line.push(with5(cramFromWord(w)));
      }
      lines.push(line);
    }
    return lines;
  }
  function bgr555Lines(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = Math.max(1, Math.min(16, bytes.length >> 5));
    const lines = [];
    for (let p = 0; p < n; p++) {
      const line = [];
      for (let i = 0; i < 16; i++) {
        const at = p * 32 + i * 2;
        const w = at + 1 < bytes.length ? view.getUint16(at, true) : 0;
        const r5 = w & 31, g5 = (w >>> 5) & 31, b5 = (w >>> 10) & 31;
        line.push({ r5: r5, g5: g5, b5: b5, r3: r5 >> 2, g3: g5 >> 2, b3: b5 >> 2 });
      }
      lines.push(line);
    }
    return lines;
  }
  // NHLPA 93 / 94 SNES team .snespal (32 bytes): same container as Genesis CRAM, expanded for CGRAM.
  function teamSnesLine(bytes) {
    const line = [];
    for (let i = 0; i < 16; i++) {
      const v = (bytes[i * 2] << 8) | bytes[i * 2 + 1];
      const bgr = ((v & 0xf) << 1) | (((v >> 4) & 0xf) << 6) | (((v >> 8) & 0xf) << 11);
      const r5 = bgr & 31, g5 = (bgr >>> 5) & 31, b5 = (bgr >>> 10) & 31;
      line.push({ r5: r5, g5: g5, b5: b5, r3: r5 >> 2, g3: g5 >> 2, b3: b5 >> 2 });
    }
    return line;
  }
  function parseJascPal(bytes) {
    let text;
    try { text = new TextDecoder('latin1').decode(bytes); }
    catch (err) { return null; }
    if (!/^JASC-PAL\b/i.test(text)) return null;
    const rows = text.replace(/\r/g, '').split('\n').map((s) => s.trim()).filter(Boolean);
    const count = parseInt(rows[2], 10);
    if (!count) throw new Error('JASC-PAL is missing a color count');
    const colors = [];
    for (let i = 3; i < rows.length && colors.length < count; i++) {
      const parts = rows[i].split(/\s+/).map(Number);
      if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) continue;
      colors.push([parts[0], parts[1], parts[2]]);
    }
    if (!colors.length) throw new Error('JASC-PAL has no RGB rows');
    return chunkRgb(colors);
  }
  function parseRiffPal(bytes) {
    if (bytes.length < 24) return null;
    const ascii = (at, n) => String.fromCharCode.apply(null, Array.from(bytes.subarray(at, at + n)));
    if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'PAL ') return null;
    let at = 12;
    while (at + 8 <= bytes.length) {
      const tag = ascii(at, 4);
      const size = bytes[at + 4] | (bytes[at + 5] << 8) | (bytes[at + 6] << 16) | (bytes[at + 7] << 24);
      at += 8;
      if (tag === 'data' && size >= 4) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + at, Math.min(size, bytes.length - at));
        const n = view.getUint16(2, true);
        const colors = [];
        for (let i = 0; i < n && 4 + i * 4 + 2 < view.byteLength; i++) {
          colors.push([view.getUint8(4 + i * 4), view.getUint8(4 + i * 4 + 1), view.getUint8(4 + i * 4 + 2)]);
        }
        if (!colors.length) throw new Error('RIFF PAL has no entries');
        return chunkRgb(colors);
      }
      at += size + (size & 1);
    }
    throw new Error('RIFF PAL has no data chunk');
  }
  function parseActBytes(bytes) {
    if (bytes.length !== 768 && bytes.length !== 772) {
      throw new Error('ACT must be 768 or 772 bytes');
    }
    const colors = [];
    for (let i = 0; i < 256; i++) colors.push([bytes[i * 3], bytes[i * 3 + 1], bytes[i * 3 + 2]]);
    let used = 256;
    if (bytes.length === 772) {
      const count = (bytes[768] << 8) | bytes[769];
      if (count > 0 && count <= 256) used = count;
    }
    return chunkRgb(colors.slice(0, used));
  }

  // Loose palette files for the Image Editor mapper: Adobe ACT, Genesis CRAM .pal
  // (ANIM-To-BMP, 32 or 128 bytes), SNES team .snespal (32) / rink BGR555 (256),
  // JASC-PAL and RIFF PAL text/binary .pal from paint programs.
  function parsePaletteFile(bytes, name) {
    const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    const lower = String(name || '').toLowerCase();
    const jasc = parseJascPal(src);
    if (jasc) return { lines: jasc, format: 'jasc' };
    const riff = parseRiffPal(src);
    if (riff) return { lines: riff, format: 'riff' };
    if (src.length === 768 || src.length === 772 || /\.act$/i.test(lower)) {
      return { lines: parseActBytes(src), format: 'act' };
    }
    if (/\.snespal$/i.test(lower)) {
      if (src.length === 32) return { lines: [teamSnesLine(src)], format: 'snes-team' };
      if (src.length >= 32 && (src.length % 32) === 0) return { lines: bgr555Lines(src), format: 'snes-bgr555' };
      throw new Error('SNES palette files are 32 bytes (team) or a multiple of 32 (BGR555 lines)');
    }
    if (/\.pal$/i.test(lower) || src.length === 32 || src.length === 128 || src.length === 256) {
      if (src.length >= 32 && (src.length % 32) === 0 && src.length <= 512) {
        if (src.length >= 256 && !looksLikeCram(src)) return { lines: bgr555Lines(src), format: 'snes-bgr555' };
        return { lines: cramLines(src), format: 'cram' };
      }
    }
    throw new Error('Not a palette (.act, Genesis .pal, SNES .snespal, JASC-PAL, or PAL-sized BIN)');
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
    packPortrait,
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
    collapseDuplicateTiles,
    paintMapNibble,
    parsePaletteFile,
    applyDonorPalette,
    MAX_TILES_EDIT,
    encodeChannel,
    encodeCramWord,
    decodeCramWord,
    encodePaletteLine
  };
});
