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
  pc96: process.env.NHL_PC96_DIR ? path.resolve(process.env.NHL_PC96_DIR) : path.join(ROOT, 'pc96')
};

function isPcKind(kind) {
  return kind === 'pc95' || kind === 'pc94' || kind === 'pc96';
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

function findRom(game) {
  if (!game.romNames.length) return null;
  if (!fs.existsSync(ROM_DIR)) return null;
  const wanted = new Set(game.romNames.map((name) => name.toLowerCase()));
  const names = fs.readdirSync(ROM_DIR);
  const named = names.find((name) => wanted.has(name.toLowerCase()));
  if (named) return path.join(ROM_DIR, named);
  return null;
}

function readRom(file, game) {
  let buf = fs.readFileSync(file);
  if (game && game.platform === 'snes' && buf.length % 1024 === 512) {
    buf = buf.subarray(512);
  } else if (buf.length >= 0x304 && buf.slice(0x300, 0x304).toString('ascii') === 'SEGA' &&
      buf.slice(0x100, 0x104).toString('ascii') !== 'SEGA') {
    buf = buf.subarray(0x200);
  }
  return buf;
}

const pcCatalogCache = { pc95: null, pc94: null, pc96: null };
const pcStampCache = { pc95: '', pc94: '', pc96: '' };
const pcIsoCache = { pc95: null, pc96: null };
const pcIsoStamp = { pc95: '', pc96: '' };
const PC_ISO_NAMES = {
  pc96: ['nhl96pc.iso', 'nhl96pc.img', 'nhl96.iso', 'nhl96.img'],
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
  if (year === 96 && names.some((rel) => /\.(fsh|asf|vsh|qvs|viv)$/i.test(rel))) return 96;
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
  const wantYear = kind === 'pc96' ? 96 : (kind === 'pc95' ? 95 : 0);
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
  if (kind !== 'pc95' && kind !== 'pc96') return null;
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
    romHint: game.kind === 'pc95' ? 'pc95/ or roms/nhl95.iso' : (game.kind === 'pc94' ? 'pc94/' : (game.kind === 'pc96' ? 'pc96/ or roms/nhl96.iso' : (game.romNames.length ? 'roms/' + game.romNames[0] : null))),
    pcAudio: pc && pc.audio ? pc.audio : undefined
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
