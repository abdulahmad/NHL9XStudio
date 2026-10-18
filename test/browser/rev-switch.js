/**
 * Browser test: NHLPA 93 ROMs of different revisions opened one after another with Open file... must each show their
 * own picture list (Rev 0 / Rev A: EASN pictures, Rev B: EA Sports ones) and draw it, in either order.
 *
 *   node test/browser/rev-switch.js
 *
 * Needs nhlpa93retail.bin, nhlpa93retailRevA.bin and nhlpa93retailRevB.bin in roms/ (or next to the disassembly);
 * skipped without them.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { withBrowser } = require('./harness');

const NAMES = { r0: 'nhlpa93retail.bin', a: 'nhlpa93retailRevA.bin', b: 'nhlpa93retailRevB.bin' };
const DIRS = [path.join(__dirname, '..', '..', 'roms'), '/home/user/ea-nhl-disassembly-project/NHL93-Genesis'];
// The page probes for a ROM on the server before one is opened.
const OPTIONAL = /\/api\/games\/\w+\/rom/;
const find = (name) => DIRS.map((d) => path.join(d, name)).find((p) => fs.existsSync(p));

async function labels(page) {
  await page.waitForSelector('#catalog .item', { timeout: 60000 });
  return page.$$eval('#catalog .item', (items) => items.map((i) => i.textContent.replace(/\s+/g, ' ').trim()));
}

async function openRom(page, file) {
  await page.setInputFiles('#file-open', file);
  await page.waitForTimeout(2500);
}

async function check(page, rev, where) {
  const list = await labels(page);
  const text = list.join(' | ');
  if (rev === 'b') {
    assert.ok(/EASports\.map\.jim/.test(text), where + ': Rev B should list EASports.map.jim');
    assert.ok(!/EASN\.anim|EASN2\.map\.jim/.test(text), where + ': Rev B should not list the EASN animation');
  } else {
    assert.ok(/EASN\.anim/.test(text) && !/EASports/.test(text), where + ': Rev 0 / A should list the EASN pictures');
  }
  // each picture in the list opens and draws
  const total = await page.$$eval('#catalog .item', (items) => items.length);
  for (const pick of [0, Math.floor(total / 2), total - 1]) {
    await page.$$eval('#catalog .item', (items, n) => items[n].click(), pick);
    await page.waitForTimeout(700);
    const drawn = await page.$eval('canvas', (c) => {
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    }).catch(() => 0);
    assert.ok(drawn > 0, where + ': picture ' + pick + ' drew nothing');
  }
}

(async () => {
  const files = {};
  for (const [k, name] of Object.entries(NAMES)) files[k] = find(name);
  if (!files.r0 || !files.a || !files.b) { console.log('rev-switch: skipped (needs the three NHLPA 93 ROMs)'); return; }
  const ok = await withBrowser('rev-switch', async ({ url, newPage }) => {
    const orders = [['a', 'b', 'a'], ['b', 'r0', 'b'], ['r0', 'b']];
    for (const order of orders) {
      const page = await newPage(1280);
      await page.goto(url + '#game=nhlpa93&mode=image');
      for (const rev of order) {
        await openRom(page, files[rev]);
        await check(page, rev, order.join('>') + ' at ' + rev);
      }
      const problems = page.problems.filter((p) => !OPTIONAL.test(p));
      assert.deepStrictEqual(problems, [], order.join('>') + ': ' + problems.join('; '));
      await page.close();
    }
  });
  if (ok) console.log('rev-switch: Rev 0, Rev A and Rev B open one after another in every order OK');
})().catch((err) => { console.error(err); process.exit(1); });
