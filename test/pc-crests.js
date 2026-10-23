// NHL 95 PC CRESTS4.PPV: RLE round trip, unedited write byte-identical, JED PCX read/write (retail parts skip without files).
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const C = require('../lib/pc-crests'); const Pc = require('../lib/pc95');
const px = Uint8Array.from({ length: 768 }, (_, i) => (i % 37 < 20 ? 255 : 197 + (i % 5)));
assert.deepStrictEqual(Array.from(C.unrle(C.rle(px), 0, 768)), Array.from(px));
const pal = new Uint8Array(768); for (let i = 0; i < 256; i++) pal.set([i, 255 - i, i >> 1], i * 3);
const r = C.readPcx(C.writePcx(px, 32, 24, pal)); assert.deepStrictEqual([r.w, r.h], [32, 24]); assert.deepStrictEqual(Array.from(r.idx), Array.from(px));
const DIR = process.env.NHL_PC95_DIR; const f = DIR && path.join(DIR, 'CRESTS4.PPV');
if (f && fs.existsSync(f)) {
  const b = new Uint8Array(fs.readFileSync(f)); const bank = C.parse(b);
  assert.strictEqual(bank.entries.length, 28);
  assert.ok(Buffer.from(C.write(bank)).equals(Buffer.from(b)), 'unedited = original');
  const ref = Pc.openBytes(b).shapes; bank.entries.forEach((e, i) => assert.deepStrictEqual(Array.from(e.pixels), Array.from(ref[i].pixels), e.tag));
  C.find(bank, 'bos').pixels[0] = 200; const w = C.write(bank); const again = Pc.openBytes(w).shapes;
  assert.strictEqual(again.length, 28); assert.strictEqual(again[3].pixels[0], 200); assert.deepStrictEqual(Array.from(again[4].pixels), Array.from(ref[4].pixels));
  const jed = path.join(process.env.NHL_JED_DIR || '', 'COL.PCX'); if (process.env.NHL_JED_DIR && fs.existsSync(jed)) { const p = C.readPcx(new Uint8Array(fs.readFileSync(jed))); assert.deepStrictEqual([p.w, p.h], [32, 24]); }
  console.log('pc-crests: retail CRESTS4.PPV round-trips, edits re-encode');
} else console.log('pc-crests: NHL_PC95_DIR not set, retail check skipped');
console.log('pc-crests: ok');
