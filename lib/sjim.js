/**
 * NHLPA 93 SNES .map.sjim screens. The file is one DecompressBytecode stream.
 * Unpacked bytes are map words, then optional BGR555 palettes, then 4bpp
 * planar tiles. Width, height, and the three offsets are not in the file —
 * the code that loads a screen knows them (nhlpa93snes/docs/file-formats.md).
 *
 * Map word (little-endian): tile 9–0, pal 12–10, priority 13, H 14, V 15.
 * Palettes are SNES BGR555, not Genesis CRAM. Packed bytes need not match
 * EA's compressor; the decompressed map, pal, and tiles must.
 */
(function (root, factory) {
  const jim = typeof module === 'object' && module.exports ? require('./jim') : root.Nhl92Jim;
  const api = factory(jim);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92Sjim = api;
})(typeof self !== 'undefined' ? self : this, function (jim) {
  const KNOWN = [
    { re: /Title1/i, mapW: 32, mapH: 28, mapSize: 0x700, pal: 0x700, tiles: 0x800, palBytes: 0x100 },
    { re: /RonBarr/i, mapW: 8, mapH: 9, mapSize: 0x90, pal: 0x90, tiles: 0x190, palBytes: 0x100 },
    { re: /GameSetUp|GameSetup/i, mapW: 32, mapH: 32, mapSize: 0x800, pal: 0x800, tiles: 0x900, palBytes: 0x100 },
    { re: /NHLPALogo/i, mapW: 8, mapH: 10, mapSize: 0xA0, pal: 0xA0, tiles: 0x1A0, palBytes: 0x100 },
    { re: /EASNBG/i, mapW: 32, mapH: 16, mapSize: 0x400, pal: null, tiles: 0x400, palBytes: 0 }
  ];
  const COMMON = [
    [32, 28], [32, 32], [32, 16], [8, 9], [8, 10], [8, 8],
    [12, 23], [3, 3], [40, 28], [16, 16], [6, 6], [9, 2]
  ];
  const MAX_TILES = 1024;

  function asBytes(buffer) {
    return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  }

  function isSjimName(name) {
    return /\.sjim$/i.test(String(name || '').split(/[/\\]/).pop());
  }

  function layoutFrom(options, name) {
    const opts = options || {};
    if (opts.layout) return normalizeLayout(opts.layout);
    if (opts.mapW && opts.mapH) return normalizeLayout(opts);
    const base = String(name || '').split(/[/\\]/).pop();
    for (let i = 0; i < KNOWN.length; i++) {
      if (KNOWN[i].re.test(base)) return normalizeLayout(KNOWN[i]);
    }
    return null;
  }

  function normalizeLayout(raw) {
    const mapW = raw.mapW | 0;
    const mapH = raw.mapH | 0;
    const mapSize = raw.mapSize != null ? raw.mapSize | 0 : mapW * mapH * 2;
    const palBytes = raw.palBytes != null
      ? raw.palBytes | 0
      : (raw.pal == null ? 0 : ((raw.tiles != null ? raw.tiles : mapSize) - (raw.pal | 0)));
    const pal = palBytes ? (raw.pal != null ? raw.pal | 0 : mapSize) : null;
    const tiles = raw.tiles != null ? raw.tiles | 0 : mapSize + palBytes;
    return { mapW, mapH, mapSize, pal, tiles, palBytes };
  }

  function inferLayout(unpacked, name) {
    const named = layoutFrom({ }, name);
    if (named && named.tiles < unpacked.length && (unpacked.length - named.tiles) % 32 === 0) {
      return named;
    }
    const n = unpacked.length;
    // Prefer a 256-byte CGRAM dump (eight lines) over a coincidental
    // smaller pal + different map size that consumes the same bytes.
    for (let p = 0; p < 3; p++) {
      const palBytes = [256, 128, 0][p];
      for (let i = 0; i < COMMON.length; i++) {
        const mapW = COMMON[i][0];
        const mapH = COMMON[i][1];
        const mapSize = mapW * mapH * 2;
        const tilesAt = mapSize + palBytes;
        if (tilesAt >= n) continue;
        if ((n - tilesAt) % 32 !== 0) continue;
        if (n - tilesAt < 32) continue;
        return { mapW, mapH, mapSize, pal: palBytes ? mapSize : null, tiles: tilesAt, palBytes };
      }
    }
    throw new Error('Could not tell the SNES screen layout. Pass map size and palette offset (they are not in the .map.sjim).');
  }

  function unpackSnesMapWord(word) {
    word = word & 0xffff;
    return {
      tile: word & 0x3ff,
      pal: (word >>> 10) & 7,
      priority: (word >>> 13) & 1,
      hFlip: (word >>> 14) & 1,
      vFlip: (word >>> 15) & 1
    };
  }

  function packSnesMapWord(cell) {
    const tile = (cell && cell.tile != null ? cell.tile : 0) & 0x3ff;
    if (cell && cell.tile > 1023) throw new Error('Tile index ' + cell.tile + ' does not fit in 10 bits');
    return tile
      | (((cell && cell.pal != null ? cell.pal : 0) & 7) << 10)
      | (((cell && cell.priority) ? 1 : 0) << 13)
      | (((cell && cell.hFlip) ? 1 : 0) << 14)
      | (((cell && cell.vFlip) ? 1 : 0) << 15);
  }

  function unpackSnesTile(bytes, offset) {
    offset = offset || 0;
    const nibbles = new Uint8Array(64);
    for (let y = 0; y < 8; y++) {
      const p0 = bytes[offset + 2 * y] || 0;
      const p1 = bytes[offset + 2 * y + 1] || 0;
      const p2 = bytes[offset + 16 + 2 * y] || 0;
      const p3 = bytes[offset + 16 + 2 * y + 1] || 0;
      for (let x = 0; x < 8; x++) {
        const bit = 7 - x;
        nibbles[y * 8 + x] = ((p0 >> bit) & 1)
          | (((p1 >> bit) & 1) << 1)
          | (((p2 >> bit) & 1) << 2)
          | (((p3 >> bit) & 1) << 3);
      }
    }
    return nibbles;
  }

  function packSnesTile(nibbles) {
    const out = new Uint8Array(32);
    for (let y = 0; y < 8; y++) {
      let p0 = 0;
      let p1 = 0;
      let p2 = 0;
      let p3 = 0;
      for (let x = 0; x < 8; x++) {
        const n = nibbles[y * 8 + x] & 15;
        const bit = 7 - x;
        if (n & 1) p0 |= 1 << bit;
        if (n & 2) p1 |= 1 << bit;
        if (n & 4) p2 |= 1 << bit;
        if (n & 8) p3 |= 1 << bit;
      }
      out[2 * y] = p0;
      out[2 * y + 1] = p1;
      out[16 + 2 * y] = p2;
      out[16 + 2 * y + 1] = p3;
    }
    return out;
  }

  function fromBgr555(word) {
    const r5 = word & 31;
    const g5 = (word >>> 5) & 31;
    const b5 = (word >>> 10) & 31;
    return {
      r5: r5, g5: g5, b5: b5,
      r3: r5 >> 2, g3: g5 >> 2, b3: b5 >> 2,
      locked: false
    };
  }

  function toBgr555(c) {
    const r = c.r5 != null ? c.r5 & 31 : ((((c.r3 || 0) & 7) << 2) | (((c.r3 || 0) & 7) >> 1));
    const g = c.g5 != null ? c.g5 & 31 : ((((c.g3 || 0) & 7) << 2) | (((c.g3 || 0) & 7) >> 1));
    const b = c.b5 != null ? c.b5 & 31 : ((((c.b3 || 0) & 7) << 2) | (((c.b3 || 0) & 7) >> 1));
    return (r & 31) | ((g & 31) << 5) | ((b & 31) << 10);
  }

  function emptyLine() {
    return Array.from({ length: 16 }, () => fromBgr555(0));
  }

  function palettesFrom(bytes, offset, palBytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = Math.max(4, Math.min(8, palBytes >> 5));
    const palettes = [];
    for (let p = 0; p < 8; p++) {
      if (p >= count) {
        palettes.push(emptyLine());
        continue;
      }
      const line = [];
      for (let i = 0; i < 16; i++) {
        const at = offset + p * 32 + i * 2;
        line.push(at + 1 < bytes.length ? fromBgr555(view.getUint16(at, true)) : fromBgr555(0));
      }
      palettes.push(line);
    }
    return palettes;
  }

  function unpackStream(bytes) {
    if (!jim || typeof jim.decompressBytecode !== 'function') {
      throw new Error('lib/jim.js decompressBytecode is required to open a .map.sjim');
    }
    return jim.decompressBytecode(asBytes(bytes), 0);
  }

  function parseSjim(buffer, donorPalette, options) {
    options = options || {};
    const bytes = asBytes(buffer);
    if (bytes.length < 2) throw new Error('SJIM is too small');
    const unpacked = unpackStream(bytes);
    const layout = layoutFrom(options, options.name) || inferLayout(unpacked, options.name);
    if (!layout.mapW || !layout.mapH || layout.mapW > 1024 || layout.mapH > 1024) {
      throw new Error('SJIM map is ' + layout.mapW + ' by ' + layout.mapH);
    }
    if (layout.mapSize > unpacked.length) throw new Error('SJIM map runs past the unpacked stream');
    const view = new DataView(unpacked.buffer, unpacked.byteOffset, unpacked.byteLength);
    const cells = [];
    for (let i = 0; i < layout.mapW * layout.mapH; i++) {
      cells.push(unpackSnesMapWord(view.getUint16(i * 2, true)));
    }
    const tileBytes = unpacked.subarray(layout.tiles);
    const tileCount = (tileBytes.length / 32) | 0;
    if (!tileCount) throw new Error('SJIM has no tiles');
    const tiles = [];
    for (let i = 0; i < tileCount; i++) tiles.push(unpackSnesTile(tileBytes, i * 32));
    let palettes;
    let embedPalettes = false;
    if (layout.palBytes && layout.pal != null && layout.pal + layout.palBytes <= unpacked.length) {
      palettes = palettesFrom(unpacked, layout.pal, layout.palBytes);
      embedPalettes = true;
    } else {
      palettes = [0, 1, 2, 3, 4, 5, 6, 7].map(emptyLine);
      if (donorPalette && donorPalette.length >= 32) {
        const donor = asBytes(donorPalette);
        palettes = palettesFrom(donor, 0, Math.min(256, donor.length));
      }
    }
    const usedPals = new Set();
    for (let i = 0; i < cells.length; i++) usedPals.add(cells[i].pal);
    const colors = [];
    for (let p = 0; p < 8; p++) {
      for (let i = 0; i < 16; i++) {
        const c = palettes[p][i];
        colors.push([
          ((c.r5 & 31) * 255 / 31) | 0,
          ((c.g5 & 31) * 255 / 31) | 0,
          ((c.b5 & 31) * 255 / 31) | 0
        ]);
      }
    }
    return {
      name: options.name || '',
      platform: 'snes',
      variant: 'sjim',
      packedOnDisk: true,
      wantPacked: true,
      tiles: tiles,
      mapW: layout.mapW,
      mapH: layout.mapH,
      cells: cells,
      palettes: palettes,
      usedPals: usedPals,
      donor: donorPalette ? asBytes(donorPalette) : null,
      remap: options.remap ? options.remap.slice() : null,
      dirty: false,
      readOnly: false,
      palOff: layout.pal,
      mapOff: 0,
      embedPalettes: embedPalettes,
      originalBytes: Uint8Array.from(bytes),
      colors: colors,
      sjim: layout
    };
  }

  function encodeSjim(doc, options) {
    options = options || {};
    if (!doc.dirty && doc.originalBytes && doc.originalBytes.length && options.force !== true) {
      return Uint8Array.from(doc.originalBytes);
    }
    const layout = normalizeLayout(doc.sjim || {
      mapW: doc.mapW, mapH: doc.mapH,
      palBytes: doc.embedPalettes === false ? 0 : 256
    });
    const tiles = doc.tiles || [];
    if (!tiles.length) throw new Error('An SJIM needs at least one tile');
    if (tiles.length > MAX_TILES) {
      throw new Error('This map has ' + tiles.length + ' tiles; the SNES BG index is 10 bits (1024)');
    }
    for (let i = 0; i < doc.cells.length; i++) {
      const t = doc.cells[i] && doc.cells[i].tile;
      if (t > 1023) throw new Error('Tile index ' + t + ' does not fit in 10 bits');
      if (t >= tiles.length) throw new Error('Map cell uses tile ' + t + ' but the set has ' + tiles.length);
    }
    const palBytesLen = doc.embedPalettes === false ? 0 : (layout.palBytes || 256);
    const unpacked = new Uint8Array(layout.mapSize + palBytesLen + tiles.length * 32);
    const view = new DataView(unpacked.buffer);
    for (let i = 0; i < doc.cells.length; i++) {
      view.setUint16(i * 2, packSnesMapWord(doc.cells[i]), true);
    }
    if (palBytesLen) {
      const palAt = layout.pal != null ? layout.pal : layout.mapSize;
      const lines = palBytesLen >> 5;
      for (let p = 0; p < lines; p++) {
        for (let i = 0; i < 16; i++) {
          const c = doc.palettes[p] && doc.palettes[p][i];
          view.setUint16(palAt + p * 32 + i * 2, toBgr555(c || fromBgr555(0)), true);
        }
      }
    }
    const tileAt = layout.tiles != null ? layout.tiles : layout.mapSize + palBytesLen;
    for (let i = 0; i < tiles.length; i++) unpacked.set(packSnesTile(tiles[i]), tileAt + i * 32);
    if (!jim || typeof jim.compressBytecode !== 'function') {
      throw new Error('Packed SJIM encode needs compressBytecode');
    }
    const packed = jim.compressBytecode(unpacked);
    const back = jim.decompressBytecode(packed, 0, unpacked.length);
    for (let i = 0; i < unpacked.length; i++) {
      if (back[i] !== unpacked[i]) throw new Error('Packed SJIM did not decompress to the same bytes');
    }
    return packed instanceof Uint8Array ? packed : Uint8Array.from(packed);
  }

  return {
    isSjimName,
    parseSjim,
    encodeSjim,
    unpackSnesMapWord,
    packSnesMapWord,
    unpackSnesTile,
    packSnesTile,
    fromBgr555,
    toBgr555,
    KNOWN,
    MAX_TILES
  };
});
