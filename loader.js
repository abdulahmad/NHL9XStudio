/**
 * The "loading games" screen: skaters carrying the puck across NHL 92 ice (each game's own skating animation, public/skaters-data.js), what is being loaded and a list of the games with their state. Shown while Studio
 * starts (looking for your games, then loading the first one) and while a folder, ROM or disc image is read.
 *
 *   const run = NhlLoader.start('Opening folder', 'nhl94-files');   // returns a handle
 *   run.games([{id, title, state: 'found' | 'missing' | 'loading' | 'done'}]);
 *   run.detail('Loading NHL 94…');
 *   run.done();
 *
 * It appears at once and stays up for 3 seconds after loading finishes, so you can see what loaded and what was not found (click it to close sooner).
 */
(function (root) {
  const SHOW_AFTER = 0;
  const HOLD_AFTER_DONE = 3000;   // stays up this long once everything is loaded, to read what loaded and what was not found
  let overlay = null;
  let active = 0;
  let stopAnim = null;
  let current = null;   // the last run to finish, still showing for its 3 seconds

  function build() {
    const box = document.createElement('div');
    box.className = 'loader';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.hidden = true;
    box.addEventListener('click', () => { if (current && current.dismiss) current.dismiss(); });
    box.innerHTML = '<div class="loader-card">' +
      '<div class="loader-rink" aria-hidden="true"><canvas class="loader-lane"></canvas></div>' +
      '<h2 class="loader-title"></h2><p class="loader-detail"></p><div class="loader-pills"></div></div>';
    document.body.appendChild(box);
    return box;
  }

  // Which skater art each game uses (the Sega CD disc shares NHL 94's player sheet).
  const ART = { nhl92: 'NHL 92', nhlpa93: 'NHLPA 93', nhl94: 'NHL 94', nhl94cd: 'NHL 94', nhl95: 'NHL 95', nhl96: 'NHL 96', nhl94snes: 'NHL 94 SNES', nhl94pc: 'NHL 94 PC', nhl95pc: 'NHL 95 PC', nhl96pc: 'NHL 96 PC' };
  const rnd = (a, b) => a + Math.random() * (b - a);
  let skaterSet = null;

  function skaterGames() {
    if (skaterSet) return skaterSet;
    skaterSet = {};
    const data = root.NhlSkaterData || [];
    const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const mk = (f) => ({ w: f.w, h: f.h, hx: f.hx, hy: f.hy, px: bytes(f.px), pal: f.pal });
    for (const g of data) {
      const frames = g.frames.map(mk);
      const puck = mk(g.puck);
      // The stick blade tip (right-most low pixel) relative to the hot spot, averaged over the cycle. The puck's own hot spot (bottom centre, where it meets the ice) goes there.
      let tx = 0;
      let ty = 0;
      for (const f of frames) {
        let rx = 0;
        let ry = 0;
        for (let y = Math.floor(f.h * 0.4); y < f.h; y++) for (let x = 0; x < f.w; x++) if (f.px[y * f.w + x] && x >= rx) { rx = x; ry = y; }
        tx += rx - f.hx;
        ty += ry - f.hy;
      }
      skaterSet[g.id] = { g, frames, puck, tx: tx / frames.length, ty: ty / frames.length, scale: g.scale || 2, cache: new Map() };
    }
    return skaterSet;
  }

  function tint(art, team, f, key) {
    let c = art.cache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = f.w;
    c.height = f.h;
    const x = c.getContext('2d');
    const im = x.createImageData(f.w, f.h);
    let pal;
    if (f.pal) pal = f.pal;
    else if (team.pal) pal = team.pal;
    else { pal = art.g.base.slice(); for (let i = 0; i < 16; i++) pal[art.g.row * 16 + i] = team.c[i]; }
    for (let i = 0; i < f.px.length; i++) {
      const p = f.px[i];
      if (!p) continue;
      const col = pal[p] || [255, 0, 255];
      im.data.set([col[0], col[1], col[2], 255], i * 4);
    }
    x.putImageData(im, 0, 0);
    art.cache.set(key, c);
    return c;
  }

  // Animates the skaters in the card until stop() is called. found() returns the ids of the games whose files were found.
  function animate(canvas, found) {
    const ctx = canvas.getContext('2d');
    let skaters = [];
    let W = 0;
    let H = 0;
    let last = 0;
    let raf = 0;
    let key = '';
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const arts = () => found().map((id) => skaterGames()[ART[id]]).filter(Boolean).filter((a, i, l) => l.indexOf(a) === i);
    const reset = (s, x) => { s.x = x; s.y = Math.random(); s.v = rnd(136, 320); s.team = s.art.g.teams[Math.random() * s.art.g.teams.length | 0]; s.t = 0; s.k = 0; };
    const layout = () => {
      const r = canvas.getBoundingClientRect();
      W = Math.max(200, r.width);
      H = r.height;
      canvas.width = W;
      canvas.height = H;
      ctx.imageSmoothingEnabled = false;
      const list = arts();
      key = list.map((a) => a.g.id).join('|');
      skaters = [];
      if (!list.length) return;
      const n = Math.max(list.length, Math.round(W / 113));
      for (let i = 0; i < n; i++) { const s = { art: list[i % list.length] }; reset(s, rnd(-80, W)); skaters.push(s); }
    };
    const frame = (ts) => {
      const dt = Math.min(50, ts - last || 16);
      last = ts;
      if (arts().map((a) => a.g.id).join('|') !== key || !W) layout();
      ctx.clearRect(0, 0, W, H);
      const ground0 = H - 26;
      const span = H - 78;
      skaters.sort((a, b) => b.y - a.y);   // higher on screen first, so the lower skaters draw in front
      for (const s of skaters) {
        const art = s.art;
        s.x += dt / 1000 * s.v;
        s.t += dt / 16.667;   // the games' own ticks, 60 a second
        const ticks = art.g.ticks;
        while (s.t >= ticks[s.k] + 1) { s.t -= ticks[s.k] + 1; s.k = (s.k + 1) % art.frames.length; }
        if (s.x > W + 90) {
          const list = arts();
          s.art = list[(list.indexOf(art) + 1 + Math.floor(rnd(0, 2)) + list.length) % list.length] || art;
          reset(s, -100);
        }
        const f = s.art.frames[s.k];
        const SC = s.art.scale;
        const ay = Math.round(ground0 - s.y * span);
        const ax = Math.round(s.x);
        ctx.fillStyle = 'rgba(0,0,0,.10)';
        ctx.beginPath();
        ctx.ellipse(ax, ay + 3, 6 * SC, 1.5 * SC + 1, 0, 0, 7);
        ctx.fill();
        ctx.drawImage(tint(s.art, s.team, f, s.team.name + '|' + s.k), ax - f.hx * SC, ay - f.hy * SC, f.w * SC, f.h * SC);
        const p = s.art.puck;
        ctx.drawImage(tint(s.art, s.team, p, 'puck'), Math.round(ax + (s.art.tx - p.hx) * SC), Math.round(ay + (s.art.ty - p.hy) * SC), p.w * SC, p.h * SC);
      }
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }

  function start(title, detail) {
    if (!overlay) overlay = build();
    const box = overlay;
    const run = { heading: title || 'Loading games', text: detail || '', list: [], shownAt: 0, ended: false, timer: 0, id: ++active };
    const paint = () => {
      box.querySelector('.loader-title').textContent = run.heading;
      box.querySelector('.loader-detail').textContent = run.text;
      const pills = box.querySelector('.loader-pills');
      pills.replaceChildren();
      for (const g of run.list) {
        const pill = document.createElement('span');
        pill.className = 'loader-pill';
        pill.dataset.state = g.state || 'found';
        pill.textContent = g.title;
        pill.title = { found: 'Found', missing: 'Not found', loading: 'Loading…', done: 'Loaded' }[g.state] || '';
        pills.appendChild(pill);
      }
      pills.hidden = !run.list.length;
    };
    const show = () => {
      if (run.ended || active !== run.id) return;
      run.shownAt = Date.now();
      paint();
      box.hidden = false;
      document.body.setAttribute('aria-busy', 'true');
      if (stopAnim) stopAnim();
      stopAnim = animate(box.querySelector('.loader-lane'), () => run.list.filter((g) => g.state !== 'missing').map((g) => g.id));
    };
    run.timer = setTimeout(show, SHOW_AFTER);
    const repaint = () => { if (run.shownAt && !run.ended && active === run.id) paint(); };
    run.detail = function (text) { run.text = text; repaint(); };
    run.games = function (list) { run.list = list; repaint(); };
    run.mark = function (id, state) {
      const g = run.list.find((x) => x.id === id);
      if (g) { g.state = state; repaint(); }
    };
    run.done = function () {
      if (run.ended) return;
      run.ended = true;
      clearTimeout(run.timer);
      const hide = () => {
        if (active === run.id) { box.hidden = true; document.body.removeAttribute('aria-busy'); if (stopAnim) { stopAnim(); stopAnim = null; } }
      };
      run.dismiss = () => { clearTimeout(run.hideTimer); hide(); };
      current = run;
      if (!run.shownAt) { hide(); return; }
      run.hideTimer = setTimeout(hide, HOLD_AFTER_DONE);
    };
    return run;
  }

  root.NhlLoader = { start };
})(typeof self !== 'undefined' ? self : this);
