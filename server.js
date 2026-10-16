const http = require('http');
const fs = require('fs');
const path = require('path');
const { GAMES, gameById, revAAdjust, sheetGameBanks } = require('./lib/games');
const { APP_NAME } = require('./lib/studio');
const { buildManifest } = require('./lib/manifest');
const pc95 = require('./lib/pc95');
const audio = require('./lib/audio');
const httpCache = require('./lib/http-cache');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const LIB = path.join(ROOT, 'lib');
const DATA = path.join(ROOT, 'data');
const ANIM_DIR = path.join(ROOT, '..', 'ANIM-To-BMP');
const PAL_DIRS = {
  '92': path.join(ANIM_DIR, 'Palettes'),
  '94': path.join(ROOT, '..', 'ANIM94-To-BMP', 'Palettes'),
  '95': path.join(ROOT, '..', 'ANIM95-To-BMP', 'Palettes', 'NHL95'),
  'snes': path.join(DATA, 'pals', 'snes')
};
const PAL_DIR = PAL_DIRS['92'];
const ROM_DIR = path.join(ROOT, 'roms');
const PC_DIRS = {
  pc95: path.join(ROOT, 'pc95'),
  pc94: path.join(ROOT, 'pc94')
};

function isPcKind(kind) {
  return kind === 'pc95' || kind === 'pc94';
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

const pcCatalogCache = { pc95: null, pc94: null };
const pcStampCache = { pc95: '', pc94: '' };

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
  const stamp = treeStamp(dir);
  if (!pcCatalogCache[kind] || pcStampCache[kind] !== stamp) {
    pcCatalogCache[kind] = pc95.catalogDirectory(dir);
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

function loadRinkColors(game) {
  const catalog = pcFiles(game);
  if (!catalog.rinkFile) return null;
  const file = pcPath(game, catalog.rinkFile);
  if (!file || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return pc95.paletteFrom(bytes) || pc95.decodeRinkFile(bytes);
}

function pcPaletteBytes(game, name) {
  const parsed = pc95.parseTeamFile(name);
  if (!parsed) return null;
  const catalog = pcFiles(game);
  const rel = parsed.side === 'away' ? catalog.awayFile : catalog.homeFile;
  const file = rel && pcPath(game, rel);
  if (!file || !fs.existsSync(file)) return null;
  const bin = fs.readFileSync(file);
  const start = parsed.index * pc95.TEAM_BYTES;
  if (start + pc95.TEAM_BYTES > bin.length) return null;
  const colors = pc95.buildTeamPalette(bin.subarray(start, start + pc95.TEAM_BYTES), loadRinkColors(game));
  if (!colors) return null;
  return Buffer.concat([
    Buffer.from(pc95.colorsToAct(colors)),
    Buffer.from(pc95.colorsToAct(colors.game || colors))
  ]);
}

function pcBundle(game, rels) {
  const files = [];
  for (const rel of rels) {
    const file = pcPath(game, rel);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    files.push({ name: rel, data: fs.readFileSync(file) });
  }
  return Buffer.from(pc95.encodeBundle(files));
}

function placedAssets(game, romFile) {
  if (isPcKind(game.kind)) return { images: pcFiles(game).images, sheet: null };
  if (game.id !== 'nhlpa93' || !romFile) return { images: game.images || [], sheet: game.sheet || null };
  try {
    const buf = readRom(romFile, game);
    const date = buf.length >= 0x120 ? buf.slice(0x118, 0x120).toString('ascii') : '';
    return revAAdjust(game, date);
  } catch (err) {
    return { images: game.images || [], sheet: game.sheet || null };
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
    if (pc.spriteFiles.length || !pc.rinkFiles.length) banks.push({ id: 'sprites', label: 'Players' });
    if (pc.rinkFiles.length) banks.push({ id: 'rink', label: 'Rink and crowd' });
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
    rom: hasRom,
    sheet: placed.sheet,
    snes: game.snes || null,
    romHint: game.kind === 'pc95' ? 'pc95/' : (game.kind === 'pc94' ? 'pc94/' : (game.romNames.length ? 'roms/' + game.romNames[0] : null))
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
    const files = bank === 'rink' ? catalog.rinkFiles : catalog.spriteFiles;
    if (!files.length) { send(res, 404, 'No PC sprites', 'text/plain; charset=utf-8'); return; }
    send(res, 200, pcBundle(game, files), 'application/octet-stream');
    return;
  }

  const pcFile = /^\/api\/games\/([a-z0-9]+)\/file$/.exec(pathname);
  if (pcFile) {
    const game = gameById(pcFile[1]);
    const file = game && isPcKind(game.kind) ? pcPath(game, url.searchParams.get('path')) : null;
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      return;
    }
    serveFile(res, file, req);
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

  if (pathname === '/api/z80/patterns') {
    send(res, 200, JSON.stringify(audio.z80Patterns.list()), MIME['.json']);
    return;
  }

  const z80Run = /^\/api\/z80\/run$/.exec(pathname);
  if (z80Run) {
    const patternId = url.searchParams.get('pattern') || 'nhl_driver_boot';
    const game = gameById('nhl92');
    const file = game ? findRom(game) : null;
    const rom = file && game ? readRom(file, game) : null;
    try {
      const out = audio.z80PreviewFromRom(rom, patternId);
      send(res, 200, JSON.stringify({
        ok: out.ok,
        detail: out.detail,
        schedule: out.schedule || null,
        snapshot: out.snapshot || null
      }), MIME['.json']);
    } catch (err) {
      send(res, 400, err.message || 'Z80 test failed', 'text/plain; charset=utf-8');
    }
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
    else if (game.id === 'z80test') rom = audio.soundFixture.resolveRom(null);
    if (!rom) { send(res, 404, 'ROM not found', 'text/plain; charset=utf-8'); return; }
    try {
      let out = audio.previewFromRom(game.id, entryId, rom);
      if ((!out || !out.schedule || !out.schedule.events || !out.schedule.events.length)
        && (game.id === 'nhl92' || game.id === 'z80test')) {
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
  if (pathname === '/viewer.js' || pathname === '/viewer.css' || pathname === '/audio-engine.js' ||
      pathname === '/chip-lab.html' || pathname === '/chip-lab.js' || pathname === '/chip-lab.css' ||
      pathname === '/sound-test-view.js' || pathname === '/sound-roll-snes.js' || pathname === '/sound-test-snes.js' || pathname === '/sound-test-snes93.js' ||
      pathname === '/sound-roll.js' || pathname === '/sound-tools.js' || pathname === '/sound-tools-nx.js' || pathname === '/sound-editor-extras.js' || pathname === '/sound-patch-editor.js' || pathname === '/sound-tools-snes.js') {
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
