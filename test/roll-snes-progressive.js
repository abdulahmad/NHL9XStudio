/**
 * SNES voice roll: a note whose length comes from the voice's next key-on grows as it plays (clipped at the
 * now line), instead of staying a 4 px stub until the next key-on is reached and then appearing whole.
 */
const assert = require('assert');
const path = require('path');
const vm = require('vm');
const fs = require('fs');

function el() {
  const n = { style: {}, hidden: false, children: [], clientWidth: 652, setAttribute() {}, addEventListener() {},
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
