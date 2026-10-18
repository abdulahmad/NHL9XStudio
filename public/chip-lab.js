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
let running = false; // true while a YM2612 or PSG button is on
let ymPreset = null; // the YM2612 button that is on (data-ym), or null
let psgMode = null; // the SN76489 button that is on (data-psg), or null
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
  statusEl.textContent = 'Ready — click a button to hear it, click it again to stop';
  initNhl92(Ym2612).catch((err) => {
    el('aud-meter').textContent = 'Driver unavailable: ' + (err && err.message ? err.message : String(err));
    console.error(err);
  });
}

function sitePrefix() {
  const base = new URL('.', document.baseURI).pathname;
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

async function initNhl92(Ym2612) {
  aud.Ym2612 = Ym2612;
  const A = window.Nhl92Z80Audio;
  const rom = await Nhl92SoundFixture.ensureSyntheticRom({ baseUrl: sitePrefix() });
  nhl.rom = rom;
  nhl.program = Nhl92SoundFixture.getEmbeddedZ80Program();
  if (!nhl.program) throw new Error('Z80 program missing from sound fixture');
  nhl.chip = new Ym2612(ymChip.module, ymChip.api.create(), ymChip.api);
  nhl.chip.reset();
  nhl.pristine = nhl.chip.saveState();

  initAudition().catch((err) => {
    el('aud-meter').textContent = 'Audition unavailable: ' + (err && err.message ? err.message : String(err));
    console.error(err);
  });
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

function describeOn() {
  const on = [];
  if (ymPreset) on.push('YM ' + ymPreset);
  if (psgMode) on.push('PSG ' + psgMode);
  return on.length ? 'Playing — ' + on.join(' + ') : 'Stopped';
}

/** Make sure the audio graph runs while at least one button is on. */
async function syncRunning() {
  running = !!(ymPreset || psgMode);
  if (running) {
    ensureAudioGraph();
    if (ctx.state === 'suspended') await ctx.resume();
  } else {
    ymLevel.clear();
    psgLevel.clear();
    if (engineReady) {
      ymMeter.textContent = 'YM2612 · stopped';
      psgMeter.textContent = 'SN76489 · stopped';
    }
  }
  statusEl.textContent = describeOn();
}

function markSelected(selector, attr, value) {
  document.querySelectorAll(selector).forEach((btn) => {
    const on = value != null && btn.getAttribute(attr) === value;
    btn.classList.toggle('is-selected', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

// Each YM2612 / SN76489 button is a toggle: click to hear it (the button lights up), click again to stop it.
// One YM2612 sound and one PSG sound can play together; picking another one on the same chip replaces it.
function toggleButton(btn, which) {
  if (!engineReady || !ymChip || !psg) {
    statusEl.textContent = 'Still loading the engine…';
    return;
  }
  if (which === 'ym') {
    const v = btn.getAttribute('data-ym');
    ymPreset = ymPreset === v ? null : v;
    if (ymPreset) applyYm(); else ymChip.reset();
    markSelected('[data-ym]', 'data-ym', ymPreset);
  } else {
    const v = btn.getAttribute('data-psg');
    psgMode = psgMode === v ? null : v;
    if (psgMode) applyPsg(); else psg.reset();
    markSelected('[data-psg]', 'data-psg', psgMode);
  }
  syncRunning().catch((err) => { statusEl.textContent = err.message || 'Playback failed'; });
}

document.querySelectorAll('[data-ym]').forEach((btn) => btn.addEventListener('click', () => toggleButton(btn, 'ym')));
document.querySelectorAll('[data-psg]').forEach((btn) => btn.addEventListener('click', () => toggleButton(btn, 'psg')));
markSelected('[data-ym]', 'data-ym', null);
markSelected('[data-psg]', 'data-psg', null);

// Mapping audition: a game's sound next to a plain GM-style reference. NHL '92 plays through the Z80 driver
// (lib/audio/nhl92-gm-audition.js); NHLPA 93 and NHL 94 play a short song on the retail 68k + Z80 drivers
// (lib/audio/nhl9x-gm-audition.js), so the three share the pick menu, the info line and the Play buttons.
const aud = { game: '92', map: null, map9x: null, source: null, images: {}, Ym2612: null };
const GAME_9X = {
  93: { label: 'NHLPA 93', slice: 'nhl93-sound-slice.bin', start: 0x165d8, size: 0x2e1fc, driver: 'Nhl93M68kHarness' },
  94: { label: 'NHL 94', slice: 'nhl94-sound-slice.bin', start: 0x1a264, size: 0x4b5c0, driver: 'Nhl94M68kHarness' }
};
const audLib = () => (aud.game === '92' ? Nhl92GmAudition : Nhl9xGmAudition);
const audMap = () => (aud.game === '92' ? aud.map : aud.map9x);
const audGameName = () => (aud.game === '92' ? "NHL '92" : GAME_9X[aud.game].label);

function audText(t) {
  if (!t) return 'none';
  if (t.kind === 'program') return 'GM ' + t.program + ' ' + t.name;
  if (t.kind === 'drum') return 'drum ' + t.note + ' ' + t.name;
  if (t.kind === 'patch') return 'patch ' + t.patch + (t.midi != null ? ' @ MIDI ' + t.midi : '');
  return 'DAC SFX ' + t.sfx + (t.label ? ' (' + t.label + ')' : '');
}

function audFillPicks() {
  const sel = el('aud-pick');
  const dir = el('aud-dir').value;
  sel.textContent = '';
  const groups = {};
  audLib().picks(audMap(), dir).forEach((p) => {
    const opt = document.createElement('option');
    opt.value = String(p.value);
    opt.textContent = p.label;
    let parent = sel;
    if (p.group) {
      if (!groups[p.group]) {
        groups[p.group] = document.createElement('optgroup');
        groups[p.group].label = p.group;
        sel.appendChild(groups[p.group]);
      }
      parent = groups[p.group];
    }
    parent.appendChild(opt);
  });
  audShowInfo();
}

function audPlan(runnerUp) {
  return audLib().plan(audMap(), el('aud-dir').value, Number(el('aud-pick').value), runnerUp);
}

function audShowInfo() {
  const pl = audPlan(false);
  const i = pl.info;
  const bits = ['Match: ' + audText(i.match), 'runner-up: ' + audText(i.runnerUp)];
  if (i.confidence) bits.push('sure: ' + i.confidence);
  if (i.fit) bits.push('fit: ' + i.fit);
  bits.push('from ' + i.source);
  el('aud-info').textContent = bits.join(' · ') + '. ' + (i.reason || '');
}

/** The sound slice of NHLPA 93 / NHL 94 placed at its ROM offset, fetched once. */
async function audImage(game) {
  if (aud.images[game]) return aud.images[game];
  const c = GAME_9X[game];
  const res = await fetch(new URL('data/fixtures/' + c.slice, document.baseURI).href);
  if (!res.ok) throw new Error(c.label + ' sound fixture missing (' + res.status + ')');
  const image = new Uint8Array(c.size);
  image.set(new Uint8Array(await res.arrayBuffer()), c.start);
  aud.images[game] = image;
  return image;
}

async function audRender(sides) {
  const out = [];
  if (aud.game === '92') {
    const A = window.Nhl92Z80Audio;
    const env = {
      rom: nhl.rom,
      renderScript: (script) => {
        nhl.chip.loadState(nhl.pristine);
        return A.create({ program: nhl.program, rom: nhl.rom, chip: nhl.chip }).play(script);
      }
    };
    for (const side of sides) out.push(await Nhl92GmAudition.renderSide(side, env));
    return out;
  }
  const game = Number(aud.game);
  const env = {
    game,
    image: await audImage(aud.game),
    driver: window[GAME_9X[aud.game].driver],
    newChip: () => {
      const chip = new aud.Ym2612(ymChip.module, ymChip.api.create(), ymChip.api);
      chip.reset();
      return chip;
    },
    newPsg: () => NhlSn76489.create({ clock: 3579545 })
  };
  for (const side of sides) {
    await new Promise((r) => setTimeout(r, 20)); // let the "Rendering…" text paint before the emulators run
    out.push(Nhl9xGmAudition.renderSide(side, env));
  }
  return out;
}

async function audPlay(mode) {
  const meter = el('aud-meter');
  if (!audMap() || !nhl.chip) {
    meter.textContent = 'Still loading…';
    return;
  }
  if (!ctx) ensureAudioGraph();
  if (ctx.state === 'suspended') await ctx.resume();
  stopAudition();
  const pl = audPlan(mode === 'ru');
  const sides = mode === 'a' ? [pl.picked] : mode === 'b' || mode === 'ru' ? [pl.mapped] : [pl.picked, pl.mapped];
  meter.textContent = 'Rendering…';
  const bufs = await audRender(sides);
  const mono = bufs.length === 2 ? audLib().join(bufs[0], bufs[1], 0.5) : bufs[0];
  const rate = audLib().SAMPLE_RATE;
  const buf = ctx.createBuffer(1, mono.length, rate);
  buf.getChannelData(0).set(mono);
  aud.source = ctx.createBufferSource();
  aud.source.buffer = buf;
  aud.source.connect(ctx.destination);
  aud.source.start();
  const label = (side) => (aud.game === '92' ? Nhl92GmAudition.sideLabel(side) : Nhl9xGmAudition.sideLabel(side, Number(aud.game)));
  meter.textContent = sides.map(label).join('  →  ') + ' · ' + (mono.length / rate).toFixed(1) + ' s';
}

function stopAudition() {
  if (aud.source) {
    try { aud.source.stop(); } catch (e) { /* already stopped */ }
    aud.source = null;
  }
}

async function initAudition() {
  const [r92, r9x] = await Promise.all([
    fetch(new URL('data/audio/nhl92-gm-map.json', document.baseURI).href),
    fetch(new URL('data/audio/nhl9x-gm-map.json', document.baseURI).href)
  ]);
  if (!r92.ok) throw new Error('mapping JSON missing (' + r92.status + ')');
  if (!r9x.ok) throw new Error('NHLPA 93 / NHL 94 mapping JSON missing (' + r9x.status + ')');
  aud.map = await r92.json();
  aud.map9x = await r9x.json();
  audFillPicks();
  el('aud-meter').textContent = 'Ready — pick something and press Play';
}

function audSetGame() {
  stopAudition();
  aud.game = el('aud-game').value;
  el('aud-title-game').textContent = audGameName();
  if (audMap()) audFillPicks();
}

el('aud-game').addEventListener('change', audSetGame);
el('aud-dir').addEventListener('change', () => audMap() && audFillPicks());
el('aud-pick').addEventListener('change', () => audMap() && audShowInfo());
for (const [id, mode] of [['aud-both', 'both'], ['aud-a', 'a'], ['aud-b', 'b'], ['aud-ru', 'ru']]) {
  el(id).addEventListener('click', () => {
    audPlay(mode).catch((err) => {
      el('aud-meter').textContent = err && err.message ? err.message : 'Render failed';
      console.error(err);
    });
  });
}
el('aud-stop').addEventListener('click', stopAudition);

initEngine().catch((err) => {
  engineReady = false;
  statusEl.textContent = 'Init failed: ' + (err && err.message ? err.message : String(err));
  console.error(err);
});
