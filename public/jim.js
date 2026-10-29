/**
 * Genesis map editor (.map.jim). Name-table words are the whole per-cell
 * record: tile, H-flip, V-flip, palette, priority. Rotation is a tool.
 * 90° and 270° bake tiles because the VDP has no rotate bit.
 *
 * Prefers Nhl92Jim.parseJim / encodeJim / transformBlock / packMapWord when
 * those exist. Otherwise reads with the same rules as decodeJim and writes
 * an uncompressed file itself.
 */
(function () {
  'use strict';

  const Jim = typeof Nhl92Jim === 'undefined' ? null : Nhl92Jim;
  const Quant = typeof NhlGenesisQuantize === 'undefined' ? null : NhlGenesisQuantize;
  const UNDO_MAX = 100;
  const METHODS = ['perceptual', 'selective', 'adaptive', 'uniform', 'weighted-kmeans'];
  const DITHERS = ['none', 'diffusion', 'pattern', 'noise'];

  const state = {
    tool: 'paint',
    zoom: 4,
    color: { pal: 0, index: 1 },
    tile: 0,
    focus: { x: 0, y: 0 },
    sel: null,
    clip: null,
    float: null,
    batch: [],
    undo: [],
    redo: [],
    drag: null,
    down: false,
    strokeNib: 1
  };

  let doc = null;

  function $(id) { return document.getElementById(id); }
  function cloneCell(c) {
    return {
      tile: c.tile | 0,
      hFlip: c.hFlip ? 1 : 0,
      vFlip: c.vFlip ? 1 : 0,
      pal: c.pal & 3,
      priority: c.priority ? 1 : 0
    };
  }
  function zeroCell() { return { tile: 0, hFlip: 0, vFlip: 0, pal: 0, priority: 0 }; }
  function isZero(c) { return !c.tile && !c.hFlip && !c.vFlip && !c.pal && !c.priority; }

  function expandChannel(c) {
    if (Quant && Quant.expandChannel) return Quant.expandChannel(c & 7);
    if (typeof Nhl92Anim !== 'undefined' && Nhl92Anim.expandChannel) return Nhl92Anim.expandChannel(c & 7);
    c &= 7;
    return (c << 5) | (c << 2) | (c >> 1);
  }
  function encodeChannel(value) {
    if (Quant && Quant.encodeChannel) return Quant.encodeChannel(value);
    let best = 0;
    let err = 1e9;
    for (let c = 0; c < 8; c++) {
      const d = Math.abs((value | 0) - expandChannel(c));
      if (d < err) { err = d; best = c; }
    }
    return best;
  }
  function rgbOf(c) {
    return 'rgb(' + expandChannel(c.r3) + ',' + expandChannel(c.g3) + ',' + expandChannel(c.b3) + ')';
  }
  function hexOf(c) {
    function h(n) { return expandChannel(n).toString(16).padStart(2, '0'); }
    return '#' + h(c.r3) + h(c.g3) + h(c.b3);
  }

  function unpackWord(word) {
    word &= 0xffff;
    return {
      tile: word & 0x7ff,
      hFlip: (word >>> 11) & 1,
      vFlip: (word >>> 12) & 1,
      pal: (word >>> 13) & 3,
      priority: (word >>> 15) & 1
    };
  }
  function packWord(cell) {
    if (Jim && typeof Jim.packMapWord === 'function') {
      try {
        const packed = Jim.packMapWord(cell);
        if (Number.isInteger(packed)) return packed & 0xffff;
      } catch (err) { /* built-in packer */ }
    }
    return (cell.tile & 0x7ff)
      | ((cell.hFlip ? 1 : 0) << 11)
      | ((cell.vFlip ? 1 : 0) << 12)
      | ((cell.pal & 3) << 13)
      | ((cell.priority ? 1 : 0) << 15);
  }
  function cellOf(value) {
    if (typeof value === 'number') return unpackWord(value);
    if (!value || typeof value !== 'object') return zeroCell();
    const pal = value.pal != null ? value.pal : value.palette;
    return {
      tile: (value.tile != null ? value.tile : value.index) | 0,
      hFlip: value.hFlip ? 1 : 0,
      vFlip: value.vFlip ? 1 : 0,
      pal: (pal | 0) & 3,
      priority: value.priority ? 1 : 0
    };
  }

  function unpackStamp(bytes, offset) {
    const n = new Uint8Array(64);
    for (let i = 0; i < 32; i++) {
      const b = bytes[offset + i];
      n[i * 2] = b >>> 4;
      n[i * 2 + 1] = b & 15;
    }
    return n;
  }
  function packStamp(nibbles) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 64; i++) {
      const n = nibbles[i] & 15;
      if ((i & 1) === 0) out[i >> 1] = n << 4;
      else out[i >> 1] |= n;
    }
    return out;
  }
  function packTiles(tiles) {
    const out = new Uint8Array(tiles.length * 32);
    tiles.forEach((t, i) => out.set(packStamp(t), i * 32));
    return out;
  }
  function readCram(bytes, offset) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const line = [];
    for (let i = 0; i < 16; i++) {
      const w = view.getUint16(offset + i * 2);
      line.push({ r3: (w >> 1) & 7, g3: (w >> 5) & 7, b3: (w >> 9) & 7 });
    }
    return line;
  }
  function encodePalBytes(palettes) {
    const out = new Uint8Array(128);
    const view = new DataView(out.buffer);
    for (let p = 0; p < 4; p++) {
      for (let i = 0; i < 16; i++) {
        const c = palettes[p][i];
        const word = ((c.b3 & 7) << 9) | ((c.g3 & 7) << 5) | ((c.r3 & 7) << 1);
        view.setUint16((p * 16 + i) * 2, word);
      }
    }
    return out;
  }
  function defaultLine(p) {
    const line = [];
    for (let i = 0; i < 16; i++) {
      line.push({ r3: (i + p) & 7, g3: (i * 2 + p) & 7, b3: (7 - i + p * 3) & 7 });
    }
    return line;
  }
  function defaultPalettes() {
    return [0, 1, 2, 3].map(defaultLine);
  }
  function copyBytes(src) {
    const u = src instanceof Uint8Array ? src : new Uint8Array(src);
    const out = new Uint8Array(u.byteLength);
    out.set(u);
    return out;
  }
  function concat(parts) {
    let n = 0;
    parts.forEach((p) => { n += p.length; });
    const out = new Uint8Array(n);
    let at = 0;
    parts.forEach((p) => { out.set(p, at); at += p.length; });
    return out;
  }
  function keyOf(nibbles) {
    let s = '';
    for (let i = 0; i < 64; i++) s += (nibbles[i] & 15).toString(16);
    return s;
  }
  function flipNibbles(tile, h, v) {
    if (!h && !v) return tile;
    const o = new Uint8Array(64);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const sx = h ? 7 - x : x;
        const sy = v ? 7 - y : y;
        o[y * 8 + x] = tile[sy * 8 + sx] & 15;
      }
    }
    return o;
  }
  function rot90(tile, cw) {
    const o = new Uint8Array(64);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const sx = cw ? 7 - y : y;
        const sy = cw ? x : 7 - x;
        o[sy * 8 + sx] = tile[y * 8 + x] & 15;
      }
    }
    return o;
  }

  function hiddenPixel(pal, nib) {
    const index = (pal << 4) | (nib & 15);
    if (Jim && typeof Jim.picturePixelHidden === 'function') return Jim.picturePixelHidden(index);
    return (nib & 15) === 0 && pal !== 0;
  }

  function snapshot() {
    return {
      tiles: doc.tiles.map((t) => Uint8Array.from(t)),
      cells: doc.cells.map(cloneCell),
      palettes: doc.palettes.map((line) => line.map((c) => ({ r3: c.r3 & 7, g3: c.g3 & 7, b3: c.b3 & 7 }))),
      mapW: doc.mapW,
      mapH: doc.mapH,
      embedPalettes: doc.embedPalettes,
      dirtyTiles: doc.dirtyTiles,
      dirtyPal: doc.dirtyPal,
      dirtyMap: doc.dirtyMap
    };
  }
  function restore(snap) {
    doc.tiles = snap.tiles.map((t) => Uint8Array.from(t));
    doc.cells = snap.cells.map(cloneCell);
    doc.palettes = snap.palettes.map((line) => line.map((c) => ({ r3: c.r3, g3: c.g3, b3: c.b3 })));
    doc.mapW = snap.mapW;
    doc.mapH = snap.mapH;
    doc.embedPalettes = snap.embedPalettes;
    doc.dirtyTiles = snap.dirtyTiles;
    doc.dirtyPal = snap.dirtyPal;
    doc.dirtyMap = snap.dirtyMap;
    if (state.focus.x >= doc.mapW) state.focus.x = doc.mapW - 1;
    if (state.focus.y >= doc.mapH) state.focus.y = doc.mapH - 1;
    if (state.tile >= doc.tiles.length) state.tile = Math.max(0, doc.tiles.length - 1);
    if (state.sel && (state.sel.x >= doc.mapW || state.sel.y >= doc.mapH)) state.sel = null;
  }
  function remember() {
    if (doc.readOnly) return;
    state.undo.push(snapshot());
    if (state.undo.length > UNDO_MAX) state.undo.shift();
    state.redo = [];
  }
  function undo() {
    if (!state.undo.length) return;
    state.redo.push(snapshot());
    restore(state.undo.pop());
    status('Undid one edit.');
    renderAll();
  }
  function redo() {
    if (!state.redo.length) return;
    state.undo.push(snapshot());
    restore(state.redo.pop());
    status('Redid one edit.');
    renderAll();
  }
  function canEdit() {
    if (!doc || !doc.readOnly) return true;
    status('This portrait is read-only.', true);
    return false;
  }

  function blankDoc() {
    const tiles = [new Uint8Array(64)];
    const cells = [];
    for (let i = 0; i < 64; i++) cells.push(zeroCell());
    return {
      name: 'untitled.map.jim',
      variant: 'map',
      readOnly: false,
      packedOnDisk: false,
      embedPalettes: true,
      originEmbed: true,
      source: null,
      rawPal: null,
      rawTileBytes: null,
      palOff: null,
      mapOff: null,
      tiles: tiles,
      mapW: 8,
      mapH: 8,
      cells: cells,
      palettes: defaultPalettes(),
      dirtyTiles: false,
      dirtyPal: false,
      dirtyMap: false,
      via: 'new',
      readerNote: ''
    };
  }

  function tilesFromParsed(value) {
    if (!value) return null;
    if (value instanceof Uint8Array) {
      if (value.length % 32 !== 0 || !value.length) return null;
      const tiles = [];
      for (let i = 0; i < value.length; i += 32) tiles.push(unpackStamp(value, i));
      return tiles;
    }
    if (typeof value.length !== 'number' || !value.length) return null;
    const tiles = [];
    for (let i = 0; i < value.length; i++) {
      const t = value[i];
      if (!t || !t.length) return null;
      if (t.length === 64) tiles.push(Uint8Array.from(t, (n) => n & 15));
      else if (t.length === 32) tiles.push(unpackStamp(t, 0));
      else return null;
    }
    return tiles;
  }
  function lineFromParsed(line) {
    if (!line) return null;
    if (line instanceof Uint8Array && line.length === 32) return readCram(line, 0);
    if (typeof line.length === 'number' && line.length === 16) {
      return Array.from(line, (entry) => {
        if (entry && entry.r3 != null) return { r3: entry.r3 & 7, g3: entry.g3 & 7, b3: entry.b3 & 7 };
        if (Array.isArray(entry) || ArrayBuffer.isView(entry)) {
          const r = entry[0], g = entry[1], b = entry[2];
          if (r <= 7 && g <= 7 && b <= 7) return { r3: r | 0, g3: g | 0, b3: b | 0 };
          return { r3: encodeChannel(r), g3: encodeChannel(g), b3: encodeChannel(b) };
        }
        if (typeof entry === 'number') return { r3: (entry >> 1) & 7, g3: (entry >> 5) & 7, b3: (entry >> 9) & 7 };
        return null;
      });
    }
    return null;
  }
  function palsFromParsed(value, bytes) {
    if (value instanceof Uint8Array && (value.length === 128 || value.length === 32)) {
      const lines = [];
      for (let p = 0; p < 4; p++) {
        lines.push(value.length >= (p + 1) * 32 ? readCram(value, p * 32) : defaultLine(p));
      }
      return lines;
    }
    if (value && value.length === 4) {
      const lines = [];
      for (let p = 0; p < 4; p++) {
        const line = lineFromParsed(value[p]);
        if (!line || line.some((c) => !c)) return null;
        lines.push(line);
      }
      return lines;
    }
    if (value && value.length === 64) {
      const flat = lineFromParsed(value);
      if (!flat) return null;
      return [0, 1, 2, 3].map((p) => flat.slice(p * 16, p * 16 + 16));
    }
    if (bytes && value == null) return null;
    return null;
  }
  function cellsFromParsed(value, count) {
    if (!value || value.length == null) return null;
    if (value instanceof Uint8Array && value.length === count * 2) {
      const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
      const cells = [];
      for (let i = 0; i < count; i++) cells.push(unpackWord(view.getUint16(i * 2)));
      return cells;
    }
    if (value.length !== count) return null;
    const cells = [];
    for (let i = 0; i < count; i++) cells.push(cellOf(value[i]));
    return cells;
  }

  function adaptParsed(raw, name, bytes) {
    if (!raw || typeof raw !== 'object') return null;
    const mapW = raw.mapW || raw.width || raw.mapWidth;
    const mapH = raw.mapH || raw.height || raw.mapHeight;
    if (!mapW || !mapH) return null;
    const tiles = tilesFromParsed(raw.tiles || raw.tileNibbles || raw.tileBytes);
    const cells = cellsFromParsed(raw.cells || raw.map || raw.mapWords, mapW * mapH);
    if (!tiles || !cells) return null;
    const noPal = raw.noPalette === true || raw.variant === 'nopal' || raw.palOff === 0xffffffff;
    const variant = raw.variant || (noPal ? 'nopal' : 'map');
    const palOff = raw.palOff != null ? raw.palOff : raw.paletteOffset;
    const mapOff = raw.mapOff != null ? raw.mapOff : raw.mapOffset;
    let palettes = palsFromParsed(raw.palettes || raw.cram, bytes);
    let rawPal = null;
    if (!noPal && palOff != null && palOff !== 0xffffffff && palOff !== mapOff && palOff + 128 <= bytes.length) {
      rawPal = bytes.subarray(palOff, palOff + 128);
      if (!palettes) palettes = [0, 1, 2, 3].map((p) => readCram(rawPal, p * 32));
    }
    if (!palettes) palettes = defaultPalettes();
    const embed = raw.embedPalettes != null ? !!raw.embedPalettes : !noPal && variant !== 'logo' && variant !== 'shared' && variant !== 'portrait';
    return {
      name: name,
      variant: variant,
      readOnly: variant === 'portrait' || !!raw.readOnly,
      packedOnDisk: !!(raw.packedOnDisk || raw.packed),
      embedPalettes: embed,
      originEmbed: embed,
      source: bytes,
      rawPal: rawPal,
      rawTileBytes: null,
      palOff: palOff == null ? null : palOff,
      mapOff: mapOff == null ? null : mapOff,
      tiles: tiles,
      mapW: mapW,
      mapH: mapH,
      cells: cells,
      palettes: palettes,
      dirtyTiles: false,
      dirtyPal: false,
      dirtyMap: false,
      via: 'parseJim',
      readerNote: ''
    };
  }

  function fallbackParse(bytes, name) {
    if (!Jim || typeof Jim.decompressBytecode !== 'function' || typeof Jim.unpackPortrait !== 'function') {
      throw new Error('lib/jim.js did not load.');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 12) throw new Error('JIM is too small');
    const noPalette = view.getUint32(0) === 0xffffffff;
    const palOff = noPalette ? 0 : view.getUint32(0);
    const mapOff = view.getUint32(4);
    const tileWord = view.getUint16(8);
    const packed = (tileWord & 0x8000) !== 0;
    const tileCount = tileWord & 0x7fff;
    if (!tileCount || tileCount > 4096) throw new Error('JIM tile count is not usable');
    const shared = !noPalette && palOff === 0 && mapOff === 0;
    const portraitRows = !noPalette && palOff === 10 + tileCount * 24;
    const portraitFace = !noPalette && palOff === 0 && mapOff === 0 && (tileCount === 36 || tileCount === 0x24);
    const portrait = portraitRows || portraitFace;
    let tileBytes;
    if (packed) tileBytes = Jim.decompressBytecode(bytes, 10, tileCount * 32);
    else if (portrait) tileBytes = Jim.unpackPortrait(bytes, 10, tileCount);
    else if (noPalette || palOff === 0 || palOff === 10 + tileCount * 32 || palOff === mapOff) {
      const end = 10 + tileCount * 32;
      if (end > bytes.length) throw new Error('JIM tile data runs past the file');
      tileBytes = bytes.subarray(10, end);
    } else throw new Error('This picture is not a JIM');

    let mapW;
    let mapH;
    if (portraitFace) {
      mapW = 6;
      mapH = Math.ceil(tileCount / mapW);
    } else if (shared) {
      mapW = Math.min(8, tileCount);
      mapH = Math.ceil(tileCount / mapW);
    } else {
      if (mapOff + 4 > bytes.length) throw new Error('JIM offsets run past the file');
      mapW = view.getUint16(mapOff);
      mapH = view.getUint16(mapOff + 2);
    }
    if (!mapW || !mapH || mapW > 1024 || mapH > 1024) throw new Error('JIM map is ' + mapW + ' by ' + mapH);
    if (!shared && mapOff + 4 + mapW * mapH * 2 > bytes.length) throw new Error('JIM map runs past the file');

    const cells = [];
    if (shared) {
      for (let i = 0; i < mapW * mapH; i++) cells.push({ tile: i, hFlip: 0, vFlip: 0, pal: 0, priority: 0 });
    } else {
      for (let i = 0; i < mapW * mapH; i++) cells.push(unpackWord(view.getUint16(mapOff + 4 + i * 2)));
    }
    const tiles = [];
    for (let i = 0; i < tileCount; i++) tiles.push(unpackStamp(tileBytes, i * 32));

    const logo = !portrait && !noPalette && palOff !== 0 && palOff === mapOff;
    let variant = 'map';
    if (portrait) variant = 'portrait';
    else if (noPalette) variant = 'nopal';
    else if (shared) variant = 'shared';
    else if (logo) variant = 'logo';

    let rawPal = null;
    let palettes = null;
    if (!shared && !noPalette && palOff !== mapOff && palOff + 128 <= bytes.length) {
      rawPal = bytes.subarray(palOff, palOff + 128);
      palettes = [0, 1, 2, 3].map((p) => readCram(rawPal, p * 32));
    } else palettes = defaultPalettes();

    const embed = !!rawPal;
    return {
      name: name,
      variant: variant,
      readOnly: portrait,
      packedOnDisk: packed,
      embedPalettes: embed,
      originEmbed: embed,
      source: bytes,
      rawPal: rawPal,
      rawTileBytes: portrait ? null : tileBytes,
      palOff: noPalette ? 0xffffffff : palOff,
      mapOff: mapOff,
      tiles: tiles,
      mapW: mapW,
      mapH: mapH,
      cells: cells,
      palettes: palettes,
      dirtyTiles: false,
      dirtyPal: false,
      dirtyMap: false,
      via: 'built-in',
      readerNote: portrait ? '' : (rawPal ? '' : 'No CRAM in the file. Colors are a stand-in until you load a donor or an ACT.')
    };
  }

  function openBytes(bytes, name, donor) {
    bytes = copyBytes(bytes);
    const donorBytes = donor && donor.length ? copyBytes(donor) : null;
    let parsedErr = null;
    if (Jim && typeof Jim.parseJim === 'function') {
      try {
        const adapted = adaptParsed(Jim.parseJim(bytes, donorBytes, { name: name }), name, bytes);
        if (adapted) return adapted;
        parsedErr = new Error('parseJim did not return a tile map');
      } catch (err) { parsedErr = err; }
    }
    try {
      const built = fallbackParse(bytes, name);
      if (parsedErr) built.readerNote = 'parseJim: ' + parsedErr.message + '. Built-in reader used.';
      return built;
    } catch (err) {
      throw parsedErr || err;
    }
  }

