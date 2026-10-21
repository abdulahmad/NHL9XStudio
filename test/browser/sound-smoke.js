/**
 * Browser: Sound test smoke for every game with playback (93G/94G/95G/93S/94S + NHL 92).
 * Opens Sound test, plays one catalog song (and one SNES effect when roll is set), expects "Playing".
 *
 *   node test/browser/sound-smoke.js
 */
const assert = require('assert');
const { withBrowser } = require('./harness');
const OPTIONAL = /\/api\/games\/\w+\/rom/;

const GAMES = [
  { id: 'nhl92', pick: 'SngTitle' },
  { id: 'nhlpa93', pick: 'SngGoal' },
  { id: 'nhl94', pick: 'TeamSongs BOS' },
  { id: 'nhl95', pick: 'TeamSongs BOS' },
  { id: 'nhlpa93snes', pick: 'SngGoal', roll: true },
  { id: 'nhl94snes', pick: 'SongBrassBonanza' }
];

async function openSound(page, url, gameId) {
  await page.goto(url);
  await page.selectOption('#game', gameId);
  await page.waitForTimeout(600);
  await page.click('#mode-soundtest');
  await page.waitForSelector('#catalog .item', { timeout: 60000 });
}

async function playLabel(page, labelPart) {
  await page.$$eval('#catalog .item', (nodes, part) => {
    const hit = nodes.find((n) => {
      const t = (n.querySelector('.name') || {}).textContent;
      return t.includes(part) || (part === 'SngGoal' && /\$30/.test(t));
    }) || nodes.find((n) => /Songs/.test((n.closest('[data-group]') || {}).getAttribute?.('data-group') || '') && (n.querySelector('.name') || {}).textContent.includes('song'));
    if (!hit) {
      const names = nodes.map((n) => (n.querySelector('.name') || {}).textContent).slice(0, 12);
      throw new Error('no catalog row matching ' + part + '; first rows: ' + names.join(' | '));
    }
    hit.click();
  }, labelPart);
  await page.waitForSelector('#sound-test-toggle', { timeout: 20000 });
  await page.click('#sound-test-toggle');
  await page.waitForFunction(() => /Playing/.test((document.querySelector('.st-status') || {}).textContent || ''), null, { timeout: 45000 });
}

(async () => {
  const ran = await withBrowser('sound-smoke', async ({ url, newPage }) => {
    const page = await newPage(1300);
    for (const g of GAMES) {
      await openSound(page, url, g.id);
      await playLabel(page, g.pick);
      await page.waitForTimeout(800);
      if (g.roll) {
        const songKeys = await page.evaluate(() => {
          const st = window.NhlSoundTestView && window.NhlSoundTestView.seqState && window.NhlSoundTestView.seqState();
          return ((st && st.commands) || []).filter((c) => c.name === 'keyOn').length;
        });
        assert.ok(songKeys >= 3, g.id + ': voice roll key-ons ' + songKeys);
        await page.click('#sound-test-toggle');
        await page.waitForTimeout(400);
        await playLabel(page, '$89');
        const fxKeys = await page.evaluate(() => {
          const st = window.NhlSoundTestView && window.NhlSoundTestView.seqState && window.NhlSoundTestView.seqState();
          return ((st && st.commands) || []).filter((c) => c.name === 'keyOn').length;
        });
        assert.ok(fxKeys >= 1, g.id + ': effect roll key-ons ' + fxKeys);
      }
      await page.click('#sound-test-toggle');
      await page.waitForTimeout(300);
    }
    const bad = page.problems.filter((p) => !OPTIONAL.test(p));
    assert.deepStrictEqual(bad, [], bad.join('\n'));
    await page.close();
  });
  if (ran) console.log('sound-smoke: 92/93/94/95 Genesis and 93S/94S Sound test play OK');
})().catch((err) => { console.error(err); process.exit(1); });
