/**
 * The "loading games" screen: skaters from the games crossing the ice (public/skaters.js and skate-data.json, so no ROM is needed; a
 * sliding puck if those cannot load), the game being loaded now, and a list of the games with their state. Shown while Studio
 * starts (looking for your games, then loading the first one) and while a folder, ROM or disc image is read.
 *
 *   const run = NhlLoader.start('Opening folder', 'nhl94-files');   // returns a handle
 *   run.games([{id, title, state: 'found' | 'missing' | 'loading' | 'done'}]);
 *   run.detail('Loading NHL 94…');
 *   run.done();
 *
 * It waits a moment before appearing (a fast load shows nothing) and then stays long enough to read.
 */
(function (root) {
  const SHOW_AFTER = 180;
  const SHOW_AT_LEAST = 450;
  let overlay = null;
  let active = 0;
  let skateSets = null;      // loaded once, from skate-data.json
  let skateRink = null;

  function build() {
    const box = document.createElement('div');
    box.className = 'loader';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.hidden = true;
    box.innerHTML = '<div class="loader-card">' +
      '<div class="loader-rink" aria-hidden="true"><span class="loader-puck"></span><span class="loader-trail"></span><canvas class="loader-skaters"></canvas></div>' +
      '<h2 class="loader-title"></h2><p class="loader-now" hidden></p><p class="loader-detail"></p><ul class="loader-games"></ul></div>';
    document.body.appendChild(box);
    return box;
  }

  /** Skaters on the loading screen, once their art has been read; until then (or without it) the puck slides. */
  function skate(box) {
    if (typeof NhlSkaters === 'undefined' || typeof fetch !== 'function') return;
    const rink = box.querySelector('.loader-rink');
    const begin = () => {
      if (!skateSets || skateSets.length === 0 || box.hidden) return;
      const canvas = box.querySelector('.loader-skaters');
      rink.classList.add('has-skaters');
      if (skateRink) skateRink.stop();
      skateRink = NhlSkaters.create(canvas, skateSets, { scale: 2, lanes: 3, count: 9, speed: 130, seed: 11 });
      if (!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches)) skateRink.start();
    };
    if (skateSets) { begin(); return; }
    if (skateSets === false) return;
    skateSets = false;
    fetch('skate-data.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => { skateSets = NhlSkaters.setsFromData(data, 4); begin(); })
      .catch(() => { skateSets = false; });
  }

  const STATES = { found: 'found on disk', missing: 'not found', loading: 'loading…', done: 'loaded' };

  function start(title, detail) {
    if (!overlay) overlay = build();
    const box = overlay;
    const run = { heading: title || 'Loading games', text: detail || '', list: [], shownAt: 0, ended: false, timer: 0, id: ++active };
    const paint = () => {
      box.querySelector('.loader-title').textContent = run.heading;
      box.querySelector('.loader-detail').textContent = run.text;
      const ul = box.querySelector('.loader-games');
      ul.replaceChildren();
      for (const g of run.list) {
        const li = document.createElement('li');
        li.dataset.state = g.state || 'found';
        const name = document.createElement('span');
        name.textContent = g.title;
        const state = document.createElement('em');
        state.textContent = STATES[g.state] || '';
        li.append(name, state);
        ul.appendChild(li);
      }
      ul.hidden = !run.list.length;
      const now = run.list.find((g) => g.state === 'loading');
      const nowEl = box.querySelector('.loader-now');
      nowEl.hidden = !now;
      nowEl.replaceChildren();
      if (now) {
        const label = document.createElement('span');
        label.textContent = 'Now loading';
        const name = document.createElement('b');
        name.textContent = now.title;
        nowEl.append(label, name);
      }
    };
    const show = () => {
      if (run.ended || active !== run.id) return;
      run.shownAt = Date.now();
      paint();
      box.hidden = false;
      document.body.setAttribute('aria-busy', 'true');
      skate(box);
    };
    run.timer = setTimeout(show, SHOW_AFTER);
    const repaint = () => { if (run.shownAt && !run.ended && active === run.id) paint(); };
    run.detail = function (text) { run.text = text; repaint(); };
    run.games = function (list) { run.list = list; repaint(); };
    // the game being loaded now: it is 'loading', the one before it is 'done'
    run.loading = function (id) {
      for (const g of run.list) if (g.state === 'loading' && g.id !== id) g.state = 'done';
      const g = run.list.find((x) => x.id === id);
      if (g) g.state = 'loading';
      repaint();
    };
    // a new list from the same run: games already loaded stay 'done'
    run.refresh = function (list) {
      const done = new Set(run.list.filter((g) => g.state === 'done' || g.state === 'loading').map((g) => g.id));
      run.list = list.map((g) => (done.has(g.id) ? Object.assign({}, g, { state: 'done' }) : g));
      repaint();
    };
    run.mark = function (id, state) {
      const g = run.list.find((x) => x.id === id);
      if (g) { g.state = state; repaint(); }
    };
    run.done = function () {
      if (run.ended) return;
      run.ended = true;
      clearTimeout(run.timer);
      const hide = () => {
        if (active === run.id) { box.hidden = true; document.body.removeAttribute('aria-busy'); if (skateRink) skateRink.stop(); }
      };
      if (!run.shownAt) { hide(); return; }
      setTimeout(hide, Math.max(0, SHOW_AT_LEAST - (Date.now() - run.shownAt)));
    };
    return run;
  }

  root.NhlLoader = { start };
})(typeof self !== 'undefined' ? self : this);
