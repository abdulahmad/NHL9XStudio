/**
 * Cross-check NHLPA 93 SNES game samples against NHLPA 93 Genesis PCM (retail slices, no driver changes).
 */
const assert = require('assert');
const SD = require('../lib/audio/nhl93s-sound-data');
const Dsp = require('../lib/audio/snes-dsp');
const PCM92 = require('../lib/audio/nhl92-pcm');
const Fixture = require('../lib/audio/nhl92-sound-fixture');
const d = SD.load(require('../data/audio/nhl93s-sound.json'));

function decode93gPcm(name) {
  const ref = PCM92.SAMPLES.find((p) => p.name === name);
  const rom = Fixture.resolveRom();
  const raw = rom.subarray(ref.start, ref.end);
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = (raw[i] - 128) / 128;
  return out;
}

function corr(a, b, lag) {
  lag = lag || 0;
  const n = Math.min(a.length, b.length - lag);
  if (n < 64) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i + lag];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i + lag] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(da * db) || 0;
}

function bestCorr(sig, ref) {
  let best = { c: -1, lag: 0 };
  for (let lag = 0; lag < 8000; lag += 8) {
    const c = corr(sig, ref, lag);
    if (c > best.c) best = { c, lag };
  }
  return best;
}

function renderedSample(gameIndex, pitch) {
  const samp = d.samples('game')[gameIndex];
  const inst = d.instruments[gameIndex + 10];
  const r = Dsp.renderVoice({
    brr: samp.brr,
    pitch,
    adsr1: inst.adsr1,
    adsr2: inst.adsr2,
    gain: inst.gain,
    sampleRate: 32000
  });
  const sig = new Float32Array(r.samples.length);
  for (let i = 0; i < r.samples.length; i++) sig[i] = r.samples[i] / 32768;
  return sig;
}

// Effect $90 / $91 both play game samples at DSP pitch $340 ($832 decimal in capture — pitch register).
const pitch = 832;
const sig90 = renderedSample(2, pitch);
const check1 = decode93gPcm('sfx_skating34_pcm');
const check2 = decode93gPcm('sfx_sam_hitboard_pcm');
const m90a = bestCorr(sig90, check1);
const m90b = bestCorr(sig90, check2);
assert.ok(m90a.c > 0.85 && m90a.c > m90b.c + 0.1, '$90 sample is check1 (skating34): ' + m90a.c.toFixed(3) + ' vs ' + m90b.c.toFixed(3));

const sig91 = renderedSample(3, pitch);
const m91a = bestCorr(sig91, check1);
const m91b = bestCorr(sig91, check2);
assert.ok(m91a.c > 0.85 && m91a.c > m91b.c + 0.1, '$91 sample is check1: ' + m91a.c + ' vs ' + m91b.c);

console.log('nhl93s-sample-match: ok ($90/$91 check1 vs check2)');
