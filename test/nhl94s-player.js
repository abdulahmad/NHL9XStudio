/**
 * Tests for lib/audio/nhl94s-player.js: the NHL '94 (SNES) sequencer driving the game's own SPC700 program.
 * The ported sequencer is checked against the independent reading of the song data in lib/audio/nhl94s-sound-data.js
 * (every note must become one key-on, on the video frame the tempo counter puts it on), and the sound unit must
 * produce sound from them. No ROM is needed.
 */
const assert = require('assert');
const Player = require('../lib/audio/nhl94s-player');
const SoundData = require('../lib/audio/nhl94s-sound-data');
const pack = require('../data/audio/nhl94s-sound.json');
const d = SoundData.load(pack);

// --- 1. the hardware multiplies (MulFrac8 / MulFrac16), worked by hand ---
{
  assert.strictEqual(Player.mulFrac8(0x40, 0x40), 32, '64 * 64 / 128');
  assert.strictEqual(Player.mulFrac8(0x7e, 0x7f), 125, '126 * 127 / 128, floored');
  assert.strictEqual(Player.mulFrac8(0, 0x7f), 0);
  assert.strictEqual(Player.mulFrac16(0x0100, 0x40), 0x80, '256 * 64 / 128');
  assert.strictEqual(Player.mulFrac16(0xff00, 0x40), 0xff80, '-256 * 64 / 128');
}

function play(name, frames, opts) {
  const p = Player.create(Object.assign({ data: d }, opts));
  p.boot();
  p.loadSet(d.songSet(name) === 'game' ? 'game' : 'menu');
  p.logCommands(true);
  p.startSong(name);
  p.record();
  p.runFrames(frames);
  return { p: p, pcm: p.stopRecording() };
}

// --- 2. a song with no voice stealing: one key-on per note, on the frame the tempo counter gives it ---
{
  const name = 'SongBrassBonanza';
  const { p, pcm } = play(name, 1200);
  const song = d.song(name);
  const frames = SoundData.tickFrames(song, 200000);
  const expected = [];
  song.tracks.forEach((t) => {
    SoundData.walk(t, { repeat: 50 }).events.forEach((e) => {
      if (e.event.type === 'note' && frames[e.tick] < 1200) expected.push(frames[e.tick]);
    });
  });
  expected.sort((a, b) => a - b);
  const got = p.commands.filter((c) => c.name === 'keyOn').map((c) => c.frame).sort((a, b) => a - b);
  assert.strictEqual(got.length, 114);
  assert.deepStrictEqual(got, expected, 'every note keys on at its tick');
  assert.strictEqual(p.stats.steals, 0);
  assert.strictEqual(p.musicOn, false, 'the song reaches its stop event');

  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  assert.ok(peak > 4000 && peak < 32767, 'audible and not clipped: peak ' + peak);
  assert.strictEqual(pcm.length / 2 > 600000, true, '20 s of audio at 32 kHz');
  // the first key-ons: tracks step from the last to the first, so voices are handed out in that order
  const first = p.commands.filter((c) => c.name === 'keyOn').slice(0, 2);
  assert.strictEqual(first[0].frame, 2);
  assert.strictEqual(first[0].args.sample, 10);
  assert.strictEqual(first[0].args.adsr1, 0xff);
}

// --- 3. the title song: voices run out, so the oldest are stolen, and every note is still started ---
{
  const name = 'TitleSong';
  const { p } = play(name, 900);
  const song = d.song(name);
  const frames = SoundData.tickFrames(song, 200000);
  let notes = 0;
  song.tracks.forEach((t) => SoundData.walk(t, { repeat: 50 }).events.forEach((e) => { if (e.event.type === 'note' && frames[e.tick] < 900) notes += 1; }));
  assert.strictEqual(p.commands.filter((c) => c.name === 'keyOn').length, notes);
  assert.ok(p.stats.steals > 0, 'the title song needs more than 8 voices at times');
}

// --- 4. the output is deterministic ---
{
  const a = play('SongBirthday', 300).pcm;
  const b = play('SongBirthday', 300).pcm;
  assert.strictEqual(a.length, b.length);
  assert.ok(a.every((v, i) => v === b[i]));
}

console.log('nhl94s player: the real sound program plays the extracted songs OK');
