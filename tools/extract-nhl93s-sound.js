#!/usr/bin/env node
/**
 * Extract the NHLPA Hockey '93 (SNES) sound data into data/audio/nhl93s-sound.json.
 *
 *   node tools/extract-nhl93s-sound.js <NHLPA93SNES checkout> [out.json]
 *   node tools/extract-nhl93s-sound.js <NHLPA93SNES checkout> --check     # compare the committed JSON with a fresh extract
 *
 * NHLPA 93 (SNES) has no main-CPU sequencer. The game uploads a sound program to the SPC700 (the "boot" stream:
 * driver, instrument table, sample directory, title/menu samples; later the "game" stream swaps in the in-game
 * samples) and then only sends one-byte cues to it. The program is Nintendo's standard N-SPC sequencer with the
 * songs and the sound effects inside it, so the pack is the two upload streams, byte for byte, plus the names the
 * disassembly gives the cues.
 *
 * Checked against the checkout while extracting (nothing is taken on trust):
 *   - the ROM's SHA-1 (lst/nhlpa93snes.bin);
 *   - the stream addresses ($868000 and $818000, from docs/file_map.md) and that each stream parses to its end block;
 *   - block 1 of the boot stream equals data/spc/driver.spc700, the sample blocks equal data/bootsamples.brr and
 *     data/gamesamples.brr, the instrument and sample-directory blocks equal the db/dw lines of src/data/sound/*.asm;
 *   - the cue numbers the StartSong* routines send, and the SFX numbers in src/ram93snes.asm.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROM_SHA1 = '76a01492cfb656e9fce0094bca356c312adfea0e';
const OUT = path.join(__dirname, '..', 'data', 'audio', 'nhl93s-sound.json');

const hex = (s) => parseInt(String(s).replace('$', ''), 16);

/** LoROM/FastROM file offset of a bank:address. */
const off = (a) => ((a >> 16) & 0x7f) * 0x8000 + (a & 0x7fff);

/** Upload stream: [length][APU address][bytes] ..., then length 0 + the address to start at. */
function parseStream(rom, start) {
  const blocks = [];
  let p = start;
  for (;;) {
    const len = rom.readUInt16LE(p);
    const addr = rom.readUInt16LE(p + 2);
    p += 4;
    if (!len) return { blocks, entry: addr, end: p };
    blocks.push({ addr, bytes: rom.subarray(p, p + len) });
    p += len;
  }
}

