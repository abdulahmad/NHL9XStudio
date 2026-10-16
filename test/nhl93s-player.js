/**
 * Tests for lib/audio/nhl93s-player.js: the cue interface to the game's own SPC700 program (NHLPA Hockey '93 SNES).
 * No ROM is needed.
 */
const assert = require('assert');
const Player = require('../lib/audio/nhl93s-player');
const SoundData = require('../lib/audio/nhl93s-sound-data');
const d = SoundData.load(require('../data/audio/nhl93s-sound.json'));

const peakOf = (pcm) => { let m = 0; for (let i = 0; i < pcm.length; i++) m = Math.max(m, Math.abs(pcm[i])); return m; };

// --- 1. every song cue is audible and ends with its order list (or keeps looping) ---
for (const c of d.cueList) {
  const p = Player.create({ data: d });
  p.cue(c.cue);
  assert.strictEqual(p.set, c.set, 'cue ' + c.cue + ' uploads the ' + c.set + ' set');
  p.record();
  p.runFrames(240);
  const pcm = p.stopRecording();
  assert.ok(peakOf(pcm) > 1500 && peakOf(pcm) < 32767, 'cue ' + c.cue + ' audible, not clipped: ' + peakOf(pcm));
  assert.ok(pcm.length / 2 > 100000, 'about 4 s of 32 kHz stereo');
  assert.ok(p.musicOn, 'cue ' + c.cue + ' is still playing after 4 s');
}

// --- 2. stop ---
{
  const p = Player.create({ data: d });
  p.cue(5);
  p.runFrames(120);
  assert.ok(p.musicOn);
  p.stop();
  p.runFrames(10);
  assert.strictEqual(p.musicOn, false);
  assert.ok(p.idle());
}

// --- 3. effects run on the game set, then the voice goes idle ---
{
  const p = Player.create({ data: d });
  p.effect(0x89);
  assert.strictEqual(p.set, 'game');
  p.record();
  p.runFrames(6);
  assert.strictEqual(p.idle(), false, 'the effect program is running');
  p.runFrames(300);
  const pcm = p.stopRecording();
  assert.ok(peakOf(pcm) > 800, 'effect audible: ' + peakOf(pcm));
  assert.ok(p.idle(), 'the effect ended');
  assert.throws(() => p.effect(0x20));
}

// --- 4. crowd noise loops until switched off ---
{
  const p = Player.create({ data: d });
  p.crowd(4);
  p.record();
  p.runFrames(200);
  assert.ok(peakOf(p.stopRecording()) > 300, 'crowd audible');
  p.crowd(0);
  p.runFrames(200);
  p.record();
  p.runFrames(60);
  assert.ok(peakOf(p.stopRecording()) < 300, 'crowd off');
}

// --- 5. set switching: boot -> game -> boot ---
{
  const p = Player.create({ data: d });
  p.cue(3);
  p.runFrames(60);
  p.cue(4);
  assert.strictEqual(p.set, 'game');
  p.record();
  p.runFrames(120);
  assert.ok(peakOf(p.stopRecording()) > 1500);
  assert.strictEqual(p.cue_, 4);
  p.cue(1);
  assert.strictEqual(p.set, 'boot');
  p.runFrames(60);
  assert.ok(p.musicOn);
}
console.log('nhl93s-player: ok');
