/** NHL 95 PC sprite colours: the Studio / jersey-editor render (lib/pc95.js decode + lib/pc-jersey.js spritePalette)
 *  must equal what EA-NHL-Tools produces: SPIT-To-BMP's .raw pixels looked up in binToAct's <TEAM>-01-createPal.ACT.
 *  Part 1 uses a synthetic SHPI bank (RLE and raw shapes covering every sprite colour) and always runs when
 *  ../EA-NHL-Tools is next to the checkout. Part 2 uses retail NHL 95 PC files (NHL_PC95_DIR, or pc95/ here) and is
 *  skipped when they are absent (they are never committed). */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Pc = require('../lib/pc95');
const J = require('../lib/pc-jersey');

const ROOT = path.join(__dirname, '..');
const TOOLS = [process.env.EA_NHL_TOOLS_ROOT, path.join(ROOT, '..', 'EA-NHL-Tools')].filter(Boolean).find((d) => fs.existsSync(path.join(d, 'SPIT-To-BMP', 'spitToBmp.js')));
const PALS = path.join(ROOT, 'test', 'fixtures', 'PAL-To-ACT');
const BASE = {
  rink: fs.readFileSync(path.join(PALS, 'rinkpalShadowfixed.act')),
  jersey: fs.readFileSync(path.join(PALS, 'createjerseyShadowfixed.act')),
  rinkPlain: fs.readFileSync(path.join(PALS, 'rinkpal.act'))
};
const CREATE = path.join(ROOT, 'test', 'fixtures', 'pc-jersey', 'createPal', 'NHL95PAL');
const FIX = path.join(ROOT, 'test', 'fixtures', 'pc-jersey');

function spitHeader(type, w, h) { const b = Buffer.alloc(16); b[0] = type; b.writeInt16LE(w, 4); b.writeInt16LE(h, 6); return b; }
/** SHPI bank: 'SHPI', u32 size, u32 count, 4-byte id, then count x (tag, u32 offset). */
function shpi(spits, firstTag) {
  const head = 16 + spits.length * 8; const out = [Buffer.alloc(head)];
  let at = head;
  out[0].write('SHPI', 0); out[0].writeUInt32LE(head + spits.reduce((n, s) => n + s.length, 0), 4); out[0].writeUInt32LE(spits.length, 8); out[0].write('GIMX', 12);
  spits.forEach((s, i) => { out[0].write(String(firstTag + i).padStart(4, '0'), 16 + i * 8); out[0].writeUInt32LE(at, 20 + i * 8); at += s.length; out.push(s); });
  return Buffer.concat(out);
}
/** SPIT slices of an SHPI (packed or not), as the tools get them from gfxpak. */
function spitsOf(bytes) {
  let b = Buffer.from(bytes);
  if (b.toString('latin1', 0, 4) !== 'SHPI') { const d = Pc.decompressEaContainer(b); if (d) b = Buffer.from(d); }
  if (b.toString('latin1', 0, 4) !== 'SHPI') return null;
  const n = b.readUInt32LE(8); const offs = [];
  for (let i = 0; i < n; i++) offs.push({ tag: b.toString('latin1', 16 + i * 8, 20 + i * 8), at: b.readUInt32LE(20 + i * 8) });
  const sorted = offs.map((o) => o.at).concat([b.length]).sort((x, y) => x - y);
  return offs.filter((o) => !/^!|^pal/i.test(o.tag)).map((o) => ({ tag: o.tag, data: b.subarray(o.at, sorted[sorted.indexOf(o.at) + 1]) }));
}
/** Run EA-NHL-Tools SPIT-To-BMP on one SPIT; returns its .raw pixels. */
function toolRaw(spit, dir, name) {
  const f = path.join(dir, name); fs.writeFileSync(f, spit);
  execFileSync(process.execPath, [path.join(TOOLS, 'SPIT-To-BMP', 'spitToBmp.js'), f], { cwd: dir, stdio: 'ignore' });
  return fs.readFileSync(f + '.raw');
}
/** Compare: Studio pixels through J.spritePalette == tool raw through the createPal ACT. Returns pixel count. */
function compare(frame, raw, act, pal, label) {
  assert.strictEqual(frame.pixels.length, raw.length, label + ' size');
  for (let i = 0; i < raw.length; i++) {
    assert.strictEqual(frame.pixels[i], raw[i], label + ' index at ' + i);
    const p = raw[i]; if (p === 255) continue; // the blitter skips 255
    assert.deepStrictEqual(pal[p], [act[p * 3], act[p * 3 + 1], act[p * 3 + 2]], label + ' colour of sprite index ' + p);
  }
  return raw.length;
}

