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
  assert.strictEqual(await page.locator('#jed-zones .jed-zone').count(), 68);

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
  assert.strictEqual(bin.name, 'CGYV.BIN');
  assert.strictEqual(bin.bytes.length, 448);

  // revert, then import the edited .bin back: same edit; import the ACT into team 0: its colours change
  await page.click('#jed-revert');
  out = await download(page, '#jed-export-file');
  assert.ok(out.bytes.equals(away), 'revert');
  await upload(page, '#jed-import-bin-btn', { name: 'CGYV.BIN', mimeType: 'application/octet-stream', buffer: bin.bytes });
  out = await download(page, '#jed-export-file');
  assert.ok(out.bytes.subarray(2 * 448, 3 * 448).equals(bin.bytes), 'bin import');
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
