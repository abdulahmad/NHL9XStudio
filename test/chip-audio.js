const assert = require('assert');
const psgApi = require('../lib/audio/sn76489');
const presets = require('../lib/audio/chip-lab-presets');
const z80Patterns = require('../lib/audio/z80-test-patterns');
const ymWasm = require('../lib/audio/ym2612-wasm');

function rms(samples) {
  if (!samples || !samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

(async () => {
  const ping = z80Patterns.run('ym_ping');
  assert.ok(ping.ok, ping.detail);

  const psg = psgApi.create();
  presets.psgTonePreset(psg, 440);
  const psgBuf = psg.generateSamples(4410, 44100);
  const psgRms = rms(psgBuf);
  assert.ok(psgRms > 0.02, 'SN76489 tone preset should be audible (rms=' + psgRms + ')');

  const ym = await ymWasm.createRuntime();
  presets.applyYmPreset(ym, '440');
  const ymStereo = ym.generateStereo(4410);
  const ymRms = rms(ymStereo.left);
  assert.ok(ymRms > 0.001, 'YM2612 WASM preset should produce FM (rms=' + ymRms + ')');

  console.log('chip audio: YM rms', ymRms.toFixed(4), 'PSG rms', psgRms.toFixed(4));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
