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

// NHL '92 retail driver picker: a dedicated YM2612 instance restored to its
// pristine saved state before every render, so each render is reproducible.
const nhl = {
  chip: null,
  pristine: null,
  program: null,
  rom: null,
  source: null,
  url: null
};

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
  initNhl92(Ym2612).catch((err) => {
    el('nhl92-meter').textContent = 'Driver unavailable: ' + (err && err.message ? err.message : String(err));
    console.error(err);
  });
}

function sitePrefix() {
  const base = new URL('.', document.baseURI).pathname;
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

async function initNhl92(Ym2612) {
  const A = window.Nhl92Z80Audio;
  const rom = await Nhl92SoundFixture.ensureSyntheticRom({ baseUrl: sitePrefix() });
  nhl.rom = rom;
  nhl.program = Nhl92SoundFixture.getEmbeddedZ80Program();
  if (!nhl.program) throw new Error('Z80 program missing from sound fixture');
  nhl.chip = new Ym2612(ymChip.module, ymChip.api.create(), ymChip.api);
  nhl.chip.reset();
  nhl.pristine = nhl.chip.saveState();

  const patchSel = el('nhl92-patch');
  for (let i = 0; i < A.PATCH_COUNT; i++) {
    const at = A.patchAddress(i);
    const algFb = nhl.program[at + 24];
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = String(i).padStart(2, '0') + ' · $' + at.toString(16).toUpperCase().padStart(4, '0') +
      ' · alg ' + (algFb & 7) + ' fb ' + ((algFb >> 3) & 7);
    patchSel.appendChild(opt);
  }
  const sfxSel = el('nhl92-sfx');
  A.DAC_SFX.forEach((entry, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = entry.name + ' · rate $' + entry.rate.toString(16).toUpperCase() + ' · pri ' + entry.priority;
    sfxSel.appendChild(opt);
  });
  el('nhl92-meter').textContent = 'Ready — pick a patch or SFX';
}

function sfxFrames(entry) {
  const A = window.Nhl92Z80Audio;
  let n = 0;
  const start = A.SOUND_BASE + entry.off + 1;
  while (nhl.rom[start + n] !== 0) n += 1;
  return Math.ceil((n * (161 + 17 * (entry.rate || 256))) / A.FRAME_TSTATES) + 30;
}

function renderNhl92(script, label) {
  const A = window.Nhl92Z80Audio;
  nhl.chip.loadState(nhl.pristine);
  const t0 = performance.now();
  const machine = A.create({ program: nhl.program, rom: nhl.rom, chip: nhl.chip });
  const pcm = machine.play(script);
  const ms = Math.round(performance.now() - t0);
  const psgWrites = machine.psgWrites;
  const ymWrites = machine.ymWrites;
  return { pcm, label, ms, psgWrites, ymWrites };
}

async function playNhl92(kind) {
  const A = window.Nhl92Z80Audio;
  const meter = el('nhl92-meter');
  if (!nhl.chip) {
    meter.textContent = 'Still loading the driver…';
    return;
  }
  if (!ctx) ensureAudioGraph();
  if (ctx.state === 'suspended') await ctx.resume();
  stopNhl92();
  let script;
  let label;
  if (kind === 'patch') {
    const i = Number(el('nhl92-patch').value);
    script = A.patchScaleScript(nhl.rom, i);
    label = 'patch-' + String(i).padStart(2, '0');
  } else {
    const entry = A.DAC_SFX[Number(el('nhl92-sfx').value)];
    script = A.sfxScript(entry, { frames: sfxFrames(entry) });
    label = 'sfx-' + entry.rom.toString(16) + '-' + entry.name.split(' ')[0];
  }
  meter.textContent = 'Rendering ' + label + ' through the Z80 driver…';
  await new Promise((r) => setTimeout(r, 20));
  const out = renderNhl92(script, label);
  const frames = out.pcm.length / 2;
  const buf = ctx.createBuffer(2, frames, A.SAMPLE_RATE);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  for (let i = 0; i < frames; i++) {
    L[i] = out.pcm[i * 2] / 32768;
    R[i] = out.pcm[i * 2 + 1] / 32768;
  }
  nhl.source = ctx.createBufferSource();
  nhl.source.buffer = buf;
  nhl.source.connect(ctx.destination);
  nhl.source.start();
  if (nhl.url) URL.revokeObjectURL(nhl.url);
  nhl.url = URL.createObjectURL(new Blob([NhlWav.encode16(out.pcm, A.SAMPLE_RATE, 2)], { type: 'audio/wav' }));
  const link = el('nhl92-download');
  link.href = nhl.url;
  link.download = label + '.wav';
  link.hidden = false;
  meter.textContent = label + ' · ' + (frames / A.SAMPLE_RATE).toFixed(2) + ' s · ' + out.ymWrites +
    ' YM writes · ' + out.psgWrites + ' PSG writes · rendered in ' + out.ms + ' ms';
}

function stopNhl92() {
  if (nhl.source) {
    try { nhl.source.stop(); } catch (e) { /* already stopped */ }
    nhl.source = null;
  }
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
  stopNhl92();
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

for (const [id, kind] of [['nhl92-play-patch', 'patch'], ['nhl92-play-sfx', 'sfx']]) {
  el(id).addEventListener('click', () => {
    playNhl92(kind).catch((err) => {
      el('nhl92-meter').textContent = err && err.message ? err.message : 'Render failed';
      console.error(err);
    });
  });
}

initEngine().catch((err) => {
  engineReady = false;
  statusEl.textContent = 'Init failed: ' + (err && err.message ? err.message : String(err));
  console.error(err);
});
