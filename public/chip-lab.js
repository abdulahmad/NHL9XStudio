import { Ym2612 } from '../lib/audio/generated/ym2612-runtime.js';

const SAMPLE_RATE = 44100;
const base = new URL('../lib/audio/generated/', import.meta.url);

const el = (id) => document.getElementById(id);
const ymMeter = el('ym-meter');
const psgMeter = el('psg-meter');
const statusEl = el('status');

let ymChip = null;
let psg = null;
let ctx = null;
let node = null;
let running = false;
let ymPreset = '440';
let psgMode = 'tone';

function rms(buf) {
  if (!buf || !buf.length) return 0;
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

async function initEngine() {
  statusEl.textContent = 'Loading YM2612 WASM…';
  const { default: moduleFactory } = await import(new URL('ym2612_wasm.js', base));
  ymChip = await Ym2612.create({
    moduleFactory,
    moduleOptions: {
      locateFile: (name) => new URL(name, base).href
    }
  });
  ymChip.reset();
  psg = NhlSn76489.create({ clock: 3579545 });
  statusEl.textContent = 'Ready — pick a preset and press Play';
}

function applyYm() {
  ymChip.reset();
  NhlChipLabPresets.applyYmPreset({
    writePort(port, value) {
      ymChip.write(port & 3, value & 0xff);
    }
  }, ymPreset);
  ymMeter.textContent = 'YM preset: ' + ymPreset;
}

function applyPsg() {
  psg.reset();
  if (psgMode === 'noise') NhlChipLabPresets.psgNoisePreset(psg);
  else NhlChipLabPresets.psgTonePreset(psg, 523.25);
  psgMeter.textContent = 'PSG: ' + psgMode;
}

async function startAudio() {
  applyYm();
  applyPsg();
  if (!ctx) {
    ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    node = ctx.createScriptProcessor(2048, 0, 2);
    node.onaudioprocess = (ev) => {
      if (!running) return;
      const L = ev.outputBuffer.getChannelData(0);
      const R = ev.outputBuffer.getChannelData(1);
      const ymPcm = ymChip.generateStereo(L.length);
      const psgBuf = psg.generateSamples(L.length, ctx.sampleRate);
      let ymLevel = 0;
      let psgLevel = 0;
      for (let i = 0; i < L.length; i++) {
        const yl = ymPcm.left[i] || 0;
        const yr = ymPcm.right[i] || 0;
        const p = psgBuf[i] || 0;
        L[i] = yl * 0.85 + p * 0.45;
        R[i] = yr * 0.85 + p * 0.45;
        ymLevel += yl * yl;
        psgLevel += p * p;
      }
      ymMeter.textContent = 'YM rms ' + Math.sqrt(ymLevel / L.length).toFixed(4);
      psgMeter.textContent = 'PSG rms ' + Math.sqrt(psgLevel / L.length).toFixed(4);
    };
    node.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') await ctx.resume();
  running = true;
  statusEl.textContent = 'Playing…';
}

function stopAudio() {
  running = false;
  statusEl.textContent = 'Stopped';
}

document.querySelectorAll('[data-ym]').forEach((btn) => {
  btn.addEventListener('click', () => {
    ymPreset = btn.getAttribute('data-ym');
    ymMeter.textContent = 'YM preset selected: ' + ymPreset;
  });
});

document.querySelectorAll('[data-psg]').forEach((btn) => {
  btn.addEventListener('click', () => {
    psgMode = btn.getAttribute('data-psg');
    psgMeter.textContent = 'PSG selected: ' + psgMode;
  });
});

el('play').addEventListener('click', () => {
  startAudio().catch((err) => {
    statusEl.textContent = err.message || 'Playback failed';
  });
});

el('stop').addEventListener('click', stopAudio);

initEngine().catch((err) => {
  statusEl.textContent = 'Init failed: ' + (err.message || err);
});