function identityMap(model) {
  if (model.variant !== 'shared' && model.variant !== 'sheet') return false;
    for (let i = 0; i < model.cells.length; i++) {
      const c = model.cells[i];
      if (c.tile !== i || c.hFlip || c.vFlip || c.pal || c.priority) return false;
    }
    return true;
  }
  function encodeMap(model) {
    const out = new Uint8Array(4 + model.mapW * model.mapH * 2);
    const view = new DataView(out.buffer);
    view.setUint16(0, model.mapW);
    view.setUint16(2, model.mapH);
    model.cells.forEach((c, i) => view.setUint16(4 + i * 2, packWord(c)));
    return out;
  }
  function localEncode(model, packed) {
    if (model.tiles.length > 2048) {
      throw new Error('Export refused: ' + model.tiles.length + ' tiles is above the 2048 name-table limit.');
    }
    for (let i = 0; i < model.cells.length; i++) {
      const c = model.cells[i];
      if (c.tile > 2047) throw new Error('Export refused: cell ' + (i % model.mapW) + ',' + Math.floor(i / model.mapW) + ' tile ' + c.tile + ' does not fit in 11 bits.');
      if (c.tile >= model.tiles.length) throw new Error('Export refused: cell ' + (i % model.mapW) + ',' + Math.floor(i / model.mapW) + ' uses tile ' + c.tile + ' but the file has ' + model.tiles.length + '.');
    }
    if (model.variant === 'portrait') {
      if (!model.source) throw new Error('This portrait has no original bytes to export.');
      if (packed !== model.packedOnDisk || model.dirtyTiles || model.dirtyPal || model.dirtyMap || model.embedPalettes !== model.originEmbed) {
        throw new Error('Portrait packing is read-only. Export keeps the original file, so leave Packed export matching the file and do not edit it.');
      }
      return model.source;
    }
    if (model.source && !model.dirtyTiles && !model.dirtyPal && !model.dirtyMap && !!packed === !!model.packedOnDisk && !!model.embedPalettes === !!model.originEmbed) {
      return model.source;
    }
    let tileBytes = !model.dirtyTiles && model.rawTileBytes && model.rawTileBytes.length === model.tiles.length * 32
      ? model.rawTileBytes
      : packTiles(model.tiles);
    let word = model.tiles.length;
    if (packed) {
      const compress = Jim && typeof Jim.compressBytecode === 'function' ? Jim.compressBytecode : null;
      if (!compress) throw new Error('Packed export is not available yet (encodeJim is not loaded). The file was not saved.');
      const stream = compress(tileBytes);
      const packedBytes = stream instanceof Uint8Array ? stream : Uint8Array.from(stream);
      const back = Jim.decompressBytecode(packedBytes, 0, tileBytes.length);
      for (let i = 0; i < tileBytes.length; i++) {
        if (back[i] !== tileBytes[i]) throw new Error('Packed stream did not decompress back to the same tiles. The file was not saved.');
      }
      tileBytes = packedBytes;
      word |= 0x8000;
    }
    const mapBytes = encodeMap(model);
    const palBytes = model.embedPalettes
      ? (!model.dirtyPal && model.rawPal && model.rawPal.length === 128 ? model.rawPal : encodePalBytes(model.palettes))
      : null;
    let palOff;
    let mapOff;
    let body;
    if (!model.embedPalettes && (model.variant === 'shared' || model.variant === 'sheet') && identityMap(model)) {
      palOff = 0;
      mapOff = 0;
      body = tileBytes;
    } else if (!model.embedPalettes && model.variant === 'logo') {
      palOff = 10 + tileBytes.length;
      mapOff = palOff;
      body = concat([tileBytes, mapBytes]);
    } else if (!model.embedPalettes) {
      palOff = 0xffffffff;
      mapOff = 10 + tileBytes.length;
      body = concat([tileBytes, mapBytes]);
    } else {
      palOff = 10 + tileBytes.length;
      mapOff = palOff + palBytes.length;
      body = concat([tileBytes, palBytes, mapBytes]);
    }
    const out = new Uint8Array(10 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, palOff >>> 0);
    view.setUint32(4, mapOff >>> 0);
    view.setUint16(8, word & 0xffff);
    out.set(body, 10);
    return out;
  }
