// $90 (game sample $02) vs 93G check PCM: spectral envelope match (low confidence; see Sound test note).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const SD = require('../lib/audio/nhl93s-sound-data');
const Dsp = require('../lib/audio/snes-dsp');
const N93 = require('../lib/audio/nhl93-names');

const d = SD.load(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'audio', 'nhl93s-sound.json'))));
const slice = new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'data', 'fixtures', 'nhl93-sound-slice.bin')));
const rom93 = new Uint8Array(0x30000);
rom93.set(slice.subarray(0, 0x30000 - 0x165d8), 0x165d8);

function load93G(name) {
  const e = N93.PCM.find((p) => p.name === name);
  const raw = rom93.subarray(e.start, e.end);
  const out = new Int16Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = (raw[i] - 128) * 256;
  return out;
}

function spec(sig, bands) {
  const n = Math.min(sig.length, 8000);
  const out = new Float32Array(bands);
  for (let b = 0; b < bands; b++) {
    const lo = Math.floor((b * n) / bands);
    const hi = Math.floor(((b + 1) * n) / bands);
    let e = 0;
    for (let i = lo; i < hi; i++) e += sig[i] * sig[i];
    out[b] = Math.sqrt(e / (hi - lo || 1));
  }
  let s = 0;
  for (const v of out) s += v;
  if (s > 0) for (let i = 0; i < bands; i++) out[i] /= s;
  return out;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

const s2 = d.samples('game').find((s) => s.index === 2);
const inst = d.instruments.find((i) => i.index === 12);
const rendered = Dsp.renderVoice({ brr: s2.brr, pitch: 832, adsr1: inst.adsr1, adsr2: inst.adsr2, gain: inst.gain, samples: 8000, keyOffAt: 8000 });
const c1 = dot(spec(rendered.samples, 32), spec(load93G('sfx_check_pcm'), 32));
const c2 = dot(spec(rendered.samples, 32), spec(load93G('sfx_check2_pcm'), 32));
assert.ok(c1 < 0.2 && c2 < 0.2, 'weak match only');
assert.ok(c2 > c1, 'slight lean to 93G check2 (hitboard)');
console.log('nhl93s $90 sample $02 spectral: check1=' + c1.toFixed(4) + ' check2=' + c2.toFixed(4) + ' (low confidence)');
