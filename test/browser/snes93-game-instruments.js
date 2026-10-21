/**
 * Browser: the NHLPA 93 (SNES) song editor offers the game's own instruments of the song's sound set next to the GM
 * programs; a track set to one plays it directly ($E0 INSTRUMENT with that id) on the game's sound program.
 *
 *   node test/browser/snes93-game-instruments.js
 */
const assert = require('assert');
const { withBrowser } = require('./harness');

(async () => {
  const ran = await withBrowser('snes93-game-instruments', async ({ url, newPage }) => {
    const page = await newPage(1300);
    await page.goto(url);
    await page.selectOption('#game', 'nhlpa93snes');
    await page.waitForTimeout(800);
    await page.click('#mode-soundtest');
    await page.waitForSelector('#catalog .item', { timeout: 60000 });
    await page.$$eval('#catalog .item', (n) => n.find((x) => /Sequencer/.test((x.querySelector('.name') || {}).textContent)).click());
    await page.waitForSelector('#sn-program', { timeout: 20000 });
    await page.selectOption('#sn-set', 'game');
    await page.waitForTimeout(200);
    const game = await page.$$eval('#sn-program optgroup option', (o) => o.map((x) => Number(x.value) - 128));
    assert.ok(game.length >= 10 && game.every((i) => i >= 10 && i <= 0x1c), 'game set instruments: ' + game);
    await page.selectOption('#sn-set', 'boot');
    await page.waitForTimeout(200);
    const boot = await page.$$eval('#sn-program optgroup option', (o) => o.map((x) => Number(x.value) - 128));
    assert.ok(boot.length >= 8 && boot.every((i) => i <= 8), 'boot set instruments (not the invalid $09): ' + boot);
    // The editor's file names the instrument; the importer writes it as the INSTRUMENT command.
    const picked = await page.evaluate(() => {
      const T = window.NhlSoundToolsSnes;
      const s = T.emptySong('nhlpa93snes');
      s.set = 'boot';
      s.programs[0] = 128 + 3;
      s.notes.push({ t: 0, dur: 48, ch: 0, pitch: 60, vel: 100 });
      const bytes = T.toSmfBytes(s, null);
      const back = T.fromSmf('nhlpa93snes', bytes, 'x');
      return back.programs[0];
    });
    assert.strictEqual(picked, 128 + 3, 'round trip through the editor file');
    // Play: a song whose track uses game instrument $03, opened from its file, sounds.
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const mid = path.join(os.tmpdir(), 'snes93-gi.mid');
    fs.writeFileSync(mid, Buffer.from(await page.evaluate(() => {
      const s = window.NhlSoundToolsSnes.emptySong('nhlpa93snes');
      s.set = 'boot';
      s.programs[0] = 128 + 3;
      [60, 64, 67, 72].forEach((p, i) => s.notes.push({ t: i * 48, dur: 40, ch: 0, pitch: p, vel: 100 }));
      return Array.from(window.NhlSoundToolsSnes.toSmfBytes(s, null));
    })));
    await page.setInputFiles('input[aria-label="Open a MIDI file"]', mid);
    await page.waitForTimeout(500);
    assert.strictEqual(await page.$eval('#sn-program', (e) => e.value), String(128 + 3), 'track 1 shows game instrument $03');
    await page.click('#sn-play');
    await page.waitForFunction(() => /Stop/.test(document.querySelector('#sn-play').textContent), null, { timeout: 30000 });
    await page.close();
  });
  if (ran) console.log('snes93-game-instruments: per-set game instruments listed, round trip, play OK');
})().catch((err) => { console.error(err); process.exit(1); });
