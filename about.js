// The "work in progress" pop-up. It reads changelog.json, shows the newest version, and opens by itself the first time and again
// whenever that version differs from the last one dismissed (kept in localStorage). The About link in the header reopens it.
(function () {
  const KEY = 'nhl9x-about-seen';
  const ISSUES = 'https://github.com/abdulahmad/NHL9XStudio/issues';
  let modal;

  function lsGet() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function lsSet(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private window: it just shows again */ } }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function build(releases) {
    const cur = releases[0] ? releases[0].version : '';
    const scrim = el('div', 'about-scrim');
    const box = el('div', 'about-modal');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'about-title');

    const top = el('div', 'about-ver');
    const h = el('h1', '', 'Welcome to NHL9X Studio');
    h.id = 'about-title';
    top.append(h, el('span', 'about-vnum', 'v' + cur));
    box.append(top, el('div', 'about-sub', 'Work in progress'));
    box.append(el('p', '', 'This is an active reverse-engineering project. Some games are well understood; others are still being mapped, and you will hit missing data, wrong names and rough edges.'));

    const tiers = el('div', 'about-tiers');
    [['ok', 'Mature', 'NHL 92, NHLPA 93 (Genesis, SNES)'], ['wip', 'Very WIP', 'NHL 94 and later, including NHL 95 (Genesis, SNES, PC)']].forEach(([c, tag, txt]) => {
      const t = el('div', 'about-tier');
      t.append(el('span', 'about-tag ' + c, tag), el('span', '', txt));
      tiers.append(t);
    });
    box.append(tiers);

    const fb = el('p', 'about-feedback', 'Found a bug or want something added? ');
    const a = el('a', '', 'Tell us on GitHub Issues');
    a.href = ISSUES; a.target = '_blank'; a.rel = 'noopener';
    fb.append(a, '.');
    box.append(fb);

    const notice = el('p', 'about-notice');
    notice.append("This screen shows again whenever the version changes, so you can see what's new. Reopen it any time from ", el('b', '', 'About'), ' in the header.');
    box.append(notice);

    const det = el('details', 'about-log');
    det.open = true;
    det.append(el('summary', '', "What's changed"));
    const log = el('div', 'about-log-body');
    releases.forEach((r) => {
      const h3 = el('h3', '', 'v' + r.version);
      if (r.date) h3.append(el('small', '', r.date));
      const ul = el('ul');
      r.changes.forEach((c) => ul.append(el('li', '', c)));
      log.append(h3, ul);
    });
    det.append(log);
    box.append(det);

    const foot = el('div', 'about-foot');
    const lab = el('label');
    const cb = el('input');
    cb.type = 'checkbox'; cb.checked = true;
    lab.append(cb, ' Don’t show again until the next version');
    const ok = el('button', '', 'Got it');
    ok.type = 'button';
    foot.append(lab, ok);
    box.append(foot);
    scrim.append(box);

    function close() {
      if (cb.checked) lsSet(cur);
      scrim.hidden = true;
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
    ok.addEventListener('click', close);
    scrim._open = () => { scrim.hidden = false; document.addEventListener('keydown', onKey); ok.focus(); };
    return { scrim, cur };
  }

  function init() {
    fetch('changelog.json').then((r) => r.json()).then((data) => {
      const built = build(data.releases);
      modal = built.scrim;
      modal.hidden = true;
      document.body.append(modal);
      const link = document.getElementById('about-open');
      if (link) link.addEventListener('click', () => modal._open());
      if (lsGet() !== built.cur) modal._open();
    }).catch(() => { /* no changelog: no pop-up */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
