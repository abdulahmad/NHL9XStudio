/**
 * NHL 94 / 95 PC Audio tab: AdLib .KMS/.CFG songs, PCFF digital samples,
 * VIV speech, and (95) IFF desk music (FORM 8SVX or RIFF XOR 0x80).
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
    WINN: 'Winnipeg', WPG: 'Winnipeg', ANA: 'Anaheim', FLA: 'Florida', MIN: 'Minnesota', DAL: 'Dallas',
    ASE: 'All-Star East', ASW: 'All-Star West'
  };
  const CUES = {
    ADTITLE: 'Title', ADAWARDS: 'Awards', ADSUM: 'Summary', ADAFAN: 'Fanfare',
    ADROCK: 'Rock', ADROCKU: 'Rock (unused)', TITLE: 'Title (unused copy)',
    ROCKDITI: 'Rock ditty', SBROCKU: 'Sound Blaster rock', SLAPSHOT: 'Slapshot',
    CANADA: 'Canada', USA: 'USA', MTTITLE: 'Title (MT-32)', MTAWARDS: 'Awards (MT-32)',
    MTSUM: 'Summary (MT-32)', MTAFAN: 'Fanfare (MT-32)', MTROCKU: 'Rock (MT-32)',
    MT32HOCK: 'MT-32 hockey sysex'
  };

  let gameId = 'nhl94pc';
  let catalog = null;
  let files = new Map();
  let error = '';
  let loading = null;
  let onChange = null;
  let ctx = null;
  let live = null;
  let volume = 0.8;
  let gain = null;
  let analyser = null;
  let panel = null;
  let vizRaf = 0;
  const OPL_COLORS = ['#f0b429', '#4cc9f0', '#8fd0a8', '#ff7a90', '#b69cff', '#ff9f5a', '#7ad0ff', '#e0c36e', '#c9a0dc'];

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
    return root.NhlPcAudioFiles || root.NhlPc94Files || null;
  }

  function gameOf() {
    const host = filesHost();
    return (host && host.gameId) || gameId || 'nhl94pc';
  }

  function is95() {
    return gameOf() === 'nhl95pc';
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
    const url = (root.assetUrl ? root.assetUrl : (p) => p)((base || '') + '/api/games/' + gameOf() + '/file?path=' + encodeURIComponent(rel));
    const res = await fetch(typeof url === 'string' ? url : url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    files.set(rel, buf);
    return buf;
  }

  async function ensure() {
    if (catalog && (catalog.songs.length || catalog.samples.length || (catalog.speech && catalog.speech.length) || (catalog.digital && catalog.digital.length))) return true;
    if (loading) return loading;
    loading = (async () => {
      error = '';
      const host = filesHost();
      let audio = host && host.catalog && host.catalog.audio;
      if (!audio) {
        try {
          const res = await fetch((host && host.baseUrl) || '/api/games');
          const games = res.ok ? await res.json() : [];
          const g = (games || []).find((x) => x.id === gameOf());
          audio = g && g.pcAudio;
        } catch (err) {
          audio = null;
        }
      }
      if (!audio || !audio.songs) {
        catalog = { songs: [], samples: [], speech: [], note: is95()
          ? 'Open a 95 PC folder (pc95/) to load .KMS / PCFF / .VIV / .IFF files.'
          : 'Open a 94 PC folder (pc94/) to load .KMS / PCFF / .VIV files.' };
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
      const speech = [];
      const digital = [];
      if (root.NhlViv && audio.extra && audio.extra.length) {
        for (const rel of audio.extra) {
          if (!/\.viv$/i.test(rel)) continue;
          const buf = await readRel(rel);
          if (!buf) continue;
          const packName = String(rel).split(/[\\/]/).pop();
          const clips = root.NhlViv.listClips(buf, { delta: is95() });
          for (const c of clips) {
            speech.push({
              id: 'speech-' + packName + '-' + c.name,
              group: 'Speech',
              label: c.label,
              sub: packName + ' · ' + c.name + ' · ' + c.rate + ' Hz · ' + c.length + ' bytes',
              clip: c
            });
          }
        }
        for (const rel of audio.extra) {
          if (!/\.iff$/i.test(rel)) continue;
          const buf = await readRel(rel);
          if (!buf || !root.NhlViv.decodeIff) continue;
          const clip = root.NhlViv.decodeIff(buf);
          if (!clip || !clip.pcm.length) continue;
          const packName = String(rel).split(/[\\/]/).pop();
          const kind = clip.kind === 'riff' ? 'IFF RIFF (XOR 80h, 16-bit)' : 'IFF FORM 8SVX';
          digital.push({
            id: 'iff-' + packName,
            group: 'Desk music',
            label: packName.replace(/\.[^.]+$/, ''),
            sub: packName + ' · ' + kind + ' · ' + clip.rate + ' Hz · ' + clip.length + ' bytes',
            clip: { name: packName, pcm: clip.pcm, rate: clip.rate, length: clip.length }
          });
        }
      }
      catalog = { songs: songs, digital: digital, samples: samples, speech: speech, audio: audio };
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
    for (const s of catalog.digital || []) out.push(s);
    for (const s of catalog.samples) out.push(s);
    for (const s of catalog.speech || []) out.push(s);
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
    if (vizRaf) { cancelAnimationFrame(vizRaf); vizRaf = 0; }
    if (live && live.source) {
      try { live.source.stop(); } catch (err) { /* already stopped */ }
    }
    live = null;
    if (onChange) onChange();
    drawViz();
  }

  function audioCtx() {
    if (ctx) return ctx;
    const AC = root.AudioContext || root.webkitAudioContext;
    ctx = new AC();
    gain = ctx.createGain();
    gain.gain.value = volume;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.55;
    analyser.connect(gain);
    gain.connect(ctx.destination);
    return ctx;
  }

  function playBuffer(id, float32, rate, viz) {
    const ac = audioCtx();
    const buf = ac.createBuffer(1, float32.length, rate);
    buf.getChannelData(0).set(float32);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(analyser);
    src.onended = () => { if (live && live.id === id) { live = null; if (onChange) onChange(); } };
    src.start();
    live = {
      id: id,
      source: src,
      started: ac.currentTime,
      duration: float32.length / rate,
      events: (viz && viz.events) || [],
      ticks: (viz && viz.ticks) || 0,
      tickHz: 100
    };
    if (onChange) onChange();
    drawViz();
  }

  function voiceOf(midiCh) {
    if (midiCh === 9) return 8;
    return midiCh % 9;
  }

  function theme() {
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
    return {
      bg: v('--bg', '#101418'),
      panel: v('--raise', '#1a2129'),
      line: v('--line', '#33414d'),
      text: v('--text', '#e8eef3'),
      muted: v('--muted', '#8ea0b0'),
      amber: v('--amber', '#f0b429'),
      mono: v('--mono', 'ui-monospace, monospace')
    };
  }

  function noteSpans(events, atTick) {
    const notes = [];
    const hold = {};
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const st = e.msg[0], cmd = st & 0xf0, ch = voiceOf(st & 0x0f);
      if (cmd === 0x90 && e.msg[2]) hold[ch] = { tick: e.tick, note: e.msg[1], ch: ch };
      else if ((cmd === 0x80 || (cmd === 0x90 && !e.msg[2])) && hold[ch]) {
        notes.push({ ch: ch, note: hold[ch].note, start: hold[ch].tick, end: e.tick });
        delete hold[ch];
      }
    }
    Object.keys(hold).forEach((k) => {
      const h = hold[k];
      notes.push({ ch: h.ch, note: h.note, start: h.tick, end: Math.max(atTick, h.tick) + 4 });
    });
    return notes;
  }

  function clock(secs) {
    return Math.floor(secs / 60) + ':' + (secs % 60 < 10 ? '0' : '') + (secs % 60).toFixed(2);
  }

  function syncHud() {
    if (!panel) return;
    const bar = panel.querySelector('.st-bar');
    const timeEl = panel.querySelector('.st-time');
    const btn = panel.querySelector('#sound-test-toggle');
    const playing = !!(live && live.id === panel.dataset.item);
    if (btn) {
      btn.textContent = playing ? '■ Stop' : '▶ Play';
      btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    }
    if (!playing) {
      if (bar) bar.style.width = '0%';
      if (timeEl) timeEl.textContent = '0:00.00 / 0:00.00';
      return;
    }
    const t = Math.max(0, ctx.currentTime - live.started);
    const frac = live.duration ? Math.min(1, t / live.duration) : 0;
    if (bar) {
      bar.style.transition = 'none';
      bar.style.width = (frac * 100).toFixed(1) + '%';
    }
    if (timeEl) timeEl.textContent = clock(t) + ' / ' + clock(live.duration);
  }

  function sizeCanvas(canvas, cssH) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(240, Math.floor(canvas.clientWidth || 520));
    const h = Math.max(72, Math.floor(cssH));
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(h * dpr);
    }
    canvas.style.height = h + 'px';
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g: g, cssW: cssW, cssH: h };
  }

  function drawRoll(canvas, C) {
    const lanes = 9;
    const cssWGuess = canvas.clientWidth || 520;
    const laneH = cssWGuess < 460 ? 26 : 30;
    const axis = 16;
    const { g, cssW, cssH } = sizeCanvas(canvas, axis + lanes * (laneH + 2) + 2);
    const gutter = cssW < 460 ? 48 : 62;
    const x0 = gutter;
    const x1 = cssW - 4;
    g.fillStyle = C.bg;
    g.fillRect(0, 0, cssW, cssH);
    g.fillStyle = C.muted;
    g.font = '10px ' + C.mono;
    g.fillText('now →', x1 - 36, 11);
    for (let i = 0; i < lanes; i++) {
      const top = axis + i * (laneH + 2);
      g.fillStyle = C.panel;
      g.fillRect(x0, top, x1 - x0, laneH);
      g.strokeStyle = C.line;
      g.lineWidth = 1;
      g.strokeRect(x0 + 0.5, top + 0.5, x1 - x0 - 1, laneH - 1);
      g.font = '600 11px ' + C.mono;
      g.fillStyle = OPL_COLORS[i];
      g.fillText('OPL' + (i + 1), 6, top + 13);
      g.beginPath();
      g.arc(gutter - 9, top + 9, 3, 0, Math.PI * 2);
      g.strokeStyle = C.line;
      g.stroke();
      g.font = '11px ' + C.mono;
      g.fillStyle = C.muted;
      g.fillText('—', 6, top + laneH - 5);
    }
    const playing = !!(live && live.events && live.events.length && live.id === panel.dataset.item);
    if (!playing) {
      g.fillStyle = C.muted;
      g.font = '12px ' + C.mono;
      g.textAlign = 'center';
      g.fillText('Press Play to see what each channel does', (x0 + x1) / 2, axis + 4 * (laneH + 2) + laneH / 2 + 4);
      g.textAlign = 'left';
      return;
    }
    const t = Math.max(0, ctx.currentTime - live.started);
    const atTick = t * live.tickHz;
    const windowTicks = 6 * live.tickHz;
    const t0 = atTick - windowTicks;
    const notes = noteSpans(live.events, atTick);
    const sounding = {};
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.end < t0 || n.start > atTick) continue;
      const xA = x0 + ((n.start - t0) / windowTicks) * (x1 - x0);
      const xB = x0 + ((Math.min(n.end, atTick) - t0) / windowTicks) * (x1 - x0);
      const nn = Math.max(24, Math.min(96, n.note));
      const top = axis + n.ch * (laneH + 2);
      const ny = top + 4 + (1 - (nn - 24) / 72) * (laneH - 10);
      g.fillStyle = OPL_COLORS[n.ch];
      g.fillRect(Math.max(x0, xA), ny, Math.max(2, xB - xA), 4);
      if (n.start <= atTick && n.end > atTick) sounding[n.ch] = n.note;
    }
    for (let i = 0; i < lanes; i++) {
      if (sounding[i] == null) continue;
      const top = axis + i * (laneH + 2);
      g.fillStyle = C.text;
      g.font = '11px ' + C.mono;
      g.fillText(String(sounding[i]), 6, top + laneH - 5);
      g.beginPath();
      g.arc(gutter - 9, top + 9, 3, 0, Math.PI * 2);
      g.fillStyle = OPL_COLORS[i];
      g.fill();
    }
    g.fillStyle = C.amber;
    g.fillRect(x1 - 1.5, axis - 3, 1.5, cssH - axis + 1);
  }

  function drawWave(canvas, C) {
    const { g, cssW, cssH } = sizeCanvas(canvas, 88);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, cssW, cssH);
    const playing = !!(live && analyser && live.id === panel.dataset.item);
    if (!playing) {
      g.fillStyle = C.muted;
      g.font = '12px ' + C.mono;
      g.textAlign = 'center';
      g.fillText('Press Play to see the waveform', cssW / 2, cssH / 2 + 4);
      g.textAlign = 'left';
      return;
    }
    const wave = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(wave);
    g.strokeStyle = C.amber;
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i < wave.length; i++) {
      const x = i / (wave.length - 1) * cssW;
      const y = (1 - wave[i] / 255) * (cssH - 8) + 4;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
  }

  function drawViz() {
    vizRaf = 0;
    if (!panel) return;
    syncHud();
    const canvas = panel.querySelector('.st-viz-canvas');
    if (!canvas) return;
    const C = theme();
    const item = panel.dataset.item || '';
    if (item.indexOf('song-') === 0) drawRoll(canvas, C);
    else drawWave(canvas, C);
    if (live) vizRaf = requestAnimationFrame(drawViz);
  }

  async function play(id) {
    stop();
    await ensure();
    if (id.startsWith('speech-') || id.startsWith('iff-')) {
      const rec = (catalog.speech || []).concat(catalog.digital || []).find((s) => s.id === id);
      if (!rec || !rec.clip) throw new Error('Unknown clip');
      playBuffer(id, root.NhlViv.toFloat32(rec.clip.pcm), rec.clip.rate);
      return;
    }
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
    playBuffer(id, f32, root.NhlPc94Player.RATE, { events: pcm.events || [], ticks: pcm.ticks || 0 });
  }

  async function toggle(id) {
    if (live && live.id === id) { stop(); return; }
    await play(id);
  }

  function renderPanel(box, id) {
    if (vizRaf) { cancelAnimationFrame(vizRaf); vizRaf = 0; }
    panel = box;
    box.replaceChildren();
    box.dataset.item = id;
    if (!catalog) {
      box.appendChild(make('p', 'st-note', error || 'Loading NHL 94 PC audio…'));
      return;
    }
    const rec = entries().find((e) => e.id === id);
    const title = is95() ? 'NHL 95 PC' : 'NHL 94 PC';
    const kind = id.startsWith('iff-')
      ? title + ' desk music (IFF)'
      : id.startsWith('speech-')
        ? title + ' announcer speech'
        : id.startsWith('sfx-') ? title + ' digital SFX' : title + ' AdLib song';
    box.appendChild(make('p', 'st-kind', kind));
    box.appendChild(make('h3', null, rec ? rec.label : id));
    if (rec && rec.sub) box.appendChild(make('p', 'st-note mono', rec.sub));
    if (id.startsWith('song-') && rec && /^MT/.test(rec.stem)) {
      box.appendChild(make('p', 'st-note', 'This file is the Roland MT-32 version. Play still uses the AdLib (YM3812) path, so it will not match the MT-32.'));
    }
    box.appendChild(make('p', 'st-note', id.startsWith('iff-')
      ? 'NHL95PC sub_8F98F load + sub_8FB8E 16-bit play. FORM 8SVX (VHDR rate, BODY, no XOR; Fibonacci-delta when sCompression is 1) or RIFF WAVE (rate at +0x18, XOR 80h, then 16-bit). 94 PC has no IFF. Desk music, not announcer speech.'
      : id.startsWith('speech-')
        ? (is95()
          ? 'OpenSpeechBank directory (count then offset/size/name). Packed clips start with G (47 FB); ReadSpeechSample unpacks then delta-decodes, dropping a 5-byte header. Played at 11025 Hz. XBRUCE2.VIV is Bruce.'
          : 'C0 FB directory, each clip BTree 47 FB then a 72 FB signed 8-bit PCM body. Names keep their suffixes (.BRU Bruce, .BAR Barr, .CTY city, .RNK rank). Played at 11025 Hz.')
        : id.startsWith('sfx-')
          ? 'Signed 8-bit PCM from PCFF001.DIG. Index FF is not used; the driver XOR-flips for the Sound Blaster DAC.'
          : 'EACSNDF sequencer from NHL95PC sub_990CB / sub_99925 (same library as NHL 94 PC). MIDI send adds 24 (HOCKEY.EXE 1844:022E). YM30 fnum table (block = note/12); PAT rec[7] transposes at note-on. FM patches from PCFF004.PAT + PCFF000/002.TIM through the MIT OPL3 core. Not a YM30.BGP unicorn capture — ear match is still open.'));
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
    const progress = make('div', 'st-progress');
    progress.appendChild(make('div', 'st-bar'));
    box.appendChild(progress);
    box.appendChild(make('p', 'st-time mono', '0:00.00 / 0:00.00'));
    const seq = make('div', 'st-seq');
    const head = make('div', 'st-seq-head');
    head.appendChild(make('span', 'st-seq-title', id.startsWith('song-') ? 'Channels' : 'Waveform'));
    seq.appendChild(head);
    const wrap = make('div', 'st-roll');
    const canvas = make('canvas', 'st-viz-canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', id.startsWith('song-')
      ? 'Piano roll of the nine YM3812 AdLib voices, newest at the right edge'
      : 'Waveform of the playing sample');
    wrap.appendChild(canvas);
    seq.appendChild(wrap);
    seq.appendChild(make('p', 'st-seq-note', id.startsWith('song-')
      ? 'Nine YM3812 (AdLib) voices from the EACSNDF sequencer, same piano roll as the Genesis Audio tab (right edge is now). PCM clips show the waveform only.'
      : 'Live waveform from the playing PCM (speech, IFF, or digital SFX).'));
    box.appendChild(seq);
    box.appendChild(make('p', 'st-status', catalog.note || ''));
    drawViz();
  }

  function metaRows(id) {
    const rec = entries().find((e) => e.id === id);
    const rows = [['Plays', rec ? rec.label : id]];
    if ((id.startsWith('speech-') || id.startsWith('iff-')) && rec && rec.clip) {
      rows.push(['File', rec.clip.name]);
      rows.push(['Rate', rec.clip.rate + ' Hz']);
      rows.push(['Length', rec.clip.length + ' bytes']);
      rows.push(['Path', id.startsWith('iff-') || /\.iff$/i.test(rec.clip.name)
        ? 'sub_8F98F FORM 8SVX / RIFF XOR 80h'
        : (is95()
          ? '.VIV OpenSpeechBank → 47/10 FB → ReadSpeechSample DPCM'
          : '.VIV C0 FB → BTree 47 FB → 72 FB signed PCM')]);
    } else if (id.startsWith('sfx-') && rec && rec.sample) {
      rows.push(['Timbre', String(rec.sample.timbre)]);
      rows.push(['Rate', rec.sample.rate + ' Hz']);
      rows.push(['Length', rec.sample.length + ' bytes']);
      rows.push(['Path', 'PCFF001.TIM / .DIG → signed 8-bit PCM']);
    } else {
      rows.push(['Path', '.KMS + .CFG sequencer → OPL2 (AdLib)']);
      rows.push(['Source', 'NHL95PC sub_990CB / sub_99925']);
    }
    rows.push(['Notes', 'docs/PC-AUDIO-KMS-VIV.md']);
    return rows;
  }

  root.NhlSoundTestPc94 = {
    setGame(id) { if (id) gameId = id; },
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
