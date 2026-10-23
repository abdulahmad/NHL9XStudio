/**
 * Browser test: the jersey editor (public/jed.html). Opens the NHL 95 PC and NHL 94 PC HOMEPALS / AWAYPALS fixtures,
 * checks the team lists, that an unedited export is byte-identical, that an RGB edit lands in the file, and the .ACT
 * and .bin export / import buttons. With NHL 94 PC sprites on disk (pc94/ here, or NHL_PC94_DIR, or EA-NHL-Tools'
 * Sprite-Viewer/pc94 next to this checkout) it also loads them and checks the preview strip; NHL_JED_SHOT=<png> saves a
 * screenshot.
 *
 *   node test/browser/jed.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { withBrowser, ROOT } = require('./harness');

const FIX = path.join(ROOT, 'test', 'fixtures', 'pc-jersey');
const fix = (file, name) => ({ name, mimeType: 'application/octet-stream', buffer: fs.readFileSync(path.join(FIX, file)) });
const PC94 = [process.env.NHL_PC94_DIR, path.join(ROOT, 'pc94'), path.join(ROOT, '..', 'EA-NHL-Tools', 'Sprite-Viewer', 'pc94')]
  .filter(Boolean).find((d) => fs.existsSync(path.join(d, '000_049.PPV')));
const OPTIONAL = /Failed to load resource.*\/api\//;

async function download(page, button) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(button)]);
  return { name: dl.suggestedFilename(), bytes: fs.readFileSync(await dl.path()) };
}
async function upload(page, button, file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(button)]);
  await chooser.setFiles(file);
  await page.waitForTimeout(200);
}

withBrowser('jed', async ({ url, newPage }) => {
  const page = await newPage(1400);
  await page.goto(url + 'jed.html');
  await page.setInputFiles('#jed-files', [fix('HOMEPALS95.BIN', 'HOMEPALS.BIN'), fix('AWAYPALS95.BIN', 'AWAYPALS.BIN')]);
  await page.waitForSelector('#jed-team-list .item');
  assert.match(await page.textContent('#jed-status'), /NHL 95 PC/);
  assert.strictEqual(await page.locator('#jed-team-list .item').count(), 28);
  assert.strictEqual(await page.locator('#jed-swatches .jed-sw').count(), 64);
  assert.strictEqual(await page.locator('#jed-zones .jed-zone').count(), 48); // jersey zones; the crest is the picture
  assert.match(await page.textContent('#jed-zones'), /Scoreboard crest: CRESTS4\.PPV not found/);
  assert.strictEqual(await page.locator('#jed-zones .jed-zgroup').count() > 10, true, 'light/medium/dark rows');
  assert.strictEqual(await page.textContent('#jed-export-file'), 'Export homepals.bin');
  assert.ok(await page.isVisible('#jed-empty'), 'no-sprites guidance shown');

  // crest logo: 5x4 picture in the team palette; clicking a pixel paints it and the logo repaints
  const crestRgb = () => page.evaluate(() => Array.from(document.getElementById('jed-crest').getContext('2d').getImageData(2, 2, 1, 1).data.slice(0, 3)));
  assert.ok(await page.isVisible('#jed-crest'), 'crest logo shown');
  await page.locator('#jed-swatches .jed-sw').nth(5).click();
  await page.click('#jed-crest', { position: { x: 3, y: 3 } });
  const want = await page.evaluate(() => [document.getElementById('jed-r').value, document.getElementById('jed-g').value, document.getElementById('jed-b').value].map((v) => Math.min(255, Number(v) * 4)));
  assert.deepStrictEqual(await crestRgb(), want, 'crest pixel repainted with colour 5');
  assert.match(await page.textContent('#jed-status'), /crest r1c1 now uses colour 5/);
  await page.click('#jed-undo');

  // 6-bit + 8-bit readout, hex entry quantized to 6-bit
  await page.fill('#jed-hex-in', '#FF8040');
  assert.deepStrictEqual(await page.evaluate(() => ['r', 'g', 'b'].map((k) => Number(document.getElementById('jed-' + k).value))), [63, 32, 16]);
  assert.match(await page.textContent('#jed-hex'), /6-bit 63, 32, 16 · 8-bit 252, 128, 64/);
  await page.fill('#jed-hex-in', '#zz'); assert.ok(await page.$eval('#jed-hex-in', (e) => e.classList.contains('bad')));
  await page.click('#jed-undo');
  // instant custom tooltip on swatches (no native title)
  await page.locator('#jed-swatches .jed-sw').nth(3).hover();
  assert.ok(await page.isVisible('#jed-tip'), 'tooltip shown at once');
  assert.match(await page.textContent('#jed-tip'), /^Colour 3 \(game 131\) · 6-bit/);
  assert.strictEqual(await page.locator('#jed-swatches .jed-sw[title]').count(), 0);
  // click-paints off: clicking the crest selects the colour it uses
  await page.uncheck('#jed-paint');
  await page.click('#jed-crest', { position: { x: 3, y: 3 } });
  assert.match(await page.textContent('#jed-status'), /crest r1c1 uses (colour|rink colour) \d+/);
  await page.check('#jed-paint');

  if (process.env.NHL_PC95_DIR) { // real game: scoreboard crest from CRESTS4.PPV, live
    const dir = process.env.NHL_PC95_DIR;
    await page.setInputFiles('#jed-files', ['HOMEPALS.BIN', 'AWAYPALS.BIN', 'CRESTS4.PPV'].map((n) => path.join(dir, n)));
    await page.waitForSelector('#jed-sbcrest');
    assert.deepStrictEqual(await page.$eval('#jed-sbcrest', (c) => [c.width, c.height]), [192, 144]);
    if (process.env.NHL_CREST_SHOT) { await page.setViewportSize({ width: 1920, height: 1080 }); await page.screenshot({ path: process.env.NHL_CREST_SHOT }); }
    await page.setInputFiles('#jed-files', [fix('HOMEPALS95.BIN', 'HOMEPALS.BIN'), fix('AWAYPALS95.BIN', 'AWAYPALS.BIN')]);
    await page.waitForFunction(() => !document.getElementById('jed-sbcrest'));
    await page.setViewportSize({ width: 1400, height: 900 });
  }

  // unedited export: identical
  let out = await download(page, '#jed-export-file');
  assert.strictEqual(out.name, 'HOMEPALS.BIN');
  assert.ok(out.bytes.equals(fs.readFileSync(path.join(FIX, 'HOMEPALS95.BIN'))), 'home export identical');
  await page.click('#jed-away');
  out = await download(page, '#jed-export-file');
  assert.ok(out.bytes.equals(fs.readFileSync(path.join(FIX, 'AWAYPALS95.BIN'))), 'away export identical');

  // team 2 (Calgary) away, colour 5 -> R 63
  await page.locator('#jed-team-list .item').nth(2).click();
  await page.locator('#jed-swatches .jed-sw').nth(5).click();
  await page.fill('#jed-rn', '63');
  await page.press('#jed-rn', 'Enter');
  out = await download(page, '#jed-export-file');
  const away = fs.readFileSync(path.join(FIX, 'AWAYPALS95.BIN'));
  assert.strictEqual(out.bytes[2 * 448 + 15], 63);
  out.bytes[2 * 448 + 15] = away[2 * 448 + 15];
  assert.ok(out.bytes.equals(away), 'only the edited byte changed');
  assert.strictEqual(await page.textContent('#jed-import-file-btn'), 'Import awaypals.bin');
  // undo / redo (button and Ctrl+Z)
  await page.click('#jed-undo');
  out = await download(page, '#jed-export-file');
  assert.ok(out.bytes.equals(away), 'undo');
  await page.click('#jed-redo');
  out = await download(page, '#jed-export-file');
  assert.strictEqual(out.bytes[2 * 448 + 15], 63, 'redo');
  await page.click('#jed-team-list'); await page.keyboard.press('Control+z');
  out = await download(page, '#jed-export-file');
  assert.ok(out.bytes.equals(away), 'Ctrl+Z');
  await page.keyboard.press('Control+Shift+z');

  // ACT and .bin exports for the selected team / side
  const act = await download(page, '#jed-export-act');
  assert.strictEqual(act.name, 'CGYV.ACT');
  assert.strictEqual(act.bytes.length, 768);
  { // sprite-colour space: identical to lib/pc-jersey toAct on the edited file (= EA-NHL-Tools createPal merge)
    const J = require('../../lib/pc-jersey');
    const pals = path.join(ROOT, 'test', 'fixtures', 'PAL-To-ACT');
    const base = { rink: fs.readFileSync(path.join(pals, 'rinkpalShadowfixed.act')), jersey: fs.readFileSync(path.join(pals, 'createjerseyShadowfixed.act')) };
    const edited = J.openFile(out.bytes);
    edited.bytes[2 * 448 + 15] = 63;
    assert.ok(Buffer.from(J.toAct(edited, 2, base)).equals(act.bytes), 'ACT = sprite palette');
    const untouched = fs.readFileSync(path.join(FIX, 'createPal', 'NHL95PAL', 'AWAYPALS', 'CGY-01-createPal.ACT'));
    assert.ok(!untouched.equals(act.bytes) || !J.slotSources(edited, 2)[5].length, 'edit shows in the ACT');
  }
  const bin = await download(page, '#jed-export-bin');
  assert.strictEqual(bin.name, 'CGY_away.bin');
  assert.strictEqual(bin.bytes.length, 448);

  // revert, then import the edited .bin back: same edit; import the ACT into team 0: its colours change
  await page.click('#jed-revert');
  out = await download(page, '#jed-export-file');
  assert.ok(out.bytes.equals(away), 'revert');
  await upload(page, '#jed-import-bin-btn', { name: 'CGYV.BIN', mimeType: 'application/octet-stream', buffer: bin.bytes });
  out = await download(page, '#jed-export-file');
  assert.ok(out.bytes.subarray(2 * 448, 3 * 448).equals(bin.bytes), 'bin import');
  // whole-file import for this side, and undo of it
  await upload(page, '#jed-import-file-btn', { name: 'AWAYPALS.BIN', mimeType: 'application/octet-stream', buffer: fs.readFileSync(path.join(FIX, 'HOMEPALS95.BIN')) });
  out = await download(page, '#jed-export-file');
  assert.ok(out.bytes.equals(fs.readFileSync(path.join(FIX, 'HOMEPALS95.BIN'))), 'awaypals.bin import');
  await page.click('#jed-undo');
  await upload(page, '#jed-import-bin-btn', { name: 'bad.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(100) });
  assert.match(await page.textContent('#jed-status'), /448 bytes/);
  await page.click('#jed-revert');
  await upload(page, '#jed-import-act-btn', { name: 'CGYV.ACT', mimeType: 'application/octet-stream', buffer: act.bytes });
  assert.match(await page.textContent('#jed-status'), /team colours set/);
  out = await download(page, '#jed-export-file');
  assert.ok(out.bytes.subarray(2 * 448, 3 * 448).equals(bin.bytes), 'ACT import restores the edit, map untouched');

  // NHL 94 PC: 26 teams, identical export; sprites when present
  const files94 = [fix('HOMEPALS94.BIN', 'HOMEPALS.BIN'), fix('AWAYPALS94.BIN', 'AWAYPALS.BIN')];
  if (PC94) {
    for (const n of fs.readdirSync(PC94)) if (/^\d{3}_\d{3}\.PPV$|^RINKPAL\.QPP$/i.test(n)) files94.push({ name: n, mimeType: 'application/octet-stream', buffer: fs.readFileSync(path.join(PC94, n)) });
  }
  await page.setInputFiles('#jed-files', files94);
  await page.waitForFunction(() => /NHL 94 PC/.test(document.getElementById('jed-status').textContent), null, { timeout: 60000 });
  assert.strictEqual(await page.locator('#jed-team-list .item').count(), 26);
  out = await download(page, '#jed-export-file');
  assert.ok(out.bytes.equals(fs.readFileSync(path.join(FIX, 'HOMEPALS94.BIN'))), '94 export identical');
  if (PC94) {
    const thumbs = await page.locator('#jed-strip .jed-thumb').count();
    assert.ok(thumbs > 500, 'preview strip lists the frames (' + thumbs + ')');
    assert.ok(await page.$eval('#jed-canvas', (c) => c.width > 1), 'preview frame drawn');
    assert.strictEqual(await page.inputValue('#jed-frame'), '369', 'default frame 369');
    assert.strictEqual(await page.textContent('#jed-scale-val'), '13×');
    assert.strictEqual(await page.getAttribute('#jed-scale', 'max'), '30');
    // hover a spot: its pixels are outlined; hover / click the sprite: JED painting
    const shown = await page.evaluate(() => { const c = document.getElementById('jed-canvas'); return { w: c.width, h: c.height }; });
    const spot = await page.evaluate(() => {
      for (const b of document.querySelectorAll('#jed-zones .jed-zone')) { b.dispatchEvent(new MouseEvent('mouseenter')); if (Number(document.getElementById('jed-overlay').dataset.outlined) > 0) return Number(b.dataset.sprite); }
      return null;
    });
    assert.ok(spot != null, 'some spot is outlined on frame 369');
    await page.mouse.move(0, 0);
    // find a team pixel on the big frame and click it
    const hit = await page.evaluate(() => {
      const c = document.getElementById('jed-canvas'), r = c.getBoundingClientRect();
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const px = r.left + (x + 0.5) * r.width / c.width, py = r.top + (y + 0.5) * r.height / c.height;
        c.dispatchEvent(new MouseEvent('mousemove', { clientX: px, clientY: py, bubbles: true }));
        if (Number(document.getElementById('jed-overlay').dataset.outlined) > 0) return { px, py };
      }
      return null;
    });
    assert.ok(hit, 'hovering the sprite outlines a spot');
    await page.locator('#jed-swatches .jed-sw').nth(63).click();
    const before = (await download(page, '#jed-export-file')).bytes;
    await page.mouse.click(hit.px, hit.py);
    const after = (await download(page, '#jed-export-file')).bytes;
    const diff = []; for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) diff.push(i);
    assert.ok(diff.length <= 1 && (!diff.length || after[diff[0]] === 128 + 63), 'sprite click repoints one spot (' + diff + ')');
    await page.keyboard.press('Control+z');
    assert.ok((await download(page, '#jed-export-file')).bytes.equals(before), 'undo sprite paint');
    assert.ok(shown.w > 1);
    // layout: fills the viewport, the zone list is not clipped, the splitter resizes the grid
    for (const [w, h] of [[1920, 1080], [1280, 800]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(200);
      const m = await page.evaluate(() => {
        const r = (id) => document.getElementById(id).getBoundingClientRect();
        return { main: document.querySelector('.jed-main').getBoundingClientRect().bottom, zones: r('jed-zones'), edit: document.querySelector('.jed-edit').getBoundingClientRect(), strip: r('jed-strip'), stage: r('jed-stage'), scroll: document.documentElement.scrollHeight };
      });
      assert.ok(m.scroll <= h + 1 && m.main <= h + 1 && m.main > h - 40, w + 'x' + h + ' fills the viewport ' + JSON.stringify(m));
      assert.ok(m.zones.bottom <= m.edit.bottom + 1 && m.zones.height > 100, w + 'x' + h + ' zone list fits its column');
      assert.ok(m.stage.height > m.strip.height * 0.6 && m.strip.height > 250, w + 'x' + h + ' preview / grid sizes');
      if (process.env.NHL_JED_SHOT) await page.screenshot({ path: process.env.NHL_JED_SHOT.replace(/\.png$/, '-' + w + 'x' + h + '.png') });
    }
    const bar = await page.$eval('#jed-split', (b) => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 4 }; });
    const h0 = await page.$eval('#jed-strip', (e) => e.getBoundingClientRect().height);
    await page.mouse.move(bar.x, bar.y); await page.mouse.down(); await page.mouse.move(bar.x, bar.y + 100, { steps: 5 }); await page.mouse.up();
    const h1 = await page.$eval('#jed-strip', (e) => e.getBoundingClientRect().height);
    assert.ok(Math.abs(h0 - 100 - h1) < 6, 'splitter resizes the grid ' + h0 + ' -> ' + h1);
    assert.strictEqual(Number(await page.evaluate(() => localStorage.getItem('jed.stripHeight'))), Math.round(h1));
    await page.setViewportSize({ width: 1920, height: 1080 }); await page.fill('#jed-scale', '6'); await page.dispatchEvent('#jed-scale', 'input');
    await page.click('#jed-next');
    const nbs = await page.locator('#jed-left .jed-nb, #jed-right .jed-nb').count();
    assert.ok(nbs >= 2, 'neighbouring frames shown (' + nbs + ')');
    const was = await page.inputValue('#jed-frame');
    await page.locator('#jed-right .jed-nb').first().click();
    assert.strictEqual(Number(await page.inputValue('#jed-frame')), Number(was) + 1, 'clicking a neighbour selects it');
    await page.locator('#jed-team-list .item').nth(3).click();
    if (process.env.NHL_JED_SHOT) await page.screenshot({ path: process.env.NHL_JED_SHOT, fullPage: false });
  } else console.log('jed: no NHL 94 PC sprites on disk, preview not checked');

  const problems = page.problems.filter((p) => !OPTIONAL.test(p));
  assert.deepStrictEqual(problems, []);
  console.log('jed: ok');
}).catch((err) => { console.error(err); process.exit(1); });
