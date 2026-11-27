/**
 * Finds the user's NHL HOCKEY '94 Sega CD dump under roms/ without depending on how it was ripped or named.
 *
 * The disc is recognised by its contents (a data track with GRAPH2.BIN, HOCKEY.BIN and STARTER.BIN), not by file names. It
 * can be a plain .iso/.img/.bin/.mdf of the data track (2048 byte sectors, or raw 2352/2336/2448 byte sectors, with or
 * without the 2 second pregap), a .cue sheet in any folder up to three levels down (the data track is any file it names, one
 * file per track or one file for the disc, and a data file that was renamed is found by its contents), or a CloneCD .ccd with
 * its .img. The music comes from the sheet's audio tracks (raw 2352 byte sectors or 16-bit stereo 44.1 kHz WAVE), or, when
 * there is no sheet, from numbered track files beside the disc ("Track02.wav", "02 - Name.bin", "... (Track 07).bin").
 *
 * What cannot be read (.chd, .nrg, .mds descriptors, .cdi, .gdi, archives, FLAC/MP3/OGG music) is reported in `notes`, so the
 * Audio tab can say what to convert instead of showing nothing.
 */
const fs = require('fs');
const path = require('path');
const iso9660 = require('./iso9660');
const cue = require('./cue');

const DISC_FILES = ['GRAPH2.BIN', 'HOCKEY.BIN', 'STARTER.BIN'];
const DISC_EXT = /\.(iso|img|bin|mdf|raw|dat)$/i;
const MAX_DEPTH = 3;
const FRAME = 2352;
const RATE_BYTES = 44100 * 4;

/** A folder, following symlinks and junctions. */
function isDir(ent, full) {
  if (ent.isDirectory()) return true;
  if (!ent.isSymbolicLink()) return false;
  try { return fs.statSync(full).isDirectory(); } catch (err) { return false; }
}

function walk(dir, depth, out, seen) {
  seen = seen || new Set();
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { return out; }
  for (const ent of list) {
    const full = path.join(dir, ent.name);
    if (isDir(ent, full)) {
      let real = full;
      try { real = fs.realpathSync(full); } catch (err) { /* keep the link path */ }
      if (depth < MAX_DEPTH && !seen.has(real)) { seen.add(real); walk(full, depth + 1, out, seen); }
    } else out.push(full);
  }
  return out;
}

/** True when the file is a data track of this disc (any supported sector layout). */
function isDisc(file) {
  let disc = null;
  try {
    disc = iso9660.openFile(file);
    if (!disc) return false;
    const names = new Set(disc.names().map((n) => n.toUpperCase()));
    return DISC_FILES.every((n) => names.has(n));
  } catch (err) {
    return false;
  } finally {
    try { if (disc && disc.close) disc.close(); } catch (err) { /* nothing to do */ }
  }
}

// ---- CloneCD (.ccd + .img) ----

