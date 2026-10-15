/**
 * Lazy YM2612 WASM backend (ymfm, BSD-3-Clause). Node + browser (chip lab).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlYm2612Wasm = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const YM_CLOCK = 7670454;
  let shared = null;
  let loadPromise = null;

  async function loadChipNode() {
    const path = require('path');
    const fs = require('fs');
    const { pathToFileURL } = require('url');
    const wasmPath = path.join(__dirname, 'generated', 'ym2612_wasm.wasm');
    const jsPath = path.join(__dirname, 'generated', 'ym2612_wasm.js');
    const wasmBinary = fs.readFileSync(wasmPath);
    const { default: moduleFactory } = await import(pathToFileURL(jsPath).href);
    const tetPath = path.join(__dirname, '..', '..', 'node_modules', 'tetorica-fm2612', 'ym2612.js');
    const { Ym2612 } = await import(pathToFileURL(tetPath).href);
    const chip = await Ym2612.create({ moduleFactory, moduleOptions: { wasmBinary } });
    chip.reset();
    return chip;
  }

  async function loadChip() {
    if (shared) return shared;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      if (typeof module === 'object' && module.exports) {
        shared = await loadChipNode();
        return shared;
      }
      throw new Error('YM2612 WASM: use chip-lab module loader in browser');
    })().catch((err) => {
      loadPromise = null;
      throw err;
    });
    return loadPromise;
  }

  async function createRuntime() {
    const chip = await loadChip();
    return {
      clock: YM_CLOCK,
      writePort(port, value) {
        chip.write(port & 3, value & 0xff);
      },
      reset() {
        chip.reset();
      },
      generateStereo(frames) {
        const pcm = chip.generateStereo(frames);
        return { left: pcm.left, right: pcm.right };
      }
    };
  }

  return { loadChip, createRuntime, YM_CLOCK };
});
