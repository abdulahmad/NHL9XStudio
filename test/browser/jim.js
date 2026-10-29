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
const { parseScreen94, encodeScreen94Zip, parseScreen94Zip } = require('../../lib/sscr');
const { crc32 } = require('../../lib/zip-store');
const zlib = require('zlib');

function pngRgb(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const at = y * (width * 3 + 1) + 1 + x * 3;
      raw[at] = rgb[0];
      raw[at + 1] = rgb[1];
      raw[at + 2] = rgb[2];
    }
  }
  function chunk(type, data) {
    const t = Buffer.from(type);
    const body = Buffer.concat([t, data]);
    const crc = crc32(body);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc, 8 + data.length);
    return out;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

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
  assert.match(await page.title(), /Image Editor/);
  assert.ok(await page.locator('#jim-map').count());
  assert.ok(await page.locator('#jim-exit').count());
  assert.ok(await page.locator('#jim-pri').count());
  assert.ok(await page.locator('#jim-png').count());
  assert.ok(await page.locator('#jim-act-export').count());
  assert.ok(await page.locator('#jim-kind').count());
  assert.ok(await page.locator('#jim-dobitmap').count());
  assert.strictEqual(await page.locator('#jim-dobitmap').evaluate((el) => el.tagName), 'SELECT');
  const dobitmap = await page.locator('#jim-dobitmap option').evaluateAll((opts) => opts.map((o) => o.value));
  assert.strictEqual(dobitmap.length, 17, 'Genesis dobitmap lists Auto plus every 4-bit mask');
  assert.ok(dobitmap.includes('auto') && dobitmap.includes('00') && dobitmap.includes('02') && dobitmap.includes('0C') && dobitmap.includes('0D') && dobitmap.includes('0F'));
  assert.match(await page.locator('label:has(#jim-only-empty)').getAttribute('title'), /skip cells that already have a tile/i);
  assert.ok(await page.locator('#jim-split').count());
  const chromeFit = await page.locator('#jim-chrome').evaluate((el) => ({ h: el.clientHeight, sh: el.scrollHeight }));
  assert.ok(chromeFit.sh <= chromeFit.h + 2, 'middle-pane tools fit without scrolling ' + JSON.stringify(chromeFit));
  assert.ok(await page.locator('[data-tool="paint"]').isVisible());
  assert.ok(await page.locator('#jim-sel-all').isVisible());
  assert.ok(await page.locator('.jim-preview-set').isVisible());
  assert.ok(await page.locator('#jim-tiles-more').count());
  const tilesH0 = await page.locator('#jim-tiles').evaluate((e) => e.getBoundingClientRect().height);
  await page.click('#jim-tiles-more');
  const tilesH1 = await page.locator('#jim-tiles').evaluate((e) => e.getBoundingClientRect().height);
  assert.ok(tilesH1 > tilesH0 + 80, 'Show more tiles grows the sheet ' + tilesH0 + ' -> ' + tilesH1);
  assert.match(await page.locator('#jim-tiles-more').textContent(), /fewer/i);
  const mapH0 = await page.locator('#jim-scroll').evaluate((e) => e.getBoundingClientRect().height);
  const split = await page.locator('#jim-split').boundingBox();
  await page.mouse.move(split.x + split.width / 2, split.y + 4);
  await page.mouse.down();
  await page.mouse.move(split.x + split.width / 2, split.y + 4 - 60, { steps: 5 });
  await page.mouse.up();
  const mapH1 = await page.locator('#jim-scroll').evaluate((e) => e.getBoundingClientRect().height);
  assert.ok(mapH1 > mapH0 + 20, 'map splitter shows more of the map ' + mapH0 + ' -> ' + mapH1);
  await page.locator('#jim-zoom').evaluate((el) => {
    el.value = '2';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.strictEqual(await page.locator('#jim-zoom').inputValue(), '2');
  assert.ok(await page.locator('#jim-memo').count());
  assert.ok(await page.locator('#jim-show-unused').count());
  assert.ok(await page.locator('#jim-import-mode').count());
  assert.match(await page.locator('label:has(#jim-import-mode)').textContent(), /Import mode/);
  assert.strictEqual(await page.locator('#jim-import-mode').inputValue(), 'replace');
  assert.ok(await page.locator('#jim-compare-a').count());
  assert.ok(await page.locator('#jim-palmap').count());
  assert.match(await page.textContent('#jim-map-px'), /pixels/);

  await page.setInputFiles('#jim-image', [{
    name: 'wide.png',
    mimeType: 'image/png',
    buffer: pngRgb(32, 16, [240, 32, 32])
  }]);
  await page.waitForFunction(() => /Floating wide\.png/.test(document.getElementById('jim-status').textContent), null, { timeout: 5000 });
  assert.match(await page.textContent('#jim-map-px'), /32×16 pixels/);
  assert.strictEqual(await page.locator('#jim-map-w').inputValue(), '4');
  assert.strictEqual(await page.locator('#jim-map-h').inputValue(), '2');
  assert.ok(await page.locator('#jim-float-bar').isVisible());
  await page.click('#jim-float-apply');
  await page.waitForFunction(() => /New image wide\.png/.test(document.getElementById('jim-status').textContent), null, { timeout: 5000 });
  assert.strictEqual(await page.locator('#jim-import-mode').inputValue(), 'replace');
  assert.strictEqual(await page.locator('#jim-map-w').inputValue(), '4');
  assert.strictEqual(await page.locator('#jim-map-h').inputValue(), '2');
  assert.match(await page.textContent('#jim-map-px'), /32×16 pixels/);

  const buf = rawJim();
  await page.setInputFiles('#jim-open', [{
    name: 'pri.map.jim',
    mimeType: 'application/octet-stream',
    buffer: buf
  }]);
  await page.waitForFunction(() => /Opened pri\.map\.jim/.test(document.getElementById('jim-status').textContent), null, { timeout: 5000 });
  assert.match(await page.textContent('#jim-status'), /Opened pri\.map\.jim/);
  assert.strictEqual(await page.locator('#jim-import-mode').inputValue(), 'place');
  assert.match(await page.textContent('#jim-map-px'), /8×8 pixels/);
  assert.ok(await page.isChecked('#jim-pri'));
  await page.click('#jim-sel-all');
  await page.selectOption('#jim-pal', '1');
  assert.strictEqual(await page.locator('#jim-pal').inputValue(), '1');
  await page.click('[data-tool="select"]');
  await page.keyboard.press('Control+z');
  assert.strictEqual(await page.locator('#jim-pal').inputValue(), '0');
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
  assert.ok(await page.locator('#jim-use-7').count());
  assert.ok(await page.locator('#jim-lock-7').count());
  assert.ok(await page.isChecked('#jim-use-5'));
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

  const map94 = Buffer.alloc(6 + 8 * 8 * 2);
  map94.writeUInt16LE(8, 0);
  map94.writeUInt16LE(8, 2);
  map94.writeUInt16LE(0x0308, 4);
  map94.writeUInt16LE(packSnesMapWord({ tile: 0, pal: 5, priority: 1, hFlip: 0, vFlip: 1 }), 6);
  const tile94 = packSnesTile(Uint8Array.from({ length: 64 }, (_, i) => (i === 0 ? 3 : 0)));
  const pal94 = Buffer.alloc(256);
  pal94.writeUInt16LE(0x7fff, 2);
  const screen94 = parseScreen94({
    tiles: Buffer.concat([Buffer.from(tile94), Buffer.alloc(32)]),
    map: map94,
    pal: pal94,
    fileNames: ['ProbeTiles.chr.huf', 'ProbeMap.map.rle']
  }, { name: 'probe.snes94.zip' });
  const zip94 = Buffer.from(encodeScreen94Zip(screen94, { packed: true }));
  await page.setInputFiles('#jim-open', [{
    name: 'probe.snes94.zip',
    mimeType: 'application/zip',
    buffer: zip94
  }]);
  await page.waitForFunction(() => /Opened probe\.snes94\.zip/.test(document.getElementById('jim-status').textContent), null, { timeout: 5000 });
  assert.match(await page.textContent('#jim-variant'), /SNES 94/);
  assert.ok(!(await page.locator('#jim-packed').isDisabled()));
  assert.strictEqual(await page.locator('#jim-pal').inputValue(), '5');
  let zipDl;
  try {
    [zipDl] = await Promise.all([
      page.waitForEvent('download', { timeout: 8000 }),
      page.click('#jim-export')
    ]);
  } catch (err) {
    throw new Error('94S export failed: status=' + (await page.textContent('#jim-status')) +
      ' note=' + (await page.textContent('#jim-note')) + ' orig=' + err.message);
  }
  assert.match(zipDl.suggestedFilename(), /snes94\.zip/);
  const zipOut = fs.readFileSync(await zipDl.path());
  const round = parseScreen94Zip(zipOut);
  assert.strictEqual(round.cells[0].pal, 5);
  assert.strictEqual(round.cells[0].priority, 1);
  assert.strictEqual(round.cells[0].vFlip, 1);
  assert.strictEqual(round.tiles[0][0], 3);

  const viewer = await newPage(1280);
  viewer.on('dialog', (dialog) => dialog.accept());
  await viewer.goto(url + '#game=nhl92&mode=image');
  await viewer.waitForSelector('#edit-image', { timeout: 10000 });
  await viewer.waitForSelector('.about-scrim:not([hidden])', { timeout: 5000 }).catch(() => null);
  const aboutOk = viewer.locator('.about-scrim:not([hidden]) button', { hasText: 'Got it' });
  if (await aboutOk.count()) await aboutOk.click();
  await viewer.waitForFunction(() => {
    const btn = document.getElementById('edit-image');
    const about = document.querySelector('.about-scrim');
    return btn && !btn.classList.contains('is-hidden') && btn.offsetParent !== null &&
      (!about || about.hidden);
  }, null, { timeout: 10000 });
  assert.ok(await viewer.locator('#edit-image').isVisible(), 'Images tab should show Edit image');
  assert.strictEqual(await viewer.locator('#edit-map').count(), 0, 'Details pane should not have a second Edit image');
  await viewer.setInputFiles('#file-open', [{
    name: 'pri.map.jim',
    mimeType: 'application/octet-stream',
    buffer: rawJim()
  }]);
  await viewer.waitForFunction(() => {
    const detail = (document.getElementById('detail') || {}).innerText || '';
    const cap = (document.getElementById('caption') || {}).textContent || '';
    return /pri\.map\.jim/i.test(detail + ' ' + cap);
  }, null, { timeout: 10000 });
  await viewer.click('#edit-image');
  await viewer.waitForURL(/jim\.html/, { timeout: 10000 });
  await viewer.waitForFunction(() => /Opened pri\.map\.jim|Imported pri/i.test(
    (document.getElementById('jim-status') || {}).textContent || ''
  ), null, { timeout: 8000 });
  assert.match(await viewer.title(), /Image Editor/);
  assert.strictEqual(await viewer.locator('#jim-import-mode').inputValue(), 'place');
  await viewer.close();

  console.log('jim browser: ok');
});
