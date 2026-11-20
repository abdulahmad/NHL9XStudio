/**
 * NHL 94 Sega CD music. The game plays its songs as CD-DA (Red Book audio) tracks 2 to 79, not from the ISO's data
 * track (track 1). A dump keeps them as one raw file per track: "NHL '94 (USA) (Track 07).bin", 2352-byte sectors of
 * 16-bit little-endian stereo at 44100 Hz, each file starting with its pregap (about 2 seconds of silence; the
 * .cue file has the exact INDEX 01 times).
 *
 * Studio looks for those files next to the disc image (roms/ and one folder level below it). Per
 * docs/segacd-handoff/segacd_audio.md in NHL94Genesis: the game's song request $30-$77 becomes track song - $29,
 * so tracks 7-78 are songs $30-$77.
 */
const fs = require('fs');
const path = require('path');
const cue = require('../cue');

const RATE = 44100;
const SECTOR = 2352;
const PREGAP = 150; // sectors, when no .cue says otherwise

// "NHL '94 (USA) (Track 07).bin", "NHL94CD (Track 7).bin", "nhl94cd_track07.wav"
const TRACK_ANY = /track\s*0*(\d+)[^\d]*\.(bin|raw|wav)$/i;
const TRACK_FILE = /^(?=.*94).*track\s*0*(\d+)[^\d]*\.(bin|raw|wav)$/i;

/** Every CD track file under dir (one folder level down too): [{track, file, kind}] sorted by track number. */
function findTracks(dir, opts) {
  const found = new Map();
  const scan = (folder, depth, anyName) => {
    let names = [];
    try { names = fs.readdirSync(folder, { withFileTypes: true }); } catch (err) { return; }
    for (const ent of names) {
      const full = path.join(folder, ent.name);
      let isDir = ent.isDirectory();
      if (!isDir && ent.isSymbolicLink()) { try { isDir = fs.statSync(full).isDirectory(); } catch (err) { isDir = false; } }
      if (isDir) { if (depth < 1) scan(full, depth + 1, anyName); continue; }
      const m = (anyName ? TRACK_ANY : TRACK_FILE).exec(ent.name);
      if (!m) continue;
      const track = Number(m[1]);
      if (track < 2 || track > 99 || found.has(track)) continue;
      found.set(track, { track, file: full, kind: m[2].toLowerCase() === 'wav' ? 'wav' : 'raw' });
    }
  };
  scan(dir, 0);
  // A .cue sheet (one .bin per track, or one .bin for the disc) names the tracks exactly, whatever the files are called.
  const sheets = (opts && opts.sheets) || [];
  for (const sheet of sheets) {
    for (const t of cue.audioTracks(sheet)) {
      if (t.track < 2 || t.track > 99) continue;
      found.set(t.track, { track: t.track, file: t.file, kind: t.kind || 'raw', skip: t.skip, end: t.end });
    }
  }
  // Loose track files beside the disc, with any naming ("... (Track 07).bin", "track07.wav"), when no sheet names them.
  for (const folder of (opts && opts.folders) || []) scan(folder, 1, true);
  return [...found.values()].sort((a, b) => a.track - b.track);
}

/** INDEX 01 minus INDEX 00 per track number from the .cue beside the files, in sectors. */
function pregaps(folder) {
  const out = new Map();
  let cues = [];
  try { cues = fs.readdirSync(folder).filter((n) => /\.cue$/i.test(n)); } catch (err) { return out; }
  for (const cue of cues) {
    let text = '';
    try { text = fs.readFileSync(path.join(folder, cue), 'latin1'); } catch (err) { continue; }
    let track = 0;
    let idx0 = 0;
    for (const line of text.split(/\r?\n/)) {
      let m = /^\s*TRACK\s+(\d+)/i.exec(line);
      if (m) { track = Number(m[1]); idx0 = 0; continue; }
      m = /^\s*INDEX\s+(\d+)\s+(\d+):(\d+):(\d+)/i.exec(line);
      if (!m || !track) continue;
      const at = (Number(m[2]) * 60 + Number(m[3])) * 75 + Number(m[4]);
      if (Number(m[1]) === 0) idx0 = at;
      else if (Number(m[1]) === 1) out.set(track, Math.max(0, at - idx0));
    }
  }
  return out;
}

function wavData(buf) {
  // RIFF WAVE, 16-bit PCM: find the data chunk.
  let at = 12;
  while (at + 8 <= buf.length) {
    const id = buf.toString('latin1', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'data') return buf.subarray(at + 8, Math.min(buf.length, at + 8 + size));
    at += 8 + size + (size & 1);
  }
  return null;
}

/** Track length in seconds (after the pregap) without reading the file. */
function seconds(entry, pregapSectors) {
  const size = fs.statSync(entry.file).size;
  if (entry.kind === 'wav') {
    if (entry.skip != null) return Math.max(0, (Math.min(size, entry.end != null ? entry.end : size) - entry.skip) / (RATE * 4));
    return Math.max(0, (size - 44) / (RATE * 4));
  }
  const start = entry.skip != null ? entry.skip : (pregapSectors == null ? PREGAP : pregapSectors) * SECTOR;
  const stop = entry.end != null ? Math.min(size, entry.end) : size;
  return Math.max(0, (stop - start) / (RATE * 4));
}

/** Little-endian 16-bit mono (both channels averaged) at 44100 Hz, pregap removed. */
function readMono(entry, pregapSectors) {
  let buf = fs.readFileSync(entry.file);
  if (entry.kind === 'wav') {
    if (entry.skip != null) buf = buf.subarray(entry.skip, entry.end != null ? entry.end : buf.length);
    else buf = wavData(buf);
    if (!buf) return null;
  } else {
    const start = entry.skip != null ? entry.skip : (pregapSectors == null ? PREGAP : pregapSectors) * SECTOR;
    buf = buf.subarray(start, entry.end != null ? entry.end : buf.length);
  }
  const frames = Math.floor(buf.length / 4);
  const out = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    out.writeInt16LE((buf.readInt16LE(i * 4) + buf.readInt16LE(i * 4 + 2)) >> 1, i * 2);
  }
  return out;
}

module.exports = { RATE, SECTOR, PREGAP, findTracks, pregaps, seconds, readMono, TRACK_FILE };
