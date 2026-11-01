/**
 * Browser test: jed.html has no server game menu. Without PC games on the server only Open game folder / Open files
 * show; with NHL_PC95_DIR (and NHL_PC94_DIR) set (local only, game files are never committed) the server game loads by
 * itself, NHL 94 PC first, and with both the NHL 94 PC / NHL 95 PC switch changes game.
 *
 *   node test/browser/jed-server.js
 */
const assert = require('assert');
const { withBrowser } = require('./harness');
const OPTIONAL = /Failed to load resource.*\/api\//;

withBrowser('jed-server', async ({ url, newPage }) => {
  const page = await newPage(1920);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(url + 'jed.html');
  assert.strictEqual(await page.locator('#jed-server, select[aria-label="Game on this server"]').count(), 0, 'no server menu');
  assert.ok(await page.isVisible('#jed-open-folder') && await page.isVisible('#jed-open-files'));
  const games = await page.evaluate(async () => (await (await fetch('api/games')).json()).filter((g) => /^pc9[45]$/.test(g.kind) && g.pixels).map((g) => g.id));
  if (!games.length) {
    await page.waitForTimeout(500);
    assert.ok(await page.isHidden('#jed-game'), 'no game switch without server games');
    assert.match(await page.textContent('#jed-status'), /^Open an NHL 94 PC or NHL 95 PC folder/);
    console.log('jed-server: no PC games on this server, auto-load not checked');
  } else {
    await page.waitForSelector('#jed-team-list .item');
    const want = games.includes('nhl94pc') ? '94' : '95';
    assert.match(await page.textContent('#jed-status'), new RegExp('NHL ' + want + ' PC'));
    if (games.length > 1) {
      assert.ok(await page.isVisible('#jed-game'));
      await page.click('#jed-game-94'); await page.waitForFunction(() => /NHL 94 PC/.test(document.getElementById('jed-status').textContent));
      assert.strictEqual(await page.getAttribute('#jed-game-94', 'aria-pressed'), 'true');
      await page.click('#jed-game-95'); await page.waitForFunction(() => /NHL 95 PC/.test(document.getElementById('jed-status').textContent));
    } else assert.ok(await page.isHidden('#jed-game'), 'one game: no switch');
    if (process.env.NHL_JED_SHOT) await page.screenshot({ path: process.env.NHL_JED_SHOT });
    console.log('jed-server: auto-loaded ' + games.join(' + '));
  }
  const problems = page.problems.filter((p) => !OPTIONAL.test(p));
  assert.deepStrictEqual(problems, []);
  console.log('jed-server: ok');
}).catch((err) => { console.error(err); process.exit(1); });
