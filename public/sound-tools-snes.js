/**
 * Sequencer for the two SNES games (NHLPA 93 and NHL 94): a piano roll over eight tracks (voices) that plays on the
 * game's own SPC700 sound program. The song is kept as plain notes; Play writes it as a Standard MIDI file and runs the
 * same GM import the "MIDI import" tool uses (data/audio/nhl93s-gm-map.json / nhl94s-gm-map.json pick the game sound for
 * each GM program), then plays the result as the game would. Opening a retail song starts from its GM export, so
 * volume / pan / vibrato commands become plain notes (use "Export MIDI (native)" on the song to keep every command).
 *
 * Modes: draw notes, select / move (box select, drag, arrows, Delete), and pitch bends (NHL 94 only: its sound program has
 * a pitch-wheel event; NHLPA 93's has none that the importer maps). Hovering a note shows its details.
 */
(function (root) {
  'use strict';

  const TRACKS = 8;
  const PPQ = 48;
  const UNIT = 12; // ticks per grid unit (a sixteenth)
  const BEAT = 4; // units per beat
  const BAR = 16;
  const MAX_BARS = 128;
  const NOTE_LO = 24;
  const NOTE_HI = 96;
  const ROW_H = 8;
  const GUTTER = 38;
  const BEND_RANGE = 2; // semitones at the top / bottom of the roll in bend mode
  const COLORS = ['#f0b429', '#4cc9f0', '#8fd0a8', '#ff7a90', '#b69cff', '#ff9f5a', '#c9b8ff', '#7ee0d8'];
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = (n) => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);
  const STORE_KEY = 'nhl9x.snes-sequencer.';
  const clone = (s) => JSON.parse(JSON.stringify(s));

  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (text, onClick, cls) => {
    const b = make('button', 'ghost-btn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  const lab = (text, el) => {
    const l = make('label', null, text + ' ');
    l.appendChild(el);
    return l;
  };

  function emptySong(game) {
    return {
      game, name: 'my-song', bpm: 120, tempos: [{ tick: 0, bpm: 120 }], ticks: BAR * 8 * UNIT, loop: false,
      set: game === 'nhlpa93snes' ? 'game' : 'game', notes: [], bends: [], programs: [0, 33, 48, 56, 73, 25, 11, 0], drumTrack: -1
    };
  }

  const model = { songs: {}, undo: [], track: 0, program: 0, len: 4, vel: 100, zoom: 4, sel: [], mode: 'notes', report: [] };

  function songFor(game) {
    if (!model.songs[game]) {
      let kept = null;
      try { kept = JSON.parse(root.localStorage.getItem(STORE_KEY + game) || 'null'); } catch (err) { /* nothing kept */ }
      model.songs[game] = kept && Array.isArray(kept.notes) ? kept : emptySong(game);
    }
    return model.songs[game];
  }
  function store(game) {
    try { root.localStorage.setItem(STORE_KEY + game, JSON.stringify(model.songs[game])); } catch (err) { /* not kept */ }
  }

  /** A retail song (or any GM Standard MIDI file) as an editable song. */
  function fromSmf(game, bytes, name) {
    const p = root.Nhl92Smf.parse(bytes);
    const k = PPQ / p.ppq;
    const s = emptySong(game);
    s.name = name || 'my-song';
    const slot = new Map();
    let drumCh = -1;
    const order = [];
    p.notes.forEach((n) => { if (!slot.has(n.ch)) { slot.set(n.ch, null); order.push(n.ch); } });
    let next = 0;
    order.forEach((ch) => {
      if (ch === 9) { drumCh = 9; return; }
      if (next < TRACKS) slot.set(ch, next++);
    });
    if (drumCh === 9 && next < TRACKS) { slot.set(9, next); s.drumTrack = next; next++; }
    s.programs = new Array(TRACKS).fill(0);
    const seen = new Set();
    // The game's own instruments chosen in this editor come back from their "n93i:<channel>:<hex>" markers (as 128 + id).
    p.markers.forEach((m) => { const x = /^n93i:(\d+):([0-9a-f]+)$/i.exec(m.text); const t = x ? slot.get(Number(x[1])) : null; if (t != null) { seen.add(t); s.programs[t] = GAME_INST + parseInt(x[2], 16); if (root.NhlSoundTestSnes93) s.set = root.NhlSoundTestSnes93.setOfInstrument(parseInt(x[2], 16)); } });
    p.programs.slice().sort((a, b) => a.tick - b.tick).forEach((pr) => { const t = slot.get(pr.ch); if (t != null && !seen.has(t)) { seen.add(t); s.programs[t] = pr.program; } });
    let dropped = 0;
    p.notes.forEach((n) => {
      const t = slot.get(n.ch);
      if (t == null) { dropped++; return; }
      s.notes.push({ t: Math.round(n.tick * k), dur: Math.max(1, Math.round(n.dur * k)), ch: t, pitch: n.pitch, vel: n.vel });
    });
    p.bends.forEach((b) => { const t = slot.get(b.ch); if (t != null && t !== s.drumTrack) s.bends.push({ t: Math.round(b.tick * k), ch: t, semis: b.semis }); });
    s.tempos = p.tempos.length ? p.tempos.map((x) => ({ tick: Math.round(x.tick * k), bpm: x.bpm })) : [{ tick: 0, bpm: 120 }];
    s.bpm = Math.round(s.tempos[0].bpm * 10) / 10;
    s.notes.sort((a, b) => a.t - b.t || a.ch - b.ch || a.pitch - b.pitch);
    s.ticks = Math.max(BAR * 4 * UNIT, Math.ceil(Math.max.apply(null, s.notes.map((n) => n.t + n.dur).concat([0])) / (BAR * UNIT)) * BAR * UNIT);
    s.report = dropped ? [dropped + ' notes on more than eight channels were dropped'] : [];
    return s;
  }

  /** NHLPA 93: a track program of GAME_INST + id plays the game's instrument id directly (no GM mapping). */
  const GAME_INST = 128;
  const hex2 = (v) => '$' + v.toString(16).toUpperCase().padStart(2, '0');
  function toSmfBytes(song, gmMap) {
    const tracks = [];
    const markers = [];
    for (let t = 0; t < TRACKS; t++) {
      const drum = t === song.drumTrack;
      let program = song.programs[t];
      if (!drum && program >= GAME_INST) {
        const id = program - GAME_INST;
        const e = gmMap && gmMap.sets && gmMap.sets[song.set] && gmMap.sets[song.set][String(id)];
        markers.push({ tick: 0, text: 'n93i:' + t + ':' + id.toString(16) });
        program = e && e.program != null ? e.program : 0; // the GM file still names a close General MIDI program
      }
      const notes = song.notes.filter((n) => n.ch === t).map((n) => ({ tick: n.t, dur: n.dur, pitch: n.pitch, vel: n.vel, program }));
      if (!notes.length) continue;
      const bends = drum ? [] : song.bends.filter((b) => b.ch === t).map((b) => ({ tick: b.t, semis: b.semis }));
      tracks.push({ name: drum ? 'drums' : 'track ' + (t + 1), ch: drum ? 9 : t, notes, bends, bendRange: BEND_RANGE });
    }
    if (!tracks.length) throw new Error('Add some notes first');
    const tempos = song.tempos.slice();
    tempos[0] = { tick: 0, bpm: song.bpm };
    return root.Nhl92Smf.write({ ppq: PPQ, tempos, name: song.name, tracks, markers });
  }

  /** Called from a retail song panel: copy the song into the editor. */
  function loadSong(game, bytes, name) {
    const s = fromSmf(game, bytes, name);
    model.songs[game] = s;
    model.undo = [];
    model.sel = [];
    model.report = s.report || [];
    store(game);
  }

  function render(box, id, host) {
    const game = host.game;
    const is94 = game === 'nhl94snes';
    const Tools = () => root.NhlSoundTools;
    const M = () => (is94 ? root.NhlNhl94sMidi : root.NhlNhl93sMidi);
    const programNames = (root.Nhl92GmMap && root.Nhl92GmMap.PROGRAM_NAMES) || [];
    const song = () => songFor(game);
    const secPerTick = () => 60 / (song().bpm * PPQ);
    const secs = (ticks) => (ticks * secPerTick()).toFixed(2) + ' s';

    box.replaceChildren();
    box.dataset.item = id;
    box.appendChild(make('p', 'st-kind', (is94 ? 'NHL 94' : 'NHLPA 93') + ' (SNES) sequencer'));
    box.appendChild(make('h3', null, 'Sequencer · ' + (is94 ? 'NHL 94' : 'NHLPA 93') + ' (SNES)'));
    box.appendChild(make('p', 'st-note', 'Eight tracks (the SPC700 has eight voices). Each track takes one General MIDI instrument, which the game\'s GM table maps to one of its own sounds; track 10 style drums map to the game\'s drum sounds. Play runs the song on the game\'s own sound program. ' + (is94 ? 'Pitch bends are supported (the sound program has a pitch-wheel event).' : 'This game\'s sound program has no pitch-wheel event the importer maps, so there is no bend mode.')));

    // --- controls ---------------------------------------------------------------------------------------------
    const row1 = make('div', 'st-controls se-bar');
    const nameIn = make('input');
    nameIn.type = 'text';
    nameIn.id = 'sn-name';
    const bpmIn = make('input');
    bpmIn.type = 'number';
    bpmIn.min = '30';
    bpmIn.max = '300';
    bpmIn.id = 'sn-bpm';
    const barsIn = make('input');
    barsIn.type = 'number';
    barsIn.min = '1';
    barsIn.max = String(MAX_BARS);
    barsIn.id = 'sn-bars';
    const setSel = make('select');
    setSel.id = 'sn-set';
    (is94 ? [['menu', 'Menu / band sounds'], ['game', 'Game sounds']] : [['boot', 'Boot samples (organ, drums, strings)'], ['game', 'Game samples (fanfare, whistle, crowd)']])
      .forEach(([v, t]) => setSel.appendChild(Object.assign(make('option', null, t), { value: v })));
    const loopBox = make('input');
    loopBox.type = 'checkbox';
    const loopLabel = make('label', null, ' loop');
    loopLabel.prepend(loopBox);
    const fresh = button('New empty song', () => { edit(() => { model.songs[game] = emptySong(game); model.sel = []; }); });
    fresh.id = 'sn-new';
    const importBtn = make('input');
    importBtn.type = 'file';
    importBtn.accept = '.mid,.midi,audio/midi';
    importBtn.setAttribute('aria-label', 'Open a MIDI file');
    row1.append(lab('Name', nameIn), lab('Tempo (BPM)', bpmIn), lab('Bars', barsIn), lab('Sound set', setSel), loopLabel, fresh, lab('Open MIDI', importBtn));
    box.appendChild(row1);

    const row2 = make('div', 'st-controls se-bar');
    const trackBox = make('div', 'se-chans');
    const trackBtns = [];
    for (let t = 0; t < TRACKS; t++) {
      const b = button('T' + (t + 1), () => { model.track = t; refreshTools(); draw(); }, 'se-chan');
      b.style.setProperty('--ch', COLORS[t]);
      b.setAttribute('role', 'radio');
      trackBtns.push(b);
      trackBox.appendChild(b);
    }
    const progSel = make('select');
    progSel.id = 'sn-program';
    progSel.setAttribute('aria-label', 'Instrument of this track');
    for (let p = 0; p < 128; p++) progSel.appendChild(Object.assign(make('option', null, p + ' · ' + (programNames[p] || 'program ' + p)), { value: String(p) }));
    // NHLPA 93: the game's own instruments of the song's sound set, written as the $E0 INSTRUMENT command directly.
    const gameGroup = make('optgroup');
    gameGroup.label = 'Game instruments (this sound set)';
    if (!is94) progSel.appendChild(gameGroup);
    function fillGameInstruments(set) {
      if (is94 || gameGroup.dataset.set === set) return;
      gameGroup.dataset.set = set;
      gameGroup.textContent = '';
      const snes = root.NhlSoundTestSnes93;
      for (const i of host.snesData.instruments || []) {
        if (snes && (snes.setOfInstrument(i.index) !== set || snes.isInvalidInstrument(i.index))) continue;
        gameGroup.appendChild(Object.assign(make('option', null, hex2(i.index) + ' · game instrument (' + set + ' set)'), { value: String(GAME_INST + i.index) }));
      }
    }
    progSel.addEventListener('change', () => edit(() => { song().programs[model.track] = Number(progSel.value); }));
    const drumBox = make('input');
    drumBox.type = 'checkbox';
    drumBox.id = 'sn-drums';
    drumBox.addEventListener('change', () => edit(() => {
      if (drumBox.checked) { song().drumTrack = model.track; } else if (song().drumTrack === model.track) song().drumTrack = -1;
      song().bends = song().bends.filter((b) => b.ch !== song().drumTrack);
    }));
    const drumLabel = make('label', null, ' drums');
    drumLabel.prepend(drumBox);
    drumLabel.title = 'This track plays the game\'s drum sounds (its notes are GM drum keys)';
    const lenSel = make('select');
    lenSel.id = 'sn-len';
    [[1, '1/16'], [2, '1/8'], [4, '1/4'], [8, '1/2'], [16, 'bar']].forEach(([v, t]) => lenSel.appendChild(Object.assign(make('option', null, t), { value: String(v) })));
    lenSel.value = String(model.len);
    lenSel.addEventListener('change', () => { model.len = Number(lenSel.value); });
    const velIn = make('input');
    velIn.type = 'number';
    velIn.min = '1';
    velIn.max = '127';
    velIn.id = 'sn-vel';
    velIn.addEventListener('change', () => { model.vel = Math.max(1, Math.min(127, Math.round(Number(velIn.value) || 100))); velIn.value = String(model.vel); });
    row2.append(trackBox, lab('Instrument', progSel), drumLabel, lab('Length', lenSel), lab('Velocity', velIn));
    box.appendChild(row2);

    const row3 = make('div', 'st-controls se-bar se-fx');
    const modeSel = make('select');
    modeSel.id = 'sn-mode';
    modeSel.setAttribute('aria-label', 'What a click does');
    [['notes', 'Click: draw notes'], ['select', 'Click: select / move']].concat(is94 ? [['bends', 'Click: pitch bends']] : [])
      .forEach(([v, t]) => modeSel.appendChild(Object.assign(make('option', null, t), { value: v })));
    modeSel.addEventListener('change', () => { model.mode = modeSel.value; refreshTools(); draw(); });
    const selTrack = button('Select track', () => { model.sel = song().notes.filter((n) => n.ch === model.track); refreshTools(); draw(); });
    const selNone = button('Select none', () => { model.sel = []; refreshTools(); draw(); });
    const selDel = button('Delete selected', () => { const dead = new Set(model.sel); edit(() => { song().notes = song().notes.filter((n) => !dead.has(n)); model.sel = []; }); });
    selDel.id = 'sn-del';
    const selVel = button('Set velocity of selected', () => { if (model.sel.length) edit(() => model.sel.forEach((n) => { n.vel = model.vel; })); });
    row3.append(lab('Mode', modeSel), selTrack, selNone, selDel, selVel);
    box.appendChild(row3);
    const selInfo = make('p', 'st-status mono se-sel');
    selInfo.id = 'sn-selinfo';
    box.appendChild(selInfo);

    const row4 = make('div', 'st-controls se-bar');
    const playBtn = button('▶ Play', () => {}, 'se-playbtn');
    playBtn.id = 'sn-play';
    const pauseBtn = button('⏸ Pause', () => { host.togglePause(); }, 'se-pausebtn');
    pauseBtn.id = 'sn-pause';
    pauseBtn.disabled = true;
    const undoBtn = button('Undo', () => undo());
    const clearBtn = button('Clear track', () => edit(() => { song().notes = song().notes.filter((n) => n.ch !== model.track); song().bends = song().bends.filter((b) => b.ch !== model.track); model.sel = []; }));
    const clearBends = button('Clear bends', () => edit(() => { song().bends = []; }));
    const exMidi = button('Export MIDI (GM)', () => { try { Tools().download(safe(song().name) + '-gm.mid', toSmfBytes(song(), host.snesData.gmMap), 'audio/midi'); } catch (err) { info.textContent = err.message; } });
    const exBin = button('Export song (.bin)', () => {
      try { const r = convert(); Tools().download((is94 ? 'nhl94s-' : 'nhl93s-') + safe(song().name) + '.bin', is94 ? r.bytes : r.block, 'application/octet-stream'); } catch (err) { info.textContent = err.message; }
    });
    row4.append(playBtn, pauseBtn, undoBtn, clearBtn);
    if (is94) row4.appendChild(clearBends);
    row4.append(exMidi, exBin);
    box.appendChild(row4);

    if (is94 && root.NhlSoundSnesInstEditor) {
      const instBox = make('div', 'st-seq');
      if (!model.soundEdits) model.soundEdits = {};
      root.NhlSoundSnesInstEditor.mount(instBox, {
        is94: true,
        data: host.snesData,
        set: () => song().set,
        edits: model.soundEdits,
        audioContext: () => host.getAudioContext && host.getAudioContext(),
        onChange: () => store(game)
      });
      box.appendChild(instBox);
    }

    const info = make('p', 'st-status mono se-info');
    info.id = 'sn-info';
    const hover = make('p', 'st-status mono se-hover');
    hover.id = 'sn-hover';
    box.append(info, hover);

    const scroller = make('div', 'se-scroll');
    scroller.tabIndex = 0;
    const canvas = make('canvas', 'se-canvas');
    canvas.id = 'sn-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Piano roll editor for the eight tracks');
    const inner = make('div', 'se-inner');
    inner.appendChild(canvas);
    scroller.appendChild(inner);
    box.appendChild(scroller);
    const tip = make('div', 'se-tip');
    tip.hidden = true;
    box.appendChild(tip);
    const messages = make('div', 'se-out');
    box.appendChild(messages);
    const seq = make('div', 'st-seq');
    box.appendChild(seq);
    host.mountRoll(seq);

    let extras = null;
    if (root.NhlEditorExtras) {
      extras = root.NhlEditorExtras.attach({
        scroller, inner, gutter: GUTTER,
        pxPerSec: () => px() / (UNIT * secPerTick()),
        totalSec: () => song().ticks * secPerTick(),
        loopSec: () => (song().loop ? 0 : null),
        hostSec: () => host.editorSeconds(),
        paused: () => host.paused,
        seek: (sec) => host.seekEditor(sec),
        seeking: () => host.editorSeekProgress()
      });
    }

    // --- behaviour --------------------------------------------------------------------------------------------
    const safe = (s) => (String(s || 'song').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'song');
    const px = () => model.zoom * 2;
    const bars = () => Math.max(1, Math.ceil(song().ticks / (BAR * UNIT)));
    let drag = null;

    function edit(fn) {
      model.undo.push(clone(song()));
      if (model.undo.length > 50) model.undo.shift();
      fn();
      store(game);
      refreshTools();
      draw();
    }
    function undo() {
      if (!model.undo.length) return;
      model.sel = [];
      model.songs[game] = model.undo.pop();
      store(game);
      refreshTools();
      draw();
    }

    /** The song as the game's own format: the same conversion the MIDI import tool runs. */
    function convert() {
      const r = M().fromSmf(toSmfBytes(song(), host.snesData.gmMap), host.snesData, host.snesData.gmMap, { set: song().set, loop: song().loop });
      if (!is94 && r.report.tooBig) throw new Error(r.report.warnings[r.report.warnings.length - 1]);
      return r;
    }
    async function play() {
      if (host.editorPlaying) { host.stopLive(); refreshTools(); return; }
      const r = convert();
      model.report = r.report.warnings || [];
      await host.playSnesEditor({
        name: song().name, bytes: r.bytes, base: r.base, block: r.block, set: r.report.set || song().set, report: r.report,
        soundEdits: is94 && model.soundEdits ? model.soundEdits : null
      }, extras ? extras.cue() : 0);
      refreshTools();
    }
    playBtn.onclick = () => play().catch((err) => { info.textContent = String(err && err.message ? err.message : err); });

    function refreshTools() {
      const s = song();
      nameIn.value = s.name;
      bpmIn.value = String(s.bpm);
      barsIn.value = String(bars());
      setSel.value = s.set;
      loopBox.checked = !!s.loop;
      lenSel.value = String(model.len);
      velIn.value = String(model.vel);
      modeSel.value = model.mode;
      fillGameInstruments(s.set);
      progSel.value = String(s.programs[model.track]);
      drumBox.checked = s.drumTrack === model.track;
      progSel.disabled = s.drumTrack === model.track;
      trackBtns.forEach((b, t) => { b.classList.toggle('is-on', t === model.track); b.setAttribute('aria-checked', t === model.track ? 'true' : 'false'); });
      selDel.disabled = !model.sel.length;
      selVel.disabled = !model.sel.length;
      undoBtn.disabled = !model.undo.length;
      clearBends.disabled = !s.bends.length;
      playBtn.textContent = host.editorPlaying ? '■ Stop' : '▶ Play';
      pauseBtn.disabled = !host.editorPlaying;
      pauseBtn.textContent = host.editorPlaying && host.paused ? '▶ Resume' : '⏸ Pause';
      const mine = s.notes.filter((n) => n.ch === model.track).length;
      selInfo.textContent = 'T' + (model.track + 1) + ': ' + mine + ' notes · ' + model.sel.length + ' selected' + (model.mode === 'select'
        ? ' · click or drag a box to select, drag a selected note to move it, arrows nudge, Delete removes, Esc clears'
        : model.mode === 'bends' ? ' · click the roll: height sets the bend (middle = none, top / bottom = ±' + BEND_RANGE + ' semitones); click an existing bend to remove it'
          : ' · shift-click a note to select it (or use Click: select / move)');
      info.textContent = s.notes.length + ' notes · ' + (is94 ? s.bends.length + ' bends · ' : '') + secs(s.ticks) + ' · ' + s.bpm + ' BPM' + (model.report.length ? ' · ' + model.report.join(' · ') : '');
    }

    // --- drawing ----------------------------------------------------------------------------------------------
    function geometry() {
      const units = bars() * BAR;
      return { units, w: GUTTER + units * px() + 16, h: (NOTE_HI - NOTE_LO + 1) * ROW_H };
    }
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
      const C = { bg: v('--bg', '#101418'), line: v('--line', '#33414d'), raise: v('--raise', '#1a2129'), muted: v('--muted', '#8ea0b0') };
      g.setTransform(dpr, 0, 0, dpr, -sx * dpr, 0);
      g.clearRect(sx, 0, viewW, h);
      g.fillStyle = C.bg;
      g.fillRect(sx, 0, viewW, h);
      const gridEnd = GUTTER + units * px();
      for (let n = NOTE_LO; n <= NOTE_HI; n++) {
        const y = (NOTE_HI - n) * ROW_H;
        const black = [1, 3, 6, 8, 10].indexOf(n % 12) >= 0;
        g.fillStyle = black ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.05)';
        g.fillRect(GUTTER, y, gridEnd - GUTTER, ROW_H);
        if (n % 12 === 0) {
          g.fillStyle = C.line;
          g.fillRect(GUTTER, y + ROW_H - 1, gridEnd - GUTTER, 1);
          g.fillStyle = C.muted;
          g.font = '9px ui-monospace, monospace';
          g.fillText(noteName(n), sx + 4, y + ROW_H - 1);
        }
      }
      for (let u = 0; u <= units; u++) {
        const x = GUTTER + u * px() + 0.5;
        if (u % BEAT) { if (px() < 8) continue; g.fillStyle = 'rgba(255,255,255,0.05)'; } else g.fillStyle = u % BAR ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.28)';
        g.fillRect(x, 0, 1, h);
      }
      const s = song();
      const drumT = s.drumTrack;
      const drawNote = (n, alpha) => {
        if (n.pitch < NOTE_LO || n.pitch > NOTE_HI) return;
        g.globalAlpha = alpha;
        g.fillStyle = COLORS[n.ch % COLORS.length];
        g.fillRect(GUTTER + (n.t / UNIT) * px(), (NOTE_HI - n.pitch) * ROW_H + 1, Math.max(2, (n.dur / UNIT) * px() - 1), ROW_H - 2);
      };
      s.notes.forEach((n) => { if (n.ch !== model.track) drawNote(n, 0.22); });
      s.notes.forEach((n) => { if (n.ch === model.track) drawNote(n, 0.95); });
      g.globalAlpha = 1;
      // Bends of this track: a stepped line around the middle of the roll.
      const bends = s.bends.filter((b) => b.ch === model.track).sort((a, b) => a.t - b.t);
      if (bends.length) {
        g.strokeStyle = COLORS[model.track % COLORS.length];
        g.globalAlpha = model.mode === 'bends' ? 0.9 : 0.35;
        g.lineWidth = 1.5;
        g.beginPath();
        let py = h / 2;
        g.moveTo(GUTTER, py);
        bends.forEach((b) => {
          const x = GUTTER + (b.t / UNIT) * px();
          g.lineTo(x, py);
          py = h / 2 - (b.semis / BEND_RANGE) * (h / 2);
          g.lineTo(x, py);
        });
        g.lineTo(gridEnd, py);
        g.stroke();
        g.lineWidth = 1;
        g.globalAlpha = 1;
      }
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      model.sel.forEach((n) => g.strokeRect(GUTTER + (n.t / UNIT) * px() + 0.5, (NOTE_HI - n.pitch) * ROW_H + 0.5, Math.max(2, (n.dur / UNIT) * px() - 1), ROW_H - 1));
      g.lineWidth = 1;
      if (drag && drag.kind === 'move' && (drag.dt || drag.dn)) {
        g.setLineDash([3, 2]);
        model.sel.forEach((n) => g.strokeRect(GUTTER + (n.t / UNIT + drag.dt) * px() + 0.5, (NOTE_HI - n.pitch - drag.dn) * ROW_H + 0.5, Math.max(2, (n.dur / UNIT) * px() - 1), ROW_H - 1));
        g.setLineDash([]);
      }
      if (drag && drag.kind === 'band') {
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
        g.strokeRect(Math.min(drag.x0, drag.x1) + 0.5, Math.min(drag.y0, drag.y1) + 0.5, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
      }
      void drumT;
    }
    let scrollDraw = 0;
    scroller.addEventListener('scroll', () => { if (!scrollDraw) scrollDraw = root.requestAnimationFrame(() => { scrollDraw = 0; draw(); }); });

    // --- pointer ----------------------------------------------------------------------------------------------
    const pos = (ev) => {
      const r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left + (parseFloat(canvas.style.left) || 0), y: ev.clientY - r.top };
    };
    const cellAt = (p) => ({ unit: Math.floor((p.x - GUTTER) / px()), pitch: NOTE_HI - Math.floor(p.y / ROW_H) });
    const noteAt = (p) => {
      const c = cellAt(p);
      const t = ((p.x - GUTTER) / px()) * UNIT; // the exact tick under the pointer: retail notes need not start on the grid
      return song().notes.find((n) => n.ch === model.track && n.pitch === c.pitch && t >= n.t && t < n.t + n.dur) || null;
    };
    function showTip(n, ev) {
      if (!n) { tip.hidden = true; return; }
      const s = song();
      const unit = n.t / UNIT;
      const drum = n.ch === s.drumTrack;
      const bends = s.bends.filter((b) => b.ch === n.ch && b.t >= n.t && b.t < n.t + n.dur);
      const lines = [
        (drum ? 'Drum key ' : '') + noteName(n.pitch) + ' (MIDI ' + n.pitch + ') · track ' + (n.ch + 1),
        drum ? 'Instrument: the game\'s drum for this key' : s.programs[n.ch] >= GAME_INST ? 'Game instrument ' + hex2(s.programs[n.ch] - GAME_INST) : 'Instrument ' + s.programs[n.ch] + ' · ' + (programNames[s.programs[n.ch]] || ''),
        'Starts bar ' + (Math.floor(unit / BAR) + 1) + ' beat ' + (Math.floor((unit % BAR) / BEAT) + 1) + ' (' + secs(n.t) + ')',
        'Length ' + (n.dur / UNIT) + ' units (' + secs(n.dur) + ')',
        'Velocity ' + n.vel
      ];
      if (is94 && !drum) lines.push('Pitch bends during the note: ' + (bends.length ? bends.length + ' (' + Math.min.apply(null, bends.map((b) => b.semis)).toFixed(1) + ' to ' + Math.max.apply(null, bends.map((b) => b.semis)).toFixed(1) + ' semitones)' : 'none'));
      tip.textContent = lines.join('\n');
      tip.hidden = false;
      tip.style.left = Math.max(4, Math.min(ev.clientX + 14, root.innerWidth - 270)) + 'px';
      tip.style.top = Math.max(4, Math.min(ev.clientY + 18, root.innerHeight - 140)) + 'px';
    }
    const clampMove = (dt, dn) => {
      const minUnit = Math.min.apply(null, model.sel.map((n) => n.t / UNIT));
      dt = Math.max(dt, -Math.round(minUnit));
      dn = Math.max(NOTE_LO - Math.min.apply(null, model.sel.map((n) => n.pitch)), Math.min(NOTE_HI - Math.max.apply(null, model.sel.map((n) => n.pitch)), dn));
      return [dt, dn];
    };
    function nudge(dt, dn) {
      if (!model.sel.length) return;
      const m = clampMove(dt, dn);
      if (!m[0] && !m[1]) return;
      edit(() => {
        model.sel.forEach((n) => { n.t += m[0] * UNIT; n.pitch += m[1]; });
        const s = song();
        s.notes.sort((a, b) => a.t - b.t || a.ch - b.ch || a.pitch - b.pitch);
        const end = Math.max.apply(null, s.notes.map((n) => n.t + n.dur));
        s.ticks = Math.max(s.ticks, Math.ceil(end / (BAR * UNIT)) * BAR * UNIT);
      });
    }
    canvas.addEventListener('pointerleave', () => { tip.hidden = true; });
    canvas.addEventListener('pointerdown', (ev) => {
      if (model.mode !== 'select' || ev.button !== 0) return;
      const p = pos(ev);
      const hit = noteAt(p);
      scroller.focus({ preventScroll: true });
      canvas.setPointerCapture(ev.pointerId);
      tip.hidden = true;
      if (hit) {
        if (ev.shiftKey) {
          const at = model.sel.indexOf(hit);
          if (at >= 0) model.sel.splice(at, 1); else model.sel.push(hit);
          drag = null;
        } else {
          if (model.sel.indexOf(hit) < 0) model.sel = [hit];
          model.vel = hit.vel;
          drag = { kind: 'move', x0: p.x, y0: p.y, dt: 0, dn: 0 };
        }
      } else {
        drag = { kind: 'band', x0: p.x, y0: p.y, x1: p.x, y1: p.y, base: ev.shiftKey ? model.sel.slice() : [] };
        if (!ev.shiftKey) model.sel = [];
      }
      refreshTools();
      draw();
    });
    function dragMove(ev) {
      const p = pos(ev);
      if (drag.kind === 'move') {
        const m = clampMove(Math.round((p.x - drag.x0) / px()), Math.round(-(p.y - drag.y0) / ROW_H));
        drag.dt = m[0];
        drag.dn = m[1];
      } else {
        drag.x1 = p.x;
        drag.y1 = p.y;
        const x0 = Math.min(drag.x0, drag.x1);
        const x1 = Math.max(drag.x0, drag.x1);
        const y0 = Math.min(drag.y0, drag.y1);
        const y1 = Math.max(drag.y0, drag.y1);
        const inside = song().notes.filter((n) => {
          if (n.ch !== model.track) return false;
          const nx = GUTTER + (n.t / UNIT) * px();
          const ny = (NOTE_HI - n.pitch) * ROW_H;
          return nx < x1 && nx + (n.dur / UNIT) * px() > x0 && ny < y1 && ny + ROW_H > y0;
        });
        model.sel = drag.base.concat(inside.filter((n) => drag.base.indexOf(n) < 0));
      }
      draw();
    }
    const endDrag = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.kind === 'move' && (d.dt || d.dn)) nudge(d.dt, d.dn);
      else { refreshTools(); draw(); }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', () => { drag = null; draw(); });
    canvas.addEventListener('pointermove', (ev) => {
      if (drag) { dragMove(ev); return; }
      const p = pos(ev);
      const n = noteAt(p);
      showTip(n, ev);
      canvas.style.cursor = model.mode === 'select' ? (n ? (model.sel.indexOf(n) >= 0 ? 'move' : 'pointer') : 'default') : n && model.mode === 'notes' ? 'pointer' : 'crosshair';
      const c = cellAt(p);
      hover.textContent = c.unit >= 0 && c.pitch >= NOTE_LO && c.pitch <= NOTE_HI
        ? 'T' + (model.track + 1) + ' · ' + noteName(c.pitch) + ' (' + c.pitch + ') · bar ' + (Math.floor(c.unit / BAR) + 1) + ' beat ' + (Math.floor((c.unit % BAR) / BEAT) + 1) + ' · ' + secs(c.unit * UNIT)
        : '';
    });
    scroller.addEventListener('keydown', (ev) => {
      if (model.mode !== 'select') return;
      const k = ev.key;
      if ((k === 'Delete' || k === 'Backspace') && model.sel.length) { ev.preventDefault(); selDel.click(); }
      else if (k === 'Escape') { model.sel = []; refreshTools(); draw(); }
      else if ((k === 'a' || k === 'A') && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); selTrack.click(); }
      else if (model.sel.length && /^Arrow/.test(k)) {
        ev.preventDefault();
        nudge(k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, k === 'ArrowUp' ? (ev.shiftKey ? 12 : 1) : k === 'ArrowDown' ? (ev.shiftKey ? -12 : -1) : 0);
      }
    });
    canvas.addEventListener('click', (ev) => {
      if (model.mode === 'select') return;
      const p = pos(ev);
      const c = cellAt(p);
      if (c.unit < 0) return;
      const t = c.unit * UNIT;
      if (model.mode === 'bends') {
        const near = UNIT / 2;
        const hit = song().bends.findIndex((b) => b.ch === model.track && Math.abs(b.t - t) <= near);
        if (hit >= 0) { edit(() => song().bends.splice(hit, 1)); return; }
        if (song().drumTrack === model.track) return;
        const frac = p.y / geometry().h;
        let semis = (0.5 - frac) * 2 * BEND_RANGE;
        if (Math.abs(semis) < 0.1) semis = 0;
        edit(() => { song().bends.push({ t, ch: model.track, semis: Math.round(Math.max(-BEND_RANGE, Math.min(BEND_RANGE, semis)) * 100) / 100 }); song().bends.sort((a, b) => a.t - b.t); });
        return;
      }
      if (c.pitch < NOTE_LO || c.pitch > NOTE_HI) return;
      if (ev.shiftKey) {
        const hit = noteAt(p);
        if (hit) { const at = model.sel.indexOf(hit); if (at >= 0) model.sel.splice(at, 1); else model.sel.push(hit); refreshTools(); draw(); }
        return;
      }
      const hit = song().notes.findIndex((n) => n.ch === model.track && n.pitch === c.pitch && t + 1 >= n.t && t + 1 < n.t + n.dur);
      if (hit >= 0) { edit(() => song().notes.splice(hit, 1)); return; }
      if (t >= BAR * UNIT * MAX_BARS) return;
      edit(() => {
        const s = song();
        s.notes.forEach((n) => { if (n.ch === model.track && n.pitch === c.pitch && n.t < t && n.t + n.dur > t) n.dur = t - n.t; });
        s.notes.push({ t, dur: model.len * UNIT, ch: model.track, pitch: c.pitch, vel: model.vel });
        s.notes.sort((a, b) => a.t - b.t || a.ch - b.ch || a.pitch - b.pitch);
        s.ticks = Math.max(s.ticks, Math.ceil((t + model.len * UNIT) / (BAR * UNIT)) * BAR * UNIT);
      });
    });

    // --- header inputs ----------------------------------------------------------------------------------------
    nameIn.addEventListener('input', () => { song().name = safe(nameIn.value); store(game); });
    bpmIn.addEventListener('change', () => edit(() => { song().bpm = Math.max(30, Math.min(300, Number(bpmIn.value) || 120)); }));
    barsIn.addEventListener('change', () => edit(() => {
      const nb = Math.max(1, Math.min(MAX_BARS, Math.round(Number(barsIn.value) || 8)));
      const s = song();
      s.ticks = nb * BAR * UNIT;
      s.notes = s.notes.filter((n) => n.t < s.ticks).map((n) => (n.t + n.dur > s.ticks ? Object.assign({}, n, { dur: s.ticks - n.t }) : n));
      s.bends = s.bends.filter((b) => b.t < s.ticks);
      model.sel = [];
    }));
    setSel.addEventListener('change', () => edit(() => { song().set = setSel.value; }));
    loopBox.addEventListener('change', () => edit(() => { song().loop = loopBox.checked; }));
    importBtn.addEventListener('change', async () => {
      const f = importBtn.files && importBtn.files[0];
      importBtn.value = '';
      if (!f) return;
      try {
        const s = fromSmf(game, new Uint8Array(await f.arrayBuffer()), f.name.replace(/\.[^.]+$/, ''));
        if (!s.notes.length) throw new Error('the file has no notes');
        edit(() => { model.songs[game] = s; model.sel = []; model.report = s.report || []; });
      } catch (err) {
        model.report = ['Could not open that file: ' + (err && err.message ? err.message : String(err))];
        refreshTools();
      }
    });

    // Keep the play / pause buttons honest while the song runs.
    const timer = setInterval(() => {
      if (!box.isConnected) { clearInterval(timer); return; }
      const l = host.editorPlaying ? '■ Stop' : '▶ Play';
      if (playBtn.textContent !== l) playBtn.textContent = l;
      const pl = host.editorPlaying && host.paused ? '▶ Resume' : '⏸ Pause';
      if (pauseBtn.textContent !== pl) pauseBtn.textContent = pl;
      pauseBtn.disabled = !host.editorPlaying;
    }, 300);

    refreshTools();
    draw();
    // Start the roll on the notes (or around middle C when empty).
    const first = song().notes.length ? Math.max.apply(null, song().notes.map((n) => n.pitch)) : 72;
    scroller.scrollTop = Math.max(0, (NOTE_HI - first - 6) * ROW_H);
  }

  root.NhlSoundToolsSnes = { render, loadSong, fromSmf, toSmfBytes, emptySong };
})(typeof self !== 'undefined' ? self : this);
