/**
 * NHLPA Hockey '93 (SNES) sound test helpers: load the extracted pack, list the songs, crowd noises and effects,
 * and drive NhlNhl93sPlayer for live 32 kHz playback in sound-test-view.js. The same surface as public/sound-test-snes.js
 * (NHL '94), so the view treats both SNES games alike.
 */
(function (root) {
  'use strict';

  const RATE = 32000;
  const FRAME_RATE = 60.0988;
  const Player = () => root.NhlNhl93sPlayer;
  const SD = () => root.NhlNhl93sSoundData;
  const START_LAG = 0.09; // the first note sounds this long after the cue reaches the sound program

  const hex = (n) => '$' + n.toString(16).toUpperCase().padStart(2, '0');

  function displaySongName(name) {
    return name;
  }

  function songInfo(data, cue) {
    return data.cueList.find((c) => c.cue === Number(cue));
  }

  const SONG_DESCRIPTIONS = {
    SngGoal: 'Home goal song', SngPeriodStart: 'Period start song', SngLateGame: 'Late game song, once in the third period',
    SngPP: 'Power play song', SngFaceoff: 'Face-off song, once per period', SngTitle: 'Title song, also the game menu',
    SngEOP: 'End of Period song', SngEOG: 'End of Game song', SngPO: 'Playoffs music'
  };
  /** Songs the game never plays: shown as 'SngEOP (unused)' in the list. */
  const UNUSED_SONGS = new Set(['SngPP', 'SngEOP', 'SngEOG']);
  /** Extra SFX notes (recording swaps, check match, retail key-off timing). Names stay from ram93s.asm. */
  const SFX_NOTES = {
    0x8d: 'forehand shot cue (93S doshot, as 92) · recording is 92 sam_pass1, the light pass shot; 93G kept only its first 500 bytes as its backhand (sfx_shotbh_pcm)',
    0x8e: 'backhand shot cue (93S doshot, as 92) · recording is 92 sam_pass2, the beefier pass shot (92 backhand); it starts like the 92/93G slap (sfx_shotfh_pcm) but is a different take',
    0x90: '93G check1 (sfx_check_pcm / skating34) · correlation ~0.92 vs rendered sample (high confidence)',
    0x91: '93G check recording (shortened); retail driver keys off ~0.59 s (not a studio bug)'
  };
  /** The 93G sound a 93S effect name corresponds to ('93G $1C check1'), or ''. */
  const TWIN_93G = {
    whistle: 'whistle', crowdcheer: 'crowdcheer', crowdboo: 'crowdboo', oooh2: 'oooh2', bglass: 'bglass', shotfh: 'shotfh1', shotbh: 'shotbh1', shothard: 'shotfh1',
    puckbody: 'puckbody', check: 'check1', check2: 'check2', hithigh: 'hithigh', hitlow: 'hitlow', puckpost: 'puckpost', puckwall1: 'puckwall1', puckwall2: 'puckwall2',
    puckwall3: 'puckwall3', shotwiff: 'shotwiff', shotwiff2: 'shotwiff', shotwiff3: 'shotwiff', shotwiff4: 'shotwiff', stop: 'beep1', stop2: 'beep2',
    playerwall: 'playerwall', playerwall2: 'playerwall2', siren: 'siren', horn: 'horn'
  };
  function twin93g(name) {
    const N = root.Nhl93Names;
    if (!name || !N) return '';
    const first = String(name).split(' / ')[0];
    const label = TWIN_93G[first];
    const id = label ? N.SFX.findIndex((e) => e[0] === label) : -1;
    return id < 0 ? '' : '93G $' + id.toString(16).toUpperCase() + ' ' + label;
  }
  const CAT = () => root.NhlAudioCategories.CATEGORY;
  const hex2 = (n) => '$' + n.toString(16).toUpperCase().padStart(2, '0');
  const setOfInstrument = (n) => (n <= 9 ? 'boot' : 'game');
  const isPart = (id) => /^snes-inst-/.test(id);
  const isInvalidInstrument = (inst) => inst === 9;

  /**
   * Catalog rows for the Sound test list: Songs, SFX, Samples and Instruments, the same headings every game uses.
   * Samples lists every BRR sample of both sets (game set by its GameSampleDir label); Instruments keeps only the rows
   * that are more than their sample (keepInstrument).
   */
  function entries(data) {
    const out = [];
    // One song list, sorted by song number: the title and menu songs are in it with the game ones.
    const songs = data.cueList.slice().sort((a, b) => a.cue - b.cue);
    for (const c of songs) {
      out.push({
        id: 'song-' + c.cue,
        group: CAT().songs,
        label: c.cue + ' · ' + c.name + (UNUSED_SONGS.has(c.name) ? ' (unused)' : ''),
        sub: (SONG_DESCRIPTIONS[c.name] || c.note) + ' · ' + c.set + ' samples'
      });
    }
    for (let level = 1; level <= 7; level++) {
      out.push({ id: 'sound-game-' + (0x80 + level), group: CAT().sfx, label: hex2(0x80 + level) + ' · crowd' + level + (level === 7 ? ' (same as crowd6)' : ''), sub: 'crowd noise level ' + level + ' · loops until Stop' });
    }
    for (const id of data.effectIds) {
      if (id <= 0x87) continue;
      const name = data.effectName(id);
      const twin = twin93g(name);
      out.push({
        id: 'sound-game-' + id, group: CAT().sfx, label: hex2(id) + (name ? ' · ' + name : ''),
        sub: [id === 0x88 ? 'crowd noise off' : null, SFX_NOTES[id], twin, data.effect(id).loops ? 'loops until Stop' : null].filter(Boolean).join(' · ') || 'cue ' + hex2(id)
      });
    }
    for (const set of ['game', 'boot']) {
      for (const e of data.samples(set)) {
        out.push({ id: 'snes-sample-' + set + '-' + e.index, group: CAT().samples, label: sampleLabel(data, set, e.index), sub: sampleSub(data, set, e) });
      }
    }
    for (const i of data.instruments) {
      if (!keepInstrument(i)) continue;
      const set = setOfInstrument(i.index);
      const samp = data.samples(set).find((e) => e.index === i.sample);
      const invalid = isInvalidInstrument(i.index);
      const brr = samp ? ' · BRR ' + samp.length + ' bytes' + (samp.loops ? ' · loops' : '') : '';
      out.push({
        id: 'snes-inst-' + i.index, group: CAT().instruments, collapsible: true,
        label: hex2(i.index) + (invalid ? ' · invalid' : ''),
        sub: [set + ' set · sample ' + hex2(i.sample) + brr, !invalid ? 'envelope ADSR ' + hex2(i.adsr1) + ' ' + hex2(i.adsr2) + ' differs from the Samples row' : null, invalid ? 'sample $9A is out of range (unused table row)' : null, gmOf(data, i.index) ? gmOf(data, i.index).text : null].filter(Boolean).join(' · ')
      });
    }
    return out;
  }

  const isSample = (id) => /^snes-sample-(game|boot)-\d+$/.test(id);
  /** { set, n, entry } of a Samples row, or null. */
  function sampleOf(data, id) {
    const m = /^snes-sample-(game|boot)-(\d+)$/.exec(id);
    if (!m) return null;
    const entry = data.samples(m[1]).find((e) => e.index === Number(m[2]));
    return entry ? { set: m[1], n: entry.index, entry } : null;
  }
  /** The instruments of a set that play sample n. */
  function instrumentsOf(data, set, n) {
    return data.instruments.filter((i) => !isInvalidInstrument(i.index) && setOfInstrument(i.index) === set && i.sample === n);
  }
  function sampleUsers(data, set, n) {
    const list = instrumentsOf(data, set, n).map((i) => hex2(i.index));
    return list.length ? 'instrument ' + list.join(', ') : 'no instrument';
  }
  /** What the disassembly says a game sample is for, beyond its name (samples $11 and $12 are music). */
  const SAMPLE_NOTES = { 0x11: 'music: fanfare lead (songs 4-8)', 0x12: 'music: fanfare drum (songs 4-7)' };
  function sampleLabel(data, set, n) {
    const e = data.samples(set).find((x) => x.index === n);
    return hex2(n) + ' · ' + (e && e.name ? e.name : set + ' sample ' + hex2(n));
  }
  function sampleSub(data, set, e) {
    const inst = instrumentsOf(data, set, e.index)[0];
    const gm = inst ? gmOf(data, inst.index) : null;
    return [set + ' set', set === 'game' ? SAMPLE_NOTES[e.index] : null, 'BRR ' + e.length + ' bytes (' + e.length / 9 + ' blocks)',
      e.loops ? 'loops from block ' + e.loopBlock : 'one shot', sampleUsers(data, set, e.index), gm ? gm.text : null].filter(Boolean).join(' · ');
  }
  /** The envelope every Samples row plays with: the one nearly all instruments use (ADSR $8F $E0, gain $B8). */
  const STD_ENV = { adsr1: 0x8f, adsr2: 0xe0, gain: 0xb8 };
  /**
   * An instrument row stays in Instruments only when it is more than its sample: $09 (the crowd-noise row, pending
   * cleanup) and any instrument whose envelope differs from STD_ENV, which a Samples row would not reproduce.
   */
  function keepInstrument(i) {
    return isInvalidInstrument(i.index) || i.adsr1 !== STD_ENV.adsr1 || i.adsr2 !== STD_ENV.adsr2 || i.gain !== STD_ENV.gain;
  }
  const SAMPLE_LOOP_SECONDS = 2; // a looping sample sounds this long, then is keyed off
  /**
   * One BRR sample decoded on the S-DSP voice model at its native rate (pitch $1000 = 32 kHz, one BRR sample per output
   * sample), with the loop the directory gives. Returns interleaved stereo Int16 at RATE.
   */
  function renderSample(data, set, n) {
    const e = data.samples(set).find((x) => x.index === n);
    if (!e) throw new Error('No ' + set + ' sample ' + hex2(n));
    const Dsp = root.NhlSnesDsp;
    const oneShot = (e.length / 9) * 16;
    const keyOffAt = e.loops ? Math.round(SAMPLE_LOOP_SECONDS * RATE) : oneShot + 64;
    const r = Dsp.renderVoice({ brr: e.brr, loopBlock: e.loops ? e.loopBlock : 0, pitch: 0x1000, adsr1: STD_ENV.adsr1, adsr2: STD_ENV.adsr2, gain: STD_ENV.gain,
      volL: 0x7f, volR: 0x7f, keyOffAt, samples: keyOffAt + Math.round(0.1 * RATE) });
    return r.samples;
  }
  /** A session that plays one rendered sample (no sound program runs), with the same pull/heardSeconds surface. */
  function startSampleSession(data, set, n) {
    const session = { player: null, sample: { set, n }, data, commands: [], chunks: [], offset: 0, queued: 0, done: true, frames: 0, blocks: [] };
    appendPcm(session, renderSample(data, set, n));
    return session;
  }

  /** The GM instrument an instrument is mapped to (data/audio/nhl93s-gm-map.json): { text, why, confidence, runnerUp } or null. */
  function gmOf(data, inst) {
    const map = data && data.gmMap;
    const M = root.NhlSnesGmMap;
    if (!map || !M || inst == null) return null;
    return M.describeEntry(map, setOfInstrument(inst), inst);
  }

  /** The instrument a catalog row plays. */
  function partInstrument(data, id) {
    const m = /^snes-inst-(\d+)$/.exec(id);
    if (!m) return null;
    const inst = Number(m[1]);
    if (isInvalidInstrument(inst)) return null;
    return inst;
  }

  /** A one-note song of an instrument, as { set, bytes, base } for startSession: the way the analysis plays a probe note. */
  function probeSong(data, instrument) {
    const M = root.NhlNhl93sMidi;
    const C = SD().CMD;
    const set = setOfInstrument(instrument);
    const midi = (data.probeMidi && data.probeMidi[instrument]) || 60;
    const length = 70; // about 0.6 s at tempo 60
    const ch = [
      { tick: 0, type: 'command', code: C.TEMPO, params: [60] },
      { tick: 0, type: 'command', code: C.MASTER_VOLUME, params: [0xb4] },
      { tick: 0, type: 'command', code: C.VOLUME, params: [0xff] },
      { tick: 0, type: 'command', code: C.PAN, params: [0x7f] },
      { tick: 0, type: 'command', code: C.INSTRUMENT, params: [instrument] },
      { tick: 0, type: 'note', key: Math.max(0, Math.min(0x47, midi - 12)), length, velocity: 15 }
    ];
    const built = M.buildSong({ set, loop: false, channels: [{ events: ch }, {}, {}, {}, {}, {}, {}, {}], end: length + 62 }, M.BASE[set]);
    return { set, bytes: built.bytes, base: built.base };
  }

  const passCache = new Map();
  /** One pass length in seconds and whether the order list loops. */
  function passInfo(data, name) {
    const key = String(name);
    if (!passCache.has(key)) {
      const tl = data.timeline(Number(name), { loops: 0 });
      passCache.set(key, { total: data.secondsAt(tl.tempoTrack, tl.ticks), loopStart: 0, loops: tl.looped || tl.loopTick != null });
    }
    return passCache.get(key);
  }

  async function loadPack() {
    const res = await fetch(new URL('data/audio/nhl93s-sound.json', document.baseURI).href);
    if (!res.ok) throw new Error('NHL 93 SNES sound pack missing (' + res.status + ')');
    const data = SD().load(await res.json());
    try {
      const gm = await fetch(new URL('data/audio/nhl93s-gm-map.json', document.baseURI).href);
      data.gmMap = gm.ok ? await gm.json() : null;
    } catch (err) { data.gmMap = null; }
    // The key each instrument is played at for its probe note: the median the retail songs use it at.
    try {
      const an = await fetch(new URL('data/audio/nhl93s-instrument-analysis.json', document.baseURI).href);
      const sets = an.ok ? (await an.json()).sets : null;
      data.probeMidi = {};
      if (sets) for (const set of Object.keys(sets)) for (const n of Object.keys(sets[set])) data.probeMidi[n] = sets[set][n].probeMidi;
    } catch (err) { data.probeMidi = {}; }
    return data;
  }

  /** The key-on list the sequencer view draws, from the song's timeline (frame of each note start, voice = channel). */
  function commandsOf(data, timeline) {
    const out = [];
    for (const e of timeline.events) {
      if (e.type !== 'note' && e.type !== 'percussion') continue;
      const sec = data.secondsAt(timeline.tempoTrack, e.tick) + START_LAG;
      const args = { voice: e.ch, sample: e.instrument, inst: e.instrument };
      if (e.type === 'note' && e.midi != null) args.midi = e.midi;
      const len = e.length != null ? e.length : e.duration;
      if (len) args.frames = Math.round((data.secondsAt(timeline.tempoTrack, e.tick + len) - data.secondsAt(timeline.tempoTrack, e.tick)) * FRAME_RATE);
      out.push({ frame: Math.round(sec * FRAME_RATE), name: 'keyOn', args });
    }
    return out;
  }

  /** A song (cue number as songName), one sound ({ set, n }) or an imported song ({ set, bytes, base }) on a fresh sound unit. */
  function startSession(data, songName, sound, custom) {
    const player = Player().create({ data });
    let commands = [];
    if (custom) {
      player.playCustom(custom.set, custom.bytes, custom.base);
      try {
        commands = commandsOf(data, data.timeline(7, { loops: 0, ram: data.customImage(custom.set, custom.bytes, custom.base, 7) }));
      } catch (err) { commands = []; }
    } else if (sound) {
      player.effect(sound.n);
      const SfxMidi = root.NhlSnesSfxMidi;
      if (SfxMidi && SfxMidi.capture && SfxMidi.notesToRollCommands) {
        const cap = Player().create({ data });
        cap.loadSet('game');
        let queued = false;
        const notes = SfxMidi.capture(cap.spc, () => {
          if (!queued) { cap.effect(sound.n); queued = true; }
          cap.runFrame();
        }, { maxFrames: 700, minFrames: 10, done: () => cap.idle() });
        commands = SfxMidi.notesToRollCommands(notes, FRAME_RATE, START_LAG);
      }
    } else {
      player.cue(Number(songName));
      commands = commandsOf(data, data.timeline(Number(songName), { loops: 0 }));
    }
    player.record();
    return {
      player,
      sound: sound || null,
      custom: custom || null,
      songName,
      data,
      commands,
      chunks: [],
      offset: 0,
      queued: 0,
      done: false,
      frames: 0,
      blocks: []
    };
  }

  function appendPcm(session, interleaved) {
    if (!interleaved.length) return;
    const n = interleaved.length / 2;
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++) {
      L[i] = interleaved[j++] / 32768;
      R[i] = interleaved[j++] / 32768;
    }
    session.chunks.push([L, R]);
    session.queued += n;
  }

  /** Run the player until at least `n` stereo samples are queued (or the sound ends), at most `maxFrames` video frames. */
  function fill(session, n, maxFrames) {
    const p = session.player;
    let frames = maxFrames || Infinity;
    while (session.queued < n && !session.done && frames-- > 0) {
      p.runFrame();
      session.frames = p.stats.frames;
      appendPcm(session, p.spc.drainRecording());
      if (session.sound) {
        const id = session.sound.n;
        const looping = id >= 0x81 && id <= 0x87;
        if (!looping && ((p.idle() && session.frames > 20) || session.frames > 1500)) session.done = true;
      } else if (!p.musicOn && session.frames > 20 && p.idle()) session.done = true;
    }
  }

  function pull(session, n) {
    fill(session, n);
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    let at = 0;
    while (at < n && session.chunks.length) {
      const [L, R] = session.chunks[0];
      const k = Math.min(n - at, L.length - session.offset);
      left.set(L.subarray(session.offset, session.offset + k), at);
      right.set(R.subarray(session.offset, session.offset + k), at);
      at += k;
      session.offset += k;
      session.queued -= k;
      if (session.offset === L.length) {
        session.chunks.shift();
        session.offset = 0;
      }
    }
    session.delivered = (session.delivered || 0) + at;
    return { left, right };
  }

  function heardSeconds(session) {
    return Math.max(0, ((session.delivered || 0) - session.queued) / RATE);
  }

  function trackDelivered(session, n) {
    session.delivered = (session.delivered || 0) + n;
  }

  function dispose(session) {
    if (!session.player) return;
    try { session.player.spc.stopRecording(); } catch (err) { /* noop */ }
  }

  root.NhlSoundTestSnes93 = {
    RATE,
    displaySongName,
    songInfo,
    entries,
    isPart,
    isSample,
    sampleOf,
    sampleUsers,
    sampleLabel,
    keepInstrument,
    STD_ENV,
    renderSample,
    startSampleSession,
    isInvalidInstrument,
    partInstrument,
    gmOf,
    probeSong,
    setOfInstrument,
    passInfo,
    loadPack,
    startSession,
    pull,
    fill,
    heardSeconds,
    trackDelivered,
    dispose,
    frameRate: () => FRAME_RATE
  };
})(typeof self !== 'undefined' ? self : this);
