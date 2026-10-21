const assert = require('assert');
const fs = require('fs');
const path = require('path');
const SD = require('../lib/audio/nhl94s-sound-data');
const P = require('../lib/audio/nhl94s-player');
const G = require('../lib/audio/nhl94s-game-sfx');

const d = SD.load(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'audio', 'nhl94s-sound.json'))));
const p = P.create({ data: d });
p.boot();
p.loadSet('game');

assert.ok(G.sfxVelocityFromHalfVxVy(0x4000, 0) > 0 && G.sfxVelocityFromHalfVxVy(0x4000, 0) <= 0x70);
const hit = G.collisionSfx(p, 0x5000, 0, 0x1000, 0, 0x55);
assert.ok(hit.velocity > 0 && hit.pitch > 0);
const rec = p.getReplayRecord();
assert.strictEqual(rec.recsfx, 0x0f);

p.setMusicDuck(-1);
p.startSong('SongBrassBonanza');
p.runFrames(30);
p.setSoundFade(0x200);
p.runFrames(5);
assert.ok(p.getReplayRecord().recsfx === 0x0f || p.musicOn);

console.log('nhl94s game sfx: PuckSfx/CollisionSfx + replay record OK');
