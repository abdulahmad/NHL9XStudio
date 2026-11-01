'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Groups = require('../lib/audio/pc-audio-groups');

function runs(items, key) {
  const out = [];
  for (const it of items) {
    const v = it[key];
    if (!out.length || out[out.length - 1] !== v) out.push(v);
  }
  return out;
}

assert.strictEqual(Groups.songGroup('ADTITLE'), Groups.SONGS);
assert.strictEqual(Groups.songGroup('CANADA'), Groups.SONGS);
assert.strictEqual(Groups.songGroup('USA'), Groups.SONGS);
assert.strictEqual(Groups.songGroup('SLAPSHOT'), Groups.SONGS);
assert.strictEqual(Groups.songGroup('SBROCKU'), Groups.SONGS);
assert.strictEqual(Groups.songGroup('ROCKDITI'), Groups.SONGS);
assert.strictEqual(Groups.songGroup('TITLE'), Groups.SONGS);
assert.strictEqual(Groups.songGroup('BOS1'), Groups.TEAM_SONGS);
assert.strictEqual(Groups.songGroup('CHIC3'), Groups.TEAM_SONGS);
assert.strictEqual(Groups.songGroup('ANA1'), Groups.TEAM_SONGS);
assert.strictEqual(Groups.songGroup('FLA2'), Groups.TEAM_SONGS);
assert.strictEqual(Groups.songGroup('MTTITLE'), Groups.MT32);
assert.strictEqual(Groups.songGroup('MT32HOCK'), Groups.MT32);
assert.strictEqual(Groups.songGroup('adtitle'), Groups.SONGS);
assert.strictEqual(Groups.songGroup('bos1', 'Songs'), Groups.TEAM_SONGS);

const mixed = [
  { stem: 'WINN2', group: Groups.songGroup('WINN2') },
  { stem: 'ADTITLE', group: Groups.songGroup('ADTITLE') },
  { stem: 'BOS1', group: Groups.songGroup('BOS1') },
  { stem: 'CANADA', group: Groups.songGroup('CANADA') },
  { stem: 'CHIC1', group: Groups.songGroup('CHIC1') },
  { stem: 'MTTITLE', group: Groups.songGroup('MTTITLE') },
  { stem: 'BOS2', group: Groups.songGroup('BOS2') },
  { stem: 'USA', group: Groups.songGroup('USA') }
];
const orig = mixed.slice();
const songs = Groups.sortSongs(mixed);
assert.deepStrictEqual(mixed, orig, 'sortSongs does not mutate');
assert.deepStrictEqual(runs(songs, 'group'), [Groups.SONGS, Groups.TEAM_SONGS, Groups.MT32]);
assert.deepStrictEqual(songs.filter((s) => s.group === Groups.TEAM_SONGS).map((s) => s.stem), ['BOS1', 'BOS2', 'CHIC1', 'WINN2']);

const speechIn = [
  { group: 'XRBARR2.VIV', subgroup: 'HOM', name: 'BOS.HOM' },
  { group: 'XBRUCE2.VIV', subgroup: 'CTY', name: 'PIT.CTY' },
  { group: 'XRBARR2.VIV', subgroup: 'BAR', name: 'EASPORTS.BAR' },
  { group: 'XBRUCE2.VIV', subgroup: 'NUM', name: '73.NUM' },
  { group: 'XBRUCE2.VIV', subgroup: 'BRU', name: 'TWELVE.BRU' },
  { group: 'XBRUCE2.VIV', subgroup: 'COR', name: '1SECOND.COR' },
  { group: 'XRBARR2.VIV', subgroup: 'RNK', name: 'EDM.RNK' }
];
const speech = Groups.sortSpeech(speechIn);
assert.deepStrictEqual(runs(speech, 'group'), ['XBRUCE2.VIV', 'XRBARR2.VIV']);
assert.deepStrictEqual(
  runs(speech.filter((c) => c.group === 'XBRUCE2.VIV'), 'subgroup'),
  ['NUM', 'COR', 'BRU', 'CTY']
);
assert.deepStrictEqual(
  runs(speech.filter((c) => c.group === 'XRBARR2.VIV'), 'subgroup'),
  ['BAR', 'HOM', 'RNK']
);
assert.strictEqual(Groups.extOf('73.NUM'), 'NUM');
assert.strictEqual(Groups.extOf('BOS.HOM'), 'HOM');
assert.strictEqual(Groups.packRank('XBRUCE2.VIV') < Groups.packRank('XRBARR2.VIV'), true);
assert.strictEqual(Groups.subKey('XBRUCE2.VIV', 'NUM'), 'XBRUCE2.VIV\x1fNUM');

