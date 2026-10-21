/**
 * NHL '94 (SNES) sound test helpers: load the extracted pack, list songs and sound entries,
 * and drive NhlNhl94sPlayer for live 32 kHz playback in sound-test-view.js.
 */
(function (root) {
  'use strict';

  const RATE = 32000;
  const Player = () => root.NhlNhl94sPlayer;
  const SD = () => root.NhlNhl94sSoundData;

  const STREAM_NAMES = ['Period end', 'Goal', 'Big hit', 'Save', 'Puck on body', 'Puck on glass'];

  function displaySongName(name) {
    return name.replace(/^Song/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  function songGroup(name, data) {
    if (data.songSet(name) === 'menu') return 'Title & menu';
    if (/^SongDefense$/.test(name)) return 'Stingers';
    if (/Charge|Rally|Buildup|LetsGo|HereWeGo|QuickBuildup|Defense/i.test(name)) return 'Crowd & charge';
    return 'Organ songs';
  }

  /** Catalog rows for the Sound test list (songs playable; sound entries informational). */
  function entries(data) {
    const out = [];
    const songs = data.songNames.slice().sort((a, b) => {
      const ga = songGroup(a, data);
      const gb = songGroup(b, data);
      if (ga !== gb) return ga.localeCompare(gb);
      return a.localeCompare(b);
    });
    for (const name of songs) {
      out.push({
        id: 'song-' + name,
        group: root.NhlAudioCategories.CATEGORY.songs,
        label: name,
        sub: songGroup(name, data) + ' · ' + data.songSet(name) + ' sample set · plays until Stop or song end'
      });
    }
    const sets = ['game', 'menu', 'intro'];
    for (const set of sets) {
      const sounds = data.sounds(set);
      const samples = data.sampleList(set);
      sounds.forEach((snd, i) => {
        const sample = samples[snd.sample] || ('sample ' + snd.sample);
        const streamed = set === 'game' && i >= 22 && i <= 27;
        out.push({
          id: 'sound-' + set + '-' + i,
          group: root.NhlAudioCategories.CATEGORY.sfx,
          label: set + ' #' + i + ' · ' + (streamed ? 'streamed ' + STREAM_NAMES[i - 22] : sample),
          sub: set + ' set · ' + (streamed ? 'streamed to the sound CPU, then played' : 'plays until its envelope ends')
        });
      });
    }
    return out;
  }

  /** One pass length in seconds and whether the sequencer loops (no stop event). */
  function passInfo(data, songName) {
    const song = data.song(songName);
    let maxTick = 0;
    let loops = false;
    for (const t of song.tracks) {
      const w = SD().walk(t, { repeat: 1 });
      if (w.endTick > maxTick) maxTick = w.endTick;
      if (t.events.some((e) => e.type === 'loop') && !t.events.some((e) => e.type === 'stop')) loops = true;
    }
    const frames = SD().tickFrames(song, maxTick);
    const total = frames[maxTick] / SD().FRAME_RATE.ntsc;
    return { total, loopStart: 0, loops };
  }

  async function loadPack() {
    const res = await fetch(new URL('data/audio/nhl94s-sound.json', document.baseURI).href);
    if (!res.ok) throw new Error('NHL 94 SNES sound pack missing (' + res.status + ')');
    const pack = await res.json();
    const data = SD().load(pack);
    try {
      const gm = await fetch(new URL('data/audio/nhl94s-gm-map.json', document.baseURI).href);
      data.gmMap = gm.ok ? await gm.json() : null;
    } catch (err) { data.gmMap = null; }
    return data;
  }

  /** A song (songName) or one sound effect ({ set, n }) on a fresh sound unit. */
  function startSession(data, songName, sound, custom) {
    const player = Player().create({ data });
    player.boot();
    player.loadSet(custom ? custom.set : sound ? sound.set : data.songSet(songName) === 'game' ? 'game' : 'menu');
    player.logCommands(true);
    if (custom) player.startSongBytes(custom.bytes);
    else if (sound) player.playEntry(sound.n);
    else player.startSong(songName);
    player.record();
    return {
      player,
      sound: sound || null,
      custom: custom || null,
      songName,
      data,
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

  /** Run the player until at least `n` stereo samples are queued (or the song ends). */
  /** Emulate until `n` stereo samples are queued, at most `maxFrames` video frames (so a timer can top the queue up in small steps). */
  function fill(session, n, maxFrames) {
    const p = session.player;
    let frames = maxFrames || Infinity;
    while (session.queued < n && !session.done && frames-- > 0) {
      p.runFrame();
      session.frames = p.stats.frames;
      appendPcm(session, p.spc.drainRecording());
      if (session.sound ? (p.idle() && session.frames > 3) || session.frames > 1500 : !p.musicOn && session.queued === 0) session.done = true;
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
    trackDelivered(session, at);
    return { left, right };
  }

  function heardSeconds(session) {
    return Math.max(0, ((session.delivered || 0) - session.queued) / RATE);
  }

  function trackDelivered(session, n) {
    session.delivered = (session.delivered || 0) + n;
  }

  function dispose(session) {
    try { session.player.stop(); } catch (err) { /* already stopped */ }
    try { session.player.spc.stopRecording(); } catch (err) { /* noop */ }
  }

  /** Buttons for MusicDuck, fade, PuckSfx / CollisionSfx (NHL94SNES routines) while a session is live. */
  function mountGameplay(box, getSession) {
    const row = document.createElement('div');
    row.className = 'st-note';
    const mk = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ghost-btn';
      b.textContent = label;
      b.addEventListener('click', () => {
        const s = getSession();
        if (!s || !s.player) return;
        fn(s.player);
      });
      return b;
    };
    row.append(
      mk('Duck music', (p) => p.setMusicDuck(1)),
      mk('Unduck', (p) => p.setMusicDuck(0)),
      mk('Fade out', (p) => p.fadeOutSound()),
      mk('Puck SFX #3', (p) => p.puckSfx(3, 0x2800, 0x800)),
      mk('Collision SFX', (p) => p.collisionSfx(0x2000, 0, 0x600, 0xa00))
    );
    const pre = document.createElement('pre');
    pre.className = 'st-note mono';
    pre.textContent = 'Replay slots (recsfx): play a puck or collision SFX while audio runs.';
    const tick = setInterval(() => {
      if (!box.isConnected) { clearInterval(tick); return; }
      const s = getSession();
      if (s && s.player && s.player.getReplaySfx) pre.textContent = 'recsfx: ' + JSON.stringify(s.player.getReplaySfx());
    }, 500);
    box.appendChild(row);
    box.appendChild(pre);
  }

  root.NhlSoundTestSnes = {
    mountGameplay,
    RATE,
    displaySongName,
    entries,
    passInfo,
    loadPack,
    startSession,
    pull,
    fill,
    heardSeconds,
    trackDelivered,
    dispose,
    frameRate: () => SD().FRAME_RATE.ntsc
  };
})(typeof self !== 'undefined' ? self : this);
