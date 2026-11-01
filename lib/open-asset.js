/**
 * Classify dropped files and route to decoders (browser + Node).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlOpenAsset = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const EXT = {
    rom: /\.(bin|md|gen|sfc|smc)$/i,
    iso: /\.(iso|img)$/i,
    anim: /\.anim$/i,
    jim: /\.(jim|map\.jim)$/i,
    sjim: /\.sjim$/i,
    frames: /\.(bin)$/i,
    ppv: /\.ppv$/i,
    qfs: /\.qfs$/i,
    qpp: /\.qpp$/i,
    pal: /\.(pal|act|bin)$/i
  };

  function pc94Modules() {
    if (typeof require === 'function') {
      try {
        return { pack: require('./pc94-pack'), shape: require('./pc94-shape') };
      } catch (err) {
        /* fall through to browser globals */
      }
    }
    return {
      pack: typeof NhlPc94Pack !== 'undefined' ? NhlPc94Pack : null,
      shape: typeof NhlPc94Shape !== 'undefined' ? NhlPc94Shape : null
    };
  }

  function isPc94Picture(bytes) {
    const mods = pc94Modules();
    if (!bytes || !bytes.length) return false;
    let raw = bytes;
    if (mods.pack && mods.pack.isPacked(bytes)) {
      try {
        raw = mods.pack.unpack(bytes).data;
      } catch (err) {
        return false;
      }
    }
    return !!(mods.shape && mods.shape.isBank(raw));
  }

  function pcGameIdOf(classified) {
    const ext = String(classified.ext || '').toLowerCase();
    if (ext === 'qpp') return 'nhl94pc';
    if (ext === 'qfs') return 'nhl95pc';
    if (isPc94Picture(classified.bytes)) return 'nhl94pc';
    return 'nhl95pc';
  }

  function classify(name, bytes) {
    const base = String(name || '').split(/[/\\]/).pop();
    const lower = base.toLowerCase();
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (EXT.iso.test(lower)) {
      return { kind: 'iso', label: base, message: 'PC ISO: extract the install folder or drop loose PPV/QFS files (ISO mount planned).' };
    }
    if (typeof NhlRomDetect !== 'undefined') {
      const rom = NhlRomDetect.detect(base, u8);
      if (rom) return { kind: 'rom', gameId: rom.id, bytes: rom.bytes, revADate: rom.revADate, label: base };
    }
    if (EXT.ppv.test(lower) || EXT.qfs.test(lower) || EXT.qpp.test(lower)) {
      return { kind: 'pc', ext: lower.split('.').pop(), label: base, bytes: u8 };
    }
    if (EXT.anim.test(lower)) return { kind: 'anim', label: base, bytes: u8 };
    // .sjim before .jim: the suffix .sjim also matches a naïve /\.jim$/.
    if (EXT.sjim.test(lower)) return { kind: 'sjim', label: base, bytes: u8 };
    const packed94 = u8.length >= 5 && ({ 0xfb10: 1, 0xfb30: 1, 0xfb46: 1, 0xfb7a: 1 }[u8[0] | (u8[1] << 8)]);
    if (packed94 || /\.(huf|lz|rle|pairs)$/i.test(lower) || /\.snes94\.zip$/i.test(lower)) {
      return { kind: 'snes94', label: base, bytes: u8 };
    }
    // Real JIMs start with a palette offset, not the ASCII letters "JI".
    // Sniffing those bytes classified ordinary buffers as pictures. .jim and
    // .map.jim are the signal; a nameless buffer is left for the other checks.
    if (EXT.jim.test(lower)) return { kind: 'jim', label: base, bytes: u8 };
    if (u8.length >= 16) {
      const tag = String.fromCharCode(u8[0], u8[1]);
      if (tag === 'SS' || (u8.length >= 12 && u8[4] === 0)) {
        return { kind: 'frames', label: base, bytes: u8 };
      }
    }
    if (u8.length > 0x80000 && u8.length <= 0x200000) {
      return { kind: 'rom-candidate', label: base, bytes: u8 };
    }
    return { kind: 'unknown', label: base, bytes: u8 };
  }

  function decodeLoose(classified, deps) {
    const { anim, sheet, jim, sjim, sscr, pc95 } = deps;
    if (classified.kind === 'anim' && anim) {
      return { mode: 'frame', bankId: classified.label, parsed: anim.parseAnim(classified.bytes) };
    }
    if (classified.kind === 'frames' && sheet && jim) {
      const missing = classified.bytes.length >= 4
        && new DataView(classified.bytes.buffer, classified.bytes.byteOffset, classified.bytes.byteLength).getUint32(0) === 0xffffffff;
      return {
        mode: 'frame',
        bankId: classified.label,
        parsed: sheet.openFrames(classified.bytes, jim, null),
        needsIcePalette: missing
      };
    }
    if (classified.kind === 'sjim' && sjim && typeof sjim.parseSjim === 'function' && jim) {
      const doc = sjim.parseSjim(classified.bytes, null, { name: classified.label });
      const drawn = jim.rasterize(doc);
      return { mode: 'image', imageId: classified.label, parsed: jim.pictureAnim(drawn.width, drawn.height, drawn.pixels, drawn.colors) };
    }
    if (classified.kind === 'snes94' && sscr && typeof sscr.parsePackedOrZip === 'function' && jim) {
      const doc = sscr.parsePackedOrZip(classified.bytes, { name: classified.label });
      const drawn = jim.rasterize(doc);
      return { mode: 'image', imageId: classified.label, parsed: jim.pictureAnim(drawn.width, drawn.height, drawn.pixels, drawn.colors) };
    }
    if (classified.kind === 'jim' && jim) {
      return { mode: 'image', imageId: classified.label, parsed: jim.decodeJim(classified.bytes, null) };
    }
    if (classified.kind === 'pc' && pc95) {
      const gameId = pcGameIdOf(classified);
      const parsed = pc95.openSpriteBundle(classified.bytes, gameId);
      if (!parsed || !parsed.numFrames) return null;
      return { mode: 'frame', bankId: classified.label, parsed, gameId: gameId };
    }
    return null;
  }

  return { classify, decodeLoose, EXT, isPc94Picture, pcGameIdOf };
});
