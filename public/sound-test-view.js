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

  /** Plans for live playback (not the same as tools/render-nhl92-sound-chain.js for siren). */
  function planFor(id) {
    const n = Number(id.split('-')[1]);
    if (id.startsWith('song-')) return Chain().songPlan(n, Infinity);
    // Siren (instrument 0) needs one song-init vblank after boot; see sfxPlanAfterSongInit.
    if (n === 0) return Chain().sfxPlanAfterSongInit(0, SFX_VBLANKS, 0);
    return Chain().sfxPlan(n, SFX_VBLANKS);
  }

  function ensureContext() {
    if (ctx) return;
    ctx = new (root.AudioContext || root.webkitAudioContext)();
    node = ctx.createScriptProcessor(BLOCK, 0, 2);
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
    node.connect(ctx.destination);
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
  }

  function stop(message) {
    if (!live) return;
    const s = live;
    live = null;
    s.chip.dispose();
    status(true, message || 'Stopped', s);
  }

  function status(force, message, ended) {
    const now = Date.now();
    if (!force && now - lastStatus < 250) return;
    lastStatus = now;
    const s = live || ended;
    const box = panel && panel.querySelector('.st-status');
    if (!box) return;
    if (!s) {
      box.textContent = 'Stopped';
      return;
    }
    const vb = Math.max(0, s.chain.frame - 1);
    const secs = s.chain.rendered / Chain().SAMPLE_RATE;
    box.textContent = (message ? message + ' · ' : 'Playing · ') + title(s.id) + ' · frame ' + vb + ' · ' + secs.toFixed(1) + ' s · ' +
      s.chain.ymWrites + ' YM writes · ' + s.chain.psgWrites + ' PSG writes';
  }

  function renderPanel(box, id) {
    panel = box;
    box.replaceChildren();
    if (!rom || !Ym) {
      box.appendChild(make('p', 'sd-note', error ? 'Sound test failed to load: ' + error : 'Loading the sound test…'));
      return;
    }
    if (live && live.id !== id) stop();
    box.appendChild(make('h3', null, title(id)));
    box.appendChild(make('p', 'sd-note', id.startsWith('song-')
      ? 'Boot (p_initialZ80, p_turnoff, p_music_vblank), then song(' + id.slice(5) + ') and p_music_vblank every vblank, until Stop.'
      : id === 'sfx-0'
        ? 'Boot, then song(0) for one vblank (Sound_InitMusicTrack sets each channel\'s instrument to $FF), then sfx(0) and p_music_vblank every vblank for ' + SFX_VBLANKS + ' vblanks. Without that init, siren\'s instrument 0 matches the cleared workspace and the driver skips the patch load (nearly silent), as in step 6\'s runSfx.'
        : 'Boot, one vblank, then sfx(' + id.slice(4) + ') and p_music_vblank every vblank, for ' + SFX_VBLANKS + ' vblanks.'));
    box.appendChild(make('p', 'sd-note', 'Rendered live from the retail code: 68k driver → Z80 RAM → Z80 driver → YM2612 (ymfm) + SN76489, ' +
      'one frame (59,736 Z80 T-states) at a time at 53,267 Hz, resampled to ' + (ctx ? ctx.sampleRate + ' Hz' : 'the audio device rate') + '.'));
    const row = make('div', 'st-buttons');
    const playBtn = make('button', 'ghost-btn', 'Play');
    playBtn.type = 'button';
    playBtn.id = 'sound-test-play';
    const stopBtn = make('button', 'ghost-btn', 'Stop');
    stopBtn.type = 'button';
    stopBtn.id = 'sound-test-stop';
    playBtn.addEventListener('click', () => {
      play(id).catch((err) => {
        const st = box.querySelector('.st-status');
        if (st) st.textContent = 'Playback failed: ' + (err && err.message ? err.message : String(err));
      });
    });
    stopBtn.addEventListener('click', () => stop());
    row.append(playBtn, stopBtn);
    box.appendChild(row);
    box.appendChild(make('p', 'st-status mono', live ? '' : 'Stopped'));
    if (live) status(true);
  }

  function metaRows(id) {
    if (!rom || !Ym) return [['Sound test', error || 'loading']];
    return [
      ['Plays', title(id)],
      ['Path', '68k driver → Z80 driver → YM2612 + SN76489'],
      ['Frame', '59,736 Z80 T-states (59.92 Hz)'],
      ['Output', '53,267 Hz, live'],
      ['Source', 'Bundled NHL 92 sound slice ($F4C8–$24213)'],
      ['Notes', 'docs/NHL92-SOUND-CHAIN.md']
    ];
  }

  root.NhlSoundTestView = {
    ensure,
    entries,
    renderPanel,
    metaRows,
    play,
    stop,
    get playing() { return !!live; },
    get ready() { return !!(rom && Ym); },
    get error() { return error; }
  };
})(typeof self !== 'undefined' ? self : this);
