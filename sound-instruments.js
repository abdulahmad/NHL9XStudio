/**
 * NHL '92 Audio section: the raw DAC samples (the PCM files the game ships) and the 22 Z80 instrument patches.
 * A sample is played from its ROM bytes at the rate of the SFX handler that starts it; a patch plays a C-major scale
 * through the game's Z80 sound driver on a dedicated YM2612 (rendered offline, then played). sound-test-view.js lists
 * the entries and hands the selected one to renderPanel(); toggle() starts and stops it.
 */
(function (root) {
  const A = () => root.Nhl92Z80Audio;
  const PCM = () => root.Nhl92Pcm;
  const NAMES = () => root.Nhl92SfxNames;

  const GROUP_DAC = root.NhlAudioCategories.CATEGORY.samples;
  const GROUP_INST = root.NhlAudioCategories.CATEGORY.instruments;
  const Z80_HZ = 3579545;

  // A YM2612 restored to its pristine saved state before every render, so each render is reproducible.
  const nhl = { chip: null, pristine: null, program: null, rom: null };
  const N93 = () => root.Nhl93Names;
  let mode = 'nhl92'; // 'nhl92': DAC samples and instrument patches; 'nhlpa93': the DAC samples (the game's PCM files) only
  let ctx = null;
  let source = null; // the buffer source that is playing
  let playingId = '';
  let urls = [];
  let host = null;
  let map = null; // data/audio/nhl92-gm-map.json (the General MIDI match shown in each patch's description)
  let onChange = null;
  let panelUi = null;

  const hex = (n, w) => n.toString(16).toUpperCase().padStart(w || 0, '0');
  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /** Called once the NHL '92 ROM image and the YM2612 runtime are loaded. */
  function init(rom, Ym, hostApi, game) {
    host = hostApi;
    mode = game === 'nhlpa93' ? 'nhlpa93' : 'nhl92';
    if (mode === 'nhlpa93') {
      nhl.rom = rom;
      return;
    }
    if (nhl.rom === rom && nhl.chip) return;
    nhl.rom = rom;
    nhl.program = root.Nhl92SoundFixture.getEmbeddedZ80Program();
    if (!nhl.program) throw new Error('Z80 program missing from sound fixture');
    nhl.chip = new Ym.Chip(Ym.module, Ym.api.create(), Ym.api);
    nhl.chip.reset();
    nhl.pristine = nhl.chip.saveState();
    if (map) return;
    fetch(new URL('data/audio/nhl92-gm-map.json', document.baseURI).href)
      .then((res) => (res.ok ? res.json() : null))
      .then((m) => { map = m; if (m && onChange) onChange(); })
      .catch(() => { map = null; });
  }

  const ready = () => (mode === 'nhlpa93' ? !!nhl.rom : !!(nhl.chip && nhl.program && nhl.rom));

  const isId = (id) => /^(dac|patch)-\d+$/.test(id);
  const index = (id) => Number(id.split('-')[1]);

  // --- DAC samples: the raw PCM files -------------------------------------------------------------------

  /** The raw samples of the loaded game (NHL 92 or NHLPA 93). */
  const samples = () => (mode === 'nhlpa93' ? N93().PCM : PCM().SAMPLES);

  /** Sample bytes before the 00 terminator (or the whole range when it has none). */
  function sampleLength(sample) {
    let n = 0;
    while (sample.start + n < sample.end && nhl.rom[sample.start + n] !== 0) n += 1;
    return n;
  }

  /** SFX that start this sample: [{ id, label, rate }] (the handlers of the retail driver, via the SFX table). */
  function usedBy(sample) {
    const out = [];
    if (mode === 'nhlpa93') return out;
    if (!ready() || !root.Nhl92GmMap) return out;
    for (let id = 0; id < 35; id++) {
      const handler = root.Nhl92GmMap.sfxHandler(nhl.rom, id);
      const entry = A().DAC_SFX.find((e) => e.rom === handler && A().SOUND_BASE + e.off === sample.start);
      if (entry && !out.some((o) => o.handler === handler)) out.push({ id, label: NAMES().label(id), rate: entry.rate, handler });
    }
    return out;
  }

  /** Playback rate in Hz of a DAC byte stream started with the driver rate `rate` (one byte per 161 + 17*rate Z80 T-states). */
  const rateHz = (rate) => Z80_HZ / (161 + 17 * rate);

  function sampleOf(id) { return samples()[index(id)]; }

  function dacSub(sample) {
    if (mode === 'nhlpa93') {
      return sample.name + '.bin · $' + hex(sample.start) + '-$' + hex(sample.end - 1) + ' · ' + sampleLength(sample) + ' bytes' +
        (sample.from92 ? ' · 92 ' + sample.from92 : ' · no 92 equivalent');
    }
    const users = usedBy(sample);
    const n = sampleLength(sample);
    return sample.name + '.bin · $' + hex(sample.start) + '-$' + hex(sample.end - 1) + ' · ' + n + ' bytes' +
      (users.length ? ' · ' + users.map((u) => u.id + ' ' + u.label).join(', ') : '');
  }

  // --- Instruments: the Z80 patches ---------------------------------------------------------------------

  function patchMatch(i) {
    if (!map) return null;
    const e = map.nhl92ToGm.patches.find((p) => p.patch === i);
    return e ? e : null;
  }

  function targetText(t) {
    if (!t) return '';
    if (t.kind === 'program') return t.name + ' (GM program ' + t.program + ')';
    if (t.kind === 'drum') return t.name + ' (GM drum ' + t.note + ')';
    return t.label || t.kind;
  }

  /** "Maps to Synth Brass 2 (GM program 63)", from the NHL '92 -> General MIDI table. */
  function mapsTo(i) {
    const e = patchMatch(i);
    return e ? 'Maps to ' + targetText(e.target) : '';
  }

  const patchTitle = (i) => 'Patch ' + String(i).padStart(2, '0');

  function title(id) {
    return id.startsWith('dac-') ? 'DAC sample · ' + sampleOf(id).name : 'Instrument · ' + patchTitle(index(id));
  }

  /** List rows. DAC samples and instruments are collapsible groups. */
  function entries() {
    if (!ready()) return [];
    const out = [];
    samples().forEach((sample, i) => {
      out.push({ id: 'dac-' + i, group: GROUP_DAC, collapsible: true, label: sample.name, sub: dacSub(sample) });
    });
    if (mode === 'nhlpa93') return out;
    for (let i = 0; i < A().PATCH_COUNT; i++) {
      const at = A().patchAddress(i);
      const algFb = nhl.program[at + 24];
      const to = mapsTo(i);
      out.push({
        id: 'patch-' + i, group: GROUP_INST, collapsible: true, label: patchTitle(i),
        sub: '$' + hex(at, 4) + ' · alg ' + (algFb & 7) + ' fb ' + ((algFb >> 3) & 7) + (to ? ' · ' + to : '')
      });
    }
    return out;
  }

  function metaRows(id) {
    if (!ready()) return [['Audio', 'loading']];
    const rows = [['Plays', title(id)]];
    if (id.startsWith('dac-')) {
      const s = sampleOf(id);
      if (mode === 'nhlpa93') {
        rows.push(['File', s.name + '.bin (as extracted by NHLPA93Genesis)']);
        rows.push(['ROM', '$' + hex(s.start) + '-$' + hex(s.end - 1) + ' (retail)']);
        rows.push(['Format', 'unsigned 8-bit, ' + sampleLength(s) + ' bytes then 00']);
        rows.push(['92 sample', s.from92 || 'none']);
        rows.push(['Started by', s.uses.map((id) => '$' + hex(id) + ' ' + N93().SFX[id][0]).join(', ')]);
        rows.push(['Path', 'ROM bytes at a nominal 8 kHz']);
        return rows;
      }
      rows.push(['File', s.name + '.bin (as extracted by NHL92Genesis)']);
      rows.push(['ROM', '$' + hex(s.start) + '-$' + hex(s.end - 1) + ' (Hockey.snd +$' + hex(s.start - A().SOUND_BASE) + ')']);
      rows.push(['Format', 'unsigned 8-bit, ' + sampleLength(s) + ' bytes then 00 00']);
      const users = usedBy(s);
      if (users.length) rows.push(['Started by', users.map((u) => 'SFX ' + u.id + ' ' + u.label + ' (rate $' + hex(u.rate) + ', ' + Math.round(rateHz(u.rate)) + ' Hz)').join('; ')]);
      rows.push(['Path', 'ROM bytes, played at the first SFX\'s rate']);
    } else {
      const i = index(id);
      rows.push(['Z80 address', '$' + hex(A().patchAddress(i), 4)]);
      const to = mapsTo(i);
      if (to) rows.push(['General MIDI', to.replace(/^Maps to /, '')]);
      rows.push(['Plays', 'a C-major scale on channel 1']);
      rows.push(['Path', 'Z80 driver → YM2612, rendered offline']);
      rows.push(['Output', A().SAMPLE_RATE + ' Hz']);
    }
    return rows;
  }

  function describe(id) {
    if (id.startsWith('dac-') && mode === 'nhlpa93') return 'The raw PCM file from the game. ' + N93().pcmDescribe(sampleOf(id)) + ' Played from its ROM bytes at a nominal 8 kHz (the 93 driver picks the rate per sound).';
    if (id.startsWith('dac-')) {
      const s = sampleOf(id);
      const users = usedBy(s);
      return 'The raw PCM file from the game' + (users.length
        ? ', started by ' + users.map((u) => 'SFX ' + u.id + ' ' + u.label + ' (' + NAMES().describe(u.id) + ')').join(', ')
        : '') + '. Played from its ROM bytes at the rate of the first of those handlers.';
    }
    const i = index(id);
    const e = patchMatch(i);
    const to = mapsTo(i);
    return (to ? to + '. ' : '') + (e && e.character ? e.character + ' ' : '') + 'The retail Z80 driver plays a C-major scale on this patch through the YM2612.';
  }

  // --- Playback -----------------------------------------------------------------------------------------

  function ensureContext() {
    if (!ctx) ctx = new (root.AudioContext || root.webkitAudioContext)();
  }

  function stop() {
    if (source) {
      try { source.stop(); } catch (err) { /* already stopped */ }
      source = null;
    }
    if (playingId) {
      playingId = '';
      if (onChange) onChange();
    }
  }

  function connect(buf, id) {
    const gain = ctx.createGain();
    gain.gain.value = host && host.volume ? host.volume() : 0.8;
    source = ctx.createBufferSource();
    source.buffer = buf;
    source.connect(gain);
    gain.connect(ctx.destination);
    const mine = source;
    source.onended = () => { if (source === mine) { source = null; playingId = ''; if (onChange) onChange(); } };
    source.start();
    playingId = id;
    if (onChange) onChange();
  }

  function render(script) {
    nhl.chip.loadState(nhl.pristine);
    return A().create({ program: nhl.program, rom: nhl.rom, chip: nhl.chip }).play(script);
  }

  function offer(link, blob, name) {
    const url = URL.createObjectURL(blob);
    urls.push(url);
    link.href = url;
    link.download = name;
    link.hidden = false;
  }

  function freeUrls() {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
  }

  async function playItem(id, ui) {
    if (!ready()) throw new Error('Still loading the driver…');
    if (host) host.stopLive();
    stop();
    ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
    freeUrls();
    if (id.startsWith('dac-')) {
      const s = sampleOf(id);
      const users = usedBy(s);
      const hz = mode === 'nhlpa93' ? 8000 : Math.round(rateHz(users.length ? users[0].rate : 0x13));
      const raw = nhl.rom.slice(s.start, s.end);
      const n = sampleLength(s);
      const buf = ctx.createBuffer(1, n, hz);
      const ch = buf.getChannelData(0);
      const wav = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        ch[i] = (raw[i] - 128) / 128;
        wav[i] = (raw[i] - 128) * 256;
      }
      connect(buf, id);
      if (ui) {
        offer(ui.link, new Blob([raw], { type: 'application/octet-stream' }), s.name + '.bin');
        offer(ui.wavLink, new Blob([root.NhlWav.encode16(wav, hz, 1)], { type: 'audio/wav' }), s.name + '.wav');
        ui.meter.textContent = s.name + ' · ' + n + ' bytes at ' + hz + ' Hz · ' + (n / hz).toFixed(2) + ' s';
      }
      return;
    }
    const i = index(id);
    const label = 'patch-' + String(i).padStart(2, '0');
    if (ui) ui.meter.textContent = 'Rendering ' + label + ' through the Z80 driver…';
    await new Promise((r) => setTimeout(r, 20));
    const t0 = root.performance.now();
    const pcm = render(A().patchScaleScript(nhl.rom, i));
    const ms = Math.round(root.performance.now() - t0);
    const frames = pcm.length / 2;
    const buf = ctx.createBuffer(2, frames, A().SAMPLE_RATE);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    for (let k = 0; k < frames; k++) {
      L[k] = pcm[k * 2] / 32768;
      R[k] = pcm[k * 2 + 1] / 32768;
    }
    connect(buf, id);
    if (ui) {
      offer(ui.wavLink, new Blob([root.NhlWav.encode16(pcm, A().SAMPLE_RATE, 2)], { type: 'audio/wav' }), label + '.wav');
      ui.meter.textContent = label + ' · ' + (frames / A().SAMPLE_RATE).toFixed(2) + ' s · rendered in ' + ms + ' ms';
    }
  }

  /** Fill the Audio panel for a DAC sample or an instrument. */
  function renderPanel(box, id) {
    box.replaceChildren();
    box.dataset.item = id;
    if (!ready()) {
      box.appendChild(make('p', 'st-note', 'Loading audio…'));
      return;
    }
    const isDac = id.startsWith('dac-');
    box.appendChild(make('p', 'st-kind', isDac ? 'DAC sample' : 'Instrument'));
    box.appendChild(make('h3', null, isDac ? sampleOf(id).name : patchTitle(index(id))));
    box.appendChild(make('p', 'st-note', describe(id)));
    const controls = make('div', 'st-controls');
    const btn = make('button', 'ghost-btn st-toggle', '▶ Play');
    btn.type = 'button';
    btn.id = 'sound-test-toggle';
    btn.setAttribute('aria-pressed', 'false');
    const link = make('a', 'download', 'Download .bin');
    link.hidden = true;
    const wavLink = make('a', 'download', 'Download WAV');
    wavLink.hidden = true;
    const meter = make('p', 'st-note mono', 'Ready — press Play');
    const ui = { meter, link, wavLink };
    btn.addEventListener('click', () => { toggle(id, ui).catch((err) => { meter.textContent = err && err.message ? err.message : 'Playback failed'; }); });
    controls.append(btn, link, wavLink);
    box.append(controls, meter);
    panelUi = { id, btn, ui };
    sync();
  }

  function sync() {
    if (!panelUi) return;
    const on = playingId === panelUi.id;
    panelUi.btn.textContent = on ? '■ Stop' : '▶ Play';
    panelUi.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /** Space / Enter / the Play button: start the item, or stop it if it is the one playing. */
  function toggle(id, ui) {
    if (playingId === id) {
      stop();
      return Promise.resolve();
    }
    return playItem(id, ui || (panelUi && panelUi.id === id ? panelUi.ui : null));
  }

  root.NhlSoundInstruments = {
    init,
    isId,
    entries,
    title,
    metaRows,
    renderPanel,
    toggle,
    stop,
    get ready() { return ready(); },
    get playingId() { return playingId; },
    set onChange(fn) { onChange = typeof fn === 'function' ? (() => { fn(); sync(); }) : null; }
  };
})(typeof self !== 'undefined' ? self : this);
