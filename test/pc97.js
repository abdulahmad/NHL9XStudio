/** NHL 97 (PC): the game entry, the disc detection and the palette block after an 8-bit shape. */
const assert = require('assert');
const Games = require('../lib/games');
const Pc = require('../lib/pc95');

const game = Games.gameById('nhl97pc');
assert.ok(game && game.kind === 'pc97' && game.platform === 'pc' && game.title === 'NHL 97 (PC)');
assert.ok(Pc.isNhl97(['DATA/CDFILEI.VIV', 'GAMEDATA/UNI0001.VIV']));
assert.ok(Pc.isNhl97(['DATA/NHL9596.SEA']));
assert.ok(!Pc.isNhl97(['DATA/GAMEART.VIV', 'GAMEDATA/MENU1.ASF']));

// A SHPI bank with one 2 x 2 shape (code 0x7B, 8 bits) followed by a 0x24 palette block of 4 colours.
function u32(n) { return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]; }
const shape = [0x7B, 20, 0, 0, 2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3];
const pal = [0x24, 0, 0, 0, 4, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9];
const body = shape.concat(pal);
const head = [0x53, 0x48, 0x50, 0x49].concat(u32(16 + 8 + body.length), u32(1), [0x47, 0x49, 0x4D, 0x58], [0x54, 0x45, 0x53, 0x54], u32(24));
const bytes = Uint8Array.from(head.concat(body));
const opened = Pc.openBytes(bytes);
assert.strictEqual(opened.shapes.length, 1);
const colors = opened.shapes[0].attachedPalette;
assert.ok(colors && colors.length === 256);
assert.deepStrictEqual(colors[0], [255, 0, 0]);
assert.deepStrictEqual(colors[3], [9, 9, 9]);
const image = Pc.openImageParts([{ name: 'x.fsh', data: bytes }], null, { rel: 'x.fsh' });
assert.deepStrictEqual(image.renderFrame(1).colors[1], [0, 255, 0]);
console.log('pc97 ok');

// NHL 97 PC .ASF songs: SCHl header, SCDl chunks of IMA ADPCM (stereo, one byte per frame).
{
  const asf = require('../lib/audio/pc96-asf');
  const fs = require('fs');
  const sample = '/mnt/user-data/uploads/CDs/NHL97/GAMEDATA/DIT40.ASF';
  const build = (frames) => {
    const hdr = Buffer.alloc(100); hdr.write('SCHl', 0); hdr.writeUInt32LE(100, 4); hdr.write('TMpl', 0x40);
    hdr[0x47] = 2; hdr.writeUInt16LE(22050, 0x4a);
    const ch = Buffer.alloc(20 + frames); ch.write('SCDl', 0); ch.writeUInt32LE(20 + frames, 4);
    ch.writeUInt32LE(frames, 8);
    return Buffer.concat([hdr, ch]);
  };
  const p = asf.parse(build(100));
  assert.ok(p && p.playable && p.rate === 22050 && p.channels === 2 && p.pcm.length === 400, 'SCHl parse');
  if (fs.existsSync(sample)) {
    const q = asf.parse(fs.readFileSync(sample));
    assert.strictEqual(q.pcm.length / 4, 230095, 'DIT40 length matches TMpl');
  }
}

// Sega CD speech PCM: sign-magnitude, 0xFF ends the sample.
{
  const pcm = require('../lib/audio/segacd-pcm');
  const out = pcm.decode(Uint8Array.from([0x80, 0x85, 0x05, 0xff, 0x90]));
  assert.deepStrictEqual(Array.from(out), [0, 5, 251], 'Sega CD PCM decode');
}

