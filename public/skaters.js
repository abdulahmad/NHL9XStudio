/**
 * Skaters: the SPAskatewp animation (a skater with the puck on the stick) from several games, each in a different team's jersey,
 * skating left to right across a strip of ice. Used by the skate demo page and the loading screen.
 *
 *   const sets = [{ game: 'nhl94', team: 'canucksh.pal', frames: [{ canvas, ticks, hx, hy }] }];   // frames face east
 *   const rink = NhlSkaters.create(canvasElement, sets, { scale: 3 });
 *   rink.start(); ... rink.stop();
 *
 * `canvas` is one frame at its own pixel size, `ticks` how long it shows (60 per second), (hx, hy) where the puck sits on the stick.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlSkaters = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  const TICK_MS = 1000 / 60;

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

  /** A small black puck with a light top edge, drawn pixel-aligned (`px` = one sprite pixel). */
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

  /**
   * @param canvas   target <canvas>; its CSS width is the strip's width
   * @param sets     skater sets (see top of file); skaters are dealt from them in order, so each game's players mix along the strip
   * @param options  scale (pixels per sprite pixel, default 3), lanes (rows of skaters, default 2), count (skaters, default 12),
   *                 speed (sprite pixels per second, default 70), puck (draw the puck on the stick, default true), seed
   */
  function create(canvas, sets, options) {
    const opts = Object.assign({ scale: 3, lanes: 2, count: 12, speed: 70, puck: true, seed: 7 }, options || {});
    const usable = (sets || []).filter((s) => s && s.frames && s.frames.length);
    const random = rand(opts.seed);
    let skaters = [];
    let raf = 0;
    let last = 0;
    let clock = 0;
    let width = 0;
    let height = 0;

    function layout() {
      const dpr = root.devicePixelRatio || 1;
      width = Math.max(200, canvas.clientWidth || 600);
      const frame0 = usable.length ? usable[0].frames[0].canvas : { height: 32, width: 32 };
      const lane = frame0.height * opts.scale * 0.78;
      height = Math.round(lane * (opts.lanes - 1) + frame0.height * opts.scale + 18);
      canvas.style.height = height + 'px';
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      // deal the skaters: sets in a shuffled order (neighbours come from different games), evenly spread along each lane
      const spanW = width + frame0.width * opts.scale * 2;
      const gcd = (x, y) => (y ? gcd(y, x % y) : x);
      let stride = 5;
      while (usable.length > 1 && gcd(stride, usable.length) !== 1) stride += 2;
      const perLane = Math.max(1, Math.ceil(opts.count / opts.lanes));
      skaters = [];
      for (let i = 0; i < opts.count && usable.length; i++) {
        const laneIndex = i % opts.lanes;
        const slot = Math.floor(i / opts.lanes);
        const set = usable[(i * stride) % usable.length];
        skaters.push({
          set,
          lane: laneIndex,
          x: (spanW * slot) / perLane + (laneIndex % 2 ? spanW / (2 * perLane) : 0) - frame0.width * opts.scale + random() * 12,
          speed: opts.speed * (0.9 + random() * 0.2),
          phase: random() * 600
        });
      }
      skaters.sort((a, b) => a.lane - b.lane);
    }

    function ice(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, height);
      g.addColorStop(0, '#dcecf3');
      g.addColorStop(1, '#bcd4e0');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      // faint skate scratches, a red centre line and blue lines
      ctx.fillStyle = 'rgba(80, 120, 150, 0.12)';
      for (let i = 0; i < 26; i++) ctx.fillRect(Math.round(((i * 97) % width)), 6 + ((i * 41) % Math.max(1, height - 12)), 40 + ((i * 13) % 60), 1);
      ctx.fillStyle = 'rgba(214, 48, 38, 0.8)';
      ctx.fillRect(Math.round(width / 2) - 2, 0, 4, height);
      ctx.fillStyle = 'rgba(40, 90, 200, 0.55)';
      ctx.fillRect(Math.round(width * 0.24), 0, 4, height);
      ctx.fillRect(Math.round(width * 0.76) - 4, 0, 4, height);
    }

    function paint(dt) {
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ice(ctx);
      const frame0 = usable.length ? usable[0].frames[0].canvas : { height: 32, width: 32 };
      const lane = frame0.height * opts.scale * 0.78;
      for (const sk of skaters) {
        sk.x += (sk.speed * opts.scale * dt) / 1000;
        if (sk.x > width + 8) sk.x = -frame0.width * opts.scale - 8;
        const f = frameAt(sk.set.frames, clock + sk.phase);
        const w = f.canvas.width * opts.scale;
        const h = f.canvas.height * opts.scale;
        const x = Math.round(sk.x / opts.scale) * opts.scale;
        const y = Math.round(sk.lane * lane + 6);
        // shadow on the ice
        ctx.fillStyle = 'rgba(30, 60, 90, 0.16)';
        ctx.fillRect(x + w * 0.18, y + h - opts.scale * 4, w * 0.62, opts.scale * 2);
        ctx.drawImage(f.canvas, x, y, w, h);
        if (opts.puck && f.hx != null) drawPuck(ctx, x + f.hx * opts.scale - opts.scale * 2, y + f.hy * opts.scale - opts.scale, opts.scale);
      }
    }

    function tick(now) {
      raf = root.requestAnimationFrame(tick);
      const dt = last ? Math.min(100, now - last) : 16;
      last = now;
      clock += dt;
      paint(dt);
    }

    layout();
    paint(0);
    return {
      start() { if (!raf) { last = 0; raf = root.requestAnimationFrame(tick); } },
      stop() { if (raf) { root.cancelAnimationFrame(raf); raf = 0; } },
      resize() { layout(); paint(0); },
      skaters() { return skaters.map((s) => ({ game: s.set.game, team: s.set.team })); }
    };
  }

  return { create, frameAt };
});
