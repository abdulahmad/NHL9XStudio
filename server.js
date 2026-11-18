const http = require('http');
const fs = require('fs');
const path = require('path');
const { GAMES, gameById, revAdjust, sheetGameBanks } = require('./lib/games');
const Revisions = require('./lib/revisions');
const { APP_NAME } = require('./lib/studio');
const { buildManifest } = require('./lib/manifest');
const pc95 = require('./lib/pc95');
const iso9660 = require('./lib/iso9660');
const audio = require('./lib/audio');
const genesis95Pals = require('./lib/genesis95-pals');
const httpCache = require('./lib/http-cache');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const LIB = path.join(ROOT, 'lib');
const DATA = path.join(ROOT, 'data');
// The ANIM-To-BMP checkout next to this one, else the copies bundled in test/fixtures (what GitHub Pages serves).
const ANIM_DIR = [path.join(ROOT, '..', 'ANIM-To-BMP'), path.join(ROOT, 'test', 'fixtures', 'ANIM-To-BMP')]
  .find((dir) => fs.existsSync(path.join(dir, 'Sprites.anim'))) || path.join(ROOT, '..', 'ANIM-To-BMP');
// A sibling ANIM-To-BMP checkout wins; otherwise the copies bundled in data/pals (what GitHub Pages serves).
const palDir = (sibling, bundled) => (fs.existsSync(sibling) && fs.readdirSync(sibling).some((name) => /\.pal$/i.test(name)) ? sibling : path.join(DATA, 'pals', bundled));
const PAL_DIRS = {
  '92': palDir(path.join(ANIM_DIR, 'Palettes'), 'genesis'),
  '94': palDir(path.join(ROOT, '..', 'ANIM94-To-BMP', 'Palettes'), 'genesis'),
  '95': palDir(path.join(ROOT, '..', 'ANIM95-To-BMP', 'Palettes', 'NHL95'), 'genesis95'),
  '96': palDir(path.join(ROOT, '..', 'ANIM96-To-BMP', 'Palettes', 'NHL96'), 'genesis96'),
  'snes': path.join(DATA, 'pals', 'snes')
};
const PAL_DIR = PAL_DIRS['92'];
const ROM_DIR = path.join(ROOT, 'roms');
const PC_DIRS = {
  // NHL_PC95_DIR / NHL_PC94_DIR / NHL_PC96_DIR point at an installed game folder instead of pc95/ / pc94/ / pc96/ here.
  pc95: process.env.NHL_PC95_DIR ? path.resolve(process.env.NHL_PC95_DIR) : path.join(ROOT, 'pc95'),
  pc94: process.env.NHL_PC94_DIR ? path.resolve(process.env.NHL_PC94_DIR) : path.join(ROOT, 'pc94'),
  pc96: process.env.NHL_PC96_DIR ? path.resolve(process.env.NHL_PC96_DIR) : path.join(ROOT, 'pc96'),
  pc97: process.env.NHL_PC97_DIR ? path.resolve(process.env.NHL_PC97_DIR) : path.join(ROOT, 'pc97')
};

function isPcKind(kind) {
  return kind === 'pc95' || kind === 'pc94' || kind === 'pc96' || kind === 'pc97';
}
const BANKS = new Set(['Sprites.anim', 'Puck.anim', 'Crowd.anim', 'Zam.anim']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.asm': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.anim': 'application/octet-stream',
  '.pal': 'application/octet-stream'
};

function send(res, status, body, type, extra) {
  const headers = Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-cache' }, extra);
  res.writeHead(status, headers);
  res.end(body);
}

function safeFile(dir, rel) {
  const cleaned = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned || cleaned.split('/').some((part) => part === '..' || part === '')) return null;
  const full = path.resolve(dir, cleaned);
  const root = path.resolve(dir);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function serveFile(res, file, req) {
  fs.stat(file, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      send(res, statErr && statErr.code !== 'ENOENT' ? 500 : 404, statErr && statErr.code !== 'ENOENT' ? 'Read failed' : 'Not found', 'text/plain; charset=utf-8');
      return;
    }
    const etag = httpCache.etagFor(stat);
    if (req && httpCache.notModified(req.headers['if-none-match'], etag)) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
      res.end();
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        send(res, err.code === 'ENOENT' ? 404 : 500, err.code === 'ENOENT' ? 'Not found' : 'Read failed', 'text/plain; charset=utf-8');
        return;
      }
      send(res, 200, buf, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', { ETag: etag });
    });
  });
}

