/**
 * Shared set-up for the browser tests: finds Playwright (a local install, else the global one), starts server.js on a
 * free port and hands back a page factory that records page errors and console errors.
 *
 * Playwright is not a dependency of the app; without it the browser tests report that they were skipped.
 */
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function findPlaywright() {
  const tries = ['playwright'];
  try {
    const globalRoot = require('child_process').execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (globalRoot) tries.push(path.join(globalRoot, 'playwright'));
  } catch (err) { /* no npm */ }
  for (const t of tries) {
    try { return require(t); } catch (err) { /* next */ }
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** Start server.js; resolves once it answers. */
async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(port) }), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const url = 'http://127.0.0.1:' + port + '/';
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return { url, stop: () => child.kill(), log: () => log };
    } catch (err) { /* not up yet */ }
    if (child.exitCode != null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('server.js did not start:\n' + log);
}

/**
 * Run `body({ browser, url, newPage })` against a fresh server. newPage(width) opens a page at that width (a phone
 * with touch below 500 px) whose .problems array collects page errors and console errors.
 */
async function withBrowser(name, body) {
  const pw = findPlaywright();
  if (!pw) {
    console.log(name + ': skipped (Playwright is not installed)');
    return false;
  }
  const server = await startServer();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined;
  const browser = await pw.chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const newPage = async (width) => {
      const phone = width < 500;
      const context = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, hasTouch: phone, isMobile: phone, deviceScaleFactor: phone ? 3 : 1 });
      const page = await context.newPage();
      page.problems = [];
      page.on('pageerror', (e) => page.problems.push('page error: ' + e.message));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const loc = m.location() || {};
        page.problems.push('console error: ' + m.text() + (loc.url ? ' (' + loc.url + ')' : ''));
      });
      page.close = ((close) => () => context.close().catch(() => close()))(page.close.bind(page));
      return page;
    };
    await body({ browser, url: server.url, newPage });
  } finally {
    await browser.close();
    server.stop();
  }
  return true;
}

module.exports = { findPlaywright, startServer, withBrowser, ROOT };
