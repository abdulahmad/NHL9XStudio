/**
 * Browser test: the Audio tab's lists. Songs and SFX are collapsible and start open; the DAC samples and Instruments
 * start closed. NHLPA 93 lists the label once (no "label | EQUATE"), and has an Instruments list whose entries play.
 *
 *   node test/browser/audio-list.js
 */
const assert = require('assert');
const { withBrowser } = require('./harness');
const OPTIONAL = /\/api\/games\/\w+\/rom/;

const groups = (page) => page.$$eval('#catalog .group-label', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
const items = (page) => page.$$eval('#catalog .item .name', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));

async function open(page, url, game) {
  await page.goto(url);
  await page.selectOption('#game', game);
  await page.waitForTimeout(1000);
  await page.click('#mode-soundtest');
  await page.waitForSelector('#catalog .item', { timeout: 60000 });
}

(async () => {
  const ran = await withBrowser('audio-list', async ({ url, newPage }) => {
    const page = await newPage(1300);
    for (const game of ['nhl92', 'nhlpa93', 'nhl94', 'nhl95', 'nhlpa93snes', 'nhl94snes']) {
      await open(page, url, game);
      let g = await groups(page);
      assert.ok(g.some((x) => /^▾ Songs/.test(x)) && g.some((x) => /^▾ SFX/.test(x)), game + ': Songs and SFX start open: ' + g.join(' | '));
      const isSnes = game.endsWith('snes');
      if (!isSnes) assert.ok(g.some((x) => /^▸ Instruments/.test(x)), game + ': Instruments start closed: ' + g.join(' | '));
      if (game === 'nhl95') assert.ok(g.some((x) => /MIDI/.test(x)), 'nhl95: MIDI tools listed: ' + g.join(' | '));
      const before = (await items(page)).length;
      // collapse SFX, then open it again
      await page.$$eval('#catalog .group-label', (n) => n.find((x) => /SFX/.test(x.textContent)).click());
      g = await groups(page);
      assert.ok(g.some((x) => /^▸ SFX/.test(x)), game + ': SFX collapsed');
      assert.ok((await items(page)).length < before - 10, game + ': collapsed SFX hides its rows');
      await page.$$eval('#catalog .group-label', (n) => n.find((x) => /SFX/.test(x.textContent)).click());
      assert.strictEqual((await items(page)).length, before, game + ': SFX reopened');
      if (game === 'nhlpa93') {
        assert.ok(!(await items(page)).some((x) => x.includes(' | ')), 'NHLPA 93 names appear once');
      }
      if (game === 'nhlpa93' || game === 'nhl94') {
        await page.$$eval('#catalog .group-label', (n) => n.find((x) => /Instruments/.test(x.textContent)).click());
        const inst = await page.$$eval('#catalog .item .name', (n) => n.map((x) => x.textContent).filter((t) => /patch/.test(t)));
        assert.ok(inst.length >= 30, game + ': Instruments list has ' + inst.length + ' entries');
        await page.$$eval('#catalog .item', (n) => n.find((x) => x.querySelector('.name').textContent === 'FM patch 1').click());
        await page.waitForSelector('#sound-test-toggle', { timeout: 20000 });
        await page.click('#sound-test-toggle');
        await page.waitForFunction(() => /Playing/.test((document.querySelector('.st-status') || {}).textContent || ''), null, { timeout: 30000 });
      } else if (game === 'nhl95') {
        // The 43 SoundBanks patches (nhl95-gm-map.json): a menus (list 0) FM patch and a game (list 1) PCM patch play.
        await page.$$eval('#catalog .group-label', (n) => n.find((x) => /Instruments/.test(x.textContent)).click());
        const inst = await page.$$eval('#catalog .item .name', (n) => n.map((x) => x.textContent).filter((t) => /^Patch \d+/.test(t)));
        assert.strictEqual(inst.length, 43, 'nhl95: Instruments list has ' + inst.length + ' entries');
        for (const name of ['Patch 11 · FM', 'Patch 0 · PCM', 'Patch 19 · PSG']) {
          await page.$$eval('#catalog .item', (n, t) => n.find((x) => x.querySelector('.name').textContent === t).click(), name);
          await page.waitForSelector('#sound-test-toggle', { timeout: 20000 });
          await page.click('#sound-test-toggle');
          await page.waitForFunction(() => /Playing/.test((document.querySelector('.st-status') || {}).textContent || ''), null, { timeout: 45000 });
          await page.click('#sound-test-toggle');
        }
        await page.$$eval('#catalog .item', (n) => n.find((x) => /TeamSongs BOS/.test((x.querySelector('.name') || {}).textContent)).click());
        await page.waitForSelector('#sound-test-toggle', { timeout: 20000 });
        await page.click('#sound-test-toggle');
        await page.waitForFunction(() => /Playing/.test((document.querySelector('.st-status') || {}).textContent || ''), null, { timeout: 45000 });
      } else if (game === 'nhlpa93snes' || game === 'nhl94snes') {
        const needle = game === 'nhlpa93snes' ? 'SngGoal' : 'SongBrassBonanza';
        await page.$$eval('#catalog .item', (nodes, part) => {
          const hit = nodes.find((n) => (n.querySelector('.name') || {}).textContent.includes(part));
          if (hit) hit.click();
        }, needle);
        await page.waitForSelector('#sound-test-toggle', { timeout: 20000 });
        await page.click('#sound-test-toggle');
        await page.waitForFunction(() => /Playing/.test((document.querySelector('.st-status') || {}).textContent || ''), null, { timeout: 45000 });
      }
    }
    const bad = page.problems.filter((p) => !OPTIONAL.test(p));
    assert.deepStrictEqual(bad, [], bad.join('\n'));
    await page.close();
  });
  if (ran) console.log('audio-list: groups collapse, NHLPA 93 names once, instruments play OK');
})().catch((err) => { console.error(err); process.exit(1); });