function listPals(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /\.(pal|snespal)$/i.test(name)).sort();
}

/** Every NHL 95 team jersey from the retail ROM, or null when that ROM is not in roms/. */
function nhl95RomPalettes() {
  const game = gameById('nhl95');
  const file = game && findRom(game);
  if (!file) return null;
  try {
    const found = genesis95Pals.palettes(readRom(file, game));
    return found && found.length ? found : null;
  } catch (err) {
    return null;
  }
}

function findRom(game) {
  if (!fs.existsSync(ROM_DIR)) return null;
  if (game.disc) {
    const wantedIso = new Set(game.disc.names);
    const hit = fs.readdirSync(ROM_DIR).find((name) => wantedIso.has(name.toLowerCase()));
    return hit ? path.join(ROM_DIR, hit) : null;
  }
  if (!game.romNames.length) return null;
  const wanted = new Set(game.romNames.map((name) => name.toLowerCase()));
  const names = fs.readdirSync(ROM_DIR);
  const named = names.find((name) => wanted.has(name.toLowerCase()));
  if (named) return path.join(ROM_DIR, named);
  return null;
}

// A game that reads one file out of a disc image (Sega CD: GRAPH2.BIN from the ISO).
function readDiscFile(file, game) {
  const iso = iso9660.openFile(file);
  if (!iso) throw new Error('Not an ISO 9660 image: ' + path.basename(file));
  try {
    const bytes = iso.read(game.disc.file);
    if (!bytes) throw new Error(game.disc.file + ' is not on ' + path.basename(file));
    const parts = [Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length)];
    // Further files follow the first one (Sega CD: HOCKEY.BIN holds the team logo palettes).
    for (const name of game.disc.extra || []) {
      const more = iso.read(name);
      if (more) parts.push(Buffer.from(more.buffer, more.byteOffset, more.length));
    }
    return parts.length > 1 ? Buffer.concat(parts) : parts[0];
  } finally {
    if (iso.close) iso.close();
  }
}

// Sega CD speech: every .PCM at the ISO root, listed for the Audio tab and decoded on request.
const segaCdPcm = require('./lib/audio/segacd-pcm');
let segaPcmList = { file: '', mtime: 0, list: [] };
function segaCdPcmFiles(game) {
  const file = game.disc && findRom(game);
  if (!file) return [];
  const mtime = fs.statSync(file).mtimeMs;
  if (segaPcmList.file === file && segaPcmList.mtime === mtime) return segaPcmList.list;
  const iso = iso9660.openFile(file);
  let list = [];
  if (iso) {
    try {
      list = iso.names().filter((n) => /\.pcm$/i.test(n) && n.indexOf('/') < 0).sort().map((name) => {
        const bytes = iso.read(name);
        return { name, size: bytes ? bytes.length : 0 };
      });
    } finally {
      if (iso.close) iso.close();
    }
  }
  segaPcmList = { file, mtime, list };
  return list;
}
function segaCdPcmRead(game, name) {
  const file = game.disc && findRom(game);
  if (!file || !segaCdPcmFiles(game).some((e) => e.name === name)) return null;
  const iso = iso9660.openFile(file);
  try {
    const bytes = iso && iso.read(name);
    return bytes ? Buffer.from(segaCdPcm.decode(bytes)) : null;
  } finally {
    if (iso && iso.close) iso.close();
  }
}

const pc97Asf = require('./lib/audio/pc96-asf');
let ksfCache = { key: '', bytes: null };
function ksfBytes(game, rel) {
  const key = game.id + '|' + rel;
  if (ksfCache.key === key) return ksfCache.bytes;
  const body = pcRead(game, rel);
  if (!body) return null;
  ksfCache = { key, bytes: new Uint8Array(body.buffer ? body.buffer : body, body.byteOffset || 0, body.length) };
  return ksfCache.bytes;
}

