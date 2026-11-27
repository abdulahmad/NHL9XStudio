/**
 * .cue sheet reader for Sega CD dumps ("NHL '94 (USA).cue" with one .bin per track, or one .bin for the whole disc).
 * Only what Studio needs: which file holds the data track (track 1) and where each audio track starts and ends.
 *
 * Sheets differ a lot between rippers (EAC, CDRWIN, ImgBurn, Redump's DiscImageCreator, IsoBuster, CloneCD converters ...), so
 * the reader is forgiving: any line ending (CRLF, LF, bare CR), a UTF-8 BOM or an old code page, keywords in any case, tabs, quoted
 * or bare file names (bare names may hold spaces), Windows or Unix paths, absolute paths that no longer exist (the file is looked
 * up by name beside the sheet and below it), REM/CATALOG/FLAGS/ISRC/CDTEXTFILE/PERFORMER/TITLE/PREGAP/POSTGAP lines, and FILE
 * types BINARY, MOTOROLA, WAVE, AIFF, MP3, FLAC, OGG, APE (only raw 2352 byte sectors and 16-bit stereo 44.1 kHz WAVE play).
 */
const fs = require('fs');
const path = require('path');

const FRAME = 2352; // bytes of one CD frame (audio, or a raw data sector)

function frames(mm, ss, ff) {
  return (Number(mm) * 60 + Number(ss)) * 75 + Number(ff);
}

const norm = (s) => String(s).replace(/\\/g, '/');

/** Every file below folder (depth levels), for finding a file a sheet names by a path that is not valid here. */
function listBelow(folder, depth, out, seen) {
  out = out || [];
  seen = seen || new Set();
  let list = [];
  try { list = fs.readdirSync(folder, { withFileTypes: true }); } catch (err) { return out; }
  for (const ent of list) {
    const full = path.join(folder, ent.name);
    let isDir = ent.isDirectory();
    if (!isDir && ent.isSymbolicLink()) { try { isDir = fs.statSync(full).isDirectory(); } catch (err) { isDir = false; } }
    if (isDir) {
      let real = full;
      try { real = fs.realpathSync(full); } catch (err) { /* keep the link */ }
      if (depth > 0 && !seen.has(real)) { seen.add(real); listBelow(full, depth - 1, out, seen); }
    } else out.push(full);
  }
  return out;
}

/**
 * The file a sheet names: beside the sheet with any capitalisation, by its path relative to the sheet, or (absolute paths from
 * another machine, renamed folders) by its bare name below the sheet's folder. null when it is not there.
 */
function resolveFile(folder, name) {
  const rel = norm(name).replace(/^\.\//, '');
  try { if (path.isAbsolute(name) && fs.statSync(name).isFile()) return name; } catch (err) { /* another machine's path */ }
  const direct = path.join(folder, rel);
  try {
    if (!/^(?:[a-z]:)?\//i.test(rel) && fs.statSync(direct).isFile()) {
      // on a case-insensitive file system the path as written works, but report the name the file really has
      const parent = path.dirname(direct);
      const actual = fs.readdirSync(parent).find((n) => n.toLowerCase() === path.basename(direct).toLowerCase());
      return actual ? path.join(parent, actual) : direct;
    }
  } catch (err) { /* try the others */ }
  const base = path.basename(rel).toLowerCase();
  const here = listBelow(folder, 0);
  let hit = here.find((f) => path.basename(f).toLowerCase() === base);
  if (hit) return hit;
  // by the relative path with any capitalisation, then by bare name anywhere below the sheet
  const tail = rel.toLowerCase();
  const all = listBelow(folder, 3);
  hit = all.find((f) => norm(path.relative(folder, f)).toLowerCase() === tail);
  if (hit) return hit;
  hit = all.find((f) => path.basename(f).toLowerCase() === base);
  return hit || null;
}

/** The text of a sheet: UTF-8, UTF-16 (a BOM) or an older single byte code page. */
function sheetText(raw) {
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) return raw.toString('utf16le').replace(/^﻿/, '');
  if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    const swapped = Buffer.from(raw.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  let text = raw.toString('utf8');
  if (text.indexOf('�') >= 0) text = raw.toString('latin1'); // not UTF-8: an older ripper's code page
  return text.replace(/^﻿/, '');
}

/**
 * [{number, audio, mode, sectorSize, name, type, file, index0, index1}] (indexes in frames inside that file), in cue order.
 * `type` is the FILE type word (BINARY, WAVE, ...), `sectorSize` the bytes per sector the mode implies (2352 for audio).
 */
function parse(cuePath) {
  let text = '';
  try { text = sheetText(fs.readFileSync(cuePath)); } catch (err) { return []; }
  const folder = path.dirname(cuePath);
  const tracks = [];
  let fileName = null;
  let fileType = 'BINARY';
  let file = null;
  let cur = null;
  for (const line of text.split(/\r\n|\n|\r/)) {
    let m = /^\s*FILE\s+(?:"([^"]+)"|'([^']+)')\s*(\w*)/i.exec(line);
    if (!m) {
      const bare = /^\s*FILE\s+(.+?)(?:\s+(BINARY|MOTOROLA|AIFF|WAVE|MP3|FLAC|OGG|APE|WAV))?\s*$/i.exec(line);
      if (bare) m = [line, bare[1], null, bare[2] || ''];
    }
    if (m) {
      fileName = m[1] || m[2];
      fileType = (m[3] || 'BINARY').toUpperCase();
      file = fileName ? resolveFile(folder, fileName) : null;
      cur = null;
      continue;
    }
    m = /^\s*TRACK\s+(\d+)\s+(\S+)/i.exec(line);
    if (m) {
      const audio = /^AUDIO$/i.test(m[2]);
      const size = /\/(\d+)/.exec(m[2]);
      cur = {
        number: Number(m[1]), audio, mode: m[2].toUpperCase(), sectorSize: audio ? FRAME : (size ? Number(size[1]) : FRAME),
        name: fileName, type: fileType, file, index0: null, index1: null
      };
      tracks.push(cur);
      continue;
    }
    m = /^\s*INDEX\s+(\d+)\s+(\d+):(\d+):(\d+)/i.exec(line);
    if (m && cur) {
      if (Number(m[1]) === 0) cur.index0 = frames(m[2], m[3], m[4]);
      else if (Number(m[1]) === 1) cur.index1 = frames(m[2], m[3], m[4]);
    }
  }
  return tracks;
}

