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

    function size() {
      const w = Math.max(240, Math.floor(wrap.clientWidth || container.clientWidth || 320));
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

      const keyOns = st.commands.filter((c) => c.name === 'keyOn');
      for (const c of keyOns) {
        const t = c.frame / frameRate;
        if (t > timeSec || t < leftT) continue;
        const voice = c.args && c.args.voice != null ? c.args.voice : 0;
        const top = G.laneTop(voice);
        const x = Math.round(xOf(t)) + 0.5;
        if (x < G.x0) continue;
        g.fillStyle = COLORS[voice % COLORS.length];
        g.globalAlpha = 0.85;
        g.fillRect(x - 2, top + 4, 4, L.laneH - 8);
        g.globalAlpha = 1;
        if (opts.voiceLabel) {
          const lab = opts.voiceLabel(c);
          if (lab) {
            g.font = '9px ' + mono;
            g.fillStyle = C.text;
            g.fillText(lab, Math.max(G.x0 + 2, x - 20), top + L.laneH - 4);
          }
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
      container.replaceChildren();
    }

    raf = root.requestAnimationFrame(loop);
    return { destroy, draw };
  }

  root.NhlSoundRollSnes = { mount };
})(typeof self !== 'undefined' ? self : this);
