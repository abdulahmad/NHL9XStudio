/**
 * NHL 94 SNES screens: separate tile, map, and palette blobs packed with
 * Decompress ($FB10 LZ, $FB30 Huffman, $FB46 pairs, $FB7A RLE). Unpacked maps
 * are width, height, a format word ($0308 on 4bpp backgrounds), then LE name-
 * table words (tile 9–0, pal 12–10, priority 13, H 14, V 15). Tiles are 4bpp
 * planar (or linear 4bpp that $9B85C2 converts). Packed bytes need not match
 * EA's compressor; the unpacked map, palettes, and tiles must.
 */
(function (root, factory) {
  const pak = typeof module === 'object' && module.exports ? require('./snespak') : root.Nhl92SnesPak;
  const sjim = typeof module === 'object' && module.exports ? require('./sjim') : root.Nhl92Sjim;
  const zip = typeof module === 'object' && module.exports ? require('./zip-store') : root.NhlZipStore;
  const api = factory(pak, sjim, zip);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92Sscr = api;
})(typeof self !== 'undefined' ? self : this, function (pak, sjim, zip) {
  const EXTRA_BG = 0x0308;
  const EXT = { lz: '.lz', huffman: '.huf', rle: '.rle', pairs: '.pairs', raw: '.bin' };

  function asBytes(buffer) {
    return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || []);
  }

  function isSscrName(name) {
    const base = String(name || '').split(/[/\\]/).pop().toLowerCase();
    return /\.(zip|huf|lz|rle|pairs)$/.test(base) || /\.chr(\.|$)/.test(base) || /\.map\.(huf|lz|rle|bin)$/.test(base);
  }

  function maybeUnpack(bytes) {
    const src = asBytes(bytes);
    if (pak && pak.isPacked94 && pak.isPacked94(src, 0)) {
      return { data: pak.unpack94(src, 0), format: pak.formatName(src[0] | (src[1] << 8)) };
    }
    return { data: src, format: 'raw' };
  }

  function linearToPlanar(data) {
    const src = asBytes(data);
    const count = (src.length / 32) | 0;
    const out = new Uint8Array(count * 32);
    for (let t = 0; t < count; t++) {
      for (let y = 0; y < 8; y++) {
        const planes = [0, 0, 0, 0];
        for (let x = 0; x < 8; x++) {
          const b = src[t * 32 + y * 4 + (x >> 1)] || 0;
          const nibble = x & 1 ? b & 15 : b >> 4;
          if (nibble & 8) planes[1] |= 0x80 >> x;
          if (nibble & 4) planes[0] |= 0x80 >> x;
          if (nibble & 2) planes[3] |= 0x80 >> x;
          if (nibble & 1) planes[2] |= 0x80 >> x;
        }
        out[t * 32 + 2 * y] = planes[0];
        out[t * 32 + 2 * y + 1] = planes[1];
        out[t * 32 + 16 + 2 * y] = planes[2];
        out[t * 32 + 17 + 2 * y] = planes[3];
      }
    }
    return out;
  }

  function planarToLinear(data) {
    const src = asBytes(data);
    const count = (src.length / 32) | 0;
    const out = new Uint8Array(count * 32);
    for (let t = 0; t < count; t++) {
      for (let y = 0; y < 8; y++) {
        const p0 = src[t * 32 + 2 * y] || 0;
        const p1 = src[t * 32 + 2 * y + 1] || 0;
        const p2 = src[t * 32 + 16 + 2 * y] || 0;
        const p3 = src[t * 32 + 17 + 2 * y] || 0;
        for (let x = 0; x < 8; x++) {
          const bit = 0x80 >> x;
          let nibble = 0;
          if (p1 & bit) nibble |= 8;
          if (p0 & bit) nibble |= 4;
          if (p3 & bit) nibble |= 2;
          if (p2 & bit) nibble |= 1;
          const at = t * 32 + y * 4 + (x >> 1);
          out[at] = x & 1 ? ((out[at] & 0xf0) | nibble) : ((nibble << 4) | (out[at] & 0x0f));
        }
      }
    }
    return out;
  }

  function looksLikeMap(data) {
    if (!data || data.length < 6) return false;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const mapW = view.getUint16(0, true);
    const mapH = view.getUint16(2, true);
    if (!mapW || !mapH || mapW > 1024 || mapH > 1024) return false;
    return 6 + mapW * mapH * 2 === data.length;
  }

  function withMapHeader(mapW, mapH, extra, words) {
    const out = new Uint8Array(6 + words.length);
    const view = new DataView(out.buffer);
    view.setUint16(0, mapW, true);
    view.setUint16(2, mapH, true);
    view.setUint16(4, extra & 0xffff, true);
    out.set(words, 6);
    return out;
  }

  function emptyLine() {
    return Array.from({ length: 16 }, () => sjim.fromBgr555(0));
  }

  function textFromBytes(bytes) {
    const src = asBytes(bytes);
    let s = '';
    for (let i = 0; i < src.length; i++) s += String.fromCharCode(src[i]);
    return s;
  }

  function bytesFromText(text) {
    const s = String(text || '');
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  function metaFromSscr(sscr) {
    return {
      variant: 'snes94',
      extraWord: sscr.extraWord,
      tileFormat: sscr.tileFormat,
      mapFormat: sscr.mapFormat,
      palFormat: sscr.palFormat,
      linear: !!sscr.linear,
      rawMap: !!sscr.rawMap,
      rawTiles: !!sscr.rawTiles,
      paletteCount: sscr.paletteCount || 0
    };
  }

  function readMeta(bytes) {
    try {
      const raw = JSON.parse(textFromBytes(bytes));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      return {
        extraWord: raw.extraWord,
        tileFormat: raw.tileFormat,
        mapFormat: raw.mapFormat,
        palFormat: raw.palFormat,
        linear: !!raw.linear,
        rawMap: !!raw.rawMap,
        rawTiles: !!raw.rawTiles,
        paletteCount: raw.paletteCount
      };
    } catch (err) {
      return {};
    }
  }

  function isMetaName(name) {
    return /(^|\/)screen\.json$/i.test(String(name || ''));
  }

  function palettesFromBytes(bytes) {
    const src = asBytes(bytes);
    const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
    const palettes = [];
    for (let p = 0; p < 8; p++) {
      const line = [];
      for (let i = 0; i < 16; i++) {
        const at = p * 32 + i * 2;
        line.push(at + 1 < src.length ? sjim.fromBgr555(view.getUint16(at, true)) : sjim.fromBgr555(0));
      }
      palettes.push(line);
    }
    return palettes;
  }

  function palBytesFrom(palettes, count) {
    const n = Math.max(1, Math.min(8, count || 8));
    const out = new Uint8Array(n * 32);
    const view = new DataView(out.buffer);
    for (let p = 0; p < n; p++) {
      for (let i = 0; i < 16; i++) {
        const c = palettes[p] && palettes[p][i];
        view.setUint16(p * 32 + i * 2, sjim.toBgr555(c || sjim.fromBgr555(0)), true);
      }
    }
    return out;
  }

  function colorsFromPalettes(palettes) {
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
    return colors;
  }

  function parseUnpacked(tiles, mapData, palBytes, options) {
    options = options || {};
    const view = new DataView(mapData.buffer, mapData.byteOffset, mapData.byteLength);
    const mapW = options.mapW || view.getUint16(0, true);
    const mapH = options.mapH || view.getUint16(2, true);
    const extraWord = mapData.length >= 6 ? view.getUint16(4, true) : EXTRA_BG;
    if (!mapW || !mapH || mapW > 1024 || mapH > 1024) {
      throw new Error('SNES screen map is ' + mapW + ' by ' + mapH);
    }
    const words = mapData.subarray(6, 6 + mapW * mapH * 2);
    if (words.length < mapW * mapH * 2) throw new Error('SNES screen map runs past the unpacked bytes');
    const wordView = new DataView(words.buffer, words.byteOffset, words.byteLength);
    const cells = [];
    for (let i = 0; i < mapW * mapH; i++) cells.push(sjim.unpackSnesMapWord(wordView.getUint16(i * 2, true)));
    let tileBytes = asBytes(tiles);
    if (options.linear) tileBytes = linearToPlanar(tileBytes);
    if (tileBytes.length % 32) throw new Error('SNES screen tiles are not a whole number of 8×8 stamps');
    const tileCount = (tileBytes.length / 32) | 0;
    if (!tileCount) throw new Error('SNES screen has no tiles');
    const tileList = [];
    for (let i = 0; i < tileCount; i++) tileList.push(sjim.unpackSnesTile(tileBytes, i * 32));
    let palettes;
    let embedPalettes = false;
    let palSource = palBytes && palBytes.length >= 32 ? palBytes : null;
    if (!palSource && options.donor && options.donor.length >= 32) palSource = asBytes(options.donor);
    if (palSource && palSource.length >= 32) {
      palettes = palettesFromBytes(palSource);
      embedPalettes = true;
    } else {
      palettes = [0, 1, 2, 3, 4, 5, 6, 7].map(emptyLine);
    }
    const usedPals = new Set();
    for (let i = 0; i < cells.length; i++) usedPals.add(cells[i].pal);
    const fileNames = (options.fileNames || []).filter((n) => n && !isMetaName(n) && !/\.json$/i.test(n));
    return {
      name: options.name || '',
      platform: 'snes',
      variant: 'snes94',
      packedOnDisk: options.packedOnDisk != null
        ? !!options.packedOnDisk
        : (options.tileFormat !== 'raw' || options.mapFormat !== 'raw'),
      wantPacked: true,
      tiles: tileList,
      mapW: mapW,
      mapH: mapH,
      cells: cells,
      palettes: palettes,
      usedPals: usedPals,
      donor: options.donor ? asBytes(options.donor) : null,
      remap: options.remap ? options.remap.slice() : null,
      dirty: false,
      dirtyTiles: false,
      dirtyPal: false,
      dirtyMap: false,
      readOnly: false,
      palOff: null,
      mapOff: 6,
      embedPalettes: embedPalettes,
      originEmbed: embedPalettes,
      originalBytes: null,
      colors: colorsFromPalettes(palettes),
      sjim: null,
      sscr: {
        extraWord: extraWord,
        tileFormat: options.tileFormat || 'huffman',
        mapFormat: options.mapFormat || 'rle',
        palFormat: options.palFormat || (embedPalettes ? 'huffman' : 'raw'),
        linear: !!options.linear,
        rawMap: !!options.rawMap,
        rawTiles: !!options.rawTiles,
        paletteCount: options.paletteCount || (embedPalettes ? (asBytes(palBytes).length >> 1) : 0),
        tileName: fileNames[0] || null,
        mapName: fileNames[1] || null,
        palName: options.palName || null
      }
    };
  }

  function parseScreen94(parts, options) {
    options = Object.assign({}, options || {}, parts || {});
    const tileSrc = parts.tiles != null ? asBytes(parts.tiles) : null;
    const mapSrc = parts.map != null ? asBytes(parts.map) : null;
    const palSrc = parts.pal != null ? asBytes(parts.pal) : null;
    if (!tileSrc || !tileSrc.length) throw new Error('SNES screen is missing tiles');
    if (!mapSrc || !mapSrc.length) throw new Error('SNES screen is missing a map');
    const tiles = options.rawTiles ? { data: tileSrc, format: 'raw' } : maybeUnpack(tileSrc);
    const map = options.rawMap ? { data: mapSrc, format: 'raw' } : maybeUnpack(mapSrc);
    let pal = null;
    let palFormat = 'raw';
    if (palSrc && palSrc.length) {
      if (pak.isPacked94(palSrc, 0)) {
        pal = maybeUnpack(palSrc);
        palFormat = pal.format;
      } else {
        pal = { data: palSrc, format: 'raw' };
      }
    }
    return parseUnpacked(tiles.data, map.data, pal && pal.data, Object.assign({}, options, {
      tileFormat: tiles.format !== 'raw' ? tiles.format : (options.tileFormat || 'huffman'),
      mapFormat: map.format !== 'raw' ? map.format : (options.mapFormat || 'rle'),
      palFormat: palFormat !== 'raw' ? palFormat : (options.palFormat || (pal && pal.data ? 'huffman' : 'raw')),
      linear: options.linear,
      rawMap: !!options.rawMap,
      rawTiles: !!options.rawTiles,
      packedOnDisk: tiles.format !== 'raw' || map.format !== 'raw' || (pal && pal.format !== 'raw')
    }));
  }

  function extractScreen94(rom, image, donor) {
    if (!pak || typeof pak.lorom !== 'function') throw new Error('lib/snespak.js did not load.');
    const src = asBytes(rom);
    const imageFiles = (image && image.fileNames) || [];
    let tiles;
    let tileFormat = 'raw';
    if (image.rawTiles) {
      tiles = src.subarray(pak.lorom(image.tiles), pak.lorom(image.tilesEnd));
    } else {
      const at = pak.lorom(image.tiles);
      tileFormat = pak.formatName(src[at] | (src[at + 1] << 8)) || 'raw';
      tiles = pak.unpack94(src, at);
    }
    const mapAt = pak.lorom(image.map);
    let mapData;
    let mapFormat = 'raw';
    if (image.rawMap) {
      const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
      const mapW = image.mapW || view.getUint16(mapAt, true);
      const mapH = image.mapH || view.getUint16(mapAt + 2, true);
      const bytes = 6 + mapW * mapH * 2;
      mapData = src.subarray(mapAt, mapAt + Math.min(bytes, src.length - mapAt));
    } else {
      mapFormat = pak.formatName(src[mapAt] | (src[mapAt + 1] << 8)) || 'raw';
      mapData = pak.unpack94(src, mapAt);
    }
    let pal = null;
    let palFormat = 'raw';
    if (image.palette) {
      const at = pak.lorom(image.palette);
      palFormat = pak.formatName(src[at] | (src[at + 1] << 8)) || 'raw';
      const block = pak.unpack94(src, at);
      const count = image.paletteCount || 128;
      pal = block.subarray(0, Math.min(block.length, count * 2));
      if (image.palette2) {
        const extraBlock = pak.unpack94(src, pak.lorom(image.palette2));
        const merged = new Uint8Array(Math.max(256, pal.length, (image.palette2At || 0) + extraBlock.length));
        merged.set(pal);
        const extra = extraBlock.subarray(0, (image.palette2Count || 16) * 2);
        merged.set(extra, image.palette2At || 0);
        pal = merged;
        palFormat = 'raw';
      }
    }
    return parseUnpacked(tiles, mapData, pal, {
      name: imageFiles[0] || (image.id ? image.id + '.snes94.zip' : 'screen.snes94.zip'),
      mapW: image.mapW,
      mapH: image.mapH,
      linear: !!image.linear,
      rawMap: !!image.rawMap,
      rawTiles: !!image.rawTiles,
      tileFormat: tileFormat,
      mapFormat: mapFormat,
      palFormat: palFormat,
      paletteCount: image.paletteCount || (pal ? pal.length >> 1 : 0),
      remap: image.remap,
      donor: donor,
      fileNames: imageFiles
    });
  }

  function pickName(sscr, kind, packed) {
    if (kind === 'tiles' && sscr.tileName) {
      return packed && sscr.tileFormat !== 'raw' ? sscr.tileName : sscr.tileName.replace(/\.(huf|lz|rle|pairs)$/i, '.bin');
    }
    if (kind === 'map' && sscr.mapName) {
      return packed && sscr.mapFormat !== 'raw' && !sscr.rawMap
        ? sscr.mapName
        : sscr.mapName.replace(/\.(huf|lz|rle|pairs)$/i, '.bin');
    }
    if (kind === 'pal' && sscr.palName) return sscr.palName;
    const base = 'screen';
    if (kind === 'tiles') return 'Tiles.chr' + (packed ? (EXT[sscr.tileFormat] || '.huf') : '.bin');
    if (kind === 'map') return 'Map.map' + (packed && !sscr.rawMap ? (EXT[sscr.mapFormat] || '.rle') : '.bin');
    return base + '.pal';
  }

  function encodeScreen94(doc, options) {
    options = options || {};
    const sscr = Object.assign({
      extraWord: EXTRA_BG,
      tileFormat: 'huffman',
      mapFormat: 'rle',
      palFormat: 'huffman',
      linear: false,
      rawMap: false,
      rawTiles: false,
      paletteCount: 128
    }, doc.sscr || {});
    const packed = options.packed !== false;
    const tiles = doc.tiles || [];
    if (!tiles.length) throw new Error('A SNES screen needs at least one tile');
    if (tiles.length > sjim.MAX_TILES) {
      throw new Error('This map has ' + tiles.length + ' tiles; the SNES BG index is 10 bits (1024)');
    }
    for (let i = 0; i < doc.cells.length; i++) {
      const t = doc.cells[i] && doc.cells[i].tile;
      if (t > 1023) throw new Error('Tile index ' + t + ' does not fit in 10 bits');
      if (t >= tiles.length) throw new Error('Map cell uses tile ' + t + ' but the set has ' + tiles.length);
    }
    let tileBytes = new Uint8Array(tiles.length * 32);
    for (let i = 0; i < tiles.length; i++) tileBytes.set(sjim.packSnesTile(tiles[i]), i * 32);
    if (sscr.linear) tileBytes = planarToLinear(tileBytes);
    const words = new Uint8Array(doc.mapW * doc.mapH * 2);
    const wordView = new DataView(words.buffer);
    for (let i = 0; i < doc.cells.length; i++) wordView.setUint16(i * 2, sjim.packSnesMapWord(doc.cells[i]), true);
    const mapRaw = withMapHeader(doc.mapW, doc.mapH, sscr.extraWord, words);
    const palCount = Math.max(1, Math.min(8, Math.ceil((sscr.paletteCount || 128) / 16)));
    const palRaw = doc.embedPalettes === false ? null : palBytesFrom(doc.palettes, palCount);
    const packTiles = packed && !sscr.rawTiles;
    const packMap = packed && !sscr.rawMap;
    const packPal = packed && !!palRaw;
    const tileFmt = sscr.tileFormat && sscr.tileFormat !== 'raw' ? sscr.tileFormat : 'huffman';
    const mapFmt = sscr.mapFormat && sscr.mapFormat !== 'raw' ? sscr.mapFormat : 'rle';
    const palFmt = sscr.palFormat && sscr.palFormat !== 'raw' ? sscr.palFormat : 'huffman';
    const tileOut = packTiles ? pak.pack94(tileBytes, tileFmt) : tileBytes;
    const mapOut = packMap ? pak.pack94(mapRaw, mapFmt, { unit: 2 }) : mapRaw;
    const palOut = palRaw && packPal ? pak.pack94(palRaw, palFmt) : palRaw;
    const files = [
      { name: 'screen.json', data: bytesFromText(JSON.stringify(metaFromSscr(sscr))) },
      { name: pickName(sscr, 'tiles', packTiles), data: tileOut },
      { name: pickName(sscr, 'map', packMap), data: mapOut }
    ];
    if (palOut) files.push({ name: pickName(sscr, 'pal', packPal), data: palOut });
    return { files: files, sscr: sscr };
  }

  function zipApi() {
    if (zip && typeof zip.zipStore === 'function') return zip;
    if (typeof NhlZipStore !== 'undefined') return NhlZipStore;
    throw new Error('lib/zip-store.js did not load.');
  }

  function encodeScreen94Zip(doc, options) {
    const encoded = encodeScreen94(doc, options);
    return zipApi().zipStore(encoded.files);
  }

  function parseScreen94Zip(buffer, options) {
    const entries = zipApi().unzipStore(buffer);
    if (!entries.length) throw new Error('That ZIP has no SNES screen files');
    let tiles = null;
    let map = null;
    let pal = null;
    let meta = {};
    const names = [];
    for (let i = 0; i < entries.length; i++) {
      const name = entries[i].name;
      const lower = name.toLowerCase();
      if (isMetaName(name) || /\.json$/i.test(lower)) {
        if (isMetaName(name)) meta = readMeta(entries[i].data);
        continue;
      }
      names.push(name);
      if (/\.pal$/i.test(lower) || (/pal/i.test(lower) && entries[i].data.length <= 512)) pal = entries[i].data;
      else if (/\.map(\.|$)/i.test(lower) || looksLikeMap(maybeUnpack(entries[i].data).data)) map = entries[i].data;
      else if (/\.chr(\.|$)/i.test(lower) || /tiles/i.test(lower)) tiles = entries[i].data;
    }
    if (!tiles || !map) {
      for (let i = 0; i < entries.length; i++) {
        if (isMetaName(entries[i].name) || /\.json$/i.test(entries[i].name)) continue;
        const unpacked = maybeUnpack(entries[i].data).data;
        if (!map && looksLikeMap(unpacked)) map = entries[i].data;
        else if (!tiles && unpacked.length % 32 === 0 && unpacked.length >= 32) tiles = entries[i].data;
      }
    }
    if (!tiles || !map) throw new Error('That ZIP needs tiles and a map (chr + map)');
    return parseScreen94({ tiles: tiles, map: map, pal: pal, fileNames: names }, Object.assign({}, meta, options || {}));
  }

  function parsePackedOrZip(buffer, options) {
    const src = asBytes(buffer);
    if (src.length >= 4 && src[0] === 0x50 && src[1] === 0x4b && (src[2] === 0x03 || src[2] === 0x05)) {
      return parseScreen94Zip(src, options);
    }
    const unpacked = maybeUnpack(src);
    if (looksLikeMap(unpacked.data)) {
      throw new Error('This is a SNES map without tiles. Open the matching .chr (.huf/.lz/.rle) with it, or a ZIP of both.');
    }
    if (unpacked.data.length % 32 === 0 && unpacked.data.length >= 32) {
      const count = unpacked.data.length / 32;
      const cols = Math.min(16, count);
      const rows = Math.ceil(count / cols);
      const words = new Uint8Array(cols * rows * 2);
      const view = new DataView(words.buffer);
      for (let i = 0; i < count; i++) view.setUint16(i * 2, i & 0x3ff, true);
      const map = withMapHeader(cols, rows, EXTRA_BG, words);
      return parseUnpacked(unpacked.data, map, options && options.donor, Object.assign({}, options, {
        tileFormat: unpacked.format,
        mapFormat: 'raw',
        rawMap: true,
        variantNote: 'tile sheet'
      }));
    }
    throw new Error('Not a packed NHL 94 SNES screen');
  }

  return {
    isSscrName,
    parseScreen94,
    parseScreen94Zip,
    parsePackedOrZip,
    extractScreen94,
    encodeScreen94,
    encodeScreen94Zip,
    linearToPlanar,
    planarToLinear,
    looksLikeMap,
    EXTRA_BG
  };
});
