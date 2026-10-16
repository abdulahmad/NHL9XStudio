/**
 * Tests for lib/audio/snes-sfx-midi.js: sound effects of both SNES games exported as MIDI from the real S-DSP voice writes.
 */
const assert = require('assert');
const Sfx = require('../lib/audio/snes-sfx-midi');
const Smf = require('../lib/audio/smf');
const d93 = require('../lib/audio/nhl93s-sound-data').load(require('../data/audio/nhl93s-sound.json'));
const d94 = require('../lib/audio/nhl94s-sound-data').load(require('../data/audio/nhl94s-sound.json'));
const g93 = require('../data/audio/nhl93s-gm-map.json');
const g94 = require('../data/audio/nhl94s-gm-map.json');

// --- '93: every effect cue makes a valid file with at least one note ---
for (let cue = 0x89; cue <= 0xa1; cue++) {
  const bytes = Sfx.exportEffect93(d93, g93, cue);
  const p = Smf.parse(bytes);
  assert.ok(p.notes.length >= 1, 'cue $' + cue.toString(16) + ' has notes');
  assert.ok(p.notes.every((n) => n.pitch >= 0 && n.pitch <= 127 && n.dur >= 1 && n.vel >= 1));
}
// the whistle (cue $89) is a pitch sweep: one voice, rising bends
{
  const p = Smf.parse(Sfx.exportEffect93(d93, g93, 0x89));
  assert.ok(p.bends.length > 10, 'sweep: ' + p.bends.length + ' bends');
  assert.ok(p.bends[p.bends.length - 2].semis > p.bends[0].semis + 2, 'rises');
  assert.strictEqual(p.notes[0].ch, 0);
}
// deterministic
assert.deepStrictEqual(Array.from(Sfx.exportEffect93(d93, g93, 0xa0)), Array.from(Sfx.exportEffect93(d93, g93, 0xa0)));

// --- '94: a drum entry becomes a GM drum hit on channel 10, an instrument entry a note with the map's program ---
{
  const snare = Smf.parse(Sfx.exportEffect94(d94, g94, 'menu', 3));
  assert.strictEqual(snare.notes.length, 1);
  assert.strictEqual(snare.notes[0].ch, 9);
  assert.strictEqual(snare.notes[0].pitch, 38);
  const organ = Smf.parse(Sfx.exportEffect94(d94, g94, 'game', 11));
  assert.strictEqual(organ.notes.length, 1);
  assert.strictEqual(organ.notes[0].pitch, 84, 'the effect plays the organ two octaves above its tuned pitch');
  for (const n of [0, 3, 9, 13, 20, 21]) assert.ok(Smf.parse(Sfx.exportEffect94(d94, g94, 'game', n)).notes.length >= 1, 'game effect ' + n);
}
console.log('snes-sfx-midi: ok');