function readRom(file, game) {
  if (game && game.disc) return readDiscFile(file, game);
  let buf = fs.readFileSync(file);
  if (game && game.platform === 'snes' && buf.length % 1024 === 512) {
    buf = buf.subarray(512);
  } else if (buf.length >= 0x304 && buf.slice(0x300, 0x304).toString('ascii') === 'SEGA' &&
      buf.slice(0x100, 0x104).toString('ascii') !== 'SEGA') {
    buf = buf.subarray(0x200);
  }
  return buf;
}

const pcCatalogCache = { pc95: null, pc94: null, pc96: null, pc97: null };
const pcStampCache = { pc95: '', pc94: '', pc96: '', pc97: '' };
const pcIsoCache = { pc95: null, pc96: null, pc97: null };
const pcIsoStamp = { pc95: '', pc96: '', pc97: '' };
const PC_ISO_NAMES = {
  pc96: ['nhl96pc.iso', 'nhl96pc.img', 'nhl96.iso', 'nhl96.img'],
  pc97: ['nhl97pc.iso', 'nhl97pc.img', 'nhl97.iso', 'nhl97.img'],
  pc95: ['nhl95pc.iso', 'nhl95pc.img', 'nhl95.iso', 'nhl95.img']
};

function dirHasFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  try {
    return fs.readdirSync(dir).some((name) => name.charAt(0) !== '.');
  } catch (err) {
    return false;
  }
}

function isoYear(iso) {
  if (!iso || !pc95.pcYearOf) return 0;
  const names = iso.names();
  const year = pc95.pcYearOf(names);
  if (year === 96 && names.some((rel) => /\.(fsh|asf|vsh|qvs|viv)$/i.test(rel))) return pc95.isNhl97 && pc95.isNhl97(names) ? 97 : 96;
  if (year === 95 && names.some((rel) => /\.(ppv|qfs|kms)$/i.test(rel) || /homepals/i.test(rel))) return 95;
  if (year === 94 && names.some((rel) => /\.qpp$/i.test(rel))) return 94;
  return 0;
}

function findPcIso(kind) {
  if (!fs.existsSync(ROM_DIR)) return null;
  const names = fs.readdirSync(ROM_DIR);
  const preferred = PC_ISO_NAMES[kind] || [];
  for (const want of preferred) {
    const hit = names.find((name) => name.toLowerCase() === want);
    if (hit) return path.join(ROM_DIR, hit);
  }
  const wantYear = kind === 'pc97' ? 97 : (kind === 'pc96' ? 96 : (kind === 'pc95' ? 95 : 0));
  if (!wantYear) return null;
  for (const name of names) {
    if (!/\.(iso|img)$/i.test(name)) continue;
    const full = path.join(ROM_DIR, name);
    let iso = null;
    try { iso = iso9660.openFile(full); } catch (err) { iso = null; }
    if (!iso) continue;
    const year = isoYear(iso);
    if (iso.close) iso.close();
    if (year === wantYear) return full;
  }
  return null;
}

function openPcIso(kind) {
  if (kind !== 'pc95' && kind !== 'pc96' && kind !== 'pc97') return null;
  const file = findPcIso(kind);
  if (!file) return null;
  const stat = fs.statSync(file);
  const stamp = file + ':' + stat.size + ':' + stat.mtimeMs;
  if (pcIsoCache[kind] && pcIsoStamp[kind] === stamp) return pcIsoCache[kind];
  if (pcIsoCache[kind] && pcIsoCache[kind].close) pcIsoCache[kind].close();
  let iso = null;
  try { iso = iso9660.openFile(file); } catch (err) { iso = null; }
  pcIsoCache[kind] = iso;
  pcIsoStamp[kind] = iso ? stamp : '';
  return iso;
}

