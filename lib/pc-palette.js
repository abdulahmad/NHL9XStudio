/**
 * Palette allocation for imports into NHL 95 PC team colours (centre ice images, scoreboard crests).
 * A team has 64 colours (6-bit VGA) = game palette 128..191 (home). Options pick which game colours an import may
 * use and which team slots it may rewrite:
 *   team       may use team slots (128..191)
 *   rink       may also use the fixed rink colours it is given (never rewritten)
 *   overwrite  rewrite the team palette freely: current team colours are not kept or matched
 *   protect    { jersey, crest, tiles }: never rewrite slots those use (they can still be matched)
 *   freeOnly   rewrite only slots that nothing uses (= all three protections)
 *   maxColors  cap on distinct game colours in the result (crest: 24 sprite colours)
 * Image colours that exactly match a usable existing colour reuse it; the rest are clustered (weighted k-means in
 * 6-bit RGB) into the writable slots. Returns { colors (new 64 x [r,g,b] 6-bit), indexOf(r8,g8,b8) -> game index,
 * written: slots rewritten, writable, free }.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlPcPalette = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const BASE = 128, SLOTS = 64;
  const to6 = (v) => Math.max(0, Math.min(63, Math.round(v / 4)));
  const to8 = (v) => Math.min(255, v * 4);
  const dist = (a, b) => { const r = a[0] - b[0], g = a[1] - b[1], bl = a[2] - b[2]; return 2 * r * r + 4 * g * g + 3 * bl * bl; };

  /** Conflicts between options: returns { key: reason } for options that must be off given the others. */
  function conflicts(o) {
    const out = {};
    if (o.overwrite) { out.freeOnly = 'Overwriting the whole team palette ignores which slots are in use'; out.jersey = out.crest = out.tiles = out.freeOnly; }
    if (o.freeOnly) { out.overwrite = '"Only free slots" keeps every used slot'; }
    if (!o.team) { out.overwrite = out.freeOnly = out.jersey = out.crest = out.tiles = 'Team slots are off: no team colour is rewritten'; }
    return out;
  }
  function slotSets(o, used) {
    const prot = new Set();
    const add = (s) => s && s.forEach((x) => prot.add(x));
    const all = new Set(); [used.jersey, used.crest, used.tiles].forEach((s) => s && s.forEach((x) => all.add(x)));
    if (o.freeOnly) add(all); else if (!o.overwrite) { if (o.jersey) add(used.jersey); if (o.crest) add(used.crest); if (o.tiles) add(used.tiles); }
    const writable = []; const free = [];
    for (let s = 0; s < SLOTS; s++) { if (!all.has(s)) free.push(s); if (o.team && !prot.has(s) && !(o.exclude && o.exclude.has(s))) writable.push(s); }
    // write free slots first so used ones are only taken when needed
    writable.sort((a, b) => (all.has(a) - all.has(b)) || a - b);
    return { writable, free, protectedSlots: prot };
  }
  /** pixels: RGBA bytes. colors: current team colours (64 x 6-bit). rink: [{ index, rgb6 }] fixed colours. */
  function allocate(rgba, colors, rink, o, used) {
    const { writable, free } = slotSets(o, used || {});
    const counts = new Map();
    for (let p = 0; p < rgba.length; p += 4) {
      if (rgba[p + 3] < 128) continue;
      const k = (to6(rgba[p]) << 12) | (to6(rgba[p + 1]) << 6) | to6(rgba[p + 2]);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const cols = [...counts].map(([k, n]) => ({ c: [k >> 12, (k >> 6) & 63, k & 63], n })).sort((a, b) => b.n - a.n);
    const ws = new Set(writable);
    const fixed = [];
    if (o.rink) for (const r of rink || []) fixed.push({ index: r.index, c: r.rgb6 });
    if (o.team && !o.overwrite) for (let s = 0; s < SLOTS; s++) if (!ws.has(s)) fixed.push({ index: BASE + s, c: colors[s] });
    if (!o.overwrite) for (const s of writable) fixed.push({ index: BASE + s, c: colors[s], soft: true }); // reuse if exact
    const tol = o.tolerance == null ? 36 : o.tolerance; // within ~2 steps of 6-bit: reuse instead of a new slot
    const exact = (c) => { let b = null, d0 = Infinity; for (const f of fixed) { const d = dist(f.c, c); if (d <= tol && d < d0) { d0 = d; b = f; } } return b; };
    const next = colors.map((c) => c.slice());
    const rest = cols.filter((x) => !exact(x.c));
    // slots still writable (not reused exactly)
    const reused = new Set(cols.map((x) => exact(x.c)).filter((f) => f && f.soft).map((f) => f.index - BASE));
    const open = writable.filter((s) => !reused.has(s));
    let k = Math.min(open.length, rest.length);
    if (o.maxColors) {
      const already = new Set(cols.map((x) => exact(x.c)).filter(Boolean).map((f) => f.index)).size;
      k = Math.max(0, Math.min(k, o.maxColors - already));
    }
    const centres = kmeans(rest, k);
    const written = [];
    centres.forEach((c, i) => { next[open[i]] = c; written.push(open[i]); });
    const cands = fixed.filter((f) => !(f.soft && !reused.has(f.index - BASE))).concat(written.map((s) => ({ index: BASE + s, c: next[s] })));
    const cache = new Map();
    const indexOf = (r, g, b) => {
      const c = [to6(r), to6(g), to6(b)]; const key = (c[0] << 12) | (c[1] << 6) | c[2];
      let v = cache.get(key); if (v !== undefined) return v;
      let best = -1, d0 = Infinity; for (const f of cands) { const d = dist(f.c, c); if (d < d0) { d0 = d; best = f.index; } }
      cache.set(key, best); return best;
    };
    if (!cands.length) throw new Error('No colours to import into: turn on team slots or rink colours, or free some slots');
    return { colors: next, indexOf, written: written.sort((a, b) => a - b), writable, free };
  }
  function kmeans(list, k) {
    if (k <= 0 || !list.length) return [];
    if (list.length <= k) return list.map((x) => x.c.slice());
    let cs = list.slice(0, k).map((x) => x.c.slice());
    for (let it = 0; it < 12; it++) {
      const sum = cs.map(() => [0, 0, 0, 0]);
      for (const x of list) { let b = 0, d0 = Infinity; cs.forEach((c, i) => { const d = dist(c, x.c); if (d < d0) { d0 = d; b = i; } }); const s = sum[b]; s[0] += x.c[0] * x.n; s[1] += x.c[1] * x.n; s[2] += x.c[2] * x.n; s[3] += x.n; }
      cs = cs.map((c, i) => (sum[i][3] ? sum[i].slice(0, 3).map((v) => Math.round(v / sum[i][3])) : c));
    }
    return cs;
  }
  /** Quantize RGBA to game indices with an allocation (alpha < 128 -> 255). */
  function indexImage(rgba, alloc) {
    const out = new Uint8Array(rgba.length / 4);
    for (let p = 0, i = 0; p < rgba.length; p += 4, i++) out[i] = rgba[p + 3] < 128 ? 255 : alloc.indexOf(rgba[p], rgba[p + 1], rgba[p + 2]);
    return out;
  }
  return { BASE, SLOTS, to6, to8, conflicts, slotSets, allocate, indexImage, kmeans };
}));
