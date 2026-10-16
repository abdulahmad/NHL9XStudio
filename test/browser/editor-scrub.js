/**
 * Browser test: the sequencer editor's scrub bar (public/sound-editor-extras.js) on all five games, at desktop width
 * with a mouse and at 390 px with touch. Copies a retail song into the editor, then checks that a seek while stopped
 * sets where Play starts, that seeks while playing go backward and forward, that a seek while paused stays paused and
 * resumes from there, and that the seconds ruler seeks too.
 *
 *   node test/browser/editor-scrub.js            (all games, both widths)
 *   node test/browser/editor-scrub.js nhl94snes  (one game)
 */
const assert = require('assert');
const { withBrowser } = require('./harness');

const GAMES = ['nhl92', 'nhlpa93', 'nhl94', 'nhlpa93snes', 'nhl94snes'];
const WIDTHS = [1280, 390];
// The page probes for optional files a checkout without ROMs does not have.
const OPTIONAL = /\/api\/games\/\w+\/rom|\/anim\/\w+\.anim/;

async function checkGame(page, url, game, width) {
  const touch = width < 500;
  const where = game + ' @' + width;
  await page.goto(url + '#game=' + game + '&mode=soundtest');
  await page.waitForSelector('#catalog .item', { timeout: 60000 });
  // The first retail song in the list, copied into the sequencer.
  const picked = await page.$$eval('#catalog .item', (items) => {
    const it = items.find((b) => !/Sequencer|MIDI import/.test(b.textContent));
    if (it) it.click();
    return !!it;
  });
  assert.ok(picked, where + ': no song in the list');
  const edit = await page.waitForSelector('button:has-text("Edit in sequencer")', { state: 'attached', timeout: 60000 });
  await edit.evaluate((b) => b.click());
  await page.waitForSelector('.se-scrub', { timeout: 60000 });

  const text = () => page.$eval('.se-scrub-time', (e) => e.textContent);
  const secsOf = (t) => { const m = /^(\d+):(\d+\.\d) \//.exec(t); return m ? +m[1] * 60 + +m[2] : null; };
  const pos = async () => secsOf(await text());
  const total = await text().then((t) => { const m = /\/ (\d+):(\d+\.\d)$/.exec(t); return +m[1] * 60 + +m[2]; });
  assert.ok(total > 4, where + ': song length ' + total);
  const playing = () => page.$eval('.se-playbtn', (b) => /Stop/.test(b.textContent));
  const paused = () => page.$eval('.se-pausebtn', (b) => /Resume/.test(b.textContent));
  const eventually = async (fn) => { for (let i = 0; i < 30; i++) { if (await fn()) return true; await page.waitForTimeout(100); } return false; };
  const press = async (sel) => { const h = await page.$(sel); if (touch) await h.tap(); else await h.click(); };
  const hit = async (x, y) => { if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };
  const scrubTo = async (f) => {
    const rail = await page.$('.se-scrub-rail');
    await rail.scrollIntoViewIfNeeded();
    const r = await rail.boundingBox();
    await hit(r.x + r.width * f, r.y + r.height / 2);
  };
  /** Wait until the shown position is inside [lo, hi] (a seek runs the drivers ahead first). */
  const until = async (lo, hi, label) => {
    let last = '';
    for (let i = 0; i < 400; i++) {
      last = await text();
      const s = secsOf(last);
      if (s != null && s >= lo && s <= hi) return s;
      await page.waitForTimeout(100);
    }
    assert.fail(where + ': ' + label + ': position "' + last + '" never reached ' + lo.toFixed(1) + '..' + hi.toFixed(1));
  };

  // Stopped: the bar sets the cue (a dimmed playhead) and Play starts there.
  await scrubTo(0.3);
  const cue = 0.3 * total;
  await until(cue - 0.15, cue + 0.15, 'cue while stopped');
  assert.ok(await page.$eval('.se-playhead', (e) => !e.hidden && e.classList.contains('is-cue')), where + ': cue playhead');
  await press('.se-playbtn');
  await until(cue + 0.3, cue + 6, 'playing from the cue');
  assert.ok(await eventually(playing), where + ': playing');

  // Backward and forward while playing.
  await scrubTo(0.1);
  await until(0.1 * total - 0.2, 0.1 * total + 1.5, 'backward seek');
  await scrubTo(0.4);
  await until(0.4 * total - 0.2, 0.4 * total + 1.5, 'forward seek');
  assert.ok(await page.$eval('.se-playhead', (e) => !e.hidden && !e.classList.contains('is-cue')), where + ': live playhead');

  // Paused: a seek stays paused (backward restarts the run), shows the new spot, and Resume plays on from it.
  await press('.se-pausebtn');
  assert.ok(await eventually(paused), where + ': paused');
  await scrubTo(0.15);
  const back = await until(0.15 * total - 0.15, 0.15 * total + 0.15, 'backward seek while paused');
  await scrubTo(0.5);
  const fwd = await until(0.5 * total - 0.15, 0.5 * total + 0.15, 'forward seek while paused');
  await page.waitForTimeout(600);
  assert.ok(await paused(), where + ': still paused after seeking');
  assert.ok(Math.abs((await pos()) - fwd) < 0.15, where + ': holds while paused');
  assert.ok(back < fwd);
  await press('.se-pausebtn');
  await until(fwd + 0.3, fwd + 5, 'resumed after the seek');

  // The seconds ruler seeks too: the playhead lands where the ruler was clicked (in roll pixels) and plays on.
  const target = await page.evaluate(() => {
    const c = document.querySelector('.se-ruler canvas');
    const sc = document.querySelector('.se-scroll');
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width * 0.75, y: r.top + r.height / 2, content: r.width * 0.75 + sc.scrollLeft };
  });
  await hit(target.x, target.y);
  const headX = () => page.$eval('.se-playhead', (e) => Number((/translateX\(([-\d.]+)px\)/.exec(e.style.transform) || [0, NaN])[1]));
  let x = NaN;
  for (let i = 0; i < 400; i++) {
    x = await headX();
    if (x >= target.content - 3 && x <= target.content + 400 && !/seeking/.test(await text())) break;
    await page.waitForTimeout(100);
  }
  assert.ok(x >= target.content - 3 && x <= target.content + 400, where + ': ruler seek put the playhead at ' + x + ', clicked ' + target.content);
  assert.ok(await playing(), where + ': still playing after the ruler seek');

  await press('.se-playbtn');
  await page.waitForTimeout(300);
  assert.ok(await eventually(async () => !(await playing())), where + ': stopped');
  // Stopped again: the bar shows the cue Play will start from.
  assert.ok(Math.abs((await pos()) - cue) < 0.15, where + ': back on the cue after Stop');
}

(async () => {
  const only = process.argv.slice(2);
  const games = only.length ? GAMES.filter((g) => only.includes(g)) : GAMES;
  await withBrowser('editor-scrub', async ({ url, newPage }) => {
    for (const width of WIDTHS) {
      for (const game of games) {
        const page = await newPage(width);
        try {
          await checkGame(page, url, game, width);
          const problems = page.problems.filter((p) => !OPTIONAL.test(p));
          assert.deepStrictEqual(problems, [], game + ' @' + width + ': errors in the page');
          console.log('editor-scrub: ' + game + ' @' + width + ' ok');
        } finally {
          await page.close();
        }
      }
    }
  });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
