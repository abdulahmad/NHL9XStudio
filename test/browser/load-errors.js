/**
 * Browser test: load every game in public/games.json in every mode, at desktop width and at 390 px (touch), and fail on
 * any page error, console error, or error text the page shows instead of raising it. The viewer catches a failed load
 * and puts the message in the caption, so a ReferenceError (a leftover call to a removed function) never reaches
 * the console; it is caught here by its text.
 *
 * Two passes per width:
 *   1. a fresh page per game and mode, opened from a link (#game=...&mode=...);
 *   2. one page that clicks each visible mode tab and, in each, switches through every game with the Game menu.
 *
 *   node test/browser/load-errors.js           (everything)
 *   node test/browser/load-errors.js nhl94     (one game)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { withBrowser, ROOT } = require('./harness');

const MODES = ['spa', 'frame', 'spf', 'image', 'audio', 'soundtest'];
const WIDTHS = [1280, 390];
// Text an uncaught JavaScript error leaves in the page (Safari, Chrome and Firefox wordings).
const ERROR_TEXT = /Can't find variable|is not defined|is not a function|\bundefined\b|\bNaN\b|Cannot read propert|null is not an object|undefined is not an object|Unexpected token|\[object Object\]/;
// Files the page asks for that a checkout without ROMs or PC game files does not have.
const OPTIONAL = /Failed to load resource.*\((?:[^)]*\/api\/games\/\w+\/(?:rom|pc|folder)|[^)]*\/anim\/\w+\.anim|[^)]*\/(?:pc95|pc94|roms)\/)/;

/** The page's visible text, plus the caption and status lines even when they are hidden by the layout. */
const pageText = (page) => page.evaluate(() => {
  const bits = [document.body.innerText];
  for (const e of document.querySelectorAll('#caption, .st-status, .caption')) bits.push(e.textContent);
  return bits.join('\n');
});

/** Let a load settle: the network goes quiet, then a little longer for timers and frames. */
async function settle(page) {
  try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch (err) { /* keep going */ }
  await page.waitForTimeout(700);
}

function check(page, text, where) {
  const problems = page.problems.filter((p) => !OPTIONAL.test(p));
  const m = ERROR_TEXT.exec(text);
  if (m) {
    const at = text.indexOf(m[0]);
    problems.push('error text on the page: "' + text.slice(Math.max(0, at - 80), at + 80).replace(/\s+/g, ' ') + '"');
  }
  page.problems.length = 0;
  assert.deepStrictEqual(problems, [], where);
}

(async () => {
  const only = process.argv.slice(2);
  const games = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'games.json'), 'utf8')).map((g) => g.id).filter((id) => !only.length || only.includes(id));
  assert.ok(games.length, 'no games');
  await withBrowser('load-errors', async ({ url, newPage }) => {
    let loads = 0;
    for (const width of WIDTHS) {
      // 1. Every game in every mode from a link.
      for (const game of games) {
        for (const mode of MODES) {
          const page = await newPage(width);
          try {
            await page.goto(url + '#game=' + game + '&mode=' + mode);
            await settle(page);
            check(page, await pageText(page), game + ' ' + mode + ' @' + width + ' (link)');
            loads += 1;
          } finally {
            await page.close();
          }
        }
      }
      // 2. Mode tabs and the Game menu on one page.
      const page = await newPage(width);
      try {
        await page.goto(url + '#game=' + games[0] + '&mode=spa');
        await settle(page);
        check(page, await pageText(page), games[0] + ' @' + width + ' (start)');
        for (const mode of MODES) {
          for (const game of games) {
            await page.selectOption('#game', game);
            await settle(page);
            const tab = await page.$('#mode-' + mode);
            if (tab && await tab.isVisible() && await tab.isEnabled()) {
              await tab.evaluate((b) => b.click());
              await settle(page);
            }
            check(page, await pageText(page), game + ' ' + mode + ' @' + width + ' (menu)');
            loads += 1;
          }
        }
      } finally {
        await page.close();
      }
    }
    console.log('load-errors: ' + games.length + ' games x ' + MODES.length + ' modes x ' + WIDTHS.length + ' widths, ' + loads + ' loads, no errors');
  });
})().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
