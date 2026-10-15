const assert = require('assert');
const psgApi = require('../lib/audio/sn76489');
const presets = require('../lib/audio/chip-lab-presets');
const resamplerApi = require('../lib/audio/chip-resampler');
const z80Patterns = require('../lib/audio/z80-test-patterns');
const ymWasm = require('../lib/audio/ym2612-wasm');

function measure(samples, sampleRate) {
  let mean = 0;
  for (let i = 0; i < samples.length; i++) mean += samples[i];
  mean /= samples.length;
  let sum = 0;
  let crossings = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] - mean;
    sum += v * v;
    if (i && ((samples[i - 1] - mean) < 0) !== (v < 0)) crossings += 1;
  }
  return {
    rms: Math.sqrt(sum / samples.length),
    hz: (crossings / 2) / (samples.length / sampleRate)
  };
}

function assertPitch(label, got, want) {
  const err = Math.abs(got.hz - want) / want;
  assert.ok(got.rms > 0.05, label + ' should be audible (rms=' + got.rms.toFixed(4) + ')');
  assert.ok(err < 0.02, label + ' pitch ' + got.hz.toFixed(1) + ' Hz, expected ' + want + ' Hz');
}

(async () => {
  const ping = z80Patterns.run('ym_ping');
  assert.ok(ping.ok, ping.detail);

  const psg = psgApi.create();
  presets.psgTonePreset(psg, 440);
  assertPitch('SN76489 440 Hz tone', measure(psg.generateSamples(44100, 44100), 44100), 440);

  const ym = await ymWasm.createRuntime();
  for (const outRate of [44100, 48000]) {
    const resampler = resamplerApi.create(ym.sampleRate(), outRate, (n) => ym.generateStereo(n));
    for (const id of Object.keys(presets.YM_PRESET_HZ)) {
      ym.reset();
      presets.applyYmPreset(ym, id);
      resampler.reset();
      resampler.process(2048);
      let left = [];
      for (let i = 0; i < 24; i++) left = left.concat(Array.from(resampler.process(2048).left));
      assertPitch('YM2612 preset ' + id + ' @' + outRate, measure(Float32Array.from(left), outRate), presets.YM_PRESET_HZ[id]);
    }
  }

  ym.reset();
  const silent = measure(ym.generateStereo(4096).left, ym.sampleRate());
  assert.ok(silent.rms < 0.001, 'YM2612 should be silent after reset');

  console.log('chip audio: YM2612 presets and SN76489 tone verified by pitch');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
