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

  /** Catalog rows for the Sound test list. */
  function entries(data) {
    const out = [];
    const songs = data.cueList.slice().sort((a, b) => (a.set === b.set ? a.cue - b.cue : a.set === 'game' ? -1 : 1));
    for (const c of songs) {
      out.push({
        id: 'song-' + c.cue,
        group: c.set === 'game' ? 'Game music (in-game samples)' : 'Title & menu music (boot samples)',
        label: c.name,
        sub: 'cue ' + hex(c.cue) + ' · ' + c.set + ' sample set' + (c.note && /unused/i.test(c.name) ? ' · unused in the game' : '')
      });
    }
    for (let level = 1; level <= 7; level++) {
      out.push({ id: 'sound-game-' + (0x80 + level), group: 'Crowd noise', label: 'Crowd noise · level ' + level, sub: 'cue ' + hex(0x80 + level) + ' · loops until Stop' });
    }
    for (const id of data.effectIds) {
      if (id <= 0x87) continue;
      const name = data.effectName(id);
      out.push({ id: 'sound-game-' + id, group: 'Sound effects', label: hex(id) + ' · ' + (name || 'effect'), sub: 'cue ' + hex(id) + (data.effect(id).loops ? ' · loops until Stop' : '') });
    }
    return out;
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
    return data;
  }

  /** The key-on list the sequencer view draws, from the song's timeline (frame of each note start, voice = channel). */
  function commandsOf(data, timeline) {
    const out = [];
    for (const e of timeline.events) {
      if (e.type !== 'note' && e.type !== 'percussion') continue;
      const sec = data.secondsAt(timeline.tempoTrack, e.tick) + START_LAG;
      out.push({ frame: Math.round(sec * FRAME_RATE), name: 'keyOn', args: { voice: e.ch, sample: e.instrument, inst: e.instrument } });
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
    } else if (sound) player.effect(sound.n);
    else {
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

  /** Run the player until at least `n` stereo samples are queued (or the sound ends). */
  function pull(session, n) {
    const p = session.player;
    while (session.queued < n && !session.done) {
      p.runFrame();
      session.frames = p.stats.frames;
      appendPcm(session, p.spc.drainRecording());
      if (session.sound) {
        const id = session.sound.n;
        const looping = id >= 0x81 && id <= 0x87;
        if (!looping && ((p.idle() && session.frames > 20) || session.frames > 1500)) session.done = true;
      } else if (!p.musicOn && session.frames > 20 && p.idle()) session.done = true;
    }
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
    try { session.player.spc.stopRecording(); } catch (err) { /* noop */ }
  }

  root.NhlSoundTestSnes93 = {
    RATE,
    displaySongName,
    songInfo,
    entries,
    passInfo,
    loadPack,
    startSession,
    pull,
    heardSeconds,
    trackDelivered,
    dispose,
    frameRate: () => FRAME_RATE
  };
})(typeof self !== 'undefined' ? self : this);