/** [{number, data, lba}] from a CloneCD control file (Point 0x01-0x63 entries; Control bit 2 marks data), or []. */
function parseCcd(file) {
  let text = '';
  try { text = cue.sheetText(fs.readFileSync(file)); } catch (err) { return []; }
  const out = [];
  let cur = null;
  for (const line of text.split(/\r\n|\n|\r/)) {
    if (/^\s*\[Entry\s+\d+\]/i.test(line)) { cur = {}; out.push(cur); continue; }
    if (/^\s*\[/.test(line)) { cur = null; continue; }
    const m = /^\s*(\w+)\s*=\s*(\S+)/.exec(line);
    if (m && cur) cur[m[1].toLowerCase()] = m[2];
  }
  const num = (v) => (v == null ? NaN : (/^0x/i.test(v) ? parseInt(v, 16) : parseInt(v, 10)));
  const tracks = [];
  for (const e of out) {
    const point = num(e.point);
    if (!(point >= 1 && point <= 99)) continue;
    tracks.push({ number: point, data: (num(e.control) & 4) !== 0, lba: num(e.plba) });
  }
  return tracks.filter((t) => Number.isFinite(t.lba)).sort((a, b) => a.number - b.number);
}

/** The .img beside a .ccd (same name, any capitalisation), or null. */
function ccdImage(ccd) {
  const base = path.basename(ccd).replace(/\.ccd$/i, '').toLowerCase();
  const dir = path.dirname(ccd);
  let names = [];
  try { names = fs.readdirSync(dir); } catch (err) { return null; }
  const hit = names.find((n) => n.toLowerCase() === base + '.img') || names.find((n) => n.toLowerCase() === base + '.bin');
  return hit ? path.join(dir, hit) : null;
}

// ---- loose track files ----

const AUDIO_EXT = /\.(bin|raw|wav|cdda)$/i;
const UNPLAYABLE_AUDIO = /\.(flac|mp3|ogg|ape|wv|m4a|aac|opus|aif|aiff)$/i;

/** How a file name carries its track number: 'word' ("Track 07"), 'lead' ("02 - Name"), 'last' (the last number), or null. */
function trackRule(name) {
  const stem = name.replace(/\.[^.]*$/, '');
  if (/track\s*[-_ ]*0*(\d{1,3})(?!\d)/i.test(stem)) return 'word';
  if (/^\s*0*(\d{1,3})(?!\d)/.test(stem)) return 'lead';
  return /(?<!\d)0*(\d{1,3})(?!\d)/.test(stem) ? 'last' : null;
}

/** The track number in a file name: "Track 07", "track07", "02 - Name", "Name - 02": by the rule above, else null. */
function trackNumber(name) {
  const stem = name.replace(/\.[^.]*$/, '');
  const rule = trackRule(name);
  if (rule === 'word') return Number(/track\s*[-_ ]*0*(\d{1,3})(?!\d)/i.exec(stem)[1]);
  if (rule === 'lead') return Number(/^\s*0*(\d{1,3})(?!\d)/.exec(stem)[1]);
  if (rule === 'last') {
    const all = [...stem.matchAll(/(?<!\d)0*(\d{1,3})(?!\d)/g)];
    return Number(all[all.length - 1][1]);
  }
  return null;
}

/** True when a loose file looks like one track of CD audio (raw 2352 byte sectors that are not a data track, or a playable WAVE). */
function looseAudioEntry(file, dataFiles) {
  if (dataFiles.has(file)) return null;
  const ext = path.extname(file).toLowerCase();
  if (ext === '.wav') {
    const w = cue.wavInfo(file);
    return w && w.ok ? { file, kind: 'wav', skip: w.offset, end: w.offset + w.length } : null;
  }
  let size = 0;
  try { size = fs.statSync(file).size; } catch (err) { return null; }
  if (size < FRAME * 150 || size % FRAME !== 0) return null;
  let data = false;
  try {
    const disc = iso9660.openFile(file);
    data = !!disc;
    if (disc && disc.close) disc.close();
  } catch (err) { data = false; }
  if (data) return null;
  // a raw track dump starts with its 2 second pregap (silence) when it came from a per-track rip
  return { file, kind: 'raw', skip: null, end: null };
}

/**
 * Numbered track files under the given folders, as {track, file, kind, skip, end}: the biggest group of files that share a name
 * name rule and extension, in the disc's own folder (2 or more) or anywhere else (10 or more).
 */
function looseTracks(files, dataFiles, discFolder) {
  const groups = new Map();
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!AUDIO_EXT.test(file) || ext === '.iso') continue;
    const num = trackNumber(path.basename(file));
    const rule = trackRule(path.basename(file));
    if (num == null || rule == null || num < 2 || num > 99) continue;
    const key = path.dirname(file) + '|' + rule + '|' + ext;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ file, num });
  }
  let best = null;
  for (const [key, list] of groups) {
    const folder = key.slice(0, key.indexOf('|'));
    const need = discFolder && folder === discFolder ? 2 : 10;
    if (list.length < need) continue;
    if (!best || list.length > best.list.length) best = { list, folder };
  }
  if (!best) return [];
  const out = [];
  const seen = new Set();
  for (const { file, num } of best.list.sort((a, b) => a.num - b.num)) {
    if (seen.has(num)) continue;
    const e = looseAudioEntry(file, dataFiles);
    if (!e) continue;
    seen.add(num);
    out.push(Object.assign({ track: num }, e));
  }
  return out;
}

// ---- the disc ----

/** Descriptor and compressed formats Studio cannot open: [{file, what}]. */
function unreadable(files) {
  const out = [];
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    const what = { '.chd': 'CHD (convert with chdman extractcd to .cue/.bin)', '.nrg': 'Nero .nrg (convert to .cue/.bin)', '.cdi': 'DiscJuggler .cdi (convert to .cue/.bin)', '.gdi': 'Dreamcast .gdi (not a Sega CD format)', '.mds': 'Alcohol .mds descriptor (use the .mdf as the data track; the music needs a .cue)', '.zip': 'an archive (unpack it)', '.7z': 'an archive (unpack it)', '.rar': 'an archive (unpack it)', '.ecm': 'ECM-compressed (unecm it)' }[ext];
    if (what && /94|hockey|nhl|sega|disc|cd/i.test(path.basename(f))) out.push({ file: f, what });
  }
  return out;
}

/**
 * {image, dataFile, sheet, folder, sheets, kind, audio, notes} or null. `image` is what the rest of Studio opens (the .cue when the
 * disc came from one, else the data track file), `dataFile` the file with the data track, `kind` how it was found ('cue', 'ccd',
 * 'raw', 'iso'), `sheets` every .cue with audio tracks that belong to this disc, `audio` the playable audio tracks
 * ({track, file, kind, skip, end}) and `notes` plain-language remarks about anything it could not use.
 */
