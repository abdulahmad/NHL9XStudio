/**
 * NHLPA 93 SNES Audio tab, Samples list (public/sound-test-snes93.js): every BRR sample of both sets is listed by its
 * disassembly name and plays with its loop; Instruments keeps only the rows that are more than their sample.
 */
const assert = require('assert');
global.self = global;
global.NhlSnesDsp = require('../lib/audio/snes-dsp');
global.NhlNhl93sSoundData = require('../lib/audio/nhl93s-sound-data');
global.NhlAudioCategories = require('../lib/audio/categories');
require('../public/sound-test-snes93.js');
const A = global.NhlSoundTestSnes93;
const pack = require('../data/audio/nhl93s-sound.json');
const d = global.NhlNhl93sSoundData.load(pack);
const rows = A.entries(d);

const NAMES = ['sfx_whistle_brr', 'sfx_crowdcheer_brr', 'sfx_check_brr', 'sfx_check2_brr', 'sfx_oooh_brr', 'sfx_hithigh_brr', 'sfx_shotfh_brr',
  'sfx_shotbh_brr', 'sfx_crowdboo_brr', 'sfx_puckwall_brr', 'sfx_puckpost_brr', 'sfx_shotwiff_brr', 'sfx_shotwiff2_brr', 'sfx_stop_brr',
  'sfx_playerwall_brr', 'sfx_a1_brr', 'sfx_siren_brr', 'sample_11_brr', 'sample_12_brr'];
assert.deepStrictEqual(pack.gameSampleNames, NAMES, 'pack carries the GameSampleDir labels');

const samples = rows.filter((r) => r.group === 'Samples');
assert.strictEqual(samples.length, 19 + 9, 'Samples lists 19 game and 9 boot samples');
NAMES.forEach((n, i) => assert.ok(samples.find((r) => r.id === 'snes-sample-game-' + i).label.endsWith(n), 'game sample ' + i + ' is ' + n));
assert.ok(/fanfare lead/.test(samples.find((r) => r.id === 'snes-sample-game-17').sub), '$11 is the fanfare lead');
assert.ok(/fanfare drum/.test(samples.find((r) => r.id === 'snes-sample-game-18').sub), '$12 is the fanfare drum');
assert.ok(samples.find((r) => r.id === 'snes-sample-boot-0').label.endsWith('boot sample $00'), 'boot samples are named neutrally');

// loops as the directory gives them (game $00/$0F/$10/$11), all on 9-byte blocks
const loops = d.samples('game').filter((e) => e.loops).map((e) => e.index);
assert.deepStrictEqual(loops, [0, 15, 16, 17], 'looping game samples');
for (const set of ['game', 'boot']) for (const e of d.samples(set)) if (e.loops) assert.strictEqual(e.loop, e.start + e.loopBlock * 9, set + ' ' + e.index + ' loop on a block');

// a looping sample keeps sounding past its BRR length; a one-shot one goes quiet
const peak = (pcm, from) => { let m = 0; for (let i = from * 2; i < pcm.length; i++) m = Math.max(m, Math.abs(pcm[i])); return m; };
const whistle = A.renderSample(d, 'game', 0);
assert.ok(peak(whistle, 32000) > 1000, 'the whistle loop still sounds after 1 s');
const shot = A.renderSample(d, 'game', 6);
assert.ok(peak(shot, 0) > 1000 && peak(shot, shot.length / 2 - 200) < 50, 'a one-shot sample plays and ends');
const s = A.startSampleSession(d, 'boot', 3);
const out = A.pull(s, 4000);
assert.ok(out.left.some((v) => Math.abs(v) > 0.01), 'a boot sample session plays');

// Instruments: only rows that are more than their sample
const inst = rows.filter((r) => r.group === 'Instruments').map((r) => r.id);
assert.deepStrictEqual(inst, ['snes-inst-8', 'snes-inst-9', 'snes-inst-25'], 'Instruments keeps $08, $09 and $19');
for (const i of d.instruments) {
  if (inst.includes('snes-inst-' + i.index)) continue;
  assert.ok(i.adsr1 === A.STD_ENV.adsr1 && i.adsr2 === A.STD_ENV.adsr2 && i.gain === A.STD_ENV.gain, 'removed instrument ' + i.index + ' had the standard envelope');
  assert.ok(samples.some((r) => r.id === 'snes-sample-' + A.setOfInstrument(i.index) + '-' + i.sample), 'removed instrument ' + i.index + ' has its Samples row');
}
console.log('nhl93s-samples: 28 samples listed and playable, 3 instruments kept');

