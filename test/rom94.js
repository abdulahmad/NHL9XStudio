/** NHL 94 team colours as the fight-colour default (NHL95PC port/rom94.c and port/fight/hooks.c make_lut_for). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R93 = require('../lib/rom93');
const R94 = require('../lib/rom94');

const root = path.join(__dirname, '..');

function put16(d, o, v) { d[o] = (v >> 8) & 255; d[o + 1] = v & 255; }
function put32(d, o, v) {
  d[o] = (v >>> 24) & 255; d[o + 1] = (v >>> 16) & 255; d[o + 2] = (v >>> 8) & 255; d[o + 3] = v & 255;
}
function cramWord(r, g, b) { return ((b & 7) << 9) | ((g & 7) << 5) | ((r & 7) << 1); }
/** A name block: a word length (itself included, even), then the letters and a 0. */
function putStr(d, o, str) {
  const bytes = Array.from(str).map((c) => c.charCodeAt(0));
  bytes.push(0);
  if ((2 + bytes.length) % 2) bytes.push(0);
  put16(d, o, 2 + bytes.length);
  bytes.forEach((b, i) => { d[o + 2 + i] = b; });
  return o + 2 + bytes.length;
}
function seal(d) {
  let sum = 0;
  for (let i = 0x200; i < d.length; i += 2) sum = (sum + ((d[i] << 8) | d[i + 1])) & 0xFFFF;
  const cur = (d[0x200] << 8) | d[0x201];
  const next = (cur + ((0x5512 - sum) & 0xFFFF)) & 0xFFFF;
  put16(d, 0x200, next);
  put16(d, 0x18E, 0x5512);
}
const z16 = () => Array.from({ length: 16 }, () => [0, 0, 0]);
function slot(n, rgb) { const a = z16(); a[n] = rgb; return a; }

function retailRom() {
  const d = new Uint8Array(R94.ROM_SIZE);
  const title = "NHL HOCKEY '94";
  assert.strictEqual(title.length, 14);
  for (let i = 0; i < title.length; i++) d[0x150 + i] = title.charCodeAt(i);
  for (let t = 0; t < R94.NTEAMS; t++) put32(d, 0x30E + t * 4, 0xFFFFF0);
  const teams = [
    ['BOS', 'Boston', slot(8, [7, 0, 0]), slot(9, [0, 0, 7])],
    ['ANH', 'Anaheim', slot(4, [0, 7, 0]), z16()],
    ['OTW', 'Ottawa', slot(3, [0, 0, 6]), z16()],
    ['DAL', 'Dallas', slot(5, [7, 7, 0]), z16()],
    ['FLA', 'Florida', slot(2, [7, 0, 7]), z16()],
    ['LA', 'Los Angeles', slot(10, [0, 7, 7]), z16()],
    ['ASE', 'East', slot(11, [1, 2, 3]), z16()],
    ['ASW', 'West', slot(12, [3, 2, 1]), z16()]
  ];
  // Boston's stick slot is a 94 colour the 95 PC stick colour must replace.
  teams[0][2][1] = [5, 5, 5];
  teams.forEach((row, index) => {
    const rec = 0x10000 + index * 0x100;
    put32(d, 0x30E + index * 4, rec);
    put16(d, rec + 2, 8);
    put16(d, rec + 4, 8 + 64);
    const home = row[2], away = row[3];
    for (let i = 0; i < 16; i++) put16(d, rec + 8 + i * 2, cramWord(home[i][0], home[i][1], home[i][2]));
    for (let i = 0; i < 16; i++) put16(d, rec + 8 + 32 + i * 2, cramWord(away[i][0], away[i][1], away[i][2]));
    putStr(d, putStr(d, rec + 8 + 64, row[1]), row[0]);
  });
  seal(d);
  return d;
}

assert.strictEqual(R94.letters('ana'), 'ANH');
assert.strictEqual(R94.letters('ANA'), 'ANH');
assert.strictEqual(R94.letters('ott'), 'OTW');
assert.strictEqual(R94.letters('min'), 'DAL');
assert.strictEqual(R94.letters('dal'), 'DAL');
assert.strictEqual(R94.letters('fla'), 'FLA');
assert.strictEqual(R94.letters('bos'), 'BOS');
assert.strictEqual(R94.teamColours(null, 'bos', true), null);

assert.throws(() => R94.open(new Uint8Array(100)), /1 MB/);
assert.throws(() => R94.open(new Uint8Array(R94.ROM_SIZE)), /header name/);

const romBytes = retailRom();
const rom = R94.open(romBytes);
const bosHome = R94.teamColours(rom, 'bos', true);
const bosAway = R94.teamColours(rom, 'bos', false);
assert.deepStrictEqual(bosHome[8], [252, 0, 0], '94 CRAM is channel × 36, not × 255 / 7');
assert.deepStrictEqual(bosHome[1], [180, 180, 180]);
assert.deepStrictEqual(bosAway[9], [0, 0, 252], 'visitor colours are the second 16');
assert.deepStrictEqual(R94.teamColours(rom, 'ana', true)[4], [0, 252, 0]);
assert.deepStrictEqual(R94.teamColours(rom, 'ott', true)[3], [0, 0, 216]);
assert.deepStrictEqual(R94.teamColours(rom, 'min', true)[5], [252, 252, 0]);
assert.deepStrictEqual(R94.teamColours(rom, 'dal', true)[5], [252, 252, 0]);
assert.deepStrictEqual(R94.teamColours(rom, 'fla', true)[2], [252, 0, 252]);
assert.deepStrictEqual(R94.teamColours(rom, 'la', true)[10], [0, 252, 252]);
assert.deepStrictEqual(R94.teamColours(rom, 'ase', true)[11], [36, 72, 108]);
assert.deepStrictEqual(R94.teamColours(rom, 'asw', false)[12], [0, 0, 0]);
assert.strictEqual(R94.teamColours(rom, 'zzz', true), null);

