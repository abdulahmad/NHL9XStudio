/**
 * NHLPA 93 and NHL 94 (Genesis) sound chains: each game's retail 68k driver (nhl9x-68k-harness.js with
 * that game's addresses, from the bundled sound segment) feeding its retail Z80 program through shared
 * Z80 RAM, run by the same chain as NHL 92 (nhl92-sound-chain.js with `driver`). Per game, checks that
 * every sound in the catalog (SFX $0-$2F, songs $30 up) plays without the driver running away or
 * leaving the sound code, that sounds make YM2612 writes, that the 68k's wait for the Z80
 * (UploadCommandBufferToZ80) is served, that the output is audible through the YM2612 core, and pins the
 * YM2612 write log of a few sounds (self-consistency: the same bytes must keep giving the same writes;
 * not an emulator capture).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Chain = require('../lib/audio/nhl92-sound-chain');

const GAMES = {
  nhlpa93: { label: 'NHLPA 93', driver: require('../lib/audio/nhl93-68k-harness'), slice: 'nhl93-sound-slice.bin', start: 0x165d8, size: 0x2efa2, catalog: 'nhlpa93.json', sounds: 56, pcmSong: 0x32, pins: ['song 30', 'song 35', 'sfx 0', 'sfx a', 'sfx 1e'] },
  nhl94: { label: 'NHL 94', driver: require('../lib/audio/nhl94-68k-harness'), slice: 'nhl94-sound-slice.bin', start: 0x1a264, size: 0x4b5c0, catalog: 'nhl94.json', sounds: 123, pcmSong: 0x78, pins: ['song 30', 'song 5a', 'song 78', 'sfx 0', 'sfx 5', 'sfx 1f'] }
};
const PIN_FILE = path.join(__dirname, '..', 'data', 'audio', 'nhl9x-sound-chain.json');
const printPins = !!process.env.NHL9X_PIN_PRINT;
const pinned = fs.existsSync(PIN_FILE) ? JSON.parse(fs.readFileSync(PIN_FILE, 'utf8')) : { ymLogHashes: {} };
const newPins = { note: 'SHA-1 prefix of the YM2612 write log (Chain.ymLogText) of 300 frames of each sound on the retail 68k + Z80 drivers. Self-consistency pins, not emulator captures. Regenerate with NHL9X_PIN_PRINT=1 node test/nhl9x-sound-chain.js.', ymLogHashes: {} };

function setup(g) {
  const slice = fs.readFileSync(path.join(__dirname, '..', 'data', 'fixtures', g.slice));
  assert.strictEqual(slice.length, g.size - g.start, g.label + ' slice size');
  const rom = new Uint8Array(g.size);
  rom.set(slice, g.start);
  return rom;
}
function run(g, rom, kind, id, frames, extra) {
  const chain = Chain.create(Object.assign({ rom, driver: g.driver, keepLogs: true }, extra || {}));
  chain.step(null);
  chain.step([{ [kind]: id }]);
  for (let f = 2; f < frames; f++) chain.step(null);
  return chain;
}
const logHash = (chain) => crypto.createHash('sha1').update(Chain.ymLogText(chain)).digest('hex').slice(0, 16);

for (const key of Object.keys(GAMES)) {
  const g = GAMES[key];
  const rom = setup(g);
  const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'audio', g.catalog), 'utf8'));

  // --- every catalog sound plays ----------------------------------------------------------------
  const sounds = cat.entries.filter((e) => e.soundId != null && e.playable);
  assert.strictEqual(sounds.length, g.sounds);
  let silent = 0;
  for (const e of sounds) {
    const kind = e.soundId >= 0x30 ? 'song' : 'sfx';
    const chain = run(g, rom, kind, e.soundId, 40);
    assert.deepStrictEqual(chain.unheldWrites, [], g.label + ' ' + e.label + ': 68k wrote Z80 RAM without the bus');
    assert.ok(chain.z.ym.length > 0, g.label + ' ' + e.label + ': no YM2612 data writes at all');
    if (!chain.z.ym.some((w) => (w.reg === 0x28 && (w.value & 0xf0)) || w.reg === 0x2a)) silent += 1;
  }
  assert.ok(silent < sounds.length / 2, g.label + ': ' + silent + ' of ' + sounds.length + ' sounds played nothing in 40 frames');
  console.log(key + ' sound chain: all ' + sounds.length + ' catalog sounds run on the retail 68k + Z80 drivers (' + (sounds.length - silent) + ' make a note or PCM within 0.7 s) OK');

  // --- the 68k waits for the Z80 -------------------------------------------------------------------
  // A song that plays a long PCM sample leaves the Z80 busy when the 68k next uploads its command
  // buffer: UploadCommandBufferToZ80 must be given Z80 time (it used to run away).
  {
    const chain = run(g, rom, 'song', g.pcmSong, 200);
    assert.ok(chain.z.ym.filter((w) => w.reg === 0x2a).length > 1000, g.label + ' song $' + g.pcmSong.toString(16) + ' streams PCM');
    assert.strictEqual(chain.frame, 200);
  }

  // --- pinned write logs -----------------------------------------------------------------------------
  {
    const got = {};
    for (const k of g.pins) {
      const [kind, id] = k.split(' ');
      got[k] = logHash(run(g, rom, kind, parseInt(id, 16), 300));
    }
    newPins.ymLogHashes[key] = got;
    if (!printPins) {
      assert.deepStrictEqual(got, pinned.ymLogHashes[key], g.label + ' YM2612 write logs changed; if intended, regenerate with NHL9X_PIN_PRINT=1');
      const [kind, id] = g.pins[0].split(' ');
      assert.strictEqual(logHash(run(g, rom, kind, parseInt(id, 16), 300)), got[g.pins[0]]);
    }
    console.log(key + ' sound chain: YM2612 write logs of ' + g.pins.length + ' sounds ' + (printPins ? 'printed' : 'match the pins and repeat exactly') + ' OK');
  }
}

// --- audible through the real chip cores ---------------------------------------------------------------
(async () => {
  if (printPins) {
    fs.writeFileSync(PIN_FILE, JSON.stringify(newPins, null, 2) + '\n');
    console.log('wrote ' + PIN_FILE);
  }
  const ym = require('../lib/audio/ym2612-wasm');
  const psg = require('../lib/audio/sn76489');
  for (const key of Object.keys(GAMES)) {
    const g = GAMES[key];
    const rom = setup(g);
    for (const [kind, id, floor] of [['song', 0x30, 3000], ['song', g.pcmSong, 3000], ['sfx', 0, 1500]]) {
      const chip = await ym.createChip();
      try {
        const chain = Chain.create({ rom, driver: g.driver, chip, psg: psg.create(), keepLogs: false });
        chain.step(null);
        chain.step([{ [kind]: id }]);
        for (let f = 2; f < 300; f++) chain.step(null);
        const pcm = chain.take();
        let peak = 0;
        for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
        assert.ok(peak > floor && peak < 32767, g.label + ' ' + kind + ' $' + id.toString(16) + ' peak ' + peak);
      } finally { chip.dispose(); }
    }
    console.log(key + ' sound chain: songs and SFX are audible through the YM2612 core and do not clip OK');
  }
})().catch((err) => { console.error(err); process.exit(1); });
