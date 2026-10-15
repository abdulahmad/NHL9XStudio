/**
 * Read-only "Sound data" view for NHL '92: songs, order lists, patterns, SFX,
 * envelopes and leftover bytes, from lib/audio/nhl92-sound-data.js. No playback
 * (that arrives with the 68k driver). viewer.js owns state and calls in here.
 */
(function (root) {
  const SD = () => root.Nhl92SoundData;
  const NAMES = () => root.Nhl92SfxNames;
  let data = null;
  let error = '';
  let loading = null;

  async function ensure(baseUrl) {
    if (data) return data;
    if (loading) return loading;
    loading = (async () => {
      const rom = await root.Nhl92SoundFixture.ensureSyntheticRom({ baseUrl });
      data = SD().parse(rom);
      error = '';
      return data;
    })().catch((err) => {
      error = err && err.message ? err.message : String(err);
      loading = null;
      throw err;
    });
    return loading;
  }

  const h = (n, w) => SD().hex(n, w);
  /** The six $FFFFFFE6 bytes Sound_WriteYM2612 leaves for this request. */
  const sfxBytes = (a) => {
    const z = (a.sample | 0x8000) & 0xffff;
    return [z >> 8, z & 0xff, 0, a.rate, (a.sample >>> 15) & 0xff, a.priority];
  };
  const bytesHex = (bs) => bs.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  const make = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  /** List entries: { id, group, label, sub }. */
  function entries() {
    if (!data) return [];
    const out = [];
    for (const s of data.songs) {
      out.push({ id: 'song-' + s.id, group: 'Songs', label: s.id + ' · ' + s.name, sub: 'tempo ' + s.tempo + ' · ' + (s.lastChannel + 1) + ' channels · ' + h(s.entry) });
    }
    for (const s of data.sfx) {
      const kinds = s.actions.map((a) => (a.type === 'dac' ? 'DAC' : 'FM ch' + a.channel)).join(' + ');
      out.push({ id: 'sfx-' + s.id, group: 'SFX', label: NAMES().name(s.id), sub: kinds + ' · disassembly label handle_sfx_' + s.label });
    }
    out.push({ id: 'stop', group: 'SFX', label: 'Stop DAC (configure_ym2612)', sub: 'called by Stop/Pause music · ' + h(data.stopHandler.handler) });
    out.push({ id: 'envelopes', group: 'Tables', label: 'Pitch envelopes', sub: data.envelopes.length + ' envelopes · ' + h(data.envelopes[0].start) });
    out.push({ id: 'patches', group: 'Tables', label: 'Instrument patches', sub: data.patches.length + ' × 32 bytes · Z80 $02A5' });
    out.push({ id: 'coverage', group: 'Tables', label: 'Data blocks & unread bytes', sub: data.blocks.length + ' blocks · ' + data.unreferenced.length + ' unread ranges' });
    return out;
  }

  function eventTable(events, opts) {
    const table = make('table', 'sd-events');
    const head = make('tr');
    ['ROM', 'Bytes', 'Event'].concat(opts && opts.note ? ['Note index'] : []).forEach((t) => head.appendChild(make('th', null, t)));
    table.appendChild(head);
    for (const e of events) {
      const tr = make('tr', 'ev-' + e.kind);
      tr.appendChild(make('td', 'mono', h(e.at)));
      tr.appendChild(make('td', 'mono', bytesHex(e.bytes)));
      tr.appendChild(make('td', null, e.text));
      if (opts && opts.note) tr.appendChild(make('td', 'mono', opts.note(e)));
      table.appendChild(tr);
    }
    return table;
  }

  function patternDetails(start, entryState, open) {
    const p = data.patternEntries.find((x) => x.start === start);
    const det = make('details', 'sd-pattern');
    if (open) det.open = true;
    const sum = make('summary');
    const stateText = entryState
      ? ' · enters with transpose ' + entryState.transpose + (entryState.patch == null ? '' : ', instrument ' + entryState.patch)
      : '';
    sum.textContent = 'Pattern ' + h(start) + ' · ' + p.events.length + ' events · ' + (p.end - start) + ' bytes' + stateText;
    det.appendChild(sum);
    det.addEventListener('toggle', () => {
      if (!det.open || det.dataset.filled) return;
      det.dataset.filled = '1';
      let transpose = entryState ? entryState.transpose : 0;
      let patch = entryState ? entryState.patch : null;
      const note = (e) => {
        if (e.kind === 'transpose') transpose = e.semitones;
        if (e.kind === 'instrument') patch = e.patch;
        if (e.kind !== 'note' || patch == null) return '';
        const n = e.note + data.patches[patch].noteOffset + transpose;
        return n + ' (' + SD().noteName(n) + ')';
      };
      det.appendChild(eventTable(p.events, entryState ? { note } : null));
    });
    if (open) det.dispatchEvent(new Event('toggle'));
    return det;
  }

  function renderSong(box, id) {
    const song = data.songs[id];
    box.appendChild(make('h3', null, 'Song ' + song.id + ' · ' + song.name));
    box.appendChild(make('p', 'sd-note', 'Header ' + h(song.entry) + ': last channel ' + song.lastChannel + ', tempo ' + song.tempo +
      ' (duration units × ' + song.tempo + ' vblanks). Note index = note + patch offset + transpose, as the walk below reaches each pattern (list order, not timing).'));
    for (const ch of song.channels) {
      const list = data.orderLists.find((l) => l.start === ch.orderList);
      const sec = make('section', 'sd-channel');
      sec.appendChild(make('h4', null, 'Channel ' + ch.channel + ' · order list ' + h(list.start) + '–' + h(list.end - 1) +
        ' · note index ' + ch.noteIndexRange[0] + '–' + ch.noteIndexRange[1]));
      const ol = make('ol', 'sd-order');
      let entry = 0;
      for (const it of list.items) {
        const li = make('li');
        li.appendChild(make('span', 'mono sd-at', h(it.at)));
        if (it.kind === 'pattern') {
          const state = ch.entries[entry++];
          li.appendChild(patternDetails(it.pattern, state, false));
        } else {
          li.appendChild(make('span', 'sd-ctl', it.text));
        }
        ol.appendChild(li);
      }
      if (list.fallsInto != null) {
        const li = make('li');
        li.appendChild(make('span', 'mono sd-at', h(list.fallsInto)));
        li.appendChild(make('span', 'sd-ctl', 'no terminator: the next word belongs to order list ' + h(list.fallsInto)));
        ol.appendChild(li);
      }
      sec.appendChild(ol);
      box.appendChild(sec);
    }
  }

  function renderSfxActions(box, actions) {
    for (const a of actions) {
      const sec = make('section', 'sd-channel');
      if (a.type === 'dac') {
        const s = data.samples.find((x) => x.start === a.sample);
        const period = 161 + 17 * (a.rate || 256);
        const hz = 3579545 / period;
        sec.appendChild(make('h4', null, 'DAC sample ' + h(a.sample) + (a.from ? ' (via ' + h(a.from) + ')' : '')));
        sec.appendChild(make('p', 'sd-note', 'Rate ' + h(a.rate, 2) + ' → ' + period + ' T-states per byte ≈ ' + hz.toFixed(0) + ' Hz · priority ' + a.priority +
          ' · plays ' + h(s.playStart) + '–' + h(s.terminator - 1) + ' (' + s.bytes + ' bytes, ≈ ' + (s.bytes / hz).toFixed(2) + ' s) · ' +
          (s.loops ? 'loops' : 'one-shot') + ' · $FFE6 bytes ' + bytesHex(sfxBytes(a))));
      } else {
        const st = data.sfxStreams.find((x) => x.start === a.stream);
        sec.appendChild(make('h4', null, 'FM stream ' + h(a.stream) + ' on output slot ' + a.channel + (a.from ? ' (via ' + h(a.from) + ')' : '')));
        sec.appendChild(eventTable(st.events));
      }
      box.appendChild(sec);
    }
  }

  function renderTables(box, id) {
    if (id === 'envelopes') {
      box.appendChild(make('h3', null, 'Pitch envelopes'));
      for (const e of data.envelopes) {
        box.appendChild(make('p', 'sd-note', 'Envelope ' + e.id + ' · ' + h(e.start) + '–' + h(e.end - 1) + ': ' + e.values.join(', ') + ', then loop ($84)'));
      }
    } else if (id === 'patches') {
      box.appendChild(make('h3', null, 'Instrument patches (Z80 $02A5 + id × 32)'));
      const table = make('table', 'sd-events');
      const head = make('tr');
      ['ID', 'Z80', 'ROM', 'Alg', 'FB', 'Note offset', 'Register bytes'].forEach((t) => head.appendChild(make('th', null, t)));
      table.appendChild(head);
      for (const p of data.patches) {
        const tr = make('tr');
        [String(p.id), h(p.z80, 4), h(p.rom), String(p.algorithm), String(p.feedback), String(p.noteOffset), bytesHex(p.registers)]
          .forEach((t, i) => tr.appendChild(make('td', i ? 'mono' : null, t)));
        table.appendChild(tr);
      }
      box.appendChild(table);
    } else {
      box.appendChild(make('h3', null, 'Data blocks'));
      const table = make('table', 'sd-events');
      const head = make('tr');
      ['Block', 'ROM range', 'Items', 'Gaps', 'Overlaps'].forEach((t) => head.appendChild(make('th', null, t)));
      table.appendChild(head);
      for (const b of data.blocks) {
        const tr = make('tr');
        [b.name, h(b.start) + '–' + h(b.end - 1), String(b.items), String(b.gaps.length), String(b.overlaps.length)]
          .forEach((t, i) => tr.appendChild(make('td', i === 1 ? 'mono' : null, t)));
        table.appendChild(tr);
      }
      box.appendChild(table);
      box.appendChild(make('h3', null, 'Bytes the driver never reads'));
      const t2 = make('table', 'sd-events');
      const h2 = make('tr');
      ['ROM range', 'Block', 'Bytes', 'Why'].forEach((t) => h2.appendChild(make('th', null, t)));
      t2.appendChild(h2);
      for (const u of data.unreferenced) {
        const tr = make('tr');
        [h(u.start) + '–' + h(u.end - 1), u.block, bytesHex(u.bytes), u.reason].forEach((t, i) => tr.appendChild(make('td', i < 3 ? 'mono' : null, t)));
        t2.appendChild(tr);
      }
      box.appendChild(t2);
    }
  }

  /** Fill the stage panel for entry `id`. */
  function renderPanel(box, id) {
    box.replaceChildren();
    if (!data) {
      box.appendChild(make('p', 'sd-note', error ? 'Sound data failed to load: ' + error : 'Loading sound data…'));
      return;
    }
    if (id.startsWith('song-')) renderSong(box, Number(id.slice(5)));
    else if (id.startsWith('sfx-')) {
      const s = data.sfx[Number(id.slice(4))];
      const N = NAMES();
      box.appendChild(make('h3', null, 'SFX ' + N.name(s.id)));
      box.appendChild(make('p', 'sd-note', 'Name from the EA sound list' + (N.EQUATES[s.id] ? ' and the src/ram.asm equate' + (N.EQUATES[s.id].length > 1 ? 's ' : ' ') + N.EQUATES[s.id].join(', ') : '') +
        '. sfx_pointer_table entry ' + h(data.sfxTable + s.id * 4) + ' → handler ' + h(s.handler) + '.'));
      box.appendChild(make('p', 'sd-note', 'In sound.asm this handler is labelled handle_sfx_' + s.label + ' and its table comment reads "' +
        N.TABLE_COMMENTS[s.id] + '". Those labels and comments are shifted against the IDs, so they are shown here only for reference.'));
      renderSfxActions(box, s.actions);
    } else if (id === 'stop') {
      box.appendChild(make('h3', null, 'configure_ym2612'));
      box.appendChild(make('p', 'sd-note', 'Called from Sound_StopMusic (' + h(data.stopHandler.calledFrom) + ') and Sound_PauseMusic. Requests an empty sample, which ends any DAC SFX.'));
      renderSfxActions(box, data.stopHandler.actions);
    } else renderTables(box, id);
  }

  /** [label, value] rows for the Details panel. */
  function metaRows(id) {
    if (!data) return [['Sound data', error || 'loading']];
    const rows = [];
    if (id.startsWith('song-')) {
      const s = data.songs[Number(id.slice(5))];
      rows.push(['Song', s.id + ' · ' + s.name], ['Header', h(s.entry)], ['Tempo', String(s.tempo)], ['Channels', String(s.lastChannel + 1)]);
      const pats = new Set();
      for (const ch of s.channels) for (const e of ch.entries) pats.add(e.pattern);
      rows.push(['Patterns', String(pats.size) + ' distinct']);
    } else if (id.startsWith('sfx-')) {
      const s = data.sfx[Number(id.slice(4))];
      rows.push(['SFX id', String(s.id)], ['Name', NAMES().name(s.id).replace(/^\d+ · /, '')], ['Disassembly label', 'handle_sfx_' + s.label], ['Handler', h(s.handler)], ['Actions', s.actions.map((a) => (a.type === 'dac' ? 'DAC ' + h(a.sample) : 'FM ' + h(a.stream))).join(', ')]);
    }
    rows.push(['Source', 'Bundled NHL 92 sound slice ($F4C8–$24213)']);
    rows.push(['Format', 'docs/NHL92-SOUND-DATA.md']);
    return rows;
  }

  root.NhlSoundDataView = {
    ensure,
    entries,
    renderPanel,
    metaRows,
    get ready() { return !!data; },
    get error() { return error; }
  };
})(typeof self !== 'undefined' ? self : this);
