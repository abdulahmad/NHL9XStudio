/** lib/pc-jersey.js: NHL 94 PC / NHL 95 PC HOMEPALS / AWAYPALS (the JED files): detection, byte-identical export,
 *  single-palette .bin and sprite-space .ACT round trips, byte equality with EA-NHL-Tools createPal ACTs, and
 *  agreement with the Studio's sprite palette and render (lib/pc95.js). */
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

// --- .ACT in sprite-colour space (EA-NHL-Tools binToAct createPal, which PPV-To-BMP applies to raw sprites) ---
const PALS = path.join(__dirname, 'fixtures', 'PAL-To-ACT');
const BASE = {
  rink: fs.readFileSync(path.join(PALS, 'rinkpalShadowfixed.act')),
  jersey: fs.readFileSync(path.join(PALS, 'createjerseyShadowfixed.act')),
  rinkPlain: fs.readFileSync(path.join(PALS, 'rinkpal.act'))
};
for (const n of ['rinkpalShadowfixed.act', 'createjerseyShadowfixed.act', 'rinkpal.act']) {
  same(fs.readFileSync(path.join(__dirname, '..', 'public', 'jed-pals', n)), fs.readFileSync(path.join(PALS, n)), 'public/jed-pals/' + n + ' = fixture');
}
// byte-for-byte equal to the createPal ACTs EA-NHL-Tools ships in PPV-To-BMP/Palettes (test/fixtures/pc-jersey/createPal).
// Exception: NHL 95 HOMEPALS ANA, whose shipped ACT was built from a different HOMEPALS (5 crest/white entries differ).
const EA_DIFFERS = { 'HOMEPALS95.BIN': ['ana'] };
const CREATE = path.join(FIX, 'createPal');
for (const name of Object.keys(FILES)) {
  const bytes = read(name);
  const f = J.openFile(bytes);
  const [game] = FILES[name];
  const side = name.slice(0, 8);
  let matched = 0;
  for (let t = 0; t < J.teamCount(f); t++) {
    const act = J.toAct(f, t, BASE);
    assert.strictEqual(act.length, 768);
    const code = f.teams[t].code;
    const ea = fs.readFileSync(path.join(CREATE, 'NHL' + game + 'PAL', side, code.toUpperCase() + '-01-createPal.ACT'));
    if ((EA_DIFFERS[name] || []).includes(code)) assert.ok(!Buffer.from(act).equals(ea), name + ' ' + code + ' known difference still there');
    else { same(act, ea, name + ' ' + code + ' = EA-NHL-Tools createPal'); matched++; }
    // = the Studio's sprite palette (lib/pc95.js buildTeamPalette, used by the Frame tab), incl. the static game palette
    const studio = Pc.buildTeamPalette(J.getRecord(f, t), null);
    const ours = J.spritePalette(f, t, BASE);
    for (let i = 0; i < 256; i++) {
      assert.deepStrictEqual(ours[i], studio[i], name + ' ' + code + ' sprite colour ' + i);
      assert.deepStrictEqual(ours.game[i], studio.game[i], name + ' ' + code + ' game colour ' + i);
    }
  }
  assert.ok(matched >= J.teamCount(f) - 1, name + ' matched ' + matched);
  const g = J.openFile(bytes);
  for (let t = 0; t < J.teamCount(g); t++) J.fromAct(g, t, J.toAct(f, t, BASE));
  same(J.exportFile(g), bytes, name + ' ACT round trip identical');
  const trailer = J.toAct(f, 4, BASE, true);
  assert.strictEqual(trailer.length, 772);
  J.fromAct(g, 4, trailer);
  same(J.exportFile(g), bytes, name + ' 772-byte ACT round trip identical');
}
{
  const f = J.openFile(read('HOMEPALS95.BIN'));
  const src = J.slotSources(f, 0);
  const slot = src.findIndex((x) => x.length >= 2);
  assert.ok(slot >= 0, 'some team colour shows at two sprite indices');
  const act = J.toAct(f, 0, BASE);
  const [first, second] = src[slot];
  act[first * 3] = 255; act[first * 3 + 1] = 6; act[first * 3 + 2] = 1; // nearest 6-bit, clamped
  act[second * 3] = 0; act[second * 3 + 1] = 0; act[second * 3 + 2] = 0;
  act[10 * 3] = 77; // a non-team entry: ignored
  const before = J.getRecord(f, 0);
  const r = J.fromAct(f, 0, act);
  assert.deepStrictEqual(J.getColors(f, 0)[slot], [63, 2, 0], 'lowest sprite index wins');
  assert.deepStrictEqual(r.conflicts.map((c) => c.slot), [slot], 'conflict reported');
  assert.strictEqual(r.conflicts[0].used, first);
  const after = J.getRecord(f, 0);
  for (let i = 0; i < 448; i++) if (i < slot * 3 || i >= slot * 3 + 3) assert.strictEqual(after[i], before[i], 'only that slot changes ' + i);
  assert.throws(() => J.fromAct(f, 0, new Uint8Array(767)), /768 bytes/);
  const short = new Uint8Array(772); short[769] = 16;
  assert.throws(() => J.fromAct(f, 0, short), /144\.\.250/);
  assert.throws(() => J.toAct(f, 0, {}), /palette/);
}
// rendering a real sprite through the ACT (pixel i -> ACT entry i) equals the Studio's preview render
{
  const PC94 = [process.env.NHL_PC94_DIR, path.join(__dirname, '..', 'pc94'), path.join(__dirname, '..', '..', 'EA-NHL-Tools', 'Sprite-Viewer', 'pc94')]
    .filter(Boolean).find((d) => fs.existsSync(path.join(d, '000_049.PPV')));
  if (PC94) {
    const files = ['000_049.PPV', '050_099.PPV'].map((n) => ({ name: n, data: new Uint8Array(fs.readFileSync(path.join(PC94, n))) }));
    const bank = Pc.openSpriteBundle(Pc.encodeBundle(files), 'nhl94pc');
    const f = J.openFile(read('HOMEPALS94.BIN'));
    let drawn = 0;
    for (let n = 1; n <= 100; n++) {
      const fr = bank.renderFrame(n); if (!fr || !fr.width) continue;
      const act = J.toAct(f, 3, BASE);
      const studio = fr.dynamic === false ? Pc.buildTeamPalette(J.getRecord(f, 3), null).game : Pc.buildTeamPalette(J.getRecord(f, 3), null);
      for (const p of fr.pixels) {
        if (p === 255 || fr.dynamic === false) continue;
        assert.deepStrictEqual([act[p * 3], act[p * 3 + 1], act[p * 3 + 2]], studio[p], 'frame ' + n + ' pixel ' + p);
      }
      drawn++;
    }
    assert.ok(drawn > 10, 'sprites rendered ' + drawn);
  } else console.log('pc-jersey: no NHL 94 PC sprites on disk, sprite render check skipped');
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

// scoreboard crest: pixel p -> palette[p], 67 -> game 103, 255 transparent; slots split jersey / crest
{
  const f = J.openFile(read('HOMEPALS95.BIN'), 'home');
  const pal = []; for (let i = 0; i < 256; i++) pal[i] = [i, 1, 2]; pal.game = []; for (let i = 0; i < 256; i++) pal.game[i] = [i, 9, 9];
  const rgb = J.crestRgb({ width: 3, height: 1, pixels: [197, 67, 255] }, pal);
  assert.deepStrictEqual(Array.from(rgb), [197, 1, 2, 255, 103, 9, 9, 255, 0, 0, 0, 0]);
  const map = J.getMap(f, 0); const c = J.crestSlots(f, 0);
  for (const z of J.SCOREBOARD) if (map[z.sprite] >= 128 && map[z.sprite] < 192) assert.ok(c.has(map[z.sprite] - 128));
  const all = new Set(J.usedColors(f, 0)); for (const x of [...c, ...J.jerseySlots(f, 0)]) assert.ok(all.has(x));
}

console.log('pc-jersey: ok');

// NHL 95 PC sprite pixels + colours vs EA-NHL-Tools SPIT-To-BMP + createPal (skips without the tools / game files).
require('./pc95-sprite-pipeline');