function exportVariant() {
  const sheet = doc.variant === 'sheet' || doc.variant === 'shared';
  if (doc.embedPalettes && (sheet || doc.variant === 'nopal' || doc.variant === 'logo')) return 'map';
  if (sheet && !identityMap(doc)) return 'nopal';
  return doc.variant === 'sheet' ? 'sheet' : doc.variant;
}
function callEncodeJim(packed) {
  const payload = {
    name: doc.name,
    variant: exportVariant(),
    packedOnDisk: doc.packedOnDisk,
    embedPalettes: !!doc.embedPalettes,
    tiles: doc.tiles,
    mapW: doc.mapW,
    mapH: doc.mapH,
    cells: doc.cells,
    palettes: doc.palettes,
    readOnly: false
  };
  const out = Jim.encodeJim(payload, { packed: !!packed, embedPalettes: !!doc.embedPalettes });
    if (out instanceof Uint8Array) return out;
    if (out instanceof ArrayBuffer) return new Uint8Array(out);
    if (Array.isArray(out)) return Uint8Array.from(out);
    if (out && out.bytes) return callBytes(out.bytes);
    throw new Error('encodeJim did not return bytes');
  }
  function callBytes(out) {
    if (out instanceof Uint8Array) return out;
    if (out instanceof ArrayBuffer) return new Uint8Array(out);
    return Uint8Array.from(out);
  }
