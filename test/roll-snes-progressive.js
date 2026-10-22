/**
 * SNES voice roll: a note whose length comes from the voice's next key-on grows as it plays (clipped at the
 * now line), instead of staying a 4 px stub until the next key-on is reached and then appearing whole.
 */
const assert = require('assert');
const path = require('path');
const vm = require('vm');
const fs = require('fs');

function el() {
  const n = { style: {}, hidden: false, children: [], clientWidth: 652, setAttribute() {}, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, getBoundingClientRect: () => ({ top: 0, left: 0 }),
    appendChild(c) { this.children.push(c); }, append(...c) { this.children.push(...c); }, replaceChildren() { this.children = []; } };
  return n;
}
const rects = [];
const ctx = new Proxy({ fillRect: (x, y, w, h) => rects.push({ x, y, w, h, c: ctx.fillStyle }), measureText: () => ({ width: 10 }) },
  { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
const sandbox = {
  document: { createElement: (tag) => { const n = el(); if (tag === 'canvas') n.getContext = () => ctx; return n; }, documentElement: {} },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}, devicePixelRatio: 1, addEventListener() {}
};
sandbox.self = sandbox;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'sound-roll-snes.js'), 'utf8'), sandbox);

const fr = 60;
const commands = [
  { frame: 0, name: 'keyOn', args: { voice: 0, pitch: 4096 } },
  { frame: 60, name: 'keyOn', args: { voice: 0, pitch: 4096 } }
];
let timeSec = 0;
const roll = sandbox.NhlSoundRollSnes.mount(el(), { frameRate: fr, state: () => ({ frame: timeSec * fr, commands, timeSec }) });
const noteWidth = () => {
  rects.length = 0;
  roll.draw();
  const bars = rects.filter((r) => r.h === 5 && r.c === '#f0b429');
  return bars.length ? Math.max(...bars.map((b) => b.w)) : 0;
};
const pps = (652 - 4 - 52 - 2) / 6;
timeSec = 0.25;
const w1 = noteWidth();
timeSec = 0.5;
const w2 = noteWidth();
assert.ok(Math.abs(w1 - 0.25 * pps) < 3, 'note at 0.25 s is drawn up to now: ' + w1);
assert.ok(Math.abs(w2 - 0.5 * pps) < 3, 'note at 0.5 s grew: ' + w2);
timeSec = 3;
const w3 = noteWidth();
assert.ok(Math.abs(w3 - 1 * pps) < 3, 'finished note keeps its length: ' + w3);
console.log('snes roll: notes grow as they play and clip at the edges OK');

// Click a voice lane to mute / unmute it (like the Genesis roll); muted lanes are dimmed.
{
  const muted = new Array(8).fill(false);
  const box = el();
  const r2 = sandbox.NhlSoundRollSnes.mount(box, { frameRate: fr, state: () => ({ frame: 0, commands, timeSec: 0.5 }), isMuted: (i) => muted[i], onToggle: (i) => { muted[i] = !muted[i]; } });
  const canvas = box.children[1].children[0];
  assert.ok(canvas.listeners.click, 'roll canvas takes clicks');
  const laneH = 30; // 652 px wide: 30 px lanes, top 16, 2 px gap
  canvas.listeners.click({ clientY: 16 + 2 * (laneH + 2) + 10 });
  assert.deepStrictEqual(muted.map(Number), [0, 0, 1, 0, 0, 0, 0, 0], 'click on V3 mutes voice 2');
  rects.length = 0;
  r2.draw();
  assert.ok(rects.some((r) => r.c === 'rgba(16,20,24,0.72)' && r.y === 16 + 2 * (laneH + 2)), 'muted lane is dimmed');
  canvas.listeners.click({ clientY: 16 + 2 * (laneH + 2) + 10 });
  assert.ok(!muted[2], 'second click unmutes');
  canvas.listeners.click({ clientY: 2 });
  assert.ok(!muted.some(Boolean), 'click above the lanes does nothing');
  r2.destroy();
}
// Every sound-test roll mount (SNES and Genesis, list view and editor host) is wired for click-to-mute.
{
  const view = fs.readFileSync(path.join(__dirname, '..', 'public', 'sound-test-view.js'), 'utf8');
  const snes = view.match(/NhlSoundRollSnes\.mount\([\s\S]*?\}\)/g) || [];
  const gen = view.match(/NhlSoundRoll\.mount\([^\n]*/g) || [];
  assert.strictEqual(snes.length, 2, 'two SNES roll mounts');
  assert.strictEqual(gen.length, 2, 'two Genesis roll mounts');
  for (const m of snes) assert.ok(/isMuted: \(i\) => voiceMuted\[i\]/.test(m) && /onToggle: toggleVoice/.test(m), 'SNES roll mount wired for mute: ' + m.slice(0, 60));
  for (const m of gen) assert.ok(/isMuted: \(i\) => chMuted\[i\]/.test(m) && /onToggle: toggleChannel/.test(m), 'Genesis roll mount wired for mute');
  assert.ok(/function applyVoiceMutes[\s\S]*?setVoiceMute/.test(view), 'SNES mutes reach the S-DSP');
  assert.strictEqual((view.match(/live\.resampler = root\.NhlChipResampler\.create\(snesApi\(\)\.RATE[^\n]*\n\s*applyVoiceMutes\(live\);/g) || []).length, 2, 'every new SNES run (play, restart, backward seek) re-applies the mutes');
}
console.log('snes roll: click a lane to mute / unmute, wired on every roll OK');
