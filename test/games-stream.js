/** /api/games/names answers at once and /api/games/stream sends the same games one line at a time (names first, then each game,
 *  then done), which is what the loading screen reads. Starts its own server.js on a free port. */
const assert = require('assert');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => { const port = srv.address().port; srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}
function get(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body }));
    }).on('error', reject);
  });
}

(async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(port) }), stdio: 'ignore' });
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await get(port, '/api/games/names')).status === 200) break; } catch (err) { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    const names = await get(port, '/api/games/names');
    assert.strictEqual(names.status, 200);
    const list = JSON.parse(names.body);
    assert.ok(list.length >= 10 && list.every((g) => g.id && g.title), 'every game has an id and a title');
    assert.ok(list.some((g) => g.id === 'nhl94cd'), 'the Sega CD game is listed');
    const stream = await get(port, '/api/games/stream');
    assert.strictEqual(stream.status, 200);
    assert.ok(/ndjson/.test(stream.type), 'newline-delimited JSON');
    const lines = stream.body.split(String.fromCharCode(10)).filter(Boolean).map((l) => JSON.parse(l));
    assert.deepStrictEqual(lines[0].names, list, 'names come first and match /api/games/names');
    const games = lines.filter((l) => l.game).map((l) => l.game);
    assert.deepStrictEqual(games.map((g) => g.id), list.map((g) => g.id), 'one line per game, in order');
    assert.deepStrictEqual(lines[lines.length - 1], { done: true }, 'it ends with done');
    const plain = JSON.parse((await get(port, '/api/games')).body);
    assert.deepStrictEqual(games.map((g) => [g.id, g.title, Boolean(g.rom)]), plain.map((g) => [g.id, g.title, Boolean(g.rom)]), 'the same games as /api/games');
    const js = await get(port, '/loading.js');
    assert.strictEqual(js.status, 200, 'loading.js is served');
  } finally {
    child.kill();
  }
  console.log('games-stream: names, one line per game, done, same games as /api/games OK');
})().catch((err) => { console.error(err); process.exit(1); });