/** The numeric db/dw items of an asm file in order (for comparing with the ROM). */
function asmNumbers(text) {
  const out = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/;.*$/, '');
    const m = /^\s*(?:\.?\w+:)?\s*(db|dw)\s+(.*)$/.exec(line);
    if (!m) continue;
    for (const part of m[2].split(',')) {
      const t = part.trim();
      if (/^\$[0-9A-Fa-f]+$/.test(t)) out.push({ size: m[1] === 'db' ? 1 : 2, value: hex(t) });
    }
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const dir = args.filter((a) => !a.startsWith('--'))[0];
  const out = args.filter((a) => !a.startsWith('--'))[1] || OUT;
  if (!dir) { console.error('usage: extract-nhl93s-sound.js <NHLPA93SNES dir> [out.json | --check]'); process.exit(2); }
  const rom = fs.readFileSync(path.join(dir, 'lst', 'nhlpa93snes.bin'));
  const sha = crypto.createHash('sha1').update(rom).digest('hex');
  if (sha !== ROM_SHA1) throw new Error('ROM SHA-1 ' + sha + ' is not the expected NHLPA 93 SNES ' + ROM_SHA1);
  const fileMap = fs.readFileSync(path.join(dir, 'docs', 'file_map.md'), 'utf8');
  const bootAt = /`\$(86[0-9A-F]{4})` data\/sound\/bootsound\.asm/.exec(fileMap);
  const gameAt = /`\$(81[0-9A-F]{4})` data\/sound\/gamesound\.asm/.exec(fileMap);
  if (!bootAt || !gameAt) throw new Error('docs/file_map.md does not place bootsound.asm / gamesound.asm');
  const boot = parseStream(rom, off(hex(bootAt[1])));
  const game = parseStream(rom, off(hex(gameAt[1])));
  if (boot.entry !== 0x0400 || game.entry !== 0x0800) throw new Error('unexpected stream entry points');
  if (boot.blocks.length !== 4 || game.blocks.length !== 2) throw new Error('unexpected block counts');

  const data = (f) => fs.readFileSync(path.join(dir, 'data', f));
  const same = (a, b, what) => { if (!Buffer.from(a).equals(Buffer.from(b))) throw new Error(what + ' differs from the ROM stream'); };
  same(boot.blocks[0].bytes, data('spc/driver.spc700'), 'data/spc/driver.spc700');
  same(boot.blocks[3].bytes, data('bootsamples.brr'), 'data/bootsamples.brr');
  same(game.blocks[1].bytes, data('gamesamples.brr'), 'data/gamesamples.brr');
  if (boot.blocks[0].addr !== 0x0400 || boot.blocks[1].addr !== 0x2b00 || boot.blocks[2].addr !== 0x2c00 || boot.blocks[3].addr !== 0x2c30) throw new Error('unexpected boot block addresses');
  if (game.blocks[0].addr !== 0x2c00 || game.blocks[1].addr !== 0x2c50) throw new Error('unexpected game block addresses');

  // the tables, against the db/dw lines
  let checked = 0;
  const compare = (block, file, label) => {
    const text = fs.readFileSync(path.join(dir, 'src', 'data', 'sound', file), 'utf8');
    const at = text.indexOf(label + ':');
    const end = text.indexOf('\n; ----', at);
    const nums = asmNumbers(text.slice(at, end < 0 ? undefined : end).replace(/SPC\w*\+\$[0-9A-Fa-f]+/g, ''));
    let p = 0;
    for (const n of nums) {
      let v = 0;
      for (let k = 0; k < n.size; k++) v |= block[p + k] << (8 * k);
      if (v !== n.value) throw new Error(label + ': +' + p + ' is $' + v.toString(16) + ', the source says $' + n.value.toString(16));
      p += n.size;
      checked += n.size;
    }
  };
  compare(boot.blocks[1].bytes, 'bootsound.asm', 'BootInstruments');

  // cue numbers: what each StartSong routine sends the sound program
  const names = {
    1: 'Home goal', 2: 'Period start', 3: 'Third period', 4: 'Cue 4 (unused)', 5: 'Mid-period', // StartSong1-5 (MusicCue)
    6: 'Title screen', 7: 'Song 7 (unused)', 8: 'Song 8 (unused)', 9: 'Playoff screen' // StartSong6-9 (APUIO0)
  };
  const cueOf = {};
  for (let n = 1; n <= 9; n++) {
    const text = fs.readFileSync(path.join(dir, 'src', 'routines', 'sound', 'StartSong' + n + '.asm'), 'utf8');
    const m = /lda\.[bw] #\$0*([0-9A-F]+)\s*(?:\r?\n\s*jsl\.l MusicCue|\r?\n\s*sta\.w APUIO0)/.exec(text)
      || /sep #\$20\s*(?:;[^\n]*)?\r?\n\s*lda\.b #\$0*([0-9A-F]+)\s*\r?\n\s*sta\.w APUIO0/.exec(text);
    if (!m) throw new Error('StartSong' + n + '.asm: cue number not found');
    cueOf[n] = hex(m[1]);
  }
  const expectCue = { 1: 4, 2: 5, 3: 6, 4: 7, 5: 8, 6: 3, 7: 2, 8: 9, 9: 1 };
  for (const n of Object.keys(expectCue)) if (cueOf[n] !== expectCue[n]) throw new Error('StartSong' + n + ' sends cue ' + cueOf[n] + ', expected ' + expectCue[n]);
  const cues = [];
  for (let n = 1; n <= 9; n++) {
    const song = Number(Object.keys(cueOf).find((k) => cueOf[k] === n));
    const text = fs.readFileSync(path.join(dir, 'src', 'routines', 'sound', 'StartSong' + song + '.asm'), 'utf8');
    const note = /^StartSong\d+:\s*;([^\n]*)/m.exec(text)[1].trim();
    cues.push({ cue: n, song, label: 'StartSong' + song, name: names[song], note, set: song >= 6 ? 'boot' : 'game' });
  }

  // sound effects: the SFX numbers the game source names
  const ram = fs.readFileSync(path.join(dir, 'src', 'ram93snes.asm'), 'utf8');
  const sfx = {};
  for (const m of ram.matchAll(/^SFX(\w+)\s*=\s*\$([0-9A-F]+)\s*;?\s*([^\n]*)/gm)) {
    const id = hex(m[2]);
    (sfx[id] = sfx[id] || []).push({ name: m[1], note: m[3].trim() });
  }
  const sfxNames = Object.keys(sfx).map(Number).sort((a, b) => a - b).map((id) => ({ id, names: sfx[id] }));
  if (!sfx[0x89] || !sfx[0xa0]) throw new Error('SFX names not found in ram93snes.asm');

  const b64 = (b) => Buffer.from(b).toString('base64');
  const pack = {
    source: {
      game: 'NHLPA Hockey \'93 (Super Nintendo)',
      rom: { sha1: ROM_SHA1, size: rom.length },
      streams: { boot: '$' + bootAt[1], game: '$' + gameAt[1] },
      note: 'Extracted by tools/extract-nhl93s-sound.js from the NHLPA93SNES disassembly and its ROM: the two SPC700 upload streams as the game sends them.'
    },
    boot: { entry: boot.entry, blocks: boot.blocks.map((b) => ({ addr: b.addr, data: b64(b.bytes) })) },
    game: { entry: game.entry, blocks: game.blocks.map((b) => ({ addr: b.addr, data: b64(b.bytes) })) },
    cues,
    sfx: sfxNames
  };
  const text = JSON.stringify(pack, null, 1) + '\n';
  if (check) {
    const sameText = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8') === text;
    console.log(sameText ? 'data/audio/nhl93s-sound.json is up to date' : 'data/audio/nhl93s-sound.json differs from a fresh extract');
    process.exit(sameText ? 0 : 1);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  console.log('wrote ' + path.relative(process.cwd(), out) + ': boot ' + boot.blocks.map((b) => b.bytes.length).join('+') + ' bytes, game '
    + game.blocks.map((b) => b.bytes.length).join('+') + ' bytes, ' + cues.length + ' cues, ' + sfxNames.length + ' named effects; '
    + checked + ' table bytes cross-checked (' + text.length + ' chars)');
}

main();
