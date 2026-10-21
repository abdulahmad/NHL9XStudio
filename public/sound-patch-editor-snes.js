/**
 * SNES (NHL 94) sound-entry editor: BRR preview and ADSR/GAIN bytes, following sound-patch-editor.js layout.
 * Edits are kept in memory and applied when the Sound test plays or exports native MIDI (Nhl94sSoundOverrides).
 */
(function (root) {
  'use strict';

  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const overrides = {};

  function key(set, n) {
    return set + ':' + n;
  }

  function entryOf(data, set, n) {
    const snd = data.sounds(set)[n];
    const k = key(set, n);
    const o = overrides[k];
    if (!o) return snd;
    const raw = snd.raw.slice();
    if (o.adsr1 != null) raw[0x15] = o.adsr1;
    if (o.adsr2 != null) raw[0x16] = o.adsr2;
    if (o.gain != null) raw[0x0a] = o.gain;
    return Object.assign({}, snd, { raw, adsr1: raw[0x15], adsr2: raw[0x16], gain: raw[0x0a] });
  }

  function mount(container, opts) {
    const data = opts.data;
    const set = opts.set || 'game';
    const n = opts.index;
    const snd = data.sounds(set)[n];
    const sample = data.sample(snd.sampleName || data.sampleList(set)[snd.sample]);
    const k = key(set, n);
    const cur = overrides[k] || { adsr1: snd.adsr1, adsr2: snd.adsr2, gain: snd.gain };
    container.replaceChildren();
    container.appendChild(make('p', 'st-kind', 'NHL 94 (SNES) sound entry'));
    container.appendChild(make('h3', null, set + ' #' + n + ' · ' + (sample.name || snd.sample)));
    const row = make('div', 'st-inst-row');
    ['adsr1', 'adsr2', 'gain'].forEach((f) => {
      const inp = make('input');
      inp.type = 'number';
      inp.min = 0;
      inp.max = 255;
      inp.value = cur[f];
      inp.addEventListener('change', () => {
        cur[f] = Number(inp.value) & 0xff;
        overrides[k] = cur;
        if (opts.onChange) opts.onChange(entryOf(data, set, n));
      });
      row.appendChild(make('label', null, f + ' '));
      row.appendChild(inp);
    });
    container.appendChild(row);
    const play = make('button', 'ghost-btn', '▶ Preview sample');
    play.type = 'button';
    play.addEventListener('click', () => {
      const e = entryOf(data, set, n);
      const Dsp = root.NhlSnesDsp;
      if (!Dsp || !sample.brr) return;
      const r = Dsp.renderVoice({ brr: sample.brr, pitch: 0x1000, adsr1: e.adsr1, adsr2: e.adsr2, gain: e.gain, samples: 8000, keyOffAt: 6000 });
      const ctx = new (root.AudioContext || root.webkitAudioContext)();
      const buf = ctx.createBuffer(1, r.samples.length, r.rate);
      buf.getChannelData(0).set(r.samples.map((s) => s / 32768));
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
    });
    container.appendChild(play);
  }

  root.NhlSoundPatchEditorSnes = { mount, entryOf, overrides: () => overrides };
})(typeof self !== 'undefined' ? self : this);
