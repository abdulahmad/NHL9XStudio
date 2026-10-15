const YM_CLOCK = 7670454;
const BLOCK = 2048;
const METER_WINDOW_SEC = 0.3;

function generatedBaseUrl() {
  return new URL('lib/audio/generated/', document.baseURI).href;
}

const el = (id) => document.getElementById(id);
const ymMeter = el('ym-meter');
const psgMeter = el('psg-meter');
const statusEl = el('status');

let ymChip = null;
let psg = null;
let ctx = null;
let node = null;
let resampler = null;
let running = false;
let ymPreset = '440';
let psgMode = 'tone';
let engineReady = false;

function createMeter(label, target) {
  let sum = 0;
  let crossings = 0;
  let count = 0;
  let prev = 0;
  return {
    add(v) {
      sum += v * v;
      if ((prev < 0) !== (v < 0)) crossings += 1;
      prev = v;
      count += 1;
    },
    flush(sampleRate) {
      if (count < sampleRate * METER_WINDOW_SEC) return;
      const rms = Math.sqrt(sum / count);
      const hz = rms > 0.002 ? (crossings / 2) / (count / sampleRate) : 0;
      target.textContent = label + ' · ' + (hz ? Math.round(hz) + ' Hz' : 'silent') + ' · rms ' + rms.toFixed(3);
      this.clear();
    },
    clear() {
      sum = crossings = count = 0;
    }
  };
}

const ymLevel = createMeter('YM2612', ymMeter);
const psgLevel = createMeter('SN76489', psgMeter);

function applyYm() {
  if (!ymChip) return;
  ymChip.reset();
  NhlChipLabPresets.applyYmPreset({
    writePort(port, value) {
      ymChip.write(port & 3, value & 0xff);
    }
  }, ymPreset);
}

function applyPsg() {
  if (!psg) return;
  psg.reset();
  if (psgMode === 'noise') NhlChipLabPresets.psgNoisePreset(psg);
  else NhlChipLabPresets.psgTonePreset(psg, 523.25);
}

async function initEngine() {
  statusEl.textContent = 'Loading YM2612 WASM…';
  const base = generatedBaseUrl();
  const { Ym2612 } = await import(new URL('ym2612-runtime.js', base).href);
  const { default: moduleFactory } = await import(new URL('ym2612_wasm.js', base).href);
  const wasmRes = await fetch(new URL('ym2612_wasm.wasm', base).href);
  if (!wasmRes.ok) throw new Error('WASM fetch failed (' + wasmRes.status + ')');
  const wasmBinary = new Uint8Array(await wasmRes.arrayBuffer());
  ymChip = await Ym2612.create({
    moduleFactory,
    moduleOptions: { wasmBinary }
  });
  ymChip.reset();
  psg = NhlSn76489.create({ clock: 3579545 });
  engineReady = true;
  statusEl.textContent = 'Ready — pick a preset and press Play';
}

function ensureAudioGraph() {
  if (ctx) return;
  ctx = new AudioContext();
  resampler = NhlChipResampler.create(ymChip.sampleRate(YM_CLOCK), ctx.sampleRate, (n) => ymChip.generateStereo(n));
  node = ctx.createScriptProcessor(BLOCK, 0, 2);
  node.onaudioprocess = (ev) => {
    const L = ev.outputBuffer.getChannelData(0);
    const R = ev.outputBuffer.getChannelData(1);
    if (!running) {
      L.fill(0);
      R.fill(0);
      return;
    }
    const ymPcm = resampler.process(L.length);
    const psgBuf = psg.generateSamples(L.length, ctx.sampleRate);
    for (let i = 0; i < L.length; i++) {
      const yl = ymPcm.left[i];
      const yr = ymPcm.right[i];
      const p = psgBuf[i] || 0;
      L[i] = yl * 0.85 + p * 0.45;
      R[i] = yr * 0.85 + p * 0.45;
      ymLevel.add((yl + yr) * 0.5);
      psgLevel.add(p);
    }
    ymLevel.flush(ctx.sampleRate);
    psgLevel.flush(ctx.sampleRate);
  };
  node.connect(ctx.destination);
}

async function startAudio() {
  if (!engineReady || !ymChip || !psg) {
    statusEl.textContent = 'Still loading — wait for Ready';
    return;
  }
  ensureAudioGraph();
  applyYm();
  applyPsg();
  resampler.reset();
  if (ctx.state === 'suspended') await ctx.resume();
  running = true;
  statusEl.textContent = 'Playing — YM ' + ymPreset + ' + PSG ' + psgMode;
}

function stopAudio() {
  running = false;
  if (ymChip) ymChip.reset();
  if (psg) psg.reset();
  ymLevel.clear();
  psgLevel.clear();
  if (engineReady) {
    ymMeter.textContent = 'YM2612 · stopped';
    psgMeter.textContent = 'SN76489 · stopped';
    statusEl.textContent = 'Stopped';
  }
}

function markSelected(selector, attr, value) {
  document.querySelectorAll(selector).forEach((btn) => {
    btn.classList.toggle('is-selected', btn.getAttribute(attr) === value);
  });
}

document.querySelectorAll('[data-ym]').forEach((btn) => {
  btn.addEventListener('click', () => {
    ymPreset = btn.getAttribute('data-ym');
    markSelected('[data-ym]', 'data-ym', ymPreset);
    if (running) {
      applyYm();
      statusEl.textContent = 'Playing — YM ' + ymPreset + ' + PSG ' + psgMode;
    } else {
      ymMeter.textContent = 'Selected ' + btn.textContent + ' — press Play';
    }
  });
});

document.querySelectorAll('[data-psg]').forEach((btn) => {
  btn.addEventListener('click', () => {
    psgMode = btn.getAttribute('data-psg');
    markSelected('[data-psg]', 'data-psg', psgMode);
    if (running) {
      applyPsg();
      statusEl.textContent = 'Playing — YM ' + ymPreset + ' + PSG ' + psgMode;
    } else {
      psgMeter.textContent = 'Selected ' + btn.textContent + ' — press Play';
    }
  });
});

markSelected('[data-ym]', 'data-ym', ymPreset);
markSelected('[data-psg]', 'data-psg', psgMode);

el('play').addEventListener('click', () => {
  startAudio().catch((err) => {
    statusEl.textContent = err.message || 'Playback failed';
  });
});

el('stop').addEventListener('click', stopAudio);

initEngine().catch((err) => {
  engineReady = false;
  statusEl.textContent = 'Init failed: ' + (err && err.message ? err.message : String(err));
  console.error(err);
});
