/**
 * Heuristic scans for Genesis Hockey.snd layout (digital anchor, FMTune table).
 * Used when building catalogs from a retail ROM path.
 */
const { DIGITAL_SAMPLE_MAGIC, SOUND_BASE } = require('./genesis-constants');

function findMagic(buf, start, end, preferOffset) {
  const needle = DIGITAL_SAMPLE_MAGIC;
  const hi = Math.min(buf.length, end) - needle.length;
  const hits = [];
  for (let i = Math.max(0, start); i <= hi; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) hits.push(i);
  }
  if (!hits.length) return null;
  if (preferOffset == null) return hits[0];
  let best = hits[0];
  let bestDist = Math.abs(best - preferOffset);
  for (const hit of hits) {
    const dist = Math.abs(hit - preferOffset);
    if (dist < bestDist) {
      best = hit;
      bestDist = dist;
    }
  }
  return best;
}

function readLong(buf, offset) {
  if (offset < 0 || offset + 4 > buf.length) return 0;
  return ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0;
}

function looksLikeFmtuneTrack(buf, tableOffset, soundBase) {
  if (tableOffset + 0x1A > buf.length) return false;
  const fmChannels = buf[tableOffset];
  if (fmChannels > 5) return false;
  const ptr = readLong(buf, tableOffset + 2);
  const abs = ptr + soundBase;
  if (abs < soundBase || abs >= buf.length - 4) return false;
  const seqRel = (buf[abs] << 8) | buf[abs + 1];
  const seqAbs = seqRel + soundBase;
  return seqAbs > soundBase && seqAbs < buf.length;
}

/**
 * Scan Hockey.snd for FMTune header table (NHL 92-style stride 0x1A).
 * @returns {{ fmtuneTable: number, fmtuneTracks: number, fmtuneStride: number } | null}
 */
function countFmtuneTracks(buf, tableOffset, soundBase, stride, maxTracks) {
  let tracks = 0;
  for (let t = 0; t < maxTracks; t++) {
    if (!looksLikeFmtuneTrack(buf, tableOffset + t * stride, soundBase)) break;
    tracks++;
  }
  return tracks;
}

function scanFmtuneTable(buf, opts) {
  const soundBase = (opts && opts.soundBase) || SOUND_BASE;
  const regionStart = (opts && opts.hockeySndStart) || soundBase;
  const regionEnd = (opts && opts.hockeySndEnd) || buf.length;
  const stride = 0x1A;
  const maxTracks = 8;
  if (opts && opts.fmtuneTable != null) {
    const tracks = countFmtuneTracks(buf, opts.fmtuneTable, soundBase, stride, maxTracks);
    if (tracks >= 4) {
      return { fmtuneTable: opts.fmtuneTable, fmtuneTracks: tracks, fmtuneStride: stride };
    }
  }
  for (let off = regionStart; off < regionEnd - stride * 2; off += 2) {
    const tracks = countFmtuneTracks(buf, off, soundBase, stride, maxTracks);
    if (tracks >= 4) {
      return { fmtuneTable: off, fmtuneTracks: tracks, fmtuneStride: stride };
    }
  }
  return null;
}

function scanGenesisAudio(buf, hints) {
  const soundBase = hints.soundBase || SOUND_BASE;
  const start = hints.hockeySndStart != null ? hints.hockeySndStart : soundBase;
  const end = hints.hockeySndEnd != null ? hints.hockeySndEnd : buf.length;
  const digitalAnchor = findMagic(buf, start, end, hints.digitalAnchor);
  const fmtune = scanFmtuneTable(buf, {
    soundBase,
    hockeySndStart: start,
    hockeySndEnd: end,
    fmtuneTable: hints.fmtuneTable
  });
  return { digitalAnchor, digitalMagicHits: findAllMagic(buf, start, end), fmtune };
}

function findAllMagic(buf, start, end) {
  const needle = DIGITAL_SAMPLE_MAGIC;
  const hi = Math.min(buf.length, end) - needle.length;
  const hits = [];
  for (let i = Math.max(0, start); i <= hi; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) hits.push(i);
  }
  return hits;
}

module.exports = { findMagic, scanFmtuneTable, scanGenesisAudio };
