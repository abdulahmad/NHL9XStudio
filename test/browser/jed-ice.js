/**
 * Browser test: the Centre ice tab of public/jed.html. Synthetic BOS.TIL / BOS.MAP plus the HOMEPALS / AWAYPALS
 * fixtures: tab switch, palette groups (away 192..250 blocked), byte-identical export, painting, moving, image import
 * (quantize, tiles, dedupe) and the placement JSON. With NHL_PC95_DIR (an NHL 95 PC install or extracted CD, local
 * only) it also opens the retail files, checks every arena exports byte-identically, and NHL_ICE_SHOT=<dir> saves
 * 1920x1080 screenshots.
 *
 *   node test/browser/jed-ice.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { withBrowser, ROOT } = require('./harness');

const FIX = path.join(ROOT, 'test', 'fixtures', 'pc-jersey');
const buf = (name, buffer) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(buffer) });
const OPTIONAL = /Failed to load resource.*\/api\//;

function png(w, h, rgba) { // minimal RGBA PNG writer
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
async function download(page, button) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(button)]);
  return { name: dl.suggestedFilename(), bytes: fs.readFileSync(await dl.path()) };
}
async function upload(page, button, file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(button)]);
  await chooser.setFiles(file); await page.waitForTimeout(300);
}

withBrowser('jed-ice', async ({ url, newPage }) => {
  const page = await newPage(1920);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(url + 'jed.html');
  // a server with pc95/ auto-loads it: let that finish before opening the test files
  await page.evaluate(() => window.JedShared.serverReady);
  const t0 = Buffer.alloc(64, 5), t1 = Buffer.alloc(64, 255); t1[9] = 140; // rink colour 5; home colour 140 on clear
  const til = Buffer.concat([t0, t1]);
  const map = Buffer.from([2, 0, 2, 0, 16, 0, 0, 0, 1, 0, 1, 0, 0, 0]);
  await page.setInputFiles('#jed-files', [buf('HOMEPALS.BIN', fs.readFileSync(path.join(FIX, 'HOMEPALS95.BIN'))), buf('AWAYPALS.BIN', fs.readFileSync(path.join(FIX, 'AWAYPALS95.BIN'))), buf('BOS.TIL', til), buf('BOS.MAP', map)]);
  await page.waitForSelector('#jed-team-list .item');
  // the jersey tab: away colours 59..63 are rink colours in NHL 95 PC
  await page.click('#jed-away');
  assert.strictEqual(await page.locator('#jed-swatches .jed-sw.rinkfixed').count(), 5);
  await page.click('#jed-home');
  assert.strictEqual(await page.locator('#jed-swatches .jed-sw.rinkfixed').count(), 0);

  await page.click('#tab-ice');
  await page.waitForSelector('#ice-team-list .item', { timeout: 5000 }).catch(async (e) => { console.log(page.problems, await page.textContent('#jed-status')); throw e; });
  assert.ok(await page.isHidden('main.jed-main'));
  assert.strictEqual(await page.locator('#ice-team-list .item').count(), 26);
  assert.strictEqual(await page.locator('#ice-swatches .ice-sw').count(), 256);
  assert.strictEqual(await page.locator('#ice-swatches .ice-sw.blocked').count(), 59, 'away 192..250 blocked');
  assert.strictEqual(await page.locator('#ice-swatches .ice-sw.src-home:not(.blocked)').count(), 64);
  assert.strictEqual(await page.locator('#ice-swatches .ice-sw.src-fixed').count(), 4);
  assert.deepStrictEqual([await page.inputValue('#ice-x'), await page.inputValue('#ice-y')], ['21', '38']);
  assert.match(await page.textContent('#ice-count'), /^2 \/ 1024/);
  // blocks: select the logo, mirror twice = unchanged; 90 adds tiles; copy / paste; tile delete / unused
  await page.click('#ice-sel-logo');
  assert.match(await page.textContent('#ice-sel-info'), /^Selection \d+ × \d+ at 21, 38/);
  await page.click('[data-xf="h"]');
  assert.match(await page.textContent('#jed-status'), /Mirrored .*tile pixels unchanged/);
  await page.click('[data-xf="h"]');
  assert.ok((await download(page, '#ice-export-map')).bytes.equals(map), 'mirror twice = original map');
  await page.click('[data-xf="90"]');
  assert.match(await page.textContent('#jed-status'), /Rotated 90°/);
  await page.click('#ice-undo'); await page.click('#ice-undo'); await page.click('#ice-undo');
  assert.ok((await download(page, '#ice-export-map')).bytes.equals(map), 'undo transforms');
  await page.click('#ice-sel-logo'); await page.click('#ice-copy'); await page.keyboard.press('Escape');
  await page.click('#ice-paste');
  assert.deepStrictEqual([await page.inputValue('#ice-x'), await page.inputValue('#ice-y')], ['0', '0'], 'pasted at 0,0');
  await page.click('#ice-undo');
  await page.click('#ice-unused');
  assert.match(await page.textContent('#jed-status'), /No unused tiles/);
  page.once('dialog', (d) => d.accept());
  await page.click('#ice-del-tile');
  assert.match(await page.textContent('#jed-status'), /Deleted tile \d+; \d+ cells? that used it are now empty/);
  await page.click('#ice-undo');
  await page.keyboard.press('Escape');
  await page.click('[data-tool="paint"]');
  // unedited export is byte-identical
  assert.ok((await download(page, '#ice-export-til')).bytes.equals(til));
  assert.ok((await download(page, '#ice-export-map')).bytes.equals(map));
  // paint a pixel of the bottom-left tile (shared tile 1 -> copy on write)
  await page.click('#ice-swatches .ice-sw[data-index="130"]');
  const box = await page.$eval('#ice-rink', (c) => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, s: r.width / 384 }; });
  await page.mouse.click(box.x + (21 * 8 + 3.5) * box.s, box.y + (39 * 8 + 3.5) * box.s);
  assert.match(await page.textContent('#ice-count'), /^3 \/ 1024/);
  let t = (await download(page, '#ice-export-til')).bytes;
  assert.strictEqual(t.length, 192); assert.strictEqual(t[128 + 27], 130);
  // blocked swatch cannot be chosen
  assert.ok(await page.isDisabled('#ice-swatches .ice-sw[data-index="200"]'));
  // move logo with the placement inputs, then undo
  await page.fill('#ice-x', '10'); await page.dispatchEvent('#ice-x', 'change');
  let j = JSON.parse((await download(page, '#ice-export-json')).bytes);
  assert.deepStrictEqual([j.arena, j.x, j.y, j.x2], ['BOS', 10, 38, -1]);
  await page.click('#ice-undo');
  assert.strictEqual(await page.inputValue('#ice-x'), '21');
  // drag with Move
  await page.click('[data-tool="move"]');
  await page.mouse.move(box.x + (22 * 8 + 4) * box.s, box.y + (38 * 8 + 4) * box.s); await page.mouse.down();
  await page.mouse.move(box.x + (25 * 8 + 4) * box.s, box.y + (40 * 8 + 4) * box.s, { steps: 4 }); await page.mouse.up();
  assert.deepStrictEqual([await page.inputValue('#ice-x'), await page.inputValue('#ice-y')], ['24', '40']);
  // image import: 32x16, left half solid home colour 140, right half transparent -> 1 unique tile
  const W = 32, H = 16, rgba = new Uint8Array(W * H * 4);
  const homeRgb = await page.evaluate(() => { const S = JedShared.state; return NhlPcJersey.getColors(S.files.home.file, 0)[12].map((v) => v * 4); });
  for (let i = 0; i < W * H; i++) if (i % W < 16) rgba.set([...homeRgb, 255], i * 4);
  await upload(page, '#ice-import-image', { name: 'logo.png', mimeType: 'image/png', buffer: png(W, H, rgba) });
  assert.match(await page.textContent('#jed-status'), /Imported logo\.png/);
  assert.match(await page.textContent('#ice-count'), /^1 \/ 1024/);
  const ex = (await download(page, '#ice-export-map')).bytes;
  assert.deepStrictEqual([ex.readUInt16LE(0), ex.readUInt16LE(2)], [2, 2]);
  t = (await download(page, '#ice-export-til')).bytes;
  assert.strictEqual(t.length, 64); assert.ok(t.every((v) => v === 140), 'quantized to the home colour');
  const logo = await download(page, '#ice-export-logo'); assert.strictEqual(logo.name, 'BOS-logo.png');
  // full-rink image (384x592) with a mask: only white cells become tiles
  const FW = 384, FH = 592, frgba = new Uint8Array(FW * FH * 4), mrgba = new Uint8Array(FW * FH * 4);
  for (let i = 0; i < FW * FH; i++) { frgba.set([...homeRgb, 255], i * 4); mrgba.set([0, 0, 0, 255], i * 4); }
  for (let y = 16; y < 32; y++) for (let x = 24; x < 48; x++) mrgba.set([255, 255, 255, 255], (y * FW + x) * 4);
  await upload(page, '#ice-mask', { name: 'mask.png', mimeType: 'image/png', buffer: png(FW, FH, mrgba) });
  assert.strictEqual(await page.inputValue('#ice-q-cells'), 'mask');
  await upload(page, '#ice-import-image', { name: 'rink.png', mimeType: 'image/png', buffer: png(FW, FH, frgba) });
  assert.match(await page.textContent('#jed-status'), /as a full rink, white cells of mask\.png: 1 \/ 1024/);
  assert.deepStrictEqual([await page.inputValue('#ice-x'), await page.inputValue('#ice-y')], ['3', '2']);
  const fmap = (await download(page, '#ice-export-map')).bytes; assert.deepStrictEqual([fmap.readUInt16LE(0), fmap.readUInt16LE(2)], [3, 2]);
  await page.selectOption('#ice-q-cells', 'all');
  // the jerseys tab still works
  await page.click('#tab-jerseys'); assert.ok(await page.isVisible('main.jed-main')); await page.click('#tab-ice');

  const DIR = process.env.NHL_PC95_DIR;
  if (DIR && fs.existsSync(path.join(DIR, 'RINK.QFS'))) {
    const names = fs.readdirSync(DIR).filter((n) => /^(HOMEPALS|AWAYPALS)\.BIN$|\.(TIL|MAP)$|^RINK\.QFS$|^RINKPAL\.QFS$/i.test(n));
    await page.setInputFiles('#jed-files', names.map((n) => buf(n, fs.readFileSync(path.join(DIR, n)))));
    await page.waitForTimeout(500);
    const items = page.locator('#ice-team-list .item');
    const arenas = await page.evaluate(() => NhlPcRink.ARENAS);
    for (let i = 0; i < arenas.length; i++) {
      await items.nth(i).click(); await page.waitForTimeout(150);
      const a = arenas[i];
      assert.ok((await download(page, '#ice-export-til')).bytes.equals(fs.readFileSync(path.join(DIR, a + '.TIL'))), a + '.TIL');
      assert.ok((await download(page, '#ice-export-map')).bytes.equals(fs.readFileSync(path.join(DIR, a + '.MAP'))), a + '.MAP');
    }
    const SHOT = process.env.NHL_ICE_SHOT;
    if (SHOT) {
      fs.mkdirSync(SHOT, { recursive: true });
      for (const [a, away] of [['TOR', 'MTL'], ['LA', 'EDM'], ['PIT', 'PHI'], ['WSH', 'NYR']]) {
        await items.nth(arenas.indexOf(a)).click(); await page.waitForTimeout(200);
        await page.selectOption('#ice-away', String(arenas.indexOf(away))); await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(SHOT, 'ice-' + a + '-1920x1080.png') });
      }
      if (process.env.NHL_ICE_RINK) { // full-rink mockup, cells that differ from RINK.QFS
        await items.nth(arenas.indexOf('TOR')).click(); await page.waitForTimeout(200);
        await page.selectOption('#ice-q-cells', 'diff');
        await upload(page, '#ice-import-image', process.env.NHL_ICE_RINK);
        console.log('jed-ice full rink: ' + await page.textContent('#jed-status'));
        await page.screenshot({ path: path.join(SHOT, 'ice-fullrink-1920x1080.png') });
        await page.selectOption('#ice-q-cells', 'all');
      }
      if (process.env.NHL_ICE_IMAGE) {
        await items.nth(arenas.indexOf('TOR')).click(); await page.waitForTimeout(200);
        await upload(page, '#ice-import-image', process.env.NHL_ICE_IMAGE);
        await page.screenshot({ path: path.join(SHOT, 'ice-import-1920x1080.png') });
      }
      { // blocks: TOR logo selected, copied, pasted and rotated 90° at 4x zoom
        await items.nth(arenas.indexOf('TOR')).click(); await page.waitForTimeout(200);
        await page.$eval('#ice-zoom', (e) => { e.value = '4'; e.dispatchEvent(new Event('input')); });
        await page.click('#ice-sel-logo'); await page.click('#ice-copy');
        await page.$eval('#ice-x', () => 0); await page.keyboard.press('Escape');
        await page.click('#ice-paste'); await page.click('[data-xf="90"]');
        await page.screenshot({ path: path.join(SHOT, 'ice-blocks-1920x1080.png') });
        await page.$eval('#ice-zoom', (e) => { e.value = '2'; e.dispatchEvent(new Event('input')); });
      }
      await page.click('#jed-away'.replace('jed-away', 'tab-jerseys')); await page.click('#jed-away'); await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOT, 'jerseys-away-1920x1080.png') });
    }
    console.log('jed-ice: 26 retail arenas export byte-identically');
  } else console.log('jed-ice: NHL_PC95_DIR not set, retail check skipped');

  const problems = page.problems.filter((p) => !OPTIONAL.test(p));
  assert.deepStrictEqual(problems, []);
  console.log('jed-ice: ok');
}).catch((err) => { console.error(err); process.exit(1); });
