// Unreferenced bytes between NHLPA 93 SNES sample directory entries (docs/TODO.md Oct 2026).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const SD = require('../lib/audio/nhl93s-sound-data');
const Dsp = require('../lib/audio/snes-dsp');

const d = SD.load(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'audio', 'nhl93s-sound.json'))));

/** Regions between directory spans that are not part of the previous sample's BRR end block. */
const PINNED = {
  boot: [[0x2796, 0x27ba], [0x455d, 0x456f], [0x4968, 0x49a7]],
  game: [[0xadd9, 0xae9f], [0xaf1d, 0xaf80], [0xafda, 0xb034]]
};

function tryDecode(img, from, to) {
  const slice = img.subarray(from, to);
  try {
    const dec = Dsp.decodeBrr(slice);
    return { bytes: to - from, pcm: dec.samples.length, blocks: dec.blocks };
  } catch (err) {
    return { bytes: to - from, error: String(err.message || err) };
  }
}

for (const set of ['boot', 'game']) {
  const gaps = d.unreferencedBrrGaps(set);
  for (const g of gaps) assert.ok(g.to > g.from, set + ' gap');
  const img = d.image(set);
  for (const [from, to] of PINNED[set]) {
    const r = tryDecode(img, from, to);
    assert.ok(r.pcm > 0 && r.pcm < 500, set + ' $' + from.toString(16) + ' decodes as a tiny BRR fragment (' + r.pcm + ' samples), not a full game sample');
  }
}

console.log('nhl93s gaps: directory slack gaps boot=' + d.unreferencedBrrGaps('boot').length + ' game=' + d.unreferencedBrrGaps('game').length + '; pinned interior regions decode as short BRR only');