const headed = new Uint8Array(R94.ROM_SIZE + 512);
headed.set(romBytes, 512);
assert.deepStrictEqual(R94.teamColours(R94.open(headed), 'fla', true)[2], [252, 0, 252], 'a 512-byte copier header is dropped');

const tampered = romBytes.slice();
tampered[0x1000] ^= 0xFF;
assert.throws(() => R94.open(tampered), /not a known retail one/);
const unnamed = romBytes.slice();
unnamed[0x150] = 'X'.charCodeAt(0);
assert.throws(() => R94.open(unnamed), /header name/);
const brokenSprites = romBytes.slice();
put32(brokenSprites, 0x5DE7A + 4, 0x00F00000);
seal(brokenSprites);
assert.throws(() => R94.open(brokenSprites), /no sprite sheet/);

// The 93 frames stay the 93 frames.
assert.strictEqual(R93.FRAMES.gloves, 353);
assert.strictEqual(R93.FRAMES.fight, 354);
assert.strictEqual(R93.FRAMES.fightInjury, 371);
assert.strictEqual(R93.FRAMES.injury, 633);

const plain = Array.from({ length: 64 }, () => [9, 9, 9]);
const missed = R93.fightBase(plain, null, true);
assert.strictEqual(missed.teamOnly, true, 'no 94 colours: a team 93 lacks stays inside 95 PC team colours');
assert.deepStrictEqual(missed.pal[40], [9, 9, 9]);
assert.deepStrictEqual(missed.pal[33], [0x00, 0x40, 0x80], 'stick is the 95 PC colour');
assert.deepStrictEqual(missed.pal[15], [0x60, 0x38, 0x1C], 'eye');
assert.deepStrictEqual(plain[33], [9, 9, 9], 'the 93 palette is not modified');

const got = R93.fightBase(plain, bosHome, true);
assert.strictEqual(got.teamOnly, false, '94 colours: match the whole 0-191 range, including Anaheim');
assert.deepStrictEqual(got.pal[32 + 8], [252, 0, 0]);
assert.deepStrictEqual(got.pal[48 + 8], [252, 0, 0], 'both team lines');
assert.deepStrictEqual(got.pal[32 + 1], [0x00, 0x40, 0x80], 'stick stays 95 PC');
assert.deepStrictEqual(got.pal[48 + 1], [0x00, 0x40, 0x80]);
assert.deepStrictEqual(got.pal[32 + 6], [0xC8, 0x84, 0x5C], 'skin');
assert.deepStrictEqual(got.pal[32 + 7], [0xA4, 0x6C, 0x48], 'skin');
assert.deepStrictEqual(got.pal[48 + 14], [0xA0, 0x60, 0x60], 'shadow');
assert.deepStrictEqual(got.pal[48 + 15], [0x40, 0xA0, 0xE0], 'skate blade');
assert.deepStrictEqual(got.pal[15], [0x60, 0x38, 0x1C], 'eye');
assert.deepStrictEqual(got.pal[3], [9, 9, 9], 'rink colours stay the 93 ROM');

const pc = Array.from({ length: 256 }, () => [0, 0, 0]);
pc[10] = [252, 0, 0];
pc[160] = [200, 0, 0];
pc[20] = [0x00, 0x40, 0x80];
pc[30] = [0x60, 0x38, 0x1C];
const free = R93.autoMap(got.pal, pc, false);
const held = R93.autoMap(got.pal, pc, true);
assert.strictEqual(free[40], 10, 'a 94 team colour may land outside 144-191');
assert.strictEqual(held[40], 160, 'the old Anaheim path would have stayed in the team range');
assert.strictEqual(free[33], 20, 'stick');
assert.strictEqual(free[15], 30, 'eye');

const map = new Array(64).fill(null);
map[34] = 200;
const all = new Array(64).fill(null);
all[34] = 180;
assert.strictEqual(R93.resolveColour(map, all, free, 34), 200, 'FIGHTPAL for this jersey wins');
assert.strictEqual(R93.resolveColour(map, all, free, 50), 200, 'line 3 is the same entry as line 2');
assert.strictEqual(R93.resolveColour(new Array(64).fill(null), all, free, 34), 180, 'a line for every jersey is next');
assert.strictEqual(R93.resolveColour(new Array(64).fill(null), new Array(64).fill(null), free, 34), free[34]);
const written = R93.writeText([{ code: 'BOS', side: 'home', map }], new Set([34]));
assert.match(written, /NHL 94/);
const parsed = R93.readText(written);
assert.strictEqual(R93.resolveColour(parsed.jerseys['bos home'], parsed.all, free, 34), 200);

const fight = fs.readFileSync(path.join(root, 'public', 'fight.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'jed.html'), 'utf8');
assert.ok(fight.includes('R94.teamColours'), 'the default asks the 94 ROM');
assert.ok(fight.includes('R.fightBase'), '94 colours replace the team slots, then the 95 PC shared colours');
assert.ok(fight.includes('!F.rom94'), 'a missing 94 ROM does not invent a default');
assert.ok(fight.includes('Open your NHL 94 ROM'));
assert.ok(fight.includes('Open your NHL 94 ROM first'));
assert.ok(html.includes('lib/rom94.js'));
assert.ok(html.includes('Open NHL 94 ROM'));
assert.ok(html.includes('id="fight-team94"'));
assert.ok(!fight.includes('autoMap(R.pc95Colours(pal93'), 'the old 93-only default is gone');

console.log('rom94 ok');
