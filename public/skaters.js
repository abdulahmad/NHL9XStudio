/**
 * Skaters: the SPAskatewp animation (a skater with the puck on the stick) from several games, each in a different team's jersey,
 * skating left to right across a strip of ice, at different speeds and on different lines. Used by the loading screen and the
 * skate demo (?skatedemo).
 *
 * The art comes from public/skate-data.json (see NhlSkaters.setsFromData), so nothing needs a ROM:
 *   { version, games: [{ id, title, frames: [{ w, h, hx, hy, bx, by, ticks, px }], puck: { w, h, hx, hy, px } | null,
 *                         teams: [{ name, pal }] }] }
 * px is base64 of w*h palette indices (0 is transparent), pal is hex RGB per index, (hx, hy) is where the skater stands (the sprite's
 * origin, which every frame is drawn from so the cycle does not jump), (bx, by) the stick blade tip and the puck's (hx, hy) its
 * own origin.
 *
 *   const sets = NhlSkaters.setsFromData(data);
 *   const rink = NhlSkaters.create(canvasElement, sets, { scale: 3 });
 *   rink.start(); ... rink.stop();
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlSkaters = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  const TICK_MS = 1000 / 60;

  function decode64(text) {
    if (typeof atob === 'function') {
      const bin = atob(text);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(text, 'base64'));
  }

  function makeCanvas(w, h) {
    if (root.document) {
      const c = root.document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    return { width: w, height: h, getContext() { return null; } };
  }

  /** One indexed sprite painted with a palette (hex RGB per index, index 0 transparent) into its own canvas. */
  function paint(w, h, indices, pal) {
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const image = ctx.createImageData(w, h);
    for (let i = 0; i < indices.length; i++) {
      const v = indices[i];
      if (!v) continue;
      const o = i * 4;
      const p = v * 6;
      image.data[o] = parseInt(pal.substr(p, 2), 16);
      image.data[o + 1] = parseInt(pal.substr(p + 2, 2), 16);
      image.data[o + 2] = parseInt(pal.substr(p + 4, 2), 16);
      image.data[o + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  /**
   * Skater sets from the data file: one per game and team: { game, title, team, frames: [{ canvas, ticks, hx, hy, bx, by }],
   * puck: { canvas, hx, hy } | null, height }. `teams` limits how many teams per game (default all).
   */
  function setsFromData(data, teams) {
    const sets = [];
    for (const g of (data && data.games) || []) {
      const frameIdx = g.frames.map((f) => decode64(f.px));
      const puckIdx = g.puck ? decode64(g.puck.px) : null;
      const heights = g.frames.map((f) => f.h).sort((a, b) => a - b);
      const height = heights[Math.floor(heights.length / 2)];
      (g.teams || []).slice(0, teams || 99).forEach((t) => {
        sets.push({
          game: g.id,
          title: g.title || g.id,
          team: t.name,
          height,
          frames: g.frames.map((f, i) => ({ canvas: paint(f.w, f.h, frameIdx[i], t.pal), ticks: f.ticks, hx: f.hx, hy: f.hy, bx: f.bx, by: f.by })),
          puck: g.puck ? { canvas: paint(g.puck.w, g.puck.h, puckIdx, g.puck.solid ? '000000' + g.puck.solid : t.pal), hx: g.puck.hx, hy: g.puck.hy } : null
        });
      });
    }
    return sets;
  }

  /** Frame to show `ms` into a looping animation. */
  function frameAt(frames, ms) {
    let total = 0;
    for (const f of frames) total += (f.ticks || 6) * TICK_MS;
    let t = ms % total;
    for (const f of frames) {
      t -= (f.ticks || 6) * TICK_MS;
      if (t < 0) return f;
    }
    return frames[frames.length - 1];
  }

  /** A small dark puck with a light top edge (for a game that has no puck sprite), pixel-aligned to `px`. */
  function drawPuck(ctx, x, y, px) {
    ctx.fillStyle = '#07090b';
    ctx.fillRect(x, y, px * 4, px * 2);
    ctx.fillStyle = '#5a6670';
    ctx.fillRect(x + px, y, px * 2, px);
  }

  function rand(seed) {
    let s = seed >>> 0 || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /** Whole-number pixel scale for a set, so a big sprite (NHL 96 PC) is drawn smaller and the skaters come out about the same height. */
  function scaleFor(set, base) {
    return Math.max(1, Math.round((base * 32) / Math.max(16, set.height || 32)));
  }

  /**
   * @param canvas   target <canvas>; its CSS width is the strip's width
   * @param sets     skater sets (setsFromData); skaters are dealt from them in a shuffled order so neighbours differ
   * @param options  scale (pixels per sprite pixel for a 32 px tall skater, default 3), lanes (lines of skaters, default 3),
   *                 count (skaters, default 14), speed (sprite pixels per second at the average, default 62), puck (default true),
   *                 seed, height (CSS px of the strip; default fits the lines)
   */
  function create(canvas, sets, options) {
    const opts = Object.assign({ scale: 3, lanes: 3, count: 14, speed: 62, puck: true, seed: 7 }, options || {});
    const usable = (sets || []).filter((s) => s && s.frames && s.frames.length);
    const random = rand(opts.seed);
    let skaters = [];
    let raf = 0;
    let last = 0;
    let clock = 0;
    let width = 0;
    let height = 0;
    const tallest = usable.reduce((m, s) => Math.max(m, Math.max.apply(null, s.frames.map((f) => f.hy)) * scaleFor(s, opts.scale)), 0) || 32 * opts.scale;
    const laneGap = Math.round(tallest * 0.34);

    function layout() {
      const dpr = root.devicePixelRatio || 1;
      width = Math.max(200, canvas.clientWidth || 600);
      height = opts.height || Math.round(tallest + laneGap * (opts.lanes - 1) + 22);
      canvas.style.height = height + 'px';
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      // deal the sets in a shuffled order, spread each line evenly, with a different speed and a small y offset for every skater
      const gcd = (x, y) => (y ? gcd(y, x % y) : x);
      let stride = 5;
      while (usable.length > 1 && gcd(stride, usable.length) !== 1) stride += 2;
      const perLane = Math.max(1, Math.ceil(opts.count / opts.lanes));
      const spanW = width + 120 * opts.scale;
      const speedTiers = [0.72, 0.86, 1.0, 1.16, 1.34];
      skaters = [];
      for (let i = 0; i < opts.count && usable.length; i++) {
        const lane = i % opts.lanes;
        const slot = Math.floor(i / opts.lanes);
        const set = usable[(i * stride) % usable.length];
        skaters.push({
          set,
          scale: scaleFor(set, opts.scale),
          lane,
          yOff: Math.round((random() - 0.5) * laneGap * 0.7),
          x: (spanW * slot) / perLane + (lane % 2 ? spanW / (2 * perLane) : (lane ? spanW / (3 * perLane) : 0)) - 60 * opts.scale + random() * 20,
          speed: opts.speed * speedTiers[(i * 3 + lane) % speedTiers.length] * (0.94 + random() * 0.12),
          phase: random() * 900
        });
      }
      // draw the lines back to front: the higher on the screen, the further away
      skaters.sort((a, b) => a.lane - b.lane || a.yOff - b.yOff);
    }

    function ice(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, height);
      g.addColorStop(0, '#dcecf3');
      g.addColorStop(1, '#bcd4e0');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(80, 120, 150, 0.12)';
      for (let i = 0; i < 26; i++) ctx.fillRect(Math.round((i * 97) % width), 6 + ((i * 41) % Math.max(1, height - 12)), 40 + ((i * 13) % 60), 1);
      ctx.fillStyle = 'rgba(214, 48, 38, 0.8)';
      ctx.fillRect(Math.round(width / 2) - 2, 0, 4, height);
      ctx.fillStyle = 'rgba(40, 90, 200, 0.55)';
      ctx.fillRect(Math.round(width * 0.24), 0, 4, height);
      ctx.fillRect(Math.round(width * 0.76) - 4, 0, 4, height);
    }

    function draw(dt) {
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ice(ctx);
      for (const sk of skaters) {
        sk.x += (sk.speed * opts.scale * dt) / 1000;
        if (sk.x > width + 60 * opts.scale) sk.x = -60 * opts.scale;
        const f = frameAt(sk.set.frames, clock + sk.phase);
        const s = sk.scale;
        // the skater's feet are at (ax, ay); every frame is drawn from its own origin (hx, hy), so the cycle stays put
        const ax = Math.round(sk.x / s) * s;
        const ay = Math.round(tallest + 10 + sk.lane * laneGap + sk.yOff);
        ctx.drawImage(f.canvas, ax - f.hx * s, ay - f.hy * s, f.canvas.width * s, f.canvas.height * s);
        if (opts.puck && f.bx != null && f.bx >= 0) {
          const px = ax + (f.bx - f.hx + 1) * s;
          const py = ay + (f.by - f.hy) * s;
          const pk = sk.set.puck;
          if (pk) ctx.drawImage(pk.canvas, px - pk.hx * s + s, py - pk.hy * s, pk.canvas.width * s, pk.canvas.height * s);
          else drawPuck(ctx, px, py - s, s);
        }
      }
    }

    function tick(now) {
      raf = root.requestAnimationFrame(tick);
      const dt = last ? Math.min(100, now - last) : 16;
      last = now;
      clock += dt;
      draw(dt);
    }

    layout();
    draw(0);
    return {
      start() { if (!raf) { last = 0; raf = root.requestAnimationFrame(tick); } },
      stop() { if (raf) { root.cancelAnimationFrame(raf); raf = 0; } },
      resize() { layout(); draw(0); },
      skaters() { return skaters.map((s) => ({ game: s.set.game, team: s.set.team, speed: Math.round(s.speed), lane: s.lane, yOff: s.yOff, scale: s.scale })); }
    };
  }

  return { create, frameAt, setsFromData, scaleFor, decode64 };
});