// ---- pitch: each Samples row plays at the pitch the game keys the sample on (not native 32 kHz) ----
global.NhlSpc700Cpu = global.NhlSpc700Cpu || require('../lib/audio/spc700-cpu');
global.NhlSnesSpc = global.NhlSnesSpc || require('../lib/audio/snes-spc');
global.NhlNhl93sPlayer = global.NhlNhl93sPlayer || require('../lib/audio/nhl93s-player');
global.NhlSnesSfxMidi = global.NhlSnesSfxMidi || require('../lib/audio/snes-sfx-midi');
global.NhlNhl93sMidi = global.NhlNhl93sMidi || require('../lib/audio/nhl93s-midi');
{
  const Dsp = global.NhlSnesDsp;
  assert.strictEqual(Dsp.hzFromPitch(0x1000), 32000, 'S-DSP pitch $1000 is 32 kHz');
  assert.strictEqual(Dsp.hzFromPitch(0x0800), 16000, 'rate = 32000 * pitch / $1000');
  const P = global.NhlNhl93sPlayer;
  const capture = (start) => {
    const p = P.create({ data: d });
    let q = false;
    return global.NhlSnesSfxMidi.capture(p.spc, () => { if (!q) { start(p); q = true; } p.runFrame(); }, { maxFrames: 400, minFrames: 10, done: () => p.idle() });
  };
  const audible = (pcm) => { let last = 0; for (let i = 0; i < pcm.length; i++) if (Math.abs(pcm[i]) > 64) last = i; return last / 2 / A.RATE; };
  const an = require('../data/audio/nhl93s-instrument-analysis.json').sets;
  d.probeMidi = {};
  for (const s of Object.keys(an)) for (const n of Object.keys(an[s])) d.probeMidi[n] = an[s][n].probeMidi;
  for (const set of ['game', 'boot']) {
    for (const e of d.samples(set)) {
      const sp = A.samplePitch(set, e.index);
      assert.notStrictEqual(sp.pitch, 0x1000, set + ' ' + e.index + ' has a game pitch');
      const cue = /^cue \$([0-9A-F]+)/.exec(sp.from);
      const inst = /^instrument \$([0-9A-F]+)/.exec(sp.from);
      let notes;
      if (cue) notes = capture((p) => { p.loadSet('game'); p.effect(parseInt(cue[1], 16)); });
      else {
        const c = A.probeSong(d, parseInt(inst[1], 16));
        notes = capture((p) => p.playCustom(c.set, c.bytes, c.base));
      }
      const note = notes.find((x) => x.srcn === e.index);
      assert.ok(note, set + ' ' + e.index + ': the game keys the sample on');
      assert.strictEqual(note.pitch0, sp.pitch, set + ' ' + e.index + ': row pitch is the pitch the game writes (' + sp.from + ')');
      assert.ok(A.entries(d).find((r) => r.id === 'snes-sample-' + set + '-' + e.index).sub.includes('pitch $' + sp.pitch.toString(16).toUpperCase().padStart(4, '0')), 'note shows the pitch');
      // Ear proxy: a one-shot sample lasts as long as the cue's note (unless the cue keys it off early).
      if (cue && !e.loops) {
        const row = audible(A.renderSample(d, set, e.index));
        const game = (note.t1 - note.t0);
        assert.ok(row >= game - 0.03 && (row <= game + 0.03 || /^\$9[01]/.test('$' + cue[1])), set + ' ' + e.index + ' lasts ' + row.toFixed(3) + ' s vs cue ' + game.toFixed(3) + ' s');
      }
    }
  }
}
console.log('nhl93s-samples pitch: rows play at the game pitch; one-shot lengths match their cues');
