/**
 * Browser: NHLPA 93 SNES sound test voice roll shows key-ons for one song and one effect.
 *   node test/browser/snes93-roll.js
 */
const assert = require('assert');
const { withBrowser } = require('./harness');

(async () => {
  const ran = await withBrowser('snes93-roll', async ({ url, newPage }) => {
    const page = await newPage(1300);
    await page.goto(url);
    await page.selectOption('#game', 'nhlpa93snes');
    await page.waitForTimeout(800);
    await page.click('#mode-soundtest');
    await page.waitForSelector('#catalog .item', { timeout: 60000 });
    const playAndCount = async (labelPart) => {
      await page.$$eval('#catalog .item', (nodes, part) => {
        const hit = nodes.find((n) => (n.querySelector('.name') || {}).textContent.includes(part));
        if (hit) hit.click();
      }, labelPart);
      await page.waitForSelector('#sound-test-toggle', { timeout: 20000 });
      await page.click('#sound-test-toggle');
      await page.waitForFunction(() => /Playing/.test((document.querySelector('.st-status') || {}).textContent || ''), null, { timeout: 30000 });
      await page.waitForTimeout(1200);
      return page.evaluate(() => {
        const st = window.NhlSoundTestView && window.NhlSoundTestView.seqState && window.NhlSoundTestView.seqState();
        const cmds = (st && st.commands) || [];
        return cmds.filter((c) => c.name === 'keyOn').length;
      });
    };
    const songKeys = await playAndCount('SngGoal');
    assert.ok(songKeys >= 5, 'song roll has key-ons: ' + songKeys);
    await page.click('#sound-test-toggle');
    await page.waitForTimeout(400);
    const fxKeys = await playAndCount('$89');
    if (fxKeys < 1) {
      const anyFx = await playAndCount('crowd');
      assert.ok(anyFx >= 1, 'effect roll has key-ons: $89=' + fxKeys + ' crowd=' + anyFx);
    }
    await page.close();
  });
  if (ran) console.log('snes93-roll: song and effect voice roll OK');
})().catch((err) => { console.error(err); process.exit(1); });
