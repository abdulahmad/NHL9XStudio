/**
 * Browser: the NHL 95 Sequencer / MIDI screen. The two MIDI rows are listed; a General MIDI file imports into the
 * sequencer for the chosen patch set and plays on the retail driver; a retail song opens in the sequencer, is
 * edited (a note added) and plays.
 *
 *   node test/browser/nhl95-sequencer.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Smf = require('../../lib/audio/smf');
const { withBrowser } = require('./harness');
const OPTIONAL = /\/api\/games\/\w+\/rom/;

const mid = path.join(os.tmpdir(), 'nhl95-seq-test.mid');
fs.writeFileSync(mid, Buffer.from(Smf.write({ ppq: 480, tempos: [{ tick: 0, bpm: 120 }], name: 't', tracks: [
  { name: 'lead', ch: 0, notes: [60, 64, 67, 72].map((p, i) => ({ tick: i * 480, dur: 400, pitch: p, vel: 100, program: 80 })) },
  { name: 'drums', ch: 9, notes: [0, 1, 2, 3].map((i) => ({ tick: i * 480, dur: 60, pitch: i % 2 ? 38 : 36, vel: 100 })) }
] })));

const clickRow = (page, text) => page.$$eval('#catalog .item', (nodes, t) => {
  const hit = nodes.find((n) => ((n.querySelector('.name') || {}).textContent || '').includes(t));
  if (!hit) throw new Error('no row ' + t);
  hit.click();
}, text);
const songState = (page) => page.evaluate(() => { const s = window.NhlSoundToolsNx.model.songs[95]; return s ? { notes: s.notes.length, list: s.loadList, chans: new Set(s.notes.map((n) => n.ch)).size } : null; });
// Playing: the Play button turned into Stop and the YM2612 sounds notes (the roll's note tracker).
const playing = (page) => page.waitForFunction(() => {
  const b = document.querySelector('#se-play');
  const st = window.NhlSoundTestView && window.NhlSoundTestView.seqState && window.NhlSoundTestView.seqState();
  return b && /Stop/.test(b.textContent) && !!(st && st.tracker && st.tracker.notes.length);
}, null, { timeout: 45000 });

(async () => {
  const ran = await withBrowser('nhl95-sequencer', async ({ url, newPage }) => {
    const page = await newPage(1300);
    await page.goto(url);
    await page.selectOption('#game', 'nhl95');
    await page.waitForTimeout(600);
    await page.click('#mode-soundtest');
    await page.waitForSelector('#catalog .item', { timeout: 60000 });
    const names = await page.$$eval('#catalog .item .name', (n) => n.map((x) => x.textContent));
    assert.ok(names.some((t) => t.includes('Sequencer · new NHL 95 song')), 'sequencer row');
    assert.ok(names.some((t) => t.includes('MIDI import → NHL 95')), 'import row');

    // MIDI import for patch set 0 (menus).
    await clickRow(page, 'MIDI import → NHL 95');
    await page.waitForSelector('#tool-import-list');
    await page.selectOption('#tool-import-list', '0');
    await page.setInputFiles('#tool-import-file', mid);
    await page.waitForSelector('#se-canvas', { timeout: 20000 });
    let st = await songState(page);
    assert.deepStrictEqual([st.notes, st.list], [8, 0], 'imported song ' + JSON.stringify(st));
    assert.strictEqual(await page.$eval('#se-load-list', (s) => s.value), '0');
    const opts = await page.$$eval('#se-patch option', (o) => o.map((x) => x.value));
    assert.strictEqual(opts.length, 12, 'list 0 patches in the Instrument list: ' + opts.length);
    await page.click('#se-play');
    await playing(page);
    await page.click('#se-play');
    await page.waitForTimeout(300);

    // A retail song into the sequencer, an edit, and playback (list 1, 16 channel buttons).
    await clickRow(page, 'TeamSongs BOS');
    await page.waitForSelector('#sound-test-toggle', { timeout: 20000 });
    await page.$$eval('button', (b) => { const e = b.find((x) => x.textContent === 'Edit in sequencer'); if (!e) throw new Error('no Edit in sequencer'); e.click(); });
    await page.waitForSelector('#se-canvas', { timeout: 20000 });
    st = await songState(page);
    assert.ok(st.notes > 50 && st.list === 1, 'retail song in the sequencer ' + JSON.stringify(st));
    assert.strictEqual(await page.$$eval('.se-chan', (b) => b.length), 16, '16 channels');
    await page.evaluate(() => { const s = window.NhlSoundToolsNx.model.songs[95]; s.notes.push({ t: 4, dur: 16, ch: 3, note: 60, vel: 100, patch: 25 }); });
    await page.click('#se-play');
    await playing(page);
    assert.strictEqual((await songState(page)).notes, st.notes + 1);
    await page.click('#se-play');
    await page.waitForTimeout(300);
    // The same song through the General MIDI reference sounds (the 95 map's targets).
    await page.click('#se-play-gm');
    await page.waitForFunction(() => /Stop GM/.test(document.querySelector('#se-play-gm').textContent), null, { timeout: 45000 });
    await page.click('#se-play-gm');
    await page.waitForTimeout(300);
    const bad = page.problems.filter((p) => !OPTIONAL.test(p));
    assert.deepStrictEqual(bad, [], bad.join('\n'));
    await page.close();
  });
  if (ran) console.log('nhl95-sequencer: MIDI import (patch set 0) plays, retail song edited in the sequencer plays (driver and GM) OK');
})().catch((err) => { console.error(err); process.exit(1); });
