/**
 * NHL '92 <-> General MIDI mapping (data/audio/nhl92-gm-map.json): the file is valid and parses
 * the same every time, every patch / GM program / GM drum note 35-81 is mapped once, every target
 * exists, and the generated doc tables, the stored patch analysis and the GM reference sounds
 * and audition planner all hold up. See docs/NHL92-GM-MAP.md.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const G = require('../lib/audio/nhl92-gm-map');
const Z = require('../lib/audio/nhl92-z80-audio');
const fixture = require('../lib/audio/nhl92-sound-fixture');
const analysisLib = require('../lib/audio/nhl92-patch-analysis');
const docLib = require('../lib/audio/nhl92-gm-map-doc');
const Ref = require('../lib/audio/gm-reference');
const Aud = require('../lib/audio/nhl92-gm-audition');
const renders = require('../lib/audio/nhl92-chip-renders');

const ROOT = path.join(__dirname, '..');
const MAP_FILE = path.join(ROOT, 'data', 'audio', 'nhl92-gm-map.json');
const ANALYSIS_FILE = path.join(ROOT, 'data', 'audio', 'nhl92-patch-analysis.json');
const DOC_FILE = path.join(ROOT, 'docs', 'NHL92-GM-MAP.md');

const rawMap = fs.readFileSync(MAP_FILE, 'utf8');
const map = JSON.parse(rawMap);
const rom = fixture.resolveRom(null);

// SFX IDs whose handler starts one of the known DAC samples.
const dacSfxIds = [];
for (let id = 0; id < G.SFX_COUNT; id++) {
  const h = G.sfxHandler(rom, id);
  if (Z.DAC_SFX.some((e) => e.rom === h)) dacSfxIds.push(id);
}

(async () => {
  // Valid JSON, parsed the same on every run.
  {
    assert.deepStrictEqual(JSON.parse(rawMap), JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')));
    assert.strictEqual(JSON.stringify(JSON.parse(rawMap)), JSON.stringify(JSON.parse(rawMap)));
    assert.deepStrictEqual(dacSfxIds, [3, 4, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 31], 'DAC SFX ids');
    assert.deepStrictEqual(G.validate(map, { dacSfxIds }), []);
    console.log('nhl92 gm map: JSON parses identically and validates (' + dacSfxIds.length + ' DAC SFX ids) OK');
  }

  // Coverage: 22 patches, 128 programs, drums 35-81.
  {
    assert.deepStrictEqual(map.nhl92ToGm.patches.map((e) => e.patch), Array.from({ length: 22 }, (_, i) => i));
    assert.strictEqual(map.gmToNhl92.families.length, 16);
    for (let p = 0; p < 128; p++) {
      const r = G.resolveProgram(map, p);
      assert.ok(r && r.target && r.runnerUp && r.reason, 'program ' + p + ' resolves with reason and runner-up');
      assert.strictEqual(r.name, G.programName(p));
      const own = map.gmToNhl92.overrides.find((o) => o.program === p);
      assert.strictEqual(r.source, own ? 'override' : 'family', 'program ' + p + ' source');
      if (own) assert.ok(!G.sameTarget(own.target, map.gmToNhl92.families.find((f) => f.family === G.familyOf(p).id).target), 'override ' + p + ' differs from family default');
    }
    assert.deepStrictEqual(map.gmToNhl92.drums.map((d) => d.note), Array.from({ length: 47 }, (_, i) => 35 + i));
    for (let n = 35; n <= 81; n++) assert.ok(G.resolveDrum(map, n).fit, 'drum ' + n);
    map.nhl92ToGm.patches.forEach((e) => assert.ok(!G.sameTarget(e.target, e.runnerUp), 'patch ' + e.patch + ' runner-up differs'));
    console.log('nhl92 gm map: 22 patches, 128 programs (' + map.gmToNhl92.overrides.length + ' overrides over 16 family defaults), drums 35-81 all mapped OK');
  }

  // A broken copy is caught.
  {
    const bad = JSON.parse(rawMap);
    bad.nhl92ToGm.patches[0].target = { kind: 'program', program: 128, name: 'x' };
    assert.ok(G.validate(bad, { dacSfxIds }).length > 0);
    const bad2 = JSON.parse(rawMap);
    bad2.gmToNhl92.drums.pop();
    assert.ok(G.validate(bad2, { dacSfxIds }).length > 0);
    const bad3 = JSON.parse(rawMap);
    bad3.gmToNhl92.overrides.push({ program: 126, target: { kind: 'dac', sfx: 99, label: 'x' }, reason: 'x', runnerUp: { kind: 'patch', patch: 1 }, confidence: 'low' });
    assert.ok(G.validate(bad3, { dacSfxIds }).length > 0);
    console.log('nhl92 gm map: validate() rejects a bad program, a missing drum and an unknown DAC SFX OK');
  }

  // Generated artefacts are current.
  {
    const analysis = JSON.parse(fs.readFileSync(ANALYSIS_FILE, 'utf8'));
    const doc = fs.readFileSync(DOC_FILE, 'utf8');
    assert.strictEqual(docLib.apply(doc, docLib.sections(map, analysis)), doc, 'docs/NHL92-GM-MAP.md is current (node tools/build-nhl92-gm-map-doc.js)');
    const fresh = await analysisLib.build();
    assert.deepStrictEqual(analysisLib.compare(analysis, fresh), [], 'nhl92-patch-analysis.json is current');
    console.log('nhl92 gm map: doc tables and patch analysis are current OK');
  }

  // GM reference sounds: finite, audible, deterministic.
  {
    const hold = { hold: 0.12, gap: 0.03, tail: 0.1 };
    for (let p = 0; p < 128; p++) {
      const b = Ref.renderProgram(p, [60], hold);
      let peak = 0;
      for (const v of b) { assert.ok(Number.isFinite(v), 'program ' + p + ' finite'); peak = Math.max(peak, Math.abs(v)); }
      assert.ok(peak > 0.05, 'program ' + p + ' is not silent');
    }
    for (let n = 35; n <= 81; n++) {
      const b = Ref.renderDrum(n, { hits: 1 });
      let peak = 0;
      for (const v of b) { assert.ok(Number.isFinite(v), 'drum ' + n + ' finite'); peak = Math.max(peak, Math.abs(v)); }
      assert.ok(peak > 0.05, 'drum ' + n + ' is not silent');
    }
    for (const p of [0, 40, 80, 126]) assert.deepStrictEqual(Ref.renderProgram(p, [60], hold), Ref.renderProgram(p, [60], hold));
    assert.deepStrictEqual(Ref.renderDrum(38, { hits: 1 }), Ref.renderDrum(38, { hits: 1 }));
    console.log('nhl92 gm map: all 128 GM reference programs and 47 drums are finite and audible, and repeat exactly OK');
  }

  // Audition planner: every pick plans, every target is renderable.
  {
    const src = renders.sources();
    const env = { rom: src.rom, renderScript: async (s) => (await renders.render(s, src)).pcm };
    const peakOf = (b) => { let m = 0; for (const v of b) { assert.ok(Number.isFinite(v)); m = Math.max(m, Math.abs(v)); } return m; };
    for (const dir of Aud.DIRECTIONS) {
      const list = Aud.picks(map, dir);
      assert.strictEqual(list.length, dir === 'n2g' ? 22 : dir === 'g2n' ? 128 : 47);
      for (const p of list) for (const ru of [false, true]) {
        const pl = Aud.plan(map, dir, p.value, ru);
        assert.ok(pl.picked && pl.mapped && pl.info.reason, dir + ' ' + p.value + ' plans');
      }
    }
    // Render the distinct NHL '92 sides (patch+style+pitch, DAC) once each, and one GM side per kind.
    const seen = new Set();
    let rendered = 0;
    for (const dir of Aud.DIRECTIONS) {
      for (const p of Aud.picks(map, dir)) for (const ru of [false, true]) {
        const pl = Aud.plan(map, dir, p.value, ru);
        for (const side of [pl.picked, pl.mapped]) {
          if (side.kind === 'program' || side.kind === 'drum') continue;
          const key = JSON.stringify(side);
          if (seen.has(key)) continue;
          seen.add(key);
          assert.ok(peakOf(await Aud.renderSide(side, env)) > 0.1, key + ' is audible');
          rendered += 1;
        }
      }
    }
    const joined = Aud.join(new Float32Array(10), new Float32Array(5), 0.001, 1000);
    assert.strictEqual(joined.length, 16);
    assert.throws(() => Aud.plan(map, 'n2g', 22), RangeError);
    assert.throws(() => Aud.plan(map, 'drum', 34), RangeError);
    console.log('nhl92 gm map: audition planner covers every pick; ' + rendered + ' distinct NHL 92 sides render audibly OK');
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
