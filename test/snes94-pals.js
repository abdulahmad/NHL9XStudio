// NHL 94 SNES jersey colours are the ROM's BGR555 uniform rows, not the 93 CRAM .snespal lines.
const assert = require('assert');
const snes = require('../lib/snes');

function putWords(rom, addr, words) {
  const at = ((addr >> 16) & 0x7f) * 0x8000 + (addr & 0x7fff);
  words.forEach((c, i) => {
    rom[at + i * 2] = c & 255;
    rom[at + i * 2 + 1] = (c >> 8) & 255;
  });
}

const rom = new Uint8Array(0x100000);
const away = new Array(16).fill(0);
away[0] = 0x001f;
away[1] = 0x03e0;
putWords(rom, 0x96C9CE, away);
const home = new Array(16).fill(0);
home[0] = 0x7c00;
putWords(rom, 0x96CD4E, home);
const buffalo = new Array(16).fill(0);
buffalo[3] = 0x001f;
putWords(rom, 0x96CD4E + 2 * 32, buffalo);

const pals = snes.uniformPalettes(rom);
assert.strictEqual(pals.length, 56);
assert.strictEqual(pals[0].name, 'ANHv.snespal');
assert.strictEqual(pals[27].name, 'ASWv.snespal');
assert.strictEqual(pals[28].name, 'ANHh.snespal');
assert.strictEqual(pals[55].name, 'ASWh.snespal');
assert.deepStrictEqual(pals[0].colors[0], [255, 0, 0]);
assert.deepStrictEqual(pals[0].colors[1], [0, 255, 0]);
assert.deepStrictEqual(pals.find((p) => p.name === 'ANHh.snespal').colors[0], [0, 0, 255]);
assert.deepStrictEqual(pals.find((p) => p.name === 'BUFh.snespal').colors[3], [255, 0, 0]);
assert.deepStrictEqual(pals.find((p) => p.name === 'DALh.snespal').colors[0], [0, 0, 0]);

// A copier header is dropped. The CRAM decoder is not used on these words.
const headed = new Uint8Array(0x100200);
headed.set(rom, 512);
const again = snes.uniformPalettes(headed);
assert.deepStrictEqual(again[0].colors[0], [255, 0, 0]);
const raw = new Uint8Array([0x1f, 0x00]);
const padded = new Uint8Array(32);
padded.set(raw);
assert.notDeepStrictEqual(snes.decodeTeamPalette(padded)[0], again[0].colors[0]);

assert.strictEqual(snes.uniformPalettes(new Uint8Array(0x80000)), null);
console.log('snes94 pals ok');
