/**
 * Browser smoke: public/jim.html loads, opens a synthetic raw JIM, undoes a
 * paint, and exports an uncompressed file whose map word still has priority.
 * Also opens a packed SNES .map.sjim and a portrait, edits the portrait, and
 * checks the v1.1 chrome (PNG/ACT, dobitmap, kind, note).
 *
 *   node test/browser/jim.js
 */
const assert = require('assert');
const { withBrowser } = require('./harness');
const { compressBytecode, packPortrait, unpackPortrait } = require('../../lib/jim');
const { packSnesMapWord, packSnesTile, parseSjim } = require('../../lib/sjim');

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

function packedSjim() {
  const mapW = 8, mapH = 8, palBytes = 256;
  const unpacked = Buffer.alloc(mapW * mapH * 2 + palBytes + 32);
  unpacked.writeUInt16LE(packSnesMapWord({ tile: 0, pal: 5, priority: 1, hFlip: 0, vFlip: 0 }), 0);
  unpacked.writeUInt16LE(0x7fff, mapW * mapH * 2 + 2);
  const tile = packSnesTile(Uint8Array.from({ length: 64 }, (_, i) => (i === 0 ? 3 : 0)));
  Buffer.from(tile).copy(unpacked, mapW * mapH * 2 + palBytes);
  return Buffer.from(compressBytecode(unpacked));
}

function rawPortrait() {
  const tiles = Array.from({ length: 36 }, () => new Uint8Array(64));
  tiles[0][0] = 9;
  const rows = packPortrait(tiles);
  const out = Buffer.alloc(10 + rows.length);
  out.writeUInt32BE(0, 0);
  out.writeUInt32BE(0, 4);
  out.writeUInt16BE(36, 8);
  Buffer.from(rows).copy(out, 10);
  return out;
}

withBrowser('jim', async ({ url, newPage }) => {
  const page = await newPage(1280);
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(url + 'jim.html');
  assert.strictEqual(page.problems.filter((p) => !/Failed to load resource/.test(p)).length, 0, page.problems.join('\n'));
  assert.ok(await page.locator('#jim-map').count());
  assert.ok(await page.locator('#jim-pri').count());
  assert.ok(await page.locator('#jim-png').count());
  assert.ok(await page.locator('#jim-act-export').count());
  assert.ok(await page.locator('#jim-kind').count());
  assert.ok(await page.locator('#jim-dobitmap').count());
  assert.ok(await page.locator('#jim-memo').count());
  assert.ok(await page.locator('#jim-show-unused').count());

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
  const fs = require('fs');
  const out = fs.readFileSync(await dl.path());
  assert.strictEqual(out.readUInt16BE(out.length - 2), 0x8000, 'priority bit survived export');

  const sjimBuf = packedSjim();
  await page.setInputFiles('#jim-open', [{
    name: 'probe.map.sjim',
    mimeType: 'application/octet-stream',
    buffer: sjimBuf
  }]);
  await page.waitForFunction(() => /Opened probe\.map\.sjim/.test(document.getElementById('jim-status').textContent), null, { timeout: 5000 });
  assert.match(await page.textContent('#jim-status'), /Opened probe\.map\.sjim/);
  assert.match(await page.textContent('#jim-variant'), /SNES/);
  assert.ok(await page.locator('#jim-packed').isDisabled());
  const palOptions = await page.locator('#jim-pal option').count();
  assert.strictEqual(palOptions, 8);
  assert.strictEqual(await page.locator('#jim-pal').inputValue(), '5');
  let sjimDl;
  try {
    [sjimDl] = await Promise.all([
      page.waitForEvent('download', { timeout: 8000 }),
      page.click('#jim-export')
    ]);
  } catch (err) {
    throw new Error('sjim export failed: status=' + (await page.textContent('#jim-status')) +
      ' note=' + (await page.textContent('#jim-note')) +
      ' problems=' + page.problems.join('; ') +
      ' orig=' + err.message);
  }
  assert.match(sjimDl.suggestedFilename(), /probe\.map\.sjim/);
  const sjimOut = fs.readFileSync(await sjimDl.path());
  const again = parseSjim(sjimOut, null, { name: 'probe.map.sjim' });
  assert.strictEqual(again.cells[0].pal, 5);
  assert.strictEqual(again.cells[0].priority, 1);
  assert.strictEqual(again.tiles[0][0], 3);

  const portraitBuf = rawPortrait();
  await page.setInputFiles('#jim-open', [{
    name: 'Card00.bin',
    mimeType: 'application/octet-stream',
    buffer: portraitBuf
  }]);
  await page.waitForFunction(() => /portrait/.test(document.getElementById('jim-status').textContent), null, { timeout: 5000 });
  assert.ok(!(await page.locator('#jim-portrait').isHidden()));
  await page.click('[data-tool="paint"]');
  const tileBox = await page.locator('#jim-tile-edit').boundingBox();
  await page.mouse.click(tileBox.x + 24, tileBox.y + 8);
  const [portDl] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#jim-export')
  ]);
  const portOut = fs.readFileSync(await portDl.path());
  assert.strictEqual(portOut.readUInt16BE(8), 36);
  const back = unpackPortrait(portOut, 10, 36);
  assert.strictEqual((back[0] >> 4) & 15, 9);
  assert.strictEqual(back[0] & 15, 5);

  console.log('jim browser: ok');
});
