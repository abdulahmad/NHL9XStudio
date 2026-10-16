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
  const KEEP_SECONDS = 8; // sequencer history kept (the roll shows 6 s)
  const T_PER_SAMPLE = 1008 / 15; // Z80 T-states per 53,267 Hz output sample (chain.sampleAt inverse)

  const TOOL_IMPORT = 'tool-import';
  const TOOL_EDITOR = 'tool-editor';
  const isTool = (id) => id === TOOL_IMPORT || id === TOOL_EDITOR;

  let rom = null;
  let data = null;
  let gmMap = null; // data/audio/nhl92-gm-map.json (lane labels, GM playback); null if it failed to load
  let customRom = null; // ROM copy with the sequencer's song as song 4 (see Nhl92Song.romWithSong)
  let gmPlay = null; // { id, source, startedAt, total }: a reference-synth playback in progress
  let toggles = {}; // id -> () => Promise, set by the tools panels (Space / Enter / double-click)
  const gmCache = new Map(); // song id -> rendered Float32Array
  let Ym = null; // { Chip, module, api }
  let error = '';
  let loading = null;
  let ctx = null;
  let node = null;
  let live = null;
  let panel = null;
  let roll = null;
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
      try {
        const res = await fetch(new URL('data/audio/nhl92-gm-map.json', document.baseURI).href);
        gmMap = res.ok ? await res.json() : null;
      } catch (err) { gmMap = null; }
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
    if (root.Nhl92Song && root.Nhl92SongGm && root.Nhl92Smf && root.NhlSoundTools) {
      out.push({ id: TOOL_IMPORT, group: 'MIDI', label: 'MIDI import → General MIDI', sub: 'open a .mid, hear it, save it as GM' });
      out.push({ id: TOOL_EDITOR, group: 'MIDI', label: 'Sequencer · new NHL 92 song', sub: 'edit, play on the retail driver, export' });
    }
    return out;
  }

  function title(id) {
    if (id === TOOL_IMPORT) return 'MIDI import → General MIDI';
    if (id === TOOL_EDITOR) return 'Sequencer · new NHL 92 song';
    const n = Number(id.split('-')[1]);
    return id.startsWith('song-') ? 'Song ' + n + ' · ' + data.songs[n].name : 'SFX ' + NAMES().name(n);
  }

  /** Plans for live playback; the siren's matches sfx-00-siren-SFXsiren-after-music-off.wav. */
  function planFor(id) {
    if (id === TOOL_EDITOR) return Chain().songPlan(root.Nhl92Song.CUSTOM_SONG, Infinity);
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
      // Where this block starts in the chip's output stream (chain samples handed to the resampler,
      // one behind: its lookahead) and when the context will play it: the sequencer's clock.
      const s = live;
      const taken = s.chain.rendered - s.queued;
      s.blocks.push({ ctxTime: typeof ev.playbackTime === 'number' && ev.playbackTime > 0 ? ev.playbackTime : ctx.currentTime, src: taken - 1 });
      if (s.blocks.length > 8) s.blocks.shift();
      s.tracker.trim(Math.max(0, taken / Chain().SAMPLE_RATE - KEEP_SECONDS) * Chain().SAMPLE_RATE * T_PER_SAMPLE);
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
    stopBuffer();
    ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const chip = new Ym.Chip(Ym.module, Ym.api.create(), Ym.api);
    chip.reset();
    const tracker = root.YmNoteTracker.create();
    // Read-only taps: the same YM2612 writes the chip gets, for the sequencer view.
    const chain = Chain().create({
      rom: id === TOOL_EDITOR && customRom ? customRom : rom, chip, psg: root.NhlSn76489.create(), keepLogs: false,
      onYmWrite: (t, port, value) => tracker.writePort(t, port, value),
      onPsgWrite: (t, value) => tracker.psgWrite(t, value),
      onYmReset: (t) => tracker.reset(t)
    });
    live = { id, chip, chain, tracker, blocks: [], plan: planFor(id), chunks: [], offset: 0, queued: 0, done: false, message: '' };
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
    if (toggles[id]) return toggles[id]();
    if (live && live.id === id) {
      stop();
      return Promise.resolve();
    }
    return play(id);
  }

  // --- Reference-synth (General MIDI) playback of a rendered buffer ------------------------------------------

  /** Play a mono Float32Array at `rate` Hz as item `id`; stops the live chain session first. */
  async function playBuffer(id, mono, rate) {
    stop();
    stopBuffer();
    ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const buf = ctx.createBuffer(1, mono.length, rate);
    buf.getChannelData(0).set(mono);
    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.connect(gain);
    const g = { id, source, startedAt: ctx.currentTime, total: mono.length / rate };
    source.onended = () => {
      if (gmPlay !== g) return;
      gmPlay = null;
      status(true, 'Finished');
      if (onChange) onChange();
    };
    gmPlay = g;
    source.start();
    status(true);
    if (onChange) onChange();
  }

  function stopBuffer() {
    if (!gmPlay) return;
    const g = gmPlay;
    gmPlay = null;
    try { g.source.stop(); } catch (err) { /* already stopped */ }
    status(true, 'Stopped');
    if (onChange) onChange();
  }

  /** A retail song through the NHL 92 -> GM table and the plain reference synth (cached). */
  function renderGmSong(n) {
    if (!gmMap) throw new Error('data/audio/nhl92-gm-map.json did not load');
    if (gmCache.has(n)) return gmCache.get(n);
    const nhl = root.Nhl92Song.fromParsed(data, n);
    const gm = root.Nhl92SongGm.nhlToGm(nhl, gmMap).song;
    const buf = root.Nhl92GmReference.renderEvents(root.Nhl92SongGm.gmEvents(gm));
    gmCache.set(n, buf);
    return buf;
  }

  async function playGm(id) {
    if (gmPlay && gmPlay.id === id) { stopBuffer(); return; }
    const n = Number(id.split('-')[1]);
    const box = panel && panel.querySelector('.st-status');
    if (box && !gmCache.has(n)) box.textContent = 'Rendering the song with the General MIDI reference sounds…';
    await new Promise((r) => setTimeout(r, 20));
    await playBuffer(id, renderGmSong(n), root.Nhl92GmReference.SAMPLE_RATE);
  }

  /** What the Sound test hands to the tools panels (public/sound-tools.js). */
  function host() {
    return {
      rom, data, map: gmMap, Chain: Chain(),
      toggles,
      playBuffer, stopBuffer,
      get bufferId() { return gmPlay ? gmPlay.id : ''; },
      playEditor(romCopy) { customRom = romCopy; return play(TOOL_EDITOR); },
      stopLive: () => stop(),
      /** Select another Sound test list entry (a click on its row), e.g. after a conversion. */
      openItem(item) {
        const want = title(item);
        const row = Array.from(document.querySelectorAll('#catalog .item')).find((b) => b.querySelector('.name') && b.querySelector('.name').textContent.replace(/^▶ /, '') === (item === TOOL_EDITOR ? 'Sequencer · new NHL 92 song' : want));
        if (row) row.click();
      },
      get editorPlaying() { return !!(live && live.id === TOOL_EDITOR); },
      mountRoll(container) {
        if (roll) roll.destroy();
        roll = root.NhlSoundRoll && root.YmNoteTracker
          ? root.NhlSoundRoll.mount(container, { chain: Chain(), state: seqState, patchLabel })
          : null;
        return roll;
      }
    };
  }

  /** Context time of the sample at the speaker right now (the browser's own output timestamp). */
  function audibleContextTime() {
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (root.performance.now() - ts.performanceTime) / 1000;
    }
    return ctx.currentTime - (ctx.outputLatency || 0);
  }

  /**
   * Chip output sample (53,267 Hz, from the start of the run) that is audible at context time `T`.
   * Each audio block is stamped with its playback time and stream position, and the stream is
   * contiguous: sample = offset + T * 53,267. The offset is the mean over the recent contiguous
   * blocks (playbackTime is only good to a render quantum or two; a jump over 30 ms means a
   * glitch, and older blocks are dropped). This accounts for the samples queued ahead, the
   * ScriptProcessor block and the device latency, which `heard()` doesn't.
   */
  function audibleSource(s, T) {
    const bl = s.blocks;
    if (!bl.length) return 0;
    const rate = Chain().SAMPLE_RATE;
    const newest = bl[bl.length - 1].src - bl[bl.length - 1].ctxTime * rate;
    let sum = 0;
    let n = 0;
    for (let i = bl.length - 1; i >= 0; i--) {
      const o = bl[i].src - bl[i].ctxTime * rate;
      if (Math.abs(o - newest) > 0.03 * rate) break;
      sum += o;
      n += 1;
    }
    const src = sum / n + (T == null ? audibleContextTime() : T) * rate;
    return Math.max(0, Math.min(src, s.chain.rendered));
  }

  /** What the sequencer view draws: the running session's tracker and the audible position, or null. */
  function seqState() {
    if (!live || !ctx) return null;
    return { tracker: live.tracker, src: audibleSource(live) };
  }

  /** Lane label for a patch burst the tracker saw: the retail patch and the GM sound its mapping names. */
  function patchLabel(burst) {
    if (!data || !root.Nhl92Song) return null;
    const id = root.Nhl92Song.identifyPatch(data.patches, burst.regs, burst.ch);
    if (id < 0) return null;
    const e = gmMap && gmMap.nhl92ToGm.patches[id];
    return e ? 'P' + id + ' · ' + e.target.name : 'P' + id;
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
    const gmBtn = panel.querySelector('.st-gm');
    if (gmBtn) {
      const gmOn = !!(gmPlay && gmPlay.id === panel.dataset.item);
      gmBtn.textContent = gmOn ? '■ Stop GM' : '▶ Play as GM';
      gmBtn.setAttribute('aria-pressed', gmOn ? 'true' : 'false');
      if (gmOn) {
        const secs = Math.min(gmPlay.total, ctx.currentTime - gmPlay.startedAt);
        panel.querySelector('.st-bar').style.width = (secs / gmPlay.total * 100).toFixed(1) + '%';
        panel.querySelector('.st-bar').classList.remove('is-loop');
        panel.querySelector('.st-time').textContent = clock(secs) + ' / ' + clock(gmPlay.total);
        panel.querySelector('.st-status').textContent = 'Playing as General MIDI · NHL 92 → GM table · plain reference synth, one pass';
        return;
      }
    }
    const s = live || ended;
    const shown = s && s.id === panel.dataset.item ? s : null;
    const btn = panel.querySelector('.st-toggle');
    const bar = panel.querySelector('.st-bar');
    const time = panel.querySelector('.st-time');
    const box = panel.querySelector('.st-status');
    if (!btn || !box || !bar || !time) return;
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
    if (roll) roll.destroy();
    roll = null;
    box.replaceChildren();
    box.dataset.item = id;
    if (!rom || !Ym) {
      box.appendChild(make('p', 'st-note', error ? 'Sound test failed to load: ' + error : 'Loading the sound test…'));
      return;
    }
    if (live && live.id !== id) stop();
    if (gmPlay && gmPlay.id !== id) stopBuffer();
    if (isTool(id)) {
      toggles = {};
      root.NhlSoundTools.render(box, id, host());
      return;
    }
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
    controls.append(btn);
    if (id.startsWith('song-') && gmMap && root.Nhl92SongGm && root.Nhl92GmReference) {
      const gmBtn = make('button', 'ghost-btn st-gm', '▶ Play as GM');
      gmBtn.type = 'button';
      gmBtn.title = 'Play this song through the NHL 92 → General MIDI table and the plain reference synth (one pass)';
      gmBtn.setAttribute('aria-pressed', 'false');
      gmBtn.addEventListener('click', () => {
        playGm(id).catch((err) => {
          const st = box.querySelector('.st-status');
          if (st) st.textContent = 'GM playback failed: ' + (err && err.message ? err.message : String(err));
        });
      });
      controls.append(gmBtn);
    }
    controls.append(vol);
    box.appendChild(controls);

    const progress = make('div', 'st-progress');
    progress.appendChild(make('div', 'st-bar'));
    box.appendChild(progress);
    box.appendChild(make('p', 'st-time mono'));
    box.appendChild(make('p', 'st-status mono'));

    if (root.NhlSoundRoll && root.YmNoteTracker) {
      const seq = make('div', 'st-seq');
      box.appendChild(seq);
      roll = root.NhlSoundRoll.mount(seq, { chain: Chain(), state: seqState, patchLabel });
    }

    box.appendChild(make('p', 'st-note', describe(id)));
    box.appendChild(make('p', 'st-note', 'Rendered live from the retail code: 68k driver → Z80 RAM → Z80 driver → YM2612 (ymfm) + SN76489, ' +
      'one frame (59,736 Z80 T-states) at a time at 53,267 Hz, resampled to ' + (ctx ? ctx.sampleRate + ' Hz' : 'the audio device rate') + '. ' +
      'Space plays or stops; ↑ ↓ pick.'));
    status(true);
  }

  function metaRows(id) {
    if (!rom || !Ym) return [['Sound test', error || 'loading']];
    if (isTool(id)) {
      return id === TOOL_IMPORT
        ? [['Tool', title(id)], ['In', 'Standard MIDI file (format 0 or 1)'], ['Out', 'General MIDI file; or an NHL 92 song for the sequencer'], ['Mapping', 'data/audio/nhl92-gm-map.json'], ['Notes', 'docs/NHL92-SEQUENCER.md']]
        : [['Tool', title(id)], ['Song', 'six FM channels, one note at a time each'], ['Plays on', 'the retail 68k + Z80 drivers, as song 4 of a ROM copy'], ['Exports', 'MIDI, cmdstream asm and binary'], ['Notes', 'docs/NHL92-SEQUENCER.md']];
    }
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
    stop() { stop(); stopBuffer(); },
    toggle,
    get playing() { return !!live || !!gmPlay; },
    /** The mounted sequencer view (readout of the last drawn frame, mode), or null. */
    get sequencer() { return roll; },
    /** Audible chip sample of the running session (see audibleSource), or null. */
    audibleSample() { return live && ctx ? audibleSource(live) : null; },
    get playingId() { return live ? live.id : gmPlay ? gmPlay.id : ''; },
    get ready() { return !!(rom && Ym); },
    get error() { return error; },
    set onChange(fn) { onChange = typeof fn === 'function' ? fn : null; }
  };
})(typeof self !== 'undefined' ? self : this);
