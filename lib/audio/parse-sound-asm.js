/**
 * Parse SoundStreamTable labels from NHLPA93Genesis / NHL94Genesis sound*.asm.
 */
const fs = require('fs');

function parseSoundStreamTable(asmText) {
  const lines = asmText.split(/\r?\n/);
  let inTable = false;
  let inSongTable = false;
  const entries = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^SoundStreamTable\b/i.test(trimmed)) {
      inTable = true;
      inSongTable = false;
      continue;
    }
    if (/^SongPointerTable\b/i.test(trimmed)) {
      inSongTable = true;
      continue;
    }
    if (!inTable && !inSongTable) continue;
    if (!trimmed || trimmed.startsWith(';') && !/dc\.[wl]/i.test(trimmed)) {
      if (entries.length && !/^dc\./i.test(trimmed)) break;
      continue;
    }
    const mWord = /dc\.w\s+(\w+)-SoundStreamTable\s*;(.*)$/i.exec(trimmed);
    const mLong = /dc\.l\s+(\w+)\s*;(.*)$/i.exec(trimmed);
    if (mWord) {
      const comment = (mWord[2] || '').trim();
      const idMatch = /sound \$([0-9A-Fa-f]+)/i.exec(comment) || /song \$([0-9A-Fa-f]+)/i.exec(comment);
      const soundId = idMatch ? parseInt(idMatch[1], 16) : entries.length;
      entries.push({
        soundId,
        symbol: mWord[1],
        comment,
        ptrKind: 'word-rel'
      });
      continue;
    }
    if (mLong) {
      const comment = (mLong[2] || '').trim();
      const idMatch = /sound \$([0-9A-Fa-f]+)/i.exec(comment) || /song \$([0-9A-Fa-f]+)/i.exec(comment);
      const soundId = idMatch ? parseInt(idMatch[1], 16) : entries.length;
      entries.push({
        soundId,
        symbol: mLong[1],
        comment,
        ptrKind: 'long-abs'
      });
      continue;
    }
    if (/^\w+.*_cmdstream\b/i.test(trimmed) && !/^dc\./i.test(trimmed) && entries.length) break;
  }
  return entries;
}

function streamKeyFromFile(name) {
  return name
    .replace(/\.bin$/, '')
    .replace(/_cmdstream94$/, '_cmdstream')
    .replace(/_cmdstream$/, '');
}

function parseExtractCmdstreams(extractJsText) {
  const map = new Map();
  const re = /\{ name: '([^']+cmdstream[^']*\.bin)', folder: '[^']+', start: (0x[0-9A-Fa-f]+), end: (0x[0-9A-Fa-f]+) \},?[^/]*\/\/(.*)$/gm;
  let m;
  while ((m = re.exec(extractJsText)) !== null) {
    const key = streamKeyFromFile(m[1]);
    map.set(key, {
      start: parseInt(m[2], 16),
      end: parseInt(m[3], 16),
      blurb: (m[4] || '').trim()
    });
  }
  return map;
}

function humanLabel(symbol, comment, blurb) {
  if (blurb) {
    const afterColon = blurb.split(':').slice(1).join(':').trim();
    if (afterColon) return afterColon.replace(/\s*\(92.*\)\s*$/i, '').trim();
  }
  if (comment) {
    const song = /song \$[0-9A-Fa-f]+:\s*(.+)/i.exec(comment);
    if (song) return song[1].trim();
    const snd = /sound \$[0-9A-Fa-f]+:\s*(.+)/i.exec(comment);
    if (snd) return snd[1].trim();
  }
  return symbol.replace(/_cmdstream$/, '').replace(/_/g, ' ');
}

function mergeStreamCatalog(tableEntries, extractMap) {
  const out = [];
  for (const row of tableEntries) {
    const key = streamKeyFromFile(row.symbol);
    const slice = extractMap.get(key);
    if (!slice) continue;
    const isSong = row.soundId >= 0x30;
    out.push({
      id: 'snd-' + row.soundId.toString(16).padStart(2, '0'),
      soundId: row.soundId,
      label: humanLabel(row.symbol, row.comment, slice.blurb),
      group: isSong ? 'Music' : 'SFX',
      type: 'fm-stream',
      start: slice.start,
      end: slice.end,
      playable: true,
      blurb: slice.blurb || row.comment || null,
      symbol: row.symbol
    });
  }
  return out;
}

function loadMerged(gameId, asmPath, extractPath) {
  const asm = fs.readFileSync(asmPath, 'utf8');
  const extract = fs.readFileSync(extractPath, 'utf8');
  const table = parseSoundStreamTable(asm);
  const slices = parseExtractCmdstreams(extract);
  const streams = mergeStreamCatalog(table, slices);
  return { gameId, streams, tableFormat: table[0] && table[0].ptrKind === 'long-abs' ? 'long-abs' : 'word-rel' };
}

module.exports = {
  parseSoundStreamTable,
  parseExtractCmdstreams,
  mergeStreamCatalog,
  loadMerged,
  humanLabel
};
