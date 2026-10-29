// compressBytecode round trips through lib/jim.js decompressBytecode, the
// port of the game's DecompressBytecode. Assertions run at require time.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { decompressBytecode } = require('../lib/jim');
const { compressBytecode } = require('../lib/jim-compress');

const opcodesSeen = new Set();

// The game does not clear its ring buffer before unpacking (Studio's starts
// zeroed), so walk the stream and check that no copy reads before output
// byte 0 or from a ring slot already overwritten.
function checkSources(label, stream, length) {
  let pos = 0;
  let at = 0;
  for (;;) {
    assert.ok(pos < stream.length, label + ': stream ends before the end code');
    const c = stream[pos++];
    const high = c >> 4;
    let count = 0;
    let distance = 0;
    let reverse = false;
    if (high <= 1) { count = (c & 0x1f) + 1; pos += count; }
    else if (high === 2) count = (c & 15) + 1;
    else if (high === 3) { count = (c & 15) + 3; pos++; }
    else if (high <= 7) { count = (c & 7) + 2; distance = ((c >> 3) & 7) + 1; }
    else if (high === 0xC || high === 0xD) { count = (c & 3) + 2; distance = ((c >> 2) & 7) + 1; reverse = true; }
    else {
      const next = stream[pos++];
      if (high === 0xE && next === 0) break;
      if (high === 8 || high === 0xE) { count = (c & 15) + 3; distance = next; }
      else if (high === 9 || high === 0xF) { count = (((c << 1) | (next >> 7)) & 0x1f) + 3; distance = (next & 0x7f) + 1; }
      else if (high === 0xA) { count = ((((c << 8) | next) >> 6) & 0x3f) + 3; distance = (next & 0x3f) + 1; }
      else { count = ((((c << 8) | next) >> 5) & 0x7f) + 3; distance = (next & 0x1f) + 1; }
      reverse = high === 0xE || high === 0xF;
    }
    opcodesSeen.add(high <= 1 ? 0 : high >= 4 && high <= 7 ? 4 : high === 0xD ? 0xC : high);
    if (distance) {
      assert.ok(distance >= 1, label + ': copy distance 0');
      const lowest = reverse ? at - distance - (count - 1) : at - distance;
      assert.ok(lowest >= 0, label + ': copy reads before the first output byte at ' + at);
      if (reverse) assert.ok(distance + 2 * (count - 1) <= 256, label + ': reverse copy leaves the ring at ' + at);
    }
    at += count;
  }
  assert.strictEqual(pos, stream.length, label + ': bytes after the end code');
  assert.strictEqual(at, length, label + ': stream writes exactly the input length');
}

function roundTrip(label, bytes) {
  const stream = compressBytecode(bytes);
  assert.ok(stream instanceof Uint8Array, label + ': stream is a Uint8Array');
  assert.deepStrictEqual(Array.from(stream.subarray(stream.length - 2)), [0xE0, 0x00], label + ': ends with $E0 $00');
  checkSources(label, stream, bytes.length);
  const back = decompressBytecode(stream, 0, bytes.length);
  assert.deepStrictEqual(Array.from(back), Array.from(bytes), label + ': round trip');
  return stream;
}

// mulberry32
function prng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function make(length, fill) {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = fill(i) & 255;
  return bytes;
}

const lengths = [0, 1, 2, 3, 31, 32, 33, 64, 255, 256, 257, 32 * 8, 32 * 61, 32 * 200];
const rand = prng(0x5EED93);
const text = 'Ron Barr, EA Sports. NHLPA Hockey 93. ';
let cases = 0;
for (const length of lengths) {
  const patterns = {
    random: () => Math.floor(rand() * 256),
    zeros: () => 0,
    ff: () => 0xFF,
    rep12: () => 0x12,
    text: (i) => text.charCodeAt(i % text.length),
    incrementing: (i) => i,
    // 4bpp-style: a few colors, long runs, rows that repeat.
    tiles: (i) => [0x00, 0x11, 0x12, 0x21, 0x33, 0xF1][Math.floor(rand() * 6 * (i % 7 === 0 ? 1 : 0.2))],
    mirrored: (i) => { const r = i % 64; return r < 32 ? r * 7 : (63 - r) * 7; },
    lowEntropy: () => Math.floor(rand() * 3)
  };
  for (const [name, fill] of Object.entries(patterns)) {
    roundTrip(name + ' x' + length, make(length, fill));
    cases++;
  }
}

