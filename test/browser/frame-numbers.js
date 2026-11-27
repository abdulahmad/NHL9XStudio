/**
 * Browser test: frame numbers follow each game's own numbering everywhere the viewer shows, takes or writes one
 * (lib/frame-number.js): Genesis / Sega CD / SNES from 1, PC from 0. Uses NHL 92's bundled banks (no ROM needed), then
 * marks the open game as a PC one, which is all the numbering reads, and checks the same places count from 0: the
 * step readout, filmstrip labels, the frame details, the SPF list ranges, the URL and the exported PNG name. Old links
 * (no base=0) still open the stored 1-based frame.
 *
 *   node test/browser/frame-numbers.js
 */
const assert = require('assert');
const { withBrowser } = require('./harness');

async function snapshot(page) {
  return page.evaluate(() => ({
    readout: document.getElementById('frame-readout').textContent,
    first: (document.querySelector('#filmstrip .thumb span') || {}).textContent,
    current: (document.querySelector('#filmstrip .thumb.is-current span, #filmstrip .thumb[aria-current="true"] span') || {}).textContent,
    title: document.getElementById('detail-title').textContent,
    hash: location.hash,
    frame: state.frame
  }));
}

withBrowser('frame-numbers', async ({ url, newPage }) => {
  const page = await newPage(1280);
  await page.goto(url + '#game=nhl92&mode=frame&frame=5');
  await page.waitForFunction(() => /\(of /.test(document.getElementById('frame-readout').textContent) && document.querySelector('#filmstrip .thumb span'), null, { timeout: 30000 });

  // Genesis: from 1.
  let s = await snapshot(page);
  assert.strictEqual(s.frame, 5);
  assert.match(s.readout, /^5 \(of 1–\d+\)$/, 'Genesis readout: ' + s.readout);
  assert.strictEqual(s.first, '1', 'Genesis filmstrip starts at 1');
  assert.strictEqual(s.title, 'Frame 5');
  assert.match(s.hash, /[#&]frame=5(&|$)/);
  assert.ok(!/base=/.test(s.hash), 'no base=0 on a Genesis link');
  const genesisEnd = Number(s.readout.match(/–(\d+)\)/)[1]);

  // The same bank as a PC game: from 0, one less than the stored frame.
  await page.evaluate(() => { gameInfo.platform = 'pc'; refreshAll(); });
  s = await snapshot(page);
  assert.strictEqual(s.frame, 5, 'stored frame unchanged');
  assert.strictEqual(s.readout, '4 (of 0–' + (genesisEnd - 1) + ')', 'PC readout: ' + s.readout);
  assert.strictEqual(s.first, '0', 'PC filmstrip starts at 0');
  assert.strictEqual(s.title, 'Frame 4');
  assert.match(s.hash, /[#&]frame=4(&|$)/);
  assert.match(s.hash, /[#&]base=0(&|$)/);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#export-frame')]);
  assert.match(dl.suggestedFilename(), /_frame004\.png$/, 'PC export name: ' + dl.suggestedFilename());

  // SPF ranges in the list.
  await page.click('#mode-spf');
  await page.waitForSelector('#catalog .item .sub');
  const pcRange = await page.$eval('#catalog .item .sub', (e) => e.textContent);
  await page.evaluate(() => { gameInfo.platform = 'genesis'; refreshAll(); });
  const genRange = await page.$eval('#catalog .item .sub', (e) => e.textContent);
  const a = pcRange.match(/^(\d+)–(\d+)/), b = genRange.match(/^(\d+)–(\d+)/);
  assert.ok(a && b, 'SPF ranges: ' + pcRange + ' / ' + genRange);
  assert.strictEqual(Number(a[1]), Number(b[1]) - 1);
  assert.strictEqual(Number(a[2]), Number(b[2]) - 1);

  // Links: base=0 carries a 0-based number, an old link without it the stored frame.
  const page2 = await newPage(1280);
  await page2.goto(url + '#game=nhl92&mode=frame&frame=0&base=0');
  await page2.waitForFunction(() => /\(of /.test(document.getElementById('frame-readout').textContent), null, { timeout: 30000 });
  assert.strictEqual(await page2.evaluate(() => state.frame), 1, 'frame=0&base=0 opens the first picture');
  await page2.goto(url + '#game=nhl92&mode=frame&frame=12');
  await page2.reload();
  await page2.waitForFunction(() => /\(of /.test(document.getElementById('frame-readout').textContent), null, { timeout: 30000 });
  assert.strictEqual(await page2.evaluate(() => state.frame), 12, 'old link keeps the stored frame');

  assert.deepStrictEqual(page.problems.filter((p) => !/Failed to load resource/.test(p)), []);
  console.log('frame-numbers: Genesis 1-based, PC 0-based (readout, filmstrip, details, SPF list, URL, export name)');
});
