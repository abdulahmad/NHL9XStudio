/**
 * Browser smoke: public/jim.html loads, opens a synthetic raw JIM, undoes a
 * paint, and exports an uncompressed file whose map word still has priority.
 *
 *   node test/browser/jim.js
 */
const assert = require('assert');
const { withBrowser } = require('./harness');

function rawJim() {
  const tiles = 1, palOff = 10 + 32, mapOff = palOff + 128;
  const out = Buffer.alloc(mapOff + 6);
  out.writeUInt32BE(palOff, 0);
  out.writeUInt32BE(mapOff, 4);
  out.writeUInt16BE(tiles, 8);
  out[10] = 0x10;
  out.writeUInt16BE(1, mapOff);
  out.writeUInt16BE(1, mapOff + 2);
  out.writeUInt16BE(0x8000, mapOff + 4); // tile 0, priority
  return out;
}

withBrowser('jim', async ({ url, newPage }) => {
  const page = await newPage(1280);
  await page.goto(url + 'jim.html');
  assert.strictEqual(page.problems.filter((p) => !/Failed to load resource/.test(p)).length, 0, page.problems.join('\n'));
  assert.ok(await page.locator('#jim-map').count());
  assert.ok(await page.locator('#jim-pri').count());
  const buf = rawJim();
  await page.setInputFiles('#jim-open', [{
    name: 'pri.map.jim',
    mimeType: 'application/octet-stream',
    buffer: buf
  }]);
  await page.waitForFunction(() => /Opened pri\.map\.jim/.test(document.getElementById('jim-status').textContent), null, { timeout: 5000 });
  assert.match(await page.textContent('#jim-status'), /Opened pri\.map\.jim/);
  assert.ok(await page.isChecked('#jim-pri'));
  await page.click('[data-tool="place"]');
  const box = await page.locator('#jim-map').boundingBox();
  await page.mouse.click(box.x + 4, box.y + 4);
  await page.keyboard.press('Control+z');
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#jim-export')
  ]);
  const name = dl.suggestedFilename();
  assert.match(name, /pri\.map\.jim/);
  const tmp = await dl.path();
  const fs = require('fs');
  const out = fs.readFileSync(tmp);
  assert.strictEqual(out.readUInt16BE(out.length - 2), 0x8000, 'priority bit survived export');
  console.log('jim browser: ok');
});