// Fuzz: random spliced runs, copies, and reversed copies so every opcode class
// and the ring wrap get exercised.
const fuzz = prng(1993);
for (let round = 0; round < 300; round++) {
  const length = 32 * (1 + Math.floor(fuzz() * 40));
  const bytes = new Uint8Array(length);
  let i = 0;
  while (i < length) {
    const kind = Math.floor(fuzz() * 5);
    const run = 1 + Math.floor(fuzz() * 140);
    for (let k = 0; k < run && i < length; k++, i++) {
      if (kind === 0) bytes[i] = Math.floor(fuzz() * 256);
      else if (kind === 1) bytes[i] = 0;
      else if (kind === 2 && i > 0) bytes[i] = bytes[i - 1];
      else if (kind === 3 && i > 40) bytes[i] = bytes[i - 37];
      else if (kind === 4 && i > 2 * k + 10) bytes[i] = bytes[i - 2 * k - 10];
      else bytes[i] = Math.floor(fuzz() * 4);
    }
  }
  roundTrip('fuzz ' + round, bytes);
  cases++;
}

roundTrip('literal [1,2,3]', Uint8Array.from([1, 2, 3]));
roundTrip('Buffer input', Buffer.from([9, 9, 9, 9, 9, 1, 2, 3, 3, 2, 1]));

// Encoder picks reverse copies: a palindrome should not be all literals.
const pal = make(64, (i) => (i < 32 ? i * 5 + 1 : (63 - i) * 5 + 1));
assert.ok(roundTrip('palindrome', pal).length < 64, 'palindrome compresses');

// Retail NHLPA 93 packed tiles (tile word $803D: 61 tiles from offset 10).
const fixture = path.join(__dirname, 'fixtures', 'JIM-Tools', 'ronbarr.map.jzip');
const file = fs.readFileSync(fixture);
const tileWord = file.readUInt16BE(8);
assert.strictEqual(tileWord, 0x803D, 'ronbarr tile word');
const tiles = tileWord & 0x7fff;
const retail = decompressBytecode(file, 10, tiles * 32);
assert.strictEqual(retail.length, tiles * 32);
const ours = roundTrip('ronbarr tiles', retail);

// Retail packed length: decode again, stopping at the end code.
let retailEnd = 10;
{
  let pos = 10;
  for (;;) {
    const c = file[pos++];
    const high = c >> 4;
    if (high <= 1) pos += (c & 0x1f) + 1;
    else if (high === 2 || (high >= 4 && high <= 7) || high === 0xC || high === 0xD) { /* one byte */ }
    else if (high === 0xE) { if (file[pos++] === 0) break; }
    else pos++;
  }
  retailEnd = pos;
}
assert.strictEqual(retailEnd, file.readUInt32BE(0), 'ronbarr palette follows the packed tiles');
const retailPacked = retailEnd - 10;

for (const high of [0, 2, 3, 4, 8, 9, 0xA, 0xB, 0xC, 0xE, 0xF]) {
  assert.ok(opcodesSeen.has(high), 'encoder emitted opcode $' + high.toString(16).toUpperCase() + 'x');
}
console.log('jim-compress: ' + cases + ' round trips ok; ronbarr ' + retail.length +
  ' tile bytes -> ours ' + ours.length + ' bytes, retail ' + retailPacked + ' bytes');
