/**
 * Sound test sequencer view: what each YM2612 channel is doing, drawn from the
 * register writes the Z80 driver actually makes (lib/audio/ym-note-tracker.js), never
 * from song data. Seven lanes (FM1-FM6 and PSG) of a scrolling piano roll, newest on the
 * right at the playhead, plus a text event list as a second view.
 *
 * Everything is placed at the *audible* position the caller gives (source samples at
 * 53,267 Hz, already corrected for the resampler queue and the output latency), so a note
 * appears when you hear it. The roll draws on requestAnimationFrame only while mounted.
 */
(function (root) {
  const WINDOW_S = 6;
  const COLORS = ['#f0b429', '#4cc9f0', '#8fd0a8', '#ff7a90', '#b69cff', '#ff9f5a'];
  const DAC_COLOR = '#ff9f5a';
  const HIT_TAIL = 400; // samples (about 8 ms) a hit stays "sounding" after its last non-centre write
  const NAMES = ['FM1', 'FM2', 'FM3', 'FM4', 'FM5', 'FM6', 'PSG'];
  const EVENT_LINES = 16;

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
   * @param {HTMLElement} container empty element to fill
   * @param {{ chain: {SAMPLE_RATE:number, sampleAt:function}, state: function, patchLabel?: function }} opts
   *   state() -> null (nothing playing) or { tracker, src } with src the audible source sample
   *   patchLabel(burst) -> text or null: names the patch a lane loaded last (tagged in the lane's corner)
   *   dacLabel(hit) -> text or null: names the PCM sample a DAC hit ({sig, writes, peak}) plays (shown on the hit and in the gutter)
   *   isMuted(i) / onToggle(i): optional; a click on an FM lane (0-5) calls onToggle, and muted lanes are drawn dimmed
   */
  function mount(container, opts) {
    const rate = opts.chain.SAMPLE_RATE;
    const sampleAt = opts.chain.sampleAt;
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
    const C = { bg: v('--bg', '#101418'), panel: v('--raise', '#1a2129'), line: v('--line', '#33414d'), text: v('--text', '#e8eef3'), muted: v('--muted', '#8ea0b0'), amber: v('--amber', '#f0b429') };
    const mono = v('--mono', 'ui-monospace, monospace');

    container.replaceChildren();
    const head = make('div', 'st-seq-head');
    head.appendChild(make('span', 'st-seq-title', 'Channels'));
    const tabs = make('div', 'st-seq-tabs');
    const tabRoll = make('button', 'ghost-btn st-seq-tab', 'Roll');
    const tabEvents = make('button', 'ghost-btn st-seq-tab', 'Events');
    for (const b of [tabRoll, tabEvents]) b.type = 'button';
    tabs.append(tabRoll, tabEvents);
    head.appendChild(tabs);
    const wrap = make('div', 'st-roll');
    const canvas = make('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Piano roll of the six FM channels and the PSG, drawn from the YM2612 writes');
    wrap.appendChild(canvas);
    const events = make('pre', 'st-events');
    events.hidden = true;
    events.setAttribute('aria-live', 'off');
    const note = make('p', 'st-seq-note', 'From the YM2612 writes the Z80 driver makes, at the position you hear (right edge). ' +
      'FM6 shows DAC while $2B bit 7 is set. The PSG lane stays empty: this driver never writes it.');
    container.append(head, wrap, events, note);
    const mutable = !!(opts.onToggle && opts.isMuted);
    if (mutable) {
      note.textContent += ' Click a lane to mute or unmute that channel.';
      canvas.style.cursor = 'pointer';
    }

    let mode = 'roll';
    let raf = 0;
    let cssW = 0;
    let cssH = 0;
    let dpr = 1;
    let idleDrawn = false;
    let lastEvents = 0;
    let lastText = '';
    let last = null; // readout of the last live frame, for debugging and tests
    const range = NAMES.map(() => ({ lo: 48, hi: 72 }));
    const dacRange = { lo: -6, hi: 6 }; // PCM playback rate in semitones around 8 kHz
    const g = canvas.getContext('2d');

    function setMode(m) {
      mode = m;
      wrap.hidden = m !== 'roll';
      events.hidden = m !== 'events';
      tabRoll.setAttribute('aria-pressed', String(m === 'roll'));
      tabEvents.setAttribute('aria-pressed', String(m === 'events'));
      idleDrawn = false;
      lastEvents = 0;
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
      const laneH = w < 460 ? 30 : 34;
      const h = 16 + NAMES.length * (laneH + 2) + 2;
      if (w !== cssW || h !== cssH || ratio !== dpr) {
        cssW = w;
        cssH = h;
        dpr = ratio;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.height = h + 'px';
        idleDrawn = false;
      }
      return { w, h, laneH, small: w < 460 };
    }

    function geometry(L) {
      const gutter = L.small ? 54 : 70;
      return { gutter, x0: gutter, x1: L.w - 4, axis: 16, laneTop: (i) => 16 + i * (L.laneH + 2) };
    }

    function frameBase(L, G) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, L.w, L.h);
      g.fillStyle = C.bg;
      g.fillRect(0, 0, L.w, L.h);
      for (let i = 0; i < NAMES.length; i++) {
        const top = G.laneTop(i);
        g.fillStyle = C.panel;
        g.fillRect(G.x0, top, G.x1 - G.x0, L.laneH);
        g.strokeStyle = C.line;
        g.lineWidth = 1;
        g.strokeRect(G.x0 + 0.5, top + 0.5, G.x1 - G.x0 - 1, L.laneH - 1);
      }
    }

    const hitName = (h) => (opts.dacLabel && opts.dacLabel(h)) || 'PCM';

    function gutterText(L, G, i, readout, keyed, dac) {
      const top = G.laneTop(i);
      if (mutable && i < 6 && opts.isMuted(i)) { keyed = false; dac = false; readout = 'muted'; }
      g.textBaseline = 'alphabetic';
      g.font = '600 ' + (L.small ? 10 : 11) + 'px ' + mono;
      g.fillStyle = i < 6 ? COLORS[i] : C.muted;
      g.fillText(NAMES[i], 6, top + 13);
      g.font = (L.small ? 10 : 11) + 'px ' + mono;
      g.fillStyle = dac ? DAC_COLOR : keyed ? C.text : C.muted;
      g.fillText(readout, 6, top + L.laneH - 5);
      if (i < 6) {
        g.beginPath();
        g.arc(G.gutter - 9, top + 9, 3, 0, Math.PI * 2);
        if (keyed || dac) { g.fillStyle = dac ? DAC_COLOR : COLORS[i]; g.fill(); }
        else { g.strokeStyle = C.line; g.lineWidth = 1; g.stroke(); }
      }
    }

    const held = new Array(6).fill(null);
    let heldSrc = 0;

    /** Muted FM lanes are covered so they read as off (their notes are still tracked). */
    function dimMuted(L, G) {
      if (!mutable) return;
      for (let i = 0; i < 6; i++) {
        if (!opts.isMuted(i)) continue;
        g.fillStyle = 'rgba(16,20,24,0.72)';
        g.fillRect(G.x0, G.laneTop(i), G.x1 - G.x0, L.laneH);
        g.strokeStyle = C.muted;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(G.x0 + 6, G.laneTop(i) + L.laneH / 2 + 0.5);
        g.lineTo(G.x1 - 6, G.laneTop(i) + L.laneH / 2 + 0.5);
        g.stroke();
      }
    }

    function drawIdle() {
      const L = size();
      const G = geometry(L);
      frameBase(L, G);
      for (let i = 0; i < NAMES.length; i++) gutterText(L, G, i, i === 6 ? 'unused' : '—', false, false);
      g.fillStyle = C.muted;
      g.font = '12px ' + mono;
      g.textAlign = 'center';
      g.fillText('Press Play to see what each channel does', (G.x0 + G.x1) / 2, G.laneTop(2) + L.laneH / 2 + 4);
      g.textAlign = 'left';
      dimMuted(L, G);
    }

    function drawLive(st) {
      const L = size();
      const G = geometry(L);
      const tr = st.tracker;
      const src = st.src;
      const pps = (G.x1 - G.x0 - 2) / WINDOW_S;
      const left = src - WINDOW_S * rate;
      const xOf = (s) => G.x1 - 1 - ((src - s) / rate) * pps;
      frameBase(L, G);

      // Pass 1: what is visible and what is sounding now.
      const lanes = NAMES.map(() => ({ keyed: false, seg: null, lo: Infinity, hi: -Infinity }));
      const bars = [];
      for (const n of tr.notes) {
        if (sampleAt(n.t0) > src) continue;
        const ne = n.t1 == null ? Infinity : sampleAt(n.t1);
        if (ne < left) continue;
        for (const seg of n.segs) {
          const s0 = sampleAt(seg.t0);
          if (s0 > src) break;
          const s1 = seg.t1 == null ? Infinity : sampleAt(seg.t1);
          if (s1 < left) continue;
          const ln = lanes[n.ch];
          if (seg.midi != null) {
            if (seg.midi < ln.lo) ln.lo = seg.midi;
            if (seg.midi > ln.hi) ln.hi = seg.midi;
            bars.push({ ch: n.ch, s0, s1, seg, live: s1 > src && ne > src });
          }
          if (s1 > src && ne > src) { ln.keyed = true; ln.seg = seg; }
        }
      }
      let dacNow = false;
      for (const d of tr.dacSpans) {
        if (sampleAt(d.t0) <= src && (d.t1 == null || sampleAt(d.t1) > src)) dacNow = true;
      }
      // A PCM hit is a run of non-centre $2A writes; it is sounding until its last write plus a short tail.
      let hitNow = null;
      for (const h of tr.dacHits) {
        if (sampleAt(h.t0) <= src && sampleAt(h.t1) + HIT_TAIL > src) hitNow = h;
      }

      // Each lane scales to its own visible pitches (at least an octave), eased so it doesn't jump.
      for (let i = 0; i < 6; i++) {
        const ln = lanes[i];
        if (ln.lo === Infinity) continue;
        let lo = ln.lo - 1;
        let hi = ln.hi + 1;
        if (hi - lo < 12) { const mid = (hi + lo) / 2; lo = mid - 6; hi = mid + 6; }
        const r = range[i];
        r.lo += (lo - r.lo) * 0.15;
        r.hi += (hi - r.hi) * 0.15;
      }

      // Patch loads and parameter writes.
      for (const p of tr.patches) {
        const s = sampleAt(p.t0);
        if (s > src || sampleAt(p.t1) < left) continue;
        const top = G.laneTop(p.ch);
        const x = Math.round(xOf(s)) + 0.5;
        if (x < G.x0) continue;
        g.fillStyle = COLORS[p.ch];
        if (p.kind === 'patch') {
          g.globalAlpha = 0.4;
          g.fillRect(x, top + 1, 1, L.laneH - 2);
          g.globalAlpha = 1;
          g.beginPath();
          g.moveTo(x - 3, top + 1);
          g.lineTo(x + 4, top + 1);
          g.lineTo(x + 0.5, top + 6);
          g.closePath();
          g.fill();
        } else {
          g.globalAlpha = 0.5;
          g.fillRect(x - 1, top + L.laneH - 4, 3, 2);
          g.globalAlpha = 1;
        }
      }

      // The instrument in each lane: the latest patch load before the playhead, named by the caller
      // (retail patch number and the GM sound the mapping gives it). Drawn after the notes, below.
      // Held per lane: the tracker only keeps a few seconds of history, so a patch loaded long ago
      // is remembered here until a newer load replaces it (or playback restarts / seeks back).
      if (src < heldSrc - 1) held.fill(null);
      heldSrc = src;
      if (opts.patchLabel) {
        for (const p of tr.patches) {
          if (p.kind !== 'patch' || sampleAt(p.t0) > src) continue;
          if (!held[p.ch] || p.t0 >= held[p.ch].t0) held[p.ch] = p;
        }
      }
      const instrument = st.held || held; // the caller may keep them itself (it can seek, and the tracker forgets)

      // Notes.
      const barH = L.small ? 5 : 6;
      const pad = 8;
      const yOf = (ch, midi) => {
        const r = range[ch];
        const f = Math.max(0, Math.min(1, (midi - r.lo) / (r.hi - r.lo)));
        return G.laneTop(ch) + pad + (1 - f) * (L.laneH - 2 * pad - barH);
      };
      g.font = (L.small ? 9 : 10) + 'px ' + mono;
      g.textBaseline = 'alphabetic';
      const labelRight = new Array(6).fill(-1e9);
      for (const b of bars) {
        const x0 = Math.max(G.x0 + 1, xOf(b.s0));
        const x1 = Math.min(G.x1 - 1, b.s1 === Infinity ? G.x1 - 1 : xOf(Math.min(b.s1, src)));
        if (x1 <= x0 - 0.01) continue;
        const y = yOf(b.ch, b.seg.midi);
        g.fillStyle = COLORS[b.ch];
        g.globalAlpha = b.live ? 1 : 0.8;
        g.fillRect(x0, y, Math.max(1, x1 - x0), barH);
        g.globalAlpha = 1;
        if (x1 - x0 >= 24 && x0 + 2 > labelRight[b.ch]) {
          const top = G.laneTop(b.ch);
          const ty = y - 2 >= top + 9 ? y - 2 : y + barH + 9;
          g.fillStyle = C.text;
          g.fillText(b.seg.name, x0 + 2, ty);
          labelRight[b.ch] = x0 + 2 + g.measureText(b.seg.name).width + 2;
        }
      }

      // Instrument labels: a small tag at the lane's left edge, over the notes.
      g.font = '600 ' + (L.small ? 9 : 10) + 'px ' + mono;
      g.textBaseline = 'alphabetic';
      for (let i = 0; i < 6; i++) {
        if (!instrument[i]) continue;
        let lab = opts.patchLabel(instrument[i]);
        if (!lab) continue;
        const room = Math.max(40, Math.min(G.x1 - G.x0 - 10, (G.x1 - G.x0) * 0.45));
        while (lab.length > 4 && g.measureText(lab).width > room) lab = lab.slice(0, -2) + '…';
        const w = g.measureText(lab).width + 8;
        const top = G.laneTop(i);
        g.globalAlpha = 0.82;
        g.fillStyle = C.bg;
        g.fillRect(G.x0 + 2, top + 2, w, 13);
        g.globalAlpha = 1;
        g.fillStyle = COLORS[i];
        g.fillText(lab, G.x0 + 6, top + 12);
      }

      // DAC: while $2B bit 7 is set FM6 isn't what you hear, so the band hides FM6's notes.
      const dacTop = G.laneTop(5);
      for (const d of tr.dacSpans) {
        const s0 = sampleAt(d.t0);
        if (s0 > src) continue;
        const s1 = d.t1 == null ? src : Math.min(sampleAt(d.t1), src);
        if (s1 < left) continue;
        const x0 = Math.max(G.x0 + 1, xOf(s0));
        const x1 = Math.min(G.x1 - 1, xOf(s1));
        if (x1 - x0 < 1) continue;
        g.fillStyle = C.panel;
        g.fillRect(x0, dacTop + 1, x1 - x0, L.laneH - 2);
        g.save();
        g.beginPath();
        g.rect(x0, dacTop + 1, x1 - x0, L.laneH - 2);
        g.clip();
        g.strokeStyle = DAC_COLOR;
        g.globalAlpha = tr.dacHits.length ? 0.2 : 0.55; // with real hits drawn on top, the hatch only says the DAC is switched on
        g.lineWidth = 1;
        g.beginPath();
        for (let x = x0 - L.laneH; x < x1; x += 5) { g.moveTo(x, dacTop + L.laneH); g.lineTo(x + L.laneH, dacTop); }
        g.stroke();
        g.restore();
        if (x1 - x0 >= 22 && !tr.dacHits.length) {
          g.fillStyle = DAC_COLOR;
          g.font = '600 10px ' + mono;
          g.fillText('DAC', x0 + 4, dacTop + 14);
        }
      }
      // Each PCM sample that actually plays: a bar from its first to its last non-centre write. Its height is the pitch:
      // the playback rate (writes per second) in semitones, so a sample driven faster than the last one sounds higher.
      // The lane scales to the visible hits like the FM lanes (at least an octave), eased.
      const hitSemis = (h) => {
        const dur = (sampleAt(h.t1) - sampleAt(h.t0)) / rate;
        return h.writes >= 4 && dur > 0 ? 12 * Math.log2(h.writes / dur / 8000) : null;
      };
      {
        let lo = Infinity;
        let hi = -Infinity;
        for (const h of tr.dacHits) {
          if (sampleAt(h.t0) > src || sampleAt(h.t1) < left) continue;
          const m = hitSemis(h);
          if (m == null) continue;
          lo = Math.min(lo, m);
          hi = Math.max(hi, m);
        }
        if (lo !== Infinity) {
          lo -= 1;
          hi += 1;
          if (hi - lo < 12) { const mid = (hi + lo) / 2; lo = mid - 6; hi = mid + 6; }
          dacRange.lo += (lo - dacRange.lo) * 0.15;
          dacRange.hi += (hi - dacRange.hi) * 0.15;
        }
      }
      for (const h of tr.dacHits) {
        const s0 = sampleAt(h.t0);
        if (s0 > src) continue;
        const s1 = Math.min(sampleAt(h.t1), src);
        if (s1 < left) continue;
        const x0 = Math.max(G.x0 + 1, xOf(s0));
        const x1 = Math.min(G.x1 - 1, Math.max(xOf(s1), xOf(s0) + 2));
        if (x1 - x0 < 1) continue;
        const semis = hitSemis(h);
        const f = semis == null ? 0.5 : Math.max(0, Math.min(1, (semis - dacRange.lo) / (dacRange.hi - dacRange.lo)));
        const y = dacTop + pad + (1 - f) * (L.laneH - 2 * pad - barH);
        g.globalAlpha = 0.35 + 0.6 * Math.min(1, h.peak / 127);
        g.fillStyle = DAC_COLOR;
        g.fillRect(x0, y, x1 - x0, barH);
        g.globalAlpha = 1;
        const text = hitName(h) + (semis == null ? '' : ' ' + (h.writes / ((sampleAt(h.t1) - sampleAt(h.t0)) / rate) / 1000).toFixed(1) + 'k');
        g.font = '600 9px ' + mono;
        if (x1 - x0 >= text.length * 5.6 + 6) {
          g.fillStyle = C.text;
          const ty = y - 2 >= dacTop + 9 ? y - 2 : y + barH + 9;
          g.fillText(text, x0 + 3, ty);
        }
      }

      // PSG: every write would be a tick; the NHL '92 driver never writes it.
      const psgTop = G.laneTop(6);
      g.font = (L.small ? 10 : 11) + 'px ' + mono;
      if (tr.stats.psgWrites === 0) {
        g.fillStyle = C.muted;
        g.fillText('never written by the driver', G.x0 + 8, psgTop + L.laneH / 2 + 4);
      } else {
        g.fillStyle = C.text;
        for (const w of tr.psg) {
          const s = sampleAt(w.t);
          if (s > src || s < left) continue;
          g.fillRect(Math.round(xOf(s)), psgTop + 4, 1, L.laneH - 8);
        }
        g.fillStyle = C.muted;
        g.fillText(tr.stats.psgWrites + ' writes', G.x0 + 8, psgTop + 12);
      }

      // Gutter readouts.
      const readout = [];
      for (let i = 0; i < 6; i++) {
        const ln = lanes[i];
        const dac = i === 5 && dacNow;
        const name = dac ? (hitNow ? hitName(hitNow) : 'DAC idle') : ln.keyed && ln.seg && ln.seg.name ? ln.seg.name : '—';
        readout.push({ ch: i, name, keyed: ln.keyed, dac, instrument: instrument[i] && opts.patchLabel ? opts.patchLabel(instrument[i]) : null });
        gutterText(L, G, i, name, ln.keyed, dac);
      }
      gutterText(L, G, 6, tr.stats.psgWrites ? tr.stats.psgWrites + ' w' : 'unused', false, false);

      // Time axis (song time, whole seconds scroll with the notes) and the playhead.
      g.font = (L.small ? 9 : 10) + 'px ' + mono;
      g.fillStyle = C.muted;
      g.strokeStyle = C.line;
      g.lineWidth = 1;
      const firstSec = Math.max(0, Math.ceil(left / rate));
      for (let m = firstSec; m * rate <= src; m++) {
        const x = Math.round(xOf(m * rate)) + 0.5;
        if (x < G.x0 + 14) continue;
        g.globalAlpha = 0.35;
        g.beginPath();
        g.moveTo(x, G.axis - 3);
        g.lineTo(x, G.laneTop(6) + L.laneH);
        g.stroke();
        g.globalAlpha = 1;
        const lab = Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
        if (x + g.measureText(lab).width < G.x1) g.fillText(lab, x + 2, 10);
      }
      g.fillStyle = C.amber;
      g.fillRect(G.x1 - 1.5, G.axis - 3, 1.5, G.laneTop(6) + L.laneH - G.axis + 3);

      dimMuted(L, G);
      last = { src, seconds: src / rate, notes: tr.notes.length, bars: bars.length, lanes: readout, dac: dacNow, psgWrites: tr.stats.psgWrites };
    }

    function updateEvents(st) {
      const tr = st.tracker;
      const src = st.src;
      const ev = [];
      for (const n of tr.notes) {
        const s0 = sampleAt(n.t0);
        if (s0 > src) continue;
        const name = n.segs[0].name || '?';
        ev.push([s0, n.ch, 1, 'key on  ' + name]);
        if (n.t1 != null && sampleAt(n.t1) <= src) ev.push([sampleAt(n.t1), n.ch, 0, 'key off']);
      }
      for (const p of tr.patches) {
        const s = sampleAt(p.t0);
        if (p.kind !== 'patch' || s > src) continue;
        ev.push([s, p.ch, 2, 'patch   A' + p.algorithm + ' FB' + p.feedback + ' #' + p.sig.slice(0, 4)]);
      }
      for (const h of tr.dacHits) {
        const s0 = sampleAt(h.t0);
        if (s0 > src) continue;
        ev.push([s0, 5, 1, 'PCM hit  ' + hitName(h) + '  ' + h.writes + ' samples, ' + ((sampleAt(h.t1) - s0) / rate).toFixed(2) + ' s']);
      }
      for (const d of tr.dacSpans) {
        const s0 = sampleAt(d.t0);
        if (s0 > src || (d.writes === 0 && d.t1 != null)) continue;
        ev.push([s0, 5, 1, 'DAC on']);
        if (d.t1 != null && sampleAt(d.t1) <= src) ev.push([sampleAt(d.t1), 5, 0, 'DAC off (' + d.writes + ' samples)']);
      }
      ev.sort((a, b) => b[0] - a[0] || a[2] - b[2]);
      const text = ev.slice(0, EVENT_LINES).map((e) => clock(e[0] / rate) + '  ' + NAMES[e[1]] + '  ' + e[3]).join('\n') || 'No events yet.';
      if (text !== lastText) {
        lastText = text;
        events.textContent = text;
      }
    }

    function tick(now) {
      raf = root.requestAnimationFrame(tick);
      if (!container.isConnected) { destroy(); return; }
      if (root.document.hidden) return;
      const st = opts.state();
      if (!st) {
        held.fill(null);
        heldSrc = 0;
        if (mode === 'roll') {
          const L = size();
          if (!idleDrawn || L.w !== cssW) { drawIdle(); idleDrawn = true; }
        } else if (lastText !== 'Not playing.') {
          lastText = 'Not playing.';
          events.textContent = lastText;
        }
        last = null;
        return;
      }
      idleDrawn = false;
      if (mode === 'roll') drawLive(st);
      else if (now - lastEvents > 120) {
        lastEvents = now;
        updateEvents(st);
      }
    }

    function destroy() {
      if (raf) root.cancelAnimationFrame(raf);
      raf = 0;
      if (ro) ro.disconnect();
    }

    canvas.addEventListener('mousemove', (ev) => {
      if (!mutable) return;
      const r = canvas.getBoundingClientRect();
      const y = ev.clientY - r.top;
      const L = size();
      const G = geometry(L);
      let over = false;
      for (let i = 0; i < 6; i++) if (y >= G.laneTop(i) && y < G.laneTop(i) + L.laneH) over = true;
      canvas.style.cursor = over ? 'pointer' : '';
    });
    canvas.addEventListener('click', (ev) => {
      if (!mutable) return;
      const r = canvas.getBoundingClientRect();
      const y = ev.clientY - r.top;
      const L = size();
      const G = geometry(L);
      for (let i = 0; i < 6; i++) {
        if (y >= G.laneTop(i) && y < G.laneTop(i) + L.laneH) {
          opts.onToggle(i);
          idleDrawn = false;
          return;
        }
      }
    });

    size();
    drawIdle();
    idleDrawn = true;
    raf = root.requestAnimationFrame(tick);

    return {
      destroy,
      setMode,
      get mode() { return mode; },
      /** What the last live frame showed (per-lane current note, key state, DAC), or null when idle. */
      get readout() { return last; }
    };
  }

  root.NhlSoundRoll = { mount, WINDOW_S };
})(typeof self !== 'undefined' ? self : this);
