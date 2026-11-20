/**
 * Bundled NHL 92 sound data for Z80 test / GitHub Pages (not a full game ROM).
 */
(function (root, factory) {
  var z80Loader = typeof module === 'object' && module.exports
    ? require('./nhl92-z80')
    : root.Nhl92Z80Driver;
  var api = factory(z80Loader);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92SoundFixture = api;
})(typeof self !== 'undefined' ? self : this, function (z80Loader) {
  const SOUND_START = 0xf4c8;
  const SYNTHETIC_ROM_SIZE = 0x25000;
  const FIXTURE_SLICE_PATH = '/data/fixtures/nhl92-sound-slice.bin';
  const FIXTURE_Z80_PATH = '/data/fixtures/nhl92-z80-program.bin';

  let cachedRom = null;
  let cachedZ80 = null;
  let loadPromise = null;

  function buildSyntheticRom(sliceBytes) {
    const rom = new Uint8Array(SYNTHETIC_ROM_SIZE);
    if (sliceBytes && sliceBytes.length) {
      rom.set(sliceBytes, SOUND_START);
    }
    return rom;
  }

  function loadFromNodeFs() {
    if (typeof require !== 'function') return null;
    try {
      const fs = require('fs');
      const path = require('path');
      const root = path.join(__dirname, '..', '..');
      const slicePath = path.join(root, 'data', 'fixtures', 'nhl92-sound-slice.bin');
      const z80Path = path.join(root, 'data', 'fixtures', 'nhl92-z80-program.bin');
      if (!fs.existsSync(slicePath)) return null;
      const slice = new Uint8Array(fs.readFileSync(slicePath));
      const rom = buildSyntheticRom(slice);
      if (fs.existsSync(z80Path)) cachedZ80 = new Uint8Array(fs.readFileSync(z80Path));
      else cachedZ80 = z80Loader.extractProgram(rom);
      cachedRom = rom;
      return rom;
    } catch (e) {
      return null;
    }
  }

  async function loadFromUrl(baseUrl) {
    const prefix = baseUrl || '';
    const response = await fetch(prefix + FIXTURE_SLICE_PATH);
    if (!response.ok) throw new Error('Sound fixture missing (' + FIXTURE_SLICE_PATH + ')');
    const slice = new Uint8Array(await response.arrayBuffer());
    const rom = buildSyntheticRom(slice);
    try {
      const z80Res = await fetch(prefix + FIXTURE_Z80_PATH);
      if (z80Res.ok) cachedZ80 = new Uint8Array(await z80Res.arrayBuffer());
    } catch (e) { /* optional */ }
    if (!cachedZ80 || !cachedZ80.length) cachedZ80 = z80Loader.extractProgram(rom);
    cachedRom = rom;
    return rom;
  }

  async function ensureSyntheticRom(options) {
    if (cachedRom) return cachedRom;
    const fromNode = loadFromNodeFs();
    if (fromNode) return fromNode;
    if (loadPromise) return loadPromise;
    loadPromise = loadFromUrl(options && options.baseUrl).catch((err) => {
      loadPromise = null;
      throw err;
    });
    return loadPromise;
  }

  function getCachedRom() {
    if (!cachedRom) loadFromNodeFs();
    return cachedRom;
  }

  function getEmbeddedZ80Program() {
    if (cachedZ80) return cachedZ80;
    loadFromNodeFs();
    return cachedZ80;
  }

  function resolveRom(userRom) {
    if (userRom && userRom.length >= 0x11800) return userRom;
    loadFromNodeFs();
    return cachedRom;
  }

  async function resolveRomAsync(userRom, options) {
    if (userRom && userRom.length >= 0x11800) return userRom;
    await ensureSyntheticRom(options);
    return cachedRom;
  }

  return {
    SOUND_START,
    SYNTHETIC_ROM_SIZE,
    FIXTURE_SLICE_PATH,
    buildSyntheticRom,
    ensureSyntheticRom,
    resolveRom,
    resolveRomAsync,
    getCachedRom,
    getEmbeddedZ80Program
  };
});
