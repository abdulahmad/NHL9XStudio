/** lib/pc-jersey.js: NHL 94 PC / NHL 95 PC HOMEPALS / AWAYPALS (the JED files): detection, byte-identical export,
 *  single-palette .bin and .ACT round trips, and agreement with the Studio's team palette (lib/pc95.js). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const J = require('../lib/pc-jersey');
const Pc = require('../lib/pc95');

const FIX = path.join(__dirname, 'fixtures', 'pc-jersey');
const read = (n) => new Uint8Array(fs.readFileSync(path.join(FIX, n)));
const same = (a, b, msg) => assert.ok(Buffer.from(a).equals(Buffer.from(b)), msg);
const FILES = { 'HOMEPALS95.BIN': ['95', 28], 'AWAYPALS95.BIN': ['95', 28], 'HOMEPALS94.BIN': ['94', 26], 'AWAYPALS94.BIN': ['94', 26] };

// --- detection and the team lists ---
for (const [name, [game, teams]] of Object.entries(FILES)) {
  const bytes = read(name);
  assert.strictEqual(J.detect(bytes), game, name);
  const f = J.openFile(bytes);
  assert.strictEqual(J.teamCount(f), teams, name);
  assert.strictEqual(f.teams.length, teams, name + ' team names');
  for (let t = 0; t < teams; t++) for (const c of J.getColors(f, t)) for (const v of c) assert.ok(v <= 63, name + ' 6-bit');
}
assert.strictEqual(J.TEAMS['95'][24].code, 'ana');
assert.strictEqual(J.TEAMS['94'][24].code, 'asw');
assert.throws(() => J.openFile(new Uint8Array(448 * 27)), /Not a HOMEPALS/);
assert.strictEqual(J.ZONES.length, 48);
assert.strictEqual(J.ZONES[0].sprite, 144);

// --- unedited export is byte-identical; an edit touches only its 3 bytes; and edits never leak into the input ---
for (const name of Object.keys(FILES)) {
  const bytes = read(name);
  const f = J.openFile(bytes);
  same(J.exportFile(f), bytes, name + ' export identical');
  J.setColor(f, 3, 10, [63, 0, 1]);
  const out = J.exportFile(f);
  const diff = [];
  for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff.push(i);
  assert.ok(diff.length >= 1 && diff.length <= 3 && diff.every((i) => i >= 3 * 448 + 30 && i < 3 * 448 + 33), name + ' edit scope');
  same(read(name), bytes, 'input untouched');
  J.setColor(f, 3, 10, J.getColors(J.openFile(bytes), 3)[10]);
  same(J.exportFile(f), bytes, name + ' undo restores identical bytes');
}

// --- single palette .bin: export / import round trip, size validation ---
{
  const bytes = read('HOMEPALS95.BIN');
  const a = J.openFile(bytes);
  const rec = J.getRecord(a, 5);
  assert.strictEqual(rec.length, 448);
  same(rec, bytes.subarray(5 * 448, 6 * 448), 'record bytes');
  const b = J.openFile(bytes);
  J.setRecord(b, 5, rec);
  same(J.exportFile(b), bytes, 'bin round trip identical');
  J.setRecord(b, 0, rec); // copy Edmonton home over Boston home
  same(J.getRecord(b, 0), rec, 'bin import into another team');
  same(J.exportFile(b).subarray(448), bytes.subarray(448), 'other teams untouched');
  assert.throws(() => J.setRecord(b, 0, new Uint8Array(447)), /448 bytes/);
  assert.throws(() => J.setRecord(b, 0, new Uint8Array(768)), /448 bytes/);
  const bad = rec.slice(); bad[0] = 64;
  assert.throws(() => J.setRecord(b, 0, bad), /0\.\.63/);
  const c = J.openFile(bytes);
  J.setRecord(c, 1, rec.subarray(0, 192)); // colours only
  same(J.getColors(c, 1), J.getColors(a, 5), '192-byte colours import');
  same(J.getMap(c, 1), J.getMap(a, 1), '192-byte import keeps the map');
  // a 94 record goes into a 95 file (same 448-byte layout)
  const r94 = J.getRecord(J.openFile(read('HOMEPALS94.BIN')), 2);
  J.setRecord(c, 2, r94);
  same(J.getRecord(c, 2), r94, '94 record into 95 file');
}

// --- .ACT: layout (EA-NHL-Tools binToAct teamPal: colours at 128..191, * 4), round trip, trailer, rounding ---
for (const name of Object.keys(FILES)) {
  const bytes = read(name);
  const f = J.openFile(bytes);
  for (let t = 0; t < J.teamCount(f); t++) {
    const act = J.toAct(f, t);
    assert.strictEqual(act.length, 768);
    for (let i = 0; i < 768; i++) {
      const idx = Math.floor(i / 3);
      const want = idx >= 128 && idx < 192 ? bytes[t * 448 + (i - 384)] * 4 : 0;
      assert.strictEqual(act[i], want, name + ' team ' + t + ' act byte ' + i);
    }
    // agrees with the Studio's team palette (game palette 128..191)
    const pal = Pc.buildTeamPalette(J.getRecord(f, t), null).game;
    for (let i = 128; i < 192; i++) assert.deepStrictEqual(pal[i], [act[i * 3], act[i * 3 + 1], act[i * 3 + 2]], 'game palette ' + i);
  }
  const g = J.openFile(bytes);
  for (let t = 0; t < J.teamCount(g); t++) J.fromAct(g, t, J.toAct(f, t));
  same(J.exportFile(g), bytes, name + ' ACT round trip identical');
  const trailer = J.toAct(f, 4, true);
  assert.strictEqual(trailer.length, 772);
  J.fromAct(g, 4, trailer);
  same(J.exportFile(g), bytes, name + ' 772-byte ACT round trip identical');
}
{
  const f = J.openFile(read('HOMEPALS95.BIN'));
  const act = J.toAct(f, 0);
  act[128 * 3] = 255; act[128 * 3 + 1] = 6; act[128 * 3 + 2] = 1; // not multiples of 4: nearest 6-bit, clamped
  J.fromAct(f, 0, act);
  assert.deepStrictEqual(J.getColors(f, 0)[0], [63, 2, 0]);
  assert.throws(() => J.fromAct(f, 0, new Uint8Array(767)), /768 bytes/);
  const short = new Uint8Array(772); short[769] = 16;
  assert.throws(() => J.fromAct(f, 0, short), /128\.\.191/);
}

// --- map: low half is a near-identity remap (shadow / blade fixes), jersey zones point at team colours ---
{
  const f = J.openFile(read('HOMEPALS95.BIN'));
  const map = J.getMap(f, 0);
  assert.strictEqual(map[0], 0);
  assert.strictEqual(map[8], 16);
  assert.strictEqual(map[88], 99);
  for (const z of J.ZONES.slice(0, 47)) assert.ok(map[z.sprite] >= 128 && map[z.sprite] < 192, 'zone ' + z.name);
  J.setMap(f, 0, 165, 128 + 7);
  assert.strictEqual(J.getMap(f, 0)[165], 135);
  assert.strictEqual(J.exportFile(f)[320 + 37], 135);
  assert.ok(J.usedColors(f, 0).includes(7));
}

console.log('pc-jersey: ok');
