/**
 * Export frame writes an 8-bit indexed PNG (PLTE), not a flattened truecolor canvas PNG.
 *
 *   node test/browser/indexed-export.js
 */
const assert = require('assert');
const fs = require('fs');
const zlib = require('zlib');
const { withBrowser } = require('./harness');

function parsePng(buf) {
  assert.deepStrictEqual(Array.from(buf.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    chunks.push({ type, data: buf.subarray(i + 8, i + 8 + len) });
    i += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

withBrowser('indexed-export', async ({ url, newPage }) => {
  const page = await newPage(1280);
  await page.goto(url + '#game=nhl92&mode=frame');
  await page.waitForSelector('#export-frame', { timeout: 30000 });
  await page.waitForFunction(() => {
    const b = document.getElementById('export-frame');
    return b && !b.classList.contains('is-hidden') && !b.disabled;
  }, null, { timeout: 30000 });
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#export-frame')
  ]);
  const bytes = fs.readFileSync(await dl.path());
  assert.match(dl.suggestedFilename(), /\.png$/);
  const chunks = parsePng(bytes);
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  assert.strictEqual(ihdr[8], 8);
  assert.strictEqual(ihdr[9], 3, 'exported PNG is indexed (color type 3), palette in the file');
  const plte = chunks.find((c) => c.type === 'PLTE');
  assert.ok(plte && plte.data.length >= 3 && plte.data.length % 3 === 0, 'PLTE present');
  const trns = chunks.find((c) => c.type === 'tRNS');
  assert.ok(trns && trns.data[0] === 0, 'sprite color 0 is tRNS transparent');
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  assert.ok(zlib.inflateSync(idat).length > 0);
  console.log('indexed-export: ' + dl.suggestedFilename() + ' ' + ihdr.readUInt32BE(0) + '×' + ihdr.readUInt32BE(4) + ' PLTE ' + (plte.data.length / 3));
});
