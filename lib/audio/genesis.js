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
  var sequenceApi = typeof module === 'object' && module.exports
    ? require('./genesis-92-sequence')
    : (root.NhlGenesis92Sequence || {});
  var api = factory(constants, parseEventStream, sequenceApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlGenesisAudio = api;
})(typeof self !== 'undefined' ? self : this, function (constants, parseEventStream, sequenceApi) {
  const { GAMES, SOUND_BASE, NHL92_NOTE_FREQ, NHL92_NOTE_OCTAVE } = constants;
  const parseChannelSequenceDriver = sequenceApi.parseChannelSequence;

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
      instrumentTable: meta.instrumentTable != null ? meta.instrumentTable : null,
      streamDriver: meta.streamDriver || null
    };
  }

  function sequenceMeta(meta, durationMult) {
    const tables = noteTables(meta);
    return {
      soundBase: meta.soundBase,
      noteFreqTable: tables.freq,
      noteOctaveTable: tables.octave,
      instrumentTable: meta.instrumentTable,
      durationMult: durationMult || 6
    };
  }

  /** @deprecated third arg is durationMult when second arg looks like offset without header */
  function parseChannelSequence(buf, channelHeaderOrSeq, durationMult, meta) {
    if (!parseChannelSequenceDriver) return { events: [], durationMult: 6 };
    if (meta && typeof durationMult === 'number' && channelHeaderOrSeq > 0x10000) {
      return parseChannelSequenceDriver(buf, null, sequenceMeta(meta, durationMult), {
        seqStart: channelHeaderOrSeq,
        maxTime: 100
      });
    }
    return parseChannelSequenceDriver(buf, channelHeaderOrSeq, sequenceMeta(meta, durationMult), {
      maxTime: 100
    });
  }

  function asRomBytes(buf) {
    if (!buf) return null;
    if (buf instanceof Uint8Array) return buf;
    if (ArrayBuffer.isView(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buf)) {
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    return null;
  }

  function previewFmtuneTrack(buf, trackId, meta) {
    if (!parseChannelSequenceDriver) return null;
    buf = asRomBytes(buf);
    if (!buf || meta.fmtuneTable == null) return null;
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
      const part = parseChannelSequenceDriver(
        buf,
        headerPtr,
        sequenceMeta(meta, durationMult),
        { channel: ch, maxTime: 48, maxEvents: 800 }
      );
      for (const ev of part.events) {
        merged.push(ev);
      }
    }
    merged.sort((a, b) => a.time - b.time);
    const end = merged.reduce((m, e) => Math.max(m, e.time + e.duration), 0);
    return { events: merged, duration: end, durationMult };
  }

  function previewCmdStream(buf, start, end, meta) {
    if (!parseChannelSequenceDriver) return null;
    buf = asRomBytes(buf);
    if (!buf) return null;
    let endPos = end != null ? end : buf.length;
    if (endPos - start <= 32) {
      endPos = Math.min(buf.length, start + 256);
      for (let i = start; i < endPos; i++) {
        if (buf[i] === 0x85) {
          endPos = i + 1;
          break;
        }
      }
    }
    const part = parseChannelSequenceDriver(buf, null, sequenceMeta(meta, 6), {
      seqStart: start,
      endPos,
      maxTime: 8,
      minMidi: 0
    });
    const endTime = part.events.reduce((m, e) => Math.max(m, e.time + e.duration), 0.2);
    return { events: part.events, duration: endTime, durationMult: 6 };
  }

  function previewEntry(buf, entry, meta) {
    buf = asRomBytes(buf);
    if (!buf || !entry || !meta) return null;
    meta = Object.assign({}, meta);
    if (meta.noteFreqTable == null || meta.noteOctaveTable == null) {
      const tables = noteTables(meta);
      meta.noteFreqTable = tables.freq;
      meta.noteOctaveTable = tables.octave;
    }
    if (meta.soundBase == null) meta.soundBase = SOUND_BASE;
    if (meta.instrumentTable == null) meta.instrumentTable = 0x116A6;
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
