/**
 * NHL '94 (SNES) sound data: the songs, sound entries, BRR samples and tables extracted into
 * data/audio/nhl94s-sound.json by tools/extract-nhl94s-sound.js, parsed into plain objects.
 *
 * No playback here. This module only reads the data and says what it means, using the rules the NHL94SNES
 * disassembly documents for the main CPU's music player (MusicStart, StepTrack, ReadTrackEvent, StartSoundVoice,
 * SeqCmd07). Field names say which routine each rule comes from; bytes whose job isn't known stay raw.
 *
 *   const data = NhlNhl94sSoundData.load(packJson);
 *   data.song('SongBrassBonanza')       -> { tempo, trackCount, tracks: [{ index, name, events }] }
 *   data.walk(track, { repeat: 2 })     -> the events with absolute ticks, the loop expanded
 *   data.tickFrames(song, ticks)        -> the video frame each tick falls on
 *   data.sound('game', 12)              -> a decoded 48-byte sound entry
 *   data.sample('SampleOrgan')          -> { loop, length, brr: Uint8Array, loops, decode() }
 */
(function (root, factory) {
  var api = factory(root.NhlSnesDsp);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlNhl94sSoundData = api;
})(typeof self !== 'undefined' ? self : this, function (Dsp) {
  'use strict';
  if (typeof require === 'function' && typeof module === 'object') Dsp = Dsp || require('./snes-dsp');

  // Event codes (ReadTrackEvent). Below $D9 the code is a note.
  var EV = {
    STOP_D9: 0xd9, STOP_DA: 0xda, LOOP: 0xdb, INSTRUMENT: 0xdc, TEMPO: 0xdd, VOLUME: 0xde, CONTROLLER: 0xdf,
    MARK: 0xe2, E3: 0xe3, BEND: 0xe5, NAME: 0xe7, EA: 0xea
  };

  // Main-CPU sequencer timing (MusicStart): the tempo byte divides 10080 (NTSC) or 8160 (PAL, STAT78 bit 4) into
  // the frame counter's tick length; each video frame adds 64 to the counter (SequencerTick).
  var TEMPO_NUMERATOR = { ntsc: 10080, pal: 8160 };
  var COUNTER_PER_FRAME = 64;
  var FRAME_RATE = { ntsc: 60.0988, pal: 50.0070 };

  function varLen(b, p) {
    var v = 0;
    for (;;) {
      var c = b[p++];
      v = (v << 7) | (c & 0x7f);
      if (!(c & 0x80)) return { value: v, next: p };
      if (p >= b.length) throw new Error('variable-length number runs off the end');
    }
  }

  /**
   * One track's note stream. Records are [delay][event]: the delay (variable length) is the wait *before* the event,
   * except the first record of the track, whose delay the player reads and discards (ReadTrackEvent).
   * Stops at an end event, a loop jump ($DB) or the end of the bytes.
   */
  function parseTrack(b, p) {
    var events = [];
    while (p < b.length) {
      var d = varLen(b, p);
      p = d.next;
      if (p >= b.length) break;
      var code = b[p++];
      var ev = { delay: d.value, code: code };
      if (code < 0xd9) {
        ev.type = 'note';
        ev.note = code; // the whole byte; the pitch uses code & $7F (songwav, StartSoundVoice), bit 7's job is not known
        ev.key = code & 0x7f;
        ev.velocity = b[p++];
        var du = varLen(b, p);
        ev.duration = du.value;
        p = du.next;
      } else if (code === EV.STOP_D9 || code === EV.STOP_DA) ev.type = 'stop';
      else if (code === EV.LOOP) ev.type = 'loop';
      else if (code === EV.E3) ev.type = 'e3';
      else if (code === EV.INSTRUMENT) {
        ev.type = 'instrument';
        ev.value = b[p++];
        ev.sound = ev.value === 0x6a ? 0x14 : ev.value; // StepTrack: $6A is sound $14
      } else if (code === EV.TEMPO) { ev.type = 'tempo'; ev.value = b[p++]; }
      else if (code === EV.VOLUME) { ev.type = 'volume'; ev.value = b[p++]; }
      else if (code === EV.MARK) { ev.type = 'mark'; ev.value = b[p++]; }
      else if (code === EV.EA) { ev.type = 'ea'; ev.value = b[p++]; }
      else if (code === EV.CONTROLLER) { ev.type = 'controller'; ev.controller = b[p++]; ev.value = b[p++]; }
      else if (code === EV.BEND) { ev.type = 'bend'; ev.value = b[p]; ev.extra = b[p + 1]; p += 2; }
      else if (code === EV.NAME) {
        var n = b[p++];
        ev.type = 'name';
        ev.text = String.fromCharCode.apply(null, Array.from(b.subarray(p, p + n)).filter(function (c) { return c; }));
        p += n;
      } else ev.type = 'unknown';
      events.push(ev);
      if (ev.type === 'stop' || ev.type === 'loop') break;
    }
    return events;
  }

  /** A song: 8 header bytes (byte 1 = tempo, byte 6 = track count), word offsets of the tracks (0 ends), TRAK chunks. */
  function parseSong(bytes) {
    var b = bytes;
    var tracks = [];
    for (var i = 8; i + 1 < b.length; i += 2) {
      var off = b[i] | (b[i + 1] << 8);
      if (!off) break;
      var events = parseTrack(b, off);
      var name = events.length && events[0].type === 'name' ? events[0].text : (events.length > 1 && events[1].type === 'name' ? events[1].text : '');
      tracks.push({ index: tracks.length, offset: off, name: name, events: events });
    }
    return { tempo: b[1], trackCount: b[6], header: Array.from(b.subarray(0, 8)), tracks: tracks, size: b.length };
  }

  /**
   * The track's events with absolute ticks. The first event's delay (and the delay before the marker after a loop
   * jump) is not waited; a loop ($DB) jumps back to the last mark ($E2) executed, or to the start. repeat = how many
   * times the body plays (1: not at all repeated). Returns { events: [{ tick, event, index }], endTick }.
   */
  function walk(track, opts) {
    var repeat = (opts && opts.repeat) || 1;
    var ev = track.events;
    var out = [];
    var tick = 0;
    var loopTo = 0;
    var pass = 1;
    var i = 0;
    var first = true;
    var guard = 0;
    while (i < ev.length && guard++ < 200000) {
      var e = ev[i];
      if (!first) tick += e.delay;
      first = false;
      if (e.type === 'loop') {
        if (pass < repeat) { pass += 1; i = loopTo; first = true; continue; }
        out.push({ tick: tick, event: e, index: i });
        break;
      }
      if (e.type === 'mark') loopTo = i;
      out.push({ tick: tick, event: e, index: i });
      if (e.type === 'stop') break;
      i += 1;
    }
    return { events: out, endTick: tick };
  }

  /** Frame (0-based, counted from the song start) on which each tick 0..ticks happens. Tempo events ($DD) set the tick length. */
  function tickFrames(song, ticks, opts) {
    var region = (opts && opts.region) || 'ntsc';
    var changes = {};
    ((opts && opts.tempoChanges) || []).forEach(function (c) { changes[c.tick] = c.value; });
    var T = Math.floor(TEMPO_NUMERATOR[region] / song.tempo) & 0xff;
    var frames = [];
    var acc = 0;
    var frame = 0;
    while (frames.length <= ticks && frame < 60 * 3600) {
      acc += COUNTER_PER_FRAME;
      while (acc >= T && frames.length <= ticks) {
        frames.push(frame);
        acc -= T;
        var c = changes[frames.length - 1];
        if (c != null) T = c;
      }
      frame += 1;
    }
    return frames;
  }

  /**
   * A 48-byte sound entry. Offsets and routines: pitchOffset +2 (StartSoundVoice adds it to the pitch), noteOffset +4
   * (added to the note), gain +$A, volL/volR +$12/+$13, sample/adsr1/adsr2 +$14/+$15/+$16 (SeqCmd07 sends them as SRCN,
   * ADSR1, ADSR2; with ADSR1 bit 7 clear the game sends GAIN with command $0C), monoVol +$17, vibrato rate/speed/depth/
   * direction +$1C/+$1E/+$20/+$2D, priority +$2A, bendRange +$2F. The other bytes are kept in raw.
   */
  function decodeSound(raw) {
    var w = function (o) { return raw[o] | (raw[o + 1] << 8); };
    var s8 = function (v) { return (v << 24) >> 24; };
    return {
      raw: Array.from(raw),
      pitchOffset: w(2), noteOffset: s8(raw[4]), noteOffsetByte: raw[4], gain: raw[0x0a],
      volL: raw[0x12], volR: raw[0x13], sample: raw[0x14], adsr1: raw[0x15], adsr2: raw[0x16], monoVol: raw[0x17],
      vibRate: raw[0x1c], vibSpeed: raw[0x1e], vibDepth: raw[0x20], vibDir: raw[0x2d],
      priority: raw[0x2a], bendRange: raw[0x2f], adsr: (raw[0x15] & 0x80) !== 0
    };
  }

  var b64 = function (s) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
    var bin = atob(s);
    var o = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
    return o;
  };

  function load(pack) {
    var songCache = {};
    var sampleCache = {};
    var setOf = function (name) { return name === 'title' ? 'title' : name; };
    return {
      pack: pack,
      songNames: Object.keys(pack.songs),
      sampleNames: Object.keys(pack.samples),
      pitchTable: pack.pitchTable,
      volumeCurve: pack.volumeCurve,
      teams: pack.teams,
      /** Which sample set a song plays with: the organ songs use the in-game set; the title, menu and playoff songs use the menu set (the title screen swaps to it before TitleSong starts). */
      songSet: function (songName) { return /^Song/.test(songName) ? 'game' : 'menu'; },
      song: function (name) {
        if (!pack.songs[name]) throw new Error('unknown song ' + name);
        if (!songCache[name]) { songCache[name] = parseSong(b64(pack.songs[name])); songCache[name].name = name; }
        return songCache[name];
      },
      songBytes: function (name) { return b64(pack.songs[name]); },
      sample: function (name) {
        var s = pack.samples[name];
        if (!s) throw new Error('unknown sample ' + name);
        if (!sampleCache[name]) {
          var brr = b64(s.brr);
          sampleCache[name] = {
            name: name, loop: s.loop, length: s.length, brr: brr, blocks: s.length / 9,
            loops: s.loop < s.length, loopBlock: s.loop / 9,
            decode: function () { return Dsp.decodeBrr(brr, 0); }
          };
        }
        return sampleCache[name];
      },
      /** The sound entries of a set ('game', 'menu', 'intro'; 'title' uses the menu entries). */
      sounds: function (set) {
        var s = pack.sets[setOf(set)];
        var src = s.sounds || pack.sets[s.soundsFrom].sounds;
        return src.map(decodeSound);
      },
      sound: function (set, n) { return this.sounds(set)[n]; },
      /** Sample names of a set, in upload order (the driver numbers its samples in upload order, so this is SRCN). */
      sampleList: function (set) { return pack.sets[setOf(set)].sampleList.slice(); },
      /** The sample a sound plays: sound entry -> its sample index -> the set's sample list. */
      soundSample: function (set, n) {
        var snd = this.sound(set, n);
        return this.sampleList(set)[snd.sample] || null;
      },
      /** TeamSongs: song names per slot (0-5) for a team abbreviation, null for none. */
      teamSongs: function (team) {
        var t = pack.teams.indexOf(team);
        if (t < 0) throw new Error('unknown team ' + team);
        return pack.teamSongs.slice(t * 6, t * 6 + 6);
      }
    };
  }

  return {
    load: load, parseSong: parseSong, parseTrack: parseTrack, walk: walk, tickFrames: tickFrames, decodeSound: decodeSound,
    EV: EV, TEMPO_NUMERATOR: TEMPO_NUMERATOR, COUNTER_PER_FRAME: COUNTER_PER_FRAME, FRAME_RATE: FRAME_RATE
  };
});