/** The file holding the disc's data track (track 1), or null when the sheet or the file is missing. */
function dataFile(cuePath) {
  const t = parse(cuePath).find((x) => !x.audio);
  return t && t.file ? t.file : null;
}

/** The data track entry ({file, mode, sectorSize, ...}) of a sheet, or null. */
function dataTrack(cuePath) {
  return parse(cuePath).find((x) => !x.audio) || null;
}

/** Where the samples of a PCM WAVE file start and how long they are, and whether Studio can play them (16-bit stereo 44.1 kHz). */
function wavInfo(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(4096);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    if (n < 44 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') return null;
    let at = 12;
    let fmt = null;
    while (at + 8 <= n) {
      const id = head.toString('latin1', at, at + 4);
      const size = head.readUInt32LE(at + 4);
      if (id === 'fmt ') fmt = { tag: head.readUInt16LE(at + 8), channels: head.readUInt16LE(at + 10), rate: head.readUInt32LE(at + 12), bits: head.readUInt16LE(at + 22) };
      if (id === 'data') {
        const total = fs.fstatSync(fd).size;
        const length = Math.min(size, total - (at + 8)) >>> 0;
        return { offset: at + 8, length: size === 0xffffffff || size === 0 ? total - (at + 8) : length, ok: !!fmt && (fmt.tag === 1 || fmt.tag === 0xfffe) && fmt.channels === 2 && fmt.bits === 16 && fmt.rate === 44100, fmt };
      }
      at += 8 + size + (size & 1);
    }
    return null;
  } catch (err) {
    return null;
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch (err) { /* closed */ }
  }
}

/**
 * The audio tracks as {track, file, kind, skip, end}: skip is the byte offset where the music starts (INDEX 01), end the byte
 * offset where the track stops (or null for the end of the file); kind is 'raw' (2352 byte sectors) or 'wav' (the offsets count
 * from the start of the file, WAVE header included). Works for one file per track and for a single file for the whole disc.
 * Tracks whose file is a format Studio cannot play (FLAC, MP3, ...) are left out; see unsupported().
 */
function audioTracks(cuePath) {
  const tracks = parse(cuePath);
  const out = [];
  tracks.forEach((t, i) => {
    if (!t.audio || !t.file) return;
    if (!/^(BINARY|MOTOROLA|WAVE|WAV)$/i.test(t.type)) return;
    // A track with only INDEX 00 (rare) starts there; none at all starts at the top of its file.
    const start = t.index1 != null ? t.index1 : (t.index0 != null ? t.index0 : 0);
    const next = tracks[i + 1];
    let wav = null;
    if (/^WAVE?$/i.test(t.type) || /\.wav$/i.test(t.file)) {
      wav = wavInfo(t.file);
      if (!wav || !wav.ok) return;
    }
    const base = wav ? wav.offset : 0;
    let end = null;
    if (next && next.file === t.file) {
      const at = next.index0 != null ? next.index0 : next.index1;
      if (at != null) end = base + at * FRAME;
    }
    if (wav && end == null) end = wav.offset + wav.length;
    out.push({ track: t.number, file: t.file, kind: wav ? 'wav' : 'raw', skip: base + start * FRAME, end });
  });
  return out;
}

/** Audio tracks the sheet lists in formats Studio cannot play: [{track, file, type}] (FLAC, MP3, OGG, APE, AIFF, odd WAVE). */
function unsupported(cuePath) {
  const out = [];
  for (const t of parse(cuePath)) {
    if (!t.audio) continue;
    if (/^(FLAC|MP3|OGG|APE|AIFF)$/i.test(t.type)) out.push({ track: t.number, file: t.file, type: t.type.toUpperCase() });
    else if (t.file && (/^WAVE?$/i.test(t.type) || /\.wav$/i.test(t.file))) {
      const w = wavInfo(t.file);
      if (!w || !w.ok) out.push({ track: t.number, file: t.file, type: 'WAVE (not 16-bit stereo 44.1 kHz)' });
    }
  }
  return out;
}

/** How many AUDIO tracks the sheet lists, whether or not their files are present. */
function audioCount(cuePath) {
  return parse(cuePath).filter((t) => t.audio).length;
}

module.exports = { parse, dataFile, dataTrack, audioTracks, audioCount, unsupported, wavInfo, resolveFile, sheetText, listBelow, FRAME };
