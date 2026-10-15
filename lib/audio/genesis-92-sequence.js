/**
 * NHL 92 FM channel cmdstream → note schedule (matches Sound_ProcessMusicTracks logic).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlGenesis92Sequence = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TICK_HZ = 60;
  const YM_CLOCK = 7670454;
  const MAX_LOOP_OPS = 12000;

  function readWord(buf, offset) {
    if (offset < 0 || offset + 2 > buf.length) return 0;
    return (buf[offset] << 8) | buf[offset + 1];
  }

  function signedByte(b) {
    return b >= 0x80 ? b - 0x100 : b;
  }

  function addByte(a, b) {
    return (a + b) & 0xff;
  }

  function ymFreqToMidi(freqHigh, freqLow) {
    const fnum = ((freqHigh & 0x07) << 8) | freqLow;
    const block = (freqHigh >> 3) & 0x07;
    const freqHz = (YM_CLOCK / 144 / 32) * fnum / (1 << (21 - block));
    return Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(freqHz / 440))));
  }

  function notePitch(buf, noteIndex, freqTable, octaveTable) {
    if (freqTable + noteIndex >= buf.length || octaveTable + noteIndex >= buf.length) return null;
    const freqByte = buf[freqTable + noteIndex];
    const octave = buf[octaveTable + noteIndex];
    const freqHigh = (freqByte & 0x38) | (octave >> 5);
    const freqLow = (freqByte & 0x07) | (octave << 3);
    return ymFreqToMidi(freqHigh, freqLow);
  }

  /**
   * @param {Buffer|Uint8Array} buf
   * @param {number} channelHeader - ROM offset of channel block (word0 = seq rel); null for raw SFX stream
   * @param {object} meta - noteFreqTable, noteOctaveTable, soundBase, instrumentTable, durationMult
   * @param {object} [opts] - channel, endPos, maxTime, maxEvents
   */
  function parseChannelSequence(buf, channelHeader, meta, opts) {
    const soundBase = meta.soundBase;
    const durationMult = meta.durationMult || 6;
    const freqTable = meta.noteFreqTable;
    const octaveTable = meta.noteOctaveTable;
    const instrumentTable = meta.instrumentTable != null ? meta.instrumentTable : 0x116A6;
    const channel = (opts && opts.channel) || 0;
    const endPos = opts && opts.endPos != null ? opts.endPos : buf.length;
    const maxTime = (opts && opts.maxTime) || 48;
    const maxEvents = (opts && opts.maxEvents) || 800;
    const minMidi = (opts && opts.minMidi) != null ? opts.minMidi : 20;

    let seqPos;
    let loopBase = 0;
    let loopPtr = 0;
    let hasLoopTable = false;

    if (channelHeader != null && channelHeader >= 0) {
      loopBase = channelHeader;
      loopPtr = channelHeader + 2;
      hasLoopTable = true;
      seqPos = readWord(buf, channelHeader) + soundBase;
    } else {
      seqPos = opts && opts.seqStart != null ? opts.seqStart : 0;
    }

    let durationTicks = durationMult;
    let pitchAdjust = 0;
    let instrTranspose = 0;
    let instrument = 0;
    let loopCounter = 0;
    let loopOps = 0;
    let time = 0;
    const events = [];
    let guard = 80000;
    let stop = false;

    function parseLoopCommand() {
      if (!hasLoopTable || loopOps >= MAX_LOOP_OPS) {
        stop = true;
        return;
      }
      loopOps++;
      if (loopPtr + 2 > buf.length) return;
      const tag = readWord(buf, loopPtr);
      if (tag === 0) {
        loopPtr = loopBase;
        const rel = readWord(buf, loopPtr);
        loopPtr += 2;
        seqPos = rel + soundBase;
        return;
      }
      if (tag === 1) {
        stop = true;
        return;
      }
      if (tag === 2) {
        if (loopPtr + 4 > buf.length) return;
        loopCounter = readWord(buf, loopPtr + 2);
        const rel = readWord(buf, loopPtr - 2);
        seqPos = rel + soundBase;
        return;
      }
      seqPos = tag + soundBase;
      loopPtr += 2;
    }

    function handleLoop() {
      if (!hasLoopTable) return;
      if (loopCounter > 0) {
        loopCounter--;
        if (loopCounter === 0) {
          loopPtr += 4;
          parseLoopCommand();
        } else {
          const rel = readWord(buf, loopPtr - 2);
          seqPos = rel + soundBase;
        }
        return;
      }
      parseLoopCommand();
    }

    while (guard-- > 0 && !stop && events.length < maxEvents && time < maxTime) {
      if (seqPos < 0 || seqPos >= endPos || seqPos >= buf.length) break;
      const byte = buf[seqPos++];

      if (byte < 0x80) {
        if (byte === 0x60) {
          time += durationTicks / TICK_HZ;
          continue;
        }
        const noteIndex = addByte(addByte(byte, signedByte(instrTranspose)), signedByte(pitchAdjust));
        const midi = notePitch(buf, noteIndex, freqTable, octaveTable);
        if (midi != null && midi >= minMidi) {
          const durSec = durationTicks / TICK_HZ;
          events.push({
            time,
            midi,
            duration: durSec,
            instrument,
            channel
          });
        }
        time += durationTicks / TICK_HZ;
        continue;
      }

      switch (byte) {
        case 0x80:
          instrument = buf[seqPos++];
          {
            const patchOff = instrumentTable + instrument * 32;
            if (patchOff + 0x1a < buf.length) instrTranspose = buf[patchOff + 0x1a];
          }
          break;
        case 0x81:
          seqPos += 2;
          break;
        case 0x83:
        case 0x89:
          break;
        case 0x84:
          handleLoop();
          break;
        case 0x85:
          stop = true;
          break;
        case 0x86:
          seqPos += 2;
          break;
        case 0x87:
          break;
        case 0x88:
          pitchAdjust = buf[seqPos++];
          break;
        case 0x8a:
        case 0x8b:
          seqPos++;
          break;
        default:
          if (byte >= 0xa0) {
            durationTicks = Math.max(1, (byte - 0xa0) * durationMult);
          }
          break;
      }
    }

    const duration = events.reduce((m, e) => Math.max(m, e.time + e.duration), 0);
    return { events, duration, durationMult: durationMult };
  }

  return {
    parseChannelSequence,
    ymFreqToMidi,
    readWord
  };
});