// NHL 95 PC OpenAnnouncerBank is XBRUCE2.VIV only (no XRBARR in HOCKEY.EXE).
// NUM / COR / TEA / PEN / FRM rink calls, then BAR / INT / HOM / AWA / RNK.
const pc95 = Groups.sortSpeech([
  { group: 'XBRUCE2.VIV', subgroup: 'HOM', name: 'BOS.HOM' },
  { group: 'XBRUCE2.VIV', subgroup: 'BAR', name: 'EASPORTS.BAR' },
  { group: 'XBRUCE2.VIV', subgroup: 'NUM', name: '73.NUM' },
  { group: 'XBRUCE2.VIV', subgroup: 'INT', name: 'BACKMOMT.INT' },
  { group: 'XBRUCE2.VIV', subgroup: 'TEA', name: 'BOS.TEA' },
  { group: 'XBRUCE2.VIV', subgroup: 'PEN', name: 'ROUGHING.PEN' },
  { group: 'XBRUCE2.VIV', subgroup: 'FRM', name: 'BOS.FRM' },
  { group: 'XBRUCE2.VIV', subgroup: 'COR', name: '1SECOND.COR' },
  { group: 'XBRUCE2.VIV', subgroup: 'AWA', name: 'BUF.AWA' },
  { group: 'XBRUCE2.VIV', subgroup: 'RNK', name: 'LA.RNK' }
]);
assert.deepStrictEqual(runs(pc95, 'group'), ['XBRUCE2.VIV']);
assert.deepStrictEqual(runs(pc95, 'subgroup'), ['NUM', 'COR', 'TEA', 'PEN', 'FRM', 'BAR', 'INT', 'HOM', 'AWA', 'RNK']);
assert.strictEqual(pc95[0].name, '73.NUM');

const ui = fs.readFileSync(path.join(__dirname, '../public/sound-test-pc94.js'), 'utf8');
assert.ok(ui.includes('NhlPcAudioGroups'), 'Audio tab uses NhlPcAudioGroups');
assert.ok(ui.includes('sortSongs') && ui.includes('sortSpeech'), 'songs and speech are grouped before listing');
assert.ok(ui.includes('subgroup'), 'speech clips carry an extension subgroup');
assert.ok(ui.includes('packName'), 'speech groups are the VIV pack name');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert.ok(html.includes('lib/audio/pc-audio-groups.js'), 'index.html loads pc-audio-groups.js');
const viewer = fs.readFileSync(path.join(__dirname, '../public/viewer.js'), 'utf8');
assert.ok(viewer.includes('is-sub'), 'Audio list renders nested subgroup toggles');
assert.ok(viewer.includes('entry.subgroup'), 'Audio list folds on entry.subgroup');

function retail94Dir() {
  const root = path.join(__dirname, '..');
  const cands = [
    process.env.NHL_PC94_DIR,
    path.join(root, 'pc94'),
    path.join(root, 'EA-NHL-Tools', 'Sprite-Viewer', 'pc94'),
    '/tmp/nhl94pc-src/lst/game',
    '/tmp/ea-nhl-tools/Sprite-Viewer/pc94'
  ].filter(Boolean);
  return cands.find((dir) => fs.existsSync(path.join(dir, 'ADTITLE.KMS'))) || null;
}

