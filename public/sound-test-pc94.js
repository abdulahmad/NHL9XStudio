/**
 * NHL 94 PC Audio tab: AdLib .KMS/.CFG songs and PCFF digital samples.
 */
(function (root) {
  const CAT = () => (root.NhlAudioCategories && root.NhlAudioCategories.CATEGORY) || {
    songs: 'Songs', sfx: 'SFX', samples: 'Samples'
  };
  const TEAM = {
    BOS: 'Boston', BUF: 'Buffalo', CAL: 'Calgary', CGY: 'Calgary', CHI: 'Chicago', CHIC: 'Chicago',
    DET: 'Detroit', ED: 'Edmonton', EDM: 'Edmonton', HART: 'Hartford', HFD: 'Hartford',
    LA: 'Los Angeles', LI: 'Long Island', NYI: 'Long Island', MON: 'Montreal', MTL: 'Montreal',
    NJER: 'New Jersey', NJ: 'New Jersey', NY: 'New York', NYR: 'New York', OTT: 'Ottawa',
    PHIL: 'Philadelphia', PHI: 'Philadelphia', PITTS: 'Pittsburgh', PIT: 'Pittsburgh',
    QU: 'Quebec', QUE: 'Quebec', SHK: 'San Jose', SJ: 'San Jose', SL: 'St. Louis', STL: 'St. Louis',
    TB: 'Tampa Bay', TOR: 'Toronto', VAN: 'Vancouver', WASH: 'Washington', WSH: 'Washington',
    WINN: 'Winnipeg', WPG: 'Winnipeg'
  };
  const CUES = {
    ADTITLE: 'Title', ADAWARDS: 'Awards', ADSUM: 'Summary', ADAFAN: 'Fanfare',
    ADROCK: 'Rock', ADROCKU: 'Rock (unused)', TITLE: 'Title (unused copy)',
    ROCKDITI: 'Rock ditty', SBROCKU: 'Sound Blaster rock', SLAPSHOT: 'Slapshot',
    CANADA: 'Canada', USA: 'USA', MTTITLE: 'Title (MT-32)', MTAWARDS: 'Awards (MT-32)',
    MTSUM: 'Summary (MT-32)', MTAFAN: 'Fanfare (MT-32)', MTROCKU: 'Rock (MT-32)',
    MT32HOCK: 'MT-32 hockey sysex'
  };

  let catalog = null;
  let files = new Map();
  let error = '';
  let loading = null;
  let onChange = null;
  let ctx = null;
  let live = null;
  let volume = 0.8;
  let gain = null;
  let panel = null;

  function make(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function labelOf(stem) {
    if (CUES[stem]) return CUES[stem];
    const m = /^([A-Z]+)(\d+)$/.exec(stem);
    if (m && TEAM[m[1]]) return TEAM[m[1]] + ' ' + m[2];
    return stem;
  }

  function groupOf(stem) {
    if (/^MT/.test(stem)) return 'Songs — MT-32';
    if (/^(AD|TITLE|ROCK|SB|SLAP|CANADA|USA)/.test(stem)) return CAT().songs;
    return 'Team songs';
  }

  function filesHost() {
    return root.NhlPc94Files || null;
  }

  async function readRel(rel) {
    if (!rel) return null;
    if (files.has(rel)) return files.get(rel);
    const host = filesHost();
    if (host && host.map && host.map.has(rel)) {
      files.set(rel, host.map.get(rel));
      return files.get(rel);
    }
    const base = (host && host.baseUrl) || '';
    const url = (root.assetUrl ? root.assetUrl : (p) => p)((base || '') + '/api/games/nhl94pc/file?path=' + encodeURIComponent(rel));
    const res = await fetch(typeof url === 'string' ? url : url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    files.set(rel, buf);
    return buf;
  }

  async function ensure() {
    if (catalog && (catalog.songs.length || catalog.samples.length)) return true;
    if (loading) return loading;
    loading = (async () => {
      error = '';
      const host = filesHost();
      let audio = host && host.catalog && host.catalog.audio;
      if (!audio) {
        try {
          const res = await fetch((host && host.baseUrl) || '/api/games');
          const games = res.ok ? await res.json() : [];
          const g = (games || []).find((x) => x.id === 'nhl94pc');
          audio = g && g.pcAudio;
        } catch (err) {
          audio = null;
        }
      }
      if (!audio || !audio.songs) {
        catalog = { songs: [], samples: [], note: 'Open a 94 PC folder (pc94/) to load .KMS / PCFF files.' };
        return true;
      }
      const songs = audio.songs.map((s) => ({
        id: 'song-' + s.stem,
        stem: s.stem,
        kms: s.kms,
        cfg: s.cfg,
        group: groupOf(s.stem),
        label: labelOf(s.stem),
        sub: s.stem + '.KMS' + (/^MT/.test(s.stem) ? ' · MT-32' : ' · AdLib')
      }));
      let samples = [];
      if (audio.dig && audio.tim && audio.tim.length) {
        const tim = await readRel(audio.tim.find((n) => /PCFF001/i.test(n)) || audio.tim[0]);
        const dig = await readRel(audio.dig);
        const pat = await readRel(audio.pat.find((n) => /PCFF001/i.test(n)) || '');
        if (tim && dig && root.NhlPc94Sfx) {
          samples = root.NhlPc94Sfx.listDigital(tim, dig, pat).map((s) => ({
            id: 'sfx-' + s.timbre,
            group: CAT().sfx,
            label: 'Timbre ' + s.timbre,
            sub: s.rate + ' Hz · ' + s.length + ' bytes' + (s.loop ? ' · loop' : '') +
              (s.programs.length ? ' · prog ' + s.programs.map((p) => p.program).join(',') : ''),
            sample: s
          }));
        }
      }
      catalog = { songs: songs, samples: samples, audio: audio };
      return true;
    })().catch((err) => {
      error = err && err.message ? err.message : String(err);
      loading = null;
      throw err;
    });
    return loading;
  }

  function entries() {
    if (!catalog) return [];
    const out = [];
    for (const s of catalog.songs) out.push(s);
    for (const s of catalog.samples) out.push(s);
    return out;
  }

  function title(id) {
    const e = entries().find((x) => x.id === id);
    return e ? e.label : id;
  }

  function reset() {
    stop();
    catalog = null;
    files = new Map();
    loading = null;
    error = '';
  }

  function stop() {
    if (live && live.source) {
      try { live.source.stop(); } catch (err) { /* already stopped */ }
    }
    live = null;
    if (onChange) onChange();
  }

  function audioCtx() {
    if (ctx) return ctx;
    const AC = root.AudioContext || root.webkitAudioContext;
    ctx = new AC();
    gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
    return ctx;
  }

  function playBuffer(id, float32, rate) {
    const ac = audioCtx();
    const buf = ac.createBuffer(1, float32.length, rate);
    buf.getChannelData(0).set(float32);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    src.onended = () => { if (live && live.id === id) { live = null; if (onChange) onChange(); } };
    src.start();
    live = { id: id, source: src };
    if (onChange) onChange();
  }

  async function play(id) {
    stop();
    await ensure();
    if (id.startsWith('sfx-')) {
      const rec = catalog.samples.find((s) => s.id === id);
      if (!rec) throw new Error('Unknown sample');
      const rendered = root.NhlPc94Player.renderSfx(rec.sample, rec.sample.loop ? { seconds: 2 } : {});
      playBuffer(id, rendered.float, rendered.rate);
      return;
    }
    if (!id.startsWith('song-')) return;
    const rec = catalog.songs.find((s) => s.id === id);
    if (!rec) throw new Error('Unknown song');
    const kms = await readRel(rec.kms);
    const cfg = rec.cfg ? await readRel(rec.cfg) : null;
    if (!kms) throw new Error(rec.stem + '.KMS not found');
    const parsed = root.NhlPc94Kms.parse(kms, cfg);
    const audio = catalog.audio || {};
    const patRel = (audio.pat || []).find((n) => /PCFF004/i.test(n)) || (audio.pat || [])[0];
    const timMap = {};
    for (const rel of audio.tim || []) {
      const buf = await readRel(rel);
      if (!buf) continue;
      const loaded = root.NhlPc94Sfx.loadTim(buf);
      const m = /PCFF(\d+)/i.exec(rel);
      const bank = m ? Number(m[1]) : 0;
      timMap[bank] = loaded.timbres;
    }
    const pat = patRel ? await readRel(patRel) : null;
    const pcm = root.NhlPc94Player.renderSong(parsed, {
      seconds: 12,
      loops: 1,
      pat: pat,
      timbres: timMap
    });
    const f32 = new Float32Array(pcm.length / 2);
    for (let i = 0; i < f32.length; i++) f32[i] = pcm[i * 2] / 32768;
    playBuffer(id, f32, root.NhlPc94Player.RATE);
  }

  async function toggle(id) {
    if (live && live.id === id) { stop(); return; }
    await play(id);
  }

  function renderPanel(box, id) {
    panel = box;
    box.replaceChildren();
    box.dataset.item = id;
    if (!catalog) {
      box.appendChild(make('p', 'st-note', error || 'Loading NHL 94 PC audio…'));
      return;
    }
    const rec = entries().find((e) => e.id === id);
    box.appendChild(make('p', 'st-kind', id.startsWith('sfx-') ? 'NHL 94 PC digital SFX' : 'NHL 94 PC AdLib song'));
    box.appendChild(make('h3', null, rec ? rec.label : id));
    if (rec && rec.sub) box.appendChild(make('p', 'st-note mono', rec.sub));
    if (id.startsWith('song-') && rec && /^MT/.test(rec.stem)) {
      box.appendChild(make('p', 'st-note', 'This file is the Roland MT-32 version. Play still uses the AdLib (YM3812) path, so it will not match the MT-32.'));
    }
    box.appendChild(make('p', 'st-note', id.startsWith('sfx-')
      ? 'Signed 8-bit PCM from PCFF001.DIG, as NHL94PC docs/SFX_FORMAT.md. Index FF is not used; the driver XOR-flips for the Sound Blaster DAC.'
      : 'Sequencer from HOCKEY.EXE (KMS/CFG). FM patches from PCFF004.PAT + PCFF000/002.TIM through the MIT OPL3 core. Not a YM30.BGP unicorn capture — ear match is still open.'));
    const controls = make('div', 'st-controls');
    const btn = make('button', 'ghost-btn st-toggle', live && live.id === id ? '■ Stop' : '▶ Play');
    btn.type = 'button';
    btn.id = 'sound-test-toggle';
    btn.addEventListener('click', () => {
      toggle(id).catch((err) => {
        const st = box.querySelector('.st-status');
        if (st) st.textContent = 'Playback failed: ' + (err && err.message ? err.message : String(err));
      });
    });
    const vol = make('label', 'st-volume');
    vol.appendChild(make('span', null, 'Volume'));
    const range = make('input');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.value = String(Math.round(volume * 100));
    range.addEventListener('input', () => {
      volume = Number(range.value) / 100;
      if (gain) gain.gain.value = volume;
    });
    vol.appendChild(range);
    controls.append(btn, vol);
    box.appendChild(controls);
    box.appendChild(make('p', 'st-status', catalog.note || ''));
  }

  function metaRows(id) {
    const rec = entries().find((e) => e.id === id);
    const rows = [['Plays', rec ? rec.label : id]];
    if (id.startsWith('sfx-') && rec && rec.sample) {
      rows.push(['Timbre', String(rec.sample.timbre)]);
      rows.push(['Rate', rec.sample.rate + ' Hz']);
      rows.push(['Length', rec.sample.length + ' bytes']);
      rows.push(['Path', 'PCFF001.TIM / .DIG → signed 8-bit PCM']);
    } else {
      rows.push(['Path', '.KMS + .CFG sequencer → OPL2 (AdLib)']);
      rows.push(['Source', 'NHL94PC docs/MUSIC_FORMAT.md']);
    }
    rows.push(['Notes', 'docs/PC-AUDIO-KMS-VIV.md']);
    return rows;
  }

  root.NhlSoundTestPc94 = {
    setGame() {},
    reset,
    ensure,
    entries,
    renderPanel,
    metaRows,
    play,
    stop,
    toggle,
    get playing() { return !!live; },
    get playingId() { return live ? live.id : ''; },
    get ready() { return !!catalog; },
    get error() { return error; },
    set onChange(fn) { onChange = typeof fn === 'function' ? fn : null; }
  };
})(typeof self !== 'undefined' ? self : this);
