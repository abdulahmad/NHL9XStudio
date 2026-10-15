/**
 * Genesis FM cmdstream preview (NHL 92 driver). Produces a simple note schedule
 * for Web Audio — not cycle-accurate YM2612.
 */
(function (root, factory) {
  var constants = typeof module === 'object' && module.exports
    ? require('./genesis-constants')
    : root.NhlGenesisAudioConstants;
  var parseEventStream = typeof module === 'object' && module.exports
    ? require('./genesis-events').parseEventStream
    : (root.NhlGenesisEvents && root.NhlGenesisEvents.parseEventStream);
  var api = factory(constants, parseEventStream);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlGenesisAudio = api;
})(typeof self !== 'undefined' ? self : this, function (constants, parseEventStream) {
  const { GAMES, SOUND_BASE, NHL92_NOTE_FREQ, NHL92_NOTE_OCTAVE } = constants;

  const YM_CLOCK = 7670454;
  const TICK_HZ = 60;

  function readWord(buf, offset) {
    if (offset < 0 || offset + 2 > buf.length) return 0;
    return (buf[offset] << 8) | buf[offset + 1];
  }

  function readLong(buf, offset) {
    if (offset < 0 || offset + 4 > buf.length) return 0;
    return ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0;
  }

  function ymFreqToMidi(freqHigh, freqLow, pitchBend) {
    const fnum = ((freqHigh & 0x07) << 8) | freqLow;
    const block = (freqHigh >> 3) & 0x07;
    const freqHz = (YM_CLOCK / 144 / 32) * fnum / (1 << (21 - block));
    let midi = Math.round(69 + 12 * Math.log2(freqHz / 440));
    midi += Math.round((pitchBend || 0) / 8);
    return Math.max(0, Math.min(127, midi));
  }

  function tickSeconds(ticks, durationMult) {
    const mult = durationMult || 6;
    return (ticks * mult) / TICK_HZ;
  }

  function noteTables(meta) {
    return {
      freq: meta.noteFreqTable != null ? meta.noteFreqTable : NHL92_NOTE_FREQ,
      octave: meta.noteOctaveTable != null ? meta.noteOctaveTable : NHL92_NOTE_OCTAVE
    };
  }

  function previewMetaFromGame(meta) {
    if (!meta) return null;
    return {
      soundBase: meta.soundBase,
      fmtuneTable: meta.fmtuneTable,
      fmtuneStride: meta.fmtuneStride || 0x1A,
      noteFreqTable: meta.noteFreqTable != null ? meta.noteFreqTable : null,
      noteOctaveTable: meta.noteOctaveTable != null ? meta.noteOctaveTable : null,
      streamDriver: meta.streamDriver || null
    };
  }

  /**
   * @returns {{ events: {time:number,midi:number,duration:number}[], durationMult:number }}
   */
  function parseChannelSequence(buf, seqStart, durationMult, meta) {
    const tables = noteTables(meta);
    const freqTable = tables.freq;
    const octaveTable = tables.octave;
    let pos = seqStart;
    let currentDuration = durationMult || 6;
    let pitchBend = 0;
    let time = 0;
    const events = [];
    let guard = 10000;

    while (guard-- > 0 && pos >= 0 && pos < buf.length) {
      const byte = buf[pos++];
      if (byte < 0x80) {
        if (byte === 0x60) {
          time += tickSeconds(1, currentDuration);
          continue;
        }
        const noteOffset = byte;
        if (freqTable + noteOffset + 1 >= buf.length) break;
        const freqByte = buf[freqTable + noteOffset];
        const octave = buf[octaveTable + noteOffset];
        const freqHigh = (freqByte & 0x38) | (octave >> 5);
        const freqLow = (freqByte & 0x07) | (octave << 3);
        const midi = ymFreqToMidi(freqHigh, freqLow, pitchBend);
        const durTicks = Math.max(1, currentDuration);
        events.push({
          time,
          midi,
          duration: tickSeconds(durTicks, 1)
        });
        time += tickSeconds(durTicks, 1);
      } else {
        switch (byte) {
          case 0x80:
            pos++;
            break;
          case 0x81:
            pos += 2;
            break;
          case 0x83:
          case 0x89:
            break;
          case 0x84:
            pos = seqStart;
            break;
          case 0x85:
            return { events, durationMult: durationMult || 6 };
          case 0x86:
            pos += 2;
            break;
          case 0x87:
            break;
          case 0x88:
            pitchBend = buf[pos++];
            break;
          case 0x8A:
          case 0x8B:
            pos++;
            break;
          default:
            if (byte >= 0xA0) {
              currentDuration = Math.max(1, (byte - 0xA0) * (durationMult || 6));
            }
            break;
        }
      }
    }
    return { events, durationMult: durationMult || 6 };
  }

  function previewFmtuneTrack(buf, trackId, meta) {
    if (meta.fmtuneTable == null) return null;
    const stride = meta.fmtuneStride || 0x1A;
    const tableOffset = meta.fmtuneTable + trackId * stride;
    if (tableOffset + 2 >= buf.length) return null;
    const fmChannels = buf[tableOffset];
    const durationMult = buf[tableOffset + 1] || 6;
    const merged = [];
    for (let ch = 0; ch <= fmChannels; ch++) {
      const ptrOffset = tableOffset + 2 + ch * 4;
      const headerPtr = readLong(buf, ptrOffset) + meta.soundBase;
      if (headerPtr < 0 || headerPtr + 2 >= buf.length) continue;
      const seqOffset = readWord(buf, headerPtr) + meta.soundBase;
      const part = parseChannelSequence(buf, seqOffset, durationMult, meta);
      for (const ev of part.events) {
        merged.push(ev);
      }
    }
    merged.sort((a, b) => a.time - b.time);
    const end = merged.reduce((m, e) => Math.max(m, e.time + e.duration), 0);
    return { events: merged, duration: end, durationMult };
  }

  function previewCmdStream(buf, start, end, meta) {
    const durationMult = 6;
    const part = parseChannelSequence(buf, start, durationMult, meta);
    const endTime = part.events.reduce((m, e) => Math.max(m, e.time + e.duration), 0.2);
    return { events: part.events, duration: endTime, durationMult };
  }

  function previewEntry(buf, entry, meta) {
    if (!buf || !entry || !meta) return null;
    if (entry.type === 'fm-song') {
      return previewFmtuneTrack(buf, entry.track, meta);
    }
    if (entry.type === 'fm-sfx') {
      return previewCmdStream(buf, entry.start, entry.end, meta);
    }
    if (entry.type === 'fm-stream' && parseEventStream && entry.start != null && entry.end != null) {
      return parseEventStream(buf, entry.start, entry.end, {});
    }
    return null;
  }

  function loadStreamPack(gameId) {
    if (typeof module !== 'object' || !module.exports) return null;
    try {
      return require('./data/' + gameId + '-streams.json');
    } catch (e) {
      return null;
    }
  }

  function decorateStreamEntry(entry, gameId) {
    const out = Object.assign({}, entry);
    if (gameId === 'nhl94' && entry.soundId != null) {
      if (entry.soundId >= 0x78) out.group = 'Music — Shared';
      else if (entry.soundId >= 0x30) out.group = 'Music — Team';
    }
    return out;
  }

  function buildCatalog(gameId, opts) {
    const meta = GAMES[gameId];
    if (!meta) return null;
    const streamPack = (opts && opts.streams) || loadStreamPack(gameId);
    const entries = [];
    if (meta.hockeySndStart != null && meta.hockeySndEnd != null) {
      entries.push({
        id: 'hockey-snd',
        label: 'Hockey.snd (ROM)',
        group: 'Samples',
        type: 'region',
        start: meta.hockeySndStart,
        end: meta.hockeySndEnd,
        playable: false,
        blurb: meta.digitalAnchor != null
          ? 'Digital sample pack; anchor 0x' + meta.digitalAnchor.toString(16)
          : 'Sound ROM region'
      });
    }
    if (meta.fmtuneTable != null && meta.fmtuneTracks > 0) {
      const names = meta.fmtuneNames || [];
      for (let t = 0; t < meta.fmtuneTracks; t++) {
        entries.push({
          id: 'fmtune-' + t,
          label: names[t] || ('FMTune track ' + t),
          group: 'Music',
          type: 'fm-song',
          track: t,
          playable: !!meta.playback
        });
      }
    }
    for (const sfx of meta.sfx || []) {
      entries.push({
        id: sfx.id,
        label: sfx.label,
        group: 'SFX',
        type: 'fm-sfx',
        start: sfx.start,
        end: sfx.end,
        playable: !!meta.playback
      });
    }
    if (streamPack && streamPack.streams) {
      for (const stream of streamPack.streams) {
        entries.push(decorateStreamEntry({
          id: stream.id,
          label: stream.label,
          group: stream.group,
          type: 'fm-stream',
          soundId: stream.soundId,
          start: stream.start,
          end: stream.end,
          playable: !!meta.playback,
          blurb: stream.blurb || null,
          symbol: stream.symbol || null
        }, gameId));
      }
    }
    return {
      gameId,
      platform: 'genesis',
      playback: !!meta.playback,
      note: meta.note || null,
      streamDriver: meta.streamDriver || null,
      previewMeta: previewMetaFromGame(meta),
      entries
    };
  }

  function gameMeta(gameId) {
    return GAMES[gameId] || null;
  }

  return {
    SOUND_BASE,
    readWord,
    readLong,
    ymFreqToMidi,
    parseChannelSequence,
    previewFmtuneTrack,
    previewCmdStream,
    previewEntry,
    previewMetaFromGame,
    buildCatalog,
    gameMeta
  };
});
