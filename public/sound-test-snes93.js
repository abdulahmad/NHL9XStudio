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
  const SfxMidi = () => root.NhlSnesSfxMidi;
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
    SngPP: 'Power play song (unused)', SngFaceoff: 'Face-off song, once per period', SngTitle: 'Title song, also the game menu',
    SngEOP: 'End of Period song (unused)', SngEOG: 'End of Game song (unused)', SngPO: 'Playoffs music'
  };
  /** The 93G sound a 93S effect name corresponds to ('93G $1C check1'), or ''. */
  const TWIN_93G = {
    whistle: 'whistle', crowdcheer: 'crowdcheer', crowdboo: 'crowdboo', oooh2: 'oooh2', bglass: 'bglass', shotfh: 'shotfh1', shotbh: 'shotbh1', shothard: 'shotfh1',
    puckbody: 'puckbody', check: 'check1', check2: 'check2', hithigh: 'hithigh', hitlow: 'hitlow', puckpost: 'puckpost', puckwall1: 'puckwall1', puckwall2: 'puckwall2',
    puckwall3: 'puckwall3', shotwiff: 'shotwiff', shotwiff2: 'shotwiff', shotwiff3: 'shotwiff', shotwiff4: 'shotwiff', stop: 'beep1', stop2: 'beep2',
    playerwall: 'playerwall', playerwall2: 'playerwall2', siren: 'siren', horn: 'horn'
  };
  /** Extra UI notes for effects (names stay the SNES equates from ram93s.asm). */
  const SFX_EXTRA = {
    0x8d: 'forehand shot in SNES code; plays 93G backhand recording (sfx_shotbh_pcm)',
    0x8e: 'backhand shot in SNES code; plays 93G forehand/slap recording (sfx_shotfh_pcm, partial match)',
    0x90: 'check 1 of 2; vs 93G check PCM spectral match leans check2/hitboard (low confidence)',
    0x91: 'check 2 of 2; 93G check/skating34 recording, shortened; retail driver keys off ~0.59 s'
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

  function sampleCount(set) {
    return set === 'game' ? 19 : 9;
  }

  function instrumentInvalid(data, inst) {
    const i = data.instruments[inst];
    if (!i) return true;
    const set = setOfInstrument(inst);
    return i.sample < 0 || i.sample >= sampleCount(set);
  }

  function sampleOfInstrument(data, inst) {
    const i = data.instruments[inst];
    if (!i || instrumentInvalid(data, inst)) return null;
    return data.samples(setOfInstrument(inst)).find((s) => s.index === i.sample);
  }

  /** Catalog rows for the Sound test list: Songs, SFX, and Instruments (one row per instrument; sample BRR info is on the row). */
  function entries(data) {
    const out = [];
    const songs = data.cueList.slice().sort((a, b) => a.cue - b.cue);
    for (const c of songs) {
      out.push({
        id: 'song-' + c.cue,
        group: CAT().songs,
        label: c.cue + ' · ' + c.name,
        sub: (SONG_DESCRIPTIONS[c.name] || c.note) + ' · ' + c.set + ' samples'
      });
    }
    for (let level = 1; level <= 7; level++) {
      out.push({ id: 'sound-game-' + (0x80 + level), group: CAT().sfx, label: hex2(0x80 + level) + ' · crowd' + level, sub: 'crowd noise level ' + level + ' · loops until Stop' });
    }
    for (const id of data.effectIds) {
      if (id <= 0x87) continue;
      const name = data.effectName(id);
      const twin = twin93g(name);
      const extra = SFX_EXTRA[id];
      out.push({
        id: 'sound-game-' + id, group: CAT().sfx, label: hex2(id) + (name ? ' · ' + name : ''),
        sub: [id === 0x88 ? 'crowd noise off' : null, extra, twin, data.effect(id).loops ? 'loops until Stop' : null].filter(Boolean).join(' · ') || 'cue ' + hex2(id)
      });
    }
    for (const i of data.instruments) {
      const invalid = instrumentInvalid(data, i.index);
      const samp = invalid ? null : sampleOfInstrument(data, i.index);
      const brr = samp ? ' · BRR ' + samp.length + ' bytes' + (samp.loops ? ' · loops' : '') : '';
      out.push({
        id: 'snes-inst-' + i.index, group: CAT().instruments, collapsible: true,
        label: hex2(i.index) + (invalid ? ' · invalid' : ''),
        sub: (invalid ? 'sample ' + hex2(i.sample) + ' out of range' : setOfInstrument(i.index) + ' set · sample ' + hex2(i.sample) + brr) + (gmOf(data, i.index) ? ' · ' + gmOf(data, i.index).text : '')
      });
    }
    return out;
  }

  /** The GM instrument an instrument is mapped to (data/audio/nhl93s-gm-map.json): { text, why, confidence, runnerUp } or null. */
  function gmOf(data, inst) {
    const map = data && data.gmMap;
    const GM = root.Nhl92GmMap;
    if (!map || !GM || inst == null) return null;
    const set = setOfInstrument(inst);
    const row = map.sets && map.sets[set] && map.sets[set][inst];
    if (!row) return null;
    const name = (r) => (r.drum != null ? 'GM drum ' + r.drum + ' (' + GM.drumName(r.drum) + ')' : 'GM program ' + r.program + ' (' + GM.PROGRAM_NAMES[r.program] + ')');
    return { text: name(row), why: row.why, confidence: row.confidence, runnerUp: row.runnerUp ? name(row.runnerUp) : '' };
  }

  /** The instrument an Instruments row plays. */
  function partInstrument(data, id) {
    const m = /^snes-inst-(\d+)$/.exec(id);
    return m ? Number(m[1]) : null;
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

  /** Log DSP key-ons into session.commands for the voice roll (effects; songs use commandsOf). */
  function attachVoiceLog(session) {
    if (session._voiceHook) return;
    const spc = session.player.spc;
    const dsp = spc.dsp;
    const orig = dsp.write.bind(dsp);
    const vs = [];
    for (let i = 0; i < 8; i++) vs.push({ srcn: 0, vl: 0, vr: 0, pl: 0, pitch: 0 });
    const endNote = (v, frame) => {
      if (!v.cur) return;
      const dur = frame - v.cur.frame;
      if (dur > 0) v.cur.args.frames = dur;
      session.commands.push(v.cur);
      v.cur = null;
    };
    dsp.write = function (a, val) {
      orig(a, val);
      const v = val & 0xff;
      a &= 0x7f;
      const frame = session.player.stats.frames;
      if (a === 0x4c) {
        for (let k = 0; k < 8; k++) {
          if (!(v & (1 << k))) continue;
          endNote(vs[k], frame);
          const set = session.sound ? 'game' : 'game';
          const srcn = vs[k].srcn;
          const inst = set === 'game' ? srcn + 10 : srcn;
          vs[k].cur = { frame, name: 'keyOn', args: { voice: k, sample: inst, inst, pitch: vs[k].pitch || null } };
        }
      } else if (a === 0x5c) {
        for (let j = 0; j < 8; j++) if (v & (1 << j)) endNote(vs[j], frame);
      } else if (a < 0x80 && (a & 0x0f) <= 7) {
        const q = vs[a >> 4];
        switch (a & 0x0f) {
          case 0: q.vl = v; break;
          case 1: q.vr = v; break;
          case 2: q.pl = v; break;
          case 3:
            q.pitch = ((v & 0x3f) << 8) | q.pl;
            if (q.cur && q.cur.args) q.cur.args.pitch = q.pitch;
            break;
          case 4: q.srcn = v; break;
          default: break;
        }
      }
    };
    session._voiceHook = orig;
    session._voiceVs = vs;
  }

  function detachVoiceLog(session) {
    if (!session._voiceHook) return;
    session.player.spc.dsp.write = session._voiceHook;
    session._voiceHook = null;
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
      commands = [];
    } else {
      player.cue(Number(songName));
      commands = commandsOf(data, data.timeline(Number(songName), { loops: 0 }));
    }
    const session = {
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
    if (sound) attachVoiceLog(session);
    player.record();
    return session;
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
    detachVoiceLog(session);
    try { session.player.spc.stopRecording(); } catch (err) { /* noop */ }
  }

  root.NhlSoundTestSnes93 = {
    RATE,
    displaySongName,
    songInfo,
    entries,
    isPart,
    partInstrument,
    instrumentInvalid,
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