// NHL 97 .KSF speech banks: offset table, then streams of bare IMA ADPCM.
{
  const asf = require('../lib/audio/pc96-asf');
  const stream = (channels, frames, dataBytes) => {
    const b = Buffer.alloc(0x60 + dataBytes);
    b.write('PATl', 4); b.write('TMpl', 60); b[66] = channels; b.writeUInt16LE(22050, 70); b.writeUInt32LE(frames, 72);
    return b;
  };
  const a = stream(2, 100, 100), m = stream(1, 100, 50);
  const head = Buffer.alloc(4 + 3 * 4);
  head.writeUInt32LE(3, 0); head.writeUInt32LE(16, 4); head.writeUInt32LE(16 + a.length, 8); head.writeUInt32LE(16 + a.length + m.length, 12);
  const file = new Uint8Array(Buffer.concat([head, a, m]));
  const list = asf.ksfStreams(file);
  assert.strictEqual(list.length, 2, 'KSF stream count');
  assert.deepStrictEqual([list[0].channels, list[1].channels, list[0].frames], [2, 1, 100]);
  assert.strictEqual(asf.parseKsfStream(file, list[0]).pcm.length, 400, 'stereo KSF stream');
  assert.strictEqual(asf.parseKsfStream(file, list[1]).pcm.length, 200, 'mono KSF stream');
  const h = Buffer.alloc(80);
  h.write('BNKl', 0);
  h.write('TMpl', 8); h[13] = 8; h[14] = 1; h[15] = 2; h.writeUInt16LE(11025, 18); h.writeUInt32LE(500, 20); h.writeUInt32LE(64, 32);
  h.write('TMpl', 44); h[49] = 16; h[50] = 2; h[51] = 0; h.writeUInt16LE(22050, 54); h.writeUInt32LE(900, 56); h.writeUInt32LE(900, 68);
  const snd = asf.bnkSounds(new Uint8Array(h));
  assert.strictEqual(snd.length, 2, 'BNK sound count');
  assert.deepStrictEqual([snd[0].codec, snd[0].rate, snd[0].frames, snd[0].offset, snd[0].channels], [2, 11025, 500, 64, 1]);
  assert.deepStrictEqual([snd[1].codec, snd[1].channels], [0, 2]);
}
{
  // 30 FB Huffman: escape byte 0, counts, symbol list, then codes. Hand-built stream for "AAB".
  const huff = require('../lib/audio/ea-huff');
  assert.ok(huff.isHuff(new Uint8Array([0x30, 0xFB, 0, 0, 3, 0, 0, 0])));
  assert.strictEqual(huff.unpack(new Uint8Array([0x30, 0xFB, 0, 0, 3, 0, 0, 0])), null, 'truncated Huffman data is refused');
}
{
  const asf = require('../lib/audio/pc96-asf');
  // BIGF with one entry, and a PBP header with one "masv" record.
  const big = Buffer.alloc(16 + 8 + 8);
  big.write('BIGF', 0); big.writeUInt32BE(1, 8); big.writeUInt32BE(32, 16); big.writeUInt32BE(4, 20); big.write('a.b', 24);
  const e = asf.bigfEntries(new Uint8Array(big));
  assert.deepStrictEqual([e.length, e[0].name, e[0].offset, e[0].size], [1, 'a.b', 32, 4]);
  const h = Buffer.alloc(100); h.write('knbv', 0); h.write('masv', 40); h.writeUInt32LE(64, 44); h.writeUInt32LE(16, 48);
  assert.deepStrictEqual(asf.pbpSamples(new Uint8Array(h)), [{ index: 0, size: 64, offset: 16 }]);
  // Two frames: filter 0 shift 12, nibble 1 gives 1 << 0 = 1 for the first sample (low nibble first).
  const fr = new Uint8Array(32); fr[0] = 12; fr[1] = 12; fr[2] = 0x01; fr[16] = 12; fr[17] = 12;
  const pbp = asf.parsePbp(fr, 22050);
  assert.strictEqual(pbp.pcm.length, 2 * 28 * 2, 'PBP frame size');
  assert.strictEqual(pbp.pcm[0] | (pbp.pcm[1] << 8), 1, 'PBP first sample');
  // 8-bit signed PCM bank sound (codec 0)
  const pcm = asf.parseKsfStream(new Uint8Array([0, 1, 255, 127, 128, 0]), { start: 0, dataAt: 0, end: 6, channels: 2, rate: 22050, frames: 3, codec: 0 });
  assert.strictEqual(pcm.pcm.length, 12, 'codec 0 stereo size');
}

