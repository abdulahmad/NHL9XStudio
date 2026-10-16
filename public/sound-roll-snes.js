/**
 * SNES sound test sequencer view: eight DSP voice lanes from the player's command log
 * (key-ons and gains), plus an event list. Same chrome as public/sound-roll.js.
 */
(function (root) {
  'use strict';

  const WINDOW_S = 6;
  const NAMES = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8'];
  const COLORS = ['#f0b429', '#4cc9f0', '#8fd0a8', '#ff7a90', '#b69cff', '#ff9f5a', '#c9b8ff', '#7ee0d8'];
  const EVENT_LINES = 18;

  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const clock = (secs) => {
    const m = Math.floor(secs / 60);
    const r = secs - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(2);
  };

  /**
   * @param {HTMLElement} container
   * @param {{ frameRate: number, state: function, voiceLabel?: function }} opts
   *   state() -> null or { frame, commands, timeSec }
   */
  function mount(container, opts) {
    const frameRate = opts.frameRate;
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
    const C = { bg: v('--bg', '#101418'), panel: v('--raise', '#1a2129'), line: v('--line', '#33414d'), text: v('--text', '#e8eef3'), muted: v('--muted', '#8ea0b0') };
    const mono = v('--mono', 'ui-monospace, monospace');

    container.replaceChildren();
    const head = make('div', 'st-seq-head');
    head.appendChild(make('span', 'st-seq-title', 'Voices'));
    const tabs = make('div', 'st-seq-tabs');
    const tabRoll = make('button', 'ghost-btn st-seq-tab', 'Roll');
    const tabEvents = make('button', 'ghost-btn st-seq-tab', 'Events');
    for (const b of [tabRoll, tabEvents]) b.type = 'button';
    tabs.append(tabRoll, tabEvents);
    head.appendChild(tabs);
    const wrap = make('div', 'st-roll');
    const canvas = make('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Eight SNES DSP voices, drawn from sequencer commands');
    wrap.appendChild(canvas);
    const events = make('pre', 'st-events');
    events.hidden = true;
    const note = make('p', 'st-seq-note', 'From the main CPU sequencer commands the ported player sends to the SPC700 program (right edge = now). SFX and ducking are not ported.');
    container.append(head, wrap, events, note);

    const pitchRange = { lo: -6, hi: 6, init: false };
    let mode = 'roll';
    let raf = 0;
    let cssW = 0;
    let cssH = 0;
    let dpr = 1;
    const g = canvas.getContext('2d');

    function setMode(m) {
      mode = m;
      wrap.hidden = m !== 'roll';
      events.hidden = m !== 'events';
      tabRoll.setAttribute('aria-pressed', String(m === 'roll'));
      tabEvents.setAttribute('aria-pressed', String(m === 'events'));
    }
    tabRoll.addEventListener('click', () => setMode('roll'));
    tabEvents.addEventListener('click', () => setMode('events'));
    setMode('roll');

    // Reading clientWidth every frame forces a layout of the whole page; a ResizeObserver tells us when it changes.
    let measured = wrap.clientWidth || container.clientWidth || 0;
    let ro = null;
    if (root.ResizeObserver) {
      ro = new root.ResizeObserver(() => { measured = wrap.clientWidth || container.clientWidth || measured; });
      ro.observe(wrap);
    }
    else root.addEventListener('resize', () => { measured = wrap.clientWidth || container.clientWidth || measured; });

    function size() {
      const w = Math.max(240, Math.floor(measured || 320));
      const ratio = Math.min(2, root.devicePixelRatio || 1);
      const laneH = w < 460 ? 26 : 30;
      const h = 16 + NAMES.length * (laneH + 2) + 2;
      if (w !== cssW || h !== cssH || ratio !== dpr) {
        cssW = w;
        cssH = h;
        dpr = ratio;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.height = h + 'px';
      }
      return { w, h, laneH, small: w < 460 };
    }

    function geometry(L) {
      const gutter = L.small ? 44 : 52;
      return { gutter, x0: gutter, x1: L.w - 4, laneTop: (i) => 16 + i * (L.laneH + 2) };
    }

    function draw() {
      const st = opts.state();
      if (mode === 'events') {
        if (!st || !st.commands) {
          events.textContent = 'Press Play to see sequencer commands.';
          return;
        }
        const lines = st.commands.slice(-EVENT_LINES).map((c) => {
          const t = clock(c.frame / frameRate);
          const args = c.args ? JSON.stringify(c.args) : '';
          return t + '  ' + c.name + (args ? ' ' + args : '');
        });
        events.textContent = lines.join('\n') || '(no commands yet)';
        return;
      }

      const L = size();
      const G = geometry(L);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, L.w, L.h);
      g.fillStyle = C.bg;
      g.fillRect(0, 0, L.w, L.h);

      for (let i = 0; i < NAMES.length; i++) {
        const top = G.laneTop(i);
        g.fillStyle = C.panel;
        g.fillRect(G.x0, top, G.x1 - G.x0, L.laneH);
        g.strokeStyle = C.line;
        g.strokeRect(G.x0 + 0.5, top + 0.5, G.x1 - G.x0 - 1, L.laneH - 1);
        g.font = '600 ' + (L.small ? 10 : 11) + 'px ' + mono;
        g.fillStyle = COLORS[i];
        g.fillText(NAMES[i], 6, top + 13);
      }

      if (!st || !st.commands) {
        g.fillStyle = C.muted;
        g.font = '12px ' + mono;
        g.textAlign = 'center';
        g.fillText('Press Play to see voice activity', (G.x0 + G.x1) / 2, G.laneTop(3) + L.laneH / 2 + 4);
        g.textAlign = 'left';
        return;
      }

      const timeSec = st.timeSec || 0;
      const leftT = Math.max(0, timeSec - WINDOW_S);
      const pps = (G.x1 - G.x0 - 2) / WINDOW_S;
      const xOf = (t) => G.x1 - 1 - (timeSec - t) * pps;

      // Pitch of a key-on in semitones: MIDI key when the song gives one ('93), else the S-DSP pitch register
      // relative to the sample's native rate ($1000 = 1.0x), which is how effects and '94 notes are known.
      const semis = (a) => (a && a.midi != null ? a.midi : a && a.pitch > 0 ? 12 * Math.log2(a.pitch / 4096) : null);
      const NN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      const noteName = (a) => (a.midi != null ? NN[a.midi % 12] + (Math.floor(a.midi / 12) - 1) : (semis(a) >= 0 ? '+' : '') + semis(a).toFixed(1) + 'st');
      // Commands are logged in time order: binary-search the window instead of scanning the whole song every frame.
      const cmds = st.commands;
      let lo0 = 0;
      let hi0 = cmds.length;
      const fromFrame = leftT * frameRate;
      while (lo0 < hi0) { const mid = (lo0 + hi0) >> 1; if (cmds[mid].frame < fromFrame) lo0 = mid + 1; else hi0 = mid; }
      const keyOns = [];
      for (let i = lo0; i < cmds.length && cmds[i].frame / frameRate <= timeSec; i++) if (cmds[i].name === 'keyOn') keyOns.push(cmds[i]);
      // One shared pitch range for all voices, eased so the view does not jump (at least an octave tall).
      let lo = Infinity;
      let hi = -Infinity;
      for (const c of keyOns) {
        const s = semis(c.args);
        if (s == null) continue;
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
      }
      if (lo <= hi) {
        if (hi - lo < 12) { const mid = (lo + hi) / 2; lo = mid - 6; hi = mid + 6; }
        const k = pitchRange.init ? 0.12 : 1;
        pitchRange.lo += (lo - pitchRange.lo) * k;
        pitchRange.hi += (hi - pitchRange.hi) * k;
        pitchRange.init = true;
      }
      const barH = 5;
      g.font = '9px ' + mono;
      // Key-ons without a known length ('94 notes, effects) run until the voice's next key-on, at most one second.
      const nextOn = new Map();
      for (let i = keyOns.length - 1; i >= 0; i--) {
        const vi = keyOns[i].args && keyOns[i].args.voice;
        if (nextOn.has(vi)) keyOns[i].gapFrames = nextOn.get(vi) - keyOns[i].frame;
        nextOn.set(vi, keyOns[i].frame);
      }
      for (const c of keyOns) {
        const t = c.frame / frameRate;
        const voice = c.args && c.args.voice != null ? c.args.voice : 0;
        const top = G.laneTop(voice);
        const x = Math.round(xOf(t)) + 0.5;
        if (x < G.x0) continue;
        const s = semis(c.args);
        const f = s == null ? 0.5 : Math.min(1, Math.max(0, (s - pitchRange.lo) / (pitchRange.hi - pitchRange.lo)));
        const y = top + 3 + (1 - f) * (L.laneH - 6 - barH);
        const lenF = c.args && c.args.frames ? c.args.frames : c.gapFrames ? Math.min(c.gapFrames, frameRate) : 0;
        const w = lenF ? Math.max(4, Math.min(G.x1 - x, (lenF / frameRate) * pps)) : 4;
        g.fillStyle = COLORS[voice % COLORS.length];
        g.globalAlpha = 0.85;
        g.fillRect(x, y, w, barH);
        g.globalAlpha = 1;
        const lab = w < 22 ? '' : s != null ? noteName(c.args) : (opts.voiceLabel && opts.voiceLabel(c)) || '';
        if (lab) {
          g.fillStyle = C.text;
          g.fillText(lab, Math.max(G.x0 + 2, x), y < top + L.laneH / 2 ? y + barH + 9 : y - 2);
        }
      }

      g.strokeStyle = C.text;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(G.x1 - 1, 12);
      g.lineTo(G.x1 - 1, L.h - 4);
      g.stroke();
    }

    function loop() {
      draw();
      raf = root.requestAnimationFrame(loop);
    }

    function destroy() {
      if (raf) root.cancelAnimationFrame(raf);
      raf = 0;
      if (ro) ro.disconnect();
      container.replaceChildren();
    }

    raf = root.requestAnimationFrame(loop);
    return { destroy, draw };
  }

  root.NhlSoundRollSnes = { mount };
})(typeof self !== 'undefined' ? self : this);
