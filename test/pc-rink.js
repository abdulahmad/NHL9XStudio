/** lib/pc-rink.js: NHL 95 PC centre ice .TIL / .MAP. Synthetic round trips, BlitTileMap semantics (flips, the rotated
 *  second copy, 255 transparent, clipping), the palette ranges, quantize / tile / dedupe and the 1024-tile limit; the
 *  away colours 59..63 the rink palette overwrites (lib/pc-jersey.js). With NHL_PC95_DIR (an NHL 95 PC install or
 *  extracted CD) it also round-trips all 26 retail arenas byte-identically. Game files are never committed. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = require('../lib/pc-rink');
const J = require('../lib/pc-jersey');

const tile = (fill) => new Uint8Array(64).fill(fill);
const same = (a, b, msg) => assert.ok(Buffer.from(a).equals(Buffer.from(b)), msg);

// --- format ---
const t0 = tile(1); t0[0] = 2; // top-left marker
const t1 = tile(R.CLEAR); t1[9] = 3;
const til = R.writeTil([t0, t1]);
assert.strictEqual(til.length, 128);
assert.throws(() => R.parseTil(new Uint8Array(65)), /multiple of 64/);
{
  const linear = new Uint8Array(64);
  for (let i = 0; i < 64; i++) linear[i] = i + 1;
  const packed = R.swizzle94(linear);
  assert.notDeepStrictEqual(Array.from(packed), Array.from(linear));
  assert.deepStrictEqual(Array.from(R.unswizzle94(packed)), Array.from(linear));
  const file = R.writeTil([linear], 94);
  assert.deepStrictEqual(Array.from(R.parseTil(file, 94)[0]), Array.from(linear));
  const t = new Uint8Array(64); t[0] = 1; t[4] = 2;
  const flipMap = { w: 1, h: 1, flag: 528, cells: Uint16Array.from([0x800]) };
  const flipped = R.composite(new Uint8Array(R.PX_W * R.PX_H).fill(7), flipMap, [t], [0, 0, -1, -1], 94);
  assert.strictEqual(flipped[4], 1, '94 0x800 swaps 4-pixel groups, not reverse-8');
  assert.strictEqual(flipped[0], 2);
}
const map = { w: 2, h: 1, flag: 16, cells: Uint16Array.from([0, 1 | R.HFLIP]) };
const mb = R.writeMap(map);
assert.deepStrictEqual(Array.from(mb), [2, 0, 1, 0, 16, 0, 0, 0, 1, 0x20]);
const back = R.parseMap(mb); assert.strictEqual(back.w, 2); assert.deepStrictEqual(Array.from(back.cells), [0, 0x2001]);
assert.throws(() => R.parseMap(Uint8Array.from([9, 0, 9, 0, 16, 0])), /does not fit/);

// --- blit: placement, flips, 255 skipped, rotated second copy, clipping ---
const base = new Uint8Array(R.PX_W * R.PX_H).fill(7);
let px = R.composite(base, map, [t0, t1], [10, 20, -1, -1]);
const at = (p, x, y) => p[y * R.PX_W + x];
assert.strictEqual(at(px, 80, 160), 2, 'tile 0 top-left at (10, 20)');
assert.strictEqual(at(px, 81, 160), 1);
assert.strictEqual(at(px, 88 + 6, 161), 3, 'tile 1 mirrored: pixel (1,1) lands at (6,1)');
assert.strictEqual(at(px, 88 + 1, 161), 7, '255 is transparent');
assert.strictEqual(base[0], 7, 'input untouched');
px = R.composite(base, map, [t0, t1], [10, 20, 30, 40]);
assert.strictEqual(at(px, 30 * 8 + 7, 40 * 8 + 7), 2, 'second copy: tile 0 rotated 180 degrees at (x2, y2)');
assert.strictEqual(at(px, 29 * 8 + 1, 40 * 8 + 6), 3, 'second copy: tile 1 one tile left, mirror cancelled, flipped');
px = R.composite(base, map, [t0, t1], [47, 73, -1, -1]); // the game does not clip; we do
assert.strictEqual(at(px, 47 * 8, 73 * 8), 2);

// --- palette ranges (LoadTeamPalette) ---
assert.ok(R.usable(0) && R.usable(127) && R.usable(128) && R.usable(191) && R.usable(251) && R.usable(254));
for (let i = 192; i <= 250; i++) assert.ok(!R.usable(i), 'away ' + i);
assert.strictEqual(R.rangeOf(150).source, 'home');
assert.strictEqual(R.rangeOf(255).source, 'clear');
const rinkAct = new Uint8Array(768); for (let i = 0; i < 768; i++) rinkAct[i] = i % 256;
const home = Array.from({ length: 64 }, (_, i) => [i, 0, 0]), away = Array.from({ length: 64 }, () => [0, 63, 0]);
const pal = R.gamePalette(rinkAct, home, away);
assert.deepStrictEqual(pal[130], [8, 0, 0]);
assert.deepStrictEqual(pal[250], [0, 252, 0]);
assert.deepStrictEqual(pal[251], [rinkAct[753], rinkAct[754], rinkAct[755]], '251..255 stay rink colours');
assert.deepStrictEqual(pal[10], [30, 31, 32]);

// jersey side: NHL 95 PC away colours 59..63 are rink colours in the game
const FIX = path.join(__dirname, 'fixtures', 'pc-jersey');
const plain = new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'public', 'jed-pals', 'rinkpal.act')));
const aw = J.openFile(new Uint8Array(fs.readFileSync(path.join(FIX, 'AWAYPALS95.BIN'))));
assert.ok(J.awayOverwritten('95', 'away', 59) && !J.awayOverwritten('95', 'away', 58) && !J.awayOverwritten('95', 'home', 63) && !J.awayOverwritten('94', 'away', 63));
const gpAway = J.gamePalette(aw, 0, { rink: plain }, 'away'), gpHome = J.gamePalette(aw, 0, { rink: plain }, 'home');
for (let s = 59; s < 64; s++) assert.deepStrictEqual(gpAway[128 + s], Array.from(plain.subarray((192 + s) * 3, (192 + s) * 3 + 3)), 'away slot ' + s);
assert.deepStrictEqual(gpHome[128 + 59], J.getColors(aw, 0)[59].map(J.to8));

// --- editor model: build / export ---
const m = R.modelFrom(map, [t0, t1], [10, 20, -1, -1]);
assert.deepStrictEqual(R.bounds(m), { x: 10, y: 20, w: 2, h: 1 });
const ex = R.exportFiles(m, { map, tiles: [t0, t1], place: [10, 20, -1, -1] });
same(ex.map, mb, 'unedited map is byte-identical'); same(ex.til, til, 'unedited til is byte-identical');
m.cells[22 * R.W + 13] = 0; // a gap row and a column
let b = R.build(m);
assert.deepStrictEqual([b.map.w, b.map.h], [4, 3]);
assert.strictEqual(b.tiles.length, 3, 'two tiles + one transparent gap tile');
assert.strictEqual(b.map.cells[1], 1, 'stored mirror bit resolved and re-found as the same tile ' + b.map.cells[1].toString(16));
// a mirrored copy of a tile dedupes to the same tile with the flip bit
const asym = tile(4); asym[0] = 5;
const m2 = { cells: new Int32Array(R.W * R.H).fill(-1), tiles: [asym, R.flipped(asym, true, false)], place: [0, 0, -1, -1], flag: 16 };
m2.cells[0] = 0; m2.cells[1] = 1;
b = R.build(m2);
assert.strictEqual(b.tiles.length, 1); assert.strictEqual(b.map.cells[1], R.HFLIP);
assert.throws(() => R.build({ cells: new Int32Array(R.W * R.H).fill(-1), tiles: [], place: [0, 0, -1, -1] }), /No tiles/);

// --- import: quantize to allowed colours, cut into tiles, dedupe, 1024 limit ---
const allowed = []; for (let i = 0; i < 256; i++) if (R.usable(i) && i !== R.CLEAR) allowed.push(i);
const w = 24, h = 16, rgba = new Uint8Array(w * h * 4);
for (let i = 0; i < w * h; i++) rgba.set(i % w < 8 ? [0, 252, 0, 255] : i % w < 16 ? [8, 0, 0, 255] : [0, 0, 0, 0], i * 4);
const idx = R.quantize(rgba, pal, allowed);
assert.ok(R.usable(idx[0]) && idx[0] < 192 || idx[0] > 250, 'green never picks an away colour (' + idx[0] + ')');
assert.strictEqual(idx[8], 130, 'exact home colour');
assert.strictEqual(idx[16], R.CLEAR, 'transparent');
const empty = { cells: new Int32Array(R.W * R.H).fill(-1), tiles: [], place: [0, 0, -1, -1], flag: 16 };
const im = R.placeImage(empty, idx, w, h, 5, 6);
assert.strictEqual(im.tiles.length, 2, 'duplicates removed, empty tiles skipped');
assert.strictEqual(im.cells[6 * R.W + 7], -1);
assert.strictEqual(empty.tiles.length, 0, 'input model untouched');
const big = new Uint8Array(R.PX_W * R.PX_H); let seed = 1; for (let i = 0; i < big.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; big[i] = (seed >> 16) & 127; }
assert.throws(() => R.placeImage(empty, big, R.PX_W, R.PX_H, 0, 0), /at most 1024/);

// full-rink import: only masked / changed cells become tiles
const rinkPix = new Uint8Array(R.PX_W * R.PX_H).fill(9);
const full = Uint8Array.from(rinkPix); for (let y = 100; y < 120; y++) for (let x = 40; x < 60; x++) full[y * R.PX_W + x] = 130;
let fm = R.placeImage(empty, full, R.PX_W, R.PX_H, 0, 0, R.cellsDiffering(full, R.PX_W, R.PX_H, 0, 0, rinkPix));
assert.deepStrictEqual(R.bounds(fm), { x: 5, y: 12, w: 3, h: 3 }, 'diff picks the changed cells only');
assert.strictEqual(R.tileCount(fm), 4, 'solid inside + rink-only edge pieces deduped');
const mask = new Uint8Array(R.PX_W * R.PX_H * 4); for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) mask.set([255, 255, 255, 255], (y * R.PX_W + x) * 4);
fm = R.placeImage(empty, full, R.PX_W, R.PX_H, 0, 0, R.cellsFromMask(mask, R.PX_W, R.PX_H));
assert.deepStrictEqual(R.bounds(fm), { x: 0, y: 0, w: 2, h: 1 }); assert.strictEqual(R.tileCount(fm), 1);
assert.throws(() => R.placeImage(empty, big, R.PX_W, R.PX_H, 0, 0, () => true), (e) => e.tiles > 1024 && /mask/.test(e.message));

// --- retail (local only) ---
const DIR = process.env.NHL_PC95_DIR;
if (DIR && fs.existsSync(path.join(DIR, 'TOR.MAP'))) {
  for (const a of R.ARENAS) {
    const mapB = new Uint8Array(fs.readFileSync(path.join(DIR, a + '.MAP'))), tilB = new Uint8Array(fs.readFileSync(path.join(DIR, a + '.TIL')));
    const orig = { map: R.parseMap(mapB), tiles: R.parseTil(tilB), place: R.PLACEMENT[95][a] };
    const mm = R.modelFrom(orig.map, orig.tiles, orig.place);
    const e = R.exportFiles(mm, orig);
    same(e.map, mapB, a + '.MAP'); same(e.til, tilB, a + '.TIL');
    const rb = R.build(mm);
    assert.ok(rb.tiles.length <= orig.tiles.length, a + ' rebuilt tiles');
    same(R.composite(base, orig.map, orig.tiles, orig.place), R.composite(base, rb.map, rb.tiles, rb.place), a + ' rebuilt renders the same');
    for (const t of orig.tiles) for (const p of t) assert.ok(p === R.CLEAR || R.usable(p), a + ' retail colour ' + p);
  }
  // a full-rink mockup (retail rink + an 'ad' block): diff keeps it well under 1024
  const P = require('../lib/pc95');
  const rk = P.openBytes(new Uint8Array(fs.readFileSync(path.join(DIR, 'RINK.QFS'))), 'RINK.QFS').shapes[0].pixels;
  const mock = Uint8Array.from(rk); for (let y = 200; y < 248; y++) for (let x = 64; x < 320; x++) mock[y * R.PX_W + x] = (x >> 4) & 1 ? 130 : 140;
  const mm = R.placeImage(empty, mock, R.PX_W, R.PX_H, 0, 0, R.cellsDiffering(mock, R.PX_W, R.PX_H, 0, 0, rk));
  assert.ok(R.tileCount(mm) < 200, 'full-rink diff ' + R.tileCount(mm));
  assert.throws(() => R.placeImage(empty, mock, R.PX_W, R.PX_H, 0, 0), /1024/, 'the whole rink without a mask is over 1024');
  console.log('pc-rink: 26 retail arenas round-trip; full-rink diff import ' + R.tileCount(mm) + ' tiles');
} else console.log('pc-rink: NHL_PC95_DIR not set, retail round trip skipped');

const DIR94 = process.env.NHL_PC94_DIR
  || [path.join(__dirname, '..', 'pc94'), path.join(__dirname, '..', 'EA-NHL-Tools', 'Sprite-Viewer', 'pc94'), '/tmp/nhl94pc-src/lst/game']
    .find((d) => fs.existsSync(path.join(d, 'RINK.TIL')));
if (DIR94 && fs.existsSync(path.join(DIR94, 'RINK.MAP'))) {
  const tilBytes = new Uint8Array(fs.readFileSync(path.join(DIR94, 'RINK.TIL')));
  const mapBytes = new Uint8Array(fs.readFileSync(path.join(DIR94, 'RINK.MAP')));
  const pic = R.fullPicture(tilBytes, mapBytes, 94);
  assert.strictEqual(pic.width, R.PX_W);
  assert.strictEqual(pic.height, R.PX_H);
  let ink = 0;
  for (let i = 0; i < pic.pixels.length; i++) if (pic.pixels[i] !== R.CLEAR) ink++;
  assert.ok(ink > 100000, '94 RINK.TIL/MAP full picture (' + ink + ')');
  const lin = R.parseTil(tilBytes)[0];
  const planar = R.parseTil(tilBytes, 94)[0];
  assert.notDeepStrictEqual(Array.from(lin), Array.from(planar), '94 tiles unswizzle off disk');
  same(R.writeTil(R.parseTil(tilBytes, 94), 94), tilBytes, '94 TIL round-trips through Mode X');
  console.log('pc-rink: 94 PC RINK.TIL/MAP full picture ok');
}

// blocks: mirror / flip / 180 via cell bits (tile pixels untouched), 90 / 270 add rotated tiles; tile delete / unused
{
  const t0 = new Uint8Array(64).fill(255); t0[0] = 1; // pixel top-left
  const t1 = new Uint8Array(64).fill(255); t1[7] = 2;
  const m = { cells: new Int32Array(R.W * R.H).fill(-1), tiles: [t0, t1, new Uint8Array(64)], place: [0, 0, -1, -1], flag: 16 };
  m.cells[0] = 0; m.cells[1] = 1; m.cells[R.W] = 0; // 2x2 block: [0 1 / 0 -]
  const b = R.grab(m, { x: 0, y: 0, w: 2, h: 2 });
  const h = R.transform(m, b, 'h');
  assert.deepStrictEqual(Array.from(h.cells), [1 | R.HFLIP, 0 | R.HFLIP, -1, 0 | R.HFLIP]);
  const r180 = R.transform(m, b, '180');
  assert.deepStrictEqual(Array.from(r180.cells), [-1, 0 | R.HFLIP | R.VFLIP, 1 | R.HFLIP | R.VFLIP, 0 | R.HFLIP | R.VFLIP]);
  assert.strictEqual(m.tiles.length, 3, 'bits only: no new tiles');
  const before = R.renderMap(R.build(m).map, R.build(m).tiles).pixels;
  const m2 = R.cloneModel(m); R.clearRect(m2, { x: 0, y: 0, w: 2, h: 2 }); R.stamp(m2, r180, 0, 0);
  const after = R.renderMap(R.build(m2).map, R.build(m2).tiles).pixels;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) assert.strictEqual(after[y * 16 + x], before[(15 - y) * 16 + 15 - x], '180 = rotated pixels');
  const m3 = R.cloneModel(m); const r90 = R.transform(m3, b, '90');
  assert.strictEqual(r90.w, 2); assert.ok(m3.tiles.length > 3, '90 adds rotated tiles');
  R.clearRect(m3, { x: 0, y: 0, w: 2, h: 2 }); R.stamp(m3, r90, 0, 0);
  const p90 = R.renderMap(R.build(m3).map, R.build(m3).tiles).pixels;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) assert.strictEqual(p90[x * 16 + (15 - y)], before[y * 16 + x], '90 cw');
  const u = R.removeUnused(m); assert.strictEqual(u.removed, 1); assert.strictEqual(u.model.tiles.length, 2);
  const d = R.deleteTile(m, 0); assert.strictEqual(d.cleared, 2); assert.strictEqual(d.model.cells[1], 0); assert.strictEqual(d.model.tiles.length, 2);
  assert.strictEqual(R.usersOf(m, 0), 2);
}
console.log('pc-rink: ok');
