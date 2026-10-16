/**
 * Tests for the sequencer editor's scrub bar maths (public/sound-editor-extras.js): folding the run clock onto one
 * pass of the song, and the run time a seek goes to.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/sound-editor-extras.js'), 'utf8'), { self: sandbox });
const { foldRun, seekRunTime } = sandbox.NhlEditorExtras;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg + ': ' + a + ' != ' + b);

// --- folding: NHL 92 songs repeat from the start, 93/94 from a loop point, SNES songs without a loop stop ---
near(foldRun(3, 10, 0), 3, 'inside the first pass');
near(foldRun(10, 10, 0), 10, 'the end of the pass');
near(foldRun(13, 10, 0), 3, 'NHL 92: the second pass starts at 0');
near(foldRun(25, 10, 4), 7, 'loop point 4: 10 + (6 + 6) - 6 -> 4 + 3');
near(foldRun(16, 10, 4), 4, 'loop point 4: the second pass starts at the loop');
near(foldRun(12, 10, null), 10, 'no loop: holds at the end');
near(foldRun(12, 0, 0), 12, 'empty song: unchanged');

// --- seeking: the first pass, or the pass being heard when the spot is inside the looped part ---
near(seekRunTime(5, null, 10, 0), 5, 'stopped: the song position');
near(seekRunTime(5, 3, 10, 0), 5, 'first pass, backward');
near(seekRunTime(8, 3, 10, 0), 8, 'first pass, forward');
near(seekRunTime(2, 13, 10, 0), 12, 'NHL 92 second pass: stays in it');
near(seekRunTime(9, 25, 10, 4), 27, 'loop 4, the pass at run 22..28 (song 4..10): 22 + (9 - 4)');
near(foldRun(seekRunTime(9, 25, 10, 4), 10, 4), 9, 'and that run time folds back to the spot');
near(seekRunTime(2, 25, 10, 4), 2, 'before the loop point: only the first pass has it');
near(seekRunTime(5, 12, 10, null), 5, 'no loop: back into the only pass');
for (const [loop, now] of [[0, 37.5], [3, 41], [7.5, 99]]) {
  for (let sec = loop; sec < 10; sec += 0.25) near(foldRun(seekRunTime(sec, now, 10, loop), 10, loop), sec, 'round trip ' + loop + '/' + now + '/' + sec);
}

console.log('editor-extras: ok');
