/**
 * Sound test tools for NHLPA 93 / NHL 94: "MIDI import → NHL 93/94" and "Sequencer · new NHL 93/94 song".
 * Drawn by NhlSoundToolsNx.render(box, id, host); `host` comes from sound-test-view.js. The song model, the event
 * stream encoder and the MIDI import are lib/audio/nhl9x-stream.js (event format: nhl9x-song.js).
 *
 * The editor's song is up to eight channels of notes on a grid of vblanks. It plays on the real drivers: the song is
 * encoded, appended to a copy of the sound slice and one song-table entry of the copy is pointed at it, then the
 * same chain as the retail songs runs it. The copy lives in memory only. Pitch bends are kept (from a retail song or
 * an imported MIDI file) and exported, and can be cleared per channel; they are not drawn on the roll note by note.
 */
(function (root) {
  const Stream = () => root.Nhl9xStream;
  const SongLib = () => root.Nhl9xSong;
  const SongGm = () => root.Nhl92SongGm;
  const Smf = () => root.Nhl92Smf;
  const Ref = () => root.Nhl92GmReference;
  const Tools = () => root.NhlSoundTools;

  const COLORS = ['#f0b429', '#4cc9f0', '#8fd0a8', '#ff7a90', '#b69cff', '#ff9f5a', '#7bdff2', '#c7f464'];
  const STORE_KEY = 'nhl9x.sequencer.nx.';
  const NOTE_LO = 12;
  const NOTE_HI = 95;
  const ROW_H = 8;
  const GUTTER = 38;
  const GRIDS = [4, 6, 8, 10, 12, 15, 16, 20];
  const LENGTHS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];
  const BEAT = 4; // units per beat
  const BAR = 16;
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = (n) => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);

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
  const clone = (s) => JSON.parse(JSON.stringify(s));
  const safeName = (s) => (String(s || 'song').replace(/\.[A-Za-z0-9]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'song');
  const reportList = (lines) => {
    const ul = make('ul', 'se-report');
    lines.forEach((t) => ul.appendChild(make('li', null, t)));
    return ul;
  };

  // State kept while you move around the Sound test: one song per game.
  const model = { songs: {}, names: {}, undo: [], channel: 0, patch: 11, len: 4, vel: 100, zoom: 4, report: [], loaded: {}, sel: [], mode: 'notes' };

  function songFor(game) {
    if (!model.songs[game]) {
      let kept = null;
      try { kept = JSON.parse(root.localStorage.getItem(STORE_KEY + game) || 'null'); } catch (err) { kept = null; }
      if (kept && kept.song && Array.isArray(kept.song.notes) && kept.song.game === game) { model.songs[game] = kept.song; model.names[game] = kept.name || 'my-song'; }
      else { model.songs[game] = Stream().emptySong(game); model.names[game] = 'my-song'; }
    }
    return model.songs[game];
  }
  function store(game) {
    try { root.localStorage.setItem(STORE_KEY + game, JSON.stringify({ song: model.songs[game], name: model.names[game] })); } catch (err) { /* not kept */ }
  }

  const gameOf = (host) => host.gameNumber;
  const maxFm = (song) => {
    const fm = song.notes.filter((n) => n.patch < 0x60).sort((a, b) => a.t - b.t);
    let worst = 0;
    fm.forEach((n) => { worst = Math.max(worst, fm.filter((m) => m.t <= n.t && m.t + m.dur > n.t).length); });
    return worst;
  };

  // --- MIDI import panel ------------------------------------------------------------------------------

  function renderImport(box, id, host) {
    const label = host.label;
    box.appendChild(make('p', 'st-kind', 'Tool'));
    box.appendChild(make('h3', null, 'MIDI import → ' + label));
    box.appendChild(make('p', 'st-note', 'Open a Standard MIDI file. It is converted to a ' + label + ' song (eight channels, FM patches and drums chosen by the GM → ' + label + ' table, ' +
      'at most five FM voices at a time, pitch bends rescaled to each patch\'s range) and opened in the sequencer, where you can edit it, play it on the retail drivers and export it.'));
    const controls = make('div', 'st-controls');
    const input = make('input');
    input.type = 'file';
    input.accept = '.mid,.midi,audio/midi,audio/x-midi';
    input.id = 'tool-import-file';
    input.setAttribute('aria-label', 'MIDI file');
    controls.appendChild(input);
    box.appendChild(controls);
    const out = make('div', 'se-out');
    box.appendChild(out);
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      out.replaceChildren(make('p', 'st-status', 'Reading ' + file.name + '…'));
      try {
        const r = await Tools().readMidiFile(file);
        const native = Stream().fromSmfNative(r.parsed);
        if (native) {
          native.song.game = gameOf(host);
          loadSong(gameOf(host), native.song, r.name, native.report);
          host.openItem('tool-editor');
          return;
        }
        if (!r.gm.notes.length) throw new Error('the file has no notes');
        const conv = Stream().fromGm(r.gm, host.map, gameOf(host), host.bank);
        loadSong(gameOf(host), conv.song, r.name, r.report.concat(conv.report));
        host.openItem('tool-editor');
      } catch (err) {
        out.replaceChildren(reportList(['Could not import that file: ' + (err && err.message ? err.message : String(err))]));
      }
    });
  }

  // --- Sequencer ---------------------------------------------------------------------------------------

  function renderEditor(box, id, host) {
    const game = gameOf(host);
    const label = host.label;
    const S = Stream();
    const map = host.map;
    box.appendChild(make('p', 'st-kind', 'Tool'));
    box.appendChild(make('h3', null, 'Sequencer · new ' + label + ' song'));
    box.appendChild(make('p', 'st-note', 'Eight channels on a grid of vblanks. Click an empty cell to add a note on the selected channel, click a note of that channel to remove it. ' +
      'Play runs the song on the retail ' + label + ' drivers; Export writes MIDI or the event stream. Pitch bends from a retail song or an imported file are kept.'));

    const row1 = make('div', 'st-controls se-bar');
    const lab = (text, el) => { const l = make('label', 'st-volume'); l.append(make('span', null, text), el); return l; };
    const nameIn = make('input');
    nameIn.type = 'text';
    nameIn.maxLength = 40;
    nameIn.id = 'se-name';
    nameIn.setAttribute('aria-label', 'Song name');
    const gridSel = make('select');
    gridSel.id = 'se-grid';
    gridSel.setAttribute('aria-label', 'Grid in vblanks');
    GRIDS.forEach((g) => gridSel.appendChild(Object.assign(make('option', null, g + ' vblanks'), { value: String(g) })));
    const gridNote = make('span', 'se-dim');
    const barsIn = make('input');
    barsIn.type = 'number';
    barsIn.min = '1';
    barsIn.max = '200';
    barsIn.id = 'se-bars';
    barsIn.setAttribute('aria-label', 'Bars');
    const copy = make('select');
    copy.id = 'se-copy';
    copy.setAttribute('aria-label', 'Start from a retail song');
    copy.appendChild(Object.assign(make('option', null, 'Start from…'), { value: '' }));
    host.data.songs.forEach((s) => copy.appendChild(Object.assign(make('option', null, '$' + s.id.toString(16).toUpperCase() + ' · ' + s.name), { value: String(s.id) })));
    copy.appendChild(Object.assign(make('option', null, 'Empty song'), { value: 'empty' }));
    const importBtn = make('input');
    importBtn.type = 'file';
    importBtn.accept = '.mid,.midi,audio/midi,audio/x-midi';
    importBtn.id = 'se-import';
    importBtn.setAttribute('aria-label', 'Import MIDI');
    row1.append(lab('Name', nameIn), lab('Grid', gridSel), gridNote, lab('Bars', barsIn), copy, lab('Import MIDI', importBtn));
    box.appendChild(row1);

    const row2 = make('div', 'st-controls se-bar');
    const chanBox = make('div', 'se-chans');
    chanBox.setAttribute('role', 'radiogroup');
    chanBox.setAttribute('aria-label', 'Channel');
    const chanBtns = [];
    for (let c = 0; c < 8; c++) {
      const b = make('button', 'ghost-btn se-chan', 'CH' + (c + 1));
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
    const patchIds = [];
    for (let p = 0; p < 32; p++) patchIds.push(p);
    [96, 97, 98, 99, 100, 101, 102, 103, 106, 107, 108, 109, 110].forEach((p) => patchIds.push(p));
    patchIds.forEach((p) => {
      const e = map && map.patches.find((x) => x.patch === p);
      patchSel.appendChild(Object.assign(make('option', null, (p >= 96 ? 'PCM $' + p.toString(16).toUpperCase() : 'FM ' + p) + (e ? ' · ≈ ' + e.target.name : '')), { value: String(p) }));
    });
    patchSel.addEventListener('change', () => {
      model.patch = Number(patchSel.value);
      if (model.sel.length) edit(() => model.sel.forEach((n) => { n.patch = model.patch; }));
    });
    const lenSel = make('select');
    lenSel.id = 'se-len';
    lenSel.setAttribute('aria-label', 'Note length in grid units');
    LENGTHS.forEach((l) => lenSel.appendChild(Object.assign(make('option', null, l + (l === 1 ? ' unit' : ' units')), { value: String(l) })));
    lenSel.addEventListener('change', () => { model.len = Number(lenSel.value); });
    const velIn = make('input');
    velIn.type = 'number';
    velIn.min = '1';
    velIn.max = '127';
    velIn.id = 'se-vel';
    velIn.setAttribute('aria-label', 'Velocity');
    velIn.addEventListener('change', () => { model.vel = Math.max(1, Math.min(127, Math.round(Number(velIn.value) || 100))); velIn.value = String(model.vel); });
    row2.append(chanBox, lab('Instrument', patchSel), lab('Length', lenSel), lab('Velocity', velIn));
    box.appendChild(row2);

    // Selection and pitch bends. A channel can use any number of instruments: every note carries its own, the encoder
    // writes a patch event wherever the channel's instrument changes. Shift-click selects notes; changing the Instrument
    // above then re-instruments the selection.
    const rowSel = make('div', 'st-controls se-bar se-fx');
    const modeSel = make('select');
    modeSel.id = 'se-mode';
    modeSel.setAttribute('aria-label', 'What a click does');
    [['notes', 'Click: notes'], ['bends', 'Click: pitch bends']].forEach(([v, t]) => modeSel.appendChild(Object.assign(make('option', null, t), { value: v })));
    modeSel.addEventListener('change', () => { model.mode = modeSel.value; refreshTools(); draw(); });
    const selChan = button('Select channel', () => { model.sel = song().notes.filter((n) => n.ch === model.channel); refreshTools(); draw(); });
    selChan.id = 'se-sel-channel';
    const selPatch = button('Select this instrument', () => { model.sel = song().notes.filter((n) => n.ch === model.channel && n.patch === model.patch); refreshTools(); draw(); });
    selPatch.id = 'se-sel-patch';
    const selNone = button('Select none', () => { model.sel = []; refreshTools(); draw(); });
    selNone.id = 'se-sel-none';
    const selDel = button('Delete selected', () => {
      const dead = new Set(model.sel);
      edit(() => { song().notes = song().notes.filter((n) => !dead.has(n)); model.sel = []; });
    });
    selDel.id = 'se-sel-delete';
    const selVel = button('Set velocity of selected', () => { if (model.sel.length) edit(() => model.sel.forEach((n) => { n.vel = model.vel; })); });
    selVel.id = 'se-sel-vel';
    rowSel.append(lab('Mode', modeSel), selChan, selPatch, selNone, selDel, selVel);
    box.appendChild(rowSel);
    const selInfo = make('p', 'st-status mono se-sel');
    selInfo.id = 'se-selinfo';
    box.appendChild(selInfo);

    const row3 = make('div', 'st-controls se-bar');
    const playBtn = button('▶ Play', () => {}, 'se-playbtn');
    playBtn.id = 'se-play';
    const gmBtn = button('▶ Play as GM', () => {});
    gmBtn.id = 'se-play-gm';
    const undoBtn = button('Undo', () => undo());
    undoBtn.id = 'se-undo';
    const clearBtn = button('Clear channel', () => edit(() => {
      const c = model.channel;
      song().notes = song().notes.filter((n) => n.ch !== c);
      song().bends = song().bends.filter((b) => b.ch !== c);
    }));
    clearBtn.id = 'se-clear';
    const clearBends = button('Clear bends', () => edit(() => { song().bends = []; }));
    clearBends.id = 'se-clear-bends';
    const loopSel = make('select');
    loopSel.id = 'se-loop';
    loopSel.setAttribute('aria-label', 'Loop');
    loopSel.addEventListener('change', () => {
      edit(() => { song().loopTick = loopSel.value === '' ? null : Number(loopSel.value); });
    });
    const exMidi = button('Export MIDI (GM)', () => exportMidi());
    exMidi.id = 'se-export-midi';
    const exNative = button('Export MIDI (native)', () => exportNative());
    exNative.id = 'se-export-native';
    const exAsm = button('Export stream (.asm)', () => exportStream('asm'));
    exAsm.id = 'se-export-asm';
    const exBin = button('Export stream (.bin)', () => exportStream('bin'));
    exBin.id = 'se-export-bin';
    row3.append(playBtn, gmBtn, undoBtn, clearBtn, clearBends, lab('Loop', loopSel), exMidi, exNative, exAsm, exBin);
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
    canvas.setAttribute('aria-label', 'Piano roll editor for the eight channels');
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
    const song = () => songFor(game);
    const unitTicks = () => song().unit;
    const barTicks = () => unitTicks() * BAR;
    const bars = () => Math.max(1, Math.ceil(Math.max(song().ticks, 1) / barTicks()));

    function edit(fn) {
      model.undo.push(clone(song()));
      if (model.undo.length > 50) model.undo.shift();
      fn();
      afterChange();
    }
    function undo() {
      if (!model.undo.length) return;
      model.sel = [];
      model.songs[game] = model.undo.pop();
      afterChange();
    }
    function fitLength() {
      const s = song();
      const last = s.notes.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
      s.ticks = Math.max(barTicks(), Math.ceil(Math.max(s.ticks, last) / barTicks()) * barTicks());
    }
    function afterChange() {
      fitLength();
      store(game);
      refreshTools();
      draw();
    }
    function refreshTools() {
      const s = song();
      nameIn.value = model.names[game];
      gridSel.value = String(s.unit);
      gridNote.textContent = '= ' + (60 * SongLib().VBLANK_HZ / (s.unit * BEAT)).toFixed(0) + ' BPM per ' + BEAT + ' units';
      barsIn.value = String(bars());
      patchSel.value = String(model.patch);
      lenSel.value = String(model.len);
      velIn.value = String(model.vel);
      loopSel.replaceChildren(Object.assign(make('option', null, 'No loop'), { value: '' }));
      for (let b = 0; b < bars(); b++) loopSel.appendChild(Object.assign(make('option', null, 'From bar ' + (b + 1)), { value: String(b * barTicks()) }));
      loopSel.value = s.loopTick == null ? '' : String(s.loopTick);
      if (loopSel.value !== (s.loopTick == null ? '' : String(s.loopTick))) loopSel.value = '';
      chanBtns.forEach((b, c) => {
        b.setAttribute('aria-checked', c === model.channel ? 'true' : 'false');
        b.classList.toggle('is-on', c === model.channel);
      });
      modeSel.value = model.mode;
      selDel.disabled = !model.sel.length;
      selVel.disabled = !model.sel.length;
      const used = {};
      s.notes.forEach((n) => { if (n.ch === model.channel) used[n.patch] = (used[n.patch] || 0) + 1; });
      selInfo.textContent = 'CH' + (model.channel + 1) + ' instruments: ' + (Object.keys(used).map((p) => p + '×' + used[p]).join(' ') || 'none') + ' · ' + s.bends.filter((b) => b.ch === model.channel).length +
        ' bends · ' + model.sel.length + ' selected' + (model.mode === 'bends' ? ' · click the roll: height sets the bend (middle = none, top/bottom = full range); click an existing bend to remove it' : ' · shift-click a note to select it');
      undoBtn.disabled = !model.undo.length;
      clearBends.disabled = !s.bends.length;
      const problems = [];
      const worst = maxFm(s);
      if (worst > S.MAX_FM_VOICES) problems.push('Up to ' + worst + ' FM notes sound at once; the driver has ' + S.MAX_FM_VOICES + ' FM voices and steals the oldest.');
      let text = s.notes.length + ' notes · ' + s.bends.length + ' bends · ' + (s.ticks / SongLib().VBLANK_HZ).toFixed(1) + ' s' + (s.loopTick == null ? '' : ' · loops from ' + (s.loopTick / SongLib().VBLANK_HZ).toFixed(1) + ' s');
      if (s.notes.length) text += ' · ' + S.encode(s, 0).bytes.length + ' bytes';
      info.textContent = text;
      messages.replaceChildren(...(problems.length ? [reportList(problems)] : []), ...(model.report.length ? [make('p', 'st-kind', 'Last import'), reportList(model.report)] : []));
      playBtn.textContent = host.editorPlaying ? '■ Stop' : '▶ Play';
      gmBtn.textContent = host.bufferId === id ? '■ Stop GM' : '▶ Play as GM';
    }

    const geometry = () => {
      const units = Math.ceil(song().ticks / unitTicks()) + BAR;
      return { units, w: GUTTER + units * model.zoom * 2, h: (NOTE_HI - NOTE_LO + 1) * ROW_H };
    };
    const px = () => model.zoom * 2; // pixels per grid unit
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
      const C = { bg: v('--bg', '#101418'), panel: v('--raise', '#1a2129'), line: v('--line', '#33414d'), muted: v('--muted', '#8ea0b0') };
      g.setTransform(dpr, 0, 0, dpr, -sx * dpr, 0);
      g.fillStyle = C.bg;
      g.fillRect(sx, 0, viewW, h);
      for (let m = NOTE_LO; m <= NOTE_HI; m++) {
        const y = (NOTE_HI - m) * ROW_H;
        if (BLACK.has(m % 12)) { g.fillStyle = C.panel; g.fillRect(GUTTER, y, w - GUTTER, ROW_H); }
        if (m % 12 === 0) {
          g.strokeStyle = C.line;
          g.beginPath();
          g.moveTo(0, y + ROW_H - 0.5);
          g.lineTo(w, y + ROW_H - 0.5);
          g.stroke();
          g.fillStyle = C.muted;
          g.font = '9px ui-monospace, monospace';
          g.fillText(noteName(m), sx + 3, y + ROW_H - 1);
        }
      }
      for (let u = Math.max(0, Math.floor((sx - GUTTER) / px()) - 1); u <= units && GUTTER + u * px() <= sx + viewW; u++) {
        const x = GUTTER + u * px() + 0.5;
        g.strokeStyle = C.line;
        g.globalAlpha = u % BAR === 0 ? 1 : u % BEAT === 0 ? 0.55 : 0.2;
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
      const endX = GUTTER + (song().ticks / unitTicks()) * px();
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(endX, 0, Math.max(0, w - endX), h);
      if (song().loopTick != null) {
        const lx = GUTTER + (song().loopTick / unitTicks()) * px();
        g.strokeStyle = '#ffd166';
        g.beginPath();
        g.moveTo(lx + 0.5, 0);
        g.lineTo(lx + 0.5, h);
        g.stroke();
      }
      for (let c = 0; c < 8; c++) {
        g.fillStyle = COLORS[c];
        g.globalAlpha = c === model.channel ? 1 : 0.3;
        song().notes.forEach((n) => {
          if (n.ch !== c || n.note < NOTE_LO || n.note > NOTE_HI) return;
          g.fillRect(GUTTER + (n.t / unitTicks()) * px() + 0.5, (NOTE_HI - n.note) * ROW_H + 0.5, Math.max(2, (n.dur / unitTicks()) * px() - 1), ROW_H - 1);
        });
        g.globalAlpha = 1;
      }
      g.fillStyle = COLORS[model.channel];
      const chBends = song().bends.filter((b) => b.ch === model.channel).sort((a, b) => a.t - b.t);
      chBends.forEach((b) => g.fillRect(GUTTER + (b.t / unitTicks()) * px() - 1, 0, 2, 5));
      if (chBends.length) {
        g.strokeStyle = COLORS[model.channel];
        g.globalAlpha = model.mode === 'bends' ? 0.9 : 0.35;
        g.beginPath();
        let py = h / 2;
        g.moveTo(GUTTER, py);
        chBends.forEach((b) => {
          const x = GUTTER + (b.t / unitTicks()) * px();
          g.lineTo(x, py);
          py = h / 2 - (b.value / 8192) * (h / 2);
          g.lineTo(x, py);
        });
        g.lineTo(endX, py);
        g.stroke();
        g.globalAlpha = 1;
      }
      g.font = '8px ui-monospace, monospace';
      g.fillStyle = '#111';
      song().notes.forEach((n) => {
        if (n.ch === model.channel && (n.dur / unitTicks()) * px() >= 14 && n.note >= NOTE_LO && n.note <= NOTE_HI) g.fillText(String(n.patch), GUTTER + (n.t / unitTicks()) * px() + 3, (NOTE_HI - n.note) * ROW_H + ROW_H - 1);
      });
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      model.sel.forEach((n) => { if (n.note >= NOTE_LO && n.note <= NOTE_HI) g.strokeRect(GUTTER + (n.t / unitTicks()) * px() + 0.5, (NOTE_HI - n.note) * ROW_H + 0.5, Math.max(2, (n.dur / unitTicks()) * px() - 1), ROW_H - 1); });
      g.lineWidth = 1;
    }

    function cellAt(ev) {
      const r = canvas.getBoundingClientRect();
      const x = ev.clientX - r.left + (parseFloat(canvas.style.left) || 0);
      const y = ev.clientY - r.top;
      return { unit: Math.floor((x - GUTTER) / px()), note: NOTE_HI - Math.floor(y / ROW_H) };
    }
    let scrollDraw = 0;
    scroller.addEventListener('scroll', () => {
      if (!scrollDraw) scrollDraw = root.requestAnimationFrame(() => { scrollDraw = 0; draw(); });
    });
    canvas.addEventListener('pointermove', (ev) => {
      const c = cellAt(ev);
      hover.textContent = c.unit >= 0 && c.note >= NOTE_LO && c.note <= NOTE_HI
        ? 'CH' + (model.channel + 1) + ' · ' + noteName(c.note) + ' (' + c.note + ') · bar ' + (Math.floor(c.unit / BAR) + 1) + ' beat ' + (Math.floor((c.unit % BAR) / BEAT) + 1) + ' · ' + (c.unit * unitTicks() / SongLib().VBLANK_HZ).toFixed(2) + ' s'
        : '';
    });
    canvas.addEventListener('click', (ev) => {
      const { unit, note } = cellAt(ev);
      if (unit < 0) return;
      if (model.mode === 'bends') { bendClick(unit * unitTicks(), ev); return; }
      if (note < NOTE_LO || note > NOTE_HI) return;
      if (ev.shiftKey) { toggleSelect(unit * unitTicks(), note); return; }
      addOrRemove(unit * unitTicks(), note);
    });
    function toggleSelect(t, note) {
      const hit = song().notes.find((n) => n.ch === model.channel && n.note === note && t >= n.t && t < n.t + n.dur);
      if (!hit) return;
      const at = model.sel.indexOf(hit);
      if (at >= 0) model.sel.splice(at, 1); else { model.sel.push(hit); model.patch = hit.patch; model.vel = hit.vel; }
      refreshTools();
      draw();
    }
    /** Pitch-bend mode: a click near a bend of this channel removes it; otherwise one is added at the click's height. */
    function bendClick(t, ev) {
      const near = unitTicks() / 2;
      const hit = song().bends.findIndex((b) => b.ch === model.channel && Math.abs(b.t - t) <= near);
      if (hit >= 0) { edit(() => song().bends.splice(hit, 1)); return; }
      if (t >= barTicks() * 200) return;
      const r = canvas.getBoundingClientRect();
      const frac = (ev.clientY - r.top) / r.height;
      let value = Math.round((0.5 - frac) * 2 * 8192);
      if (Math.abs(value) < 200) value = 0;
      value = Math.max(-8192, Math.min(8191, value));
      edit(() => { song().bends.push({ t: t, ch: model.channel, value: value }); song().bends.sort((a, b) => a.t - b.t); });
    }
    function addOrRemove(t, note) {
      const hit = song().notes.findIndex((n) => n.ch === model.channel && n.note === note && t >= n.t && t < n.t + n.dur);
      if (hit >= 0) { edit(() => song().notes.splice(hit, 1)); return; }
      if (t >= barTicks() * 200) return;
      edit(() => {
        const s = song();
        // An earlier note of the same key that runs into the new one is cut (the driver's key is channel + note).
        s.notes.forEach((n) => { if (n.ch === model.channel && n.note === note && n.t < t && n.t + n.dur > t) n.dur = t - n.t; });
        s.notes.push({ t: t, dur: model.len * unitTicks(), ch: model.channel, note: note, vel: model.vel, patch: model.patch });
        s.notes.sort((a, b) => a.t - b.t || a.ch - b.ch || a.note - b.note);
      });
    }

    nameIn.addEventListener('input', () => { model.names[game] = safeName(nameIn.value) || 'song'; store(game); });
    gridSel.addEventListener('change', () => {
      // Notes stay where they are in time; only the grid the editor snaps to changes.
      edit(() => { song().unit = Number(gridSel.value); });
    });
    barsIn.addEventListener('change', () => {
      const n = Math.max(1, Math.min(200, Math.round(Number(barsIn.value) || 4)));
      edit(() => {
        const s = song();
        s.ticks = n * barTicks();
        s.notes = s.notes.filter((x) => x.t < s.ticks).map((x) => (x.t + x.dur > s.ticks ? Object.assign({}, x, { dur: s.ticks - x.t }) : x));
        s.bends = s.bends.filter((b) => b.t < s.ticks);
        if (s.loopTick != null && s.loopTick >= s.ticks) s.loopTick = null;
      });
    });
    copy.addEventListener('change', () => {
      const v = copy.value;
      copy.value = '';
      if (!v) return;
      edit(() => {
        if (v === 'empty') { model.songs[game] = Stream().emptySong(game); model.names[game] = 'my-song'; } else {
          const id2 = Number(v);
          model.songs[game] = Stream().fromStream(game, host.slice, id2, map);
          model.names[game] = safeName(host.data.songs.find((s) => s.id === id2).name);
        }
        model.report = [];
        model.sel = [];
      });
    });
    importBtn.addEventListener('change', async () => {
      const file = importBtn.files && importBtn.files[0];
      importBtn.value = '';
      if (!file) return;
      try {
        const r = await Tools().readMidiFile(file);
        const native = Stream().fromSmfNative(r.parsed);
        if (native) { native.song.game = game; edit(() => { model.songs[game] = native.song; model.names[game] = r.name; model.sel = []; model.report = native.report; }); return; }
        if (!r.gm.notes.length) throw new Error('the file has no notes');
        const conv = Stream().fromGm(r.gm, map, game, host.bank);
        edit(() => { model.songs[game] = conv.song; model.names[game] = r.name; model.sel = []; model.report = r.report.concat(conv.report); });
      } catch (err) {
        model.report = ['Could not import that file: ' + (err && err.message ? err.message : String(err))];
        refreshTools();
      }
    });

    const needNotes = () => { if (!song().notes.length) throw new Error('Add some notes first'); };
    async function toggleNhl() {
      if (host.editorPlaying) { host.stopLive(); refreshTools(); return; }
      needNotes();
      await host.playEditor(Stream().romWithSong(game, host.rom, song()).rom);
      refreshTools();
    }
    async function toggleGm() {
      if (host.bufferId === id) { host.stopBuffer(); refreshTools(); return; }
      needNotes();
      info.textContent = 'Rendering with the General MIDI reference sounds…';
      await nextFrame();
      const gm = Stream().toGm(song(), map, host.bank).song;
      const buf = Ref().renderEvents(SongGm().gmEvents(gm));
      const viz = host.songViz(Stream().romWithSong(game, host.rom, song()).rom);
      await host.playBuffer(id, buf, Ref().SAMPLE_RATE, viz);
      refreshTools();
    }
    const guard = (fn) => () => fn().catch((err) => { info.textContent = String(err && err.message ? err.message : err); });
    playBtn.onclick = guard(toggleNhl);
    gmBtn.onclick = guard(toggleGm);
    host.toggles[id] = guard(toggleNhl);

    function exportMidi() {
      try {
        needNotes();
        const smf = SongGm().toSmfSong(Stream().toGm(song(), map, host.bank).song);
        smf.name = model.names[game];
        Tools().download(model.names[game] + '-gm.mid', Smf().write(smf), 'audio/midi');
      } catch (err) { info.textContent = String(err.message || err); }
    }
    function exportNative() {
      try {
        needNotes();
        const smf = Stream().toSmfNative(song());
        smf.name = model.names[game];
        Tools().download(model.names[game] + '-nhl' + game + '.mid', Smf().write(smf), 'audio/midi');
      } catch (err) { info.textContent = String(err.message || err); }
    }
    function exportStream(kind) {
      try {
        needNotes();
        exportSongStream(song(), model.names[game], kind);
      } catch (err) { info.textContent = String(err.message || err); }
    }

    afterChange();
    {
      const all = song().notes;
      if (all.length) {
        const first = Math.min(...all.map((n) => n.t));
        const near = all.filter((n) => n.t < first + barTicks() * 4).map((n) => n.note);
        const mid = (Math.min(...near) + Math.max(...near)) / 2;
        scroller.scrollLeft = Math.max(0, (first / unitTicks()) * px() - 20);
        scroller.scrollTop = Math.max(0, (NOTE_HI - mid) * ROW_H - (scroller.clientHeight || 380) / 2);
      } else scroller.scrollTop = Math.max(0, (NOTE_HI - 76) * ROW_H);
    }
    draw();
    const timer = setInterval(() => {
      if (!box.isConnected) { clearInterval(timer); return; }
      const l1 = host.editorPlaying ? '■ Stop' : '▶ Play';
      if (playBtn.textContent !== l1) playBtn.textContent = l1;
      const l2 = host.bufferId === id ? '■ Stop GM' : '▶ Play as GM';
      if (gmBtn.textContent !== l2) gmBtn.textContent = l2;
    }, 300);
  }

  function render(box, id, host) {
    if (id === 'tool-import') renderImport(box, id, host);
    else renderEditor(box, id, host);
  }

  /** Put a song into the sequencer as the one being edited (undo returns to the previous one). */
  function loadSong(game, song, name, report) {
    const prev = songFor(game);
    model.undo.push(clone(prev));
    if (model.undo.length > 50) model.undo.shift();
    model.songs[game] = clone(song);
    model.names[game] = safeName(name);
    model.report = report || [];
    model.sel = [];
    store(game);
  }

  /** A song model as a downloaded event stream: 'asm' (source with a comment per event) or 'bin'. */
  function exportSongStream(song, name, kind) {
    const base = safeName(name);
    if (kind === 'asm') Tools().download(base + '.asm', Stream().toAsm(song, base), 'text/plain');
    else Tools().download(base + '.nhl' + song.game + 'song.bin', Stream().encode(song, 0).bytes, 'application/octet-stream');
  }

  root.NhlSoundToolsNx = { render, model, loadSong, exportSongStream };
})(typeof self !== 'undefined' ? self : this);
