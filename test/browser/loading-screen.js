/**
 * Browser test: Studio shows a loading screen that names the games while it starts, and again while a folder is opened.
 * The game stream is held back so the screen is on long enough to read.
 *
 *   node test/browser/loading-screen.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { withBrowser } = require('./harness');

const OPTIONAL = /\/api\/games\/\w+\/rom/;

(async () => {
  const ok = await withBrowser('loading-screen', async ({ url, newPage }) => {
    const page = await newPage(1280);
    // hold the slow game check back so the first screen can be read
    await page.route('**/api/games/stream', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
    await page.goto(url);
    await page.waitForSelector('#loading-screen:not([hidden])', { timeout: 5000 });
    assert.ok(/Loading NHL9X Studio/.test(await page.textContent('.loading-title')), 'the screen has a title');
    await page.waitForSelector('#loading-screen .loading-game', { timeout: 5000 });
    const names = await page.$$eval('#loading-screen .loading-name', (n) => n.map((x) => x.textContent));
    assert.ok(names.length >= 8, 'it lists the games: ' + names.join(', '));
    assert.ok(names.some((n) => /NHL 94/.test(n)) && names.some((n) => /Sega CD/.test(n)), 'with their names');
    assert.ok(await page.$('#loading-screen .loading-game.is-working'), 'one game is marked as being checked');
    await page.waitForSelector('#catalog .item', { timeout: 60000 });
    await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 });
    assert.ok(!(await page.evaluate(() => document.body.classList.contains('is-loading'))), 'the page is released when it is done');

    // Opening a folder shows the screen again, with the files it reads and the game it finds.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loading-folder-'));
    try {
      fs.writeFileSync(path.join(dir, 'readme.txt'), 'nothing to see');
      fs.writeFileSync(path.join(dir, 'other.txt'), 'still nothing');
      await page.evaluate(() => {
        const original = NhlOpenAsset.classify;
        window.__sawLoading = [];
        const obs = new MutationObserver(() => {
          const t = document.querySelector('#loading-screen .loading-title');
          const d = document.querySelector('#loading-screen .loading-detail');
          if (t && !document.getElementById('loading-screen').hidden) window.__sawLoading.push((t.textContent + ' | ' + (d ? d.textContent : '')).trim());
        });
        obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
        NhlOpenAsset.classify = function () { return original.apply(this, arguments); };
      });
      await page.setInputFiles('#folder-open', [path.join(dir, 'readme.txt'), path.join(dir, 'other.txt')]);
      await page.waitForTimeout(800);
      const seen = await page.evaluate(() => window.__sawLoading);
      assert.ok(seen.some((s) => /Opening/.test(s)), 'a folder or file open shows the screen: ' + JSON.stringify(seen.slice(0, 3)));
      await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const problems = page.problems.filter((p) => !OPTIONAL.test(p));
    assert.deepStrictEqual(problems, [], problems.join('; '));
    await page.close();
  });
  if (ok === false) process.exit(1);
  console.log('loading-screen: names, status and folder open OK');
})().catch((err) => { console.error(err); process.exit(1); });
