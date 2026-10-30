/**
 * Browser test: the Revision picker next to Game lists the retail revisions of NHLPA 93 (Rev 0 / A / B) and nothing
 * for a game with one layout, and choosing Rev B swaps the EASN pictures for the EA Sports ones. Needs no ROM.
 *
 *   node test/browser/revision-picker.js
 */
const assert = require('assert');
const { withBrowser } = require('./harness');

const OPTIONAL = /\/api\/games\/\w+\/rom/;

(async () => {
  const ok = await withBrowser('revision-picker', async ({ url, newPage }) => {
    const page = await newPage(1280);
    await page.goto(url + '#game=nhlpa93&mode=image');
    await page.waitForSelector('#catalog .item', { timeout: 60000 });
    assert.ok(await page.$eval('#revision-field', (f) => !f.hidden), 'picker should show for NHLPA 93');
    const options = await page.$$eval('#revision option', (o) => o.map((x) => x.value));
    assert.deepStrictEqual(options, ['0', 'a', 'b']);
    const names = async () => (await page.$$eval('#catalog .item', (i) => i.map((x) => x.textContent))).join(' | ');
    assert.ok(/EASN\.anim/.test(await names()), 'Rev 0 lists the EASN animation');
    await page.selectOption('#revision', 'b');
    await page.waitForTimeout(800);
    const rev = await names();
    assert.ok(/EASports\.map\.jim/.test(rev) && !/EASN\.anim/.test(rev), 'Rev B lists EA Sports, not EASN');
    await page.selectOption('#revision', 'a');
    await page.waitForTimeout(800);
    assert.ok(/EASN\.anim/.test(await names()), 'Rev A lists the EASN animation again');
    await page.selectOption('#game', 'nhl92');
    await page.waitForTimeout(800);
    assert.deepStrictEqual(await page.$$eval('#revision option', (o) => o.map((x) => x.value)), ['0', 'a'], 'NHL 92 offers retail and Rev A');
    await page.selectOption('#game', 'nhl94');
    await page.waitForTimeout(800);
    assert.ok(await page.$eval('#revision-field', (f) => f.hidden), 'picker hides for a game with one layout');
    const problems = page.problems.filter((p) => !OPTIONAL.test(p));
    assert.deepStrictEqual(problems, [], problems.join('; '));
    await page.close();
  });
  if (ok) console.log('revision-picker: NHLPA 93 Rev 0 / A / B switch and hide on other games OK');
})().catch((err) => { console.error(err); process.exit(1); });