function find(root) {
  const files = walk(root, 0, []);
  const cues = files.filter((f) => /\.cue$/i.test(f));
  const ccds = files.filter((f) => /\.ccd$/i.test(f));
  const notes = [];
  let found = null;
  const candidates = () => files.filter((f) => DISC_EXT.test(f));

  for (const sheet of cues) {
    const track = cue.dataTrack(sheet);
    if (!track) continue;
    let data = track.file;
    if (!data || !isDisc(data)) {
      // a data file that was renamed or moved: the disc file in the sheet's folder (or below it) with the right contents
      data = null;
      const folder = path.dirname(sheet);
      const near = candidates().filter((f) => path.dirname(f) === folder || path.dirname(f).startsWith(folder + path.sep));
      if (track.file == null || near.length) data = near.find((f) => isDisc(f)) || null;
    }
    if (data) { found = { image: sheet, dataFile: data, sheet, folder: path.dirname(sheet), kind: 'cue' }; break; }
  }
  if (!found) {
    for (const ccd of ccds) {
      const img = ccdImage(ccd);
      if (img && isDisc(img)) { found = { image: img, dataFile: img, sheet: null, ccd, folder: path.dirname(ccd), kind: 'ccd' }; break; }
    }
  }
  if (!found) {
    const plain = candidates().find((f) => isDisc(f));
    if (plain) found = { image: plain, dataFile: plain, sheet: null, folder: path.dirname(plain), kind: /\.iso$/i.test(plain) ? 'iso' : 'raw' };
  }

  // Sheets with the music: the one tied to the disc, or any sheet with a good run of audio tracks (a dump whose data track is
  // only available as a separate .iso).
  const sheets = [];
  for (const sheet of cues) {
    if (found && found.sheet === sheet) { sheets.push(sheet); continue; }
    if (cue.audioTracks(sheet).length >= 10) sheets.push(sheet);
  }
  if (!found) {
    if (sheets.length || ccds.length) notes.push('Found music sheets but no data track with GRAPH2.BIN, HOCKEY.BIN and STARTER.BIN');
    for (const u of unreadable(files)) notes.push(path.basename(u.file) + ': ' + u.what);
    return null;
  }
  found.sheets = sheets;

  // The music, best source first: a sheet, a CloneCD table, then numbered files beside the disc.
  const audio = new Map();
  for (const sheet of sheets) {
    for (const t of cue.audioTracks(sheet)) {
      if (t.track >= 2 && t.track <= 99 && !audio.has(t.track)) audio.set(t.track, t);
    }
    for (const u of cue.unsupported(sheet)) notes.push('Track ' + u.track + ' is ' + u.type + ' (' + (u.file ? path.basename(u.file) : 'missing') + '): convert it to .bin or 16-bit stereo 44.1 kHz .wav');
  }
  if (found.ccd) {
    const tracks = parseCcd(found.ccd);
    tracks.forEach((t, i) => {
      if (t.data || t.number < 2 || audio.has(t.number)) return;
      const next = tracks[i + 1];
      audio.set(t.number, { track: t.number, file: found.dataFile, kind: 'raw', skip: t.lba * FRAME, end: next ? next.lba * FRAME : null });
    });
  }
  const dataFiles = new Set(files.filter((f) => DISC_EXT.test(f) && isDisc(f)));
  dataFiles.add(found.dataFile);
  if (audio.size < 10) {
    for (const t of looseTracks(files, dataFiles, found.folder)) if (!audio.has(t.track)) audio.set(t.track, t);
  }
  found.audio = [...audio.values()].sort((a, b) => a.track - b.track);
  const lossy = files.filter((f) => UNPLAYABLE_AUDIO.test(f) && /track|94|hockey|nhl|\d\d/i.test(path.basename(f)));
  if (!found.audio.length && lossy.length) notes.push(lossy.length + ' music files are ' + path.extname(lossy[0]).slice(1).toUpperCase() + ' (not supported): convert them to .wav (16-bit stereo 44.1 kHz) or use the .bin/.cue');
  for (const u of unreadable(files)) notes.push(path.basename(u.file) + ': ' + u.what);
  found.notes = notes;
  return found;
}

let cache = { root: '', at: 0, value: null };
/** find() remembered for a few seconds, since every request asks. */
function findCached(root) {
  const now = Date.now();
  if (cache.root === root && now - cache.at < 3000) return cache.value;
  const value = find(root);
  cache = { root, at: now, value };
  return value;
}

module.exports = { find, findCached, isDisc, trackNumber, trackRule, looseTracks, parseCcd, RATE_BYTES };