function treeStamp(dir) {
  if (!fs.existsSync(dir)) return 'missing';
  let stamp = '';
  const walk = (abs) => {
    for (const name of fs.readdirSync(abs)) {
      if (name.charAt(0) === '.') continue;
      const full = path.join(abs, name);
      const stat = fs.statSync(full);
      stamp += name + ':' + stat.size + ':' + stat.mtimeMs + ';';
      if (stat.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return stamp || 'empty';
}

function pcFiles(game) {
  const kind = game && isPcKind(game.kind) ? game.kind : 'pc95';
  const dir = PC_DIRS[kind];
  if (dirHasFiles(dir)) {
    const stamp = 'dir:' + treeStamp(dir);
    if (!pcCatalogCache[kind] || pcStampCache[kind] !== stamp) {
      pcCatalogCache[kind] = pc95.catalogDirectory(dir);
      pcStampCache[kind] = stamp;
    }
    return pcCatalogCache[kind];
  }
  const iso = openPcIso(kind);
  const stamp = iso ? 'iso:' + pcIsoStamp[kind] : 'missing';
  if (!pcCatalogCache[kind] || pcStampCache[kind] !== stamp) {
    pcCatalogCache[kind] = iso
      ? pc95.catalogFromPaths(iso.names(), (rel) => iso.read(rel))
      : pc95.catalogDirectory(dir);
    pcStampCache[kind] = stamp;
  }
  return pcCatalogCache[kind];
}

function pcPath(game, rel) {
  const kind = game && isPcKind(game.kind) ? game.kind : 'pc95';
  const cleaned = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned || cleaned.split('/').some((part) => part === '..' || part === '')) return null;
  const pcRoot = PC_DIRS[kind];
  const full = path.resolve(pcRoot, cleaned);
  const root = path.resolve(pcRoot);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function pcRead(game, rel) {
  const kind = game && isPcKind(game.kind) ? game.kind : 'pc95';
  const readBytes = (name) => {
    if (dirHasFiles(PC_DIRS[kind])) {
      const file = pcPath(game, name);
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
      return fs.readFileSync(file);
    }
    const iso = openPcIso(kind);
    return iso ? iso.read(name) : null;
  };
  if (pc95.readPacked) return pc95.readPacked(rel, readBytes);
  return readBytes(rel);
}

function loadRinkColors(game) {
  const catalog = pcFiles(game);
  if (!catalog.rinkFile) return null;
  const bytes = pcRead(game, catalog.rinkFile);
  if (!bytes) return null;
  return pc95.paletteFrom(bytes) || pc95.decodeRinkFile(bytes);
}

function pcPaletteBytes(game, name) {
  const parsed = pc95.parseTeamFile(name);
  if (!parsed) return null;
  const catalog = pcFiles(game);
  const rel = parsed.side === 'away' ? catalog.awayFile : catalog.homeFile;
  const bin = rel && pcRead(game, rel);
  if (!bin) return null;
  const colors = pc95.teamPaletteColors
    ? pc95.teamPaletteColors(name, bin, loadRinkColors(game))
    : null;
  if (!colors) return null;
  return Buffer.concat([
    Buffer.from(pc95.colorsToAct(colors)),
    Buffer.from(pc95.colorsToAct(colors.game || colors))
  ]);
}

function pcBundle(game, rels) {
  const files = [];
  for (const rel of rels) {
    const data = pcRead(game, rel);
    if (!data || !data.length) continue;
    files.push({ name: rel, data });
  }
  return Buffer.from(pc95.encodeBundle(files));
}

function placedAssets(game, romFile) {
  if (isPcKind(game.kind)) return { images: pcFiles(game).images, sheet: null };
  if (game.id !== 'nhlpa93' || !romFile) return { images: game.images || [], sheet: game.sheet || null };
  try {
    const buf = readRom(romFile, game);
    const date = buf.length >= 0x120 ? buf.slice(0x118, 0x120).toString('ascii') : '';
    return revAdjust(game, date);
  } catch (err) {
    return { images: game.images || [], sheet: game.sheet || null };
  }
}

// The revision of the ROM on disk, from its header date ('' for a game with a single retail layout).
function romRevision(game, romFile) {
  if (!romFile || !Revisions.list(game.id).length) return '';
  try {
    const buf = readRom(romFile, game);
    return Revisions.fromRom(game.id, buf);
  } catch (err) {
    return Revisions.list(game.id)[0].id;
  }
}

function gameStatus(game) {
  const rom = findRom(game);
  const hasRom = Boolean(rom);
  const pc = isPcKind(game.kind) ? pcFiles(game) : null;
  const placed = placedAssets(game, rom);
  const pixels = isPcKind(game.kind)
    ? pc.spriteFiles.length > 0 || pc.rinkFiles.length > 0 || pc.images.length > 0
    : (game.kind === 'anim' || hasRom);
  let banks = game.banks;
  if (game.kind === 'sheet') {
    banks = sheetGameBanks(placed.images);
  } else if (isPcKind(game.kind)) {
    banks = [];
    if (game.id === 'nhl96pc' && pc95.pc96Banks) {
      banks = pc95.pc96Banks(pc);
    } else {
      if (pc.spriteFiles.length || !pc.rinkFiles.length) banks.push({ id: 'sprites', label: 'Players' });
      if (pc.rinkFiles.length) banks.push({ id: 'rink', label: 'Rink and crowd' });
    }
  }
  return {
    app: APP_NAME,
    id: game.id,
    title: game.title,
    source: game.source,
    platform: game.platform,
    kind: game.kind,
    paletteKind: game.paletteKind,
    jerseyRow: game.jerseyRow || 2,
    paletteLabel: game.paletteLabel || null,
    tagline: game.tagline || null,
    hint: game.hint || null,
    frames: game.frames,
    banks,
    images: placed.images,
    pixels,
    rom: isPcKind(game.kind) ? pc95.installReady(pc) : hasRom,
    sheet: placed.sheet,
    // images and sheet above are placed for `revision` (the ROM on disk); the retail layout lets the page re-place them.
    revisions: Revisions.list(game.id),
    revision: romRevision(game, rom) || (Revisions.list(game.id)[0] || {}).id || '',
    retail: Revisions.list(game.id).length
      ? { images: game.images || [], sheet: game.sheet || null, banks: game.kind === 'sheet' ? sheetGameBanks(game.images || []) : game.banks }
      : null,
    snes: game.snes || null,
    romHint: game.kind === 'pc95' ? 'pc95/ or roms/nhl95.iso' : (game.kind === 'pc94' ? 'pc94/' : (game.kind === 'pc96' ? 'pc96/ or roms/nhl96.iso' : (game.kind === 'pc97' ? 'pc97/ or roms/nhl97.iso' : (game.disc ? 'roms/' + game.disc.names[0] : (game.romNames.length ? 'roms/' + game.romNames[0] : null))))),
    pcAudio: pc && pc.audio ? pc.audio : (game.id === 'nhl94cd' && rom ? { songs: [], tim: [], pat: [], extra: [], dig: '', segaCdPcm: segaCdPcmFiles(game), rate: segaCdPcm.RATE } : undefined)
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/palettes') {
    send(res, 200, JSON.stringify(listPals(PAL_DIR)), MIME['.json']);
    return;
  }

  if (pathname === '/api/games') {
    send(res, 200, JSON.stringify(GAMES.map(gameStatus)), MIME['.json']);
    return;
  }

  const gameFrames = /^\/api\/games\/([a-z0-9]+)\/frames$/.exec(pathname);
  if (gameFrames) {
    const game = gameById(gameFrames[1]);
    if (!game) { send(res, 404, 'Unknown game', 'text/plain; charset=utf-8'); return; }
    serveFile(res, path.join(DATA, game.frames), req);
    return;
  }

  const gamePals = /^\/api\/games\/([a-z0-9]+)\/palettes$/.exec(pathname);
  if (gamePals) {
    const game = gameById(gamePals[1]);
    if (!game) { send(res, 404, 'Unknown game', 'text/plain; charset=utf-8'); return; }
    if (isPcKind(game.kind)) {
      send(res, 200, JSON.stringify(pcFiles(game).paletteNames), MIME['.json']);
      return;
    }
    if (game.id === 'nhl95') {
      const fromRom = nhl95RomPalettes();
      if (fromRom) {
        send(res, 200, JSON.stringify(fromRom.map((p) => p.name)), MIME['.json']);
        return;
      }
    }
    send(res, 200, JSON.stringify(listPals(PAL_DIRS[game.palettes])), MIME['.json']);
    return;
  }

  const gamePal = /^\/api\/games\/([a-z0-9]+)\/palettes\/([^/]+)$/.exec(pathname);
  if (gamePal) {
    const game = gameById(gamePal[1]);
    if (game && isPcKind(game.kind)) {
      const body = pcPaletteBytes(game, gamePal[2]);
      if (!body) { send(res, 404, 'Unknown palette', 'text/plain; charset=utf-8'); return; }
      send(res, 200, body, 'application/octet-stream');
      return;
    }
    if (game && game.id === 'nhl95') {
      const hit = nhl95RomPalettes();
      const pal = hit && hit.find((p) => p.name === gamePal[2].toLowerCase());
      if (pal) { send(res, 200, Buffer.from(pal.bytes), 'application/octet-stream'); return; }
    }
    const file = game && safeFile(PAL_DIRS[game.palettes], gamePal[2]);
    if (!file || !/\.(pal|snespal)$/i.test(file)) {
      send(res, 404, 'Unknown palette', 'text/plain; charset=utf-8');
      return;
    }
    serveFile(res, file, req);
    return;
  }

  const pcSprites = /^\/api\/games\/([a-z0-9]+)\/sprites$/.exec(pathname);
  if (pcSprites) {
    const game = gameById(pcSprites[1]);
    if (!game || !isPcKind(game.kind)) { send(res, 404, 'Unknown game', 'text/plain; charset=utf-8'); return; }
    const catalog = pcFiles(game);
    const bank = url.searchParams.get('bank') || 'sprites';
    const files = pc95.spriteBankFiles
      ? pc95.spriteBankFiles(catalog, bank)
      : (bank === 'rink' ? catalog.rinkFiles : catalog.spriteFiles);
    if (!files.length) { send(res, 404, 'No PC sprites', 'text/plain; charset=utf-8'); return; }
    send(res, 200, pcBundle(game, files), 'application/octet-stream');
    return;
  }

  const segaPcm = /^\/api\/games\/(nhl94cd)\/pcm$/.exec(pathname);
  if (segaPcm) {
    const game = gameById(segaPcm[1]);
    const body = game && segaCdPcmRead(game, url.searchParams.get('name') || '');
    if (!body) { send(res, 404, 'Not found', 'text/plain; charset=utf-8'); return; }
    send(res, 200, body, 'application/octet-stream');
    return;
  }

  // NHL 97 speech banks (.KSF can be 100 MB): list the streams, or send one stream's bytes.
  const ksfRoute = /^\/api\/games\/(nhl97pc)\/ksf$/.exec(pathname);
  if (ksfRoute) {
    const game = gameById(ksfRoute[1]);
    const rel = url.searchParams.get('path');
    const bytes = game && rel && /\.ksf$/i.test(rel) ? ksfBytes(game, rel) : null;
    if (!bytes) { send(res, 404, 'Not found', 'text/plain; charset=utf-8'); return; }
    const streams = pc97Asf.ksfStreams(bytes);
    const n = url.searchParams.get('n');
    if (n == null) { send(res, 200, JSON.stringify(streams), MIME['.json']); return; }
    const one = streams.find((x) => x.index === Number(n));
    if (!one) { send(res, 404, 'Not found', 'text/plain; charset=utf-8'); return; }
    send(res, 200, Buffer.from(bytes.subarray(one.start, one.end)), 'application/octet-stream');
    return;
  }

  // NHL 97 sound-effect banks (AUDSFX.VIV: NAME.bkh headers + NAME.bkd data).
  const bnkRoute = /^\/api\/games\/(nhl97pc)\/bnk$/.exec(pathname);
  if (bnkRoute) {
    const game = gameById(bnkRoute[1]);
    const rel = url.searchParams.get('path');
    const bytes = game && rel && /\.viv$/i.test(rel) ? ksfBytes(game, rel) : null;
    const files = bytes ? pc95.parseUnitC0fb(bytes) : null;
    if (!files) { send(res, 404, 'Not found', 'text/plain; charset=utf-8'); return; }
    const byName = new Map(files.map((f) => [String(f.name).toLowerCase(), f.data]));
    const bank = url.searchParams.get('bank');
    const n = url.searchParams.get('n');
    if (bank == null) {
      const list = [];
      for (const f of files) {
        const m = /^(.*)\.bkh$/i.exec(f.name);
        if (!m) continue;
        for (const snd of pc97Asf.bnkSounds(new Uint8Array(f.data))) list.push(Object.assign({ bank: m[1] }, snd));
      }
      send(res, 200, JSON.stringify(list), MIME['.json']);
      return;
    }
    const hdr = byName.get(bank.toLowerCase() + '.bkh');
    const data = byName.get(bank.toLowerCase() + '.bkd');
    const snd = hdr && data ? pc97Asf.bnkSounds(new Uint8Array(hdr))[Number(n)] : null;
    if (!snd) { send(res, 404, 'Not found', 'text/plain; charset=utf-8'); return; }
    const size = snd.channels === 1 ? Math.ceil(snd.frames / 2) : snd.frames;
    send(res, 200, Buffer.from(new Uint8Array(data.buffer ? data.buffer : data, (data.byteOffset || 0) + snd.offset, Math.min(size + 1, data.length - snd.offset))), 'application/octet-stream');
    return;
  }

  const pcFile = /^\/api\/games\/([a-z0-9]+)\/file$/.exec(pathname);
  if (pcFile) {
    const game = gameById(pcFile[1]);
    const rel = url.searchParams.get('path');
    if (!game || !isPcKind(game.kind) || !rel) {
      send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      return;
    }
    const body = pcRead(game, rel);
    if (!body) { send(res, 404, 'Not found', 'text/plain; charset=utf-8'); return; }
    send(res, 200, Buffer.from(body), 'application/octet-stream');
    return;
  }

  const gameAudio = /^\/api\/games\/([a-z0-9]+)\/audio$/.exec(pathname);
  if (gameAudio) {
    const game = gameById(gameAudio[1]);
    if (!game) { send(res, 404, 'Unknown game', 'text/plain; charset=utf-8'); return; }
    const catalog = audio.loadCatalog(game.id);
    if (!catalog) { send(res, 404, 'No audio catalog', 'text/plain; charset=utf-8'); return; }
    send(res, 200, JSON.stringify(catalog), MIME['.json']);
    return;
  }

  const gameAudioPreview = /^\/api\/games\/([a-z0-9]+)\/audio\/preview$/.exec(pathname);
  if (gameAudioPreview) {
    const game = gameById(gameAudioPreview[1]);
    const entryId = url.searchParams.get('entry');
    if (!game || !entryId) { send(res, 400, 'Bad request', 'text/plain; charset=utf-8'); return; }
    let rom = null;
    const file = findRom(game);
    if (file) rom = readRom(file, game);
    if (!rom) { send(res, 404, 'ROM not found', 'text/plain; charset=utf-8'); return; }
    try {
      let out = audio.previewFromRom(game.id, entryId, rom);
      if ((!out || !out.schedule || !out.schedule.events || !out.schedule.events.length)
        && game.id === 'nhl92') {
        const catalog = audio.loadCatalog(game.id);
        const entry = catalog && catalog.entries.find((e) => e.id === entryId);
        if (entry) {
          try {
            const sys = audio.soundSystem.create(rom);
            const schedule = sys.playEntry(entry, catalog.previewMeta, entry.type === 'fm-song' ? 90 : 45);
            out = { entry, schedule };
          } catch (e) { /* fall through */ }
        }
      }
      if (!out) { send(res, 404, 'Unknown entry', 'text/plain; charset=utf-8'); return; }
      send(res, 200, JSON.stringify(out.schedule), MIME['.json']);
    } catch (err) {
      send(res, 500, 'Preview failed', 'text/plain; charset=utf-8');
    }
    return;
  }

  const gameRom = /^\/api\/games\/([a-z0-9]+)\/rom$/.exec(pathname);
  if (gameRom) {
    const game = gameById(gameRom[1]);
    const file = game && findRom(game);
    if (!file) { send(res, 404, 'ROM not found', 'text/plain; charset=utf-8'); return; }
    try {
      send(res, 200, readRom(file, game), 'application/octet-stream');
    } catch (err) {
      send(res, 500, 'Could not read ROM', 'text/plain; charset=utf-8');
    }
    return;
  }

  if (pathname === '/games.json') {
    serveFile(res, path.join(PUBLIC, 'games.json'), req);
    return;
  }
  if (pathname.startsWith('/data/')) {
    const file = safeFile(DATA, pathname.slice('/data/'.length));
    if (!file) { send(res, 400, 'Bad path', 'text/plain; charset=utf-8'); return; }
    serveFile(res, file, req);
    return;
  }
  if (pathname === '/' || pathname === '/index.html') {
    serveFile(res, path.join(PUBLIC, 'index.html'), req);
    return;
  }
  if (pathname === '/data/frames.asm') {
    serveFile(res, path.join(DATA, 'frames.asm'), req);
    return;
  }
  if (pathname.startsWith('/lib/')) {
    const file = safeFile(LIB, pathname.slice('/lib/'.length));
    if (!file) { send(res, 400, 'Bad path', 'text/plain; charset=utf-8'); return; }
    serveFile(res, file, req);
    return;
  }
  if (pathname.startsWith('/anim/')) {
    const name = path.basename(pathname);
    if (!BANKS.has(name)) { send(res, 404, 'Unknown ANIM bank', 'text/plain; charset=utf-8'); return; }
    serveFile(res, path.join(ANIM_DIR, name), req);
    return;
  }
  if (pathname.startsWith('/palettes/')) {
    const file = safeFile(PAL_DIR, pathname.slice('/palettes/'.length));
    if (!file || !file.toLowerCase().endsWith('.pal')) {
      send(res, 404, 'Unknown palette', 'text/plain; charset=utf-8');
      return;
    }
    serveFile(res, file, req);
    return;
  }
  if (pathname === '/viewer.js' || pathname === '/about.js' || pathname === '/button-icons.js' || pathname === '/changelog.json' || pathname === '/viewer.css' || pathname === '/jed.html' || pathname === '/jed.js' || pathname === '/ice.js' || pathname === '/fight.js' || pathname === '/jed.css' || pathname === '/jim.html' || pathname === '/jim.js' || pathname === '/jim.css' || /^\/jed-pals\/[a-zA-Z]+\.act$/.test(pathname) || pathname === '/audio-engine.js' ||
      pathname === '/chip-lab.html' || pathname === '/chip-lab.js' || pathname === '/chip-lab.css' ||
      pathname === '/sound-test-view.js' || pathname === '/sound-test-pc94.js' || pathname === '/sound-instruments.js' || pathname === '/sound-roll-snes.js' || pathname === '/sound-test-snes.js' || pathname === '/sound-test-snes93.js' ||
      pathname === '/sound-roll.js' || pathname === '/sound-tools.js' || pathname === '/sound-tools-nx.js' || pathname === '/sound-editor-extras.js' || pathname === '/sound-patch-editor.js' || pathname === '/sound-tools-snes.js' || pathname === '/sound-snes-inst-editor.js') {
    serveFile(res, path.join(PUBLIC, pathname.slice(1)), req);
    return;
  }
  send(res, 404, 'Not found', 'text/plain; charset=utf-8');
});

try {
  const manifestPath = path.join(PUBLIC, 'games.json');
  fs.writeFileSync(manifestPath, JSON.stringify(buildManifest(), null, 2) + '\n');
} catch (err) {
  console.warn('Could not write games.json:', err.message);
}

const port = Number(process.env.PORT) || 8732;
server.listen(port, () => {
  console.log(APP_NAME + ' at http://localhost:' + port);
});
