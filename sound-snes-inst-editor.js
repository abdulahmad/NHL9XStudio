/**
 * NHL 94 (SNES) sound-entry editor: BRR preview and ADSR / GAIN bytes (48-byte SoundTable row).
 */
(function (root) {
  'use strict';

  const SIZE = () => root.NhlSnesSoundEdits.SIZE;
  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function mount(container, opts) {
    container.replaceChildren();
    if (!opts.is94) {
      container.appendChild(make('p', 'st-note', 'Instrument editing is available for NHL 94 (SNES) only.'));
      return { getEdits: () => null };
    }
    const data = opts.data;
    const set = () => opts.set();
    let soundId = 0;
    let bytes = null;
    const edits = opts.edits || {};

    const idSel = document.createElement('select');
    for (let i = 0; i < 29; i++) {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = '#' + i + ' · ' + (data.soundSample(set(), i) || 'sound');
      idSel.appendChild(o);
    }
    const fields = ['adsr1', 'adsr2', 'gain', 'sample'].map((k) => {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.min = '0';
      inp.max = '255';
      inp.className = 'mono';
      return { key: k, inp };
    });
    const load = () => {
      soundId = Number(idSel.value);
      const base = edits[soundId] || data.sound(set(), soundId).raw;
      bytes = base.slice();
      fields.forEach((f) => {
        const off = f.key === 'adsr1' ? 0x15 : f.key === 'adsr2' ? 0x16 : f.key === 'gain' ? 0x0a : 0x14;
        f.inp.value = String(bytes[off]);
      });
    };
    idSel.addEventListener('change', load);
    load();

    const row = make('div', 'st-note');
    row.appendChild(make('span', null, 'Sound entry '));
    row.appendChild(idSel);
    fields.forEach((f) => {
      row.appendChild(make('span', null, ' ' + f.key + ' '));
      row.appendChild(f.inp);
      f.inp.addEventListener('change', () => {
        const off = f.key === 'adsr1' ? 0x15 : f.key === 'adsr2' ? 0x16 : f.key === 'gain' ? 0x0a : 0x14;
        bytes[off] = Number(f.inp.value) & 0xff;
        edits[soundId] = bytes.slice();
        if (opts.onChange) opts.onChange();
      });
    });
    const playBtn = make('button', 'ghost-btn', '▶ Preview BRR');
    playBtn.type = 'button';
    playBtn.addEventListener('click', () => {
      const snd = data.sound(set(), soundId);
      const samp = data.sample(data.soundSample(set(), soundId));
      const Dsp = root.NhlSnesDsp;
      const pitch = snd.pitchOffset || 0x1000;
      const r = Dsp.renderVoice({
        brr: samp.brr,
        pitch: pitch & 0x3fff,
        adsr1: bytes[0x15],
        adsr2: bytes[0x16],
        gain: bytes[0x0a],
        sampleRate: 32000
      });
      const ctx = opts.audioContext();
      if (!ctx) return;
      const buf = ctx.createBuffer(1, r.samples.length, r.rate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < r.samples.length; i++) ch[i] = r.samples[i] / 32768;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
    });
    row.appendChild(playBtn);
    container.appendChild(row);
    container.appendChild(make('p', 'st-note', 'Edits apply when you Play or export native MIDI (n94:sound markers).'));

    return {
      getEdits: () => edits,
      setSet: () => load()
    };
  }

  root.NhlSoundSnesInstEditor = { mount };
})(typeof self !== 'undefined' ? self : this);
