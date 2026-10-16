/**
 * YM2612 instrument editor for the sequencer panels: every FM patch the retail driver loads is 32 bytes (26 register
 * bytes: DT/MUL, TL, RS/AR, AM/D1R, D2R, SL/RR for four operators, then feedback/algorithm and pan/AMS/FMS; a note
 * offset at +26; the rest the 68k/Z80 side keeps). This panel shows and edits those bytes. The sequencer applies the
 * edits to its ROM copy when the song plays, so the retail drivers play the edited instruments.
 *
 * The YM2612 has no filters: its tone comes from the algorithm (how the four operators feed each other), each
 * operator's frequency multiple and detune, total level (volume), and a four-stage envelope per operator
 * (attack, first decay, second decay, release, with a sustain level between the decays).
 */
(function (root) {
  'use strict';

  const ALGORITHMS = [
    '1 → 2 → 3 → 4',
    '(1 + 2) → 3 → 4',
    '(1 + (2 → 3)) → 4',
    '((1 → 2) + 3) → 4',
    '(1 → 2) + (3 → 4)',
    '1 → (2 + 3 + 4)',
    '(1 → 2) + 3 + 4',
    '1 + 2 + 3 + 4'
  ];
  const CARRIERS = { 0: [3], 1: [3], 2: [3], 3: [3], 4: [1, 3], 5: [1, 2, 3], 6: [1, 2, 3], 7: [0, 1, 2, 3] };
  const PAN = ['off', 'right', 'left', 'both'];

  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /** Field definitions: [key, label, min, max, read(bytes, op), write(bytes, op, value), title]. */
  const OP_FIELDS = [
    ['dt', 'DT', 0, 7, (b, i) => (b[i] >> 4) & 7, (b, i, v) => { b[i] = (b[i] & 0x8f) | (v << 4); }, 'Detune: a small fixed offset from the multiple'],
    ['mul', 'MUL', 0, 15, (b, i) => b[i] & 15, (b, i, v) => { b[i] = (b[i] & 0xf0) | v; }, 'Frequency multiple of the note (0 = half)'],
    ['tl', 'TL', 0, 127, (b, i) => b[4 + i] & 127, (b, i, v) => { b[4 + i] = (b[4 + i] & 0x80) | v; }, 'Total level: 0 is loudest, 127 is silent (a carrier\'s TL is the voice volume; a modulator\'s sets how bright)'],
    ['rs', 'RS', 0, 3, (b, i) => (b[8 + i] >> 6) & 3, (b, i, v) => { b[8 + i] = (b[8 + i] & 0x3f) | (v << 6); }, 'Rate scaling: higher notes run the envelope faster'],
    ['ar', 'AR', 0, 31, (b, i) => b[8 + i] & 31, (b, i, v) => { b[8 + i] = (b[8 + i] & 0xe0) | v; }, 'Attack rate: 31 is instant'],
    ['am', 'AM', 0, 1, (b, i) => (b[12 + i] >> 7) & 1, (b, i, v) => { b[12 + i] = (b[12 + i] & 0x7f) | (v << 7); }, 'Let the LFO tremolo (amplitude modulation) affect this operator'],
    ['d1r', 'D1R', 0, 31, (b, i) => b[12 + i] & 31, (b, i, v) => { b[12 + i] = (b[12 + i] & 0xe0) | v; }, 'First decay rate: from the peak down to the sustain level'],
    ['sl', 'SL', 0, 15, (b, i) => (b[20 + i] >> 4) & 15, (b, i, v) => { b[20 + i] = (b[20 + i] & 0x0f) | (v << 4); }, 'Sustain level the first decay falls to (0 = peak, 15 = lowest)'],
    ['d2r', 'D2R', 0, 31, (b, i) => b[16 + i] & 31, (b, i, v) => { b[16 + i] = (b[16 + i] & 0xe0) | v; }, 'Second decay rate: the slow fall while the key is held (0 holds forever)'],
    ['rr', 'RR', 0, 15, (b, i) => b[20 + i] & 15, (b, i, v) => { b[20 + i] = (b[20 + i] & 0xf0) | v; }, 'Release rate after key off']
  ];

  /** Approximate envelope shape of one operator: a polyline over (time, level) with log-compressed phase widths. */
  function envelopePoints(b, i) {
    const tl = b[4 + i] & 127;
    const ar = b[8 + i] & 31;
    const d1r = b[12 + i] & 31;
    const d2r = b[16 + i] & 31;
    const sl = (b[20 + i] >> 4) & 15;
    const rr = b[20 + i] & 15;
    const peak = 1 - tl / 127;
    const sus = peak * (1 - (sl === 15 ? 1 : sl / 15) * 0.95);
    const dur = (rate, max) => (rate === 0 ? 1 : Math.max(0.03, Math.min(1, Math.pow(2, (max - rate) / 3.2) * 0.06)));
    const tA = ar === 0 ? 1 : dur(ar, 31);
    const tD = d1r === 0 ? 1 : dur(d1r, 31);
    const tS = 1;
    const tR = rr === 0 ? 1 : dur(rr * 2 + 1, 31);
    const total = tA + tD + tS + tR;
    const pts = [[0, 0]];
    let x = tA;
    pts.push([x / total, peak]);
    x += tD;
    pts.push([x / total, d1r === 0 ? peak : sus]);
    const hold = d2r === 0 ? 0 : Math.min(1, d2r / 31) * 0.5;
    x += tS;
    pts.push([x / total, Math.max(0, (d1r === 0 ? peak : sus) * (1 - hold))]);
    x += tR;
    pts.push([1, 0]);
    return pts;
  }

  /**
   * @param {HTMLElement} container
   * @param {{
   *   ids: number[], current: function(): number, setCurrent: function(number),
   *   get: function(number): Uint8Array, retail: function(number): Uint8Array, set: function(number, Uint8Array),
   *   reset: function(number), edited: function(number): boolean, label: function(number): string,
   *   audition: function(number), hasNoteOffset: boolean }} o
   */
  function mount(container, o) {
    const box = make('details', 'pe-box');
    box.id = 'se-patch-editor';
    const sum = make('summary', null, 'Instrument editor (YM2612 operators, envelopes)');
    box.appendChild(sum);
    const body = make('div', 'pe-body');
    box.appendChild(body);
    container.appendChild(box);

    const top = make('div', 'st-controls se-bar');
    const sel = make('select');
    sel.id = 'pe-patch';
    sel.setAttribute('aria-label', 'Instrument to edit');
    o.ids.forEach((id) => sel.appendChild(Object.assign(make('option'), { value: String(id), textContent: o.label(id) })));
    const hint = make('span', 'se-dim');
    const auditionBtn = make('button', 'ghost-btn', '▶ Audition');
    auditionBtn.type = 'button';
    auditionBtn.id = 'pe-audition';
    auditionBtn.title = 'Play one note (C4, then C5) on this instrument through the retail driver';
    auditionBtn.addEventListener('click', () => o.audition(Number(sel.value)));
    const resetBtn = make('button', 'ghost-btn', 'Reset to retail');
    resetBtn.type = 'button';
    resetBtn.id = 'pe-reset';
    resetBtn.addEventListener('click', () => { o.reset(Number(sel.value)); render(); });
    const copyBtn = make('button', 'ghost-btn', 'Copy hex');
    copyBtn.type = 'button';
    copyBtn.title = 'Copy the 32 patch bytes as hex (paste them into a hack or an assembler source)';
    copyBtn.addEventListener('click', () => {
      const hex = Array.from(o.get(Number(sel.value))).map((v) => (v < 16 ? '0' : '') + v.toString(16).toUpperCase()).join(' ');
      try { navigator.clipboard.writeText(hex); hint.textContent = 'Copied.'; } catch (err) { hint.textContent = hex; }
    });
    const lab = (text, el) => { const l = make('label', null, text + ' '); l.appendChild(el); return l; };
    top.append(lab('Instrument', sel), auditionBtn, resetBtn, copyBtn, hint);
    body.appendChild(top);

    const inputs = new Map();
    const numInput = (min, max, title, onChange) => {
      const i = make('input');
      i.type = 'number';
      i.min = String(min);
      i.max = String(max);
      i.step = '1';
      i.title = title || '';
      i.addEventListener('change', () => {
        const v = Math.max(min, Math.min(max, Math.round(Number(i.value) || 0)));
        i.value = String(v);
        onChange(v);
      });
      return i;
    };
    const change = (fn) => {
      const id = Number(sel.value);
      const b = Uint8Array.from(o.get(id));
      fn(b);
      o.set(id, b);
      render();
    };

    // Channel-wide settings
    const row = make('div', 'st-controls se-bar');
    const algIn = numInput(0, 7, 'Algorithm: how the operators feed each other', (v) => change((b) => { b[24] = (b[24] & 0x38) | v; }));
    const fbIn = numInput(0, 7, 'Operator 1 feedback', (v) => change((b) => { b[24] = (b[24] & 7) | (v << 3); }));
    const panSel = make('select');
    PAN.forEach((t, i) => panSel.appendChild(Object.assign(make('option'), { value: String(i), textContent: t })));
    panSel.addEventListener('change', () => change((b) => { b[25] = (b[25] & 0x3f) | (Number(panSel.value) << 6); }));
    const amsIn = numInput(0, 3, 'Tremolo depth (LFO amplitude modulation)', (v) => change((b) => { b[25] = (b[25] & 0xcf) | (v << 4); }));
    const fmsIn = numInput(0, 7, 'Vibrato depth (LFO frequency modulation)', (v) => change((b) => { b[25] = (b[25] & 0xf8) | v; }));
    const noteOff = numInput(-127, 127, 'Semitones added to every note on this instrument', (v) => change((b) => { b[26] = v & 255; }));
    const algText = make('span', 'se-dim');
    row.append(lab('Algorithm', algIn), algText, lab('Feedback', fbIn), lab('Pan', panSel), lab('AMS', amsIn), lab('FMS', fmsIn));
    if (o.hasNoteOffset) row.appendChild(lab('Note offset', noteOff));
    body.appendChild(row);

    // Operators
    const grid = make('div', 'pe-grid');
    const cards = [];
    for (let i = 0; i < 4; i++) {
      const card = make('div', 'pe-op');
      const title = make('div', 'pe-op-title', 'Operator ' + (i + 1));
      card.appendChild(title);
      const fields = make('div', 'pe-fields');
      OP_FIELDS.forEach(([key, name, min, max, read, write, tip]) => {
        const input = numInput(min, max, tip, (v) => change((b) => write(b, i, v)));
        const l = make('label', 'pe-f', name + ' ');
        l.title = tip;
        l.appendChild(input);
        fields.appendChild(l);
        inputs.set(key + i, { input, read });
      });
      card.appendChild(fields);
      const cv = make('canvas', 'pe-env');
      cv.width = 220;
      cv.height = 54;
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', 'Approximate envelope of operator ' + (i + 1));
      card.appendChild(cv);
      grid.appendChild(card);
      cards.push({ title, cv });
    }
    body.appendChild(grid);
    body.appendChild(make('p', 'se-dim pe-note', 'Edits are applied to the ROM copy the sequencer plays (and kept with the song in this browser); MIDI and stream exports still name the retail instruments. Envelope drawings show the shape only, not exact times. The YM2612 has no filters: the tone comes from the algorithm, multiples/detune, total levels and these envelopes.'));

    function drawEnv(cv, b, i, carrier) {
      const g = cv.getContext('2d');
      const css = getComputedStyle(document.documentElement);
      const line = (css.getPropertyValue('--line') || '#33414d').trim();
      g.clearRect(0, 0, cv.width, cv.height);
      g.fillStyle = (css.getPropertyValue('--bg') || '#101418').trim();
      g.fillRect(0, 0, cv.width, cv.height);
      g.strokeStyle = line;
      g.strokeRect(0.5, 0.5, cv.width - 1, cv.height - 1);
      const pts = envelopePoints(b, i);
      g.strokeStyle = carrier ? '#f0b429' : '#4cc9f0';
      g.lineWidth = 1.5;
      g.beginPath();
      pts.forEach(([x, y], k) => {
        const px = 4 + x * (cv.width - 8);
        const py = cv.height - 4 - y * (cv.height - 8);
        if (k) g.lineTo(px, py); else g.moveTo(px, py);
      });
      g.stroke();
    }

    function render() {
      const cur = o.current();
      if (o.ids.indexOf(cur) >= 0 && String(cur) !== sel.value && document.activeElement !== sel) sel.value = String(cur);
      const id = Number(sel.value);
      const b = o.get(id);
      const alg = b[24] & 7;
      algIn.value = String(alg);
      algText.textContent = ALGORITHMS[alg];
      fbIn.value = String((b[24] >> 3) & 7);
      panSel.value = String((b[25] >> 6) & 3);
      amsIn.value = String((b[25] >> 4) & 3);
      fmsIn.value = String(b[25] & 7);
      noteOff.value = String((b[26] << 24) >> 24);
      for (let i = 0; i < 4; i++) {
        const carrier = CARRIERS[alg].indexOf(i) >= 0;
        OP_FIELDS.forEach(([key]) => { const f = inputs.get(key + i); f.input.value = String(f.read(b, i)); });
        cards[i].title.textContent = 'Operator ' + (i + 1) + (carrier ? ' · carrier (heard)' : ' · modulator');
        cards[i].title.classList.toggle('is-carrier', carrier);
        drawEnv(cards[i].cv, b, i, carrier);
      }
      const edited = o.edited(id);
      resetBtn.disabled = !edited;
      hint.textContent = edited ? 'Edited from the retail patch.' : 'Retail patch.';
      sel.querySelectorAll('option').forEach((opt) => { opt.textContent = o.label(Number(opt.value)) + (o.edited(Number(opt.value)) ? ' *' : ''); });
    }
    // Called from the sequencer's own refresh (undo, instrument change): only does work while the panel is open.
    const refresh = () => { if (box.open) render(); };
    sel.addEventListener('change', () => { o.setCurrent(Number(sel.value)); render(); });
    box.addEventListener('toggle', () => { if (box.open) render(); });
    return { refresh, open: () => { box.open = true; render(); }, destroy() { box.remove(); } };
  }

  root.NhlPatchEditor = { mount, ALGORITHMS, CARRIERS, OP_FIELDS, envelopePoints };
})(typeof self !== 'undefined' ? self : this);
