/**
 * Plain NHL '92 sound test: pick a song (0-4) or SFX (0-34), Play / Stop. Audio is
 * rendered live, frame by frame, by lib/audio/nhl92-sound-chain.js: the retail 68k
 * driver, the shared Z80 RAM, the retail Z80 driver, the YM2612 (ymfm WASM) and the
 * SN76489, the same path as tools/render-nhl92-sound-chain.js. viewer.js owns state
 * and calls in here.
 */
(function (root) {
  const Chain = () => root.Nhl92SoundChain;
  const SD = () => root.Nhl92SoundData;
  const NAMES = () => root.Nhl92SfxNames;
  const SFX_VBLANKS = 600;
  const BLOCK = 4096;
  const Z80_HZ = 3579545;

  let rom = null;
  let data = null;
  let Ym = null; // { Chip, module, api }
  let error = '';
  let loading = null;
  let ctx = null;
  let node = null;
  let live = null;
  let panel = null;
  let lastStatus = 0;
  const VOLUME_KEY = 'nhl9x.soundTest.volume';
  let gain = null;
  let volume = loadVolume();
  let onChange = null;

  /** Output level only (a GainNode after the chain); the rendered samples are untouched. */
  function loadVolume() {
    try {
      const raw = root.localStorage.getItem(VOLUME_KEY);
      const v = Number(raw);
      if (raw != null && raw !== '' && v >= 0 && v <= 1) return v;
    } catch (err) { /* storage blocked: default */ }
    return 0.8;
  }

  async function loadYm() {
    const base = new URL('lib/audio/generated/', document.baseURI).href;
    const { Ym2612 } = await import(new URL('ym2612-runtime.js', base).href);
    const { default: moduleFactory } = await import(new URL('ym2612_wasm.js', base).href);
    const res = await fetch(new URL('ym2612_wasm.wasm', base).href);
    if (!res.ok) throw new Error('YM2612 WASM fetch failed (' + res.status + ')');
    const shared = await Ym2612.create({ moduleFactory, moduleOptions: { wasmBinary: new Uint8Array(await res.arrayBuffer()) } });
    return { Chip: Ym2612, module: shared.module, api: shared.api };
  }

  async function ensure(baseUrl) {
    if (rom && Ym) return true;
    if (loading) return loading;
    loading = (async () => {
      rom = await root.Nhl92SoundFixture.ensureSyntheticRom({ baseUrl });
      data = SD().parse(rom);
      Ym = await loadYm();
      error = '';
      return true;
    })().catch((err) => {
      error = err && err.message ? err.message : String(err);
      loading = null;
      throw err;
    });
    return loading;
  }

  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function entries() {
    if (!data) return [];
    const out = [];
    for (const s of data.songs) out.push({ id: 'song-' + s.id, group: 'Songs', label: s.id + ' · ' + s.name, sub: 'song ' + s.id + ' · loops until Stop' });
    for (const s of data.sfx) {
      const kinds = s.actions.map((a) => (a.type === 'dac' ? 'DAC' : 'FM ch' + a.channel)).join(' + ');
      out.push({ id: 'sfx-' + s.id, group: 'SFX', label: NAMES().name(s.id), sub: kinds + ' · ' + SFX_VBLANKS + ' vblanks' });
    }
    return out;
  }

  function title(id) {
    const n = Number(id.split('-')[1]);
    return id.startsWith('song-') ? 'Song ' + n + ' · ' + data.songs[n].name : 'SFX ' + NAMES().name(n);
  }

  /** Plans for live playback; the siren's matches sfx-00-siren-SFXsiren-after-music-off.wav. */
  function planFor(id) {
    const n = Number(id.split('-')[1]);
    if (id.startsWith('song-')) return Chain().songPlan(n, Infinity);
    // Siren uses instrument 0, which equals every channel's $41 after a bare boot, so it
    // would skip its patch load. Play it the way the game reaches it: music initialised,
    // then p_turnoff, then the SFX (sfxPlanAfterMusicOff). No song note is ever parsed.
    // Other SFX use instruments != 0, so their output is the same either way; they keep
    // sfxPlan, which matches the pinned offline renders.
    if (n === 0) return Chain().sfxPlanAfterMusicOff(0, SFX_VBLANKS, 0);
    return Chain().sfxPlan(n, SFX_VBLANKS);
  }

  function ensureContext() {
    if (ctx) return;
    ctx = new (root.AudioContext || root.webkitAudioContext)();
    node = ctx.createScriptProcessor(BLOCK, 0, 2);
    gain = ctx.createGain();
    gain.gain.value = volume;
    node.onaudioprocess = (ev) => {
      const L = ev.outputBuffer.getChannelData(0);
      const R = ev.outputBuffer.getChannelData(1);
      if (!live) {
        L.fill(0);
        R.fill(0);
        return;
      }
      const out = live.resampler.process(L.length);
      L.set(out.left);
      R.set(out.right);
      if (live.done && live.queued === 0) stop('Finished');
      else status();
    };
    node.connect(gain);
    gain.connect(ctx.destination);
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (gain) gain.gain.value = volume;
    try { root.localStorage.setItem(VOLUME_KEY, String(volume)); } catch (err) { /* not kept */ }
  }

  /** Run chain frames until `n` source samples are queued (or the plan ends). */
  function pull(n) {
    const s = live;
    while (s.queued < n && !s.done) {
      const f = s.chain.frame;
      s.chain.step(s.plan.calls[f] || null);
      const pcm = s.chain.take();
      const L = new Float32Array(pcm.length / 2);
      const R = new Float32Array(pcm.length / 2);
      for (let i = 0, j = 0; i < L.length; i++) {
        L[i] = pcm[j++] / 32768;
        R[i] = pcm[j++] / 32768;
      }
      s.chunks.push([L, R]);
      s.queued += L.length;
      if (s.chain.frame >= s.plan.frames) s.done = true;
    }
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    let at = 0;
    while (at < n && s.chunks.length) {
      const [L, R] = s.chunks[0];
      const k = Math.min(n - at, L.length - s.offset);
      left.set(L.subarray(s.offset, s.offset + k), at);
      right.set(R.subarray(s.offset, s.offset + k), at);
      at += k;
      s.offset += k;
      s.queued -= k;
      if (s.offset === L.length) {
        s.chunks.shift();
        s.offset = 0;
      }
    }
    return { left, right };
  }

  async function play(id) {
    if (!rom || !Ym) throw new Error(error || 'Sound test still loading');
    stop();
    ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const chip = new Ym.Chip(Ym.module, Ym.api.create(), Ym.api);
    chip.reset();
    const chain = Chain().create({ rom, chip, psg: root.NhlSn76489.create(), keepLogs: false });
    live = { id, chip, chain, plan: planFor(id), chunks: [], offset: 0, queued: 0, done: false, message: '' };
    live.resampler = root.NhlChipResampler.create(Chain().SAMPLE_RATE, ctx.sampleRate, pull);
    status(true);
    if (onChange) onChange();
  }

  function stop(message) {
    if (!live) return;
    const s = live;
    live = null;
    s.chip.dispose();
    status(true, message || 'Stopped', s);
    if (onChange) onChange();
  }

  function toggle(id) {
    if (live && live.id === id) {
      stop();
      return Promise.resolve();
    }
    return play(id);
  }

  const secondsOf = (frames) => frames * Chain().FRAME_TSTATES / Z80_HZ;
  function clock(secs) {
    const m = Math.floor(secs / 60);
    const r = secs - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
  }

  /** Seconds of output that have left the queue (what the listener has heard, give or take a block). */
  function heard(s) {
    return Math.max(0, (s.chain.rendered - s.queued) / Chain().SAMPLE_RATE);
  }

  function status(force, message, ended) {
    const now = Date.now();
    if (!force && now - lastStatus < 250) return;
    lastStatus = now;
    if (!panel) return;
    const s = live || ended;
    const shown = s && s.id === panel.dataset.item ? s : null;
    const btn = panel.querySelector('.st-toggle');
    const bar = panel.querySelector('.st-bar');
    const time = panel.querySelector('.st-time');
    const box = panel.querySelector('.st-status');
    if (!btn || !box) return;
    const playing = !!(live && live.id === panel.dataset.item);
    btn.textContent = playing ? '■ Stop' : '▶ Play';
    btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    const id = panel.dataset.item;
    const total = id.startsWith('sfx-') ? secondsOf(planFor(id).frames) : null;
    if (!shown) {
      bar.style.width = '0%';
      time.textContent = total != null ? clock(0) + ' / ' + clock(total) : 'Loops until Stop';
      box.textContent = message || 'Stopped';
      return;
    }
    const secs = playing ? heard(shown) : (message === 'Finished' && total != null ? total : heard(shown));
    bar.style.width = total != null ? Math.min(100, (secs / total) * 100).toFixed(1) + '%' : (playing ? '100%' : '0%');
    bar.classList.toggle('is-loop', total == null && playing);
    time.textContent = total != null ? clock(secs) + ' / ' + clock(total) : clock(secs) + ' · loops until Stop';
    box.textContent = (message || 'Playing') + ' · frame ' + Math.max(0, shown.chain.frame - 1) + ' · ' +
      shown.chain.ymWrites + ' YM writes · ' + shown.chain.psgWrites + ' PSG writes';
  }

  function describe(id) {
    const n = id.slice(id.indexOf('-') + 1);
    if (id.startsWith('song-')) {
      return 'Boot (p_initialZ80, p_turnoff, p_music_vblank), then song(' + n + ') and p_music_vblank every vblank, until Stop.';
    }
    if (id === 'sfx-0') {
      return 'Boot, song(0) for one vblank (Sound_InitMusicTrack sets each channel\'s instrument to $FF; no notes yet), ' +
        'p_turnoff for one vblank (music off, as the game does at setup and on pause), then sfx(0) and p_music_vblank every vblank for ' +
        SFX_VBLANKS + ' vblanks. Without the init, siren\'s instrument 0 matches the cleared workspace and the driver skips its patch load (silent).';
    }
    return 'Boot, one vblank, then sfx(' + n + ') and p_music_vblank every vblank, for ' + SFX_VBLANKS + ' vblanks.';
  }

  function renderPanel(box, id) {
    panel = box;
    box.replaceChildren();
    box.dataset.item = id;
    if (!rom || !Ym) {
      box.appendChild(make('p', 'st-note', error ? 'Sound test failed to load: ' + error : 'Loading the sound test…'));
      return;
    }
    if (live && live.id !== id) stop();
    const n = Number(id.split('-')[1]);
    box.appendChild(make('p', 'st-kind', id.startsWith('song-') ? 'Song ' + n : 'SFX ' + n));
    box.appendChild(make('h3', null, id.startsWith('song-') ? data.songs[n].name : NAMES().name(n)));

    const controls = make('div', 'st-controls');
    const btn = make('button', 'ghost-btn st-toggle', '▶ Play');
    btn.type = 'button';
    btn.id = 'sound-test-toggle';
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      toggle(id).catch((err) => {
        const st = box.querySelector('.st-status');
        if (st) st.textContent = 'Playback failed: ' + (err && err.message ? err.message : String(err));
      });
    });
    const vol = make('label', 'st-volume');
    vol.appendChild(make('span', null, 'Volume'));
    const range = make('input');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.value = String(Math.round(volume * 100));
    range.setAttribute('aria-label', 'Volume');
    range.addEventListener('input', () => setVolume(Number(range.value) / 100));
    vol.appendChild(range);
    controls.append(btn, vol);
    box.appendChild(controls);

    const progress = make('div', 'st-progress');
    progress.appendChild(make('div', 'st-bar'));
    box.appendChild(progress);
    box.appendChild(make('p', 'st-time mono'));
    box.appendChild(make('p', 'st-status mono'));

    box.appendChild(make('p', 'st-note', describe(id)));
    box.appendChild(make('p', 'st-note', 'Rendered live from the retail code: 68k driver → Z80 RAM → Z80 driver → YM2612 (ymfm) + SN76489, ' +
      'one frame (59,736 Z80 T-states) at a time at 53,267 Hz, resampled to ' + (ctx ? ctx.sampleRate + ' Hz' : 'the audio device rate') + '. ' +
      'Space plays or stops; ↑ ↓ pick.'));
    status(true);
  }

  function metaRows(id) {
    if (!rom || !Ym) return [['Sound test', error || 'loading']];
    const n = Number(id.split('-')[1]);
    const rows = [['Plays', title(id)]];
    if (id.startsWith('song-')) {
      const song = data.songs[n];
      rows.push(['Channels', song.channels.length + ' FM · tempo ' + song.tempo]);
      rows.push(['Order lists', song.channels.map((c) => c.entries.length).join(' / ') + ' entries']);
      rows.push(['Length', 'loops until Stop']);
    } else {
      const sfx = data.sfx[n];
      rows.push(['Uses', sfx.actions.map((a) => (a.type === 'dac' ? 'DAC sample' : 'FM ch' + a.channel)).join(' + ')]);
      rows.push(['Handler', '$' + sfx.handler.toString(16).toUpperCase()]);
      rows.push(['Length', SFX_VBLANKS + ' vblanks' + (n === 0 ? ' after a 3-vblank prelude' : '')]);
    }
    rows.push(['Path', '68k driver → Z80 driver → YM2612 + SN76489']);
    rows.push(['Frame', '59,736 Z80 T-states (59.92 Hz)']);
    rows.push(['Output', '53,267 Hz, live']);
    rows.push(['Source', 'Bundled NHL 92 sound slice ($F4C8–$24213)']);
    rows.push(['Notes', 'docs/NHL92-SOUND-CHAIN.md']);
    return rows;
  }

  root.NhlSoundTestView = {
    ensure,
    entries,
    renderPanel,
    metaRows,
    play,
    stop,
    toggle,
    get playing() { return !!live; },
    get playingId() { return live ? live.id : ''; },
    get ready() { return !!(rom && Ym); },
    get error() { return error; },
    set onChange(fn) { onChange = typeof fn === 'function' ? fn : null; }
  };
})(typeof self !== 'undefined' ? self : this);
