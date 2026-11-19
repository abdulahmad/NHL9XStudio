/**
 * Loading screen for Studio: shown while the game list is read and the first game loads, and while a folder or file is opened.
 * It names each game it is working on, with a waiting / checking / ready state, so a slow start is never a blank page.
 *
 *   NhlLoading.show({ title, detail, games: [{ id, title }] })   open (or retitle) the screen
 *   NhlLoading.detail(text)                                       the line under the title
 *   NhlLoading.setGames([{ id, title }])                          replace the list
 *   NhlLoading.game(id, state, note, title)                       state: 'waiting' | 'working' | 'ready' | 'skipped' | 'error'
 *   NhlLoading.hide()                                             close it (after a short moment so a quick load is not a flash)
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlLoading = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  const STATES = ['waiting', 'working', 'ready', 'skipped', 'error'];
  const MARK = { waiting: '', working: '', ready: '✓', skipped: '–', error: '!' };
  const LABEL = { waiting: 'waiting', working: 'checking', ready: 'ready', skipped: 'not found', error: 'problem' };
  let host = null;
  let rows = new Map();
  let shownAt = 0;
  let hideTimer = null;
  let doc = null;

  function ensure() {
    doc = root.document;
    if (!doc || !doc.body) return false;
    if (host && host.isConnected) return true;
    host = doc.createElement('div');
    host.id = 'loading-screen';
    host.className = 'loading-screen';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    host.hidden = true;
    host.innerHTML = [
      '<div class="loading-card">',
      '  <div class="loading-rink" aria-hidden="true"><span class="loading-puck"></span><span class="loading-line"></span></div>',
      '  <h2 class="loading-title"></h2>',
      '  <p class="loading-detail"></p>',
      '  <ul class="loading-games"></ul>',
      '</div>'
    ].join('');
    doc.body.appendChild(host);
    return true;
  }

  const q = (cls) => host.querySelector('.' + cls);

  function setGames(list) {
    if (!ensure()) return;
    const ul = q('loading-games');
    ul.textContent = '';
    rows = new Map();
    for (const g of list || []) addGame(g.id, g.title, g.state || 'waiting', g.note || '');
  }

  function paintRow(id, text) {
    const row = rows.get(id);
    if (!row) return;
    row.li.className = 'loading-game is-' + row.state;
    row.mark.textContent = MARK[row.state];
    row.name.textContent = row.title;
    row.noteEl.textContent = text || LABEL[row.state];
  }

  function addGame(id, title, state, note) {
    if (!ensure()) return;
    if (rows.has(id)) { game(id, state || rows.get(id).state, note, title); return; }
    const li = doc.createElement('li');
    const mark = doc.createElement('span');
    mark.className = 'loading-mark';
    mark.setAttribute('aria-hidden', 'true');
    const name = doc.createElement('span');
    name.className = 'loading-name';
    const noteEl = doc.createElement('span');
    noteEl.className = 'loading-note';
    li.appendChild(mark);
    li.appendChild(name);
    li.appendChild(noteEl);
    q('loading-games').appendChild(li);
    rows.set(id, { li, mark, name, noteEl, title: title || id, state: STATES.indexOf(state) >= 0 ? state : 'waiting' });
    paintRow(id, note);
  }

  function game(id, state, note, title) {
    if (!ensure()) return;
    if (!rows.has(id)) { addGame(id, title || id, state, note); return; }
    const row = rows.get(id);
    if (STATES.indexOf(state) >= 0) row.state = state;
    if (title) row.title = title;
    paintRow(id, note);
  }

  function detail(text) {
    if (!ensure()) return;
    q('loading-detail').textContent = text || '';
  }

  function show(opts) {
    if (!ensure()) return;
    const o = opts || {};
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    q('loading-title').textContent = o.title || 'Loading';
    q('loading-detail').textContent = o.detail || '';
    if (o.games) setGames(o.games);
    else if (o.reset !== false && host.hidden) setGames([]);
    if (host.hidden) shownAt = Date.now();
    host.hidden = false;
    host.classList.remove('is-leaving');
    doc.body.classList.add('is-loading');
  }

  /** Close the screen; it stays at least `minMs` so a fast load is a short flash, not a flicker. */
  function hide(minMs) {
    if (!host || host.hidden) return;
    const wait = Math.max(0, (minMs == null ? 350 : minMs) - (Date.now() - shownAt));
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      host.classList.add('is-leaving');
      setTimeout(() => { if (host.classList.contains('is-leaving')) { host.hidden = true; doc.body.classList.remove('is-loading'); } }, 200);
    }, wait);
  }

  return { show, hide, detail, setGames, addGame, game, STATES };
});