if (!TOOLS) { console.log('pc95-sprite-pipeline: no EA-NHL-Tools next to the checkout, skipped'); process.exit(0); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc95pipe-'));
try {
  const teams = [['HOMEPALS', 'BOS'], ['AWAYPALS', 'CGY'], ['HOMEPALS', 'TOR'], ['AWAYPALS', 'ANA'], ['HOMEPALS', 'ASE']];
  const files = { HOMEPALS: J.openFile(fs.readFileSync(path.join(FIX, 'HOMEPALS95.BIN'))), AWAYPALS: J.openFile(fs.readFileSync(path.join(FIX, 'AWAYPALS95.BIN'))) };
  const team = (code) => J.TEAMS['95'].findIndex((t) => t.code === code.toLowerCase());

  // ---- part 1: synthetic SHPI, every sprite colour 0..255, RLE runs, literal runs and a raw (type 123) shape ----
  const all = []; for (let i = 0; i < 256; i++) all.push(i);
  const lit = (arr) => Buffer.concat([Buffer.from([256 - arr.length]), Buffer.from(arr)]);
  const spits = [
    Buffer.concat([spitHeader(0, 16, 16), ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((r) => lit(all.slice(r * 16, r * 16 + 16))), Buffer.from([0])]),
    null,
    Buffer.concat([spitHeader(123, 8, 6), Buffer.from(all.slice(140, 188))])
  ];
  spits[1] = Buffer.concat([spitHeader(0, 12, 4), Buffer.from([5, 144, 7, 255]), lit([192, 193, 194, 195, 196, 250, 251, 0, 128, 143]), Buffer.from([20, 197, 6, 82, 0])]);
  const bank = Pc.openSpriteBundle(Pc.encodeBundle([{ name: '000_049.PPV', data: shpi(spits, 0) }]), 'nhl95pc');
  let px = 0;
  for (const [side, code] of teams) {
    const act = fs.readFileSync(path.join(CREATE, side, code + '-01-createPal.ACT'));
    const ours = J.spritePalette(files[side], team(code), BASE);
    const known = side === 'HOMEPALS' && code === 'ANA'; // shipped ACT built from another HOMEPALS (see test/pc-jersey.js)
    spits.forEach((s, i) => {
      const raw = toolRaw(s, tmp, code + side + i + '.spit');
      if (!known) px += compare(bank.renderFrame(i + 1), raw, act, ours, 'synthetic ' + side + ' ' + code + ' shape ' + i);
    });
  }
  assert.ok(px > 1000, 'synthetic pixels compared ' + px);

  // ---- part 2: retail NHL 95 PC sprites (local only) ----
  const DIR = [process.env.NHL_PC95_DIR, path.join(ROOT, 'pc95')].filter(Boolean).find((d) => fs.existsSync(path.join(d, '000_049.PPV')) || fs.existsSync(path.join(d, '000_049.ppv')));
  if (!DIR) console.log('pc95-sprite-pipeline: synthetic ' + px + ' px OK; no retail NHL 95 PC sprites (NHL_PC95_DIR or pc95/), retail check skipped');
  else {
    const sheets = fs.readdirSync(DIR).filter((n) => /^\d{3}_\d{3}\.ppv$|^\d{8}\.ppv$/i.test(n)).sort();
    const studio = Pc.openSpriteBundle(Pc.encodeBundle(sheets.map((n) => ({ name: n.toUpperCase(), data: fs.readFileSync(path.join(DIR, n)) }))), 'nhl95pc');
    const home = fs.existsSync(path.join(DIR, 'HOMEPALS.BIN')) ? J.openFile(fs.readFileSync(path.join(DIR, 'HOMEPALS.BIN'))) : files.HOMEPALS;
    let frames = 0; let rpx = 0;
    for (const n of sheets.slice(0, 8)) {
      const start = Number(n.slice(0, 3)) || 0;
      const list = spitsOf(fs.readFileSync(path.join(DIR, n))) || [];
      for (const s of list.slice(0, 12)) {
        const frame = start + Number(s.tag) - (Number(list[0].tag) || 0) + 1;
        const f = studio.renderFrame(frame); if (!f || !f.width || f.tag !== s.tag) continue;
        const raw = toolRaw(s.data, tmp, 'r' + frame + '.spit');
        for (const t of [0, 2, 20, 24]) rpx += compare(f, raw, J.toAct(home, t, BASE), J.spritePalette(home, t, BASE), 'retail frame ' + (frame - 1) + ' team ' + t);
        frames++;
      }
    }
    assert.ok(frames > 20, 'retail frames compared ' + frames);
    // the crest logo the editor draws (J.CREST, 5 x 4) is exactly the block of sprite colours 192+row*16+col on the
    // jersey front: docs frame 369 (anthem) has it as one 5 x 4 block; sprites never use 197..207 etc. (no other logo)
    const anthem = studio.renderFrame(370); const used = new Set();
    for (let f = 1; f <= 1134; f++) { const r = studio.renderFrame(f); if (r && r.width) for (const p of r.pixels) if (p >= 192 && p < 251) used.add(p); }
    assert.deepStrictEqual([...used].sort((a, b) => a - b), J.CREST.map((z) => z.sprite).sort((a, b) => a - b), 'sprites use exactly the crest colours');
    const at = anthem.pixels.indexOf(192); const x0 = at % anthem.width; const y0 = (at - x0) / anthem.width;
    J.CREST.forEach((z, i) => assert.strictEqual(anthem.pixels[(y0 + Math.floor(i / 5)) * anthem.width + x0 + (i % 5)], z.sprite, 'frame 369 crest ' + z.name));
    // retail HOMEPALS/AWAYPALS give EA's shipped createPal ACT for every team, ANA home included (the fixture's ANA differs)
    for (const side of ['HOMEPALS', 'AWAYPALS']) {
      const fp = path.join(DIR, side + '.BIN'); if (!fs.existsSync(fp)) continue;
      const file = J.openFile(fs.readFileSync(fp));
      J.TEAMS['95'].forEach((t, i) => {
        const act = path.join(CREATE, side, t.code.toUpperCase() + '-01-createPal.ACT'); if (!fs.existsSync(act)) return;
        assert.ok(Buffer.from(J.toAct(file, i, BASE)).subarray(0, 768).equals(fs.readFileSync(act).subarray(0, 768)), 'retail ' + side + ' ' + t.code + ' == createPal');
      });
    }
    console.log('pc95-sprite-pipeline: synthetic ' + px + ' px, retail ' + frames + ' frames / ' + rpx + ' px from ' + DIR + ' OK');
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
