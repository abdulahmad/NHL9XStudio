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

  // 'nhl92' | 'nhlpa93' | 'nhl94': which retail driver the chain runs (setGame). 93 and 94 share one driver
  // family (nhl9x-68k-harness.js); each has its bundled sound segment placed at its ROM offsets.
  let game = 'nhl92';
  const NX = {
    nhlpa93: { label: 'NHLPA 93', short: '93', slice: 'nhl93-sound-slice.bin', start: 0x165d8, size: 0x2efa2, catalog: 'nhlpa93.json', driver: 'Nhl93M68kHarness' },
    nhl94: { label: 'NHL 94', short: '94', slice: 'nhl94-sound-slice.bin', start: 0x1a264, size: 0x4b5c0, catalog: 'nhl94.json', driver: 'Nhl94M68kHarness' }
  };
  const isNx = () => !!NX[game];
  const nxNumber = () => (game === 'nhlpa93' ? 93 : 94);
  const toolName = (id) => (isNx()
    ? (id === TOOL_EDITOR ? 'Sequencer · new ' + NX[game].label + ' song' : 'MIDI import → ' + NX[game].label)
    : (id === TOOL_EDITOR ? 'Sequencer · new NHL 92 song' : 'MIDI import → NHL 92'));
  let rom = null;
  let data = null;
  let gmMap = null; // data/audio/nhl92-gm-map.json (lane labels, GM playback); null if it failed to load
  let nxSlice = null; // NHL 93 / 94: the sound segment bytes (Nhl9xSong reads the event streams from it)
  let nxBank = null; // the 32 FM patches of the loaded game (patchLabel)
  let nxMap = null; // NHL 93 / 94: data/audio/nhl9x-gm-map.json
  let customRom = null; // ROM copy with the sequencer's song as song 4 (see Nhl92Song.romWithSong)
  let gmPlay = null; // { id, source, startedAt, total }: a reference-synth playback in progress
  let toggles = {}; // id -> () => Promise, set by the tools panels (Space / Enter / double-click)
  const gmCache = new Map(); // song id -> rendered Float32Array
  const sfxGmCache = new Map(); // sfx number -> { buf, song, tracker, notes } (see renderGmSfx)
  const LEAD_FRAMES = 2; // the retail driver's first note sounds this many frames after unit 0
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

  /** Select the game whose sound chain this view runs. Stops playback and drops the other game's data. */
  function setGame(id) {
    const want = NX[id] ? id : 'nhl92';
    if (want === game) return;
    stop();
    stopBuffer();
    if (roll) roll.destroy();
    roll = null;
    game = want;
    rom = null;
    data = null;
    gmMap = null;
    nxSlice = null;
    nxBank = null;
    nxMap = null;
    customRom = null;
    loading = null;
    error = '';
    gmCache.clear();
    sfxGmCache.clear();
    passCache.clear();
    infoCache.clear();
    if (onChange) onChange();
  }

  /** NHL 93 / 94: the bundled sound segment and the catalog's names, shaped like the NHL 92 parse (songs / sfx). */
  async function loadNx() {
    const c = NX[game];
    const slice = await fetch(new URL('data/fixtures/' + c.slice, document.baseURI).href);
    if (!slice.ok) throw new Error(c.label + ' sound fixture missing (' + slice.status + ')');
    const image = new Uint8Array(c.size);
    image.set(new Uint8Array(await slice.arrayBuffer()), c.start);
    const res = await fetch(new URL('data/audio/' + c.catalog, document.baseURI).href);
    if (!res.ok) throw new Error(c.label + ' sound catalog missing (' + res.status + ')');
    const cat = await res.json();
    let map = null;
    try {
      const m = await fetch(new URL('data/audio/nhl9x-gm-map.json', document.baseURI).href);
      map = m.ok ? await m.json() : null;
    } catch (err) { map = null; }
    const sounds = cat.entries.filter((e) => e.soundId != null && e.playable);
    const nice = (e) => e.label.replace(/^sfx /, '').replace(/^ChooseSong, /, '');
    return {
      rom: image,
      slice: image.subarray(c.start),
      map,
      data: {
        songs: sounds.filter((e) => e.soundId >= 0x30).map((e) => ({ id: e.soundId, name: nice(e), group: e.group, blurb: e.blurb })),
        sfx: sounds.filter((e) => e.soundId < 0x30).map((e) => ({ id: e.soundId, name: nice(e), blurb: e.blurb }))
      }
    };
  }

  async function ensure(baseUrl) {
    if (rom && Ym) return true;
    if (loading) return loading;
    const forGame = game;
    loading = (async () => {
      if (NX[forGame]) {
        const g = await loadNx();
        if (game !== forGame) return false;
        rom = g.rom;
        data = g.data;
        gmMap = null;
        nxSlice = g.slice;
        nxMap = g.map;
      } else {
        const image = await root.Nhl92SoundFixture.ensureSyntheticRom({ baseUrl });
        if (game !== forGame) return false;
        rom = image;
        data = SD().parse(rom);
        try {
          const res = await fetch(new URL('data/audio/nhl92-gm-map.json', document.baseURI).href);
          gmMap = res.ok ? await res.json() : null;
        } catch (err) { gmMap = null; }
      }
      if (!Ym) Ym = await loadYm();
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
    if (isNx()) {
      if (root.Nhl9xStream && root.NhlSoundToolsNx && root.Nhl92SongGm && root.Nhl92Smf && root.NhlSoundTools && nxMap) {
        out.push({ id: TOOL_EDITOR, group: 'MIDI', label: toolName(TOOL_EDITOR), sub: 'edit, play on the retail drivers, export' });
        out.push({ id: TOOL_IMPORT, group: 'MIDI', label: toolName(TOOL_IMPORT), sub: 'open a .mid, edit it as a ' + NX[game].label + ' song' });
      }
      for (const s of data.songs) {
        out.push({ id: 'song-' + s.id, group: s.group === 'Music — Team' ? 'Team songs' : 'Songs', label: '$' + s.id.toString(16).toUpperCase() + ' · ' + s.name, sub: 'song $' + s.id.toString(16).toUpperCase() });
      }
      for (const s of data.sfx) out.push({ id: 'sfx-' + s.id, group: 'SFX', label: '$' + s.id.toString(16).toUpperCase() + ' · ' + s.name, sub: SFX_VBLANKS + ' vblanks' });
      return out;
    }
    // Tools first, so the sequencer and the MIDI import are the first thing in the list.
    if (root.Nhl92Song && root.Nhl92SongGm && root.Nhl92Smf && root.NhlSoundTools) {
      out.push({ id: TOOL_EDITOR, group: 'MIDI', label: 'Sequencer · new NHL 92 song', sub: 'edit, play on the retail driver, export' });
      out.push({ id: TOOL_IMPORT, group: 'MIDI', label: 'MIDI import → NHL 92', sub: 'open a .mid, edit it as an NHL 92 song' });
    }
    for (const s of data.songs) out.push({ id: 'song-' + s.id, group: 'Songs', label: s.id + ' · ' + s.name, sub: 'song ' + s.id + ' · loops until Stop' });
    for (const s of data.sfx) {
      const kinds = s.actions.map((a) => (a.type === 'dac' ? 'DAC' : 'FM ch' + a.channel)).join(' + ');
      out.push({ id: 'sfx-' + s.id, group: 'SFX', label: NAMES().name(s.id), sub: kinds + ' · ' + SFX_VBLANKS + ' vblanks' });
    }
    return out;
  }

  /** Sound id -> record of the loaded game's list (NHL 94 ids are not array positions). */
  const song94 = (n) => data.songs.find((s) => s.id === n);
  const sfx94 = (n) => data.sfx.find((s) => s.id === n);

  function title(id) {
    if (isTool(id)) return toolName(id);
    const n = Number(id.split('-')[1]);
    if (isNx()) return (id.startsWith('song-') ? 'Song $' + n.toString(16).toUpperCase() + ' · ' + song94(n).name : 'SFX $' + n.toString(16).toUpperCase() + ' · ' + sfx94(n).name);
    return id.startsWith('song-') ? 'Song ' + n + ' · ' + data.songs[n].name : 'SFX ' + NAMES().name(n);
  }

  /** Plans for live playback; the siren's matches sfx-00-siren-SFXsiren-after-music-off.wav. */
  function planFor(id) {
    if (id === TOOL_EDITOR) return Chain().songPlan(isNx() ? root.Nhl9xStream.CUSTOM_SONG[nxNumber()] : root.Nhl92Song.CUSTOM_SONG, Infinity);
    const n = Number(id.split('-')[1]);
    if (id.startsWith('song-')) return Chain().songPlan(n, Infinity);
    if (isNx()) return Chain().sfxPlan(n, SFX_VBLANKS);
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
      if (s.seeking) {
        L.fill(0);
        R.fill(0);
        status();
        return;
      }
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
    if (s.seeking) return { left: new Float32Array(n), right: new Float32Array(n) };
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

  const taps = (tracker) => ({
    onYmWrite: (t, port, value) => tracker.writePort(t, port, value),
    onPsgWrite: (t, value) => tracker.psgWrite(t, value),
    onYmReset: (t) => tracker.reset(t)
  });

  /** A chain and its note tracker over `romImage`. withChip=false makes no audio: only the register writes (for the roll). */
  function newSession(romImage, withChip) {
    let chip;
    if (withChip) {
      chip = new Ym.Chip(Ym.module, Ym.api.create(), Ym.api);
      chip.reset();
    }
    const tracker = root.YmNoteTracker.create();
    // Read-only taps: the same YM2612 writes the chip gets, for the sequencer view.
    const chain = Chain().create(Object.assign({ rom: romImage, chip, psg: root.NhlSn76489.create(), keepLogs: false, driver: isNx() ? root[NX[game].driver] : undefined }, taps(tracker)));
    return { chip, chain, tracker, held: new Array(6).fill(null) };
  }

  /** Latest patch load per lane at or before source sample `src`, kept for the roll's instrument tags (the tracker forgets old ones). */
  function updateHeld(s, src) {
    for (const p of s.tracker.patches) {
      if (p.kind !== 'patch' || Chain().sampleAt(p.t0) > src) continue;
      const h = s.held[p.ch];
      if (!h || p.t0 >= h.t0) s.held[p.ch] = p;
    }
  }

  async function play(id, startSec) {
    if (!rom || !Ym) throw new Error(error || 'Sound test still loading');
    stop();
    stopBuffer();
    ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const sess = newSession(id === TOOL_EDITOR && customRom ? customRom : rom, true);
    live = Object.assign(sess, { id, blocks: [], plan: planFor(id), chunks: [], offset: 0, queued: 0, done: false, message: '', seeking: null, frozen: 0 });
    live.resampler = root.NhlChipResampler.create(Chain().SAMPLE_RATE, ctx.sampleRate, pull);
    if (startSec > 0) beginSeek(live, framesOf(startSec));
    status(true);
    if (onChange) onChange();
  }

  function stop(message) {
    if (!live) return;
    const s = live;
    live = null;
    s.dead = true;
    if (s.chip) s.chip.dispose();
    status(true, message || 'Stopped', s);
    if (onChange) onChange();
  }

  // --- Seeking the live chain -----------------------------------------------------------------------------
  // The retail driver can only run forward, so a forward seek fast-forwards the running chain with sample
  // generation switched off (register writes still reach the chips, so the sound state is right when it
  // resumes), in short slices so the page stays responsive. A backward seek starts a new run and does the same.

  const framesOf = (sec) => Math.max(0, Math.round(sec / secondsOf(1)));

  function beginSeek(s, targetFrame) {
    const last = s.plan.frames === Infinity ? Infinity : s.plan.frames - 1;
    targetFrame = Math.min(targetFrame, last);
    if (targetFrame <= s.chain.frame) return;
    s.frozen = Math.max(0, s.chain.rendered - s.queued);
    s.seeking = { from: s.chain.frame, target: targetFrame };
    s.chain.setMute(true);
    const slice = () => {
      if (s.dead || live !== s) return;
      const t0 = root.performance.now();
      while (s.chain.frame < s.seeking.target && root.performance.now() - t0 < 25) {
        s.chain.step(s.plan.calls[s.chain.frame] || null);
        s.chain.take();
      }
      if (s.chain.frame < s.seeking.target) {
        status(true);
        setTimeout(slice, 0);
        return;
      }
      endSeek(s);
    };
    setTimeout(slice, 0);
  }

  function endSeek(s) {
    s.chain.setMute(false);
    s.chunks = [];
    s.offset = 0;
    s.queued = 0;
    s.blocks = [];
    s.done = s.chain.frame >= s.plan.frames;
    s.resampler = root.NhlChipResampler.create(Chain().SAMPLE_RATE, ctx.sampleRate, pull);
    updateHeld(s, s.chain.rendered);
    s.seeking = null;
    status(true);
  }

  /** Move the live run to `sec` seconds of chain time (forward: fast-forward; backward: start over and fast-forward). */
  function seekLive(sec) {
    const s = live;
    if (!s || s.id === TOOL_EDITOR) return;
    const target = framesOf(sec);
    if (s.seeking) {
      if (target > s.seeking.target) s.seeking.target = target;
      return;
    }
    if (target > s.chain.frame) beginSeek(s, target);
    else play(s.id, sec).catch((err) => { if (panel) { const st = panel.querySelector('.st-status'); if (st) st.textContent = 'Seek failed: ' + (err && err.message ? err.message : String(err)); } });
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

  /**
   * Play a mono Float32Array at `rate` Hz as item `id`; stops the live chain session first.
   * `viz` (optional) drives the sequencer view while it plays:
   *   { tracker }      a finished tracker (the SFX), drawn as it stands, or
   *   { rom, plan }    a silent run of the retail chain over `rom`, kept level with the audio.
   */
  async function playBuffer(id, mono, rate, viz) {
    stop();
    stopBuffer();
    ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const audioBuf = ctx.createBuffer(1, mono.length, rate);
    audioBuf.getChannelData(0).set(mono);
    const g = { id, source: null, audioBuf, startedAt: 0, total: mono.length / rate, viz: makeViz(viz) };
    gmPlay = g;
    g.timer = setInterval(() => status(), 250);
    startSource(g, 0);
    status(true);
    if (onChange) onChange();
  }

  function startSource(g, sec) {
    const source = ctx.createBufferSource();
    source.buffer = g.audioBuf;
    source.connect(gain);
    source.onended = () => {
      if (gmPlay !== g || g.source !== source) return;
      clearInterval(g.timer);
      gmPlay = null;
      status(true, 'Finished');
      if (onChange) onChange();
    };
    g.source = source;
    g.startedAt = ctx.currentTime - sec;
    source.start(0, sec);
  }

  /** Jump the General MIDI playback to `sec` (the buffer is whole, so this is immediate). */
  function seekGm(sec) {
    const g = gmPlay;
    if (!g) return;
    const old = g.source;
    old.onended = null;
    try { old.stop(); } catch (err) { /* already stopped */ }
    startSource(g, Math.max(0, Math.min(g.total - 0.05, sec)));
    status(true);
  }

  function stopBuffer() {
    if (!gmPlay) return;
    const g = gmPlay;
    clearInterval(g.timer);
    gmPlay = null;
    g.source.onended = null;
    try { g.source.stop(); } catch (err) { /* already stopped */ }
    status(true, 'Stopped');
    if (onChange) onChange();
  }

  function makeViz(spec) {
    if (!spec || !root.YmNoteTracker || !root.NhlSn76489) return null;
    if (spec.tracker) return { fixed: true, spec, tracker: spec.tracker, held: new Array(6).fill(null) };
    return Object.assign({ fixed: false, spec, plan: spec.plan, minSrc: 0 }, newSession(spec.rom, false));
  }

  /** The roll's state during General MIDI playback: chain time follows the audio clock (plus the driver's start-up lead). */
  function vizState(g) {
    let v = g.viz;
    const rate = Chain().SAMPLE_RATE;
    const t = Math.max(0, Math.min(g.total, audibleContextTime() - g.startedAt));
    if (v.fixed) {
      updateHeld(v, t * rate);
      return { tracker: v.tracker, src: t * rate, held: v.held };
    }
    const target = (t + secondsOf(LEAD_FRAMES)) * rate;
    if (target < v.minSrc) { // seeked back past what the view still holds: run the driver again from the start
      g.viz = v = makeViz(v.spec);
    }
    const t0 = root.performance.now();
    while (v.chain.rendered < target && v.chain.frame < v.plan.frames && root.performance.now() - t0 < 14) {
      v.chain.step(v.plan.calls[v.chain.frame] || null);
      v.chain.take();
    }
    const src = Math.min(target, v.chain.rendered);
    updateHeld(v, src);
    v.minSrc = Math.max(0, src - KEEP_SECONDS * rate);
    v.tracker.trim(v.minSrc * T_PER_SAMPLE);
    return { tracker: v.tracker, src, held: v.held };
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

  /** NHL 93 / 94: a song or sound effect through the stream -> GM table and the plain reference synth (cached). */
  function nxGm(id) {
    if (!nxMap || !nxSlice || !root.Nhl9xSong) throw new Error('data/audio/nhl9x-gm-map.json did not load');
    const key = (id.startsWith('song-') ? 's' : 'f') + Number(id.split('-')[1]);
    if (gmCache.has(key)) return gmCache.get(key);
    const g = root.Nhl9xSong.toGm(game === 'nhlpa93' ? 93 : 94, nxSlice, Number(id.split('-')[1]), nxMap);
    const out = { notes: g.notes, song: g.song, seconds: g.seconds, buf: null };
    if (g.notes) out.buf = root.Nhl92GmReference.renderEvents(root.Nhl92SongGm.gmEvents(g.song));
    gmCache.set(key, out);
    return out;
  }

  async function exportNxMidi(id) {
    await new Promise((r) => setTimeout(r, 20));
    const r = nxGm(id);
    if (!r.notes) throw new Error('This sound has no notes to export');
    const smf = root.Nhl92SongGm.toSmfSong(r.song);
    const name = NX[game].short === '93' ? 'nhlpa93' : 'nhl94';
    const tag = (id.startsWith('song-') ? 'song-' : 'sfx-') + Number(id.split('-')[1]).toString(16);
    smf.name = name + '-' + tag;
    root.NhlSoundTools.download(name + '-' + tag + '-gm.mid', root.Nhl92Smf.write(smf), 'audio/midi');
  }

  /** True when every part of this SFX is a DAC sample: there are no FM notes for General MIDI to play. */
  const sfxIsDacOnly = (n) => data.sfx[n].actions.every((a) => a.type === 'dac');

  /**
   * An SFX as General MIDI: the whole plan is run once without audio, the notes the YM2612 was asked for
   * (tracker) become GM notes, and the result goes through the reference synth. DAC samples have no
   * notes and are left out, so a DAC-only SFX gives { notes: 0 }. Cached; the tracker is reused for the view.
   */
  function renderGmSfx(n) {
    if (!gmMap) throw new Error('data/audio/nhl92-gm-map.json did not load');
    if (sfxGmCache.has(n)) return sfxGmCache.get(n);
    const id = 'sfx-' + n;
    const plan = planFor(id);
    const sess = newSession(rom, false);
    for (let f = 0; f < plan.frames; f++) {
      sess.chain.step(plan.calls[f] || null);
      sess.chain.take();
    }
    const g = root.Nhl92SongGm.gmFromTracker(sess.tracker, {
      map: gmMap, sampleAt: Chain().sampleAt, rate: Chain().SAMPLE_RATE, endT: plan.frames * Chain().FRAME_TSTATES, patches: data.patches
    });
    const out = { notes: g.notes, song: g.song, tracker: sess.tracker, buf: null };
    if (g.notes) out.buf = root.Nhl92GmReference.renderEvents(root.Nhl92SongGm.gmEvents(g.song));
    sfxGmCache.set(n, out);
    return out;
  }

  async function playGm(id) {
    if (gmPlay && gmPlay.id === id) { stopBuffer(); return; }
    const n = Number(id.split('-')[1]);
    const box = panel && panel.querySelector('.st-status');
    const isSong = id.startsWith('song-');
    if (isNx()) {
      await new Promise((r) => setTimeout(r, 20));
      const r = nxGm(id);
      if (!r.notes) {
        if (box) box.textContent = 'This sound has no notes to play as General MIDI.';
        return;
      }
      await playBuffer(id, r.buf, root.Nhl92GmReference.SAMPLE_RATE, { rom, plan: planFor(id) });
      return;
    }
    if (box && !(isSong ? gmCache.has(n) : sfxGmCache.has(n))) {
      box.textContent = isSong ? 'Rendering the song with the General MIDI reference sounds…' : 'Running the sound effect and converting its FM notes to General MIDI…';
    }
    await new Promise((r) => setTimeout(r, 20));
    if (isSong) {
      await playBuffer(id, renderGmSong(n), root.Nhl92GmReference.SAMPLE_RATE, { rom, plan: Chain().songPlan(n, Infinity) });
      return;
    }
    const r = renderGmSfx(n);
    if (!r.notes) {
      if (box) box.textContent = 'This sound effect has no FM notes to play as General MIDI (it is a DAC sample).';
      return;
    }
    await playBuffer(id, r.buf, root.Nhl92GmReference.SAMPLE_RATE, { tracker: r.tracker });
  }

  /** Download an SFX's General MIDI conversion (same notes as Play as GM). */
  async function exportSfxMidi(n) {
    await new Promise((r) => setTimeout(r, 20));
    const r = renderGmSfx(n);
    if (!r.notes) throw new Error('This sound effect has no FM notes (it is a DAC sample)');
    const smf = root.Nhl92SongGm.toSmfSong(r.song);
    smf.name = 'nhl92-sfx-' + n;
    root.NhlSoundTools.download('nhl92-sfx-' + n + '-gm.mid', root.Nhl92Smf.write(smf), 'audio/midi');
  }

  /** What the Sound test hands to the tools panels (public/sound-tools.js). */
  function host() {
    return {
      rom, data, map: isNx() ? nxMap : gmMap, Chain: Chain(),
      toggles,
      playBuffer, stopBuffer,
      /** Viz spec for playBuffer: the retail drivers playing the sequencer's song (a ROM copy from Nhl92Song.romWithSong). */
      songViz: (romCopy) => ({ rom: romCopy, plan: Chain().songPlan(isNx() ? root.Nhl9xStream.CUSTOM_SONG[nxNumber()] : root.Nhl92Song.CUSTOM_SONG, Infinity) }),
      // NHL 93 / 94 sequencer: which game, its name, the stream reader's slice, the GM table and the 32 FM patches.
      get gameNumber() { return isNx() ? nxNumber() : 92; },
      get label() { return isNx() ? NX[game].label : 'NHL 92'; },
      get slice() { return nxSlice; },
      get bank() { if (!nxBank && nxSlice) nxBank = root.Nhl9xSong.patches(nxNumber(), nxSlice); return nxBank; },
      get bufferId() { return gmPlay ? gmPlay.id : ''; },
      playEditor(romCopy) { customRom = romCopy; return play(TOOL_EDITOR); },
      stopLive: () => stop(),
      /** Select another Sound test list entry (a click on its row), e.g. after a conversion. */
      openItem(item) {
        const want = title(item);
        const row = Array.from(document.querySelectorAll('#catalog .item')).find((b) => b.querySelector('.name') && b.querySelector('.name').textContent.replace(/^▶ /, '') === (isTool(item) ? toolName(item) : want));
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
    if (!ctx) return null;
    if (live) {
      const s = live;
      const src = s.seeking ? s.frozen : s.blocks.length ? audibleSource(s) : Math.max(0, s.chain.rendered - s.queued);
      updateHeld(s, src);
      return { tracker: s.tracker, src, held: s.held };
    }
    if (gmPlay && gmPlay.viz) {
      status(); // the roll's frame loop also keeps the clock and bar moving
      return vizState(gmPlay);
    }
    return null;
  }

  /** Lane label for a patch burst the tracker saw: the retail patch and the GM sound its mapping names. */
  function patchLabel(burst) {
    if (isNx()) {
      if (!nxSlice || !root.Nhl9xSong) return null;
      const g = game === 'nhlpa93' ? 93 : 94;
      if (!nxBank) nxBank = root.Nhl9xSong.patches(g, nxSlice);
      const pid = root.Nhl9xSong.identify(nxBank, burst.regs, burst.ch);
      if (pid < 0) return null;
      const m = nxMap && nxMap.patches.find((x) => x.patch === pid);
      const tn = m && m.target ? (m.target.kind === 'drum' ? m.target.name : m.target.name) : '';
      return tn ? 'P' + pid + ' · ' + tn : 'P' + pid;
    }
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
    if (s.seeking) return s.frozen / Chain().SAMPLE_RATE;
    return Math.max(0, (s.chain.rendered - s.queued) / Chain().SAMPLE_RATE);
  }

  /** Seconds one pass of a retail song lasts (units x tempo frames), or null. */
  const passCache = new Map();
  function passSecs(n) {
    if (!passCache.has(n)) {
      const song = root.Nhl92Song.fromParsed(data, n);
      passCache.set(n, secondsOf(song.units * song.tempo));
    }
    return passCache.get(n);
  }

  /**
   * One pass of a song: { total, loopStart, loops } in seconds. NHL 92 songs repeat from the start; an NHL 93 / 94
   * stream plays to its end event or jumps back to a loop point (Nhl9xSong.parse), so after the first pass it
   * repeats only from the loop point. null when the stream cannot be read.
   */
  const infoCache = new Map();
  function passInfo(n) {
    if (!isNx()) return { total: passSecs(n), loopStart: 0, loops: true };
    if (!infoCache.has(n)) {
      let info = null;
      if (nxSlice && root.Nhl9xSong) {
        const g = game === 'nhlpa93' ? 93 : 94;
        const r = root.Nhl9xSong.parse(g, nxSlice, root.Nhl9xSong.streamAddr(g, nxSlice, n));
        if (r.end !== 'bad' && r.ticks > 0) {
          const looped = r.end === 'loop' && r.loopTick != null;
          info = { total: secondsOf(r.ticks), loopStart: looped ? secondsOf(r.loopTick) : 0, loops: looped && r.ticks > r.loopTick };
        }
      }
      infoCache.set(n, info);
    }
    return infoCache.get(n);
  }

  /** Where `pos` seconds into a song run falls: the position inside the bar and the pass number (0-based). */
  function posIn(info, pos) {
    if (pos < info.total) return { within: pos, pass: 0 };
    if (!info.loops) return { within: info.total, pass: 0, ended: true };
    const len = info.total - info.loopStart;
    const k = Math.floor((pos - info.total) / len) + 1;
    return { within: info.loopStart + ((pos - info.total) % len), pass: k };
  }

  let drag = null; // fraction while the progress bar is being dragged
  let lastFraction = 0;

  /** Seek item `id` to a fraction of its bar (one pass for a song, the whole run for an SFX). */
  function seekFraction(id, f) {
    f = Math.max(0, Math.min(1, f));
    if (gmPlay && gmPlay.id === id) {
      seekGm(f * gmPlay.total);
      return;
    }
    if (!live || live.id !== id) return;
    const n = Number(id.split('-')[1]);
    if (id.startsWith('sfx-')) {
      seekLive(f * secondsOf(planFor(id).frames));
      return;
    }
    const info = passInfo(n);
    if (!info) return;
    const lead = secondsOf(LEAD_FRAMES);
    const pos = Math.max(0, heard(live) - lead);
    const cur = posIn(info, pos);
    // The start of the pass being heard on the run clock: 0 for the first pass, the loop repeat after that.
    const passStart = cur.pass === 0 ? 0 : info.total + (cur.pass - 1) * (info.total - info.loopStart) - info.loopStart;
    const want = f * info.total;
    seekLive(lead + (cur.pass === 0 ? want : passStart + Math.max(info.loopStart, want)));
  }

  function status(force, message, ended) {
    const now = Date.now();
    if (!force && now - lastStatus < 250) return;
    lastStatus = now;
    if (!panel) return;
    const bar = panel.querySelector('.st-bar');
    const time = panel.querySelector('.st-time');
    const box = panel.querySelector('.st-status');
    const slider = panel.querySelector('.st-progress');
    const setBar = (f, text) => {
      lastFraction = f;
      if (drag == null) bar.style.width = (f * 100).toFixed(1) + '%';
      if (slider) slider.setAttribute('aria-valuenow', String(Math.round(f * 100)));
      if (slider) slider.setAttribute('aria-valuetext', text);
    };
    const gmBtn = panel.querySelector('.st-gm');
    if (gmBtn && bar && time && box) {
      const gmOn = !!(gmPlay && gmPlay.id === panel.dataset.item);
      gmBtn.textContent = gmOn ? '■ Stop GM' : '▶ Play as GM';
      gmBtn.setAttribute('aria-pressed', gmOn ? 'true' : 'false');
      if (gmOn) {
        const secs = Math.max(0, Math.min(gmPlay.total, ctx.currentTime - gmPlay.startedAt));
        const text = clock(secs) + ' / ' + clock(gmPlay.total);
        bar.classList.remove('is-loop');
        setBar(secs / gmPlay.total, text);
        time.textContent = text;
        box.textContent = 'Playing as General MIDI · ' + (isNx() ? NX[game].label : 'NHL 92') + ' → GM table · plain reference synth, one pass' + (gmPlay.viz ? '' : ' · no sequencer view');
        return;
      }
    }
    const s = live || ended;
    const shown = s && s.id === panel.dataset.item ? s : null;
    const btn = panel.querySelector('.st-toggle');
    if (!btn || !box || !bar || !time) return;
    const playing = !!(live && live.id === panel.dataset.item);
    btn.textContent = playing ? '■ Stop' : '▶ Play';
    btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    const id = panel.dataset.item;
    const isSong = id.startsWith('song-');
    const n = Number(id.split('-')[1]);
    // Length of the bar: one pass of an NHL 92 song, the whole run of an SFX; NHL 94 songs have no known length.
    const info = isSong ? passInfo(n) : null;
    const total = isSong ? (info ? info.total : null) : secondsOf(planFor(id).frames);
    bar.classList.remove('is-loop');
    if (!shown) {
      setBar(0, clock(0));
      time.textContent = total == null ? 'Plays until Stop' : clock(0) + ' / ' + clock(total) + (isSong ? (info.loops ? ' · one pass, loops until Stop' : ' · plays once') : '');
      box.textContent = message || 'Stopped';
      return;
    }
    if (total == null) { // no known length: elapsed time and a moving stripe
      bar.classList.toggle('is-loop', playing);
      setBar(playing ? 1 : 0, clock(heard(shown)));
      time.textContent = clock(heard(shown)) + ' · plays until Stop';
      box.textContent = (message || 'Playing') + ' · frame ' + Math.max(0, shown.chain.frame - 1) + ' · ' +
        shown.chain.ymWrites + ' YM writes · ' + shown.chain.psgWrites + ' PSG writes';
      return;
    }
    if (shown.seeking) {
      const to = shown.seeking.target;
      const pct = Math.max(0, Math.min(100, ((shown.chain.frame - shown.seeking.from) / Math.max(1, to - shown.seeking.from)) * 100));
      const secs = to * secondsOf(1);
      const within = isSong ? posIn(info, Math.max(0, secs - secondsOf(LEAD_FRAMES))).within : secs;
      setBar(within / total, clock(within));
      time.textContent = clock(within) + ' / ' + clock(total);
      box.textContent = 'Seeking… ' + pct.toFixed(0) + '% (the driver runs forward at full speed, silently)';
      return;
    }
    let secs = heard(shown);
    if (!playing && message === 'Finished' && !isSong) secs = total;
    let within = secs;
    let pass = 0;
    let done = false;
    if (isSong) {
      const at = posIn(info, Math.max(0, secs - secondsOf(LEAD_FRAMES)));
      pass = at.pass;
      within = at.within;
      done = !!at.ended;
    }
    const text = clock(within) + ' / ' + clock(total) + (isSong && info.loops ? ' · pass ' + (pass + 1) : '');
    setBar(Math.min(1, within / total), text);
    time.textContent = text + (isSong ? (info.loops ? ' · loops until Stop' : done ? ' · ended' : ' · plays once') : '');
    box.textContent = (message || 'Playing') + ' · frame ' + Math.max(0, shown.chain.frame - 1) + ' · ' +
      shown.chain.ymWrites + ' YM writes · ' + shown.chain.psgWrites + ' PSG writes';
  }

  function describe(id) {
    if (isNx()) {
      const n = Number(id.split('-')[1]);
      return id.startsWith('song-')
        ? 'Boot (p_initialZ80, p_turnoff, p_music_vblank), then the game\'s song wrapper with $' + n.toString(16).toUpperCase() + ' (play_sfx_or_music_track) and p_music_vblank every vblank, until Stop.'
        : 'Boot, one vblank, then the game\'s sfx wrapper with $' + n.toString(16).toUpperCase() + ' and p_music_vblank every vblank, for ' + SFX_VBLANKS + ' vblanks.';
    }
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
      (isNx() ? root.NhlSoundToolsNx : root.NhlSoundTools).render(box, id, host());
      return;
    }
    const n = Number(id.split('-')[1]);
    if (isNx()) {
      const rec = id.startsWith('song-') ? song94(n) : sfx94(n);
      box.appendChild(make('p', 'st-kind', (id.startsWith('song-') ? NX[game].label + ' song $' : NX[game].label + ' SFX $') + n.toString(16).toUpperCase()));
      box.appendChild(make('h3', null, rec.name));
    } else {
      box.appendChild(make('p', 'st-kind', id.startsWith('song-') ? 'Song ' + n : 'SFX ' + n));
      box.appendChild(make('h3', null, id.startsWith('song-') ? data.songs[n].name : NAMES().name(n)));
    }

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
    const fail = (what) => (err) => {
      const st = box.querySelector('.st-status');
      if (st) st.textContent = what + ' failed: ' + (err && err.message ? err.message : String(err));
    };
    if (isNx() && nxMap && root.Nhl9xSong && root.Nhl92SongGm && root.Nhl92GmReference) {
      const gmBtn = make('button', 'ghost-btn st-gm', '▶ Play as GM');
      gmBtn.type = 'button';
      gmBtn.setAttribute('aria-pressed', 'false');
      gmBtn.title = 'Play the notes of this ' + (id.startsWith('song-') ? 'song' : 'sound') + ' through the ' + NX[game].label + ' → General MIDI table and the plain reference synth (one pass; pitch bends are not converted)';
      gmBtn.addEventListener('click', () => { playGm(id).catch(fail('GM playback')); });
      controls.append(gmBtn);
    }
    if (!isNx() && gmMap && root.Nhl92SongGm && root.Nhl92GmReference) {
      const isSong = id.startsWith('song-');
      const gmBtn = make('button', 'ghost-btn st-gm', '▶ Play as GM');
      gmBtn.type = 'button';
      gmBtn.setAttribute('aria-pressed', 'false');
      if (isSong) gmBtn.title = 'Play this song through the NHL 92 → General MIDI table and the plain reference synth (one pass)';
      else if (sfxIsDacOnly(n)) {
        gmBtn.disabled = true;
        gmBtn.title = 'This sound effect is a DAC sample only: there are no FM notes to play as General MIDI';
      } else gmBtn.title = 'Play the FM notes of this sound effect through the NHL 92 → General MIDI table and the plain reference synth (DAC samples are left out)';
      gmBtn.addEventListener('click', () => { playGm(id).catch(fail('GM playback')); });
      controls.append(gmBtn);
    }
    controls.append(vol);
    box.appendChild(controls);

    if (isNx() && nxMap && root.Nhl9xSong && root.NhlSoundTools && root.Nhl92Smf) {
      const ex = make('div', 'st-controls st-exports');
      const b = make('button', 'ghost-btn', 'Export MIDI (GM)');
      b.type = 'button';
      b.title = 'Standard MIDI file with General MIDI sounds chosen by the ' + NX[game].label + ' → GM table';
      b.addEventListener('click', () => { exportNxMidi(id).catch(fail('Export MIDI')); });
      if (id.startsWith('song-') && root.Nhl9xStream && root.NhlSoundToolsNx) {
        const model = () => root.Nhl9xStream.fromStream(nxNumber(), nxSlice, n, nxMap);
        const nm = (NX[game].short === '93' ? 'nhlpa93' : 'nhl94') + '-song-' + n.toString(16);
        const edit = make('button', 'ghost-btn', 'Edit in sequencer');
        edit.type = 'button';
        edit.title = 'Copy this song (notes, patches and pitch bends) into the sequencer to change it';
        edit.addEventListener('click', () => {
          root.NhlSoundToolsNx.loadSong(nxNumber(), model(), nm, []);
          host().openItem(TOOL_EDITOR);
        });
        ex.appendChild(edit);
        ex.appendChild(b);
        const nat = make('button', 'ghost-btn', 'Export MIDI (native)');
        nat.type = 'button';
        nat.title = 'Standard MIDI file with one track per channel; patches and pitch bends ride in marker events so the sequencer reads it back exactly';
        nat.addEventListener('click', () => {
          try {
            const smf = root.Nhl9xStream.toSmfNative(model());
            smf.name = nm;
            root.NhlSoundTools.download(nm + '-native.mid', root.Nhl92Smf.write(smf), 'audio/midi');
          } catch (err) { fail('Export MIDI (native)')(err); }
        });
        ex.appendChild(nat);
        [['asm', 'Export stream (.asm)', 'The song\'s event stream as source, one comment per event (the loop address is absolute: relocate it)'], ['bin', 'Export stream (.bin)', 'The song\'s event stream as bytes']].forEach(([kind, text, tip]) => {
          const x = make('button', 'ghost-btn', text);
          x.type = 'button';
          x.title = tip;
          x.addEventListener('click', () => { try { root.NhlSoundToolsNx.exportSongStream(model(), nm, kind); } catch (err) { fail(text)(err); } });
          ex.appendChild(x);
        });
      } else ex.appendChild(b);
      box.appendChild(ex);
    }

    // Edit / export: the same conversions the sequencer uses, straight from this entry.
    if (!isNx() && root.NhlSoundTools && root.Nhl92Song && root.Nhl92SongGm && root.Nhl92Smf) {
      const ex = make('div', 'st-controls st-exports');
      const add = (label, title, fn) => {
        const b = make('button', 'ghost-btn', label);
        b.type = 'button';
        b.title = title;
        b.addEventListener('click', () => { try { Promise.resolve(fn()).catch(fail(label)); } catch (err) { fail(label)(err); } });
        ex.appendChild(b);
        return b;
      };
      if (id.startsWith('song-')) {
        const name = 'nhl92-song-' + n;
        const song = () => root.Nhl92Song.fromParsed(data, n);
        add('Edit in sequencer', 'Copy this song into the sequencer to change it (Undo there returns to your previous song)', () => {
          root.NhlSoundTools.loadSong(song(), name);
          host().openItem(TOOL_EDITOR);
        });
        add('Export MIDI (GM)', 'Standard MIDI file with General MIDI sounds chosen by the NHL 92 → GM table', () => root.NhlSoundTools.exportSong(song(), name, 'midi-gm', gmMap));
        add('Export MIDI (native)', 'Standard MIDI file with one track per FM channel; the NHL 92 patches and effects ride in marker events so the sequencer reads it back exactly', () => root.NhlSoundTools.exportSong(song(), name, 'midi-fm', gmMap));
        add('Export cmdstream (.asm)', 'The song rebuilt as NHL 92 cmdstream source (see docs/NHL92-SEQUENCER.md)', () => root.NhlSoundTools.exportSong(song(), name, 'asm', gmMap));
        add('Export cmdstream (.bin)', 'The song rebuilt as NHL 92 cmdstream bytes', () => root.NhlSoundTools.exportSong(song(), name, 'bin', gmMap));
      } else if (gmMap && !sfxIsDacOnly(n)) {
        add('Export MIDI (GM)', 'The FM notes of this sound effect as a General MIDI file', () => exportSfxMidi(n));
      }
      if (ex.children.length) box.appendChild(ex);
    }

    const progress = make('div', 'st-progress');
    progress.appendChild(make('div', 'st-bar'));
    progress.tabIndex = 0;
    progress.setAttribute('role', 'slider');
    progress.setAttribute('aria-label', 'Playback position (click or drag to seek while playing)');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    progress.setAttribute('aria-valuenow', '0');
    const fractionOf = (ev) => {
      const r = progress.getBoundingClientRect();
      return Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width)));
    };
    progress.addEventListener('pointerdown', (ev) => {
      drag = fractionOf(ev);
      progress.setPointerCapture(ev.pointerId);
      progress.querySelector('.st-bar').style.width = (drag * 100).toFixed(1) + '%';
    });
    progress.addEventListener('pointermove', (ev) => {
      if (drag == null) return;
      drag = fractionOf(ev);
      progress.querySelector('.st-bar').style.width = (drag * 100).toFixed(1) + '%';
    });
    const release = (ev) => {
      if (drag == null) return;
      const f = ev.type === 'pointercancel' ? null : fractionOf(ev);
      drag = null;
      if (f != null) seekFraction(id, f);
      status(true);
    };
    progress.addEventListener('pointerup', release);
    progress.addEventListener('pointercancel', release);
    progress.addEventListener('keydown', (ev) => {
      const step = ev.key === 'ArrowRight' ? 0.05 : ev.key === 'ArrowLeft' ? -0.05 : 0;
      if (!step) return;
      ev.preventDefault();
      ev.stopPropagation();
      seekFraction(id, lastFraction + step);
    });
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
      if (isNx()) {
        return id === TOOL_IMPORT
          ? [['Tool', title(id)], ['In', 'Standard MIDI file (format 0 or 1)'], ['Out', 'a ' + NX[game].label + ' song in the sequencer'], ['Mapping', 'data/audio/nhl9x-gm-map.json'], ['Notes', 'docs/NHL93-94-SOUND.md']]
          : [['Tool', title(id)], ['Song', 'eight channels, notes on a grid of vblanks, pitch bends kept'], ['Plays on', 'the retail 68k + Z80 drivers, as the last song of a ROM copy'], ['Exports', 'MIDI, event stream asm and binary'], ['Notes', 'docs/NHL93-94-SOUND.md']];
      }
      return id === TOOL_IMPORT
        ? [['Tool', title(id)], ['In', 'Standard MIDI file (format 0 or 1)'], ['Out', 'an NHL 92 song in the sequencer (and a GM file)'], ['Mapping', 'data/audio/nhl92-gm-map.json'], ['Notes', 'docs/NHL92-SEQUENCER.md']]
        : [['Tool', title(id)], ['Song', 'six FM channels, one note at a time each'], ['Plays on', 'the retail 68k + Z80 drivers, as song 4 of a ROM copy'], ['Exports', 'MIDI, cmdstream asm and binary'], ['Notes', 'docs/NHL92-SEQUENCER.md']];
    }
    const n = Number(id.split('-')[1]);
    const rows = [['Plays', title(id)]];
    if (isNx()) {
      const rec = id.startsWith('song-') ? song94(n) : sfx94(n);
      rows.push(['Sound id', '$' + n.toString(16).toUpperCase() + (id.startsWith('song-') ? ' (song)' : ' (SFX)')]);
      if (rec.blurb) rows.push(['Used by', rec.blurb]);
      rows.push(['Length', id.startsWith('song-') ? 'until Stop' : SFX_VBLANKS + ' vblanks']);
      rows.push(['Path', '68k driver → Z80 driver → YM2612 + SN76489']);
      rows.push(['Frame', '59,736 Z80 T-states (59.92 Hz)']);
      rows.push(['Output', '53,267 Hz, live']);
      rows.push(['Source', 'Bundled ' + NX[game].label + ' sound segment ($' + NX[game].start.toString(16).toUpperCase() + '–$' + NX[game].size.toString(16).toUpperCase() + ')']);
      rows.push(['Notes', 'docs/NHL93-94-SOUND.md']);
      return rows;
    }
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
    setGame,
    get game() { return game; },
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