function retail95Viv() {
  const root = path.join(__dirname, '..');
  const cands = [
    process.env.NHL_PC95_DIR && path.join(process.env.NHL_PC95_DIR, 'XBRUCE2.VIV'),
    path.join(root, 'pc95', 'XBRUCE2.VIV'),
    '/cursor/stores/self/media/nhl95pc-audio/XBRUCE2.VIV'
  ].filter(Boolean);
  return cands.find((p) => fs.existsSync(p)) || null;
}

const retail = retail94Dir();
if (retail) {
  const stems = fs.readdirSync(retail).filter((n) => /\.KMS$/i.test(n)).map((n) => n.replace(/\.KMS$/i, ''));
  assert.ok(stems.includes('BOS1') && stems.includes('ADTITLE') && stems.includes('MTTITLE'));
  const listed = Groups.sortSongs(stems.map((stem) => ({ stem: stem, group: Groups.songGroup(stem) })));
  assert.deepStrictEqual(runs(listed, 'group'), [Groups.SONGS, Groups.TEAM_SONGS, Groups.MT32]);
  const team = listed.filter((s) => s.group === Groups.TEAM_SONGS).map((s) => s.stem);
  assert.ok(team.includes('BOS1') && team.includes('CHIC1') && team.includes('WINN2'),
    'team songs stay together: ' + team.join(','));
  assert.ok(listed.findIndex((s) => s.group === Groups.TEAM_SONGS) >
    listed.findIndex((s) => s.group === Groups.SONGS));
  const clips = [];
  for (const pack of ['XBRUCE2.VIV', 'XRBARR2.VIV']) {
    const p = path.join(retail, pack);
    if (!fs.existsSync(p)) continue;
    const buf = fs.readFileSync(p);
    assert.strictEqual(buf[0], 0xc0);
    const count = (buf[4] << 8) | buf[5];
    let w = 6;
    for (let i = 0; i < count; i++) {
      w += 6;
      let z = w;
      while (z < buf.length && buf[z] !== 0) z++;
      const name = Buffer.from(buf.slice(w, z)).toString('ascii');
      clips.push({ group: pack, subgroup: Groups.extOf(name), name: name });
      w = z + 1;
    }
  }
  if (clips.length) {
    const ordered = Groups.sortSpeech(clips.slice().reverse());
    assert.deepStrictEqual(runs(ordered, 'group'), ['XBRUCE2.VIV', 'XRBARR2.VIV']);
    const bruce = ordered.filter((c) => c.group === 'XBRUCE2.VIV');
    assert.deepStrictEqual(runs(bruce, 'subgroup'), ['BRU', 'MSC', 'OFF', 'CTY']);
    const barr = ordered.filter((c) => c.group === 'XRBARR2.VIV');
    assert.deepStrictEqual(runs(barr, 'subgroup'), ['BAR', 'INT', 'HOM', 'AWA', 'RNK']);
  }
}

const viv95 = retail95Viv();
if (viv95) {
  const buf = fs.readFileSync(viv95);
  assert.strictEqual(buf[0], 0xc0);
  const count = (buf[4] << 8) | buf[5];
  const clips = [];
  let w = 6;
  for (let i = 0; i < count; i++) {
    w += 6;
    let z = w;
    while (z < buf.length && buf[z] !== 0) z++;
    const name = Buffer.from(buf.slice(w, z)).toString('ascii');
    clips.push({ group: 'XBRUCE2.VIV', subgroup: Groups.extOf(name), name: name });
    w = z + 1;
  }
  assert.strictEqual(clips.length, 344, 'retail 95 XBRUCE2.VIV clip count');
  const ordered = Groups.sortSpeech(clips.slice().reverse());
  assert.deepStrictEqual(runs(ordered, 'group'), ['XBRUCE2.VIV']);
  assert.deepStrictEqual(runs(ordered, 'subgroup'), ['NUM', 'COR', 'TEA', 'PEN', 'FRM', 'BAR', 'INT', 'HOM', 'AWA', 'RNK']);
  assert.ok(/\.NUM$/i.test(ordered[0].name));
}

console.log('pc-audio-groups: ok');