function buildExport(packed) {
  const unchanged = doc.source && !doc.dirtyTiles && !doc.dirtyPal && !doc.dirtyMap
    && !!packed === !!doc.packedOnDisk && !!doc.embedPalettes === !!doc.originEmbed;
  if (unchanged) return doc.source;
  if (doc.readOnly || doc.variant === 'portrait') return localEncode(doc, packed);
  if (Jim && typeof Jim.encodeJim === 'function') {
      try { return callBytes(callEncodeJim(packed)); }
      catch (err) {
        if (packed) throw err;
        return localEncode(doc, false);
      }
    }
    return localEncode(doc, packed);
  }

  function users(tile) {
    let n = 0;
    doc.cells.forEach((c) => { if (c.tile === tile) n++; });
    return n;
  }
  function nibbleAt(cell, px, py) {
    const tile = doc.tiles[cell.tile];
    if (!tile) return 0;
    let x = px & 7;
    let y = py & 7;
    if (cell.hFlip) x = 7 - x;
    if (cell.vFlip) y = 7 - y;
    return tile[y * 8 + x] & 15;
  }

  function status(text, isError) {
    const el = $('jim-status');
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }
  function focused(id) { return document.activeElement && document.activeElement.id === id; }

  function headerMode() {
if (doc.variant === 'portrait') return 'Export keeps the original portrait bytes.';
  if (doc.embedPalettes) return 'Export writes 128 bytes of CRAM, then the map.';
  if (doc.variant === 'logo') return 'Export keeps the logo header: palette offset equals the map offset (no CRAM).';
  if ((doc.variant === 'shared' || doc.variant === 'sheet') && identityMap(doc)) return 'Export keeps the shared zero header (no map words, no CRAM).';
  if (doc.variant === 'shared' || doc.variant === 'sheet') return 'Cell edits do not fit a shared header. Export writes $FFFFFFFF plus a map.';
    return 'Export writes $FFFFFFFF (no palette). The game needs a donor CRAM.';
  }
  function stats() {
    const pals = new Set();
    const inks = new Set();
    let bad = 0;
    doc.cells.forEach((c) => {
      pals.add(c.pal);
      if (c.tile >= doc.tiles.length || c.tile > 2047) { bad++; return; }
      const tile = doc.tiles[c.tile];
      for (let i = 0; i < 64; i++) {
        const nib = tile[i] & 15;
        if (hiddenPixel(c.pal, nib)) continue;
        const col = doc.palettes[c.pal][nib];
        inks.add(col.r3 + ',' + col.g3 + ',' + col.b3);
      }
    });
    let budget = 0;
    pals.forEach((p) => { budget += p === 0 ? 16 : 15; });
    return { pals: Array.from(pals).sort(), inks: inks.size, budget: budget, bad: bad };
  }
  function variantLabel() {
    if (doc.variant === 'nopal') return 'no palette ($FFFFFFFF)';
    if (doc.variant === 'portrait') return 'portrait (read-only)';
if (doc.variant === 'shared' || doc.variant === 'sheet') return 'shared header';
  if (doc.variant === 'logo') return 'logo (palette offset = map offset)';
    return 'map';
  }

  function renderNote() {
    const s = stats();
    const warnings = [];
    if (doc.tiles.length > 2048) warnings.push('above 2048 tiles — export refused');
    else if (doc.tiles.length === 2048) warnings.push('at the 2048 tile cap');
    if (s.bad) warnings.push(s.bad + ' cell' + (s.bad === 1 ? '' : 's') + ' point past the tile set');
    if (s.inks > s.budget) warnings.push('more ink colors than the open lines can hold');
    if (doc.mapW > 1024 || doc.mapH > 1024 || !doc.mapW || !doc.mapH) warnings.push('map size is outside 1–1024');
    if (doc.readerNote) warnings.push(doc.readerNote);
    const packedBox = $('jim-packed').checked;
    const text = doc.tiles.length + '/2048 tiles · ' + s.inks + '/' + s.budget + ' colors · lines ' +
      (s.pals.length ? s.pals.join(',') : 'none') + ' · on disk ' + (doc.packedOnDisk ? 'packed' : 'raw') +
      ' · export ' + (packedBox ? 'packed' : 'uncompressed') + ' · ' + variantLabel() +
      (warnings.length ? ' · ' + warnings.join(' · ') : '');
    $('jim-note').textContent = text;
    $('jim-count').textContent = doc.tiles.length + ' / 2048';
    $('jim-count').classList.toggle('error', doc.tiles.length > 2048);
    for (let p = 0; p < 4; p++) {
      const mark = $('jim-onmap-' + p);
      if (mark) mark.textContent = s.pals.indexOf(p) >= 0 ? 'yes' : '';
    }
  }
  function renderMeta() {
    const where = [];
    if (doc.palOff != null) where.push('pal $' + (doc.palOff >>> 0).toString(16).toUpperCase());
    if (doc.mapOff != null) where.push('map $' + (doc.mapOff >>> 0).toString(16).toUpperCase());
    $('jim-variant').textContent = variantLabel();
    $('jim-file-meta').textContent = doc.name + ' · ' + doc.mapW + '×' + doc.mapH + ' cells · ' +
      (doc.packedOnDisk ? 'packed on disk' : 'raw on disk') + ' · ' + doc.via +
      (where.length ? ' · ' + where.join(' · ') : '');
    $('jim-header-mode').textContent = headerMode();
    if (!focused('jim-map-w')) $('jim-map-w').value = String(doc.mapW);
    if (!focused('jim-map-h')) $('jim-map-h').value = String(doc.mapH);
    if (document.activeElement !== $('jim-embed')) $('jim-embed').checked = !!doc.embedPalettes;
    $('jim-portrait').hidden = doc.variant !== 'portrait';
  }

  function drawZoom() {
    let z = state.zoom;
    while (z > 1 && (doc.mapW * 8 * z > 4096 || doc.mapH * 8 * z > 4096)) z--;
    return z;
  }
  function samplePreview(cell, px, py) {
    const shown = previewCell(cell);
    let nib = nibbleAt(shown, px, py);
    const remap = readRemap();
    if (remap && nib < remap.length) nib = remap[nib] & 15;
    return { pal: shown.pal, nib: nib, priority: shown.priority };
  }
  function previewCell(cell) {
    const mask = printaMask();
    if (!mask) return cell;
    return unpackWord(packWord(cell) ^ mask);
  }
  function printaMask() {
    if (!$('jim-printa-on').checked) return 0;
    const v = parseInt($('jim-printa').value, 16);
    if (!Number.isFinite(v)) return 0;
    return v & 0xF800;
  }
  function readRemap() {
    if (!$('jim-remap-on').checked) return null;
    const inputs = $('jim-remap').querySelectorAll('input');
    const table = [];
    for (let i = 0; i < 16; i++) table.push(i);
    inputs.forEach((input, i) => {
      const t = input.value.trim();
      if (!t) return;
      const v = parseInt(t, 16);
      if (!Number.isFinite(v)) return;
      if (t.length <= 1) table[i * 2] = v & 15;
      else { table[i * 2] = (v >> 4) & 15; table[i * 2 + 1] = v & 15; }
    });
    return table;
  }

  function paintPixel(data, w, x, y, r, g, b, a) {
    const at = (y * w + x) * 4;
    data[at] = r; data[at + 1] = g; data[at + 2] = b; data[at + 3] = a;
  }
  function renderMap() {
    const z = drawZoom();
    const W = doc.mapW * 8;
    const H = doc.mapH * 8;
    if (!state.scratch || state.scratch.width !== W || state.scratch.height !== H) {
      state.scratch = document.createElement('canvas');
      state.scratch.width = W;
      state.scratch.height = H;
    }
    const sctx = state.scratch.getContext('2d');
    const img = sctx.createImageData(W, H);
    const data = img.data;
    const showHoles = $('jim-trans').checked;
    for (let ty = 0; ty < doc.mapH; ty++) {
      for (let tx = 0; tx < doc.mapW; tx++) {
        const cell = doc.cells[ty * doc.mapW + tx];
        for (let py = 0; py < 8; py++) {
          for (let px = 0; px < 8; px++) {
            const x = tx * 8 + px;
            const y = ty * 8 + py;
            const sample = samplePreview(cell, x, y);
            if (showHoles && hiddenPixel(sample.pal, sample.nib)) {
              const v = ((x >> 3) ^ (y >> 3)) & 1 ? 86 : 138;
              paintPixel(data, W, x, y, v, v, v, 255);
            } else {
              const col = doc.palettes[sample.pal][sample.nib];
              paintPixel(data, W, x, y, expandChannel(col.r3), expandChannel(col.g3), expandChannel(col.b3), 255);
            }
          }
        }
      }
    }
    if (state.float) blitFloat(data, W, H);
    sctx.putImageData(img, 0, 0);
    const canvas = $('jim-map');
    canvas.width = W * z;
    canvas.height = H * z;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.scratch, 0, 0, canvas.width, canvas.height);
    if ($('jim-grid').checked) {
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.beginPath();
      for (let x = 0; x <= doc.mapW; x++) { ctx.moveTo(x * 8 * z + 0.5, 0); ctx.lineTo(x * 8 * z + 0.5, canvas.height); }
      for (let y = 0; y <= doc.mapH; y++) { ctx.moveTo(0, y * 8 * z + 0.5); ctx.lineTo(canvas.width, y * 8 * z + 0.5); }
      ctx.stroke();
    }
    if ($('jim-seam').checked) {
      ctx.strokeStyle = 'rgba(255, 70, 70, 0.9)';
      ctx.beginPath();
      for (let ty = 0; ty < doc.mapH; ty++) {
        for (let tx = 0; tx < doc.mapW; tx++) {
          const pal = previewCell(doc.cells[ty * doc.mapW + tx]).pal;
          if (tx + 1 < doc.mapW && previewCell(doc.cells[ty * doc.mapW + tx + 1]).pal !== pal) {
            const x = (tx + 1) * 8 * z + 0.5;
            ctx.moveTo(x, ty * 8 * z); ctx.lineTo(x, (ty + 1) * 8 * z);
          }
          if (ty + 1 < doc.mapH && previewCell(doc.cells[(ty + 1) * doc.mapW + tx]).pal !== pal) {
            const y = (ty + 1) * 8 * z + 0.5;
            ctx.moveTo(tx * 8 * z, y); ctx.lineTo((tx + 1) * 8 * z, y);
          }
        }
      }
      ctx.stroke();
    }
    if ($('jim-show-users').checked) {
      ctx.strokeStyle = 'rgba(240, 180, 41, 0.95)';
      ctx.beginPath();
      doc.cells.forEach((c, i) => {
        if (c.tile !== state.tile) return;
        const x = (i % doc.mapW) * 8 * z;
        const y = Math.floor(i / doc.mapW) * 8 * z;
        ctx.rect(x + 1.5, y + 1.5, 8 * z - 3, 8 * z - 3);
      });
      ctx.stroke();
    }
    if (state.sel) {
      ctx.strokeStyle = '#f0b429';
      ctx.lineWidth = 2;
      ctx.strokeRect(state.sel.x * 8 * z + 1, state.sel.y * 8 * z + 1, state.sel.w * 8 * z - 2, state.sel.h * 8 * z - 2);
      ctx.lineWidth = 1;
    }
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(state.focus.x * 8 * z + 0.5, state.focus.y * 8 * z + 0.5, 8 * z - 1, 8 * z - 1);
    const cursors = { paint: 'crosshair', place: 'copy', erase: 'cell', select: 'crosshair', pick: 'crosshair', pan: 'grab' };
    canvas.style.cursor = state.float && state.tool !== 'pan' ? 'move' : (cursors[state.tool] || 'crosshair');
    const label = state.zoom + '×';
    $('jim-zoom-val').textContent = z === state.zoom ? label : label + ' (drawn ' + z + '×)';
  }
  function blitFloat(data, W, H) {
    const f = state.float;
    const showHoles = $('jim-trans').checked;
    for (let ty = 0; ty < f.h; ty++) {
      for (let tx = 0; tx < f.w; tx++) {
        const cell = f.cells[ty * f.w + tx];
        if (!cell) continue;
        const mx = f.x + tx;
        const my = f.y + ty;
        if (mx < 0 || my < 0 || mx >= doc.mapW || my >= doc.mapH) continue;
        for (let py = 0; py < 8; py++) {
          for (let px = 0; px < 8; px++) {
            const nib = cell.nibbles[py * 8 + px] & 15;
            const x = mx * 8 + px;
            const y = my * 8 + py;
            if (showHoles && hiddenPixel(cell.pal, nib)) continue;
            const col = (f.palettes || doc.palettes)[cell.pal][nib];
            paintPixel(data, W, x, y, expandChannel(col.r3), expandChannel(col.g3), expandChannel(col.b3), 255);
          }
        }
      }
    }
  }

  function renderSwatches() {
    for (let p = 0; p < 4; p++) {
      for (let i = 0; i < 16; i++) {
        const btn = $('jim-sw-' + p + '-' + i);
        if (!btn) continue;
        const c = doc.palettes[p][i];
        btn.style.backgroundColor = rgbOf(c);
        const hole = hiddenPixel(p, i);
        btn.style.backgroundImage = hole ? 'repeating-conic-gradient(#555 0 25%, transparent 0 50%)' : 'none';
        btn.style.backgroundSize = hole ? '8px 8px' : '';
        btn.setAttribute('aria-selected', state.color.pal === p && state.color.index === i ? 'true' : 'false');
        btn.title = 'Pal ' + p + ' index ' + i + ' ' + hexOf(c) + (hole ? ' (hole)' : '');
      }
    }
    const c = doc.palettes[state.color.pal][state.color.index];
    const locked = $('jim-lock-' + state.color.pal).checked || doc.readOnly;
    $('jim-color-line').textContent = 'Pal ' + state.color.pal + ' index ' + state.color.index + '  ' + hexOf(c) +
      '  CRAM ' + cramHex(c) + (locked ? '  (locked)' : '');
    if (!focused('jim-r') && !focused('jim-rn')) { $('jim-r').value = String(c.r3); $('jim-rn').value = String(c.r3); }
    if (!focused('jim-g') && !focused('jim-gn')) { $('jim-g').value = String(c.g3); $('jim-gn').value = String(c.g3); }
    if (!focused('jim-b') && !focused('jim-bn')) { $('jim-b').value = String(c.b3); $('jim-bn').value = String(c.b3); }
    ['jim-r', 'jim-g', 'jim-b', 'jim-rn', 'jim-gn', 'jim-bn'].forEach((id) => { $(id).disabled = locked; });
  }
  function cramHex(c) {
    const word = ((c.b3 & 7) << 9) | ((c.g3 & 7) << 5) | ((c.r3 & 7) << 1);
    return '$' + word.toString(16).toUpperCase().padStart(4, '0');
  }
  function thumb(tile, pal, size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    const z = size / 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const nib = tile[y * 8 + x] & 15;
        let r, g, b;
        if ($('jim-trans').checked && hiddenPixel(pal, nib)) {
          const v = ((x >> 2) ^ (y >> 2)) & 1 ? 80 : 120;
          r = g = b = v;
        } else {
          const col = doc.palettes[pal][nib];
          r = expandChannel(col.r3); g = expandChannel(col.g3); b = expandChannel(col.b3);
        }
        for (let py = 0; py < z; py++) for (let px = 0; px < z; px++) {
          paintPixel(img.data, size, x * z + px, y * z + py, r, g, b, 255);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
  function palForTile(index) {
    for (let i = 0; i < doc.cells.length; i++) if (doc.cells[i].tile === index) return doc.cells[i].pal;
    return 0;
  }
  function renderTiles() {
    const host = $('jim-tiles');
    host.innerHTML = '';
    const size = doc.tiles.length > 400 ? 16 : 24;
    doc.tiles.forEach((tile, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ice-tile';
      btn.title = 'Tile ' + i;
      btn.setAttribute('aria-selected', i === state.tile ? 'true' : 'false');
      btn.appendChild(thumb(tile, palForTile(i), size));
      btn.addEventListener('click', () => {
        state.tile = i;
        state.tool = 'place';
        document.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === 'place')));
        renderTiles();
        renderTileEdit();
        renderMap();
      });
      host.appendChild(btn);
    });
    renderTileEdit();
  }
  function renderTileEdit() {
    const canvas = $('jim-tile-edit');
    const tile = doc.tiles[state.tile];
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, 128, 128);
    if (!tile) return;
    const pal = palForTile(state.tile);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const nib = tile[y * 8 + x] & 15;
        if ($('jim-trans').checked && hiddenPixel(pal, nib)) {
          ctx.fillStyle = ((x ^ y) & 1) ? '#555' : '#888';
        } else ctx.fillStyle = rgbOf(doc.palettes[pal][nib]);
        ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    }
  }
  function renderInspector() {
    const cell = doc.cells[state.focus.y * doc.mapW + state.focus.x];
    $('jim-cellpos').textContent = state.focus.x + ', ' + state.focus.y;
    if (!focused('jim-tile')) $('jim-tile').value = String(cell.tile);
    if (document.activeElement !== $('jim-pal')) $('jim-pal').value = String(cell.pal);
    if (document.activeElement !== $('jim-h')) $('jim-h').checked = !!cell.hFlip;
    if (document.activeElement !== $('jim-v')) $('jim-v').checked = !!cell.vFlip;
    if (document.activeElement !== $('jim-pri')) $('jim-pri').checked = !!cell.priority;
    const word = packWord(cell);
    const bad = cell.tile >= doc.tiles.length || cell.tile > 2047;
    $('jim-word').textContent = 'Word $' + word.toString(16).toUpperCase().padStart(4, '0') +
      (bad ? '  (tile is outside the set)' : '');
    $('jim-word').classList.toggle('error', bad);
    const mask = printaMask();
    $('jim-preview-word').textContent = mask
      ? 'Preview word $' + (packWord(previewCell(cell))).toString(16).toUpperCase().padStart(4, '0') + ' (printa, not saved)'
      : '';
    const info = state.sel
      ? 'Selection ' + state.sel.w + '×' + state.sel.h + ' at ' + state.sel.x + ', ' + state.sel.y
      : (state.clip ? 'Clipboard ' + state.clip.w + '×' + state.clip.h : '');
    $('jim-sel-info').textContent = info;
  }
  function renderChrome() {
    const ro = !!doc.readOnly;
    document.querySelectorAll('.jim-edit').forEach((el) => { el.disabled = ro; });
    $('jim-undo').disabled = ro || !state.undo.length;
    $('jim-redo').disabled = ro || !state.redo.length;
    $('jim-paste').disabled = ro || !state.clip;
    document.querySelectorAll('.jim-needsel').forEach((el) => { el.disabled = ro || !state.sel; });
    $('jim-float-bar').hidden = !state.float;
    if (state.float) {
      const extra = state.float.pending ? ' · quantize pending' : '';
      $('jim-float-name').textContent = state.float.name + ' (' + state.float.w + '×' + state.float.h + ') at ' +
        state.float.x + ', ' + state.float.y + extra;
    }
    $('jim-q-warn').textContent = state.float && state.float.warnings && state.float.warnings.length
      ? state.float.warnings.join(' ')
      : '';
  }
  function renderBatch() {
    const ul = $('jim-batch');
    ul.innerHTML = '';
    state.batch.forEach((item, index) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = item.name + ' ' + item.w + '×' + item.h;
      li.appendChild(name);
      for (let p = 0; p < 4; p++) {
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = item.pals.indexOf(p) >= 0;
        box.addEventListener('change', () => {
          item.pals = [];
          li.querySelectorAll('input[data-pal]').forEach((el) => { if (el.checked) item.pals.push(Number(el.dataset.pal)); });
        });
        box.dataset.pal = String(p);
        label.appendChild(box);
        label.appendChild(document.createTextNode(' ' + p));
        li.appendChild(label);
      }
      const empty = document.createElement('label');
      const emptyBox = document.createElement('input');
      emptyBox.type = 'checkbox';
      emptyBox.checked = !!item.onlyEmpty;
      emptyBox.addEventListener('change', () => { item.onlyEmpty = emptyBox.checked; });
      empty.appendChild(emptyBox);
      empty.appendChild(document.createTextNode(' empty only'));
      li.appendChild(empty);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost-btn';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => { state.batch.splice(index, 1); renderBatch(); });
      li.appendChild(remove);
      ul.appendChild(li);
    });
  }
  function renderAll() {
    renderMeta();
    renderNote();
    renderSwatches();
    renderTiles();
    renderInspector();
    renderMap();
    renderChrome();
  }

  function cellAt(event) {
    const canvas = $('jim-map');
    const rect = canvas.getBoundingClientRect();
    const W = doc.mapW * 8;
    const H = doc.mapH * 8;
    if (rect.width < 1 || rect.height < 1) return null;
    const px = Math.floor((event.clientX - rect.left) * W / rect.width);
    const py = Math.floor((event.clientY - rect.top) * H / rect.height);
    if (px < 0 || py < 0 || px >= W || py >= H) return null;
    return { px: px, py: py, x: px >> 3, y: py >> 3 };
  }
  function writeNibble(cell, px, py, nib) {
    const tiles = doc.tiles;
    let next = cell;
    if (users(cell.tile) > 1) {
      tiles.push(Uint8Array.from(tiles[cell.tile]));
      next = cloneCell(cell);
      next.tile = tiles.length - 1;
      doc.dirtyTiles = true;
      doc.dirtyMap = true;
    }
    let x = px & 7;
    let y = py & 7;
    if (next.hFlip) x = 7 - x;
    if (next.vFlip) y = 7 - y;
    const tile = tiles[next.tile];
    if ((tile[y * 8 + x] & 15) !== (nib & 15)) {
      tile[y * 8 + x] = nib & 15;
      doc.dirtyTiles = true;
    }
    return next;
  }
  function paintAt(p) {
    const k = p.y * doc.mapW + p.x;
    let cell = doc.cells[k];
    if (!doc.tiles[cell.tile]) return;
    const nib = state.strokeNib & 15;
    if (nib === nibbleAt(cell, p.px, p.py) && (state.strokeForcePal == null || cell.pal === state.strokeForcePal)) {
      state.tile = cell.tile;
      return;
    }
    if (state.strokeForcePal != null && cell.pal !== state.strokeForcePal) {
      cell = cloneCell(cell);
      cell.pal = state.strokeForcePal;
      doc.dirtyMap = true;
    }
    cell = writeNibble(cell, p.px, p.py, nib);
    doc.cells[k] = cell;
    state.tile = cell.tile;
    state.focus = { x: p.x, y: p.y };
  }
  function placeAt(p) {
    if (!doc.tiles.length) return;
    if (state.tile >= doc.tiles.length) state.tile = 0;
    const prev = doc.cells[p.y * doc.mapW + p.x];
    doc.cells[p.y * doc.mapW + p.x] = {
      tile: state.tile, hFlip: 0, vFlip: 0, pal: state.color.pal & 3, priority: prev ? prev.priority : 0
    };
    doc.dirtyMap = true;
    state.focus = { x: p.x, y: p.y };
  }
  function eraseAt(p) {
    doc.cells[p.y * doc.mapW + p.x] = zeroCell();
    doc.dirtyMap = true;
    state.focus = { x: p.x, y: p.y };
  }
  function grab(rect) {
    const cells = [];
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) cells.push(cloneCell(doc.cells[(rect.y + y) * doc.mapW + (rect.x + x)]));
    }
    return { w: rect.w, h: rect.h, cells: cells };
  }
  function clearRect(rect) {
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        const X = rect.x + x;
        const Y = rect.y + y;
        if (X >= 0 && Y >= 0 && X < doc.mapW && Y < doc.mapH) doc.cells[Y * doc.mapW + X] = zeroCell();
      }
    }
    doc.dirtyMap = true;
  }
  function stamp(block, x, y, onlyEmpty) {
    for (let j = 0; j < block.h; j++) {
      for (let i = 0; i < block.w; i++) {
        const cell = block.cells[j * block.w + i];
        if (!cell) continue;
        const X = x + i;
        const Y = y + j;
        if (X < 0 || Y < 0 || X >= doc.mapW || Y >= doc.mapH) continue;
        if (onlyEmpty && !isZero(doc.cells[Y * doc.mapW + X])) continue;
        doc.cells[Y * doc.mapW + X] = cloneCell(cell);
      }
    }
    doc.dirtyMap = true;
  }
  function localTransform(block, op) {
    if (op === 'h' || op === 'v' || op === '180') {
      const out = { w: block.w, h: block.h, cells: new Array(block.w * block.h) };
      const fh = op !== 'v';
      const fv = op !== 'h';
      for (let y = 0; y < block.h; y++) {
        for (let x = 0; x < block.w; x++) {
          const cell = cloneCell(block.cells[y * block.w + x]);
          if (fh) cell.hFlip ^= 1;
          if (fv) cell.vFlip ^= 1;
          const nx = fh ? block.w - 1 - x : x;
          const ny = fv ? block.h - 1 - y : y;
          out.cells[ny * block.w + nx] = cell;
        }
      }
      return out;
    }
    const cw = op === '90';
    const out = { w: block.h, h: block.w, cells: new Array(block.h * block.w) };
    const known = new Map();
    function adopt(nibbles) {
      const key = keyOf(nibbles);
      if (known.has(key)) return known.get(key);
      for (let i = 0; i < doc.tiles.length; i++) {
        if (keyOf(doc.tiles[i]) === key) { known.set(key, i); return i; }
      }
      doc.tiles.push(Uint8Array.from(nibbles));
      const id = doc.tiles.length - 1;
      known.set(key, id);
      doc.dirtyTiles = true;
      return id;
    }
    for (let y = 0; y < block.h; y++) {
      for (let x = 0; x < block.w; x++) {
        const cell = block.cells[y * block.w + x];
        const base = doc.tiles[cell.tile] || new Uint8Array(64);
        const turned = rot90(flipNibbles(base, cell.hFlip, cell.vFlip), cw);
        const id = adopt(turned);
        const nx = cw ? block.h - 1 - y : y;
        const ny = cw ? x : block.w - 1 - x;
        out.cells[ny * out.w + nx] = { tile: id, hFlip: 0, vFlip: 0, pal: cell.pal, priority: cell.priority };
      }
    }
    return out;
  }
  function runTransform(block, op) {
    if (Jim && typeof Jim.transformBlock === 'function') {
      const before = doc.tiles.length;
      const result = Jim.transformBlock(doc, {
        w: block.w,
        h: block.h,
        cells: block.cells.map((c) => (c ? cloneCell(c) : null))
      }, op);
      if (!result || !result.cells || !result.w || !result.h) {
        throw new Error('transformBlock did not return a block');
      }
      if (doc.tiles.length !== before) doc.dirtyTiles = true;
      return {
        w: result.w | 0,
        h: result.h | 0,
        cells: Array.from(result.cells, (c) => (c ? cellOf(c) : null))
      };
    }
    return localTransform(block, op);
  }
  function blockOp(op) {
    if (!canEdit() || !state.sel) return;
remember();
  const before = doc.tiles.length;
  const block = grab(state.sel);
  clearRect(state.sel);
  let next;
  try {
    next = runTransform(block, op);
  } catch (err) {
    restore(state.undo.pop());
    status(err.message || String(err), true);
    renderAll();
    return;
  }
    let x = state.sel.x;
    let y = state.sel.y;
    if (x + next.w > doc.mapW) x = Math.max(0, doc.mapW - next.w);
    if (y + next.h > doc.mapH) y = Math.max(0, doc.mapH - next.h);
    stamp({ w: next.w, h: next.h, cells: next.cells }, x, y, false);
    state.sel = { x: x, y: y, w: Math.min(next.w, doc.mapW - x), h: Math.min(next.h, doc.mapH - y) };
    const added = doc.tiles.length - before;
    if (op === '90' || op === '270') {
      status('Rotated ' + op + '°. The VDP name table has no rotate bit, so the pixels were baked into ' +
        (added ? added + ' new tile' + (added === 1 ? '' : 's') : 'tiles already in the set') + '.');
    } else if (op === 'h') status('Mirrored the block (H-flip bit XORed, cells reordered, tile pixels unchanged).');
    else if (op === 'v') status('Flipped the block (V-flip bit XORed, cells reordered, tile pixels unchanged).');
    else status('Rotated 180° (both flip bits XORed, cells reordered, no new tiles).');
    renderAll();
  }

  function copySel(cut) {
    if (!state.sel || (cut && !canEdit())) return;
    const s = state.sel;
    const cells = [];
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const c = doc.cells[(s.y + y) * doc.mapW + (s.x + x)];
        const tile = doc.tiles[c.tile] || new Uint8Array(64);
        cells.push({ hFlip: c.hFlip, vFlip: c.vFlip, pal: c.pal, priority: c.priority, nibbles: Uint8Array.from(tile) });
      }
    }
    state.clip = { w: s.w, h: s.h, cells: cells };
    if (cut) {
      remember();
      clearRect(s);
    }
    status((cut ? 'Cut ' : 'Copied ') + s.w + '×' + s.h + ' cells.');
    renderAll();
  }
  function adoptExact(tiles, nibbles) {
    const key = keyOf(nibbles);
    for (let i = 0; i < tiles.length; i++) if (keyOf(tiles[i]) === key) return i;
    tiles.push(Uint8Array.from(nibbles));
    doc.dirtyTiles = true;
    return tiles.length - 1;
  }
  function paste() {
    if (!canEdit() || !state.clip) return;
    remember();
    const x = state.sel ? state.sel.x : 0;
    const y = state.sel ? state.sel.y : 0;
    const block = { w: state.clip.w, h: state.clip.h, cells: [] };
    state.clip.cells.forEach((c) => {
      block.cells.push({ tile: adoptExact(doc.tiles, c.nibbles), hFlip: c.hFlip, vFlip: c.vFlip, pal: c.pal, priority: c.priority });
    });
    stamp(block, x, y, false);
    state.sel = {
      x: x, y: y,
      w: Math.min(state.clip.w, doc.mapW - x),
      h: Math.min(state.clip.h, doc.mapH - y)
    };
    state.tool = 'select';
    document.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === 'select')));
    status('Pasted ' + state.clip.w + '×' + state.clip.h + ' at ' + x + ', ' + y + '.');
    renderAll();
  }
  function clearSel() {
    if (!canEdit() || !state.sel) return;
    remember();
    clearRect(state.sel);
    status('Cleared the selection to zero words.');
    renderAll();
  }

  function onDown(event) {
    if (!doc) return;
    const p = cellAt(event);
    if (!p) return;
    if (state.float && state.tool !== 'pan' && event.button === 0) {
      state.drag = { float: true, x: p.x, y: p.y };
      $('jim-map').setPointerCapture(event.pointerId);
      state.down = true;
      return;
    }
    if (state.tool === 'pan' || event.button === 1) {
      const sc = $('jim-scroll');
      state.drag = { pan: true, x: event.clientX, y: event.clientY, l: sc.scrollLeft, t: sc.scrollTop };
      $('jim-map').setPointerCapture(event.pointerId);
      state.down = true;
      event.preventDefault();
      return;
    }
    if (doc.readOnly) {
      state.focus = { x: p.x, y: p.y };
      if (state.tool === 'pick') pickAt(p);
      renderInspector();
      renderMap();
      return;
    }
    state.focus = { x: p.x, y: p.y };
    if (state.tool === 'pick') { pickAt(p); renderSwatches(); renderInspector(); return; }
    if (state.tool === 'select') {
      const s = state.sel;
      if (s && p.x >= s.x && p.y >= s.y && p.x < s.x + s.w && p.y < s.y + s.h) {
        state.drag = { block: grab(s), sx: s.x, sy: s.y, x: p.x, y: p.y, moved: false };
      } else {
        state.sel = { x: p.x, y: p.y, w: 1, h: 1 };
        state.drag = { from: p };
      }
      $('jim-map').setPointerCapture(event.pointerId);
      state.down = true;
      renderMap();
      renderInspector();
      renderChrome();
      return;
    }
    remember();
    state.strokeNib = event.button === 2 ? 0 : state.color.index;
    state.strokeForcePal = event.button === 2 ? null : state.color.pal;
    if (state.tool === 'paint') paintAt(p);
    else if (state.tool === 'place') placeAt(p);
    else if (state.tool === 'erase') eraseAt(p);
    $('jim-map').setPointerCapture(event.pointerId);
    state.down = true;
    renderMap();
    renderInspector();
    renderTileEdit();
    renderNote();
  }
  function onMove(event) {
    if (!state.down || !state.drag && state.tool !== 'paint' && state.tool !== 'place' && state.tool !== 'erase') return;
    const p = cellAt(event);
    if (!p) return;
    if (state.drag && state.drag.pan) {
      const sc = $('jim-scroll');
      sc.scrollLeft = state.drag.l - (event.clientX - state.drag.x);
      sc.scrollTop = state.drag.t - (event.clientY - state.drag.y);
      return;
    }
    if (state.drag && state.drag.float) {
      if (p.x === state.drag.x && p.y === state.drag.y) return;
      state.float.x += p.x - state.drag.x;
      state.float.y += p.y - state.drag.y;
      state.drag.x = p.x;
      state.drag.y = p.y;
      renderMap();
      renderChrome();
      return;
    }
    if (state.tool === 'paint') { paintAt(p); renderMap(); renderTileEdit(); return; }
    if (state.tool === 'place') { placeAt(p); renderMap(); renderInspector(); return; }
    if (state.tool === 'erase') { eraseAt(p); renderMap(); return; }
    if (state.tool === 'select' && state.drag && state.drag.from) {
      const a = state.drag.from;
      state.sel = {
        x: Math.min(a.x, p.x), y: Math.min(a.y, p.y),
        w: Math.abs(a.x - p.x) + 1, h: Math.abs(a.y - p.y) + 1
      };
      renderMap();
      renderInspector();
      return;
    }
    if (state.tool === 'select' && state.drag && state.drag.block) {
      const d = state.drag;
      if (!d.moved) {
        remember();
        clearRect({ x: d.sx, y: d.sy, w: d.block.w, h: d.block.h });
        d.under = doc.cells.map(cloneCell);
        stamp(d.block, d.sx, d.sy, false);
        d.moved = true;
      }
      const nx = Math.max(0, Math.min(doc.mapW - d.block.w, d.sx + p.x - d.x));
      const ny = Math.max(0, Math.min(doc.mapH - d.block.h, d.sy + p.y - d.y));
      if (nx === state.sel.x && ny === state.sel.y) return;
      doc.cells = d.under.map(cloneCell);
      stamp(d.block, nx, ny, false);
      state.sel = { x: nx, y: ny, w: d.block.w, h: d.block.h };
      renderMap();
      renderInspector();
    }
  }
  function onUp() {
    if (!state.down) return;
    state.down = false;
    if (state.drag && state.drag.block && state.drag.moved && state.sel && state.sel.x === state.drag.sx && state.sel.y === state.drag.sy) {
      state.undo.pop();
    }
    state.drag = null;
    renderAll();
  }
  function pickAt(p) {
    const cell = doc.cells[p.y * doc.mapW + p.x];
    state.color = { pal: cell.pal, index: nibbleAt(cell, p.px, p.py) };
    state.focus = { x: p.x, y: p.y };
    status('Picked palette ' + state.color.pal + ' index ' + state.color.index + '.');
  }

  function editTileAt(event) {
    if (!canEdit()) return;
    const canvas = $('jim-tile-edit');
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) * 8 / rect.width);
    const y = Math.floor((event.clientY - rect.top) * 8 / rect.height);
    if (x < 0 || y < 0 || x > 7 || y > 7) return;
    const tile = doc.tiles[state.tile];
    if (!tile) return;
    const nib = event.button === 2 || event.altKey ? 0 : (state.color.index & 15);
    if ((tile[y * 8 + x] & 15) === nib) return;
    if (!state.tileStroke) { remember(); state.tileStroke = true; }
    tile[y * 8 + x] = nib;
    doc.dirtyTiles = true;
    renderTileEdit();
    renderMap();
    renderNote();
  }

  function setChannel(ch, value) {
    const p = state.color.pal;
    const i = state.color.index;
    if ($('jim-lock-' + p).checked || doc.readOnly) return;
    const v = Math.max(0, Math.min(7, value | 0));
    if ((doc.palettes[p][i][ch] & 7) === v) return;
    if (!state.colorStroke) { remember(); state.colorStroke = true; }
    doc.palettes[p][i][ch] = v;
    doc.dirtyPal = true;
    renderSwatches();
    renderMap();
    renderTileEdit();
    renderNote();
  }
  function applyInspector() {
    if (!canEdit()) return;
    const k = state.focus.y * doc.mapW + state.focus.x;
    const prev = doc.cells[k];
    let tile = parseInt($('jim-tile').value, 10);
    if (!Number.isFinite(tile)) tile = prev.tile;
    tile = Math.max(0, Math.min(2047, tile));
    const next = {
      tile: tile,
      pal: parseInt($('jim-pal').value, 10) & 3,
      hFlip: $('jim-h').checked ? 1 : 0,
      vFlip: $('jim-v').checked ? 1 : 0,
      priority: $('jim-pri').checked ? 1 : 0
    };
    if (prev.tile === next.tile && prev.pal === next.pal && prev.hFlip === next.hFlip && prev.vFlip === next.vFlip && prev.priority === next.priority) return;
    remember();
    doc.cells[k] = next;
    doc.dirtyMap = true;
    state.tile = next.tile < doc.tiles.length ? next.tile : state.tile;
    renderAll();
  }

  function resizeMap() {
    if (!canEdit()) return;
    let w = parseInt($('jim-map-w').value, 10);
    let h = parseInt($('jim-map-h').value, 10);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > 1024 || h > 1024) {
      status('Map width and height must be from 1 to 1024.', true);
      renderMeta();
      return;
    }
    if (w === doc.mapW && h === doc.mapH) { status('Map is already ' + w + '×' + h + '.'); return; }
    const drop = w < doc.mapW || h < doc.mapH;
    const msg = 'Change the map from ' + doc.mapW + '×' + doc.mapH + ' to ' + w + '×' + h + '?' +
      (drop ? ' Cells outside the new size are dropped.' : ' New cells are zero words.');
    if (!window.confirm(msg)) { renderMeta(); return; }
    remember();
    const next = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        next.push(x < doc.mapW && y < doc.mapH ? cloneCell(doc.cells[y * doc.mapW + x]) : zeroCell());
      }
    }
    doc.cells = next;
    doc.mapW = w;
    doc.mapH = h;
    doc.dirtyMap = true;
    if (state.focus.x >= w) state.focus.x = w - 1;
    if (state.focus.y >= h) state.focus.y = h - 1;
    state.sel = null;
    status('Map is now ' + w + '×' + h + '.');
    renderAll();
  }

  function quantizeOpts(pals) {
    const locked = [0, 1, 2, 3].map((p) => $('jim-lock-' + p).checked);
    return {
      order: $('jim-q-order').value,
      stepA: { method: $('jim-a-method').value, dither: $('jim-a-dither').value, strength: Number($('jim-a-strength').value) },
      stepB: { method: $('jim-b-method').value, dither: $('jim-b-dither').value, strength: Number($('jim-b-strength').value) },
      pals: pals,
      lockedLines: locked,
      act: locked.some(Boolean) ? actFromDoc() : null,
      opaquePal0: $('jim-opaque0').checked,
      alphaThreshold: Number($('jim-alpha').value)
    };
  }
  function actFromDoc() {
    const out = new Uint8Array(768);
    for (let p = 0; p < 4; p++) {
      for (let i = 0; i < 16; i++) {
        const c = doc.palettes[p][i];
        const at = (p * 16 + i) * 3;
        out[at] = expandChannel(c.r3);
        out[at + 1] = expandChannel(c.g3);
        out[at + 2] = expandChannel(c.b3);
      }
    }
    return out;
  }
  function openPalList() {
    const pals = [];
    for (let p = 0; p < 4; p++) if ($('jim-use-' + p).checked) pals.push(p);
    return pals;
  }
  function padImage(image) {
    const W = Math.ceil(image.w / 8) * 8;
    const H = Math.ceil(image.h / 8) * 8;
    if (W === image.w && H === image.h) return { rgba: image.rgba, w: image.w, h: image.h };
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < image.h; y++) rgba.set(image.rgba.subarray(y * image.w * 4, (y + 1) * image.w * 4), y * W * 4);
    return { rgba: rgba, w: W, h: H };
  }
  function tileOpaque(rgba, w, h, tx, ty, alpha) {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const px = tx * 8 + x;
        const py = ty * 8 + y;
        if (px >= w || py >= h) continue;
        if (rgba[(py * w + px) * 4 + 3] >= alpha) return true;
      }
    }
    return false;
  }
  function snapStub(padded, alpha) {
    const found = [];
    const keys = new Map();
    let overflow = false;
    function slot(r, g, b) {
      const key = (r << 6) | (g << 3) | b;
      if (keys.has(key)) return keys.get(key);
      if (found.length < 15) {
        found.push({ r3: r, g3: g, b3: b });
        const idx = found.length;
        keys.set(key, idx);
        return idx;
      }
      overflow = true;
      let best = 1;
      let dist = 1e9;
      found.forEach((c, i) => {
        const d = (c.r3 - r) * (c.r3 - r) + (c.g3 - g) * (c.g3 - g) + (c.b3 - b) * (c.b3 - b);
        if (d < dist) { dist = d; best = i + 1; }
      });
      return best;
    }
    const tw = padded.w / 8;
    const th = padded.h / 8;
    const tiles = [];
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        const nibbles = new Uint8Array(64);
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const px = tx * 8 + x;
            const py = ty * 8 + y;
            const at = (py * padded.w + px) * 4;
            if (padded.rgba[at + 3] < alpha) continue;
            nibbles[y * 8 + x] = slot(encodeChannel(padded.rgba[at]), encodeChannel(padded.rgba[at + 1]), encodeChannel(padded.rgba[at + 2]));
          }
        }
        tiles.push({ x: tx, y: ty, pal: 0, nibbles: nibbles });
      }
    }
    const line = defaultLine(0);
    line[0] = { r3: 0, g3: 0, b3: 0 };
    found.forEach((c, i) => { line[i + 1] = c; });
    return {
      tiles: tiles,
      palettes: [line, defaultLine(1), defaultLine(2), defaultLine(3)],
      warnings: overflow ? ['More than 15 ink colors; extras were snapped to the nearest.'] : []
    };
  }
  function floatFrom(name, padded, tiles, palettes, warnings, pending, onlyEmpty) {
    const alpha = Number($('jim-alpha').value);
    const tw = padded.w / 8;
    const th = padded.h / 8;
    const cells = new Array(tw * th).fill(null);
    tiles.forEach((tile) => {
      if (!tileOpaque(padded.rgba, padded.w, padded.h, tile.x, tile.y, alpha)) return;
      cells[tile.y * tw + tile.x] = {
        nibbles: Uint8Array.from(tile.nibbles || tile.pixels || []),
        pal: (tile.pal | 0) & 3
      };
    });
    return {
      name: name,
      w: tw,
      h: th,
      x: Math.max(0, Math.floor((doc.mapW - tw) / 2)),
      y: Math.max(0, Math.floor((doc.mapH - th) / 2)),
      cells: cells,
      palettes: palettes,
      warnings: warnings || [],
      pending: !!pending,
      onlyEmpty: !!onlyEmpty
    };
  }
  function quantizeToFloat(image, pals, onlyEmpty) {
    const padded = padImage(image);
    const use = pals == null ? openPalList() : pals.slice();
    if (!use.length) throw new Error('Pick at least one palette line (Use) for ' + image.name + '.');
    if (Quant && typeof Quant.quantize === 'function') {
      const result = Quant.quantize(padded.rgba, padded.w, padded.h, quantizeOpts(use));
      const order = $('jim-q-order').value === 'countFirst' ? 'count, then 3-bit' : '3-bit, then count';
      const warnings = (result.warnings || []).slice();
      warnings.unshift('Preview is after both steps (' + order + ').');
      return floatFrom(image.name, padded, result.tiles, result.palettes, warnings, false, onlyEmpty);
    }
    const stub = snapStub(padded, Number($('jim-alpha').value));
    return floatFrom(image.name, padded, stub.tiles, stub.palettes, ['quantize pending'].concat(stub.warnings), true, onlyEmpty);
  }
  function mergeFloat(base, extra) {
    const w = Math.max(base.w, extra.w);
    const h = Math.max(base.h, extra.h);
    const cells = new Array(w * h).fill(null);
    function copy(src) {
      for (let y = 0; y < src.h; y++) {
        for (let x = 0; x < src.w; x++) {
          const cell = src.cells[y * src.w + x];
          if (!cell) continue;
          const at = y * w + x;
          if (src.onlyEmpty && cells[at]) continue;
          cells[at] = cell;
        }
      }
    }
    copy(base);
    copy(extra);
    return {
      name: extra.name, w: w, h: h, x: base.x, y: base.y, cells: cells,
      palettes: extra.palettes || base.palettes,
      warnings: base.warnings.concat(extra.warnings),
      pending: base.pending || extra.pending,
      onlyEmpty: $('jim-only-empty').checked
    };
  }
  function adoptFlip(tiles, nibbles) {
    const want = keyOf(nibbles);
    for (let i = 0; i < tiles.length; i++) {
      for (let v = 0; v < 2; v++) {
        for (let h = 0; h < 2; h++) {
          if (keyOf(flipNibbles(tiles[i], h, v)) === want) return { tile: i, hFlip: h, vFlip: v };
        }
      }
    }
    tiles.push(Uint8Array.from(nibbles));
    return { tile: tiles.length - 1, hFlip: 0, vFlip: 0 };
  }
  function applyFloat() {
    const f = state.float;
    if (!f || !canEdit()) return;
    const tiles = doc.tiles.map((t) => Uint8Array.from(t));
    const cells = doc.cells.map(cloneCell);
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const src = f.cells[y * f.w + x];
        if (!src) continue;
        const X = f.x + x;
        const Y = f.y + y;
        if (X < 0 || Y < 0 || X >= doc.mapW || Y >= doc.mapH) continue;
        if (f.onlyEmpty && !isZero(cells[Y * doc.mapW + X])) continue;
        const hit = adoptFlip(tiles, src.nibbles);
        cells[Y * doc.mapW + X] = { tile: hit.tile, hFlip: hit.hFlip, vFlip: hit.vFlip, pal: src.pal, priority: 0 };
      }
    }
    if (tiles.length > 2048) {
      status('That import needs ' + tiles.length + ' tiles. The name table holds 2048, so it was not applied.', true);
      return;
    }
    remember();
    doc.tiles = tiles;
    doc.cells = cells;
    doc.dirtyTiles = true;
    doc.dirtyMap = true;
    if (f.palettes) {
      const locked = [0, 1, 2, 3].map((p) => $('jim-lock-' + p).checked);
      for (let p = 0; p < 4; p++) {
        if (locked[p] || !f.palettes[p]) continue;
        for (let i = 0; i < 16; i++) {
          const c = f.palettes[p][i];
          if (!c) continue;
          doc.palettes[p][i] = { r3: c.r3 & 7, g3: c.g3 & 7, b3: c.b3 & 7 };
        }
      }
      doc.dirtyPal = true;
    }
    const name = f.name;
    state.float = null;
    state.tile = Math.min(state.tile, doc.tiles.length - 1);
    status('Applied ' + name + '. ' + doc.tiles.length + ' / 2048 tiles.');
    renderAll();
  }

  function readImage(file) {
    const url = URL.createObjectURL(file);
    return new Promise((ok, bad) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        URL.revokeObjectURL(url);
        ok({ name: file.name, w: canvas.width, h: canvas.height, rgba: new Uint8Array(data) });
      };
      img.onerror = () => { URL.revokeObjectURL(url); bad(new Error('Could not read ' + file.name + ' as an image')); };
      img.src = url;
    });
  }
  async function importOne(file) {
    if (!canEdit()) return;
    const image = await readImage(file);
    state.float = quantizeToFloat(image, openPalList(), $('jim-only-empty').checked);
    const pending = state.float.pending ? ' quantize pending.' : '';
    status('Floating ' + file.name + ' (' + image.w + '×' + image.h + '). Drag it, then Apply or Cancel.' + pending);
    renderAll();
  }
  function importAct(bytes) {
    if (!canEdit()) return;
    if (bytes.length !== 768 && bytes.length !== 772) throw new Error('ACT must be 768 or 772 bytes');
    let snapped = false;
    const lines = [];
    if (Quant && typeof Quant.parseAct === 'function') {
      const colors = Quant.parseAct(bytes);
      for (let p = 0; p < 4; p++) lines.push(colors.slice(p * 16, p * 16 + 16).map((c) => ({ r3: c.r3, g3: c.g3, b3: c.b3 })));
    } else {
      for (let p = 0; p < 4; p++) {
        const line = [];
        for (let i = 0; i < 16; i++) {
          const at = (p * 16 + i) * 3;
          const r3 = encodeChannel(bytes[at]);
          const g3 = encodeChannel(bytes[at + 1]);
          const b3 = encodeChannel(bytes[at + 2]);
          if (expandChannel(r3) !== bytes[at] || expandChannel(g3) !== bytes[at + 1] || expandChannel(b3) !== bytes[at + 2]) snapped = true;
          line.push({ r3: r3, g3: g3, b3: b3 });
        }
        lines.push(line);
      }
    }
    for (let p = 0; p < 4; p++) {
      for (let i = 0; i < 16; i++) {
        const c = lines[p][i];
        const at = (p * 16 + i) * 3;
        if (expandChannel(c.r3) !== bytes[at] || expandChannel(c.g3) !== bytes[at + 1] || expandChannel(c.b3) !== bytes[at + 2]) snapped = true;
      }
    }
    remember();
    doc.palettes = lines;
    doc.dirtyPal = true;
    const locks = [0, 1, 2, 3].filter((p) => $('jim-lock-' + p).checked);
    status('Loaded ACT colors 1–64 into palettes 0–3.' +
      (locks.length ? ' Locked lines: ' + locks.join(', ') + '.' : ' No line is locked yet.') +
      (snapped ? ' Some colors were snapped to 3-bit CRAM.' : ''));
    renderAll();
  }
  function applyDonor(bytes) {
    if (bytes.length !== 32 && bytes.length !== 128) throw new Error('Donor CRAM must be 32 or 128 bytes');
    if (doc.readOnly) {
      const line = readCram(bytes, bytes.length === 128 ? 32 : 0);
      doc.palettes = [0, 1, 2, 3].map(() => line.map((c) => ({ r3: c.r3, g3: c.g3, b3: c.b3 })));
      doc.dirtyPal = false;
      status('Donor colors are for display only. The portrait file is unchanged.');
      renderAll();
      return;
    }
    remember();
    const lines = bytes.length === 128
      ? [0, 1, 2, 3].map((p) => readCram(bytes, p * 32))
      : [0, 1, 2, 3].map(() => readCram(bytes, 0));
    for (let p = 0; p < 4; p++) {
      if ($('jim-lock-' + p).checked) continue;
      if (bytes.length === 32 && doc.variant === 'map' && p > 0) continue;
      doc.palettes[p] = lines[p];
    }
    doc.dirtyPal = true;
    status(bytes.length === 128 ? 'Donor CRAM replaced unlocked lines.' : 'Donor line applied.');
    renderAll();
  }

  function isDirty() {
    return !!(doc.dirtyTiles || doc.dirtyPal || doc.dirtyMap || (doc.source && doc.embedPalettes !== doc.originEmbed));
  }
  function loadDoc(next, note) {
    doc = next;
    state.undo = [];
    state.redo = [];
    state.sel = null;
    state.float = null;
    state.focus = { x: 0, y: 0 };
    state.tile = 0;
    for (let i = 0; i < doc.cells.length; i++) {
      if (doc.cells[i].tile) { state.tile = doc.cells[i].tile; break; }
    }
    if (state.tile >= doc.tiles.length) state.tile = 0;
    $('jim-packed').checked = false;
    status(note || ('Opened ' + doc.name + ' (' + variantLabel() + ', ' + doc.tiles.length + ' tiles).'));
    renderAll();
  }
  function openJimBytes(bytes, name) {
    if (isDirty() && !window.confirm('Discard unsaved map edits and open ' + name + '?')) return;
    const next = openBytes(bytes, name);
    if (typeof Jim.decodeJim === 'function') {
      try { Jim.decodeJim(bytes); } catch (err) { next.readerNote = (next.readerNote ? next.readerNote + ' ' : '') + err.message; }
    }
    loadDoc(next);
  }

  function download(bytes, name) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name || 'untitled.map.jim';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function doExport() {
    try {
      const packed = $('jim-packed').checked;
      const bytes = buildExport(packed);
      download(bytes, doc.name || 'untitled.map.jim');
      status('Exported ' + doc.name + ' (' + (packed ? 'packed' : 'uncompressed') + ', ' + bytes.length + ' bytes).');
    } catch (err) {
      status(err.message || String(err), true);
    }
    renderNote();
  }

  function fillSelect(id, values, selected) {
    const el = $(id);
    values.forEach((value) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      if (value === selected) opt.selected = true;
      el.appendChild(opt);
    });
  }
  function buildPaletteChrome() {
    const host = $('jim-swatches');
    for (let p = 0; p < 4; p++) {
      const row = document.createElement('div');
      row.className = 'jim-swatch-row';
      const name = document.createElement('span');
      name.textContent = 'Pal ' + p;
      const use = document.createElement('input');
      use.type = 'checkbox';
      use.id = 'jim-use-' + p;
      use.checked = true;
      use.title = 'Quantize may assign tiles to this line';
      const lock = document.createElement('input');
      lock.type = 'checkbox';
      lock.id = 'jim-lock-' + p;
      lock.title = 'Quantize will not rewrite this line. ACT colors 1–16 are pal 0, 17–32 pal 1, and so on.';
      lock.addEventListener('change', renderSwatches);
      const onMap = document.createElement('span');
      onMap.id = 'jim-onmap-' + p;
      const sw = document.createElement('div');
      sw.className = 'ice-swatches';
      for (let i = 0; i < 16; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ice-sw';
        btn.id = 'jim-sw-' + p + '-' + i;
        btn.addEventListener('click', () => {
          state.color = { pal: p, index: i };
          renderSwatches();
        });
        sw.appendChild(btn);
      }
      row.appendChild(name);
      row.appendChild(use);
      row.appendChild(lock);
      row.appendChild(onMap);
      row.appendChild(sw);
      host.appendChild(row);
    }
  }
  function isImageName(name) { return /\.(png|bmp|gif|jpe?g)$/i.test(name); }

  async function ingestList(files) {
    const list = Array.from(files || []);
    const images = [];
    for (const file of list) {
      const lower = file.name.toLowerCase();
      if (isImageName(lower) || (file.type && file.type.indexOf('image/') === 0)) { images.push(file); continue; }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (/\.act$/i.test(lower)) { importAct(bytes); continue; }
      try { openJimBytes(bytes, file.name); }
      catch (err) {
        if ((bytes.length === 32 || bytes.length === 128) && /\.(pal|bin)$/i.test(lower)) applyDonor(bytes);
        else status(err.message || String(err), true);
      }
    }
    for (const file of images) {
      const image = await readImage(file);
      state.batch.push({ name: image.name, w: image.w, h: image.h, rgba: image.rgba, pals: openPalList(), onlyEmpty: $('jim-only-empty').checked });
    }
    if (images.length === 1 && list.length === 1) await importOne(images[0]);
    else if (images.length) {
      renderBatch();
      status(images.length + ' image' + (images.length === 1 ? '' : 's') + ' added to the batch. Preview batch to float them together.');
    }
    renderBatch();
  }

  function setRemapPreview(remap) {
    if (!remap || !remap.length) return;
    $('jim-remap-on').checked = true;
    const full = [];
    for (let i = 0; i < 16; i++) full.push(i < remap.length ? remap[i] & 15 : i);
    $('jim-remap').querySelectorAll('input').forEach((inp, i) => {
      inp.value = ((full[i * 2] << 4) | full[i * 2 + 1]).toString(16).toUpperCase().padStart(2, '0');
    });
  }

  function fromSession() {
    try {
      const raw = sessionStorage.getItem('nhl9x-jim');
      if (!raw) return false;
      const data = JSON.parse(raw);
      sessionStorage.removeItem('nhl9x-jim');
      const bytes = Uint8Array.from(data.bytes || []);
      if (!bytes.length) return false;
      const donor = data.donor && data.donor.length ? Uint8Array.from(data.donor) : null;
      loadDoc(openBytes(bytes, data.name || 'catalog.map.jim', donor));
      setRemapPreview(data.remap);
      return true;
    } catch (err) {
      return false;
    }
  }

  function hashNote() {
    const q = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (!q.get('image')) return;
    const game = q.get('game');
    $('jim-hash').hidden = false;
    $('jim-hash').textContent = 'ROM load is later (' + (game || 'game') + ' / ' + q.get('image') +
      '). Open the .map.jim directly until the Images tab can hand the picture over.';
  }

  function wire() {
    document.querySelectorAll('[data-tool]').forEach((btn) => btn.addEventListener('click', () => {
      if (doc.readOnly && btn.classList.contains('jim-edit')) return;
      state.tool = btn.dataset.tool;
      document.querySelectorAll('[data-tool]').forEach((el) => el.setAttribute('aria-pressed', String(el === btn)));
      renderMap();
    }));
    const canvas = $('jim-map');
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('pointerup', onUp);
    $('jim-tile-edit').addEventListener('pointerdown', (e) => { state.tileStroke = false; editTileAt(e); });
    $('jim-tile-edit').addEventListener('pointermove', (e) => { if (state.tileStroke && (e.buttons & 1)) editTileAt(e); });
    window.addEventListener('pointerup', () => {
      if (state.tileStroke) renderTiles();
      state.tileStroke = false;
      state.colorStroke = false;
    });
    $('jim-tile-edit').addEventListener('contextmenu', (e) => e.preventDefault());
    $('jim-zoom').addEventListener('input', () => { state.zoom = Number($('jim-zoom').value); renderMap(); });
    ['jim-grid', 'jim-trans', 'jim-seam', 'jim-show-users', 'jim-remap-on', 'jim-printa-on'].forEach((id) => {
      $(id).addEventListener('change', () => { renderMap(); renderTiles(); renderInspector(); });
    });
    $('jim-printa').addEventListener('input', () => { renderMap(); renderInspector(); });
    $('jim-remap').addEventListener('input', () => { renderMap(); });
    $('jim-undo').addEventListener('click', undo);
    $('jim-redo').addEventListener('click', redo);
    $('jim-copy').addEventListener('click', () => copySel(false));
    $('jim-cut').addEventListener('click', () => copySel(true));
    $('jim-paste').addEventListener('click', paste);
    $('jim-clear').addEventListener('click', clearSel);
    $('jim-sel-all').addEventListener('click', () => {
      if (!canEdit()) return;
      state.sel = { x: 0, y: 0, w: doc.mapW, h: doc.mapH };
      state.tool = 'select';
      document.querySelectorAll('[data-tool]').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.tool === 'select')));
      renderAll();
    });
    document.querySelectorAll('[data-xf]').forEach((btn) => btn.addEventListener('click', () => blockOp(btn.dataset.xf)));
    $('jim-resize').addEventListener('click', resizeMap);
    $('jim-embed').addEventListener('change', () => {
      if (!canEdit()) { $('jim-embed').checked = doc.embedPalettes; return; }
      if ($('jim-embed').checked === doc.embedPalettes) return;
      remember();
      doc.embedPalettes = $('jim-embed').checked;
      status(headerMode());
      renderMeta();
      renderNote();
    });
    ['jim-tile', 'jim-pal', 'jim-h', 'jim-v', 'jim-pri'].forEach((id) => $(id).addEventListener('change', applyInspector));
    function channelInput(ch, rangeId, numId) {
      const fire = (fromRange) => setChannel(ch, Number($(fromRange ? rangeId : numId).value));
      $(rangeId).addEventListener('input', () => fire(true));
      $(numId).addEventListener('input', () => fire(false));
      $(rangeId).addEventListener('change', () => { state.colorStroke = false; });
      $(numId).addEventListener('change', () => { state.colorStroke = false; });
    }
    channelInput('r3', 'jim-r', 'jim-rn');
    channelInput('g3', 'jim-g', 'jim-gn');
    channelInput('b3', 'jim-b', 'jim-bn');
    $('jim-new-tile').addEventListener('click', () => {
      if (!canEdit()) return;
      remember();
      doc.tiles.push(new Uint8Array(64));
      state.tile = doc.tiles.length - 1;
      doc.dirtyTiles = true;
      state.tool = 'place';
      document.querySelectorAll('[data-tool]').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.tool === 'place')));
      status('New tile ' + state.tile + '. Place tool is on.');
      renderAll();
    });
    $('jim-mirror').addEventListener('click', () => {
      if (!canEdit() || !doc.tiles[state.tile]) return;
      remember();
      doc.tiles[state.tile] = flipNibbles(doc.tiles[state.tile], 1, 0);
      doc.dirtyTiles = true;
      status('Mirrored tile ' + state.tile + ' pixels.');
      renderAll();
    });
    $('jim-flip').addEventListener('click', () => {
      if (!canEdit() || !doc.tiles[state.tile]) return;
      remember();
      doc.tiles[state.tile] = flipNibbles(doc.tiles[state.tile], 0, 1);
      doc.dirtyTiles = true;
      status('Flipped tile ' + state.tile + ' pixels.');
      renderAll();
    });
    $('jim-del-tile').addEventListener('click', () => {
      if (!canEdit() || !doc.tiles[state.tile]) return;
      const n = users(state.tile);
      if (n && !window.confirm(n + ' cell' + (n === 1 ? ' uses' : 's use') + ' tile ' + state.tile + '. They become zero words. Delete it?')) return;
      remember();
      const gone = state.tile;
      doc.tiles.splice(gone, 1);
      if (!doc.tiles.length) doc.tiles.push(new Uint8Array(64));
      doc.cells.forEach((c) => {
        if (c.tile === gone) Object.assign(c, zeroCell());
        else if (c.tile > gone) c.tile--;
      });
      doc.dirtyTiles = true;
      doc.dirtyMap = true;
      if (state.tile >= doc.tiles.length) state.tile = doc.tiles.length - 1;
      status('Deleted tile ' + gone + '.');
      renderAll();
    });
    $('jim-unused').addEventListener('click', () => {
      if (!canEdit()) return;
      const used = new Set();
      doc.cells.forEach((c) => { if (c.tile < doc.tiles.length) used.add(c.tile); });
      if (used.size === doc.tiles.length) { status('Every tile is used.'); return; }
      remember();
      const remap = new Map();
      const tiles = [];
      doc.tiles.forEach((t, i) => { if (used.has(i)) { remap.set(i, tiles.length); tiles.push(t); } });
      if (!tiles.length) tiles.push(new Uint8Array(64));
      const removed = doc.tiles.length - tiles.length;
      doc.tiles = tiles;
      doc.cells.forEach((c) => { c.tile = remap.has(c.tile) ? remap.get(c.tile) : 0; });
      doc.dirtyTiles = true;
      doc.dirtyMap = true;
      if (!remap.has(state.tile)) state.tile = 0;
      else state.tile = remap.get(state.tile);
      status('Removed ' + removed + ' unused tile' + (removed === 1 ? '' : 's') + '.');
      renderAll();
    });
    $('jim-open-btn').addEventListener('click', () => $('jim-open').click());
    $('jim-open').addEventListener('change', () => {
      const files = $('jim-open').files;
      if (!files || !files.length) return;
      ingestList(files).catch((err) => status(err.message, true)).finally(() => { $('jim-open').value = ''; });
    });
    $('jim-donor-btn').addEventListener('click', () => $('jim-donor').click());
    $('jim-donor').addEventListener('change', async () => {
      const files = $('jim-donor').files;
      if (!files || !files[0]) return;
      try { applyDonor(new Uint8Array(await files[0].arrayBuffer())); }
      catch (err) { status(err.message, true); }
      $('jim-donor').value = '';
    });
    $('jim-act-btn').addEventListener('click', () => $('jim-act').click());
    $('jim-act').addEventListener('change', async () => {
      const files = $('jim-act').files;
      if (!files || !files[0]) return;
      try { importAct(new Uint8Array(await files[0].arrayBuffer())); }
      catch (err) { status(err.message, true); }
      $('jim-act').value = '';
    });
    $('jim-import-btn').addEventListener('click', () => $('jim-image').click());
    $('jim-image').addEventListener('change', async () => {
      const files = $('jim-image').files;
      if (!files || !files[0]) return;
      try { await importOne(files[0]); }
      catch (err) { status(err.message || String(err), true); }
      $('jim-image').value = '';
    });
    $('jim-batch-add').addEventListener('click', () => $('jim-batch-file').click());
    $('jim-batch-file').addEventListener('change', () => {
      const files = $('jim-batch-file').files;
      if (files) ingestList(files).catch((err) => status(err.message, true));
      $('jim-batch-file').value = '';
    });
    $('jim-batch-clear').addEventListener('click', () => { state.batch = []; renderBatch(); });
    $('jim-batch-preview').addEventListener('click', () => {
      if (!state.batch.length) { status('Add images to the batch first.'); return; }
      try {
        let float = null;
        state.batch.forEach((item) => {
          const part = quantizeToFloat(item, item.pals, item.onlyEmpty);
          float = float ? mergeFloat(float, part) : part;
        });
        float.name = 'Batch (' + state.batch.length + ')';
        float.x = Math.max(0, Math.floor((doc.mapW - float.w) / 2));
        float.y = Math.max(0, Math.floor((doc.mapH - float.h) / 2));
        state.float = float;
        status('Floating batch of ' + state.batch.length + '. Later files overwrote earlier ones. Drag, then Apply.');
        renderAll();
      } catch (err) { status(err.message || String(err), true); }
    });
    $('jim-float-apply').addEventListener('click', () => { try { applyFloat(); } catch (err) { status(err.message, true); } });
    $('jim-float-cancel').addEventListener('click', () => { state.float = null; status('Cancelled the floating import.'); renderAll(); });
    $('jim-export').addEventListener('click', doExport);
    $('jim-packed').addEventListener('change', renderNote);
    document.addEventListener('keydown', (event) => {
      const tag = event.target && event.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) { undo(); event.preventDefault(); }
      else if ((event.ctrlKey || event.metaKey) && key === 'z' && event.shiftKey) { redo(); event.preventDefault(); }
      else if ((event.ctrlKey || event.metaKey) && key === 'y') { redo(); event.preventDefault(); }
      else if ((event.ctrlKey || event.metaKey) && key === 'c') { copySel(false); event.preventDefault(); }
      else if ((event.ctrlKey || event.metaKey) && key === 'x') { copySel(true); event.preventDefault(); }
      else if ((event.ctrlKey || event.metaKey) && key === 'v') { paste(); event.preventDefault(); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { clearSel(); event.preventDefault(); }
      else if (event.key === 'Escape') { state.sel = null; if (state.float) { state.float = null; status('Cancelled the floating import.'); } renderAll(); }
    });

    let dragging = false;
    const overlay = $('drop-overlay');
    const show = (on) => { overlay.hidden = !on; overlay.setAttribute('aria-hidden', on ? 'false' : 'true'); };
    window.addEventListener('dragenter', (event) => {
      if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return;
      event.preventDefault();
      dragging = true;
      show(true);
    });
    window.addEventListener('dragover', (event) => {
      if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', (event) => { if (dragging && event.relatedTarget == null) { dragging = false; show(false); } });
    window.addEventListener('dragend', () => { dragging = false; show(false); });
    window.addEventListener('drop', (event) => {
      event.preventDefault();
      dragging = false;
      show(false);
      ingestList(event.dataTransfer.files).catch((err) => status(err.message || String(err), true));
    });
  }

  function boot() {
    if (!Jim) {
      status('lib/jim.js did not load.', true);
      return;
    }
    fillSelect('jim-a-method', METHODS, 'uniform');
    fillSelect('jim-b-method', METHODS, 'adaptive');
    fillSelect('jim-a-dither', DITHERS, 'none');
    fillSelect('jim-b-dither', DITHERS, 'none');
    buildPaletteChrome();
    wire();
    hashNote();
    if (!fromSession()) {
      loadDoc(blankDoc(), 'Open a Genesis .map.jim, .jim, or .bin. Export stays on this machine — nothing is written into a ROM.');
    }
  }

  boot();
})();
