/**
 * Browser: the NHL 94 (SNES) song editor offers the sound entries of the song's set next to the GM
 * programs; a track set to one plays it directly ($DC with that sound entry) on the game's sound program.
 *
 *   node test/browser/snes94-game-instruments.js
 */
const assert = require('assert');
const { withBrowser } = require('./harness');

(async () => {
  const ran = await withBrowser('snes94-game-instruments', async ({ url, newPage }) => {
    const page = await newPage(1300);
    await page.goto(url);
    await page.selectOption('#game', 'nhl94snes');
    await page.waitForTimeout(800);
    await page.click('#mode-soundtest');
    await page.waitForSelector('#catalog .item', { timeout: 60000 });
    await page.$$eval('#catalog .item', (n) => n.find((x) => /Sequencer/.test((x.querySelector('.name') || {}).textContent)).click());
    await page.waitForSelector('#sn-program', { timeout: 20000 });
    await page.selectOption('#sn-set', 'game');
    await page.waitForTimeout(200);
    const game = await page.$$eval('#sn-program optgroup option', (o) => o.map((x) => Number(x.value) - 128));
    assert.ok(game.length >= 5 && !game.some((i) => i >= 22 && i <= 27), 'game set entries, no streamed sounds: ' + game);
    await page.selectOption('#sn-set', 'menu');
    await page.waitForTimeout(200);
    const menu = await page.$$eval('#sn-program optgroup option', (o) => o.map((x) => Number(x.value) - 128));
    assert.ok(menu.length >= 5 && menu.join() !== game.join(), 'menu set entries: ' + menu);
    // The editor's file names the instrument; the importer writes it as the INSTRUMENT command.
    const picked = await page.evaluate(() => {
      const T = window.NhlSoundToolsSnes;
      const s = T.emptySong('nhl94snes');
      s.set = 'menu';
      s.programs[0] = 128 + 3;
      s.notes.push({ t: 0, dur: 48, ch: 0, pitch: 60, vel: 100 });
      const bytes = T.toSmfBytes(s, null);
      const back = T.fromSmf('nhl94snes', bytes, 'x');
      return back.programs[0];
    });
    assert.strictEqual(picked, 128 + 3, 'round trip through the editor file');
    // Play: a song whose track uses sound entry 3, opened from its file, sounds.
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const mid = path.join(os.tmpdir(), 'snes94-gi.mid');
    fs.writeFileSync(mid, Buffer.from(await page.evaluate(() => {
      const s = window.NhlSoundToolsSnes.emptySong('nhl94snes');
      s.set = 'menu';
      s.programs[0] = 128 + 3;
      [60, 64, 67, 72].forEach((p, i) => s.notes.push({ t: i * 48, dur: 40, ch: 0, pitch: p, vel: 100 }));
      return Array.from(window.NhlSoundToolsSnes.toSmfBytes(s, null));
    })));
    await page.setInputFiles('input[aria-label="Open a MIDI file"]', mid);
    await page.waitForTimeout(500);
    assert.strictEqual(await page.$eval('#sn-program', (e) => e.value), String(128 + 3), 'track 1 shows sound entry 3');
    await page.click('#sn-play');
    await page.waitForFunction(() => /Stop/.test(document.querySelector('#sn-play').textContent), null, { timeout: 30000 });
    await page.close();
  });
  if (ran) console.log('snes94-game-instruments: per-set game instruments listed, round trip, play OK');
})().catch((err) => { console.error(err); process.exit(1); });
