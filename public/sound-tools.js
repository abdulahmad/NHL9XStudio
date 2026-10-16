/**
 * Sound test tools: "MIDI import → General MIDI" and the "Sequencer · new NHL 92 song" editor.
 * Both panels are drawn by NhlSoundTools.render(box, id, host); `host` comes from sound-test-view.js
 * (the ROM, the parsed sound data, the mapping JSON, playback of rendered buffers and of the
 * retail chain). The song model, cmdstream encoder and MIDI conversions are in lib/audio:
 * nhl92-song.js, nhl92-song-gm.js, smf.js, gm-reference.js.
 *
 * The editor's song is six FM channels of single notes on a 16th-note grid (1 unit). It plays
 * on the real drivers: the song is built into cmdstreams, put into a copy of the sound ROM as
 * song 4 and run through the same chain as the retail songs. The copy lives in memory only.
 */
(function (root) {
  const Song = () => root.Nhl92Song;
  const SongGm = () => root.Nhl92SongGm;
  const Smf = () => root.Nhl92Smf;
  const Ref = () => root.Nhl92GmReference;

  const COLORS = ['#f0b429', '#4cc9f0', '#8fd0a8', '#ff7a90', '#b69cff', '#ff9f5a'];
  const STORE_KEY = 'nhl9x.sequencer.song';
  const BAR = 16; // units per bar
  const MIDI_LO = 21; // lowest / highest note shown: note indexes 9-90
  const MIDI_HI = 102;
  const ROW_H = 9;
  const GUTTER = 38;
  const LENGTHS = [1, 2, 3, 4, 6, 8, 12, 16];
  const PATTERN_BYTES = 0x11624 - 0x1061e;

  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (label, onClick, cls) => {
    const b = make('button', 'ghost-btn ' + (cls || ''), label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  const nextFrame = () => new Promise((r) => setTimeout(r, 20));

  function download(name, bytes, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type: type || 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const safeName = (s) => (String(s || 'song').replace(/\.[A-Za-z0-9]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'song');

  /** File → { gm, report, name, parsed } through smf.js and the General MIDI clean-up. */
  async function readMidiFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = Smf().parse(bytes);
    const norm = SongGm().normalizeGm(parsed);
    norm.song.name = safeName(file.name);
    return { gm: norm.song, report: norm.report, stats: norm.stats, name: safeName(file.name), parsed };
  }

  function reportList(lines) {
    const ul = make('ul', 'se-report');
    lines.forEach((t) => ul.appendChild(make('li', null, t)));
    return ul;
  }

  // --- Shared state (kept while you move around the Sound test) ------------------------------

  const model = {
    song: null, // NhlSong
    name: 'my-song',
    undo: [],
    channel: 0,
    patch: 6,
    len: 4,
    sel: [], // selected notes (objects of the current song)
    fx: { modDelay: 0, modDelta: 0, env: -1, envSpeed: -128, legato: false, noKeyOff: false }, // effects new notes get
    imported: null, // last file read by the import panel
    gmReport: [],
    zoom: 14
  };

  function newSong() {
    const s = Song().emptySong(6);
    s.units = BAR * 4;
    return s;
  }

  function loadStored() {
    try {
      const raw = root.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (o && o.song && Array.isArray(o.song.channels) && o.song.channels.length === 6) return o;
    } catch (err) { /* nothing stored */ }
    return null;
  }

  function store() {
    try { root.localStorage.setItem(STORE_KEY, JSON.stringify({ song: model.song, name: model.name })); } catch (err) { /* not kept */ }
  }

  function ensureModel() {
    if (model.song) return;
    const kept = loadStored();
    if (kept) { model.song = kept.song; model.name = kept.name || model.name; } else model.song = newSong();
  }

  const clone = (s) => JSON.parse(JSON.stringify(s));

  // --- MIDI import panel --------------------------------------------------------------------

  function renderImport(box, id, host) {
    box.appendChild(make('p', 'st-kind', 'Tool'));
    box.appendChild(make('h3', null, 'MIDI import → NHL 92'));
    box.appendChild(make('p', 'st-note', 'Open a Standard MIDI file. It is converted to an NHL 92 song (six FM channels, patches chosen by the GM → NHL 92 table) and opened in the sequencer, where you can edit it, ' +
      'play it on the retail drivers and export it. The conversion report is kept under the editor. You can also hear the cleaned-up General MIDI version with the plain reference sounds, or save it as a GM file, from here.'));

    const controls = make('div', 'st-controls');
    const input = make('input');
    input.type = 'file';
    input.accept = '.mid,.midi,audio/midi,audio/x-midi';
    input.id = 'tool-import-file';
    input.setAttribute('aria-label', 'MIDI file');
    const play = button('▶ Play', () => toggle(), 'se-playbtn');
    play.id = 'tool-import-play';
    play.disabled = true;
    const save = button('Save General MIDI (.mid)', () => {
      const m = model.imported;
      download(m.name + '-gm.mid', Smf().write(SongGm().toSmfSong(m.gm)), 'audio/midi');
    });
    save.id = 'tool-import-save';
    save.disabled = true;
    const toEditor = button('Open in sequencer', () => convert());
    toEditor.id = 'tool-import-convert';
    toEditor.disabled = true;
    controls.append(input, play, save, toEditor);
    box.appendChild(controls);
    const status = make('p', 'st-status mono', model.imported ? 'Loaded ' + model.imported.name : 'No file loaded');
    status.id = 'tool-import-status';
    box.appendChild(status);
    const out = make('div', 'se-out');
    box.appendChild(out);

    function show() {
      const m = model.imported;
      out.replaceChildren();
      if (!m) return;
      out.appendChild(make('p', 'st-kind', m.name));
      out.appendChild(reportList(m.report));
      play.disabled = false;
      save.disabled = false;
      toEditor.disabled = false;
      refreshPlay();
    }
    function refreshPlay() {
      const on = host.bufferId === id;
      play.textContent = on ? '■ Stop' : '▶ Play';
      play.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    async function toggle() {
      if (host.bufferId === id) { host.stopBuffer(); refreshPlay(); return; }
      const m = model.imported;
      if (!m) { status.textContent = 'Open a MIDI file first'; return; }
      status.textContent = 'Rendering with the General MIDI reference sounds…';
      await nextFrame();
      const events = SongGm().gmEvents(m.gm);
      const buf = Ref().renderEvents(events);
      await host.playBuffer(id, buf, Ref().SAMPLE_RATE);
      status.textContent = 'Playing · ' + (buf.length / Ref().SAMPLE_RATE).toFixed(1) + ' s · plain reference synth';
      refreshPlay();
    }
    function convert() {
      const m = model.imported;
      const r = SongGm().gmToNhl(m.gm, host.map);
      ensureModel();
      model.undo.push(clone(model.song));
      model.song = r.song;
      model.name = m.name;
      model.gmReport = m.report.concat(r.report);
      store();
      status.textContent = 'Converted to an NHL 92 song; opening the sequencer.';
      out.replaceChildren(make('p', 'st-kind', m.name + ' → NHL 92'), reportList(r.report));
      if (host.openItem) host.openItem('tool-editor');
    }
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        host.stopBuffer();
        const r = await readMidiFile(file);
        const native = SongGm().nhlFromNativeSmf(r.parsed);
        if (native) {
          ensureModel();
          model.undo.push(clone(model.song));
          model.song = native.song;
          model.name = r.name;
          model.sel = [];
          model.gmReport = native.report;
          store();
          out.replaceChildren(make('p', 'st-kind', r.name + ' (native NHL 92 file)'), reportList(native.report));
          status.textContent = 'Loaded ' + file.name + ' as a native NHL 92 song; opening the sequencer.';
          if (host.openItem) host.openItem('tool-editor');
          return;
        }
        if (!r.gm.notes.length) throw new Error('the file has no notes');
        model.imported = r;
        status.textContent = 'Loaded ' + file.name;
        show();
        convert(); // the point of the import: an NHL 92 song you can edit
      } catch (err) {
        model.imported = null;
        out.replaceChildren();
        play.disabled = save.disabled = toEditor.disabled = true;
        status.textContent = 'Could not read that file: ' + (err && err.message ? err.message : String(err));
      }
    });
    host.toggles[id] = () => toggle();
    show();
  }

  // --- Sequencer ----------------------------------------------------------------------------

  function renderEditor(box, id, host) {
    ensureModel();
    const S = Song();
    const map = host.map;
    box.appendChild(make('p', 'st-kind', 'Tool'));
    box.appendChild(make('h3', null, 'Sequencer · new NHL 92 song'));
    box.appendChild(make('p', 'st-note', 'Six FM channels, one note at a time each, on a 16th-note grid. Click an empty cell to add a note on the selected channel, ' +
      'click a note of that channel to remove it. Play runs the song on the retail drivers; Export writes MIDI or the NHL 92 cmdstream.'));

    // Toolbar: song settings
    const row1 = make('div', 'st-controls se-bar');
    const nameIn = make('input');
    nameIn.type = 'text';
    nameIn.value = model.name;
    nameIn.maxLength = 40;
    nameIn.id = 'se-name';
    nameIn.setAttribute('aria-label', 'Song name');
    const tempoIn = make('input');
    tempoIn.type = 'number';
    tempoIn.min = '2';
    tempoIn.max = '16';
    tempoIn.id = 'se-tempo';
    tempoIn.setAttribute('aria-label', 'Tempo in frames per unit');
    const tempoNote = make('span', 'se-dim');
    const barsIn = make('input');
    barsIn.type = 'number';
    barsIn.min = '1';
    barsIn.max = '64';
    barsIn.id = 'se-bars';
    barsIn.setAttribute('aria-label', 'Bars');
    const fresh = make('button', 'ghost-btn', 'New empty song');
    fresh.type = 'button';
    fresh.title = 'Clear the sequencer (Undo brings the song back)';
    const lab = (text, el) => { const l = make('label', 'st-volume'); l.append(make('span', null, text), el); return l; };
    const importBtn = make('input');
    importBtn.type = 'file';
    importBtn.accept = '.mid,.midi,audio/midi,audio/x-midi';
    importBtn.id = 'se-import';
    importBtn.setAttribute('aria-label', 'Import MIDI');
    row1.append(lab('Name', nameIn), lab('Tempo', tempoIn), tempoNote, lab('Bars', barsIn), fresh, lab('Import MIDI', importBtn));
    box.appendChild(row1);

    // Toolbar: what a click adds
    const row2 = make('div', 'st-controls se-bar');
    const chanBox = make('div', 'se-chans');
    chanBox.setAttribute('role', 'radiogroup');
    chanBox.setAttribute('aria-label', 'Channel');
    const chanBtns = [];
    for (let c = 0; c < 6; c++) {
      const b = make('button', 'ghost-btn se-chan', 'FM' + (c + 1));
      b.type = 'button';
      b.style.setProperty('--ch', COLORS[c]);
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => { model.channel = c; refreshTools(); draw(); });
      chanBtns.push(b);
      chanBox.appendChild(b);
    }
    const patchSel = make('select');
    patchSel.id = 'se-patch';
    patchSel.setAttribute('aria-label', 'Instrument');
    for (let p = 0; p < S.PATCH_COUNT; p++) {
      const e = map && map.nhl92ToGm.patches[p];
      patchSel.appendChild(Object.assign(make('option', null, p + (e ? ' · ≈ ' + e.target.name : '')), { value: String(p) }));
    }
    patchSel.addEventListener('change', () => {
      model.patch = Number(patchSel.value);
      if (model.sel.length) edit(() => model.sel.forEach((n) => { n.patch = model.patch; }));
    });
    const lenSel = make('select');
    lenSel.id = 'se-len';
    lenSel.setAttribute('aria-label', 'Note length in units');
    LENGTHS.forEach((l) => lenSel.appendChild(Object.assign(make('option', null, l + (l === 1 ? ' unit (16th)' : l === 4 ? ' units (quarter)' : ' units')), { value: String(l) })));
    lenSel.addEventListener('change', () => { model.len = Number(lenSel.value); });
    row2.append(chanBox, lab('Instrument', patchSel), lab('Length', lenSel));
    box.appendChild(row2);

    // Toolbar: effects (what a new note gets; "Apply" writes them to the selected notes). Shift-click selects notes.
    const rowFx = make('div', 'st-controls se-bar se-fx');
    const numIn = (id, min, max, label) => {
      const i = make('input');
      i.type = 'number';
      i.min = String(min);
      i.max = String(max);
      i.id = id;
      i.setAttribute('aria-label', label);
      return i;
    };
    const modDelay = numIn('se-mod-delay', 0, 255, 'Modulation delay in frames (0 = off)');
    const modDelta = numIn('se-mod-delta', -128, 127, 'Modulation delta per frame');
    const envSel = make('select');
    envSel.id = 'se-env';
    envSel.setAttribute('aria-label', 'Pitch envelope');
    [['-1', 'Off'], ['0', 'Envelope 0'], ['1', 'Envelope 1'], ['2', 'Envelope 2'], ['3', 'Envelope 3']].forEach(([v, t]) => envSel.appendChild(Object.assign(make('option', null, t), { value: v })));
    const envSpeed = numIn('se-env-speed', -128, 127, 'Pitch envelope speed');
    const legatoCb = make('input');
    legatoCb.type = 'checkbox';
    legatoCb.id = 'se-legato';
    const keyCb = make('input');
    keyCb.type = 'checkbox';
    keyCb.id = 'se-nokey';
    const readFx = () => {
      model.fx = {
        modDelay: Math.max(0, Math.min(255, Math.round(Number(modDelay.value) || 0))),
        modDelta: Math.max(-128, Math.min(127, Math.round(Number(modDelta.value) || 0))),
        env: Number(envSel.value),
        envSpeed: Math.max(-128, Math.min(127, Math.round(Number(envSpeed.value) || 0))),
        legato: legatoCb.checked,
        noKeyOff: keyCb.checked
      };
    };
    [modDelay, modDelta, envSel, envSpeed, legatoCb, keyCb].forEach((el) => el.addEventListener('change', readFx));
    const fxOf = (f) => {
      const o = {};
      if (f.modDelay > 0 && f.modDelta !== 0) o.mod = { delay: f.modDelay, delta: f.modDelta };
      if (f.env >= 0 && f.envSpeed !== 0) o.env = { id: f.env, speed: f.envSpeed };
      if (f.legato) o.legato = true;
      if (f.noKeyOff) o.noKeyOff = true;
      return o;
    };
    const applyFx = button('Apply to selected', () => {
      readFx();
      if (!model.sel.length) return;
      edit(() => model.sel.forEach((n) => { delete n.mod; delete n.env; delete n.legato; delete n.noKeyOff; Object.assign(n, fxOf(model.fx)); }));
    });
    applyFx.id = 'se-fx-apply';
    const selChan = button('Select channel', () => { model.sel = model.song.channels[model.channel].slice(); refreshTools(); draw(); });
    selChan.id = 'se-sel-channel';
    const selPatch = button('Select this instrument', () => { model.sel = model.song.channels[model.channel].filter((n) => n.patch === model.patch); refreshTools(); draw(); });
    selPatch.id = 'se-sel-patch';
    const selNone = button('Select none', () => { model.sel = []; refreshTools(); draw(); });
    selNone.id = 'se-sel-none';
    const selDel = button('Delete selected', () => {
      const dead = new Set(model.sel);
      edit(() => { model.song.channels = model.song.channels.map((c) => c.filter((n) => !dead.has(n))); model.sel = []; });
    });
    selDel.id = 'se-sel-delete';
    rowFx.append(make('span', 'se-dim', 'Effects:'), lab('Modulation delay', modDelay), lab('delta', modDelta), lab('Pitch envelope', envSel), lab('speed', envSpeed), lab('Legato', legatoCb), lab('No key-off', keyCb), applyFx, selChan, selPatch, selNone, selDel);
    box.appendChild(rowFx);
    const selInfo = make('p', 'st-status mono se-sel');
    selInfo.id = 'se-selinfo';
    box.appendChild(selInfo);

    // Toolbar: play / export
    const row3 = make('div', 'st-controls se-bar');
    const playBtn = button('▶ Play', () => {}, 'se-playbtn');
    playBtn.id = 'se-play';
    const gmBtn = button('▶ Play as GM', () => {});
    gmBtn.id = 'se-play-gm';
    const undoBtn = button('Undo', () => undo());
    undoBtn.id = 'se-undo';
    const clearBtn = button('Clear channel', () => edit(() => { model.song.channels[model.channel] = []; }));
    clearBtn.id = 'se-clear';
    const exMidi = button('Export MIDI (GM)', () => exportMidi(true));
    exMidi.id = 'se-export-midi';
    const exRaw = button('Export MIDI (native)', () => exportMidi(false));
    exRaw.id = 'se-export-raw';
    const exAsm = button('Export cmdstream (.asm)', () => exportCmd('asm'));
    exAsm.id = 'se-export-asm';
    const exBin = button('Export cmdstream (.bin)', () => exportCmd('bin'));
    exBin.id = 'se-export-bin';
    row3.append(playBtn, gmBtn, undoBtn, clearBtn, exMidi, exRaw, exAsm, exBin);
    box.appendChild(row3);

    const info = make('p', 'st-status mono se-info');
    info.id = 'se-info';
    const hover = make('p', 'st-status mono se-hover');
    hover.id = 'se-hover';
    box.append(info, hover);

    const scroller = make('div', 'se-scroll');
    const canvas = make('canvas', 'se-canvas');
    canvas.id = 'se-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Piano roll editor for the six FM channels');
    // The canvas is only as wide as the scroller and is moved along with it (a 100-bar song is far wider
    // than a browser allows a canvas to be); `inner` gives the scroller its full width.
    const inner = make('div', 'se-inner');
    inner.appendChild(canvas);
    scroller.appendChild(inner);
    box.appendChild(scroller);

    const messages = make('div', 'se-out');
    messages.id = 'se-messages';
    box.appendChild(messages);
    const seq = make('div', 'st-seq');
    box.appendChild(seq);
    host.mountRoll(seq);

    // --- behaviour ---

    function edit(fn) {
      model.undo.push(clone(model.song));
      if (model.undo.length > 50) model.undo.shift();
      fn();
      afterChange();
    }
    function undo() {
      if (!model.undo.length) return;
      model.song = model.undo.pop();
      model.sel = [];
      afterChange();
    }
    function totalUnits() { return Math.max(BAR, Math.ceil(S.lengthOf(model.song) / BAR) * BAR); }
    function afterChange() {
      model.song.units = Math.max(BAR, Math.ceil(S.lengthOf(model.song) / BAR) * BAR, model.song.units || 0);
      store();
      refreshTools();
      draw();
    }
    function refreshTools() {
      nameIn.value = model.name;
      tempoIn.value = String(model.song.tempo);
      tempoNote.textContent = '= ' + S.bpmOfTempo(model.song.tempo).toFixed(0) + ' BPM, ' + (model.song.tempo / S.FRAME_HZ * 1000).toFixed(0) + ' ms per 16th';
      barsIn.value = String(Math.ceil(model.song.units / BAR));
      patchSel.value = String(model.patch);
      lenSel.value = String(model.len);
      chanBtns.forEach((b, c) => {
        b.setAttribute('aria-checked', c === model.channel ? 'true' : 'false');
        b.classList.toggle('is-on', c === model.channel);
      });
      modDelay.value = String(model.fx.modDelay);
      modDelta.value = String(model.fx.modDelta);
      envSel.value = String(model.fx.env);
      envSpeed.value = String(model.fx.envSpeed);
      legatoCb.checked = model.fx.legato;
      keyCb.checked = model.fx.noKeyOff;
      applyFx.disabled = !model.sel.length;
      selDel.disabled = !model.sel.length;
      const used = {};
      model.song.channels[model.channel].forEach((n) => { used[n.patch] = (used[n.patch] || 0) + 1; });
      const legend = Object.keys(used).map((p) => 'P' + p + '×' + used[p]).join(' ');
      selInfo.textContent = 'FM' + (model.channel + 1) + ' instruments: ' + (legend || 'none') + ' · ' + model.sel.length + ' selected (shift-click a note to select; changing the Instrument or pressing Apply changes the selection)';
      undoBtn.disabled = !model.undo.length;
      const notes = model.song.channels.reduce((n, c) => n + c.length, 0);
      let text = notes + ' notes · ' + model.song.units + ' units · ' + (model.song.units * S.secondsPerUnit(model.song.tempo)).toFixed(1) + ' s per pass';
      let problems = [];
      if (notes) {
        try {
          const built = S.build(model.song);
          problems = built.problems;
          text += ' · ' + built.stats.patterns + ' patterns, ' + built.stats.patternBytes + ' / ' + PATTERN_BYTES + ' pattern bytes';
          if (built.stats.patternBytes > PATTERN_BYTES) problems = problems.concat(['Too long for the retail pattern block: it cannot be played here or placed in the ROM as is.']);
        } catch (err) { problems = [String(err.message || err)]; }
      }
      info.textContent = text;
      messages.replaceChildren(...(problems.length ? [reportList(problems)] : []), ...(model.gmReport.length ? [make('p', 'st-kind', 'Last import'), reportList(model.gmReport)] : []));
      playBtn.textContent = host.editorPlaying ? '■ Stop' : '▶ Play';
      gmBtn.textContent = host.bufferId === id ? '■ Stop GM' : '▶ Play as GM';
    }

    function geometry() {
      const units = totalUnits() + BAR;
      const w = GUTTER + units * model.zoom;
      const h = (MIDI_HI - MIDI_LO + 1) * ROW_H;
      return { units, w, h };
    }
    const BLACK = new Set([1, 3, 6, 8, 10]);
    function draw() {
      const { units, w, h } = geometry();
      const dpr = Math.min(2, root.devicePixelRatio || 1);
      const viewW = Math.max(200, Math.min(w, scroller.clientWidth || 900));
      const sx = Math.max(0, Math.min(scroller.scrollLeft, w - viewW));
      inner.style.width = w + 'px';
      inner.style.height = h + 'px';
      if (canvas.width !== Math.round(viewW * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(viewW * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = viewW + 'px';
        canvas.style.height = h + 'px';
      }
      canvas.style.left = sx + 'px';
      const g = canvas.getContext('2d');
      const css = getComputedStyle(document.documentElement);
      const v = (n, f) => (css.getPropertyValue(n) || '').trim() || f;
      const C = { bg: v('--bg', '#101418'), panel: v('--raise', '#1a2129'), line: v('--line', '#33414d'), text: v('--text', '#e8eef3'), muted: v('--muted', '#8ea0b0') };
      g.setTransform(dpr, 0, 0, dpr, -sx * dpr, 0); // world coordinates; the canvas shows [sx, sx + viewW]
      g.fillStyle = C.bg;
      g.fillRect(sx, 0, viewW, h);
      for (let m = MIDI_LO; m <= MIDI_HI; m++) {
        const y = (MIDI_HI - m) * ROW_H;
        if (BLACK.has(m % 12)) { g.fillStyle = C.panel; g.fillRect(GUTTER, y, w - GUTTER, ROW_H); }
        if (m % 12 === 0) {
          g.strokeStyle = C.line;
          g.beginPath();
          g.moveTo(0, y + ROW_H - 0.5);
          g.lineTo(w, y + ROW_H - 0.5);
          g.stroke();
          g.fillStyle = C.muted;
          g.font = '9px ui-monospace, monospace';
          g.fillText(S.noteName(m), sx + 3, y + ROW_H - 1);
        }
      }
      for (let u = Math.max(0, Math.floor((sx - GUTTER) / model.zoom) - 1); u <= units && GUTTER + u * model.zoom <= sx + viewW; u++) {
        const x = GUTTER + u * model.zoom + 0.5;
        g.strokeStyle = C.line;
        g.globalAlpha = u % BAR === 0 ? 1 : u % 4 === 0 ? 0.55 : 0.2;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
        g.globalAlpha = 1;
        if (u % BAR === 0 && u < units) {
          g.fillStyle = C.muted;
          g.font = '9px ui-monospace, monospace';
          g.fillText(String(u / BAR + 1), x + 3, 9);
        }
      }
      // The song's end.
      const endX = GUTTER + model.song.units * model.zoom;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(endX, 0, Math.max(0, w - endX), h);
      model.song.channels.forEach((list, c) => {
        g.fillStyle = COLORS[c];
        g.globalAlpha = c === model.channel ? 1 : 0.3;
        list.forEach((n) => {
          const y = (MIDI_HI - (n.index + 12)) * ROW_H;
          const x = GUTTER + n.unit * model.zoom;
          g.fillRect(x + 0.5, y + 0.5, Math.max(2, n.len * model.zoom - 1), ROW_H - 1);
        });
        g.globalAlpha = 1;
      });
      g.font = '8px ui-monospace, monospace';
      g.fillStyle = '#111';
      model.song.channels[model.channel].forEach((n) => {
        const tag = String(n.patch) + (n.mod ? '~' : '') + (n.env ? 'E' : '') + (n.legato ? 'L' : '') + (n.noKeyOff ? 'K' : '');
        if (n.len * model.zoom >= 8 * tag.length + 6) g.fillText(tag, GUTTER + n.unit * model.zoom + 3, (MIDI_HI - (n.index + 12)) * ROW_H + ROW_H - 2);
      });
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      model.sel.forEach((n) => g.strokeRect(GUTTER + n.unit * model.zoom + 0.5, (MIDI_HI - (n.index + 12)) * ROW_H + 0.5, Math.max(2, n.len * model.zoom - 1), ROW_H - 1));
      g.lineWidth = 1;
    }

    function cellAt(ev) {
      const r = canvas.getBoundingClientRect();
      const x = ev.clientX - r.left + (parseFloat(canvas.style.left) || 0);
      const y = ev.clientY - r.top;
      const unit = Math.floor((x - GUTTER) / model.zoom);
      const midi = MIDI_HI - Math.floor(y / ROW_H);
      return { unit, midi };
    }

    let scrollDraw = 0;
    scroller.addEventListener('scroll', () => {
      if (!scrollDraw) scrollDraw = root.requestAnimationFrame(() => { scrollDraw = 0; draw(); });
    });
    canvas.addEventListener('pointermove', (ev) => {
      const c = cellAt(ev);
      hover.textContent = c.unit >= 0 && c.midi >= MIDI_LO && c.midi <= MIDI_HI
        ? 'FM' + (model.channel + 1) + ' · ' + S.noteName(c.midi) + ' · bar ' + (Math.floor(c.unit / BAR) + 1) + ' beat ' + (Math.floor((c.unit % BAR) / 4) + 1) + ' · unit ' + c.unit
        : '';
    });
    canvas.addEventListener('click', (ev) => {
      const { unit, midi } = cellAt(ev);
      if (unit < 0 || midi < MIDI_LO || midi > MIDI_HI) return;
      if (ev.shiftKey) { toggleSelect(unit, midi); return; }
      addOrRemove(unit, midi);
    });
    /** Shift-click: add the note under the cell to the selection (or remove it) and load its instrument and effects into the toolbar. */
    function toggleSelect(unit, midi) {
      const hit = model.song.channels[model.channel].find((n) => n.index === midi - 12 && unit >= n.unit && unit < n.unit + n.len);
      if (!hit) return;
      const at = model.sel.indexOf(hit);
      if (at >= 0) model.sel.splice(at, 1); else model.sel.push(hit);
      if (at < 0) {
        model.patch = hit.patch;
        model.fx = { modDelay: hit.mod ? hit.mod.delay : 0, modDelta: hit.mod ? hit.mod.delta : 0, env: hit.env ? hit.env.id : -1, envSpeed: hit.env ? hit.env.speed : model.fx.envSpeed, legato: !!hit.legato, noKeyOff: !!hit.noKeyOff };
      }
      refreshTools();
      draw();
    }

    /** Toggle: a note of the selected channel under the cell goes; otherwise one is added there. */
    function addOrRemove(unit, midi) {
      const list = model.song.channels[model.channel];
      const index = midi - 12;
      const hit = list.findIndex((n) => n.index === index && unit >= n.unit && unit < n.unit + n.len);
      if (hit >= 0) { edit(() => list.splice(hit, 1)); return; }
      if (unit >= model.song.units) {
        if (unit >= BAR * 64) return;
      }
      edit(() => {
        const start = unit;
        // Earlier notes that run into the new one are cut; notes that start inside it are removed.
        const keep = [];
        list.forEach((n) => {
          if (n.unit < start && n.unit + n.len > start) keep.push(Object.assign({}, n, { len: start - n.unit }));
          else if (n.unit >= start && n.unit < start + model.len) { /* replaced */ }
          else keep.push(n);
        });
        keep.push(Object.assign({ unit: start, len: model.len, index: index, patch: model.patch }, fxOf(model.fx)));
        keep.sort((a, b) => a.unit - b.unit);
        // A note that would run into the next one stops at it.
        keep.forEach((n, i) => { const nx = keep[i + 1]; if (nx && n.unit + n.len > nx.unit) n.len = nx.unit - n.unit; });
        model.song.channels[model.channel] = keep;
        model.song.units = Math.max(model.song.units, Math.ceil((start + model.len) / BAR) * BAR);
      });
    }

    nameIn.addEventListener('input', () => { model.name = safeName(nameIn.value) || 'song'; store(); });
    tempoIn.addEventListener('change', () => {
      const t = Math.max(2, Math.min(16, Math.round(Number(tempoIn.value) || 6)));
      edit(() => { model.song.tempo = t; });
    });
    barsIn.addEventListener('change', () => {
      const bars = Math.max(1, Math.min(64, Math.round(Number(barsIn.value) || 4)));
      edit(() => {
        const units = bars * BAR;
        model.song.units = units;
        model.song.channels = model.song.channels.map((ch) => ch.filter((n) => n.unit < units).map((n) => (n.unit + n.len > units ? Object.assign({}, n, { len: units - n.unit }) : n)));
      });
    });
    fresh.addEventListener('click', () => {
      edit(() => {
        model.sel = [];
        model.song = newSong();
        model.name = 'my-song';
        model.gmReport = [];
      });
    });
    importBtn.addEventListener('change', async () => {
      const file = importBtn.files && importBtn.files[0];
      importBtn.value = '';
      if (!file) return;
      try {
        const r = await readMidiFile(file);
        const native = SongGm().nhlFromNativeSmf(r.parsed);
        if (native) { edit(() => { model.song = native.song; model.name = r.name; model.sel = []; model.gmReport = native.report; }); return; }
        if (!r.gm.notes.length) throw new Error('the file has no notes');
        const out = SongGm().gmToNhl(r.gm, map);
        model.imported = r;
        edit(() => { model.song = out.song; model.name = r.name; model.sel = []; model.gmReport = r.report.concat(out.report); });
      } catch (err) {
        model.gmReport = ['Could not import that file: ' + (err && err.message ? err.message : String(err))];
        refreshTools();
      }
    });

    function buildOrExplain() {
      const notes = model.song.channels.reduce((n, c) => n + c.length, 0);
      if (!notes) throw new Error('Add some notes first');
      return S.build(model.song);
    }
    async function toggleNhl() {
      if (host.editorPlaying) { host.stopLive(); refreshTools(); return; }
      const built = buildOrExplain();
      const rom = S.romWithSong(host.rom, built);
      await host.playEditor(rom);
      refreshTools();
    }
    async function toggleGm() {
      if (host.bufferId === id) { host.stopBuffer(); refreshTools(); return; }
      const notes = model.song.channels.reduce((n, c) => n + c.length, 0);
      if (!notes) throw new Error('Add some notes first');
      info.textContent = 'Rendering with the General MIDI reference sounds…';
      await nextFrame();
      const gm = SongGm().nhlToGm(model.song, map).song;
      const buf = Ref().renderEvents(SongGm().gmEvents(gm));
      // The sequencer view follows the retail drivers playing the same song, level with the GM audio.
      let viz = null;
      try { viz = host.songViz(S.romWithSong(host.rom, S.build(model.song))); } catch (err) { /* too long for the driver: no view */ }
      await host.playBuffer(id, buf, Ref().SAMPLE_RATE, viz);
      refreshTools();
    }
    const guard = (fn) => () => fn().catch((err) => { info.textContent = String(err && err.message ? err.message : err); });
    playBtn.onclick = guard(toggleNhl);
    gmBtn.onclick = guard(toggleGm);
    host.toggles[id] = guard(toggleNhl);

    function exportMidi(mapped) {
      try {
        const notes = model.song.channels.reduce((n, c) => n + c.length, 0);
        if (!notes) throw new Error('Add some notes first');
        const smf = mapped
          ? SongGm().toSmfSong(SongGm().nhlToGm(model.song, map).song)
          : SongGm().nhlToSmfSong(model.song, model.name);
        if (mapped) smf.name = model.name;
        download(model.name + (mapped ? '-gm' : '-fm') + '.mid', Smf().write(smf), 'audio/midi');
      } catch (err) { info.textContent = String(err.message || err); }
    }
    function exportCmd(kind) {
      try {
        const built = buildOrExplain();
        if (kind === 'asm') download(model.name + '.asm', S.toAsm(built, model.name), 'text/plain');
        else download(model.name + '.nhl92song.bin', S.toBinary(built), 'application/octet-stream');
      } catch (err) { info.textContent = String(err.message || err); }
    }

    afterChange();
    // Scroll the roll to the middle of the range on first show.
    // Open on the music: the first note of any channel, at the pitch range it uses (an imported song can start with rests).
    {
      const all = model.song.channels.flat();
      if (all.length) {
        const first = Math.min(...all.map((n) => n.unit));
        const mids = all.filter((n) => n.unit < first + BAR * 8).map((n) => n.index + 12);
        const mid = (Math.min(...mids) + Math.max(...mids)) / 2;
        scroller.scrollLeft = Math.max(0, GUTTER + first * model.zoom - GUTTER - 20);
        scroller.scrollTop = Math.max(0, (MIDI_HI - mid) * ROW_H - (scroller.clientHeight || 380) / 2);
      } else scroller.scrollTop = Math.max(0, (MIDI_HI - 76) * ROW_H);
    }
    draw();
    // Keep the play button honest while the chain runs.
    const timer = setInterval(() => {
      if (!box.isConnected) { clearInterval(timer); return; }
      const label = host.editorPlaying ? '■ Stop' : '▶ Play';
      if (playBtn.textContent !== label) playBtn.textContent = label;
      const gl = host.bufferId === id ? '■ Stop GM' : '▶ Play as GM';
      if (gmBtn.textContent !== gl) gmBtn.textContent = gl;
    }, 300);
  }

  function render(box, id, host) {
    if (id === 'tool-import') renderImport(box, id, host);
    else renderEditor(box, id, host);
  }

  /** Put a song (e.g. a retail one) into the sequencer as the song being edited; undo returns to the previous one. */
  function loadSong(nhlSong, name) {
    ensureModel();
    model.undo.push(clone(model.song));
    if (model.undo.length > 50) model.undo.shift();
    model.song = clone(nhlSong);
    model.sel = [];
    model.name = safeName(name);
    model.gmReport = [];
    store();
  }

  /** Download a song as 'midi-gm', 'midi-fm', 'asm' or 'bin' (the same files as the sequencer's Export buttons). */
  function exportSong(nhlSong, name, kind, map) {
    const base = safeName(name);
    const S = Song();
    if (kind === 'midi-gm' || kind === 'midi-fm') {
      const mapped = kind === 'midi-gm';
      const smf = mapped ? SongGm().toSmfSong(SongGm().nhlToGm(nhlSong, map).song) : SongGm().nhlToSmfSong(nhlSong, base);
      if (mapped) smf.name = base;
      download(base + (mapped ? '-gm' : '-fm') + '.mid', Smf().write(smf), 'audio/midi');
    } else if (kind === 'asm') download(base + '.asm', S.toAsm(S.build(nhlSong), base), 'text/plain');
    else download(base + '.nhl92song.bin', S.toBinary(S.build(nhlSong)), 'application/octet-stream');
  }

  root.NhlSoundTools = { render, model, readMidiFile, loadSong, exportSong, download };
})(typeof self !== 'undefined' ? self : this);
