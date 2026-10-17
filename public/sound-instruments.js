/**
 * NHL '92 Audio section: DAC samples, instruments (the 22 Z80 patches) and the NHL '92 <-> General MIDI
 * mapping audition. Each plays through the game's own Z80 sound driver on a dedicated YM2612, rendered
 * offline and then played (the same path the Chip lab used to have). sound-test-view.js lists the entries
 * and hands the selected one to render(); toggle() starts and stops it.
 */
(function (root) {
  const A = () => root.Nhl92Z80Audio;
  const AUD = () => root.Nhl92GmAudition;
  const NAMES = () => root.Nhl92SfxNames;

  const GROUP_DAC = 'DAC samples';
  const GROUP_INST = 'Instruments';
  const MAPPING = 'inst-mapping';

  // The Chip lab's NHL '92 picker: a YM2612 restored to its pristine saved state before every render,
  // so each render is reproducible.
  const nhl = { chip: null, pristine: null, program: null, rom: null };
  let ctx = null;
  let source = null; // the buffer source that is playing
  let playingId = '';
  let url = null; // object URL of the last WAV
  let host = null;
  let map = null; // data/audio/nhl92-gm-map.json
  let mapError = '';
  let onChange = null;

  const hex = (n, w) => n.toString(16).toUpperCase().padStart(w || 0, '0');
  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /** Called once the NHL '92 ROM image and the YM2612 runtime are loaded. */
  function init(rom, Ym, hostApi) {
    host = hostApi;
    if (nhl.rom === rom && nhl.chip) return;
    nhl.rom = rom;
    nhl.program = root.Nhl92SoundFixture.getEmbeddedZ80Program();
    if (!nhl.program) throw new Error('Z80 program missing from sound fixture');
    nhl.chip = new Ym.Chip(Ym.module, Ym.api.create(), Ym.api);
    nhl.chip.reset();
    nhl.pristine = nhl.chip.saveState();
    if (map || mapError) return;
    fetch(new URL('data/audio/nhl92-gm-map.json', document.baseURI).href)
      .then((res) => { if (!res.ok) throw new Error('mapping JSON missing (' + res.status + ')'); return res.json(); })
      .then((m) => { map = m; if (onChange) onChange(); })
      .catch((err) => { mapError = err && err.message ? err.message : String(err); });
  }

  const ready = () => !!(nhl.chip && nhl.program && nhl.rom);

  const isId = (id) => id === MAPPING || /^(dac|patch)-\d+$/.test(id);
  const index = (id) => Number(id.split('-')[1]);

  /** SFX ID that starts this DAC sample (the first of the IDs that share a handler), or -1. */
  function sfxIdOf(entry) {
    if (!ready() || !root.Nhl92GmMap) return -1;
    for (let id = 0; id < 35; id++) if (root.Nhl92GmMap.sfxHandler(nhl.rom, id) === entry.rom) return id;
    return -1;
  }

  function dacTitle(i) {
    const entry = A().DAC_SFX[i];
    const id = sfxIdOf(entry);
    return entry.name + (id >= 0 ? ' · SFX ' + id : '');
  }

  function patchTitle(i) {
    return 'Patch ' + String(i).padStart(2, '0');
  }

  function title(id) {
    if (id === MAPPING) return 'Mapping audition · NHL \'92 ↔ General MIDI';
    return id.startsWith('dac-') ? 'DAC sample · ' + dacTitle(index(id)) : 'Instrument · ' + patchTitle(index(id));
  }

  /** List rows. DAC samples and instruments are collapsible groups. */
  function entries() {
    if (!ready()) return [];
    const out = [];
    A().DAC_SFX.forEach((entry, i) => {
      const id = sfxIdOf(entry);
      const desc = id >= 0 ? NAMES().describe(id) : 'stops the DAC';
      out.push({
        id: 'dac-' + i, group: GROUP_DAC, collapsible: true,
        label: entry.name, sub: (id >= 0 ? 'SFX ' + id + ' · ' : '') + desc + ' · rate $' + hex(entry.rate) + ' · pri ' + entry.priority
      });
    });
    out.push({ id: MAPPING, group: GROUP_INST, collapsible: true, label: 'Mapping audition', sub: 'hear a patch next to its General MIDI match' });
    for (let i = 0; i < A().PATCH_COUNT; i++) {
      const at = A().patchAddress(i);
      const algFb = nhl.program[at + 24];
      out.push({
        id: 'patch-' + i, group: GROUP_INST, collapsible: true,
        label: patchTitle(i), sub: '$' + hex(at, 4) + ' · alg ' + (algFb & 7) + ' fb ' + ((algFb >> 3) & 7)
      });
    }
    return out;
  }

  function metaRows(id) {
    if (!ready()) return [['Audio', 'loading']];
    if (id === MAPPING) {
      return [['Tool', title(id)], ['Plays on', 'the retail Z80 driver → YM2612, next to a plain GM stand-in synth'], ['Mapping', 'data/audio/nhl92-gm-map.json'], ['Notes', 'docs/NHL92-GM-MAP.md']];
    }
    const rows = [['Plays', title(id)]];
    if (id.startsWith('dac-')) {
      const entry = A().DAC_SFX[index(id)];
      const sfx = sfxIdOf(entry);
      if (sfx >= 0) rows.push(['SFX', sfx + ' · ' + NAMES().describe(sfx)]);
      rows.push(['Handler', '$' + hex(entry.rom)]);
      rows.push(['Sample', 'Hockey.snd +$' + hex(entry.off) + ' (ROM $' + hex(A().SOUND_BASE + entry.off) + ')']);
      rows.push(['Rate', '$' + hex(entry.rate) + ' · priority ' + entry.priority]);
    } else {
      const at = A().patchAddress(index(id));
      rows.push(['Z80 address', '$' + hex(at, 4)]);
      rows.push(['Plays', 'a C-major scale on channel 1']);
    }
    rows.push(['Path', 'Z80 driver → YM2612, rendered offline']);
    rows.push(['Output', A().SAMPLE_RATE + ' Hz']);
    return rows;
  }

  function describe(id) {
    if (id === MAPPING) return 'Pick a patch, GM program or GM drum, then hear it next to its mapped sound.';
    if (id.startsWith('dac-')) return 'The Z80 driver streams this sample to the YM2612 DAC at its handler\'s rate, as the game does when the 68k requests it.';
    return 'The retail Z80 driver plays a C-major scale on this patch through the YM2612.';
  }

  // --- Playback ---------------------------------------------------------------------------------------

  function ensureContext() {
    if (ctx) return;
    ctx = new (root.AudioContext || root.webkitAudioContext)();
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
    gain.gain.value = host && host.volume != null ? host.volume() : 0.8;
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

  function sfxFrames(entry) {
    const start = A().SOUND_BASE + entry.off + 1;
    let n = 0;
    while (nhl.rom[start + n] !== 0) n += 1;
    return Math.ceil((n * (161 + 17 * (entry.rate || 256))) / A().FRAME_TSTATES) + 30;
  }

  async function playItem(id, ui) {
    if (!ready()) throw new Error('Still loading the driver…');
    if (host) host.stopLive();
    stop();
    ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
    let script;
    let label;
    if (id.startsWith('dac-')) {
      const entry = A().DAC_SFX[index(id)];
      script = A().sfxScript(entry, { frames: sfxFrames(entry) });
      label = 'sfx-' + hex(entry.rom).toLowerCase() + '-' + entry.name.split(' ')[0];
    } else {
      script = A().patchScaleScript(nhl.rom, index(id));
      label = 'patch-' + String(index(id)).padStart(2, '0');
    }
    if (ui) ui.meter.textContent = 'Rendering ' + label + ' through the Z80 driver…';
    await new Promise((r) => setTimeout(r, 20));
    const t0 = root.performance.now();
    const pcm = render(script);
    const ms = Math.round(root.performance.now() - t0);
    const frames = pcm.length / 2;
    const buf = ctx.createBuffer(2, frames, A().SAMPLE_RATE);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    for (let i = 0; i < frames; i++) {
      L[i] = pcm[i * 2] / 32768;
      R[i] = pcm[i * 2 + 1] / 32768;
    }
    connect(buf, id);
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(new Blob([root.NhlWav.encode16(pcm, A().SAMPLE_RATE, 2)], { type: 'audio/wav' }));
    if (ui) {
      ui.link.href = url;
      ui.link.download = label + '.wav';
      ui.link.hidden = false;
      ui.meter.textContent = label + ' · ' + (frames / A().SAMPLE_RATE).toFixed(2) + ' s · rendered in ' + ms + ' ms';
    }
  }

  // --- Mapping audition (lib/audio/nhl92-gm-audition.js) ----------------------------------------------

  function audText(t) {
    if (!t) return 'none';
    if (t.kind === 'program') return 'GM ' + t.program + ' ' + t.name;
    if (t.kind === 'drum') return 'drum ' + t.note + ' ' + t.name;
    if (t.kind === 'patch') return 'patch ' + t.patch + (t.midi != null ? ' @ MIDI ' + t.midi : '');
    return 'DAC SFX ' + t.sfx + (t.label ? ' (' + t.label + ')' : '');
  }

  async function playAudition(mode, ui) {
    if (!map || !ready()) {
      ui.meter.textContent = 'Still loading…';
      return;
    }
    if (host) host.stopLive();
    stop();
    ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const plan = AUD().plan(map, ui.dir.value, Number(ui.pick.value), mode === 'ru');
    const sides = mode === 'a' ? [plan.picked] : mode === 'b' || mode === 'ru' ? [plan.mapped] : [plan.picked, plan.mapped];
    ui.meter.textContent = 'Rendering…';
    await new Promise((r) => setTimeout(r, 20));
    const env = { rom: nhl.rom, renderScript: (script) => render(script) };
    const bufs = [];
    for (const side of sides) bufs.push(await AUD().renderSide(side, env));
    const mono = bufs.length === 2 ? AUD().join(bufs[0], bufs[1], 0.5) : bufs[0];
    const rate = AUD().SAMPLE_RATE;
    const buf = ctx.createBuffer(1, mono.length, rate);
    buf.getChannelData(0).set(mono);
    connect(buf, MAPPING);
    ui.meter.textContent = sides.map(AUD().sideLabel).join('  →  ') + ' · ' + (mono.length / rate).toFixed(1) + ' s';
  }

  function renderMapping(box) {
    box.appendChild(make('p', 'st-kind', 'Instruments'));
    box.appendChild(make('h3', null, title(MAPPING)));
    box.appendChild(make('p', 'st-note', 'Hear a pick next to its mapped sound. The NHL \'92 side is the retail driver; the GM side is a basic stand-in synth, not a real GM sound set, so judge the NHL \'92 sound against the name. Both sides play at the same level. Matches live in data/audio/nhl92-gm-map.json.'));
    if (!map) {
      box.appendChild(make('p', 'st-note', mapError ? 'Mapping unavailable: ' + mapError : 'Loading mapping…'));
      return;
    }
    const dir = make('select');
    dir.setAttribute('aria-label', 'Direction');
    [['n2g', 'NHL \'92 patch → GM'], ['g2n', 'GM program → NHL \'92'], ['drum', 'GM drum → NHL \'92']].forEach(([v, t]) => {
      const o = make('option', null, t);
      o.value = v;
      dir.appendChild(o);
    });
    const pick = make('select');
    pick.setAttribute('aria-label', 'Pick');
    const info = make('p', 'st-note mono');
    const meter = make('p', 'st-note mono', 'Ready — pick something and press Play');
    const ui = { dir, pick, meter };
    const plan = () => AUD().plan(map, dir.value, Number(pick.value), false);
    const showInfo = () => {
      const i = plan().info;
      const bits = ['Match: ' + audText(i.match), 'runner-up: ' + audText(i.runnerUp)];
      if (i.confidence) bits.push('sure: ' + i.confidence);
      if (i.fit) bits.push('fit: ' + i.fit);
      bits.push('from ' + i.source);
      info.textContent = bits.join(' · ') + '. ' + (i.reason || '');
    };
    const fillPicks = () => {
      pick.textContent = '';
      const groups = {};
      AUD().picks(map, dir.value).forEach((p) => {
        const opt = make('option', null, p.label);
        opt.value = String(p.value);
        let parent = pick;
        if (p.group) {
          if (!groups[p.group]) {
            groups[p.group] = make('optgroup');
            groups[p.group].label = p.group;
            pick.appendChild(groups[p.group]);
          }
          parent = groups[p.group];
        }
        parent.appendChild(opt);
      });
      showInfo();
    };
    dir.addEventListener('change', fillPicks);
    pick.addEventListener('change', showInfo);
    const row = make('div', 'st-controls');
    const dl = make('label', 'st-volume');
    dl.append(make('span', null, 'Direction'), dir);
    const pl = make('label', 'st-volume');
    pl.append(make('span', null, 'Pick'), pick);
    row.append(dl, pl);
    box.append(row, info);
    const buttons = make('div', 'st-controls');
    [['both', 'Play pick, then match', true], ['a', 'Pick only'], ['b', 'Match only'], ['ru', 'Runner-up only']].forEach(([mode, text, primary]) => {
      const b = make('button', 'ghost-btn' + (primary ? ' st-toggle' : ''), (primary ? '▶ ' : '') + text);
      b.type = 'button';
      b.addEventListener('click', () => {
        playAudition(mode, ui).catch((err) => { meter.textContent = err && err.message ? err.message : 'Render failed'; });
      });
      buttons.appendChild(b);
    });
    const stopBtn = make('button', 'ghost-btn', '■ Stop');
    stopBtn.type = 'button';
    stopBtn.addEventListener('click', stop);
    buttons.appendChild(stopBtn);
    box.append(buttons, meter);
    box.querySelector('.st-toggle').id = 'sound-test-toggle';
    fillPicks();
    lastToggle = { play: () => playAudition('both', ui) };
  }

  /** Fill the Audio panel for a DAC sample, instrument or the mapping audition. */
  function renderPanel(box, id) {
    box.replaceChildren();
    box.dataset.item = id;
    if (!ready()) {
      box.appendChild(make('p', 'st-note', 'Loading audio…'));
      return;
    }
    if (id === MAPPING) {
      renderMapping(box);
      return;
    }
    const isDac = id.startsWith('dac-');
    box.appendChild(make('p', 'st-kind', isDac ? 'DAC sample' : 'Instrument'));
    box.appendChild(make('h3', null, isDac ? dacTitle(index(id)) : patchTitle(index(id))));
    if (isDac) {
      const sfx = sfxIdOf(A().DAC_SFX[index(id)]);
      if (sfx >= 0) box.appendChild(make('p', 'st-note', NAMES().describe(sfx)));
    }
    const controls = make('div', 'st-controls');
    const btn = make('button', 'ghost-btn st-toggle', '▶ Play');
    btn.type = 'button';
    btn.id = 'sound-test-toggle';
    btn.setAttribute('aria-pressed', 'false');
    const link = make('a', 'download', 'Download WAV');
    link.hidden = true;
    const meter = make('p', 'st-note mono', 'Ready — press Play');
    const ui = { meter, link };
    btn.addEventListener('click', () => { toggle(id, ui).catch((err) => { meter.textContent = err && err.message ? err.message : 'Render failed'; }); });
    controls.append(btn, link);
    box.append(controls, make('p', 'st-note', describe(id)), meter);
    panelUi = { id, btn, ui };
    sync();
  }

  let panelUi = null;
  let lastToggle = null;

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
    if (id === MAPPING) return lastToggle ? lastToggle.play() : Promise.resolve();
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
